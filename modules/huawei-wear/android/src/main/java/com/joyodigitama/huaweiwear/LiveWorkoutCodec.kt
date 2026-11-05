package com.joyodigitama.huaweiwear

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV

/**
 * Huawei Health's "reverse linkage": a workout started on the watch, mirrored live on the phone. Modelled on the behaviour of Huawei Health
 * 17.0.8.300. Everything is DataSync (0x37) between the watch's
 * `hw.sport.linkage.device` and the phone's `hw.sport.linkage.app`:
 *  - `37/02` events: [EVENT_CONTROL] (start / stop / resume / report, the phone answers start, stop and resume) and
 *    [EVENT_START] .. [EVENT_RESUME] (no answer),
 *  - `37/03` points: one list of `{dict field id, big-endian value}` per push, see [applyPoint].
 */
internal object LiveWorkoutWire {
  const val PHONE_PKG = "hw.sport.linkage.app"
  const val WATCH_PKG = "hw.sport.linkage.device"

  /** 800400014: linkage control; data `01 workoutType, 02 operation, 03 time ms, 04 reply code, 05 status`. */
  const val EVENT_CONTROL = 800400014
  const val EVENT_START = 800400002
  const val EVENT_STOP = 800400003
  const val EVENT_PAUSE = 800400004
  const val EVENT_RESUME = 800400005

  const val OP_START = 0
  const val OP_STOP = 1
  const val OP_RESUME = 2
  const val OP_REPORT = 3

  /** Tag 05 of a control event: the watch's own state (`TrackMainMapActivity.initStatus`). */
  const val WATCH_PRE_SPORT = 0
  const val WATCH_RUNNING = 1
  const val WATCH_PAUSED = 2

  class Control(val workoutType: Int?, val operation: Int?, val status: Int?)

  fun parseControl(data: ByteArray?): Control {
    val tlv = HuaweiTLV().parse(data ?: ByteArray(0))
    return Control(uint(tlv, 0x01)?.toInt(), uint(tlv, 0x02)?.toInt(), uint(tlv, 0x05)?.toInt())
  }

  /** Tag 02 of a start / stop / pause / resume event. */
  fun parseWorkoutType(data: ByteArray?): Int? = uint(HuaweiTLV().parse(data ?: ByteArray(0)), 0x02)?.toInt()

  /** Control reply layout: `02 <operation> 04 <code>`, code 0 accepts. Huawei writes both as minimal-length ints. */
  fun reply(operation: Int, code: Int = 0): ByteArray = byteArrayOf(0x02, 0x01, operation.toByte(), 0x04, 0x01, code.toByte())

  // Live point keys (dictionary field ids; `olk.c` allow-list, units from `MirrorLinkDataSource` / `getLinkageBundle`).
  const val KEY_DURATION = 50004396 // s
  const val KEY_HEART_RATE = 50004838 // bpm
  const val KEY_DISTANCE = 50004765 // dm
  const val KEY_CALORIES = 50004829 // cal (kcal x 1000)
  const val KEY_ACTIVE_CALORIES = 50004617 // cal, as calories (unverified)
  const val KEY_SPEED = 50004799 // km/h x 100
  const val KEY_PACE = 50004979 // s per km
  const val KEY_STEP_RATE = 50004721 // steps/min
  const val KEY_STEPS = 50004684
  const val KEY_CADENCE = 50004254 // cycling rpm
  const val KEY_ALTITUDE = 50004286 // m, signed when 4 bytes
  const val KEY_RISE = 50004395 // m
  const val KEY_DESCENT = 50004774 // m
  const val KEY_AEROBIC_TE = 50004172 // x10
  const val KEY_ANAEROBIC_TE = 50004881 // x10
  const val KEY_HR_ZONE = 50004146 // zone number (inferred)
  const val KEY_STATE = 50004770 // 1 running, 2 paused, 3 stopped, 7 pre-sport

  /** `CommonUtil.y(hex)`: unsigned big-endian, one to four bytes; anything else is null. */
  fun unsigned(bytes: ByteArray?): Long? {
    if (bytes == null || bytes.isEmpty() || bytes.size > 4) return null
    var n = 0L
    for (b in bytes) n = (n shl 8) or (b.toLong() and 0xFF)
    return n
  }

  /** `cph.e`: big-endian, signed only when it is four bytes (a negative altitude). Kept for status codes (always positive). */
  fun signedWhenFour(bytes: ByteArray?): Int? {
    if (bytes == null || bytes.isEmpty() || bytes.size > 4) return null
    var n = 0
    for (b in bytes) n = (n shl 8) or (b.toInt() and 0xFF)
    return n
  }

