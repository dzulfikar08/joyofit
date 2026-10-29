package com.joyodigitama.huaweiwear

/**
 * Writes an import into `joyofit.db` through [SyncStore]'s connection. The rules, in one place:
 *
 * - **Watch data wins.** Rows are inserted with `imported = 1` (migration `imported` in
 *   `schema/joyofit-db-migrations.json`) and never replace a row that exists. A minute the watch already stored only
 *   gets heart rate, SpO2 and resting heart rate filled in where those are NULL (`COALESCE`), never its steps,
 *   distance or calories. A sleep segment is skipped when a watch-synced one overlaps it. A workout is skipped when
 *   one starts within [WORKOUT_MATCH_SEC] of it.
 * - **Imported rows stay on the phone.** The cloud upload, the Health Connect export and the Strava upload read
 *   `imported = 0` only, so a year of history does not become an upload burst or a pile of duplicate records.
 *   When the watch later syncs the same minute, segment or workout, its write sets `imported = 0` again and the
 *   row travels like any watch row.
 * - **Idempotent.** The second import of the same file changes nothing.
 *
 * Minute calories are small calories (cal), like the watch's own.
 */
internal class SqliteHuaweiImportStore(private val openDb: () -> WearDatabase) : HuaweiImportStore {
  override fun writeMinutes(rows: Collection<ImportedMinute>): Int {
    if (rows.isEmpty()) return 0
    val db = openDb()
    var changed = 0
    db.beginTransaction()
    try {
      val statement = db.compileStatement(
        """INSERT INTO step_samples (timestamp, steps, calories, distance, heart_rate, spo2, resting_heart_rate, imported)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)
           ON CONFLICT(timestamp) DO UPDATE SET
             heart_rate = COALESCE(heart_rate, excluded.heart_rate),
             spo2 = COALESCE(spo2, excluded.spo2),
             resting_heart_rate = COALESCE(resting_heart_rate, excluded.resting_heart_rate),
             steps = CASE WHEN imported = 1 AND steps = 0 THEN excluded.steps ELSE steps END,
             distance = CASE WHEN imported = 1 AND distance = 0 THEN excluded.distance ELSE distance END,
             calories = CASE WHEN imported = 1 AND calories = 0 THEN excluded.calories ELSE calories END
           WHERE (heart_rate IS NULL AND excluded.heart_rate IS NOT NULL)
              OR (spo2 IS NULL AND excluded.spo2 IS NOT NULL)
              OR (resting_heart_rate IS NULL AND excluded.resting_heart_rate IS NOT NULL)
              OR (imported = 1 AND steps = 0 AND excluded.steps > 0)
              OR (imported = 1 AND distance = 0 AND excluded.distance > 0)
              OR (imported = 1 AND calories = 0 AND excluded.calories > 0)""",
      )
      try {
        for (m in rows) {
          statement.clearBindings()
          statement.bindLong(1, m.ts)
          statement.bindLong(2, m.steps.toLong())
          statement.bindLong(3, m.calories.toLong())
          statement.bindLong(4, m.distance.toLong())
          m.heartRate?.let { statement.bindLong(5, it.toLong()) } ?: statement.bindNull(5)
          m.spo2?.let { statement.bindLong(6, it.toLong()) } ?: statement.bindNull(6)
          m.restingHeartRate?.let { statement.bindLong(7, it.toLong()) } ?: statement.bindNull(7)
          changed += statement.executeUpdateDelete()
        }
      } finally {
        statement.close()
      }
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
    return changed
  }

  override fun writeSleep(segments: List<ImportedSleep>): Int {
    if (segments.isEmpty()) return 0
    val db = openDb()
    var added = 0
    db.beginTransaction()
    try {
      val statement = db.compileStatement(
        """INSERT OR IGNORE INTO sleep_segments (start, end, type, stage, imported)
           SELECT ?, ?, ?, ?, 1
           WHERE NOT EXISTS (SELECT 1 FROM sleep_segments WHERE start > ? AND start < ? AND end > ? AND imported = 0)""",
      )
      try {
        for (s in segments) {
          statement.clearBindings()
          statement.bindLong(1, s.start)
          statement.bindLong(2, s.end)
          statement.bindLong(3, s.type.toLong())
          s.stage?.let { statement.bindString(4, it) } ?: statement.bindNull(4)
          // The primary key leads with `start`, so a window of the longest stage keeps this lookup off a scan of the table.
          statement.bindLong(5, s.start - MAX_SEGMENT_SEC)
          statement.bindLong(6, s.end)
          statement.bindLong(7, s.start)
          added += statement.executeUpdateDelete()
        }
      } finally {
        statement.close()
      }
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
    return added
  }

  /**
   * Metrics go where the watch's own go (`health_metrics`, the types of `src/features/health/metrics.ts`), so the Health
   * screen shows them: stress / emotion, HRV, sleep apnea, skin temperature, arterial stiffness, arrhythmia. A row the watch
   * already stored for the same type and second stays.
   */
  override fun writeMetrics(points: List<ImportedMetric>): Map<String, Int> {
    if (points.isEmpty()) return emptyMap()
    val db = openDb()
    val added = HashMap<String, Int>()
    db.beginTransaction()
    try {
      val statement = db.compileStatement(
        "INSERT OR IGNORE INTO health_metrics (type, ts, last_ts, value, values_json) VALUES (?, ?, ?, ?, ?)",
      )
      try {
        for (p in points) {
          statement.clearBindings()
          statement.bindString(1, p.type)
          statement.bindLong(2, p.ts)
          statement.bindLong(3, p.ts)
          statement.bindDouble(4, p.value)
          statement.bindString(5, p.json)
          val n = statement.executeUpdateDelete()
          if (n > 0) added.merge(p.type, n, Int::plus)
        }
      } finally {
        statement.close()
      }
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
    return added
  }

  /** A night's score where the watch has none starting at the same second; the watch's own row is never replaced. */
  override fun writeSleepScores(scores: List<ImportedSleepScore>): Int {
    if (scores.isEmpty()) return 0
    val db = openDb()
    var added = 0
    db.beginTransaction()
    try {
      val statement = db.compileStatement("INSERT OR IGNORE INTO sleep_scores (start, end, score, efficiency) VALUES (?, ?, ?, ?)")
      try {
        for (s in scores) {
          statement.clearBindings()
          statement.bindLong(1, s.start)
          statement.bindLong(2, s.end)
          statement.bindLong(3, s.score.toLong())
          s.efficiency?.let { statement.bindLong(4, it.toLong()) } ?: statement.bindNull(4)
          added += statement.executeUpdateDelete()
        }
      } finally {
        statement.close()
      }
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
    return added
  }

  /**
   * The day's totals are authoritative where the per-minute rows fall short of them (a real export: 319 days with no per-minute
   * file at all, and days where the minutes add up to less). The shortfall, steps / distance / calories the minutes of that
   * day do not account for, goes into one row at the first free minute from noon, marked `imported = 1`. Day sums, the steps
   * card and the calories total are then the day's own; an hour-by-hour chart shows the shortfall at 12:00, which is all the
   * summary knows. A day whose rows already add up to its total is left alone, which also makes a second run add nothing.
   */
  override fun writeDayTotals(totals: List<ImportedDayTotal>): Int {
    if (totals.isEmpty()) return 0
    val db = openDb()
    var added = 0
    db.beginTransaction()
    try {
      val insert = db.compileStatement("INSERT OR IGNORE INTO step_samples (timestamp, steps, calories, distance, imported) VALUES (?, ?, ?, ?, 1)")
      try {
        for (t in totals) {
          val args = arrayOf(t.dayStartSec.toString(), t.dayEndSec.toString())
          val have = db.rawQuery(
            "SELECT COALESCE(SUM(steps), 0), COALESCE(SUM(calories), 0), COALESCE(SUM(distance), 0) FROM step_samples WHERE timestamp >= ? AND timestamp < ?",
            args,
          ).use { if (it.moveToFirst()) longArrayOf(it.getLong(0), it.getLong(1), it.getLong(2)) else longArrayOf(0, 0, 0) }
          val steps = maxOf(0L, t.steps - have[0])
          val calories = maxOf(0L, t.calories - have[1])
          val distance = maxOf(0L, t.distance - have[2])
          if (steps == 0L && calories == 0L && distance == 0L) continue
          val taken = HashSet<Long>()
          db.rawQuery("SELECT timestamp FROM step_samples WHERE timestamp >= ? AND timestamp < ?", arrayOf(t.noonSec.toString(), t.dayEndSec.toString())).use {
            while (it.moveToNext()) taken.add(it.getLong(0))
          }
          var at = t.noonSec / 60 * 60
          while (at in taken && at < t.dayEndSec) at += 60
          if (at >= t.dayEndSec) continue
          insert.clearBindings()
          insert.bindLong(1, at)
          insert.bindLong(2, steps)
          insert.bindLong(3, calories)
          insert.bindLong(4, distance)
          added += insert.executeUpdateDelete()
        }
      } finally {
        insert.close()
      }
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
    return added
  }

  override fun writeWorkout(workout: ImportedWorkout): WorkoutWrite {
    val db = openDb()
    db.beginTransaction()
    try {
      val existing = findWorkout(db, workout.start)
      if (existing != null) {
        // An earlier import of an export read by an older version stored the workout without its track and totals: fill it in.
        // One read off a broken record before that fallback knew `subType` and `summaryData` has its track but no sport,
        // distance or calories: name it and fill the totals, keeping the track. A watch-synced workout is never touched.
        val fillTrack = existing.points == 0 &&
          (workout.points.isNotEmpty() || existing.calories != workout.calories || existing.distance != workout.distance)
        val fillSport = existing.sportName == HuaweiExportSports.name(null) && workout.sportName != existing.sportName
        if (!existing.imported || !(fillTrack || fillSport)) {
          db.setTransactionSuccessful()
          return WorkoutWrite(added = false, points = 0)
        }
        val update = db.compileStatement(
          """UPDATE workouts SET end = ?, sport_type = ?, sport_name = ?, duration = ?, distance = ?, calories = ?, avg_hr = ?,
               max_hr = ?, steps = ?, summary_json = ? WHERE id = ?""",
        )
        try {
          update.bindLong(1, workout.end)
          update.bindLong(2, workout.sportType.toLong())
          update.bindString(3, workout.sportName)
          update.bindLong(4, workout.duration.toLong())
          update.bindLong(5, workout.distance.toLong())
          update.bindLong(6, workout.calories.toLong())
          workout.avgHr?.let { update.bindLong(7, it.toLong()) } ?: update.bindNull(7)
          workout.maxHr?.let { update.bindLong(8, it.toLong()) } ?: update.bindNull(8)
          update.bindLong(9, workout.steps.toLong())
          update.bindString(10, workout.summaryJson)
          update.bindLong(11, existing.id)
          update.executeUpdateDelete()
        } finally {
          update.close()
        }
        val pointsAdded = if (existing.points == 0) workout.points.size else 0
        if (pointsAdded > 0) insertPoints(db, existing.id, workout.points)
        db.setTransactionSuccessful()
        return WorkoutWrite(added = false, points = pointsAdded, updated = true)
      }
      val insert = db.compileStatement(
        """INSERT OR IGNORE INTO workouts
             (workout_number, start, end, sport_type, sport_name, duration, distance, calories, avg_hr, max_hr, steps, summary_json, complete, imported)
           VALUES (0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)""",
      )
      val id = try {
        insert.bindLong(1, workout.start)
        insert.bindLong(2, workout.end)
        insert.bindLong(3, workout.sportType.toLong())
        insert.bindString(4, workout.sportName)
        insert.bindLong(5, workout.duration.toLong())
        insert.bindLong(6, workout.distance.toLong())
        insert.bindLong(7, workout.calories.toLong())
        workout.avgHr?.let { insert.bindLong(8, it.toLong()) } ?: insert.bindNull(8)
        workout.maxHr?.let { insert.bindLong(9, it.toLong()) } ?: insert.bindNull(9)
        insert.bindLong(10, workout.steps.toLong())
        insert.bindString(11, workout.summaryJson)
        insert.executeInsert()
      } finally {
        insert.close()
      }
      if (id < 0) {
        db.setTransactionSuccessful()
        return WorkoutWrite(added = false, points = 0)
      }
      insertPoints(db, id, workout.points)
      db.setTransactionSuccessful()
      return WorkoutWrite(added = true, points = workout.points.size)
    } finally {
      db.endTransaction()
    }
  }

  /**
   * Weigh-ins go where the Bluetooth scale's go (`scale_reading`, `src/features/scale/store.ts`, created by JS when the
   * database opens; the same statement runs here so an import before the first JS start still works), under the
   * scale id [WEIGH_IN_SCALE_ID] and with `rogo_state = 'pending'`. The Bluetooth scale's own push (`weight.checkIn`, which writes
   * over a day) leaves these rows alone; JS sends them through `weight.importHistory`, which never writes over a day.
   * Skipped when a weigh-in already sits within a minute at about the same weight (the same weighing from the
   * scale and from Huawei Health, or this export imported twice).
   */
  /**
   * The queue of what JoyoRogo should get from an import (`rogo_import_queue`, created here and by JS, `src/features/import/rogoQueue.ts`):
   * one row per meal or water day, `state` `pending` until JS has sent it. A row that is there already (pending, sent or failed) stays as it is.
   */
  override fun queueForRogo(items: List<QueuedImport>): Int {
    if (items.isEmpty()) return 0
    val db = openDb()
    var added = 0
    db.beginTransaction()
    try {
      db.execSQL(
        """CREATE TABLE IF NOT EXISTS rogo_import_queue (
             kind TEXT NOT NULL, key TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', error TEXT,
             PRIMARY KEY (kind, key))""",
      )
      val statement = db.compileStatement("INSERT OR IGNORE INTO rogo_import_queue (kind, key, payload) VALUES (?, ?, ?)")
      try {
        for (item in items) {
          statement.clearBindings()
          statement.bindString(1, item.kind)
          statement.bindString(2, item.key)
          statement.bindString(3, item.payload)
          added += statement.executeUpdateDelete()
        }
      } finally {
        statement.close()
      }
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
    return added
  }

  override fun writeWeighIns(weighIns: List<ImportedWeighIn>): Int {
    if (weighIns.isEmpty()) return 0
    val db = openDb()
    var added = 0
    db.beginTransaction()
    try {
      db.execSQL(
        """CREATE TABLE IF NOT EXISTS scale_reading (
             id INTEGER PRIMARY KEY AUTOINCREMENT, scale_id TEXT NOT NULL, taken_at INTEGER NOT NULL, weight_kg REAL NOT NULL,
             impedance_ohm REAL, reported TEXT, estimate TEXT, rogo_state TEXT NOT NULL DEFAULT 'pending', rogo_error TEXT)""",
      )
      db.execSQL("CREATE INDEX IF NOT EXISTS scale_reading_taken_at ON scale_reading (taken_at)")
      val statement = db.compileStatement(
        """INSERT INTO scale_reading (scale_id, taken_at, weight_kg, impedance_ohm, reported, rogo_state)
           SELECT ?, ?, ?, ?, ?, 'pending'
           WHERE NOT EXISTS (SELECT 1 FROM scale_reading WHERE taken_at BETWEEN ? AND ? AND ABS(weight_kg - ?) < 0.3)""",
      )
      try {
        for (w in weighIns) {
          statement.clearBindings()
          statement.bindString(1, WEIGH_IN_SCALE_ID)
          statement.bindLong(2, w.tsMs)
          statement.bindDouble(3, w.weightKg)
          w.impedanceOhm?.let { statement.bindDouble(4, it) } ?: statement.bindNull(4)
          w.reportedJson?.let { statement.bindString(5, it) } ?: statement.bindNull(5)
          statement.bindLong(6, w.tsMs - 60_000)
          statement.bindLong(7, w.tsMs + 60_000)
          statement.bindDouble(8, w.weightKg)
          added += statement.executeUpdateDelete()
        }
      } finally {
        statement.close()
      }
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
    return added
  }

  private class ExistingWorkout(val id: Long, val imported: Boolean, val points: Int, val calories: Int, val distance: Int, val sportName: String?)

  private fun findWorkout(db: WearDatabase, start: Long): ExistingWorkout? =
    db.rawQuery(
      """SELECT id, imported, (SELECT COUNT(*) FROM workout_points WHERE workout_id = workouts.id), calories, distance, sport_name
         FROM workouts WHERE start BETWEEN ? AND ? LIMIT 1""",
      arrayOf((start - WORKOUT_MATCH_SEC).toString(), (start + WORKOUT_MATCH_SEC).toString()),
    ).use { if (it.moveToFirst()) ExistingWorkout(it.getLong(0), it.getInt(1) == 1, it.getInt(2), it.getInt(3), it.getInt(4), it.getString(5)) else null }

  private fun insertPoints(db: WearDatabase, workoutId: Long, points: List<WorkoutPoint>) {
    val point = db.compileStatement(
      "INSERT INTO workout_points (workout_id, ts, lat, lon, alt, hr, speed, cadence, stride, power) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    try {
      for (p in points) {
        point.clearBindings()
        point.bindLong(1, workoutId)
        point.bindLong(2, p.ts)
        p.lat?.let { point.bindDouble(3, it) } ?: point.bindNull(3)
        p.lon?.let { point.bindDouble(4, it) } ?: point.bindNull(4)
        p.alt?.let { point.bindDouble(5, it) } ?: point.bindNull(5)
        p.hr?.let { point.bindLong(6, it.toLong()) } ?: point.bindNull(6)
        p.speed?.let { point.bindDouble(7, it) } ?: point.bindNull(7)
        p.cadence?.let { point.bindLong(8, it.toLong()) } ?: point.bindNull(8)
        p.stride?.let { point.bindDouble(9, it) } ?: point.bindNull(9)
        p.power?.let { point.bindLong(10, it.toLong()) } ?: point.bindNull(10)
        point.executeInsert()
      }
    } finally {
      point.close()
    }
  }

  companion object {
    /** `scale_reading.scale_id` of weigh-ins read from the export; no `scale` row belongs to it. */
    const val WEIGH_IN_SCALE_ID = "huawei-health-export"

    /** No stored sleep stage is longer than this ([HuaweiHealthDetailParser] refuses longer ones, the watch never writes them). */
    const val MAX_SEGMENT_SEC = 24 * 3600L

    /** The same workout seen by the watch and by the export differs by a second or two at most. */
    const val WORKOUT_MATCH_SEC = 120L
  }
}
