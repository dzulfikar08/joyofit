package com.joyodigitama.huaweiwear

import android.media.session.PlaybackState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MediaControlCodecTest {
  @Test
  fun sanitizeTextStripsControlCharsAndCapsLength() {
    assertEquals("", MediaControlCodec.sanitizeText(null))
    assertEquals("", MediaControlCodec.sanitizeText("   \u0000\u0007\n\r\t  "))
    assertEquals("", MediaControlCodec.sanitizeText("Valid", maxChars = 0))
    assertEquals("", MediaControlCodec.sanitizeText("Valid", maxChars = -5))
    assertEquals("Song Title", MediaControlCodec.sanitizeText("  Song\u0000\n Title\u0007 "))
    assertEquals("Lagu 🎵", MediaControlCodec.sanitizeText("Lagu 🎵"))

    val longInput = "A".repeat(10_000)
    val truncated = MediaControlCodec.sanitizeText(longInput)
    assertEquals(MediaControlCodec.MAX_TEXT_CHARS, truncated.length)
  }

  @Test
  fun clampVolumesAndValidateUnsignedWatchVolumeBounds() {
    assertEquals(15.toByte() to 0.toByte(), MediaControlCodec.clampVolumes(-5, 15))
    assertEquals(15.toByte() to 15.toByte(), MediaControlCodec.clampVolumes(99, 15))
    assertEquals(127.toByte() to 127.toByte(), MediaControlCodec.clampVolumes(500, 500))
    assertEquals(0.toByte() to 0.toByte(), MediaControlCodec.clampVolumes(5, -1))

    assertEquals(0, MediaControlCodec.validWatchVolume(0, 0, 15))
    assertEquals(15, MediaControlCodec.validWatchVolume(15, 0, 15))
    assertNull(MediaControlCodec.validWatchVolume(16, 0, 15))
    assertNull(MediaControlCodec.validWatchVolume((-1).toByte(), 0, 15)) // 0xFF = 255 > 15
    assertNull(MediaControlCodec.validWatchVolume(0x80.toByte(), 0, 15)) // 0x80 = 128 > 15
    assertNull(MediaControlCodec.validWatchVolume(0, 1, 15)) // below minVolume = 1
    assertNull(MediaControlCodec.validWatchVolume(0, 0, 0)) // maxVolume <= 0
    assertNull(MediaControlCodec.validWatchVolume(5, 10, 5)) // minVolume > maxVolume
  }

  @Test
  fun mapPlaybackStateHandlesKnownAndFallbackStates() {
    assertEquals(3.toByte(), MediaControlCodec.mapPlaybackState(PlaybackState.STATE_PLAYING, false))
    assertEquals(2.toByte(), MediaControlCodec.mapPlaybackState(PlaybackState.STATE_PAUSED, true))
    assertEquals(1.toByte(), MediaControlCodec.mapPlaybackState(PlaybackState.STATE_STOPPED, false))
    assertEquals(0.toByte(), MediaControlCodec.mapPlaybackState(PlaybackState.STATE_BUFFERING, true))
    assertEquals(3.toByte(), MediaControlCodec.mapPlaybackState(null, true))
    assertEquals(0.toByte(), MediaControlCodec.mapPlaybackState(null, false))
  }
}
