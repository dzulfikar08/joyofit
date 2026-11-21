// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): HuaweiSupportProvider.downloadStressData (gate and request),
// HuaweiStressParser.parseRri (file layout), HuaweiStressHRVCalculation (meaning of the 10 features and their valid ranges).
package com.joyodigitama.huaweiwear

import kotlin.math.roundToInt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiStressParser

/**
 * One record of `rrisqi_data.bin`: a roughly one minute stress measurement the watch made and analysed itself. The file
 * holds no raw RR intervals. The watch keeps the intervals' summary instead: [features] are the ten values of GB's
 * `HuaweiStressHRVCalculation.calculateHRV` (0 median-NNI bin count, 1 sdHR, 2 NNI range, 3 %VLF, 4 RMSSD, 5 median NNI,
 * 6 normalised variance, 7 HF power, 8 LF power, 9 %LF) followed by two zeros.
 */
internal class RriRecord(
  val startSec: Long,
  val endSec: Long,
  val score: Int,
  val level: Int,
  val cFlag: Int,
  val type: Int,
  val accFlag: Int,
  val ppgFlag: Int,
  val features: List<Float>,
) {
  /** RMSSD in milliseconds when the watch's value is inside the range its own validation accepts (0..200), else null. */
  val rmssd: Double?
    get() {
      val v = features.getOrNull(FEATURE_RMSSD) ?: return null
      return if (v.isFinite() && v > 0f && v <= NightHrv.MAX_RMSSD_MS) v.toDouble() else null
    }

  /** The 20 ms bin the intervals clustered in, when inside the watch's 300..1500 ms validation range. */
  val medianNni: Double?
    get() {
      val v = features.getOrNull(FEATURE_MEDIAN_NNI) ?: return null
      return if (v.isFinite() && v >= NightHrv.MIN_NNI_MS && v <= NightHrv.MAX_NNI_MS) v.toDouble() else null
    }

  val midSec: Long get() = (startSec + endSec) / 2

  override fun toString(): String =
    "$startSec..$endSec score=$score level=$level flags(c=$cFlag type=$type acc=$accFlag ppg=$ppgFlag) " +
      "rmssd=${features.getOrNull(FEATURE_RMSSD)} medianNni=${features.getOrNull(FEATURE_MEDIAN_NNI)} " +
      "sdHr=${features.getOrNull(1)} nniCount=${features.getOrNull(0)}"

  companion object {
    const val FEATURE_RMSSD = 4
    const val FEATURE_MEDIAN_NNI = 5
  }
}

internal class RriFile(val fileSize: Long, val version: Int, val bitmap: Int, val records: List<RriRecord>, val understood: Boolean)

/** A span of unix seconds. */
internal class TimeSpan(val start: Long, val end: Long) {
  operator fun contains(t: Long) = t in start until end
}

/** One sleep session: the main sleep of a night, with the spans that count as asleep. */
internal class NightSpan(val start: Long, val end: Long, val asleep: List<TimeSpan>) {
  val asleepSec: Long get() = asleep.sumOf { it.end - it.start }
  fun asleepAt(t: Long) = asleep.any { t in it }
}

internal class NightSummary(
  val night: NightSpan,
  /** Records whose midpoint lies in an asleep span. */
  val inSleep: List<RriRecord>,
  /** [inSleep] with a usable RMSSD. */
  val valid: List<RriRecord>,
  val rmssdMean: Double?,
  val rmssdMedian: Double?,
  /** Beats the valid records cover, estimated as duration / median NNI; the file has no beat count. */
  val beats: Int,
  /** Why no reading is stored, or null when there is one. */
  val rejected: String?,
)

/**
 * Nightly HRV from the watch's automatic stress records. `rrisqi_data.bin` (service 0x2C `FileDownloadInit`, type RRI,
 * or 0x0A `RriFileRequest`) is requested like GB's `downloadStressData`; each record carries the RMSSD the watch computed
 * from its beat-to-beat intervals. A night's value is the mean of the records made while asleep.
 */
