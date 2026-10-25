package com.joyodigitama.huaweiwear

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WatchWorkoutTest {
  private fun hex(s: String): ByteArray = s.replace(" ", "").chunked(2).map { it.toInt(16).toByte() }.toByteArray()

  private val plain = HuaweiPacket.ParamsProvider().also { it.setTransactionsCrypted(false); it.setSliceSize(1022) }

  // 1_700_000_000 s = 0x6553F100; the workout started 60 s earlier.
  private val now = 1_700_000_000_000L
  private val started = now - 60_000L

  private val plainShape = WatchWorkoutWire.Shape(linkTags = false, forbidPause = false)
  private val fullShape = WatchWorkoutWire.Shape(linkTags = true, forbidPause = true)

  @Test
  fun startOfStrengthTrainingIsHuaweiHealthsOperatorLayout() {
    val tlv = WatchWorkoutWire.operatorTlv(WatchWorkoutWire.OP_START, WatchWorkoutWire.SPORT_STRENGTH_TRAINING, now, now, plainShape)
    assertArrayEquals(
      hex(
        "81 29  02 01 01  03 01 01  05 01 8c  06 04 6553f100" +
          "  87 12 08 04 00000000 09 04 00000000 0a 04 00000000  0c 04 6553f100",
      ),
      tlv.serialize(),
    )
  }

  @Test
  fun versionRunCourseAndForbidPauseTagsFollowHuaweisOrder() {
    val tlv = WatchWorkoutWire.operatorTlv(WatchWorkoutWire.OP_STOP, WatchWorkoutWire.SPORT_STRENGTH_TRAINING, now, started, fullShape)
    assertArrayEquals(
      hex(
        "81 32  02 01 04  03 01 01  05 01 8c  06 04 6553f100" +
          "  87 12 08 04 00000000 09 04 00000000 0a 04 00000000  0b 01 00  0c 04 6553f0c4  0d 01 00  0e 01 00",
      ),
      tlv.serialize(),
    )
  }

  @Test
  fun packetCarriesServiceAndCommand() {
    val packet = WatchWorkoutWire.setOperator(plain, WatchWorkoutWire.OP_PAUSE, WatchWorkoutWire.SPORT_STRENGTH_TRAINING, now, started, plainShape)
    assertEquals(0x17.toByte(), packet.serviceId)
    assertEquals(0x01.toByte(), packet.commandId)
    assertEquals(0x02.toByte(), packet.getTlv().getObject(0x81).getBytes(0x02)[0])
  }

  @Test
  fun statusRequestIsAnEmptyContainer() {
    val packet = WatchWorkoutWire.statusRequest(plain)
    assertEquals(0x03.toByte(), packet.commandId)
    assertArrayEquals(hex("81 00"), packet.getTlv().serialize())
  }

  @Test
  fun workoutTypesUseTheShortestBigEndianBytes() {
    assertArrayEquals(hex("00"), WatchWorkoutWire.minimalBytes(0))
    assertArrayEquals(hex("01"), WatchWorkoutWire.minimalBytes(1))
    assertArrayEquals(hex("8c"), WatchWorkoutWire.minimalBytes(140))
    assertArrayEquals(hex("ff"), WatchWorkoutWire.minimalBytes(255))
    assertArrayEquals(hex("0100"), WatchWorkoutWire.minimalBytes(256))
    assertArrayEquals(hex("010203"), WatchWorkoutWire.minimalBytes(0x010203))
  }

  @Test
  fun optionalTagsFollowTheWatchsSupportedCommands() {
    val listed = setOf(0x17 to 0x12, 0x17 to 0x15)
    val shape = WatchWorkoutWire.shapeFor { service, command -> (service to command) in listed }
    assertTrue(shape.linkTags)
    assertTrue(shape.forbidPause)
    val none = WatchWorkoutWire.shapeFor { _, _ -> false }
    assertFalse(none.linkTags)
    assertFalse(none.forbidPause)
  }

  @Test
  fun resultCodeIsReadFromTag7F() {
    assertEquals(WatchWorkoutWire.OK, WatchWorkoutWire.resultCode(HuaweiTLV().parse(hex("7f 04 000186a0"))))
    assertEquals(123002, WatchWorkoutWire.resultCode(HuaweiTLV().parse(hex("7f 04 0001e07a"))))
    assertNull(WatchWorkoutWire.resultCode(HuaweiTLV().parse(hex("81 03 02 01 01"))))
    assertNull(WatchWorkoutWire.resultCode(null))
  }

  @Test
  fun theFit4ProRefusalAndIdleStatusAsCapturedOn2026_10_21() {
    // Every 17/01 on the Fit 4 Pro (6.1.0.117), whatever the operator, sport or tag subset, answered this
    // (plaintext of the encrypted frame 5A00090017017F040001E07A6157).
    val refusal = HuaweiTLV().parse(hex("7f 04 0001e07a"))
    assertEquals(WatchWorkoutWire.ERR_FAILED, WatchWorkoutWire.resultCode(refusal))
    assertEquals("7F040001E07A", WatchWorkoutWire.plain(refusal))
    // The 17/03 answers before and after: trainMonitorState 0, operator 0, nothing running.
    val idle = WatchWorkoutWire.parseStatus(HuaweiTLV().parse(hex("81 06 02 01 00 03 01 00")))!!
    assertEquals(0, idle.operator)
    assertFalse(idle.running)
    assertEquals("(empty)", WatchWorkoutWire.plain(null))
  }

  @Test
  fun wearRequestIsHuaweiHealthsEmptyTagOne() {
    val packet = WatchWorkoutWire.wearRequest(plain)
    assertEquals(0x2E.toByte(), packet.serviceId)
    assertEquals(0x03.toByte(), packet.commandId)
    assertArrayEquals(hex("01 00"), packet.getTlv().serialize())
  }

  @Test
  fun wearStatusTwoMeansNotWorn() {
    assertEquals(false, WatchWorkoutWire.wornFrom(HuaweiTLV().parse(hex("01 01 02"))))
    assertEquals(true, WatchWorkoutWire.wornFrom(HuaweiTLV().parse(hex("01 01 01"))))
    assertNull(WatchWorkoutWire.wornFrom(HuaweiTLV().parse(hex("7f 04 000186a0"))))
    assertNull(WatchWorkoutWire.wornFrom(null))
  }

  @Test
  fun statusAnswerSaysWhetherTheWatchRunsAWorkout() {
    val running = WatchWorkoutWire.parseStatus(HuaweiTLV().parse(hex("81 0c  02 01 01  03 01 01  04 01 01  06 01 8c")))!!
    assertEquals(1, running.operator)
    assertEquals(140, running.workoutType)
    assertTrue(running.running)
    val paused = WatchWorkoutWire.parseStatus(HuaweiTLV().parse(hex("81 06  02 01 01  03 01 02")))!!
    assertFalse(paused.running)
    assertEquals(WatchPhase.PAUSED, paused.phase)
    val stopped = WatchWorkoutWire.parseStatus(HuaweiTLV().parse(hex("81 03  03 01 04")))!!
    assertFalse(stopped.running)
    assertEquals(WatchPhase.IDLE, stopped.phase)
    assertNull(WatchWorkoutWire.parseStatus(HuaweiTLV()))
  }

  @Test
  fun theGoScreenIsOpenNotRunning() {
    // Fit 4 Pro, 2026-10-25: Outdoor walk opened, GO not pressed (16:09:32, 12:07:22), then after GO (12:07:43).
    val goScreen = WatchWorkoutWire.parseStatus(HuaweiTLV().parse(hex("81 06  02 01 00  03 01 01")))!!
    assertEquals(0, goScreen.trainMonitorState)
    assertEquals(1, goScreen.operator)
    assertEquals(WatchPhase.OPEN, goScreen.phase)
    assertFalse(goScreen.running)
    val afterGo = WatchWorkoutWire.parseStatus(HuaweiTLV().parse(hex("81 06  02 01 01  03 01 03")))!!
    assertEquals(WatchPhase.RUNNING, afterGo.phase)
    assertTrue(afterGo.running)
  }

  @Test
  fun noticeFromTheWatchCarriesOperatorAndWorkoutType() {
    val notice = WatchWorkoutWire.parseNotice(HuaweiTLV().parse(hex("81 09  02 01 04  03 01 01  05 01 8c")))!!
    assertEquals(WatchWorkoutWire.OP_STOP, notice.operator)
    assertEquals(140, notice.workoutType)
  }

  @Test
  fun noticeIsAnsweredWithTheSuccessCode() {
    val ack = WatchWorkoutWire.noticeAck(plain)
    assertEquals(0x02.toByte(), ack.commandId)
    assertArrayEquals(hex("7f 04 000186a0"), ack.getTlv().serialize())
  }

  @Test
  fun strengthTrainingIsTheCodeOfTheSportTable() {
    assertEquals("STRENGTH_TRAINING", WorkoutSportTypes.kind(WatchWorkoutWire.SPORT_STRENGTH_TRAINING))
  }
}