  /**
   * Big-endian two's-complement over 1-4 bytes, sign-extended to the full Int width. Altitude is used only here: a value sent in
   * fewer than four bytes (the watch sends `-10 m` as `FF F6`) must read `-10`, not `65526` as [signedWhenFour] would. No range clamp:
   * plausibility is the caller's business, and the function is also what status codes would break on if they used it.
   */
  fun signedBytes(bytes: ByteArray?): Int? {
    if (bytes == null || bytes.isEmpty() || bytes.size > 4) return null
    var n = 0
    for (b in bytes) n = (n shl 8) or (b.toInt() and 0xFF)
    val shift = (4 - bytes.size) * 8
    return (n shl shift) shr shift
  }

  private fun uint(tlv: HuaweiTLV, tag: Int): Long? = if (tlv.contains(tag)) {
    val bytes = tlv.getBytes(tag, null)
    if (bytes == null || bytes.isEmpty() || bytes.size > 8) null else bytes.fold(0L) { acc, b -> (acc shl 8) or (b.toLong() and 0xFF) }
  } else {
    null
  }
}

/** What the live screen shows. Every metric is null until the watch has sent it. */
internal data class LiveMetrics(
  val durationSec: Int? = null,
  val heartRate: Int? = null,
  val distanceM: Double? = null,
  val calories: Double? = null,
  val activeCalories: Double? = null,
  val speedKmh: Double? = null,
  val paceSecPerKm: Int? = null,
  val stepRate: Int? = null,
  val steps: Int? = null,
  val cadence: Int? = null,
  val altitudeM: Int? = null,
  val riseM: Int? = null,
  val descentM: Int? = null,
  val aerobicTe: Double? = null,
  val anaerobicTe: Double? = null,
  val heartRateZone: Int? = null,
  /** `operator_type` of the point stream: 1 running, 2 paused, 3 stopped, 7 pre-sport. */
  val watchState: Int? = null,
) {
  /** This snapshot with the values of one `37/03` push laid over it; unknown keys are ignored. */
  fun applyPoint(values: List<PointValue>): LiveMetrics {
    var m = this
    for (v in values) {
      val raw = v.value
      m = when (v.key) {
        LiveWorkoutWire.KEY_DURATION -> LiveWorkoutWire.unsigned(raw)?.let { m.copy(durationSec = it.toInt()) }
        LiveWorkoutWire.KEY_HEART_RATE -> LiveWorkoutWire.unsigned(raw)?.let { m.copy(heartRate = it.toInt()) }
        LiveWorkoutWire.KEY_DISTANCE -> LiveWorkoutWire.unsigned(raw)?.let { m.copy(distanceM = it / 10.0) }
        LiveWorkoutWire.KEY_CALORIES -> LiveWorkoutWire.unsigned(raw)?.let { m.copy(calories = it / 1000.0) }
        LiveWorkoutWire.KEY_ACTIVE_CALORIES -> LiveWorkoutWire.unsigned(raw)?.let { m.copy(activeCalories = it / 1000.0) }
        LiveWorkoutWire.KEY_SPEED -> LiveWorkoutWire.unsigned(raw)?.let { m.copy(speedKmh = it / 100.0) }
        LiveWorkoutWire.KEY_PACE -> LiveWorkoutWire.unsigned(raw)?.let { m.copy(paceSecPerKm = it.toInt()) }
        LiveWorkoutWire.KEY_STEP_RATE -> LiveWorkoutWire.unsigned(raw)?.let { m.copy(stepRate = it.toInt()) }
        LiveWorkoutWire.KEY_STEPS -> LiveWorkoutWire.unsigned(raw)?.let { m.copy(steps = it.toInt()) }
        LiveWorkoutWire.KEY_CADENCE -> LiveWorkoutWire.unsigned(raw)?.let { m.copy(cadence = it.toInt()) }
        LiveWorkoutWire.KEY_ALTITUDE -> LiveWorkoutWire.signedBytes(raw)?.let { m.copy(altitudeM = it) }
        LiveWorkoutWire.KEY_RISE -> LiveWorkoutWire.unsigned(raw)?.let { m.copy(riseM = it.toInt()) }
        LiveWorkoutWire.KEY_DESCENT -> LiveWorkoutWire.unsigned(raw)?.let { m.copy(descentM = it.toInt()) }
        LiveWorkoutWire.KEY_AEROBIC_TE -> LiveWorkoutWire.unsigned(raw)?.let { m.copy(aerobicTe = it / 10.0) }
        LiveWorkoutWire.KEY_ANAEROBIC_TE -> LiveWorkoutWire.unsigned(raw)?.let { m.copy(anaerobicTe = it / 10.0) }
        LiveWorkoutWire.KEY_HR_ZONE -> LiveWorkoutWire.unsigned(raw)?.let { m.copy(heartRateZone = it.toInt()) }
        LiveWorkoutWire.KEY_STATE -> LiveWorkoutWire.unsigned(raw)?.let { m.copy(watchState = it.toInt()) }
        else -> null
      } ?: m
    }
    return m
  }
}

