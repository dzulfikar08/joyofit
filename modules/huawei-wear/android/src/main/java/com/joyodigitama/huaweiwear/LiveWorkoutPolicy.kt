package com.joyodigitama.huaweiwear

/**
 * Workout time of a phone-side live session ([LiveWorkout]): counted from the moment the watch really started the workout,
 * without the pauses, frozen once it ends. Pure, so the arithmetic is tested on the JVM.
 */
internal class WorkoutClock {
  private var startedAtMs: Long? = null
  private var pausedAtMs: Long? = null
  private var pausedTotalMs = 0L

  val started get() = startedAtMs != null

  fun start(nowMs: Long) {
    if (startedAtMs == null) startedAtMs = nowMs
  }

  fun pause(nowMs: Long) {
    start(nowMs)
    if (pausedAtMs == null) pausedAtMs = nowMs
  }

  fun resume(nowMs: Long) {
    val since = pausedAtMs
    if (since == null) {
      start(nowMs)
      return
    }
    pausedTotalMs += (nowMs - since).coerceAtLeast(0L)
    pausedAtMs = null
  }

  /** Whole seconds of workout time at [nowMs], null before the workout started. */
  fun seconds(nowMs: Long): Int? {
    val start = startedAtMs ?: return null
    val end = pausedAtMs ?: nowMs
    return ((end - start - pausedTotalMs).coerceAtLeast(0L) / 1000L).toInt()
  }
}

/**
 * When a phone-side session may start counting and when it ends, from what the watch reports. The watch asks for the
 * phone's GPS (`18/02`) from the moment its workout screen starts looking for a fix, which is before the workout runs, so
 * a GPS request alone is only "preparing"; the `17/03` status poll (or the watch's own numbers) says when it runs.
 */
internal object LiveWorkoutPolicy {
  /** "No workout" answers in a row that end a session (one per status poll, every [LIVE_POLL_MS] while a session is live). */
  const val IDLE_ANSWERS_TO_END = 3

  /** Status poll period while no workout is followed. */
  const val IDLE_POLL_MS = 30_000L

  /** Status poll period while a session is live, so a stop on the watch reaches the phone in about 30 s. */
  const val LIVE_POLL_MS = 10_000L

  /** No GPS request for this long counts as GPS silence (the watch asks about every 20 s until its own GPS has a fix). */
  const val GPS_SILENCE_MS = 120_000L

  /** A session still preparing (the watch never started the workout) is dropped after this much GPS silence. */
  const val PREPARING_SILENCE_MS = 60_000L

  /** No status answer for this long means the poll is not answered (the watch does not support 17/03, or the link is quiet). */
  const val STATUS_STALE_MS = 90_000L

  /** With no status answers at all, silence this long ends the session when the user did not answer the prompt. */
  const val GIVE_UP_MS = 300_000L

  /** Frames of a workout that just ended are ignored for this long, so late numbers do not open a second session. */
  const val RESTART_GUARD_MS = 60_000L

  enum class Verdict { KEEP, SUSPECT, END }

  /**
   * One status answer said "no workout" for the [idleAnswers]th time in a row, for a phone-side session.
   *  - [preparing]: the watch never started the workout; once its GPS requests stopped it was left, so end it;
   *  - [confirmed]: the watch itself said the workout was running and now says it is not: end;
   *  - otherwise the poll alone never confirmed the workout, so a watch that still asks for GPS keeps it ([Verdict.SUSPECT]
   *    asks the user), and one that stopped asking ends it.
   */
  fun idleVerdict(preparing: Boolean, confirmed: Boolean, idleAnswers: Int, msSinceGps: Long): Verdict {
    if (idleAnswers < IDLE_ANSWERS_TO_END) return Verdict.KEEP
    return when {
      preparing -> if (msSinceGps > PREPARING_SILENCE_MS) Verdict.END else Verdict.KEEP
      confirmed -> Verdict.END
      msSinceGps > GPS_SILENCE_MS -> Verdict.END
      else -> Verdict.SUSPECT
    }
  }

  /**
   * The GPS requests of a GPS-started session stopped, for [msSinceGps]. While the status poll answers it decides; with no
   * answers the watch's own silence is all there is: ask the user first, end by itself only much later.
   */
  fun silenceVerdict(preparing: Boolean, msSinceGps: Long, msSinceStatus: Long): Verdict {
    if (msSinceStatus <= STATUS_STALE_MS) return Verdict.KEEP
    return when {
      preparing -> if (msSinceGps > PREPARING_SILENCE_MS) Verdict.END else Verdict.KEEP
      msSinceGps > GIVE_UP_MS -> Verdict.END
      msSinceGps > GPS_SILENCE_MS -> Verdict.SUSPECT
      else -> Verdict.KEEP
    }
  }

  /**
   * Whether a frame with the watch's own numbers is a workout that really runs: a running or paused state, or time on the
   * clock. A frame of a workout that is only being prepared (zeros, no state) must not start the timer.
   */
  fun isRunningFrame(running: Boolean, durationSec: Int?): Boolean = running || (durationSec ?: 0) > 0

  /** A frame that opens a workout (state running, a few seconds on the clock), not a straggler of the one that ended. */
  fun isFreshStart(running: Boolean, durationSec: Int?): Boolean = running && (durationSec ?: 0) < 10

  /** The watch's own numbers stopped for this long while it says "no workout": the stop frame was lost. */
  const val FRAMES_STALE_MS = 30_000L

  /**
   * A session fed by the watch's own numbers ends on the watch's stop frame; with the frames silent and the status poll
   * idle [IDLE_ANSWERS_TO_END] times in a row, a lost stop frame does not leave it running. One that only prepares gets
   * [GIVE_UP_MS] (the watch may search for GPS for minutes).
   */
  fun watchFedEnds(preparing: Boolean, idleAnswers: Int, msSinceFrame: Long): Boolean =
    idleAnswers >= IDLE_ANSWERS_TO_END && msSinceFrame > (if (preparing) GIVE_UP_MS else FRAMES_STALE_MS)

  /**
   * Whether a live session of [source] ends by itself once the watch is gone (link lost: no status answers, no frames, no GPS
   * requests). Only the GPS-request session has a watchdog for that ([silenceVerdict]: asks the user after [GPS_SILENCE_MS], ends
   * after [GIVE_UP_MS]); the others end on the watch's word or Finish. Decides whether the phone's GPS survives a lost link.
   */
  fun endsWithoutLink(source: LiveWorkout.Source): Boolean = source == LiveWorkout.Source.GPS
}
