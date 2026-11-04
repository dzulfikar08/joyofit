package com.joyodigitama.huaweiwear

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.CameraRemote
import nodomain.freeyourgadget.gadgetbridge.util.CheckSums
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The watch's Remote shutter packets: 01/2A from the phone, 01/29 from the watch (the same bytes the Swift tests check). */
class CameraRemoteTest {
  private val plain = HuaweiPacket.ParamsProvider().also { it.setTransactionsCrypted(false) }

  private fun frame(service: Int, command: Int, tlv: ByteArray): ByteArray {
    val body = byteArrayOf(0x00, service.toByte(), command.toByte()) + tlv
    val head = byteArrayOf(0x5A, (body.size shr 8).toByte(), body.size.toByte()) + body
    val crc = CheckSums.getCRC16(head, 0)
    return head + byteArrayOf((crc shr 8).toByte(), crc.toByte())
  }

  @Test
  fun setupEventsAreTagOneZeroOneTwo() {
    val events = listOf(
      CameraRemote.CameraRemoteSetup.Request.Event.ENABLE_CAMERA to 0,
      CameraRemote.CameraRemoteSetup.Request.Event.CAMERA_STARTED to 1,
      CameraRemote.CameraRemoteSetup.Request.Event.CAMERA_STOPPED to 2,
    )
    for ((event, value) in events) {
      val out = CameraRemote.CameraRemoteSetup.Request(plain, event).serialize()
      assertEquals(1, out.size)
      assertArrayEquals(frame(0x01, 0x2A, byteArrayOf(0x01, 0x01, value.toByte())), out[0])
    }
  }

  @Test
  fun watchStatusParsesToTheEvent() {
    val expected = mapOf(
      1 to CameraRemote.CameraRemoteStatus.Response.Event.OPEN_CAMERA,
      2 to CameraRemote.CameraRemoteStatus.Response.Event.TAKE_PICTURE,
      3 to CameraRemote.CameraRemoteStatus.Response.Event.CLOSE_CAMERA,
      9 to null,
    )
    for ((value, event) in expected) {
      val packet = HuaweiPacket(plain).parse(frame(0x01, 0x29, byteArrayOf(0x01, 0x01, value.toByte())))
      assertTrue(packet is CameraRemote.CameraRemoteStatus.Response)
      packet.parseTlv()
      val parsed = (packet as CameraRemote.CameraRemoteStatus.Response).event
      if (event == null) assertNull(parsed) else assertEquals(event, parsed)
    }
  }
}
