import XCTest
@testable import HuaweiWearLogic

/// Collects what LiveWorkout publishes and what the heart-rate sensor was asked.
private final class LiveEvents: WearEvents, @unchecked Sendable {
    private let lock = NSLock()
    private var _payloads: [[String: Any]] = []
    private var _logs: [LogEntry] = []
    var payloads: [[String: Any]] { lock.locked { _payloads } }
    var last: [String: Any]? { payloads.last }
    func state(_ state: LinkState, error: String?) {}
    func battery(_ level: Int) {}
    func syncComplete(_ summary: SyncSummary) {}
    func log(_ entry: LogEntry) { lock.locked { _logs.append(entry) } }
    func liveWorkout(_ payload: [String: Any]) { lock.locked { _payloads.append(payload) } }
    func contains(_ fragment: String) -> Bool { lock.locked { _logs.contains { $0.message.contains(fragment) } } }
}

private final class Counter: @unchecked Sendable {
    private let lock = NSLock()
    private var _toggles: [Bool] = []
    private var _now: Int64 = 1_760_000_000_000
    var toggles: [Bool] { lock.locked { _toggles } }
    func toggle(_ on: Bool) { lock.locked { _toggles.append(on) } }
    var now: Int64 { lock.locked { _now } }
    func advance(_ ms: Int64) { lock.locked { _now += ms } }
}

private final class FakeGps: LiveGpsSource, @unchecked Sendable {
    private let lock = NSLock()
    private var handler: (@Sendable (WorkoutLinkWire.Fix) -> Void)?
    private var _started = 0
    private var _stopped = 0
    var auth: LocationAuthorization = .granted
    var asked = 0
    var authorization: LocationAuthorization { auth }
    func requestAuthorization() async -> LocationAuthorization {
        asked += 1
        if auth == .notDetermined { auth = .granted }
        return auth
    }
    func start(_ onFix: @escaping @Sendable (WorkoutLinkWire.Fix) -> Void) -> Bool {
        lock.locked {
            handler = onFix
            _started += 1
        }
        return true
    }
    func stop() { lock.locked { handler = nil; _stopped += 1 } }
    var started: Int { lock.locked { _started } }
    var stopped: Int { lock.locked { _stopped } }
    func emit(_ fix: WorkoutLinkWire.Fix) {
        let h = lock.locked { handler }
        h?(fix)
    }
}

/// An unsliced, unencrypted watch frame of any service.
private func frame(_ service: UInt8, _ command: UInt8, _ tlv: HuaweiTLV) -> Bytes {
    var body = Bytes([huaweiMagic])
    let inner = Bytes([service, command]) + tlv.serialize()
    body.appendBE(UInt16(inner.count + 1))
    body.append(0)
    body += inner
    body.appendBE(CRC16.checksum(body))
    return body
}

/// A `17/03` answer; `trainMonitorState` nil leaves tag 02 out (a watch read by its operator alone).
private func statusAnswer(operatorType: Int, workoutType: Int, trainMonitorState: Int? = nil) -> Bytes {
    var body = HuaweiTLV()
    if let trainMonitorState { body.put(0x02, byte: UInt8(trainMonitorState)) }
    body.put(0x03, byte: UInt8(operatorType))
    body.put(0x06, byte: UInt8(workoutType))
    var t = HuaweiTLV()
    t.put(0x81, tlv: body)
    return frame(0x17, 0x03, t)
}

/// What the scripted watch answers next.
private final class Script: @unchecked Sendable {
    private let lock = NSLock()
    private var _answer: Bytes?
    var answer: Bytes? {
        get { lock.locked { _answer } }
        set { lock.locked { _answer = newValue } }
    }
}

final class LiveWorkoutTests: XCTestCase {
    private func hex(_ s: String) -> Bytes { Bytes(hex: s.replacingOccurrences(of: " ", with: ""))! }

    private struct Rig {
        let rig: DataSyncRig
        let events: LiveEvents
        let counter: Counter
        let live: LiveWorkout
        let settings: WearSettings
    }

    private func make(watchdogEveryMs: Int = 10_000, profile: UserProfileData? = nil, connected: Bool = true) -> Rig {
        let rig = DataSyncRig(bits: [83, 84], connected: connected)
        let events = LiveEvents()
        let counter = Counter()
        let settings = WearSettings(defaults: ephemeralDefaults())
        settings.profile = profile
        let live = LiveWorkout(
            dataSync: rig.service, events: events, settings: settings, setHeartRateActive: { counter.toggle($0) }, nowMs: { counter.now },
            watchdogEveryMs: watchdogEveryMs
        )
        rig.service.register(live)
        return Rig(rig: rig, events: events, counter: counter, live: live, settings: settings)
    }

    private func control(op: Int, type: Int, status: Int) -> Bytes {
        DataSyncRig.eventFrame(
            src: LiveWorkoutWire.watchPkg, wear: LiveWorkoutWire.phonePkg, id: LiveWorkoutWire.eventControl,
            data: Bytes([0x01, 0x01, UInt8(type), 0x02, 0x01, UInt8(op), 0x05, 0x01, UInt8(status)])
        )
    }

    private func point(_ values: [(Int, String)]) -> Bytes {
        var list = HuaweiTLV()
        for (key, value) in values {
            var e = HuaweiTLV()
            e.put(0x08, int: Int32(key))
            e.put(0x09, bytes: hex(value))
            list.put(0x87, tlv: e)
        }
        var t = HuaweiTLV()
        t.put(0x01, string: LiveWorkoutWire.watchPkg)
        t.put(0x02, string: LiveWorkoutWire.phonePkg)
        t.put(0x03, int: 1)
        t.put(0x86, tlv: list)
        return DataSyncRig.frame(0x03, t)
    }

    // MARK: the watch announces the workout (reverse linkage)

    func testAStartControlOpensASessionAndIsAnswered() async {
        let r = make()
        await r.rig.attach()
        r.rig.watch.responder = { _ in [] }
        r.rig.session.onData(control(op: LiveWorkoutWire.opStart, type: 2, status: 1))
        await eventually("session published") { r.events.last != nil }
        let s = r.events.last!
        XCTAssertEqual(s["status"] as? String, "running")
        XCTAssertEqual(s["source"] as? String, "watch")
        XCTAssertEqual(s["sportType"] as? Int, 2)
        XCTAssertEqual(s["sportName"] as? String, WorkoutSportTypes.name(2))
        XCTAssertEqual(r.live.snapshot()?["status"] as? String, "running")
        await eventually("reply sent") { !r.rig.watch.sent.isEmpty }
        let sent = r.rig.watch.sent[0]
        XCTAssertEqual(sent.service, 0x37)
        XCTAssertEqual(sent.command, 0x02)
        XCTAssertEqual(try? sent.tlv.string(0x01), LiveWorkoutWire.phonePkg)
        XCTAssertEqual(try? sent.tlv.string(0x02), LiveWorkoutWire.watchPkg)
        XCTAssertEqual(Int((try? sent.tlv.int(0x03)) ?? 0), LiveWorkoutWire.eventControl)
        XCTAssertEqual(try? sent.tlv.bytes(0x05), LiveWorkoutWire.reply(LiveWorkoutWire.opStart))
    }