internal object NightHrv {
  const val FILE_NAME = "rrisqi_data.bin"

  /** GB `HuaweiState.supportsAutoStress`: service 0x20 command 0x09. */
  const val GATE_SERVICE = 0x20
  const val GATE_COMMAND = 0x09

  /** The watch's own validation accepts RMSSD up to 200 ms and median NNI 300..1500 ms (`calculateHRV`). */
  const val MAX_RMSSD_MS = 200f
  const val MIN_NNI_MS = 300f
  const val MAX_NNI_MS = 1500f

  /** Fewer usable records than this during sleep give no night reading. */
  const val MIN_RECORDS = 3

  /** Header of a version 3 file; records of 66 bytes follow (GB `parseRri`). */
  const val HEADER_BYTES = 48

  /** The file window of a first or full pull starts here (2000-01-01), as the activity sync does for a 0 start. */
  private const val MIN_START_SEC = 946684800L
  private const val MIN_WINDOW_SEC = 48 * 3600L
  private const val REWIND_SEC = 12 * 3600L

  /** Records of [data], or null when GB's parser rejects it (shorter than the 48 byte header). */
  fun parse(data: ByteArray): RriFile? {
    val file = HuaweiStressParser.parseRri(data) ?: return null
    val stress = file.stressData
    val records = (stress ?: emptyList()).map { s ->
      RriRecord(
        startSec = s.startTime / 1000L,
        endSec = s.endTime / 1000L,
        score = s.score.toInt(),
        level = s.level.toInt(),
        cFlag = s.cFlag.toInt(),
        type = s.type.toInt(),
        accFlag = s.accFlag.toInt(),
        ppgFlag = s.ppgFlag.toInt(),
        features = s.features.toList(),
      )
    }
    return RriFile(file.fileSize, file.version, file.bitmap, records, understood = stress != null)
  }

  /**
   * Start of the file window: the start of everything the watch holds when no night was stored yet or [fullHistory] asks
   * for it, else 12 h before the last stored night's end, but never later than 48 h ago, so a night that ended yesterday
   * morning is still fully inside it.
   */
  fun windowStart(lastNightEndSec: Long?, nowSec: Long, fullHistory: Boolean = false): Long {
    if (fullHistory || lastNightEndSec == null) return MIN_START_SEC
    return minOf(nowSec - MIN_WINDOW_SEC, lastNightEndSec - REWIND_SEC)
  }

  /**
   * Sleep sessions of [segments] like `buildNights` in `nights.ts`: unstaged strays dropped, sessions split where the gap
   * exceeds [SleepReport.SESSION_GAP_SEC] or a segment is marked [SleepSegment.breakBefore]. Asleep means deep, light
   * or rem; segments without any decoded stage in the session count as asleep as a whole. Oldest first.
   */
  fun nights(segments: List<SleepSegment>): List<NightSpan> {
    val sorted = withoutBlips(withoutStrayUnstaged(segments))
    val sessions = ArrayList<MutableList<SleepSegment>>()
    var reach = Long.MIN_VALUE
    for (s in sorted) {
      if (s.end <= s.start) continue
      val current = sessions.lastOrNull()
      if (current != null && !s.breakBefore && s.start - reach <= SleepReport.SESSION_GAP_SEC) {
        current.add(s)
      } else {
        sessions.add(mutableListOf(s))
        reach = Long.MIN_VALUE
      }
      reach = maxOf(reach, s.end)
    }
    return sessions.map { session ->
      val staged = session.any { it.stage != null && it.stage != "awake" }
      val asleep = session.filter { if (staged) it.stage in ASLEEP_STAGES else it.stage != "awake" }
      NightSpan(session.minOf { it.start }, session.maxOf { it.end }, merge(asleep.map { TimeSpan(it.start, it.end) }))
    }
  }

