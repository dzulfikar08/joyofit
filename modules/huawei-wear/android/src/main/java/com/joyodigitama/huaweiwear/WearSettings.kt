package com.joyodigitama.huaweiwear

import android.content.Context
import android.content.SharedPreferences

/** Profile and goal as the JS Settings screen stores them (`UserProfile` in `HuaweiWear.types.ts`). */
internal data class UserProfileData(
  val heightCm: Int,
  val weightKg: Double,
  val birthYear: Int,
  /** `male`, `female` or `unknown`. */
  val sex: String,
  val dailyStepGoal: Int,
) {
  fun toJs(): Map<String, Any?> = mapOf(
    "heightCm" to heightCm,
    "weightKg" to weightKg,
    "birthYear" to birthYear,
    "sex" to sex,
    "dailyStepGoal" to dailyStepGoal,
  )
}

/**
 * Everything the user configures that must survive without JS running: the remembered watch,
 * background mode and its sync interval, notification forwarding (switch + per-app choices) and
 * the profile/goal. One private SharedPreferences file, read by the service, the listener and the module.
 */
internal class WearSettings(context: Context) {
  private val prefs: SharedPreferences =
    context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  /** Watches that pull their whole history on the next sync because the link was moved to them from another watch. */
  val switchBackfill = SwitchBackfill(prefs)

  /** The watch last connected from the app or enabled for background (uppercase MAC). */
  var watchAddress: String?
    get() = prefs.getString(KEY_ADDRESS, null)
    set(value) = prefs.edit().apply { if (value == null) remove(KEY_ADDRESS) else putString(KEY_ADDRESS, value) }.apply()

  var watchName: String?
    get() = prefs.getString(KEY_NAME, null)
    set(value) = prefs.edit().apply { if (value == null) remove(KEY_NAME) else putString(KEY_NAME, value) }.apply()

  var backgroundEnabled: Boolean
    get() = prefs.getBoolean(KEY_BACKGROUND, false)
    set(value) = prefs.edit().putBoolean(KEY_BACKGROUND, value).apply()

  /**
   * Developer switch: open every watch over Bluetooth LE GATT (service 0xFE86) instead of the link its model uses, to find out whether
   * a Classic watch also answers the Huawei protocol over LE (what an iOS port would need). Off by default, and ignored outside debug
   * builds: the switch is hidden there, and a value saved by an earlier debug install must not move a Classic watch onto LE, where
   * Android 14+ discards the watch's 514-byte notifications and any longer reply is lost.
   */
  var forceBle: Boolean
    get() = BuildConfig.DEBUG && prefs.getBoolean(KEY_FORCE_BLE, false)
    set(value) = prefs.edit().putBoolean(KEY_FORCE_BLE, value).apply()

  var syncIntervalMinutes: Int
    get() = prefs.getInt(KEY_INTERVAL, DEFAULT_SYNC_INTERVAL_MIN)
    set(value) = prefs.edit().putInt(KEY_INTERVAL, value).apply()

  /**
   * The user's Huawei account id (the 17-18 digit `userId` of their Huawei account), sent to the watch in 1A/05
   * SendExtendedAccountToDevice so a watch that was set up under that account keeps its data instead of asking for a factory reset
   * (Gadgetbridge PREF_HUAWEI_ACCOUNT; the user enters it on the watch-face screen). null or blank = send Gadgetbridge's empty
   * default, the behaviour before this setting existed. This is only an account id; no signature or token is involved.
   */
  var huaweiAccount: String?
    get() = prefs.getString(KEY_HUAWEI_ACCOUNT, null)?.takeIf { it.isNotBlank() }
    set(value) = prefs.edit().apply {
      val clean = value?.trim()
      if (clean.isNullOrEmpty()) remove(KEY_HUAWEI_ACCOUNT) else putString(KEY_HUAWEI_ACCOUNT, clean)
    }.apply()

  var notificationsEnabled: Boolean
    get() = prefs.getBoolean(KEY_NOTIFICATIONS, false)
    set(value) = prefs.edit().putBoolean(KEY_NOTIFICATIONS, value).apply()

  /** The once-a-day morning summary notification (off by default). */
  var morningSummaryEnabled: Boolean
    get() = prefs.getBoolean(KEY_MORNING_SUMMARY, false)
    set(value) = prefs.edit().putBoolean(KEY_MORNING_SUMMARY, value).apply()

  /** Local date (`yyyy-MM-dd`) the morning summary was last posted, so it posts once per day. */
  var morningSummaryDay: String?
    get() = prefs.getString(KEY_MORNING_SUMMARY_DAY, null)
    set(value) = prefs.edit().apply { if (value == null) remove(KEY_MORNING_SUMMARY_DAY) else putString(KEY_MORNING_SUMMARY_DAY, value) }.apply()