    func testAPreparingWatchStatusShowsAsPreparing() async {
        let r = make()
        await r.rig.attach()
        r.rig.session.onData(control(op: LiveWorkoutWire.opStart, type: 1, status: 0))
        await eventually { r.events.last != nil }
        XCTAssertEqual(r.events.last?["status"] as? String, "preparing")
    }

    func testPointsFillTheNumbersAndTheFatAndCarbEstimate() async {
        let r = make()
        await r.rig.attach()
        r.rig.session.onData(control(op: LiveWorkoutWire.opStart, type: 1, status: 1))
        await eventually { r.events.last != nil }
        r.rig.session.onData(point([(LiveWorkoutWire.keyHeartRate, "78"), (LiveWorkoutWire.keyCalories, "00C350"), (LiveWorkoutWire.keyDistance, "05DC")])) // 120 bpm, 50 kcal, 150 m
        await eventually("hr") { r.events.last?["heartRate"] as? Int == 120 }
        r.rig.session.onData(point([(LiveWorkoutWire.keyCalories, "00EA60")])) // 60 kcal
        await eventually("kcal") { (r.events.last?["calories"] as? Double) == 60.0 }
        let s = r.events.last!
        XCTAssertEqual(s["distanceM"] as? Double, 150.0)
        XCTAssertEqual(s["maxHeartRate"] as? Int, 185)
        let share = SubstrateEstimator.fatShare(heartRate: 120, maxHeartRate: 185)
        XCTAssertEqual(s["fatShare"] as? Double ?? -1, share, accuracy: 1e-12)
        XCTAssertEqual(s["fatGrams"] as? Double ?? -1, 10.0 * share / 9.0, accuracy: 1e-9)
        XCTAssertEqual(s["carbGrams"] as? Double ?? -1, 10.0 * (1 - share) / 4.0, accuracy: 1e-9)
    }

    func testAStopControlEndsTheWorkoutReleasesTheSensorOnceAndIsAnswered() async {
        let r = make()
        await r.rig.attach()
        r.rig.session.onData(control(op: LiveWorkoutWire.opStart, type: 1, status: 1))
        await eventually { r.events.last != nil }
        r.rig.session.onData(control(op: LiveWorkoutWire.opStop, type: 1, status: 1))
        await eventually("ended") { r.events.last?["status"] as? String == "ended" }
        XCTAssertNotNil(r.events.last?["endedAt"] as? Double)
        await eventually("stop reply") { r.rig.watch.sent.count == 2 }
        XCTAssertEqual(try? r.rig.watch.sent[1].tlv.bytes(0x05), LiveWorkoutWire.reply(LiveWorkoutWire.opStop))
        // A late point does not reopen the ended workout's sensor again.
        r.rig.session.onData(point([(LiveWorkoutWire.keyHeartRate, "50")]))
        await sleepMs(100)
        XCTAssertEqual(r.counter.toggles.filter { !$0 }.count, 1)
    }

    func testPauseAndResumeEventsFollowTheWatch() async {
        let r = make()
        await r.rig.attach()
        func event(_ id: Int) -> Bytes {
            DataSyncRig.eventFrame(src: LiveWorkoutWire.watchPkg, wear: LiveWorkoutWire.phonePkg, id: id, data: [0x02, 0x01, 0x03])
        }
        r.rig.session.onData(event(LiveWorkoutWire.eventStart))
        await eventually { r.events.last?["status"] as? String == "running" }
        XCTAssertEqual(r.events.last?["sportType"] as? Int, 3)
        r.rig.session.onData(event(LiveWorkoutWire.eventPause))
        await eventually { r.events.last?["status"] as? String == "paused" }
        r.rig.session.onData(event(LiveWorkoutWire.eventResume))
        await eventually { r.events.last?["status"] as? String == "running" }
        r.rig.session.onData(event(LiveWorkoutWire.eventStop))
        await eventually { r.events.last?["status"] as? String == "ended" }
        // A stop that arrives again changes nothing; a new start opens a fresh session.
        let count = r.events.payloads.count
        r.rig.session.onData(event(LiveWorkoutWire.eventStop))
        await sleepMs(80)
        XCTAssertEqual(r.events.payloads.count, count)
        r.counter.advance(5_000)
        r.rig.session.onData(event(LiveWorkoutWire.eventStart))
        await eventually("fresh") { r.events.last?["status"] as? String == "running" }
        XCTAssertNotEqual(r.events.last?["id"] as? Double, r.events.payloads.first?["id"] as? Double)
    }

    func testAPointStreamStateOfStoppedEndsTheWorkout() async {
        let r = make()
        await r.rig.attach()
        r.rig.session.onData(point([(LiveWorkoutWire.keyState, "02")]))
        await eventually { r.events.last?["status"] as? String == "paused" }
        r.rig.session.onData(point([(LiveWorkoutWire.keyState, "03")]))
        await eventually { r.events.last?["status"] as? String == "ended" }
    }

    func testAResumeControlLinksAgainWithTheWatchsState() async {
        let r = make()
        await r.rig.attach()
        r.rig.session.onData(control(op: LiveWorkoutWire.opResume, type: 2, status: LiveWorkoutWire.watchPaused))
        await eventually { r.events.last?["status"] as? String == "paused" }
        await eventually("resume reply") { !r.rig.watch.sent.isEmpty }
        XCTAssertEqual(try? r.rig.watch.sent[0].tlv.bytes(0x05), LiveWorkoutWire.reply(LiveWorkoutWire.opResume))
    }

    func testAReportControlOnlyLogs() async {
        let r = make()
        await r.rig.attach()
        r.rig.session.onData(control(op: LiveWorkoutWire.opReport, type: 1, status: 1))
        await eventually("logged") { r.events.contains("watch reports linkage status 1") }
        XCTAssertNil(r.live.snapshot())
        XCTAssertTrue(r.rig.watch.sent.isEmpty)
    }

    // MARK: JoyoFit's own session on the heart rate

    func testManualStartRunsOnHeartRateAndFinishes() {
        // 40 years old on the test clock (October 2025).
        let profile = UserProfileData(heightCm: 175, weightKg: 80, birthYear: 1985, sex: "male", dailyStepGoal: 8000)
        let r = make(profile: profile)
        r.live.startManual()
        XCTAssertEqual(r.counter.toggles, [true])
        XCTAssertEqual(r.events.last?["source"] as? String, "manual")
        XCTAssertEqual(r.events.last?["maxHeartRate"] as? Int, 180)
        // A second Start while one runs does nothing.
        r.live.startManual()
        XCTAssertEqual(r.counter.toggles, [true])

        r.live.onHeartRate(130)
        XCTAssertEqual(r.events.last?["heartRate"] as? Int, 130)
        XCTAssertEqual(r.events.last?["calories"] as? Double, 0.0) // the first reading has no interval yet
        r.counter.advance(6_000)
        r.live.onHeartRate(130)
        let kcal = HeartRateEnergy.kcalPerMinute(heartRate: 130, weightKg: 80, age: 40, sex: "male") * 6_000 / 60_000.0
        XCTAssertEqual(r.events.last?["calories"] as? Double ?? -1, kcal, accuracy: 1e-9)
        XCTAssertEqual(r.events.last?["durationSec"] as? Int, 6)
        // A gap longer than 10 s counts as 10 s.
        r.counter.advance(60_000)
        r.live.onHeartRate(130)
        let capped = kcal + HeartRateEnergy.kcalPerMinute(heartRate: 130, weightKg: 80, age: 40, sex: "male") * 10_000 / 60_000.0
        XCTAssertEqual(r.events.last?["calories"] as? Double ?? -1, capped, accuracy: 1e-9)
        XCTAssertGreaterThan(r.events.last?["fatGrams"] as? Double ?? 0, 0)

        r.live.finish()
        XCTAssertEqual(r.events.last?["status"] as? String, "ended")
        XCTAssertEqual(r.counter.toggles, [true, false])
        // Readings after the end change nothing.
        let n = r.events.payloads.count
        r.live.onHeartRate(150)
        XCTAssertEqual(r.events.payloads.count, n)
        r.live.finish()
        XCTAssertEqual(r.events.payloads.count, n)

        // Dismissing closes the ended workout; Start works again.
        r.live.dismiss()
        XCTAssertNil(r.live.snapshot())
        r.live.startManual()
        XCTAssertEqual(r.live.snapshot()?["status"] as? String, "running")
    }

