package com.joyodigitama.huaweiwear

import android.content.Context
import android.content.SharedPreferences

/**
 * What the satellite-data job remembers between runs: the newest download on the phone, the last delivery
 * to the watch, what the watch last asked for, and the retry state. Own SharedPreferences file; nothing here is personal data
 * (only tag names, never the paths and URLs the watch names, which can carry a rough position).
 */
internal class AgpsStore(private val prefs: SharedPreferences) {
  constructor(context: Context) : this(context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE))

  /** When the newest download finished (phone clock, ms); 0 when none. */
  val cachedAtMs: Long get() = prefs.getLong(KEY_CACHED_AT, 0L)

  /** The age of that data itself (the server's Last-Modified, else the download time). */
  val cachedDataMs: Long get() = prefs.getLong(KEY_CACHED_DATA, 0L)
  val cachedSize: Int get() = prefs.getInt(KEY_CACHED_SIZE, 0)
  val cachedSource: String get() = prefs.getString(KEY_CACHED_SOURCE, "") ?: ""

  val deliveredAtMs: Long get() = prefs.getLong(KEY_DELIVERED_AT, 0L)
  val deliveredDataMs: Long get() = prefs.getLong(KEY_DELIVERED_DATA, 0L)
  val deliveredSize: Int get() = prefs.getInt(KEY_DELIVERED_SIZE, 0)
  val deliveredSource: String get() = prefs.getString(KEY_DELIVERED_SOURCE, "") ?: ""

  /** The watch (its address) the last delivery went to; the screen shows a delivery only for the watch it is looking at. */
  val deliveredAddress: String get() = prefs.getString(KEY_DELIVERED_ADDRESS, "") ?: ""

  val lastAskMs: Long get() = prefs.getLong(KEY_ASK_AT, 0L)

  /** The download version the watch named in its last consult; -1 when it never asked. */
  val lastAskVersion: Int get() = prefs.getInt(KEY_ASK_VERSION, -1)

  /** Tag names of that consult (the last `/` segment of each entry), joined by `,`. */
  val lastAskTags: String get() = prefs.getString(KEY_ASK_TAGS, "") ?: ""

  val lastOutcome: String get() = prefs.getString(KEY_OUTCOME, AgpsOutcome.NONE) ?: AgpsOutcome.NONE
  val lastError: String get() = prefs.getString(KEY_ERROR, "") ?: ""
  val lastAttemptMs: Long get() = prefs.getLong(KEY_ATTEMPT_AT, 0L)

  /** Failed downloads in a row, and when the last one happened. */
  val failures: Int get() = prefs.getInt(KEY_FAILURES, 0)
  val lastFailureMs: Long get() = prefs.getLong(KEY_FAILURE_AT, 0L)

  fun retryAtMs(): Long = AgpsPolicy.retryAtMs(lastFailureMs, failures)

  /** The experimental switch ([AgpsLab]): serve JoyoFit's HW_AGNSS file to a watch that asks for exactly that kind. Off by default. */
  val labAgnss: Boolean get() = prefs.getBoolean(KEY_LAB_AGNSS, false)

  fun setLabAgnss(enabled: Boolean) {
    prefs.edit().putBoolean(KEY_LAB_AGNSS, enabled).apply()
  }

  /** The second experimental switch ([AgpsPgnss]): serve JoyoFit's six HW_PGNSS_* files to a watch that asks for `HW_PGNSS_PRED`. Off by default. */
  val labPgnss: Boolean get() = prefs.getBoolean(KEY_LAB_PGNSS, false)

  fun setLabPgnss(enabled: Boolean) {
    prefs.edit().putBoolean(KEY_LAB_PGNSS, enabled).apply()
  }

  /**
   * The server's build time (Last-Modified) of the PGNSS bundle on the phone; 0 when none. Kept apart from [cachedDataMs], which the watch's
   * HW_AGNSS ask two seconds earlier overwrites, so the 800 KB copy is not fetched again for every PRED ask.
   */
  val pgnssBuiltMs: Long get() = prefs.getLong(KEY_PGNSS_BUILT, 0L)

  fun recordPgnssBuilt(builtMs: Long) {
    prefs.edit().putLong(KEY_PGNSS_BUILT, builtMs).apply()
  }

  /** The watch asked (its op 1) but has not yet said what kind of data it wants. */
  fun touchAsk(nowMs: Long) {
    prefs.edit().putLong(KEY_ASK_AT, nowMs).apply()
  }

  fun recordAsk(nowMs: Long, version: Int, tags: String) {
    prefs.edit().putLong(KEY_ASK_AT, nowMs).putInt(KEY_ASK_VERSION, version).putString(KEY_ASK_TAGS, tags.take(MAX_TAGS_CHARS)).apply()
  }

  fun recordDownloaded(nowMs: Long, dataMs: Long, size: Int, source: String) {
    prefs.edit()
      .putLong(KEY_CACHED_AT, nowMs).putLong(KEY_CACHED_DATA, dataMs).putInt(KEY_CACHED_SIZE, size).putString(KEY_CACHED_SOURCE, source)
      .putInt(KEY_FAILURES, 0).putLong(KEY_FAILURE_AT, 0L)
      .apply()
  }

  fun recordDelivered(nowMs: Long, dataMs: Long, size: Int, source: String, address: String) {
    prefs.edit()
      .putString(KEY_DELIVERED_ADDRESS, address)
      .putLong(KEY_DELIVERED_AT, nowMs).putLong(KEY_DELIVERED_DATA, dataMs).putInt(KEY_DELIVERED_SIZE, size).putString(KEY_DELIVERED_SOURCE, source)
      .putString(KEY_OUTCOME, AgpsOutcome.DELIVERED).putString(KEY_ERROR, "").putLong(KEY_ATTEMPT_AT, nowMs)
      .apply()
  }

  /** An attempt that ended without a delivery. [countsAsFailure] feeds the retry schedule (download problems only). */
  fun recordOutcome(nowMs: Long, outcome: String, error: String, countsAsFailure: Boolean) {
    val edit = prefs.edit().putString(KEY_OUTCOME, outcome).putString(KEY_ERROR, error.take(MAX_ERROR_CHARS)).putLong(KEY_ATTEMPT_AT, nowMs)
    if (countsAsFailure) edit.putInt(KEY_FAILURES, failures + 1).putLong(KEY_FAILURE_AT, nowMs)
    edit.apply()
  }

  /** The user asked for a refresh: the retry wait ends. */
  fun clearRetry() {
    prefs.edit().putInt(KEY_FAILURES, 0).putLong(KEY_FAILURE_AT, 0L).apply()
  }

  private companion object {
    const val PREFS_NAME = "joyofit_agps"
    const val KEY_CACHED_AT = "cached_at"
    const val KEY_CACHED_DATA = "cached_data"
    const val KEY_CACHED_SIZE = "cached_size"
    const val KEY_CACHED_SOURCE = "cached_source"
    const val KEY_DELIVERED_AT = "delivered_at"
    const val KEY_DELIVERED_DATA = "delivered_data"
    const val KEY_DELIVERED_SIZE = "delivered_size"
    const val KEY_DELIVERED_SOURCE = "delivered_source"
    const val KEY_DELIVERED_ADDRESS = "delivered_address"
    const val KEY_ASK_AT = "ask_at"
    const val KEY_ASK_VERSION = "ask_version"
    const val KEY_ASK_TAGS = "ask_tags"
    const val KEY_OUTCOME = "outcome"
    const val KEY_ERROR = "error"
    const val KEY_ATTEMPT_AT = "attempt_at"
    const val KEY_FAILURES = "failures"
    const val KEY_FAILURE_AT = "failure_at"
    const val KEY_LAB_AGNSS = "lab_agnss"
    const val KEY_LAB_PGNSS = "lab_pgnss"
    const val KEY_PGNSS_BUILT = "pgnss_built"
    const val MAX_TAGS_CHARS = 120
    const val MAX_ERROR_CHARS = 200
  }
}
