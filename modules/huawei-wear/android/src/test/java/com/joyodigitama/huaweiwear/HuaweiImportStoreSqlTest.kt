package com.joyodigitama.huaweiwear

import java.io.File
import java.nio.file.Files
import java.sql.DriverManager
import org.json.JSONArray
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test

/** [SqliteHuaweiImportStore] on the shipped schema (sqlite-jdbc): the rules of its statements, with made-up values. */
class HuaweiImportStoreSqlTest {
  private val dir: File = Files.createTempDirectory("huawei-import-store").toFile()
  private val file = File(dir, "joyofit.db")
  private val jdbc = DriverManager.getConnection("jdbc:sqlite:${file.path}")
  private val db = WearDatabase(file.path, JdbcSqlConnection(jdbc))
  private val store = SqliteHuaweiImportStore { db }

  init {
    val migrations = JSONArray(File("../schema/joyofit-db-migrations.json").readText())
    for (i in 0 until migrations.length()) {
      val statements = migrations.getJSONArray(i)
      for (j in 0 until statements.length()) db.execSQL(statements.getString(j))
    }
  }

  /** The table as JS creates it (`ensureScaleSchema`, `src/features/scale/store.ts`): the importer's own `IF NOT EXISTS` must agree with it. */
  private fun createScaleTableLikeJs() = db.execSQL(
    """CREATE TABLE IF NOT EXISTS scale_reading (
         id INTEGER PRIMARY KEY AUTOINCREMENT, scale_id TEXT NOT NULL, taken_at INTEGER NOT NULL, weight_kg REAL NOT NULL,
         impedance_ohm REAL, reported TEXT, estimate TEXT, rogo_state TEXT NOT NULL DEFAULT 'pending', rogo_error TEXT)""",
  )

  @After
  fun close() {
    db.close()
    dir.deleteRecursively()
  }

  private fun count(sql: String): Long = jdbc.createStatement().use { s -> s.executeQuery(sql).use { it.next(); it.getLong(1) } }

  private val t0 = 1_750_000_020_000L

  @Test
  fun weighInsLandInScaleReadingAndAnImportRunTwiceAddsNothing() {
    val rows = listOf(
      ImportedWeighIn(t0, 71.5, 500.0, """{"bodyFatPct":21.3,"bmi":22.4}"""),
      ImportedWeighIn(t0 + 86_400_000, 71.2, null, null),
    )
    assertEquals(2, store.writeWeighIns(rows))
    assertEquals(0, store.writeWeighIns(rows))
    assertEquals(2, count("SELECT COUNT(*) FROM scale_reading WHERE scale_id = 'huawei-health-export' AND rogo_state = 'pending'"))
    assertEquals(1, count("SELECT COUNT(*) FROM scale_reading WHERE reported LIKE '%bodyFatPct%' AND impedance_ohm = 500"))
  }

  @Test
  fun aWeighInThatTheScaleAlreadyDeliveredIsNotDuplicated() {
    createScaleTableLikeJs()
    db.execSQL(
      "INSERT INTO scale_reading (scale_id, taken_at, weight_kg, rogo_state) VALUES ('AA:BB', ?, 71.4, 'sent')",
      arrayOf<Any>(t0 + 20_000),
    )
    assertEquals(0, store.writeWeighIns(listOf(ImportedWeighIn(t0, 71.5, null, null))))
    // A different weight at the same moment is another person on the scale, not the same weighing.
    assertEquals(1, store.writeWeighIns(listOf(ImportedWeighIn(t0, 90.0, null, null))))
  }

  @Test
  fun minutesAreMergedAndASecondRunChangesNothing() {
    val minute = ImportedMinute(1_750_000_020L).also { it.steps = 10; it.heartRate = 80 }
    assertEquals(1, store.writeMinutes(listOf(minute)))
    assertEquals(0, store.writeMinutes(listOf(minute)))
    assertEquals(1, count("SELECT COUNT(*) FROM step_samples WHERE heart_rate = 80 AND steps = 10 AND imported = 1"))
  }

  @Test
  fun minuteCaloriesFillInAnEarlierImportButNeverTheWatchs() {
    // An earlier import (an older version) stored the minute without calories; the same export fills them in.
    db.execSQL("INSERT INTO step_samples (timestamp, steps, calories, distance, imported) VALUES (1750000020, 10, 0, 7, 1)")
    db.execSQL("INSERT INTO step_samples (timestamp, steps, calories, distance, imported) VALUES (1750000080, 10, 0, 7, 0)")
    val a = ImportedMinute(1_750_000_020L).also { it.steps = 10; it.distance = 7; it.calories = 5000 }
    val b = ImportedMinute(1_750_000_080L).also { it.steps = 99; it.distance = 99; it.calories = 5000 }
    assertEquals(1, store.writeMinutes(listOf(a, b)))
    assertEquals(0, store.writeMinutes(listOf(a, b)))
    assertEquals(5000, count("SELECT calories FROM step_samples WHERE timestamp = 1750000020"))
    assertEquals(0, count("SELECT calories FROM step_samples WHERE timestamp = 1750000080"))
  }

