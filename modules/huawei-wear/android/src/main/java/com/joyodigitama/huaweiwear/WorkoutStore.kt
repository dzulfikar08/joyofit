package com.joyodigitama.huaweiwear

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Writes workouts into the shared database (`workouts`, `workout_points`; migration 3 in
 * `schema/joyofit-db-migrations.json`) through [SyncStore]'s connection. A workout is replaced as a whole in one
 * transaction: the row is upserted by `start` (the id stays), its old points are deleted and the new ones inserted.
 *
 * [address] is the watch that is writing (the connected one): it is stored in `workouts.device`, and a session that
 * another watch already recorded is stored once ([WorkoutWriter], docs/multi-watch.md section 3).
 */
internal class WorkoutStore(private val store: SyncStore, private val address: String) : WorkoutSink, DynamicsSink {
  override suspend fun isComplete(start: Long, end: Long): Boolean = withContext(Dispatchers.IO) {
    WorkoutWriter(AndroidWatchDb(store.db()), address).isComplete(start, end)
  }

  override suspend fun save(record: WorkoutRecord): Boolean = withContext(Dispatchers.IO) {
    WorkoutWriter(AndroidWatchDb(store.db()), address).save(record)
  }

  /**
   * Start of the next workout window, unix seconds: everything after the newest workout this watch recorded (from
   * 2000-01-01, so everything the watch holds, when there is none); the start of the oldest incomplete workout wins over
   * that so it is downloaded again. [fullHistory] always starts from 2000-01-01; stored workouts upsert by start.
   */
  suspend fun syncStart(fullHistory: Boolean = false): Int = withContext(Dispatchers.IO) {
    WorkoutWriter(AndroidWatchDb(store.db()), address).syncStart(fullHistory)
  }

  /** The stored workouts of this watch among [starts] (unix seconds), in the order given; a start this watch has no copy of is left out. */
  suspend fun refetchTargets(starts: List<Long>): List<RefetchTarget> = withContext(Dispatchers.IO) {
    val writer = WorkoutWriter(AndroidWatchDb(store.db()), address)
    starts.mapNotNull { writer.refetchTarget(it) }
  }

  override suspend fun merge(start: Long, dynamics: RunDynamics.Result): DynamicsMerge = withContext(Dispatchers.IO) {
    WorkoutWriter(AndroidWatchDb(store.db()), address).mergeDynamics(start, dynamics)
  }

  fun backfillConnectedGps(session: ConnectedGpsSession): Int =
    ConnectedGpsMerger.backfillStored(AndroidWatchDb(store.db()), address, session)

  companion object {
    /** 2000-01-01 00:00:00 UTC; GB's own fallback (2022-06-10) is an app-imposed limit this app does not keep. */
    const val DEFAULT_START_SEC = 946684800L
  }
}

