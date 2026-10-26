package com.joyodigitama.huaweiwear

import java.util.concurrent.atomic.AtomicInteger
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.P2P
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.HuaweiP2PManager
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.HuaweiBaseP2PService
import org.json.JSONObject

/** The fingerprints Wear Engine checks: the phone app's (source, tag 05) and the watch app's (destination, tag 06). */
internal data class WatchNavConfig(val phoneFingerprint: String, val watchFingerprint: String)

/**
 * P2P service `<phone package>` <-> `com.joyodigitama.navi` (JoyoFit's own watch app, [WatchNavWire]). Registered by [WatchNav] while a
 * session runs. Sends JSON messages as P2P data, answers the watch app's ping with 0xca and its data with 0xcf, forwards the watch app's
 * messages as `onWatchNav` events and tracks whether the watch app answers. Twin: `WatchNavService.swift`.
 */
internal class WatchNavService(
  manager: HuaweiP2PManager,
  val phonePackage: String,
  val config: WatchNavConfig,
  private val events: WearEvents,
  private val now: () -> Long = System::currentTimeMillis,
) : HuaweiBaseP2PService(manager) {
  /** "unknown", "present" or "absent". */
  @Volatile
  var watchApp: String = UNKNOWN
    private set

  @Volatile
  var lastCode: Int? = null
    private set

  @Volatile
  var lastHeardAt: Long? = null
    private set

  @Volatile
  private var lastPingAt: Long? = null

  private val sentCount = AtomicInteger(0)
  private val ackedCount = AtomicInteger(0)
  private val receivedCount = AtomicInteger(0)

  val sent: Int get() = sentCount.get()
  val acked: Int get() = ackedCount.get()
  val received: Int get() = receivedCount.get()

  override fun getModule() = phonePackage

  override fun getPackage() = WatchNavWire.PACKAGE

  override fun getFingerprint() = config.watchFingerprint

  override fun getLocalFingerprint() = config.phoneFingerprint

  override fun getPingPackage() = phonePackage

  override fun registered() {
    log("registered $phonePackage -> ${WatchNavWire.PACKAGE}")
    ping()
  }

  override fun unregister() {
    clearPending()
    presence(UNKNOWN, null)
  }

  fun ping() {
    lastPingAt = now()
    sendPing { code, _ ->
      val c = code and 0xFF
      lastCode = c
      lastHeardAt = now()
      log("ping of ${WatchNavWire.PACKAGE} answered 0x%02x (0xca = the watch app is there)".format(c))
      presence(if (c == WatchNavWire.PING_PRESENT) PRESENT else ABSENT, c)
    }
  }

  /** Sends one message; throws [ErrorCodes.INVALID_ARGUMENT] when it is empty or too long. */
  fun send(json: String): Boolean {
    WatchNavWire.problem(json)?.let { throw WearException(ErrorCodes.INVALID_ARGUMENT, "Watch navigation message not sent: $it") }
    val last = lastPingAt
    if (watchApp != PRESENT && (last == null || now() - last > REPING_MS)) ping()
    val bytes = json.toByteArray(Charsets.UTF_8)
    val summary = WatchNavWire.summary(json)
    sentCount.incrementAndGet()
    log("tx $summary (${bytes.size} bytes)")
    sendCommand(bytes) { code, _ ->
      val c = code and 0xFF
      lastCode = c
      lastHeardAt = now()
      if (c == WatchNavWire.ACK_RECEIVED) ackedCount.incrementAndGet()
      presence(if (c == WatchNavWire.ACK_RECEIVED) PRESENT else ABSENT, c)
      log(if (c == WatchNavWire.ACK_RECEIVED) "tx $summary acknowledged 0xcf" else "tx $summary answered 0x%02x".format(c))
    }
    return true
  }

  override fun onPingPacket(packet: P2P.P2PCommand.Response): Int {
    log("the watch app pinged; answered 0xca")
    lastHeardAt = now()
    presence(PRESENT, WatchNavWire.PING_PRESENT)
    return WatchNavWire.PING_PRESENT
  }

  override fun onDataPacket(packet: P2P.P2PCommand.Response): Int = WatchNavWire.ACK_RECEIVED

  override fun handleData(data: ByteArray) {
    receivedCount.incrementAndGet()
    lastHeardAt = now()
    presence(PRESENT, null)
    val text = String(data, Charsets.UTF_8)
    val isJson = try {
      JSONObject(text)
      true
    } catch (e: Exception) {
      false
    }
    if (!isJson) {
      log("rx not JSON (${data.size} bytes): ${data.toHex().lowercase()}")
      return
    }
    log("rx $text")
    events.watchNav(mapOf("kind" to "message", "json" to text, "ts" to now()))
  }

  /** Records the watch app's presence; logs and emits only when it changed. */
  private fun presence(value: String, code: Int?) {
    synchronized(this) {
      if (watchApp == value) return
      watchApp = value
    }
    log("watch app $value" + if (code != null) " (code 0x%02x)".format(code) else "")
    events.watchNav(mapOf("kind" to "presence", "watchApp" to value, "code" to code, "ts" to now()))
  }

  private fun log(message: String) = events.log(LogDirection.INFO, 0x34, 0x01, null, "WatchNav: $message")

  companion object {
    const val UNKNOWN = "unknown"
    const val PRESENT = "present"
    const val ABSENT = "absent"

    /** A send while the watch app is not known present pings first when the last ping is older than this. */
    const val REPING_MS = 30_000L
  }
}
