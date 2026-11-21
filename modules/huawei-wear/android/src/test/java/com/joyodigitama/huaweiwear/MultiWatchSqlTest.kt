package com.joyodigitama.huaweiwear

import java.io.File
import java.sql.Connection
import java.sql.DriverManager
import org.json.JSONArray
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The statements the Android stores run ([WatchSql]) and the flows built on them ([WorkoutWriter], [NightHrvStore]) on a real
 * SQLite (sqlite-jdbc) holding the shipped schema: every migration of `schema/joyofit-db-migrations.json`, so the triggers of
 * migration 14 decide. `src/db/multiWatch.test.ts` runs the same rules from JS; this proves the Kotlin statements, their
 * argument order and the delete/skip decisions of the workout and night HRV writers. (Binding itself goes through
 * [AndroidWatchDb] in the app, which cannot run on the JVM.)
 */
class MultiWatchSqlTest {
  private val a = "AA:AA:AA:AA:AA:01"
  private val b = "BB:BB:BB:BB:BB:02"
  private val c = "CC:CC:CC:CC:CC:03"

  private val connection: Connection = DriverManager.getConnection("jdbc:sqlite::memory:")
  private val db = JdbcWatchDb(connection)

  init {
    val migrations = JSONArray(File("../schema/joyofit-db-migrations.json").readText())
    for (i in 0 until migrations.length()) {
      val statements = migrations.getJSONArray(i)
      for (j in 0 until statements.length()) connection.createStatement().use { it.execute(statements.getString(j)) }
    }
  }

  @After
  fun close() = connection.close()

  /** [a] primary, [b] and [c] not. */
  private fun threeWatches(primary: String? = a) {
    for (address in listOf(a, b, c)) {
      db.exec("INSERT INTO device (address, name, is_primary) VALUES (?, ?, ?)", address, "W $address", if (address == primary) 1 else 0)
    }
  }

  private fun one(sql: String, vararg args: Any?): Any? = db.query(sql, *args).firstOrNull()?.get(0)

  // device

  @Test
  fun theFirstWatchBecomesPrimaryAndTheSecondDoesNot() {
    db.exec(WatchSql.UPSERT_DEVICE, a, "Band", "Fit 4", "1.0")
    db.exec(WatchSql.UPSERT_DEVICE, b, "GT", "GT 5", "2.0")
    assertEquals(listOf(listOf(a, 1L), listOf(b, 0L)), db.query("SELECT address, is_primary FROM device ORDER BY address"))
    assertTrue((one("SELECT added_at FROM device WHERE address = ?", a) as Long) > 1_700_000_000L)
    assertNull(one("SELECT last_sync FROM device WHERE address = ?", a))
  }

  @Test
  fun aPhoneWithoutAPrimaryGivesItToTheNextWatchThatConnects() {
    db.exec("INSERT INTO device (address, name) VALUES (?, 'old')", a)
    assertEquals(0L, one("SELECT is_primary FROM device WHERE address = ?", a))
    db.exec(WatchSql.UPSERT_DEVICE, b, "GT", null, null)
    assertEquals(1L, one("SELECT is_primary FROM device WHERE address = ?", b))
  }

  @Test
  fun reconnectingKeepsWhatTheUserSetAndOnlyRefreshesTheWatchDescription() {
    db.exec(WatchSql.UPSERT_DEVICE, a, "Band", "Fit 4", "1.0")
    db.exec(WatchSql.UPSERT_DEVICE, b, "GT", "GT 5", "2.0")
    db.exec("UPDATE device SET alias = 'Run', is_primary = 0, tracks_health = 0, bg_sync = 1, added_at = 5, last_sync = 123 WHERE address = ?", b)
    db.exec(WatchSql.UPSERT_DEVICE, b, "GT renamed", "GT 5 Pro", "2.1")
    assertEquals(
      listOf("GT renamed", "GT 5 Pro", "2.1", "Run", 0L, 0L, 1L, 5L, 123L),
      db.query("SELECT name, product_model, software_version, alias, is_primary, tracks_health, bg_sync, added_at, last_sync FROM device WHERE address = ?", b).single(),
    )
    assertEquals(1L, one("SELECT is_primary FROM device WHERE address = ?", a))
  }

