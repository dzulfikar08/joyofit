import XCTest
@testable import HuaweiWearLogic

final class SyncStoreTests: XCTestCase {
    private func store() -> (SyncStore, URL) {
        let url = temporaryDatabaseURL()
        return (SyncStore(url: url), url)
    }

    private func sample(_ ts: Int64, steps: Int = 1, hr: Int? = nil) -> StepSample {
        StepSample(timestamp: ts, steps: steps, calories: 2, distance: 3, heartRate: hr, spo2: nil, restingHeartRate: nil)
    }

    private func result(from: Int64 = 100, to: Int64 = 1_000, samples: [StepSample] = [], sleep: [SleepSegment] = [], scores: [SleepScore] = []) -> SyncResult {
        SyncResult(from: from, to: to, samples: samples, sleep: sleep, totalSteps: 10, totalCalories: 20, totalDistance: 30, sleepScores: scores)
    }

    // BackgroundPlanningTest.kt

    func testBackoffDoublesUpToFiveMinutes() {
        var backoff = BackgroundController.initialBackoffMs
        var seen = [Int]()
        for _ in 0..<8 {
            seen.append(backoff)
            backoff = nextBackoff(currentMs: backoff)
        }
        XCTAssertEqual(seen, [5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000])
    }

    func testFirstSyncAsksForFullHistory() {
        XCTAssertEqual(syncWindowStart(lastSyncSec: nil), 0)
    }

    func testLaterSyncsOverlapByOneHour() {
        XCTAssertEqual(syncWindowStart(lastSyncSec: 500_000), 500_000 - 3600)
        XCTAssertEqual(syncWindowStart(lastSyncSec: 100), 0)
    }

    func testMigrationsCreateTheSharedSchema() throws {
        let (store, url) = store()
        let user = try store.read { db in try db.userVersion }
        XCTAssertEqual(user, try SyncStore.sharedMigrations().count)
        XCTAssertEqual(user, 14)
        let tables: [String] = try store.read { db in
            try db.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name") { $0.text(0)! }
        }
        for expected in ["step_samples", "sleep_segments", "sleep_scores", "device", "workouts", "workout_points", "cloud_cursor", "hrv_readings", "rri_samples", "diet_day", "cycle_periods", "strava_upload", "cloud_workout"] {
            XCTAssertTrue(tables.contains(expected), "missing table \(expected)")
        }
        // Migration 10: rows the Huawei export importer writes (Android) are marked; the native writer's rows never are.
        for table in ["step_samples", "sleep_segments", "workouts"] {
            let columns: [String] = try store.read { db in try db.query("PRAGMA table_info(\(table))") { $0.text(1)! } }
            XCTAssertTrue(columns.contains("imported"), "\(table) has no imported column")
        }
        // Migration 11: what the Strava upload of the JS app records per workout.
        let strava: [String] = try store.read { db in try db.query("PRAGMA table_info(strava_upload)") { $0.text(1)! } }
        XCTAssertEqual(strava, ["workout_start", "status", "upload_id", "activity_id", "error", "attempts", "updated_at"])
        // Migration 12: per-sample motion fields of a workout point.
        let points: [String] = try store.read { db in try db.query("PRAGMA table_info(workout_points)") { $0.text(1)! } }
        for column in ["speed", "cadence", "stride", "power"] {
            XCTAssertTrue(points.contains(column), "workout_points has no \(column) column")
        }
        // Migration 13: what the JS app recorded per workout it uploaded to or restored from JoyoRogo.
        let cloudWorkout: [String] = try store.read { db in try db.query("PRAGMA table_info(cloud_workout)") { $0.text(1)! } }
        XCTAssertEqual(cloudWorkout, ["start", "rev", "engine_rev", "version", "hash", "bytes", "uploaded_at"])
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
        // WAL, as JS sets it.
        let mode: String = try store.read { db in try db.query("PRAGMA journal_mode") { $0.text(0)! }.first! }
        XCTAssertEqual(mode, "wal")
    }

    /// The migrations compiled into WearMigrations.swift must be the shared JSON JS and Android read. Regenerate with
    /// `node modules/huawei-wear/ios/scripts/gen-migrations.mjs` when this fails.
    func testEmbeddedMigrationsAreTheSharedJson() throws {
        let url = repoRoot.appendingPathComponent("modules/huawei-wear/schema/joyofit-db-migrations.json")
        let shared = try SyncStore.parseMigrations(String(contentsOf: url, encoding: .utf8))
        XCTAssertEqual(try SyncStore.sharedMigrations(), shared, "WearMigrations.swift is stale: run node modules/huawei-wear/ios/scripts/gen-migrations.mjs")
    }

