import XCTest
@testable import HuaweiProtocol

/// The P2P stack over the real session wire format against a scripted watch: registration gates, the Healthy Living request on the wire, the
/// heart-rate zones of a Track watch and the health dictionary sync with its status rows.
final class P2PStackTests: XCTestCase {
    static let watchHealthApp = "hw.watch.health.filesync"
    static let dictionaryModule = "hw.unitedevice.datadictionarysync"

    static func bitmap(_ bits: [Int]) -> Bytes {
        var out = Bytes(repeating: 0, count: 48)
        for bit in bits { out[bit / 8] |= UInt8(1 << (bit % 8)) }
        return out
    }

    /// Answers pings with 0xca and dictionary requests with the scripted pages (a watch that does not answer when `silent`).
    final class ScriptedWatch: @unchecked Sendable {
        let lock = NSLock()
        var silent = false
        var answerPings = true
        /// Pages per dictionary class, consumed one per request; an empty page after them.
        var pages: [Int: [Bytes]] = [:]
        var nextSeq = 100
        var requests: [(dictClass: Int, start: Int64)] = []

        func frame(_ cmd: UInt8, _ seq: Int, _ src: String, _ dst: String, data: Bytes? = nil, code: UInt8? = nil) -> Bytes {
            var tlv = HuaweiTLV()
            tlv.put(0x01, byte: cmd)
            tlv.put(0x02, short: Int16(seq))
            tlv.put(0x03, string: src)
            tlv.put(0x04, string: dst)
            if let data { tlv.put(0x07, bytes: data) }
            if let code { tlv.put(0x08, byte: code) }
            return UploadFakeWatch.tlvFrame(0x34, 0x01, tlv)
        }

        func respond(_ msg: UploadFakeWatch.Msg) -> [Bytes] {
            guard msg.service == 0x34, msg.command == 0x01, let tlv = msg.tlv, !silent else { return [] }
            guard let cmd = try? tlv.byte(0x01), let seq = try? tlv.short(0x02), let dst = try? tlv.string(0x04) else { return [] }
            if cmd == 1 {
                return answerPings ? [frame(3, Int(seq), dst, "com.huawei.health", code: 0xCA)] : []
            }
            if cmd == 2, dst == P2PStackTests.watchHealthApp, let data = try? tlv.bytes(0x07), data.first == 1, let request = try? HuaweiTLV(parsing: Array(data.dropFirst())) {
                let cls = (try? request.bytes(0x02))?.reduce(0) { ($0 << 8) | Int($1) } ?? 0
                let start = (try? request.long(0x05)) ?? -1
                lock.lock()
                requests.append((cls, start))
                var page = pages[cls] ?? []
                let answer = page.isEmpty ? P2PTests.answer(1, cls, [], 0, 0) : page.removeFirst()
                pages[cls] = page
                nextSeq += 1
                let s = nextSeq
                lock.unlock()
                return [frame(2, s, P2PStackTests.watchHealthApp, P2PStackTests.dictionaryModule, data: answer)]
            }
            return []
        }
    }

    final class MemoryMetrics: HealthMetricsStoring, @unchecked Sendable {
        struct Status: Equatable {
            var dictClass: Int
            var title: String
            var supported: Bool
            var gate: String
            var note: String?
            var rowsAdded: Int?
        }

        private let lock = NSLock()
        var rows: [DictionaryRow] = []
        var status: [String: Status] = [:]

        func lastFetchTimestamp(_ type: String) -> Int64 { lock.p2pLocked { rows.filter { $0.type == type }.map(\.lastTimestamp).max() ?? 0 } }

        func persist(_ rows: [DictionaryRow]) throws { lock.p2pLocked { self.rows.append(contentsOf: rows) } }

        func setStatus(type: String, dictClass: Int, title: String, supported: Bool, gate: String, note: String?, rowsAdded: Int?) throws {
            lock.p2pLocked {
                let previous = status[type]?.rowsAdded
                status[type] = Status(dictClass: dictClass, title: title, supported: supported, gate: gate, note: note, rowsAdded: rowsAdded ?? previous)
            }
        }
    }

    struct Harness {
        let watch: UploadFakeWatch
        let script: ScriptedWatch
        let session: HuaweiSession
        let caps: DeviceCaps
        let stack: P2PStack
        let state: P2PHealthCourseTests.MemoryState
        let logs: SleepFilesLogCollector
    }