  @Test
  fun tracksHealthDefaultsToOnAndIsReadFresh() {
    db.exec(WatchSql.UPSERT_DEVICE, a, "Band", null, null)
    assertEquals(1L, one(WatchSql.SELECT_TRACKS_HEALTH, a))
    db.exec("UPDATE device SET tracks_health = 0 WHERE address = ?", a)
    assertEquals(0L, one(WatchSql.SELECT_TRACKS_HEALTH, a))
    assertNull(one(WatchSql.SELECT_TRACKS_HEALTH, "no row"))
  }

  @Test
  fun lastSyncAdvancesForOneWatchOnly() {
    threeWatches()
    db.exec(WatchSql.UPDATE_LAST_SYNC, 777L, b)
    assertEquals(listOf(listOf(a, null), listOf(b, 777L), listOf(c, null)), db.query("SELECT address, last_sync FROM device ORDER BY address"))
  }

  @Test
  fun backgroundSyncWatchesAreTheOnesWithTheFlag() {
    threeWatches()
    assertTrue(db.query(WatchSql.SELECT_BG_SYNC_WATCHES).isEmpty())
    db.exec("UPDATE device SET bg_sync = 1, last_sync = 9 WHERE address = ?", c)
    assertEquals(listOf(listOf(c, 9L)), db.query(WatchSql.SELECT_BG_SYNC_WATCHES))
  }

  // step_samples

  private fun step(device: String, timestamp: Long, steps: Int, heartRate: Int? = null) =
    db.exec(WatchSql.UPSERT_STEP_SAMPLE, timestamp, steps, 0, 0, heartRate, null, null, device)

  private fun stepRow(timestamp: Long) = db.query("SELECT steps, device FROM step_samples WHERE timestamp = ?", timestamp).single()

  @Test
  fun thePrimaryOwnsAMinuteAndOtherWatchesFillGaps() {
    threeWatches()
    step(a, 1_000, 30, heartRate = 80)
    step(b, 1_000, 99, heartRate = 70)
    assertEquals(listOf(30L, a), stepRow(1_000))
    step(b, 1_060, 5)
    assertEquals(listOf(5L, b), stepRow(1_060))
  }

  @Test
  fun aWatchRewritesItsOwnMinuteAndThePrimaryTakesOverAnotherWatchsMinute() {
    threeWatches()
    step(b, 1_000, 10)
    step(b, 1_000, 11)
    assertEquals(listOf(11L, b), stepRow(1_000))
    step(a, 1_000, 40)
    assertEquals(listOf(40L, a), stepRow(1_000))
  }

  @Test
  fun amongNonPrimaryWatchesTheFirstWriterKeepsTheMinute() {
    threeWatches()
    step(b, 1_000, 10)
    step(c, 1_000, 20)
    assertEquals(listOf(10L, b), stepRow(1_000))
  }

  @Test
  fun anEmptyMinuteNeverReplacesDataAndIsReplacedByData() {
    threeWatches()
    step(b, 1_000, 10)
    step(a, 1_000, 0)
    assertEquals(listOf(10L, b), stepRow(1_000))
    step(c, 2_000, 0)
    step(b, 2_000, 7)
    assertEquals(listOf(7L, b), stepRow(2_000))
  }

  @Test
  fun anUpsertAttributesAnImportedMinuteToTheWatch() {
    threeWatches()
    db.exec("INSERT INTO step_samples (timestamp, steps, calories, distance, imported) VALUES (3000, 5, 0, 0, 1)")
    step(c, 3_000, 6)
    assertEquals(listOf(6L, c), stepRow(3_000))
    assertEquals(0L, one("SELECT imported FROM step_samples WHERE timestamp = 3000"))
  }

  // sleep

  private fun segment(device: String, start: Long, end: Long, type: Int = 2) =
    db.exec(WatchSql.UPSERT_SLEEP_SEGMENT, start, end, type, null, device)

  private fun segments() = db.query("SELECT start, end, device FROM sleep_segments ORDER BY start")