    func testDismissKeepsARunningWorkout() {
        let r = make()
        r.live.startManual()
        r.live.dismiss()
        XCTAssertEqual(r.live.snapshot()?["status"] as? String, "running")
    }

    func testHeartRateDoesNotDriveAWatchFedSession() async {
        let r = make()
        await r.rig.attach()
        r.rig.session.onData(control(op: LiveWorkoutWire.opStart, type: 1, status: 1))
        await eventually { r.events.last != nil }
        let n = r.events.payloads.count
        r.live.onHeartRate(150)
        XCTAssertEqual(r.events.payloads.count, n)
    }

    func testDefaultsWithoutAProfile() {
        let r = make()
        r.live.startManual()
        XCTAssertEqual(r.events.last?["maxHeartRate"] as? Int, 185)
        r.live.onHeartRate(100)
        r.counter.advance(6_000)
        r.live.onHeartRate(100)
        let kcal = HeartRateEnergy.kcalPerMinute(heartRate: 100, weightKg: 70, age: 35, sex: "unknown") * 0.1
        XCTAssertEqual(r.events.last?["calories"] as? Double ?? -1, kcal, accuracy: 1e-9)
    }

    // MARK: the 17/03 status poll and the GPS requests

    func testTheStatusPollStartsFollowsAndEndsAPhoneSideSession() {
        let r = make()
        r.live.watchStatus(phase: .running, workoutType: 7)
        XCTAssertEqual(r.events.last?["source"] as? String, "status")
        XCTAssertEqual(r.events.last?["sportType"] as? Int, 7)
        XCTAssertEqual(r.events.last?["clockConfirmed"] as? Bool, true)
        XCTAssertEqual(r.counter.toggles, [true])
        r.live.onHeartRate(120)
        r.live.watchStatus(phase: .paused, workoutType: 7)
        XCTAssertEqual(r.events.last?["status"] as? String, "paused")
        r.live.onHeartRate(120) // paused: not counted
        XCTAssertEqual(r.events.last?["status"] as? String, "paused")
        r.live.watchStatus(phase: .running, workoutType: nil)
        XCTAssertEqual(r.events.last?["status"] as? String, "running")
        // The watch confirmed the workout: three idle answers in a row end it, the first two do not.
        r.live.watchStatus(phase: .idle, workoutType: nil)
        r.live.watchStatus(phase: .idle, workoutType: nil)
        XCTAssertEqual(r.events.last?["status"] as? String, "running")
        r.live.watchStatus(phase: .idle, workoutType: nil)
        XCTAssertEqual(r.events.last?["status"] as? String, "ended")
        XCTAssertEqual(r.counter.toggles, [true, false])
        XCTAssertTrue(r.events.contains("no workout 3 times in a row"))
    }

    func testARunningAnswerResetsTheIdleCountAndGpsRequestsKeepAPreparingSessionAlive() {
        let r = make()
        r.live.watchStatus(phase: .running, workoutType: nil)
        r.live.watchStatus(phase: .idle, workoutType: nil)
        r.live.watchStatus(phase: .idle, workoutType: nil)
        r.live.watchStatus(phase: .running, workoutType: nil)
        r.live.watchStatus(phase: .idle, workoutType: nil)
        r.live.watchStatus(phase: .idle, workoutType: nil)
        XCTAssertEqual(r.events.last?["status"] as? String, "running")
        r.live.finish()
        // A session that waits for GO: idle answers are normal while the watch still asks for GPS.
        r.counter.advance(LiveWorkoutPolicy.restartGuardMs)
        r.live.gpsPing()
        for _ in 0..<5 { r.live.watchStatus(phase: .idle, workoutType: nil) }
        XCTAssertEqual(r.live.snapshot()?["status"] as? String, "preparing")
        // The watch stopped asking: the next idle answer drops it.
        r.counter.advance(LiveWorkoutPolicy.preparingSilenceMs + 1)
        r.live.watchStatus(phase: .idle, workoutType: nil)
        XCTAssertEqual(r.live.snapshot()?["status"] as? String, "ended")
    }

    func testAnIdleAnswerNeverEndsAWatchFedOrManualSession() async {
        let r = make()
        r.live.startManual()
        r.counter.advance(LiveWorkoutPolicy.gpsSilenceMs * 2)
        for _ in 0..<5 { r.live.watchStatus(phase: .idle, workoutType: nil) }
        XCTAssertEqual(r.live.snapshot()?["status"] as? String, "running")
    }

    func testGpsPingOpensASessionOnceAndTheWatchdogEndsItOnSilence() async {
        let r = make(watchdogEveryMs: 20)
        XCTAssertTrue(r.live.gpsPing())
        XCTAssertEqual(r.events.last?["source"] as? String, "gps")
        XCTAssertEqual(r.events.last?["status"] as? String, "preparing")
        XCTAssertEqual(r.counter.toggles, [true])
        let n = r.events.payloads.count
        XCTAssertTrue(r.live.gpsPing(), "still preparing: ask the status")
        XCTAssertEqual(r.events.payloads.count, n)
        XCTAssertEqual(r.counter.toggles, [true])
        // Silence for longer than the limit and no status answer ever: the watchdog ends the session.
        r.counter.advance(LiveWorkoutPolicy.gpsSilenceMs + LiveWorkoutPolicy.statusStaleMs)
        await eventually("watchdog end") { r.events.last?["status"] as? String == "ended" }
        XCTAssertTrue(r.events.contains("does not answer the status poll"))
        XCTAssertEqual(r.counter.toggles, [true, false])
    }

    func testTheWatchdogLeavesASessionAloneWhileTheStatusPollAnswers() async {
        let r = make(watchdogEveryMs: 20)
        r.live.gpsPing()
        r.counter.advance(LiveWorkoutPolicy.gpsSilenceMs + 1_000)
        r.live.watchStatus(phase: .running, workoutType: nil) // a fresh answer
        await sleepMs(150)
        XCTAssertEqual(r.live.snapshot()?["status"] as? String, "running")
        r.live.finish()
    }

    // MARK: the realtime report and the switch from phone-side to watch-fed

