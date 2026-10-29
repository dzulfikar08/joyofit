package com.joyodigitama.huaweiwear

import java.io.FilterInputStream
import java.io.IOException
import java.io.InputStream
import java.io.InputStreamReader
import android.util.Log
import java.time.Instant
import java.util.BitSet
import kotlin.math.roundToInt
import org.json.JSONObject

/** Why an import could not start; the module turns [kind] into an error code for JS. */
internal class HuaweiImportException(val kind: Kind, message: String, cause: Throwable? = null) : Exception(message, cause) {
  enum class Kind { BAD_PASSWORD, NOT_A_ZIP, NOT_AN_EXPORT, STORAGE }
}

/** One file inside the export archive. */
internal class HuaweiExportEntry(val name: String, val size: Long)

/** The archive of an export: its files and a way to read one. Implemented over zip4j by [Zip4jExportSource]. */
internal interface HuaweiExportSource {
  fun entries(): List<HuaweiExportEntry>
  fun open(entry: HuaweiExportEntry): InputStream
}

/** Which kind of data a file holds, decided by the folder it sits in. */
internal enum class HuaweiExportKind {
  /** `Health detail data & description`: heart rate, SpO2, sleep, stress, HRV, weigh-ins ... */
  HEALTH_DETAIL,

  /** `Sport per minute merged data & description`: steps and distance per minute. */
  SPORT_PER_MINUTE,

  /** `Motion path detail data & description`: one object per tracked workout. */
  MOTION_PATH,

  /** `Sample sequence data & description`: sleep summaries (score) and raw sequences JoyoFit does not store. */
  SAMPLE_SEQUENCE,

  /** `SportsHealth data & desciption/SportsHealth-Data.xls`: daily totals. Last, so the per-minute rows are in first. */
  SPORTS_HEALTH,
  ;

  /** Short name for the unreadable-record counts. */
  val label: String get() = name.lowercase()

  companion object {
    /** The kind of the archive member [name], or null for anything that is not one of the JSON data files. */
    fun of(name: String): HuaweiExportKind? {
      val path = name.replace('\\', '/').lowercase()
      if (path.endsWith(".xls")) return if ("sportshealth" in path && "field description" !in path) SPORTS_HEALTH else null
      if (!path.endsWith(".json")) return null
      return when {
        "health detail data" in path -> HEALTH_DETAIL
        "sport per minute" in path -> SPORT_PER_MINUTE
        "motion path detail" in path -> MOTION_PATH
        "sample sequence data" in path -> SAMPLE_SEQUENCE
        else -> null
      }
    }
  }
}

/** What an import found and wrote. Counted while it runs; [HuaweiImportProgress] hands out the live numbers. */
internal class HuaweiImportSummary {
  var filesRead = 0
  var filesFailed = 0
  var filesIgnored = 0

  /** Records that were not usable JSON and could not be repaired, plus oversize ones. */
  var badRecords = 0

  /** Sample points of a known kind whose value was missing or implausible. */
  var rejectedSamples = 0

  /** Sample points of kinds the importer does not use (exercise intensity ...). */
  var unmappedSamples = 0

  /** Why readings were dropped: `key` + `reason` (see [HuaweiImportCollector.rejected]) with a count and the first offending value. */
  val rejectedReasons = LinkedHashMap<String, RejectedCount>()

  /** Which kinds of unreadable records there were (`health` / `sport` / `motion` + why), with a count. */
  val badRecordReasons = LinkedHashMap<String, Int>()

  /** Keys of unmapped sample points, with a count each, so the owner of a new export can see what JoyoFit leaves out. */
  val unmappedKeys = LinkedHashMap<String, Int>()

  var heartRateReadings = 0
  var restingHeartRateReadings = 0
  var spo2Readings = 0
  var stressReadings = 0
  var sleepSegmentsFound = 0

  /** `step_samples` rows inserted or filled in. */
  var minutesWritten = 0
  var sleepSegmentsAdded = 0
  var stressAdded = 0

