// Writes workouts into the shared database (`workouts`, `workout_points`; migration 3 in schema/joyofit-db-migrations.json) through SyncStore's
// connection, and runs the workout phase of the activity sync. Port of WorkoutStore.kt and WearLink.syncWorkouts. A workout is replaced as a
// whole in one transaction: the row is upserted by `start` (the id stays), its old points are deleted and the new ones inserted.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

public final class WorkoutStore: WorkoutSink, DynamicsSink {
    /// GB HuaweiWorkoutSyncManager.getStartTimeFromDb fallback: 2022-06-10 00:00:00 UTC.
    public static let defaultStartSec: Int64 = 1_654_819_200
    /// A full-history pull starts here (2000-01-01, the Kotlin `DEFAULT_START_SEC`): everything the watch still holds.
    public static let fullHistoryStartSec: Int64 = 946_684_800

    private let store: SyncStore
    /// The watch that writes (`device.address`): attributes every row and keeps this watch's sync window apart from the other watches'.
    private let address: String
    private let gpsStore: ConnectedGpsStore

    public init(_ store: SyncStore, address: String, gpsStore: ConnectedGpsStore = .shared) {
        self.store = store
        self.address = address
        self.gpsStore = gpsStore
    }

    /// Who keeps a session two watches recorded (docs/multi-watch.md, section 3): the copy with a GPS track, else the primary watch's, else the
    /// one stored first. True when the incoming copy replaces the stored one.
    public static func incomingWins(incomingHasGps: Bool, storedHasGps: Bool, incomingIsPrimary: Bool, storedIsPrimary: Bool) -> Bool {
        if incomingHasGps != storedHasGps { return incomingHasGps }
        return incomingIsPrimary && !storedIsPrimary
    }

    /// Two sessions of different watches are one when they overlap by at least half of the shorter one.
    public static func isDuplicate(startA: Int64, endA: Int64, startB: Int64, endB: Int64) -> Bool {
        let overlap = min(endA, endB) - max(startA, startB)
        let shorter = min(endA - startA, endB - startB)
        return overlap > 0 && overlap * 2 >= shorter
    }

    /// True when a complete workout with this start and end is stored, or when this watch's copy lost to another watch's (`workout_shadow`).
    public func isComplete(start: Int64, end: Int64) throws -> Bool {
        try store.read { db in
            try !db.query("SELECT 1 FROM workouts WHERE start = ? AND end = ? AND complete = 1", [.int(start), .int(end)]) { _ in true }.isEmpty
                || !db.query("SELECT 1 FROM workout_shadow WHERE device = ? AND start = ? AND end = ?", [.text(address), .int(start), .int(end)]) { _ in true }.isEmpty
        }
    }

    private struct Stored {
        let id: Int64
        let device: String
        let start: Int64
        let end: Int64
    }

    /// Settles a session another watch also recorded. Returns false (and notes the loser in `workout_shadow`) when the stored copy stays;
    /// otherwise deletes the stored copies it replaces, noting them in `workout_shadow`.
    private func keepsIncoming(_ db: SQLiteDatabase, _ record: WorkoutRecord) throws -> Bool {
        let others = try db.query(
            "SELECT id, device, start, end FROM workouts WHERE device IS NOT NULL AND device <> ? AND imported = 0 AND start < ? AND end > ? ORDER BY start, id",
            [.text(address), .int(record.end), .int(record.start)]
        ) { Stored(id: $0.int64(0), device: $0.text(1)!, start: $0.int64(2), end: $0.int64(3)) }
            .filter { WorkoutStore.isDuplicate(startA: record.start, endA: record.end, startB: $0.start, endB: $0.end) }
        if others.isEmpty { return true }
        func isPrimary(_ device: String) throws -> Bool {
            try db.query("SELECT is_primary FROM device WHERE address = ?", [.text(device)]) { $0.int(0) == 1 }.first ?? false
        }
        func hasGps(_ id: Int64) throws -> Bool {
            let phoneGps = try db.query("SELECT phone_gps FROM workouts WHERE id = ?", [.int(id)]) { $0.int(0) == 1 }.first ?? false
            if phoneGps { return false }
            return try !db.query("SELECT 1 FROM workout_points WHERE workout_id = ? AND lat IS NOT NULL AND lon IS NOT NULL LIMIT 1", [.int(id)]) { _ in true }.isEmpty
        }
        let incomingGps = record.points.contains { $0.lat != nil && $0.lon != nil }
        let incomingPrimary = try isPrimary(address)
        for other in others {
            if !WorkoutStore.incomingWins(
                incomingHasGps: incomingGps, storedHasGps: try hasGps(other.id), incomingIsPrimary: incomingPrimary, storedIsPrimary: try isPrimary(other.device)
            ) {
                try db.run(
                    "INSERT OR REPLACE INTO workout_shadow (device, start, end, kept_start) VALUES (?, ?, ?, ?)",
                    [.text(address), .int(record.start), .int(record.end), .int(other.start)]
                )
                return false
            }
        }
        for other in others {
            try db.run("DELETE FROM workout_points WHERE workout_id = ?", [.int(other.id)])
            try db.run("DELETE FROM workouts WHERE id = ?", [.int(other.id)])
            try db.run(
                "INSERT OR REPLACE INTO workout_shadow (device, start, end, kept_start) VALUES (?, ?, ?, ?)",
                [.text(other.device), .int(other.start), .int(other.end), .int(record.start)]
            )
        }
        return true
    }