    func testAReportReplacesAPhoneSideSessionKeepingItsId() {
        let r = make()
        r.live.startManual()
        let id = r.events.last?["id"] as? Double
        r.live.onHeartRate(100)
        var t = HuaweiTLV()
        t.put(0x02, bytes: hex("0100"))
        t.put(0x03, bytes: hex("8C"))
        t.put(0x09, bytes: hex("00C350"))
        t.put(0x11, bytes: hex("01"))
        r.live.onReport(WorkoutReport.parse(t))
        let s = r.events.last!
        XCTAssertEqual(s["source"] as? String, "watch")
        XCTAssertEqual(s["id"] as? Double, id)
        XCTAssertEqual(s["heartRate"] as? Int, 140)
        XCTAssertEqual(s["durationSec"] as? Int, 256)
        XCTAssertEqual(s["calories"] as? Double, 50.0)
        XCTAssertTrue(r.events.contains("using them instead of the heart-rate estimate"))
        var stop = HuaweiTLV()
        stop.put(0x11, bytes: hex("04"))
        r.live.onReport(WorkoutReport.parse(stop))
        XCTAssertEqual(r.events.last?["status"] as? String, "ended")
        XCTAssertEqual(r.counter.toggles.last, false)
    }

    // MARK: JS shape

    func testTheSnapshotHasEveryFieldOfTheTypeScriptInterface() {
        let r = make()
        r.live.startManual()
        let keys = Set(r.live.snapshot()!.keys)
        let expected: Set<String> = [
            "id", "status", "source", "sportType", "sportName", "updatedAt", "endedAt", "durationSec", "heartRate", "heartRateZone", "maxHeartRate",
            "distanceM", "calories", "activeCalories", "speedKmh", "paceSecPerKm", "stepRate", "steps", "cadence", "altitudeM", "riseM", "descentM",
            "aerobicTe", "anaerobicTe", "fatGrams", "carbGrams", "fatShare", "endSuspected", "clockConfirmed", "gpsRequested", "location", "locationAt",
            "gpsDistanceM", "gpsRiseM", "gpsPaceSecPerKm",
        ]
        XCTAssertEqual(keys, expected)
        XCTAssertTrue(r.live.snapshot()!["heartRate"] is NSNull)
        XCTAssertEqual(r.live.snapshot()!["clockConfirmed"] as? Bool, true)
        XCTAssertEqual(r.live.snapshot()!["gpsRequested"] as? Bool, false)
        XCTAssertEqual(r.live.snapshot()!["endSuspected"] as? Bool, false)
    }

    // MARK: WorkoutLink: GPS, status poll and report against a scripted watch

    private struct LinkRig {
        let r: Rig
        let gps: FakeGps
        let link: WorkoutLink
    }

    private func makeLink(
        statusFirstMs: Int = 20, pollDelayMs: @escaping @Sendable (Int64) -> Int64 = { $0 / 100 }, gpsBitmap: Int = 0xD7, watchdogEveryMs: Int = 10_000,
        poll: @escaping @Sendable () -> Bytes? = { nil }
    ) -> LinkRig {
        let r = make(watchdogEveryMs: watchdogEveryMs)
        let gps = FakeGps()
        let link = WorkoutLink(
            link: r.rig.source, events: r.events, live: r.live, gps: gps, statusFirstMs: statusFirstMs, pollDelayMs: pollDelayMs, nowMs: { r.counter.now }
        )
        r.rig.watch.responder = { sent in
            switch (sent.service, sent.command) {
            case (0x18, 0x01):
                var inner = HuaweiTLV()
                inner.put(0x02, byte: UInt8(gpsBitmap))
                var t = HuaweiTLV()
                t.put(0x81, tlv: inner)
                return [frame(0x18, 0x01, t)]
            case (0x17, 0x12): return [frame(0x17, 0x12, HuaweiTLV())]
            case (0x17, 0x03): return poll().map { [$0] } ?? []
            default: return []
            }
        }
        return LinkRig(r: r, gps: gps, link: link)
    }

    private func gpsRequest(_ on: Bool) -> Bytes {
        var t = HuaweiTLV()
        t.put(0x01, byte: on ? 1 : 0)
        return frame(0x18, 0x02, t)
    }

    func testTheWatchAsksForGpsAndGetsFixesUntilItStops() async throws {
        let l = makeLink()
        let h = l.r.rig.source.current!
        await l.link.linkConnected(h)
        l.r.rig.session.onData(gpsRequest(true))

        await eventually("gps started") { l.gps.started == 1 }
        // The location updates start first; the fields the watch takes (18/01) come after, for the feed.
        await eventually("fields read") { l.r.events.contains("watch takes GPS fields bitmap 0xd7") }
        // The answer (18/02 {7F: 100000}), the parameter read (18/01) and the report open (17/12) went out; a session follows the workout.
        let sent = l.r.rig.watch.sent
        let answer = try XCTUnwrap(sent.first { $0.service == 0x18 && $0.command == 0x02 })
        XCTAssertEqual(WorkoutLinkWire.gpsAnswer().tlv?.serialize(), answer.tlv.serialize())
        XCTAssertTrue(sent.contains { $0.service == 0x18 && $0.command == 0x01 })
        XCTAssertTrue(sent.contains { $0.service == 0x17 && $0.command == 0x12 })
        XCTAssertEqual(l.r.live.snapshot()?["source"] as? String, "gps")
        XCTAssertEqual(l.r.counter.toggles, [true])
        XCTAssertTrue(l.r.events.contains("watch takes GPS fields bitmap 0xd7"))

        // Fixes: the first has no distance, the second the metres since the first.
        let t0 = l.r.counter.now
        let first = WorkoutLinkWire.Fix(latitude: -6.9147, longitude: 107.6098, timeMs: t0, speed: 2.9, altitude: 712.6, bearing: 271.5, accuracy: 4.5)
        let second = WorkoutLinkWire.Fix(latitude: -6.9146, longitude: 107.6099, timeMs: t0 + 1000, speed: 3.1, altitude: 713.0, bearing: 90, accuracy: 5)
        l.gps.emit(first)
        await eventually("first fix") { l.r.rig.watch.sent.filter { $0.service == 0x18 && $0.command == 0x03 }.count == 1 }
        l.gps.emit(second)
        await eventually("second fix") { l.r.rig.watch.sent.filter { $0.service == 0x18 && $0.command == 0x03 }.count == 2 }
        let fixes = l.r.rig.watch.sent.filter { $0.service == 0x18 && $0.command == 0x03 }
        let params = WorkoutLinkWire.GpsParams(bitmap: 0xD7)
        let nowMs = l.r.counter.now
        XCTAssertEqual(
            fixes[0].tlv.serialize(), WorkoutLinkWire.gpsFix(params, fix: first, previous: nil, distanceFromPrevious: nil, nowMs: nowMs).tlv?.serialize()
        )
        XCTAssertEqual(
            fixes[1].tlv.serialize(),
            WorkoutLinkWire.gpsFix(params, fix: second, previous: first, distanceFromPrevious: second.distance(to: first), nowMs: nowMs).tlv?.serialize()
        )

        // A second request while streaming does not start a second stream. "Off" stops only the feed: no further fixes reach the watch, but the
        // phone keeps tracking the workout until it ends.
        l.r.rig.session.onData(gpsRequest(true))
        await sleepMs(100)
        XCTAssertEqual(l.gps.started, 1)
        l.r.rig.session.onData(gpsRequest(false))
        await eventually("feed stopped") { l.r.events.contains("feed stopped") }
        l.gps.emit(first)
        await sleepMs(80)
        XCTAssertEqual(l.r.rig.watch.sent.filter { $0.service == 0x18 && $0.command == 0x03 }.count, 2)
        XCTAssertEqual(l.gps.stopped, 0)
        l.r.live.finish()
        XCTAssertEqual(l.gps.stopped, 1)
        XCTAssertTrue(l.r.events.contains("phone GPS stopped"))
    }