    private func harness(
        expand: [Int], listed: Bool = true, day: HealthDay? = nil, age: Int = 35, configure: (ScriptedWatch) -> Void = { _ in }
    ) -> Harness {
        let script = ScriptedWatch()
        configure(script)
        let logs = SleepFilesLogCollector()
        let watch = UploadFakeWatch { script.respond($0) }
        let session = HuaweiSession(sink: watch, log: logs.sink)
        session.params.secretKey = Bytes(repeating: 0, count: 16)
        watch.attach(session)
        let caps = DeviceCaps()
        if listed { caps.supportedCommands = [0x34: [0x01]] }
        caps.expandCapabilities = Self.bitmap(expand)
        let state = P2PHealthCourseTests.MemoryState()
        let loaded = day ?? HealthDay(
            recordDay: 20261014, steps: 4000, stepGoal: 8000, exerciseMinutes: 0, sleepSeconds: nil, intakeKcal: nil, weightKg: nil, bloodPressure: false,
            stressMeasured: false, timestampMs: 1_700_000_000_000
        )
        let stack = P2PStack(
            session: session, caps: caps, log: logs.sink, settings: state,
            healthModelFactory: { manager in
                HealthModelService(manager: manager, settings: state, log: logs.sink, dayLoader: { _ in loaded }, nowMs: { 1_790_000_000_000 }, pushDelayMs: 10)
            },
            heartRateAge: { age }
        )
        return Harness(watch: watch, script: script, session: session, caps: caps, stack: stack, state: state, logs: logs)
    }

    private func waitFor(_ message: String, timeoutMs: Int = 3_000, _ condition: () -> Bool) async {
        var waited = 0
        while !condition() && waited < timeoutMs {
            try? await Task.sleep(nanoseconds: 10_000_000)
            waited += 10
        }
        XCTAssertTrue(condition(), "timed out waiting for \(message)")
    }

    private func p2p(_ h: Harness) -> [UploadFakeWatch.Msg] { h.watch.all(0x34, 0x01) }

    private func packages(_ msgs: [UploadFakeWatch.Msg], cmd: Int) -> [String] {
        msgs.compactMap { m in (try? m.tlv?.byte(0x01)).flatMap { Int($0) == cmd ? (try? m.tlv?.string(0x04)) : nil } }
    }

    // MARK: registration

    func testAWatchWithoutTheP2PServiceRegistersNothing() async throws {
        let h = harness(expand: [37, 54, 235], listed: false)
        await h.stack.start()
        h.stack.registerServices()
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertTrue(p2p(h).isEmpty)
        XCTAssertNil(h.stack.dictionary)
        XCTAssertNil(h.stack.healthModel)
        XCTAssertFalse(h.stack.resendHeartRateZones())
        XCTAssertTrue(h.logs.messages.contains { $0.contains("the watch does not list the P2P service") })
        h.stack.close()
    }

    func testTheGatesDecideWhichServicesRegister() async throws {
        // 37 set, switched on: dictionary + Healthy Living; 54 not set: no Track service.
        let h = harness(expand: [37])
        await h.stack.start()
        h.stack.registerServices()
        await waitFor("two pings") { self.packages(self.p2p(h), cmd: 1).count == 2 }
        XCTAssertEqual(Set(packages(p2p(h), cmd: 1)), ["hw.watch.health.filesync", "com.huawei.health.healthyliving"])
        await waitFor("ping answers") { h.stack.healthModel?.pingCode == 0xCA && h.stack.dictionaryPing == 0xCA }
        XCTAssertTrue(h.stack.dictionary!.isAvailable)
        XCTAssertFalse(h.stack.resendHeartRateZones())
        h.stack.close()

        // 37 not set: only the dictionary.
        let none = harness(expand: [])
        await none.stack.start()
        none.stack.registerServices()
        await waitFor("one ping") { self.packages(self.p2p(none), cmd: 1).count == 1 }
        XCTAssertNil(none.stack.healthModel)
        XCTAssertTrue(none.logs.messages.contains { $0.contains("ExpandCapability 37 is not set") })
        none.stack.close()

        // 37 set but switched off in the app: only the dictionary.
        let off = harness(expand: [37])
        off.state.healthLivingEnabled = false
        await off.stack.start()
        off.stack.registerServices()
        await waitFor("one ping") { self.packages(self.p2p(off), cmd: 1).count == 1 }
        XCTAssertNil(off.stack.healthModel)
        XCTAssertTrue(off.logs.messages.contains { $0.contains("switched off in the app") })
        off.stack.close()
    }