    func testAnOpenDatabaseWithJsMigrationsAlreadyAppliedIsLeftAlone() throws {
        let url = temporaryDatabaseURL()
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        // What JS does first: apply every migration and set user_version.
        let js = try SQLiteDatabase(path: url.path)
        for (i, statements) in try SyncStore.sharedMigrations().enumerated() {
            for s in statements { try js.exec(s) }
            try js.setUserVersion(i + 1)
        }
        try js.run("INSERT INTO device (address, name, last_sync) VALUES ('X', 'watch', 42)")
        let native = SyncStore(url: url)
        XCTAssertEqual(try native.lastSync(address: "X"), 42)
        XCTAssertEqual(try native.read { try $0.userVersion }, try SyncStore.sharedMigrations().count)
    }

    func testAPartiallyMigratedDatabaseIsBroughtForward() throws {
        let url = temporaryDatabaseURL()
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let first = try SQLiteDatabase(path: url.path)
        for s in try SyncStore.sharedMigrations()[0] { try first.exec(s) }
        try first.setUserVersion(1)
        let native = SyncStore(url: url)
        XCTAssertEqual(try native.read { try $0.userVersion }, try SyncStore.sharedMigrations().count)
        XCTAssertTrue(try native.read { try $0.query("PRAGMA table_info(sleep_segments)") { $0.text(1)! } }.contains("stage"))
    }

    /// TestFlight build 202610160151 shipped nine migrations. An iPhone with that database (and a workout the watch synced) must come out with
    /// migrations 10 and 11 applied and the workout still counted as a watch row.
    func testTheDatabaseOfTheLastTestFlightBuildIsUpgradedForStrava() throws {
        let url = temporaryDatabaseURL()
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let old = try SQLiteDatabase(path: url.path)
        let shared = try SyncStore.sharedMigrations()
        for (i, statements) in shared.prefix(9).enumerated() {
            for s in statements { try old.exec(s) }
            try old.setUserVersion(i + 1)
        }
        try old.run("""
            INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, avg_hr, max_hr, steps, summary_json, complete)
            VALUES (1, 1700000000, 1700000600, 1, 'Running', 600, 5000, 321, 135, NULL, 100, '{}', 1)
            """)

        let native = SyncStore(url: url)
        XCTAssertEqual(try native.read { try $0.userVersion }, shared.count)
        let imported: [Int] = try native.read { try $0.query("SELECT imported FROM workouts") { $0.int(0) } }
        XCTAssertEqual(imported, [0])
        XCTAssertTrue(try native.read { try $0.tableExists("strava_upload") })
    }

    /// Migration 12 only adds nullable columns to `workout_points`: a database that has the workout tables (migration 3) with stored points comes
    /// out at the latest version with every old row untouched and the new columns NULL.
    func testPerSamplePointColumnsAreAddedWithoutTouchingStoredPoints() throws {
        let url = temporaryDatabaseURL()
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let old = try SQLiteDatabase(path: url.path)
        let shared = try SyncStore.sharedMigrations()
        for (i, statements) in shared.prefix(3).enumerated() {
            for s in statements { try old.exec(s) }
            try old.setUserVersion(i + 1)
        }
        try old.run("""
            INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, avg_hr, max_hr, steps, summary_json, complete)
            VALUES (1, 1700000000, 1700000600, 1, 'Running', 600, 5000, 321, 135, 170, 100, '{}', 1)
            """)
        try old.run("INSERT INTO workout_points (workout_id, ts, lat, lon, alt, hr) VALUES (1, 1700000001, -6.2, 106.8, 12.5, 140), (1, 1700000002, NULL, NULL, NULL, 142)")

        let native = SyncStore(url: url)
        XCTAssertEqual(try native.read { try $0.userVersion }, shared.count)
        let columns: [String] = try native.read { try $0.query("PRAGMA table_info(workout_points)") { $0.text(1)! } }
        XCTAssertEqual(columns, ["workout_id", "ts", "lat", "lon", "alt", "hr", "speed", "cadence", "stride", "power"])
        let rows: [[Double?]] = try native.read {
            try $0.query("SELECT ts, lat, lon, alt, hr, speed, cadence, stride, power FROM workout_points ORDER BY ts") { s in
                (0..<9).map { s.isNull(Int32($0)) ? nil : s.double(Int32($0)) }
            }
        }
        XCTAssertEqual(rows, [
            [1_700_000_001, -6.2, 106.8, 12.5, 140, nil, nil, nil, nil],
            [1_700_000_002, nil, nil, nil, 142, nil, nil, nil, nil],
        ])
        XCTAssertEqual(try native.read { try $0.query("SELECT COUNT(*) FROM workouts") { $0.int(0) } }, [1])
    }

