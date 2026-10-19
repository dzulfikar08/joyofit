package com.joyodigitama.huaweiwear

import android.content.Context
import android.database.sqlite.SQLiteException
import java.io.File
import org.json.JSONArray

/** Re-request this much already-stored history on every sync; upserts make the overlap idempotent. */
internal const val SYNC_OVERLAP_SEC = 3600L

/** One request chain covers at most this much of a long pull, so a full history never becomes a single endless request. */
internal const val SYNC_SLICE_SEC = 14 * 24 * 3600L

/** History older than this is requested as one slice by [syncSlices]. */
internal const val SYNC_HEAD_SEC = 8 * 7 * 24 * 3600L

/**
 * Start of the next sync window, unix seconds: 0 (everything the watch still holds) on the first sync, else 1 h before
 * the last one.
 */
internal fun syncWindowStart(lastSyncSec: Long?): Long =
  if (lastSyncSec == null) 0L else maxOf(0L, lastSyncSec - SYNC_OVERLAP_SEC)

/**
 * Consecutive `[from, to]` slices from [fromSec] up to [nowSec], oldest first. Everything older than [SYNC_HEAD_SEC]
 * is one slice (the watch pages it itself, and an empty stretch costs one count request, not hundreds), the recent
 * part is cut into [SYNC_SLICE_SEC] pieces.
 */
internal fun syncSlices(fromSec: Long, nowSec: Long): List<Pair<Long, Long>> {
  val slices = ArrayList<Pair<Long, Long>>()
  var start = fromSec
  val headEnd = nowSec - SYNC_HEAD_SEC
  if (start < headEnd) {
    slices.add(start to headEnd)
    start = headEnd
  }
  while (start < nowSec - SYNC_SLICE_SEC) {
    slices.add(start to start + SYNC_SLICE_SEC)
    start += SYNC_SLICE_SEC
  }
  slices.add(start to nowSec)
  return slices
}

/** What one stored sync reports to JS (`SyncSummary` in `HuaweiWear.types.ts`). */
internal class SyncSummary(
  val from: Long,
  val to: Long,
  val samples: Int,
  val sleep: Int,
  val totalSteps: Int,
  val totalCalories: Int,
  val totalDistance: Int,
  /** Workouts written (new or completed) by this sync's workout phase. */
  val workouts: Int = 0,
) {
  fun withWorkouts(count: Int) =
    SyncSummary(from, to, samples, sleep, totalSteps, totalCalories, totalDistance, count)

  fun toJs(): Map<String, Any?> = mapOf(
    "from" to from,
    "to" to to,
    "samples" to samples,
    "workouts" to workouts,
    "sleep" to sleep,
    "totals" to mapOf(
      "steps" to totalSteps,
      "calories" to totalCalories,
      "distance" to totalDistance,
    ),
  )
}

/**
 * Writes sync results into the database the JS side reads with expo-sqlite: `joyofit.db` in
 * `<filesDir>/SQLite` (expo-sqlite's `defaultDatabaseDirectory` + the name `_layout.tsx` opens).
 * Schema and migrations come from the same JSON asset JS imports
 * (`modules/huawei-wear/schema/joyofit-db-migrations.json`); `PRAGMA user_version` counts applied
 * migrations in both. Upserts are the ones `src/db/queries.ts` used to run from JS.
 *
 * The connection is [WearDatabase], on the SQLite library of expo-sqlite, never `android.database.sqlite`: two copies of the
 * library in one process do not lock each other out and corrupt a file they share (see [ExpoSqliteConnection]).
 */
internal class SyncStore(context: Context) {
  private val appContext = context.applicationContext
  private val file = File(File(appContext.filesDir, "SQLite"), DATABASE_NAME)
  private var database: WearDatabase? = null

  /** True while JS replaces the file ([release]): no connection is opened, every access fails as a storage error. */
  private var released = false

  @Synchronized
  internal fun db(): WearDatabase {
    database?.let { return it }
    if (released) throw SQLiteException("The database is being repaired")
    file.parentFile?.mkdirs()
    // JS may hold the file briefly (its own migration, a write): wait for it instead of failing.
    val opened = WearDatabase.open(file.path, BUSY_TIMEOUT_MS)
    try {
      migrate(opened, loadMigrations())
    } catch (e: Exception) {
      opened.close()
      throw e
    }
    database = opened
    return opened
  }

  /**
   * Closes the connection and keeps it closed until [resume]: the repair of a damaged file (`src/db/recovery`) replaces the
   * file, and a replaced file must not be open here. Waits for a transaction that is running; what uses the old connection
   * afterwards fails with a storage error and tries again later.
   */
  fun release() {
    val open = synchronized(this) {
      released = true
      database.also { database = null }
    }
    open?.close()
  }

  /** Lets [db] open the connection again after [release]. */
  @Synchronized
  fun resume() {
    released = false
  }

  private fun loadMigrations(): List<List<String>> {
    val json = appContext.assets.open(MIGRATIONS_ASSET).use { String(it.readBytes(), Charsets.UTF_8) }
    val all = JSONArray(json)
    return List(all.length()) { i ->
      val statements = all.getJSONArray(i)
      List(statements.length()) { statements.getString(it) }
    }
  }

