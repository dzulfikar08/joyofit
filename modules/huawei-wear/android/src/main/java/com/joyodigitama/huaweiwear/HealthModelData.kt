package com.joyodigitama.huaweiwear

import android.database.sqlite.SQLiteException
import java.time.LocalDate
import java.time.ZoneId
import org.json.JSONArray
import org.json.JSONException

/** Reads one local day of JoyoFit data out of the shared database for [HealthModelBuilder]. */
internal object HealthModelData {
  const val DEFAULT_STEP_GOAL = 8000

  /** `yyyyMMdd` of the local day containing [ms], Huawei's `recordDay`. */
  fun recordDayOf(ms: Long, zone: ZoneId = ZoneId.systemDefault()): Int {
    val d = java.time.Instant.ofEpochMilli(ms).atZone(zone).toLocalDate()
    return d.year * 10000 + d.monthValue * 100 + d.dayOfMonth
  }

  fun dateOf(recordDay: Int): LocalDate? = try {
    LocalDate.of(recordDay / 10000, recordDay / 100 % 100, recordDay % 100)
  } catch (e: java.time.DateTimeException) {
    null
  }

  /** The day to answer for: the requested one, else today (a request with `recordDay` 0 or an impossible date). */
  fun load(db: WearDatabase, requestedDay: Int, stepGoal: Int, nowMs: Long, zone: ZoneId = ZoneId.systemDefault()): HealthDay {
    val date = dateOf(requestedDay) ?: java.time.Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
    val recordDay = date.year * 10000 + date.monthValue * 100 + date.dayOfMonth
    val from = date.atStartOfDay(zone).toEpochSecond()
    val to = date.plusDays(1).atStartOfDay(zone).toEpochSecond()

    val steps = scalarLong(db, "SELECT COALESCE(SUM(steps), 0) FROM step_samples WHERE timestamp >= ? AND timestamp < ?", from, to) ?: 0L
    val newest = scalarLong(db, "SELECT MAX(timestamp) FROM step_samples WHERE timestamp >= ? AND timestamp < ?", from, to)
    val exerciseSeconds = scalarLong(db, "SELECT COALESCE(SUM(duration), 0) FROM workouts WHERE start >= ? AND start < ?", from, to) ?: 0L
    // A night counts on the day it ends; awake spans are not sleep, and stage-less rows are cleaned first (SleepStore).
    val sleepSeconds = sleepSecondsEndingIn(db, from + 1, to + 1)?.takeIf { it > 0 }
    val stress = scalarLong(db, "SELECT COUNT(*) FROM health_metrics WHERE type = 'emotion' AND ts >= ? AND ts < ?", from, to) ?: 0L
    val bp = scalarLong(db, "SELECT COUNT(*) FROM health_metrics WHERE type = 'blood_pressure' AND ts >= ? AND ts < ?", from, to) ?: 0L

    return HealthDay(
      recordDay = recordDay,
      steps = steps.toInt(),
      stepGoal = if (stepGoal > 0) stepGoal else DEFAULT_STEP_GOAL,
      exerciseMinutes = (exerciseSeconds / 60).toInt(),
      sleepSeconds = sleepSeconds?.toInt(),
      intakeKcal = intakeKcal(db, date.toString()),
      weightKg = null,
      bloodPressure = bp > 0,
      stressMeasured = stress > 0,
      timestampMs = if (newest != null) newest * 1000 else minOf(nowMs, to * 1000),
    )
  }

  /** Sum of `kcal` over the meals of the diet day (`diet_day.meals_json`, written by the diet card); null when the day has no row. */
  fun intakeKcal(db: WearDatabase, date: String): Double? = try {
    db.rawQuery("SELECT meals_json FROM diet_day WHERE date = ?", arrayOf(date)).use { cursor ->
      if (!cursor.moveToFirst() || cursor.isNull(0)) {
        null
      } else {
        val meals = JSONArray(cursor.getString(0))
        var sum = 0.0
        for (i in 0 until meals.length()) sum += meals.optJSONObject(i)?.optDouble("kcal", 0.0) ?: 0.0
        sum
      }
    }
  } catch (e: SQLiteException) {
    null // the table is created by the diet migration; without it there is no diet day
  } catch (e: JSONException) {
    null
  }

  private fun scalarLong(db: WearDatabase, sql: String, vararg args: Long): Long? =
    try {
      db.rawQuery(sql, Array(args.size) { args[it].toString() }).use { if (it.moveToFirst() && !it.isNull(0)) it.getLong(0) else null }
    } catch (e: SQLiteException) {
      null // a table of a later migration is not there yet
    }

  /** Seconds asleep in cleaned segments that end in `[fromEndSec, toEndSec)`; null when a table of a later migration is not there yet. */
  private fun sleepSecondsEndingIn(db: WearDatabase, fromEndSec: Long, toEndSec: Long): Long? =
    try {
      SleepStore.load(db, fromEndSec, toEndSec).sumOf { if (it.stage == "awake") 0L else maxOf(0L, it.end - it.start) }
    } catch (e: SQLiteException) {
      null
    }
}