  @Test
  fun thePrimaryReplacesAnotherWatchsNightAndLaterWatchesAreSkipped() {
    threeWatches()
    segment(b, 1_000, 5_000)
    segment(a, 1_100, 5_200)
    assertEquals(listOf(listOf(1_100L, 5_200L, a)), segments())
    segment(c, 1_200, 2_500, type = 1)
    assertEquals(listOf(listOf(1_100L, 5_200L, a)), segments())
  }

  @Test
  fun aWatchsOwnSegmentsNeverRemoveEachOther() {
    threeWatches()
    segment(b, 1_000, 2_000, type = 1)
    segment(b, 1_500, 3_000, type = 2)
    assertEquals(2, segments().size)
  }

  @Test
  fun anUpsertOfAnUnattributedSegmentAttributesIt() {
    threeWatches()
    db.exec("INSERT INTO sleep_segments (start, end, type, imported) VALUES (500, 2000, 2, 1)")
    segment(b, 500, 2_100)
    assertEquals(listOf(listOf(500L, 2_100L, b)), segments())
  }

  @Test
  fun sleepScoresFollowTheSameRule() {
    threeWatches()
    db.exec(WatchSql.UPSERT_SLEEP_SCORE, 1_000L, 5_000L, 80, null, b)
    db.exec(WatchSql.UPSERT_SLEEP_SCORE, 1_100L, 5_200L, 70, 91, a)
    assertEquals(listOf(listOf(70L, a)), db.query("SELECT score, device FROM sleep_scores"))
    db.exec(WatchSql.UPSERT_SLEEP_SCORE, 1_200L, 5_000L, 90, null, c)
    assertEquals(listOf(listOf(70L, a)), db.query("SELECT score, device FROM sleep_scores"))
  }

  @Test
  fun aSleepScoreUpsertAttributesAnUnattributedRow() {
    threeWatches()
    db.exec("INSERT INTO sleep_scores (start, end, score) VALUES (1000, 5000, 60)")
    db.exec(WatchSql.UPSERT_SLEEP_SCORE, 1_000L, 5_000L, 75, null, c)
    assertEquals(listOf(listOf(75L, c)), db.query("SELECT score, device FROM sleep_scores"))
  }

  // health_metrics

  private fun metric(device: String, ts: Long, value: Double) =
    db.exec(WatchSql.UPSERT_HEALTH_METRIC, "spo2", ts, ts, value, "[]", device)

  private fun metricRow(ts: Long) = db.query("SELECT value, device FROM health_metrics WHERE ts = ?", ts).single()

  @Test
  fun thePrimaryWinsAMetricAndOtherWatchesKeepTheirFirstWriter() {
    threeWatches()
    metric(b, 100, 1.0)
    metric(c, 100, 2.0)
    assertEquals(listOf(1.0, b), metricRow(100))
    metric(a, 100, 3.0)
    assertEquals(listOf(3.0, a), metricRow(100))
    metric(b, 100, 4.0)
    assertEquals(listOf(3.0, a), metricRow(100))
  }

  @Test
  fun aMetricUpsertAttributesAnUnattributedRow() {
    threeWatches()
    db.exec("INSERT INTO health_metrics (type, ts, last_ts, value, values_json) VALUES ('spo2', 100, 100, 1, '[]')")
    metric(b, 100, 2.0)
    assertEquals(listOf(2.0, b), metricRow(100))
  }

  @Test
  fun theFetchCursorIsPerWatch() {
    threeWatches()
    metric(a, 100, 1.0)
    metric(b, 200, 1.0)
    db.exec(WatchSql.UPSERT_HEALTH_METRIC, "emotion", 900L, 950L, 1.0, "[]", b)
    assertEquals(100L, one(WatchSql.SELECT_HEALTH_METRIC_CURSOR, "spo2", a))
    assertEquals(200L, one(WatchSql.SELECT_HEALTH_METRIC_CURSOR, "spo2", b))
    assertNull(one(WatchSql.SELECT_HEALTH_METRIC_CURSOR, "spo2", c))
    assertEquals(950L, one(WatchSql.SELECT_HEALTH_METRIC_CURSOR, "emotion", b))
  }

  // hrv_readings

