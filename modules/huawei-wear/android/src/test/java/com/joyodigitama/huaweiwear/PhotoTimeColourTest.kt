package com.joyodigitama.huaweiwear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** JoyoFit's time colour heuristic on synthetic 408 x 480 pictures with the Fit 4 Pro photo face's top time area (68, 18, 406, 182). */
class PhotoTimeColourTest {
  private val w = 408
  private val h = 480

  private fun flat(colour: Long) = IntArray(w * h) { colour.toInt() }

  private fun pickTop(pixels: IntArray) = PhotoTimeColour.pick(pixels, w, h, 68, 18, 406, 182)

  @Test
  fun aDarkAreaGetsAPaleTintOfItsHueAndALightOneADarkShade() {
    // Dark blue (H 228): HSV(228, 15, 100).
    assertEquals(0xFFD9E0FF.toInt(), pickTop(flat(0xFF102060)))
    // Light yellow (H 54): HSV(54, 100, 20).
    assertEquals(0xFF332D00.toInt(), pickTop(flat(0xFFF0E68C)))
  }

  @Test
  fun greyAreasGetWhiteOrDarkGrey() {
    assertEquals(0xFFFFFFFF.toInt(), pickTop(flat(0xFF000000)))
    assertEquals(0xFF333333.toInt(), pickTop(flat(0xFFFFFFFF)))
    assertEquals(0xFF333333.toInt(), pickTop(flat(0xFF808080)))
  }

  @Test
  fun theDominantColourWinsOverAMinority() {
    // 70 % of the area's columns dark blue, the rest white.
    val pixels = IntArray(w * h) { i -> if (i % w - 68 < (406 - 68) * 7 / 10) 0xFF102060.toInt() else -1 }
    assertEquals(0xFFD9E0FF.toInt(), pickTop(pixels))
  }

  @Test
  fun onlyTheTimeAreaCounts() {
    val pixels = IntArray(w * h) { i ->
      val x = i % w
      val y = i / w
      if (x in 68 until 406 && y in 18 until 182) 0xFFF0E68C.toInt() else 0xFFFF0000.toInt()
    }
    assertEquals(0xFF332D00.toInt(), pickTop(pixels))
  }

  @Test
  fun smallNoiseDoesNotMoveTheDominantColour() {
    val pixels = IntArray(w * h) { i ->
      val d = (i * 7) % 9 - 4
      (0xFF shl 24) or ((40 + d) shl 16) or ((90 + d) shl 8) or (60 + d)
    }
    assertEquals(0x27593B, PhotoTimeColour.dominant(pixels, w, 68, 18, 406, 182))
    assertEquals(0xFFD9FFE8.toInt(), pickTop(pixels))
  }

  @Test
  fun theAreaIsCutToThePictureAndAnEmptyOneHasNoColour() {
    assertEquals(0xFFD9E0FF.toInt(), PhotoTimeColour.pick(flat(0xFF102060), w, h, 300, 400, 600, 600))
    assertNull(PhotoTimeColour.pick(flat(0xFF102060), w, h, 500, 500, 600, 600))
    // A tie between two bins goes to the lower bin (dark blue before white).
    val tie = intArrayOf(0xFF102060.toInt(), 0xFF102060.toInt(), -1, 0xFF102060.toInt(), -1, -1)
    assertEquals(0xFFD9E0FF.toInt(), PhotoTimeColour.pick(tie, 3, 2, 0, 0, 3, 2))
  }
}
