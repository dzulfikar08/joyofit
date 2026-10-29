package com.joyodigitama.huaweiwear

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Synthetic fixtures only: made-up values in the layout the community converters describe. */
class HuaweiExportParsersTest {
  private class Recorder : HuaweiImportCollector {
    val heartRate = ArrayList<Pair<Long, Int>>()
    val resting = ArrayList<Pair<Long, Int>>()
    val spo2 = ArrayList<Pair<Long, Int>>()
    val sleep = ArrayList<ImportedSleep>()
    val metrics = ArrayList<ImportedMetric>()
    val sleepScores = ArrayList<ImportedSleepScore>()
    val dayTotals = ArrayList<ImportedDayTotal>()
    val steps = ArrayList<List<Number>>()
    val unmapped = ArrayList<String>()
    val weighIns = ArrayList<ImportedWeighIn>()
    val meals = ArrayList<ImportedMeal>()
    val water = ArrayList<Triple<String, Int, String>>()
    val facts = ArrayList<Triple<String, Double, Long>>()
    val rejectedKeys = ArrayList<Triple<String, String, String?>>()
    val rejected get() = rejectedKeys.size

    override fun heartRate(tsSec: Long, bpm: Int) { heartRate.add(tsSec to bpm) }
    override fun restingHeartRate(tsSec: Long, bpm: Int) { resting.add(tsSec to bpm) }
    override fun spo2(tsSec: Long, percent: Int) { spo2.add(tsSec to percent) }
    override fun sleep(segment: ImportedSleep) { sleep.add(segment) }
    override fun metric(point: ImportedMetric) { metrics.add(point) }
    override fun sleepScore(score: ImportedSleepScore) { sleepScores.add(score) }
    override fun dayTotal(total: ImportedDayTotal) { dayTotals.add(total) }
    override fun steps(minuteSec: Long, steps: Int, distance: Int, calories: Int) { this.steps.add(listOf(minuteSec, steps, distance, calories)) }
    override fun weighIn(weighIn: ImportedWeighIn) { weighIns.add(weighIn) }
    override fun meal(meal: ImportedMeal) { meals.add(meal) }
    override fun water(date: String, ml: Int, key: String) { water.add(Triple(date, ml, key)) }
    override fun profileFact(kind: String, value: Double, tsMs: Long) { facts.add(Triple(kind, value, tsMs)) }
    override fun unmapped(key: String) { unmapped.add(key) }
    override fun rejected(key: String, reason: String, sample: String?) { rejectedKeys.add(Triple(key, reason, sample)) }
  }

  private val t0 = 1_750_000_020_000L // a whole minute

  private fun point(key: String, startMs: Long, endMs: Long, value: String) =
    """{"key":"$key","startTime":$startMs,"endTime":$endMs,"unit":"0","value":${JSONObject.quote(value)}}"""

  private fun healthRecord(vararg points: String) =
    JSONObject("""{"type":7,"startTime":$t0,"endTime":${t0 + 60_000},"timeZone":"+0700","deviceCode":1,"recordId":"r","samplePoints":[${points.joinToString(",")}]}""")

  @Test
  fun heartRateRestingAndSpo2AreMappedByKey() {
    val out = Recorder()
    HuaweiHealthDetailParser.parse(
      healthRecord(
        point("DATA_POINT_DYNAMIC_HEARTRATE", t0 + 5_000, t0 + 5_000, "82.0"),
        point("DATA_POINT_REST_HEARTRATE", t0, t0 + 86_400_000, "58"),
        point("DATA_POINT_NEW_REST_HEARTRATE", t0 + 1000, t0 + 2000, "57.4"),
        point("BLOOD_OXYGEN_SATURATION", t0 + 10_000, t0 + 10_000, """{"avgSaturation":97.0,"maxSaturation":99}"""),
        point("BLOOD_OXYGEN_SATURATION", t0 + 70_000, t0 + 70_000, "96"),
      ),
      out,
    )
    assertEquals(listOf(1_750_000_025L to 82), out.heartRate)
    assertEquals(listOf(1_750_000_020L to 58, 1_750_000_021L to 57), out.resting)
    assertEquals(listOf(1_750_000_030L to 97, 1_750_000_090L to 96), out.spo2)
    assertEquals(0, out.rejected)
  }

