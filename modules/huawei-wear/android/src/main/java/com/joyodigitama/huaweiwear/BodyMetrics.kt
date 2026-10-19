// Layouts as Huawei Health 17.0.8.300 behaves on the wire (weight sync rows, health glance JSON) and
// the dictionary field ids from assets/dict_config.json (10006 bodyWeight 2004, bodyFatRate 2001, basalMetabolism 2024;
// 500018 basalMetabolism 500018055). UNVERIFIED on the Fit 4 Pro.
package com.joyodigitama.huaweiwear

import android.content.Context
import android.database.sqlite.SQLiteException
import kotlin.math.pow
import kotlin.math.roundToInt

/** What JoyoFit knows about the body: the JoyoRogo weigh-in and anything else JS hands over. Every field is optional. */
internal data class BodyMetricsData(
  val weightKg: Double? = null,
  val weightTsMs: Long? = null,
  val bodyFatPct: Double? = null,
  val bodyFatTsMs: Long? = null,
  /** Resting metabolism (BMR), kcal per day. */
  val restingKcal: Int? = null,
  val systolic: Int? = null,
  val diastolic: Int? = null,
  val bpTsMs: Long? = null,
) {
  fun toJs(): Map<String, Any?> = mapOf(
    "weightKg" to weightKg,
    "weightTs" to weightTsMs,
    "bodyFatPct" to bodyFatPct,
    "bodyFatTs" to bodyFatTsMs,
    "restingKcal" to restingKcal,
    "systolic" to systolic,
    "diastolic" to diastolic,
    "bpTs" to bpTsMs,
  )
}

/** Pure builders for the weight dictionary, the resting-metabolism dictionary and the Health Glance JSON. */
internal object BodyMetricsCodec {
  const val PHONE_PKG = "hw.unitedevice.weightMgr"
  const val WATCH_PKG = "hw.sport.dietcal"

  /** DicDataTypeUtil WEIGHT_BODYFAT_BROAD and its field ids (healthType in dict_config.json). */
  const val DICT_WEIGHT = 10006
  const val KEY_BODY_WEIGHT = 2004
  const val KEY_BODY_FAT_RATE = 2001
  const val KEY_BASAL_METABOLISM = 2024

  /** RESTING_METABOLISM_SET and its one field. */
  const val DICT_RESTING = 500018
  const val KEY_RESTING = 500018055

  const val GLANCE_PHONE_PKG = "hw.unitedevice.healthGlanceMgr"
  const val GLANCE_WATCH_PKG = "hw.watch.health.healthcheck"
  const val EVENT_GLANCE = 80030006

  /** One row; values are 8-byte little-endian doubles; unknown values are left out. */
  fun weightRow(weightKg: Double, tsMs: Long, bodyFatPct: Double?, basalKcal: Double?, modifyMs: Long): DictRow {
    val values = ArrayList<DictValue>()
    values += DictValue(KEY_BODY_WEIGHT, DataSyncBytes.doubleLe(weightKg))
    bodyFatPct?.let { values += DictValue(KEY_BODY_FAT_RATE, DataSyncBytes.doubleLe(it)) }
    basalKcal?.let { values += DictValue(KEY_BASAL_METABOLISM, DataSyncBytes.doubleLe(it)) }
    return DictRow(tsMs, tsMs, modifyMs, values)
  }

  /** Row with the 4-byte big-endian kcal. */
  fun restingRow(kcal: Int, startMs: Long, endMs: Long, modifyMs: Long): DictRow =
    DictRow(startMs, endMs, modifyMs, listOf(DictValue(KEY_RESTING, DataSyncBytes.int32(kcal))))

  /**
   * Health glance JSON (declaration order, null fields omitted): bloodPressureSource, bloodPressureTimestamp, bodyMassIndex,
   * diastolicPressure, fatPercentageTimestamp, fatPercentage, systolicPressure, height, weight, weightTimestamp.
   * BMI is weight / (height / 100)^2 rounded to one decimal, only when both are known.
   */
  fun glance(data: BodyMetricsData, weightKg: Double?, heightCm: Int?): Map<String, Any?> {
    val out = LinkedHashMap<String, Any?>()
    val hasBp = data.systolic != null && data.diastolic != null
    if (hasBp) {
      out["bloodPressureSource"] = 0
      data.bpTsMs?.let { out["bloodPressureTimestamp"] = it }
    }
    if (weightKg != null && heightCm != null && heightCm > 0 && weightKg > 0.0) {
      val bmi = weightKg / (heightCm / 100.0).pow(2)
      out["bodyMassIndex"] = ((bmi * 10).roundToInt() / 10.0).toFloat()
    }
    if (hasBp) out["diastolicPressure"] = data.diastolic
    if (data.bodyFatPct != null) {
      data.bodyFatTsMs?.let { out["fatPercentageTimestamp"] = it }
      out["fatPercentage"] = data.bodyFatPct.toFloat()
    }
    if (hasBp) out["systolicPressure"] = data.systolic
    if (heightCm != null && heightCm > 0) out["height"] = heightCm
    if (weightKg != null && weightKg > 0.0) {
      out["weight"] = weightKg.toFloat()
      data.weightTsMs?.let { out["weightTimestamp"] = it }
    }
    return out
  }
}

