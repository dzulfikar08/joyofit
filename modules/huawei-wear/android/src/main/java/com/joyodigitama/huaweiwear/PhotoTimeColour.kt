// JoyoFit's own choice of a photo's time colour, sent as "#01" + RRGGBB when the watch asks for colours picked from the picture
// (27/01 tag 0x1b = 1). A simple heuristic written for JoyoFit: the dominant colour of the area where the face draws the time, then a
// readable colour of the same hue (a pale tint over a dark area, a dark shade over a light one). Integer arithmetic only, so the Swift
// twin (PhotoTimeColour.swift) gives the same result.
package com.joyodigitama.huaweiwear

/**
 * 1. The area is the rect (left, top, right, bottom) cut to the picture.
 * 2. Its dominant colour: every pixel goes into a coarse histogram (4 bits per channel, 4096 bins); the most populated bin wins (the
 *    lowest bin on a tie) and its pixels' mean RGB is the dominant colour, so a few odd pixels or a gradient do not move it.
 * 3. The time colour: hue H (0..359), saturation S and brightness of the dominant colour; luma Y = (299 R + 587 G + 114 B) / 1000.
 *    Over a dark area (Y < 128) a pale tint HSV(H, 15, 100), white for a grey area (S < 10); over a light area a dark shade
 *    HSV(H, 100, 20), `0xFF333333` for a grey area.
 */
internal object PhotoTimeColour {
  /**
   * The time colour (0xFFRRGGBB) for the area of [argb] (0xAARRGGBB ints row by row, `Bitmap.getPixels`); null when the area is empty or
   * the pixels do not match the size.
   */
  fun pick(argb: IntArray, width: Int, height: Int, left: Int, top: Int, right: Int, bottom: Int): Int? {
    if (width < 0 || height < 0 || argb.size < width * height) return null
    val x0 = left.coerceIn(0, width)
    val x1 = right.coerceIn(0, width)
    val y0 = top.coerceIn(0, height)
    val y1 = bottom.coerceIn(0, height)
    if (x1 <= x0 || y1 <= y0) return null
    val dominant = dominant(argb, width, x0, y0, x1, y1)
    return readable(dominant)
  }

  /** The mean RGB (0xRRGGBB) of the most populated 4-bit-per-channel bin of the area. */
  fun dominant(argb: IntArray, width: Int, x0: Int, y0: Int, x1: Int, y1: Int): Int {
    val counts = IntArray(BINS)
    val sumR = LongArray(BINS)
    val sumG = LongArray(BINS)
    val sumB = LongArray(BINS)
    for (y in y0 until y1) {
      for (x in x0 until x1) {
        val p = argb[y * width + x]
        val r = (p shr 16) and 0xFF
        val g = (p shr 8) and 0xFF
        val b = p and 0xFF
        val bin = ((r shr 4) shl 8) or ((g shr 4) shl 4) or (b shr 4)
        counts[bin]++
        sumR[bin] += r.toLong()
        sumG[bin] += g.toLong()
        sumB[bin] += b.toLong()
      }
    }
    var best = 0
    for (bin in 1 until BINS) if (counts[bin] > counts[best]) best = bin
    val n = counts[best].toLong()
    return ((sumR[best] / n).toInt() shl 16) or ((sumG[best] / n).toInt() shl 8) or (sumB[best] / n).toInt()
  }

  /** The readable time colour (0xFFRRGGBB) over a background of [rgb] (0xRRGGBB). */
  fun readable(rgb: Int): Int {
    val r = (rgb shr 16) and 0xFF
    val g = (rgb shr 8) and 0xFF
    val b = rgb and 0xFF
    val max = maxOf(r, g, b)
    val min = minOf(r, g, b)
    val delta = max - min
    val hue = when {
      delta == 0 -> 0
      max == r -> 60 * (g - b) / delta
      max == g -> 120 + 60 * (b - r) / delta
      else -> 240 + 60 * (r - g) / delta
    }.let { ((it % 360) + 360) % 360 }
    val saturation = if (max == 0) 0 else delta * 100 / max
    val luma = (299 * r + 587 * g + 114 * b) / 1000
    val grey = saturation < GREY_SATURATION
    return if (luma < DARK_LUMA) {
      if (grey) WHITE else hsv(hue, TINT_SATURATION, 100)
    } else {
      if (grey) DARK_GREY else hsv(hue, 100, SHADE_BRIGHTNESS)
    }
  }

  /** HSV (hue 0..359, saturation and value 0..100) to 0xFFRRGGBB. */
  fun hsv(hue: Int, saturation: Int, value: Int): Int {
    val v = value * 255 / 100
    val c = v * saturation / 100
    val x = c * (60 - kotlin.math.abs(hue % 120 - 60)) / 60
    val m = v - c
    val (r, g, b) = when (hue / 60) {
      0 -> Triple(c, x, 0)
      1 -> Triple(x, c, 0)
      2 -> Triple(0, c, x)
      3 -> Triple(0, x, c)
      4 -> Triple(x, 0, c)
      else -> Triple(c, 0, x)
    }
    return (0xFF shl 24) or ((r + m) shl 16) or ((g + m) shl 8) or (b + m)
  }

  private const val BINS = 4096
  private const val DARK_LUMA = 128
  private const val GREY_SATURATION = 10
  private const val TINT_SATURATION = 15
  private const val SHADE_BRIGHTNESS = 20
  private const val WHITE = -0x1 // 0xFFFFFFFF
  private const val DARK_GREY = -0xcccccd // 0xFF333333
}
