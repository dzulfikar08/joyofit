package com.joyodigitama.metronomeclick

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class ClickSoundTest {
  private val samples = ClickSound.samples()

  private fun assertNear(expected: Int, actual: Short) {
    // libm differences between platforms may move a rounded sample by one step.
    assertTrue("expected $expected, got $actual", abs(expected - actual) <= 1)
  }

  @Test
  fun isThirtyFiveMillisecondsAt44kHz() {
    assertEquals(1_544, samples.size)
    assertEquals(35.0, samples.size * 1000.0 / ClickSound.SAMPLE_RATE, 0.02)
  }

  @Test
  fun startsAtTheFirstSampleAndDecaysToSilence() {
    assertEquals(0.toShort(), samples[0])
    assertTrue(abs(samples[5].toInt()) > 10_000)
    assertTrue(samples.takeLast(20).all { abs(it.toInt()) < 400 })
  }

  @Test
  fun peaksAtAboutMinusOneDbfs() {
    val peak = samples.maxOf { abs(it.toInt()) }
    assertTrue(peak in 29_162..29_163)
  }

  /** The same values `ClickSoundTests.swift` checks: the Kotlin and Swift twins make the same sound. */
  @Test
  fun matchesTheSwiftTwin() {
    assertNear(806, samples[1])
    assertNear(12_417, samples[5])
    assertNear(-12_353, samples[13])
    assertNear(-29_163, samples[42])
    assertNear(4_697, samples[100])
    assertNear(5_294, samples[400])
    assertNear(-362, samples[1_000])
  }

  @Test
  fun wavHeaderDescribesSixteenBitMonoPcm() {
    val wav = ClickSound.wav()
    assertEquals(44 + 1_544 * 2, wav.size)
    assertArrayEquals("RIFF".toByteArray(), wav.copyOfRange(0, 4))
    assertArrayEquals("WAVEfmt ".toByteArray(), wav.copyOfRange(8, 16))
    assertArrayEquals("data".toByteArray(), wav.copyOfRange(36, 40))
    fun u32(at: Int) = (0 until 4).sumOf { (wav[at + it].toInt() and 0xFF) shl (8 * it) }
    fun u16(at: Int) = (wav[at].toInt() and 0xFF) or ((wav[at + 1].toInt() and 0xFF) shl 8)
    assertEquals(wav.size - 8, u32(4))
    assertEquals(1, u16(20))
    assertEquals(1, u16(22))
    assertEquals(44_100, u32(24))
    assertEquals(88_200, u32(28))
    assertEquals(16, u16(34))
    assertEquals(1_544 * 2, u32(40))
    assertEquals(samples[5].toInt() and 0xFFFF, u16(44 + 5 * 2))
  }
}