  @Test
  fun metricsAndSleepScoresAreAddedOnceAndTheWatchsRowsStay() {
    db.execSQL("INSERT INTO health_metrics (type, ts, last_ts, value, values_json) VALUES ('hrv', 1750000000, 1750000000, 70, '{}')")
    val points = listOf(
      ImportedMetric("hrv", 1_750_000_000L, 55.0, "{}"),
      ImportedMetric("hrv", 1_750_000_300L, 56.0, "{}"),
      ImportedMetric("emotion", 1_750_000_300L, 30.0, "{}"),
    )
    assertEquals(mapOf("hrv" to 1, "emotion" to 1), store.writeMetrics(points))
    assertEquals(emptyMap<String, Int>(), store.writeMetrics(points))
    assertEquals(70, count("SELECT value FROM health_metrics WHERE type = 'hrv' AND ts = 1750000000"))
    val scores = listOf(ImportedSleepScore(1_750_000_000L, 1_750_030_000L, 85, 97), ImportedSleepScore(1_750_100_000L, 1_750_130_000L, 70, null))
    db.execSQL("INSERT INTO sleep_scores (start, end, score, efficiency) VALUES (1750100000, 1750130000, 60, 50)")
    assertEquals(1, store.writeSleepScores(scores))
    assertEquals(0, store.writeSleepScores(scores))
    assertEquals(60, count("SELECT score FROM sleep_scores WHERE start = 1750100000"))
  }

  @Test
  fun aDayTotalAddsOnlyWhatTheDaysRowsFallShortOf() {
    val day = 1_750_000_000L / 86_400 * 86_400
    db.execSQL("INSERT INTO step_samples (timestamp, steps, calories, distance, imported) VALUES (?, 5, 100, 3, 0)", arrayOf<Any>(day + 3_600 * 8))
    // A row sits at noon already: the shortfall goes to the next free minute.
    db.execSQL("INSERT INTO step_samples (timestamp, steps, calories, distance, imported) VALUES (?, 7, 0, 4, 1)", arrayOf<Any>(day + 43_200))
    val partial = ImportedDayTotal(day, day + 86_400, day + 43_200, 5000, 3000, 100_000)
    val empty = ImportedDayTotal(day + 86_400, day + 2 * 86_400, day + 86_400 + 43_200, 6000, 4000, 200_000)
    val covered = ImportedDayTotal(day + 2 * 86_400, day + 3 * 86_400, day + 2 * 86_400 + 43_200, 10, 0, 0)
    db.execSQL("INSERT INTO step_samples (timestamp, steps, calories, distance, imported) VALUES (?, 20, 0, 0, 0)", arrayOf<Any>(day + 2 * 86_400 + 60))
    assertEquals(2, store.writeDayTotals(listOf(partial, empty, covered)))
    assertEquals(0, store.writeDayTotals(listOf(partial, empty, covered)))
    // 5000 - (5 + 7) steps, 3000 - (3 + 4) m, 100 000 - 100 cal, at 12:01.
    assertEquals(1, count("SELECT COUNT(*) FROM step_samples WHERE timestamp = ${day + 43_260} AND steps = 4988 AND distance = 2993 AND calories = 99900 AND imported = 1"))
    assertEquals(1, count("SELECT COUNT(*) FROM step_samples WHERE timestamp = ${day + 86_400 + 43_200} AND steps = 6000 AND calories = 200000 AND distance = 4000"))
    assertEquals(5, count("SELECT COUNT(*) FROM step_samples"))
  }

  @Test
  fun aWorkoutImportedWithoutItsTrackIsFilledInOnceAndWatchWorkoutsAreNeverTouched() {
    val start = 1_750_000_020L
    db.execSQL(
      """INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, steps, summary_json, complete, imported)
         VALUES (0, ?, ?, 255, 'Workout (Huawei type 3)', 600, 0, 0, 0, '{}', 1, 1)""",
      arrayOf<Any>(start, start + 600),
    )
    db.execSQL(
      """INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, steps, summary_json, complete, imported)
         VALUES (1, ?, ?, 1, 'Running', 600, 100, 10, 0, '{}', 1, 0)""",
      arrayOf<Any>(start + 100_000, start + 100_600),
    )
    fun workout(at: Long) = ImportedWorkout(
      at, at + 600, 3, "Biking", 600, 2500, 285, 3243, 100, 120, "{}",
      listOf(WorkoutPoint(at, -6.2, 106.8, null, null), WorkoutPoint(at + 5, null, null, null, 88)),
    )
    val first = store.writeWorkout(workout(start + 1))
    assertEquals(true, first.updated)
    assertEquals(false, first.added)
    assertEquals(2, first.points)
    assertEquals(false, store.writeWorkout(workout(start + 1)).updated)
    assertEquals(1, count("SELECT COUNT(*) FROM workouts WHERE start = $start AND sport_type = 3 AND distance = 2500 AND calories = 285"))
    assertEquals(2, count("SELECT COUNT(*) FROM workout_points"))
    val watch = store.writeWorkout(workout(start + 100_001))
    assertEquals(false, watch.updated || watch.added)
    assertEquals(1, count("SELECT COUNT(*) FROM workouts WHERE sport_type = 1 AND distance = 100"))
  }

