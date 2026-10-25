// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): util/MediaManager and
// service/receivers/GBMusicControlReceiver.
package com.joyodigitama.huaweiwear

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaController
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.service.notification.StatusBarNotification
import android.view.KeyEvent
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.MusicControl

internal class AndroidMediaBridge(
  context: Context,
  private val events: WearEvents,
) : MediaBridge {
  private val appContext = context.applicationContext
  private val mainHandler = Handler(Looper.getMainLooper())
  @Volatile private var changeCallback: (() -> Unit)? = null
  private var volumeReceiverRegistered = false

  private val tracker = MediaSessionTracker(appContext, mainHandler) {
    changeCallback?.invoke()
  }

  private val volumeReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      if (intent.action != VOLUME_CHANGED_ACTION) return
      val stream = intent.getIntExtra(EXTRA_VOLUME_STREAM_TYPE, -1)
      if (stream == -1 || stream == AudioManager.STREAM_MUSIC) {
        changeCallback?.invoke()
      }
    }
  }

  fun onNotificationPosted(sbn: StatusBarNotification): Boolean = tracker.onNotificationPosted(sbn)

  fun onNotificationRemoved(sbn: StatusBarNotification) = tracker.onNotificationRemoved(sbn)

  fun onNotificationListenerReady() = tracker.onNotificationListenerReady()

  override fun attachListeners(onChange: () -> Unit) {
    changeCallback = onChange
    tracker.attach()
    mainHandler.post {
      if (changeCallback != null) registerVolumeReceiver()
    }
  }

  override fun detachListeners() {
    changeCallback = null
    tracker.detach()
    mainHandler.post { unregisterVolumeReceiver() }
  }

  override fun snapshot(): MediaTrackInfo {
    val audio = appContext.getSystemService(AudioManager::class.java)
    val (maxVol, curVol) = if (audio != null) {
      MediaControlCodec.clampVolumes(
        audio.getStreamVolume(AudioManager.STREAM_MUSIC),
        audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC),
      )
    } else {
      0.toByte() to 0.toByte()
    }
    val controller = tracker.activeController()
    if (controller == null) {
      val state = MediaControlCodec.mapPlaybackState(null, audio?.isMusicActive == true)
      return MediaTrackInfo("", "", state, maxVol, curVol)
    }
    val meta = runCatching { controller.metadata }.getOrNull()
    val playback = runCatching { controller.playbackState }.getOrNull()
    val artist = MediaControlCodec.sanitizeText(
      meta?.firstText(
        MediaMetadata.METADATA_KEY_ARTIST,
        MediaMetadata.METADATA_KEY_ALBUM_ARTIST,
        MediaMetadata.METADATA_KEY_AUTHOR,
        MediaMetadata.METADATA_KEY_WRITER,
        MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE,
      ),
    )
    val track = MediaControlCodec.sanitizeText(
      meta?.firstText(MediaMetadata.METADATA_KEY_TITLE, MediaMetadata.METADATA_KEY_DISPLAY_TITLE),
    )
    val playState = MediaControlCodec.mapPlaybackState(playback?.state, audio?.isMusicActive == true)
    return MediaTrackInfo(artist, track, playState, maxVol, curVol)
  }

  override fun onButton(button: MusicControl.Control.Response.Button): Boolean {
    val audio = appContext.getSystemService(AudioManager::class.java) ?: return false
    return when (button) {
      MusicControl.Control.Response.Button.Volume_up -> {
        audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_RAISE, 0)
        true
      }
      MusicControl.Control.Response.Button.Volume_down -> {
        audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_LOWER, 0)
        true
      }
      MusicControl.Control.Response.Button.Play -> dispatchTransport(audio, KeyEvent.KEYCODE_MEDIA_PLAY) { it.play() }
      MusicControl.Control.Response.Button.Pause -> dispatchTransport(audio, KeyEvent.KEYCODE_MEDIA_PAUSE) { it.pause() }
      MusicControl.Control.Response.Button.Previous -> dispatchTransport(audio, KeyEvent.KEYCODE_MEDIA_PREVIOUS) { it.skipToPrevious() }
      MusicControl.Control.Response.Button.Next -> dispatchTransport(audio, KeyEvent.KEYCODE_MEDIA_NEXT) { it.skipToNext() }
      MusicControl.Control.Response.Button.Unknown -> false
    }
  }

  override fun setVolume(rawVolume: Byte): Boolean {
    val audio = appContext.getSystemService(AudioManager::class.java) ?: return false
    val minVol = audio.getStreamMinVolume(AudioManager.STREAM_MUSIC)
    val maxVol = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
    val target = MediaControlCodec.validWatchVolume(rawVolume, minVol, maxVol)
    if (target == null) {
      events.log(LogDirection.INFO, null, null, null, "Music control: ignored out-of-range volume ${rawVolume.toInt() and 0xFF} (valid $minVol..$maxVol)")
      return false
    }
    audio.setStreamVolume(AudioManager.STREAM_MUSIC, target, 0)
    return true
  }

  private fun dispatchTransport(audio: AudioManager, keyCode: Int, action: (MediaController.TransportControls) -> Unit): Boolean {
    val controller = tracker.activeController()
    if (controller != null) {
      try {
        action(controller.transportControls)
        return true
      } catch (e: Exception) {
        events.log(LogDirection.ERROR, null, null, null, "Music control: session transport failed, falling back to key event: ${e.message}")
      }
    }
    val now = SystemClock.uptimeMillis()
    audio.dispatchMediaKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_DOWN, keyCode, 0))
    audio.dispatchMediaKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_UP, keyCode, 0))
    return true
  }

  private fun registerVolumeReceiver() {
    if (volumeReceiverRegistered) return
    runCatching {
      val filter = IntentFilter(VOLUME_CHANGED_ACTION)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        appContext.registerReceiver(volumeReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
      } else {
        appContext.registerReceiver(volumeReceiver, filter)
      }
      volumeReceiverRegistered = true
    }
  }

  private fun unregisterVolumeReceiver() {
    if (!volumeReceiverRegistered) return
    volumeReceiverRegistered = false
    runCatching { appContext.unregisterReceiver(volumeReceiver) }
  }

  private fun MediaMetadata.firstText(vararg keys: String): String? {
    for (key in keys) {
      val value = getString(key)
      if (!value.isNullOrBlank()) return value
    }
    return null
  }

  private companion object {
    const val VOLUME_CHANGED_ACTION = "android.media.VOLUME_CHANGED_ACTION"
    const val EXTRA_VOLUME_STREAM_TYPE = "android.media.EXTRA_VOLUME_STREAM_TYPE"
  }
}