  /** Readings of the other `health_metrics` types (HRV, sleep apnea, skin temperature ...) found and added. */
  var metricsFound = 0
  var metricsAdded = 0
  var sleepScoresFound = 0
  var sleepScoresAdded = 0

  /** Days of the `.xls` summary found, and those added as a noon row (the per-minute files had no row for them). */
  var dayTotalsFound = 0
  var dayTotalsAdded = 0
  var mealsFound = 0
  var waterDaysFound = 0

  /** Meals and water days put in the queue for JoyoRogo now (the rest were queued by an earlier run). */
  var mealsQueued = 0
  var waterDaysQueued = 0

  /** What the export says about the person, for the profile when the phone has none: `heightCm`, `weightKg`, `sex`, `birthYear`. */
  var profile: Map<String, Any> = emptyMap()
  var weighInsFound = 0
  var weighInsAdded = 0
  var workoutsFound = 0
  var workoutsAdded = 0

  /** Workouts of an earlier import that had no track or totals and got them now. */
  var workoutsUpdated = 0
  var workoutPointsAdded = 0

  /** Earliest and latest time (unix seconds) of anything read, for "your history reaches back to ...". */
  var oldestSec: Long? = null
  var newestSec: Long? = null
  var cancelled = false

  fun reject(key: String, reason: String, sample: String?) {
    rejectedSamples++
    val entry = rejectedReasons.getOrPut("$key|$reason") { RejectedCount(key, reason, sample) }
    entry.count++
  }

  fun badRecord(reason: String) {
    badRecords++
    badRecordReasons.merge(reason, 1, Int::plus)
  }

  fun unmapped(key: String) {
    unmappedSamples++
    // The export has a handful of keys; a cap keeps a corrupt one from growing the map without bound.
    if (unmappedKeys.size < MAX_KEYS || key in unmappedKeys) unmappedKeys.merge(key, 1, Int::plus)
  }

  fun seen(tsSec: Long) {
    if (oldestSec?.let { tsSec < it } != false) oldestSec = tsSec
    if (newestSec?.let { tsSec > it } != false) newestSec = tsSec
  }

  fun toJs(): Map<String, Any?> = mapOf(
    "filesRead" to filesRead,
    "filesFailed" to filesFailed,
    "filesIgnored" to filesIgnored,
    "badRecords" to badRecords,
    "rejectedSamples" to rejectedSamples,
    "unmappedSamples" to unmappedSamples,
    "heartRateReadings" to heartRateReadings,
    "restingHeartRateReadings" to restingHeartRateReadings,
    "spo2Readings" to spo2Readings,
    "stressReadings" to stressReadings,
    "sleepSegmentsFound" to sleepSegmentsFound,
    "minutesWritten" to minutesWritten,
    "sleepSegmentsAdded" to sleepSegmentsAdded,
    "stressAdded" to stressAdded,
    "metricsFound" to metricsFound,
    "metricsAdded" to metricsAdded,
    "sleepScoresFound" to sleepScoresFound,
    "sleepScoresAdded" to sleepScoresAdded,
    "dayTotalsFound" to dayTotalsFound,
    "dayTotalsAdded" to dayTotalsAdded,
    "mealsFound" to mealsFound,
    "mealsQueued" to mealsQueued,
    "waterDaysFound" to waterDaysFound,
    "waterDaysQueued" to waterDaysQueued,
    "profile" to profile,
    "weighInsFound" to weighInsFound,
    "weighInsAdded" to weighInsAdded,
    "rejectedReasons" to rejectedReasons.values.sortedByDescending { it.count }.take(MAX_REASONS).map { it.toJs() },
    "badRecordReasons" to badRecordReasons.entries.sortedByDescending { it.value }.take(MAX_REASONS).map { mapOf("reason" to it.key, "count" to it.value) },
    "unmappedKeys" to unmappedKeys.entries.sortedByDescending { it.value }.take(MAX_REASONS).map { mapOf("key" to it.key, "count" to it.value) },
    "workoutsFound" to workoutsFound,
    "workoutsAdded" to workoutsAdded,
    "workoutsUpdated" to workoutsUpdated,
    "workoutPointsAdded" to workoutPointsAdded,
    "oldestSec" to oldestSec,
    "newestSec" to newestSec,
    "cancelled" to cancelled,
  )
}

