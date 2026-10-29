package com.joyodigitama.huaweiwear

import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener

/**
 * How a Huawei sport id of the export (`subType` of a record, the `Sport type` sheet of the field description) becomes a
 * JoyoFit sport (the watch's own ids, see [WorkoutSportTypes]). Huawei's list and the watch's share ids from 140 up to 216
 * and 223 (strength training 140, HIIT 143, boxing 149 ...); the first ones differ and are listed here. Ids the watch has no
 * sport for (free weights 117 is strength training, the rest stay unnamed) keep their Huawei id in the summary.
 */
internal object HuaweiExportSports {
  /** The sport id for ones the export has but this table does not know: GB's catch-all `EXERCISE`. */
  const val OTHER = 255

  private val SPECIAL: Map<Int, Int> = mapOf(
    1 to 177, // climbing stairs
    2 to 4, // mountain climbing
    3 to 3, // outdoor cycling
    4 to 1, // outdoor running
    5 to 2, // outdoor walking (the id 5 is in the data and not in Huawei's sheet; every converter reads it as walking)
    9 to 8, // swimming
    101 to 5, // indoor running
    102 to 6, // pool swimming
    103 to 7, // indoor cycling
    104 to 8, // open water
    105 to 128, 106 to 129, 107 to 130, 108 to 131, 109 to 132, 110 to 133, // racket and ball sports
    111 to 134, 112 to 135, 113 to 136, // elliptical, rowing machine, stepmill
    114 to 137, 115 to 138, 116 to 139, // yoga, pilates, aerobics
    117 to 140, // free weights: strength training
    118 to 11, // trail run
    281 to 13, // indoor walking
    282 to 14, // hiking
    287 to 22, 288 to 23, 289 to 24, 291 to 25, // free diving, breath-hold training and test, scuba
  )

  fun joyofitType(huaweiType: Int?): Int {
    if (huaweiType == null) return OTHER
    SPECIAL[huaweiType]?.let { return it }
    return if ((huaweiType in 140..216 || huaweiType == 223) && WorkoutSportTypes.sport(huaweiType) != null) huaweiType else OTHER
  }

  fun name(huaweiType: Int?): String {
    val type = joyofitType(huaweiType)
    return if (type != OTHER) WorkoutSportTypes.name(type) else "Workout (Huawei type ${huaweiType ?: "unknown"})"
  }
}

/** One GPS fix of a track; [startsSegment] after a pause marker. */
internal class GpsFix(val ts: Long, val lat: Double, val lon: Double, val alt: Double?, val startsSegment: Boolean)

/** One sensor reading (heart rate in bpm, barometric altitude in metres, cadence in steps per minute) at [ts] unix seconds. */
internal class SensorReading(val ts: Long, val value: Double)

internal class MotionTrack(
  val gps: List<GpsFix>,
  val heartRates: List<SensorReading>,
  val altitudes: List<SensorReading>,
  val cadences: List<SensorReading>,
  /** `tp=rs`: [SensorReading.ts] is the offset in seconds from the workout's start, the value metres per second. */
  val speeds: List<SensorReading> = emptyList(),
)

/** The fields of one `Motion path detail data` object that the importer reads. Times are milliseconds. */
internal class RawMotionPath(
  val startMs: Long?,
  val endMs: Long?,
  val sportType: Int?,
  val totalSteps: Double?,
  val totalDistance: Double?,
  val totalCalories: Double?,
  val totalTime: Double?,
  val timeZone: String?,
  /** The track text (`detailData`, once `attribute`), one record per line. */
  val attribute: String,
  /** The parsed `summaryData` JSON: heart-rate figures, pace, climb. */
  val summary: JSONObject? = null,
)

