package com.joyodigitama.huaweiwear

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * A phone-tracked Connected GPS trajectory recorded while a wearable workout runs.
 * Huawei Bands (Band 8/9/10/11, etc.) have no built-in GNSS receiver and report `trajectoriesData = 0` in `17/07`,
 * so their workouts only get a route map when the phone's live GPS track is merged into the synced [WorkoutRecord].
 */
internal data class ConnectedGpsSession(
  val id: String,
  val startSec: Long,
  val endSec: Long,
  val sportType: Int?,
  val distanceM: Double,
  val riseM: Double,
  val points: List<TrackFix>,
) {
  val effectiveEndSec: Long
    get() = max(endSec, (points.lastOrNull()?.timeMs ?: 0L) / 1000L)

  fun fixesInWindow(workoutStartSec: Long, workoutEndSec: Long, slackSec: Long = ConnectedGpsStore.MATCH_SLACK_SEC): List<TrackFix> {
    val effectiveEnd = if (workoutEndSec > workoutStartSec) workoutEndSec else effectiveEndSec
    val lo = workoutStartSec - slackSec
    val hi = effectiveEnd + slackSec
    val bySec = LinkedHashMap<Long, TrackFix>()
    for (fix in points) {
      val sec = fix.timeMs / 1000L
      if (sec > 0L && sec in lo..hi && fix.lat.isFinite() && fix.lon.isFinite() && fix.lat in -90.0..90.0 && fix.lon in -180.0..180.0) {
        bySec.putIfAbsent(sec, fix)
      }
    }
    return bySec.values.toList()
  }
}

/**
 * Bounded, optionally file-backed store of recent phone GPS tracks from [LiveWorkout] so that [WorkoutWriter] can attach
 * the route map when the wearable workout syncs (either during the live session stop sequence or on the next sync).
 */
internal class ConnectedGpsStore(private val storageFile: File? = null) {
  private val lock = Any()
  private val sessions = ArrayList<ConnectedGpsSession>()
  private val writer = java.util.concurrent.Executors.newSingleThreadExecutor { r ->
    Thread(r, "ConnectedGpsStore-IO").apply { isDaemon = true }
  }

  init {
    loadFromDisk()
  }

  fun clear() {
    synchronized(lock) {
      sessions.clear()
      runCatching { storageFile?.delete() }
    }
  }

  fun upsert(session: ConnectedGpsSession, persist: Boolean = true) {
    if (session.points.size < 2 || session.startSec <= 0L) return
    if (WorkoutSportTypes.isIndoor(session.sportType)) return
    synchronized(lock) {
      val cutoff = max(0L, session.effectiveEndSec - RETENTION_SEC)
      sessions.removeAll { it.id == session.id || abs(it.startSec - session.startSec) <= 10L || it.effectiveEndSec < cutoff }
      sessions.add(session)
      while (sessions.size > MAX_SESSIONS) sessions.removeAt(0)
      if (persist) saveToDiskLocked()
    }
  }

  fun match(workoutStartSec: Long, workoutEndSec: Long, sportType: Int?): ConnectedGpsSession? {
    if (workoutStartSec <= 0L || WorkoutSportTypes.isIndoor(sportType)) return null
    synchronized(lock) {
      return sessions
        .filter { s ->
          val effectiveEnd = if (workoutEndSec > workoutStartSec) workoutEndSec else s.effectiveEndSec
          val sportOk = sportType == null || s.sportType == null || s.sportType == sportType
          val overlap = min(effectiveEnd + MATCH_SLACK_SEC, s.effectiveEndSec) - max(workoutStartSec - MATCH_SLACK_SEC, s.startSec)
          sportOk && overlap > 0L && s.fixesInWindow(workoutStartSec, effectiveEnd).size >= 2
        }
        .maxWithOrNull(compareBy<ConnectedGpsSession> { s ->
          val effectiveEnd = if (workoutEndSec > workoutStartSec) workoutEndSec else s.effectiveEndSec
          s.fixesInWindow(workoutStartSec, effectiveEnd).size
        }.thenBy { -abs(it.startSec - workoutStartSec) })
    }
  }

  private fun loadFromDisk() {
    val file = storageFile ?: return
    if (!file.isFile) return
    runCatching {
      val arr = JSONArray(file.readText())
      synchronized(lock) {
        for (i in 0 until min(arr.length(), MAX_SESSIONS)) {
          val obj = arr.optJSONObject(i) ?: continue
          val ptsArr = obj.optJSONArray("points") ?: continue
          val pts = ArrayList<TrackFix>(ptsArr.length())
          for (j in 0 until min(ptsArr.length(), TrackAccumulator.MAX_TRACK_POINTS)) {
            val p = ptsArr.optJSONObject(j) ?: continue
            val lat = p.optDouble("lat", Double.NaN)
            val lon = p.optDouble("lon", Double.NaN)
            if (!lat.isFinite() || !lon.isFinite()) continue
            pts.add(
              TrackFix(
                timeMs = p.optLong("t", 0L),
                lat = lat,
                lon = lon,
                altitudeM = if (p.has("alt")) p.optDouble("alt") else null,
                accuracyM = if (p.has("acc")) p.optDouble("acc").toFloat() else null,
                speedMps = if (p.has("spd")) p.optDouble("spd").toFloat() else null,
                bearingDeg = null,
              )
            )
          }
          if (pts.size >= 2) {
            sessions.add(
              ConnectedGpsSession(
                id = obj.optString("id", "persisted-$i"),
                startSec = obj.optLong("startSec", 0L),
                endSec = obj.optLong("endSec", 0L),
                sportType = if (obj.has("sportType")) obj.optInt("sportType") else null,
                distanceM = obj.optDouble("distanceM", 0.0),
                riseM = obj.optDouble("riseM", 0.0),
                points = pts,
              )
            )
          }
        }
      }
    }
  }

