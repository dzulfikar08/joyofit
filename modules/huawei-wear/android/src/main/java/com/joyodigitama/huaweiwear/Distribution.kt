package com.joyodigitama.huaweiwear

/**
 * Which build this is: "play" (Google Play: no SEND_SMS, READ_CALL_LOG, READ_CONTACTS or REQUEST_IGNORE_BATTERY_OPTIMIZATIONS in the
 * manifest) or "sideload" (the APK from the website or a self-build). Set at build time by `JOYOFIT_DISTRIBUTION` (see `build.gradle`).
 */
internal object Distribution {
  val name: String = BuildConfig.DISTRIBUTION

  val isPlay: Boolean get() = name == "play"

  /** The build can send the SOS text message the watch asks for (needs SEND_SMS in the manifest). */
  val canSendSms: Boolean get() = !isPlay

  /** The build can learn the caller's number and name of an incoming call (READ_CALL_LOG, READ_CONTACTS). */
  val canIdentifyCaller: Boolean get() = !isPlay

  /**
   * The build can show the system's "allow this app to ignore battery optimization" dialog (REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).
   * Google Play allows that prompt only for apps whose core function Doze breaks, and lists a peripheral companion that syncs
   * periodically as not acceptable, so the Play build opens the battery optimization list instead ([BatteryExemption]).
   */
  val canRequestBatteryExemption: Boolean get() = !isPlay
}
