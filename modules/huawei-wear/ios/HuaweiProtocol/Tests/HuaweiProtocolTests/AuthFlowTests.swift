import XCTest
@testable import HuaweiProtocol

/// The phone side (authenticator, initializer, activity sync) against `PacketsAuthFakeWatch`: real HMAC/HKDF/AES-GCM on both sides, the same
/// frames the Fit 4 Pro exchanges over BLE.
final class AuthFlowTests: XCTestCase {
    let identityAndroidId = "0123456789ABCDEF0123456789ABCDEF"
    let now = Date(timeIntervalSince1970: 1_792_000_000)

    override func tearDown() {
        Entropy.provider = Entropy.systemProvider
    }

    struct Rig {
        let watch: PacketsAuthFakeWatch
        let session: HuaweiSession
        let identity: InMemoryDeviceIdentity
        let log: PacketsLogBox
        let authenticator: HuaweiAuthenticator
    }

    private func fastTimeouts(auth: Int = 3000) -> LinkTimeouts {
        var t = LinkTimeouts()
        t.authMs = auth
        t.firstAuthMs = auth
        t.hichainFirstStepMs = auth
        t.hichainStepMs = auth
        t.initMs = 1500
        t.queryMs = 1500
        t.syncCountMs = 1500
        t.syncDataMs = 1500
        t.setupStatusMs = 80
        t.linkParamsRetryMs = auth
        t.linkParamsBackoffMs = 5
        return t
    }

    private func makeRig(
        _ config: PacketsAuthFakeWatch.Config = .init(), bonded: Bool = false, authKey: Bytes? = nil, watchKnowsPhone: Bool = false,
        deviceType: HuaweiDeviceType = .ble, auth: Int = 3000
    ) -> Rig {
        let watch = PacketsAuthFakeWatch(config: config)
        let log = PacketsLogBox()
        let session = HuaweiSession(sink: watch, log: log.sink)
        watch.attach(session)
        let identity = InMemoryDeviceIdentity(
            deviceAddress: "11111111-2222-3333-4444-555555555555", macAddress: "FF:FF:FF:AB:C1:23", androidId: identityAndroidId,
            authKey: authKey, bonded: bonded
        )
        watch.bondAddress = identity.deviceAddress
        if watchKnowsPhone, let authKey { watch.knownIdentities[identity.androidIdBytes] = authKey }
        let authenticator = HuaweiAuthenticator(session: session, identity: identity, log: log.sink, deviceType: deviceType, phoneModel: "iPhone17,1")
        authenticator.timeouts = fastTimeouts(auth: auth)
        return Rig(watch: watch, session: session, identity: identity, log: log, authenticator: authenticator)
    }

    /// A rig whose LinkParams waits are `waitMs` while the HiChain steps keep their generous timeouts (the crypto of a first bind is slow in a
    /// debug build), so a retry test does not wait seconds and still authenticates once the watch answers.
    private func shortLinkParamsRig(_ config: PacketsAuthFakeWatch.Config, waitMs: Int) -> Rig {
        let rig = makeRig(config)
        var timeouts = rig.authenticator.timeouts
        timeouts.authMs = waitMs
        timeouts.linkParamsRetryMs = waitMs
        rig.authenticator.timeouts = timeouts
        return rig
    }

    private let hiChainLabels = Array(repeating: "01/28", count: 7)

    // MARK: HiChain3 first bind (authType 5), init, sync

