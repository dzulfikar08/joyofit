package com.joyodigitama.huaweiwear

import java.util.Collections
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.P2P
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.HuaweiP2PManager
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class WatchNavServiceTest {
  private class SentP2P(
    val cmd: Byte,
    val seq: Short,
    val src: String?,
    val dst: String?,
    val srcFp: String?,
    val dstFp: String?,
    val data: ByteArray?,
    val code: Int,
  )

  private class FakeTransport : HuaweiP2PManager.Transport {
    val sent: MutableList<SentP2P> = Collections.synchronizedList(ArrayList())

    override fun sendP2P(cmdId: Byte, sequence: Short, srcPackage: String?, dstPackage: String?, srcFingerprint: String?, dstFingerprint: String?, sendData: ByteArray?, sendCode: Int) {
      sent.add(SentP2P(cmdId, sequence, srcPackage, dstPackage, srcFingerprint, dstFingerprint, sendData, sendCode))
    }

    override fun supportsExpandCapability(which: Int) = false

    override fun log(message: String) = Unit
  }

  private class RecordingEvents : WearEvents {
    val navs: MutableList<Map<String, Any?>> = Collections.synchronizedList(ArrayList())
    val logs: MutableList<String> = Collections.synchronizedList(ArrayList())

    override fun state(state: LinkState, error: String?) = Unit
    override fun battery(level: Int) = Unit
    override fun syncComplete(summary: SyncSummary) = Unit
    override fun log(direction: LogDirection, serviceId: Int?, commandId: Int?, hex: String?, message: String) {
      logs.add(message)
    }

    override fun watchNav(payload: Map<String, Any?>) {
      navs.add(payload)
    }
  }

  private fun params() = HuaweiPacket.ParamsProvider().also { it.setSecretKey(ByteArray(16)) }

  private fun watchPacket(cmd: Int, seq: Int, src: String, dst: String, data: ByteArray? = null, code: Int = 0): P2P.P2PCommand.Response {
    val r = P2P.P2PCommand.Response(params())
    r.cmdId = cmd.toByte()
    r.sequenceId = seq.toShort()
    r.srcPackage = src
    r.dstPackage = dst
    r.respData = data
    r.respCode = code
    return r
  }

  private val config = WatchNavConfig("PHONEFP", "WATCHFP")

  private class Setup(val transport: FakeTransport, val manager: HuaweiP2PManager, val service: WatchNavService, val events: RecordingEvents)

  private var clock = 1_000_000L

  private fun setup(): Setup {
    val transport = FakeTransport()
    val manager = HuaweiP2PManager(transport)
    val events = RecordingEvents()
    val service = WatchNavService(manager, PHONE, config, events) { clock }
    service.register()
    return Setup(transport, manager, service, events)
  }

  private fun Setup.answerPing(code: Int) {
    val ping = transport.sent.first { it.cmd.toInt() == 1 }
    manager.handlePacket(watchPacket(3, ping.seq.toInt(), WatchNavWire.PACKAGE, PHONE, null, code))
  }

  @Test
  fun registrationPingsTheWatchAppFromThePhonePackageWithoutFingerprints() {
    val s = setup()
    val ping = s.transport.sent.single()
    assertEquals(1, ping.cmd.toInt())
    assertEquals(PHONE, ping.src)
    assertEquals(WatchNavWire.PACKAGE, ping.dst)
    assertNull(ping.srcFp)
    assertNull(ping.dstFp)
    assertEquals("unknown", s.service.watchApp)
  }

  @Test
  fun pingAnswer0xcaMeansPresent() {
    val s = setup()
    s.answerPing(0xCA)
    assertEquals("present", s.service.watchApp)
    assertEquals(0xCA, s.service.lastCode)
    val event = s.events.navs.single()
    assertEquals("presence", event["kind"])
    assertEquals("present", event["watchApp"])
    assertEquals(0xCA, event["code"])
    assertTrue(s.events.logs.contains("WatchNav: ping of com.joyodigitama.navi answered 0xca (0xca = the watch app is there)"))
  }

  @Test
  fun anotherPingAnswerMeansAbsent() {
    val s = setup()
    s.answerPing(0xCB)
    assertEquals("absent", s.service.watchApp)
    assertEquals("absent", s.events.navs.single()["watchApp"])
  }

  @Test
  fun sendCarriesBothPackagesAndFingerprintsAndCountsTheAck() {
    val s = setup()
    s.answerPing(0xCA)
    s.transport.sent.clear()
    val json = """{"t":"step","n":3}"""
    assertTrue(s.service.send(json))
    val data = s.transport.sent.single()
    assertEquals(2, data.cmd.toInt())
    assertEquals(PHONE, data.src)
    assertEquals(WatchNavWire.PACKAGE, data.dst)
    assertEquals("PHONEFP", data.srcFp)
    assertEquals("WATCHFP", data.dstFp)
    assertArrayEquals(json.toByteArray(Charsets.UTF_8), data.data)
    assertEquals(1, s.service.sent)

    s.manager.handlePacket(watchPacket(3, data.seq.toInt(), WatchNavWire.PACKAGE, PHONE, null, 0xCF))
    assertEquals(1, s.service.acked)
    assertEquals(0xCF, s.service.lastCode)
    assertTrue(s.events.logs.contains("WatchNav: tx step n=3 (18 bytes)"))
    assertTrue(s.events.logs.contains("WatchNav: tx step n=3 acknowledged 0xcf"))
  }

  @Test
  fun sendPingsFirstWhileTheWatchAppIsNotKnown() {
    val s = setup()
    clock += 31_000
    s.transport.sent.clear()
    s.service.send("""{"t":"step","n":1}""")
    assertEquals(listOf(1, 2), s.transport.sent.map { it.cmd.toInt() })
  }

  @Test
  fun messagesOver1000BytesAreRejectedAndExactly1000Accepted() {
    val s = setup()
    val prefix = """{"t":"x","p":""""
    val suffix = """"}"""
    val exact = prefix + "a".repeat(1000 - prefix.length - suffix.length) + suffix
    assertEquals(1000, exact.toByteArray().size)
    assertTrue(s.service.send(exact))
    try {
      s.service.send(prefix + "a".repeat(1001 - prefix.length - suffix.length) + suffix)
      fail("expected a rejection")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.INVALID_ARGUMENT, e.errorCode)
    }
  }

  @Test
  fun theWatchAppsPingIsAnswered0xcaToTheWatchApp() {
    val s = setup()
    s.transport.sent.clear()
    s.manager.handlePacket(watchPacket(1, 21, WatchNavWire.PACKAGE, PHONE))
    val ack = s.transport.sent.single()
    assertEquals(3, ack.cmd.toInt())
    assertEquals(21, ack.seq.toInt())
    assertEquals(PHONE, ack.src)
    assertEquals(WatchNavWire.PACKAGE, ack.dst)
    assertEquals(0xCA, ack.code)
    assertEquals("present", s.service.watchApp)
  }

  @Test
  fun watchDataIsAcked0xcfAndEmittedAsAMessage() {
    val s = setup()
    s.answerPing(0xCA)
    s.transport.sent.clear()
    s.events.navs.clear()
    val json = """{"t":"hello","v":1}"""
    s.manager.handlePacket(watchPacket(2, 30, WatchNavWire.PACKAGE, PHONE, json.toByteArray()))
    val ack = s.transport.sent.single()
    assertEquals(3, ack.cmd.toInt())
    assertEquals(0xCF, ack.code)
    assertEquals(WatchNavWire.PACKAGE, ack.dst)
    val event = s.events.navs.single()
    assertEquals("message", event["kind"])
    assertEquals(json, event["json"])
    assertEquals(clock, event["ts"])
    assertEquals(1, s.service.received)
  }

  @Test
  fun nonJsonDataIsNotEmitted() {
    val s = setup()
    s.answerPing(0xCA)
    s.events.navs.clear()
    s.manager.handlePacket(watchPacket(2, 31, WatchNavWire.PACKAGE, PHONE, byteArrayOf(0x01, 0xFF.toByte())))
    assertTrue(s.events.navs.isEmpty())
    assertTrue(s.events.logs.contains("WatchNav: rx not JSON (2 bytes): 01ff"))
  }

  @Test
  fun unregisterServiceRemovesItAndPresenceIsUnknownAgain() {
    val s = setup()
    s.answerPing(0xCA)
    s.manager.unregisterService(PHONE)
    assertNull(s.manager.getRegisteredService(PHONE))
    assertEquals("unknown", s.service.watchApp)
    assertEquals("unknown", s.events.navs.last()["watchApp"])
    assertNull(s.events.navs.last()["code"])
  }

  @Test
  fun wireSummaryAndProblem() {
    assertEquals("step n=3", WatchNavWire.summary("""{"t":"step","n":3}"""))
    assertEquals("step n=?", WatchNavWire.summary("""{"t":"step"}"""))
    assertEquals("?", WatchNavWire.summary("nope"))
    assertNull(WatchNavWire.problem("{}"))
    assertEquals("empty", WatchNavWire.problem(""))
    assertEquals("1001 bytes, more than 1000", WatchNavWire.problem("a".repeat(1001)))
    assertTrue(WatchNavWire.isPlaceholder("PLACEHOLDER_PHONE"))
    assertFalse(WatchNavWire.isPlaceholder("AB:CD"))
  }

  private companion object {
    const val PHONE = "com.joyodigitama.joyofit"
  }
}
