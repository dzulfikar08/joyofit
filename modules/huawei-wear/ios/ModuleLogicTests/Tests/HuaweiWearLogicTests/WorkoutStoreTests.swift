import XCTest
@testable import HuaweiWearLogic

/// A watch that answers the 0x17 workout commands for one workout over the real `HuaweiSession` wire format (requests are decrypted with the
/// session's key like the watch does). The GPS file (service 0x2C) is covered by the protocol package's tests; this watch reports no trajectory.
final class ScriptedWorkoutWatch: FrameSink, @unchecked Sendable {
    private let lock = NSLock()
    private var assembler = PacketAssembler()
    private var session: HuaweiSession?
    private var _requests: [(service: UInt8, command: UInt8)] = []
    /// Commands that get no answer.
    var silent: Set<UInt8> = []
    var workouts: [(number: Int16, start: Int32, end: Int32, type: UInt8, hr: [UInt8])] = []

    func attach(_ session: HuaweiSession) { lock.locked { self.session = session } }
    var requests: [(service: UInt8, command: UInt8)] { lock.locked { _requests } }

    func write(_ frames: [Bytes]) async throws {
        for f in frames { handle(f) }
    }

    private func frame(command: UInt8, _ tlv: HuaweiTLV) -> Bytes {
        var buffer = Bytes([huaweiMagic])
        let body = tlv.serialize()
        buffer.appendBE(UInt16(2 + body.count + 1))
        buffer.append(0)
        buffer.append(0x17)
        buffer.append(command)
        buffer += body
        buffer.appendBE(CRC16.checksum(buffer))
        return buffer
    }

    private func handle(_ f: Bytes) {
        guard let session = lock.locked({ self.session }) else { return }
        var local = lock.locked { assembler }
        guard let packet = try? local.feed(f, params: session.params).packet else { return }
        lock.locked { assembler = local }
        guard let tlv = packet.tlv else { return }
        lock.locked { _requests.append((packet.serviceId, packet.commandId)) }
        if packet.serviceId != 0x17 || silent.contains(packet.commandId) { return }
        let c = (try? tlv.object(0x81)) ?? HuaweiTLV()
        func answer(_ t: HuaweiTLV) { session.onData(frame(command: packet.commandId, t)) }
        func box(_ build: (inout HuaweiTLV) -> Void) -> HuaweiTLV {
            var inner = HuaweiTLV()
            build(&inner)
            var out = HuaweiTLV()
            out.put(0x81, tlv: inner)
            return out
        }
        switch packet.commandId {
        case 0x07:
            answer(box { inner in
                inner.put(0x02, short: Int16(workouts.count))
                for w in workouts {
                    var e = HuaweiTLV()
                    e.put(0x06, short: w.number)
                    e.put(0x07, short: 1)
                    e.put(0x08, short: 0)
                    e.put(0x0e, byte: 0)
                    inner.put(0x85, tlv: e)
                }
            })
        case 0x08:
            guard let n = try? c.short(0x02), let w = workouts.first(where: { $0.number == n }) else { return }
            answer(box {
                $0.put(0x02, short: w.number)
                $0.put(0x04, int: w.start)
                $0.put(0x05, int: w.end)
                $0.put(0x06, int: 300)
                $0.put(0x07, int: 4200)
                $0.put(0x08, int: 5000)
                $0.put(0x12, int: w.end - w.start)
                $0.put(0x14, byte: w.type)
            })
        case 0x0a:
            guard let n = try? c.short(0x02), let w = workouts.first(where: { $0.number == n }) else { return }
            var header = Bytes()
            header.appendBE(UInt16(bitPattern: n))
            header.appendBE(UInt16(0))
            header.appendBE(UInt32(bitPattern: w.start))
            header.append(5)
            header.appendBE(UInt16(w.hr.count))
            header.append(1)
            header.appendBE(UInt16(0x0001))
            answer(box {
                $0.put(0x02, short: n)
                $0.put(0x03, short: 0)
                $0.put(0x04, bytes: header)
                $0.put(0x05, bytes: w.hr)
            })
        default:
            return
        }
    }
}

final class WorkoutStoreTests: XCTestCase {
    private let start: Int32 = 1_700_000_000

    private func record(start: Int64 = 1_700_000_000, end: Int64 = 1_700_000_600, complete: Bool = true, points: [WorkoutPoint] = [], steps: Int = 100) -> WorkoutRecord {
        WorkoutRecord(
            number: 5, start: start, end: end, sportType: 1, sportName: "Running", duration: 600, distance: 5000, calories: 321, steps: steps, avgHr: 135, maxHr: nil,
            summaryJson: "{\"kind\":\"RUNNING\"}", points: points, complete: complete
        )
    }

    private func rows<T>(_ store: SyncStore, _ sql: String, _ map: @escaping (SQLiteStatement) -> T) throws -> [T] {
        try store.read { try $0.query(sql, [], map) }
    }

    // MARK: WorkoutStore