  private fun night(device: String, start: Long, end: Long) = NightHrvStore.save(db, device, NightSpan(start, end, emptyList()), 40.0, 100)

  private fun nights() = db.query("SELECT start, end, device FROM hrv_readings WHERE source = 'night' ORDER BY start")

  @Test
  fun thePrimaryOwnsANightAndOtherWatchesAreSkipped() {
    threeWatches()
    night(b, 1_000, 5_000)
    night(a, 1_100, 5_200)
    assertEquals(listOf(listOf(1_100L, 5_200L, a)), nights())
    night(c, 1_200, 5_000)
    assertEquals(listOf(listOf(1_100L, 5_200L, a)), nights())
  }

  @Test
  fun aNightIsReplacedByTheSameWatchsLongerNightAndByNothingOfAnotherWatch() {
    threeWatches(primary = null)
    night(b, 1_000, 5_000)
    night(b, 1_000, 5_100)
    assertEquals(listOf(listOf(1_000L, 5_100L, b)), nights())
    // c overlaps b's night: its delete must not touch b's row, and the claim trigger skips its insert
    night(c, 1_500, 5_000)
    assertEquals(listOf(listOf(1_000L, 5_100L, b)), nights())
  }

  @Test
  fun aWatchsNightRemovesAnUnattributedOneOfTheSameSession() {
    threeWatches()
    db.exec("INSERT INTO hrv_readings (start, end, source, rmssd, beats) VALUES (1000, 5000, 'night', 30, 50)")
    night(b, 1_200, 5_100)
    assertEquals(listOf(listOf(1_200L, 5_100L, b)), nights())
  }

  @Test
  fun theNightCursorIsPerWatch() {
    threeWatches()
    night(a, 1_000, 5_000)
    night(b, 90_000, 95_000)
    assertEquals(5_000L, NightHrvStore.lastEnd(db, a))
    assertEquals(95_000L, NightHrvStore.lastEnd(db, b))
    assertNull(NightHrvStore.lastEnd(db, c))
  }

  @Test
  fun aSpotReadingIsAlwaysStoredWithTheConnectedWatch() {
    threeWatches()
    db.exec(WatchSql.INSERT_SPOT_HRV, 3_000L, 3_060L, 40.0, 50.0, 800.0, 60, b)
    db.exec(WatchSql.INSERT_SPOT_HRV, 4_000L, 4_060L, 41.0, 51.0, 801.0, 61, c)
    assertEquals(
      listOf(listOf(3_000L, b), listOf(4_000L, c)),
      db.query("SELECT start, device FROM hrv_readings WHERE source = 'spot' ORDER BY start"),
    )
  }

  // workouts

  private fun record(start: Long, end: Long, gps: Boolean = false, complete: Boolean = true) = WorkoutRecord(
    number = 1,
    start = start,
    end = end,
    sportType = 1,
    sportName = "run",
    duration = (end - start).toInt(),
    distance = 100,
    calories = 10,
    steps = 5,
    avgHr = null,
    maxHr = null,
    summaryJson = "{}",
    points = listOf(
      WorkoutPoint(start, if (gps) 1.5 else null, if (gps) 2.5 else null, null, 120),
      WorkoutPoint(start + 10, if (gps) 1.6 else null, if (gps) 2.6 else null, null, 125),
    ),
    complete = complete,
  )

  private fun workouts() = db.query("SELECT start, end, device FROM workouts ORDER BY start")

  private fun points() = db.query("SELECT workout_id, COUNT(*) FROM workout_points GROUP BY workout_id ORDER BY workout_id")

  private fun shadows() = db.query("SELECT device, start, end, kept_start FROM workout_shadow ORDER BY device, start")

  @Test
  fun aWorkoutIsStoredWithItsWatchAndPoints() {
    threeWatches()
    assertTrue(WorkoutWriter(db, b).save(record(1_000, 2_000, gps = true)))
    assertEquals(listOf(listOf(1_000L, 2_000L, b)), workouts())
    assertEquals(listOf(listOf(1L, 2L)), points())
    assertTrue(WorkoutWriter(db, b).isComplete(1_000, 2_000))
    assertFalse(WorkoutWriter(db, b).isComplete(1_000, 2_001))
  }