    func testATrackWatchGetsItsHeartRateZonesOverP2P() async throws {
        let h = harness(expand: [0x36], age: 40)
        await h.stack.start()
        h.stack.registerServices()
        await waitFor("the zones") { !self.packages(self.p2p(h), cmd: 2).isEmpty }
        let message = p2p(h).first { (try? $0.tlv?.byte(0x01)) == 2 }!
        XCTAssertEqual(try message.tlv?.string(0x03), "hw.unitedevice.track")
        XCTAssertEqual(try message.tlv?.string(0x04), "hw.watch.health.p2p")
        XCTAssertEqual(try message.tlv?.string(0x05), "UniteDeviceManagement")
        XCTAssertEqual(try message.tlv?.string(0x06), "SystemApp")
        let sub = try P2PSubMsg(parsing: try message.tlv?.bytes(0x07))
        XCTAssertEqual(sub.type, 2)
        let expected = HeartRateZonesCalc.trackTlv(HeartRateZonesCalc.deviceConfig(age: 40, track: true, simpleCommand: false, extended: false))!
        var tlv = HuaweiTLV()
        for (tag, value) in expected { tlv.put(tag, byte: UInt8(truncatingIfNeeded: value)) }
        XCTAssertEqual(sub.data, tlv.serialize())
        XCTAssertEqual(Int(sub.totalLength), 36 + tlv.serialize().count)
        // A profile change sends them again.
        XCTAssertTrue(h.stack.resendHeartRateZones())
        await waitFor("the zones again") { self.packages(self.p2p(h), cmd: 2).count == 2 }
        h.stack.close()
    }

    // MARK: Healthy Living on the wire

    func testTheWatchsHealthyLivingRequestIsAckedAndAnsweredOverTheSession() async throws {
        let h = harness(expand: [37])
        await h.stack.start()
        h.stack.registerServices()
        await waitFor("ping answered") { h.stack.healthModel?.pingCode == 0xCA }
        let body = HealthModelMessages.encodeRequestBody(.init(recordDay: 20261014, requestTaskIds: "2", pageSize: 0, packageSize: 0))
        let request = HealthModelMessages.encodeRequest(msgType: 2001, msgVer: 3.0, body: body)
        h.session.onData(h.script.frame(2, 400, "com.huawei.health.healthyliving", "hw.unitedevice.healthmodel", data: request))
        await waitFor("ack and report") { self.p2p(h).filter { (try? $0.tlv?.byte(0x01)) == 3 }.count == 1 && self.packages(self.p2p(h), cmd: 2).contains("com.huawei.health.healthyliving") }
        let ack = p2p(h).first { (try? $0.tlv?.byte(0x01)) == 3 }!
        XCTAssertEqual(try ack.tlv?.short(0x02), 400)
        XCTAssertEqual(try ack.tlv?.int(0x08), 0xCF)
        XCTAssertEqual(try ack.tlv?.string(0x03), "hw.unitedevice.healthmodel")
        let report = p2p(h).first { (try? $0.tlv?.string(0x04)) == "com.huawei.health.healthyliving" && (try? $0.tlv?.byte(0x01)) == 2 }!
        let decoded = try HealthModelMessages.decodeReport(try report.tlv!.bytes(0x07))
        let tasks = try HealthModelMessages.decodeTaskBody(decoded.body)
        XCTAssertEqual(tasks.tasks.map(\.taskId), [2])
        XCTAssertEqual(tasks.tasks[0].taskValue, "4000")
        XCTAssertEqual(h.state.healthLivingMsgVer, 3.0)
        h.stack.close()
    }

    // MARK: health metrics

    private func hrvPage(_ start: Int64, _ value: Double) -> Bytes { P2PTests.answer(1, 500044, [[start, start + 60_000, 0]], 500044831, value) }

