package com.joyodigitama.huaweiwear

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.util.CheckSums
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * The 0x1F / 0x1C exchange against a fake watch that plays the watch's side step by step (GB `HuaweiEphemerisManager` flow),
 * with a fake source and an in-memory store. Timings are shortened; nothing here touches the network.
 */
class AgpsExchangeTest {
  private class Msg(val service: Int, val command: Int, val tlv: HuaweiTLV?, val payload: ByteArray)

  private class Events : WearEvents {
    val logs: MutableList<String> = Collections.synchronizedList(ArrayList())
    override fun state(state: LinkState, error: String?) = Unit
    override fun battery(level: Int) = Unit
    override fun syncComplete(summary: SyncSummary) = Unit
    override fun log(direction: LogDirection, serviceId: Int?, commandId: Int?, hex: String?, message: String) {
      logs.add("${direction.wire}: $message")
    }
  }

  /** Records what the phone writes, reassembling sliced packets; chunk frames (1C/05) are `index + bytes` after decryption. */
  private class Watch : FrameSink {
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
        val msg = if (pendingService == 0x1C && pendingCommand == 0x05) {
          Msg(pendingService, pendingCommand, null, HuaweiTLV().parse(body).decryptRaw(session.params))
        } else {
          val tlv = HuaweiTLV().parse(body, 0, body.size)
          if (tlv.contains(0x7C)) tlv.decrypt(session.params)
          Msg(pendingService, pendingCommand, tlv, body)
        }
        messages.add(msg)
      }
    }

    fun all(service: Int, command: Int) = synchronized(messages) { messages.filter { it.service == service && it.command == command } }
  }

  private class FakeSource(val files: Map<String, ByteArray>, val outcome: String = AgpsOutcome.NONE, val gate: CountDownLatch? = null) : AgpsSource {
    var calls = 0
    val forces = ArrayList<Boolean>()
    override fun fetch(consult: AgpsConsult, force: Boolean): AgpsFetch {
      calls++
      forces.add(force)
      gate?.await(5, TimeUnit.SECONDS)
      return if (files.isNotEmpty()) AgpsFetch(files, AgpsSources.BROADCOM, 1_000L, AgpsOutcome.NONE, "") else AgpsFetch.failed(outcome, "fake $outcome")
    }
  }

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
  private lateinit var watch: Watch
  private lateinit var session: HuaweiSession
  private lateinit var events: Events
  private lateinit var store: AgpsStore
  private var exchange: AgpsExchange? = null

  @Before
  fun setUp() {
    events = Events()
    watch = Watch()
    session = HuaweiSession(watch, events).also { it.params.setSecretKey(ByteArray(16)) }
    watch.session = session
    store = AgpsStore(MemoryPrefs())
  }

  @After
  fun tearDown() {
    exchange?.stop()
    scope.cancel()
    DeviceCaps.reset()
  }

  private fun start(source: AgpsSource, online: Boolean = true, timing: AgpsTiming = AgpsTiming(downloadTimeoutMs = 5_000, pullWaitMs = 600, stallMs = 600, probeAskMs = 600, probeTransferMs = 3_000)): AgpsExchange {
    val ex = AgpsExchange(session, "AA:BB:CC:DD:EE:FF", events, scope, source, store, { online }, timing = timing)
    ex.start()
    exchange = ex
    return ex
  }

  private fun frame(service: Int, command: Int, tlv: HuaweiTLV): ByteArray {
    val inner = byteArrayOf(service.toByte(), command.toByte()) + tlv.serialize()
    val head = ByteBuffer.allocate(4 + inner.size).put(0x5A.toByte()).putShort((inner.size + 1).toShort()).put(0).put(inner).array()
    return head + ByteBuffer.allocate(2).putShort(CheckSums.getCRC16(head, 0x0000).toShort()).array()
  }

  private fun fromWatch(service: Int, command: Int, tlv: HuaweiTLV) = session.onData(frame(service, command, tlv))

  private fun await(service: Int, command: Int, count: Int = 1): Msg = runBlocking {
    withTimeout(5_000) {
      while (watch.all(service, command).size < count) delay(10)
      watch.all(service, command)[count - 1]
    }
  }

  private fun waitFor(what: String, condition: () -> Boolean) = runBlocking {
    withTimeout(5_000) {
      while (!condition()) delay(10)
    }
  }

  private fun ltoFile(size: Int = 2000) = ByteArray(size) { (it * 13).toByte() }.also {
    it[0] = 0xFF.toByte()
    it[1] = 0xCA.toByte()
    it[2] = 0xDE.toByte()
  }

  private fun op1() = fromWatch(0x1F, 0x01, HuaweiTLV().put(0x81, HuaweiTLV().put(0x02, 1.toByte()).put(0x03, 1000)))

  private fun consult(version: Int, tag: String = "") =
    fromWatch(0x1F, 0x02, HuaweiTLV().put(0x81, HuaweiTLV().put(0x04, 5).put(0x05, version.toByte()).put(0x06, tag)))

  private fun fileConsult(transferSize: Int, maxData: Int, type: Int = 1) =
    fromWatch(0x1C, 0x02, HuaweiTLV().put(0x01, "1.0").put(0x03, transferSize).put(0x04, maxData).put(0x06, type.toByte()))

  /** Drives the whole pull of one file as the watch does (after any earlier pulls in the same test), returning the bytes it received. */
  private fun pull(name: String, size: Int, maxData: Int, transferSize: Int): ByteArray {
    val lists = watch.all(0x1C, 0x01).size
    val consults = watch.all(0x1C, 0x02).size
    val infos = watch.all(0x1C, 0x03).size
    fromWatch(0x1C, 0x01, HuaweiTLV().put(0x02, 1.toByte()).put(0x03, "p"))
    await(0x1C, 0x01, lists + 1)
    fileConsult(transferSize, maxData)
    await(0x1C, 0x02, consults + 1)
    fromWatch(0x1C, 0x03, HuaweiTLV().put(0x01, name))
    await(0x1C, 0x03, infos + 1)
    val received = ByteArray(size)
    var offset = 0
    var requests = watch.all(0x1C, 0x04).size
    var frames = watch.all(0x1C, 0x05).size
    while (offset < size) {
      fromWatch(0x1C, 0x04, HuaweiTLV().put(0x01, name).put(0x02, offset).put(0x03, minOf(maxData, size - offset)))
      requests++
      val answer = await(0x1C, 0x04, requests)
      assertEquals(100000, answer.tlv!!.getInteger(0x7F))
      val chunk = minOf(maxData, size - offset)
      val expectedFrames = (chunk + transferSize - 1) / transferSize
      waitFor("frames") { watch.all(0x1C, 0x05).size >= frames + expectedFrames }
      val all = watch.all(0x1C, 0x05)
      for (i in 0 until expectedFrames) {
        val payload = all[frames + i].payload
        assertEquals("frame index", i, payload[0].toInt() and 0xFF)
        System.arraycopy(payload, 1, received, offset + i * transferSize, payload.size - 1)
      }
      frames += expectedFrames
      offset += chunk
    }
    return received
  }

  @Test
  fun theWatchAsksAndGetsTheFileAndTheDeliveryIsRecorded() {
    val file = ltoFile(2000)
    start(FakeSource(mapOf(AgpsSources.LTO_FILE to file)))

    op1()
    assertEquals(100000, await(0x1F, 0x01).tlv!!.getInteger(0x7F))
    await(0x1F, 0x02)
    consult(0)
    assertEquals(3, await(0x1F, 0x03).tlv!!.getByte(0x01).toInt())

    fromWatch(0x1C, 0x01, HuaweiTLV().put(0x02, 1.toByte()))
    assertEquals(AgpsSources.LTO_FILE, await(0x1C, 0x01).tlv!!.getString(0x01))

    fileConsult(transferSize = 100, maxData = 700)
    assertEquals(100000, await(0x1C, 0x02).tlv!!.getInteger(0x7F))

    fromWatch(0x1C, 0x03, HuaweiTLV().put(0x01, AgpsSources.LTO_FILE))
    val info = await(0x1C, 0x03).tlv!!
    assertEquals(2000, info.getInteger(0x02))
    assertEquals(CheckSums.getCRC16(file, 0x0000).toShort(), info.getShort(0x03))

    var received = ByteArray(0)
    var offset = 0
    var requests = 0
    var frames = 0
    while (offset < 2000) {
      fromWatch(0x1C, 0x04, HuaweiTLV().put(0x01, AgpsSources.LTO_FILE).put(0x02, offset).put(0x03, 700))
      requests++
      val answer = await(0x1C, 0x04, requests).tlv!!
      assertEquals(EphemerisNet.addressDigest("AA:BB:CC:DD:EE:FF") + AgpsSources.LTO_FILE, answer.getString(0x02))
      assertEquals(offset, answer.getInteger(0x03))
      val chunk = minOf(700, 2000 - offset)
      val count = (chunk + 99) / 100
      waitFor("frames") { watch.all(0x1C, 0x05).size >= frames + count }
      for (i in 0 until count) received += watch.all(0x1C, 0x05)[frames + i].payload.copyOfRange(1, watch.all(0x1C, 0x05)[frames + i].payload.size)
      frames += count
      offset += chunk
    }
    assertArrayEquals(file, received)
    assertEquals(3, requests)

    fromWatch(0x1C, 0x06, HuaweiTLV().put(0x01, 0.toByte()))
    assertEquals(100000, await(0x1C, 0x06).tlv!!.getInteger(0x7F))
    waitFor("delivery recorded") { store.deliveredAtMs > 0 }
    assertEquals(2000, store.deliveredSize)
    assertEquals(AgpsSources.BROADCOM, store.deliveredSource)
    assertEquals("AA:BB:CC:DD:EE:FF", store.deliveredAddress)
    assertEquals(AgpsOutcome.DELIVERED, store.lastOutcome)
    assertEquals(0, store.lastAskVersion)
    assertTrue(store.cachedAtMs > 0)
    assertFalse("the exchange is over", exchange!!.busy)
  }

  @Test
  fun aLargerFileIsPulledInSeveralDataRequests() {
    val file = ltoFile(5000)
    start(FakeSource(mapOf(AgpsSources.LTO_FILE to file)))
    op1()
    await(0x1F, 0x02)
    consult(0)
    await(0x1F, 0x03)
    val received = pull(AgpsSources.LTO_FILE, 5000, maxData = 2048, transferSize = 232)
    assertArrayEquals(file, received)
  }

  @Test
  fun withoutNetworkTheWatchIsToldAndNothingIsStartedOrCounted() {
    val source = FakeSource(emptyMap())
    start(source, online = false)
    op1()
    assertEquals(100007, await(0x1F, 0x01).tlv!!.getInteger(0x7F))
    assertTrue(watch.all(0x1F, 0x02).isEmpty())
    assertEquals(0, source.calls)
    assertEquals(AgpsOutcome.NO_NETWORK, store.lastOutcome)
    assertEquals(0, store.failures)
    assertFalse(exchange!!.busy)
  }

  @Test
  fun aFailedDownloadTellsTheWatchFailedAndTheNextAskWaitsForTheRetryWindow() {
    val source = FakeSource(emptyMap(), AgpsOutcome.DOWNLOAD_FAILED)
    start(source)
    op1()
    await(0x1F, 0x02)
    consult(0)
    assertEquals(4, await(0x1F, 0x03).tlv!!.getByte(0x01).toInt())
    assertEquals(AgpsOutcome.DOWNLOAD_FAILED, store.lastOutcome)
    assertEquals(1, store.failures)
    assertEquals(1, source.calls)

    // The watch asks again at once: answered "failed" without another download, and the failure count does not grow.
    op1()
    await(0x1F, 0x02, 2)
    consult(0)
    assertEquals(4, await(0x1F, 0x03, 2).tlv!!.getByte(0x01).toInt())
    assertEquals(1, source.calls)
    assertEquals(1, store.failures)
  }

  @Test
  fun aKindOnlyTheWatchMakersAppPreparesIsAnsweredFailedAndTheAskIsRecordedWithTagNamesOnly() {
    val store = this.store
    val real = NetworkAgpsSource(object : AgpsCache {
      override fun read(url: String, maxAgeMs: Long): ByteArray? = null
      override fun write(url: String, data: ByteArray) = Unit
      override fun delete(url: String) = Unit
    }, store, { }, { true })
    start(real)
    op1()
    await(0x1F, 0x02)
    consult(3, "secret/path/HW_PGNSS_PRED")
    assertEquals(4, await(0x1F, 0x03).tlv!!.getByte(0x01).toInt())
    assertEquals(AgpsOutcome.UNSUPPORTED, store.lastOutcome)
    assertEquals(3, store.lastAskVersion)
    assertEquals("HW_PGNSS_PRED", store.lastAskTags)
    assertEquals("a refused kind is not a download failure", 0, store.failures)
    assertTrue(events.logs.none { it.contains("secret/path") })
    assertTrue("no file is offered afterwards", watch.all(0x1C, 0x01).isEmpty())
    fromWatch(0x1C, 0x01, HuaweiTLV().put(0x02, 1.toByte()))
    assertEquals(100001, await(0x1C, 0x01).tlv!!.getInteger(0x7F))
  }

  @Test
  fun aWatchThatAnswersThePhoneStartedQuestionWithAnErrorEndsItWithoutAnyStatus() = runBlocking {
    val ex = start(FakeSource(mapOf(AgpsSources.LTO_FILE to ltoFile())))
    val outcome = scope.async { ex.probe(force = true) }
    await(0x1F, 0x02)
    // What the Fit 4 Pro answers when it has no request open: 7f 118001, no 0x81 container.
    fromWatch(0x1F, 0x02, HuaweiTLV().put(0x7F, 118001))
    assertEquals(AgpsOutcome.WATCH_REFUSED, withTimeout(5_000) { outcome.await() })
    assertTrue(store.lastError.contains("118001"))
    assertTrue("nothing was started, so no status is sent", watch.all(0x1F, 0x03).isEmpty())
    assertFalse(ex.busy)
  }

  @Test
  fun anUnknownVersionIsAnsweredUnsupported() {
    start(FakeSource(emptyMap(), AgpsOutcome.UNSUPPORTED))
    op1()
    await(0x1F, 0x02)
    consult(9)
    assertEquals(5, await(0x1F, 0x03).tlv!!.getByte(0x01).toInt())
  }

  @Test
  fun theProgressPollIsAnsweredWithTheStateAndIgnoredWithoutARequest() {
    val gate = CountDownLatch(1)
    start(FakeSource(mapOf(AgpsSources.LTO_FILE to ltoFile()), gate = gate))
    fromWatch(0x1F, 0x01, HuaweiTLV().put(0x81, HuaweiTLV().put(0x02, 2.toByte()).put(0x03, 1000)))
    Thread.sleep(150)
    assertTrue("no request running: no answer", watch.all(0x1F, 0x01).isEmpty())

    op1()
    await(0x1F, 0x01)
    await(0x1F, 0x02)
    consult(0)
    waitFor("downloading") { exchange!!.phase == "downloading" }
    fromWatch(0x1F, 0x01, HuaweiTLV().put(0x81, HuaweiTLV().put(0x02, 2.toByte()).put(0x03, 1000)))
    val progress = await(0x1F, 0x01, 2).tlv!!.getObject(0x81)
    assertEquals(2, progress.getByte(0x02).toInt())
    assertEquals(2, progress.getByte(0x04).toInt())
    gate.countDown()
    await(0x1F, 0x03)
  }

  @Test
  fun aFileConsultWithNothingToSendOrWithAbsurdSizesIsRefused() {
    start(FakeSource(mapOf(AgpsSources.LTO_FILE to ltoFile())))
    // No request running yet: the list is refused.
    fromWatch(0x1C, 0x01, HuaweiTLV().put(0x02, 1.toByte()))
    assertEquals(100001, await(0x1C, 0x01).tlv!!.getInteger(0x7F))
    fileConsult(0, 100)
    assertEquals(100001, await(0x1C, 0x02).tlv!!.getInteger(0x7F))
    fileConsult(100, 0)
    assertEquals(100001, await(0x1C, 0x02, 2).tlv!!.getInteger(0x7F))
  }

  @Test
  fun aDataRequestThatWouldNeedTooManyFramesOrNamesAnotherFileIsRefused() {
    start(FakeSource(mapOf(AgpsSources.LTO_FILE to ltoFile(100_000))))
    op1()
    await(0x1F, 0x02)
    consult(0)
    await(0x1F, 0x03)
    fromWatch(0x1C, 0x01, HuaweiTLV().put(0x02, 1.toByte()))
    await(0x1C, 0x01)
    // One byte per frame of 100000 bytes is more than the frame cap allows.
    fileConsult(transferSize = 1, maxData = 100_000)
    await(0x1C, 0x02)
    fromWatch(0x1C, 0x03, HuaweiTLV().put(0x01, AgpsSources.LTO_FILE))
    await(0x1C, 0x03)
    fromWatch(0x1C, 0x04, HuaweiTLV().put(0x01, AgpsSources.LTO_FILE).put(0x02, 0).put(0x03, 100_000))
    assertEquals(100001, await(0x1C, 0x04).tlv!!.getInteger(0x7F))
    assertTrue(watch.all(0x1C, 0x05).isEmpty())
    // The refusal ended that transfer: the next request is refused too.
    fromWatch(0x1C, 0x04, HuaweiTLV().put(0x01, AgpsSources.LTO_FILE).put(0x02, 0).put(0x03, 10))
    assertEquals(100001, await(0x1C, 0x04, 2).tlv!!.getInteger(0x7F))
  }

  @Test
  fun aDataRequestForAnotherNameOrBeyondTheEndIsRefused() {
    start(FakeSource(mapOf(AgpsSources.LTO_FILE to ltoFile(1000))))
    op1()
    await(0x1F, 0x02)
    consult(0)
    await(0x1F, 0x03)
    fileConsult(100, 500)
    await(0x1C, 0x02)
    fromWatch(0x1C, 0x03, HuaweiTLV().put(0x01, "nope.dat"))
    assertEquals(100001, await(0x1C, 0x03).tlv!!.getInteger(0x7F))
    fileConsult(100, 500)
    await(0x1C, 0x02, 2)
    fromWatch(0x1C, 0x03, HuaweiTLV().put(0x01, AgpsSources.LTO_FILE))
    await(0x1C, 0x03, 2)
    fromWatch(0x1C, 0x04, HuaweiTLV().put(0x01, AgpsSources.LTO_FILE).put(0x02, 1001).put(0x03, 10))
    assertEquals(100001, await(0x1C, 0x04).tlv!!.getInteger(0x7F))
  }

  @Test
  fun aTransferThatGoesSilentIsDroppedAndRecordedAsTimedOut() {
    start(FakeSource(mapOf(AgpsSources.LTO_FILE to ltoFile(1000))))
    op1()
    await(0x1F, 0x02)
    consult(0)
    await(0x1F, 0x03)
    fileConsult(100, 500)
    await(0x1C, 0x02)
    fromWatch(0x1C, 0x03, HuaweiTLV().put(0x01, AgpsSources.LTO_FILE))
    await(0x1C, 0x03)
    // The watch says nothing more; after the stall time the request is dropped.
    waitFor("timeout recorded") { store.lastOutcome == AgpsOutcome.TIMEOUT }
    assertFalse(exchange!!.busy)
    fromWatch(0x1C, 0x04, HuaweiTLV().put(0x01, AgpsSources.LTO_FILE).put(0x02, 0).put(0x03, 100))
    assertEquals("nothing is sent into a dropped transfer", 100001, await(0x1C, 0x04).tlv!!.getInteger(0x7F))
    assertTrue(watch.all(0x1C, 0x05).isEmpty())
    assertEquals(0L, store.deliveredAtMs)
  }

  @Test
  fun aReadyFileTheWatchNeverCollectsIsDropped() {
    start(FakeSource(mapOf(AgpsSources.LTO_FILE to ltoFile())))
    op1()
    await(0x1F, 0x02)
    consult(0)
    await(0x1F, 0x03)
    waitFor("pull wait expired") { store.lastOutcome == AgpsOutcome.WATCH_SILENT }
    assertFalse(exchange!!.busy)
    fromWatch(0x1C, 0x01, HuaweiTLV().put(0x02, 1.toByte()))
    assertEquals("the dropped file is no longer offered", 100001, await(0x1C, 0x01).tlv!!.getInteger(0x7F))
  }

  @Test
  fun aTransferClosedBeforeTheEndIsNotADelivery() {
    start(FakeSource(mapOf(AgpsSources.LTO_FILE to ltoFile(1000))))
    op1()
    await(0x1F, 0x02)
    consult(0)
    await(0x1F, 0x03)
    fileConsult(100, 300)
    await(0x1C, 0x02)
    fromWatch(0x1C, 0x03, HuaweiTLV().put(0x01, AgpsSources.LTO_FILE))
    await(0x1C, 0x03)
    fromWatch(0x1C, 0x04, HuaweiTLV().put(0x01, AgpsSources.LTO_FILE).put(0x02, 0).put(0x03, 300))
    await(0x1C, 0x04)
    waitFor("frames") { watch.all(0x1C, 0x05).size == 3 }
    fromWatch(0x1C, 0x06, HuaweiTLV().put(0x01, 1.toByte()))
    assertEquals(100000, await(0x1C, 0x06).tlv!!.getInteger(0x7F))
    waitFor("outcome") { store.lastOutcome == AgpsOutcome.WATCH_REFUSED }
    assertEquals(0L, store.deliveredAtMs)
  }

  @Test
  fun aNewOperatorRequestStartsOverAndClearsWhatWasReady() {
    val source = FakeSource(mapOf(AgpsSources.LTO_FILE to ltoFile()))
    start(source)
    op1()
    await(0x1F, 0x02)
    consult(0)
    await(0x1F, 0x03)
    op1()
    await(0x1F, 0x02, 2)
    fromWatch(0x1C, 0x01, HuaweiTLV().put(0x02, 1.toByte()))
    assertEquals("cleared until the new download is ready", 100001, await(0x1C, 0x01).tlv!!.getInteger(0x7F))
  }

  @Test
  fun aPhoneStartedUpdateAsksTheWatchAndCarriesOnWhenItAnswers() = runBlocking {
    val file = ltoFile(1500)
    val source = FakeSource(mapOf(AgpsSources.LTO_FILE to file))
    val ex = start(source)
    val outcome = scope.async { ex.probe(force = true) }
    await(0x1F, 0x02)
    assertTrue("no operator answer is sent for a phone-started request", watch.all(0x1F, 0x01).isEmpty())
    consult(0)
    assertEquals(3, await(0x1F, 0x03).tlv!!.getByte(0x01).toInt())
    assertEquals(listOf(true), source.forces)
    assertArrayEquals(file, pull(AgpsSources.LTO_FILE, 1500, maxData = 800, transferSize = 100))
    fromWatch(0x1C, 0x06, HuaweiTLV().put(0x01, 0.toByte()))
    assertEquals(AgpsOutcome.DELIVERED, withTimeout(5_000) { outcome.await() })
  }

  @Test
  fun aPhoneStartedUpdateTheWatchIgnoresEndsAsSilentAndLeavesNothingRunning() = runBlocking {
    val ex = start(FakeSource(mapOf(AgpsSources.LTO_FILE to ltoFile())))
    assertEquals(AgpsOutcome.WATCH_SILENT, withTimeout(5_000) { ex.probe(force = false) })
    assertFalse(ex.busy)
    assertEquals("idle", ex.phase)
  }

  @Test
  fun aSecondPhoneStartedUpdateWhileOneRunsIsBusy() = runBlocking {
    val ex = start(FakeSource(mapOf(AgpsSources.LTO_FILE to ltoFile())))
    val first = scope.async { ex.probe(force = false) }
    await(0x1F, 0x02)
    assertEquals(AgpsOutcome.BUSY, ex.probe(force = false))
    assertEquals(AgpsOutcome.WATCH_SILENT, withTimeout(5_000) { first.await() })
  }

  @Test
  fun cancellingDuringTheDownloadTellsTheWatchFailedAndDropsTheRequest() = runBlocking {
    val gate = CountDownLatch(1)
    val ex = start(FakeSource(mapOf(AgpsSources.LTO_FILE to ltoFile()), gate = gate))
    val outcome = scope.async { ex.probe(force = true) }
    await(0x1F, 0x02)
    consult(0)
    waitFor("downloading") { ex.phase == "downloading" }
    ex.cancel()
    assertEquals(4, await(0x1F, 0x03).tlv!!.getByte(0x01).toInt())
    assertEquals(AgpsOutcome.CANCELLED, withTimeout(5_000) { outcome.await() })
    assertEquals(AgpsOutcome.CANCELLED, store.lastOutcome)
    assertFalse(ex.busy)
    gate.countDown()
    delay(100)
    assertEquals("no 'ready' follows a cancelled download", 1, watch.all(0x1F, 0x03).size)
  }

  @Test
  fun stoppingTheExchangeEndsAWaitingUpdateAsLinkLost() = runBlocking {
    val ex = start(FakeSource(mapOf(AgpsSources.LTO_FILE to ltoFile())), timing = AgpsTiming(probeAskMs = 5_000))
    val outcome = scope.async { ex.probe(force = false) }
    await(0x1F, 0x02)
    ex.stop()
    assertEquals(AgpsOutcome.LINK_LOST, withTimeout(5_000) { outcome.await() })
    assertEquals(AgpsOutcome.LINK_LOST, store.lastOutcome)
  }

  // The experimental HW_AGNSS path (AgpsLab)

  private object NoCache : AgpsCache {
    override fun read(url: String, maxAgeMs: Long): ByteArray? = null
    override fun write(url: String, data: ByteArray) = Unit
    override fun delete(url: String) = Unit
  }

  /** The real source with the HTTP side faked: [answer] gets the URL asked for. */
  private fun labSource(answer: (String) -> AgpsDownload) = NetworkAgpsSource(NoCache, store, { }, { true }, http = { url, _ -> answer(url) })

  /** The Fit 4 Pro's consult tag from the 2026-10-25 capture. */
  private val hwAgnssTag = "higeo/v1/gnssinfo?type=0x0024/HW_AGNSS"

  private fun hex(tlv: HuaweiTLV) = tlv.serialize().joinToString("") { "%02x".format(it) }

  @Test
  fun withTheLabSwitchOffAHwAgnssAskIsDeclinedWithTodaysBytesAndNoDownload() {
    assertFalse("off by default", store.labAgnss)
    start(labSource { throw AssertionError("the network must not be used") })
    op1()
    await(0x1F, 0x02)
    consult(3, hwAgnssTag)
    await(0x1F, 0x03)
    fromWatch(0x1C, 0x01, HuaweiTLV().put(0x02, 1.toByte()))
    await(0x1C, 0x01)
    val sent = synchronized(watch.messages) { watch.messages.map { Triple(it.service, it.command, hex(it.tlv!!)) } }
    assertEquals(
      listOf(
        Triple(0x1F, 0x01, hex(AgpsMessages.operatorAnswer(AgpsMessages.CODE_OK))),
        Triple(0x1F, 0x02, hex(AgpsMessages.parameterConsult())),
        Triple(0x1F, 0x03, hex(AgpsMessages.fileStatus(AgpsMessages.STATE_FAILED))),
        Triple(0x1C, 0x01, hex(AgpsMessages.refused())),
      ),
      sent,
    )
    assertEquals(AgpsOutcome.UNSUPPORTED, store.lastOutcome)
    assertEquals("the watch asked for kinds only the watch maker's app prepares (version 3: HW_AGNSS)", store.lastError)
    assertEquals(0, store.failures)
    assertEquals(0L, store.cachedAtMs)
  }

  @Test
  fun withTheLabSwitchOnAHwAgnssAskGetsTheServersFileOverTheFileService() {
    store.setLabAgnss(true)
    val file = rtcmFile(110)
    val asked = Collections.synchronizedList(ArrayList<String>())
    start(labSource { url -> asked += url; AgpsDownload(file, System.currentTimeMillis() - 60_000L) })

    op1()
    await(0x1F, 0x02)
    consult(3, hwAgnssTag)
    assertEquals("ready", 3, await(0x1F, 0x03).tlv!!.getByte(0x01).toInt())
    assertEquals(listOf(EphemerisNet.AGNSS_URL), asked)

    assertArrayEquals(file, pull(AgpsLab.FILE, file.size, maxData = 2048, transferSize = 232))
    assertEquals("the one file the watch is offered", AgpsLab.FILE, await(0x1C, 0x01).tlv!!.getString(0x01))
    val info = await(0x1C, 0x03).tlv!!
    assertEquals(file.size, info.getInteger(0x02))
    assertEquals(CheckSums.getCRC16(file, 0x0000).toShort(), info.getShort(0x03))
    assertEquals(EphemerisNet.addressDigest("AA:BB:CC:DD:EE:FF") + AgpsLab.FILE, await(0x1C, 0x04).tlv!!.getString(0x02))

    fromWatch(0x1C, 0x06, HuaweiTLV().put(0x01, 0.toByte()))
    assertEquals(100000, await(0x1C, 0x06).tlv!!.getInteger(0x7F))
    waitFor("delivery recorded") { store.deliveredAtMs > 0 }
    assertEquals(AgpsOutcome.DELIVERED, store.lastOutcome)
    assertEquals(AgpsLab.SOURCE, store.deliveredSource)
    assertEquals(file.size, store.deliveredSize)
    assertEquals(AgpsLab.SOURCE, store.cachedSource)
    assertEquals("HW_AGNSS", store.lastAskTags)
    assertFalse(exchange!!.busy)
  }

  @Test
  fun withTheLabSwitchOnAFileThatFailsTheCheckIsDeclinedAsToday() {
    store.setLabAgnss(true)
    start(labSource { AgpsDownload(rtcmFile(10), System.currentTimeMillis()) })
    op1()
    await(0x1F, 0x02)
    consult(3, hwAgnssTag)
    assertEquals(4, await(0x1F, 0x03).tlv!!.getByte(0x01).toInt())
    assertEquals(AgpsOutcome.INVALID_FILE, store.lastOutcome)
    assertEquals("HW_AGNSS: only 10 satellites (at least 20 needed)", store.lastError)
    fromWatch(0x1C, 0x01, HuaweiTLV().put(0x02, 1.toByte()))
    assertEquals("nothing is offered", 100001, await(0x1C, 0x01).tlv!!.getInteger(0x7F))
  }

  @Test
  fun withTheLabSwitchOnAnyOtherKindIsDeclinedWithoutADownload() {
    store.setLabAgnss(true)
    start(labSource { throw AssertionError("the network must not be used") })
    op1()
    await(0x1F, 0x02)
    consult(3, "com.huawei.higeo_dataModule_PGNSSConfig?type=HW_EEV2/HW_PGNSS_PRED;")
    assertEquals(4, await(0x1F, 0x03).tlv!!.getByte(0x01).toInt())
    op1()
    await(0x1F, 0x02, 2)
    consult(3, "a/HW_AGNSS;b/HW_PGNSS_GPS")
    assertEquals(4, await(0x1F, 0x03, 2).tlv!!.getByte(0x01).toInt())
    assertEquals(AgpsOutcome.UNSUPPORTED, store.lastOutcome)
  }

  @Test
  fun withTheLabSwitchOnAFailedDownloadWaitsForTheRetryScheduleAndAnUpdateNowSkipsIt() = runBlocking {
    store.setLabAgnss(true)
    val calls = java.util.concurrent.atomic.AtomicInteger()
    val ex = start(labSource { calls.incrementAndGet(); throw AgpsFetchException("HTTP 503") })
    op1()
    await(0x1F, 0x02)
    consult(3, hwAgnssTag)
    assertEquals(4, await(0x1F, 0x03).tlv!!.getByte(0x01).toInt())
    assertEquals(AgpsOutcome.DOWNLOAD_FAILED, store.lastOutcome)
    assertEquals("HW_AGNSS: HTTP 503", store.lastError)
    assertEquals(1, store.failures)
    assertEquals(1, calls.get())

    // The watch asks again at once: answered "failed" from the retry wait, without another request to the server.
    op1()
    await(0x1F, 0x02, 2)
    consult(3, hwAgnssTag)
    assertEquals(4, await(0x1F, 0x03, 2).tlv!!.getByte(0x01).toInt())
    assertEquals(1, calls.get())
    assertEquals(1, store.failures)
    assertTrue(store.lastError.startsWith("waiting "))

    // "Perbarui sekarang" (a forced, phone-started request) ends the wait and asks the server again.
    val outcome = scope.async { ex.probe(force = true) }
    await(0x1F, 0x02, 3)
    consult(3, hwAgnssTag)
    assertEquals(4, await(0x1F, 0x03, 3).tlv!!.getByte(0x01).toInt())
    assertEquals(AgpsOutcome.DOWNLOAD_FAILED, withTimeout(5_000) { outcome.await() })
    assertEquals(2, calls.get())
    assertEquals("the forced try starts the schedule over", 1, store.failures)
  }

  @Test
  fun withTheLabSwitchOffARunningRetryWaitLeavesTheDeclineAsItWas() {
    store.recordOutcome(System.currentTimeMillis(), AgpsOutcome.DOWNLOAD_FAILED, "earlier Broadcom failure", true)
    assertTrue(store.retryAtMs() > System.currentTimeMillis())
    start(labSource { throw AssertionError("the network must not be used") })
    op1()
    await(0x1F, 0x02)
    consult(3, hwAgnssTag)
    assertEquals(4, await(0x1F, 0x03).tlv!!.getByte(0x01).toInt())
    assertEquals(AgpsOutcome.UNSUPPORTED, store.lastOutcome)
    assertEquals("the watch asked for kinds only the watch maker's app prepares (version 3: HW_AGNSS)", store.lastError)
  }

  // The experimental HW_PGNSS_PRED path (AgpsPgnss)

  /** The Fit 4 Pro's PRED consult tag (logcat of 2026-10-18, capture of 2026-10-25). */
  private val predTag = "com.huawei.higeo_dataModule_PGNSSConfig?type=HW_EEV2/HW_PGNSS_PRED;"

  /** What the phone sent so far, as (service, command, TLV hex). */
  private fun sentSoFar() = synchronized(watch.messages) { watch.messages.map { Triple(it.service, it.command, hex(it.tlv!!)) } }

  /** Today's decline of a kind: operator ok, parameter consult, state 4, and the file list refused. */
  private val declineBytes
    get() = listOf(
      Triple(0x1F, 0x01, hex(AgpsMessages.operatorAnswer(AgpsMessages.CODE_OK))),
      Triple(0x1F, 0x02, hex(AgpsMessages.parameterConsult())),
      Triple(0x1F, 0x03, hex(AgpsMessages.fileStatus(AgpsMessages.STATE_FAILED))),
      Triple(0x1C, 0x01, hex(AgpsMessages.refused())),
    )

  @Test
  fun withThePgnssSwitchOffAPredAskIsDeclinedWithTodaysBytesAndNoDownload() {
    assertFalse("off by default", store.labPgnss)
    store.setLabAgnss(true)
    start(labSource { throw AssertionError("the network must not be used") })
    op1()
    await(0x1F, 0x02)
    consult(3, predTag)
    await(0x1F, 0x03)
    fromWatch(0x1C, 0x01, HuaweiTLV().put(0x02, 1.toByte()))
    await(0x1C, 0x01)
    assertEquals(declineBytes, sentSoFar())
    assertEquals(AgpsOutcome.UNSUPPORTED, store.lastOutcome)
    assertEquals("the watch asked for kinds only the watch maker's app prepares (version 3: HW_PGNSS_PRED)", store.lastError)
    assertEquals(0, store.failures)
    assertEquals(0L, store.cachedAtMs)
  }

  @Test
  fun withOnlyThePgnssSwitchOnAHwAgnssAskIsStillDeclinedWithTodaysBytes() {
    store.setLabPgnss(true)
    start(labSource { throw AssertionError("the network must not be used") })
    op1()
    await(0x1F, 0x02)
    consult(3, hwAgnssTag)
    await(0x1F, 0x03)
    fromWatch(0x1C, 0x01, HuaweiTLV().put(0x02, 1.toByte()))
    await(0x1C, 0x01)
    assertEquals(declineBytes, sentSoFar())
    assertEquals("the watch asked for kinds only the watch maker's app prepares (version 3: HW_AGNSS)", store.lastError)
  }

  @Test
  fun withThePgnssSwitchOnAPredAskGetsTheSixFilesOneAfterTheOtherOverTheFileService() {
    store.setLabPgnss(true)
    val built = System.currentTimeMillis() - 60_000L
    val files = pgnssFiles(built)
    val bundle = pgnssBundle(files)
    val asked = Collections.synchronizedList(ArrayList<String>())
    start(labSource { url -> asked += url; AgpsDownload(bundle, built) })

    op1()
    await(0x1F, 0x02)
    consult(3, predTag)
    assertEquals("ready", 3, await(0x1F, 0x03).tlv!!.getByte(0x01).toInt())
    assertEquals(listOf(EphemerisNet.PGNSS_URL), asked)

    // The order the Fit 4 Pro pulled them from Huawei Health: one 1C/01 ... 1C/06 round per file, every 1C/01 answered with all six names.
    val names = listOf("HW_PGNSS_GPS", "HW_PGNSS_BDS", "HW_PGNSS_GLONASS", "HW_PGNSS_GALILEO", "HW_PGNSS_QZS", "HW_PGNSS_EXTRA")
    for ((k, name) in names.withIndex()) {
      val data = files.getValue(name)
      assertArrayEquals(name, data, pull(name, data.size, maxData = 32_768, transferSize = 862))
      assertEquals(names.joinToString(";"), await(0x1C, 0x01, k + 1).tlv!!.getString(0x01))
      val info = await(0x1C, 0x03, k + 1).tlv!!
      assertEquals(data.size, info.getInteger(0x02))
      assertEquals(CheckSums.getCRC16(data, 0x0000).toShort(), info.getShort(0x03))
      assertEquals(EphemerisNet.addressDigest("AA:BB:CC:DD:EE:FF") + name, watch.all(0x1C, 0x04).last().tlv!!.getString(0x02))
      fromWatch(0x1C, 0x06, HuaweiTLV().put(0x01, 1.toByte()))
      assertEquals(100000, await(0x1C, 0x06, k + 1).tlv!!.getInteger(0x7F))
      if (k < names.size - 1) {
        assertEquals("no delivery is recorded before the last file", 0L, store.deliveredAtMs)
        assertTrue(exchange!!.busy)
      }
    }
    waitFor("delivery recorded") { store.deliveredAtMs > 0 }
    assertEquals(AgpsOutcome.DELIVERED, store.lastOutcome)
    assertEquals(AgpsPgnss.SOURCE, store.deliveredSource)
    assertEquals("all six files", 799_112, store.deliveredSize)
    assertEquals(built, store.deliveredDataMs)
    assertEquals(AgpsPgnss.SOURCE, store.cachedSource)
    assertEquals("HW_PGNSS_PRED", store.lastAskTags)
    assertEquals(1, asked.size)
    assertFalse(exchange!!.busy)
  }

  @Test
  fun withThePgnssSwitchOnAWrongStaleOrMisorderedBundleIsDeclinedAsToday() {
    store.setLabPgnss(true)
    val now = System.currentTimeMillis()
    val files = pgnssFiles(now - 60_000L)
    val shortGps = LinkedHashMap(files).also { it["HW_PGNSS_GPS"] = it.getValue("HW_PGNSS_GPS").copyOf(93_311) }
    val badHeader = LinkedHashMap(files).also { it["HW_PGNSS_GPS"] = it.getValue("HW_PGNSS_GPS").copyOf().also { gps -> gps[12 * 2 + 4] = 0 } }
    val cases = listOf(
      AgpsDownload(pgnssBundle(shortGps), now - 60_000L) to "HW_PGNSS_PRED: HW_PGNSS_GPS is 93311 bytes (93312 expected)",
      AgpsDownload(pgnssBundle(files, order = files.keys.reversed()), now - 60_000L) to
        "HW_PGNSS_PRED: file 1 is \"HW_PGNSS_EXTRA\" (HW_PGNSS_GPS expected)",
      AgpsDownload(pgnssBundle(badHeader), now - 60_000L) to "HW_PGNSS_PRED: HW_PGNSS_GPS header entry 2 points at 5888 (6136 expected)",
      AgpsDownload(pgnssBundle(files), now - 7 * 3_600_000L) to "HW_PGNSS_PRED: the bundle was built 420 minutes ago",
    )
    var next = 0
    start(labSource { cases[next].first })
    for ((k, case) in cases.withIndex()) {
      next = k
      store.clearRetry()
      op1()
      await(0x1F, 0x02, k + 1)
      consult(3, predTag)
      assertEquals(case.second, 4, await(0x1F, 0x03, k + 1).tlv!!.getByte(0x01).toInt())
      assertEquals(AgpsOutcome.INVALID_FILE, store.lastOutcome)
      assertEquals(case.second, store.lastError)
      fromWatch(0x1C, 0x01, HuaweiTLV().put(0x02, 1.toByte()))
      assertEquals("nothing is offered", 100001, await(0x1C, 0x01, k + 1).tlv!!.getInteger(0x7F))
    }
    assertTrue(watch.all(0x1C, 0x03).isEmpty())
    assertEquals(0L, store.deliveredAtMs)
  }

  @Test
  fun withBothSwitchesOnTheHwAgnssAskAndThePredAskAfterItAreEachServedOnTheirOwn() {
    store.setLabAgnss(true)
    store.setLabPgnss(true)
    val built = System.currentTimeMillis() - 60_000L
    val rtcm = rtcmFile(110)
    val bundle = pgnssBundle(pgnssFiles(built))
    start(labSource { url -> if (url == EphemerisNet.AGNSS_URL) AgpsDownload(rtcm, built) else AgpsDownload(bundle, built) })

    // Device run of 2026-10-25: HW_AGNSS first, then HW_PGNSS_PRED in its own 1F/01 exchange two seconds after the transfer closed.
    op1()
    await(0x1F, 0x02)
    consult(3, hwAgnssTag)
    assertEquals(3, await(0x1F, 0x03).tlv!!.getByte(0x01).toInt())
    assertArrayEquals(rtcm, pull(AgpsLab.FILE, rtcm.size, maxData = 2048, transferSize = 232))
    assertEquals(AgpsLab.FILE, await(0x1C, 0x01).tlv!!.getString(0x01))
    fromWatch(0x1C, 0x06, HuaweiTLV().put(0x01, 1.toByte()))
    waitFor("HW_AGNSS delivered") { store.deliveredSource == AgpsLab.SOURCE }

    op1()
    await(0x1F, 0x02, 2)
    consult(3, predTag)
    assertEquals(3, await(0x1F, 0x03, 2).tlv!!.getByte(0x01).toInt())
    fromWatch(0x1C, 0x01, HuaweiTLV().put(0x02, 1.toByte()))
    assertEquals(PgnssBundle.FILES.joinToString(";") { it.name }, await(0x1C, 0x01, 2).tlv!!.getString(0x01))
  }
}