    func testFirstBindThenInitThenSyncAgainstTheFakeWatch() async throws {
        var config = PacketsAuthFakeWatch.Config()
        let midnight = Int32(Int(now.timeIntervalSince1970) - Int(now.timeIntervalSince1970) % 86400)
        config.stepPages = [
            .init(timestamp: midnight - 600, subs: [(0, [0x0E, 0x00, 0x64, 0x03, 0xE8, 0x00, 0x50]), (1, [0x4E, 0x00, 0x0A, 0x00, 0x05, 0x00, 0x03, 72])], number: nil),
            .init(timestamp: midnight + 600, subs: [(0, [0x8E, 0x03, 0x00, 0x05, 0x00, 0x01, 0x00, 0x02, 97, 55]), (2, [0x0E, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00])], number: nil),
        ]
        config.sleepPages = [[(0x07, 1_791_990_000, 30), (0x06, 1_791_991_800, 15)]]
        config.totals = (5000, 200, 3800)
        let rig = makeRig(config)

        // --- authentication
        let mode = try await rig.authenticator.authenticate()
        XCTAssertEqual(mode, .hichain3)
        XCTAssertEqual(rig.authenticator.protocolVersion, 2)
        XCTAssertEqual(rig.watch.labels, ["01/01", "01/33", "01/2c"] + hiChainLabels) // op1: 4 messages, op2: 3
        XCTAssertFalse(rig.identity.isFirstConnection)
        let token = try XCTUnwrap(rig.watch.knownIdentities[rig.identity.androidIdBytes])
        XCTAssertEqual(token.count, 32)
        XCTAssertEqual(rig.identity.authKey, token)
        let key = try XCTUnwrap(rig.session.params.secretKey)
        XCTAssertEqual(key.count, 32)
        XCTAssertEqual(key, rig.watch.params.secretKey, "phone and watch derived the same session key")
        XCTAssertNotEqual(key, token)
        XCTAssertEqual(rig.session.params.sliceSize, 1022)
        XCTAssertEqual(rig.session.params.mtu, 514)
        XCTAssertEqual(rig.session.params.deviceSupportType, 4)
        XCTAssertEqual(rig.session.params.authVersion, 1)
        XCTAssertEqual(rig.session.params.pinCode, config.pin)
        XCTAssertTrue(rig.log.contains("Auth: hichain3 mode (authType=5, firstConnection=true)"))
        XCTAssertTrue(rig.log.contains("Auth: the watch and the local state agree (authType 5, firstConnection=true)"))

        // The SecurityNegotiation the watch saw: authMode 4, our android id and the phone model (real wire layout).
        let negotiation = try XCTUnwrap(rig.watch.requests("01/33").first).tlv
        XCTAssertEqual(try negotiation.byte(0x01), 4)
        XCTAssertEqual(try negotiation.byte(0x02), 1)
        XCTAssertEqual(try negotiation.bytes(0x05), rig.identity.androidIdBytes)
        XCTAssertEqual(try negotiation.string(0x07), "iPhone17,1")

        // --- init
        let authCount = rig.watch.seen.count
        let caps = DeviceCaps()
        let profile = UserProfileData(heightCm: 175, weightKg: 70, birthYear: 1990, sex: "male", dailyStepGoal: 8000)
        let initializer = HuaweiInitializer(
            session: rig.session, caps: caps, log: rig.log.sink, bondedName: nil, protocolVersion: rig.authenticator.protocolVersion, profile: profile
        )
        initializer.timeouts = fastTimeouts()
        initializer.now = { self.now }
        initializer.timeZone = TimeZone(identifier: "Asia/Jakarta")!
        let result = try await initializer.run()
        XCTAssertEqual(result.productModel, "SYA-B29")
        XCTAssertEqual(result.softwareVersion, "6.1.0.117(SP20C00M05)")
        XCTAssertEqual(result.hardwareVersion, "1.0.0.5")
        XCTAssertEqual(result.serialNumber, "SN123456")
        XCTAssertEqual(result.deviceName, "HUAWEI WATCH FIT 4 Pro-40A")
        XCTAssertEqual(result.batteryLevel, 71)

        let initRequests = Array(rig.watch.seen[authCount...])
        XCTAssertEqual(
            initRequests.map { $0.label },
            ["01/07", "01/05", "01/05", "01/08", "01/02", "01/03", "01/37", "1a/05", "01/31", "01/30", "01/3f", "01/3e", "01/3d", "01/35", "07/01", "07/16"]
        )
        XCTAssertTrue(initRequests.allSatisfy { $0.encrypted }, "after the bind every TLV is encrypted with the session key")
        // SetTime: the watch is one second ahead, so the time is sent again (the Kotlin 'apply').
        XCTAssertTrue(rig.log.contains("SetTime: systemTime=1792000000 deviceTime=1792000001 diff=1"))
        let timeRequest = try XCTUnwrap(rig.watch.requests("01/05").first).tlv
        XCTAssertEqual(try timeRequest.int(0x01), 1_792_000_000)
        XCTAssertEqual(Array(try timeRequest.bytes(0x02)), [7, 0]) // Asia/Jakarta, UTC+7
        // SetUpDeviceStatus names the watch, WearStatus follows even though the watch never answers the former.
        XCTAssertEqual(try rig.watch.requests("01/3e").first?.tlv.string(0x02), "HUAWEI WATCH FIT 4 Pro-40A")
        XCTAssertEqual(try rig.watch.requests("1a/05").first?.tlv.bytes(0x01), [0])
        XCTAssertFalse(try XCTUnwrap(rig.watch.requests("1a/05").first).tlv.contains(0x03)) // expand capability 0xac not offered
        // Caps
        XCTAssertTrue(caps.supports(0x01, 0x37))
        XCTAssertTrue(caps.supports(0x07, 0x16))
        XCTAssertFalse(caps.supports(0x07, 0x02))
        XCTAssertTrue(caps.expandCapability(182))
        XCTAssertTrue(caps.expandCapability(109))
        XCTAssertFalse(caps.expandCapability(143))
        XCTAssertTrue(caps.truSleepNewSync)
        XCTAssertFalse(caps.rriNewSync)
        XCTAssertTrue(caps.supportsTruSleep)
        // The goal reached the watch; the user info did not, because 07/02 is not in GB's command table (see testProfileSender...).
        let goal = try XCTUnwrap(rig.watch.motionGoal).object(0x81).object(0x82)
        XCTAssertEqual(try goal.int(0x05), 8000)
        XCTAssertNil(rig.watch.userInfo)

        // --- sync
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let download = SleepDownload(
            segments: [
                SleepSegment(start: 1_791_990_000, end: 1_791_991_800, type: 0x07, stage: "deep"), // the same as a frame record: de-duplicated
                SleepSegment(start: 1_791_980_000, end: 1_791_981_000, type: 0x5656, stage: "rem"),
            ],
            scores: [SleepScore(start: 1_791_980_000, end: 1_791_992_700, score: 88, efficiency: 91)]
        )
        let sync = ActivitySync(session: rig.session, caps: caps, log: rig.log.sink, trueSleep: { since, end in
            XCTAssertEqual(since, 1_791_000_000)
            XCTAssertEqual(end, 1_792_000_000)
            return download
        })
        sync.timeouts = fastTimeouts()
        let synced = try await sync.sync(fromSec: 1_791_000_000, now: now, calendar: calendar)
        XCTAssertEqual(synced.from, 1_791_000_000)
        XCTAssertEqual(synced.to, 1_792_000_000)
        XCTAssertEqual(
            synced.samples,
            [
                StepSample(timestamp: Int64(midnight) - 600, steps: 100, calories: 1000, distance: 80, heartRate: nil, spo2: nil, restingHeartRate: nil),
                StepSample(timestamp: Int64(midnight) - 540, steps: 10, calories: 5, distance: 3, heartRate: 72, spo2: nil, restingHeartRate: nil),
                StepSample(timestamp: Int64(midnight) + 600, steps: 5, calories: 1, distance: 2, heartRate: nil, spo2: 97, restingHeartRate: 55),
                // 0xFFFF steps is "absent" and maps to 0
                StepSample(timestamp: Int64(midnight) + 720, steps: 0, calories: 0, distance: 0, heartRate: nil, spo2: nil, restingHeartRate: nil),
            ]
        )
        XCTAssertEqual(
            synced.sleep,
            [
                SleepSegment(start: 1_791_980_000, end: 1_791_981_000, type: 0x5656, stage: "rem"),
                SleepSegment(start: 1_791_990_000, end: 1_791_991_800, type: 0x07, stage: "deep"),
                SleepSegment(start: 1_791_991_800, end: 1_791_992_700, type: 0x06, stage: "light"),
            ]
        )
        XCTAssertEqual(synced.totalSteps, 5000)
        XCTAssertEqual(synced.totalCalories, 200)
        XCTAssertEqual(synced.totalDistance, 3800)
        XCTAssertEqual(synced.sleepScores, download.scores)
        let syncRequests = Array(rig.watch.seen[(authCount + initRequests.count)...])
        XCTAssertEqual(syncRequests.map { $0.label }, ["07/0c", "07/0d", "07/0a", "07/0b", "07/0b", "07/03"])
        XCTAssertTrue(syncRequests.allSatisfy { $0.encrypted })
        let sleepCount = syncRequests[0].tlv
        XCTAssertEqual(try sleepCount.int(0x03), 1_791_000_000)
        XCTAssertEqual(try sleepCount.int(0x04), 1_792_000_000)
        XCTAssertTrue(rig.log.contains("Sync HR: 4 step subcontainers (0 unparsed): heartRate TV in 1 (measured 1), SpO2 TV in 1 (measured 1), resting HR TV in 1 (measured 1)"))
    }