    func testSavesTheRowAndItsPointsWithNullsWhereASourceHadNone() throws {
        let store = SyncStore(url: temporaryDatabaseURL())
        let workouts = WorkoutStore(store, address: "AA:AA:AA:AA:AA:01")
        let points = [
            WorkoutPoint(ts: 1_700_000_000, lat: nil, lon: nil, alt: 5.5, hr: 120),
            WorkoutPoint(ts: 1_700_000_010, lat: -6.2, lon: 106.8, alt: nil, hr: nil),
        ]

        XCTAssertTrue(try workouts.save(record(points: points)))

        let row = try rows(store, "SELECT workout_number, start, end, sport_type, sport_name, duration, distance, calories, avg_hr, max_hr, steps, summary_json, complete FROM workouts") {
            [$0.int(0), $0.int(1), $0.int(2), $0.int(3), $0.int(5), $0.int(6), $0.int(7), $0.int(10), $0.int(12)]
        }
        XCTAssertEqual(row, [[5, 1_700_000_000, 1_700_000_600, 1, 600, 5000, 321, 100, 1]])
        let strings = try rows(store, "SELECT sport_name, summary_json, avg_hr, max_hr FROM workouts") { [$0.text(0), $0.text(1), $0.optionalInt(2).map(String.init), $0.optionalInt(3).map(String.init)] }
        XCTAssertEqual(strings.first ?? [], ["Running", "{\"kind\":\"RUNNING\"}", "135", nil])
        let stored = try rows(store, "SELECT ts, lat, lon, alt, hr FROM workout_points ORDER BY ts") { s in
            [s.isNull(1) ? nil : s.double(1), s.isNull(2) ? nil : s.double(2), s.isNull(3) ? nil : s.double(3), s.isNull(4) ? nil : Double(s.int(4))]
        }
        XCTAssertEqual(stored.count, 2)
        XCTAssertEqual(stored[0], [nil, nil, 5.5, 120])
        XCTAssertEqual(stored[1], [-6.2, 106.8, nil, nil])
    }

    func testSavesSpeedCadenceStrideAndPowerOfEachPoint() throws {
        let store = SyncStore(url: temporaryDatabaseURL())
        let workouts = WorkoutStore(store, address: "AA:AA:AA:AA:AA:01")
        let points = [
            WorkoutPoint(ts: 1_700_000_000, lat: nil, lon: nil, alt: nil, hr: 150, speed: 3.1, cadence: 172, stride: 1.05, power: 240),
            WorkoutPoint(ts: 1_700_000_010, lat: -6.2, lon: 106.8, alt: nil, hr: nil),
        ]

        XCTAssertTrue(try workouts.save(record(points: points)))

        let stored = try rows(store, "SELECT speed, cadence, stride, power FROM workout_points ORDER BY ts") { s in
            (0..<4).map { s.isNull(Int32($0)) ? nil : s.double(Int32($0)) } as [Double?]
        }
        XCTAssertEqual(stored, [[3.1, 172, 1.05, 240], [nil, nil, nil, nil]])
    }

    func testSavingAgainReplacesTheWorkoutAndItsPointsKeepingTheId() throws {
        let store = SyncStore(url: temporaryDatabaseURL())
        let workouts = WorkoutStore(store, address: "AA:AA:AA:AA:AA:01")
        XCTAssertTrue(try workouts.save(record(complete: false, points: [WorkoutPoint(ts: 1, lat: nil, lon: nil, alt: nil, hr: 90)])))
        let id = try rows(store, "SELECT id FROM workouts") { $0.int(0) }

        // Incomplete before: finishing it counts as stored.
        XCTAssertTrue(try workouts.save(record(end: 1_700_000_900, complete: true, points: [WorkoutPoint(ts: 2, lat: nil, lon: nil, alt: nil, hr: 95), WorkoutPoint(ts: 3, lat: nil, lon: nil, alt: nil, hr: 96)], steps: 222)))
        // Complete before: not new.
        XCTAssertFalse(try workouts.save(record(end: 1_700_000_900, complete: true, points: [WorkoutPoint(ts: 4, lat: nil, lon: nil, alt: nil, hr: 99)], steps: 333)))

        XCTAssertEqual(try rows(store, "SELECT id FROM workouts") { $0.int(0) }, id)
        XCTAssertEqual(try rows(store, "SELECT end, steps, complete FROM workouts") { [$0.int(0), $0.int(1), $0.int(2)] }, [[1_700_000_900, 333, 1]])
        XCTAssertEqual(try rows(store, "SELECT ts FROM workout_points") { $0.int(0) }, [4])
    }

    func testRevColumnAdvancesOnEveryReplaceForTheCloudCursor() throws {
        let store = SyncStore(url: temporaryDatabaseURL())
        let workouts = WorkoutStore(store, address: "AA:AA:AA:AA:AA:01")
        _ = try workouts.save(record())
        let first = try rows(store, "SELECT rev FROM workouts") { $0.int(0) }[0]
        _ = try workouts.save(record(steps: 7))
        let second = try rows(store, "SELECT rev FROM workouts") { $0.int(0) }[0]
        XCTAssertGreaterThan(second, first)
    }

    // MARK: refetch of running dynamics (mergeSummary, refetchTargets)