  @Test
  fun aWorkoutIsNewOnlyOnceItIsComplete() {
    threeWatches()
    val writer = WorkoutWriter(db, b)
    assertTrue(writer.save(record(1_000, 2_000, complete = false)))
    assertFalse(writer.isComplete(1_000, 2_000))
    assertTrue(writer.save(record(1_000, 2_000)))
    assertTrue(writer.isComplete(1_000, 2_000))
    assertFalse(writer.save(record(1_000, 2_000)))
    assertEquals(listOf(listOf(2L)), db.query("SELECT COUNT(*) FROM workout_points"))
  }

  @Test
  fun aWorkoutWithGpsBeatsThePrimarysCopyWithout() {
    threeWatches()
    assertTrue(WorkoutWriter(db, b).save(record(1_000, 2_000, gps = true)))
    assertFalse(WorkoutWriter(db, a).save(record(1_020, 1_990)))
    assertEquals(listOf(listOf(1_000L, 2_000L, b)), workouts())
    assertEquals(listOf(listOf(a, 1_020L, 1_990L, 1_000L)), shadows())
    assertTrue(WorkoutWriter(db, a).isComplete(1_020, 1_990))
  }

  @Test
  fun aWorkoutWithGpsReplacesTheStoredCopyWithoutAndTheStoredOneIsNoted() {
    threeWatches()
    assertTrue(WorkoutWriter(db, a).save(record(1_000, 2_000)))
    assertTrue(WorkoutWriter(db, b).save(record(1_050, 2_100, gps = true)))
    assertEquals(listOf(listOf(1_050L, 2_100L, b)), workouts())
    assertEquals(listOf(listOf(a, 1_000L, 2_000L, 1_050L)), shadows())
    assertEquals(listOf(listOf(2L)), db.query("SELECT COUNT(*) FROM workout_points"))
    assertTrue(WorkoutWriter(db, a).isComplete(1_000, 2_000))
  }

  @Test
  fun thePrimaryBeatsTheFirstStoredCopyWhenGpsIsEqual() {
    threeWatches()
    assertTrue(WorkoutWriter(db, b).save(record(1_000, 2_000)))
    assertTrue(WorkoutWriter(db, a).save(record(1_000, 2_000)))
    assertEquals(listOf(listOf(1_000L, 2_000L, a)), workouts())
    assertEquals(listOf(listOf(b, 1_000L, 2_000L, 1_000L)), shadows())
    assertEquals(1, points().size)
    // b does not download it again
    assertTrue(WorkoutWriter(db, b).isComplete(1_000, 2_000))
  }

  @Test
  fun withoutAPrimaryTheFirstStoredCopyStays() {
    threeWatches(primary = null)
    assertTrue(WorkoutWriter(db, b).save(record(1_000, 2_000)))
    assertFalse(WorkoutWriter(db, c).save(record(1_000, 2_000)))
    assertEquals(listOf(listOf(1_000L, 2_000L, b)), workouts())
    assertEquals(listOf(listOf(c, 1_000L, 2_000L, 1_000L)), shadows())
  }

  @Test
  fun aWatchsOwnWorkoutsNeverCountAsDuplicates() {
    threeWatches()
    assertTrue(WorkoutWriter(db, b).save(record(1_000, 2_000)))
    assertTrue(WorkoutWriter(db, b).save(record(1_100, 2_100)))
    assertEquals(2, workouts().size)
    assertTrue(shadows().isEmpty())
  }

  @Test
  fun anOverlapUnderHalfOfTheShorterSessionKeepsBoth() {
    threeWatches()
    assertTrue(WorkoutWriter(db, b).save(record(1_000, 2_000)))
    // a runs 1_960..2_960: 40 s of 1_000 s overlap
    assertTrue(WorkoutWriter(db, a).save(record(1_960, 2_960)))
    assertEquals(2, workouts().size)
    assertTrue(shadows().isEmpty())
  }

