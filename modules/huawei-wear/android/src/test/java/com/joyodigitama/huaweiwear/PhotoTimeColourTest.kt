package com.joyodigitama.huaweiwear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * JoyoFit's time colour rule on synthetic 408 x 480 pictures with the Fit 4 Pro photo face's top time area (68, 18, 406, 182). The Swift
 * twin (PhotoTimeColourTests.swift) expects the same values.
 */
class PhotoTimeColourTest {
  private val w = 408
  private val h = 480

  private fun flat(colour: Long) = IntArray(w * h) { colour.toInt() }

  private fun pickTop(pixels: IntArray) = PhotoTimeColour.pick(pixels, w, h, 68, 18, 406, 182)

  @Test
  fun theLinearTableIsTheSameOnBothPlatforms() {
    assertEquals(0, PhotoTimeColour.LINEAR[0])
    assertEquals(14146, PhotoTimeColour.LINEAR[128])
    assertEquals(65535, PhotoTimeColour.LINEAR[255])
    assertEquals(5217863, PhotoTimeColour.LINEAR.sum())
  }

  @Test
  fun aFlatDarkAreaGetsWhiteAndAFlatLightOneNearBlack() {
    assertEquals(0xFFFFFFFF.toInt(), pickTop(flat(0xFF102060))) // navy: white 15.0, tint 8.6
    assertEquals(0xFF111111.toInt(), pickTop(flat(0xFFF0E0C0))) // beige: near-black 14.5, shade 9.5
  }

  @Test
  fun saturatedAreasKeepTheirHueOnlyWhenItIsReadableAndCloseToTheBest() {
    assertEquals(0xFFFFFFFF.toInt(), pickTop(flat(0xFFD01010))) // red: white 5.6, tint 3.2
    assertEquals(0xFFFFFFFF.toInt(), pickTop(flat(0xFF1030D0))) // blue: white 8.9, tint 5.0
    assertEquals(0xFFF2F2B6.toInt(), pickTop(flat(0xFF606030))) // olive: tint 5.6 >= 4.5 and within 1.0 of white's 6.5
    assertEquals(0xFF1A1A40.toInt(), pickTop(flat(0xFFA0A0F0))) // lavender: shade 6.9, within 1.0 of near-black's 7.9
  }

  @Test
  fun greyAreasGetOnlyWhiteOrNearBlack() {
    assertEquals(0xFFFFFFFF.toInt(), pickTop(flat(0xFF000000)))
    assertEquals(0xFF111111.toInt(), pickTop(flat(0xFFFFFFFF)))
    assertEquals(0xFF111111.toInt(), pickTop(flat(0xFF808080)))
    // Saturation 6 / 90 < 0.08: white, though its yellow tint would pass the hue rule.
    assertEquals(0xFFFFFFFF.toInt(), pickTop(flat(0xFF5A5A54)))
  }

  @Test
  fun aMixIsAveragedInLinearLight() {
    // 70 % black, 30 % white: linear mean 0.3, so near-black (6.3 against white's 3.0); a gamma-space mean (#4D4D4D) would give white.
    val mix = IntArray(10) { if (it < 7) 0xFF000000.toInt() else -1 }
    assertEquals(0xFF111111.toInt(), PhotoTimeColour.pick(mix, 10, 1, 0, 0, 10, 1))
    assertEquals(0xFFFFFFFF.toInt(), PhotoTimeColour.pick(intArrayOf(0xFF4D4D4D.toInt()), 1, 1, 0, 0, 1, 1))
  }

  @Test
  fun theAreaIsCutToThePhotoAndAnAreaOutsideItUsesTheWholePhoto() {
    // Top half beige, bottom half navy.
    val half = IntArray(w * h) { if (it / w < 240) 0xFFF0E0C0.toInt() else 0xFF102060.toInt() }
    assertEquals(0xFFFFFFFF.toInt(), PhotoTimeColour.pick(half, w, h, 300, 400, 600, 600))
    assertEquals(0xFF111111.toInt(), PhotoTimeColour.pick(half, w, h, 500, 500, 600, 600))
    assertEquals(0xFF111111.toInt(), PhotoTimeColour.pick(half, w, h, -50, -50, -10, -10))
    assertEquals(0xFF111111.toInt(), PhotoTimeColour.pick(half, w, h, 100, 100, 100, 200))
    assertNull(PhotoTimeColour.pick(IntArray(3), 2, 2, 0, 0, 2, 2))
    assertNull(PhotoTimeColour.pick(IntArray(0), 0, 0, 0, 0, 1, 1))
  }

  @Test
  fun transparentPixelsAreSkippedAndSemiTransparentOnesSitOnBlack() {
    // Every other pixel fully transparent white: the navy alone counts.
    assertEquals(0xFFFFFFFF.toInt(), pickTop(IntArray(w * h) { if (it % 2 == 1) 0x00FFFFFF else 0xFF102060.toInt() }))
    // Nothing visible: black, so white.
    assertEquals(0xFFFFFFFF.toInt(), pickTop(flat(0x00FFFFFFL)))
    // White at alpha 0x20 over black is dark (L 0.13): white, where opaque white gets near-black.
    assertEquals(0xFFFFFFFF.toInt(), pickTop(flat(0x20FFFFFFL)))
  }
}
