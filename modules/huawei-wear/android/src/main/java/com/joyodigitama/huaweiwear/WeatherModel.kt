// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): HuaweiWeatherManager.openWeatherMapConditionCodeToHuaweiIcon,
// model/WeatherSpec (toBeaufort, windSpeed in km/h).
package com.joyodigitama.huaweiwear

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Weather

/** One forecast hour. Temperatures are degrees Celsius; [code] is a WMO weather code. */
internal data class WeatherHour(
  val timestamp: Int,
  val code: Int,
  val tempC: Double,
  /** Percent, null when the model gives none. */
  val precipProbability: Int?,
  val uvIndex: Double?,
)

/**
 * One forecast day. Sun and moon times are unix seconds, 0 when the body does not rise or set that day (polar sun, or the day the
 * moon skips its rise or set).
 */
internal data class WeatherDay(
  /** Local midnight at the place, unix seconds. */
  val timestamp: Int,
  val code: Int,
  val maxC: Double,
  val minC: Double,
  val sunrise: Int,
  val sunset: Int,
  val moonrise: Int = 0,
  val moonset: Int = 0,
)

/** What Open-Meteo returned, in the units GB's WeatherSpec uses (km/h, degrees Celsius, unix seconds). */
internal data class WeatherReport(
  val fetchedAtSec: Long,
  val observedAtSec: Int,
  val place: WeatherPlace,
  /** WMO weather code of the current conditions. */
  val code: Int,
  val tempC: Double,
  val feelsLikeC: Double,
  val humidity: Int,
  val windSpeedKmh: Double,
  val windDirection: Int,
  val uvIndex: Double?,
  val hourly: List<WeatherHour>,
  /** Today first. */
  val daily: List<WeatherDay>,
  /** Rows Open-Meteo listed but without a temperature or weather code, left out of [hourly]; the watch wants whole lists. */
  val skippedHours: Int = 0,
  /** Same for [daily]. */
  val skippedDays: Int = 0,
)

/**
 * WMO weather interpretation code (Open-Meteo `weather_code`) to the Huawei icon.
 *
 * GB has no WMO mapping, but it maps OpenWeatherMap condition codes to Huawei icons
 * ([openWeatherMapToHuaweiIcon], a verbatim port). So a WMO code is first mapped to the closest
 * OpenWeatherMap code, then through GB's table:
 *
 * | WMO | Meaning | OWM | Huawei icon |
 * |---|---|---|---|
 * | 0 | clear sky | 800 | SUNNY |
 * | 1 | mainly clear | 801 | CLOUDY |
 * | 2 | partly cloudy | 802 | CLOUDY |
 * | 3 | overcast | 804 | OVERCAST |
 * | 45, 48 | fog, rime fog | 741 | FOG |
 * | 51 / 53 / 55 | drizzle light / moderate / dense | 300 / 301 / 302 | LIGHT_RAIN |
 * | 56, 57 | freezing drizzle | 511 | FREEZING_RAIN |
 * | 61 / 63 / 65 | rain slight / moderate / heavy | 500 / 501 / 502 | LIGHT_RAIN / RAIN / HEAVY_RAIN |
 * | 66, 67 | freezing rain | 511 | FREEZING_RAIN |
 * | 71 | snow slight | 600 | LIGHT_SNOW |
 * | 73 | snow moderate | 601 | SNOW |
 * | 75 | snow heavy | 602 | HEAVY_SNOW |
 * | 77 | snow grains | 600 | LIGHT_SNOW |
 * | 80 / 81 / 82 | rain showers slight / moderate / violent | 500 / 501 / 502 | LIGHT_RAIN / RAIN / HEAVY_RAIN |
 * | 85 | snow showers slight | 600 | LIGHT_SNOW |
 * | 86 | snow showers heavy | 602 | HEAVY_SNOW |
 * | 95 | thunderstorm | 211 | THUNDERSTORMS |
 * | 96, 99 | thunderstorm with hail | 212 | THUNDERSTORMS |
 *
 * Any other code becomes UNKNOWN (0x63), as GB does for an unmapped condition. The Huawei enum has
 * no separate night icons; the watch picks them from the sun times it is sent.
 */