    /// Stores the workout; false when it was not newly stored (it was complete already, or another watch's copy of the session was kept).
    /// When `rawRecord` has no GPS points of its own (for example a Huawei Band without built-in GNSS), attaches a matching phone Connected
    /// GPS trajectory from `gpsStore` after duplicate resolution and before persistence.
    public func save(_ rawRecord: WorkoutRecord) throws -> Bool {
        return try store.read { db in
            try db.transaction {
                if try !keepsIncoming(db, rawRecord) { return false }
                let record = ConnectedGpsMerger.merge(rawRecord, store: gpsStore)
                let hasPhoneGps = record.points.count > rawRecord.points.count || record.summaryJson.contains("\"gpsSource\":\"phone\"")
                let wasComplete: Bool? = try db.query("SELECT complete FROM workouts WHERE start = ?", [.int(record.start)]) { $0.int(0) == 1 }.first
                try db.run(
                    """
                    INSERT INTO workouts
                      (workout_number, start, end, sport_type, sport_name, duration, distance, calories, avg_hr, max_hr, steps, summary_json, complete, device, phone_gps)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(start) DO UPDATE SET
                      workout_number = excluded.workout_number,
                      end = excluded.end,
                      sport_type = excluded.sport_type,
                      sport_name = excluded.sport_name,
                      duration = excluded.duration,
                      distance = excluded.distance,
                      calories = excluded.calories,
                      avg_hr = excluded.avg_hr,
                      max_hr = excluded.max_hr,
                      steps = excluded.steps,
                      summary_json = excluded.summary_json,
                      complete = excluded.complete,
                      device = excluded.device,
                      phone_gps = excluded.phone_gps,
                      imported = 0
                    """,
                    [
                        .int(Int64(record.number)), .int(record.start), .int(record.end), .int(Int64(record.sportType)), .text(record.sportName),
                        .int(Int64(record.duration)), .int(Int64(record.distance)), .int(Int64(record.calories)), .integer(record.avgHr),
                        .integer(record.maxHr), .int(Int64(record.steps)), .text(record.summaryJson), .int(record.complete ? 1 : 0), .text(address),
                        .int(hasPhoneGps ? 1 : 0),
                    ]
                )
                guard let id = try db.query("SELECT id FROM workouts WHERE start = ?", [.int(record.start)], { $0.int64(0) }).first else {
                    throw SQLiteError(code: -1, message: "workout row for start \(record.start) is missing right after its upsert")
                }
                try db.run("DELETE FROM workout_points WHERE workout_id = ?", [.int(id)])
                let insert = try db.prepare(
                    "INSERT INTO workout_points (workout_id, ts, lat, lon, alt, hr, speed, cadence, stride, power) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                )
                for p in record.points {
                    insert.reset()
                    try insert.bind([
                        .int(id), .int(p.ts), p.lat.map { .double($0) } ?? .null, p.lon.map { .double($0) } ?? .null, p.alt.map { .double($0) } ?? .null,
                        .integer(p.hr), p.speed.map { .double($0) } ?? .null, .integer(p.cadence), p.stride.map { .double($0) } ?? .null, .integer(p.power),
                    ])
                    while try insert.step() {}
                }
                return wasComplete != true
            }
        }
    }

    /// The stored workouts of this watch among `starts` (unix seconds), in the order given; a start this watch has no copy of is left out
    /// (another watch's, an imported or an unknown one).
    public func refetchTargets(_ starts: [Int64]) throws -> [RefetchTarget] {
        try store.read { db in
            try starts.compactMap { start in
                try db.query(
                    "SELECT start, end, workout_number FROM workouts WHERE start = ? AND device = ? AND imported = 0",
                    [.int(start), .text(address)]
                ) { RefetchTarget(start: $0.int64(0), end: $0.int64(1), number: $0.int(2)) }.first
            }
        }
    }

    /// Puts the running form read from the watch into the stored summary of the workout at `start` and nothing else (points, totals and every
    /// other summary field stay). The row is only written when the form differs, so a second refetch does not move its `rev` and the cloud
    /// copy is replaced for the workouts that changed only.
    public func mergeSummary(start: Int64, _ edit: (String) -> SummaryEdit?) throws -> DynamicsMerge {
        try store.read { db in
            try db.transaction { () throws -> DynamicsMerge in
                let stored = try db.query(
                    "SELECT summary_json FROM workouts WHERE start = ? AND device = ? AND imported = 0", [.int(start), .text(address)]
                ) { $0.text(0) }.first ?? nil
                guard let stored, let edited = edit(stored) else { return .notStored }
                if !edited.changed { return .unchanged }
                try db.run("UPDATE workouts SET summary_json = ? WHERE start = ?", [.text(edited.json), .int(start)])
                return .updated
            }
        }
    }

    /// Reverse-order backfill: when a band workout synced to SQLite just before `LiveWorkout` finished or flushed its last fixes,
    /// attaches the phone's GPS route to the already-stored workout row if it currently has zero GPS points.
    @discardableResult
    public func backfillConnectedGps(_ session: ConnectedGpsSession) throws -> Int {
        if session.points.count < 2 || WorkoutSportTypes.isIndoor(session.sportType) { return 0 }
        let lo = session.startSec - ConnectedGpsStore.matchSlackSec
        let hi = session.effectiveEndSec + ConnectedGpsStore.matchSlackSec
        return try store.read { db in
            let rows = try db.query(
                """
                SELECT w.id, w.start, w.end, w.sport_type, w.duration, w.distance, w.summary_json
                FROM workouts w
                WHERE w.imported = 0 AND (? = '' OR w.device IS NULL OR LOWER(w.device) = LOWER(?))
                  AND MAX(COALESCE(w.end, 0), w.start + COALESCE(w.duration, 0)) >= ? AND w.start <= ?
                  AND NOT EXISTS (
                    SELECT 1 FROM workout_points p WHERE p.workout_id = w.id AND p.lat IS NOT NULL AND p.lon IS NOT NULL
                  )
                """,
                [.text(address), .text(address), .int(lo), .int(hi)]
            ) { row in
                (
                    id: row.int64(0),
                    start: row.int64(1),
                    end: row.int64(2),
                    sportType: row.isNull(3) ? nil : row.int(3),
                    duration: row.isNull(4) ? 0 : row.int(4),
                    distance: row.isNull(5) ? 0 : row.int(5),
                    summaryJson: row.text(6) ?? "{}"
                )
            }
            var updated = 0
            for row in rows {
                if WorkoutSportTypes.isIndoor(row.sportType) { continue }
                if let rowSport = row.sportType, let sessSport = session.sportType, rowSport != sessSport { continue }
                let effectiveEnd = row.end > row.start ? row.end : (row.duration > 0 ? row.start + Int64(row.duration) : session.effectiveEndSec)
                let fixes = session.fixesInWindow(workoutStartSec: row.start, workoutEndSec: effectiveEnd, slackSec: 0)
                let windowStart = row.start
                let windowEnd = max(row.start, effectiveEnd)
                let validFixes = fixes.filter { ($0.timeMs / 1000) >= windowStart && ($0.timeMs / 1000) <= windowEnd }
                guard validFixes.count >= 2 else { continue }
                let routeDist = session.distanceM > 0 ? session.distanceM : ConnectedGpsMerger.routeDistanceM(validFixes)
                let newDistance = row.distance > 0 ? row.distance : Int(routeDist.rounded())
                let newSummary = ConnectedGpsMerger.enrichSummaryJson(
                    row.summaryJson,
                    fixes: validFixes,
                    gpsPointsCount: validFixes.count,
                    distanceM: newDistance,
                    durationSec: row.duration,
                    riseM: session.riseM
                )
                try db.transaction {
                    let newEnd = row.end > row.start ? row.end : effectiveEnd
                    try db.run(
                        "UPDATE workouts SET distance = ?, end = ?, summary_json = ?, phone_gps = 1 WHERE id = ?",
                        [.int(Int64(newDistance)), .int(newEnd), .text(newSummary), .int(row.id)]
                    )
                    let insert = try db.prepare(
                        "INSERT INTO workout_points (workout_id, ts, lat, lon, alt, hr, speed, cadence, stride, power) VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL)"
                    )
                    for fix in validFixes {
                        insert.reset()
                        let ts = fix.timeMs / 1000
                        try insert.bind([
                            .int(row.id), .int(ts), .double(fix.latitude), .double(fix.longitude),
                            fix.altitude.map { .double($0) } ?? .null, fix.speed.map { .double($0) } ?? .null,
                        ])
                        while try insert.step() {}
                    }
                }
                updated += 1
            }
            return updated
        }
    }

    /// Start of the next workout window, unix seconds. GB asks for everything after the newest stored workout (and from 2022-06-10 when there
    /// is none); the start of the oldest incomplete workout wins over that so it is downloaded again. Workouts imported from a Huawei export say
    /// nothing about what the watch still holds, so they do not count.
    /// The newest end counts this watch's workouts and the ones of its that lost a duplicate (`workout_shadow`), so another watch's newest
    /// workout does not move this watch's window; the oldest incomplete one is this watch's or an unattributed one.
    /// `fullHistory` always starts from 2000-01-01; stored workouts upsert by start.
    public func syncStart(fullHistory: Bool = false) throws -> Int {
        if fullHistory { return Int(WorkoutStore.fullHistoryStartSec) }
        let (newestEnd, oldestIncomplete): (Int64?, Int64?) = try store.read { db in
            let newest = try db.query(
                """
                SELECT MAX(end) FROM (
                  SELECT end FROM workouts WHERE imported = 0 AND device = ?
                  UNION ALL SELECT end FROM workout_shadow WHERE device = ?
                )
                """,
                [.text(address), .text(address)]
            ) { $0.isNull(0) ? nil : $0.int64(0) }.first ?? nil
            let incomplete = try db.query(
                "SELECT MIN(start) FROM workouts WHERE complete = 0 AND (device = ? OR device IS NULL)", [.text(address)]
            ) { $0.isNull(0) ? nil : $0.int64(0) }.first ?? nil
            return (newest, incomplete)
        }
        let start: Int64
        if let newestEnd {
            start = oldestIncomplete.map { min($0, newestEnd + 1) } ?? newestEnd + 1
        } else {
            start = WorkoutStore.defaultStartSec
        }
        return Int(min(start, Int64(Int32.max)))
    }
}

/// The workout phase of the activity sync, run after the steps, sleep and totals are committed.
public enum WorkoutPhase {
    /// Workout sessions and their GPS tracks. Whatever fails here is logged and does not fail the sync: the steps, sleep and totals are already
    /// committed. Returns the workouts newly stored (or completed). Only cancellation propagates.
    public static func run(session: HuaweiSession, caps: DeviceCaps, syncStore: SyncStore, address: String, events: WearEvents, nowSec: Int64, fullHistory: Bool = false) async throws -> Int {
        let workouts = WorkoutStore(syncStore, address: address)
        let sync = WorkoutSync(session: session, caps: caps, log: events.sink)
        do {
            let start = try workouts.syncStart(fullHistory: fullHistory)
            try await sync.sync(startSec: start, endSec: Int(Int32(truncatingIfNeeded: nowSec)), sink: workouts)
        } catch is CancellationError {
            throw CancellationError()
        } catch let e as WearError {
            events.error("Workout sync failed: \(e.message)")
        } catch let e as SQLiteError {
            events.error("Workout sync failed: \(e.message)")
        } catch {
            events.error("Workout sync failed: \(error)")
        }
        events.info("Workout sync: \(sync.saved) workouts stored")
        return sync.saved
    }
}

#endif