  private fun saveToDiskLocked() {
    val file = storageFile ?: return
    val snapshot = ArrayList(sessions)
    writer.execute {
      runCatching {
        val arr = JSONArray()
        for (s in snapshot) {
          val pts = JSONArray()
          for (p in s.points) {
            val po = JSONObject().put("t", p.timeMs).put("lat", p.lat).put("lon", p.lon)
            if (p.altitudeM != null && p.altitudeM.isFinite()) po.put("alt", p.altitudeM)
            if (p.accuracyM != null && p.accuracyM.isFinite()) po.put("acc", p.accuracyM.toDouble())
            if (p.speedMps != null && p.speedMps.isFinite()) po.put("spd", p.speedMps.toDouble())
            pts.put(po)
          }
          val obj = JSONObject()
            .put("id", s.id)
            .put("startSec", s.startSec)
            .put("endSec", s.endSec)
            .put("distanceM", s.distanceM)
            .put("riseM", s.riseM)
            .put("points", pts)
          if (s.sportType != null) obj.put("sportType", s.sportType)
          arr.put(obj)
        }
        val parent = file.parentFile
        parent?.mkdirs()
        val tmp = File(parent ?: file.absoluteFile.parentFile, "${file.name}.tmp")
        tmp.writeText(arr.toString())
        if (!tmp.renameTo(file)) {
          file.writeText(arr.toString())
          tmp.delete()
        }
      }
    }
  }

  companion object {
    const val MATCH_SLACK_SEC = 180L
    const val MAX_SESSIONS = 20
    const val RETENTION_SEC = 7 * 86_400L

    @Volatile
    var shared: ConnectedGpsStore = ConnectedGpsStore()
  }
}

/** Merges a matching [ConnectedGpsSession] into a [WorkoutRecord] (or already-stored DB row) that lacks watch GPS points. */
internal object ConnectedGpsMerger {
  fun merge(record: WorkoutRecord, store: ConnectedGpsStore = ConnectedGpsStore.shared): WorkoutRecord {
    if (record.points.any { it.lat != null && it.lon != null }) return record
    val nominalEnd = if (record.end > record.start) record.end else if (record.duration > 0) record.start + record.duration else 0L
    val session = store.match(record.start, nominalEnd, record.sportType) ?: return record
    val effectiveEnd = if (nominalEnd > record.start) nominalEnd else session.effectiveEndSec
    val fixes = session.fixesInWindow(record.start, effectiveEnd, slackSec = 0L)
    val windowStart = record.start
    val windowEnd = max(record.start, effectiveEnd)
    val validFixes = fixes.filter { (it.timeMs / 1000L) in windowStart..windowEnd }
    if (validFixes.size < 2) return record

    val gpsPoints = validFixes.map { fix ->
      WorkoutPoint(
        ts = fix.timeMs / 1000L,
        lat = fix.lat,
        lon = fix.lon,
        alt = fix.altitudeM,
        hr = null,
        speed = fix.speedMps?.toDouble(),
      )
    }
    val mergedPoints = (record.points + gpsPoints).sortedBy { it.ts }
    val routeDistM = if (session.distanceM > 0.0) session.distanceM else routeDistanceM(validFixes)
    val newDistance = if (record.distance > 0) record.distance else routeDistM.roundToInt()
    val updatedSummary = enrichSummaryJson(record.summaryJson, validFixes, gpsPoints.size, newDistance, record.duration, session.riseM)

    return WorkoutRecord(
      number = record.number,
      start = record.start,
      end = if (record.end > record.start) record.end else effectiveEnd,
      sportType = record.sportType,
      sportName = record.sportName,
      duration = record.duration,
      distance = newDistance,
      calories = record.calories,
      steps = record.steps,
      avgHr = record.avgHr,
      maxHr = record.maxHr,
      summaryJson = updatedSummary,
      points = mergedPoints,
      complete = record.complete,
    )
  }

