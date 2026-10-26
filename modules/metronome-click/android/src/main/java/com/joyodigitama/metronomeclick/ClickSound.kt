package com.joyodigitama.metronomeclick

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * The metronome's click: 35 ms of a woodblock-like tick (two partials, 1.8 and 2.9 kHz, decaying with a 5 ms time constant after a
 * 0.3 ms attack), 16-bit mono PCM at 44.1 kHz, peak about -1 dBFS. The sound starts at the first sample, so the tick lands when
 * playback starts. Synthesized rather than shipped as a file: no asset to bundle per platform. Twin of `ClickSound.swift`; keep them
 * in step (`ClickSoundTest` and `ClickSoundTests` check the same samples).
 */
object ClickSound {
  const val SAMPLE_RATE = 44_100
  const val SAMPLE_COUNT = 1_544 // 35 ms
  private const val DECAY_S = 0.005
  private const val ATTACK_S = 0.0003
  private const val PEAK = 0.89

  fun samples(): ShortArray {
    val raw = DoubleArray(SAMPLE_COUNT) { i ->
      val t = i.toDouble() / SAMPLE_RATE
      val envelope = min(1.0, t / ATTACK_S) * exp(-t / DECAY_S)
      envelope * (0.7 * sin(2 * PI * 1800 * t) + 0.3 * sin(2 * PI * 2900 * t))
    }
    val max = raw.maxOf { abs(it) }
    return ShortArray(SAMPLE_COUNT) { i -> (raw[i] / max * PEAK * Short.MAX_VALUE).roundToInt().toShort() }
  }

  /** The samples as a canonical 44-byte-header PCM WAV file. */
  fun wav(): ByteArray {
    val pcm = samples()
    val dataBytes = pcm.size * 2
    val out = ByteArray(44 + dataBytes)
    fun ascii(at: Int, text: String) = text.forEachIndexed { i, c -> out[at + i] = c.code.toByte() }
    fun u32(at: Int, value: Int) {
      for (i in 0 until 4) out[at + i] = (value ushr (8 * i)).toByte()
    }
    fun u16(at: Int, value: Int) {
      out[at] = value.toByte()
      out[at + 1] = (value ushr 8).toByte()
    }
    ascii(0, "RIFF")
    u32(4, 36 + dataBytes)
    ascii(8, "WAVE")
    ascii(12, "fmt ")
    u32(16, 16) // fmt chunk size
    u16(20, 1) // PCM
    u16(22, 1) // mono
    u32(24, SAMPLE_RATE)
    u32(28, SAMPLE_RATE * 2) // byte rate
    u16(32, 2) // block align
    u16(34, 16) // bits per sample
    ascii(36, "data")
    u32(40, dataBytes)
    pcm.forEachIndexed { i, sample -> u16(44 + i * 2, sample.toInt()) }
    return out
  }
}
