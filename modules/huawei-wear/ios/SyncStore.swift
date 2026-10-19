// Writes sync results into the database the JS side reads with expo-sqlite. Port of SyncStore.kt.
//
// `joyofit.db` lives in `<Documents>/SQLite`, the directory expo-sqlite's `defaultDatabaseDirectory` constant returns on iOS
// (ExpoSQLite SQLiteModule.swift: `documentDirectory + "SQLite"`), under the name `_layout.tsx` opens. Schema and migrations are the ones JS
// imports (modules/huawei-wear/schema/joyofit-db-migrations.json, compiled into WearMigrations.swift); `PRAGMA user_version` counts the
// migrations applied in both. The upserts are the ones src/db/queries.ts used to run from JS.
//
// The connection is on the SQLite library expo-sqlite links (see SQLiteDatabase.swift), the one JS opens the same file with, so the two
// really lock each other out. It stays open until `release()` (the repair of a damaged file in src/db/recovery replaces the file and
// needs it closed) and opens again on the next access after `resume()`.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

/// Re-request this much already-stored history on every sync; upserts make the overlap idempotent.
public let syncOverlapSec: Int64 = 3600

/// Start of the next sync window, unix seconds: 0 (everything the watch still holds) on the first sync, else 1 h before the last one.
public func syncWindowStart(lastSyncSec: Int64?) -> Int64 {
    guard let last = lastSyncSec else { return 0 }
    return max(0, last - syncOverlapSec)
}

/// One request chain covers at most this much of a long pull, so a full history never becomes a single endless request.
public let syncSliceSec: Int64 = 14 * 24 * 3600

/// History older than this is requested as one slice by `syncSlices`.
public let syncHeadSec: Int64 = 8 * 7 * 24 * 3600

/// Consecutive `(from, to)` slices from `fromSec` up to `nowSec`, oldest first. Everything older than `syncHeadSec` is one slice (the watch
/// pages it itself, and an empty stretch costs one count request, not hundreds), the recent part is cut into `syncSliceSec` pieces.
public func syncSlices(fromSec: Int64, nowSec: Int64) -> [(from: Int64, to: Int64)] {
    var slices = [(from: Int64, to: Int64)]()
    var start = fromSec
    let headEnd = nowSec - syncHeadSec
    if start < headEnd {
        slices.append((start, headEnd))
        start = headEnd
    }
    while start < nowSec - syncSliceSec {
        slices.append((start, start + syncSliceSec))
        start += syncSliceSec
    }
    slices.append((start, nowSec))
    return slices
}

/// What one stored sync reports to JS (`SyncSummary` in HuaweiWear.types.ts).
public struct SyncSummary: Equatable, Sendable {
    public let from: Int64
    public let to: Int64
    public let samples: Int
    public let sleep: Int
    public let totalSteps: Int
    public let totalCalories: Int
    public let totalDistance: Int
    /// Workouts written (new or completed) by this sync's workout phase.
    public let workouts: Int

    public init(from: Int64, to: Int64, samples: Int, sleep: Int, totalSteps: Int, totalCalories: Int, totalDistance: Int, workouts: Int = 0) {
        self.from = from
        self.to = to
        self.samples = samples
        self.sleep = sleep
        self.totalSteps = totalSteps
        self.totalCalories = totalCalories
        self.totalDistance = totalDistance
        self.workouts = workouts
    }

    public func withWorkouts(_ count: Int) -> SyncSummary {
        SyncSummary(from: from, to: to, samples: samples, sleep: sleep, totalSteps: totalSteps, totalCalories: totalCalories, totalDistance: totalDistance, workouts: count)
    }

    public func toJS() -> [String: Any] {
        [
            "from": from,
            "to": to,
            "samples": samples,
            "workouts": workouts,
            "sleep": sleep,
            "totals": [
                "steps": totalSteps,
                "calories": totalCalories,
                "distance": totalDistance,
            ] as [String: Any],
        ]
    }
}