/** How often a reading of [key] was dropped for [reason]; [sample] is the first offending value. */
internal class RejectedCount(val key: String, val reason: String, val sample: String?, var count: Int = 0) {
  fun toJs(): Map<String, Any?> = mapOf("key" to key, "reason" to reason, "sample" to sample, "count" to count)
}

private const val MAX_KEYS = 200
private const val MAX_REASONS = 20

/** A progress report: [phase] is `reading` while files are processed and `done` at the end. */
internal class HuaweiImportProgress(
  val phase: String,
  val fileName: String?,
  val fileIndex: Int,
  val fileCount: Int,
  /** 0..1 over the uncompressed bytes of all data files. */
  val fraction: Double,
  val summary: HuaweiImportSummary,
) {
  fun toJs(): Map<String, Any?> = mapOf(
    "phase" to phase,
    "fileName" to fileName,
    "fileIndex" to fileIndex,
    "fileCount" to fileCount,
    "fraction" to fraction,
    "summary" to summary.toJs(),
  )
}

/**
 * Reads a Huawei Privacy Centre health export and writes it through a [HuaweiImportStore].
 *
 * Every file is streamed: [HuaweiExportJson.forEachRecord] cuts it into records, each record is parsed on its own and a
 * record that fails is counted in [HuaweiImportSummary.badRecords] and skipped. Minutes, sleep segments and stress
 * readings are buffered and flushed between records in transactions of at most [FLUSH_MINUTES] rows; workouts are
 * written one by one. Cancelling stops between records; what was written stays, and running the same export again
 * only adds what is still missing.
 */
