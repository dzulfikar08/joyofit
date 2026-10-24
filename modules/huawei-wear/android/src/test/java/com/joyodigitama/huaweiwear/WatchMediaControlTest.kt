package com.joyodigitama.huaweiwear

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.util.Collections
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.MusicControl
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.MusicControl.Control.Response.Button
import nodomain.freeyourgadget.gadgetbridge.util.CheckSums
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class WatchMediaControlTest {
  private class Msg(val service: Int, val command: Int, val tlv: HuaweiTLV)

  private class Events : WearEvents {
    val logs: MutableList<String> = Collections.synchronizedList(ArrayList())
    override fun state(state: LinkState, error: String?) = Unit
    override fun battery(level: Int) = Unit
    override fun syncComplete(summary: SyncSummary) = Unit
    override fun log(direction: LogDirection, serviceId: Int?, commandId: Int?, hex: String?, message: String) {
      logs.add("${direction.wire}: $message")
    }
  }

  private class FakeWatch : FrameSink {
    lateinit var session: HuaweiSession
    val messages: MutableList<Msg> = Collections.synchronizedList(ArrayList())
    private var pending: ByteArrayOutputStream? = null
    private var pendingService = 0
    private var pendingCommand = 0

    override suspend fun write(frames: List<ByteArray>) {
      for (f in frames) {
        val body: ByteArray
        when (f[3].toInt()) {
          0 -> {
            pendingService = f[4].toInt() and 0xFF
            pendingCommand = f[5].toInt() and 0xFF
            body = f.copyOfRange(6, f.size - 2)
          }
          1 -> {
            pendingService = f[5].toInt() and 0xFF
            pendingCommand = f[6].toInt() and 0xFF
            pending = ByteArrayOutputStream().also { it.write(f, 7, f.size - 9) }
            continue
          }
          2 -> {
            pending!!.write(f, 5, f.size - 7)
            continue
          }
          else -> {
            pending!!.write(f, 5, f.size - 7)
            body = pending!!.toByteArray()
            pending = null
          }
        }
        val tlv = HuaweiTLV().parse(body, 0, body.size)
        if (tlv.contains(0x7C)) tlv.decrypt(session.params)
        messages.add(Msg(pendingService, pendingCommand, tlv))
      }
    }

    fun all(service: Int, command: Int): List<Msg> =
      synchronized(messages) { messages.filter { it.service == service && it.command == command } }
  }

  private class FakeMediaBridge(
    @Volatile var current: MediaTrackInfo = MediaTrackInfo("Hindia", "Evaluasi", 3, 15, 8),
  ) : MediaBridge {
    val buttons: MutableList<Button> = Collections.synchronizedList(ArrayList())
    val volumes: MutableList<Int> = Collections.synchronizedList(ArrayList())
    @Volatile var attachedCallback: (() -> Unit)? = null
    @Volatile var detachedCount = 0

    override fun snapshot(): MediaTrackInfo = current

    override fun onButton(button: Button): Boolean {
      buttons.add(button)
      when (button) {
        Button.Play -> current = current.copy(playState = 3)
        Button.Pause -> current = current.copy(playState = 2)
        Button.Next -> current = current.copy(track = "Secukupnya", playState = 3)
        Button.Previous -> current = current.copy(track = "Membasuh", playState = 3)
        Button.Volume_up -> current = current.copy(currentVolume = (current.currentVolume + 1).toByte())
        Button.Volume_down -> current = current.copy(currentVolume = (current.currentVolume - 1).toByte())
        Button.Unknown -> return false
      }
      return true
    }

    override fun setVolume(rawVolume: Byte): Boolean {
      val valid = MediaControlCodec.validWatchVolume(rawVolume, 0, current.maxVolume.toInt()) ?: return false
      volumes.add(valid)
      current = current.copy(currentVolume = valid.toByte())
      return true
    }

    override fun attachListeners(onChange: () -> Unit) {
      attachedCallback = onChange
    }

    override fun detachListeners() {
      attachedCallback = null
      detachedCount++
    }
  }

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
  private lateinit var events: Events
  private lateinit var watch: FakeWatch
  private lateinit var session: HuaweiSession
  private lateinit var bridge: FakeMediaBridge
  private lateinit var control: WatchMediaControl

  @Before
  fun setUp() {
    DeviceCaps.reset()
    events = Events()
    watch = FakeWatch()
    session = HuaweiSession(watch, events).also { it.params.setSecretKey(ByteArray(16)) }
    watch.session = session
    bridge = FakeMediaBridge()
    control = WatchMediaControl(
      bridge = bridge,
      sessionProvider = { session },
      events = events,
      scope = scope,
      settleDelayMs = 10L,
      debounceMs = 15L,
    )
  }

  @After
  fun tearDown() {
    control.onLinkState(LinkState.DISCONNECTED)
    scope.cancel()
    DeviceCaps.reset()
  }

  private fun frame(service: Int, command: Int, tlv: HuaweiTLV): ByteArray {
    val inner = byteArrayOf(service.toByte(), command.toByte()) + tlv.serialize()
    val head = ByteBuffer.allocate(4 + inner.size)
      .put(0x5A.toByte())
      .putShort((inner.size + 1).toShort())
      .put(0)
      .put(inner)
      .array()
    return head + ByteBuffer.allocate(2).putShort(CheckSums.getCRC16(head, 0x0000).toShort()).array()
  }

  private suspend fun awaitMessages(service: Int, command: Int, expectedCount: Int) {
    withTimeout(2_000) {
      while (watch.all(service, command).size < expectedCount) {
        delay(10)
      }
    }
  }

  @Test
  fun statusRequest2501SendsAckAndCurrentMusicInfo() = runBlocking {
    control.onLinkState(LinkState.CONNECTED)

    session.onData(frame(0x25, 0x01, HuaweiTLV().put(0x7F, MusicControl.successValue)))

    awaitMessages(0x25, 0x01, 1)
    awaitMessages(0x25, 0x02, 1)

    val ack = watch.all(0x25, 0x01).single().tlv
    assertEquals(MusicControl.successValue, ack.getInteger(0x7F))

    val info = watch.all(0x25, 0x02).single().tlv
    assertEquals("Hindia", info.getString(0x01))
    assertEquals("Evaluasi", info.getString(0x02))
    assertEquals(3.toByte(), info.getByte(0x03))
    assertEquals(15.toByte(), info.getByte(0x04))
    assertEquals(8.toByte(), info.getByte(0x05))
  }

  @Test
  fun statusRequest2501WithErrorStatusStopsWithoutAckOrPush() = runBlocking {
    control.onLinkState(LinkState.CONNECTED)

    session.onData(frame(0x25, 0x01, HuaweiTLV().put(0x7F, 0x000186AA)))
    delay(60)

    assertTrue(watch.all(0x25, 0x01).isEmpty())
    assertTrue(watch.all(0x25, 0x02).isEmpty())
  }

  @Test
  fun control2503DispatchesButtonsSendsAckAndRefreshesMusicInfo() = runBlocking {
    control.onLinkState(LinkState.CONNECTED)

    // 1. Pause (button = 2)
    session.onData(frame(0x25, 0x03, HuaweiTLV().put(0x01, 2.toByte())))
    awaitMessages(0x25, 0x03, 1)
    awaitMessages(0x25, 0x02, 1)
    assertEquals(listOf(Button.Pause), bridge.buttons)
    assertEquals(MusicControl.successValue, watch.all(0x25, 0x03)[0].tlv.getInteger(0x7F))
    assertEquals(2.toByte(), watch.all(0x25, 0x02)[0].tlv.getByte(0x03))

    // 2. Next track (button = 4)
    session.onData(frame(0x25, 0x03, HuaweiTLV().put(0x01, 4.toByte())))
    awaitMessages(0x25, 0x03, 2)
    awaitMessages(0x25, 0x02, 2)
    assertEquals(listOf(Button.Pause, Button.Next), bridge.buttons)
    assertEquals("Secukupnya", watch.all(0x25, 0x02)[1].tlv.getString(0x02))
    assertEquals(3.toByte(), watch.all(0x25, 0x02)[1].tlv.getByte(0x03))

    // 3. Volume up (button = 5)
    session.onData(frame(0x25, 0x03, HuaweiTLV().put(0x01, 5.toByte())))
    awaitMessages(0x25, 0x03, 3)
    awaitMessages(0x25, 0x02, 3)
    assertEquals(9.toByte(), watch.all(0x25, 0x02)[2].tlv.getByte(0x05))
  }

  @Test
  fun control2503HandlesVolumeSliderExitScreenAndAdversarialInputs() = runBlocking {
    control.onLinkState(LinkState.CONNECTED)

    // 1. Direct volume slider update on watch (tag 0x02 = 12) -> acks 0x000186A0 + pushes volume 12
    session.onData(frame(0x25, 0x03, HuaweiTLV().put(0x02, 12.toByte())))
    awaitMessages(0x25, 0x03, 1)
    awaitMessages(0x25, 0x02, 1)
    assertEquals(listOf(12), bridge.volumes)
    assertEquals(MusicControl.successValue, watch.all(0x25, 0x03)[0].tlv.getInteger(0x7F))
    assertEquals(12.toByte(), watch.all(0x25, 0x02)[0].tlv.getByte(0x05))

    // 2. Out-of-range volume byte (0xFF = 255 > maxVolume 15) -> acks 0 (error) and re-pushes true volume (12)
    session.onData(frame(0x25, 0x03, HuaweiTLV().put(0x02, 0xFF.toByte())))
    awaitMessages(0x25, 0x03, 2)
    awaitMessages(0x25, 0x02, 2)
    assertEquals(0, watch.all(0x25, 0x03)[1].tlv.getInteger(0x7F))
    assertEquals(12.toByte(), watch.all(0x25, 0x02)[1].tlv.getByte(0x05))

    // 3. Exit screen (tag 0x01 = 100) and unknown button (0xFF) -> ignored without ack spam
    session.onData(frame(0x25, 0x03, HuaweiTLV().put(0x01, 100.toByte())))
    session.onData(frame(0x25, 0x03, HuaweiTLV().put(0x01, 0xFF.toByte())))
    delay(50)
    assertEquals(2, watch.all(0x25, 0x03).size)
  }

  @Test
  fun phoneMediaChangesPushDebouncedAndDeduplicate() = runBlocking {
    DeviceCaps.supportedCommands = mapOf(0x25 to byteArrayOf(0x02))
    control.onLinkState(LinkState.CONNECTED)

    awaitMessages(0x25, 0x02, 1)
    assertEquals("Evaluasi", watch.all(0x25, 0x02)[0].tlv.getString(0x02))

    bridge.attachedCallback?.invoke()
    delay(50)
    assertEquals(1, watch.all(0x25, 0x02).size)

    bridge.current = bridge.current.copy(artist = "Tulus", track = "Hati-Hati di Jalan")
    bridge.attachedCallback?.invoke()
    bridge.attachedCallback?.invoke()
    awaitMessages(0x25, 0x02, 2)
    delay(40)
    assertEquals(2, watch.all(0x25, 0x02).size)
    assertEquals("Tulus", watch.all(0x25, 0x02)[1].tlv.getString(0x01))
    assertEquals("Hati-Hati di Jalan", watch.all(0x25, 0x02)[1].tlv.getString(0x02))
  }

  @Test
  fun disconnectInvalidatesStateAndDetachesListeners() = runBlocking {
    DeviceCaps.supportedCommands = mapOf(0x25 to byteArrayOf(0x02))
    control.onLinkState(LinkState.CONNECTED)
    awaitMessages(0x25, 0x02, 1)

    control.onLinkState(LinkState.DISCONNECTED)
    assertNull(bridge.attachedCallback)
    assertTrue(bridge.detachedCount >= 1)

    control.onLinkState(LinkState.CONNECTED)
    awaitMessages(0x25, 0x02, 2)
    assertEquals(2, watch.all(0x25, 0x02).size)
  }
}