public final class SyncStore: @unchecked Sendable {
    public static let databaseName = "joyofit.db"

    private let url: URL
    private let migrationsOverride: [[String]]?
    private let lock = NSLock()
    private var database: SQLiteDatabase?
    /// True between `release()` and `resume()`: no connection is opened and every access fails as a storage error.
    private var released = false

    /// `url` defaults to `<Documents>/SQLite/joyofit.db`; `migrations` to the shared schema (parsed when the database is first opened, so a
    /// broken schema file surfaces as a storage error instead of failing the module).
    public init(url: URL? = nil, migrations: [[String]]? = nil) {
        self.url = url ?? SyncStore.defaultURL()
        self.migrationsOverride = migrations
    }

    public static func defaultURL() -> URL {
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return documents.appendingPathComponent("SQLite", isDirectory: true).appendingPathComponent(databaseName)
    }

    /// The migrations JSON compiled into the module: a list of lists of single SQL statements.
    public static func sharedMigrations() throws -> [[String]] {
        try parseMigrations(WearMigrations.json)
    }

    public static func parseMigrations(_ json: String) throws -> [[String]] {
        guard let data = json.data(using: .utf8), let parsed = try JSONSerialization.jsonObject(with: data) as? [[String]] else {
            throw SQLiteError(code: -1, message: "The migrations JSON is not a list of lists of statements")
        }
        return parsed
    }

    /// Opens the database on first use, enables WAL (as JS does and as Android's ENABLE_WRITE_AHEAD_LOGGING) and applies pending migrations.
    private func db() throws -> SQLiteDatabase {
        if let database { return database }
        if released { throw SQLiteError(code: -1, message: "The database is being repaired") }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let opened = try SQLiteDatabase(path: url.path)
        try opened.exec("PRAGMA journal_mode = WAL")
        try migrate(opened)
        database = opened
        return opened
    }

    /// `migrate()` in src/db/migrations.ts: entry `i` upgrades `user_version` i to i + 1.
    private func migrate(_ db: SQLiteDatabase) throws {
        let migrations = try migrationsOverride ?? SyncStore.sharedMigrations()
        let current = try db.userVersion
        if current > migrations.count {
            throw SQLiteError(code: -1, message: "Database schema v\(current) is newer than this app supports (v\(migrations.count))")
        }
        for version in current..<migrations.count {
            try db.transaction {
                // JS may have applied this step between the read above and taking the write lock.
                if try db.userVersion <= version {
                    for statement in migrations[version] { try db.exec(statement) }
                    try db.setUserVersion(version + 1)
                }
            }
        }
    }

    /// Closes the connection and keeps it closed until `resume()`: a file that is replaced must not be open here. Waits for an access that
    /// is running (they hold the same lock).
    public func release() {
        lock.lock()
        defer { lock.unlock() }
        released = true
        database = nil
    }

    /// Lets the next access open the connection again after `release()`.
    public func resume() {
        lock.lock()
        defer { lock.unlock() }
        released = false
    }

    /// Runs `block` against the open database, serialized with every other access; the HealthKit export reads stored rows through this.
    public func read<T>(_ block: (SQLiteDatabase) throws -> T) throws -> T {
        lock.lock()
        defer { lock.unlock() }
        return try block(db())
    }

    public func lastSync(address: String) throws -> Int64? {
        try read { db in
            try db.query("SELECT last_sync FROM device WHERE address = ?", [.text(address)]) { $0.isNull(0) ? nil : $0.int64(0) }.first ?? nil
        }
    }

    /// Whether a watch stores health rows (`device.tracks_health`); a watch with no row yet does.
    public func tracksHealth(address: String) throws -> Bool {
        try read { db in
            try db.query("SELECT tracks_health FROM device WHERE address = ?", [.text(address)]) { $0.int(0) != 0 }.first ?? true
        }
    }