    func testGpsWithoutLocationPermissionIsAnsweredAndLogged() async {
        let l = makeLink()
        l.gps.auth = .denied
        await l.link.linkConnected(l.r.rig.source.current!)
        l.r.rig.session.onData(gpsRequest(true))
        await eventually("logged") { l.r.events.contains("no location permission") }
        XCTAssertEqual(l.gps.started, 0)
        XCTAssertTrue(l.r.rig.watch.sent.contains { $0.service == 0x18 && $0.command == 0x02 })
        // The live session still follows the workout on the heart rate.
        XCTAssertEqual(l.r.live.snapshot()?["source"] as? String, "gps")
    }

    func testTheFirstGpsRequestShowsTheSystemPromptOnce() async {
        let l = makeLink()
        l.gps.auth = .notDetermined
        await l.link.linkConnected(l.r.rig.source.current!)
        l.r.rig.session.onData(gpsRequest(true))
        await eventually("started after the answer") { l.gps.started == 1 }
        XCTAssertEqual(l.gps.asked, 1)
        // The user said no earlier in this process: the watch's next request does not ask again.
        l.gps.auth = .notDetermined
        l.r.rig.session.onData(gpsRequest(false))
        l.r.live.finish()
        await eventually { l.gps.stopped == 1 }
        l.r.rig.session.onData(gpsRequest(true))
        await sleepMs(150)
        XCTAssertEqual(l.gps.asked, 1)
    }

    func testFieldsTheWatchDoesNotTakeAreLeftOut() async throws {
        let l = makeLink(gpsBitmap: 0x10)
        await l.link.linkConnected(l.r.rig.source.current!)
        l.r.rig.session.onData(gpsRequest(true))
        await eventually { l.gps.started == 1 }
        await eventually { l.r.events.contains("watch takes GPS fields bitmap 0x10") }
        l.gps.emit(WorkoutLinkWire.Fix(latitude: 1, longitude: 2, timeMs: l.r.counter.now, speed: 3, altitude: 4, bearing: 5, accuracy: 6))
        await eventually { l.r.rig.watch.sent.contains { $0.service == 0x18 && $0.command == 0x03 } }
        let fix = try XCTUnwrap(l.r.rig.watch.sent.first { $0.service == 0x18 && $0.command == 0x03 })
        let point = try fix.tlv.object(0x81).object(0x82)
        XCTAssertTrue(point.contains(0x09) && point.contains(0x0A) && point.contains(0x07) && point.contains(0x08))
        XCTAssertFalse(point.contains(0x03) || point.contains(0x04) || point.contains(0x05) || point.contains(0x0D) || point.contains(0x0E))
    }

    func testTheStatusPollStartsASessionForAnIndoorWorkoutAndEndsIt() async {
        let idle = Counter()
        let l = makeLink(poll: { statusAnswer(operatorType: idle.toggles.isEmpty ? 1 : 4, workoutType: 13) })
        await l.link.linkConnected(l.r.rig.source.current!)
        await eventually("session from the poll") { l.r.live.snapshot()?["source"] as? String == "status" }
        XCTAssertEqual(l.r.live.snapshot()?["sportType"] as? Int, 13)
        XCTAssertEqual(l.r.counter.toggles, [true])
        // The watch reports the workout over: three idle answers in a row end it.
        idle.toggle(true)
        await eventually("ended by the poll") { l.r.live.snapshot()?["status"] as? String == "ended" }
        XCTAssertTrue(l.r.rig.watch.sent.contains { $0.service == 0x17 && $0.command == 0x03 })
        l.link.linkDisconnected()
    }

    func testAWatchThatDoesNotAnswerTheStatusPollStopsTheProbe() async {
        let l = makeLink(poll: { nil })
        // The request times out after 5 s in production; here the session closing is what ends it, so only check that the probe is logged
        // and nothing else starts.
        await l.link.linkConnected(l.r.rig.source.current!)
        await eventually("probing logged") { l.r.events.contains("does not list 17/03; probing it") }
        XCTAssertNil(l.r.live.snapshot())
        l.link.linkDisconnected()
    }

    func testRealtimeReportsFeedTheWatchSession() async {
        let l = makeLink()
        await l.link.linkConnected(l.r.rig.source.current!)
        var body = HuaweiTLV()
        body.put(0x02, bytes: hex("003C"))
        body.put(0x03, bytes: hex("96"))
        body.put(0x08, bytes: hex("03E8"))
        body.put(0x11, bytes: hex("01"))
        var t = HuaweiTLV()
        t.put(0x81, tlv: body)
        l.r.rig.session.onData(frame(0x17, 0x11, t))
        await eventually("report") { l.r.live.snapshot()?["heartRate"] as? Int == 150 }
        let s = l.r.live.snapshot()!
        XCTAssertEqual(s["source"] as? String, "watch")
        XCTAssertEqual(s["durationSec"] as? Int, 60)
        XCTAssertEqual(s["distanceM"] as? Double, 1000)
        XCTAssertEqual(s["status"] as? String, "running")
        // A flat report (no 81 wrapper) is read too.
        var flat = HuaweiTLV()
        flat.put(0x03, bytes: hex("A0"))
        l.r.rig.session.onData(frame(0x17, 0x11, flat))
        await eventually("flat report") { l.r.live.snapshot()?["heartRate"] as? Int == 160 }
    }

    func testALinkLossKeepsTheTrackOfAGpsSessionUntilItsWatchdogEndsIt() async {
        let l = makeLink(watchdogEveryMs: 20)
        await l.link.linkConnected(l.r.rig.source.current!)
        l.r.rig.session.onData(gpsRequest(true))
        await eventually { l.gps.started == 1 }
        XCTAssertTrue(l.r.live.endsWithoutLink)
        // The workout goes on without the link: its track runs until the session ends, which the watchdog does once the watch stays quiet.
        l.link.linkDisconnected()
        XCTAssertEqual(l.gps.stopped, 0)
        l.r.counter.advance(LiveWorkoutPolicy.gpsSilenceMs + LiveWorkoutPolicy.statusStaleMs)
        await eventually("watchdog end") { l.r.live.snapshot()?["status"] as? String == "ended" }
        await eventually("gps stopped") { l.gps.stopped == 1 }
    }