internal class HuaweiExportImporter(
  private val store: HuaweiImportStore,
  private val onProgress: (HuaweiImportProgress) -> Unit,
  private val isCancelled: () -> Boolean = { false },
  private val nowMs: () -> Long = System::currentTimeMillis,
) {
  private class Cancelled : RuntimeException()

  private val summary = HuaweiImportSummary()
  private val minutes = HashMap<Long, ImportedMinute>()
  private val sleep = ArrayList<ImportedSleep>()
  private val heartRateMinutes = MinuteSet()
  private val restingMinutes = MinuteSet()
  private val spo2Minutes = MinuteSet()
  private val weighInMinutes = HashSet<Long>()
  private val queue = ArrayList<QueuedImport>()
  private val waterKeys = HashSet<String>()
  private val waterMl = HashMap<String, Int>()

  /** Newest value (and its time) per kind of profile fact. */
  private val facts = HashMap<String, Pair<Long, Double>>()
  private val metrics = ArrayList<ImportedMetric>()
  private val metricKeys = HashSet<String>()
  private val sleepScores = ArrayList<ImportedSleepScore>()
  private val dayTotals = ArrayList<ImportedDayTotal>()
  private val weighIns = ArrayList<ImportedWeighIn>()

  private var fileIndex = 0
  private var fileCount = 0
  private var fileName: String? = null
  private var totalBytes = 0L
  private var doneBytes = 0L
  private var lastProgressMs = 0L

  private val collector = object : HuaweiImportCollector {
    private fun minute(tsSec: Long): ImportedMinute {
      summary.seen(tsSec)
      val key = tsSec / 60 * 60
      return minutes.getOrPut(key) { ImportedMinute(key) }
    }

    // The export writes most readings twice, under two numeric types and in different files: only the first reading of a
    // minute counts, over the whole run (the minute buffer is flushed between files).
    override fun heartRate(tsSec: Long, bpm: Int) {
      val m = minute(tsSec)
      if (m.heartRate == null) m.heartRate = bpm
      if (heartRateMinutes.add(m.ts)) summary.heartRateReadings++
    }

    override fun restingHeartRate(tsSec: Long, bpm: Int) {
      val m = minute(tsSec)
      if (m.restingHeartRate == null) m.restingHeartRate = bpm
      if (restingMinutes.add(m.ts)) summary.restingHeartRateReadings++
    }

    override fun spo2(tsSec: Long, percent: Int) {
      val m = minute(tsSec)
      if (m.spo2 == null) m.spo2 = percent
      if (spo2Minutes.add(m.ts)) summary.spo2Readings++
    }

    override fun sleep(segment: ImportedSleep) {
      summary.sleepSegmentsFound++
      summary.seen(segment.start)
      summary.seen(segment.end)
      sleep.add(segment)
    }

    override fun metric(point: ImportedMetric) {
      if (!metricKeys.add("${point.type}|${point.ts}")) return
      if (point.type == HuaweiMetricTypes.STRESS) summary.stressReadings++ else summary.metricsFound++
      summary.seen(point.ts)
      metrics.add(point)
    }

    override fun sleepScore(score: ImportedSleepScore) {
      summary.sleepScoresFound++
      summary.seen(score.start)
      sleepScores.add(score)
    }

    override fun dayTotal(total: ImportedDayTotal) {
      summary.dayTotalsFound++
      summary.seen(total.noonSec)
      dayTotals.add(total)
    }

    override fun steps(minuteSec: Long, steps: Int, distance: Int, calories: Int) {
      val m = minute(minuteSec)
      if (steps > m.steps) m.steps = steps
      if (distance > m.distance) m.distance = distance
      if (calories > m.calories) m.calories = calories
    }

    override fun weighIn(weighIn: ImportedWeighIn) {
      // Weigh-ins come under two numeric types too; a weighing is one per minute.
      if (!weighInMinutes.add(weighIn.tsMs / 60_000)) return
      summary.weighInsFound++
      summary.seen(weighIn.tsMs / 1000)
      weighIns.add(weighIn)
    }

    override fun meal(meal: ImportedMeal) {
      summary.mealsFound++
      summary.seen(meal.eatenAtMs?.div(1000) ?: Instant.parse("${meal.date}T12:00:00Z").epochSecond)
      val json = JSONObject()
        .put("key", meal.key)
        .put("date", meal.date)
        .put("meal", meal.meal)
        .put("name", meal.name)
        .put("kcal", meal.kcal)
      meal.protein?.let { json.put("protein", it) }
      meal.carbs?.let { json.put("carbs", it) }
      meal.fat?.let { json.put("fat", it) }
      meal.eatenAtMs?.let { json.put("eatenAt", it) }
      queue.add(QueuedImport("meal", meal.key, json.toString()))
    }

    override fun water(date: String, ml: Int, key: String) {
      if (waterKeys.add(key)) waterMl.merge(date, ml, Int::plus)
    }

    override fun profileFact(kind: String, value: Double, tsMs: Long) {
      val have = facts[kind]
      if (have == null || tsMs >= have.first) facts[kind] = tsMs to value
    }

    override fun unmapped(key: String) = summary.unmapped(key)

    override fun rejected(key: String, reason: String, sample: String?) = summary.reject(key, reason, sample)
  }

  fun run(source: HuaweiExportSource): HuaweiImportSummary {
    val entries = source.entries()
    val files = entries
      .mapNotNull { entry -> HuaweiExportKind.of(entry.name)?.let { it to entry } }
      .sortedBy { it.first.ordinal }
    summary.filesIgnored = entries.size - files.size
    if (files.isEmpty()) {
      throw HuaweiImportException(
        HuaweiImportException.Kind.NOT_AN_EXPORT,
        "No Health data folders found in this file (expected \"Health detail data\", \"Sport per minute\" or \"Motion path detail\")",
      )
    }
    fileCount = files.size
    totalBytes = files.sumOf { it.second.size.coerceAtLeast(0) }.coerceAtLeast(1)
    try {
      for ((index, file) in files.withIndex()) {
        fileIndex = index + 1
        fileName = file.second.name.substringAfterLast('/').substringAfterLast('\\')
        val before = doneBytes
        try {
          source.open(file.second).use { stream -> readFile(file.first, CountingStream(stream)) }
          summary.filesRead++
        } catch (e: Cancelled) {
          throw e
        } catch (e: IOException) {
          // A damaged or unreadable member costs that file only. Database errors are not caught: they end the import.
          summary.filesFailed++
        }
        flush()
        doneBytes = before + file.second.size.coerceAtLeast(0)
        report("reading", force = true)
      }
    } catch (e: Cancelled) {
      summary.cancelled = true
      flush()
    }
    // A cancelled run has only part of a day's drinks: queueing that sum would fix the day at too little.
    if (!summary.cancelled) queueWater()
    summary.profile = profileFromFacts()
    fileName = null
    doneBytes = totalBytes
    report("done", force = true)
    logSummary()
    return summary
  }

  private inner class CountingStream(input: InputStream) : FilterInputStream(input) {
    override fun read(): Int = super.read().also { if (it >= 0) doneBytes++ }

    override fun read(b: ByteArray, off: Int, len: Int): Int = super.read(b, off, len).also { if (it > 0) doneBytes += it }
  }

  /** The summed water of each local day, in glasses of 250 ml, as one queue item per day (a day under 125 ml is no glass). */
  private fun queueWater() {
    summary.waterDaysFound = waterMl.size
    val items = waterMl.entries.sortedBy { it.key }.mapNotNull { (date, ml) ->
      val glasses = (ml / WATER_GLASS_ML.toDouble()).roundToInt().coerceAtMost(40)
      if (glasses < 1) null else QueuedImport("water", date, JSONObject().put("date", date).put("glasses", glasses).toString())
    }
    if (items.isNotEmpty()) summary.waterDaysQueued = store.queueForRogo(items)
    waterMl.clear()
  }

  /** `heightCm`, `weightKg`, `sex` (`male` / `female`) and `birthYear` (the year of the newest weigh-in minus the age it carried), where the export says them. */
  private fun profileFromFacts(): Map<String, Any> {
    val out = LinkedHashMap<String, Any>()
    facts["height"]?.let { out["heightCm"] = it.second.roundToInt() }
    facts["weight"]?.let { out["weightKg"] = Math.round(it.second * 10) / 10.0 }
    facts["male"]?.let { out["sex"] = if (it.second == 1.0) "male" else "female" }
    facts["age"]?.let { (ts, age) -> out["birthYear"] = Instant.ofEpochMilli(ts).atOffset(java.time.ZoneOffset.UTC).year - age.roundToInt() }
    return out
  }

  /** One line per fact in logcat (`adb logcat -s HuaweiImport`): counts and keys, never a health value but the first offending one per reason. */
  private fun logSummary() {
    Log.i(TAG, "files read=${summary.filesRead} failed=${summary.filesFailed} ignored=${summary.filesIgnored} bad=${summary.badRecords} rejected=${summary.rejectedSamples} unmapped=${summary.unmappedSamples}")
    for (r in summary.rejectedReasons.values.sortedByDescending { it.count }.take(MAX_REASONS)) Log.i(TAG, "rejected ${r.key} ${r.reason} x${r.count} e.g. ${r.sample}")
    for ((reason, n) in summary.badRecordReasons) Log.i(TAG, "bad record $reason x$n")
    for ((key, n) in summary.unmappedKeys.entries.sortedByDescending { it.value }.take(MAX_REASONS)) Log.i(TAG, "unmapped $key x$n")
    Log.i(TAG, "written minutes=${summary.minutesWritten} sleep=${summary.sleepSegmentsAdded} stress=${summary.stressAdded} metrics=${summary.metricsAdded}/${summary.metricsFound} sleepScores=${summary.sleepScoresAdded}/${summary.sleepScoresFound} dayTotals=${summary.dayTotalsAdded}/${summary.dayTotalsFound} weighIns=${summary.weighInsAdded}/${summary.weighInsFound} meals=${summary.mealsQueued}/${summary.mealsFound} waterDays=${summary.waterDaysQueued}/${summary.waterDaysFound} workouts=${summary.workoutsAdded}+${summary.workoutsUpdated}/${summary.workoutsFound}")
  }

  private fun readFile(kind: HuaweiExportKind, stream: InputStream) {
    if (kind == HuaweiExportKind.SPORTS_HEALTH) {
      readSpreadsheet(stream)
      return
    }
    val reader = InputStreamReader(stream, Charsets.UTF_8)
    HuaweiExportJson.forEachRecord(
      reader,
      onRecord = { text -> handleRecord(kind, text) },
      onUnterminated = { text -> recover(kind, text) },
      onOversized = { summary.badRecord("${kind.label}/oversized") },
    )
  }

  /** The `.xls` summary is read whole (under a megabyte); a file that is not readable costs that file only. */
  private fun readSpreadsheet(stream: InputStream) {
    val bytes = stream.readBytes()
    try {
      HuaweiSportsHealthParser.parse(bytes, collector)
    } catch (e: HuaweiXlsReader.XlsException) {
      summary.badRecord("${HuaweiExportKind.SPORTS_HEALTH.label}/${e.message}")
    }
    report("reading", force = false)
  }

  private fun handleRecord(kind: HuaweiExportKind, text: String) {
    if (isCancelled()) throw Cancelled()
    val record = HuaweiExportJson.parseObject(text)
    if (record == null) {
      recover(kind, text)
    } else {
      // Only reading the record is guarded: a bad record is skipped, a failing database is not.
      var workout: ImportedWorkout? = null
      var readable = true
      try {
        when (kind) {
          HuaweiExportKind.HEALTH_DETAIL -> HuaweiHealthDetailParser.parse(record, collector)
          HuaweiExportKind.SPORT_PER_MINUTE -> HuaweiSportPerMinuteParser.parse(record, collector)
          HuaweiExportKind.SAMPLE_SEQUENCE -> HuaweiSampleSequenceParser.parse(record, collector)
          HuaweiExportKind.SPORTS_HEALTH -> Unit
          HuaweiExportKind.MOTION_PATH -> workout = HuaweiMotionPathParser.build(HuaweiMotionPathParser.fromJson(record))
        }
      } catch (e: RuntimeException) {
        readable = false
      }
      if (!readable) {
        summary.badRecord("${kind.label}/parser-error")
      } else if (kind == HuaweiExportKind.MOTION_PATH) {
        if (workout == null) summary.badRecord("${kind.label}/no-start-or-duration") else writeWorkout(workout)
      }
    }
    if (minutes.size >= FLUSH_MINUTES || sleep.size >= FLUSH_ROWS || metrics.size >= FLUSH_ROWS || weighIns.size >= FLUSH_ROWS) flush()
    report("reading", force = false)
  }

  /**
   * A record that is not valid JSON. Motion paths are read off the raw text (the line records inside do not need the
   * JSON around them), and when a stray quote merged several workouts into one text it is cut at the next workout's
   * first key. Other kinds have nothing to salvage.
   */
  private fun recover(kind: HuaweiExportKind, text: String) {
    if (kind != HuaweiExportKind.MOTION_PATH) {
      summary.badRecord("${kind.label}/invalid-json")
      return
    }
    val starts = ArrayList<Int>()
    var at = text.indexOf(HuaweiMotionPathParser.RECORD_MARKER)
    while (at >= 0) {
      starts.add(at)
      at = text.indexOf(HuaweiMotionPathParser.RECORD_MARKER, at + 1)
    }
    val pieces = if (starts.size <= 1) listOf(text) else starts.mapIndexed { i, from -> text.substring(from, starts.getOrElse(i + 1) { text.length }) }
    for (piece in pieces) {
      val workout = try {
        HuaweiMotionPathParser.fromBrokenText(piece)?.let { HuaweiMotionPathParser.build(it) }
      } catch (e: RuntimeException) {
        null
      }
      if (workout == null) summary.badRecord("${kind.label}/unrecoverable") else writeWorkout(workout)
    }
  }

  private fun writeWorkout(workout: ImportedWorkout) {
    summary.workoutsFound++
    summary.seen(workout.start)
    summary.seen(workout.end)
    val result = store.writeWorkout(workout)
    if (result.added) summary.workoutsAdded++
    if (result.updated) summary.workoutsUpdated++
    if (result.added || result.updated) summary.workoutPointsAdded += result.points
  }

  private fun flush() {
    if (minutes.isNotEmpty()) {
      summary.minutesWritten += store.writeMinutes(minutes.values)
      minutes.clear()
    }
    if (sleep.isNotEmpty()) {
      summary.sleepSegmentsAdded += store.writeSleep(sleep)
      sleep.clear()
    }
    if (metrics.isNotEmpty()) {
      for ((type, added) in store.writeMetrics(metrics)) {
        if (type == HuaweiMetricTypes.STRESS) summary.stressAdded += added else summary.metricsAdded += added
      }
      metrics.clear()
    }
    if (sleepScores.isNotEmpty()) {
      summary.sleepScoresAdded += store.writeSleepScores(sleepScores)
      sleepScores.clear()
    }
    if (queue.isNotEmpty()) {
      summary.mealsQueued += store.queueForRogo(queue)
      queue.clear()
    }
    if (weighIns.isNotEmpty()) {
      summary.weighInsAdded += store.writeWeighIns(weighIns)
      weighIns.clear()
    }
    // After the minutes: a day total only fills a day the per-minute rows left empty.
    if (dayTotals.isNotEmpty()) {
      summary.dayTotalsAdded += store.writeDayTotals(dayTotals)
      dayTotals.clear()
    }
  }

  private fun report(phase: String, force: Boolean) {
    val now = nowMs()
    if (!force && now - lastProgressMs < PROGRESS_INTERVAL_MS) return
    lastProgressMs = now
    onProgress(HuaweiImportProgress(phase, fileName, fileIndex, fileCount, (doneBytes.toDouble() / totalBytes).coerceIn(0.0, 1.0), summary))
  }

  companion object {
    const val FLUSH_MINUTES = 20_000
    const val FLUSH_ROWS = 5_000
    const val PROGRESS_INTERVAL_MS = 250L

    /** One glass in JoyoRogo's water log, ml. */
    const val WATER_GLASS_ML = 250
    private const val TAG = "HuaweiImport"
  }
}

/**
 * The minutes (unix seconds of a whole minute) a kind of reading was counted for, one bit per minute since 2000, the earliest
 * time the parsers accept: under 2 MB per set until 2026. A `HashSet<Long>` took about 50 bytes a minute; on the JVM, six years
 * of synthetic per-minute heart rate (3.15 M minutes, 614 MB of JSON) ran a 256 MB heap out of memory with it and finish in
 * 128 MB without a full GC with this.
 */
private class MinuteSet {
  private val bits = BitSet()
  private val outside = HashSet<Long>()

  /** True when [minuteSec] was not in the set yet. */
  fun add(minuteSec: Long): Boolean {
    val index = minuteSec / 60 - FIRST_MINUTE
    if (index !in 0..Int.MAX_VALUE.toLong()) return outside.add(minuteSec)
    if (bits.get(index.toInt())) return false
    bits.set(index.toInt())
    return true
  }

  private companion object {
    /** 2000-01-01 in minutes since the epoch. */
    const val FIRST_MINUTE = 946_684_800L / 60
  }
}