    func testTotalsFallBackToTodaysSamplesWhenTheWatchAnswersWithoutTheContainer() async throws {
        var config = PacketsAuthFakeWatch.Config()
        let midnight = Int32(Int(now.timeIntervalSince1970) - Int(now.timeIntervalSince1970) % 86400)
        config.stepPages = [
            .init(timestamp: midnight - 120, subs: [(0, [0x0E, 0x00, 0x64, 0x03, 0xE8, 0x00, 0x50])], number: nil), // yesterday: not counted
            .init(timestamp: midnight + 120, subs: [(0, [0x0E, 0x00, 0x0A, 0x07, 0xD0, 0x00, 0x05]), (1, [0x0E, 0x00, 0x14, 0x07, 0xD0, 0x00, 0x07])], number: nil),
        ]
        config.sleepPages = nil // the Fit 4 answers the sleep count without the 0x81 container
        config.totals = nil
        let rig = makeRig(config)
        _ = try await rig.authenticator.authenticate()
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let sync = ActivitySync(session: rig.session, caps: DeviceCaps(), log: rig.log.sink, trueSleep: { _, _ in .empty })
        sync.timeouts = fastTimeouts()
        let result = try await sync.sync(fromSec: 0, now: now, calendar: calendar)
        XCTAssertEqual(result.from, 946_684_800) // zero starts at 2000-01-01, as GB
        XCTAssertEqual(result.samples.count, 3)
        XCTAssertEqual(result.totalSteps, 30)
        XCTAssertEqual(result.totalCalories, 4) // (2000 + 2000) cal / 1000
        XCTAssertEqual(result.totalDistance, 12)
        XCTAssertTrue(result.sleep.isEmpty)
        XCTAssertTrue(rig.log.contains("SleepDataCount: no data in response"))
        XCTAssertTrue(rig.log.contains("FitnessTotals: no data in response"))
        XCTAssertTrue(rig.log.contains("(summed from samples)"))
    }

    func testASliceEndingBeforeTodayEndsItsRequestsThereAndSkipsTheTotals() async throws {
        var config = PacketsAuthFakeWatch.Config()
        config.stepPages = []
        config.sleepPages = []
        config.totals = (5000, 200, 3800)
        let rig = makeRig(config)
        _ = try await rig.authenticator.authenticate()
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let before = rig.watch.seen.count
        let sync = ActivitySync(session: rig.session, caps: DeviceCaps(), log: rig.log.sink, trueSleep: { since, end in
            XCTAssertEqual(since, 1_700_000_000)
            XCTAssertEqual(end, 1_710_000_000)
            return .empty
        })
        sync.timeouts = fastTimeouts()
        let result = try await sync.sync(fromSec: 1_700_000_000, toSec: 1_710_000_000, now: now, calendar: calendar)
        XCTAssertEqual(result.from, 1_700_000_000)
        XCTAssertEqual(result.to, 1_710_000_000)
        // No totals request for a window that ends before today, and nothing summed.
        let labels = Array(rig.watch.seen[before...]).map { $0.label }
        XCTAssertFalse(labels.contains("07/03"))
        XCTAssertEqual(result.totalSteps, 0)
        let sleepCount = try XCTUnwrap(rig.watch.seen[before...].first).tlv
        XCTAssertEqual(try sleepCount.int(0x03), 1_700_000_000)
        XCTAssertEqual(try sleepCount.int(0x04), 1_710_000_000)
    }

    func testASliceEndingAfterNowIsCutAtNow() async throws {
        var config = PacketsAuthFakeWatch.Config()
        config.stepPages = []
        config.sleepPages = []
        config.totals = (1, 2, 3)
        let rig = makeRig(config)
        _ = try await rig.authenticator.authenticate()
        let sync = ActivitySync(session: rig.session, caps: DeviceCaps(), log: rig.log.sink, trueSleep: { _, _ in .empty })
        sync.timeouts = fastTimeouts()
        let result = try await sync.sync(fromSec: 1_791_000_000, toSec: 1_999_999_999, now: now)
        XCTAssertEqual(result.to, 1_792_000_000)
        XCTAssertEqual(result.totalSteps, 1)
    }

    func testStepPagingFollowsTheWatchsCounterAndSkipsUnreadableSubcontainers() async throws {
        var config = PacketsAuthFakeWatch.Config()
        config.stepPages = [
            .init(timestamp: 1_791_000_000, subs: [(0, [0x02, 0x00, 0x01])], number: nil),
            .init(timestamp: 1_791_003_600, subs: [(0, [0x02, 0x00, 0x02])], number: 2), // the watch answers our request 1 with "page 2": GB follows its counter
            .init(timestamp: 1_791_007_200, subs: [(0, [0x02, 0x00, 0x03])], number: nil), // never asked for
            .init(timestamp: 1_791_010_800, subs: [(0, [0x02, 0x00, 0x04]), (1, [0x04])], number: nil), // the second subcontainer is too short
        ]
        config.sleepPages = []
        config.totals = (7, 0, 0)
        let rig = makeRig(config)
        _ = try await rig.authenticator.authenticate()
        let sync = ActivitySync(session: rig.session, caps: DeviceCaps(), log: rig.log.sink, trueSleep: { _, _ in .empty })
        sync.timeouts = fastTimeouts()
        let result = try await sync.sync(fromSec: 1_791_000_000, now: now)
        XCTAssertEqual(result.samples.map { $0.steps }, [1, 2, 4])
        XCTAssertTrue(rig.log.contains("StepData 2/4: counts do not match (received 2, expected 1)"))
        XCTAssertTrue(rig.log.contains("StepData 4/4: Data is too short for selected features."))
        XCTAssertEqual(rig.watch.requests("07/0b").count, 3)
        XCTAssertEqual(try rig.watch.requests("07/0b").map { try $0.tlv.object(0x81).short(0x02) }, [0, 1, 3])
    }

