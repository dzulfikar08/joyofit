package com.joyodigitama.huaweiwear

import android.media.session.PlaybackState
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.MusicControl

internal data class MediaTrackInfo(
  val artist: String,
  val track: String,
  val playState: Byte,
  val maxVolume: Byte,
  val currentVolume: Byte,
)

internal interface MediaBridge {
  fun snapshot(): MediaTrackInfo
  fun onButton(button: MusicControl.Control.Response.Button): Boolean
  fun setVolume(rawVolume: Byte): Boolean
  fun attachListeners(onChange: () -> Unit)
  fun detachListeners()
}

internal object MediaControlCodec {
  const val MAX_TEXT_CHARS = 120

  fun sanitizeText(raw: String?, maxChars: Int = MAX_TEXT_CHARS): String {
    if (raw.isNullOrBlank() || maxChars <= 0) return ""
    val cleaned = buildString(minOf(raw.length, maxChars)) {
      for (ch in raw) {
        if (!Character.isISOControl(ch)) append(ch)
      }
    }.trim()
    return if (cleaned.length <= maxChars) cleaned else cleaned.substring(0, maxChars)
  }

  /** GB SetMusicRequest.convertMusicState: maps Android PlaybackState to Huawei 0x25/0x02 tag 0x03. */
  fun mapPlaybackState(androidState: Int?, isMusicActive: Boolean = false): Byte = when (androidState) {
    PlaybackState.STATE_PLAYING -> PlaybackState.STATE_PLAYING.toByte()
    PlaybackState.STATE_PAUSED -> PlaybackState.STATE_PAUSED.toByte()
    PlaybackState.STATE_STOPPED -> PlaybackState.STATE_STOPPED.toByte()
    null -> if (isMusicActive) PlaybackState.STATE_PLAYING.toByte() else PlaybackState.STATE_NONE.toByte()
    else -> PlaybackState.STATE_NONE.toByte()
  }

  fun clampVolumes(current: Int, max: Int): Pair<Byte, Byte> {
    val safeMax = max.coerceIn(0, 127)
    val safeCurrent = current.coerceIn(0, safeMax)
    return safeMax.toByte() to safeCurrent.toByte()
  }

  /** Validates an unsigned watch volume byte against [minVolume]..[maxVolume]; null when out of range. */
  fun validWatchVolume(rawVolume: Byte, minVolume: Int, maxVolume: Int): Int? {
    if (maxVolume <= 0) return null
    val safeMin = minVolume.coerceAtLeast(0)
    if (safeMin > maxVolume) return null
    val unsigned = rawVolume.toInt() and 0xFF
    return if (unsigned in safeMin..maxVolume) unsigned else null
  }
}
