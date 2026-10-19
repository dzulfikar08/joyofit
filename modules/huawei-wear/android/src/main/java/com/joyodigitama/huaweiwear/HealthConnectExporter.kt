package com.joyodigitama.huaweiwear

import android.content.Context
import android.content.SharedPreferences
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.OxygenSaturationRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.metadata.Device
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.units.Energy
import androidx.health.connect.client.units.Length
import androidx.health.connect.client.units.Percentage
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.Locale
import kotlin.reflect.KClass
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** What one export wrote, in records. `toJs` is `HealthConnectExportResult` in `HuaweiWear.types.ts`. */
internal class HealthConnectCounts {
  var steps = 0
  var distance = 0
  var calories = 0
  var heartRate = 0
  var spo2 = 0
  var restingHeartRate = 0
  var sleep = 0

  /** Sleep sessions of an earlier build asked to be deleted (not part of [total] or of `HealthConnectExportResult`). */
  var sleepRemoved = 0
  var workouts = 0

  val total get() = steps + distance + calories + heartRate + spo2 + restingHeartRate + sleep + workouts

  fun toJs(): Map<String, Any?> = mapOf(
    "steps" to steps,
    "distance" to distance,
    "calories" to calories,
    "heartRate" to heartRate,
    "spo2" to spo2,
    "restingHeartRate" to restingHeartRate,
    "sleep" to sleep,
    "workouts" to workouts,
  )

  override fun toString() =
    "steps=$steps distance=$distance calories=$calories hr=$heartRate spo2=$spo2 restingHr=$restingHeartRate sleep=$sleep sleepRemoved=$sleepRemoved workouts=$workouts"
}

/** Health Connect switch and the last export's outcome; private preferences, readable without JS. */
internal class HealthConnectSettings(context: Context) {
  private val prefs: SharedPreferences =
    context.applicationContext.getSharedPreferences("joyofit_health_connect", Context.MODE_PRIVATE)

  var enabled: Boolean
    get() = prefs.getBoolean(KEY_ENABLED, false)
    set(value) = prefs.edit().putBoolean(KEY_ENABLED, value).apply()

  /** Unix seconds of the last export that finished without an error, 0 if none. */
  var lastExportSec: Long
    get() = prefs.getLong(KEY_LAST_EXPORT, 0L)
    set(value) = prefs.edit().putLong(KEY_LAST_EXPORT, value).apply()

  var lastError: String?
    get() = prefs.getString(KEY_LAST_ERROR, null)
    set(value) = prefs.edit().apply { if (value == null) remove(KEY_LAST_ERROR) else putString(KEY_LAST_ERROR, value) }.apply()

  /** `start|end|calories|distance` of every workout already written, so each is exported once and again only if it changes. */
  var exportedWorkouts: Set<String>
    get() = prefs.getStringSet(KEY_WORKOUTS, emptySet()) ?: emptySet()
    set(value) = prefs.edit().putStringSet(KEY_WORKOUTS, HashSet(value)).apply()

  var lastCounts: String?
    get() = prefs.getString(KEY_COUNTS, null)
    set(value) = prefs.edit().apply { if (value == null) remove(KEY_COUNTS) else putString(KEY_COUNTS, value) }.apply()

  /** The [SleepCleaning.SLEEP_RULES_VERSION] the whole stored sleep was last exported under; 0 before any such export. */
  var sleepRulesVersion: Int
    get() = prefs.getInt(KEY_SLEEP_RULES, 0)
    set(value) = prefs.edit().putInt(KEY_SLEEP_RULES, value).apply()

  private companion object {
    const val KEY_ENABLED = "enabled"
    const val KEY_LAST_EXPORT = "last_export_sec"
    const val KEY_LAST_ERROR = "last_error"
    const val KEY_WORKOUTS = "exported_workouts"
    const val KEY_COUNTS = "last_counts"
    const val KEY_SLEEP_RULES = "sleep_rules_version"
  }
}

/**
 * Writes the watch data stored in `joyofit.db` into Health Connect, from native code only, so it
 * works from the background service with no JS running. Each sync exports its window; the backfill
 * walks the whole table. Both read the stored rows, plan records with [HealthConnectPlan] and
 * insert them with a client record id and a version equal to the export time, which makes the
 * Health Connect insert an upsert: exporting a window twice leaves one record per minute/hour/night.
 *
 * Record types: StepsRecord, DistanceRecord and ActiveCaloriesBurnedRecord per minute,
 * HeartRateRecord as one series per hour, OxygenSaturationRecord per reading, RestingHeartRateRecord
 * per day, SleepSessionRecord with stages, ExerciseSessionRecord per workout (the workout's own
 * energy is not written again: the per-minute calories already cover it, and adding it would count
 * it twice for readers that sum energy). Types the user has not granted are skipped.
 */
