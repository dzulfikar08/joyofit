package com.joyodigitama.huaweiwear

import java.io.IOException
import java.nio.ByteBuffer
import java.util.Collections
import kotlinx.coroutines.runBlocking
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiCoordinator.HuaweiDeviceType
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.util.CheckSums
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The HiChain first-bind gate of [HuaweiAuthenticator] against a scripted watch: LinkParams and SecurityNegotiation are answered,
 * and the step after them (PinCode for a first bind, HiChain operationCode 2 for a reconnect) is never answered, so the write of
 * that request proves the authentication went on past the gate.
 */
class AuthBindConsentTest {
  private class Events : WearEvents {
    val logs: MutableList<String> = Collections.synchronizedList(ArrayList())
    override fun state(state: LinkState, error: String?) = Unit
    override fun battery(level: Int) = Unit
    override fun syncComplete(summary: SyncSummary) = Unit
    override fun log(direction: LogDirection, serviceId: Int?, commandId: Int?, hex: String?, message: String) {
      logs.add(message)
    }
  }

  /** Answers the first requests in order with [replies]; the write after them fails like a link that dropped. */
  private class ScriptedWatch(private val replies: List<ByteArray>) : FrameSink {
    lateinit var session: HuaweiSession
    val writes = Collections.synchronizedList(ArrayList<ByteArray>())

    override suspend fun write(frames: List<ByteArray>) {
      writes.add(frames.first())
      val index = writes.size - 1
      if (index >= replies.size) throw IOException("script ended")
      session.onData(replies[index])
    }
  }

  /** Unsliced, unencrypted frame of one Huawei service command carrying [tlv]. */
  private fun frame(service: Int, command: Int, tlv: HuaweiTLV): ByteArray {
    val body = byteArrayOf(service.toByte(), command.toByte()) + tlv.serialize()
    val head = ByteBuffer.allocate(4 + body.size)
      .put(0x5A.toByte())
      .putShort((body.size + 1).toShort())
      .put(0x00)
      .put(body)
      .array()
    val crc = CheckSums.getCRC16(head, 0x0000)
    return ByteBuffer.allocate(head.size + 2).put(head).putShort(crc.toShort()).array()
  }

  /** LinkParams response of a deviceSupportType 4 watch (authMode 4, HiChain). */
  private fun linkParams(): ByteArray {
    val nonce = ByteArray(18).also { it[1] = 0x01 }
    return frame(
      0x01,
      0x01,
      HuaweiTLV()
        .put(0x01, 0x09.toByte())
        .put(0x02, 0xF4.toShort())
        .put(0x03, 0x14.toShort())
        .put(0x05, nonce)
        .put(0x07, 0x04.toByte())
        .put(0x08, 0x00.toByte())
        .put(0x09, 0x00.toByte())
        .put(0x0C, 0x00.toByte()),
    )
  }

  /** SecurityNegotiation response of authMode 4: tag 0x02 = 1 gives authType 5 (phone unknown), 2 gives 6 (phone known). */
  private fun securityNegotiation(authType: Int): ByteArray =
    frame(0x01, 0x33, HuaweiTLV().put(0x01, 0x04.toByte()).put(0x02, (authType xor 0x04).toByte()))

  private class Run(val watch: ScriptedWatch, val events: Events, val error: WearException?, val mode: AuthMode?)

  /** [bonded]: this phone holds a key from an earlier bind. */
  private fun authenticate(authType: Int, bonded: Boolean, firstBindAllowed: Boolean): Run {
    val watch = ScriptedWatch(listOf(linkParams(), securityNegotiation(authType)))
    val events = Events()
    val session = HuaweiSession(watch, events)
    session.params.setTransactionsCrypted(false)
    watch.session = session
    val identity = DeviceIdentity("AA:BB:CC:DD:EE:FF", MemoryPrefs())
    if (bonded) {
      identity.authKey = ByteArray(16) { 7 }
      identity.markBonded()
    }
    val authenticator = HuaweiAuthenticator(session, identity, events, HuaweiDeviceType.BLE)
    return try {
      Run(watch, events, null, runBlocking { authenticator.authenticate(firstBindAllowed) })
    } catch (e: WearException) {
      Run(watch, events, e, null)
    }
  }

  @Test
  fun watchThatDoesNotKnowThisPhoneNeedsConfirmationBeforeAnyBindRequest() {
    val run = authenticate(authType = 5, bonded = true, firstBindAllowed = false)

    assertEquals(ErrorCodes.BIND_CONFIRMATION, run.error?.errorCode)
    // A key is stored (bonded) and the watch does not know it: the lost-binding text (JRG-414).
    assertEquals(FirstBind.LOST_MESSAGE, run.error?.message)
    // LinkParams and SecurityNegotiation only: no PinCode or HiChain request reached the watch.
    assertEquals(2, run.watch.writes.size)
  }

  @Test
  fun missingLocalKeyNeedsConfirmationEvenWhenTheWatchKnowsThisPhone() {
    val run = authenticate(authType = 6, bonded = false, firstBindAllowed = false)

    assertEquals(ErrorCodes.BIND_CONFIRMATION, run.error?.errorCode)
    assertEquals(FirstBind.MESSAGE, run.error?.message)
    assertEquals(2, run.watch.writes.size)
  }

  @Test
  fun confirmedFirstBindGoesOnToThePinCodeRequest() {
    val run = authenticate(authType = 5, bonded = false, firstBindAllowed = true)

    // The third write is the PinCode request; the script has no answer, which ends the attempt as a dropped link.
    assertEquals(3, run.watch.writes.size)
    assertEquals(ErrorCodes.DISCONNECTED, run.error?.errorCode)
    assertTrue(run.events.logs.any { it.contains("firstConnection=true") })
  }

  @Test
  fun reconnectWithAKeyTheWatchKnowsNeverAsksForConfirmation() {
    val run = authenticate(authType = 6, bonded = true, firstBindAllowed = false)

    // The third write is HiChain operationCode 2 step 1, not a PinCode request and not a confirmation stop.
    assertEquals(3, run.watch.writes.size)
    assertEquals(ErrorCodes.DISCONNECTED, run.error?.errorCode)
    assertTrue(run.events.logs.any { it.contains("firstConnection=false") })
    assertFalse(run.error?.errorCode == ErrorCodes.BIND_CONFIRMATION)
  }
}