/**
 * The JSON files of the `Motion path detail data & description` folder: one object per tracked workout with `sportType`, `startTime`,
 * `endTime`, totals (`totalSteps`, `totalDistance` in metres, `totalCalories`, `totalTime`) and an `attribute` string,
 * `HW_EXT_TRACK_DETAIL@i` followed by one record per line:
 *
 *  - `tp=lbs;k=N;lat=;lon=;alt=;t=<seconds, scientific notation>;` a GPS fix. `lat=90.0;lon=-80.0` is a pause marker.
 *  - `tp=h-r;k=<ms>;v=<bpm>;` heart rate, `tp=alti;k=<ms>;v=<m>;` barometric altitude, `tp=s-r;k=<ms>;v=<steps/min>;` cadence.
 *  - `tp=p-m;k=<km index>;v=<seconds for that km>`, `sec`, `rs`, `b-p-m` per-kilometre or per-session summaries, not per-timestamp
 *    readings, so not stored.
 *
 * The object is sometimes invalid JSON. [fromBrokenText] reads the same fields straight off the raw text then: the
 * line records do not depend on the JSON around them.
 */
internal object HuaweiMotionPathParser {
  /** Text the importer resynchronises on when a corrupt record swallowed its neighbours. */
  const val RECORD_MARKER = "{\"abnormalTrack\":"

  private const val HR_RANGE_MIN = 20
  private const val HR_RANGE_MAX = 250
  private const val CADENCE_RANGE_MAX = 300

  /** 100 m/s: nothing a person moves at on land. */
  private const val SPEED_MAX_DM_PER_SEC = 1000.0

  /** Elevation changes under this many metres are barometer noise. */
  private const val ELEVATION_NOISE_M = 3.0

  /**
   * One record of a real export: `{startTime, endTime, subType (the sport id), timeZone, summaryData: "<JSON text>", detailData:
   * "<track text>"}`. The totals live in `summaryData` (`totalDistance` m, `totalSteps`, `totalCalories` cal, `totalTime` ms);
   * records in the layout community converters describe carry them, and `attribute` for the track, at the top.
   */
  fun fromJson(obj: JSONObject): RawMotionPath {
    val summary = HuaweiExportJson.embeddedObject(obj.opt("summaryData"))
    fun total(vararg names: String): Double? {
      for (name in names) {
        HuaweiExportJson.number(summary?.opt(name))?.let { return it }
        HuaweiExportJson.number(obj.opt(name))?.let { return it }
      }
      return null
    }
    val track = obj.optString("detailData", "").ifEmpty { obj.optString("attribute", "") }
    return RawMotionPath(
      startMs = HuaweiExportJson.epochMs(obj.opt("startTime")),
      endMs = HuaweiExportJson.epochMs(obj.opt("endTime")),
      sportType = HuaweiExportJson.number(obj.opt("subType") ?: obj.opt("sportType"))?.roundToInt(),
      totalSteps = total("totalSteps", "steps"),
      totalDistance = total("totalDistance", "distance"),
      totalCalories = total("totalCalories", "calorie", "calories"),
      totalTime = total("totalTime", "duration"),
      timeZone = obj.optString("timeZone", "").ifEmpty { null },
      attribute = track,
      summary = summary,
    )
  }

  /**
   * Regex fallback for a record that is not valid JSON; null when not even a start time can be found. Reads both layouts
   * like [fromJson]: the sport from `subType` (else `sportType`), the totals from the `summaryData` text before the top
   * level. Inside the raw record the summary's quotes are escaped (`\"totalDistance\":2500`), so a summary that does not
   * parse is still read key by key.
   */
  fun fromBrokenText(text: String): RawMotionPath? {
    // Top-level keys only: the escaped `\"sportType\"` inside summaryData is another numbering (258 on a run).
    fun scalar(name: String): Double? =
      Regex("\"$name\"\\s*:\\s*\"?(-?[0-9][0-9.Ee+-]*)").find(text)?.groupValues?.get(1)?.toDoubleOrNull()?.takeIf { it.isFinite() }
    fun anywhere(name: String): Double? =
      Regex("\\\\?\"$name\\\\?\"\\s*:\\s*\\\\?\"?(-?[0-9][0-9.Ee+-]*)").find(text)?.groupValues?.get(1)?.toDoubleOrNull()?.takeIf { it.isFinite() }
    val summary = summaryData(text)
    fun total(vararg names: String): Double? {
      for (name in names) {
        HuaweiExportJson.number(summary?.opt(name))?.let { return it }
        anywhere(name)?.let { return it }
      }
      return null
    }
    val startMs = HuaweiExportJson.epochMs(scalar("startTime"))
    val attribute = text.replace("\\n", "\n")
    if (startMs == null && !attribute.contains("tp=lbs")) return null
    return RawMotionPath(
      startMs = startMs,
      endMs = HuaweiExportJson.epochMs(scalar("endTime")),
      sportType = (scalar("subType") ?: scalar("sportType"))?.roundToInt(),
      totalSteps = total("totalSteps", "steps"),
      totalDistance = total("totalDistance", "distance"),
      totalCalories = total("totalCalories", "calorie", "calories"),
      totalTime = total("totalTime", "duration"),
      timeZone = Regex("\"timeZone\"\\s*:\\s*\"([^\"]*)\"").find(text)?.groupValues?.get(1),
      attribute = attribute,
      summary = summary,
    )
  }