  private val ASLEEP_STAGES = setOf("deep", "light", "rem")

  private fun merge(spans: List<TimeSpan>): List<TimeSpan> {
    val out = ArrayList<TimeSpan>()
    for (s in spans.sortedBy { it.start }) {
      val last = out.lastOrNull()
      if (last != null && s.start <= last.end) out[out.size - 1] = TimeSpan(last.start, maxOf(last.end, s.end))
      else out.add(s)
    }
    return out
  }

  /** The night's value from the records made while asleep; [NightSummary.rejected] says why there is none. */
  fun summarize(night: NightSpan, records: List<RriRecord>): NightSummary {
    val inSleep = records.filter { night.asleepAt(it.midSec) }
    val valid = inSleep.filter { it.rmssd != null }
    val values = valid.mapNotNull { it.rmssd }.sorted()
    val mean = if (values.isEmpty()) null else values.average()
    val median = if (values.isEmpty()) null else if (values.size % 2 == 1) values[values.size / 2] else (values[values.size / 2 - 1] + values[values.size / 2]) / 2
    val beats = valid.sumOf { r ->
      val nni = r.medianNni
      if (nni == null || r.endSec <= r.startSec) 0 else ((r.endSec - r.startSec) * 1000.0 / nni).roundToInt()
    }
    val rejected = when {
      inSleep.isEmpty() -> "no stress records during sleep"
      valid.size < MIN_RECORDS -> "only ${valid.size} usable records during sleep, need $MIN_RECORDS"
      else -> null
    }
    return NightSummary(night, inSleep, valid, mean, median, beats, rejected)
  }
}

/**
 * What the last night HRV step found, kept for the support report. The question a report on a new watch has to answer is whether
 * any stress record reached the phone overnight, and a day of syncs scrolls that out of the log. In memory only.
 */
internal object NightHrvDiagnostics {
  class Builder(val atSec: Long) {
    var gate = false
    var result = "not run"
    var fileBytes: Int? = null
    var records: Int? = null
    var recordSpan: String? = null
    val nights = ArrayList<String>()
    var examined = 0
    var stored = 0
    var withoutRecords = 0

    fun snapshot() = Snapshot(atSec, gate, result, fileBytes, records, recordSpan, nights.takeLast(MAX_NIGHT_LINES), examined, stored, withoutRecords)
  }

  class Snapshot(
    val atSec: Long,
    /** The watch lists 20/09, the command GB gates the stress file on. */
    val gate: Boolean,
    /** What became of the file: "gate closed", "file not available", "file empty", "records read", ... */
    val result: String,
    val fileBytes: Int?,
    val records: Int?,
    val recordSpan: String?,
    /** One line per sleep night looked at, newest last. */
    val nights: List<String>,
    /** Sleep nights inside the file window that were long enough to score. */
    val examined: Int,
    val stored: Int,
    /** Examined nights where the file held no stress record made while asleep: the sign of a watch that does not record overnight. */
    val withoutRecords: Int,
  )

  @Volatile var last: Snapshot? = null

  private const val MAX_NIGHT_LINES = 4