    private func addDynamics(_ stored: String) -> SummaryEdit? {
        SummaryEdit(json: stored.replacingOccurrences(of: "}", with: ",\"dynamics\":{\"stepSec\":60}}"), changed: true)
    }

    func testMergeSummaryChangesOnlyTheSummaryAndMovesRevOnlyWhenTheEditChangedSomething() throws {
        let store = SyncStore(url: temporaryDatabaseURL())
        let workouts = WorkoutStore(store, address: "AA:AA:AA:AA:AA:01")
        _ = try workouts.save(record(points: [WorkoutPoint(ts: 1, lat: 1.5, lon: 2.5, alt: nil, hr: 120, cadence: 160)]))
        let columns = "SELECT distance, calories, avg_hr, complete, device FROM workouts"
        func snapshot() throws -> [String] { try rows(store, columns) { "\($0.int(0)),\($0.int(1)),\($0.optionalInt(2) ?? -1),\($0.int(3)),\($0.text(4) ?? "-")" } }
        let others = try snapshot()
        let rev = try rows(store, "SELECT rev FROM workouts") { $0.int(0) }[0]

        XCTAssertEqual(try workouts.mergeSummary(start: 1_700_000_000, addDynamics), .updated)

        XCTAssertEqual(try rows(store, "SELECT summary_json FROM workouts") { $0.text(0) }, ["{\"kind\":\"RUNNING\",\"dynamics\":{\"stepSec\":60}}"])
        XCTAssertGreaterThan(try rows(store, "SELECT rev FROM workouts") { $0.int(0) }[0], rev)
        XCTAssertEqual(try snapshot(), others)
        XCTAssertEqual(try rows(store, "SELECT ts, lat, hr, cadence FROM workout_points") { [Double($0.int(0)), $0.double(1), Double($0.int(2)), Double($0.int(3))] }, [[1, 1.5, 120, 160]])

        let afterRev = try rows(store, "SELECT rev FROM workouts") { $0.int(0) }[0]
        XCTAssertEqual(try workouts.mergeSummary(start: 1_700_000_000, { SummaryEdit(json: $0, changed: false) }), .unchanged)
        XCTAssertEqual(try rows(store, "SELECT rev FROM workouts") { $0.int(0) }[0], afterRev)
    }

    func testMergeSummaryLeavesAnotherWatchsAnImportedAndAnUnknownWorkoutAlone() throws {
        let store = SyncStore(url: temporaryDatabaseURL())
        _ = try WorkoutStore(store, address: "AA:AA:AA:AA:AA:01").save(record())
        let other = WorkoutStore(store, address: "BB:BB:BB:BB:BB:02")

        XCTAssertEqual(try other.mergeSummary(start: 1_700_000_000, addDynamics), .notStored)
        XCTAssertEqual(try WorkoutStore(store, address: "AA:AA:AA:AA:AA:01").mergeSummary(start: 5, addDynamics), .notStored)
        XCTAssertEqual(try WorkoutStore(store, address: "AA:AA:AA:AA:AA:01").mergeSummary(start: 1_700_000_000, { _ in nil }), .notStored)
        try store.read { try $0.run("UPDATE workouts SET imported = 1") }
        XCTAssertEqual(try WorkoutStore(store, address: "AA:AA:AA:AA:AA:01").mergeSummary(start: 1_700_000_000, addDynamics), .notStored)
        XCTAssertEqual(try rows(store, "SELECT summary_json FROM workouts") { $0.text(0) }, ["{\"kind\":\"RUNNING\"}"])
    }

    func testRefetchTargetsAreThisWatchsStoredWorkoutsInTheOrderAsked() throws {
        let store = SyncStore(url: temporaryDatabaseURL())
        let mine = WorkoutStore(store, address: "AA:AA:AA:AA:AA:01")
        _ = try mine.save(record(start: 1_700_000_000, end: 1_700_000_600))
        _ = try mine.save(record(start: 1_800_000_000, end: 1_800_000_600))
        _ = try WorkoutStore(store, address: "BB:BB:BB:BB:BB:02").save(record(start: 1_900_000_000, end: 1_900_000_600))

        let targets = try mine.refetchTargets([1_800_000_000, 1_900_000_000, 7, 1_700_000_000])

        XCTAssertEqual(targets, [RefetchTarget(start: 1_800_000_000, end: 1_800_000_600, number: 5), RefetchTarget(start: 1_700_000_000, end: 1_700_000_600, number: 5)])
    }

    // MARK: what the JS Strava code reads from the rows this store writes

    /// `listAutoUploadCandidates` in src/db/strava.ts, verbatim: the JS app decides on its own what to send after a sync.
    private static let autoUploadCandidates = """
        SELECT w.id AS id, w.start AS start
        FROM workouts w LEFT JOIN strava_upload u ON u.workout_start = w.start
        WHERE w.complete != 0 AND w.imported = 0 AND w."end" > ?
          AND (u.workout_start IS NULL OR u.status = 'processing' OR (u.status = 'failed' AND u.attempts < ?))
        ORDER BY w.start
        """