    func testALinkLossStopsTheGpsOfASessionThatCannotEndWithoutTheWatchAndTheNextSessionSubscribesAgain() async {
        let l = makeLink()
        await l.link.linkConnected(l.r.rig.source.current!)
        l.r.rig.session.onData(gpsRequest(true))
        await eventually { l.gps.started == 1 }
        // The watch's own numbers take the session over: it now ends only on the watch's stop (or Finish), which a lost link never brings.
        var report = HuaweiTLV()
        report.put(0x02, bytes: hex("003C"))
        report.put(0x11, bytes: hex("01"))
        l.r.rig.session.onData(frame(0x17, 0x11, report))
        await eventually("watch-fed") { l.r.live.snapshot()?["source"] as? String == "watch" }
        XCTAssertFalse(l.r.live.endsWithoutLink)
        l.link.linkDisconnected()
        XCTAssertEqual(l.gps.stopped, 1)
        XCTAssertEqual(l.r.live.snapshot()?["status"] as? String, "running")
        // The same session announced again is not subscribed twice; the watch's next request starts the GPS again, answered once.
        await l.link.linkConnected(l.r.rig.source.current!)
        await l.link.linkConnected(l.r.rig.source.current!)
        l.r.rig.session.onData(gpsRequest(true))
        await eventually { l.gps.started == 2 }
        let answers = l.r.rig.watch.sent.filter { $0.service == 0x18 && $0.command == 0x02 }.count
        XCTAssertEqual(answers, 2)
        l.r.live.finish()
        XCTAssertEqual(l.gps.stopped, 2)
        l.link.linkDisconnected()
    }

    // MARK: the phone's own track (LiveGpsTrack.kt, docs/live-run.md "Phone GPS for the whole session")

    private func walk(_ t0: Int64, _ sec: Int, _ northM: Double) -> WorkoutLinkWire.Fix {
        WorkoutLinkWire.Fix(latitude: 10 + northM / 111_194.93, longitude: 20, timeMs: t0 + Int64(sec) * 1000, speed: 4, altitude: 100, accuracy: 5)
    }

    private func distance(_ r: Rig) -> Double { r.live.snapshot()?["gpsDistanceM"] as? Double ?? -1 }

    func testTheWatchWithdrawingItsGpsRequestMidRunKeepsTheTrackGoing() async {
        let l = makeLink()
        await l.link.linkConnected(l.r.rig.source.current!)
        l.r.rig.session.onData(gpsRequest(true))
        await eventually { l.gps.started == 1 }
        await eventually("fields read") { l.r.events.contains("watch takes GPS fields bitmap") }
        let fed = { l.r.rig.watch.sent.filter { $0.service == 0x18 && $0.command == 0x03 }.count }
        // The watch's status says the workout runs (after GO): the phone's track counts from here.
        l.r.live.watchStatus(phase: .running, workoutType: nil)
        XCTAssertEqual(l.r.live.snapshot()?["status"] as? String, "running")
        let t0 = l.r.counter.now
        for s in 0...20 { l.gps.emit(walk(t0, s, Double(s) * 4)) }
        await eventually("fixes fed") { fed() == 21 }
        XCTAssertEqual(distance(l.r), 80, accuracy: 0.5)
        // The watch has its own fix and withdraws its request (Fit 4 Pro, 80 s into a walk, 2026-10-25).
        l.r.rig.session.onData(gpsRequest(false))
        await eventually("feed stopped") { l.r.events.contains("feed stopped") }
        for s in 21...40 { l.gps.emit(walk(t0, s, Double(s) * 4)) }
        XCTAssertEqual(distance(l.r), 160, accuracy: 0.5)
        XCTAssertEqual(Double(l.r.live.snapshot()?["gpsPaceSecPerKm"] as? Int ?? 0), 250, accuracy: 1)
        XCTAssertEqual(l.r.live.snapshot()?["locationAt"] as? Double, Double(t0 + 40_000))
        await sleepMs(80)
        XCTAssertEqual(fed(), 21)
        XCTAssertEqual(l.gps.stopped, 0)
        // Asking again restarts the feed on the same location updates (the fix repeats until the request is handled; repeats add no distance).
        l.r.rig.session.onData(gpsRequest(true))
        await eventually("fed again") {
            l.gps.emit(walk(t0, 41, 164))
            return fed() > 21
        }
        XCTAssertEqual(l.gps.started, 1)
        XCTAssertEqual(distance(l.r), 164, accuracy: 0.5)
        // The end of the workout stops the phone's GPS.
        l.r.live.finish()
        XCTAssertEqual(l.gps.stopped, 1)
        l.link.linkDisconnected()
    }

    func testFixesWhileTheWatchPreparesShowOnTheMapButAddNoDistance() async {
        let r = make()
        await r.rig.attach()
        r.rig.session.onData(control(op: LiveWorkoutWire.opStart, type: 1, status: 0))
        await eventually { r.events.last?["status"] as? String == "preparing" }
        // 30 s of walking to the start line while the watch searches for GPS.
        let t0 = r.counter.now
        for s in 0...30 { r.live.onLocation(walk(t0, s, Double(s) * 4)) }
        let preparing = r.live.snapshot()!
        XCTAssertEqual(preparing["gpsDistanceM"] as? Double, 0)
        XCTAssertEqual(preparing["locationAt"] as? Double, Double(t0 + 30_000))
        XCTAssertEqual((preparing["location"] as? [String: Any])?["lat"] as? Double, walk(t0, 30, 120).latitude)
        // The watch starts the workout: the stretch begins at the newest fix, the walk before it is not in it.
        r.counter.advance(30_400)
        var running = HuaweiTLV()
        running.put(0x11, bytes: hex("01"))
        r.live.onReport(WorkoutReport.parse(running))
        XCTAssertEqual(r.live.snapshot()?["status"] as? String, "running")
        for s in 31...40 { r.live.onLocation(walk(t0, s, Double(s) * 4)) }
        XCTAssertEqual(distance(r), 40, accuracy: 0.5)
        // A pause adds nothing either.
        var paused = HuaweiTLV()
        paused.put(0x11, bytes: hex("02"))
        r.live.onReport(WorkoutReport.parse(paused))
        for s in 41...60 { r.live.onLocation(walk(t0, s, Double(s) * 4)) }
        XCTAssertEqual(distance(r), 40, accuracy: 0.5)
    }

    func testAnyEndOfTheWorkoutStopsThePhonesGpsOnce() async {
        let l = makeLink()
        await l.link.linkConnected(l.r.rig.source.current!)
        l.r.rig.session.onData(gpsRequest(true))
        await eventually { l.gps.started == 1 }
        // The watch's own stop, not Finish on the phone.
        var stop = HuaweiTLV()
        stop.put(0x11, bytes: hex("04"))
        l.r.live.onReport(WorkoutReport.parse(stop))
        XCTAssertEqual(l.r.live.snapshot()?["status"] as? String, "ended")
        XCTAssertEqual(l.gps.stopped, 1)
        l.r.live.finish()
        l.r.live.onReport(WorkoutReport.parse(stop))
        XCTAssertEqual(l.gps.stopped, 1)
        // A new request (the next workout) starts it again.
        l.r.rig.session.onData(gpsRequest(true))
        await eventually { l.gps.started == 2 }
        l.link.linkDisconnected()
    }

    // MARK: the GO screen, GO and the watch's workout screen (WatchPhase, 18/08; Fit 4 Pro 2026-10-25)

