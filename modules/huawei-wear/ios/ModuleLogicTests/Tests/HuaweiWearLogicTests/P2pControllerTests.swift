import XCTest
@testable import HuaweiWearLogic

extension FakeLink: LinkHandleSource {}

/// The P2P module glue: settings, the health metric tables, the day Healthy Living reports, the course parser and the controller against a
/// scripted watch (registration, Healthy Living, the metrics sync as a sync extension, the course push through a real upload).
final class P2pControllerTests: XCTestCase {
    // MARK: settings

    func testSettingsDefaultsAndPersistence() {
        let defaults = ephemeralDefaults()
        let s = P2pSettings(defaults: defaults)
        XCTAssertTrue(s.healthLivingEnabled)
        XCTAssertEqual(s.healthLivingMsgVer, 0)
        XCTAssertEqual(s.healthLivingPackageSize, 0)
        XCTAssertEqual(s.healthLivingLastRequestMs, 0)
        XCTAssertEqual(s.healthLivingLastReportMs, 0)
        XCTAssertNil(s.healthLivingLastSummary)
        XCTAssertFalse(s.experimentalCourses)
        s.healthLivingEnabled = false
        s.healthLivingMsgVer = 3.5
        s.healthLivingPackageSize = 4096
        s.healthLivingLastRequestMs = 1_792_110_700_123
        s.healthLivingLastReportMs = 1_792_110_701_456
        s.healthLivingLastSummary = "day 1"
        s.experimentalCourses = true
        let again = P2pSettings(defaults: defaults)
        XCTAssertFalse(again.healthLivingEnabled)
        XCTAssertEqual(again.healthLivingMsgVer, 3.5)
        XCTAssertEqual(again.healthLivingPackageSize, 4096)
        XCTAssertEqual(again.healthLivingLastRequestMs, 1_792_110_700_123)
        XCTAssertEqual(again.healthLivingLastReportMs, 1_792_110_701_456)
        XCTAssertEqual(again.healthLivingLastSummary, "day 1")
        XCTAssertTrue(again.experimentalCourses)
        again.healthLivingLastSummary = nil
        XCTAssertNil(P2pSettings(defaults: defaults).healthLivingLastSummary)
    }

    // MARK: health metric tables

    private func store() -> SyncStore { SyncStore(url: temporaryDatabaseURL()) }