    func testTheHealthMetricsSyncPagesThroughTheDictionaryAndRecordsStatus() async throws {
        let h = harness(expand: [235, 29]) { script in
            script.pages[500044] = [
                P2PTests.answer(1, 500044, [[1_700_000_000_000, 1_700_000_060_000, 0]], 500044831, 42), P2PTests.answer(1, 500044, [[1_700_000_120_000, 1_700_000_180_000, 0]], 500044831, 51),
            ]
            script.pages[400012] = []
        }
        await h.stack.start()
        h.stack.registerServices()
        let metrics = MemoryMetrics()
        let sync = HealthMetricsSync(stack: h.stack, store: metrics, caps: h.caps, log: h.logs.sink, classTimeoutMs: 3_000, pingWaitMs: 3_000)
        let result = try await sync.sync()
        XCTAssertEqual(result, HealthMetricsResult(rows: ["skin_temperature": 0, "hrv": 2], failed: []))
        XCTAssertEqual(result?.total, 2)
        XCTAssertEqual(metrics.rows.map(\.value), [42, 51])
        XCTAssertEqual(metrics.rows.map(\.timestamp), [1_700_000_000_000, 1_700_000_120_000])
        // Every gate is recorded, supported or not.
        XCTAssertEqual(metrics.status.count, 9)
        XCTAssertEqual(metrics.status["hrv"], MemoryMetrics.Status(dictClass: 500044, title: "Heart rate variability", supported: true, gate: "ExpandCapability 235 (GB supportsHRV)", note: nil, rowsAdded: 2))
        XCTAssertEqual(metrics.status["skin_temperature"]?.note, "The watch had no new entries.")
        XCTAssertEqual(metrics.status["blood_pressure"]?.supported, false)
        XCTAssertEqual(
            metrics.status["blood_pressure"]?.note, "Not supported by this watch (ExpandCapability 59 (GB supportsBloodPressure, commented out in GB) is not set)."
        )
        XCTAssertNil(metrics.status["blood_pressure"]?.rowsAdded)
        // The second page is asked for from just after the first one's last entry.
        let asked = h.script.requests.filter { $0.dictClass == 500044 }.map(\.start)
        XCTAssertEqual(asked, [0, 1_700_000_061_000, 1_700_000_181_000])
        h.stack.close()
    }

    func testASecondSyncAsksFromTheStoredTimestamp() async throws {
        let h = harness(expand: [235])
        await h.stack.start()
        h.stack.registerServices()
        let metrics = MemoryMetrics()
        try metrics.persist([DictionaryRow(type: "hrv", timestamp: 1_700_000_000_000, lastTimestamp: 1_700_000_060_000, value: 1, valuesJson: "{}")])
        let sync = HealthMetricsSync(stack: h.stack, store: metrics, caps: h.caps, log: h.logs.sink, classTimeoutMs: 3_000, pingWaitMs: 3_000)
        let result = try await sync.sync()
        XCTAssertEqual(result?.total, 0)
        XCTAssertEqual(h.script.requests.map(\.start), [1_700_000_061_000])
        h.stack.close()
    }

    func testASyncWithoutAWatchAppAnswerGivesUpAndSaysSo() async throws {
        let h = harness(expand: [235]) { $0.answerPings = false }
        await h.stack.start()
        h.stack.registerServices()
        let metrics = MemoryMetrics()
        let sync = HealthMetricsSync(stack: h.stack, store: metrics, caps: h.caps, log: h.logs.sink, classTimeoutMs: 300, pingWaitMs: 200)
        let result = try await sync.sync()
        XCTAssertEqual(result, HealthMetricsResult(rows: [:], failed: ["hrv"]))
        XCTAssertEqual(metrics.status["hrv"]?.note, "The watch app did not answer the P2P ping; nothing synced.")
        XCTAssertTrue(h.logs.messages.contains { $0.contains("hw.watch.health.filesync is not available (ping not answered within 200 ms)") })
        h.stack.close()
    }