  /**
   * Reverse-order backfill: when a band workout synced to SQLite just before [LiveWorkout] finished or flushed its last fixes,
   * attaches the phone's GPS route to the already-stored workout row if it currently has zero GPS points.
   */
  fun backfillStored(db: WatchDb, address: String, session: ConnectedGpsSession): Int {
    if (session.points.size < 2 || WorkoutSportTypes.isIndoor(session.sportType)) return 0
    val lo = session.startSec - ConnectedGpsStore.MATCH_SLACK_SEC
    val hi = session.effectiveEndSec + ConnectedGpsStore.MATCH_SLACK_SEC
    val rows = db.query(
      """SELECT w.id, w.start, w.end, w.sport_type, w.duration, w.distance, w.summary_json
         FROM workouts w
         WHERE w.imported = 0 AND (? = '' OR w.device IS NULL OR LOWER(w.device) = LOWER(?))
           AND CAST(MAX(COALESCE(w.end, 0), w.start + COALESCE(w.duration, 0)) AS INTEGER) >= ? AND w.start <= ?
           AND NOT EXISTS (
             SELECT 1 FROM workout_points p WHERE p.workout_id = w.id AND p.lat IS NOT NULL AND p.lon IS NOT NULL
           )""",
      address, address, lo, hi,
    )
    var updated = 0
    for (row in rows) {
      val workoutId = row[0] as Long
      val startSec = row[1] as Long
      val rawEndSec = row[2] as Long
      val sportType = (row[3] as? Long)?.toInt()
      val durationSec = (row[4] as? Long)?.toInt() ?: 0
      val distanceM = (row[5] as? Long)?.toInt() ?: 0
      val summaryJson = (row[6] as? String) ?: "{}"
      val endSec = if (rawEndSec > startSec) rawEndSec else if (durationSec > 0) startSec + durationSec else session.effectiveEndSec
      if (WorkoutSportTypes.isIndoor(sportType)) continue
      if (sportType != null && session.sportType != null && sportType != session.sportType) continue
      val fixes = session.fixesInWindow(startSec, endSec, slackSec = 0L)
      val windowMax = max(startSec, endSec)
      val validFixes = fixes.filter { (it.timeMs / 1000L) in startSec..windowMax }
      if (validFixes.size < 2) continue
      val routeDistM = if (session.distanceM > 0.0) session.distanceM else routeDistanceM(validFixes)
      val newDistance = if (distanceM > 0) distanceM else routeDistM.roundToInt()
      val newSummary = enrichSummaryJson(summaryJson, validFixes, validFixes.size, newDistance, durationSec, session.riseM)
      val gpsPoints = validFixes.map { fix ->
        WorkoutPoint(
          ts = fix.timeMs / 1000L,
          lat = fix.lat,
          lon = fix.lon,
          alt = fix.altitudeM,
          hr = null,
          speed = fix.speedMps?.toDouble(),
        )
      }
      db.transaction {
        val newEnd = if (rawEndSec > startSec) rawEndSec else endSec
        db.exec("UPDATE workouts SET distance = ?, end = ?, summary_json = ?, phone_gps = 1 WHERE id = ?", newDistance, newEnd, newSummary, workoutId)
        db.insertPoints(workoutId, gpsPoints)
      }
      updated++
    }
    return updated
  }

  fun enrichSummaryJson(
    summaryJson: String,
    fixes: List<TrackFix>,
    gpsPointsCount: Int,
    distanceM: Int,
    durationSec: Int,
    riseM: Double,
  ): String {
    val obj = runCatching { JSONObject(summaryJson) }.getOrElse { JSONObject() }
    obj.put("gps", "ok")
    obj.put("gpsPoints", gpsPointsCount)
    obj.put("gpsSource", "phone")
    if (distanceM > 0 && durationSec > 0) {
      val avgSpeed = distanceM.toDouble() / durationSec.toDouble()
      if (obj.isNull("avgSpeed") || obj.optDouble("avgSpeed", 0.0) <= 0.0) {
        obj.put("avgSpeed", (avgSpeed * 100.0).roundToInt() / 100.0)
      }
      if ((obj.isNull("avgPaceSecPerKm") || obj.optInt("avgPaceSecPerKm", 0) <= 0) && avgSpeed > 0.0) {
        obj.put("avgPaceSecPerKm", (1000.0 / avgSpeed).roundToInt())
      }
    }
    if ((obj.isNull("elevationGain") || obj.optDouble("elevationGain", 0.0) <= 0.0) && riseM > 0.0) {
      obj.put("elevationGain", (riseM * 10.0).roundToInt() / 10.0)
    }
    val alts = fixes.mapNotNull { it.altitudeM?.takeIf(Double::isFinite) }
    if (alts.isNotEmpty()) {
      if (obj.isNull("minAltitude")) obj.put("minAltitude", ((alts.minOrNull() ?: 0.0) * 10.0).roundToInt() / 10.0)
      if (obj.isNull("maxAltitude")) obj.put("maxAltitude", ((alts.maxOrNull() ?: 0.0) * 10.0).roundToInt() / 10.0)
    }
    return obj.toString()
  }

  private fun routeDistanceM(fixes: List<TrackFix>): Double {
    var sum = 0.0
    for (i in 1 until fixes.size) {
      sum += TrackAccumulator.haversineM(fixes[i - 1].lat, fixes[i - 1].lon, fixes[i].lat, fixes[i].lon)
    }
    return sum
  }
}