    func testMetricRowsAreUpsertedByTypeAndTimestampAndStoredInSeconds() throws {
        let sync = store()
        let metrics = HealthMetricsStore(store: sync)
        XCTAssertEqual(metrics.lastFetchTimestamp("hrv"), 0)
        try metrics.persist([])
        try metrics.persist([
            DictionaryRow(type: "hrv", timestamp: 1_700_000_000_999, lastTimestamp: 1_700_000_060_000, value: 42, valuesJson: #"{"rmssd":42}"#),
            DictionaryRow(type: "hrv", timestamp: 1_700_000_100_000, lastTimestamp: 1_700_000_090_000, value: nil, valuesJson: "{}"),
        ])
        XCTAssertEqual(metrics.lastFetchTimestamp("hrv"), 1_700_000_100_000)
        XCTAssertEqual(metrics.lastFetchTimestamp("emotion"), 0)
        XCTAssertEqual(metrics.count("hrv"), 2)
        // The same (type, ts) replaces the row.
        try metrics.persist([DictionaryRow(type: "hrv", timestamp: 1_700_000_000_000, lastTimestamp: 1_700_000_200_000, value: 50, valuesJson: #"{"rmssd":50}"#)])
        XCTAssertEqual(metrics.count("hrv"), 2)
        let rows = try sync.read { db in
            try db.query("SELECT ts, last_ts, value, values_json FROM health_metrics ORDER BY ts") { ($0.int64(0), $0.int64(1), $0.isNull(2) ? nil : $0.double(2), $0.text(3)!) }
        }
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows[0].0, 1_700_000_000)
        XCTAssertEqual(rows[0].1, 1_700_000_200)
        XCTAssertEqual(rows[0].2, 50)
        XCTAssertEqual(rows[0].3, #"{"rmssd":50}"#)
        XCTAssertEqual(rows[1].0, 1_700_000_100)
        XCTAssertEqual(rows[1].1, 1_700_000_100)  // last time never before the start
        XCTAssertNil(rows[1].2)
    }

    func testStatusKeepsTheLastSyncAndCountWhenOnlyTheGateIsRechecked() throws {
        let sync = store()
        let metrics = HealthMetricsStore(store: sync, nowSec: { 1_000 })
        func row() throws -> (Int, Int, Int64?, Int?, String?) {
            try sync.read { db in
                try db.query("SELECT supported, checked_at, synced_at, rows_added, note FROM health_metric_status WHERE type = 'hrv'") {
                    ($0.int(0), $0.int(1), $0.isNull(2) ? nil : $0.int64(2), $0.optionalInt(3), $0.text(4))
                }.first!
            }
        }
        try metrics.setStatus(type: "hrv", dictClass: 500044, title: "HRV", supported: true, gate: "g", note: nil, rowsAdded: nil)
        var r = try row()
        XCTAssertEqual(r.0, 1)
        XCTAssertEqual(r.1, 1_000)
        XCTAssertNil(r.2)
        XCTAssertNil(r.3)
        let later = HealthMetricsStore(store: sync, nowSec: { 2_000 })
        try later.setStatus(type: "hrv", dictClass: 500044, title: "HRV", supported: true, gate: "g", note: "The watch had no new entries.", rowsAdded: 0)
        r = try row()
        XCTAssertEqual(r.1, 2_000)
        XCTAssertEqual(r.2, 2_000)
        XCTAssertEqual(r.3, 0)
        XCTAssertEqual(r.4, "The watch had no new entries.")
        let latest = HealthMetricsStore(store: sync, nowSec: { 3_000 })
        try latest.setStatus(type: "hrv", dictClass: 500044, title: "HRV", supported: false, gate: "g2", note: "x", rowsAdded: nil)
        r = try row()
        XCTAssertEqual(r.0, 0)
        XCTAssertEqual(r.1, 3_000)
        XCTAssertEqual(r.2, 2_000)  // kept
        XCTAssertEqual(r.3, 0)  // kept
    }

    // MARK: the day

    private var utc: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(secondsFromGMT: 0)!
        return c
    }

    private func seed(_ sync: SyncStore, goalDay: Int64) throws {
        try sync.read { db in
            // 2026-10-14 00:00 UTC = 1_791_936_000
            for (offset, steps) in [(0, 1200), (3_600, 2300), (86_399, 100), (86_400, 999)] {
                try db.run("INSERT INTO step_samples (timestamp, steps, calories, distance) VALUES (?, ?, 0, 0)", [.int(goalDay + Int64(offset)), .int(Int64(steps))])
            }
            try db.run(
                "INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, steps, summary_json) VALUES (1, ?, ?, 1, 'Run', 1800, 0, 0, 0, '{}')",
                [.int(goalDay + 7_200), .int(goalDay + 9_000)]
            )
            try db.run(
                "INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, steps, summary_json) VALUES (2, ?, ?, 1, 'Run', 1500, 0, 0, 0, '{}')",
                [.int(goalDay + 20_000), .int(goalDay + 21_500)]
            )
            // A night ending in the day, a nap, an awake span, and a span that ends on the next day.
            for (start, end, stage, type) in [(-7_200, 21_600, "light", 1), (30_000, 32_400, "light", 2), (21_600, 23_000, "awake", 3), (80_000, 90_000, "deep", 4)] as [(Int64, Int64, String, Int)] {
                try db.run("INSERT INTO sleep_segments (start, end, type, stage) VALUES (?, ?, ?, ?)", [.int(goalDay + start), .int(goalDay + end), .int(Int64(type)), .text(stage)])
            }
            try db.run("INSERT INTO health_metrics (type, ts, last_ts, value, values_json) VALUES ('emotion', ?, ?, 3, '{}')", [.int(goalDay + 100), .int(goalDay + 100)])
            try db.run("INSERT INTO health_metrics (type, ts, last_ts, value, values_json) VALUES ('blood_pressure', ?, ?, NULL, '{}')", [.int(goalDay + 90_000), .int(goalDay + 90_000)])
            try db.run(
                "INSERT INTO diet_day (date, meals_json, updated_at) VALUES ('2026-10-14', ?, 1)",
                [.text(#"[{"name":"a","kcal":450.5},{"name":"b","kcal":"100"},{"name":"c"},7,{"kcal":1}]"#)]
            )
        }
    }

    func testTheDayIsReadFromTheSharedDatabase() throws {
        let sync = store()
        let start: Int64 = 1_791_936_000
        try seed(sync, goalDay: start)
        let now: Int64 = (start + 50_000) * 1000
        let day = try sync.read { HealthModelData.load(db: $0, requestedDay: 20261014, stepGoal: 6000, nowMs: now, calendar: utc) }
        XCTAssertEqual(day.recordDay, 20261014)
        XCTAssertEqual(day.steps, 1200 + 2300 + 100)
        XCTAssertEqual(day.stepGoal, 6000)
        XCTAssertEqual(day.exerciseMinutes, 55)
        XCTAssertEqual(day.sleepSeconds, 28_800 + 2_400)  // the night that ends in the day (not the awake span) plus the nap
        XCTAssertEqual(day.intakeKcal, 551.5)
        XCTAssertNil(day.weightKg)
        XCTAssertFalse(day.bloodPressure)  // the reading is on the next day
        XCTAssertTrue(day.stressMeasured)
        XCTAssertEqual(day.timestampMs, (start + 86_399) * 1000)
    }

    func testAnEmptyDayAndAnImpossibleRequestFallBackToToday() throws {
        let sync = store()
        let now: Int64 = 1_791_936_000_000 + 12 * 3_600_000
        for requested in [0, 20261340, 20260230] {
            let day = try sync.read { HealthModelData.load(db: $0, requestedDay: requested, stepGoal: 0, nowMs: now, calendar: utc) }
            XCTAssertEqual(day.recordDay, 20261014, "requested \(requested)")
            XCTAssertEqual(day.steps, 0)
            XCTAssertEqual(day.stepGoal, HealthModelData.defaultStepGoal)
            XCTAssertNil(day.sleepSeconds)
            XCTAssertNil(day.intakeKcal)
            XCTAssertFalse(day.stressMeasured)
            XCTAssertEqual(day.timestampMs, now.advanced(by: 0).clamped(to: now))
        }
        XCTAssertEqual(HealthModelData.recordDay(ofMs: now, calendar: utc), 20261014)
    }

    func testTheTimestampOfAnEmptyPastDayIsTheEndOfThatDay() throws {
        let sync = store()
        let now: Int64 = 1_791_936_000_000 + 5 * 86_400_000
        let day = try sync.read { HealthModelData.load(db: $0, requestedDay: 20261014, stepGoal: 8000, nowMs: now, calendar: utc) }
        XCTAssertEqual(day.timestampMs, (1_791_936_000 + 86_400) * 1000)
    }

    // MARK: the course from JS

    func testACourseIsParsedWithTheAndroidRecordDefaults() throws {
        let raw: [String: Any] = [
            "name": "  Intervals ",
            "blocks": [
                ["repeat": 4, "steps": [["kind": "run", "target": "distance", "targetValue": 400, "intensity": "pace", "low": 270.0, "high": 300], ["kind": "rest"]]],
                ["steps": [["kind": "cooldown", "target": "none", "targetValue": 0]]],
            ] as [[String: Any]],
        ]
        let course = try P2pController.parseCourse(raw, nowMs: 1_790_000_000_000)
        XCTAssertEqual(course.name, "Intervals")
        XCTAssertEqual(course.id, "JF" + String(1_790_000_000_000, radix: 36).uppercased())
        XCTAssertEqual(course.blocks.count, 2)
        XCTAssertEqual(course.blocks[0].repeatCount, 4)
        XCTAssertEqual(course.blocks[0].steps[0], CourseStep(kind: .run, target: .distance, targetValue: 400, intensity: .pace, low: 270, high: 300))
        XCTAssertEqual(course.blocks[0].steps[1], CourseStep(kind: .rest, target: .time, targetValue: 0))
        XCTAssertEqual(course.blocks[1].repeatCount, 1)
        XCTAssertEqual(try P2pController.parseCourse([:]).blocks.count, 0)
    }

    func testAMistypedCourseIsAnInvalidArgument() {
        func rejects(_ raw: [String: Any], _ message: String, line: UInt = #line) {
            XCTAssertThrowsError(try P2pController.parseCourse(raw), line: line) {
                XCTAssertEqual(($0 as? WearError)?.code, .invalidArgument, line: line)
                XCTAssertEqual(($0 as? WearError)?.message, message, line: line)
            }
        }
        rejects(["name": 5], "'name' must be text")
        rejects(["blocks": [5]], "Every block must be an object")
        rejects(["blocks": [["steps": [5]]]], "Every step must be an object")
        rejects(["blocks": [["steps": [["kind": "sprint"]]]]], "Unknown step kind 'sprint'")
        rejects(["blocks": [["steps": [["target": "laps"]]]]], "Unknown target 'laps'")
        rejects(["blocks": [["steps": [["intensity": "power"]]]]], "Unknown intensity 'power'")
        rejects(["blocks": [["repeat": 1.5, "steps": []]]], "'repeat' must be a whole number")
        rejects(["blocks": [["repeat": "2", "steps": []]]], "'repeat' must be a whole number")
    }

    // MARK: the controller against a scripted watch

    private final class Harness: @unchecked Sendable {
        let events = RecordingEvents()
        let link: FakeLink
        let sync = SyncStore(url: temporaryDatabaseURL())
        let defaults = ephemeralDefaults()
        let settings: WearSettings
        let controller: P2pController
        var extensions: [WearLink.SyncExtension] = []
        private let lock = NSLock()
        var pingAnswers = true
        var uploadStatus: UInt8 = 1
        var courseAnswer: Bytes? = [0x0A, 0x0B]
        /// The watch's side of a route push: the ack of the handshake (0xCF = received, nil = none), its answer (code, point limit), its answer to the file.
        var routeAck: UInt8? = 0xCF
        var routeHandshake: Bytes? = [1, 0, 0, 0, 200, 0, 0, 0]
        var routeFile: Bytes? = [1, 0, 0, 0]
        var uploadName = ""
        var hrvPages: [Bytes] = []
        private var seq = 500

        init(expand: [Int], listed: Bool = true) {
            link = FakeLink(events: events, commands: listed ? [0x34: [0x01]] : [:], expandBits: expand)
            settings = WearSettings(defaults: ephemeralDefaults())
            var captured: [WearLink.SyncExtension] = []
            let box = ExtensionBox()
            controller = P2pController(
                settings: P2pSettings(defaults: defaults), link: link, addSyncExtension: { box.add($0) }, wearSettings: settings, syncStore: sync, events: events,
                nowMs: { 1_791_950_000_000 }, answerWaitMs: 300
            )
            captured = box.list
            extensions = captured
            link.setConnected(true)
            link.watch.responder = { [weak self] in self?.respond($0) ?? [] }
        }

        private func frame(_ cmd: UInt8, _ seq: Int, _ src: String, _ dst: String, data: Bytes? = nil, code: UInt8? = nil) -> Bytes {
            var tlv = HuaweiTLV()
            tlv.put(0x01, byte: cmd)
            tlv.put(0x02, short: Int16(seq))
            tlv.put(0x03, string: src)
            tlv.put(0x04, string: dst)
            if let data { tlv.put(0x07, bytes: data) }
            if let code { tlv.put(0x08, byte: code) }
            return WeatherScriptedWatch.tlvFrame(service: 0x34, command: 0x01, tlv)
        }

        func watchSends(_ cmd: UInt8, _ seq: Int, _ src: String, _ dst: String, data: Bytes? = nil) {
            link.session.onData(frame(cmd, seq, src, dst, data: data))
        }

        private func next() -> Int {
            lock.lock()
            defer { lock.unlock() }
            seq += 1
            return seq
        }

        func respond(_ r: WeatherScriptedWatch.Request) -> [Bytes] {
            func ok(_ tlv: HuaweiTLV) -> [Bytes] { [WeatherScriptedWatch.tlvFrame(service: r.service, command: r.command, tlv)] }
            switch (r.service, r.command) {
            case (0x34, 0x01):
                guard let cmd = try? r.tlv.byte(0x01), let seq = try? r.tlv.short(0x02), let dst = try? r.tlv.string(0x04) else { return [] }
                if cmd == 1 { return pingAnswers ? [frame(3, Int(seq), dst, "com.huawei.health", code: 0xCA)] : [] }
                if cmd == 2, dst == "hw.watch.health.filesync", let data = try? r.tlv.bytes(0x07), data.first == 1 {
                    let request = try? HuaweiTLV(parsing: Array(data.dropFirst()))
                    let cls = (try? request?.bytes(0x02))?.flatMap { $0 }.reduce(0) { ($0 << 8) | Int($1) } ?? 0
                    let page: Bytes = hrvPages.isEmpty ? Self.answer(cls, [], 0, 0) : hrvPages.removeFirst()
                    return [frame(2, next(), "hw.watch.health.filesync", "hw.unitedevice.datadictionarysync", data: page)]
                }
                if cmd == 2, dst == "in.huawei.fitness", let data = try? r.tlv.bytes(0x07) {
                    var out = [Bytes]()
                    if let routeAck { out.append(frame(3, Int(seq), dst, "hw.unitedevice.fitness", code: routeAck)) }
                    if let message = try? P2PSubMsg(parsing: data), Int(message.type) == RouteFile.businessRouteHandshake, let answer = routeHandshake {
                        out.append(frame(2, next(), "in.huawei.fitness", "hw.unitedevice.fitness", data: P2PSubMsg(type: RouteFile.businessRouteHandshake, messageId: 77, data: answer).bytes))
                    }
                    return out
                }
                return []
            case (0x28, 0x02):
                uploadName = (try? r.tlv.string(0x01)) ?? ""
                var res = HuaweiTLV()
                res.put(0x7f, int: 100_000)
                var id = HuaweiTLV()
                id.put(0x01, byte: 7)
                return [WeatherScriptedWatch.tlvFrame(service: 0x28, command: 0x02, res), WeatherScriptedWatch.tlvFrame(service: 0x28, command: 0x03, id)]
            case (0x28, 0x03):
                var t = HuaweiTLV()
                t.put(0x01, byte: 7)
                t.put(0x02, string: "1.0")
                t.put(0x03, int: 5000)
                t.put(0x04, int: 0)
                t.put(0x05, int: 100_000)
                t.put(0x06, int: 100_000)
                t.put(0x07, int: 10)
                t.put(0x08, int: 0)
                t.put(0x09, byte: 1)
                return [WeatherScriptedWatch.tlvFrame(service: 0x28, command: 0x04, t)]
            case (0x28, 0x04):
                var t = HuaweiTLV()
                t.put(0x02, int: 0)
                t.put(0x03, int: Int32(uploadSize))
                return [WeatherScriptedWatch.tlvFrame(service: 0x28, command: 0x05, t)]
            case (0x28, 0x06):
                var t = HuaweiTLV()
                t.put(0x02, byte: uploadStatus)
                var out = [WeatherScriptedWatch.tlvFrame(service: 0x28, command: 0x07, t)]
                if let answer = courseAnswer, let id = messageId(of: uploadName) {
                    out.append(frame(2, next(), "in.huawei.fitness", "hw.unitedevice.fitness", data: P2PSubMsg(type: 3, messageId: id, data: answer).bytes))
                }
                if uploadName == RouteFile.fileName, let answer = routeFile {
                    out.append(frame(2, next(), "in.huawei.fitness", "hw.unitedevice.fitness", data: P2PSubMsg(type: RouteFile.businessRouteFile, messageId: 4242, data: answer).bytes))
                }
                return out
            default:
                return []
            }
        }

        /// The size of the file the phone announced in 28/02 (the watch asks for all of it at once).
        var uploadSize: Int {
            guard let request = link.watch.requests.last(where: { $0.key == "28/02" }), let size = try? request.tlv.int(0x02) else { return 0 }
            return Int(size)
        }

        func messageId(of name: String) -> Int? { Int(name.replacingOccurrences(of: "courseInfo.bin", with: "")) }

        static func answer(_ cls: Int, _ entries: [[Int64]], _ type: Int, _ value: Double) -> Bytes {
            var tlv = HuaweiTLV()
            tlv.put(0x01, byte: 1)
            tlv.put(0x02, bytes: P2PDictionarySyncService.dictToBytes(cls))
            var block = HuaweiTLV()
            for e in entries {
                var l = HuaweiTLV()
                l.put(0x05, long: e[0])
                l.put(0x06, long: e[1])
                var inner = HuaweiTLV()
                inner.put(0x09, int: Int32(type))
                inner.put(0x0a, bytes: (0..<8).map { UInt8((value.bitPattern >> UInt64(8 * (7 - $0))) & 0xFF) })
                var wrap = HuaweiTLV()
                wrap.put(0x88, tlv: inner)
                l.put(0x87, tlv: wrap)
                block.put(0x84, tlv: l)
            }
            if !entries.isEmpty { tlv.put(0x83, tlv: block) }
            return [1] + tlv.serialize()
        }

        var p2pWrites: [WeatherScriptedWatch.Request] { link.watch.requests.filter { $0.key == "34/01" } }
    }

    private final class ExtensionBox: @unchecked Sendable {
        private let lock = NSLock()
        private var _list: [WearLink.SyncExtension] = []
        func add(_ e: @escaping WearLink.SyncExtension) { lock.lock(); _list.append(e); lock.unlock() }
        var list: [WearLink.SyncExtension] { lock.lock(); defer { lock.unlock() }; return _list }
    }

    private func connect(_ h: Harness) async {
        await h.controller.linkConnected(h.link.handleValue)
        await eventually("pings") { h.controller.stack?.dictionary?.isAvailable == true }
    }

    func testTheStatusesWithNoWatchAreOffAndPushingNeedsOne() async {
        let h = Harness(expand: [37, 41])
        h.link.setConnected(false)
        let hl = h.controller.healthLivingStatus()
        XCTAssertEqual(hl["supported"] as? Bool, false)
        XCTAssertEqual(hl["gate"] as? String, "ExpandCapability 37")
        XCTAssertEqual(hl["gateSet"] as? Bool, false)
        XCTAssertEqual(hl["enabled"] as? Bool, true)
        XCTAssertEqual(hl["registered"] as? Bool, false)
        XCTAssertTrue(hl["pingCode"] is NSNull)
        XCTAssertTrue(hl["msgVer"] is NSNull)
        XCTAssertEqual(hl["packageSize"] as? Int, 0)
        XCTAssertTrue(hl["lastRequestAt"] is NSNull)
        XCTAssertTrue(hl["lastReportAt"] is NSNull)
        XCTAssertTrue(hl["lastReport"] is NSNull)
        let c = h.controller.coursesStatus()
        XCTAssertEqual(Set(c.keys), ["enabled", "gate41", "gate169", "gate295", "p2p"])
        XCTAssertEqual(c["enabled"] as? Bool, false)
        XCTAssertEqual(c["p2p"] as? Bool, false)
        do {
            _ = try await h.controller.pushHealthLiving()
            XCTFail("no stack")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .unsupported)
        } catch { XCTFail("\(error)") }
    }

    func testRegistrationOnConnectAndTheStatusItReports() async throws {
        let h = Harness(expand: [37, 41, 235])
        await connect(h)
        await eventually("health ping answered") { h.controller.stack?.healthModel?.pingCode == 0xCA }
        let hl = h.controller.healthLivingStatus()
        XCTAssertEqual(hl["supported"] as? Bool, true)
        XCTAssertEqual(hl["gateSet"] as? Bool, true)
        XCTAssertEqual(hl["registered"] as? Bool, true)
        XCTAssertEqual(hl["pingCode"] as? Int, 0xCA)
        let c = h.controller.coursesStatus()
        XCTAssertEqual(c["gate41"] as? Bool, true)
        XCTAssertEqual(c["gate169"] as? Bool, false)
        XCTAssertEqual(c["gate295"] as? Bool, false)
        XCTAssertEqual(c["p2p"] as? Bool, true)
        // The gates of every dictionary class were recorded, supported or not.
        let rows = try h.sync.read { db in try db.query("SELECT type, supported FROM health_metric_status ORDER BY type") { ($0.text(0)!, $0.int(1)) } }
        XCTAssertEqual(rows.count, 9)
        XCTAssertEqual(rows.first { $0.0 == "hrv" }?.1, 1)
        XCTAssertEqual(rows.first { $0.0 == "blood_pressure" }?.1, 0)
        // The same session announced again keeps the stack; a new one replaces it; the link going away drops it.
        let first = h.controller.stack
        await h.controller.linkConnected(h.link.handleValue)
        XCTAssertTrue(h.controller.stack === first)
        h.controller.linkDisconnected()
        XCTAssertNil(h.controller.stack)
        XCTAssertEqual(h.controller.healthLivingStatus()["registered"] as? Bool, false)
    }

    func testThePetalMapsProbeSwitchIsOffByDefaultAndRegistersAtOnceAndOnConnect() async throws {
        let h = Harness(expand: [235])
        XCTAssertFalse(h.controller.settings.petalMapsProbe)
        await connect(h)
        XCTAssertNil(h.controller.stack?.petalProbe, "off by default: nothing registered")

        await h.controller.setPetalMapsProbe(true)
        XCTAssertTrue(h.controller.settings.petalMapsProbe)
        XCTAssertNotNil(h.controller.stack?.petalProbe)
        await h.controller.setPetalMapsProbe(false)
        XCTAssertNil(h.controller.stack?.petalProbe)

        await h.controller.setPetalMapsProbe(true)
        h.controller.linkDisconnected()
        await h.controller.linkConnected(h.link.handleValue)
        XCTAssertNotNil(h.controller.stack?.petalProbe, "registered on every connect while on")
        await h.controller.setPetalMapsProbe(false)
    }

    func testHealthyLivingAnswersTheWatchAndPushNeedsItsRequest() async throws {
        let h = Harness(expand: [37])
        await connect(h)
        await eventually("health ping answered") { h.controller.stack?.healthModel?.pingCode == 0xCA }
        let early = try await h.controller.pushHealthLiving()
        XCTAssertFalse(early)  // the watch never asked: msgVer unknown

        let body = HealthModelMessages.encodeRequestBody(.init(recordDay: 0, requestTaskIds: "", pageSize: 0, packageSize: 0))
        h.watchSends(2, 77, "com.huawei.health.healthyliving", "hw.unitedevice.healthmodel", data: HealthModelMessages.encodeRequest(msgType: 2001, msgVer: 3.0, body: body))
        await eventually("ack and report") {
            h.p2pWrites.filter { (try? $0.tlv.byte(0x01)) == 3 }.count == 1 && h.p2pWrites.filter { (try? $0.tlv.string(0x04)) == "com.huawei.health.healthyliving" && (try? $0.tlv.byte(0x01)) == 2 }.count == 1
        }
        let report = h.p2pWrites.first { (try? $0.tlv.string(0x04)) == "com.huawei.health.healthyliving" && (try? $0.tlv.byte(0x01)) == 2 }!
        let tasks = try HealthModelMessages.decodeTaskBody(HealthModelMessages.decodeReport(try report.tlv.bytes(0x07)).body)
        // Today (the injected clock) with the default goal, from an empty database.
        XCTAssertEqual(tasks.recordDay, HealthModelData.recordDay(ofMs: 1_791_950_000_000))
        XCTAssertEqual(tasks.tasks.map(\.taskId), [1, 2, 3])
        let hl = h.controller.healthLivingStatus()
        XCTAssertEqual(hl["msgVer"] as? Double, 3.0)
        XCTAssertEqual(hl["lastRequestAt"] as? Int64, 1_791_950_000_000)
        XCTAssertEqual(hl["lastReportAt"] as? Int64, 1_791_950_000_000)
        XCTAssertTrue((hl["lastReport"] as? String)?.hasPrefix("day ") == true)

        let before = h.p2pWrites.count
        let pushed = try await h.controller.pushHealthLiving()
        XCTAssertTrue(pushed)
        await eventually("push report") { h.p2pWrites.count >= before + 2 }

        // Switching off unregisters at once.
        h.controller.setHealthLivingEnabled(false)
        XCTAssertEqual(h.controller.healthLivingStatus()["enabled"] as? Bool, false)
    }

    func testTheMetricsSyncRunsAsASyncExtensionAndStoresTheRows() async throws {
        let h = Harness(expand: [235, 37])
        XCTAssertEqual(h.extensions.count, 1)
        await connect(h)
        h.hrvPages = [Harness.answer(500044, [[1_700_000_000_000, 1_700_000_060_000]], 500044831, 61)]
        try await h.extensions[0](h.link.session)
        let address = h.link.handleValue.address
        let metrics = HealthMetricsStore(store: h.sync, address: { address })
        XCTAssertEqual(metrics.count("hrv"), 1)
        XCTAssertEqual(metrics.lastFetchTimestamp("hrv"), 1_700_000_060_000)
        XCTAssertEqual(try h.sync.read { try $0.query("SELECT device FROM health_metrics") { $0.text(0) } }, [address], "the rows are attributed to the connected watch")
        XCTAssertTrue(h.events.messages().contains { $0.contains("Health metrics: 1 rows stored") })
        // Healthy Living is told afterwards; without a request from the watch it stays quiet.
        XCTAssertTrue(h.events.messages().contains { $0.contains("not pushing (activity sync)") })
    }

    func testTheMetricsSyncWithoutAStackIsSkipped() async throws {
        let h = Harness(expand: [235], listed: false)
        await h.controller.linkConnected(h.link.handleValue)
        try await h.extensions[0](h.link.session)
        XCTAssertTrue(h.events.messages().contains { $0.contains("Health metrics: the P2P service is not available") })
    }

    // MARK: course push

    func testThePushRefusesWhatCannotWork() async throws {
        let h = Harness(expand: [37])
        await connect(h)
        let course = RunningCourse(id: "x", name: "Easy", blocks: [CourseBlock(repeatCount: 1, steps: [CourseStep(kind: .run, target: .time, targetValue: 600)])])
        func code(_ course: RunningCourse) async -> ErrorCode? {
            do {
                _ = try await h.controller.pushCourse(course)
                return nil
            } catch let e as WearError { return e.code } catch { return nil }
        }
        var c = await code(course)
        XCTAssertEqual(c, .unsupported)  // switched off
        h.controller.settings.experimentalCourses = true
        c = await code(RunningCourse(id: "x", name: "", blocks: course.blocks))
        XCTAssertEqual(c, .invalidArgument)
        c = await code(course)
        XCTAssertEqual(c, .unsupported)  // neither ExpandCapability 41 nor 169
        h.link.setConnected(false)
        c = await code(course)
        XCTAssertEqual(c, .notConnected)
    }

    func testACoursePushUploadsTheFileAndReturnsWhatTheWatchSaid() async throws {
        let h = Harness(expand: [41])
        await connect(h)
        h.controller.settings.experimentalCourses = true
        let course = RunningCourse(
            id: "JFTEST", name: "Run",
            blocks: [CourseBlock(repeatCount: 2, steps: [CourseStep(kind: .run, target: .distance, targetValue: 1000, intensity: .pace, low: 300, high: 330)])]
        )
        let result = try await h.controller.pushCourse(course)
        let messageId = result["messageId"] as! Int
        XCTAssertEqual(result["fileName"] as? String, "\(messageId)courseInfo.bin")
        XCTAssertEqual(h.uploadName, "\(messageId)courseInfo.bin")
        let payload = CourseProtobuf.encode(course, updateTimeSec: 1_791_950_000)
        XCTAssertEqual(result["bytes"] as? Int, 36 + payload.count)
        XCTAssertEqual(result["uploadStatus"] as? Int, 1)
        XCTAssertEqual(result["answered"] as? Bool, true)
        XCTAssertEqual(result["answerHex"] as? String, "0A0B")
        // The upload announced the fitness app as the destination and the module as the source.
        let info = h.link.watch.requests.first { $0.key == "28/02" }!
        XCTAssertEqual(try info.tlv.int(0x02), Int32(36 + payload.count))
        XCTAssertEqual(try info.tlv.byte(0x03), 7)
        XCTAssertEqual(try info.tlv.string(0x08), "hw.unitedevice.fitness")
        XCTAssertEqual(try info.tlv.string(0x09), "in.huawei.fitness")
        XCTAssertEqual(try info.tlv.string(0x0b), "UniteDeviceManagement")
        XCTAssertEqual(try info.tlv.string(0x0c), "SystemApp")
        XCTAssertEqual(Set(result.keys), ["messageId", "fileName", "bytes", "uploadStatus", "answered", "answerHex"])
    }

    func testACoursePushWithoutAnAnswerMessageStillReturns() async throws {
        let h = Harness(expand: [169])
        h.courseAnswer = nil
        await connect(h)
        h.controller.settings.experimentalCourses = true
        let course = RunningCourse(id: "JFTEST", name: "Run", blocks: [CourseBlock(repeatCount: 1, steps: [CourseStep(kind: .run, target: .none, targetValue: 0)])])
        let started = Date()
        let result = try await h.controller.pushCourse(course)
        XCTAssertEqual(result["answered"] as? Bool, false)
        XCTAssertTrue(result["answerHex"] is NSNull)
        XCTAssertGreaterThan(Date().timeIntervalSince(started), 0.25)  // it waited for the answer
    }

    // MARK: route push

    private func fixes(_ n: Int, altitude: Bool) -> [RouteFix] {
        (0..<n).map { RouteFix(lat: -7.98 + Double($0) * 0.0004, lon: 112.63 + Double($0) * 0.0002, alt: altitude ? 400 + Double($0) : 0) }
    }

    private func route(_ n: Int = 40, altitude: Bool = true, name: String = "Lari pagi") -> RouteTrack {
        RouteTrack(id: "0b8d4c52-5e0a-4f3e-9d27-000000000001", name: name, fixes: fixes(n, altitude: altitude), hasAltitude: altitude, totalTimeSec: 1800)
    }

    private func routeError(_ h: Harness, _ route: RouteTrack) async -> WearError? {
        do {
            _ = try await h.controller.pushRoute(route)
            return nil
        } catch let e as WearError { return e } catch { return nil }
    }

    func testRoutesStatusReportsTheGates() async {
        let h = Harness(expand: [70, 218])
        let off = h.controller.routesStatus()
        XCTAssertEqual(Set(off.keys), ["p2p", "deliver", "altitude", "image", "sceneTypes", "climb"])
        XCTAssertEqual(off["deliver"] as? Bool, true)  // the harness link is connected from the start
        await connect(h)
        let s = h.controller.routesStatus()
        XCTAssertEqual(s["p2p"] as? Bool, true)
        XCTAssertEqual(s["deliver"] as? Bool, true)
        XCTAssertEqual(s["altitude"] as? Bool, false)
        XCTAssertEqual(s["image"] as? Bool, true)
        XCTAssertEqual(s["sceneTypes"] as? Bool, false)
        XCTAssertEqual(s["climb"] as? Bool, false)
        h.link.setConnected(false)
        XCTAssertEqual(h.controller.routesStatus()["deliver"] as? Bool, false)
    }

    func testARoutePushSendsTheHandshakeThenTheVersionTwoFileWhenTheAltitudeGateIsSet() async throws {
        let h = Harness(expand: [70, 216])
        await connect(h)
        let r = route()
        let result = try await h.controller.pushRoute(r)
        let body = RouteFile.convert(RouteTrack(id: r.id, name: r.name, fixes: r.fixes, hasAltitude: true, totalTimeSec: 1800, version: 2), maxPoints: 200)
        let points = RouteFile.pointCount(file: body, version: 2)
        XCTAssertEqual(result["ok"] as? Bool, true)
        XCTAssertEqual(result["alreadyOnWatch"] as? Bool, false)
        XCTAssertEqual(result["handshakeCode"] as? Int, 1)
        XCTAssertEqual(result["maxPoints"] as? Int, 200)
        XCTAssertEqual(result["version"] as? Int, 2)
        XCTAssertEqual(result["sentPoints"] as? Int, points)
        XCTAssertEqual(result["bytes"] as? Int, 36 + body.count)
        XCTAssertEqual(result["uploadStatus"] as? Int, 1)
        XCTAssertEqual(result["answerCode"] as? Int, 1)
        XCTAssertEqual(Set(result.keys), ["ok", "alreadyOnWatch", "handshakeCode", "maxPoints", "version", "sentPoints", "bytes", "uploadStatus", "answerCode"])
        XCTAssertEqual(h.uploadName, "byte.bin")
        // The handshake is a P2P command from the module to the fitness app: a type 5 message whose body is the route name as TLV tag 5.
        let handshake = try XCTUnwrap(
            h.p2pWrites.first { (try? $0.tlv.byte(0x01)) == 2 && (try? $0.tlv.string(0x04)) == "in.huawei.fitness" }
        )
        let message = try P2PSubMsg(parsing: try handshake.tlv.bytes(0x07))
        XCTAssertEqual(Int(message.type), 5)
        XCTAssertEqual(message.data, RouteFile.handshakeBody(name: "Lari pagi"))
        // The upload announced the fitness app as the destination, like the course push.
        let info = try XCTUnwrap(h.link.watch.requests.first { $0.key == "28/02" })
        XCTAssertEqual(try info.tlv.string(0x01), "byte.bin")
        XCTAssertEqual(try info.tlv.int(0x02), Int32(36 + body.count))
        XCTAssertEqual(try info.tlv.byte(0x03), 7)
        XCTAssertEqual(try info.tlv.string(0x08), "hw.unitedevice.fitness")
        XCTAssertEqual(try info.tlv.string(0x09), "in.huawei.fitness")
        let messages = h.events.messages()
        XCTAssertTrue(messages.contains { $0.hasPrefix("Routes: gates ExpandCapability 70 (deliver)=true 216 (altitude)=true") })
        XCTAssertTrue(messages.contains { $0.contains("Routes: handshake answer body 01000000C8000000 -> code 1, point limit 200") })
        XCTAssertTrue(messages.contains { $0.contains("version 2, byte.bin \(36 + body.count) bytes") })
        XCTAssertTrue(messages.contains { $0.contains("file answer body 01000000 -> code 1") })
    }

    func testWithoutTheAltitudeGateTheFileIsTheVersionOneLine() async throws {
        let h = Harness(expand: [70])
        await connect(h)
        let r = route()
        let result = try await h.controller.pushRoute(r)
        let body = RouteFile.convert(RouteTrack(id: r.id, name: r.name, fixes: r.fixes, hasAltitude: false, totalTimeSec: 1800, version: 1), maxPoints: 200)
        XCTAssertEqual(result["version"] as? Int, 1)
        XCTAssertEqual(result["sentPoints"] as? Int, RouteFile.pointCount(file: body, version: 1))
        XCTAssertEqual(result["bytes"] as? Int, 36 + body.count)
        XCTAssertEqual(result["handshakeCode"] as? Int, 1)
    }

    func testTheWatchesPointLimitBelowTwoHundredIsRaisedAndAHigherOneIsKept() async throws {
        let h = Harness(expand: [70, 216])
        h.routeHandshake = [1, 0, 0, 0, 100, 0, 0, 0]
        await connect(h)
        var result = try await h.controller.pushRoute(route())
        XCTAssertEqual(result["maxPoints"] as? Int, 100)
        XCTAssertTrue(h.events.messages().contains { $0.contains("(limit 200)") })
        h.routeHandshake = [1, 0, 0, 0, 0xF4, 1, 0, 0]
        result = try await h.controller.pushRoute(route())
        XCTAssertEqual(result["maxPoints"] as? Int, 500)
        XCTAssertTrue(h.events.messages().contains { $0.contains("(limit 500)") })
    }

    func testARouteAlreadyOnTheWatchIsNotUploaded() async throws {
        let h = Harness(expand: [70, 216])
        h.routeHandshake = [3, 0, 0, 0]
        await connect(h)
        let result = try await h.controller.pushRoute(route())
        XCTAssertEqual(result["ok"] as? Bool, true)
        XCTAssertEqual(result["alreadyOnWatch"] as? Bool, true)
        XCTAssertEqual(result["handshakeCode"] as? Int, 3)
        XCTAssertTrue(result["maxPoints"] is NSNull)
        XCTAssertEqual(result["version"] as? Int, 0)
        XCTAssertEqual(result["sentPoints"] as? Int, 0)
        XCTAssertEqual(result["bytes"] as? Int, 0)
        XCTAssertTrue(result["uploadStatus"] is NSNull)
        XCTAssertTrue(result["answerCode"] is NSNull)
        XCTAssertEqual(h.uploadName, "")
    }

    func testTheHandshakeAnswersThatRefuseTheRoute() async throws {
        let h = Harness(expand: [70, 216])
        await connect(h)
        h.routeHandshake = [2, 0, 0, 0]
        var e = await routeError(h, route())
        XCTAssertEqual(e?.code, .routeFull)
        XCTAssertEqual(e?.statusCode, 2)
        h.routeHandshake = [5, 0, 0, 0]
        e = await routeError(h, route())
        XCTAssertEqual(e?.code, .routeName)
        XCTAssertEqual(e?.statusCode, 5)
        h.routeHandshake = [4, 0, 0, 0]
        e = await routeError(h, route())
        XCTAssertEqual(e?.code, .uploadRejected)
        XCTAssertEqual(e?.statusCode, 4)
        h.routeHandshake = [1, 0]  // too short to hold a code
        e = await routeError(h, route())
        XCTAssertEqual(e?.code, .uploadRejected)
        XCTAssertNil(e?.statusCode)
        XCTAssertEqual(h.uploadName, "")
    }

    func testAHandshakeTheWatchNeverAnswersTimesOut() async throws {
        let h = Harness(expand: [70, 216])
        h.routeHandshake = nil
        await connect(h)
        let started = Date()
        let e = await routeError(h, route())
        XCTAssertEqual(e?.code, .timeout)
        XCTAssertGreaterThan(Date().timeIntervalSince(started), 0.25)
        XCTAssertEqual(h.uploadName, "")
    }

    func testAHandshakeTheWatchDoesNotAcknowledgeIsRejectedWithItsCode() async throws {
        let h = Harness(expand: [70, 216])
        h.routeAck = 0x12
        await connect(h)
        let e = await routeError(h, route())
        XCTAssertEqual(e?.code, .uploadRejected)
        XCTAssertEqual(e?.statusCode, 0x12)
        XCTAssertEqual(h.uploadName, "")
    }

    func testARefusalOfTheFileIsReportedAndASilentWatchIsNot() async throws {
        let h = Harness(expand: [70, 216])
        await connect(h)
        h.routeFile = [4, 0, 0, 0]
        let e = await routeError(h, route())
        XCTAssertEqual(e?.code, .uploadRejected)
        XCTAssertEqual(e?.statusCode, 4)
        XCTAssertEqual(h.uploadName, "byte.bin")
        // No answer to the file within the wait: the upload itself was accepted, so the result carries no answer code.
        h.routeFile = nil
        let result = try await h.controller.pushRoute(route())
        XCTAssertEqual(result["ok"] as? Bool, true)
        XCTAssertEqual(result["uploadStatus"] as? Int, 1)
        XCTAssertTrue(result["answerCode"] is NSNull)
    }

    func testARoutePushRefusesWhatCannotWork() async throws {
        let h = Harness(expand: [37])
        await connect(h)
        var e = await routeError(h, route(name: " "))
        XCTAssertEqual(e?.code, .invalidArgument)
        e = await routeError(h, route())
        XCTAssertEqual(e?.code, .unsupported)  // ExpandCapability 70 is not set
        XCTAssertTrue(h.events.messages().contains { $0.hasPrefix("Routes: gates ExpandCapability 70 (deliver)=false") })
        h.link.setConnected(false)
        e = await routeError(h, route())
        XCTAssertEqual(e?.code, .notConnected)
    }

    func testARouteIsParsedWithTheAndroidRecordDefaults() throws {
        let raw: [String: Any] = ["name": "  Lari  ", "points": [-7.98, 112.63, 400, -7.97, 112.64, 410.5], "hasAltitude": true, "durationSec": 1800]
        let r = try P2pController.parseRoute(raw)
        XCTAssertEqual(r.name, "Lari")
        XCTAssertEqual(r.fixes, [RouteFix(lat: -7.98, lon: 112.63, alt: 400), RouteFix(lat: -7.97, lon: 112.64, alt: 410.5)])
        XCTAssertTrue(r.hasAltitude)
        XCTAssertEqual(r.totalTimeSec, 1800)
        XCTAssertEqual(r.version, 2)
        XCTAssertEqual(r.id.count, 36)
        XCTAssertEqual(r.id, r.id.lowercased())
        XCTAssertNotEqual(r.id, try P2pController.parseRoute(raw).id)
        // Without hasAltitude the altitude column is dropped, a negative duration is 0, and integers are numbers too.
        let plain = try P2pController.parseRoute(["name": "A", "points": [1, 2, 99], "durationSec": -5])
        XCTAssertEqual(plain.fixes, [RouteFix(lat: 1, lon: 2, alt: 0)])
        XCTAssertFalse(plain.hasAltitude)
        XCTAssertEqual(plain.totalTimeSec, 0)
        XCTAssertEqual(try P2pController.parseRoute([:]).fixes.count, 0)
    }

    func testAMistypedRouteIsAnInvalidArgument() {
        func rejects(_ raw: [String: Any], _ message: String, line: UInt = #line) {
            XCTAssertThrowsError(try P2pController.parseRoute(raw), line: line) {
                XCTAssertEqual(($0 as? WearError)?.code, .invalidArgument, line: line)
                XCTAssertEqual(($0 as? WearError)?.message, message, line: line)
            }
        }
        rejects(["name": 5], "'name' must be text")
        rejects(["points": "1,2,3"], "'points' must be a list of numbers")
        rejects(["points": [1, "2", 3]], "'points' must be a list of numbers")
        rejects(["points": [1, 2]], "A route is a list of latitude, longitude, altitude triples")
        rejects(["hasAltitude": "yes"], "'hasAltitude' must be true or false")
        rejects(["durationSec": 1.5], "'durationSec' must be a whole number")
        rejects(["durationSec": "60"], "'durationSec' must be a whole number")
    }
}

private extension Int64 {
    func clamped(to value: Int64) -> Int64 { Swift.min(self, value) }
}
