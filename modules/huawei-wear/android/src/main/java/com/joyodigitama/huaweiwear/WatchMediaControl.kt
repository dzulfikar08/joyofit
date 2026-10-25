// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): service/devices/huawei/AsynchronousResponse.handleMusicControls,
// HuaweiSupportProvider.{sendSetMusic,onSetMusicInfo,onSetMusicState}, requests/{SetMusicRequest,SetMusicStatusRequest}.
package com.joyodigitama.huaweiwear

import android.content.Context
import android.service.notification.StatusBarNotification
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.MusicControl

/**
 * Remote media control over Huawei service 0x25:
 * - answers the watch's 25/01 status request when the Music screen opens on the watch;
 * - pushes 25/02 MusicInfo (artist, track, playback state, max/current volume) when playback or volume changes;
 * - executes the watch's 25/03 play, pause, next, previous and volume commands on the phone.
 */
internal class WatchMediaControl(
  private val bridge: MediaBridge,
  private val sessionProvider: () -> HuaweiSession?,
  private val events: WearEvents,
  private val scope: CoroutineScope,
  private val settleDelayMs: Long = 120L,
  private val debounceMs: Long = 100L,
) {
  constructor(
    context: Context,
    link: WearLink,
    events: WearEvents,
    scope: CoroutineScope,
  ) : this(
    bridge = AndroidMediaBridge(context, events),
    sessionProvider = { link.handle()?.session },
    events = events,
    scope = scope,
  )

  private val lock = Any()
  private var attached: HuaweiSession? = null
  private val subscriptions = ArrayList<AutoCloseable>()
  private var debounceJob: Job? = null
  private var lastSent: MediaTrackInfo? = null
  @Volatile private var watchRequested = false
  @Volatile private var listenersAttached = false

  private fun log(cmd: Int, msg: String) = events.log(LogDirection.INFO, MusicControl.id.toInt(), cmd, null, msg)
  private fun error(cmd: Int, msg: String) = events.log(LogDirection.ERROR, MusicControl.id.toInt(), cmd, null, msg)

  fun onNotificationPosted(sbn: StatusBarNotification) { (bridge as? AndroidMediaBridge)?.onNotificationPosted(sbn) }
  fun onNotificationRemoved(sbn: StatusBarNotification) { (bridge as? AndroidMediaBridge)?.onNotificationRemoved(sbn) }
  fun onNotificationListenerReady() { (bridge as? AndroidMediaBridge)?.onNotificationListenerReady() }

  @Synchronized
  fun onLinkState(state: LinkState) {
    when (state) {
      LinkState.CONNECTED, LinkState.SYNCING -> {
        val session = sessionProvider() ?: return
        if (session === attached) return
        detach()
        attached = session
        subscriptions += session.subscribe(MusicControl.id, MusicControl.MusicStatusResponse.id, "music status") { onStatusRequest(it, session) }
        subscriptions += session.subscribe(MusicControl.id, MusicControl.MusicInfo.id, "music info") { onMusicInfoAck(it) }
        subscriptions += session.subscribe(MusicControl.id, MusicControl.Control.id, "music control") { onControlCommand(it, session) }
        if (supportsMusicControl()) {
          ensureBridgeListeners()
          schedulePush()
        }
      }
      LinkState.DISCONNECTED -> detach()
      else -> Unit
    }
  }

  private fun detach() {
    subscriptions.forEach { it.close() }
    subscriptions.clear()
    attached = null
    watchRequested = false
    synchronized(lock) {
      debounceJob?.cancel()
      debounceJob = null
      lastSent = null
    }
    if (listenersAttached) {
      bridge.detachListeners()
      listenersAttached = false
    }
  }

  private fun ensureBridgeListeners() {
    if (!listenersAttached) {
      listenersAttached = true
      bridge.attachListeners { schedulePush() }
    }
  }

  private fun supportsMusicControl(): Boolean =
    watchRequested || DeviceCaps.supports(MusicControl.id.toInt(), MusicControl.MusicInfo.id.toInt())

  private fun schedulePush() {
    if (!supportsMusicControl()) return
    synchronized(lock) {
      debounceJob?.cancel()
      debounceJob = scope.launch {
        if (debounceMs > 0) delay(debounceMs)
        val session = synchronized(this@WatchMediaControl) { attached } ?: return@launch
        sendMusicInfo(session, force = false)
      }
    }
  }

  private fun onStatusRequest(packet: HuaweiPacket, session: HuaweiSession) {
    val resp = try {
      packet.parseTlv()
      packet as? MusicControl.MusicStatusResponse ?: return
    } catch (e: Exception) {
      error(MusicControl.MusicStatusResponse.id.toInt(), "Music status: could not parse watch packet: ${e.message}")
      return
    }
    if (resp.status != -1 && resp.status != MusicControl.successValue) {
      log(MusicControl.MusicStatusResponse.id.toInt(), "Music status: watch reported error 0x${Integer.toHexString(resp.status)}")
      return
    }
    watchRequested = true
    ensureBridgeListeners()
    scope.launch {
      sendStatusAck(session, MusicControl.MusicStatusResponse.id, "MusicStatusAck")
      sendMusicInfo(session, force = true)
    }
  }

  private fun onControlCommand(packet: HuaweiPacket, session: HuaweiSession) {
    val resp = try {
      packet.parseTlv()
      packet as? MusicControl.Control.Response ?: return
    } catch (e: Exception) {
      error(MusicControl.Control.id.toInt(), "Music control: could not parse watch packet: ${e.message}")
      return
    }
    watchRequested = true
    ensureBridgeListeners()
    scope.launch {
      var handled = false
      var ok = true
      if (resp.buttonPresent) {
        handled = true
        val btn = resp.button ?: MusicControl.Control.Response.Button.Unknown
        if (btn != MusicControl.Control.Response.Button.Unknown) {
          log(MusicControl.Control.id.toInt(), "Music control: button $btn")
          try {
            if (!bridge.onButton(btn)) ok = false
          } catch (e: Exception) {
            ok = false
            error(MusicControl.Control.id.toInt(), "Music control: button $btn failed: ${e.message}")
          }
        }
      }
      if (resp.volumePresent) {
        handled = true
        log(MusicControl.Control.id.toInt(), "Music control: volume ${resp.volume.toInt() and 0xFF}")
        try {
          if (!bridge.setVolume(resp.volume)) ok = false
        } catch (e: Exception) {
          ok = false
          error(MusicControl.Control.id.toInt(), "Music control: volume update failed: ${e.message}")
        }
      }
      if (handled) {
        val code = if (ok) MusicControl.successValue else 0
        sendStatusAck(session, MusicControl.Control.id, "MusicControlAck", code)
        if (settleDelayMs > 0) delay(settleDelayMs)
        sendMusicInfo(session, force = true)
      }
    }
  }

  private fun onMusicInfoAck(packet: HuaweiPacket) {
    try {
      packet.parseTlv()
      val resp = packet as? MusicControl.MusicInfo.Response ?: return
      if (!resp.ok) {
        log(MusicControl.MusicInfo.id.toInt(), "Music info not acknowledged: ${resp.error}")
      }
    } catch (e: Exception) {
      error(MusicControl.MusicInfo.id.toInt(), "Music info: could not parse watch response: ${e.message}")
    }
  }

  private suspend fun sendStatusAck(
    session: HuaweiSession,
    commandId: Byte,
    label: String,
    returnValue: Int = MusicControl.successValue,
  ) {
    try {
      val ack = MusicControl.MusicStatusRequest(session.params, commandId, returnValue)
      session.send(ack, label)
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      error(commandId.toInt(), "$label failed: ${e.message}")
    }
  }

  internal suspend fun sendMusicInfo(session: HuaweiSession, force: Boolean) {
    if (!force && !supportsMusicControl()) return
    val info = try {
      bridge.snapshot()
    } catch (e: Exception) {
      error(MusicControl.MusicInfo.id.toInt(), "Music info: could not read media state: ${e.message}")
      return
    }
    synchronized(lock) {
      if (!force && info == lastSent) return
      lastSent = info
    }
    try {
      val req = MusicControl.MusicInfo.Request(
        session.params,
        info.artist,
        info.track,
        info.playState,
        info.maxVolume,
        info.currentVolume,
      )
      session.send(req, "MusicInfo", logFrames = false)
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      error(MusicControl.MusicInfo.id.toInt(), "Music info: send failed: ${e.message}")
    }
  }
}
