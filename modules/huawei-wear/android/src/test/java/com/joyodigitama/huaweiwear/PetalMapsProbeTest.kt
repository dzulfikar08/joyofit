package com.joyodigitama.huaweiwear

import java.util.Collections
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.P2P
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.HuaweiP2PManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Petal Maps companion probe (PetalMapsProbe.kt, lab JRG-434): its answers on the wire and its log lines. Twin: PetalMapsProbeTests.swift. */
class PetalMapsProbeTest {
  private class Sent(val cmd: Int, val seq: Short, val src: String?, val dst: String?, val srcFp: String?, val dstFp: String?, val data: ByteArray?, val code: Int)

  private class FakeTransport : HuaweiP2PManager.Transport {
    val sent: MutableList<Sent> = Collections.synchronizedList(ArrayList())

    override fun sendP2P(cmdId: Byte, sequence: Short, srcPackage: String?, dstPackage: String?, srcFingerprint: String?, dstFingerprint: String?, sendData: ByteArray?, sendCode: Int) {
      sent += Sent(cmdId.toInt(), sequence, srcPackage, dstPackage, srcFingerprint, dstFingerprint, sendData, sendCode)
    }

    override fun supportsExpandCapability(which: Int) = false

    override fun log(message: String) = Unit
  }

  private class Rig(start: Long = 0L) {
    var now = start
    val transport = FakeTransport()
    val manager = HuaweiP2PManager(transport)
    val logs: MutableList<String> = Collections.synchronizedList(ArrayList())
    val probe = PetalMapsProbeService(manager, { logs += it }, { now })
  }

  private fun params() = HuaweiPacket.ParamsProvider().also { it.setSecretKey(ByteArray(16)) }

  private fun fromWatch(cmd: Int, seq: Int, data: ByteArray? = null, srcFp: String? = null, dstFp: String? = null, src: String = PetalProbeWire.WATCH_PACKAGE): P2P.P2PCommand.Response {
    val r = P2P.P2PCommand.Response(params())
    r.cmdId = cmd.toByte()
    r.sequenceId = seq.toShort()
    r.srcPackage = src
    r.dstPackage = PetalProbeWire.PHONE_PACKAGE
    r.srcFingerprint = srcFp
    r.dstFingerprint = dstFp
    r.respData = data
    return r
  }

  /** The P2P TLV of what the manager sent (before the session's encryption). */
  private fun wire(s: Sent): String =
    P2P.P2PCommand.Request(params(), s.cmd.toByte(), s.seq, s.src, s.dst, s.srcFp, s.dstFp, s.data, s.code).getTlv().serialize().toHex()

  private fun ascii(s: String) = s.toByteArray(Charsets.US_ASCII).toHex()

  @Test
  fun registrationLogsOneInfoLineAndSendsNothing() {
    val rig = Rig()
    rig.probe.register()
    assertEquals(
      listOf(
        "PetalProbe: registered for the watch app com.huawei.ohos.maps.app (phone package com.huawei.maps.app); pings answered 0xca, " +
          "messages acknowledged 0xcf, nothing else is sent",
      ),
      rig.logs.toList(),
    )
    assertTrue(rig.transport.sent.isEmpty())
  }

  @Test
  fun thePingOfTheWatchAppIsAnswered0xcaWithThisFrame() {
    val rig = Rig()
    rig.probe.register()
    rig.logs.clear()
    rig.manager.handlePacket(fromWatch(1, 90))

    val ack = rig.transport.sent.single()
    assertEquals(3, ack.cmd)
    assertEquals(90, ack.seq.toInt())
    assertEquals(PetalProbeWire.PHONE_PACKAGE, ack.src)
    assertEquals(PetalProbeWire.WATCH_PACKAGE, ack.dst)
    assertEquals(0xCA, ack.code)
    // 01 cmd 3, 02 seq 90, 03 our package, 04 the watch app, 08 code 0xca; no fingerprints, no data.
    assertEquals("010103" + "0202005A" + "0313" + ascii("com.huawei.maps.app") + "0418" + ascii("com.huawei.ohos.maps.app") + "0804000000CA", wire(ack))
    assertEquals(
      listOf(
        "PetalProbe: rx P2P cmd=1 seq=90 code=0 (0x0) src=com.huawei.ohos.maps.app dst=com.huawei.maps.app srcFp=none dstFp=none",
        "PetalProbe: rx P2P seq=90 data=none",
        "PetalProbe: answering ping seq=90 with 0xca (app present)",
      ),
      rig.logs.toList(),
    )
  }

  @Test
  fun aMessageIsAcknowledged0xcfAndDumpedWithItsTlvs() {
    val rig = Rig()
    rig.probe.register()
    rig.logs.clear()
    val data = "0103616263820303010704020102".hexToBytes()
    rig.manager.handlePacket(fromWatch(2, 91, data, srcFp = "watchFp", dstFp = "phoneFp"))

    val ack = rig.transport.sent.single()
    assertEquals(3, ack.cmd)
    assertEquals(91, ack.seq.toInt())
    assertEquals(0xCF, ack.code)
    assertEquals("010103" + "0202005B" + "0313" + ascii("com.huawei.maps.app") + "0418" + ascii("com.huawei.ohos.maps.app") + "0804000000CF", wire(ack))
    assertEquals(
      listOf(
        "PetalProbe: rx P2P cmd=2 seq=91 code=0 (0x0) src=com.huawei.ohos.maps.app dst=com.huawei.maps.app srcFp=watchFp dstFp=phoneFp",
        "PetalProbe: rx P2P seq=91 data=14 bytes",
        "PetalProbe: rx P2P seq=91 hex[1/1] 0103616263820303010704020102 |..abc.........|",
        "PetalProbe: rx P2P seq=91 tlv 01 len=3: 616263 = 6382179 \"abc\"",
        "PetalProbe: rx P2P seq=91 tlv 82 len=3: nested",
        "PetalProbe: rx P2P seq=91 tlv 82.03 len=1: 07 = 7",
        "PetalProbe: rx P2P seq=91 tlv 04 len=2: 0102 = 258",
        "PetalProbe: acknowledging message seq=91 with 0xcf",
      ),
      rig.logs.toList(),
    )
  }

