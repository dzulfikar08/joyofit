// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): service/devices/huawei/{ResponseManager,requests/Request}.
package com.joyodigitama.huaweiwear

import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV

/**
 * Request/response layer over a [FrameSink]. Owns the [HuaweiPacket.ParamsProvider] shared by every
 * packet, reassembles inbound bytes like GB's ResponseManager.handleData and hands each complete
 * packet to the first pending request with the same serviceId + commandId (GB's
 * `Request.handleResponse(HuaweiPacket)`). Complete packets without a pending request go to the
 * [subscribe]r for their serviceId + commandId, if any (GB's non-auto-removed response handlers,
 * such as the file download's data receiver); the rest are GB's "asynchronous responses" and are
 * only logged.
 */
internal class HuaweiSession(
  private val sink: FrameSink,
  private val events: WearEvents,
) {
  val params = HuaweiPacket.ParamsProvider()

  private class Waiter(val serviceId: Byte, val commandId: Byte, val label: String) {
    val result = CompletableDeferred<HuaweiPacket>()
  }

  private class Subscription(val serviceId: Byte, val commandId: Byte, val label: String, val handler: (HuaweiPacket) -> Unit)

  // Guards [waiters], [closedBy], [received] and [frame]. Also orders ParamsProvider writes made
  // before a request against the read thread's parse of its response.
  private val lock = Any()
  private val waiters = ArrayList<Waiter>()
  private var closedBy: WearException? = null
  private val subscriptions = ArrayList<Subscription>()
  private val unhandledObservers = ArrayList<UnhandledObserver>()

  // Reassembly state (ResponseManager.receivedPackets for the single main channel).
  private var received: HuaweiPacket? = null

  // Raw wire bytes of the packet(s) being reassembled, for the rx log only.
  private var frame = ByteArray(0)

  /**
   * Sends [packet] and suspends for its response (GB `Request.doPerform` + `handleResponse`).
   * The response is returned with `parseTlv()` already applied. Throws [WearException] with
   * ERR_TIMEOUT, ERR_PROTOCOL (serialize/parse failure) or ERR_DISCONNECTED (link closed).
   */
  suspend fun request(packet: HuaweiPacket, timeoutMs: Long, label: String): HuaweiPacket {
    val frames = serialize(packet, label)

    val waiter = Waiter(packet.serviceId, packet.commandId, label)
    synchronized(lock) {
      closedBy?.let { throw it }
      waiters.add(waiter)
    }

    try {
      transmit(packet, frames, label)
    } catch (e: Throwable) {
      removeWaiter(waiter)
      throw e
    }

    val response = try {
      withTimeout(timeoutMs) { waiter.result.await() }
    } catch (e: TimeoutCancellationException) {
      removeWaiter(waiter)
      throw WearException(
        ErrorCodes.TIMEOUT,
        "$label: no response (service ${waiter.serviceId.hex2()}, command ${waiter.commandId.hex2()}) within $timeoutMs ms",
        e,
      )
    } catch (e: Throwable) {
      removeWaiter(waiter)
      throw e
    }

    try {
      response.parseTlv()
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      throw WearException(ErrorCodes.PROTOCOL, "$label: failed to parse response: ${e.message}", e)
    }
    return response
  }

  /**
   * Sends [packet] without waiting for an answer, for commands whose reply (if any) is picked up by
   * a [subscribe]r, e.g. GB's GetFileBlockRequest, which only starts the watch pushing 0x05 data.
   */
  suspend fun send(packet: HuaweiPacket, label: String, logFrames: Boolean = true) {
    val frames = serialize(packet, label)
    synchronized(lock) { closedBy?.let { throw it } }
    transmit(packet, frames, label, logFrames)
  }

  /** Why the session was closed, or null while it is open. */
  val closeCause: WearException? get() = synchronized(lock) { closedBy }

  /**
   * Routes complete packets that no pending [request] waits for to [handler] until the returned
   * handle is closed (GB: a Request whose `autoRemoveFromResponseHandler()` is false, e.g. the
   * file download manager's FileDataReceiver). The packet is handed over without `parseTlv()`.
   * [handler] runs on the read thread under the session lock and must not block.
   */
  fun subscribe(serviceId: Byte, commandId: Byte, label: String, handler: (HuaweiPacket) -> Unit): AutoCloseable {
    val subscription = Subscription(serviceId, commandId, label, handler)
    synchronized(lock) { subscriptions.add(subscription) }
    return AutoCloseable { synchronized(lock) { subscriptions.remove(subscription) } }
  }

  /**
   * A lab hook: [observer] also hears every complete packet that no request waits for and no [subscribe]r takes (the ones logged as
   * "asynchronous"), with its decoded TLV bytes (null when undecodable) and the raw frame, until the returned handle is closed. It runs on
   * the read thread under the session lock and must not block.
   */
  fun observeUnhandled(observer: UnhandledObserver): AutoCloseable {
    synchronized(lock) { unhandledObservers.add(observer) }
    return AutoCloseable { synchronized(lock) { unhandledObservers.remove(observer) } }
  }

  private fun serialize(packet: HuaweiPacket, label: String): List<ByteArray> = try {
    packet.serialize() ?: throw WearException(ErrorCodes.PROTOCOL, "$label: packet serialized to nothing")
  } catch (e: WearException) {
    throw e
  } catch (e: CancellationException) {
    throw e
  } catch (e: Exception) {
    throw WearException(ErrorCodes.PROTOCOL, "$label: request could not be created: ${e.message}", e)
  }

  private suspend fun transmit(packet: HuaweiPacket, frames: List<ByteArray>, label: String, logFrames: Boolean = true) {
    try {
      val mtu = params.mtu
      val wire = ArrayList<ByteArray>(frames.size)
      for ((index, f) in frames.withIndex()) {
        // Bulk data (file upload chunks) is logged as one summary line, not as hex per frame.
        if (logFrames) {
          events.log(
            LogDirection.TX,
            packet.serviceId.toInt() and 0xFF,
            packet.commandId.toInt() and 0xFF,
            f.toHex(),
            if (frames.size > 1) "$label (frame ${index + 1}/${frames.size})" else label,
          )
        }
        splitToMtu(f, mtu, wire)
      }
      if (!logFrames) {
        events.log(
          LogDirection.TX,
          packet.serviceId.toInt() and 0xFF,
          packet.commandId.toInt() and 0xFF,
          null,
          "$label (${frames.size} frames, ${frames.sumOf { it.size }} bytes, hex not logged)",
        )
      }
      sink.write(wire)
    } catch (e: IOException) {
      throw WearException(ErrorCodes.DISCONNECTED, "$label: write failed: ${e.message}", e)
    }
  }

  /** Fails everything in flight and rejects new requests. Idempotent; the first cause wins. */
  fun close(cause: WearException) {
    val pending: List<Waiter>
    synchronized(lock) {
      if (closedBy != null) return
      closedBy = cause
      pending = ArrayList(waiters)
      waiters.clear()
      received = null
      frame = ByteArray(0)
    }
    for (w in pending) w.result.completeExceptionally(cause)
  }

  /**
   * Feeds a raw chunk from the socket; a direct port of ResponseManager.handleData(data, channel)
   * for a single channel, including the "concatenated packets" loop on [HuaweiPacket.getLeft].
   */
  fun onData(chunk: ByteArray) {
    synchronized(lock) {
      if (closedBy != null) return
      var data = chunk
      var left = 0
      do {
        if (left > 0) data = data.copyOfRange(data.size - left, data.size)
        frame += data

        val packet: HuaweiPacket = try {
          val existing = received
          if (existing == null) HuaweiPacket(params).parse(data) else existing.parse(data)
        } catch (e: Exception) {
          // GB catches only ParseException and drops the packet; anything else would leave the
          // reassembly buffer poisoned, so every failure resets it.
          events.log(LogDirection.ERROR, null, null, frame.toHex(), "Packet parse failed: ${e.message}")
          received = null
          frame = ByteArray(0)
          return
        }
        received = packet
        left = packet.left

        if (packet.complete) {
          val raw = frame.copyOf(frame.size - left)
          frame = ByteArray(0)
          dispatch(packet, raw)
          received = null
        } else if (left > 0) {
          // The tail belongs to the next frame and is fed again on the next iteration.
          frame = frame.copyOf(frame.size - left)
        }
      } while (left > 0)
    }
  }

  private fun dispatch(packet: HuaweiPacket, raw: ByteArray) {
    val service = packet.serviceId.toInt() and 0xFF
    val command = packet.commandId.toInt() and 0xFF
    val waiter = waiters.firstOrNull { it.serviceId == packet.serviceId && it.commandId == packet.commandId }
    val subscription = if (waiter != null) null else subscriptions.firstOrNull { it.serviceId == packet.serviceId && it.commandId == packet.commandId }
    if (waiter != null) {
      waiters.remove(waiter)
      events.log(LogDirection.RX, service, command, raw.toHex(), "response to ${waiter.label}")
      waiter.result.complete(packet)
    } else if (subscription != null) {
      events.log(LogDirection.RX, service, command, raw.toHex(), "pushed (${subscription.label})")
      try {
        subscription.handler(packet)
      } catch (e: Exception) {
        events.log(LogDirection.ERROR, service, command, null, "${subscription.label}: handler failed: ${e.message ?: e.javaClass.simpleName}")
      }
    } else {
      // The frame is encrypted on most commands; the decoded TLV is what a reader of the log needs.
      var decoded: HuaweiTLV? = null
      val tlv = try {
        packet.parseTlv()
        decoded = packet.tlv
        packet.tlv?.toString()
      } catch (e: Exception) {
        "undecodable: ${e.message}"
      }
      events.log(LogDirection.RX, service, command, raw.toHex(), "asynchronous (no pending request) tlv=$tlv")
      if (unhandledObservers.isNotEmpty()) {
        val bytes = try {
          decoded?.serialize()
        } catch (e: Exception) {
          null
        }
        for (observer in unhandledObservers.toList()) observer.onUnhandled(service, command, bytes, raw)
      }
    }
  }

  private fun removeWaiter(waiter: Waiter) {
    synchronized(lock) { waiters.remove(waiter) }
  }

  /** Request.doPerform: frames of `mtu` bytes or more are written in `mtu`-sized pieces. */
  private fun splitToMtu(frame: ByteArray, mtu: Int, into: MutableList<ByteArray>) {
    if (mtu <= 0 || frame.size < mtu) {
      into.add(frame)
      return
    }
    var offset = 0
    while (offset < frame.size) {
      val end = minOf(offset + mtu, frame.size)
      into.add(frame.copyOfRange(offset, end))
      offset = end
    }
  }
}

/** See [HuaweiSession.observeUnhandled]. */
internal fun interface UnhandledObserver {
  fun onUnhandled(service: Int, command: Int, tlv: ByteArray?, raw: ByteArray)
}
