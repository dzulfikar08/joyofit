package com.joyodigitama.blesensors

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class StepCounterLogicTest {
  private val start = 1_000_000L

  @Test
  fun theFirstCounterReadingIsTheBaseline() {
    val logic = StepCounterLogic(start)
    assertEquals(StepCounterLogic.Reading(0, start), logic.counter(12_345f, start))
    assertEquals(StepCounterLogic.Reading(3, start + 1_000), logic.counter(12_348f, start + 1_000))
    // the same count again adds no step: nothing to deliver
    assertNull(logic.counter(12_348f, start + 2_000))
    assertEquals(StepCounterLogic.Reading(10, start + 3_000), logic.counter(12_355f, start + 3_000))
  }

  @Test
  fun aCounterThatGoesBackwardsKeepsWhatWasCountedAndAddsTheNewSteps() {
    val logic = StepCounterLogic(start)
    logic.counter(5_000f, start)
    assertEquals(20L, logic.counter(5_020f, start + 1_000)?.steps)
    // reboot: the counter starts again from a small value
    assertEquals(25L, logic.counter(5f, start + 2_000)?.steps)
    assertEquals(40L, logic.counter(20f, start + 3_000)?.steps)
  }

  @Test
  fun theFirstCounterEventStampedBeforeTheStartCountsAtTheStart() {
    // the counter's first event carries the time of the last step before the listener, ten minutes ago
    val logic = StepCounterLogic(start)
    assertEquals(StepCounterLogic.Reading(0, start), logic.counter(800f, start - 600_000))
    assertEquals(StepCounterLogic.Reading(24, start + 12_000), logic.counter(824f, start + 12_000))
  }

  @Test
  fun theDetectorMovesTheCountOnBetweenTwoCounterEvents() {
    val logic = StepCounterLogic(start)
    logic.counter(1_000f, start)
    // a step every 500 ms, the counter silent
    for (i in 1..10) assertEquals(StepCounterLogic.Reading(i.toLong(), start + i * 500L), logic.detector(start + i * 500L))
    // the counter reports the same 10 steps late: nothing new
    assertNull(logic.counter(1_010f, start + 5_000))
    // two more steps, then the counter covers them and one the detector missed
    assertEquals(11L, logic.detector(start + 5_500)?.steps)
    assertEquals(12L, logic.detector(start + 6_000)?.steps)
    assertEquals(StepCounterLogic.Reading(13, start + 6_200), logic.counter(1_013f, start + 6_200))
  }

  @Test
  fun detectorStepsTheCounterAlreadyCoversAreNotCountedTwice() {
    val logic = StepCounterLogic(start)
    logic.counter(0f, start)
    // a batch: the counter's event (5 steps up to 2.5 s) arrives before the detector's events of the same steps
    assertEquals(StepCounterLogic.Reading(5, start + 2_500), logic.counter(5f, start + 2_500))
    for (i in 1..5) assertNull(logic.detector(start + i * 500L))
    assertEquals(StepCounterLogic.Reading(6, start + 3_000), logic.detector(start + 3_000))
  }

  @Test
  fun aDetectorAheadOfTheCounterNeverMakesTheCountGoDown() {
    val logic = StepCounterLogic(start)
    logic.counter(0f, start)
    for (i in 1..10) logic.detector(start + i * 500L)
    // the counter found only 8 of the 10 steps: the count stays at 10, and the next two steps wait for it
    assertNull(logic.counter(8f, start + 5_000))
    assertNull(logic.detector(start + 5_500))
    assertNull(logic.detector(start + 6_000))
    assertEquals(StepCounterLogic.Reading(11, start + 6_500), logic.detector(start + 6_500))
  }

  @Test
  fun aCounterEventOlderThanTheDetectorsNewestStepKeepsThatStepOnTopAtItsTime() {
    val logic = StepCounterLogic(start)
    logic.counter(0f, start)
    assertEquals(start + 4_000, logic.detector(start + 4_000)?.tsMs)
    // the counter's 3 steps up to 3 s, and the detector's step at 4 s after them
    assertEquals(StepCounterLogic.Reading(4, start + 4_000), logic.counter(3f, start + 3_000))
  }

  @Test
  fun eventTimeIsWallClockMinusTheAgeOfTheEvent() {
    // the event is 250 ms old
    assertEquals(999_750L, StepCounterLogic.eventWallMs(eventNanos = 9_750_000_000L, nowWallMs = 1_000_000L, nowElapsedNanos = 10_000_000_000L))
    assertEquals(1_000_000L, StepCounterLogic.eventWallMs(eventNanos = 10_000_000_000L, nowWallMs = 1_000_000L, nowElapsedNanos = 10_000_000_000L))
  }
}
