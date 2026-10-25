// JoyoFit's own rule for a photo's time colour, sent as "#01" + RRGGBB when the watch asks for colours picked from the picture (27/01 tag
// 0x1b = 1). Not derived from Huawei code. Swift twin: PhotoTimeColour.swift; both do the same integer and double arithmetic in the same
// order (no pow outside the 256-entry table, whose entries are at least 0.0016 away from a rounding edge), so they pick the same colour.
//
// The rule:
// 1. The area is the time rect cut to the photo, or the whole photo when nothing of it is left.
// 2. Its mean colour in linear-light sRGB: fully transparent pixels are skipped, a semi-transparent one counts as composited over black.
//    Linear light because that is how the eye mixes a busy area seen from arm's length; averaging the gamma-encoded values makes a
//    70 % black / 30 % white area look much darker than it is.
// 3. Its WCAG 2 relative luminance L, and four candidates: white #FFFFFF, near-black #111111 (softer than pure black on an OLED face,
//    still above 18:1 on white), and two that keep the area's hue: a light tint HSV(H, 0.25, 0.95) and a dark shade HSV(H, 0.60, 0.25).
//    The tint and shade constants are our own choice: pale and deep enough to stay readable, saturated enough that the hue shows.
// 4. The winner is the candidate with the highest WCAG contrast ratio against L, except that a hue-keeping candidate whose contrast is
//    at least 4.5 (WCAG AA for text) and within 1.0 of the best is preferred: a colour that matches the photo beats a slightly harder
//    black or white. A grey area (HSV saturation of its mean below 0.08) has no hue worth keeping and gets only white or near-black.
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
    var n = 0L
    var sumR = 0L
    var sumG = 0L
    var sumB = 0L
    for (y in y0 until y1) {
      for (x in x0 until x1) {
        val p = argb[y * width + x]
        val a = p ushr 24
        if (a == 0) continue
        n++
        sumR += LINEAR[(p shr 16) and 0xFF].toLong() * a
        sumG += LINEAR[(p shr 8) and 0xFF].toLong() * a
        sumB += LINEAR[p and 0xFF].toLong() * a
      }
    }
    // Mean linear channels (0..65535), rounded; an area with no visible pixel is black.
    val d = n * 255
    val r = if (n == 0L) 0 else ((sumR + d / 2) / d).toInt()
    val g = if (n == 0L) 0 else ((sumG + d / 2) / d).toInt()
    val b = if (n == 0L) 0 else ((sumB + d / 2) / d).toInt()
    val area = luminance(r, g, b)

    val candidates = ArrayList<Int>(4)
    candidates.add(WHITE)
    candidates.add(NEAR_BLACK)
    // Hue and saturation of the mean, back in 8-bit sRGB.
    val r8 = encode(r)
    val g8 = encode(g)
    val b8 = encode(b)
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

    val contrasts = DoubleArray(candidates.size) { contrast(luminanceOf(candidates[it]), area) }
    var best = 0
    for (i in 1 until candidates.size) if (contrasts[i] > contrasts[best]) best = i
    var keep = -1
    for (i in 2 until candidates.size) {
      val c = contrasts[i]
      if (c >= MIN_HUE_CONTRAST && c >= contrasts[best] - HUE_PREFERENCE && (keep < 0 || c > contrasts[keep])) keep = i
    }
    return candidates[if (keep >= 0) keep else best]
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

  private const val OPAQUE = -0x1000000 // 0xFF000000
  private const val WHITE = -0x1 // 0xFFFFFFFF
  private const val NEAR_BLACK = -0xeeeeef // 0xFF111111
  private const val TINT_SATURATION = 0.25
  private const val TINT_VALUE = 0.95
  private const val SHADE_SATURATION = 0.60
  private const val SHADE_VALUE = 0.25
  private const val GREY_SATURATION_PERCENT = 8
  private const val MIN_HUE_CONTRAST = 4.5
  private const val HUE_PREFERENCE = 1.0
}
