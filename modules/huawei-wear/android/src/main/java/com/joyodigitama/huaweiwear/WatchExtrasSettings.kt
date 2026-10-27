package com.joyodigitama.huaweiwear

import android.content.Context
import android.content.SharedPreferences

/**
 * Switches and small state of the fall detection / SOS relay, the morning sleep report, DST sync, the
 * menstrual calendar and the songs-on-the-watch lab. Own SharedPreferences file so these features never touch the other settings.
 */
internal class WatchExtrasSettings(context: Context) {
  private val prefs: SharedPreferences =
    context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  /** The watch's fall detection switch as last seen: -1 unknown, 0 off, 1 on. */
  var fallSwitch: Int
    get() = prefs.getInt(KEY_FALL_SWITCH, -1)
    set(value) = prefs.edit().putInt(KEY_FALL_SWITCH, value).apply()

  /** When [fallSwitch] was last set or reported, unix ms; 0 when never. */
  var fallUpdatedMs: Long
    get() = prefs.getLong(KEY_FALL_UPDATED, 0L)
    set(value) = prefs.edit().putLong(KEY_FALL_UPDATED, value).apply()

  /** Send the SMS the watch asks for (SOS). Off until the user turns it on; never sends while off. */
  var sosRelayEnabled: Boolean
    get() = prefs.getBoolean(KEY_SOS_RELAY, false)
    set(value) = prefs.edit().putBoolean(KEY_SOS_RELAY, value).apply()

  /** Push the morning sleep report to the watch. On by default. */
  var sleepReportEnabled: Boolean
    get() = prefs.getBoolean(KEY_SLEEP_REPORT, true)
    set(value) = prefs.edit().putBoolean(KEY_SLEEP_REPORT, value).apply()

  /** `end` (unix s) of the last sleep session a report was pushed for; 0 when none. */
  var sleepReportLastEnd: Long
    get() = prefs.getLong(KEY_SLEEP_LAST_END, 0L)
    set(value) = prefs.edit().putLong(KEY_SLEEP_LAST_END, value).apply()

  /** The menstrual calendar on the watch. Off by default. */
  var cycleEnabled: Boolean
    get() = prefs.getBoolean(KEY_CYCLE, false)
    set(value) = prefs.edit().putBoolean(KEY_CYCLE, value).apply()

  /** The reminder switches (`MenstrualCodec.Switches.bitfield`), master off by default. */
  var cycleSwitches: MenstrualCodec.Switches
    get() = MenstrualCodec.Switches.fromBitfield(prefs.getInt(KEY_CYCLE_SWITCHES, DEFAULT_SWITCHES.bitfield(true)))
    set(value) = prefs.edit().putInt(KEY_CYCLE_SWITCHES, value.bitfield(true)).apply()

  /** Songs on the watch ([WatchMusicController], docs/watch-music.md). Off: a lab test, unverified on any watch. */
  var watchMusicLab: Boolean
    get() = prefs.getBoolean(KEY_WATCH_MUSIC_LAB, false)
    set(value) = prefs.edit().putBoolean(KEY_WATCH_MUSIC_LAB, value).apply()

  private companion object {
    const val PREFS_NAME = "joyofit_watch_extras"
    const val KEY_FALL_SWITCH = "fall_switch"
    const val KEY_FALL_UPDATED = "fall_updated"
    const val KEY_SOS_RELAY = "sos_relay"
    const val KEY_SLEEP_REPORT = "sleep_report"
    const val KEY_SLEEP_LAST_END = "sleep_last_end"
    const val KEY_CYCLE = "cycle"
    const val KEY_CYCLE_SWITCHES = "cycle_switches"
    const val KEY_WATCH_MUSIC_LAB = "watch_music_lab"
    val DEFAULT_SWITCHES = MenstrualCodec.Switches()
  }
}
