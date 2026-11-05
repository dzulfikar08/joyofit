// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): HuaweiSupportProvider (SendCameraRemoteSetupEvent at init,
// onCameraStatusChange) and AsynchronousResponse.handleCameraRemote.
package com.joyodigitama.huaweiwear

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.CameraRemote

/**
 * The watch's Remote shutter, for the phone's own camera app. At connect the phone announces its camera (01/2A, 0), which makes the
 * watch show the app. The shutter itself is not ours: the watch is also a Bluetooth keyboard ("<name> Consumer Control") and each
 * press sends a volume key (seen on a Watch Fit 4 Pro and a Xiaomi, 2026-11-05: alternating volume down and up), which any camera app
 * takes as its shutter. All this controller does is answer the watch's open (01/29, 1) with "camera started" (01/2A, 1) and its close
 * (3) with "camera stopped" (2), here in native code so it also works while JoyoFit is in the background. The watch's events still go
 * to JS as `onCameraRemote`, for the log only.
 */
internal class CameraRemoteController(
  private val link: WearLink,
  private val events: WearEvents,
  private val scope: CoroutineScope,
) {
  private val lock = Any()
  private var attached: HuaweiSession? = null
  private var subscription: AutoCloseable? = null

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, message)

  private fun error(message: String) = events.log(LogDirection.ERROR, null, null, null, message)

  private fun supported() = DeviceCaps.supports(CameraRemote.id.toInt(), CameraRemote.CameraRemoteStatus.id.toInt())

  fun onLinkState(state: LinkState) {
    when (state) {
      LinkState.CONNECTED, LinkState.SYNCING -> {
        val session = link.handle()?.session ?: return
        synchronized(lock) {
          if (session === attached) return
          subscription?.close()
          subscription = null
          attached = session
          if (!supported()) {
            log("Camera remote: the watch does not list 01/29; not announced")
            return
          }
          subscription = session.subscribe(CameraRemote.id, CameraRemote.CameraRemoteStatus.id, "camera remote") { onStatus(session, it) }
        }
        scope.launch { send(session, CameraRemote.CameraRemoteSetup.Request.Event.ENABLE_CAMERA) }
      }
      LinkState.DISCONNECTED -> synchronized(lock) {
        subscription?.close()
        subscription = null
        attached = null
      }
      else -> Unit
    }
  }

  /** Runs on the read thread: parse, answer an open or a close, then tell JS. */
  private fun onStatus(session: HuaweiSession, packet: HuaweiPacket) {
    val event = try {
      packet.parseTlv()
      (packet as CameraRemote.CameraRemoteStatus.Response).event
    } catch (e: Exception) {
      error("Camera remote: could not parse the watch's packet: ${e.message}")
      return
    }
    val action = when (event) {
      CameraRemote.CameraRemoteStatus.Response.Event.OPEN_CAMERA -> "open"
      CameraRemote.CameraRemoteStatus.Response.Event.TAKE_PICTURE -> "shutter"
      CameraRemote.CameraRemoteStatus.Response.Event.CLOSE_CAMERA -> "close"
      null -> {
        log("Camera remote: unknown event from the watch")
        return
      }
    }
    log("Camera remote: the watch sent $action")
    val answer = when (event) {
      CameraRemote.CameraRemoteStatus.Response.Event.OPEN_CAMERA -> CameraRemote.CameraRemoteSetup.Request.Event.CAMERA_STARTED
      CameraRemote.CameraRemoteStatus.Response.Event.CLOSE_CAMERA -> CameraRemote.CameraRemoteSetup.Request.Event.CAMERA_STOPPED
      else -> null
    }
    if (answer != null) scope.launch { send(session, answer) }
    events.cameraRemote(mapOf("action" to action))
  }

  private suspend fun send(session: HuaweiSession, event: CameraRemote.CameraRemoteSetup.Request.Event) {
    try {
      session.send(CameraRemote.CameraRemoteSetup.Request(session.params, event), "CameraRemoteSetup $event")
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      error("Camera remote: $event not sent: ${e.message}")
    }
  }
}