    func testATrueSleepFailureLeavesTheStepDataIntact() async throws {
        var config = PacketsAuthFakeWatch.Config()
        config.stepPages = [.init(timestamp: 1_791_000_000, subs: [(0, [0x02, 0x00, 0x09])], number: nil)]
        config.sleepPages = []
        let rig = makeRig(config)
        _ = try await rig.authenticator.authenticate()
        let failing = ActivitySync(session: rig.session, caps: DeviceCaps(), log: rig.log.sink, trueSleep: { _, _ in throw WearError(.timeout, "sleep file") })
        failing.timeouts = fastTimeouts()
        let result = try await failing.sync(fromSec: 1_791_000_000, now: now)
        XCTAssertEqual(result.samples.map { $0.steps }, [9])
        XCTAssertTrue(rig.log.contains("TruSleep: sleep download failed"))

        let lost = ActivitySync(session: rig.session, caps: DeviceCaps(), log: rig.log.sink, trueSleep: { _, _ in throw WearError(.disconnected, "link lost") })
        lost.timeouts = fastTimeouts()
        do {
            _ = try await lost.sync(fromSec: 1_791_000_000, now: now)
            XCTFail("a lost link must abort the sync")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .disconnected)
        }
    }

    // MARK: reconnect (authType 6)

    func testReconnectWithTheStoredKeyRunsOnlyOperation2() async throws {
        let stored = Bytes((0..<32).map { UInt8($0 &* 7 &+ 1) })
        let rig = makeRig(bonded: true, authKey: stored, watchKnowsPhone: true)
        let mode = try await rig.authenticator.authenticate()
        XCTAssertEqual(mode, .hichain3)
        XCTAssertEqual(rig.watch.labels, ["01/01", "01/33", "01/28", "01/28", "01/28"], "no PinCode, no op 1")
        XCTAssertEqual(try rig.watch.requests("01/33").first?.tlv.byte(0x02), 1)
        XCTAssertEqual(rig.identity.authKey, stored)
        XCTAssertTrue(rig.log.contains("Auth: the watch and the local state agree (authType 6, firstConnection=false)"))
        XCTAssertTrue(rig.log.contains("Auth: hichain3 mode (authType=6, firstConnection=false)"))
        let key = try XCTUnwrap(rig.session.params.secretKey)
        XCTAssertEqual(key, rig.watch.params.secretKey)
        XCTAssertEqual(key.count, 32)

        // The session key works both ways: battery over the encrypted link.
        let battery = try await rig.session.queryBattery(timeoutMs: 1500)
        XCTAssertEqual(battery, 71)
        XCTAssertEqual(try XCTUnwrap(rig.watch.requests("01/08").first).encrypted, true)
    }

    func testTwoReconnectsDeriveDifferentSessionKeys() async throws {
        let stored = Bytes((0..<32).map { UInt8($0 &+ 100) })
        var keys = [Bytes]()
        for _ in 0..<2 {
            let rig = makeRig(bonded: true, authKey: stored, watchKnowsPhone: true)
            _ = try await rig.authenticator.authenticate()
            keys.append(try XCTUnwrap(rig.session.params.secretKey))
        }
        XCTAssertNotEqual(keys[0], keys[1])
    }

    func testAStoredKeyTheWatchDoesNotKnowStartsAFirstBind() async throws {
        let stale = Bytes(repeating: 0x42, count: 32)
        let rig = makeRig(bonded: true, authKey: stale, watchKnowsPhone: false)
        XCTAssertFalse(rig.identity.isFirstConnection, "locally this identity claims to be bonded")
        let mode = try await rig.authenticator.authenticate()
        XCTAssertEqual(mode, .hichain3)
        XCTAssertEqual(try rig.watch.requests("01/33").first?.tlv.byte(0x02), 1)
        XCTAssertEqual(rig.watch.labels, ["01/01", "01/33", "01/2c"] + hiChainLabels)
        XCTAssertTrue(rig.log.contains("does not know this identity (authType 5) although a bind key is stored locally"))
        XCTAssertTrue(rig.log.contains("Auth: hichain3 mode (authType=5, firstConnection=true)"))
        let fresh = try XCTUnwrap(rig.watch.knownIdentities[rig.identity.androidIdBytes])
        XCTAssertNotEqual(fresh, stale)
        XCTAssertEqual(rig.identity.authKey, fresh)
        XCTAssertEqual(rig.session.params.secretKey, rig.watch.params.secretKey)
    }

    func testAWatchThatKnowsUsWhileTheLocalStateIsFreshFollowsTheLocalFlag() async throws {
        let rig = makeRig(bonded: false, authKey: nil)
        rig.watch.knownIdentities[rig.identity.androidIdBytes] = Bytes(repeating: 0x11, count: 32)
        let mode = try await rig.authenticator.authenticate()
        XCTAssertEqual(mode, .hichain3)
        XCTAssertEqual(rig.watch.labels, ["01/01", "01/33", "01/2c"] + hiChainLabels, "Kotlin runs op 1 on the local flag")
        XCTAssertTrue(rig.log.contains("already knows this identity (authType 6) but no bind is stored locally"))
        XCTAssertEqual(rig.session.params.secretKey, rig.watch.params.secretKey)
    }

    // MARK: first bind only on request

    func testABackgroundReconnectMayNotBindAWatchThatForgotUs() async throws {
        let stale = Bytes(repeating: 0x42, count: 32)
        let rig = makeRig(bonded: true, authKey: stale, watchKnowsPhone: false)
        do {
            _ = try await rig.authenticator.authenticate(firstBindAllowed: false)
            XCTFail("authType 5 needs a first bind, which this connection may not start")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .authFailed)
            XCTAssertEqual(e.message, "watch does not know this phone: first bind needed")
            XCTAssertTrue(e.isFirstBindNeeded)
            XCTAssertEqual((e.underlying as? FirstBindNeededError)?.authType, 5)
            XCTAssertTrue(e.isLostBinding, "a stored key the watch forgot: something else bound the watch (JRG-414)")
        }
        XCTAssertEqual(rig.watch.labels, ["01/01", "01/33"], "no PinCode, no HiChain: the watch is untouched")
        XCTAssertEqual(rig.identity.authKey, stale)
        XCTAssertNil(rig.session.params.secretKey)
        XCTAssertTrue(rig.watch.knownIdentities.isEmpty)
        XCTAssertTrue(rig.log.contains("this connection may not start a first bind"))
    }

    func testAFreshPhoneMayNotBindInTheBackgroundEither() async throws {
        let rig = makeRig(bonded: false, authKey: nil)
        do {
            _ = try await rig.authenticator.authenticate(firstBindAllowed: false)
            XCTFail("a first bind needs the user")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .authFailed)
            XCTAssertEqual(e.message, "watch does not know this phone: first bind needed")
            XCTAssertTrue(e.isFirstBindNeeded)
            XCTAssertFalse(e.isLostBinding, "nothing was stored here, so nothing was lost")
        }
        XCTAssertEqual(rig.watch.labels, ["01/01", "01/33"])
        XCTAssertTrue(rig.identity.isFirstConnection)
        // The same rig binds as soon as the user asks for it.
        let mode = try await rig.authenticator.authenticate()
        XCTAssertEqual(mode, .hichain3)
        XCTAssertFalse(rig.identity.isFirstConnection)
    }

    func testAWatchThatKnowsUsButNoLocalKeyIsAlsoAFirstBind() async throws {
        let rig = makeRig(bonded: false, authKey: nil)
        rig.watch.knownIdentities[rig.identity.androidIdBytes] = Bytes(repeating: 0x11, count: 32)
        do {
            _ = try await rig.authenticator.authenticate(firstBindAllowed: false)
            XCTFail("without a stored key only a first bind can work")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .authFailed)
            XCTAssertEqual(e.message, "no bind key is stored for this watch: first bind needed")
            XCTAssertEqual((e.underlying as? FirstBindNeededError)?.authType, 6)
        }
        XCTAssertEqual(rig.watch.labels, ["01/01", "01/33"])
    }

    func testABackgroundReconnectOfABoundPhoneNeedsNoFirstBind() async throws {
        let stored = Bytes((0..<32).map { UInt8($0 &+ 9) })
        let rig = makeRig(bonded: true, authKey: stored, watchKnowsPhone: true)
        let mode = try await rig.authenticator.authenticate(firstBindAllowed: false)
        XCTAssertEqual(mode, .hichain3)
        XCTAssertEqual(rig.watch.labels, ["01/01", "01/33", "01/28", "01/28", "01/28"])
        XCTAssertEqual(rig.session.params.secretKey, rig.watch.params.secretKey)
    }

    func testOtherAuthFailuresAreNotReportedAsFirstBindNeeded() async throws {
        var config = PacketsAuthFakeWatch.Config()
        config.corruptHiChainToken = true
        let rig = makeRig(config)
        do {
            _ = try await rig.authenticator.authenticate(firstBindAllowed: true)
            XCTFail("a wrong token must be rejected")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .authFailed)
            XCTAssertFalse(e.isFirstBindNeeded)
        }
    }

    // MARK: failures

    func testASilentWatchIsAskedThreeTimesAndEndsInErrTimeout() async throws {
        var config = PacketsAuthFakeWatch.Config()
        config.silent = true
        let rig = makeRig(config, auth: 120)
        let recoveries = RecoveryCalls()
        rig.authenticator.linkRecovery = { attempt in
            recoveries.add(attempt)
            return "changed the link for attempt \(attempt)"
        }
        do {
            _ = try await rig.authenticator.authenticate()
            XCTFail("a silent watch cannot authenticate")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .timeout)
            XCTAssertTrue(e.message.hasPrefix("Authentication timed out: LinkParams: no response (service 0x01, command 0x01) within 120 ms"), e.message)
            XCTAssertTrue(e.message.hasSuffix("(3 attempts)"), e.message)
        }
        XCTAssertEqual(rig.watch.labels, ["01/01", "01/01", "01/01"])
        XCTAssertEqual(recoveries.attempts, [2, 3])
        XCTAssertTrue(rig.log.contains("LinkParams: no answer within 120 ms (attempt 1 of 3); trying again in 5 ms"))
        XCTAssertTrue(rig.log.contains("LinkParams: no answer within 120 ms (attempt 2 of 3); trying again in 10 ms"))
        XCTAssertTrue(rig.log.contains("LinkParams: before attempt 3: changed the link for attempt 3"))
    }

    func testALinkParamsAnswerOnTheSecondAttemptStillAuthenticates() async throws {
        var config = PacketsAuthFakeWatch.Config()
        config.ignoreFirst = ["01/01": 1]
        let rig = shortLinkParamsRig(config, waitMs: 150)
        let recoveries = RecoveryCalls()
        rig.authenticator.linkRecovery = { attempt in
            recoveries.add(attempt)
            return nil
        }
        let mode = try await rig.authenticator.authenticate()
        XCTAssertEqual(mode, .hichain3)
        XCTAssertEqual(Array(rig.watch.labels.prefix(3)), ["01/01", "01/01", "01/33"])
        XCTAssertEqual(recoveries.attempts, [2])
        XCTAssertTrue(rig.log.contains("LinkParams: answered on attempt 2 of 3"))
        XCTAssertEqual(rig.session.params.sliceSize, 1022)
    }

    func testAFailedRecoveryIsLoggedAndTheAttemptStillRuns() async throws {
        var config = PacketsAuthFakeWatch.Config()
        config.ignoreFirst = ["01/01": 1]
        let rig = shortLinkParamsRig(config, waitMs: 150)
        rig.authenticator.linkRecovery = { _ in throw WearError(.timeout, "GATT connect: no answer from the watch within 8000 ms") }
        let mode = try await rig.authenticator.authenticate()
        XCTAssertEqual(mode, .hichain3)
        XCTAssertTrue(rig.log.contains("LinkParams: before attempt 2: the link could not be changed"))
        XCTAssertTrue(rig.log.contains("LinkParams: answered on attempt 2 of 3"))
    }

    func testALostLinkDuringRecoveryStopsTheAttempts() async throws {
        var config = PacketsAuthFakeWatch.Config()
        config.silent = true
        let rig = makeRig(config, auth: 100)
        rig.authenticator.linkRecovery = { _ in throw WearError(.disconnected, "Bluetooth LE link ended: the watch ended the connection") }
        do {
            _ = try await rig.authenticator.authenticate()
            XCTFail("a lost link ends the authentication")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .disconnected)
        }
        XCTAssertEqual(rig.watch.labels, ["01/01"])
    }

    func testWithoutARecoveryTheAttemptsOnlyRepeat() async throws {
        var config = PacketsAuthFakeWatch.Config()
        config.ignoreFirst = ["01/01": 2]
        let rig = shortLinkParamsRig(config, waitMs: 100)
        let mode = try await rig.authenticator.authenticate()
        XCTAssertEqual(mode, .hichain3)
        XCTAssertTrue(rig.log.contains("LinkParams: answered on attempt 3 of 3"))
    }

    func testAWatchThatStopsAnsweringMidwayEndsInErrTimeout() async throws {
        var config = PacketsAuthFakeWatch.Config()
        config.silentCommands = ["01/2c"] // the PIN never arrives
        let rig = makeRig(config)
        var timeouts = fastTimeouts()
        timeouts.firstAuthMs = 300 // a first bind: SecurityNegotiation, PinCode and the HiChain steps wait this long
        rig.authenticator.timeouts = timeouts
        do {
            _ = try await rig.authenticator.authenticate()
            XCTFail("no PIN, no bind")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .timeout)
            XCTAssertTrue(e.message.contains("PinCode"), e.message)
        }
    }

    func testAWrongHiChainTokenIsErrAuthFailed() async throws {
        var config = PacketsAuthFakeWatch.Config()
        config.corruptHiChainToken = true
        let rig = makeRig(config)
        do {
            _ = try await rig.authenticator.authenticate()
            XCTFail("a wrong token must be rejected")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .authFailed)
            XCTAssertTrue(e.message.hasPrefix("Authentication failed: HiChain op1 step 1: tokenCheck:"), e.message)
        }
        XCTAssertNil(rig.session.params.secretKey)
        XCTAssertTrue(rig.identity.isFirstConnection)
    }

    func testAHiChainErrorCodeIsErrAuthFailed() async throws {
        var config = PacketsAuthFakeWatch.Config()
        config.hiChainErrorCode = 4
        let rig = makeRig(config)
        do {
            _ = try await rig.authenticator.authenticate()
            XCTFail("an error code must fail the bind")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .authFailed)
            XCTAssertTrue(e.message.contains("HiChain op1 step 1: Got errorCode 4"), e.message)
        }
    }

    func testAnUnknownIdentityInOp2IsErrAuthFailedNotAHang() async throws {
        // The local state claims a bind, the watch answers authType 6 for a different identity table: here the watch is told to know the id
        // but with another key, so the op 2 token check fails instead.
        let rig = makeRig(bonded: true, authKey: Bytes(repeating: 1, count: 32), watchKnowsPhone: false)
        rig.watch.knownIdentities[rig.identity.androidIdBytes] = Bytes(repeating: 2, count: 32)
        do {
            _ = try await rig.authenticator.authenticate()
            XCTFail("a different key must fail op 2")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .authFailed)
            XCTAssertTrue(e.message.contains("tokenCheck"), e.message)
        }
    }

    func testAnUnexpectedDeviceStatusIsReportedForNonBleLinks() async throws {
        var config = PacketsAuthFakeWatch.Config()
        config.deviceStatus = 5
        let rig = makeRig(config, deviceType: .aw)
        do {
            _ = try await rig.authenticator.authenticate()
            XCTFail("status 5 is not allowed")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .deviceStatus)
            XCTAssertTrue(e.message.contains("unexpected device status 5"), e.message)
        }
        XCTAssertEqual(rig.watch.labels, ["01/01", "01/16"])
        // The AW LinkParams request asks tag 0x06 as well.
        XCTAssertTrue(try XCTUnwrap(rig.watch.requests("01/01").first).tlv.contains(0x06))
    }

    func testBleSkipsTheDeviceStatusCheck() async throws {
        let rig = makeRig()
        _ = try await rig.authenticator.authenticate()
        XCTAssertFalse(rig.watch.labels.contains("01/16"))
        XCTAssertFalse(try XCTUnwrap(rig.watch.requests("01/01").first).tlv.contains(0x06))
    }

    // MARK: normal mode

    func testNormalModeAuthBondParamsBondThenAnEncryptedBatteryQuery() async throws {
        var config = PacketsAuthFakeWatch.Config()
        config.deviceSupportType = 0
        config.authVersion = 1
        let rig = makeRig(config)
        let mode = try await rig.authenticator.authenticate()
        XCTAssertEqual(mode, .normal)
        XCTAssertEqual(rig.watch.labels, ["01/01", "01/13", "01/0f", "01/0e"])
        XCTAssertFalse(rig.identity.isFirstConnection)
        let key = try XCTUnwrap(rig.session.params.secretKey)
        XCTAssertEqual(key.count, 16)
        XCTAssertEqual(key, rig.watch.bondKey, "the watch recovered the bonding key the phone encrypted")
        // BondParams says 7; the Bond request's IV took the next counter, 8; the next encrypted request carries 9 in its IV.
        XCTAssertEqual(rig.session.params.encryptionCounter, 8)
        let battery = try await rig.session.queryBattery(timeoutMs: 1500)
        XCTAssertEqual(battery, 71)
        XCTAssertTrue(try XCTUnwrap(rig.watch.requests("01/08").first).encrypted)
        XCTAssertEqual(rig.session.params.encryptionCounter, 9)
    }

    // MARK: init semantics

    func testInitSkipsUnansweredRequestsAndKeepsGoing() async throws {
        var config = PacketsAuthFakeWatch.Config()
        config.silentCommands = ["01/07", "01/08", "01/31"]
        let rig = makeRig(config)
        _ = try await rig.authenticator.authenticate()
        let caps = DeviceCaps()
        let initializer = HuaweiInitializer(session: rig.session, caps: caps, log: rig.log.sink, bondedName: "MyWatch", protocolVersion: 2)
        var timeouts = fastTimeouts()
        timeouts.initMs = 400
        initializer.timeouts = timeouts
        initializer.now = { self.now }
        let result = try await initializer.run()
        XCTAssertNil(result.productModel)
        XCTAssertNil(result.batteryLevel)
        XCTAssertTrue(rig.log.contains("ProductInfo skipped: ProductInfo: no response"))
        XCTAssertTrue(rig.log.contains("BatteryLevel skipped"))
        XCTAssertTrue(rig.log.contains("SettingRelated skipped"))
        XCTAssertFalse(caps.truSleepNewSync)
        XCTAssertTrue(caps.supports(0x01, 0x37), "later requests still ran")
        XCTAssertEqual(try rig.watch.requests("01/3e").first?.tlv.string(0x02), "MyWatch", "the bonded name wins over the ProductInfo name")
        XCTAssertTrue(rig.watch.labels.contains("01/35"))
        XCTAssertNil(rig.watch.motionGoal, "no profile, no profile request")
    }

    /// The sensor switches the user saved reach the watch on every connect, after the profile, in GB's order and only for the commands the
    /// watch lists; the zones go over FitnessData 07/21 on a watch without Track.
    func testInitSendsTheSavedSensorSwitchesAndTheZonesAfterTheProfile() async throws {
        var config = PacketsAuthFakeWatch.Config()
        config.commands[0x07] = [0x01, 0x03, 0x13, 0x16, 0x17, 0x1C, 0x1D, 0x21, 0x22, 0x23, 0x24]
        config.commands[0x17] = [0x17]
        let rig = makeRig(config)
        _ = try await rig.authenticator.authenticate()
        let authCount = rig.watch.seen.count
        let profile = UserProfileData(heightCm: 175, weightKg: 70, birthYear: 1990, sex: "male", dailyStepGoal: 8000)
        let sensors = HealthSensorConfig(automaticHeartRate: true, automaticSpo2: false, truSleep: true, highHeartRateAlert: 140, lowHeartRateAlert: 0)
        let initializer = HuaweiInitializer(
            session: rig.session, caps: DeviceCaps(), log: rig.log.sink, bondedName: nil, protocolVersion: 2, profile: profile, healthSensors: sensors
        )
        initializer.timeouts = fastTimeouts()
        initializer.now = { self.now }
        _ = try await initializer.run()

        let after = Array(rig.watch.seen[authCount...].map(\.label).drop { $0 != "07/01" })
        XCTAssertEqual(
            after, ["07/01", "07/21", "17/17", "07/23", "07/16", "07/17", "07/24", "07/1d"],
            "profile, zones, capability notifications, TruSleep, heart rate, SpO2, high alert (the low alert is off, so not overwritten)"
        )
        XCTAssertEqual(try rig.watch.requests("07/17").first?.tlv.bool(0x01), true)
        XCTAssertEqual(try rig.watch.requests("07/24").first?.tlv.bool(0x01), false)
        XCTAssertEqual(try rig.watch.requests("07/16").first?.tlv.bool(0x01), true)
        let alert = try XCTUnwrap(rig.watch.requests("07/1d").first).tlv
        XCTAssertEqual(try alert.bool(0x01), true)
        XCTAssertEqual(try alert.byte(0x02), Int8(truncatingIfNeeded: 140))
        let zones = try XCTUnwrap(rig.watch.requests("07/21").first).tlv.object(0x81)
        XCTAssertEqual(try zones.byte(0x09), Int8(truncatingIfNeeded: 220 - (2026 - 1990)), "the age comes from the saved profile")
        XCTAssertTrue(rig.watch.seen.allSatisfy { $0.encrypted || $0.service == 0x01 })
        XCTAssertTrue(rig.log.contains("HealthSensors: 6 of 6 requests acknowledged"))
        XCTAssertTrue(rig.log.contains("HR zones: ExpandCapability 0x36 (Track)=false, FitnessData 07/13=true, 07/21=true"))
        XCTAssertTrue(rig.log.contains("HR zones: sent 07/21 for age 36"))
    }

    func testInitSendsNothingForSensorsAWatchDoesNotList() async throws {
        let rig = makeRig()  // lists 07/16 only
        _ = try await rig.authenticator.authenticate()
        let authCount = rig.watch.seen.count
        let initializer = HuaweiInitializer(
            session: rig.session, caps: DeviceCaps(), log: rig.log.sink, bondedName: nil, protocolVersion: 2,
            healthSensors: HealthSensorConfig(truSleep: false, highHeartRateAlert: 120)
        )
        initializer.timeouts = fastTimeouts()
        initializer.now = { self.now }
        _ = try await initializer.run()
        let sensorLabels = rig.watch.seen[authCount...].map(\.label).filter { $0.hasPrefix("07/1") || $0.hasPrefix("07/2") || $0 == "17/17" || $0 == "07/16" }
        XCTAssertEqual(sensorLabels, ["07/16"])
        XCTAssertEqual(try rig.watch.requests("07/16").first?.tlv.bool(0x01), false, "the saved TruSleep switch, not a default")
        XCTAssertTrue(rig.log.contains("HealthSensors: 1 of 1 requests acknowledged"))
        XCTAssertTrue(rig.log.contains("branch=none"))
    }

    /// The phone's language reaches a watch that lists 0C/01 as the last init request: the legacy `in` for Indonesian, metric, no script
    /// without ExpandCapability 57; the app's pinned language wins over the phone's.
    func testInitSendsThePhoneLanguageWhenTheWatchListsIt() async throws {
        var config = PacketsAuthFakeWatch.Config()
        config.commands[0x0C] = [0x01]
        let rig = makeRig(config)
        _ = try await rig.authenticator.authenticate()
        let authCount = rig.watch.seen.count
        let initializer = HuaweiInitializer(
            session: rig.session, caps: DeviceCaps(), log: rig.log.sink, bondedName: nil, protocolVersion: 2, phoneLanguage: "id-ID"
        )
        initializer.timeouts = fastTimeouts()
        initializer.now = { self.now }
        _ = try await initializer.run()

        XCTAssertEqual(rig.watch.seen[authCount...].map(\.label).last, "0c/01", "the language is the last init request")
        let request = try XCTUnwrap(rig.watch.requests("0c/01").first)
        XCTAssertEqual(try request.tlv.string(0x01), "in-ID")
        XCTAssertEqual(try request.tlv.byte(0x02), 0, "metric")
        XCTAssertFalse(request.tlv.contains(0x03), "ExpandCapability 57 is not offered")
        XCTAssertTrue(request.encrypted)
        XCTAssertTrue(rig.log.contains("LanguageSetting: in-ID, metric (phone language)"))
    }

    func testInitSendsThePinnedAppLanguageOverThePhones() async throws {
        var config = PacketsAuthFakeWatch.Config()
        config.commands[0x0C] = [0x01]
        let rig = makeRig(config)
        _ = try await rig.authenticator.authenticate()
        let initializer = HuaweiInitializer(
            session: rig.session, caps: DeviceCaps(), log: rig.log.sink, bondedName: nil, protocolVersion: 2,
            pinnedLanguage: "en", phoneLanguage: "id-ID"
        )
        initializer.timeouts = fastTimeouts()
        initializer.now = { self.now }
        _ = try await initializer.run()
        XCTAssertEqual(try rig.watch.requests("0c/01").first?.tlv.string(0x01), "en-US")
        XCTAssertTrue(rig.log.contains("LanguageSetting: en-US, metric (app language en)"))
    }

    func testInitSendsNoLanguageToAWatchThatDoesNotListIt() async throws {
        let rig = makeRig()
        _ = try await rig.authenticator.authenticate()
        let initializer = HuaweiInitializer(session: rig.session, caps: DeviceCaps(), log: rig.log.sink, bondedName: nil, protocolVersion: 2, phoneLanguage: "id-ID")
        initializer.timeouts = fastTimeouts()
        initializer.now = { self.now }
        _ = try await initializer.run()
        XCTAssertTrue(rig.watch.requests("0c/01").isEmpty)
        XCTAssertTrue(rig.log.contains("LanguageSetting: the watch does not list 0C/01, not sent"))
    }

    func testInitWithoutDriftSendsTheTimeOnce() async throws {
        var config = PacketsAuthFakeWatch.Config()
        config.clockOffset = 0
        config.batteryMulti = [88, 90]
        let rig = makeRig(config)
        _ = try await rig.authenticator.authenticate()
        let initializer = HuaweiInitializer(session: rig.session, caps: DeviceCaps(), log: rig.log.sink, bondedName: nil, protocolVersion: 2)
        initializer.timeouts = fastTimeouts()
        initializer.now = { self.now }
        let result = try await initializer.run()
        XCTAssertEqual(rig.watch.requests("01/05").count, 1)
        XCTAssertEqual(result.batteryLevel, 88, "the first of the multi levels")
    }

    // MARK: profile

    func testProfileSenderSendsUserInfoAndGoalWhenTheWatchListsThem() async throws {
        let rig = makeRig()
        _ = try await rig.authenticator.authenticate()
        let caps = DeviceCaps()
        caps.supportedCommands = [0x07: [0x01, 0x02]]
        caps.expandCapabilities = Bytes(repeating: 0, count: 0x20)
        let profile = UserProfileData(heightCm: 175, weightKg: 70.5, birthYear: 1990, sex: "female", dailyStepGoal: 9500)
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let sent = try await ProfileSender.sendProfile(session: rig.session, caps: caps, log: rig.log.sink, profile: profile, now: now, calendar: calendar)
        XCTAssertEqual(sent, 2)
        let info = try XCTUnwrap(rig.watch.userInfo)
        XCTAssertEqual(try info.byte(0x01), Int8(truncatingIfNeeded: 175))
        XCTAssertEqual(try info.byte(0x02), 70)
        XCTAssertEqual(try info.byte(0x03), Int8(2026 - 1990))
        XCTAssertEqual(try info.int(0x04), (1990 << 16) + 257)
        XCTAssertEqual(try info.byte(0x05), 2)
        XCTAssertEqual(try info.byte(0x06), Int8(truncatingIfNeeded: javaRound(0.42 * 175))) // 74
        XCTAssertEqual(try info.byte(0x07), Int8(truncatingIfNeeded: javaRound(0.83 * 175))) // 145 as a signed byte
        XCTAssertFalse(info.contains(0x0b), "precision weight needs expand capability 0xb3")
        XCTAssertEqual(try XCTUnwrap(rig.watch.motionGoal).object(0x81).object(0x82).int(0x05), 9500)

        // A watch that lists neither command is sent neither.
        let none = DeviceCaps()
        let count = try await ProfileSender.sendProfile(session: rig.session, caps: none, log: rig.log.sink, profile: profile, now: now, calendar: calendar)
        XCTAssertEqual(count, 0)
        XCTAssertEqual(ProfileSender.age(birthYear: 2040, now: now, calendar: calendar), 0)
        XCTAssertEqual(ProfileSender.encodeBirthday(birthYear: 1990), (1990 << 16) + 257)
    }

    private func javaRound(_ f: Float) -> Int { Int(PacketsJava.round(f)) }

    // MARK: transport edges

    func testTheFakeWatchesNotificationsMayArriveInTinyPieces() async throws {
        var config = PacketsAuthFakeWatch.Config()
        config.notifySize = 20
        let rig = makeRig(config)
        let mode = try await rig.authenticator.authenticate()
        XCTAssertEqual(mode, .hichain3)
        XCTAssertEqual(rig.session.params.secretKey, rig.watch.params.secretKey)
    }

    func testDefaultTimeoutsAreTheKotlinOnesExceptTheHumanFirstBind() {
        let t = LinkTimeouts()
        // Kotlin: 10 s, 30 s first bind, 5 s and 10 s for the op 2 steps, 2 s init, 5 s query, 10 s and 15 s sync, 300 ms SetUpDeviceStatus.
        // iOS waits 120 s for the first bind (the user confirms on the watch); the reconnect values are Kotlin's.
        XCTAssertEqual([t.authMs, t.firstAuthMs, t.hichainFirstStepMs, t.hichainStepMs, t.initMs, t.queryMs, t.syncCountMs, t.syncDataMs, t.setupStatusMs],
                       [10_000, 120_000, 5_000, 10_000, 2_000, 5_000, 10_000, 15_000, 300])
        // LinkParams is asked up to three times: 10 s, then 8 s twice, with 1 s and 2 s of quiet between.
        XCTAssertEqual([t.linkParamsAttempts, t.linkParamsRetryMs, t.linkParamsBackoffMs], [3, 8_000, 1_000])
    }
}

/// The attempt numbers the authenticator asked the link to recover for, in order.
private final class RecoveryCalls: @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [Int] = []

    func add(_ attempt: Int) {
        lock.lock()
        recorded.append(attempt)
        lock.unlock()
    }

    var attempts: [Int] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }
}