/**
 * Body data for the watch: the weight and body-fat dictionary (watch event `80030003` `{event:5}`), the resting-metabolism
 * dictionary (the watch's `500018` request, and a push when the value changes) and the Health Glance card (event `80030006`).
 * Stored in the `body_metrics` table (key / value) so the background service can answer with JS closed.
 */
internal class BodyMetrics(
  context: Context,
  private val store: SyncStore,
  private val service: DataSyncService,
  private val events: WearEvents,
  private val settings: WearSettings,
) : DataSyncFeature {
  @Suppress("unused") private val appContext = context.applicationContext

  override val name = "body metrics"

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, message)

  private fun error(message: String) = events.log(LogDirection.ERROR, null, null, null, message)

  // Storage

  @Synchronized
  fun load(): BodyMetricsData = try {
    val map = HashMap<String, String>()
    store.db().rawQuery("SELECT key, value FROM body_metrics", null).use { c ->
      while (c.moveToNext()) map[c.getString(0).orEmpty()] = c.getString(1).orEmpty()
    }
    BodyMetricsData(
      weightKg = map["weight_kg"]?.toDoubleOrNull(),
      weightTsMs = map["weight_ts"]?.toLongOrNull(),
      bodyFatPct = map["body_fat_pct"]?.toDoubleOrNull(),
      bodyFatTsMs = map["body_fat_ts"]?.toLongOrNull(),
      restingKcal = map["resting_kcal"]?.toIntOrNull(),
      systolic = map["systolic"]?.toIntOrNull(),
      diastolic = map["diastolic"]?.toIntOrNull(),
      bpTsMs = map["bp_ts"]?.toLongOrNull(),
    )
  } catch (e: SQLiteException) {
    error("Body metrics: could not read the database: ${e.message}")
    BodyMetricsData()
  }

  /** Overwrites only the fields [update] sets (non-null); returns the merged result. */
  @Synchronized
  fun save(update: BodyMetricsData): BodyMetricsData {
    val now = System.currentTimeMillis()
    val rows = ArrayList<Pair<String, String>>()
    update.weightKg?.let { rows += "weight_kg" to it.toString() }
    update.weightTsMs?.let { rows += "weight_ts" to it.toString() }
    update.bodyFatPct?.let { rows += "body_fat_pct" to it.toString() }
    update.bodyFatTsMs?.let { rows += "body_fat_ts" to it.toString() }
    update.restingKcal?.let { rows += "resting_kcal" to it.toString() }
    update.systolic?.let { rows += "systolic" to it.toString() }
    update.diastolic?.let { rows += "diastolic" to it.toString() }
    update.bpTsMs?.let { rows += "bp_ts" to it.toString() }
    try {
      val db = store.db()
      db.beginTransaction()
      try {
        for ((key, value) in rows) {
          db.execSQL(
            "INSERT INTO body_metrics (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            arrayOf<Any>(key, value, now),
          )
        }
        db.setTransactionSuccessful()
      } finally {
        db.endTransaction()
      }
    } catch (e: SQLiteException) {
      throw WearException(ErrorCodes.STORAGE, "Could not store the body metrics: ${e.message}", e)
    }
    return load()
  }

  /** Stored weight, else the JoyoFit profile weight (no timestamp). */
  private fun effectiveWeight(data: BodyMetricsData): Double? = data.weightKg ?: settings.profile?.weightKg

  /** Latest weight (plus body fat and BMR when known) as the dictionary rows the watch's `{event:5}` asks for. */
  fun weightRowOrNull(nowMs: Long = System.currentTimeMillis()): DictRow? {
    val data = load()
    val weight = effectiveWeight(data) ?: return null
    return BodyMetricsCodec.weightRow(weight, data.weightTsMs ?: nowMs, data.bodyFatPct, data.restingKcal?.toDouble(), nowMs)
  }

  // Sending

  /** The watch's `{event:5}` (or a new weigh-in): 0x37/04 dictionary 10006. */
  suspend fun sendWeight(phonePkg: String, watchPkg: String, reason: String): Boolean {
    val row = weightRowOrNull()
    if (row == null) {
      log("Body: weight not sent ($reason): no weight known (no weigh-in and no profile)")
      return false
    }
    log("Body: sending weight dictionary ($reason)")
    return service.sendDictionary(phonePkg, watchPkg, BodyMetricsCodec.DICT_WEIGHT, listOf(row), what = "weight dictionary")
  }

  /** The watch's `500018` request, or a push after the value changed. [startMs] / [endMs] echo the request's window when it had one. */
  suspend fun sendResting(phonePkg: String, watchPkg: String, startMs: Long?, endMs: Long?, reason: String): Boolean {
    val kcal = load().restingKcal
    if (kcal == null || kcal <= 0) {
      log("Body: resting metabolism not sent ($reason): no value known")
      return false
    }
    val now = System.currentTimeMillis()
    val row = BodyMetricsCodec.restingRow(kcal, startMs ?: startOfDay(now), endMs ?: now, now)
    log("Body: sending resting metabolism $kcal kcal ($reason)")
    return service.sendDictionary(phonePkg, watchPkg, BodyMetricsCodec.DICT_RESTING, listOf(row), what = "resting metabolism dictionary")
  }

  /** Stores [update] and pushes what changed to a connected watch. Returns the merged data. */
  suspend fun set(update: BodyMetricsData): BodyMetricsData {
    val before = load()
    val after = save(update)
    log("Body: stored ${update.toJs().filterValues { it != null }}")
    if (service.connected()) {
      if (after.restingKcal != null && after.restingKcal != before.restingKcal) {
        sendResting(BodyMetricsCodec.PHONE_PKG, BodyMetricsCodec.WATCH_PKG, null, null, "changed")
      }
      if ((after.weightKg != null && after.weightKg != before.weightKg) || (after.bodyFatPct != null && after.bodyFatPct != before.bodyFatPct)) {
        sendWeight(BodyMetricsCodec.PHONE_PKG, BodyMetricsCodec.WATCH_PKG, "changed")
      }
    }
    return after
  }

  fun glanceJson(): Map<String, Any?> {
    val data = load()
    return BodyMetricsCodec.glance(data, effectiveWeight(data), settings.profile?.heightCm)
  }

  // Watch requests

  override fun register(service: DataSyncService) {
    service.onDictionary(BodyMetricsCodec.PHONE_PKG, null, BodyMetricsCodec.DICT_RESTING) { query ->
      sendResting(query.phonePkg, query.watchPkg.ifEmpty { BodyMetricsCodec.WATCH_PKG }, query.startMs?.takeIf { it > 0 }, query.endMs?.takeIf { it > 0 }, "watch request")
    }
    service.onEvent(BodyMetricsCodec.GLANCE_PHONE_PKG, null, BodyMetricsCodec.EVENT_GLANCE) { event ->
      val json = glanceJson()
      log("Health Glance: watch asked, answering with ${json.keys}")
      service.sendEvent(
        event.phonePkg.ifEmpty { BodyMetricsCodec.GLANCE_PHONE_PKG },
        event.watchPkg.ifEmpty { BodyMetricsCodec.GLANCE_WATCH_PKG },
        BodyMetricsCodec.EVENT_GLANCE,
        DataSyncJson.bytes(json),
        what = "health glance",
      )
    }
  }

  override suspend fun onConnected() {
    // Huawei pushes the resting metabolism when it changes and the watch asks for the weight itself; send the known BMR once.
    sendResting(BodyMetricsCodec.PHONE_PKG, BodyMetricsCodec.WATCH_PKG, null, null, "connected")
  }

  private fun startOfDay(nowMs: Long): Long {
    val cal = java.util.Calendar.getInstance()
    cal.timeInMillis = nowMs
    cal.set(java.util.Calendar.HOUR_OF_DAY, 0)
    cal.set(java.util.Calendar.MINUTE, 0)
    cal.set(java.util.Calendar.SECOND, 0)
    cal.set(java.util.Calendar.MILLISECOND, 0)
    return cal.timeInMillis
  }
}
