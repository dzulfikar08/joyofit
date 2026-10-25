package com.joyodigitama.huaweiwear

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import java.time.LocalDate
import java.util.Locale
import kotlin.math.roundToInt
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * A workout on the watch, followed live on the phone. Two sources:
 *  - the watch's own numbers, when it sends them (Huawei Health's reverse linkage [LiveWorkoutWire], or the `17/11` report);
 *  - otherwise JoyoFit's own session ([Source.GPS] / [Source.STATUS] / [Source.MANUAL]): the Fit 4 Pro (6.1.0.117) sends
 *    neither, but asks for the phone's GPS about every 20 s from the moment its workout screen looks for a fix, answers the
 *    `17/03` status poll, and pushes realtime heart rate when asked. The session runs on that heart rate: calories from
 *    [HeartRateEnergy], time from the phone's clock, which starts only when the watch says the workout runs (its `17/03` status,
 *    a `17/11` report, a start event; a watch that gives none of these starts it by the person moving, [MotionStart]). A GPS
 *    request alone never starts it: the watch asks for the phone's GPS from its pre-start (GO) screen on, so until the watch
 *    says otherwise the session is [Status.PREPARING]. It ends when the status poll says "no workout"
 *    [LiveWorkoutPolicy.IDLE_ANSWERS_TO_END] times in a row, or the user taps Finish; a watch that is not conclusive (still
 *    asks for GPS, or answers nothing) makes the screen ask the user (`endSuspected`) instead of dropping the session.
 * Either way it keeps JoyoFit's fat and carbohydrate estimate ([SubstrateEstimator]), the phone's own GPS track of a workout the watch
 * asked GPS for (to the session's end, [SessionTrack], [PhoneGpsSession]), an ongoing notification that opens the
 * live screen, and reports every change to JS (`onLiveWorkout`). The state decisions live in [LiveWorkoutPolicy].
 */
internal class LiveWorkout(
  context: Context,
  private val dataSync: DataSyncService,
  private val events: WearEvents,
  private val settings: WearSettings,
  private val liveHeartRate: LiveHeartRate,
  private val scope: CoroutineScope,
) : DataSyncFeature {
  override val name = "live workout"

  enum class Status(val wire: String) { PREPARING("preparing"), RUNNING("running"), PAUSED("paused"), ENDED("ended") }

  /** Where the numbers come from: the watch, or JoyoFit's heart-rate session started by the GPS requests or by hand. */
  enum class Source(val wire: String) { WATCH("watch"), GPS("gps"), STATUS("status"), MANUAL("manual") }

  private class Session(
    val id: Long,
    var sportType: Int?,
    var status: Status,
    var metrics: LiveMetrics,
    val estimator: SubstrateEstimator,
    val maxHeartRate: Int,
    var updatedAtMs: Long,
    var source: Source,
    var endedAtMs: Long? = null,
    /** Phone-side session: kcal so far, last heart-rate time, last GPS request. */
    var estimatedKcal: Double = 0.0,
    var lastHeartRateAtMs: Long? = null,
    var lastGpsAtMs: Long = 0L,
  ) {
    /** Phone-side session: workout time, counted from the moment the watch really ran the workout. */
    val clock = WorkoutClock()

    /** Phone-side session: the watch's own status said the workout runs (a GPS request alone does not). */
    var confirmed = false

    /** The watch looks to have stopped but did not say so: JS asks the user (Finish / keep going). */
    var endSuspected = false

    /**
     * The phone's GPS for this session: the newest fix for the map (also while the workout only prepares), and distance, climb and
     * speed from the fixes of the running stretches, the figures a watch that sends none of its own lacks ([SessionTrack]).
     */
    var phoneTrack = SessionTrack()

    /** The watch asked for the phone's GPS during this session: an outdoor sport, whatever sport tag it did or did not send. */
    var gpsRequested = false
  }

  private var watchdog: Job? = null

  /**
   * True while a workout the phone started on the watch ([WatchWorkoutControl]) is owned by a screen of its own (the strength logger): the
   * watch's workout is then not mirrored as a live workout, which would open a second screen for the same session. A mirror that is already
   * running is left alone; only a new one is not opened.
   */
  @Volatile
  var phoneOwned: () -> Boolean = { false }

  private fun mirrorBlocked(): Boolean = phoneOwned() && synchronized(lock) { session?.status.let { it == null || it == Status.ENDED } }

  /** Last answer of the 17/03 status poll, and how many answers in a row said "no workout". */
  private var lastStatusAtMs = 0L
  private var idleAnswers = 0

  /** A `17/11` report was received on this link: the watch tells its own start, so movement is no signal to wait for. */
  private var reportsSeen = false

  /**
   * Called once each time a session ends, outside [lock]: the phone's location updates for it stop ([WorkoutLink],
   * [PhoneGpsSession.sessionEnded]).
   */
  @Volatile
  var onEnded: () -> Unit = {}

  /** The ended session [onEnded] was already called for. */
  private var endReported: Session? = null

  private val appContext = context.applicationContext
  private val lock = Any()
  private var session: Session? = null
  private var notifiedAtMs = 0L
  private var notifiedStatus: Status? = null

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, message)

  override fun register(service: DataSyncService) {
    service.onEvent(LiveWorkoutWire.PHONE_PKG, LiveWorkoutWire.WATCH_PKG, null) { onEvent(it) }
    service.onPoint(LiveWorkoutWire.PHONE_PKG, LiveWorkoutWire.WATCH_PKG, null) { onPoint(it) }
  }

  /** The current or last workout for JS (`getLiveWorkout`), null when none was seen since the app started. */
  fun snapshot(): Map<String, Any?>? = synchronized(lock) { session?.let { toJs(it) } }

  /** True from a workout's start until it ends: the link must not be taken away from it. */
  val isLive: Boolean get() = synchronized(lock) { session?.status.let { it != null && it != Status.ENDED } }

  /**
   * True while the live session ends by itself once the watch is gone ([LiveWorkoutPolicy.endsWithoutLink]: the GPS-request session
   * and its watchdog), so it may keep the phone's GPS through a lost link. Any other session ends only on what the watch says, or
   * Finish; a lost link brings neither, so the phone's GPS must not wait for it ([PhoneGpsSession.linkLost]).
   */
  val endsWithoutLink: Boolean
    get() = synchronized(lock) { session?.let { it.status != Status.ENDED && LiveWorkoutPolicy.endsWithoutLink(it.source) } ?: false }

  /** The user closed the finished workout on the phone. */
  fun dismiss() {
    synchronized(lock) {
      if (session?.status == Status.ENDED) session = null
    }
    cancelNotification()
  }

  /** Live screen "Start": a phone-side session for a workout the watch does not announce (indoor). */
  fun startManual() {
    synchronized(lock) {
      if (session?.status.let { it != null && it != Status.ENDED }) return
      session = newSession(null, Status.RUNNING, Source.MANUAL)
    }
    log("Live workout: started on the phone")
    liveHeartRate.setWorkoutActive(true)
    publish(force = true)
  }

  /** Live screen "Finish". */
  fun finish() = end("finished on the phone")

  private fun end(why: String) {
    synchronized(lock) {
      val s = session ?: return
      if (s.status == Status.ENDED) return
      setStatus(s, Status.ENDED, System.currentTimeMillis())
    }
    log("Live workout: ended ($why)")
    liveHeartRate.setWorkoutActive(false)
    watchdog?.cancel()
    watchdog = null
    publish(force = true)
  }

  /**
   * Realtime heart rate from the watch: drives a phone-side session; a watch-fed one has its own heart rate. While the
   * watch only prepares (searching for GPS) the heart rate shows but no time or energy is counted.
   */
  fun onHeartRate(bpm: Int) {
    synchronized(lock) {
      val s = session ?: return
      if (s.source == Source.WATCH || (s.status != Status.RUNNING && s.status != Status.PREPARING)) return
      val now = System.currentTimeMillis()
      if (s.status == Status.PREPARING) {
        s.metrics = s.metrics.copy(heartRate = bpm)
        s.updatedAtMs = now
      } else {
        val last = s.lastHeartRateAtMs
        s.lastHeartRateAtMs = now
        if (last != null) {
          // A reading covers the time since the previous one, at most 10 s (the link may have dropped in between).
          val minutes = (now - last).coerceIn(0L, 10_000L) / 60_000.0
          val profile = settings.profile
          val age = profile?.birthYear?.takeIf { it > 0 }?.let { ProfileSender.age(it, LocalDate.now()) } ?: DEFAULT_AGE
          val weight = profile?.weightKg?.takeIf { it > 0 } ?: DEFAULT_WEIGHT_KG
          s.estimatedKcal += HeartRateEnergy.kcalPerMinute(bpm, weight, age, profile?.sex ?: "unknown") * minutes
        }
        s.metrics = s.metrics.copy(heartRate = bpm, calories = s.estimatedKcal, durationSec = s.clock.seconds(now) ?: s.metrics.durationSec)
        s.updatedAtMs = now
        s.estimator.update(s.estimatedKcal, bpm)
      }
    }
    publish(force = false)
  }

  private suspend fun onEvent(event: SampleEvent) {
    if (mirrorBlocked()) return
    when (event.eventId) {
      LiveWorkoutWire.EVENT_CONTROL -> onControl(LiveWorkoutWire.parseControl(event.data))
      LiveWorkoutWire.EVENT_START -> change(LiveWorkoutWire.parseWorkoutType(event.data), Status.RUNNING, "started", opens = true)
      LiveWorkoutWire.EVENT_PAUSE -> change(LiveWorkoutWire.parseWorkoutType(event.data), Status.PAUSED, "paused")
      LiveWorkoutWire.EVENT_RESUME -> change(LiveWorkoutWire.parseWorkoutType(event.data), Status.RUNNING, "resumed")
      LiveWorkoutWire.EVENT_STOP -> change(LiveWorkoutWire.parseWorkoutType(event.data), Status.ENDED, "stopped")
      else -> log("Live workout: event ${event.eventId} not handled, data=${DataSyncService.describe(event.data)}")
    }
  }

  private suspend fun onControl(control: LiveWorkoutWire.Control) {
    log("Live workout: control op=${control.operation} type=${control.workoutType} status=${control.status}")
    val watchStatus = when (control.status) {
      LiveWorkoutWire.WATCH_RUNNING -> Status.RUNNING
      LiveWorkoutWire.WATCH_PAUSED -> Status.PAUSED
      else -> Status.PREPARING
    }
    when (control.operation) {
      LiveWorkoutWire.OP_START -> {
        // A new workout on the watch: always a fresh session, even if the last one never saw its stop.
        synchronized(lock) { session = newSession(control.workoutType, watchStatus) }
        publish(force = true)
        reply(LiveWorkoutWire.OP_START, "start")
      }
      LiveWorkoutWire.OP_RESUME -> {
        // The watch picks the phone up again (after a reconnect) with its current state.
        val status = if (control.status == LiveWorkoutWire.WATCH_PAUSED) Status.PAUSED else Status.RUNNING
        change(control.workoutType, status, "linked again")
        reply(LiveWorkoutWire.OP_RESUME, "resume")
      }
      LiveWorkoutWire.OP_STOP -> {
        change(control.workoutType, Status.ENDED, "stopped (control)")
        reply(LiveWorkoutWire.OP_STOP, "stop")
      }
      LiveWorkoutWire.OP_REPORT -> log("Live workout: watch reports linkage status ${control.status}")
      else -> log("Live workout: unknown control operation ${control.operation}")
    }
  }

  private suspend fun reply(operation: Int, what: String) {
    dataSync.sendEvent(
      LiveWorkoutWire.PHONE_PKG,
      LiveWorkoutWire.WATCH_PKG,
      LiveWorkoutWire.EVENT_CONTROL,
      LiveWorkoutWire.reply(operation),
      what = "live workout $what reply",
    )
  }

  private fun change(workoutType: Int?, status: Status, what: String, opens: Boolean = false) {
    val now = System.currentTimeMillis()
    synchronized(lock) {
      val current = session?.takeIf { it.status != Status.ENDED }
      if (current == null) {
        // Nothing to stop; right after a workout ended only a start opens a new one (a late pause or resume is a straggler).
        if (status == Status.ENDED) return
        val endedAt = session?.endedAtMs
        if (!opens && endedAt != null && now - endedAt < LiveWorkoutPolicy.RESTART_GUARD_MS) return
        // A pause or resume without a known start (the app started mid-workout) still opens a session.
        session = newSession(workoutType, status)
      } else {
        if (workoutType != null) current.sportType = workoutType
        setStatus(current, status, now)
      }
    }
    log("Live workout: $what (type $workoutType)")
    publish(force = true)
  }

  private fun onPoint(point: SamplePointIn) {
    if (mirrorBlocked()) return
    synchronized(lock) {
      val now = System.currentTimeMillis()
      val frame = LiveMetrics().applyPoint(point.values)
      val running = frame.watchState == 1 || frame.watchState == 2
      if (!acceptsWatchFrame(running, frame.durationSec, frame.watchState == 3, now)) return
      val current = watchSession(if (LiveWorkoutPolicy.isRunningFrame(running, frame.durationSec)) Status.RUNNING else Status.PREPARING)
      val metrics = current.metrics.applyPoint(point.values)
      current.metrics = metrics
      current.updatedAtMs = now
      current.estimator.update(metrics.calories, metrics.heartRate)
      val next = when (metrics.watchState) {
        1 -> Status.RUNNING
        2 -> Status.PAUSED
        3 -> Status.ENDED
        else -> if (current.status == Status.PREPARING && LiveWorkoutPolicy.isRunningFrame(running, metrics.durationSec)) Status.RUNNING else null
      }
      if (next != null) setStatus(current, next, now)
    }
    publish(force = false)
  }

  /**
   * The watch's answer to the status poll (`17/03`): the watch says when the workout really runs (after its GPS search and
   * countdown), so this is what starts the phone's timer for a session opened by a GPS request, and what starts one for
   * a running workout nothing else announced (indoor ones included). It follows pause and resume, and ends a session once
   * the watch is idle ([LiveWorkoutPolicy.idleVerdict]).
   */
  fun watchStatus(running: Boolean, paused: Boolean, workoutType: Int?) {
    if (mirrorBlocked()) return
    var created = false
    var ended = false
    var changed = false
    var note: String? = null
    synchronized(lock) {
      val now = System.currentTimeMillis()
      lastStatusAtMs = now
      idleAnswers = if (running) 0 else idleAnswers + 1
      val s = session?.takeIf { it.status != Status.ENDED }
      when {
        running && s == null -> {
          session = newSession(workoutType, if (paused) Status.PAUSED else Status.RUNNING, Source.STATUS).also { it.confirmed = true }
          created = true
        }
        running && s != null -> {
          if (workoutType != null && s.sportType == null) s.sportType = workoutType
          if (s.source != Source.WATCH) {
            s.confirmed = true
            val want = if (paused) Status.PAUSED else Status.RUNNING
            if (s.status != want) {
              note = if (paused) "the watch paused the workout" else if (s.status == Status.PAUSED) "the watch resumed the workout" else "the watch started the workout; timer running"
              setStatus(s, want, now)
              changed = true
            } else if (s.endSuspected) {
              s.endSuspected = false
              changed = true
            }
          }
        }
        !running && s != null && (s.source == Source.STATUS || s.source == Source.GPS) -> {
          when (LiveWorkoutPolicy.idleVerdict(s.status == Status.PREPARING, s.confirmed, idleAnswers, now - s.lastGpsAtMs)) {
            LiveWorkoutPolicy.Verdict.END -> ended = true
            LiveWorkoutPolicy.Verdict.SUSPECT -> if (!s.endSuspected) {
              s.endSuspected = true
              changed = true
              note = "the watch reports no workout but still asks for GPS; asking the user"
            }
            LiveWorkoutPolicy.Verdict.KEEP -> Unit
          }
        }
        // A watch-fed session normally ends on the watch's stop frame; with the frames silent and the poll idle, a lost stop does not leave it running.
        !running && s != null && s.source == Source.WATCH ->
          ended = LiveWorkoutPolicy.watchFedEnds(s.status == Status.PREPARING, idleAnswers, now - s.updatedAtMs)
      }
    }
    note?.let { log("Live workout: $it") }
    when {
      created -> {
        log("Live workout: the watch reports a workout running (type $workoutType); following its heart rate")
        liveHeartRate.setWorkoutActive(true)
        publish(force = true)
      }
      ended -> end("the watch reported no workout $idleAnswers times in a row")
      changed -> publish(force = true)
    }
  }

  /**
   * The watch asked for the phone's GPS (the request repeats about every 20 s). It asks from the moment its workout screen
   * starts looking for a fix, which is before the workout runs, so this opens a session that is only preparing (the timer
   * waits); [watchStatus] or the watch's own numbers start it. A watch that never answered the status poll gives nothing
   * else to wait for, so its session runs from the first request. Returns true while the status should be asked now (the
   * session was just opened, or still prepares).
   */
  fun gpsPing(): Boolean {
    if (mirrorBlocked()) return false
    var created = false
    var changed = false
    var askStatus = false
    synchronized(lock) {
      val now = System.currentTimeMillis()
      val last = session
      val s = last?.takeIf { it.status != Status.ENDED }
      if (s != null) {
        s.lastGpsAtMs = now
        s.gpsRequested = true
        askStatus = s.status == Status.PREPARING
        if (s.endSuspected) {
          s.endSuspected = false
          changed = true
        }
      } else {
        // A straggling request right after a workout ended does not open a second one.
        val endedAt = last?.endedAtMs
        if (endedAt != null && now - endedAt < LiveWorkoutPolicy.RESTART_GUARD_MS) return false
        // Always preparing: the watch asks for GPS from its pre-start (GO) screen on, so the request says nothing about the
        // workout running. The status poll, a `17/11` report or a start event starts the clock; a watch that gives none of
        // those starts it by movement ([onLocation]).
        session = newSession(null, Status.PREPARING, Source.GPS).also {
          it.lastGpsAtMs = now
          it.gpsRequested = true
        }
        created = true
        askStatus = true
      }
    }
    if (!created) {
      if (changed) publish(force = true)
      return askStatus
    }
    log("Live workout: the watch asked for the phone's GPS; following its heart rate (timer waits for the watch to start the workout)")
    liveHeartRate.setWorkoutActive(true)
    watchdog?.cancel()
    watchdog = scope.launch {
      while (isActive) {
        delay(15_000L)
        var verdict = LiveWorkoutPolicy.Verdict.KEEP
        synchronized(lock) {
          val s = session
          if (s != null && s.source == Source.GPS && s.status != Status.ENDED) {
            val now = System.currentTimeMillis()
            verdict = LiveWorkoutPolicy.silenceVerdict(s.status == Status.PREPARING, now - s.lastGpsAtMs, now - lastStatusAtMs)
            if (verdict == LiveWorkoutPolicy.Verdict.SUSPECT) {
              if (s.endSuspected) verdict = LiveWorkoutPolicy.Verdict.KEEP else s.endSuspected = true
            }
          }
        }
        when (verdict) {
          LiveWorkoutPolicy.Verdict.END -> end("the watch stopped asking for GPS and does not answer the status poll")
          LiveWorkoutPolicy.Verdict.SUSPECT -> {
            log("Live workout: the watch stopped asking for GPS and does not answer the status poll; asking the user")
            publish(force = true)
          }
          LiveWorkoutPolicy.Verdict.KEEP -> Unit
        }
      }
    }
    publish(force = true)
    return askStatus
  }

  /** A `17/11` realtime report ([WorkoutReport]); operator type 1 running, 2 paused, 3 resumed, 4 stopped. */
  fun onReport(report: WorkoutReport.Parsed) {
    if (mirrorBlocked()) return
    reportsSeen = true
    synchronized(lock) {
      val now = System.currentTimeMillis()
      val operator = report.operatorType
      val running = operator == 1 || operator == 2 || operator == 3
      val frame = report.apply(LiveMetrics())
      if (!acceptsWatchFrame(running, frame.durationSec, operator == 4, now)) return
      val current = watchSession(if (LiveWorkoutPolicy.isRunningFrame(running, frame.durationSec)) Status.RUNNING else Status.PREPARING)
      val metrics = report.apply(current.metrics)
      current.metrics = metrics
      current.updatedAtMs = now
      current.estimator.update(metrics.calories, metrics.heartRate)
      val next = when (operator) {
        1, 3 -> Status.RUNNING
        2 -> Status.PAUSED
        4 -> Status.ENDED
        else -> if (current.status == Status.PREPARING && LiveWorkoutPolicy.isRunningFrame(running, metrics.durationSec)) Status.RUNNING else null
      }
      if (next != null) setStatus(current, next, now)
    }
    publish(force = false)
  }

  /**
   * A fix of the phone's GPS. It runs from the watch's first GPS request to the end of the session, also after the watch stopped
   * asking ([PhoneGpsSession]). Kept for the map; while the workout runs it also feeds the phone's own distance, climb and speed
   * ([SessionTrack]), which JS shows when the watch sends none. Fixes while the session prepares or is paused count nothing.
   * A watch that never says when its workout starts (no `17/03` answer, no `17/11` report) has no other sign than the person
   * moving: [MotionStart] starts the clock then, and only then.
   */
  fun onLocation(fix: TrackFix) {
    if (mirrorBlocked()) return
    var started = false
    synchronized(lock) {
      val s = session?.takeIf { it.status != Status.ENDED } ?: return
      val silentWatch = lastStatusAtMs == 0L && !reportsSeen && s.source != Source.WATCH
      val moving = s.phoneTrack.onFix(fix, running = s.status == Status.RUNNING, motionStarts = s.status == Status.PREPARING && silentWatch)
      if (moving) {
        setStatus(s, Status.RUNNING, System.currentTimeMillis())
        started = true
      }
    }
    if (started) log("Live workout: the watch gives no sign of a start; the person is moving, timer running")
    publish(force = started)
  }

  /**
   * The session watch numbers go into. A phone-side session is replaced by a watch-fed one with the same id, because the
   * watch's cumulative calories and its estimate would otherwise be mixed. [initial] is the state of a session opened by
   * the frame. Callers hold [lock].
   */
  private fun watchSession(initial: Status = Status.RUNNING): Session {
    val current = session?.takeIf { it.status != Status.ENDED }
    if (current != null && current.source == Source.WATCH) return current
    val status = current?.status?.takeIf { it != Status.PREPARING } ?: initial
    val fresh = newSession(current?.sportType, status, Source.WATCH, id = current?.id)
    if (current != null) {
      // The phone's own GPS follows the session whoever feeds the numbers.
      fresh.phoneTrack = current.phoneTrack
      fresh.gpsRequested = current.gpsRequested
      fresh.lastGpsAtMs = current.lastGpsAtMs
      // Opened running from a session that only prepared: the running stretch begins now, as with [setStatus].
      if (current.status == Status.PREPARING && status == Status.RUNNING) fresh.phoneTrack.startStretch(fresh.updatedAtMs)
    }
    session = fresh
    if (current != null) log("Live workout: the watch sends its own numbers; using them instead of the heart-rate estimate")
    return fresh
  }

  /**
   * Whether a frame with the watch's own numbers belongs to a workout to follow. Not: a stop with nothing to stop; right
   * after a workout ended, anything but the start of a new one (stragglers must not open a second session); while a
   * phone-side session still only prepares, a frame that shows no running workout (the watch is searching for GPS).
   * Callers hold [lock].
   */
  private fun acceptsWatchFrame(running: Boolean, durationSec: Int?, stop: Boolean, now: Long): Boolean {
    val last = session
    val current = last?.takeIf { it.status != Status.ENDED }
    if (stop) return current != null
    if (current == null) {
      val endedAt = last?.endedAtMs ?: return true
      return now - endedAt >= LiveWorkoutPolicy.RESTART_GUARD_MS || LiveWorkoutPolicy.isFreshStart(running, durationSec)
    }
    if (current.status == Status.PREPARING && current.source != Source.WATCH) return LiveWorkoutPolicy.isRunningFrame(running, durationSec)
    return true
  }

  /** Moves a session to [status]; a phone-side session's clock follows it. Callers hold [lock]. */
  private fun setStatus(s: Session, status: Status, now: Long) {
    if (s.status == status) return
    // The stretch before a pause (or the pre-start walk) and the one after it are not joined into one step of the phone's track.
    if (status == Status.RUNNING) s.phoneTrack.startStretch(now)
    if (s.source != Source.WATCH) {
      when (status) {
        Status.RUNNING -> {
          s.clock.resume(now)
          // A pause must not count as workout time once resumed.
          s.lastHeartRateAtMs = null
        }
        Status.PAUSED, Status.ENDED -> s.clock.pause(now)
        Status.PREPARING -> Unit
      }
      s.clock.seconds(now)?.let { s.metrics = s.metrics.copy(durationSec = it) }
    }
    s.status = status
    s.updatedAtMs = now
    s.endSuspected = false
    if (status == Status.ENDED) s.endedAtMs = now
  }

  private fun newSession(workoutType: Int?, status: Status, source: Source = Source.WATCH, id: Long? = null): Session {
    val birthYear = settings.profile?.birthYear?.takeIf { it > 0 }
    val age = birthYear?.let { ProfileSender.age(it, LocalDate.now()) } ?: DEFAULT_AGE
    val maxHr = SubstrateEstimator.maxHeartRate(age)
    val now = System.currentTimeMillis()
    val s = Session(id ?: now, workoutType, status, LiveMetrics(), SubstrateEstimator(maxHr), maxHr, now, source)
    // A phone-side session counts its own time, from the moment the workout is really running (not while it only prepares).
    if (source != Source.WATCH && status != Status.PREPARING) {
      s.clock.start(now)
      if (status == Status.PAUSED) s.clock.pause(now)
      s.metrics = s.metrics.copy(durationSec = 0)
    }
    return s
  }

  private fun toJs(s: Session): Map<String, Any?> {
    val m = s.metrics
    val located = s.phoneTrack.location
    val track = s.phoneTrack.track
    val confirmed = when (s.source) {
      Source.WATCH, Source.MANUAL -> true
      else -> s.confirmed
    }
    return mapOf(
      "id" to s.id.toDouble(),
      "status" to s.status.wire,
      "source" to s.source.wire,
      "sportType" to s.sportType,
      "sportName" to s.sportType?.let { WorkoutSportTypes.name(it) },
      "updatedAt" to s.updatedAtMs.toDouble(),
      "endedAt" to s.endedAtMs?.toDouble(),
      "durationSec" to m.durationSec,
      "heartRate" to m.heartRate,
      "heartRateZone" to m.heartRateZone,
      "maxHeartRate" to s.maxHeartRate,
      "distanceM" to m.distanceM,
      "calories" to m.calories,
      "activeCalories" to m.activeCalories,
      "speedKmh" to m.speedKmh,
      "paceSecPerKm" to m.paceSecPerKm,
      "stepRate" to m.stepRate,
      "steps" to m.steps,
      "cadence" to m.cadence,
      "altitudeM" to m.altitudeM,
      "riseM" to m.riseM,
      "descentM" to m.descentM,
      "aerobicTe" to m.aerobicTe,
      "anaerobicTe" to m.anaerobicTe,
      "fatGrams" to s.estimator.fatGrams,
      "carbGrams" to s.estimator.carbGrams,
      "fatShare" to m.heartRate?.let { SubstrateEstimator.fatShare(it, s.maxHeartRate) },
      "endSuspected" to s.endSuspected,
      // Added with the pre-start fix (B1/B2/B3): absent from older binaries, JS fills the defaults.
      "clockConfirmed" to confirmed,
      "gpsRequested" to s.gpsRequested,
      "location" to located?.let { mapOf("lat" to it.lat, "lon" to it.lon, "accuracy" to it.accuracyM?.toDouble(), "bearing" to it.bearingDeg?.toDouble()) },
      "locationAt" to located?.timeMs?.toDouble(),
      "gpsDistanceM" to if (located != null) track.distanceM else null,
      "gpsRiseM" to if (located != null) track.riseM else null,
      "gpsPaceSecPerKm" to track.paceSecPerKm,
    )
  }

  private fun publish(force: Boolean) {
    val (payload, s, justEnded) = synchronized(lock) {
      val s = session ?: return
      val justEnded = s.status == Status.ENDED && endReported !== s
      if (justEnded) endReported = s
      Triple(toJs(s), s, justEnded)
    }
    events.liveWorkout(payload)
    if (justEnded) onEnded()
    val now = SystemClock.elapsedRealtime()
    if (!force && s.status == notifiedStatus && now - notifiedAtMs < NOTIFY_EVERY_MS) return
    notifiedAtMs = now
    notifiedStatus = s.status
    if (s.status == Status.ENDED) {
      liveHeartRate.setWorkoutActive(false)
      cancelNotification()
    } else {
      notify(s)
    }
  }

  private fun notify(s: Session) {
    val manager = appContext.getSystemService(NotificationManager::class.java) ?: return
    val channel = NotificationChannel(CHANNEL_ID, "Live workout", NotificationManager.IMPORTANCE_HIGH).apply {
      description = "Follows a workout you started on the watch"
      setSound(null, null)
      enableVibration(false)
    }
    manager.createNotificationChannel(channel)
    val open = PendingIntent.getActivity(
      appContext,
      0,
      Intent(Intent.ACTION_VIEW, Uri.parse(DEEP_LINK)).setPackage(appContext.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val m = s.metrics
    val sport = s.sportType?.let { WorkoutSportTypes.name(it) } ?: if (s.gpsRequested) "Outdoor workout" else "Workout"
    val title = when (s.status) {
      Status.PREPARING -> if (s.source == Source.WATCH) "$sport starting on your watch" else "$sport: searching for GPS on your watch"
      Status.PAUSED -> "$sport paused"
      else -> sport
    }
    val parts = ArrayList<String>()
    m.heartRate?.let { parts += "$it bpm" }
    m.distanceM?.let { parts += if (it >= 1000) String.format(Locale.US, "%.2f km", it / 1000) else "${it.roundToInt()} m" }
    m.calories?.let { parts += "${it.roundToInt()} kcal" }
    if (s.estimator.fatGrams > 0) parts += "fat ${formatGrams(s.estimator.fatGrams)}"
    if (s.estimator.carbGrams > 0) parts += "carbs ${formatGrams(s.estimator.carbGrams)}"
    val builder = Notification.Builder(appContext, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_joyofit)
      .setColor(appContext.getColor(R.color.joyofit_notification_accent))
      .setContentTitle(title)
      .setContentText(
        when {
          s.endSuspected -> "The watch may have stopped. Tap to check."
          parts.isEmpty() -> "Tap to follow it live"
          else -> parts.joinToString(" · ")
        },
      )
      .setCategory(Notification.CATEGORY_WORKOUT)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(open)
    val duration = m.durationSec
    if (s.status == Status.RUNNING && duration != null) {
      // The system ticks the clock between pushes: base = now - elapsed.
      builder.setUsesChronometer(true).setShowWhen(true).setWhen(System.currentTimeMillis() - duration * 1000L)
    } else {
      builder.setShowWhen(false)
    }
    try {
      manager.notify(NOTIFICATION_ID, builder.build())
    } catch (e: SecurityException) {
      log("Live workout: notification not shown: ${e.message}")
    }
  }

  private fun cancelNotification() {
    appContext.getSystemService(NotificationManager::class.java)?.cancel(NOTIFICATION_ID)
    notifiedStatus = null
  }

  private fun formatGrams(g: Double): String = if (g < 10) String.format(Locale.US, "%.1f g", g) else "${g.roundToInt()} g"

  companion object {
    const val CHANNEL_ID = "watch_live_workout"
    const val NOTIFICATION_ID = 4103
    const val DEEP_LINK = "joyofit://workout-live"
    const val NOTIFY_EVERY_MS = 5_000L

    /** Age used for the maximum heart rate when no profile is saved (220 - 35 = 185 bpm). */
    const val DEFAULT_AGE = 35

    /** Weight for the heart-rate energy estimate when no profile is saved. */
    const val DEFAULT_WEIGHT_KG = 70.0
  }
}