    func testTheGoScreenKeepsAGpsSessionPreparingAndGoStartsTheClock() {
        let r = make()
        XCTAssertTrue(r.live.gpsPing())
        XCTAssertEqual(r.live.pollEveryMs(), LiveWorkoutPolicy.preparingPollMs)
        var s = r.live.snapshot()!
        XCTAssertEqual(s["status"] as? String, "preparing")
        XCTAssertTrue(s["durationSec"] is NSNull)
        XCTAssertEqual(s["clockConfirmed"] as? Bool, false)
        XCTAssertEqual(s["gpsRequested"] as? Bool, true)
        XCTAssertEqual(s["endSuspected"] as? Bool, false)
        // The heart rate shows while the watch waits for GO; no time, no energy.
        r.live.onHeartRate(110)
        r.counter.advance(5_000)
        r.live.onHeartRate(110)
        s = r.live.snapshot()!
        XCTAssertEqual(s["heartRate"] as? Int, 110)
        XCTAssertTrue(s["calories"] is NSNull)
        XCTAssertTrue(s["durationSec"] is NSNull)
        // The GO screen (`02 00 03 01`) is no start.
        r.live.watchStatus(phase: .open, workoutType: nil)
        r.counter.advance(2_000)
        r.live.watchStatus(phase: .open, workoutType: nil)
        s = r.live.snapshot()!
        XCTAssertEqual(s["status"] as? String, "preparing")
        XCTAssertTrue(s["durationSec"] is NSNull)
        XCTAssertEqual(s["clockConfirmed"] as? Bool, false)
        XCTAssertTrue(r.live.gpsPing(), "still waiting for GO: ask the status")
        // GO (`02 01 03 03`): the clock starts now.
        r.counter.advance(1_000)
        r.live.watchStatus(phase: .running, workoutType: nil)
        s = r.live.snapshot()!
        XCTAssertEqual(s["status"] as? String, "running")
        XCTAssertEqual(s["durationSec"] as? Int, 0)
        XCTAssertEqual(s["clockConfirmed"] as? Bool, true)
        XCTAssertTrue(r.events.contains("the watch started the workout (GO); timer running"))
        XCTAssertEqual(r.live.pollEveryMs(), LiveWorkoutPolicy.livePollMs)
        XCTAssertFalse(r.live.gpsPing())
        r.counter.advance(10_000)
        r.live.onHeartRate(110)
        XCTAssertEqual(r.live.snapshot()?["durationSec"] as? Int, 10)
        // Back on the open screen without counting: the phone's clock stops too.
        r.live.watchStatus(phase: .open, workoutType: nil)
        XCTAssertEqual(r.live.snapshot()?["status"] as? String, "paused")
        XCTAssertTrue(r.events.contains("timer paused"))
        r.counter.advance(30_000)
        r.live.watchStatus(phase: .running, workoutType: nil)
        r.counter.advance(5_000)
        r.live.onHeartRate(110)
        XCTAssertEqual(r.live.snapshot()?["durationSec"] as? Int, 15)
        // Pause and resume follow the watch.
        r.live.watchStatus(phase: .paused, workoutType: nil)
        XCTAssertEqual(r.live.snapshot()?["status"] as? String, "paused")
        r.counter.advance(20_000)
        r.live.watchStatus(phase: .running, workoutType: nil)
        XCTAssertEqual(r.live.snapshot()?["status"] as? String, "running")
        XCTAssertEqual(r.live.snapshot()?["durationSec"] as? Int, 15)
    }

    func testAClosedWorkoutScreenEndsOnTheNextIdleAnswer() {
        let r = make()
        r.live.gpsPing()
        r.live.watchStatus(phase: .running, workoutType: nil)
        XCTAssertTrue(r.live.workoutScreen(open: false), "a close asks the status now")
        r.counter.advance(5_000)
        r.live.watchStatus(phase: .idle, workoutType: nil)
        XCTAssertEqual(r.live.snapshot()?["status"] as? String, "ended")
        XCTAssertTrue(r.events.contains("no workout 1 times in a row"))
    }

    func testIdleAnswersWithoutTheScreenClosingNeedThree() {
        let r = make()
        r.live.gpsPing()
        r.live.watchStatus(phase: .running, workoutType: nil)
        XCTAssertFalse(r.live.workoutScreen(open: true))
        r.live.watchStatus(phase: .idle, workoutType: nil)
        r.live.watchStatus(phase: .idle, workoutType: nil)
        XCTAssertEqual(r.live.snapshot()?["status"] as? String, "running")
        r.live.watchStatus(phase: .idle, workoutType: nil)
        XCTAssertEqual(r.live.snapshot()?["status"] as? String, "ended")
    }

    func testAClosedScreenOnAWatchThatDoesNotAnswerTheStatusAsksTheUser() {
        let r = make()
        r.live.gpsPing()
        XCTAssertTrue(r.live.workoutScreen(open: false))
        XCTAssertEqual(r.events.last?["endSuspected"] as? Bool, true)
        XCTAssertEqual(r.events.last?["status"] as? String, "preparing")
        XCTAssertTrue(r.events.contains("closed its workout screen and does not answer the status poll"))
        // The watch asks for GPS again: it was not over.
        r.live.gpsPing()
        XCTAssertEqual(r.events.last?["endSuspected"] as? Bool, false)
        // Nothing followed: a screen event asks nothing.
        r.live.finish()
        XCTAssertFalse(r.live.workoutScreen(open: false))
    }

    func testLeavingTheGoScreenAndComingBackOpensANewSessionWhoseClockStartsAtGo() {
        let r = make()
        // The workout screen opens (GPS request, then 18/08 {01: 1}); the person leaves it without GO.
        XCTAssertTrue(r.live.gpsPing())
        XCTAssertFalse(r.live.workoutScreen(open: true), "the open of a live session asks nothing")
        let first = r.live.snapshot()?["id"] as? Double
        r.counter.advance(5_000)
        XCTAssertTrue(r.live.workoutScreen(open: false))
        r.live.watchStatus(phase: .idle, workoutType: nil)
        XCTAssertEqual(r.live.snapshot()?["status"] as? String, "ended")
        // Back 20 s later: the GPS request opens a new session at once (the ended one never ran), and the open finds it live.
        r.counter.advance(20_000)
        XCTAssertTrue(r.live.gpsPing())
        XCTAssertFalse(r.live.workoutScreen(open: true))
        XCTAssertEqual(r.live.snapshot()?["status"] as? String, "preparing")
        XCTAssertNotEqual(r.live.snapshot()?["id"] as? Double, first)
        XCTAssertTrue(r.live.snapshot()?["durationSec"] is NSNull)
        // GO screen, then GO: the clock starts at GO.
        r.live.watchStatus(phase: .open, workoutType: nil)
        XCTAssertEqual(r.live.snapshot()?["status"] as? String, "preparing")
        r.counter.advance(3_000)
        r.live.watchStatus(phase: .running, workoutType: nil)
        XCTAssertEqual(r.live.snapshot()?["status"] as? String, "running")
        XCTAssertEqual(r.live.snapshot()?["durationSec"] as? Int, 0)
        r.counter.advance(7_000)
        r.live.onHeartRate(100)
        XCTAssertEqual(r.live.snapshot()?["durationSec"] as? Int, 7)
    }