  /** The `summaryData` string of a raw record, parsed; null when it is missing or not readable. Scanned, not matched, so a long one cannot exhaust a regex. */
  private fun summaryData(text: String): JSONObject? {
    val key = text.indexOf("\"summaryData\"")
    if (key < 0) return null
    var at = key + "\"summaryData\"".length
    while (at < text.length && (text[at].isWhitespace() || text[at] == ':')) at++
    if (at >= text.length || text[at] != '"') return null
    var end = at + 1
    while (end < text.length && text[end] != '"') end += if (text[end] == '\\') 2 else 1
    if (end >= text.length) return null
    val literal = try {
      JSONTokener(text.substring(at, end + 1)).nextValue() as? String
    } catch (e: JSONException) {
      null
    }
    return HuaweiExportJson.embeddedObject(literal)
  }

  fun parseTrack(attribute: String): MotionTrack {
    val gps = ArrayList<GpsFix>()
    val heartRates = ArrayList<SensorReading>()
    val altitudes = ArrayList<SensorReading>()
    val cadences = ArrayList<SensorReading>()
    val speeds = ArrayList<SensorReading>()
    var pendingBreak = false
    for (line in attribute.split('\n')) {
      val at = line.indexOf("tp=")
      if (at < 0) continue
      val fields = HashMap<String, String>()
      for (part in line.substring(at).split(';')) {
        val eq = part.indexOf('=')
        if (eq > 0) fields[part.substring(0, eq).trim()] = part.substring(eq + 1).trim()
      }
      when (fields["tp"]) {
        "lbs" -> {
          val lat = HuaweiExportJson.number(fields["lat"])
          val lon = HuaweiExportJson.number(fields["lon"])
          val t = HuaweiExportJson.number(fields["t"])
          if (lat == null || lon == null) continue
          if (lat == 90.0 && lon == -80.0) {
            pendingBreak = true
          } else if (t != null && abs(lat) <= 90.0 && abs(lon) <= 180.0 && !(lat == 0.0 && lon == 0.0)) {
            val seconds = (if (t > 1e11) t / 1000.0 else t).roundToInt().toLong()
            // 0 is "no altitude" in these fixes; the barometer series carries the real one.
            val alt = HuaweiExportJson.number(fields["alt"])?.takeIf { it != 0.0 }
            gps.add(GpsFix(seconds, lat, lon, alt, pendingBreak))
            pendingBreak = false
          }
        }
        "h-r" -> {
          val ms = HuaweiExportJson.number(fields["k"])
          val bpm = HuaweiExportJson.number(fields["v"])?.roundToInt()
          if (ms != null && bpm != null && bpm in HR_RANGE_MIN..HR_RANGE_MAX) heartRates.add(SensorReading((ms / 1000.0).toLong(), bpm.toDouble()))
        }
        "alti" -> {
          val ms = HuaweiExportJson.number(fields["k"])
          val metres = HuaweiExportJson.number(fields["v"])
          if (ms != null && metres != null) altitudes.add(SensorReading((ms / 1000.0).toLong(), metres))
        }
        "s-r" -> {
          val ms = HuaweiExportJson.number(fields["k"])
          val spm = HuaweiExportJson.number(fields["v"])?.roundToInt()
          if (ms != null && spm != null && spm in 1..CADENCE_RANGE_MAX) cadences.add(SensorReading((ms / 1000.0).toLong(), spm.toDouble()))
        }
        "rs" -> {
          val offset = HuaweiExportJson.number(fields["k"])
          val dmPerSec = HuaweiExportJson.number(fields["v"])
          // -1 is "no speed" (indoor and strength workouts write the series anyway); decimetres per second to metres.
          if (offset != null && dmPerSec != null && offset >= 0 && dmPerSec in 0.0..SPEED_MAX_DM_PER_SEC) speeds.add(SensorReading(offset.toLong(), dmPerSec / 10.0))
        }
      }
    }
    return MotionTrack(gps, heartRates, altitudes, cadences, speeds)
  }