  /** `migrate()` in `src/db/migrations.ts`: entry `i` upgrades `user_version` i to i + 1. */
  private fun migrate(db: WearDatabase, migrations: List<List<String>>) {
    val current = db.version
    if (current > migrations.size) {
      throw SQLiteException("Database schema v$current is newer than this app supports (v${migrations.size})")
    }
    for (version in current until migrations.size) {
      db.beginTransaction()
      try {
        // JS may have applied this step between the read above and taking the write lock.
        if (db.version <= version) {
          for (statement in migrations[version]) db.execSQL(statement)
          db.version = version + 1
        }
        db.setTransactionSuccessful()
      } finally {
        db.endTransaction()
      }
    }
  }

  /** Runs [block] against the open database; the Health Connect export reads stored rows through this. */
  fun <T> read(block: (WearDatabase) -> T): T = block(db())

  fun lastSync(address: String): Long? =
    db().rawQuery("SELECT last_sync FROM device WHERE address = ?", arrayOf(address)).use { cursor ->
      if (cursor.moveToFirst() && !cursor.isNull(0)) cursor.getLong(0) else null
    }

  /**
   * `upsertDevice` of the old JS queries: keeps `last_sync` of an existing row, and its alias, primary flag, switches and
   * `added_at`. A new row is primary when no watch is ([WatchSql.UPSERT_DEVICE]).
   */
  fun upsertDevice(address: String, name: String, productModel: String?, softwareVersion: String?) {
    db().execSQL(WatchSql.UPSERT_DEVICE, arrayOf(address, name, productModel, softwareVersion))
  }

  /** `(address, last_sync)` of the watches with `bg_sync = 1`; empty on a phone that never set it, which is the single-watch case. */
  fun bgSyncWatches(): List<Pair<String, Long?>> =
    db().rawQuery(WatchSql.SELECT_BG_SYNC_WATCHES, null).use { cursor ->
      val out = ArrayList<Pair<String, Long?>>(cursor.count)
      while (cursor.moveToNext()) out.add(cursor.getString(0).orEmpty() to (if (cursor.isNull(1)) null else cursor.getLong(1)))
      out
    }

  /** False when the user switched `tracks_health` off for [address]; read on every sync. A watch with no row tracks health. */
  fun tracksHealth(address: String): Boolean =
    db().rawQuery(WatchSql.SELECT_TRACKS_HEALTH, arrayOf(address)).use { cursor ->
      !cursor.moveToFirst() || cursor.isNull(0) || cursor.getInt(0) != 0
    }

  /** A sync of a watch that stores no health rows still counts as a sync. */
  fun touchLastSync(address: String, sec: Long) {
    db().execSQL(WatchSql.UPDATE_LAST_SYNC, arrayOf(sec, address))
  }

  /**
   * Persists one sync in a single transaction and advances `device.last_sync` to `result.to`; every row carries [address]
   * in `device` and the triggers of migration 14 decide against another watch's rows.
   */
  fun save(address: String, result: SyncResult): SyncSummary {
    val db = db()
    db.beginTransaction()
    try {
      val sample = db.compileStatement(WatchSql.UPSERT_STEP_SAMPLE)
      val segment = db.compileStatement(WatchSql.UPSERT_SLEEP_SEGMENT)
      try {
        for (s in result.samples) {
          sample.clearBindings()
          sample.bindLong(1, s.timestamp)
          sample.bindLong(2, s.steps.toLong())
          sample.bindLong(3, s.calories.toLong())
          sample.bindLong(4, s.distance.toLong())
          s.heartRate?.let { sample.bindLong(5, it.toLong()) } ?: sample.bindNull(5)
          s.spo2?.let { sample.bindLong(6, it.toLong()) } ?: sample.bindNull(6)
          s.restingHeartRate?.let { sample.bindLong(7, it.toLong()) } ?: sample.bindNull(7)
          sample.bindString(8, address)
          sample.executeInsert()
        }
        for (s in result.sleep) {
          segment.clearBindings()
          segment.bindLong(1, s.start)
          segment.bindLong(2, s.end)
          segment.bindLong(3, s.type.toLong())
          s.stage?.let { segment.bindString(4, it) } ?: segment.bindNull(4)
          segment.bindString(5, address)
          segment.executeInsert()
        }
      } finally {
        sample.close()
        segment.close()
      }
      for (s in result.sleepScores) {
        db.execSQL(
          WatchSql.UPSERT_SLEEP_SCORE,
          arrayOf<Any?>(s.start, s.end, s.score, s.efficiency, address),
        )
      }
      db.execSQL(WatchSql.UPDATE_LAST_SYNC, arrayOf(result.to, address))
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
    return SyncSummary(
      from = result.from,
      to = result.to,
      samples = result.samples.size,
      sleep = result.sleep.size,
      totalSteps = result.totalSteps,
      totalCalories = result.totalCalories,
      totalDistance = result.totalDistance,
    )
  }

  private companion object {
    /** Must match `DATABASE_NAME` in `src/app/_layout.tsx`. */
    const val DATABASE_NAME = "joyofit.db"
    const val MIGRATIONS_ASSET = "joyofit-db-migrations.json"
    const val BUSY_TIMEOUT_MS = 10_000
  }
}