  @Test
  fun anImportedOrUnattributedWorkoutIsNeverADuplicate() {
    threeWatches()
    db.exec(
      """INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, steps, summary_json, complete, imported)
         VALUES (1, 1000, 2000, 1, 'run', 1000, 1, 1, 1, '{}', 1, 1)""",
    )
    db.exec(
      """INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, steps, summary_json, complete, imported)
         VALUES (1, 1500, 2500, 1, 'run', 1000, 1, 1, 1, '{}', 1, 0)""",
    )
    assertTrue(WorkoutWriter(db, b).save(record(1_100, 1_900)))
    assertEquals(3, workouts().size)
    assertTrue(shadows().isEmpty())
  }

  @Test
  fun aWatchTakesOverAnUnattributedWorkoutOfTheSameStart() {
    threeWatches()
    db.exec(
      """INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, steps, summary_json, complete, imported)
         VALUES (1, 1000, 2000, 1, 'run', 1000, 1, 1, 1, '{}', 1, 1)""",
    )
    // the stored copy was already complete, so this is not a "new" workout (as before several watches existed), but it is attributed
    assertFalse(WorkoutWriter(db, c).save(record(1_000, 2_000)))
    assertEquals(listOf(listOf(1_000L, 2_000L, c)), workouts())
    assertEquals(0L, one("SELECT imported FROM workouts WHERE start = 1000"))
  }

  @Test
  fun theWinnerRemovesEveryStoredCopyItBeats() {
    threeWatches()
    assertTrue(WorkoutWriter(db, b).save(record(1_000, 1_400)))
    assertTrue(WorkoutWriter(db, c).save(record(1_450, 1_900)))
    assertTrue(WorkoutWriter(db, a).save(record(1_000, 1_900)))
    assertEquals(listOf(listOf(1_000L, 1_900L, a)), workouts())
    assertEquals(
      listOf(listOf(b, 1_000L, 1_400L, 1_000L), listOf(c, 1_450L, 1_900L, 1_000L)),
      shadows(),
    )
    assertEquals(1, points().size)
  }

  @Test
  fun aLoserOfOneCopyStoresNothingEvenWhenItBeatsAnother() {
    threeWatches()
    assertTrue(WorkoutWriter(db, b).save(record(1_000, 1_400)))
    assertTrue(WorkoutWriter(db, c).save(record(1_450, 1_900, gps = true)))
    // a (primary, no GPS) beats b but loses to c's GPS copy: nothing of b is removed
    assertFalse(WorkoutWriter(db, a).save(record(1_000, 1_900)))
    assertEquals(2, workouts().size)
    assertEquals(listOf(listOf(a, 1_000L, 1_900L, 1_450L)), shadows())
  }

  @Test
  fun theSyncWindowStartsAfterTheNewestWorkoutOfTheWatch() {
    threeWatches()
    assertEquals(WorkoutStore.DEFAULT_START_SEC.toInt(), WorkoutWriter(db, a).syncStart(false))
    WorkoutWriter(db, a).save(record(1_000, 5_000))
    WorkoutWriter(db, b).save(record(10_000, 12_000))
    assertEquals(5_001, WorkoutWriter(db, a).syncStart(false))
    assertEquals(12_001, WorkoutWriter(db, b).syncStart(false))
    assertEquals(WorkoutStore.DEFAULT_START_SEC.toInt(), WorkoutWriter(db, c).syncStart(false))
    assertEquals(WorkoutStore.DEFAULT_START_SEC.toInt(), WorkoutWriter(db, a).syncStart(true))
  }

  @Test
  fun aDroppedWorkoutStillMovesTheWatchsWindow() {
    threeWatches()
    WorkoutWriter(db, b).save(record(1_000, 2_000, gps = true))
    WorkoutWriter(db, a).save(record(1_000, 2_000))
    assertEquals(2_001, WorkoutWriter(db, a).syncStart(false))
  }

  @Test
  fun aDeletedWorkoutStillMovesTheWatchsWindowThroughItsShadow() {
    threeWatches()
    WorkoutWriter(db, b).save(record(1_000, 2_000))
    WorkoutWriter(db, a).save(record(1_000, 1_800))
    assertEquals(2_001, WorkoutWriter(db, b).syncStart(false))
  }