internal class HealthConnectExporter(
  context: Context,
  private val syncStore: SyncStore,
  private val events: WearEvents,
  private val scope: CoroutineScope,
) {
  private val appContext = context.applicationContext
  val settings = HealthConnectSettings(appContext)
  private val mutex = Mutex()

  @Volatile
  var exporting = false
    private set

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, "HealthConnect: $message")

  private fun logError(message: String) = events.log(LogDirection.ERROR, null, null, null, "HealthConnect: $message")

  // Availability and permissions

  /** `available`, `update-required` (the Health Connect app must be updated) or `unavailable`. */
  fun availability(): String = when (HealthConnectClient.getSdkStatus(appContext)) {
    HealthConnectClient.SDK_AVAILABLE -> "available"
    HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "update-required"
    else -> "unavailable"
  }

  private fun client(): HealthConnectClient {
    if (availability() != "available") {
      throw WearException(ErrorCodes.UNSUPPORTED, "Health Connect is not available on this phone (${availability()})")
    }
    return HealthConnectClient.getOrCreate(appContext)
  }

  /** Permissions the request dialog asks for. */
  fun requiredPermissions(): Set<String> = TYPES.map { HealthPermission.getWritePermission(it.second) }.toSet()

  suspend fun grantedPermissions(): Set<String> =
    if (availability() == "available") client().permissionController.getGrantedPermissions() else emptySet()

  /** `HealthConnectStatus` in `HuaweiWear.types.ts`. */
  suspend fun status(): Map<String, Any?> {
    val granted = grantedPermissions()
    return mapOf(
      "availability" to availability(),
      "enabled" to settings.enabled,
      "granted" to TYPES.filter { HealthPermission.getWritePermission(it.second) in granted }.map { it.first },
      "missing" to TYPES.filter { HealthPermission.getWritePermission(it.second) !in granted }.map { it.first },
      "exporting" to exporting,
      "lastExportSec" to settings.lastExportSec.takeIf { it > 0 },
      "lastError" to settings.lastError,
      "lastCounts" to settings.lastCounts,
    )
  }

  /**
   * Switches the export on or off. Switching on needs Health Connect and at least one granted write
   * permission, then runs the backfill once; switching off only stops later exports (records already
   * written stay in Health Connect; the user removes them there).
   */
  suspend fun setEnabled(enabled: Boolean) {
    if (!enabled) {
      settings.enabled = false
      return
    }
    if (grantedPermissions().none { it in requiredPermissions() }) {
      throw WearException(ErrorCodes.UNSUPPORTED, "Grant Health Connect write permission first")
    }
    settings.enabled = true
    backfill()
  }

  // Triggers

  /** After every stored sync: export that sync's window (fire and forget; failures are logged). */
  fun onSyncComplete(summary: SyncSummary) {
    if (!settings.enabled) return
    scope.launch(Dispatchers.IO) {
      try {
        mutex.withLock {
          run("sync window") { c, g, v, d -> exportWindow(c, g, v, d, summary.from) }
          if (sleepRepairDue()) run("sleep repair") { c, g, v, d -> repairSleep(c, g, v, d) }
        }
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        fail(e)
      }
    }
  }

  /**
   * On app or service start: when the sleep rules changed since the last export ([SleepCleaning.SLEEP_RULES_VERSION]),
   * rewrites the stored sleep now instead of waiting for the next sync. Does nothing while the export is off or
   * Health Connect is not there.
   */
  fun repairSleepIfDue() {
    if (!sleepRepairDue() || availability() != "available") return
    scope.launch(Dispatchers.IO) {
      try {
        mutex.withLock {
          if (sleepRepairDue()) run("sleep repair") { c, g, v, d -> repairSleep(c, g, v, d) }
        }
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        fail(e)
      }
    }
  }

  private fun sleepRepairDue() = settings.enabled && SleepRulesRepair.due(settings.sleepRulesVersion)

  /** Writes everything stored so far; resolves with the counts and keeps running if the caller goes away. */
  suspend fun backfill(): Map<String, Any?> {
    val job: Deferred<HealthConnectCounts> = scope.async(Dispatchers.IO) {
      mutex.withLock {
        settings.exportedWorkouts = emptySet()
        run("backfill") { c, g, v, d -> exportAll(c, g, v, d) }
      }
    }
    return try {
      job.await().toJs()
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      fail(e)
      throw WearException(ErrorCodes.STORAGE, "Health Connect export failed: ${e.message}", e)
    }
  }

  private fun fail(e: Exception) {
    val message = e.message ?: e.javaClass.simpleName
    settings.lastError = message
    logError("export failed: $message")
  }

  private suspend fun run(
    label: String,
    body: suspend (HealthConnectClient, Set<String>, Long, Device) -> HealthConnectCounts,
  ): HealthConnectCounts {
    val client = client()
    val granted = client.permissionController.getGrantedPermissions()
    val missing = TYPES.filter { HealthPermission.getWritePermission(it.second) !in granted }.map { it.first }
    if (missing.size == TYPES.size) {
      settings.lastError = "Health Connect write permission is not granted"
      throw WearException(ErrorCodes.UNSUPPORTED, "no Health Connect write permission is granted")
    }
    if (missing.isNotEmpty()) log("skipping types without permission: ${missing.joinToString()}")
    exporting = true
    log("$label: start")
    try {
      val device = withContext(Dispatchers.IO) { deviceInfo() }
      val counts = body(client, granted, System.currentTimeMillis(), device)
      settings.lastExportSec = System.currentTimeMillis() / 1000
      settings.lastError = null
      settings.lastCounts = counts.toString()
      log("$label: wrote $counts")
      return counts
    } finally {
      exporting = false
    }
  }

  // Export bodies

  private fun deviceInfo(): Device {
    val (name, productModel) = syncStore.read { db ->
      db.rawQuery("SELECT name, product_model FROM device ORDER BY is_primary DESC, last_sync DESC LIMIT 1", null).use {
        if (it.moveToFirst()) it.getString(0) to (if (it.isNull(1)) null else it.getString(1)) else null to null
      }
    }
    val manufacturer = if (name?.trim()?.lowercase(Locale.ROOT)?.startsWith("honor") == true) "Honor" else "Huawei"
    // "Watch GT 4" without the brand, which is the manufacturer field.
    val catalogModel = WatchModels.match(name).model?.name?.substringAfter(' ')
    return Device(manufacturer = manufacturer, model = productModel ?: catalogModel, type = Device.TYPE_WATCH)
  }

  private suspend fun exportWindow(
    client: HealthConnectClient,
    granted: Set<String>,
    version: Long,
    device: Device,
    fromSec: Long,
  ): HealthConnectCounts {
    val counts = HealthConnectCounts()
    exportSamples(client, granted, version, device, fromSec, Long.MAX_VALUE, counts)
    exportSleep(client, granted, version, device, fromSec - SLEEP_LOOKBACK_SEC, counts)
    exportWorkouts(client, granted, version, device, counts)
    return counts
  }

  private suspend fun exportAll(
    client: HealthConnectClient,
    granted: Set<String>,
    version: Long,
    device: Device,
  ): HealthConnectCounts {
    val counts = HealthConnectCounts()
    val bounds = withContext(Dispatchers.IO) {
      syncStore.read { db ->
        db.rawQuery("SELECT MIN(timestamp), MAX(timestamp) FROM step_samples WHERE imported = 0", null).use {
          if (it.moveToFirst() && !it.isNull(0)) it.getLong(0) to it.getLong(1) else null
        }
      }
    }
    if (bounds != null) {
      val zone = ZoneId.systemDefault()
      var start = dayStart(bounds.first, zone)
      while (start <= bounds.second) {
        val next = nextDayStart(start, zone)
        exportSamples(client, granted, version, device, start, next, counts)
        start = next
      }
    }
    if (exportSleep(client, granted, version, device, 0L, counts)) settings.sleepRulesVersion = SleepCleaning.SLEEP_RULES_VERSION
    exportWorkouts(client, granted, version, device, counts)
    return counts
  }

  private fun loadSamples(db: WearDatabase, fromSec: Long, toSec: Long): List<StepSample> =
    db.rawQuery(
      """SELECT timestamp, steps, calories, distance, heart_rate, spo2, resting_heart_rate
         FROM step_samples WHERE imported = 0 AND timestamp >= ? AND timestamp < ? ORDER BY timestamp""",
      arrayOf(fromSec.toString(), toSec.toString()),
    ).use { c ->
      val out = ArrayList<StepSample>(c.count)
      while (c.moveToNext()) {
        out.add(
          StepSample(
            timestamp = c.getLong(0),
            steps = c.getInt(1),
            calories = c.getInt(2),
            distance = c.getInt(3),
            heartRate = if (c.isNull(4)) null else c.getInt(4),
            spo2 = if (c.isNull(5)) null else c.getInt(5),
            restingHeartRate = if (c.isNull(6)) null else c.getInt(6),
          ),
        )
      }
      out
    }

  /**
   * Samples in [writeFrom, writeTo). Heart-rate hours are rebuilt from whole hours, so the rows are
   * loaded from the hour containing [writeFrom] to the end of the hour containing [writeTo].
   */
  private suspend fun exportSamples(
    client: HealthConnectClient,
    granted: Set<String>,
    version: Long,
    device: Device,
    writeFrom: Long,
    writeTo: Long,
    counts: HealthConnectCounts,
  ) {
    val loadFrom = Math.floorDiv(writeFrom, HealthConnectPlan.HEART_SERIES_SEC) * HealthConnectPlan.HEART_SERIES_SEC
    val loadTo = if (writeTo == Long.MAX_VALUE) Long.MAX_VALUE else Math.floorDiv(writeTo + HealthConnectPlan.HEART_SERIES_SEC - 1, HealthConnectPlan.HEART_SERIES_SEC) * HealthConnectPlan.HEART_SERIES_SEC
    val loaded = withContext(Dispatchers.IO) { syncStore.read { loadSamples(it, loadFrom, loadTo) } }
    if (loaded.isEmpty()) return
    val inWindow = loaded.filter { it.timestamp in writeFrom until writeTo }
    val zone = ZoneId.systemDefault()
    fun offset(sec: Long): ZoneOffset = zone.rules.getOffset(Instant.ofEpochSecond(sec))
    fun meta(id: String) = Metadata.autoRecorded(device, id, version)

    fun has(type: KClass<out Record>) = HealthPermission.getWritePermission(type) in granted

    if (has(StepsRecord::class)) {
      val records = HealthConnectPlan.steps(inWindow, writeFrom).map {
        StepsRecord(
          Instant.ofEpochSecond(it.startSec), offset(it.startSec), Instant.ofEpochSecond(it.endSec), offset(it.endSec),
          it.value, meta(it.id),
        )
      }
      counts.steps += insert(client, records)
    }
    if (has(DistanceRecord::class)) {
      val records = HealthConnectPlan.distance(inWindow, writeFrom).map {
        DistanceRecord(
          Instant.ofEpochSecond(it.startSec), offset(it.startSec), Instant.ofEpochSecond(it.endSec), offset(it.endSec),
          Length.meters(it.value.toDouble()), meta(it.id),
        )
      }
      counts.distance += insert(client, records)
    }
    if (has(ActiveCaloriesBurnedRecord::class)) {
      val records = HealthConnectPlan.calories(inWindow, writeFrom).map {
        ActiveCaloriesBurnedRecord(
          Instant.ofEpochSecond(it.startSec), offset(it.startSec), Instant.ofEpochSecond(it.endSec), offset(it.endSec),
          // Step frames count small calories (1/1000 kcal), see StepSample.calories.
          Energy.calories(it.value.toDouble()), meta(it.id),
        )
      }
      counts.calories += insert(client, records)
    }
    if (has(HeartRateRecord::class)) {
      // Whole hours: rows were loaded from the hour start to the hour end, so a rewritten hour keeps all its minutes.
      val records = HealthConnectPlan.heartSeries(loaded).map { s ->
        HeartRateRecord(
          Instant.ofEpochSecond(s.startSec), offset(s.startSec), Instant.ofEpochSecond(s.endSec), offset(s.endSec),
          s.points.map { HeartRateRecord.Sample(Instant.ofEpochSecond(it.timeSec), it.value.toLong()) },
          meta(s.id),
        )
      }
      counts.heartRate += insert(client, records)
    }
    if (has(OxygenSaturationRecord::class)) {
      val records = HealthConnectPlan.spo2(inWindow, writeFrom).map {
        OxygenSaturationRecord(
          Instant.ofEpochSecond(it.timeSec), offset(it.timeSec), Percentage(it.value.toDouble()),
          meta(HealthConnectPlan.id("spo2", it.timeSec)),
        )
      }
      counts.spo2 += insert(client, records)
    }
    if (has(RestingHeartRateRecord::class)) {
      val records = HealthConnectPlan.restingHeartRate(inWindow, writeFrom) { localDay(it, zone) }.map { (id, p) ->
        RestingHeartRateRecord(Instant.ofEpochSecond(p.timeSec), offset(p.timeSec), p.value.toLong(), meta(id))
      }
      counts.restingHeartRate += insert(client, records)
    }
  }

  /**
   * Sessions ending at or after [fromSec], planned from the stored sleep with its stage-less rows cleaned
   * ([SleepStore]). Records an earlier build wrote for sessions the cleaned plan no longer has (see
   * [HealthConnectPlan.staleSleepIds]) are deleted; only records this app wrote can be deleted. Returns false when the
   * sleep permission is missing and nothing was done.
   */
  private suspend fun exportSleep(
    client: HealthConnectClient,
    granted: Set<String>,
    version: Long,
    device: Device,
    fromSec: Long,
    counts: HealthConnectCounts,
  ): Boolean {
    if (HealthPermission.getWritePermission(SleepSessionRecord::class) !in granted) return false
    // Read a day before the window so a night that began before it is seen whole.
    val (raw, segments) = withContext(Dispatchers.IO) {
      syncStore.read { db ->
        val rows = SleepStore.loadRaw(db, fromSec - 24 * 3600L - SleepStore.CLEAN_MARGIN_SEC, importedOnly = true)
        rows to SleepStore.clean(db, rows)
      }
    }
    val zone = ZoneId.systemDefault()
    fun offset(sec: Long): ZoneOffset = zone.rules.getOffset(Instant.ofEpochSecond(sec))
    val plan = HealthConnectPlan.sleepSessions(segments, fromSec)
    val records = plan.map { s ->
      SleepSessionRecord(
        Instant.ofEpochSecond(s.startSec), offset(s.startSec), Instant.ofEpochSecond(s.endSec), offset(s.endSec),
        Metadata.autoRecorded(device, s.id, version),
        "Sleep",
        null,
        s.stages.map {
          SleepSessionRecord.Stage(Instant.ofEpochSecond(it.startSec), Instant.ofEpochSecond(it.endSec), sleepStageType(it.stage))
        },
      )
    }
    counts.sleep += insert(client, records)
    val stale = HealthConnectPlan.staleSleepIds(raw, plan, fromSec)
    for (chunk in stale.chunked(INSERT_CHUNK)) {
      client.deleteRecords(SleepSessionRecord::class, emptyList(), chunk)
    }
    counts.sleepRemoved += stale.size
    return true
  }

  /**
   * After an update that changed the sleep rules ([SleepCleaning.SLEEP_RULES_VERSION]): writes every stored night again
   * and deletes the sessions the old rules wrote. Ran at most once per version; the marker is only set when the whole
   * history went through, so a failed or permission-less run is tried again at the next sync or app start.
   */
  private suspend fun repairSleep(
    client: HealthConnectClient,
    granted: Set<String>,
    version: Long,
    device: Device,
  ): HealthConnectCounts {
    val counts = HealthConnectCounts()
    if (exportSleep(client, granted, version, device, 0L, counts)) settings.sleepRulesVersion = SleepCleaning.SLEEP_RULES_VERSION
    return counts
  }

  /**
   * Completed workouts not written yet (or changed since: the signature covers the end, energy and
   * distance), as ExerciseSessionRecord keyed by the workout's start time. Skipped when the table
   * does not exist (a build without workout sync).
   */
  private suspend fun exportWorkouts(
    client: HealthConnectClient,
    granted: Set<String>,
    version: Long,
    device: Device,
    counts: HealthConnectCounts,
  ) {
    if (HealthPermission.getWritePermission(ExerciseSessionRecord::class) !in granted) return
    val written = settings.exportedWorkouts
    val rows = withContext(Dispatchers.IO) { syncStore.read { loadWorkouts(it) } }.filter { it.signature() !in written }
    if (rows.isEmpty()) return
    val zone = ZoneId.systemDefault()
    fun offset(sec: Long): ZoneOffset = zone.rules.getOffset(Instant.ofEpochSecond(sec))
    val records = rows.map { w ->
      ExerciseSessionRecord(
        Instant.ofEpochSecond(w.start), offset(w.start), Instant.ofEpochSecond(w.end), offset(w.end),
        Metadata.activelyRecorded(device, HealthConnectPlan.id("workout", w.start), version),
        HealthConnectExercise.type(w.sportType),
        w.name,
        w.notes(),
      )
    }
    counts.workouts += insert(client, records)
    settings.exportedWorkouts = written + rows.map { it.signature() }
  }

  private class WorkoutRow(
    val start: Long,
    val end: Long,
    val sportType: Int,
    val name: String?,
    val distance: Int?,
    val calories: Int?,
    val avgHr: Int?,
    val maxHr: Int?,
  ) {
    fun signature() = "$start|$end|${calories ?: 0}|${distance ?: 0}"

    fun notes(): String? {
      val parts = ArrayList<String>()
      distance?.takeIf { it > 0 }?.let { parts.add("%.2f km".format(java.util.Locale.ROOT, it / 1000.0)) }
      calories?.takeIf { it > 0 }?.let { parts.add("$it kcal") }
      avgHr?.takeIf { it > 0 }?.let { parts.add("avg HR $it") }
      maxHr?.takeIf { it > 0 }?.let { parts.add("max HR $it") }
      return if (parts.isEmpty()) null else "JoyoFit: " + parts.joinToString(", ")
    }
  }

  private fun loadWorkouts(db: WearDatabase): List<WorkoutRow> {
    val exists = db.rawQuery("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'workouts'", null).use { it.moveToFirst() }
    if (!exists) return emptyList()
    return db.rawQuery(
      """SELECT start, end, duration, sport_type, sport_name, distance, calories, avg_hr, max_hr
         FROM workouts WHERE imported = 0 AND complete = 1 ORDER BY start""",
      null,
    ).use { c ->
      fun int(i: Int): Int? = if (c.isNull(i)) null else c.getInt(i)
      val out = ArrayList<WorkoutRow>()
      while (c.moveToNext()) {
        val start = c.getLong(0)
        val end = if (!c.isNull(1) && c.getLong(1) > start) c.getLong(1) else start + (int(2) ?: 0)
        if (end <= start) continue
        out.add(WorkoutRow(start, end, int(3) ?: 255, c.getString(4), int(5), int(6), int(7), int(8)))
      }
      out
    }
  }

  private suspend fun insert(client: HealthConnectClient, records: List<Record>): Int {
    for (chunk in records.chunked(INSERT_CHUNK)) client.insertRecords(chunk)
    return records.size
  }

  companion object {
    /** Health Connect accepts at most 1000 records per insert. */
    private const val INSERT_CHUNK = 500

    /** A sync window reaches this far back for sleep, so a night that straddles it is written whole. */
    private const val SLEEP_LOOKBACK_SEC = 36 * 3600L

    /** Friendly name and record class of every type written; the name is what JS sees in `granted`/`missing`. */
    val TYPES: List<Pair<String, KClass<out Record>>> = listOf(
      "Steps" to StepsRecord::class,
      "HeartRate" to HeartRateRecord::class,
      "OxygenSaturation" to OxygenSaturationRecord::class,
      "RestingHeartRate" to RestingHeartRateRecord::class,
      "Distance" to DistanceRecord::class,
      "ActiveCaloriesBurned" to ActiveCaloriesBurnedRecord::class,
      "SleepSession" to SleepSessionRecord::class,
      "ExerciseSession" to ExerciseSessionRecord::class,
    )

    fun sleepStageType(kind: HealthConnectPlan.SleepStageKind): Int = when (kind) {
      HealthConnectPlan.SleepStageKind.SLEEPING -> SleepSessionRecord.STAGE_TYPE_SLEEPING
      HealthConnectPlan.SleepStageKind.LIGHT -> SleepSessionRecord.STAGE_TYPE_LIGHT
      HealthConnectPlan.SleepStageKind.DEEP -> SleepSessionRecord.STAGE_TYPE_DEEP
      HealthConnectPlan.SleepStageKind.REM -> SleepSessionRecord.STAGE_TYPE_REM
      HealthConnectPlan.SleepStageKind.AWAKE -> SleepSessionRecord.STAGE_TYPE_AWAKE
    }

    private fun localDay(sec: Long, zone: ZoneId): String = Instant.ofEpochSecond(sec).atZone(zone).toLocalDate().toString()

    private fun dayStart(sec: Long, zone: ZoneId): Long =
      Instant.ofEpochSecond(sec).atZone(zone).toLocalDate().atStartOfDay(zone).toEpochSecond()

    private fun nextDayStart(startSec: Long, zone: ZoneId): Long =
      Instant.ofEpochSecond(startSec).atZone(zone).toLocalDate().plusDays(1).atStartOfDay(zone).toEpochSecond()
  }
}