    /// The sync of a watch with `tracks_health = 0` (docs/multi-watch.md, section 3): nothing is stored, `device.last_sync` still advances to
    /// `nowSec`, and the summary is empty. nil when the watch tracks health and the sync must run. Read fresh on every sync.
    public func untrackedSyncSummary(address: String, nowSec: Int64) throws -> SyncSummary? {
        if try tracksHealth(address: address) { return nil }
        try read { db in try db.run("UPDATE device SET last_sync = ? WHERE address = ?", [.int(nowSec), .text(address)]) }
        return SyncSummary(from: nowSec, to: nowSec, samples: 0, sleep: 0, totalSteps: 0, totalCalories: 0, totalDistance: 0)
    }

    /// `upsertDevice` of the old JS queries: keeps `last_sync` of an existing row. A new row is primary when no watch is yet; an existing row
    /// keeps its alias, primary flag, `tracks_health`, `bg_sync`, `added_at` and `last_sync` (docs/multi-watch.md, section 2).
    public func upsertDevice(address: String, name: String, productModel: String?, softwareVersion: String?) throws {
        try read { db in
            try db.run(
                """
                INSERT INTO device (address, name, product_model, software_version, last_sync, is_primary, added_at)
                VALUES (?, ?, ?, ?, NULL,
                  CASE WHEN EXISTS (SELECT 1 FROM device WHERE is_primary = 1) THEN 0 ELSE 1 END,
                  CAST(strftime('%s', 'now') AS INTEGER))
                ON CONFLICT(address) DO UPDATE SET
                  name = excluded.name,
                  product_model = excluded.product_model,
                  software_version = excluded.software_version
                """,
                [.text(address), .text(name), .string(productModel), .string(softwareVersion)]
            )
        }
    }

    /// Persists one sync in a single transaction and advances `device.last_sync` to `result.to`.
    public func save(address: String, result: SyncResult) throws -> SyncSummary {
        try read { db in
            try db.transaction {
                let sample = try db.prepare(
                    """
                    INSERT INTO step_samples
                      (timestamp, steps, calories, distance, heart_rate, spo2, resting_heart_rate, device)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(timestamp) DO UPDATE SET
                      steps = excluded.steps,
                      calories = excluded.calories,
                      distance = excluded.distance,
                      heart_rate = excluded.heart_rate,
                      spo2 = excluded.spo2,
                      resting_heart_rate = excluded.resting_heart_rate,
                      device = excluded.device,
                      imported = 0
                    """
                )
                let segment = try db.prepare(
                    """
                    INSERT INTO sleep_segments (start, end, type, stage, device) VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(start, type) DO UPDATE SET end = excluded.end, stage = excluded.stage, device = excluded.device, imported = 0
                    """
                )
                for s in result.samples {
                    sample.reset()
                    try sample.bind([
                        .int(s.timestamp), .int(Int64(s.steps)), .int(Int64(s.calories)), .int(Int64(s.distance)),
                        .integer(s.heartRate), .integer(s.spo2), .integer(s.restingHeartRate), .text(address),
                    ])
                    while try sample.step() {}
                }
                for s in result.sleep {
                    segment.reset()
                    try segment.bind([.int(s.start), .int(s.end), .int(Int64(s.type)), .string(s.stage), .text(address)])
                    while try segment.step() {}
                }
                for s in result.sleepScores {
                    try db.run(
                        """
                        INSERT INTO sleep_scores (start, end, score, efficiency, device) VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT(start) DO UPDATE SET end = excluded.end, score = excluded.score, efficiency = excluded.efficiency, device = excluded.device
                        """,
                        [.int(s.start), .int(s.end), .int(Int64(s.score)), .integer(s.efficiency), .text(address)]
                    )
                }
                try db.run("UPDATE device SET last_sync = ? WHERE address = ?", [.int(result.to), .text(address)])
            }
            return SyncSummary(
                from: result.from, to: result.to, samples: result.samples.count, sleep: result.sleep.count,
                totalSteps: result.totalSteps, totalCalories: result.totalCalories, totalDistance: result.totalDistance
            )
        }
    }
}

#endif