  /** Support report lines: what lets a watch record night HRV, then the last sync. */
  fun summary(listed: Boolean?, enabled: Boolean, calibratedAtSec: Long?, nowSec: Long = System.currentTimeMillis() / 1000): List<String> {
    fun yn(value: Boolean) = if (value) "yes" else "no"
    val lines = ArrayList<String>()
    lines.add(
      "Night HRV gates: automatic stress 20/09 listed=${listed?.let(::yn) ?: "unknown"} (last connect), switch=${if (enabled) "on" else "off"}, " +
        "calibrated=${calibratedAtSec?.let { java.time.Instant.ofEpochSecond(it).toString() } ?: "never"}, " +
        "dictionary sleep (cap 143)=${yn(DeviceCaps.supportsDictSleepSync)}, HRV dictionary (cap 235)=${yn(DeviceCaps.expandCapability(235))}, " +
        "stress file over the new sync service=${yn(DeviceCaps.rriNewSync)}",
    )
    val snapshot = last
    if (snapshot == null) {
      lines.add("Night HRV last sync: none in this process")
      return lines
    }
    val ago = (nowSec - snapshot.atSec).coerceAtLeast(0)
    lines.add("Night HRV last sync: ${ago / 60} min ago, ${snapshot.result}")
    if (snapshot.fileBytes != null) {
      lines.add(
        "  file ${snapshot.fileBytes} bytes, ${snapshot.records ?: 0} stress records${snapshot.recordSpan?.let { " ($it)" } ?: ""}; " +
          "nights looked at ${snapshot.examined}, stored ${snapshot.stored}, with no record during sleep ${snapshot.withoutRecords}",
      )
    }
    for (night in snapshot.nights) lines.add("  $night")
    return lines
  }
}

/**
 * The nightly HRV step of an activity sync: downloads `rrisqi_data.bin` for the window, works out each sleep night the
 * window covers and upserts `hrv_readings` (source `night`). Everything here is best effort: the caller isolates it.
 *
 * After an update that changed the sleep rules ([SleepCleaning.SLEEP_RULES_VERSION]) the first sync also deletes the
 * stored nights that are no longer sleep and reads the whole file, so every night whose span changed is recomputed
 * ([SleepRulesRepair]); the marker is set when that sync got through.
 */
