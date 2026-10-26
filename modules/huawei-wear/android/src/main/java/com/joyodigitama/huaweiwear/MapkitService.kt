package com.joyodigitama.huaweiwear

import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.HuaweiP2PManager
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.HuaweiBaseP2PService

/**
 * P2P module `hw.unitedevice.mapkit` <-> `in.huawei.mapkit` (fingerprint `SystemApp`), Huawei's offline-map transfer ([MapkitWire]). Registered only
 * while the experimental offline-map switch is on ([OfflineMapLab]). On registration it pings the watch's map app and sends the political view
 * (`02`, as Huawei Health on every connect; "1" is retried 3 times after 3 s); it answers the watch's own asks the way huac does (`07` with the
 * political view, `09` with size 0, `0B` with "no network"). Every frame in both directions is logged with [MapkitWire.describe]. Twin:
 * `MapkitService` in `MapkitWire.swift`.
 */
internal class MapkitService(
  manager: HuaweiP2PManager,
  private val events: WearEvents,
  private val scope: CoroutineScope,
) : HuaweiBaseP2PService(manager) {
  @Volatile
  var pingCode: Int? = null
    private set

  /** The watch's answer to the political view: "0" ok, "1" failed; null before one arrived. */
  @Volatile
  var politicalViewResult: String? = null
    private set

  /** The watch's last `08` parse result on this connection, and when it arrived. */
  @Volatile
  var lastParsed: MapkitMessage.Parsed? = null
    private set

  @Volatile
  var lastParsedAt: Long = 0L
    private set

  private val listeners = CopyOnWriteArrayList<(MapkitMessage) -> Unit>()
  private val counter = AtomicInteger(0)
  private val politicalRetries = AtomicInteger(0)

  /** Huawei Health's message id: a counter mod 10000. */
  fun nextMsgId(): Int = counter.updateAndGet { (it + 1) % 10000 }

  override fun getModule() = MapkitWire.MODULE

  override fun getPackage() = MapkitWire.PACKAGE

  override fun getFingerprint() = MapkitWire.FINGERPRINT

  override fun registered() {
    log("registered ${MapkitWire.MODULE} -> ${MapkitWire.PACKAGE}; political view ${MapkitWire.POLITICAL_VIEW}")
    sendPing { code, _ ->
      pingCode = code
      log("ping of ${MapkitWire.PACKAGE} answered 0x%02x (0xca = the map app is there)".format(code and 0xFF))
    }
    sendPoliticalView(nextMsgId())
  }

  override fun unregister() {
    clearPending()
    listeners.clear()
  }

  /** Calls [listener] with every decoded frame from the watch until the returned handle is closed. */
  fun subscribe(listener: (MapkitMessage) -> Unit): AutoCloseable {
    listeners += listener
    return AutoCloseable { listeners -= listener }
  }

  /** Sends one frame, logged; the P2P acknowledgement code (0xcf = received) is logged when it arrives. */
  fun send(frame: ByteArray) {
    val line = MapkitWire.describe(frame)
    log("tx $line")
    sendCommand(frame) { code, _ -> log("tx %02X acknowledged 0x%02x".format(frame[0].toInt() and 0xFF, code and 0xFF)) }
  }

  private fun sendPoliticalView(msgId: Int) = send(MapkitWire.politicalView(MapkitWire.POLITICAL_VIEW, msgId))

  override fun handleData(data: ByteArray) {
    log("rx ${MapkitWire.describe(data)}")
    val message = MapkitWire.parse(data) ?: return
    when (message) {
      is MapkitMessage.PoliticalView -> onPoliticalView(message)
      is MapkitMessage.Parsed -> {
        lastParsed = message
        lastParsedAt = System.currentTimeMillis()
        log("the watch parsed map ${message.mapId} type ${message.mapType}: code ${message.code} (0 = ok)")
      }
      is MapkitMessage.WatchAsk -> when (message.type) {
        MapkitWire.TYPE_ASK_POLITICAL_VIEW -> sendPoliticalView(nextMsgId())
        MapkitWire.TYPE_ASK_SIZE -> {
          log("the watch asked for a map around its position; answering size 0 (JoyoFit downloads no maps)")
          send(MapkitWire.sizeAnswer(0))
        }
        MapkitWire.TYPE_ASK_DOWNLOAD -> {
          log("the watch asked for a map download; answering \"no network\"")
          send(MapkitWire.noNetwork(nextMsgId()))
        }
      }
      else -> Unit
    }
    for (listener in listeners) listener(message)
  }

  private fun onPoliticalView(message: MapkitMessage.PoliticalView) {
    politicalViewResult = message.result
    if (message.result == "0") {
      politicalRetries.set(0)
      return
    }
    if (politicalRetries.incrementAndGet() > POLITICAL_RETRIES) {
      log("the watch refused the political view ${POLITICAL_RETRIES + 1} times; not retrying")
      return
    }
    val msgId = message.msgId?.toInt() ?: nextMsgId()
    scope.launch {
      delay(POLITICAL_RETRY_MS)
      sendPoliticalView(msgId)
    }
  }

  private fun log(message: String) = events.log(LogDirection.INFO, 0x34, 0x01, null, "Mapkit: $message")

  private companion object {
    const val POLITICAL_RETRIES = 3
    const val POLITICAL_RETRY_MS = 3_000L
  }
}