    func testADatabaseNewerThanTheAppIsRefused() throws {
        let url = temporaryDatabaseURL()
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let db = try SQLiteDatabase(path: url.path)
        try db.setUserVersion(99)
        XCTAssertThrowsError(try SyncStore(url: url).lastSync(address: "X")) { error in
            XCTAssertTrue("\(error)".contains("newer than this app supports"), "\(error)")
        }
    }

    func testUpsertDeviceKeepsLastSync() throws {
        let (store, _) = store()
        try store.upsertDevice(address: "A", name: "Watch", productModel: "P1", softwareVersion: "1")
        XCTAssertNil(try store.lastSync(address: "A"))
        _ = try store.save(address: "A", result: result(to: 5_000))
        XCTAssertEqual(try store.lastSync(address: "A"), 5_000)
        try store.upsertDevice(address: "A", name: "Renamed", productModel: nil, softwareVersion: "2")
        XCTAssertEqual(try store.lastSync(address: "A"), 5_000)
        let row: [String?] = try store.read { db in
            try db.query("SELECT name, product_model, software_version FROM device WHERE address = 'A'") { [$0.text(0), $0.text(1), $0.text(2)] }.first!
        }
        XCTAssertEqual(row, ["Renamed", nil, "2"])
    }

    func testSaveWritesRowsAndIsIdempotent() throws {
        let (store, _) = store()
        try store.upsertDevice(address: "A", name: "Watch", productModel: nil, softwareVersion: nil)
        let r = result(
            samples: [sample(60, steps: 5, hr: 70), sample(120, steps: 7)],
            sleep: [SleepSegment(start: 0, end: 600, type: 6, stage: "light"), SleepSegment(start: 600, end: 900, type: 1, stage: nil)],
            scores: [SleepScore(start: 0, end: 900, score: 80, efficiency: 90), SleepScore(start: 5_000, end: 6_000, score: 70, efficiency: nil)]
        )
        let summary = try store.save(address: "A", result: r)
        XCTAssertEqual(summary, SyncSummary(from: 100, to: 1_000, samples: 2, sleep: 2, totalSteps: 10, totalCalories: 20, totalDistance: 30))
        _ = try store.save(address: "A", result: r)
        let counts: [Int] = try store.read { db in
            try ["step_samples", "sleep_segments", "sleep_scores"].map { try db.query("SELECT COUNT(*) FROM \($0)") { $0.int(0) }.first! }
        }
        XCTAssertEqual(counts, [2, 2, 2], "a second save of the same window does not add rows")
    }

    func testSaveReplacesChangedValuesOfTheSameKey() throws {
        let (store, _) = store()
        try store.upsertDevice(address: "A", name: "Watch", productModel: nil, softwareVersion: nil)
        _ = try store.save(
            address: "A",
            result: result(
                samples: [sample(60, steps: 5, hr: 70)], sleep: [SleepSegment(start: 0, end: 600, type: 6, stage: "light")],
                scores: [SleepScore(start: 0, end: 900, score: 80, efficiency: 90)]
            )
        )
        _ = try store.save(
            address: "A",
            result: result(
                samples: [StepSample(timestamp: 60, steps: 9, calories: 1, distance: 1, heartRate: nil, spo2: 98, restingHeartRate: 55)],
                sleep: [SleepSegment(start: 0, end: 700, type: 6, stage: "deep")], scores: [SleepScore(start: 0, end: 950, score: 85, efficiency: nil)]
            )
        )
        let sampleRow: [Int?] = try store.read { db in
            try db.query("SELECT steps, calories, distance, heart_rate, spo2, resting_heart_rate FROM step_samples") { s in (0..<6).map { s.optionalInt(Int32($0)) } }.first!
        }
        XCTAssertEqual(sampleRow, [9, 1, 1, nil, 98, 55])
        let segment: [String?] = try store.read { db in try db.query("SELECT end, stage FROM sleep_segments") { [String($0.int(0)), $0.text(1)] }.first! }
        XCTAssertEqual(segment, ["700", "deep"])
        let score: [Int?] = try store.read { db in try db.query("SELECT end, score, efficiency FROM sleep_scores") { s in (0..<3).map { s.optionalInt(Int32($0)) } }.first! }
        XCTAssertEqual(score, [950, 85, nil])
    }