/** The workout statements of one watch on one [WatchDb]; [WorkoutStore] is the Android wrapper. */
internal class WorkoutWriter(
  private val db: WatchDb,
  private val address: String,
  private val gpsStore: ConnectedGpsStore = ConnectedGpsStore.shared,
) {
  /** True when a complete copy with this start and end is stored, or this watch's copy was dropped for another watch's. */
  fun isComplete(start: Long, end: Long): Boolean =
    db.query(WatchSql.SELECT_WORKOUT_DONE, start, end, start, end, address).isNotEmpty()

  /**
   * Stores the workout and its points, replacing an earlier copy with the same start. True if it is new or was incomplete;
   * false when it was already complete, or when another watch's copy of the same session is kept instead (then this one is
   * only noted in `workout_shadow`).
   *
   * When [rawRecord] has no GPS points of its own (for example a Huawei Band without built-in GNSS), attaches a matching
   * phone Connected GPS trajectory from [gpsStore] after duplicate resolution and before persistence.
   */
  fun save(rawRecord: WorkoutRecord): Boolean = db.transaction {
    if (!resolveDuplicates(rawRecord)) return@transaction false
    val record = ConnectedGpsMerger.merge(rawRecord, gpsStore)
    val hasPhoneGps = record.points.size > rawRecord.points.size || record.summaryJson.contains("\"gpsSource\":\"phone\"")
    val wasComplete = db.query(WatchSql.SELECT_WORKOUT_COMPLETE, record.start).firstOrNull()?.let { (it[0] as Long) == 1L }
    db.exec(
      WatchSql.UPSERT_WORKOUT,
      record.number,
      record.start,
      record.end,
      record.sportType,
      record.sportName,
      record.duration,
      record.distance,
      record.calories,
      record.avgHr,
      record.maxHr,
      record.steps,
      record.summaryJson,
      if (record.complete) 1 else 0,
      address,
      if (hasPhoneGps) 1 else 0,
    )
    val id = db.query(WatchSql.SELECT_WORKOUT_ID, record.start).first()[0] as Long
    db.exec(WatchSql.DELETE_WORKOUT_POINTS, id)
    db.insertPoints(id, record.points)
    wasComplete != true
  }

  /** The workout this watch recorded that started at [start], as the watch has to be asked for it; null for another watch's, an imported or an unknown one. */
  fun refetchTarget(start: Long): RefetchTarget? =
    db.query(WatchSql.SELECT_WORKOUT_TARGET, start, address).firstOrNull()?.let {
      RefetchTarget(it[0] as Long, it[1] as Long, (it[2] as Long).toInt())
    }

  /**
   * Puts the running form read from the watch into the stored summary of the workout at [start] and nothing else (points, totals and
   * every other summary field stay). The row is only written when the form differs, so a second refetch does not move its `rev` and
   * the cloud copy is replaced for the workouts that changed only.
   */
  fun mergeDynamics(start: Long, dynamics: RunDynamics.Result): DynamicsMerge = db.transaction {
    val stored = db.query(WatchSql.SELECT_WORKOUT_SUMMARY, start, address).firstOrNull()?.get(0) as String?
      ?: return@transaction DynamicsMerge.NOT_STORED
    val merged = RunDynamics.merge(stored, dynamics) ?: return@transaction DynamicsMerge.NOT_STORED
    if (!merged.changed) return@transaction DynamicsMerge.UNCHANGED
    db.exec(WatchSql.UPDATE_WORKOUT_SUMMARY, merged.json, start)
    DynamicsMerge.UPDATED
  }

  /**
   * Looks for copies of [record]'s session recorded by other watches. When one of them wins ([incomingWinsDuplicate]) the
   * record is not stored: it is noted in `workout_shadow` and this returns false. Otherwise the copies it beats are
   * deleted with their points, each noted in `workout_shadow`, and this returns true.
   */
  private fun resolveDuplicates(record: WorkoutRecord): Boolean {
    val candidates = db.query(WatchSql.SELECT_WORKOUT_CANDIDATES, address, record.end, record.start)
    if (candidates.isEmpty()) return true
    val primary = db.query(WatchSql.SELECT_PRIMARY_DEVICE).firstOrNull()?.get(0) as String?
    val incoming = WorkoutSpan(record.start, record.end, address, record.points.any { it.lat != null && it.lon != null })
    val losers = ArrayList<List<Any?>>()
    for (row in candidates) {
      val stored = WorkoutSpan(row[1] as Long, row[2] as Long, row[3] as String, (row[4] as Long) != 0L)
      if (!isCrossWatchDuplicate(incoming, stored)) continue
      if (!incomingWinsDuplicate(incoming, stored, primary)) {
        db.exec(WatchSql.UPSERT_WORKOUT_SHADOW, address, record.start, record.end, stored.start)
        return false
      }
      losers.add(row)
    }
    for (row in losers) {
      db.exec(WatchSql.DELETE_WORKOUT_POINTS, row[0])
      db.exec(WatchSql.DELETE_WORKOUT, row[0])
      db.exec(WatchSql.UPSERT_WORKOUT_SHADOW, row[3], row[1], row[2], record.start)
    }
    return true
  }

  fun syncStart(fullHistory: Boolean): Int {
    if (fullHistory) return WorkoutStore.DEFAULT_START_SEC.toInt()
    // Workouts imported from a Huawei export say nothing about what the watch still holds.
    val newestEnd = db.query(WatchSql.SELECT_WORKOUT_NEWEST_END, address, address).firstOrNull()?.get(0) as Long?
    val oldestIncomplete = db.query(WatchSql.SELECT_WORKOUT_OLDEST_INCOMPLETE, address).firstOrNull()?.get(0) as Long?
    val start = when {
      newestEnd == null -> WorkoutStore.DEFAULT_START_SEC
      oldestIncomplete != null -> minOf(oldestIncomplete, newestEnd + 1)
      else -> newestEnd + 1
    }
    return minOf(start, Int.MAX_VALUE.toLong()).toInt()
  }
}
