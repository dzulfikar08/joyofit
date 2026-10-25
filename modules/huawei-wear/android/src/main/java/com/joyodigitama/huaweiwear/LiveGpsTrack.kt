package com.joyodigitama.huaweiwear

import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/** One fix of the phone's GPS, as [LiveWorkout] follows a workout the watch runs. Pure data, so the arithmetic below runs on the JVM. */
internal class TrackFix(
  val timeMs: Long,
  val lat: Double,
  val lon: Double,
  val altitudeM: Double?,
  val accuracyM: Float?,
  val speedMps: Float?,
  val bearingDeg: Float?,
)

/**
 * Distance, climb and current speed of a workout from the phone's own GPS, for the figures the watch does not send (a band
 * without a GPS of its own reports no distance or pace until the phone's fixes reach it, and some never report a climb).
 * Fed with the fixes of the stretch the workout is RUNNING; the pauses are simply not fed.
 *  - Fixes worse than [MAX_ACCURACY_M] are dropped, and a step shorter than [MIN_STEP_M] from the last kept fix is jitter (the
 *    kept fix does not move, so a slow drift still adds up once it is past the threshold).
 *  - A jump faster than [MAX_SPEED_MPS] is a bad fix.
 *  - The climb runs on a smoothed altitude (GPS altitude jumps by metres) with a [RISE_HYSTERESIS_M] dead band, so noise does not
 *    add up to metres of "climb" while standing still.
 *  - The current speed is the distance of the last [SPEED_WINDOW_MS], once at least [SPEED_MIN_SPAN_MS] of it is known.
 */
internal class TrackAccumulator {
  var distanceM = 0.0
    private set
  var riseM = 0.0
    private set

  private var last: TrackFix? = null
  private var smoothedAlt: Double? = null
  private var referenceAlt: Double? = null
  private val window = ArrayDeque<Pair<Long, Double>>()

  /** Metres per second over the recent window, null while there is not enough of it (or the person stands still: then 0). */
  val speedMps: Double?
    get() {
      val newest = window.lastOrNull() ?: return null
      val oldest = window.first()
      val span = newest.first - oldest.first
      if (span < SPEED_MIN_SPAN_MS) return null
      return (newest.second - oldest.second) / (span / 1000.0)
    }

  /** Seconds per kilometre of [speedMps]; null when unknown or when standing (below [MIN_PACE_SPEED_MPS], a pace would be meaningless). */
  val paceSecPerKm: Int?
    get() {
      val v = speedMps ?: return null
      return if (v >= MIN_PACE_SPEED_MPS) (1000.0 / v).toInt() else null
    }

  fun reset() {
    distanceM = 0.0
    riseM = 0.0
    last = null
    smoothedAlt = null
    referenceAlt = null
    window.clear()
  }

  /** The workout was paused (or only starts now): the next fix begins a new stretch, nothing is added for the way in between. */
  fun gap() {
    last = null
    window.clear()
  }

  /** Takes a fix of the running workout; false when it was dropped. */
  fun add(fix: TrackFix): Boolean {
    if (fix.accuracyM != null && fix.accuracyM > MAX_ACCURACY_M) return false
    val prev = last
    if (prev == null) {
      last = fix
      window.addLast(fix.timeMs to distanceM)
      takeAltitude(fix)
      return true
    }
    val dtS = (fix.timeMs - prev.timeMs) / 1000.0
    if (dtS <= 0.0) return false
    val step = haversineM(prev.lat, prev.lon, fix.lat, fix.lon)
    if (step / dtS > MAX_SPEED_MPS) return false
    // The altitude and the speed window follow every good fix, the distance only a real step.
    takeAltitude(fix)
    if (step < MIN_STEP_M) {
      window.addLast(fix.timeMs to distanceM)
      trim(fix.timeMs)
      return true
    }
    distanceM += step
    last = fix
    window.addLast(fix.timeMs to distanceM)
    trim(fix.timeMs)
    return true
  }

  private fun trim(nowMs: Long) {
    while (window.size > 2 && nowMs - window.first().first > SPEED_WINDOW_MS) window.removeFirst()
  }

  private fun takeAltitude(fix: TrackFix) {
    val alt = fix.altitudeM ?: return
    val smooth = smoothedAlt?.let { it + ALT_ALPHA * (alt - it) } ?: alt
    smoothedAlt = smooth
    val ref = referenceAlt
    if (ref == null) {
      referenceAlt = smooth
    } else if (smooth - ref >= RISE_HYSTERESIS_M) {
      riseM += smooth - ref
      referenceAlt = smooth
    } else if (ref - smooth >= RISE_HYSTERESIS_M) {
      referenceAlt = smooth
    }
  }

  companion object {
    const val MAX_ACCURACY_M = 30f
    const val MIN_STEP_M = 3.0
    const val MAX_SPEED_MPS = 30.0
    const val ALT_ALPHA = 0.25
    const val RISE_HYSTERESIS_M = 3.0
    const val SPEED_WINDOW_MS = 10_000L
    const val SPEED_MIN_SPAN_MS = 3_000L

    /** Below this (about 1:00:00 per km) the person is standing and no pace is shown. */
    const val MIN_PACE_SPEED_MPS = 0.28

    private const val EARTH_RADIUS_M = 6_371_008.8

    fun haversineM(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
      val p1 = Math.toRadians(lat1)
      val p2 = Math.toRadians(lat2)
      val dLat = p2 - p1
      val dLon = Math.toRadians(lon2 - lon1)
      val a = sin(dLat / 2) * sin(dLat / 2) + cos(p1) * cos(p2) * sin(dLon / 2) * sin(dLon / 2)
      return 2 * EARTH_RADIUS_M * asin(sqrt(a.coerceIn(0.0, 1.0)))
    }
  }
}