    func testAWorkoutThisStoreWritesIsAnAutomaticStravaCandidateUntilTheJsAppSettlesItAndAReSyncKeepsThat() throws {
        let store = SyncStore(url: temporaryDatabaseURL())
        let workouts = WorkoutStore(store, address: "AA:AA:AA:AA:AA:01")
        _ = try workouts.save(record(start: 1_700_000_000, end: 1_700_000_600))
        _ = try workouts.save(record(start: 1_700_001_000, end: 1_700_001_600, complete: false))
        func candidates(connectedAt: Int64, maxAttempts: Int64 = 3) throws -> [Int64] {
            try store.read { try $0.query(WorkoutStoreTests.autoUploadCandidates, [.int(connectedAt), .int(maxAttempts)]) { $0.int64(1) } }
        }

        XCTAssertEqual(try rows(store, "SELECT imported FROM workouts ORDER BY start") { $0.int(0) }, [0, 0], "the native writer never marks a row as imported")
        XCTAssertEqual(try candidates(connectedAt: 1_699_999_999), [1_700_000_000], "complete, from the watch, ended after connecting; the incomplete one waits")
        XCTAssertEqual(try candidates(connectedAt: 1_700_000_600), [], "ended before the account connected: only the button sends it")

        // What the JS app records after an attempt (saveStravaUpload), in the same file.
        let upsert = """
            INSERT INTO strava_upload (workout_start, status, upload_id, activity_id, error, attempts, updated_at) VALUES (1700000000, ?, 7, ?, NULL, ?, 1)
            ON CONFLICT(workout_start) DO UPDATE SET status = excluded.status, activity_id = excluded.activity_id, attempts = excluded.attempts
            """
        try store.read { try $0.run(upsert, [.text("failed"), .null, .int(1)]) }
        XCTAssertEqual(try candidates(connectedAt: 1_699_999_999), [1_700_000_000], "a failed upload is retried while it has attempts left")
        XCTAssertEqual(try candidates(connectedAt: 1_699_999_999, maxAttempts: 1), [], "and not after that")
        try store.read { try $0.run(upsert, [.text("done"), .int(8), .int(2)]) }
        XCTAssertEqual(try candidates(connectedAt: 1_699_999_999), [])

        // The watch's next sync sends the same workout again with a later end and other points: the id, the upload record and the "done" stay.
        let id = try rows(store, "SELECT id FROM workouts WHERE start = 1700000000") { $0.int(0) }
        _ = try workouts.save(record(start: 1_700_000_000, end: 1_700_000_700, points: [WorkoutPoint(ts: 1_700_000_005, lat: -6.2, lon: 106.8, alt: nil, hr: nil)]))
        XCTAssertEqual(try rows(store, "SELECT id FROM workouts WHERE start = 1700000000") { $0.int(0) }, id)
        XCTAssertEqual(try rows(store, "SELECT status, activity_id FROM strava_upload") { [$0.text(0), $0.optionalInt(1).map(String.init)] }, [["done", "8"]])
        XCTAssertEqual(try candidates(connectedAt: 1_699_999_999), [])
    }

    func testIsCompleteNeedsStartEndAndTheCompleteFlag() throws {
        let workouts = WorkoutStore(SyncStore(url: temporaryDatabaseURL()), address: "AA:AA:AA:AA:AA:01")
        _ = try workouts.save(record(complete: true))
        _ = try workouts.save(record(start: 5_000, end: 5_600, complete: false))

        XCTAssertTrue(try workouts.isComplete(start: 1_700_000_000, end: 1_700_000_600))
        XCTAssertFalse(try workouts.isComplete(start: 1_700_000_000, end: 1_700_000_601))
        XCTAssertFalse(try workouts.isComplete(start: 5_000, end: 5_600))
        XCTAssertFalse(try workouts.isComplete(start: 9, end: 9))
    }

    func testSyncStartIsTheGbDefaultThenAfterTheNewestWorkoutOrTheOldestIncomplete() throws {
        let workouts = WorkoutStore(SyncStore(url: temporaryDatabaseURL()), address: "AA:AA:AA:AA:AA:01")
        XCTAssertEqual(try workouts.syncStart(), 1_654_819_200)

        _ = try workouts.save(record(start: 1_700_000_000, end: 1_700_000_600))
        XCTAssertEqual(try workouts.syncStart(), 1_700_000_601)

        _ = try workouts.save(record(start: 1_690_000_000, end: 1_690_000_100, complete: false))
        _ = try workouts.save(record(start: 1_695_000_000, end: 1_695_000_100, complete: false))
        XCTAssertEqual(try workouts.syncStart(), 1_690_000_000, "the oldest incomplete workout is asked for again")

        _ = try workouts.save(record(start: 1_800_000_000, end: 1_800_000_100, complete: false))
        _ = try workouts.save(record(start: 1_690_000_000, end: 1_690_000_100, complete: true))
        _ = try workouts.save(record(start: 1_695_000_000, end: 1_695_000_100, complete: true))
        XCTAssertEqual(try workouts.syncStart(), 1_800_000_000, "incomplete again, and it is also the newest")
    }