  /** Explicit per-app choice: true = forward, false = block, null = default policy. */
  fun appChoice(packageName: String): Boolean? = when {
    prefs.getStringSet(KEY_APPS_ON, emptySet())!!.contains(packageName) -> true
    prefs.getStringSet(KEY_APPS_OFF, emptySet())!!.contains(packageName) -> false
    else -> null
  }

  @Synchronized
  fun setAppChoice(packageName: String, enabled: Boolean) {
    val on = HashSet(prefs.getStringSet(KEY_APPS_ON, emptySet())!!)
    val off = HashSet(prefs.getStringSet(KEY_APPS_OFF, emptySet())!!)
    if (enabled) {
      on.add(packageName)
      off.remove(packageName)
    } else {
      off.add(packageName)
      on.remove(packageName)
    }
    prefs.edit().putStringSet(KEY_APPS_ON, on).putStringSet(KEY_APPS_OFF, off).apply()
  }

  /** The watch-side health sensor switches (see [HealthSensorConfig]); defaults match Huawei Health. */
  var healthSensors: HealthSensorConfig
    get() = HealthSensorConfig(
      automaticHeartRate = prefs.getBoolean(KEY_AUTO_HEART_RATE, true),
      automaticSpo2 = prefs.getBoolean(KEY_AUTO_SPO2, true),
      truSleep = prefs.getBoolean(KEY_TRUSLEEP, true),
      highHeartRateAlert = prefs.getInt(KEY_HIGH_HR_ALERT, 0),
      lowHeartRateAlert = prefs.getInt(KEY_LOW_HR_ALERT, 0),
    )
    set(value) = prefs.edit()
      .putBoolean(KEY_AUTO_HEART_RATE, value.automaticHeartRate)
      .putBoolean(KEY_AUTO_SPO2, value.automaticSpo2)
      .putBoolean(KEY_TRUSLEEP, value.truSleep)
      .putInt(KEY_HIGH_HR_ALERT, value.highHeartRateAlert)
      .putInt(KEY_LOW_HR_ALERT, value.lowHeartRateAlert)
      .apply()

  /**
   * The language JoyoFit's "Bahasa" setting pinned (`id`, `en`), sent to the watch as its language; null follows the phone
   * ([WatchLocale.resolve]).
   */
  var watchLanguage: String?
    get() = prefs.getString(KEY_WATCH_LANGUAGE, null)
    set(value) = prefs.edit().apply { if (value == null) remove(KEY_WATCH_LANGUAGE) else putString(KEY_WATCH_LANGUAGE, value) }.apply()

  /** The watch's automatic stress switch as the user last set it here (GB PREF_HUAWEI_STRESS_SWITCH). */
  var stressEnabled: Boolean
    get() = prefs.getBoolean(KEY_STRESS_ENABLED, false)
    set(value) = prefs.edit().putBoolean(KEY_STRESS_ENABLED, value).apply()

  /** The last stress calibration as `HuaweiStressParser.stressDataToJsonStr` (GB PREF_HUAWEI_STRESS_LAST_DATA), so it can be re-sent. */
  var stressCalibration: String?
    get() = prefs.getString(KEY_STRESS_CALIBRATION, null)
    set(value) = prefs.edit().apply { if (value == null) remove(KEY_STRESS_CALIBRATION) else putString(KEY_STRESS_CALIBRATION, value) }.apply()

  /**
   * Whether the watch listed the automatic stress command (20/09) the last time it connected; null before any connect. The live
   * answer only exists while connected, and the app has to tell a watch that cannot record night HRV from one that is just
   * away (`StressStatus.knownSupported`).
   */
  var autoStressListed: Boolean?
    get() = if (prefs.contains(KEY_AUTO_STRESS_LISTED)) prefs.getBoolean(KEY_AUTO_STRESS_LISTED, false) else null
    set(value) = prefs.edit().apply { if (value == null) remove(KEY_AUTO_STRESS_LISTED) else putBoolean(KEY_AUTO_STRESS_LISTED, value) }.apply()

  /**
   * The [SleepCleaning.SLEEP_RULES_VERSION] the stored night HRV rows were last re-derived under, 0 before. Set by the night
   * HRV sync once it has gone through the whole file (see [SleepRulesRepair]).
   */
  var nightHrvRulesVersion: Int
    get() = prefs.getInt(KEY_NIGHT_HRV_RULES, 0)
    set(value) = prefs.edit().putInt(KEY_NIGHT_HRV_RULES, value).apply()

