package com.joyodigitama.blesensors

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class StepLogTest {
  private val start = 1_000_000L

  @Test
  fun theFirstEventOfEachSensorHasALineOfItsOwn() {
    val log = StepLog("live", start)
    assertEquals(
      "Phone steps (live): first counter event 0.1 s after the start, raw 12345, stamped 600.0 s before it arrived",
      log.event(false, start + 100, start - 599_900, 12_345f),
    )
    assertEquals(
      "Phone steps (live): first detector event 2.0 s after the start, stamped 0.3 s before it arrived",
      log.event(true, start + 2_000, start + 1_700, null),
    )
    assertNull(log.event(true, start + 2_500, start + 2_300, null))
  }

  @Test
  fun theSummarySaysWhatArrivedAndHowLateAndStartsTheNextPeriod() {
    val log = StepLog("live", start)
    log.event(false, start + 50, start - 10_000, 500f)
    // a counter that hands over its steps every 12 s, 2 s after the newest of them
    log.event(false, start + 12_000, start + 10_000, 524f)
    log.event(false, start + 24_000, start + 22_000, 548f)
    assertEquals(
      "Phone steps (live): 30.0 s: counter 3 events, detector 0 events, +48 steps (total 48), longest gap 12.0 s, max delay 2.0 s",
      log.summary(start + 30_000, 48),
    )
    // nothing at all for the next 30 s
    assertEquals(
      "Phone steps (live): 30.0 s: counter 0 events, detector 0 events, +0 steps (total 48), longest gap 36.0 s, max delay -",
      log.summary(start + 60_000, 48),
    )
  }

  @Test
  fun theStopCountsTheWholeRun() {
    val log = StepLog("recording", start)
    log.event(false, start, start, 0f)
    log.event(true, start + 500, start + 400, null)
    log.event(true, start + 1_000, start + 900, null)
    log.summary(start + 30_000, 2)
    assertEquals(
      "Phone steps (recording): stopped after 95.0 s: total 2 steps, counter 1 events, detector 2 events",
      log.stopped(start + 95_000, 2),
    )
  }
}
