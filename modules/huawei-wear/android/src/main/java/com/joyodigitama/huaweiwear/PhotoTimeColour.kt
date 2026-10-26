// JoyoFit's own rule for a photo's time colour, sent as "#01" + RRGGBB when the watch asks for colours picked from the picture (27/01 tag
// 0x1b = 1). Not derived from Huawei code. Swift twin: PhotoTimeColour.swift; both do the same integer and double arithmetic in the same
// order (no pow outside the 256-entry table, whose entries are at least 0.0016 away from a rounding edge), so they pick the same colour.
//
// The rule:
// 1. The area is the time rect cut to the photo, or the whole photo when nothing of it is left. It is sampled on a grid of at most 4096
//    pixels (every s-th column and row from the area's corner, s as small as allows). Fully transparent pixels are skipped; a
//    semi-transparent one counts as composited over black. Each sample's WCAG 2 relative luminance is taken in linear-light sRGB.
// 2. Four candidates: white #FFFFFF, near-black #111111 (softer than pure black on an OLED face, still above 18:1 on white), and two that
//    keep the hue of the samples' linear mean: a light tint HSV(H, 0.25, 0.95) and a dark shade HSV(H, 0.60, 0.25). A grey area (HSV
//    saturation of that mean below 0.08) has no hue worth keeping and gets only white and near-black.
// 3. A candidate's score is its 20th-percentile WCAG contrast ratio over the samples: the contrast it reaches on at least 80 % of the area.
//    Scoring against the mean instead lets a few bright highlights lift a mostly dark area into "light", so near-black digits end up on
//    dark ground; the percentile follows what most of the area looks like.
// 4. The best score wins, white on a tie (light digits read best on photos). A hue-keeping candidate whose score is at least 3.0 and within
//    0.5 of the best is preferred: a colour that matches the photo beats a slightly harder black or white. An area with no visible pixel
//    gets white.
package com.joyodigitama.huaweiwear

import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.pow

internal object PhotoTimeColour {
  /**
   * The time colour (0xFFRRGGBB) for the rect (left, top, right, bottom) of [argb] (0xAARRGGBB ints row by row, `Bitmap.getPixels`);
   * the whole photo when the rect has nothing inside it. Null only for an empty photo or pixels that do not match the size.
   */
  fun pick(argb: IntArray, width: Int, height: Int, left: Int, top: Int, right: Int, bottom: Int): Int? {
    if (width <= 0 || height <= 0 || argb.size < width * height) return null
    var x0 = left.coerceIn(0, width)
    var x1 = right.coerceIn(0, width)
    var y0 = top.coerceIn(0, height)
    var y1 = bottom.coerceIn(0, height)
    if (x1 <= x0 || y1 <= y0) {
      x0 = 0
      y0 = 0
      x1 = width
      y1 = height
    }
    val stride = gridStep(x1 - x0, y1 - y0)
    val luminances = DoubleArray(MAX_SAMPLES)
    var n = 0
    var sumR = 0L
    var sumG = 0L
    var sumB = 0L
    for (y in y0 until y1 step stride) {
      for (x in x0 until x1 step stride) {
        val p = argb[y * width + x]
        val a = p ushr 24
        if (a == 0) continue
        val r = (LINEAR[(p shr 16) and 0xFF] * a + 127) / 255
        val g = (LINEAR[(p shr 8) and 0xFF] * a + 127) / 255
        val b = (LINEAR[p and 0xFF] * a + 127) / 255
        sumR += r
        sumG += g
        sumB += b
        luminances[n++] = luminance(r, g, b)
      }
    }
    if (n == 0) return WHITE

    val candidates = ArrayList<Int>(4)
    candidates.add(WHITE)
    candidates.add(NEAR_BLACK)
    // Hue and saturation of the samples' linear mean, back in 8-bit sRGB.
    val r8 = encode(((sumR + n / 2) / n).toInt())
    val g8 = encode(((sumG + n / 2) / n).toInt())
    val b8 = encode(((sumB + n / 2) / n).toInt())
    val max = maxOf(r8, g8, b8)
    val delta = max - minOf(r8, g8, b8)
    val grey = max == 0 || delta * 100 < GREY_SATURATION_PERCENT * max
    if (!grey) {
      var hue = when (max) {
        r8 -> 60.0 * (g8 - b8) / delta
        g8 -> 60.0 * (b8 - r8) / delta + 120.0
        else -> 60.0 * (r8 - g8) / delta + 240.0
      }
      if (hue < 0.0) hue += 360.0
      candidates.add(hsv(hue, TINT_SATURATION, TINT_VALUE))
      candidates.add(hsv(hue, SHADE_SATURATION, SHADE_VALUE))
    }

    val contrasts = DoubleArray(n)
    val scores = DoubleArray(candidates.size) { i ->
      val candidate = luminanceOf(candidates[i])
      for (k in 0 until n) contrasts[k] = contrast(candidate, luminances[k])
      contrasts.sort()
      contrasts[n / 5]
    }
    var best = 0
    for (i in 1 until candidates.size) if (scores[i] > scores[best]) best = i
    var keep = -1
    for (i in 2 until candidates.size) {
      val s = scores[i]
      if (s >= MIN_HUE_SCORE && s >= scores[best] - HUE_PREFERENCE && (keep < 0 || s > scores[keep])) keep = i
    }
    return candidates[if (keep >= 0) keep else best]
  }