  /** The workout [raw] describes, or null when it has no usable start or no duration at all. */
  fun build(raw: RawMotionPath): ImportedWorkout? {
    val track = parseTrack(raw.attribute)
    fun summaryHr(name: String): Int? = HuaweiExportJson.number(raw.summary?.opt(name))?.roundToInt()?.takeIf { it in HR_RANGE_MIN..HR_RANGE_MAX }
    val trackTimes = track.gps.map { it.ts } + track.heartRates.map { it.ts } + track.altitudes.map { it.ts } + track.cadences.map { it.ts }
    val start = raw.startMs?.div(1000) ?: trackTimes.minOrNull() ?: return null
    val elapsedMs = raw.endMs?.let { it - start * 1000 }
    val movingSec = totalTimeSeconds(raw.totalTime, elapsedMs)
    var end = raw.endMs?.div(1000) ?: trackTimes.maxOrNull() ?: start
    if (end <= start) end = start + (movingSec ?: 0L)
    if (end <= start) return null
    val duration = (end - start).toInt()

    val distance = (raw.totalDistance?.takeIf { it > 0 } ?: trackDistance(track.gps)).roundToInt()
    val heartRates = track.heartRates.map { it.value.toInt() }
    // The track's own readings first; the summary's figures for a workout whose track has none.
    val avgHr = if (heartRates.isEmpty()) summaryHr("avgHeartRate") else heartRates.average().roundToInt()
    val maxHr = heartRates.maxOrNull() ?: summaryHr("maxHeartRate")
    val kind = WorkoutSportTypes.kind(HuaweiExportSports.joyofitType(raw.sportType))

    val points = ArrayList<WorkoutPoint>(track.gps.size + track.heartRates.size + track.altitudes.size + track.cadences.size)
    for (g in track.gps) points.add(WorkoutPoint(g.ts, g.lat, g.lon, g.alt, null))
    for (h in track.heartRates) points.add(WorkoutPoint(h.ts, null, null, null, h.value.toInt()))
    for (a in track.altitudes) points.add(WorkoutPoint(a.ts, null, null, a.value, null))
    for (c in track.cadences) points.add(WorkoutPoint(c.ts, null, null, null, null, cadence = c.value.toInt()))
    for (v in track.speeds) points.add(WorkoutPoint(start + v.ts, null, null, null, null, speed = v.value))
    // Stable: GPS fixes before sensor readings of the same second.
    val sorted = points.sortedBy { it.ts }

    return ImportedWorkout(
      start = start,
      end = end,
      sportType = HuaweiExportSports.joyofitType(raw.sportType),
      sportName = HuaweiExportSports.name(raw.sportType),
      duration = duration,
      distance = distance,
      calories = kcal(raw.totalCalories),
      steps = raw.totalSteps?.roundToInt()?.coerceAtLeast(0) ?: 0,
      avgHr = avgHr,
      maxHr = maxHr,
      summaryJson = summaryJson(raw, kind, duration, distance, movingSec, track, heartRates).toString(),
      points = sorted,
    )
  }

  /**
   * `totalCalories` is in small calories (cal, 1/1000 kcal) as the field description says; on a real export the 103 workouts
   * come to a median of 7.8 kcal per minute that way (and to nonsense in any other unit).
   */
  fun kcal(raw: Double?): Int = if (raw == null || raw <= 0.0) 0 else (raw / 1000.0).roundToInt()

