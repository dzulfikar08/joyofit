package com.joyodigitama.huaweiwear

/**
 * The statements the stores run against `joyofit.db` for the multi-watch rules (docs/multi-watch.md). Every watch-sourced
 * write binds the writer's `device.address` in `device` and repeats `device = excluded.device` in its `DO UPDATE SET`: the
 * triggers of migration 14 compare it with the stored row's `device` to decide who keeps a minute, a night or a metric. The
 * writer never deletes another watch's rows itself. `src/db/multiWatch.test.ts` runs the same statements on the shipped schema.
 */
internal object WatchSql {
  /** (address, name, product_model, software_version). The first watch of a database becomes primary; an existing row keeps alias, flags, `added_at` and `last_sync`. */
  const val UPSERT_DEVICE =
    """INSERT INTO device (address, name, product_model, software_version, last_sync, is_primary, added_at)
       VALUES (?, ?, ?, ?, NULL,
         CASE WHEN EXISTS (SELECT 1 FROM device WHERE is_primary = 1) THEN 0 ELSE 1 END,
         CAST(strftime('%s', 'now') AS INTEGER))
       ON CONFLICT(address) DO UPDATE SET
         name = excluded.name,
         product_model = excluded.product_model,
         software_version = excluded.software_version"""

  /** (address). Read fresh on every sync; a watch without a row tracks health. */
  const val SELECT_TRACKS_HEALTH = "SELECT tracks_health FROM device WHERE address = ?"

  /** (last_sync, address) */
  const val UPDATE_LAST_SYNC = "UPDATE device SET last_sync = ? WHERE address = ?"

  /** () -> address, last_sync of every watch the user wants synced in the background ([BackgroundController] visits). */
  const val SELECT_BG_SYNC_WATCHES = "SELECT address, last_sync FROM device WHERE bg_sync = 1"

  /** (timestamp, steps, calories, distance, heart_rate, spo2, resting_heart_rate, device) */
  const val UPSERT_STEP_SAMPLE =
    """INSERT INTO step_samples
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
         imported = 0"""

  /** (start, end, type, stage, device) */
  const val UPSERT_SLEEP_SEGMENT =
    """INSERT INTO sleep_segments (start, end, type, stage, device) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(start, type) DO UPDATE SET
         end = excluded.end, stage = excluded.stage, device = excluded.device, imported = 0"""

  /** (start, end, score, efficiency, device) */
  const val UPSERT_SLEEP_SCORE =
    """INSERT INTO sleep_scores (start, end, score, efficiency, device) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(start) DO UPDATE SET
         end = excluded.end, score = excluded.score, efficiency = excluded.efficiency, device = excluded.device"""

  /** (type, ts, last_ts, value, values_json, device) */
  const val UPSERT_HEALTH_METRIC =
    """INSERT INTO health_metrics (type, ts, last_ts, value, values_json, device) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(type, ts) DO UPDATE SET
         last_ts = excluded.last_ts, value = excluded.value, values_json = excluded.values_json, device = excluded.device"""

  /** (type, device): the newest stored `last_ts` of one watch, so each watch fetches from where it stopped itself. */
  const val SELECT_HEALTH_METRIC_CURSOR = "SELECT MAX(last_ts) FROM health_metrics WHERE type = ? AND device = ?"

  /** (device): the end of this watch's newest stored night. */
  const val SELECT_NIGHT_HRV_CURSOR = "SELECT MAX(end) FROM hrv_readings WHERE source = 'night' AND device = ?"

  /**
   * (night end, night start, device): this watch's own and unattributed rows of the session; another watch's overlapping
   * night is left to the claim triggers.
   */
  const val DELETE_NIGHT_HRV_OVERLAP =
    "DELETE FROM hrv_readings WHERE source = 'night' AND start <= ? AND end >= ? AND (device IS NULL OR device = ?)"

  /** (start, end, rmssd, beats, device) */
  const val INSERT_NIGHT_HRV =
    "INSERT OR REPLACE INTO hrv_readings (start, end, source, rmssd, sdnn, mean_rr, beats, device) VALUES (?, ?, 'night', ?, NULL, NULL, ?, ?)"