internal class NightHrvSync(
  session: HuaweiSession,
  private val events: WearEvents,
  private val store: SyncStore,
  private val settings: WearSettings,
  /** The connected watch: its nights are the ones this sync reads the cursor of and writes ([NightHrvStore]). */
  private val address: String,
) {
  private val downloader = FileDownloader(session, events)

  suspend fun sync(nowSec: Long, fullHistory: Boolean = false) {
    val diag = NightHrvDiagnostics.Builder(nowSec)
    try {
      val repairing = SleepRulesRepair.nightHrvDue(settings)
      if (repairing) {
        val removed = withContext(Dispatchers.IO) { SleepRulesRepair.pruneNightHrv(store.db()) }
        log("Night HRV: sleep rules version ${SleepCleaning.SLEEP_RULES_VERSION}: $removed stored nights are no longer sleep and were removed, the rest is recomputed from the whole file")
      }
      val complete = run(nowSec, fullHistory, repairing, diag)
      if (repairing && complete) settings.nightHrvRulesVersion = SleepCleaning.SLEEP_RULES_VERSION
    } finally {
      NightHrvDiagnostics.last = diag.snapshot()
    }
  }

  /**
   * True when the step ran through for what the watch holds (a download that failed or could not be read is false, so a
   * night HRV repair waits for the next sync).
   */
  private suspend fun run(nowSec: Long, fullHistory: Boolean, repairing: Boolean, diag: NightHrvDiagnostics.Builder): Boolean {
    val autoStress = DeviceCaps.supports(NightHrv.GATE_SERVICE, NightHrv.GATE_COMMAND)
    val newSync = DeviceCaps.rriNewSync
    diag.gate = autoStress
    log(
      "Night HRV gates: supportsAutoStress(20/09)=$autoStress rriNewSync(SettingRelated)=$newSync " +
        "commands20=[${DeviceCaps.supportedCommands[NightHrv.GATE_SERVICE]?.joinToString(" ") { it.hex2() } ?: "none"}]",
    )
    if (!autoStress) {
      diag.result = "gate closed: the watch does not list 20/09, so it cannot record night HRV for us (stress file skipped, as GB)"
      log("Night HRV: service 0x20 command 0x09 not supported, RRI file skipped (as GB)")
      return true
    }

    val lastEnd = withContext(Dispatchers.IO) { NightHrvStore.lastEnd(AndroidWatchDb(store.db()), address) }
    val from = NightHrv.windowStart(lastEnd, nowSec, fullHistory || repairing)
    val request = FileRequest.rri(newSync, from.toInt(), nowSec.toInt())
    log("Night HRV: requesting $request (last stored night ends ${lastEnd ?: "never"})")
    val data = try {
      downloader.download(request)
    } catch (e: CancellationException) {
      throw e
    } catch (e: WearException) {
      if (e.errorCode == ErrorCodes.DISCONNECTED) throw e
      // GB treats any download failure of this file as "no stress data"; the watch answers an unsupported or empty
      // request with an error status or file size -1, which surfaces here as a protocol error.
      diag.result = "file not available [${e.errorCode}]: ${e.message}"
      events.log(LogDirection.ERROR, null, null, null, "Night HRV: ${request.filename} not available, skipped [${e.errorCode}]: ${e.message}")
      return false
    }
    diag.fileBytes = data.size
    if (data.isEmpty()) {
      diag.result = "file empty: the watch holds no stress record in the window (automatic stress off, or nothing measured yet)"
      log("Night HRV: ${request.filename} is empty, the watch has no stress records in the window (automatic stress off, or nothing measured yet)")
      return true
    }
    log("Night HRV: ${request.filename} ${data.size} bytes, header ${data.copyOf(minOf(NightHrv.HEADER_BYTES, data.size)).toHex()}")

    val file = NightHrv.parse(data)
    if (file == null) {
      diag.result = "file shorter than its ${NightHrv.HEADER_BYTES} byte header, ignored"
      log("Night HRV: file shorter than the ${NightHrv.HEADER_BYTES} byte header, ignored")
      return false
    }
    log("Night HRV: parsed fileSize=${file.fileSize} version=${file.version} bitmap=${file.bitmap} records=${file.records.size}")
    diag.records = file.records.size
    if (!file.understood) {
      diag.result = "file version ${file.version} not known (GB only knows 3), no records read"
      log("Night HRV: file version ${file.version} is not known (GB only knows 3), no records read")
      return false
    }
    if (file.records.isEmpty()) {
      diag.result = "file has a header but no stress records"
      log("Night HRV: file has no records")
      return true
    }
    diag.recordSpan = "${file.records.minOf { it.startSec }}..${file.records.maxOf { it.endSec }}"
    log("Night HRV: records span ${diag.recordSpan}")
    for (r in file.records.sortedBy { it.startSec }.takeLast(LOGGED_RECORDS)) log("Night HRV: record $r")
    diag.result = "records read"

    val stressRows = withContext(Dispatchers.IO) { RriStressStore.save(AndroidWatchDb(store.db()), address, file.records) }
    log(
      if (stressRows == null) "Night HRV: stress scores not stored as emotion, the watch reports its own"
      else "Night HRV: $stressRows stress scores stored as emotion (the watch reports none of its own)",
    )

    val segments = withContext(Dispatchers.IO) { store.read { db -> SleepStore.load(db, from - SleepReport.SESSION_GAP_SEC) } }
    val nights = NightHrv.nights(segments)
    log("Night HRV: ${segments.size} sleep segments in ${nights.size} sessions since ${from - SleepReport.SESSION_GAP_SEC}")

    var stored = 0
    for (night in nights) {
      val label = "night ${night.start}..${night.end}"
      if (night.start < from) {
        log("Night HRV: $label began before the file window ($from), left as stored")
        continue
      }
      if (night.asleepSec < SleepReport.MIN_NIGHT_SEC) {
        log("Night HRV: $label is a nap (${night.asleepSec / 60} min asleep), skipped")
        continue
      }
      val summary = NightHrv.summarize(night, file.records)
      val inWindow = file.records.count { it.endSec >= night.start && it.startSec <= night.end }
      val detail = "$label asleep=${night.asleepSec / 60} min records=$inWindow inSleep=${summary.inSleep.size} usable=${summary.valid.size}"
      log(
        "Night HRV: $detail flagsAcc=${summary.inSleep.count { it.accFlag != 0 }} " +
          "rmssdMean=${summary.rmssdMean?.let { "%.1f".format(it) }} rmssdMedian=${summary.rmssdMedian?.let { "%.1f".format(it) }} " +
          "beats~${summary.beats}",
      )
      diag.examined++
      if (summary.inSleep.isEmpty()) diag.withoutRecords++
      val reason = summary.rejected
      val mean = summary.rmssdMean
      if (reason != null || mean == null) {
        diag.nights.add("$detail: no reading (${reason ?: "no usable RMSSD"})")
        log("Night HRV: $label no reading: ${reason ?: "no usable RMSSD"}")
        continue
      }
      withContext(Dispatchers.IO) { NightHrvStore.save(AndroidWatchDb(store.db()), address, night, mean, summary.beats) }
      stored++
      diag.stored = stored
      diag.nights.add("$detail: stored rmssd ${"%.1f".format(mean)} ms")
      log("Night HRV: $label stored rmssd=${"%.1f".format(mean)} ms from ${summary.valid.size} records")
    }
    diag.result = if (stored > 0) "records read, $stored nights stored" else "records read, no night stored"
    log("Night HRV: $stored nights stored")
    return true
  }

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, message)

  private companion object {
    const val LOGGED_RECORDS = 40
  }
}

