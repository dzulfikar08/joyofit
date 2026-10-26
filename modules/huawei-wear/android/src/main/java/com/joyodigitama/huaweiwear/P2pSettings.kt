package com.joyodigitama.huaweiwear

import android.content.Context
import android.content.SharedPreferences

/** What [HealthModelService] keeps between requests; [P2pSettings] stores it, tests use memory. */
internal interface HealthLivingState {
  var healthLivingEnabled: Boolean
  var healthLivingMsgVer: Float
  var healthLivingPackageSize: Int
  var healthLivingLastRequestMs: Long
  var healthLivingLastReportMs: Long
  var healthLivingLastSummary: String?
}

/**
 * Switches and bookkeeping of the P2P (service 0x34) features: Healthy Living replies, the experimental
 * running-course push. Own SharedPreferences file so the background service reads it without JS.
 */
internal class P2pSettings(context: Context) : HealthLivingState {
  private val prefs: SharedPreferences = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  /** Answer the watch's Healthy Living requests and push the day when data changes. On by default: the watch only asks when the user opens the app. */
  override var healthLivingEnabled: Boolean
    get() = prefs.getBoolean(KEY_HEALTH_LIVING, true)
    set(value) = prefs.edit().putBoolean(KEY_HEALTH_LIVING, value).apply()

  /** The watch asked at least once, with this `msgVer` (0 = never); Huawei Health only pushes unasked after a request. */
  override var healthLivingMsgVer: Float
    get() = prefs.getFloat(KEY_HL_VER, 0f)
    set(value) = prefs.edit().putFloat(KEY_HL_VER, value).apply()

  override var healthLivingPackageSize: Int
    get() = prefs.getInt(KEY_HL_PACKAGE, 0)
    set(value) = prefs.edit().putInt(KEY_HL_PACKAGE, value).apply()

  override var healthLivingLastRequestMs: Long
    get() = prefs.getLong(KEY_HL_REQUEST, 0L)
    set(value) = prefs.edit().putLong(KEY_HL_REQUEST, value).apply()

  override var healthLivingLastReportMs: Long
    get() = prefs.getLong(KEY_HL_REPORT, 0L)
    set(value) = prefs.edit().putLong(KEY_HL_REPORT, value).apply()

  override var healthLivingLastSummary: String?
    get() = prefs.getString(KEY_HL_SUMMARY, null)
    set(value) = prefs.edit().apply { if (value == null) remove(KEY_HL_SUMMARY) else putString(KEY_HL_SUMMARY, value) }.apply()

  /** The running-course editor and push (service `fitness`). Off: the static analysis behind it is not complete, see protocol/README.md. */
  var experimentalCourses: Boolean
    get() = prefs.getBoolean(KEY_COURSES, false)
    set(value) = prefs.edit().putBoolean(KEY_COURSES, value).apply()

  /** The offline-map lab (P2P module `mapkit`, docs/offline-maps.md). Off: a lab test of OSM-built maps, unproven on any watch JoyoFit supports. */
  var offlineMapLab: Boolean
    get() = prefs.getBoolean(KEY_OFFLINE_MAP_LAB, false)
    set(value) = prefs.edit().putBoolean(KEY_OFFLINE_MAP_LAB, value).apply()

  /** Watch navigation with JoyoFit's own watch app (JRG-439, [WatchNav]). Off: a lab test until the watch app is signed and installed. */
  var watchNavLab: Boolean
    get() = prefs.getBoolean(KEY_WATCH_NAV_LAB, false)
    set(value) = prefs.edit().putBoolean(KEY_WATCH_NAV_LAB, value).apply()

  /** The quick replies the user chose (one per line); null until the app sent a list. Never contains a newline inside a reply. */
  var quickReplies: List<String>?
    get() = prefs.getString(KEY_QUICK, null)?.split('\n')
    set(value) = prefs.edit().apply { if (value == null) remove(KEY_QUICK) else putString(KEY_QUICK, value.joinToString("\n")) }.apply()

  /** `<watch address>|<fingerprint>` of the list the watch last got, so a reconnect sends only a changed list. */
  var quickRepliesSent: String?
    get() = prefs.getString(KEY_QUICK_SENT, null)
    set(value) = prefs.edit().apply { if (value == null) remove(KEY_QUICK_SENT) else putString(KEY_QUICK_SENT, value) }.apply()

  private companion object {
    const val KEY_QUICK = "quick_replies"
    const val KEY_QUICK_SENT = "quick_replies_sent"
    const val PREFS_NAME = "joyofit_p2p"
    const val KEY_HEALTH_LIVING = "health_living"
    const val KEY_HL_VER = "hl_ver"
    const val KEY_HL_PACKAGE = "hl_package"
    const val KEY_HL_REQUEST = "hl_request_ms"
    const val KEY_HL_REPORT = "hl_report_ms"
    const val KEY_HL_SUMMARY = "hl_summary"
    const val KEY_COURSES = "courses_experimental"
    const val KEY_OFFLINE_MAP_LAB = "offline_map_lab"
    const val KEY_WATCH_NAV_LAB = "watch_nav_lab"
  }
}