  /** (start, end, rmssd, sdnn, mean_rr, beats, device): a measurement the user started on the connected watch, always stored. */
  const val INSERT_SPOT_HRV =
    "INSERT OR REPLACE INTO hrv_readings (start, end, source, rmssd, sdnn, mean_rr, beats, device) VALUES (?, ?, 'spot', ?, ?, ?, ?, ?)"

  // Workouts

  /** (start) -> complete */
  const val SELECT_WORKOUT_COMPLETE = "SELECT complete FROM workouts WHERE start = ?"

  /** (start, end, device): a complete copy is stored, or this watch's copy was dropped for another watch's (workout_shadow). */
  const val SELECT_WORKOUT_DONE =
    """SELECT 1 FROM workouts WHERE start = ? AND end = ? AND complete = 1
       UNION ALL
       SELECT 1 FROM workout_shadow WHERE start = ? AND end = ? AND device = ?"""

  /** () -> address of the primary watch, none when no watch is primary. */
  const val SELECT_PRIMARY_DEVICE = "SELECT address FROM device WHERE is_primary = 1"

  /**
   * (device, end, start) -> id, start, end, device, has a GPS point. Stored copies of other watches (never imported or unattributed
   * rows) that touch the window; the overlap threshold is applied by [isCrossWatchDuplicate]. Oldest stored first.
   */
  const val SELECT_WORKOUT_CANDIDATES =
    """SELECT w.id, w.start, w.end, w.device,
         (EXISTS (SELECT 1 FROM workout_points p WHERE p.workout_id = w.id AND p.lat IS NOT NULL AND p.lon IS NOT NULL) AND w.phone_gps = 0)
       FROM workouts w
       WHERE w.device IS NOT NULL AND w.device <> ? AND w.imported = 0 AND w.start < ? AND w.end > ?
       ORDER BY w.id"""

  /** (id) */
  const val DELETE_WORKOUT_POINTS = "DELETE FROM workout_points WHERE workout_id = ?"

  /** (id) */
  const val DELETE_WORKOUT = "DELETE FROM workouts WHERE id = ?"

  /** (device, start, end, kept_start) */
  const val UPSERT_WORKOUT_SHADOW = "INSERT OR REPLACE INTO workout_shadow (device, start, end, kept_start) VALUES (?, ?, ?, ?)"

  /** (workout_number, start, end, sport_type, sport_name, duration, distance, calories, avg_hr, max_hr, steps, summary_json, complete, device, phone_gps) */
  const val UPSERT_WORKOUT =
    """INSERT INTO workouts
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
         imported = 0"""

  /** (start) -> id */
  const val SELECT_WORKOUT_ID = "SELECT id FROM workouts WHERE start = ?"

  /** (start, device) -> start, end, workout_number: a workout this watch recorded (not imported), what a refetch needs to find it on the watch again. */
  const val SELECT_WORKOUT_TARGET = "SELECT start, end, workout_number FROM workouts WHERE start = ? AND device = ? AND imported = 0"

  /** (start, device) -> summary_json of a workout this watch recorded. */
  const val SELECT_WORKOUT_SUMMARY = "SELECT summary_json FROM workouts WHERE start = ? AND device = ? AND imported = 0"

  /** (summary_json, start): the row's `rev` moves with the update (migration trigger), so only this workout goes to the cloud again. */
  const val UPDATE_WORKOUT_SUMMARY = "UPDATE workouts SET summary_json = ? WHERE start = ?"

  /** (workout_id, ts, lat, lon, alt, hr, speed, cadence, stride, power) */
  const val INSERT_WORKOUT_POINT =
    "INSERT INTO workout_points (workout_id, ts, lat, lon, alt, hr, speed, cadence, stride, power) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"

  /** (device) -> newest end of the workouts this watch recorded: stored ones and the ones dropped as duplicates. */
  const val SELECT_WORKOUT_NEWEST_END =
    """SELECT MAX(e) FROM (
         SELECT MAX(end) AS e FROM workouts WHERE imported = 0 AND device = ?
         UNION ALL
         SELECT MAX(end) AS e FROM workout_shadow WHERE device = ?
       )"""

  /** (device) -> start of the oldest incomplete workout this watch (or an unattributed row) holds. */
  const val SELECT_WORKOUT_OLDEST_INCOMPLETE = "SELECT MIN(start) FROM workouts WHERE complete = 0 AND (device = ? OR device IS NULL)"
}