/**
 * Whether a watch that gives no sign of when its workout starts (it does not answer the `17/03` poll and sends no `17/11`
 * report) has been started: [FIXES] fixes in a row at a walking pace or faster. The person standing on the watch's GO screen does
 * not move, so this does not start the clock early the way the first GPS request used to; a watch that does talk never needs it.
 */
internal class MotionStart {
  private var run = 0

  /** True once the person has been moving for [FIXES] good fixes in a row. */
  fun onFix(speedMps: Float?, accuracyM: Float?): Boolean {
    val moving = speedMps != null && speedMps >= MIN_SPEED_MPS && (accuracyM == null || accuracyM <= TrackAccumulator.MAX_ACCURACY_M)
    run = if (moving) run + 1 else 0
    return run >= FIXES
  }

  fun reset() {
    run = 0
  }

  companion object {
    const val FIXES = 3
    const val MIN_SPEED_MPS = 1.0f
  }
}

/**
 * The phone's track of one live session (pure, so the rules run on the JVM):
 *  - every fix becomes the newest [location], for the map, whatever state the session is in;
 *  - only the fixes of a running stretch feed [track]: a fix while the watch only prepares (its GO screen, the GPS search, the countdown)
 *    or while the workout is paused adds nothing;
 *  - the switch to running begins a new stretch at the newest fix ([startStretch]).
 * Start fresh rather than buffer the preparing fixes: the clock starts at that same moment (docs/live-run.md, "state machine"), so the
 * distance and the time cover the same stretch and the average pace stays honest. A buffer would add the way to the start line, the
 * pacing in front of the GO screen or the [MotionStart] run-up, none of which is in the clock (nor in the watch's own figures).
 */
internal class SessionTrack {
  /** The newest fix, null before the first. */
  var location: TrackFix? = null
    private set

  /** Distance, climb and speed of the running stretches. */
  val track = TrackAccumulator()

  /** Counts fixes of a person on the move, for a watch that never says when its workout starts. */
  private val motion = MotionStart()

  /**
   * Takes a fix. [running]: the session runs, so the fix counts. [motionStarts]: the session prepares for a watch that gives no sign
   * of its start, so movement is the start. Returns true when this fix completes that movement ([MotionStart]): the caller starts the
   * session, which calls [startStretch].
   */
  fun onFix(fix: TrackFix, running: Boolean, motionStarts: Boolean): Boolean {
    location = fix
    if (running) {
      track.add(fix)
      return false
    }
    return motionStarts && motion.onFix(fix.speedMps, fix.accuracyM)
  }

  /**
   * The session runs, from preparing or again after a pause: nothing from before is joined to what follows. The newest fix, when it
   * is at most [ANCHOR_MAX_AGE_MS] from [nowMs], is where the new stretch starts, so the first second after the start is not lost; an
   * older one is not where the person is now, and the next fix starts the stretch instead.
   */
  fun startStretch(nowMs: Long) {
    track.gap()
    val newest = location ?: return
    if (abs(nowMs - newest.timeMs) <= ANCHOR_MAX_AGE_MS) track.add(newest)
  }

  companion object {
    const val ANCHOR_MAX_AGE_MS = 5_000L
  }
}

/**
 * The phone's location updates for a live workout and the `18/03` feed of them to the watch, as two lifetimes ([WorkoutLink]):
 *  - the watch's `18/02 {01: 1}` starts both; its `{01: 0}` stops only the feed. A watch with a GPS of its own withdraws its request
 *    once it has a fix (Fit 4 Pro: 80 s into a walk, 2026-10-25) and sends no figures of its own, so the phone's track stays the only
 *    source of distance and pace (docs/live-run.md);
 *  - the updates stop when the live session ends ([sessionEnded]: Finish, the watch's stop, the status poll, the watchdog); when the
 *    request is withdrawn with no live session to follow (a phone-started run, whose screen owns the watch's workout); and when the
 *    link is lost, unless the session ends by itself without it ([linkLost]);
 *  - a request after that starts both again.
 * [start] returns false when the updates cannot run (no permission, no provider): the watch's next request tries again.
 */
internal class PhoneGpsSession(private val start: () -> Boolean, private val stop: () -> Unit) {
  private val lock = Any()
  private var tracking = false

  /** The fixes also go to the watch. */
  @Volatile
  var feeding = false
    private set

  /** The phone's location updates run. */
  val isTracking: Boolean get() = synchronized(lock) { tracking }

  /** `18/02 {01: 1}`. */
  fun watchAsks() {
    synchronized(lock) {
      feeding = true
      if (!tracking) tracking = start()
    }
  }

  /** `18/02 {01: 0}`: the feed stops; the updates go on while [liveSession] (a live workout is followed). */
  fun watchWithdraws(liveSession: Boolean) {
    synchronized(lock) {
      feeding = false
      if (!liveSession) stopTracking()
    }
  }

  /**
   * The link to the watch is gone: nothing to feed. The updates go on only while [sessionEndsWithoutLink]: a live session that ends
   * by itself when the watch goes quiet ([LiveWorkout.endsWithoutLink], the GPS-request session and its watchdog). Any other session
   * would only end on Finish, so the updates stop now, and the watch's next request after a reconnect starts them again.
   */
  fun linkLost(sessionEndsWithoutLink: Boolean) = watchWithdraws(sessionEndsWithoutLink)

  /** The live session ended: everything stops. */
  fun sessionEnded() {
    synchronized(lock) {
      feeding = false
      stopTracking()
    }
  }

  private fun stopTracking() {
    if (!tracking) return
    tracking = false
    stop()
  }
}
