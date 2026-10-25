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
 * What the watch's `17/03` answer says about its workout. The answer is `81{02 trainMonitorState, 03 operatorType, [04 sport], [06 workout
 * type]}` (Huawei Health 17.0.8.300 `HwLinkageServiceManager.handleGetOperatorStatusTlvData`). Huawei Health reads tag 02 as "the watch is
 * busy with a workout" (`dfj.getDeviceBusyStatus`; `MyPlanInfoAdapter`: 0 is "device is not running"); JoyoFit read only tag 03 before.
 * Observed on the Fit 4 Pro 6.1.0.117 (2026-10-22 and 25, outdoor walk and strength):
 *  - `02 00, 03 00`: nothing open ([IDLE]);
 *  - `02 00, 03 01`: the workout screen is open, GO not pressed yet (it comes with the first GPS request, `18/02` and `18/08` `{01: 1}`);
 *    read by tag 03 alone it looked like a running workout and started the phone's clock on the GO screen ([OPEN]);
 *  - `02 01, 03 03`: the workout runs (after GO; 12:07:43 and 12:08:13 on 2026-10-25) ([RUNNING]);
 *  - operator 2 is a pause ([PAUSED]); operator 4 a stop ([IDLE]).
 * A watch that sends no tag 02 is read by its operator alone, as before: 1 or 3 running, 2 paused.
 */
internal enum class WatchPhase {
  IDLE,
  OPEN,
  RUNNING,
  PAUSED;

  companion object {
    fun of(trainMonitorState: Int?, operator: Int?): WatchPhase = when {
      operator == 4 -> IDLE
      operator == 2 -> PAUSED
      trainMonitorState == null -> if (operator == 1 || operator == 3) RUNNING else IDLE
      trainMonitorState != 0 -> RUNNING
      operator == 1 || operator == 3 -> OPEN
      else -> IDLE
    }
  }
}

/**
 * When a phone-side session may start counting and when it ends, from what the watch reports. The watch asks for the
 * phone's GPS (`18/02`) from the moment its workout screen starts looking for a fix, which is before the workout runs, so
 * a GPS request alone is only "preparing"; the `17/03` status poll ([WatchPhase], or the watch's own numbers) says when it runs.
 */
internal object LiveWorkoutPolicy {
  /** "No workout" answers in a row that end a session (one per status poll, every [LIVE_POLL_MS] while a session is live). */
  const val IDLE_ANSWERS_TO_END = 3

  /** Status poll period while no workout is followed. */
  const val IDLE_POLL_MS = 30_000L

  /** Status poll period while a session is live, so a stop on the watch reaches the phone in about 15 s. */
  const val LIVE_POLL_MS = 5_000L

  /** Status poll period while a session waits for GO on the watch: the phone's clock starts at most this late. */
  const val PREPARING_POLL_MS = 2_000L

  /** The watch closed its workout screen (`18/08 {01: 0}`) this recently: one "no workout" answer is enough to end. */
  const val SCREEN_CLOSED_MS = 60_000L

  /** How often to ask the status for a session in [status] (null or ended: none followed). */
  fun pollEveryMs(status: LiveWorkout.Status?): Long = when (status) {
    LiveWorkout.Status.PREPARING -> PREPARING_POLL_MS
    LiveWorkout.Status.RUNNING, LiveWorkout.Status.PAUSED -> LIVE_POLL_MS
    else -> IDLE_POLL_MS
  }

  /**
   * The state a phone-side session in [current] moves to on a `17/03` answer of [phase]; null: no change ([WatchPhase.IDLE] is
   * [idleVerdict]'s). [WatchPhase.OPEN] (the watch is not counting, its workout screen is open) keeps a session that waits for GO
   * waiting, and pauses one that ran: the watch's clock stopped, whether paused or back on its start screen, so the phone's stops too.
   */
  fun statusTarget(current: LiveWorkout.Status, phase: WatchPhase): LiveWorkout.Status? = when (phase) {
    WatchPhase.RUNNING -> LiveWorkout.Status.RUNNING
    WatchPhase.PAUSED -> LiveWorkout.Status.PAUSED
    WatchPhase.OPEN -> if (current == LiveWorkout.Status.RUNNING) LiveWorkout.Status.PAUSED else null
    WatchPhase.IDLE -> null
  }

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
   *  - [screenClosed]: the watch said it closed its workout screen ([SCREEN_CLOSED_MS], `18/08 {01: 0}`), and the poll agrees: end at once
   *    (the finish on the watch reaches the phone within seconds, not after three answers);
   *  - [preparing]: the watch never started the workout; once its GPS requests stopped it was left, so end it;
   *  - [confirmed]: the watch itself said the workout was running and now says it is not: end;
   *  - otherwise the poll alone never confirmed the workout, so a watch that still asks for GPS keeps it ([Verdict.SUSPECT]
   *    asks the user), and one that stopped asking ends it.
   */
  fun idleVerdict(preparing: Boolean, confirmed: Boolean, idleAnswers: Int, msSinceGps: Long, screenClosed: Boolean = false): Verdict {
    if (screenClosed && idleAnswers >= 1) return Verdict.END
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