    func testSyncStartIsClampedToTheWireRange() throws {
        let workouts = WorkoutStore(SyncStore(url: temporaryDatabaseURL()), address: "AA:AA:AA:AA:AA:01")
        _ = try workouts.save(record(start: 5_000_000_000, end: 5_000_000_100))
        XCTAssertEqual(try workouts.syncStart(), Int(Int32.max))
    }

    // MARK: the phase over a scripted watch

    private struct Rig {
        let session: HuaweiSession
        let watch: ScriptedWorkoutWatch
        let events = RecordingEvents()
        let store = SyncStore(url: temporaryDatabaseURL())
        let caps = DeviceCaps()

        init(_ workouts: [(number: Int16, start: Int32, end: Int32, type: UInt8, hr: [UInt8])]) {
            watch = ScriptedWorkoutWatch()
            watch.workouts = workouts
            session = HuaweiSession(sink: watch, log: { _ in })
            session.params.secretKey = Bytes(repeating: 0, count: 16)
            session.params.encryptMethod = 0
            session.params.deviceSupportType = 1
            watch.attach(session)
        }

        func run(nowSec: Int64) async throws -> Int {
            try await WorkoutPhase.run(session: session, caps: caps, syncStore: store, address: "AA:AA:AA:AA:AA:01", events: events, nowSec: nowSec)
        }
    }

    func testPhaseStoresTheWatchsWorkoutsAndReportsTheCount() async throws {
        let rig = Rig([(5, start, start + 600, 1, [120, 0, 150]), (6, start + 7200, start + 7800, 3, [100, 110])])

        let saved = try await rig.run(nowSec: Int64(start) + 10_000)

        XCTAssertEqual(saved, 2)
        let stored = try rows(rig.store, "SELECT workout_number, sport_name, avg_hr, max_hr, distance, complete FROM workouts ORDER BY start") {
            [$0.text(1) ?? "", String($0.int(0)), String($0.int(2)), String($0.int(3)), String($0.int(4)), String($0.int(5))]
        }
        XCTAssertEqual(stored, [["Running", "5", "135", "150", "4200", "1"], ["Biking", "6", "105", "110", "4200", "1"]])
        XCTAssertEqual(try rows(rig.store, "SELECT COUNT(*) FROM workout_points WHERE hr IS NOT NULL") { $0.int(0) }, [4])
        XCTAssertTrue(rig.events.messages(.info).contains("Workout sync: 2 workouts stored"))
    }

    func testTheSummaryCarriesTheWorkoutCountToJs() async throws {
        let rig = Rig([(5, start, start + 600, 1, [120])])
        let saved = try await rig.run(nowSec: Int64(start) + 10_000)
        let summary = SyncSummary(from: 1, to: 2, samples: 3, sleep: 4, totalSteps: 5, totalCalories: 6, totalDistance: 7).withWorkouts(saved)

        XCTAssertEqual(summary.workouts, 1)
        XCTAssertEqual(summary.toJS()["workouts"] as? Int, 1)
    }

    func testASecondPhaseAsksOnlyForWhatCameAfterAndStoresNothingTwice() async throws {
        let rig = Rig([(5, start, start + 600, 1, [120, 130])])
        _ = try await rig.run(nowSec: Int64(start) + 10_000)
        let before = rig.watch.requests.count

        let again = try await rig.run(nowSec: Int64(start) + 20_000)

        XCTAssertEqual(again, 0)
        XCTAssertEqual(try rows(rig.store, "SELECT COUNT(*) FROM workouts") { $0.int(0) }, [1])
        // The count request is repeated (the fake lists the workout again), but it is complete in the database, so neither its totals' data
        // nor its points are asked for a second time.
        let newRequests = rig.watch.requests.dropFirst(before).map { $0.command }
        XCTAssertFalse(newRequests.contains(0x0a))
    }

    func testAWatchThatStopsAnsweringKeepsTheWorkoutIncompleteForTheNextSync() async throws {
        let rig = Rig([(5, start, start + 600, 1, [120, 130])])
        rig.watch.silent = [0x0c, 0x0a]

        // Every request waits 10 s like GB's; shorten the wait on the sync object the phase would use.
        let sync = WorkoutSync(session: rig.session, caps: rig.caps, log: rig.events.sink)
        sync.requestTimeoutMs = 100
        let sink = WorkoutStore(rig.store, address: "AA:AA:AA:AA:AA:01")
        do {
            try await sync.sync(startSec: Int(start) - 10, endSec: Int(start) + 10_000, sink: sink)
            XCTFail("expected a timeout")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .timeout)
        }

