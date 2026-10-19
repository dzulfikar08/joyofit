package com.joyodigitama.huaweiwear

/**
 * Reads `sleep_segments` for everything that totals or groups sleep, and cleans the stage-less rows on the way
 * ([SleepCleaning.cleanUnstagedSleep]). The raw rows stay as the watch sent them, so a rule change re-derives every
 * stored night the next time it is read. Same as `listSleepSince` and `sleepEvidence` in src/db/queries.ts.
 */
internal object SleepStore {
  /**
   * Rows this far outside a requested range are read too, so a stage-less run that crosses the edge of the range is
   * cleaned whole instead of being cut into a piece too short to count.
   */
  const val CLEAN_MARGIN_SEC = 6 * 3600L

  /**
   * Cleaned segments whose end lies in `[fromEndSec, toEndSec)`, sorted by start. [importedOnly] keeps the
   * `imported = 0` filter of a consumer that ignores rows from a Huawei export; the evidence always covers every row.
   */
  fun load(db: WearDatabase, fromEndSec: Long, toEndSec: Long = Long.MAX_VALUE, importedOnly: Boolean = false): List<SleepSegment> {
    val raw = loadRaw(db, fromEndSec - CLEAN_MARGIN_SEC, if (toEndSec > Long.MAX_VALUE - CLEAN_MARGIN_SEC) Long.MAX_VALUE else toEndSec + CLEAN_MARGIN_SEC, importedOnly)
    return clean(db, raw).filter { it.end >= fromEndSec && it.end < toEndSec }
  }

  /** The stored rows whose end lies in `[fromEndSec, toEndSec)`, exactly as stored. */
  fun loadRaw(db: WearDatabase, fromEndSec: Long, toEndSec: Long = Long.MAX_VALUE, importedOnly: Boolean = false): List<SleepSegment> =
    db.rawQuery(
      "SELECT start, end, type, stage FROM sleep_segments WHERE end >= ? AND end < ?" +
        (if (importedOnly) " AND imported = 0" else "") + " ORDER BY start, end",
      arrayOf(fromEndSec.toString(), toEndSec.toString()),
    ).use { c ->
      val out = ArrayList<SleepSegment>(c.count)
      while (c.moveToNext()) out.add(SleepSegment(c.getLong(0), c.getLong(1), c.getInt(2), if (c.isNull(3)) null else c.getString(3)))
      out
    }

  /** [raw] cleaned with the evidence the database holds about the span of its stage-less rows; staged-only history reads no evidence. */
  fun clean(db: WearDatabase, raw: List<SleepSegment>): List<SleepSegment> {
    var from = Long.MAX_VALUE
    var to = Long.MIN_VALUE
    for (s in raw) {
      if (s.stage != null) continue
      from = minOf(from, s.start)
      to = maxOf(to, s.end)
    }
    if (from > to) return SleepCleaning.cleanUnstagedSleep(raw, SleepEvidence.NONE)
    return SleepCleaning.cleanUnstagedSleep(raw, evidence(db, from, to))
  }

  /**
   * What the stored workouts, spot HRV measurements and per-minute steps say about `[from, to]`. Only minutes with real
   * walking are read, never the whole step history.
   */
  fun evidence(db: WearDatabase, from: Long, to: Long): SleepEvidence {
    val workouts = db.rawQuery(
      // The CAST: a bound string compares as text against an expression, which has no column affinity to turn it into a number.
      "SELECT start, end, duration FROM workouts WHERE start <= ? AND (end >= ? OR start + duration >= CAST(? AS INTEGER))",
      arrayOf(to.toString(), from.toString(), from.toString()),
    ).use { c ->
      val out = ArrayList<TimeSpan>(c.count)
      while (c.moveToNext()) out.add(SleepCleaning.workoutSpan(c.getLong(0), c.getLong(1), c.getLong(2)))
      out
    }
    val spots = db.rawQuery(
      "SELECT start, end FROM hrv_readings WHERE source = 'spot' AND end >= ? AND start <= ?",
      arrayOf((from - SleepCleaning.SPOT_MARGIN_SEC).toString(), (to + SleepCleaning.SPOT_MARGIN_SEC).toString()),
    ).use { c ->
      val out = ArrayList<TimeSpan>(c.count)
      while (c.moveToNext()) out.add(TimeSpan(c.getLong(0), c.getLong(1)))
      out
    }
    val active = db.rawQuery(
      "SELECT timestamp FROM step_samples WHERE timestamp >= ? AND timestamp <= ? AND steps >= ?",
      arrayOf((from - 60).toString(), to.toString(), SleepCleaning.ACTIVE_STEPS_PER_MIN.toString()),
    ).use { c ->
      val out = ArrayList<Long>(c.count)
      while (c.moveToNext()) out.add(c.getLong(0))
      out
    }
    return SleepEvidence(workouts, spots, active)
  }
}
