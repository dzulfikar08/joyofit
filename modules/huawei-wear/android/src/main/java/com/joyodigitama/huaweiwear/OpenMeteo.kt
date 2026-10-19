package com.joyodigitama.huaweiwear

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.Locale
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * Open-Meteo (https://open-meteo.com, no API key): the forecast for a point and the geocoding that
 * turns a city name into one. Requests use `timeformat=unixtime`, so every time in the reply is
 * unix seconds and no date parsing is needed. Temperatures are Celsius and wind is km/h (both are
 * the API defaults), the units GB's WeatherSpec carries.
 */
internal object OpenMeteo {
  private const val FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
  private const val GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"
  private const val CONNECT_TIMEOUT_MS = 10_000
  private const val READ_TIMEOUT_MS = 15_000

  /** Today plus seven days: the watch takes up to eight day entries. */
  private const val FORECAST_DAYS = 8

  /** An answer that is not the expected JSON; reported like a network failure. */
  class BadResponseException(message: String, cause: Throwable? = null) : IOException(message, cause)

  fun forecastUrl(latitude: Double, longitude: Double): String = FORECAST_URL +
    "?latitude=${coordinate(latitude)}&longitude=${coordinate(longitude)}" +
    "&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,uv_index" +
    "&hourly=temperature_2m,weather_code,precipitation_probability,uv_index" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,moonrise,moonset" +
    "&timezone=auto&timeformat=unixtime&forecast_days=$FORECAST_DAYS"

  fun geocodingUrl(name: String, count: Int): String =
    "$GEOCODING_URL?name=${URLEncoder.encode(name, "UTF-8")}&count=$count&language=en&format=json"

  /** Coarse on purpose: two decimals is about 1 km. */
  private fun coordinate(value: Double): String = String.format(Locale.US, "%.2f", value)

  fun get(url: String): String {
    val connection = URL(url).openConnection() as HttpURLConnection
    try {
      connection.connectTimeout = CONNECT_TIMEOUT_MS
      connection.readTimeout = READ_TIMEOUT_MS
      connection.setRequestProperty("Accept", "application/json")
      connection.setRequestProperty("User-Agent", "JoyoFit")
      val status = connection.responseCode
      if (status !in 200..299) {
        val reason = connection.errorStream?.use { String(it.readBytes(), Charsets.UTF_8) }?.take(200)
        throw BadResponseException("Open-Meteo answered HTTP $status${if (reason.isNullOrBlank()) "" else ": $reason"}")
      }
      return connection.inputStream.use { String(it.readBytes(), Charsets.UTF_8) }
    } finally {
      connection.disconnect()
    }
  }

  fun fetchForecast(place: WeatherPlace, nowSec: Long): WeatherReport =
    parseForecast(get(forecastUrl(place.latitude, place.longitude)), place, nowSec)

  fun parseForecast(json: String, place: WeatherPlace, fetchedAtSec: Long): WeatherReport {
    try {
      val root = JSONObject(json)
      if (root.optBoolean("error", false)) throw BadResponseException("Open-Meteo: ${root.optString("reason", "error")}")
      val current = root.getJSONObject("current")
      val hourly = root.getJSONObject("hourly")
      val daily = root.getJSONObject("daily")

      val hourTimes = hourly.getJSONArray("time")
      val hourTemps = hourly.getJSONArray("temperature_2m")
      val hourCodes = hourly.getJSONArray("weather_code")
      val hourPrecip = hourly.optJSONArray("precipitation_probability")
      val hourUv = hourly.optJSONArray("uv_index")
      val hours = ArrayList<WeatherHour>(hourTimes.length())
      var skippedHours = 0
      for (i in 0 until hourTimes.length()) {
        if (hourTemps.isNull(i) || hourCodes.isNull(i)) {
          skippedHours++
          continue
        }
        hours.add(
          WeatherHour(
            timestamp = hourTimes.getInt(i),
            code = hourCodes.getInt(i),
            tempC = hourTemps.getDouble(i),
            precipProbability = hourPrecip.intOrNull(i),
            uvIndex = hourUv.doubleOrNull(i),
          ),
        )
      }

      val dayTimes = daily.getJSONArray("time")
      val dayCodes = daily.getJSONArray("weather_code")
      val dayMax = daily.getJSONArray("temperature_2m_max")
      val dayMin = daily.getJSONArray("temperature_2m_min")
      val daySunrise = daily.optJSONArray("sunrise")
      val daySunset = daily.optJSONArray("sunset")
      val dayMoonrise = daily.optJSONArray("moonrise")
      val dayMoonset = daily.optJSONArray("moonset")
      val days = ArrayList<WeatherDay>(dayTimes.length())
      var skippedDays = 0
      for (i in 0 until dayTimes.length()) {
        if (dayCodes.isNull(i) || dayMax.isNull(i) || dayMin.isNull(i)) {
          skippedDays++
          continue
        }
        days.add(
          WeatherDay(
            timestamp = dayTimes.getInt(i),
            code = dayCodes.getInt(i),
            maxC = dayMax.getDouble(i),
            minC = dayMin.getDouble(i),
            // Null at polar latitudes (no sunrise or sunset that day); the packet skips 0.
            sunrise = daySunrise.intOrNull(i) ?: 0,
            sunset = daySunset.intOrNull(i) ?: 0,
            // Null on the day the moon does not rise (or set) between local midnights; the packet skips 0.
            moonrise = dayMoonrise.intOrNull(i) ?: 0,
            moonset = dayMoonset.intOrNull(i) ?: 0,
          ),
        )
      }
      if (days.isEmpty()) throw BadResponseException("Open-Meteo returned no daily forecast")

      return WeatherReport(
        fetchedAtSec = fetchedAtSec,
        observedAtSec = current.getInt("time"),
        place = place,
        code = current.getInt("weather_code"),
        tempC = current.getDouble("temperature_2m"),
        feelsLikeC = current.optDouble("apparent_temperature", current.getDouble("temperature_2m")),
        humidity = Math.round(current.optDouble("relative_humidity_2m", 0.0)).toInt(),
        windSpeedKmh = current.optDouble("wind_speed_10m", 0.0),
        windDirection = Math.round(current.optDouble("wind_direction_10m", 0.0)).toInt(),
        uvIndex = if (current.isNull("uv_index") || !current.has("uv_index")) null else current.getDouble("uv_index"),
        hourly = hours,
        daily = days,
        skippedHours = skippedHours,
        skippedDays = skippedDays,
      )
    } catch (e: JSONException) {
      throw BadResponseException("Open-Meteo answered something unexpected: ${e.message}", e)
    }
  }

  /**
   * Cities matching [query]. "Bandung, Indonesia" searches "Bandung" and keeps the results whose
   * country, region or country code equals the text after the comma, as the API matches names only.
   */
  fun searchCity(query: String): List<WeatherPlace> {
    val trimmed = query.trim()
    val name = trimmed.substringBefore(',').trim()
    val qualifier = if (trimmed.contains(',')) trimmed.substringAfter(',').trim() else ""
    if (name.isEmpty()) return emptyList()
    val found = parseGeocoding(get(geocodingUrl(name, if (qualifier.isEmpty()) 1 else 10)))
    return matchQualifier(found, qualifier)
  }

  fun matchQualifier(places: List<WeatherPlace>, qualifier: String): List<WeatherPlace> =
    if (qualifier.isEmpty()) places
    else places.filter { place -> place.detail?.split(", ")?.any { it.equals(qualifier, ignoreCase = true) } == true }

  /** Each result's detail is "region, country, COUNTRY_CODE" (the parts that exist). */
  fun parseGeocoding(json: String): List<WeatherPlace> {
    try {
      val results = JSONObject(json).optJSONArray("results") ?: return emptyList()
      val out = ArrayList<WeatherPlace>(results.length())
      for (i in 0 until results.length()) {
        val item = results.getJSONObject(i)
        val parts = listOf(item.optString("admin1", ""), item.optString("country", ""), item.optString("country_code", ""))
          .filter { it.isNotBlank() }
        out.add(
          WeatherPlace(
            name = item.getString("name"),
            latitude = item.getDouble("latitude"),
            longitude = item.getDouble("longitude"),
            detail = if (parts.isEmpty()) null else parts.joinToString(", "),
          ),
        )
      }
      return out
    } catch (e: JSONException) {
      throw BadResponseException("Open-Meteo geocoding answered something unexpected: ${e.message}", e)
    }
  }

  private fun JSONArray?.intOrNull(index: Int): Int? =
    if (this == null || index >= length() || isNull(index)) null else Math.round(getDouble(index)).toInt()

  private fun JSONArray?.doubleOrNull(index: Int): Double? =
    if (this == null || index >= length() || isNull(index)) null else getDouble(index)
}
