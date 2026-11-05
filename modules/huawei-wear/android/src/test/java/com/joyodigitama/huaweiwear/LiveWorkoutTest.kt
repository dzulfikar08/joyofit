package com.joyodigitama.huaweiwear

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LiveWorkoutTest {
  @Test
  fun signedBytesSignExtendsAnyWidthWhileSignedWhenFourDoesNot() {
    // Altitude -10 m sent as two bytes FF F6.
    assertEquals(65526, LiveWorkoutWire.signedWhenFour(hex("FF F6")))
    assertEquals(-10, LiveWorkoutWire.signedBytes(hex("FF F6")))
    // One byte, three bytes, and the four-byte case both already handle.
    assertEquals(-1, LiveWorkoutWire.signedBytes(hex("FF")))
    assertEquals(-10, LiveWorkoutWire.signedBytes(hex("FF FF F6")))
    assertEquals(-10, LiveWorkoutWire.signedBytes(hex("FF FF FF F6")))
    // Positive altitude and status-sized values are unchanged.
    assertEquals(1234, LiveWorkoutWire.signedBytes(hex("04 D2")))
    assertEquals(100014, LiveWorkoutWire.signedBytes(hex("01 86 AE")))
    assertNull(LiveWorkoutWire.signedBytes(hex("00 00 00 00 00")))
  }

  private fun hex(s: String): ByteArray = s.replace(" ", "").chunked(2).map { it.toInt(16).toByte() }.toByteArray()

  private val plain = HuaweiPacket.ParamsProvider().also { it.setTransactionsCrypted(false); it.setSliceSize(1022) }

  @Test
  fun acceptingAStartMatchesHuaweiHealthsReply() {
    // The reply layout of the control event (accepting a start).
    val packet = DataSyncWire.event(plain, LiveWorkoutWire.PHONE_PKG, LiveWorkoutWire.WATCH_PKG, LiveWorkoutWire.EVENT_CONTROL, 0, LiveWorkoutWire.reply(LiveWorkoutWire.OP_START))
    assertArrayEquals(
      hex("011468772e73706f72742e6c696e6b6167652e617070021768772e73706f72742e6c696e6b6167652e64657669636503042fb5228e0401000506020100040100"),
      packet.getTlv().serialize(),
    )
  }

  @Test
  fun controlEventCarriesTypeOperationAndStatus() {
    val control = LiveWorkoutWire.parseControl(hex("01 01 02  02 01 00  03 08 00 00 01 92 00 00 00 00  05 01 01"))
    assertEquals(2, control.workoutType)
    assertEquals(LiveWorkoutWire.OP_START, control.operation)
    assertEquals(LiveWorkoutWire.WATCH_RUNNING, control.status)
  }

  @Test
  fun pointsAreScaledToDisplayUnits() {
    val values = listOf(
      PointValue(LiveWorkoutWire.KEY_HEART_RATE, hex("78")),
      PointValue(LiveWorkoutWire.KEY_DURATION, hex("41")),
      PointValue(LiveWorkoutWire.KEY_DISTANCE, hex("05DC")), // 1500 dm
      PointValue(LiveWorkoutWire.KEY_CALORIES, hex("01E078")), // 123000 cal
      PointValue(LiveWorkoutWire.KEY_SPEED, hex("01F4")), // 5.00 km/h
      PointValue(LiveWorkoutWire.KEY_AEROBIC_TE, hex("1F")),
      PointValue(12345, hex("FF")),
    )
    val m = LiveMetrics().applyPoint(values)
    assertEquals(120, m.heartRate)
    assertEquals(65, m.durationSec)
    assertEquals(150.0, m.distanceM!!, 1e-9)
    assertEquals(123.0, m.calories!!, 1e-9)
    assertEquals(5.0, m.speedKmh!!, 1e-9)
    assertEquals(3.1, m.aerobicTe!!, 1e-9)
  }

  @Test
  fun aPushKeepsWhatItDoesNotRepeat() {
    val first = LiveMetrics().applyPoint(listOf(PointValue(LiveWorkoutWire.KEY_STEPS, hex("64")), PointValue(LiveWorkoutWire.KEY_HEART_RATE, hex("50"))))
    val second = first.applyPoint(listOf(PointValue(LiveWorkoutWire.KEY_HEART_RATE, hex("5A"))))
    assertEquals(100, second.steps)
    assertEquals(90, second.heartRate)
  }

  @Test
  fun altitudeIsSignedOnlyInFourBytes() {
    assertEquals(-12, LiveMetrics().applyPoint(listOf(PointValue(LiveWorkoutWire.KEY_ALTITUDE, hex("FFFFFFF4")))).altitudeM)
    assertEquals(244, LiveMetrics().applyPoint(listOf(PointValue(LiveWorkoutWire.KEY_ALTITUDE, hex("F4")))).altitudeM)
  }

  @Test
  fun malformedValuesLeaveTheMetricUnset() {
    val m = LiveMetrics().applyPoint(listOf(PointValue(LiveWorkoutWire.KEY_HEART_RATE, null), PointValue(LiveWorkoutWire.KEY_STEPS, ByteArray(5))))
    assertNull(m.heartRate)
    assertNull(m.steps)
  }

  @Test
  fun easyEffortBurnsMoreFatThanHardEffort() {
    val max = SubstrateEstimator.maxHeartRate(35)
    val walk = SubstrateEstimator.fatShare(105, max)
    val run = SubstrateEstimator.fatShare(165, max)
    assertTrue("walk $walk run $run", walk > 0.6 && run < 0.35 && walk > run)
    // Clamped at both ends of the curve.
    assertEquals(SubstrateEstimator.fatShare(40, max), SubstrateEstimator.fatShare(60, max), 1e-9)
    assertEquals(0.0, SubstrateEstimator.fatShare(200, max), 1e-9)
  }

  @Test
  fun caloriesAreSplitAsTheyAccrueAndNeverTwice() {
    val max = SubstrateEstimator.maxHeartRate(35)
    val estimator = SubstrateEstimator(max)
    estimator.update(10.0, 110) // first figure: no delta yet
    estimator.update(19.0, 110)
    estimator.update(19.0, 110) // same total again: nothing
    estimator.update(28.0, null) // no heart rate: not attributed
    estimator.update(37.0, 110)
    val share = SubstrateEstimator.fatShare(110, max)
    assertEquals(18.0 * share / 9.0, estimator.fatGrams, 1e-9)
    assertEquals(18.0 * (1 - share) / 4.0, estimator.carbGrams, 1e-9)
  }
}