  /** The smallest grid step that samples at most [MAX_SAMPLES] pixels of a [w] x [h] area. */
  private fun gridStep(w: Int, h: Int): Int {
    var s = 1
    while (((w + s - 1) / s).toLong() * ((h + s - 1) / s) > MAX_SAMPLES) s++
    return s
  }

  /** sRGB channel (0..255) to linear light scaled to 0..65535, rounded. */
  internal val LINEAR = IntArray(256) { i ->
    val s = i / 255.0
    val v = if (s <= 0.04045) s / 12.92 else ((s + 0.055) / 1.055).pow(2.4)
    floor(v * 65535.0 + 0.5).toInt()
  }

  /** The 8-bit sRGB channel whose linear value is nearest to [linear] (0..65535); the lower one on a tie. */
  private fun encode(linear: Int): Int {
    var lo = 0
    var hi = 255
    while (lo < hi) {
      val mid = (lo + hi) / 2
      if (LINEAR[mid] < linear) lo = mid + 1 else hi = mid
    }
    return if (lo > 0 && linear - LINEAR[lo - 1] <= LINEAR[lo] - linear) lo - 1 else lo
  }

  /** WCAG 2 relative luminance (0..1) of linear channels scaled to 0..65535. */
  private fun luminance(r: Int, g: Int, b: Int): Double = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 65535.0

  private fun luminanceOf(argb: Int): Double = luminance(LINEAR[(argb shr 16) and 0xFF], LINEAR[(argb shr 8) and 0xFF], LINEAR[argb and 0xFF])

  /** WCAG 2 contrast ratio (1..21). */
  private fun contrast(a: Double, b: Double): Double = if (a > b) (a + 0.05) / (b + 0.05) else (b + 0.05) / (a + 0.05)

  /** HSV (hue 0 until 360, saturation and value 0..1) to 0xFFRRGGBB. */
  private fun hsv(hue: Double, saturation: Double, value: Double): Int {
    val c = value * saturation
    val h = hue / 60.0
    val x = c * (1.0 - abs(h % 2.0 - 1.0))
    val m = value - c
    val (r, g, b) = when (floor(h).toInt()) {
      0 -> Triple(c, x, 0.0)
      1 -> Triple(x, c, 0.0)
      2 -> Triple(0.0, c, x)
      3 -> Triple(0.0, x, c)
      4 -> Triple(x, 0.0, c)
      else -> Triple(c, 0.0, x)
    }
    return OPAQUE or (byte(r + m) shl 16) or (byte(g + m) shl 8) or byte(b + m)
  }

  private fun byte(channel: Double): Int = floor(channel * 255.0 + 0.5).toInt()

  private const val MAX_SAMPLES = 4096
  private const val OPAQUE = -0x1000000 // 0xFF000000
  private const val WHITE = -0x1 // 0xFFFFFFFF
  private const val NEAR_BLACK = -0xeeeeef // 0xFF111111
  private const val TINT_SATURATION = 0.25
  private const val TINT_VALUE = 0.95
  private const val SHADE_SATURATION = 0.60
  private const val SHADE_VALUE = 0.25
  private const val GREY_SATURATION_PERCENT = 8
  private const val MIN_HUE_SCORE = 3.0
  private const val HUE_PREFERENCE = 0.5
}