  @Test
  fun implausibleValuesAreRejectedNotStored() {
    val out = Recorder()
    HuaweiHealthDetailParser.parse(
      healthRecord(
        point("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "0"),
        point("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "400"),
        point("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "n/a"),
        point("BLOOD_OXYGEN_SATURATION", t0, t0, "{}"),
        point("STRESS_DATA", t0, t0, """{"score":0}"""),
      ),
      out,
    )
    assertTrue(out.heartRate.isEmpty())
    assertTrue(out.spo2.isEmpty())
    assertTrue(out.metrics.isEmpty())
    assertEquals(5, out.rejected)
    // Each drop says what and why, so the import summary can show it.
    assertEquals(
      listOf(
        Triple("DATA_POINT_DYNAMIC_HEARTRATE", "out-of-range", "0"),
        Triple("DATA_POINT_DYNAMIC_HEARTRATE", "out-of-range", "400"),
        Triple("DATA_POINT_DYNAMIC_HEARTRATE", "no-number", "n/a"),
        Triple("BLOOD_OXYGEN_SATURATION", "no-number", "{}"),
        Triple("STRESS_DATA", "out-of-range", "0"),
      ),
      out.rejectedKeys,
    )
  }

  @Test
  fun sleepStagesBecomeSegmentsWithTheWatchsRawKinds() {
    val out = Recorder()
    val h = 3_600_000L
    HuaweiHealthDetailParser.parse(
      healthRecord(
        point("PROFESSIONAL_SLEEP_SHALLOW", t0, t0 + h, ""),
        point("PROFESSIONAL_SLEEP_DEEP", t0 + h, t0 + 2 * h, ""),
        point("PROFESSIONAL_SLEEP_DREAM", t0 + 2 * h, t0 + 3 * h, ""),
        point("PROFESSIONAL_SLEEP_WAKE", t0 + 3 * h, t0 + 3 * h + 60_000, ""),
        point("PROFESSIONAL_SLEEP_NOON", t0 + 5 * h, t0 + 6 * h, ""),
        point("PROFESSIONAL_SLEEP_DEEP", t0 + h, t0 + h, ""),
      ),
      out,
    )
    assertEquals(listOf(0x06, 0x07, 0x5656, 0x5658, 0x5659), out.sleep.map { it.type })
    assertEquals(listOf("light", "deep", "rem", "awake", "light"), out.sleep.map { it.stage })
    assertEquals(1_750_000_020L, out.sleep[0].start)
    assertEquals(1_750_000_020L + 3600, out.sleep[0].end)
    // The span with no length is rejected.
    assertEquals(1, out.rejected)
  }

  @Test
  fun stressScoreComesFromTheEmbeddedObject() {
    val out = Recorder()
    HuaweiHealthDetailParser.parse(healthRecord(point("STRESS_DATA", t0, t0, """{"score":42,"level":2}""")), out)
    assertEquals(1, out.metrics.size)
    assertEquals("emotion", out.metrics[0].type)
    assertEquals(42.0, out.metrics[0].value, 0.0)
    assertEquals(1_750_000_020L, out.metrics[0].ts)
  }

  @Test
  fun otherKeysAreCountedAsUnmapped() {
    val out = Recorder()
    HuaweiHealthDetailParser.parse(
      healthRecord(point("WEIGHT_BODYFAT_BROAD", t0, t0, """{"bodyWeight":70}"""), point("EXERCISE_INTENSITY", t0, t0, "3")),
      out,
    )
    assertEquals(listOf("EXERCISE_INTENSITY"), out.unmapped)
    assertEquals(1, out.weighIns.size)
  }

  @Test
  fun samplePointsFallBackToTheRecordTimes() {
    val out = Recorder()
    val record = JSONObject("""{"startTime":$t0,"endTime":${t0 + 1000},"samplePoints":[{"key":"DATA_POINT_DYNAMIC_HEARTRATE","value":"70"}]}""")
    HuaweiHealthDetailParser.parse(record, out)
    assertEquals(listOf(1_750_000_020L to 70), out.heartRate)
  }

  @Test
  fun sportPerMinuteWalksTheMinutesOfAnEntry() {
    val out = Recorder()
    val record = JSONObject(
      """{"recordDay":20250615,"sportDataUserData":[{"startTime":$t0,"endTime":${t0 + 240_000},"sportType":5,"sportBasicInfos":[
           {"steps":0,"distance":0,"calorie":10,"duration":1},
           {"steps":42,"distance":30,"calorie":9900,"duration":1},
           {"steps":50,"distance":36,"duration":2},
           {"steps":9999,"distance":1,"duration":1},
           {"steps":10,"distance":7,"duration":1}]}]}""",
    )
    HuaweiSportPerMinuteParser.parse(record, out)
    // Minute 0 has nothing; minute 1 and 2 are read; the info with duration 2 skips minute 3; 9999 steps is rejected.
    assertEquals(
      // calorie 10 alone is a reading (10 cal) and is kept; the calories are small calories, as the watch's own.
      listOf(listOf(1_750_000_020L, 0L, 0L, 10L), listOf(1_750_000_080L, 42L, 30L, 9900L), listOf(1_750_000_140L, 50L, 36L, 0L), listOf(1_750_000_320L, 10L, 7L, 0L)),
      out.steps.map { row -> row.map { it.toLong() } },
    )
    assertEquals(1, out.rejected)
  }

  // Motion path

  private fun attribute(vararg lines: String) = "HW_EXT_TRACK_DETAIL@is\n" + lines.joinToString("\n") + "\n"

  private val trackLines = arrayOf(
    "tp=lbs;k=0;lat=-6.2000000;lon=106.8000000;alt=0.0;t=1.75000002E9;",
    "tp=h-r;k=1750000021000;v=120;",
    "tp=lbs;k=1;lat=-6.2001000;lon=106.8001000;alt=7.5;t=1.750000021E9;",
    "tp=alti;k=1750000021000;v=12.5;",
    "tp=lbs;k=2;lat=90.0;lon=-80.0;alt=0.0;t=1.750000022E9;",
    "tp=lbs;k=3;lat=-6.2010000;lon=106.8010000;alt=8.0;t=1.750000100E9;",
    "tp=h-r;k=1750000100000;v=150;",
    "tp=h-r;k=1750000110000;v=0;",
    "tp=s-r;k=1750000100000;v=160;",
    "tp=p-m;k=1;v=300;",
  )

  private fun motionJson(sportType: Int = 4, totalCalories: Double = 90_000.0) = JSONObject(
    mapOf(
      "abnormalTrack" to "",
      "sportType" to sportType,
      "startTime" to t0,
      "endTime" to t0 + 600_000,
      "timeZone" to "+0700",
      "totalSteps" to 1200,
      "totalDistance" to 1500,
      "totalCalories" to totalCalories,
      "totalTime" to 540_000,
      "attribute" to attribute(*trackLines),
    ),
  )

  @Test
  fun motionPathBecomesAWorkoutWithRouteHeartRateAndAltitude() {
    val workout = HuaweiMotionPathParser.build(HuaweiMotionPathParser.fromJson(motionJson()))
    assertNotNull(workout)
    workout!!
    assertEquals(1_750_000_020L, workout.start)
    assertEquals(1_750_000_620L, workout.end)
    assertEquals(600, workout.duration)
    assertEquals(1, workout.sportType)
    assertEquals("Running", workout.sportName)
    assertEquals(1500, workout.distance)
    assertEquals(90, workout.calories)
    assertEquals(1200, workout.steps)
    // The reading of 0 bpm is dropped.
    assertEquals(135, workout.avgHr)
    assertEquals(150, workout.maxHr)

    val gps = workout.points.filter { it.lat != null }
    // The pause marker is not a point; its neighbours are.
    assertEquals(3, gps.size)
    assertNull(gps[0].alt) // alt=0.0 means "none"
    assertEquals(7.5, gps[1].alt!!, 0.0)
    assertEquals(2, workout.points.count { it.hr != null })
    assertEquals(1, workout.points.count { it.lat == null && it.alt != null })
    // tp=s-r is cadence in steps per minute at its own timestamp; tp=p-m (a per-km pace summary) is not a point.
    val cadence = workout.points.filter { it.cadence != null }
    assertEquals(1, cadence.size)
    assertEquals(1_750_000_100L, cadence[0].ts)
    assertEquals(160, cadence[0].cadence)
    assertTrue(workout.points.all { it.speed == null && it.stride == null && it.power == null })
    assertEquals(workout.points.map { it.ts }, workout.points.map { it.ts }.sorted())

    val summary = JSONObject(workout.summaryJson)
    assertEquals("RUNNING", summary.getString("kind"))
    assertEquals("ok", summary.getString("gps"))
    assertEquals(3, summary.getInt("gpsPoints"))
    assertEquals("huawei-export", summary.getString("source"))
    assertEquals(4, summary.getInt("huaweiSportType"))
    assertEquals(540L, summary.getLong("movingTimeSec"))
    assertEquals(1500.0 / 600, summary.getDouble("avgSpeed"), 1e-9)
    assertEquals(1000.0 / (1500.0 / 600), summary.getDouble("avgPaceSecPerKm"), 1e-6)
  }

  @Test
  fun sportIdsOutsideTheKnownTableStayUnnamedWorkouts() {
    assertEquals(3, HuaweiExportSports.joyofitType(3))
    assertEquals(2, HuaweiExportSports.joyofitType(5))
    assertEquals("Biking", HuaweiExportSports.name(3))
    val workout = HuaweiMotionPathParser.build(HuaweiMotionPathParser.fromJson(motionJson(sportType = 77)))!!
    assertEquals(HuaweiExportSports.OTHER, workout.sportType)
    assertEquals("Workout (Huawei type 77)", workout.sportName)
    assertEquals(77, JSONObject(workout.summaryJson).getInt("huaweiSportType"))
  }

  @Test
  fun caloriesInSmallCaloriesAreScaledDown() {
    assertEquals(90, HuaweiMotionPathParser.kcal(90_000.0))
    assertEquals(285, HuaweiMotionPathParser.kcal(285_000.0))
    assertEquals(0, HuaweiMotionPathParser.kcal(0.0))
    assertEquals(0, HuaweiMotionPathParser.kcal(null))
  }

  @Test
  fun distanceFallsBackToTheTrackAndSkipsPauses() {
    val json = motionJson()
    json.put("totalDistance", 0)
    val workout = HuaweiMotionPathParser.build(HuaweiMotionPathParser.fromJson(json))!!
    // First two fixes are ~15.7 m apart; the third follows a pause and starts a new segment.
    assertTrue(workout.distance in 14..18)
  }

  @Test
  fun workoutWithoutAnyTimeIsNotImported() {
    val raw = HuaweiMotionPathParser.fromJson(JSONObject("""{"sportType":4,"attribute":""}"""))
    assertNull(HuaweiMotionPathParser.build(raw))
  }

  @Test
  fun totalTimeInSecondsIsRecognisedToo() {
    val json = motionJson()
    json.put("totalTime", 540)
    val workout = HuaweiMotionPathParser.build(HuaweiMotionPathParser.fromJson(json))!!
    assertEquals(540L, JSONObject(workout.summaryJson).getLong("movingTimeSec"))
  }

  @Test
  fun brokenMotionTextIsReadStraightOffTheRawText() {
    // A stray quote in the attribute makes this invalid JSON; the line records are still readable.
    val raw = """{"abnormalTrack":"","sportType":4,"startTime":$t0,"endTime":${t0 + 600_000},"totalDistance":1500,"totalCalories":90,""" +
      """"partTimeMap":{1.0:439.0},"attribute":"HW_EXT_TRACK_DETAIL@is\ntp=lbs;k=0;lat=-6.2;lon=106.8;alt=0.0;t=1.75000002E9;\n""" +
      """tp=h-r;k=1750000021000;v=120;\n"stray";\n"}"""
    assertNull(HuaweiExportJson.parseObject(raw))
    val workout = HuaweiMotionPathParser.build(HuaweiMotionPathParser.fromBrokenText(raw)!!)
    assertNotNull(workout)
    assertEquals(1, workout!!.sportType)
    assertEquals(1500, workout.distance)
    assertEquals(1, workout.points.count { it.lat != null })
    assertEquals(120, workout.avgHr)
    assertFalse(workout.points.isEmpty())
  }

  @Test
  fun elevationChangeIgnoresNoise() {
    val (gain, loss) = HuaweiMotionPathParser.elevationChange(listOf(10.0, 11.0, 9.5, 14.0, 20.0, 15.0, 15.5))
    assertEquals(10.0, gain, 1e-9)
    assertEquals(5.0, loss, 1e-9)
  }

  @Test
  fun weighInsAreReadFromEmbeddedBodyCompositionFields() {
    val out = Recorder()
    HuaweiHealthDetailParser.parse(
      healthRecord(
        point(
          "WEIGHT_BODYFAT_BROAD", t0 + 3_000, t0 + 3_000,
          """{"bodyWeight":71.5,"bodyFatRate":0.213,"muscleMass":52.1,"bodyWaterRate":55.2,"boneSalt":3.1,"bmi":22.4,"visceralFatLevel":8,"basal":1600,"impedance":512}""",
        ),
        point("WEIGHT_BODYFAT_BROAD", t0 + 9_000, t0 + 9_000, """{"bodyFatRate":400}"""),
      ),
      out,
    )
    assertEquals(1, out.weighIns.size)
    val w = out.weighIns[0]
    assertEquals(t0 + 3_000, w.tsMs)
    assertEquals(71.5, w.weightKg, 0.001)
    assertEquals(512.0, w.impedanceOhm!!, 0.001)
    val reported = JSONObject(w.reportedJson!!)
    assertEquals(21.3, reported.getDouble("bodyFatPct"), 0.001)
    assertEquals(52.1, reported.getDouble("muscleKg"), 0.001)
    assertEquals(55.2, reported.getDouble("waterPct"), 0.001)
    assertEquals(3.1, reported.getDouble("boneKg"), 0.001)
    assertEquals(22.4, reported.getDouble("bmi"), 0.001)
    assertEquals(8.0, reported.getDouble("visceralFat"), 0.001)
    // The same minute holds a point without a weight: merged into the first weighing, whose weight stands.
    assertEquals(0, out.rejected)
  }

  @Test
  fun weighInWithoutAPlausibleWeightIsRejected() {
    val out = Recorder()
    HuaweiHealthDetailParser.parse(healthRecord(point("WEIGHT_BODYFAT_BROAD", t0, t0, """{"bodyWeight":7,"bodyFatRate":20}""")), out)
    assertTrue(out.weighIns.isEmpty())
    assertEquals(listOf(Triple("weight", "no-weight", null)), out.rejectedKeys.map { Triple(it.first, it.second, it.third?.takeIf { s -> s != "7.0" }) })
  }

  @Test
  fun weightInGramsBecomesKilograms() {
    val out = Recorder()
    HuaweiHealthDetailParser.parse(healthRecord(point("BODY_WEIGHT", t0, t0, "70250")), out)
    assertEquals(70.25, out.weighIns.single().weightKg, 0.001)
  }

  @Test
  fun weightKeysAreRecognisedAndGoalKeysAreNot() {
    assertTrue(HuaweiWeightParser.isWeightKey("WEIGHT_BODYFAT_BROAD"))
    assertTrue(HuaweiWeightParser.isWeightKey("DATA_POINT_BODY_WEIGHT"))
    assertFalse(HuaweiWeightParser.isWeightKey("WEIGHT_GOAL"))
    assertFalse(HuaweiWeightParser.isWeightKey("DATA_POINT_DYNAMIC_HEARTRATE"))
  }

  // The layout of a real export (Oct 2026): summaryData / detailData / subType.

  private fun realMotion(subType: Int = 4, startMs: Long = t0) = JSONObject(
    JSONObject(
      mapOf(
        "appType" to 1,
        "startTime" to startMs,
        "endTime" to startMs + 700_000,
        "subType" to subType,
        "timeZone" to "+0700",
        "type" to 30001,
        "summaryData" to """{"avgHeartRate":101,"maxHeartRate":120,"minHeartRate":91,"totalCalories":285000,"totalDistance":2500,"totalSteps":3243,"totalTime":600000,"sportType":258,"creepingWave":120.0,"mTotalDescent":-1.0,"mMaxAlti":1.4E-45}""",
        "detailData" to "tp=lbs;k=0;lat=-6.2;lon=106.8;alt=0.0;t=${startMs / 1000}.0;\ntp=lbs;k=1;lat=-6.2001;lon=106.8001;alt=0.0;t=${startMs / 1000 + 1}.0;\n" +
          "tp=h-r;k=${startMs + 5_000};v=88;\ntp=s-r;k=${startMs + 5_000};v=130;\ntp=rs;k=0;v=-1;\ntp=rs;k=5;v=25;\ntp=rs;k=10;v=0;\ntp=p-m;k=10000219;v=217.0;\n",
      ),
    ).toString(),
  )

  @Test
  fun realRecordsTakeTotalsFromSummaryDataAndTheSportFromSubType() {
    val workout = HuaweiMotionPathParser.build(HuaweiMotionPathParser.fromJson(realMotion()))!!
    assertEquals(1, workout.sportType) // Huawei 4, outdoor running
    assertEquals("Running", workout.sportName)
    assertEquals(2500, workout.distance)
    assertEquals(285, workout.calories) // 285 000 cal
    assertEquals(3243, workout.steps)
    assertEquals(88, workout.avgHr) // the track's heart rate, not the summary's
    assertEquals(88, workout.maxHr)
    assertEquals(2, workout.points.count { it.lat != null })
    // tp=rs: seconds from the start, decimetres per second; -1 is no speed.
    val speeds = workout.points.filter { it.speed != null }
    assertEquals(listOf(workout.start + 5, workout.start + 10), speeds.map { it.ts })
    assertEquals(listOf(2.5, 0.0), speeds.map { it.speed })
    val summary = JSONObject(workout.summaryJson)
    assertEquals(12.0, summary.getDouble("elevationGain"), 1e-9)
    assertEquals(false, summary.has("elevationLoss"))
    assertEquals(4, summary.getInt("huaweiSportType"))
  }

  @Test
  fun aWorkoutWithoutATrackUsesTheSummaryHeartRate() {
    val record = JSONObject(realMotion(subType = 117).toString().replace("tp=h-r", "tp=x-x"))
    val workout = HuaweiMotionPathParser.build(HuaweiMotionPathParser.fromJson(record))!!
    assertEquals(140, workout.sportType) // free weights are strength training
    assertEquals(101, workout.avgHr)
    assertEquals(120, workout.maxHr)
  }

  /** A real-layout record as raw text: [summary] is the summaryData text with its quotes escaped, as in the file, [detail] the track. */
  private fun brokenRealMotion(summary: String, detail: String) =
    """{"appType":1,"startTime":$t0,"endTime":${t0 + 700_000},"subType":4,"timeZone":"+0700","type":30001,""" +
      """"summaryData":"$summary","detailData":"$detail"}"""

  @Test
  fun aBrokenRealRecordStillGetsItsSportAndTotals() {
    val raw = brokenRealMotion(
      summary = """{\"avgHeartRate\":101,\"maxHeartRate\":120,\"totalCalories\":285000,\"totalDistance\":2500,\"totalSteps\":3243,\"totalTime\":600000,\"sportType\":258}""",
      detail = """tp=lbs;k=0;lat=-6.2;lon=106.8;alt=0.0;t=${t0 / 1000}.0;\n"stray";\n""",
    )
    assertNull(HuaweiExportJson.parseObject(raw))
    val workout = HuaweiMotionPathParser.build(HuaweiMotionPathParser.fromBrokenText(raw)!!)!!
    assertEquals(1, workout.sportType) // subType 4, not the summary's 258
    assertEquals("Running", workout.sportName)
    assertEquals(2500, workout.distance)
    assertEquals(285, workout.calories)
    assertEquals(3243, workout.steps)
    assertEquals(101, workout.avgHr) // no heart rate in the track: the summary's
    assertEquals(1, workout.points.count { it.lat != null })
  }

  @Test
  fun aBrokenSummaryIsStillReadKeyByKey() {
    val raw = brokenRealMotion(
      summary = """{\"totalDistance\":2500,\"totalCalories\":285000,\"note\":"x"}""",
      detail = """tp=lbs;k=0;lat=-6.2;lon=106.8;alt=0.0;t=${t0 / 1000}.0;\n""",
    )
    assertNull(HuaweiExportJson.parseObject(raw))
    val workout = HuaweiMotionPathParser.build(HuaweiMotionPathParser.fromBrokenText(raw)!!)!!
    assertEquals(1, workout.sportType)
    assertEquals(2500, workout.distance)
    assertEquals(285, workout.calories)
  }

  @Test
  fun huaweiSportIdsMapToTheWatchsTable() {
    assertEquals(1, HuaweiExportSports.joyofitType(4))
    assertEquals(2, HuaweiExportSports.joyofitType(5))
    assertEquals(3, HuaweiExportSports.joyofitType(3))
    assertEquals(6, HuaweiExportSports.joyofitType(102))
    assertEquals(7, HuaweiExportSports.joyofitType(103))
    assertEquals(139, HuaweiExportSports.joyofitType(116))
    assertEquals(13, HuaweiExportSports.joyofitType(281))
    assertEquals(140, HuaweiExportSports.joyofitType(140))
    assertEquals(HuaweiExportSports.OTHER, HuaweiExportSports.joyofitType(283))
    assertEquals("Workout (Huawei type 283)", HuaweiExportSports.name(283))
  }

  // Sample sequence

  @Test
  fun sleepDetailsBecomeASleepScoreAndOtherSequencesAreCounted() {
    val out = Recorder()
    HuaweiSampleSequenceParser.parse(
      JSONObject(
        """{"type":"700013","startTime":"1750000020000","endTime":"1750030020000","summaryData":"{\"sleepScore\":85,\"sleepEfficiency\":97,\"bedTime\":1750000000}"}""",
      ),
      out,
    )
    HuaweiSampleSequenceParser.parse(JSONObject("""{"type":"700021","startTime":"1750000020000","endTime":"1750000080000","summaryData":""}"""), out)
    HuaweiSampleSequenceParser.parse(JSONObject("""{"type":"700013","startTime":"1750000020000","endTime":"1750030020000","summaryData":"{\"sleepScore\":0}"}"""), out)
    HuaweiSampleSequenceParser.parse(JSONObject("""{"type":"700013","startTime":"1750000020000","endTime":"1750030020000","summaryData":"{\"sleepScore\":120}"}"""), out)
    assertEquals(1, out.sleepScores.size)
    assertEquals(1_750_000_020L, out.sleepScores[0].start)
    assertEquals(1_750_030_020L, out.sleepScores[0].end)
    assertEquals(85, out.sleepScores[0].score)
    assertEquals(97, out.sleepScores[0].efficiency)
    assertEquals(listOf("SEQUENCE_700021"), out.unmapped)
    assertEquals(listOf(Triple("SLEEP_DETAILS", "out-of-range", "120")), out.rejectedKeys)
  }

  // Health detail, the real field names

  @Test
  fun bloodOxygenTakesEitherGenerationsFieldAndHeartRateEitherType() {
    val out = Recorder()
    HuaweiHealthDetailParser.parse(
      healthRecord(
        point("BLOOD_OXYGEN_SATURATION", t0, t0, """{"avgSaturation":97}"""),
        point("BLOOD_OXYGEN_SATURATION", t0, t0, """{"spo2":96}"""),
        point("DYNAMIC_HEART_RATE", t0, t0, """{"bpm":77}"""),
        point("RESTING_HEART_RATE", t0, t0, """{"restBpm":56}"""),
        point("RESTING_HEART_RATE", t0, t0, """{"oldRestBpm":60}"""),
      ),
      out,
    )
    assertEquals(listOf(1_750_000_020L to 97, 1_750_000_020L to 96), out.spo2)
    assertEquals(listOf(1_750_000_020L to 77), out.heartRate)
    assertEquals(listOf(1_750_000_020L to 56, 1_750_000_020L to 60), out.resting)
    assertEquals(0, out.rejected)
  }

  @Test
  fun hrvApneaSkinTemperatureAndOtherMetricsBecomeHealthMetrics() {
    val out = Recorder()
    HuaweiHealthDetailParser.parse(
      healthRecord(
        point("HEART_RATE_VARIABILITY", t0, t0, """{"heartRateVariabilityRMSSD":55}"""),
        point("OBSTRUCTIVE_SLEEP_APNEA", t0, t0, """{"osaLevel":1}"""),
        point("SKIN_TEMPERATURE", t0, t0, """{"skinTemperature":34.3}"""),
        point("VASCULAR_HEALTH", t0, t0, """{"activityRecord":42,"pulseWaveVelocity":7.1,"vascularPulse":80}"""),
        point("ARRHYTHMIA_RESULT", t0, t0, """{"measureType":1,"ppgIrregularHeartbeat":1}"""),
        point("STRESS", t0, t0, """{"stressScore":42}"""),
        point("EMOTION", t0, t0, """{"emotionStatus":2}"""),
      ),
      out,
    )
    assertEquals(
      listOf("hrv" to 55.0, "sleep_apnea" to 1.0, "skin_temperature" to 34.3, "arterial_stiffness" to 7.1, "arrhythmia" to 1.0, "emotion" to 42.0),
      out.metrics.map { it.type to it.value },
    )
    assertEquals("""{"heartRateVariabilityRMSSD":55,"source":"huawei-export"}""", out.metrics[0].json)
    assertEquals(listOf("EMOTION"), out.unmapped)
  }

  @Test
  fun aRealWeighInOnlyHasWeightBmiAndProfileFields() {
    val out = Recorder()
    HuaweiHealthDetailParser.parse(
      healthRecord(point("WEIGHT_BODYFAT_BROAD", t0, t0, """{"age":33,"bodyWeight":89.2,"extendAttribute":"0","gender":1,"height":170,"bmi":30.9,"conflictFlag":0}""")),
      out,
    )
    val w = out.weighIns.single()
    assertEquals(89.2, w.weightKg, 0.001)
    assertEquals(null, w.impedanceOhm)
    assertEquals(setOf("bmi"), JSONObject(w.reportedJson!!).keys().asSequence().toSet())
  }

  @Test
  fun bodyCompositionFieldsFollowTheBroadBodyFatDescription() {
    val out = Recorder()
    HuaweiHealthDetailParser.parse(
      healthRecord(
        point(
          "WEIGHT_BODYFAT_BROAD", t0, t0,
          """{"bodyWeight":80,"bodyFat":16,"bodyFatRate":20.0,"moisture":40,"moistureRate":50.1,"muscleMass":30.5,"skeletalMusclelMass":25,"boneSalt":3.2,"basalMetabolism":1700,"visceralFatLevel":9,"proteinRate":17.5,"bodyAge":30,"bodyScore":70,"impedance":480,"lhrhImpedance":300,"leftArmMuscleMass":2,"waistHipRatio":0.9}""",
        ),
      ),
      out,
    )
    val w = out.weighIns.single()
    assertEquals(480.0, w.impedanceOhm!!, 0.001)
    val r = JSONObject(w.reportedJson!!)
    assertEquals(20.0, r.getDouble("bodyFatPct"), 0.001)
    assertEquals(50.1, r.getDouble("waterPct"), 0.001)
    assertEquals(30.5, r.getDouble("muscleKg"), 0.001)
    assertEquals(3.2, r.getDouble("boneKg"), 0.001)
    assertEquals(1700.0, r.getDouble("bmrKcal"), 0.001)
    assertEquals(9.0, r.getDouble("visceralFat"), 0.001)
    assertEquals(17.5, r.getDouble("proteinPct"), 0.001)
    assertEquals(30.0, r.getDouble("bodyAge"), 0.001)
    // Fat and water in kilograms, skeletal and per-limb values, scores and ratios are not ReportedBody fields.
    assertEquals(setOf("bodyFatPct", "waterPct", "muscleKg", "boneKg", "bmrKcal", "visceralFat", "proteinPct", "bodyAge"), r.keys().asSequence().toSet())
  }

  // Meals, water and the profile (real field names, made-up values)

  private fun nutrition(
    meal: Int,
    kcal: Double = 546.0,
    startMs: Long = 1_785_603_600_000L, // 2026-08-02 00:00 in +0700
    eatSec: Long? = null,
    extra: String = "",
  ) = """{"carbohydrates":47.82,"dietaryEnergy":$kcal,"fat":27.21,"foodCount":300,"foodExtUnitValue":1,"foodProvider":1,"meal":$meal,""" +
    (eatSec?.let { """"mealEatTime":$it,""" } ?: "") + """"mealRecordTime":${startMs / 1000 + 75_000},"protein":27.21$extra}"""

  private fun mealRecord(value: String, startMs: Long = 1_785_603_600_000L, zone: String = "+0700") = JSONObject(
    """{"recordId":"rec","timeZone":"$zone","startTime":$startMs,"endTime":$startMs,"samplePoints":[{"key":"NUTRITION_RECORD","startTime":$startMs,"endTime":$startMs,"value":${JSONObject.quote(value)}}]}""",
  )

  @Test
  fun nutritionRecordBecomesAMealOnItsLocalDayWithTheSlotOfItsCode() {
    val out = Recorder()
    HuaweiHealthDetailParser.parse(mealRecord(nutrition(20, 584.0, eatSec = 1_785_646_800L)), out)
    val m = out.meals.single()
    assertEquals("rec:0", m.key)
    assertEquals("2026-08-02", m.date)
    assertEquals("makan_siang", m.meal)
    assertEquals(584.0, m.kcal, 0.0)
    assertEquals(27.2, m.protein!!, 0.0)
    assertEquals(47.8, m.carbs!!, 0.0)
    assertEquals(1_785_646_800_000L, m.eatenAtMs)
    assertEquals(HuaweiDiaryParser.MEAL_NAME, m.name)
    assertEquals(0, out.rejected)
    assertEquals(emptyList<String>(), out.unmapped)
  }

  @Test
  fun aRecordWrittenInAnotherZoneKeepsItsOwnDay() {
    // 2026-08-06 23:00 in +0700 is 2026-08-07 00:00 in +0800: the day Huawei means.
    val out = Recorder()
    HuaweiHealthDetailParser.parse(mealRecord(nutrition(30, 800.0, startMs = 1_786_035_600_000L), startMs = 1_786_035_600_000L, zone = "+0800"), out)
    assertEquals("2026-08-07", out.meals.single().date)
    assertEquals("makan_malam", out.meals.single().meal)
    assertEquals(null, out.meals.single().eatenAtMs)
  }

  @Test
  fun mealSlotCodesAndTheHourFallback() {
    assertEquals("sarapan", HuaweiDiaryParser.slot(10, 0, "+0700"))
    assertEquals("snack", HuaweiDiaryParser.slot(21, 0, "+0700"))
    assertEquals("snack", HuaweiDiaryParser.slot(31, 0, "+0700"))
    // an unknown code goes by the local hour: 01:00 UTC is 08:00 at +0700, 13:00 UTC is 20:00
    assertEquals("sarapan", HuaweiDiaryParser.slot(99, 3_600_000, "+0700"))
    assertEquals("makan_malam", HuaweiDiaryParser.slot(null, 13 * 3_600_000L, "+0700"))
  }

  @Test
  fun implausibleMealsAreRejected() {
    val out = Recorder()
    HuaweiHealthDetailParser.parse(mealRecord(nutrition(10, 0.0)), out)
    HuaweiHealthDetailParser.parse(mealRecord(nutrition(10, 90000.0)), out)
    HuaweiHealthDetailParser.parse(mealRecord("""{"meal":10}"""), out)
    assertTrue(out.meals.isEmpty())
    assertEquals(listOf("out-of-range", "out-of-range", "no-number"), out.rejectedKeys.map { it.second })
  }

  @Test
  fun waterAndHeightAreRead() {
    val out = Recorder()
    val rec = JSONObject(
      """{"recordId":"w","timeZone":"+0800","startTime":1747564821000,"samplePoints":[
           {"key":"DRINK_WATER","startTime":1747564821000,"value":"{\"drinkWater\":250}"},
           {"key":"DRINK_WATER","startTime":1747564821000,"value":"{\"drinkWater\":0}"},
           {"key":"USER_HEIGHT","startTime":1747564830000,"value":"{\"userHeight\":0}"},
           {"key":"USER_HEIGHT","startTime":1747564840000,"value":"{\"userHeight\":172}"},
           {"key":"USER_HEIGHT","startTime":1747564850000,"value":"{\"userHeight\":17}"},
           {"key":"DIET_RECORD","startTime":1747564850000,"value":"{\"dietRecord\":0}"}]}""",
    )
    HuaweiHealthDetailParser.parse(rec, out)
    // 1747564821000 is 2025-05-18 10:00:21 UTC: 18:00 on the +0800 clock
    assertEquals(listOf(Triple("2025-05-18", 250, "w:0")), out.water)
    assertEquals(listOf(Triple("height", 172.0, 1_747_564_840_000L)), out.facts)
    assertEquals(listOf("out-of-range", "out-of-range"), out.rejectedKeys.map { it.second })
    assertEquals(listOf("DIET_RECORD"), out.unmapped)
  }

  @Test
  fun aWeighInCarriesTheProfileItWasWeighedWith() {
    val out = Recorder()
    HuaweiHealthDetailParser.parse(
      healthRecord(point("WEIGHT_BODYFAT_BROAD", t0, t0, """{"age":33,"bodyWeight":89.2,"gender":1,"height":170}""")),
      out,
    )
    assertEquals(
      setOf("height" to 170.0, "male" to 1.0, "age" to 33.0, "weight" to 89.2),
      out.facts.map { it.first to it.second }.toSet(),
    )
    // those profile fields are not body values
    assertEquals(null, out.weighIns.single().reportedJson)
  }
}
