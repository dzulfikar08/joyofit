// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): HuaweiSupportProvider (SendCameraRemoteSetupEvent at init,
// onCameraStatusChange) and AsynchronousResponse.handleCameraRemote.
package com.joyodigitama.huaweiwear

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.CameraRemote

/**
 * The watch's Remote shutter. At connect the phone announces its camera (01/2A, 0), which makes the watch show the app; the
 * watch's open, take picture and close (01/29) go to JS as `onCameraRemote`, whose camera screen answers with
 * [setPhoneCamera] (01/2A, 1 started / 2 stopped).
 */
internal class CameraRemoteController(
  private val link: WearLink,
  private val events: WearEvents,
  private val scope: CoroutineScope,
) {
  private val lock = Any()
  private var attached: HuaweiSession? = null
  private var subscription: AutoCloseable? = null

  /** What JS last reported: the phone's viewfinder is on screen. Re-sent on a reconnect so the watch does not wait for it. */
  @Volatile
  private var phoneOpen = false

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, message)

  private fun error(message: String) = events.log(LogDirection.ERROR, null, null, null, message)

  fun status(): Map<String, Any?> = mapOf(
    "connected" to (link.handle() != null),
    "supported" to (link.handle() != null && supported()),
  )

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
          subscription = session.subscribe(CameraRemote.id, CameraRemote.CameraRemoteStatus.id, "camera remote") { onStatus(it) }
        }
        scope.launch {
          send(session, CameraRemote.CameraRemoteSetup.Request.Event.ENABLE_CAMERA)
          if (phoneOpen) send(session, CameraRemote.CameraRemoteSetup.Request.Event.CAMERA_STARTED)
        }
      }
      LinkState.DISCONNECTED -> synchronized(lock) {
        subscription?.close()
        subscription = null
        attached = null
      }
      else -> Unit
    }
  }

  /** Runs on the read thread: parse, then hand to JS. */
  private fun onStatus(packet: HuaweiPacket) {
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
    events.cameraRemote(mapOf("action" to action))
  }

  /** The camera screen is showing (`true`, "camera started") or has closed (`false`, "camera stopped"). */
  suspend fun setPhoneCamera(open: Boolean) {
    phoneOpen = open
    val handle = link.handle() ?: return
    if (!supported()) return
    send(
      handle.session,
      if (open) CameraRemote.CameraRemoteSetup.Request.Event.CAMERA_STARTED else CameraRemote.CameraRemoteSetup.Request.Event.CAMERA_STOPPED,
    )
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