  /**
   * The heart-rate zones the user set in the app (`setHeartRateZones`), sent to the watch at every connect; null = GB's defaults
   * for the profile age. Stored as one string: `method;maxHr;restingHr;z1,z2,z3,z4,z5;warningEnabled;warningLimit`.
   */
  var heartRateZones: HeartRateZonesCalc.UserZones?
    get() {
      val parts = prefs.getString(KEY_HR_ZONES, null)?.split(';') ?: return null
      if (parts.size != 6) return null
      val method = when (parts[0]) {
        "max" -> HeartRateZonesCalc.Method.MHR
        "hrr" -> HeartRateZonesCalc.Method.HRR
        else -> return null
      }
      val zones = parts[3].split(',').map { it.toIntOrNull() ?: return null }
      val user = HeartRateZonesCalc.UserZones(
        method, parts[1].toIntOrNull() ?: return null, parts[2].toIntOrNull() ?: return null, zones, parts[4] == "1",
        parts[5].toIntOrNull() ?: return null,
      )
      return if (user.problem() == null) user else null
    }
    set(value) = prefs.edit().apply {
      if (value == null) {
        remove(KEY_HR_ZONES)
      } else {
        val method = if (value.method == HeartRateZonesCalc.Method.HRR) "hrr" else "max"
        putString(KEY_HR_ZONES, "$method;${value.maxHr};${value.restingHr};${value.zones.joinToString(",")};${if (value.warningEnabled) 1 else 0};${value.warningLimit}")
      }
    }.apply()

  var profile: UserProfileData?
    get() {
      if (!prefs.contains(KEY_PROFILE_HEIGHT)) return null
      return UserProfileData(
        heightCm = prefs.getInt(KEY_PROFILE_HEIGHT, 0),
        weightKg = java.lang.Double.longBitsToDouble(prefs.getLong(KEY_PROFILE_WEIGHT, 0L)),
        birthYear = prefs.getInt(KEY_PROFILE_BIRTH_YEAR, 0),
        sex = prefs.getString(KEY_PROFILE_SEX, "unknown") ?: "unknown",
        dailyStepGoal = prefs.getInt(KEY_PROFILE_GOAL, 0),
      )
    }
    set(value) {
      val editor = prefs.edit()
      if (value == null) {
        editor.remove(KEY_PROFILE_HEIGHT).remove(KEY_PROFILE_WEIGHT).remove(KEY_PROFILE_BIRTH_YEAR)
          .remove(KEY_PROFILE_SEX).remove(KEY_PROFILE_GOAL)
      } else {
        editor.putInt(KEY_PROFILE_HEIGHT, value.heightCm)
          .putLong(KEY_PROFILE_WEIGHT, java.lang.Double.doubleToRawLongBits(value.weightKg))
          .putInt(KEY_PROFILE_BIRTH_YEAR, value.birthYear)
          .putString(KEY_PROFILE_SEX, value.sex)
          .putInt(KEY_PROFILE_GOAL, value.dailyStepGoal)
      }
      editor.apply()
    }

  companion object {
    const val DEFAULT_SYNC_INTERVAL_MIN = 30
    const val MIN_SYNC_INTERVAL_MIN = 5
    const val MAX_SYNC_INTERVAL_MIN = 1440

    private const val PREFS_NAME = "joyofit_settings"
    private const val KEY_ADDRESS = "watch_address"
    private const val KEY_NAME = "watch_name"
    private const val KEY_BACKGROUND = "background_enabled"
    private const val KEY_FORCE_BLE = "force_ble"
    private const val KEY_INTERVAL = "sync_interval_min"
    private const val KEY_HUAWEI_ACCOUNT = "huawei_account_id"
    private const val KEY_NOTIFICATIONS = "notifications_enabled"
    private const val KEY_MORNING_SUMMARY = "morning_summary_enabled"
    private const val KEY_MORNING_SUMMARY_DAY = "morning_summary_day"
    private const val KEY_APPS_ON = "notification_apps_on"
    private const val KEY_APPS_OFF = "notification_apps_off"
    private const val KEY_HR_ZONES = "heart_rate_zones"
    private const val KEY_PROFILE_HEIGHT = "profile_height_cm"
    private const val KEY_PROFILE_WEIGHT = "profile_weight_kg"
    private const val KEY_PROFILE_BIRTH_YEAR = "profile_birth_year"
    private const val KEY_PROFILE_SEX = "profile_sex"
    private const val KEY_PROFILE_GOAL = "profile_step_goal"
    private const val KEY_AUTO_HEART_RATE = "sensor_auto_heart_rate"
    private const val KEY_AUTO_SPO2 = "sensor_auto_spo2"
    private const val KEY_TRUSLEEP = "sensor_trusleep"
    private const val KEY_HIGH_HR_ALERT = "sensor_high_hr_alert"
    private const val KEY_LOW_HR_ALERT = "sensor_low_hr_alert"
    private const val KEY_STRESS_ENABLED = "stress_automatic"
    private const val KEY_WATCH_LANGUAGE = "watch_language"
    private const val KEY_STRESS_CALIBRATION = "stress_calibration"
    private const val KEY_AUTO_STRESS_LISTED = "stress_auto_listed"
    private const val KEY_NIGHT_HRV_RULES = "night_hrv_sleep_rules_version"
  }
}