    func testAClassTheWatchLeavesUnansweredIsGivenUp() async throws {
        let h = harness(expand: [235])
        await h.stack.start()
        h.stack.registerServices()
        await waitFor("ping answered") { h.stack.dictionary?.isAvailable == true }
        h.script.silent = true
        let metrics = MemoryMetrics()
        let sync = HealthMetricsSync(stack: h.stack, store: metrics, caps: h.caps, log: h.logs.sink, classTimeoutMs: 200, pingWaitMs: 1_000)
        let result = try await sync.sync()
        XCTAssertEqual(result, HealthMetricsResult(rows: ["hrv": 0], failed: ["hrv"]))
        XCTAssertEqual(metrics.status["hrv"]?.note, "The watch did not answer within 0 s.")
        h.stack.close()
    }

    func testASyncOnAStackWithoutTheServiceIsSkipped() async throws {
        let h = harness(expand: [235], listed: false)
        await h.stack.start()
        h.stack.registerServices()
        let sync = HealthMetricsSync(stack: h.stack, store: MemoryMetrics(), caps: h.caps, log: h.logs.sink)
        let result = try await sync.sync()
        XCTAssertNil(result)
        h.stack.close()
    }

    func testAWatchThatSupportsNoClassSyncsNothing() async throws {
        let h = harness(expand: [])
        await h.stack.start()
        h.stack.registerServices()
        let metrics = MemoryMetrics()
        let result = try await HealthMetricsSync(stack: h.stack, store: metrics, caps: h.caps, log: h.logs.sink).sync()
        XCTAssertEqual(result, HealthMetricsResult(rows: [:], failed: []))
        XCTAssertEqual(metrics.status.values.filter(\.supported).count, 0)
        XCTAssertEqual(metrics.status.count, 9)
        h.stack.close()
    }

    func testClosingTheStackStopsItsServices() async throws {
        let h = harness(expand: [235, 37])
        await h.stack.start()
        h.stack.registerServices()
        await waitFor("pings answered") { h.stack.dictionary?.isAvailable == true }
        h.stack.close()
        XCTAssertFalse(h.stack.dictionary!.isAvailable)
        let before = p2p(h).count
        h.session.onData(h.script.frame(1, 9, "hw.watch.health.filesync", "hw.unitedevice.datadictionarysync"))
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(p2p(h).count, before)
    }
}

extension P2PStackTests {
    /// The Petal Maps probe (lab, PetalMapsProbe.swift) on a real stack: the watch app's ping is answered 0xca, a frame of a service nothing
    /// handles is dumped inside the window, and once unregistered the ping goes unanswered.
    func testThePetalMapsProbeAnswersTheMapsAppAndHearsWhatNothingHandles() async throws {
        let h = harness(expand: [])
        await h.stack.start()
        h.stack.registerServices()
        await h.stack.registerPetalProbe()
        XCTAssertNotNil(h.stack.petalProbe)
        XCTAssertTrue(h.logs.contains("PetalProbe: registered for the watch app com.huawei.ohos.maps.app"))

        h.session.onData(h.script.frame(1, 90, PetalProbeWire.watchPackage, PetalProbeWire.phonePackage))
        let isAnswer: (UploadFakeWatch.Msg) -> Bool = { (try? $0.tlv?.byte(0x01)) == 3 && (try? $0.tlv?.string(0x04)) == PetalProbeWire.watchPackage }
        await waitFor("the 0xca answer") { self.p2p(h).contains(where: isAnswer) }
        let ack = try XCTUnwrap(p2p(h).first(where: isAnswer))
        XCTAssertEqual(try ack.tlv?.short(0x02), 90)
        XCTAssertEqual(try ack.tlv?.string(0x03), PetalProbeWire.phonePackage)
        XCTAssertEqual(try ack.tlv?.int(0x08), 0xCA)

        var unknown = HuaweiTLV()
        unknown.put(0x01, byte: 0xAA)
        h.session.onData(UploadFakeWatch.tlvFrame(0x27, 0x05, unknown))
        await waitFor("the unhandled frame") { h.logs.contains("PetalProbe: unhandled svc=27 cmd=05 tlv 01 len=1: AA = 170") }

        h.stack.unregisterPetalProbe()
        XCTAssertNil(h.stack.petalProbe)
        let before = p2p(h).count
        h.session.onData(h.script.frame(1, 91, PetalProbeWire.watchPackage, PetalProbeWire.phonePackage))
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(p2p(h).count, before, "unregistered: the ping goes unanswered")
        h.stack.close()
    }
}