        XCTAssertEqual(try rows(rig.store, "SELECT complete FROM workouts") { $0.int(0) }, [0])
        XCTAssertEqual(try sink.syncStart(), Int(start), "the incomplete workout's start beats the end of the newest one")
    }

    func testALostLinkIsLoggedAndDoesNotFailTheSyncThatAlreadyStoredItsData() async throws {
        let rig = Rig([(5, start, start + 600, 1, [120])])
        await rig.session.close(WearError(.disconnected, "link closed"))

        let saved = try await rig.run(nowSec: Int64(start) + 10_000)

        XCTAssertEqual(saved, 0)
        XCTAssertTrue(rig.events.messages(.error).contains { $0.hasPrefix("Workout sync failed:") && $0.contains("link closed") })
        XCTAssertTrue(rig.events.messages(.info).contains("Workout sync: 0 workouts stored"))
    }

    func testBandWorkoutWithNoGpsMergesPhoneConnectedGpsTrackAndSkipsIndoorSport() throws {
        let store = SyncStore(url: temporaryDatabaseURL())
        let gpsStore = ConnectedGpsStore()
        let fixes = [
            WorkoutLinkWire.Fix(timeMs: 1_700_000_010_000, latitude: -6.2000, longitude: 106.8000, altitude: 15.0, accuracy: 5.0, speed: 3.0, bearing: nil),
            WorkoutLinkWire.Fix(timeMs: 1_700_000_020_000, latitude: -6.2005, longitude: 106.8005, altitude: 19.0, accuracy: 5.0, speed: 3.2, bearing: nil),
            WorkoutLinkWire.Fix(timeMs: 1_700_000_030_000, latitude: -6.2010, longitude: 106.8010, altitude: 22.0, accuracy: 5.0, speed: 3.1, bearing: nil),
        ]
        gpsStore.upsert(
            ConnectedGpsSession(
                id: "band-run-1",
                startSec: 1_700_000_000,
                endSec: 1_700_000_600,
                sportType: 1,
                distanceM: 157.0,
                riseM: 7.0,
                points: fixes
            )
        )

        let sink = WorkoutStore(store, address: "AA:BB:CC:DD:EE:01", gpsStore: gpsStore)
        // Huawei Band outdoor run (sportType 1) with no watch GPS points and 0 watch distance
        let bandRun = WorkoutRecord(
            number: 11,
            start: 1_700_000_000,
            end: 1_700_000_600,
            sportType: 1,
            sportName: "Running",
            duration: 600,
            distance: 0,
            calories: 85,
            steps: 900,
            avgHr: 142,
            maxHr: 165,
            summaryJson: #"{"kind":"RUNNING","gps":"none","gpsPoints":0}"#,
            points: [WorkoutPoint(ts: 1_700_000_015, lat: nil, lon: nil, alt: nil, hr: 142)],
            complete: true
        )
        XCTAssertTrue(try sink.save(bandRun))

        let gpsPointsCount = try rows(store, "SELECT COUNT(*) FROM workout_points WHERE lat IS NOT NULL AND lon IS NOT NULL") { $0.int(0) }.first
        XCTAssertEqual(gpsPointsCount, 3)
        let summaryStr = try rows(store, "SELECT summary_json FROM workouts WHERE start = 1700000000") { $0.text(0) ?? "" }.first ?? ""
        XCTAssertTrue(summaryStr.contains(#""gps":"ok""#))
        XCTAssertTrue(summaryStr.contains(#""gpsSource":"phone""#))
        XCTAssertTrue(summaryStr.contains(#""gpsPoints":3"#))
        let savedDist = try rows(store, "SELECT distance FROM workouts WHERE start = 1700000000") { $0.int(0) }.first ?? 0
        XCTAssertGreaterThan(savedDist, 100)

        // Indoor running (sportType 5) at an overlapping window must NOT get GPS points attached
        gpsStore.upsert(
            ConnectedGpsSession(
                id: "indoor-1",
                startSec: 1_700_010_000,
                endSec: 1_700_010_600,
                sportType: nil,
                distanceM: 200.0,
                riseM: 0.0,
                points: [
                    WorkoutLinkWire.Fix(timeMs: 1_700_010_010_000, latitude: -6.2, longitude: 106.8, altitude: nil, accuracy: 5.0, speed: 3.0, bearing: nil),
                    WorkoutLinkWire.Fix(timeMs: 1_700_010_020_000, latitude: -6.201, longitude: 106.801, altitude: nil, accuracy: 5.0, speed: 3.0, bearing: nil),
                ]
            )
        )
        let indoorRun = WorkoutRecord(
            number: 12,
            start: 1_700_010_000,
            end: 1_700_010_600,
            sportType: 5,
            sportName: "Indoor Running",
            duration: 600,
            distance: 1000,
            calories: 90,
            steps: 1000,
            avgHr: 140,
            maxHr: 160,
            summaryJson: #"{"kind":"INDOOR_RUNNING","gps":"none","gpsPoints":0}"#,
            points: [],
            complete: true
        )
        XCTAssertTrue(try sink.save(indoorRun))
        let indoorId = try rows(store, "SELECT id FROM workouts WHERE start = 1700010000") { $0.int64(0) }.first!
        let indoorGpsCount = try rows(store, "SELECT COUNT(*) FROM workout_points WHERE workout_id = \(indoorId) AND lat IS NOT NULL") { $0.int(0) }.first
        XCTAssertEqual(indoorGpsCount, 0)
    }

    func testBandWorkoutWithZeroEndMergesTrackAndBackfillsWithCaseInsensitiveDevice() throws {
        let store = SyncStore(url: temporaryDatabaseURL())
        let gpsStore = ConnectedGpsStore()
        let fixes = [
            WorkoutLinkWire.Fix(timeMs: 1_700_000_010_000, latitude: -6.2000, longitude: 106.8000, altitude: 15.0, accuracy: 5.0, speed: 3.0, bearing: nil),
            WorkoutLinkWire.Fix(timeMs: 1_700_000_030_000, latitude: -6.2010, longitude: 106.8010, altitude: 22.0, accuracy: 5.0, speed: 3.1, bearing: nil),
        ]
        let session = ConnectedGpsSession(
            id: "band-zero-end",
            startSec: 1_700_000_000,
            endSec: 1_700_000_600,
            sportType: 1,
            distanceM: 157.0,
            riseM: 7.0,
            points: fixes
        )
        gpsStore.upsert(session)

        // fixesInWindow handles workoutEndSec <= workoutStartSec gracefully
        XCTAssertEqual(session.fixesInWindow(workoutStartSec: 1_700_000_000, workoutEndSec: 0).count, 2)
        XCTAssertEqual(session.fixesInWindow(workoutStartSec: 1_700_000_000, workoutEndSec: 1_700_000_000).count, 2)

        let bandRunZeroEnd = WorkoutRecord(
            number: 21,
            start: 1_700_000_000,
            end: 0,
            sportType: 1,
            sportName: "Running",
            duration: 600,
            distance: 0,
            calories: 85,
            steps: 900,
            avgHr: 142,
            maxHr: 165,
            summaryJson: #"{"kind":"RUNNING","gps":"none","gpsPoints":0}"#,
            points: [],
            complete: true
        )
        let merged = ConnectedGpsMerger.merge(bandRunZeroEnd, store: gpsStore)
        XCTAssertEqual(merged.end, 1_700_000_600)
        XCTAssertEqual(merged.points.count, 2)

        // Backfill with uppercase address in DB vs lowercase address parameter and end == 0
        let sinkUpper = WorkoutStore(store, address: "AA:BB:CC:DD:EE:01", gpsStore: ConnectedGpsStore())
        let unmergedRecord = WorkoutRecord(
            number: 22,
            start: 1_700_020_000,
            end: 0,
            sportType: 2,
            sportName: "Walking",
            duration: 600,
            distance: 0,
            calories: 50,
            steps: 800,
            avgHr: 115,
            maxHr: 130,
            summaryJson: #"{"kind":"WALKING","gps":"none","gpsPoints":0}"#,
            points: [],
            complete: true
        )
        XCTAssertTrue(try sinkUpper.save(unmergedRecord))

        let backfillSession = ConnectedGpsSession(
            id: "backfill-zero-end",
            startSec: 1_700_020_000,
            endSec: 1_700_020_600,
            sportType: 2,
            distanceM: 140.0,
            riseM: 3.0,
            points: [
                WorkoutLinkWire.Fix(timeMs: 1_700_020_010_000, latitude: -6.3000, longitude: 106.9000, altitude: 10.0, accuracy: 5.0, speed: 1.4, bearing: nil),
                WorkoutLinkWire.Fix(timeMs: 1_700_020_040_000, latitude: -6.3010, longitude: 106.9010, altitude: 12.0, accuracy: 5.0, speed: 1.4, bearing: nil),
            ]
        )
        let sinkLower = WorkoutStore(store, address: "aa:bb:cc:dd:ee:01", gpsStore: ConnectedGpsStore())
        let updatedCount = try sinkLower.backfillConnectedGps(backfillSession)
        XCTAssertEqual(updatedCount, 1)

        let pointsCount = try rows(store, "SELECT COUNT(*) FROM workout_points p JOIN workouts w ON w.id = p.workout_id WHERE w.start = 1700020000 AND p.lat IS NOT NULL") { $0.int(0) }.first
        XCTAssertEqual(pointsCount, 2)
        let updatedEnd = try rows(store, "SELECT end FROM workouts WHERE start = 1700020000") { $0.int64(0) }.first
        XCTAssertEqual(updatedEnd, 1_700_020_600)
    }

    func testMergedRoutesOnlyIncludeFixesInsideWindowWithoutClamping() throws {
        let store = SyncStore(url: temporaryDatabaseURL())
        let gpsStore = ConnectedGpsStore()
        let startSec: Int64 = 1_700_030_000
        let endSec: Int64 = 1_700_030_600
        // Fixes at start - 150s, start + 10s, start + 20s, end + 150s
        let fixes = [
            WorkoutLinkWire.Fix(timeMs: (startSec - 150) * 1000, latitude: -6.1000, longitude: 106.7000, altitude: 10.0, accuracy: 5.0, speed: 3.0, bearing: nil),
            WorkoutLinkWire.Fix(timeMs: (startSec + 10) * 1000, latitude: -6.1005, longitude: 106.7005, altitude: 10.0, accuracy: 5.0, speed: 3.0, bearing: nil),
            WorkoutLinkWire.Fix(timeMs: (startSec + 20) * 1000, latitude: -6.1010, longitude: 106.7010, altitude: 10.0, accuracy: 5.0, speed: 3.0, bearing: nil),
            WorkoutLinkWire.Fix(timeMs: (endSec + 150) * 1000, latitude: -6.1020, longitude: 106.7020, altitude: 10.0, accuracy: 5.0, speed: 3.0, bearing: nil),
        ]
        let session = ConnectedGpsSession(
            id: "slack-window-test",
            startSec: startSec - 150,
            endSec: endSec + 150,
            sportType: 1,
            distanceM: 500.0,
            riseM: 0.0,
            points: fixes
        )
        gpsStore.upsert(session)

        let bandRun = WorkoutRecord(
            number: 31,
            start: startSec,
            end: endSec,
            sportType: 1,
            sportName: "Running",
            duration: 600,
            distance: 0,
            calories: 80,
            steps: 900,
            avgHr: 140,
            maxHr: 160,
            summaryJson: "{}",
            points: [],
            complete: true
        )
        let merged = ConnectedGpsMerger.merge(bandRun, store: gpsStore)
        // Should only include the two points inside [startSec, endSec]
        XCTAssertEqual(merged.points.count, 2)
        XCTAssertEqual(merged.points[0].ts, startSec + 10)
        XCTAssertEqual(merged.points[1].ts, startSec + 20)
        // No two points share a clamped timestamp
        let timestamps = merged.points.map { $0.ts }
        XCTAssertEqual(Set(timestamps).count, timestamps.count)
    }

    func testRealWatchGpsWinsOverBandWithPhoneGpsWhicheverOrderArrives() throws {
        let store = SyncStore(url: temporaryDatabaseURL())
        let gpsStore = ConnectedGpsStore()
        let primaryBandAddress = "AA:BB:CC:DD:EE:01"
        let gpsWatchAddress = "FF:EE:DD:CC:BB:02"

        try store.read { db in
            try db.run("INSERT INTO device (address, name, is_primary) VALUES (?, 'Primary Band', 1)", [.text(primaryBandAddress)])
            try db.run("INSERT INTO device (address, name, is_primary) VALUES (?, 'GPS Watch', 0)", [.text(gpsWatchAddress)])
        }

        let startSec: Int64 = 1_700_050_000
        let endSec: Int64 = 1_700_050_600
        let phoneFixes = [
            WorkoutLinkWire.Fix(timeMs: (startSec + 10) * 1000, latitude: -6.2000, longitude: 106.8000, altitude: 10.0, accuracy: 5.0, speed: 3.0, bearing: nil),
            WorkoutLinkWire.Fix(timeMs: (startSec + 30) * 1000, latitude: -6.2005, longitude: 106.8005, altitude: 10.0, accuracy: 5.0, speed: 3.0, bearing: nil),
        ]
        gpsStore.upsert(ConnectedGpsSession(id: "band-run", startSec: startSec, endSec: endSec, sportType: 1, distanceM: 200.0, riseM: 0.0, points: phoneFixes))

        let bandSink = WorkoutStore(store, address: primaryBandAddress, gpsStore: gpsStore)
        let watchSink = WorkoutStore(store, address: gpsWatchAddress, gpsStore: gpsStore)

        let bandRecord = WorkoutRecord(
            number: 41,
            start: startSec,
            end: endSec,
            sportType: 1,
            sportName: "Running",
            duration: 600,
            distance: 0,
            calories: 75,
            steps: 850,
            avgHr: 135,
            maxHr: 155,
            summaryJson: "{}",
            points: [],
            complete: true
        )

        let watchGpsRecord = WorkoutRecord(
            number: 42,
            start: startSec + 5,
            end: endSec - 5,
            sportType: 1,
            sportName: "Running",
            duration: 590,
            distance: 1200,
            calories: 80,
            steps: 860,
            avgHr: 138,
            maxHr: 158,
            summaryJson: "{}",
            points: [
                WorkoutPoint(ts: startSec + 10, lat: -6.2000, lon: 106.8000, alt: 10.0, hr: 135),
                WorkoutPoint(ts: startSec + 30, lat: -6.2005, lon: 106.8005, alt: 10.0, hr: 140),
            ],
            complete: true
        )

        // Band arrives first, gets merged with phone track and phone_gps = 1
        XCTAssertTrue(try bandSink.save(bandRecord))
        let phoneGpsFlag = try rows(store, "SELECT phone_gps FROM workouts WHERE device = ?", [.text(primaryBandAddress)]) { $0.int(0) }.first
        XCTAssertEqual(phoneGpsFlag, 1)

        // Then real GPS watch arrives: since band's points are phone GPS, watch's built-in GPS wins!
        XCTAssertTrue(try watchSink.save(watchGpsRecord))
        let winningDevice = try rows(store, "SELECT device FROM workouts WHERE start >= ? AND start <= ?", [.int(startSec - 10), [.int(startSec + 10)]]) { $0.text(0) }.first
        XCTAssertEqual(winningDevice, gpsWatchAddress)
    }
}
