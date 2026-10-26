package com.joyodigitama.huaweiwear

import java.nio.ByteBuffer
import java.util.Collections
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.yield
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.DeviceConfig
import nodomain.freeyourgadget.gadgetbridge.util.CheckSums
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HuaweiSessionTest {
  private class RecordingSink : FrameSink {
    val written: MutableList<ByteArray> = Collections.synchronizedList(ArrayList())
    override suspend fun write(frames: List<ByteArray>) {
      written.addAll(frames)
    }
  }

  private class RecordingEvents : WearEvents {
    val logs: MutableList<Pair<LogDirection, String>> = Collections.synchronizedList(ArrayList())
    override fun state(state: LinkState, error: String?) = Unit
    override fun battery(level: Int) = Unit
    override fun syncComplete(summary: SyncSummary) = Unit
    override fun log(direction: LogDirection, serviceId: Int?, commandId: Int?, hex: String?, message: String) {
      logs.add(direction to message)
    }
  }

  /** Unsliced, unencrypted BatteryLevel (01/08) response carrying TLV 01:[level]. */
  private fun batteryFrame(level: Int): ByteArray {
    val body = byteArrayOf(0x01, 0x08, 0x01, 0x01, level.toByte())
    val head = ByteBuffer.allocate(4 + body.size)
      .put(0x5A.toByte())
      .putShort((body.size + 1).toShort())
      .put(0x00)
      .put(body)
      .array()
    val crc = CheckSums.getCRC16(head, 0x0000)
    return ByteBuffer.allocate(head.size + 2).put(head).putShort(crc.toShort()).array()
  }

  /** Post-auth session: requests are encrypted with a (zero) secret key like GB's packet tests. */
  private fun session(sink: FrameSink, events: WearEvents) =
    HuaweiSession(sink, events).also { it.params.setSecretKey(ByteArray(16)) }

  private suspend fun awaitWrites(sink: RecordingSink, count: Int) {
    withTimeout(2_000) { while (sink.written.size < count) yield() }
  }

  private suspend fun HuaweiSession.battery(): Int {
    val response = request(DeviceConfig.BatteryLevel.Request(params), 2_000, "BatteryLevel")
      .expect<DeviceConfig.BatteryLevel.Response>("BatteryLevel")
    return response.level.toInt() and 0xFF
  }

  @Test
  fun concatenatedResponsesCompletePendingRequestsInOrder() = runBlocking {
    val sink = RecordingSink()
    val session = session(sink, RecordingEvents())

    val first = async { session.battery() }
    awaitWrites(sink, 1)
    val second = async { session.battery() }
    awaitWrites(sink, 2)

    session.onData(batteryFrame(0x11) + batteryFrame(0xC8))

    assertEquals(0x11, first.await())
    assertEquals(0xC8, second.await())
  }

  @Test
  fun responseSplitAcrossReadsIsReassembled() = runBlocking {
    val sink = RecordingSink()
    val session = session(sink, RecordingEvents())

    val pending = async { session.battery() }
    awaitWrites(sink, 1)

    val frame = batteryFrame(0x42)
    session.onData(frame.copyOfRange(0, 3))
    session.onData(frame.copyOfRange(3, 7))
    session.onData(frame.copyOfRange(7, frame.size))

    assertEquals(0x42, pending.await())
  }

  @Test
  fun corruptFrameIsDroppedAndNextFrameStillParses() = runBlocking {
    val sink = RecordingSink()
    val events = RecordingEvents()
    val session = session(sink, events)

    val pending = async { session.battery() }
    awaitWrites(sink, 1)

    val corrupt = batteryFrame(0x01).also { it[it.size - 1] = (it[it.size - 1].toInt() xor 0xFF).toByte() }
    session.onData(corrupt)
    session.onData(batteryFrame(0x63))

    assertEquals(0x63, pending.await())
    assertTrue(events.logs.any { it.first == LogDirection.ERROR })
  }

  @Test
  fun unsolicitedPacketIsLoggedNotDelivered() = runBlocking {
    val sink = RecordingSink()
    val events = RecordingEvents()
    val session = session(sink, events)

    session.onData(batteryFrame(0x50))
    val pending = async { session.battery() }
    awaitWrites(sink, 1)
    session.onData(batteryFrame(0x51))

    assertEquals(0x51, pending.await())
    assertTrue(events.logs.any { it.first == LogDirection.RX && it.second.startsWith("asynchronous") })
  }

  @Test
  fun unhandledObserverHearsOnlyPacketsNobodyTakesUntilClosed() = runBlocking {
    val sink = RecordingSink()
    val session = session(sink, RecordingEvents())
    val heard = Collections.synchronizedList(ArrayList<String>())
    val handle = session.observeUnhandled { service, command, tlv, raw -> heard += "%02x/%02x ${tlv?.toHex()} ${raw.size}".format(service, command) }

    session.onData(batteryFrame(0x50))
    val pending = async { session.battery() }
    awaitWrites(sink, 1)
    session.onData(batteryFrame(0x51))
    assertEquals(0x51, pending.await())
    handle.close()
    session.onData(batteryFrame(0x52))

    assertEquals(listOf("01/08 010150 11"), heard.toList())
  }
}
