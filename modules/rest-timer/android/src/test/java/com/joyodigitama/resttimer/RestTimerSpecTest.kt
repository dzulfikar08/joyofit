package com.joyodigitama.resttimer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RestTimerSpecTest {
  @Test
  fun timeoutIsTheTimeLeft() {
    assertEquals(90_000L, RestTimerSpec.timeoutMs(endsAt = 1_090_000, now = 1_000_000))
  }

  @Test
  fun aRestThatEndedHasNoTimeout() {
    assertNull(RestTimerSpec.timeoutMs(endsAt = 1_000_000, now = 1_000_000))
    assertNull(RestTimerSpec.timeoutMs(endsAt = 999_999, now = 1_000_000))
  }

  @Test
  fun shortTextPassesTrimmed() {
    assertEquals("Bench Press", RestTimerSpec.clip("  Bench Press "))
  }

  @Test
  fun longTextIsCutWithAnEllipsis() {
    val clipped = RestTimerSpec.clip("x".repeat(200))
    assertEquals(RestTimerSpec.MAX_TEXT, clipped.length)
    assertEquals('\u2026', clipped.last())
  }
}