  @Test
  fun importedWorkoutsDoNotMoveTheWindow() {
    threeWatches()
    db.exec(
      """INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, steps, summary_json, complete, imported, device)
         VALUES (1, 1000, 9000, 1, 'run', 8000, 1, 1, 1, '{}', 1, 1, 'AA:AA:AA:AA:AA:01')""",
    )
    assertEquals(WorkoutStore.DEFAULT_START_SEC.toInt(), WorkoutWriter(db, a).syncStart(false))
  }

  @Test
  fun anIncompleteWorkoutOfTheWatchOrAnUnattributedOneIsFetchedAgain() {
    threeWatches()
    WorkoutWriter(db, a).save(record(1_000, 2_000, complete = false))
    WorkoutWriter(db, a).save(record(5_000, 6_000))
    assertEquals(1_000, WorkoutWriter(db, a).syncStart(false))
    // another watch's incomplete workout is not this watch's to fetch
    assertEquals(WorkoutStore.DEFAULT_START_SEC.toInt(), WorkoutWriter(db, b).syncStart(false))
    db.exec(
      """INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, steps, summary_json, complete, imported)
         VALUES (1, 100, 200, 1, 'run', 100, 1, 1, 1, '{}', 0, 0)""",
    )
    assertEquals(100, WorkoutWriter(db, a).syncStart(false))
    assertEquals(WorkoutStore.DEFAULT_START_SEC.toInt(), WorkoutWriter(db, b).syncStart(false))
  }

  @Test
  fun bandWorkoutWithoutGpsMergesPhoneConnectedGpsTrackAndSupportsBackfill() {
    threeWatches()
    val gpsStore = ConnectedGpsStore()
    val fixes = listOf(
      TrackFix(1_010_000L, -6.2000, 106.8000, 12.0, 5f, 3.0f, null),
      TrackFix(1_020_000L, -6.2005, 106.8005, 16.0, 5f, 3.1f, null),
      TrackFix(1_030_000L, -6.2010, 106.8010, 20.0, 5f, 3.2f, null),
    )
    gpsStore.upsert(
      ConnectedGpsSession(
        id = "band-session-1",
        startSec = 1_000L,
        endSec = 1_600L,
        sportType = 1,
        distanceM = 157.0,
        riseM = 8.0,
        points = fixes,
      ),
      persist = false,
    )

    val bandRun = WorkoutRecord(
      number = 1,
      start = 1_000L,
      end = 1_600L,
      sportType = 1,
      sportName = "Running",
      duration = 600,
      distance = 0,
      calories = 80,
      steps = 900,
      avgHr = 140,
      maxHr = 160,
      summaryJson = """{"kind":"RUNNING","gps":"none","gpsPoints":0}""",
      points = listOf(WorkoutPoint(1_015L, null, null, null, 140)),
      complete = true,
    )
    assertTrue(WorkoutWriter(db, b, gpsStore).save(bandRun))
    val gpsCount = one("SELECT COUNT(*) FROM workout_points WHERE lat IS NOT NULL AND lon IS NOT NULL")
    assertEquals(3L, gpsCount)
    val summary = db.query("SELECT summary_json, distance FROM workouts WHERE start = 1000").single()
    val summaryJson = summary[0] as String
    assertTrue(summaryJson.contains("\"gps\":\"ok\""))
    assertTrue(summaryJson.contains("\"gpsSource\":\"phone\""))
    assertTrue((summary[1] as Long) > 100L)

    // Reverse-order backfill: workout synced before LiveWorkout flushed its track
    val unmergedWalk = WorkoutRecord(
      number = 2,
      start = 5_000L,
      end = 5_600L,
      sportType = 2,
      sportName = "Walking",
      duration = 600,
      distance = 0,
      calories = 45,
      steps = 700,
      avgHr = 110,
      maxHr = 125,
      summaryJson = """{"kind":"WALKING","gps":"none","gpsPoints":0}""",
      points = emptyList(),
      complete = true,
    )
    assertTrue(WorkoutWriter(db, b, ConnectedGpsStore()).save(unmergedWalk))
    val walkTrack = ConnectedGpsSession(
      id = "band-session-2",
      startSec = 5_000L,
      endSec = 5_600L,
      sportType = 2,
      distanceM = 120.0,
      riseM = 4.0,
      points = listOf(
        TrackFix(5_010_000L, -6.2100, 106.8100, 10.0, 5f, 1.5f, null),
        TrackFix(5_030_000L, -6.2105, 106.8105, 14.0, 5f, 1.5f, null),
      ),
    )
    assertEquals(1, ConnectedGpsMerger.backfillStored(db, b, walkTrack))
    val walkGpsCount = one("SELECT COUNT(*) FROM workout_points p JOIN workouts w ON w.id = p.workout_id WHERE w.start = 5000 AND p.lat IS NOT NULL")
    assertEquals(2L, walkGpsCount)
  }

