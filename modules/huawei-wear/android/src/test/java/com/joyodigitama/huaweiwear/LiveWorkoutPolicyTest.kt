package com.joyodigitama.huaweiwear

import com.joyodigitama.huaweiwear.LiveWorkoutPolicy.Verdict
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LiveWorkoutPolicyTest {
  @Test
  fun clockIsEmptyUntilTheWorkoutStarts() {
    val clock = WorkoutClock()
    assertNull(clock.seconds(1_000_000L))
    assertFalse(clock.started)
  }

  @Test
  fun clockCountsFromTheStartNotFromTheGpsSearch() {
    val clock = WorkoutClock()
    // GPS search began at t=0 (nothing counted); the watch reports the workout running at t=90 s.
    clock.start(90_000L)
    assertEquals(0, clock.seconds(90_000L))
    assertEquals(30, clock.seconds(120_500L))
  }

  @Test
  fun clockLeavesPausesOut() {
    val clock = WorkoutClock()
    clock.start(0L)
    clock.pause(60_000L)
    assertEquals(60, clock.seconds(300_000L))
    clock.resume(300_000L)
    assertEquals(70, clock.seconds(310_000L))
    // A second pause call while paused does not move the pause point.
    clock.pause(320_000L)
    clock.pause(400_000L)
    assertEquals(80, clock.seconds(500_000L))
  }

  @Test
  fun clockFreezesWhenTheWorkoutEnds() {
    val clock = WorkoutClock()
    clock.start(0L)
    clock.pause(45_000L)
    assertEquals(45, clock.seconds(10_000_000L))
  }

  @Test
  fun resumeBeforeStartStartsTheClock() {
    val clock = WorkoutClock()
    clock.resume(5_000L)
    assertTrue(clock.started)
    assertEquals(2, clock.seconds(7_500L))
  }

  @Test
  fun pauseBeforeStartIsAFrozenZero() {
    val clock = WorkoutClock()
    clock.pause(5_000L)
    assertEquals(0, clock.seconds(50_000L))
  }

  @Test
  fun aSessionStillSearchingForGpsIsNotEndedByIdleAnswersWhileTheWatchAsks() {
    // Idle answers during the GPS search are normal: the workout has not started.
    assertEquals(Verdict.KEEP, LiveWorkoutPolicy.idleVerdict(preparing = true, confirmed = false, idleAnswers = 9, msSinceGps = 20_000L))
  }

  @Test
  fun aSearchTheWatchGaveUpIsDropped() {
    assertEquals(Verdict.END, LiveWorkoutPolicy.idleVerdict(preparing = true, confirmed = false, idleAnswers = 3, msSinceGps = 61_000L))
    assertEquals(Verdict.KEEP, LiveWorkoutPolicy.idleVerdict(preparing = true, confirmed = false, idleAnswers = 2, msSinceGps = 61_000L))
  }

  @Test
  fun aWorkoutTheWatchConfirmedEndsOnIdleAnswersEvenWhileGpsRequestsContinue() {
    assertEquals(Verdict.KEEP, LiveWorkoutPolicy.idleVerdict(preparing = false, confirmed = true, idleAnswers = 2, msSinceGps = 5_000L))
    assertEquals(Verdict.END, LiveWorkoutPolicy.idleVerdict(preparing = false, confirmed = true, idleAnswers = 3, msSinceGps = 5_000L))
  }

  @Test
  fun anUnconfirmedWorkoutThatStillAsksForGpsPromptsInsteadOfEnding() {
    assertEquals(Verdict.SUSPECT, LiveWorkoutPolicy.idleVerdict(preparing = false, confirmed = false, idleAnswers = 3, msSinceGps = 30_000L))
    assertEquals(Verdict.END, LiveWorkoutPolicy.idleVerdict(preparing = false, confirmed = false, idleAnswers = 3, msSinceGps = 130_000L))
  }

  @Test
  fun silenceDefersToAStatusPollThatAnswers() {
    assertEquals(Verdict.KEEP, LiveWorkoutPolicy.silenceVerdict(preparing = false, msSinceGps = 500_000L, msSinceStatus = 30_000L))
  }

  @Test
  fun silenceWithoutStatusAnswersPromptsThenEnds() {
    val stale = LiveWorkoutPolicy.STATUS_STALE_MS + 1
    assertEquals(Verdict.KEEP, LiveWorkoutPolicy.silenceVerdict(preparing = false, msSinceGps = 60_000L, msSinceStatus = stale))
    assertEquals(Verdict.SUSPECT, LiveWorkoutPolicy.silenceVerdict(preparing = false, msSinceGps = 121_000L, msSinceStatus = stale))
    assertEquals(Verdict.END, LiveWorkoutPolicy.silenceVerdict(preparing = false, msSinceGps = 301_000L, msSinceStatus = stale))
  }

  @Test
  fun aPreparingSessionWithNothingToWaitForIsDropped() {
    val stale = LiveWorkoutPolicy.STATUS_STALE_MS + 1
    assertEquals(Verdict.END, LiveWorkoutPolicy.silenceVerdict(preparing = true, msSinceGps = 61_000L, msSinceStatus = stale))
    assertEquals(Verdict.KEEP, LiveWorkoutPolicy.silenceVerdict(preparing = true, msSinceGps = 30_000L, msSinceStatus = stale))
  }

  @Test
  fun aFrameOfAWorkoutThatOnlyPreparesDoesNotStartTheTimer() {
    assertFalse(LiveWorkoutPolicy.isRunningFrame(running = false, durationSec = 0))
    assertFalse(LiveWorkoutPolicy.isRunningFrame(running = false, durationSec = null))
    assertTrue(LiveWorkoutPolicy.isRunningFrame(running = true, durationSec = null))
    assertTrue(LiveWorkoutPolicy.isRunningFrame(running = false, durationSec = 3))
  }

  @Test
  fun onlyAFreshStartPassesTheGuardAfterAWorkoutEnded() {
    assertTrue(LiveWorkoutPolicy.isFreshStart(running = true, durationSec = 2))
    assertTrue(LiveWorkoutPolicy.isFreshStart(running = true, durationSec = null))
    assertFalse(LiveWorkoutPolicy.isFreshStart(running = true, durationSec = 1_800))
    assertFalse(LiveWorkoutPolicy.isFreshStart(running = false, durationSec = 0))
  }

  @Test
  fun aWatchFedSessionWithALostStopEndsOnceFramesAndPollAgree() {
    assertFalse(LiveWorkoutPolicy.watchFedEnds(preparing = false, idleAnswers = 2, msSinceFrame = 60_000L))
    assertFalse(LiveWorkoutPolicy.watchFedEnds(preparing = false, idleAnswers = 3, msSinceFrame = 5_000L))
    assertTrue(LiveWorkoutPolicy.watchFedEnds(preparing = false, idleAnswers = 3, msSinceFrame = 31_000L))
    // A countdown or GPS search on the watch has no frames and an idle poll: it waits much longer.
    assertFalse(LiveWorkoutPolicy.watchFedEnds(preparing = true, idleAnswers = 9, msSinceFrame = 120_000L))
    assertTrue(LiveWorkoutPolicy.watchFedEnds(preparing = true, idleAnswers = 9, msSinceFrame = 301_000L))
  }

  @Test
  fun statusPhasesAsTheFit4ProAnswered() {
    // 2026-10-25 12:07, outdoor walk on a Fit 4 Pro 6.1.0.117 (`Workout link: workout status {tag: 81 - Value: ...}`).
    assertEquals(WatchPhase.IDLE, WatchPhase.of(trainMonitorState = 0, operator = 0)) // 020100030100: nothing open
    assertEquals(WatchPhase.OPEN, WatchPhase.of(trainMonitorState = 0, operator = 1)) // 020100030101: GO screen, 12:07:22 with the GPS request
    assertEquals(WatchPhase.RUNNING, WatchPhase.of(trainMonitorState = 1, operator = 3)) // 020101030103: after GO, 12:07:43
    assertEquals(WatchPhase.RUNNING, WatchPhase.of(trainMonitorState = 1, operator = 1))
    assertEquals(WatchPhase.PAUSED, WatchPhase.of(trainMonitorState = 1, operator = 2))
    assertEquals(WatchPhase.PAUSED, WatchPhase.of(trainMonitorState = 0, operator = 2))
    assertEquals(WatchPhase.IDLE, WatchPhase.of(trainMonitorState = 1, operator = 4))
    // A watch that sends no tag 02: its operator alone, as before.
    assertEquals(WatchPhase.RUNNING, WatchPhase.of(trainMonitorState = null, operator = 1))
    assertEquals(WatchPhase.RUNNING, WatchPhase.of(trainMonitorState = null, operator = 3))
    assertEquals(WatchPhase.PAUSED, WatchPhase.of(trainMonitorState = null, operator = 2))
    assertEquals(WatchPhase.IDLE, WatchPhase.of(trainMonitorState = null, operator = null))
  }

  /** The phone-side session states a run of status answers leads to, from a session the GPS request opened (preparing). */
  private fun follow(vararg phases: WatchPhase): List<LiveWorkout.Status> {
    var status = LiveWorkout.Status.PREPARING
    return phases.map { phase ->
      LiveWorkoutPolicy.statusTarget(status, phase)?.let { status = it }
      status
    }
  }

  @Test
  fun theGoScreenDoesNotStartTheClockGoDoes() {
    val s = LiveWorkout.Status.PREPARING
    val r = LiveWorkout.Status.RUNNING
    val p = LiveWorkout.Status.PAUSED
    // Watch opened (GO screen) for 20 s, GO, a pause, resume. Before this change the first OPEN answer started the clock (16:09:32).
    assertEquals(
      listOf(s, s, r, r, p, r),
      follow(WatchPhase.OPEN, WatchPhase.OPEN, WatchPhase.RUNNING, WatchPhase.RUNNING, WatchPhase.PAUSED, WatchPhase.RUNNING),
    )
    // A watch that stops counting but keeps its workout screen open (a pause told only by tag 02) pauses the phone too.
    assertEquals(listOf(r, p, r), follow(WatchPhase.RUNNING, WatchPhase.OPEN, WatchPhase.RUNNING))
    // Idle answers move nothing here: the end is idleVerdict's.
    assertNull(LiveWorkoutPolicy.statusTarget(LiveWorkout.Status.RUNNING, WatchPhase.IDLE))
  }

  @Test
  fun aClosedWorkoutScreenEndsOnTheFirstIdleAnswer() {
    // Finish on the watch: 18/08 {01: 0}, then 17/03 idle 5 s later (12:07:58 / 12:08:03). One answer is enough.
    assertEquals(Verdict.END, LiveWorkoutPolicy.idleVerdict(preparing = false, confirmed = true, idleAnswers = 1, msSinceGps = 5_000L, screenClosed = true))
    // The person left the GO screen without starting: ends too, even with a GPS request seconds ago.
    assertEquals(Verdict.END, LiveWorkoutPolicy.idleVerdict(preparing = true, confirmed = false, idleAnswers = 1, msSinceGps = 1_000L, screenClosed = true))
    // Without the close, one idle answer is not enough.
    assertEquals(Verdict.KEEP, LiveWorkoutPolicy.idleVerdict(preparing = false, confirmed = true, idleAnswers = 1, msSinceGps = 5_000L))
    assertEquals(Verdict.END, LiveWorkoutPolicy.idleVerdict(preparing = false, confirmed = true, idleAnswers = 3, msSinceGps = 5_000L))
  }

  @Test
  fun theStatusIsAskedFastWhileWaitingForGo() {
    assertEquals(LiveWorkoutPolicy.PREPARING_POLL_MS, LiveWorkoutPolicy.pollEveryMs(LiveWorkout.Status.PREPARING))
    assertEquals(LiveWorkoutPolicy.LIVE_POLL_MS, LiveWorkoutPolicy.pollEveryMs(LiveWorkout.Status.RUNNING))
    assertEquals(LiveWorkoutPolicy.LIVE_POLL_MS, LiveWorkoutPolicy.pollEveryMs(LiveWorkout.Status.PAUSED))
    assertEquals(LiveWorkoutPolicy.IDLE_POLL_MS, LiveWorkoutPolicy.pollEveryMs(LiveWorkout.Status.ENDED))
    assertEquals(LiveWorkoutPolicy.IDLE_POLL_MS, LiveWorkoutPolicy.pollEveryMs(null))
  }
}