  @Test
  fun aWorkoutImportedWithoutItsSportIsNamedOnceAndKeepsItsTrack() {
    val start = 1_750_000_020L
    for ((i, name) in listOf("Workout (Huawei type unknown)", "Workout (Huawei type 283)").withIndex()) {
      val at = start + i * 100_000L
      db.execSQL(
        """INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, steps, summary_json, complete, imported)
           VALUES (0, ?, ?, 255, ?, 600, 0, 0, 0, '{}', 1, 1)""",
        arrayOf<Any>(at, at + 600, name),
      )
      db.execSQL("INSERT INTO workout_points (workout_id, ts, lat, lon) SELECT id, ?, -6.2, 106.8 FROM workouts WHERE start = ?", arrayOf<Any>(at, at))
    }
    fun workout(at: Long, type: Int, name: String) = ImportedWorkout(
      at, at + 600, type, name, 600, 2500, 285, 3243, 100, 120, "{}",
      listOf(WorkoutPoint(at, -6.2, 106.8, null, null), WorkoutPoint(at + 5, null, null, null, 88)),
    )
    val first = store.writeWorkout(workout(start, 1, "Running"))
    assertEquals(true, first.updated)
    assertEquals(0, first.points)
    assertEquals(false, store.writeWorkout(workout(start, 1, "Running")).updated)
    assertEquals(1, count("SELECT COUNT(*) FROM workouts WHERE start = $start AND sport_type = 1 AND sport_name = 'Running' AND distance = 2500 AND calories = 285"))
    // A workout whose sport id was read but is not one JoyoFit names stays as it is.
    assertEquals(false, store.writeWorkout(workout(start + 100_000, 255, "Workout (Huawei type 283)")).updated)
    assertEquals(2, count("SELECT COUNT(*) FROM workout_points"))
  }

  @Test
  fun sleepStagesOverlappingWatchSleepAreSkippedAndASecondRunAddsNothing() {
    db.execSQL("INSERT INTO sleep_segments (start, end, type, stage, imported) VALUES (1750000000, 1750003600, 7, 'deep', 0)")
    val rows = listOf(
      ImportedSleep(1_750_001_000L, 1_750_002_000L, 6, "light"), // inside the watch's stage
      ImportedSleep(1_749_990_000L, 1_750_000_100L, 6, "light"), // overlaps its start
      ImportedSleep(1_750_100_000L, 1_750_101_000L, 6, "light"), // a night the watch did not have
      ImportedSleep(1_750_100_000L, 1_750_102_000L, 6, "light"), // the same stage twice in the export
    )
    assertEquals(1, store.writeSleep(rows))
    assertEquals(0, store.writeSleep(rows))
    assertEquals(2, count("SELECT COUNT(*) FROM sleep_segments"))
  }

  @Test
  fun theQueueKeepsWhatIsThereAndImportedWeighInsAreWaitingForJoyoRogo() {
    val items = listOf(QueuedImport("meal", "r:0", """{"kcal":1}"""), QueuedImport("water", "2026-08-02", """{"glasses":3}"""))
    assertEquals(2, store.queueForRogo(items))
    assertEquals(0, store.queueForRogo(items))
    db.execSQL("UPDATE rogo_import_queue SET state = 'sent' WHERE kind = 'meal'")
    assertEquals(0, store.queueForRogo(listOf(QueuedImport("meal", "r:0", """{"kcal":2}"""))))
    assertEquals(1, count("SELECT COUNT(*) FROM rogo_import_queue WHERE kind = 'meal' AND state = 'sent' AND payload = '{\"kcal\":1}'"))
    assertEquals(1, count("SELECT COUNT(*) FROM rogo_import_queue WHERE kind = 'water' AND state = 'pending'"))
    createScaleTableLikeJs()
    store.writeWeighIns(listOf(ImportedWeighIn(t0, 80.0, null, null)))
    assertEquals(1, count("SELECT COUNT(*) FROM scale_reading WHERE scale_id = 'huawei-health-export' AND rogo_state = 'pending'"))
  }
}