  /** `totalTime` in seconds, reading it as the unit (ms or s) that lands closer to the elapsed time; ms without one. */
  private fun totalTimeSeconds(totalTime: Double?, elapsedMs: Long?): Long? {
    if (totalTime == null || totalTime <= 0.0) return null
    if (elapsedMs == null || elapsedMs <= 0) return (totalTime / 1000.0).roundToInt().toLong()
    val asMs = abs(totalTime - elapsedMs)
    val asSec = abs(totalTime * 1000.0 - elapsedMs)
    return if (asSec < asMs) totalTime.roundToInt().toLong() else (totalTime / 1000.0).roundToInt().toLong()
  }

  /** Metres along the fixes, not across a pause. */
  fun trackDistance(gps: List<GpsFix>): Double {
    var total = 0.0
    for (i in 1 until gps.size) {
      if (gps[i].startsSegment) continue
      total += haversine(gps[i - 1].lat, gps[i - 1].lon, gps[i].lat, gps[i].lon)
    }
    return total
  }

  private fun haversine(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
    val r = 6_371_000.0
    val p1 = Math.toRadians(lat1)
    val p2 = Math.toRadians(lat2)
    val dp = p2 - p1
    val dl = Math.toRadians(lon2 - lon1)
    val a = sin(dp / 2) * sin(dp / 2) + cos(p1) * cos(p2) * sin(dl / 2) * sin(dl / 2)
    return 2 * r * atan2(sqrt(a), sqrt(1 - a))
  }

  /** Climb and descent of an altitude series, ignoring swings smaller than [ELEVATION_NOISE_M]. */
  fun elevationChange(altitudes: List<Double>): Pair<Double, Double> {
    if (altitudes.isEmpty()) return 0.0 to 0.0
    var reference = altitudes[0]
    var gain = 0.0
    var loss = 0.0
    for (a in altitudes) {
      if (a - reference >= ELEVATION_NOISE_M) {
        gain += a - reference
        reference = a
      } else if (reference - a >= ELEVATION_NOISE_M) {
        loss += reference - a
        reference = a
      }
    }
    return gain to loss
  }

  private fun summaryJson(
    raw: RawMotionPath,
    kind: String,
    duration: Int,
    distance: Int,
    movingSec: Long?,
    track: MotionTrack,
    heartRates: List<Int>,
  ): JSONObject {
    val json = JSONObject()
    json.put("kind", kind)
    json.put("source", "huawei-export")
    raw.sportType?.let { json.put("huaweiSportType", it) }
    raw.timeZone?.let { json.put("timeZone", it) }
    movingSec?.let { json.put("movingTimeSec", it) }
    json.put("gps", if (track.gps.isEmpty()) "none" else "ok")
    json.put("gpsPoints", track.gps.size)
    if (duration > 0 && distance > 0) {
      val avgSpeed = distance.toDouble() / duration
      json.put("avgSpeed", avgSpeed)
      if (WorkoutSportTypes.isPace(kind)) json.put("avgPaceSecPerKm", 1000.0 / avgSpeed)
    }
    heartRates.minOrNull()?.let { json.put("minHr", it) }
    // `creepingWave` (climb) and `mTotalDescent` are decimetres, 0 or -1 when the watch had no barometer reading.
    if (track.altitudes.isEmpty()) {
      HuaweiExportJson.number(raw.summary?.opt("creepingWave"))?.takeIf { it > 0 }?.let { json.put("elevationGain", it / 10.0) }
      HuaweiExportJson.number(raw.summary?.opt("mTotalDescent"))?.takeIf { it > 0 }?.let { json.put("elevationLoss", it / 10.0) }
    }
    if (track.altitudes.isNotEmpty()) {
      val values = track.altitudes.map { it.value }
      json.put("minAltitude", values.min())
      json.put("maxAltitude", values.max())
      json.put("avgAltitude", values.average())
      val (gain, loss) = elevationChange(values)
      json.put("elevationGain", gain)
      json.put("elevationLoss", loss)
    }
    return json
  }
}