internal object WeatherIcons {
  fun wmoToOpenWeatherMap(wmo: Int): Int = when (wmo) {
    0 -> 800
    1 -> 801
    2 -> 802
    3 -> 804
    45, 48 -> 741
    51 -> 300
    53 -> 301
    55 -> 302
    56, 57, 66, 67 -> 511
    61, 80 -> 500
    63, 81 -> 501
    65, 82 -> 502
    71, 77, 85 -> 600
    73 -> 601
    75, 86 -> 602
    95 -> 211
    96, 99 -> 212
    else -> -1
  }

  fun forWmo(wmo: Int): Weather.WeatherIcon = openWeatherMapToHuaweiIcon(wmoToOpenWeatherMap(wmo))

  /** HuaweiWeatherManager.openWeatherMapConditionCodeToHuaweiIcon, unchanged. */
  fun openWeatherMapToHuaweiIcon(conditionCode: Int): Weather.WeatherIcon {
    // More exact first, groups after
    when (conditionCode) {
      500 -> return Weather.WeatherIcon.LIGHT_RAIN
      501 -> return Weather.WeatherIcon.RAIN
      502 -> return Weather.WeatherIcon.HEAVY_RAIN
      503 -> return Weather.WeatherIcon.RAIN_STORM
      504 -> return Weather.WeatherIcon.SEVERE_RAIN_STORMS
      511 -> return Weather.WeatherIcon.FREEZING_RAIN
      600 -> return Weather.WeatherIcon.LIGHT_SNOW
      601 -> return Weather.WeatherIcon.SNOW
      602 -> return Weather.WeatherIcon.HEAVY_SNOW
      611 -> return Weather.WeatherIcon.SLEET
      701, 741 -> return Weather.WeatherIcon.FOG
      721 -> return Weather.WeatherIcon.HAZY
      751 -> return Weather.WeatherIcon.SAND
      761 -> return Weather.WeatherIcon.DUST
      800 -> return Weather.WeatherIcon.SUNNY
      801, 802 -> return Weather.WeatherIcon.CLOUDY
      803, 804 -> return Weather.WeatherIcon.OVERCAST
    }
    if (conditionCode in 200..299) return Weather.WeatherIcon.THUNDERSTORMS
    if (conditionCode in 300..399) return Weather.WeatherIcon.LIGHT_RAIN
    if (conditionCode in 500..599) return Weather.WeatherIcon.RAIN
    if (conditionCode in 600..699) return Weather.WeatherIcon.SNOW
    return Weather.WeatherIcon.UNKNOWN
  }
}

/** GB `WeatherSpec.toBeaufort`: lower bounds of Beaufort 1 to 12 in km/h. */
internal object Beaufort {
  private val lowerBounds = floatArrayOf(2f, 6f, 12f, 20f, 29f, 39f, 50f, 62f, 75f, 89f, 103f, 118f)

  fun fromKmh(speed: Double): Int {
    var level = 0
    while (level < lowerBounds.size && lowerBounds[level] < speed) level++
    return level
  }
}

/**
 * The moon phase is computed from the mean synodic month (not fetched; moon rise and set are). Accurate to
 * about a day, which is what the watch's eight-step phase icon needs. 0 is new moon, 180 full moon.
 */
internal object Moon {
  private const val SYNODIC_DAYS = 29.530588853

  /** Julian date of a known new moon (2000-01-06 18:14 UTC). */
  private const val NEW_MOON_JD = 2451550.26

  fun phaseDegrees(epochSec: Long): Int {
    val julianDate = epochSec / 86400.0 + 2440587.5
    var cycles = (julianDate - NEW_MOON_JD) / SYNODIC_DAYS
    cycles -= Math.floor(cycles)
    return Math.round(cycles * 360.0).toInt() % 360
  }
}
