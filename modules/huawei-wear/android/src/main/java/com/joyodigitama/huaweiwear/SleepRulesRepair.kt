package com.joyodigitama.huaweiwear

/**
 * What an update that changes the sleep rules ([SleepCleaning.SLEEP_RULES_VERSION]) has to re-derive besides what is
 * computed on every read (Today, the sleep report, the family summary, the model data all read through [SleepStore]):
 *
 *  - Health Connect sessions already written: [HealthConnectExporter.repairSleepIfDue].
 *  - Night HRV rows (`hrv_readings` source `night`), which belong to a night of the sleep as it was then. Rows that no
 *    longer lie within a night of the cleaned sleep are deleted here ([pruneNightHrvIfDue]); nights whose span changed
 *    are recomputed by the next night HRV sync, which reaches back over the whole file while the repair is pending
 *    ([NightHrvSync]), and which sets the marker when it is done.
 *
 * Both are marked per rules version in preferences, so each runs once after the update and again only when the version
 * is raised.
 */
internal object SleepRulesRepair {
  /**
   * The stored night rows that are not part of any night of at least [SleepReport.MIN_NIGHT_SEC] asleep: a night built
   * on stress checks or a morning run that the cleaned sleep no longer has, or one that shrank to a nap. A row inside a
   * night stays: an unchanged night keeps its row exactly, and a changed one is replaced when it is recomputed.
   */
  fun staleNightRows(rows: List<TimeSpan>, nights: List<NightSpan>): List<TimeSpan> {
    val real = nights.filter { it.asleepSec >= SleepReport.MIN_NIGHT_SEC }
    return rows.filter { row -> real.none { row.start >= it.start && row.end <= it.end } }
  }

  /** Deletes the stale night HRV rows of all stored history; returns how many. */
  fun pruneNightHrv(db: WearDatabase): Int {
    val nights = NightHrv.nights(SleepStore.load(db, 0L))
    val rows = db.rawQuery("SELECT start, end FROM hrv_readings WHERE source = 'night'", null).use { c ->
      val out = ArrayList<TimeSpan>(c.count)
      while (c.moveToNext()) out.add(TimeSpan(c.getLong(0), c.getLong(1)))
      out
    }
    val stale = staleNightRows(rows, nights)
    if (stale.isEmpty()) return 0
    db.beginTransaction()
    try {
      for (row in stale) db.execSQL("DELETE FROM hrv_readings WHERE source = 'night' AND start = ?", arrayOf<Any?>(row.start))
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
    return stale.size
  }

  /** Whether what was last re-derived under [storedVersion] (0 before any repair) has to be re-derived for the current rules. */
  fun due(storedVersion: Int): Boolean = storedVersion < SleepCleaning.SLEEP_RULES_VERSION

  /** Whether the night HRV rows still have to be re-derived for the current rules version. */
  fun nightHrvDue(settings: WearSettings): Boolean = due(settings.nightHrvRulesVersion)
}