  @Test
  fun longDataIsSplitIntoLinesAndANonTlvIsSaidSo() {
    val data = ByteArray(600) { 0xFF.toByte() }
    val lines = PetalProbeWire.dump("x", data)
    assertEquals(4, lines.size)
    assertEquals("PetalProbe: x data=600 bytes", lines[0])
    assertEquals("PetalProbe: x hex[1/2] ${"FF".repeat(512)} |${".".repeat(512)}|", lines[1])
    assertEquals("PetalProbe: x hex[2/2] ${"FF".repeat(88)} |${".".repeat(88)}|", lines[2])
    assertEquals("PetalProbe: x tlv: not a Huawei TLV", lines[3])
    assertEquals(listOf("PetalProbe: x data=0 bytes"), PetalProbeWire.dump("x", ByteArray(0)))
  }

  @Test
  fun aLongTlvValueIsCutAndUtf8IsPreviewed() {
    val text = "Malang–Surabaya".toByteArray(Charsets.UTF_8)
    val long = ByteArray(70) { it.toByte() }
    val data = byteArrayOf(0x05, text.size.toByte()) + text + byteArrayOf(0x06, 70) + long
    val lines = PetalProbeWire.dump("y", data)
    assertEquals(4, lines.size)
    // 0x46 (the length 70) is "F"; 0x00-0x1F are control characters.
    assertTrue(lines[1].endsWith("|..Malang–Surabaya.F${".".repeat(32)} !\"#\$%&'()*+,-./0123456789:;<=>?@ABCDE|"))
    assertEquals("PetalProbe: y tlv 05 len=17: ${text.toHex()} \"Malang–Surabaya\"", lines[2])
    assertEquals("PetalProbe: y tlv 06 len=70: ${long.copyOfRange(0, 64).toHex()}...", lines[3])
  }

  @Test
  fun framesNothingHandlesAreLoggedOnlyInThe30sAfterAPing() {
    val rig = Rig(start = 1_000L)
    rig.probe.register()
    rig.logs.clear()
    rig.probe.onUnhandled(0x27, 0x05, "0101AA".hexToBytes(), ByteArray(20))
    assertTrue("nothing before a ping", rig.logs.isEmpty())

    rig.manager.handlePacket(fromWatch(1, 5))
    rig.logs.clear()
    rig.now = 1_500L
    rig.probe.onUnhandled(0x27, 0x05, "0101AA".hexToBytes(), ByteArray(20))
    assertEquals(
      listOf(
        "PetalProbe: unhandled svc=27 cmd=05 500 ms after the ping, raw frame 20 bytes (its hex is on the RX line above)",
        "PetalProbe: unhandled svc=27 cmd=05 data=3 bytes",
        "PetalProbe: unhandled svc=27 cmd=05 hex[1/1] 0101AA |...|",
        "PetalProbe: unhandled svc=27 cmd=05 tlv 01 len=1: AA = 170",
      ),
      rig.logs.toList(),
    )

    rig.logs.clear()
    rig.now = 2_000L
    rig.manager.setUnclaimedListener { rig.probe.onUnclaimed(it) }
    rig.manager.handlePacket(fromWatch(2, 6, null, src = "com.huawei.ohos.other"))
    assertEquals(
      listOf(
        "PetalProbe: 1000 ms after the ping, a P2P packet from com.huawei.ohos.other, which no service has:",
        "PetalProbe: unclaimed P2P cmd=2 seq=6 code=0 (0x0) src=com.huawei.ohos.other dst=com.huawei.maps.app srcFp=none dstFp=none",
        "PetalProbe: unclaimed P2P seq=6 data=none",
      ),
      rig.logs.toList(),
    )
    assertTrue("nobody answers another package", rig.transport.sent.size == 1)

    rig.logs.clear()
    rig.now = 31_001L
    rig.probe.onUnhandled(0x27, 0x05, null, ByteArray(20))
    rig.manager.handlePacket(fromWatch(2, 7, null, src = "com.huawei.ohos.other"))
    assertTrue("the window closed", rig.logs.isEmpty())
  }

  @Test
  fun anUnregisteredProbeAnswersNothing() {
    val rig = Rig()
    rig.probe.register()
    rig.manager.unregisterService(PetalProbeWire.PHONE_PACKAGE)
    rig.logs.clear()
    rig.manager.handlePacket(fromWatch(1, 9))
    assertTrue(rig.transport.sent.isEmpty())
    assertTrue(rig.logs.isEmpty())
  }

  @Test
  fun filesFromTheWatchAppAreDumped() {
    val rig = Rig()
    rig.probe.register()
    rig.logs.clear()
    rig.manager.handleFile(PetalProbeWire.WATCH_PACKAGE, PetalProbeWire.PHONE_PACKAGE, "a", "b", "m.bin", byteArrayOf(0x41, 0x42))
    assertEquals(
      listOf(
        "PetalProbe: rx file m.bin data=2 bytes",
        "PetalProbe: rx file m.bin hex[1/1] 4142 |AB|",
        "PetalProbe: rx file m.bin tlv: not a Huawei TLV",
      ),
      rig.logs.toList(),
    )
  }
}