    func testAWorkoutThatRanAndEndedBlocksAStragglerUnlessTheScreenOpensAgain() {
        let r = make()
        r.live.gpsPing()
        r.live.watchStatus(phase: .running, workoutType: nil)
        XCTAssertTrue(r.live.workoutScreen(open: false))
        r.live.watchStatus(phase: .idle, workoutType: nil)
        XCTAssertEqual(r.live.snapshot()?["status"] as? String, "ended")
        let ended = r.live.snapshot()?["id"] as? Double
        // A late GPS request of the workout that ran: a straggler, nothing opens.
        r.counter.advance(10_000)
        XCTAssertFalse(r.live.gpsPing())
        XCTAssertEqual(r.live.snapshot()?["status"] as? String, "ended")
        XCTAssertEqual(r.live.snapshot()?["id"] as? Double, ended)
        // The watch opens its workout screen again (its GPS request came a few ms earlier and was taken for a straggler): a new session.
        r.counter.advance(1_000)
        XCTAssertTrue(r.live.workoutScreen(open: true), "the new session waits for GO: ask the status")
        XCTAssertEqual(r.live.snapshot()?["status"] as? String, "preparing")
        XCTAssertNotEqual(r.live.snapshot()?["id"] as? Double, ended)
        // Its next GPS requests follow that session.
        let reopened = r.live.snapshot()?["id"] as? Double
        XCTAssertTrue(r.live.gpsPing())
        XCTAssertEqual(r.live.snapshot()?["id"] as? Double, reopened)
        r.live.watchStatus(phase: .running, workoutType: nil)
        XCTAssertEqual(r.live.snapshot()?["durationSec"] as? Int, 0)
    }

    private func workoutScreen(_ open: Bool) -> Bytes {
        var t = HuaweiTLV()
        t.put(0x01, byte: open ? 1 : 0)
        return frame(0x18, 0x08, t)
    }

    func testTheLinkWaitsForGoAndEndsAtOnceWhenTheWatchClosesItsWorkoutScreen() async {
        let script = Script()
        script.answer = statusAnswer(operatorType: 0, workoutType: 13, trainMonitorState: 0)
        // A minute between answers: only the first one, the GPS requests and the screen close ask the status here.
        let l = makeLink(pollDelayMs: { _ in 60_000 }, poll: { script.answer })
        await l.link.linkConnected(l.r.rig.source.current!)
        await eventually("first answer") { l.r.events.contains("Workout link: workout status") }
        XCTAssertNil(l.r.live.snapshot())
        // The workout screen opens, GO not pressed: 18/08 {01: 1} and the GPS request; the status says `02 00 03 01`.
        script.answer = statusAnswer(operatorType: 1, workoutType: 13, trainMonitorState: 0)
        l.r.rig.session.onData(workoutScreen(true))
        l.r.rig.session.onData(gpsRequest(true))
        await eventually("the GO screen answered") { l.r.live.snapshot()?["sportType"] as? Int == 13 }
        XCTAssertEqual(l.r.live.snapshot()?["status"] as? String, "preparing")
        XCTAssertTrue(l.r.live.snapshot()?["durationSec"] is NSNull)
        XCTAssertTrue(l.r.events.contains("the watch's workout screen opened (18/08)"))
        // GO: the watch's next GPS request asks the status again while the session waits.
        script.answer = statusAnswer(operatorType: 3, workoutType: 13, trainMonitorState: 1)
        l.r.rig.session.onData(gpsRequest(true))
        await eventually("GO") { l.r.live.snapshot()?["status"] as? String == "running" }
        XCTAssertEqual(l.r.live.snapshot()?["durationSec"] as? Int, 0)
        XCTAssertEqual(l.r.live.snapshot()?["clockConfirmed"] as? Bool, true)
        // Finish on the watch: 18/08 {01: 0} asks the status now, and one idle answer ends the session.
        script.answer = statusAnswer(operatorType: 0, workoutType: 13, trainMonitorState: 0)
        l.r.rig.session.onData(workoutScreen(false))
        await eventually("ended") { l.r.live.snapshot()?["status"] as? String == "ended" }
        XCTAssertTrue(l.r.events.contains("the watch's workout screen closed (18/08)"))
        XCTAssertTrue(l.r.events.contains("no workout 1 times in a row"))
        await eventually("both answered") { l.r.rig.watch.sent.filter { $0.service == 0x18 && $0.command == 0x08 }.count == 2 }
        for answer in l.r.rig.watch.sent.filter({ $0.service == 0x18 && $0.command == 0x08 }) {
            XCTAssertEqual(answer.tlv.serialize(), WorkoutLinkWire.workoutScreenAnswer().tlv?.serialize())
        }
        l.link.linkDisconnected()
    }

    func testThePauseAndResumeOfTheFit4ProProbeFollowTheWatchAndDoNotEndTheSession() async {
        // 2026-10-25 17:43, Outdoor walk on a Fit 4 Pro: pre-start screen, GO (03 03), pause (03 04), resume (03 05), finish (02 00 03 00).
        let script = Script()
        script.answer = statusAnswer(operatorType: 1, workoutType: 13, trainMonitorState: 0)
        let l = makeLink(poll: { script.answer })
        await l.link.linkConnected(l.r.rig.source.current!)
        l.r.rig.session.onData(gpsRequest(true))
        await eventually("pre-start screen") { l.r.live.snapshot()?["sportType"] as? Int == 13 }
        XCTAssertEqual(l.r.live.snapshot()?["status"] as? String, "preparing")
        script.answer = statusAnswer(operatorType: 3, workoutType: 13, trainMonitorState: 1)
        await eventually("GO") { l.r.live.snapshot()?["status"] as? String == "running" }
        script.answer = statusAnswer(operatorType: 4, workoutType: 13, trainMonitorState: 1)
        await eventually("paused") { l.r.live.snapshot()?["status"] as? String == "paused" }
        // A pause is no "no workout": several answers later the session is still paused.
        await sleepMs(300)
        XCTAssertEqual(l.r.live.snapshot()?["status"] as? String, "paused")
        script.answer = statusAnswer(operatorType: 5, workoutType: 13, trainMonitorState: 1)
        await eventually("resumed") { l.r.live.snapshot()?["status"] as? String == "running" }
        XCTAssertTrue(l.r.events.contains("the watch resumed the workout"))
        script.answer = statusAnswer(operatorType: 0, workoutType: 13, trainMonitorState: 0)
        await eventually("finished") { l.r.live.snapshot()?["status"] as? String == "ended" }
        l.link.linkDisconnected()
    }

    func testRoughFixesGoToTheMapButNotToTheWatch() async {
        let l = makeLink()
        await l.link.linkConnected(l.r.rig.source.current!)
        l.r.rig.session.onData(gpsRequest(true))
        await eventually { l.gps.started == 1 }
        await eventually("fields read") { l.r.events.contains("watch takes GPS fields bitmap 0xd7") }
        let fed = { l.r.rig.watch.sent.filter { $0.service == 0x18 && $0.command == 0x03 }.count }
        let t0 = l.r.counter.now
        // A Wi-Fi or cell position, worse than the track's limit.
        l.gps.emit(WorkoutLinkWire.Fix(latitude: 10, longitude: 20, timeMs: t0, accuracy: TrackAccumulator.maxAccuracyM + 20))
        await sleepMs(80)
        XCTAssertEqual(fed(), 0)
        XCTAssertEqual(l.r.live.snapshot()?["locationAt"] as? Double, Double(t0))
        XCTAssertTrue(l.r.events.contains("phone fix 1, accuracy 50 m"))
        l.gps.emit(WorkoutLinkWire.Fix(latitude: 10, longitude: 20, timeMs: t0 + 1_000, accuracy: TrackAccumulator.maxAccuracyM))
        await eventually("a good fix is fed") { fed() == 1 }
        l.r.live.finish()
        l.link.linkDisconnected()
    }
}