/**
 * Fat and carbohydrate burned, estimated by JoyoFit (the watch sends neither and Huawei Health computes neither). Each
 * calorie increase of the workout is split by the intensity at that moment:
 *  - %HRmax to %VO2max with Swain et al. (1994): `%HRmax = 0.64 x %VO2max + 37`, HRmax = 220 - age (Huawei's own rule),
 *  - %VO2max to the respiratory exchange ratio along a piecewise line through typical values (Romijn 1993, Achten 2003):
 *    25% 0.78, 45% 0.83, 65% 0.88, 85% 0.95, 100% 1.00,
 *  - RER to the fat share of energy with the non-protein table's linear form (Lusk): `(1.00 - RER) / 0.30`,
 *  - grams with Atwater: 9 kcal per gram of fat, 4 per gram of carbohydrate.
 * An estimate for motivation, not a measurement: it ignores fitness, diet and the protein share.
 */
internal class SubstrateEstimator(private val maxHeartRate: Int) {
  var fatKcal = 0.0
    private set
  var carbKcal = 0.0
    private set
  private var lastCalories: Double? = null

  val fatGrams: Double get() = fatKcal / KCAL_PER_G_FAT
  val carbGrams: Double get() = carbKcal / KCAL_PER_G_CARB

  /** Attributes the calories since the previous call to fat and carbohydrate at [heartRate]; no heart rate, no split. */
  fun update(totalCalories: Double?, heartRate: Int?) {
    if (totalCalories == null) return
    val previous = lastCalories
    lastCalories = totalCalories
    if (previous == null || heartRate == null || heartRate <= 0) return
    val delta = totalCalories - previous
    if (delta <= 0.0) return
    val fat = fatShare(heartRate, maxHeartRate)
    fatKcal += delta * fat
    carbKcal += delta * (1.0 - fat)
  }

  companion object {
    const val KCAL_PER_G_FAT = 9.0
    const val KCAL_PER_G_CARB = 4.0

    private val RER_POINTS = listOf(25.0 to 0.78, 45.0 to 0.83, 65.0 to 0.88, 85.0 to 0.95, 100.0 to 1.00)

    fun maxHeartRate(age: Int): Int = (220 - age).coerceIn(120, 220)

    /** Share of energy from fat (0..1) at [heartRate] for [maxHeartRate]. */
    fun fatShare(heartRate: Int, maxHeartRate: Int): Double {
      val pctHrMax = 100.0 * heartRate / maxHeartRate
      val pctVo2 = ((pctHrMax - 37.0) / 0.64).coerceIn(RER_POINTS.first().first, RER_POINTS.last().first)
      val rer = interpolate(pctVo2)
      return ((1.0 - rer) / 0.30).coerceIn(0.0, 1.0)
    }

    private fun interpolate(x: Double): Double {
      for (i in 1 until RER_POINTS.size) {
        val (x1, y1) = RER_POINTS[i]
        if (x <= x1) {
          val (x0, y0) = RER_POINTS[i - 1]
          return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
        }
      }
      return RER_POINTS.last().second
    }
  }
}

/**
 * Energy from heart rate, for when the watch sends no calories live: Keytel et al. (2005), kJ per minute from heart rate,
 * weight, age and sex, divided by 4.184 for kcal. Sex unknown uses the mean of both equations. Below about 90 bpm the
 * equation drifts towards zero, so it never goes under a resting 1.2 kcal per minute.
 */
internal object HeartRateEnergy {
  fun kcalPerMinute(heartRate: Int, weightKg: Double, age: Int, sex: String): Double {
    val male = (-55.0969 + 0.6309 * heartRate + 0.1988 * weightKg + 0.2017 * age) / 4.184
    val female = (-20.4022 + 0.4472 * heartRate - 0.1263 * weightKg + 0.074 * age) / 4.184
    val kcal = when (sex) {
      "male" -> male
      "female" -> female
      else -> (male + female) / 2
    }
    return kcal.coerceAtLeast(REST_KCAL_PER_MIN)
  }

  const val REST_KCAL_PER_MIN = 1.2
}