  @Test
  fun bandWorkoutWithZeroEndMergesTrackAndBackfillsWithCaseInsensitiveDevice() {
    threeWatches()
    val gpsStore = ConnectedGpsStore()
    val fixes = listOf(
      TrackFix(1_010_000L, -6.2000, 106.8000, 12.0, 5f, 3.0f, null),
      TrackFix(1_030_000L, -6.2010, 106.8010, 20.0, 5f, 3.2f, null),
    )
    val session = ConnectedGpsSession(
      id = "band-session-zero-end",
      startSec = 1_000L,
      endSec = 1_600L,
      sportType = 1,
      distanceM = 150.0,
      riseM = 5.0,
      points = fixes,
    )
    gpsStore.upsert(session, persist = false)

    // fixesInWindow handles workoutEndSec <= workoutStartSec gracefully
    assertEquals(2, session.fixesInWindow(1_000L, 0L).size)
    assertEquals(2, session.fixesInWindow(1_000L, 1_000L).size)

    // Band record with end == 0L
    val bandRecord = WorkoutRecord(
      number = 10,
      start = 1_000L,
      end = 0L,
      sportType = 1,
      sportName = "Running",
      duration = 600,
      distance = 0,
      calories = 80,
      steps = 900,
      avgHr = 140,
      maxHr = 160,
      summaryJson = """{"kind":"RUNNING","gps":"none","gpsPoints":0}""",
      points = emptyList(),
      complete = true,
    )
    val merged = ConnectedGpsMerger.merge(bandRecord, gpsStore)
    assertEquals(1_600L, merged.end)
    assertEquals(2, merged.points.size)
    assertTrue(merged.points.all { it.lat != null })

    // Backfill with uppercase address in DB vs lowercase address parameter and end == 0
    val unmergedZeroEnd = WorkoutRecord(
      number = 11,
      start = 8_000L,
      end = 0L,
      sportType = 2,
      sportName = "Walking",
      duration = 600,
      distance = 0,
      calories = 50,
      steps = 800,
      avgHr = 115,
      maxHr = 130,
      summaryJson = """{"kind":"WALKING","gps":"none","gpsPoints":0}""",
      points = emptyList(),
      complete = true,
    )
    assertTrue(WorkoutWriter(db, "AA:BB:CC:DD:EE:01", ConnectedGpsStore()).save(unmergedZeroEnd))

    val backfillSession = ConnectedGpsSession(
      id = "backfill-session-zero-end",
      startSec = 8_000L,
      endSec = 8_600L,
      sportType = 2,
      distanceM = 140.0,
      riseM = 3.0,
      points = listOf(
        TrackFix(8_010_000L, -6.3000, 106.9000, 10.0, 5f, 1.4f, null),
        TrackFix(8_040_000L, -6.3010, 106.9010, 12.0, 5f, 1.4f, null),
      ),
    )
    // Pass lowercase address "aa:bb:cc:dd:ee:01"
    val updatedCount = ConnectedGpsMerger.backfillStored(db, "aa:bb:cc:dd:ee:01", backfillSession)
    assertEquals(1, updatedCount)
    val pointsCount = one("SELECT COUNT(*) FROM workout_points p JOIN workouts w ON w.id = p.workout_id WHERE w.start = 8000 AND p.lat IS NOT NULL")
    assertEquals(2L, pointsCount)
    val updatedEnd = one("SELECT end FROM workouts WHERE start = 8000")
    assertEquals(8_600L, updatedEnd)
  }
}