/**
 * The watch's own stress score of each `rrisqi_data.bin` record (1 to 100, what the watch shows as stress) as `health_metrics`
 * `emotion` rows, the type the Stress screen reads. Only for a watch that reports no `emotion` rows of its own: the Band 11 Pro
 * leaves the P2P Emotion dictionary empty but holds its automatic stress measurements in this file (JRG-486). A watch whose
 * dictionary does report them (Watch Fit 4 Pro) is not touched, and when a watch starts reporting its own,
 * [HealthMetricsStore.persist] removes these rows first, so no measurement is counted twice.
 */
internal object RriStressStore {
  const val TYPE = "emotion"

  /** Rows written, or null when skipped because the watch has `emotion` rows of its own. */
  fun save(db: WatchDb, address: String, records: List<RriRecord>): Int? {
    val own = db.query(WatchSql.COUNT_OWN_EMOTION, address).firstOrNull()?.get(0) as Long? ?: 0L
    if (own > 0) return null
    val rows = records.filter { it.score in 1..100 && it.endSec >= it.startSec }
    db.transaction {
      for (r in rows) db.exec(WatchSql.UPSERT_HEALTH_METRIC, TYPE, r.startSec, r.endSec, r.score.toDouble(), json(r), address)
    }
    return rows.size
  }

  fun json(r: RriRecord): String = """{"source":"rrisqi","score":${r.score},"level":${r.level}}"""
}

/** `hrv_readings` rows of source `night`, per watch. */
internal object NightHrvStore {
  /** End of the newest night [address] stored, null when it has none: each watch's file window starts after its own last night. */
  fun lastEnd(db: WatchDb, address: String): Long? =
    db.query(WatchSql.SELECT_NIGHT_HRV_CURSOR, address).firstOrNull()?.get(0) as Long?

  /**
   * A night's row replaces this watch's earlier row (or an unattributed one) for an overlapping session; its start moves
   * when more sleep arrives. Another watch's overlapping night is not touched here: the claim triggers keep the primary's
   * and ignore a non-primary insert that overlaps another watch's night.
   */
  fun save(db: WatchDb, address: String, night: NightSpan, rmssd: Double, beats: Int) {
    db.transaction {
      db.exec(WatchSql.DELETE_NIGHT_HRV_OVERLAP, night.end, night.start, address)
      db.exec(WatchSql.INSERT_NIGHT_HRV, night.start, night.end, rmssd, beats, address)
    }
  }
}