    func testSaveIsOneTransaction() throws {
        let (store, _) = store()
        try store.upsertDevice(address: "A", name: "Watch", productModel: nil, softwareVersion: nil)
        _ = try store.save(address: "A", result: result(samples: [sample(60)]))
        // A sample with a NULL-able column cannot fail; force a failure with a constraint instead: the device row for another address does not
        // change last_sync, and a thrown error mid-save leaves nothing behind. Use a duplicated explicit transaction to prove ROLLBACK works.
        XCTAssertThrowsError(
            try store.read { db in
                try db.transaction {
                    try db.run("INSERT INTO step_samples (timestamp, steps, calories, distance) VALUES (999, 1, 1, 1)")
                    try db.run("INSERT INTO no_such_table VALUES (1)")
                }
            }
        )
        let rows: Int = try store.read { db in try db.query("SELECT COUNT(*) FROM step_samples") { $0.int(0) }.first! }
        XCTAssertEqual(rows, 1)
    }

    func testSyncSummaryToJSMatchesTheTypeScriptShape() {
        let js = SyncSummary(from: 1, to: 2, samples: 3, sleep: 4, totalSteps: 5, totalCalories: 6, totalDistance: 7, workouts: 8).toJS()
        XCTAssertEqual(Set(js.keys), ["from", "to", "samples", "sleep", "workouts", "totals"])
        let totals = js["totals"] as! [String: Any]
        XCTAssertEqual(Set(totals.keys), ["steps", "calories", "distance"])
        XCTAssertEqual(totals["calories"] as? Int, 6)
        XCTAssertEqual(SyncSummary(from: 1, to: 2, samples: 3, sleep: 4, totalSteps: 5, totalCalories: 6, totalDistance: 7).withWorkouts(2).workouts, 2)
    }

    // releaseDatabase / resumeDatabase: the repair of a damaged file replaces it and the native connection must not be open meanwhile.

    func testReleaseClosesTheConnectionAndResumeOpensItAgainOnTheSameData() throws {
        let (store, _) = store()
        try store.upsertDevice(address: "AA:AA:AA:AA:AA:01", name: "Band", productModel: nil, softwareVersion: nil)
        store.release()
        XCTAssertThrowsError(try store.read { db in try db.userVersion }, "a released store opens nothing")
        XCTAssertThrowsError(try store.lastSync(address: "AA:AA:AA:AA:AA:01"))
        store.resume()
        let addresses: [String] = try store.read { db in try db.query("SELECT address FROM device") { $0.text(0)! } }
        XCTAssertEqual(addresses, ["AA:AA:AA:AA:AA:01"])
    }

    func testAFileReplacedWhileReleasedIsTheOneThatOpensAfterResume() throws {
        let (store, url) = store()
        try store.upsertDevice(address: "AA:AA:AA:AA:AA:01", name: "Band", productModel: nil, softwareVersion: nil)
        store.release()
        for suffix in ["", "-wal", "-shm"] { try? FileManager.default.removeItem(atPath: url.path + suffix) }
        store.resume()
        let devices: Int = try store.read { db in try db.query("SELECT COUNT(*) FROM device") { $0.int(0) }.first! }
        XCTAssertEqual(devices, 0, "the connection was reopened on the new file, not kept on the old one")
        XCTAssertEqual(try store.read { db in try db.userVersion }, try SyncStore.sharedMigrations().count)
    }

    func testReleaseWaitsForAnAccessThatIsRunning() throws {
        let (store, _) = store()
        let inside = DispatchSemaphore(value: 0)
        let finish = DispatchSemaphore(value: 0)
        let reader = Thread {
            _ = try? store.read { (db: SQLiteDatabase) -> Int in
                inside.signal()
                _ = finish.wait(timeout: .now() + 5)
                return try db.userVersion
            }
        }
        reader.start()
        XCTAssertEqual(inside.wait(timeout: .now() + 5), .success)
        let released = DispatchSemaphore(value: 0)
        let releaser = Thread {
            store.release()
            released.signal()
        }
        releaser.start()
        XCTAssertEqual(released.wait(timeout: .now() + 0.2), .timedOut, "release must wait for the running access")
        finish.signal()
        XCTAssertEqual(released.wait(timeout: .now() + 5), .success)
    }
}
