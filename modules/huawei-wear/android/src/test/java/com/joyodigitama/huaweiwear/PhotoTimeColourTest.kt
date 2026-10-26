package com.joyodigitama.huaweiwear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * JoyoFit's time colour rule on synthetic 408 x 480 pictures with the Fit 4 Pro photo face's top time area (68, 18, 406, 182), sampled every
 * 4th pixel (3485 samples). Scores in the comments are 20th-percentile contrasts. The Swift twin (PhotoTimeColourTests.swift) expects the
 * same values.
 */
class PhotoTimeColourTest {
  private val w = 408
  private val h = 480

  private fun flat(colour: Long) = IntArray(w * h) { colour.toInt() }

  private fun picture(colour: (Int, Int) -> Long) = IntArray(w * h) { colour(it % w, it / w).toInt() }

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
    assertEquals(0xFFFFFFFF.toInt(), pickTop(flat(0xFF102060))) // navy: white 15.0, tint 12.2
    assertEquals(0xFF111111.toInt(), pickTop(flat(0xFFF0E0C0))) // beige: near-black 14.5, shade 13.4
  }

  @Test
  fun aHueKeepingCandidateWinsWithinHalfAPointOfTheBest() {
    assertEquals(0xFFFFFFFF.toInt(), pickTop(flat(0xFFD01010))) // red: white 5.6, tint 4.5
    assertEquals(0xFFFFFFFF.toInt(), pickTop(flat(0xFF1030D0))) // blue: white 8.9, tint 7.2
    assertEquals(0xFFFFFFE0.toInt(), pickTop(flat(0xFF606030))) // olive: tint 6.4, white 6.5
    assertEquals(0xFFE0FFFF.toInt(), pickTop(flat(0xFF005050))) // dark teal: tint 8.8, white 9.3
    assertEquals(0xFF0F0F1F.toInt(), pickTop(flat(0xFFA0A0F0))) // lavender: shade 7.92, near-black 7.90
    assertEquals(0xFF1F0F12.toInt(), pickTop(flat(0xFFFFC0CB))) // pink: shade 12.0, near-black 12.3
  }

  @Test
  fun texturedColourfulAreasKeepTheirHue() {
    // A noisy orange sunset: shade 5.2, near-black 5.5.
    assertEquals(0xFF1F160F.toInt(), pickTop(picture { x, y -> rgb(220 + noise(x, y) / 3, 90 + noise(x, y), 20 + noise(y, x) / 2) }))
    // A noisy dark teal: tint 6.9, white 7.3.
    assertEquals(0xFFE0FFFF.toInt(), pickTop(picture { x, y -> rgb(10, 50 + noise(x, y), 50 + noise(y, x)) }))
    // Pastel pink with about 10 % black specks: shade 12.6, near-black 12.9.
    assertEquals(0xFF1F0F14.toInt(), pickTop(picture { x, y -> if ((x * 31 + y * 17) % 97 < 10) 0xFF000000 else 0xFFFAC8D7 }))
  }

  /** Deterministic noise 0..60. */
  private fun noise(x: Int, y: Int) = ((x * 7919) xor (y * 104729)) % 61

  private fun rgb(r: Int, g: Int, b: Int) = 0xFF000000 or (r.toLong() shl 16) or (g.toLong() shl 8) or b.toLong()

  @Test
  fun greyAreasGetOnlyWhiteOrNearBlack() {
    assertEquals(0xFFFFFFFF.toInt(), pickTop(flat(0xFF000000)))
    assertEquals(0xFF111111.toInt(), pickTop(flat(0xFFFFFFFF)))
    assertEquals(0xFF111111.toInt(), pickTop(flat(0xFF808080)))
    assertEquals(0xFFFFFFFF.toInt(), pickTop(flat(0xFF5A5A54))) // saturation 6 / 90 < 0.08
  }

  @Test
  fun aMostlyDarkAreaWithBrightHighlightsGetsWhite() {
    // #606060 with the right 10 % of the area's columns white. The linear mean (L 0.21) would favour near-black (4.6 against 4.1);
    // the 20th percentile sees the grey: white 6.3, near-black 3.0.
    assertEquals(0xFFFFFFFF.toInt(), pickTop(picture { x, _ -> if (x >= 372) 0xFFFFFFFF else 0xFF606060 }))
    // The same picture as a whole (fallback area, every 7th pixel).
    assertEquals(0xFFFFFFFF.toInt(), PhotoTimeColour.pick(picture { x, _ -> if (x >= 372) 0xFFFFFFFF else 0xFF606060 }, w, h, -1, -1, -1, -1))
  }

  @Test
  fun aMostlyLightAreaWithDarkSpecksGetsNearBlack() {
    // #E0E0E0 with about 10 % black specks: near-black 14.3, white 1.3.
    assertEquals(0xFF111111.toInt(), pickTop(picture { x, y -> if ((x * 31 + y * 17) % 97 < 10) 0xFF000000 else 0xFFE0E0E0 }))
  }

  @Test
  fun aSmallMinorityDoesNotPullTheScore() {
    // 85 % black, 15 % white: white reaches 21 on the black, near-black only 1.1.
    val mix = IntArray(20) { if (it < 17) 0xFF000000.toInt() else -1 }
    assertEquals(0xFFFFFFFF.toInt(), PhotoTimeColour.pick(mix, 20, 1, 0, 0, 20, 1))
  }

  @Test
  fun theAreaIsCutToThePhotoAndAnAreaOutsideItUsesTheWholePhoto() {
    // The top 60 rows navy, the rest beige.
    val bands = picture { _, y -> if (y < 60) 0xFF102060 else 0xFFF0E0C0 }
    assertEquals(0xFFFFFFFF.toInt(), PhotoTimeColour.pick(bands, w, h, 300, -50, 600, 50))
    assertEquals(0xFF111111.toInt(), PhotoTimeColour.pick(bands, w, h, 500, 500, 600, 600))
    assertEquals(0xFF111111.toInt(), PhotoTimeColour.pick(bands, w, h, -50, -50, -10, -10))
    assertEquals(0xFF111111.toInt(), PhotoTimeColour.pick(bands, w, h, 100, 100, 100, 200))
    assertNull(PhotoTimeColour.pick(IntArray(3), 2, 2, 0, 0, 2, 2))
    assertNull(PhotoTimeColour.pick(IntArray(0), 0, 0, 0, 0, 1, 1))
  }

  @Test
  fun transparentPixelsAreSkippedAndSemiTransparentOnesSitOnBlack() {
    // Every other pixel fully transparent white: the navy alone counts.
    assertEquals(0xFFFFFFFF.toInt(), pickTop(IntArray(w * h) { if (it % 2 == 1) 0x00FFFFFF else 0xFF102060.toInt() }))
    // Nothing visible: white.
    assertEquals(0xFFFFFFFF.toInt(), pickTop(flat(0x00FFFFFFL)))
    // White at alpha 0x20 over black is dark (L 0.13): white, where opaque white gets near-black.
    assertEquals(0xFFFFFFFF.toInt(), pickTop(flat(0x20FFFFFFL)))
  }
}
