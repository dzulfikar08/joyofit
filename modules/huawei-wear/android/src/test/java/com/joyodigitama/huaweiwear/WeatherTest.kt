package com.joyodigitama.huaweiwear

import java.time.ZoneId
import java.time.ZonedDateTime
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Weather
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WeatherTest {
  @After
  fun resetCaps() = DeviceCaps.reset()

  private val zone: ZoneId = ZoneId.of("Asia/Jakarta")
  private val now: Long = ZonedDateTime.of(2026, 10, 14, 10, 30, 0, 0, zone).toEpochSecond()
  private fun day(offset: Long): Long = ZonedDateTime.of(2026, 10, 14, 0, 0, 0, 0, zone).plusDays(offset).toEpochSecond()

  private fun params() = HuaweiPacket.ParamsProvider().also { it.setSecretKey(ByteArray(16)) }

  private fun allSupported() = Weather.Settings().apply {
    weatherSupported = true
    windSupported = true
    pm25Supported = true
    temperatureSupported = true
    locationNameSupported = true
    currentTemperatureSupported = true
    unitSupported = true
    airQualityIndexSupported = true
    timeSupported = true
    sourceSupported = true
    weatherIconSupported = true
    sunRiseSetSupported = true
    moonPhaseSupported = true
    extendedHourlyForecast = true
    uvIndexSupported = true
  }

  private fun report(): WeatherReport {
    val hours = (0 until 48).map { i ->
      WeatherHour(
        timestamp = (day(0) + 3600L * i).toInt(),
        code = if (i % 2 == 0) 0 else 63,
        tempC = 24.0 + i,
        precipProbability = if (i == 5) null else 40,
        uvIndex = 3.4,
      )
    }
    val days = (0 until 8).map { i ->
      WeatherDay(
        timestamp = day(i.toLong()).toInt(),
        code = 61,
        maxC = 31.4 + i,
        minC = 22.6 - i,
        sunrise = (day(i.toLong()) + 5 * 3600 + 40 * 60).toInt(),
        sunset = (day(i.toLong()) + 17 * 3600 + 50 * 60).toInt(),
        moonrise = (day(i.toLong()) + 12 * 3600 + 10 * 60).toInt(),
        moonset = (day(i.toLong()) + 7 * 60).toInt(),
      )
    }
    return WeatherReport(
      fetchedAtSec = now,
      observedAtSec = now.toInt(),
      place = WeatherPlace("Bandung", -6.91, 107.61),
      code = 2,
      tempC = 27.6,
      feelsLikeC = 30.2,
      humidity = 78,
      windSpeedKmh = 14.0,
      windDirection = 90,
      uvIndex = 5.2,
      hourly = hours,
      daily = days,
    )
  }

  @Test
  fun wmoCodesMapThroughOpenWeatherMapToHuaweiIcons() {
    val expected = mapOf(
      0 to Weather.WeatherIcon.SUNNY,
      1 to Weather.WeatherIcon.CLOUDY,
      2 to Weather.WeatherIcon.CLOUDY,
      3 to Weather.WeatherIcon.OVERCAST,
      45 to Weather.WeatherIcon.FOG,
      48 to Weather.WeatherIcon.FOG,
      51 to Weather.WeatherIcon.LIGHT_RAIN,
      55 to Weather.WeatherIcon.LIGHT_RAIN,
      56 to Weather.WeatherIcon.FREEZING_RAIN,
      61 to Weather.WeatherIcon.LIGHT_RAIN,
      63 to Weather.WeatherIcon.RAIN,
      65 to Weather.WeatherIcon.HEAVY_RAIN,
      67 to Weather.WeatherIcon.FREEZING_RAIN,
      71 to Weather.WeatherIcon.LIGHT_SNOW,
      73 to Weather.WeatherIcon.SNOW,
      75 to Weather.WeatherIcon.HEAVY_SNOW,
      77 to Weather.WeatherIcon.LIGHT_SNOW,
      80 to Weather.WeatherIcon.LIGHT_RAIN,
      81 to Weather.WeatherIcon.RAIN,
      82 to Weather.WeatherIcon.HEAVY_RAIN,
      85 to Weather.WeatherIcon.LIGHT_SNOW,
      86 to Weather.WeatherIcon.HEAVY_SNOW,
      95 to Weather.WeatherIcon.THUNDERSTORMS,
      96 to Weather.WeatherIcon.THUNDERSTORMS,
      99 to Weather.WeatherIcon.THUNDERSTORMS,
      42 to Weather.WeatherIcon.UNKNOWN,
    )
    for ((wmo, icon) in expected) assertEquals("WMO $wmo", icon, WeatherIcons.forWmo(wmo))
  }

  @Test
  fun openWeatherMapGroupsFollowGb() {
    assertEquals(Weather.WeatherIcon.THUNDERSTORMS, WeatherIcons.openWeatherMapToHuaweiIcon(231))
    assertEquals(Weather.WeatherIcon.LIGHT_RAIN, WeatherIcons.openWeatherMapToHuaweiIcon(321))
    assertEquals(Weather.WeatherIcon.RAIN, WeatherIcons.openWeatherMapToHuaweiIcon(522))
    assertEquals(Weather.WeatherIcon.SNOW, WeatherIcons.openWeatherMapToHuaweiIcon(621))
    assertEquals(Weather.WeatherIcon.HAZY, WeatherIcons.openWeatherMapToHuaweiIcon(721))
    assertEquals(Weather.WeatherIcon.UNKNOWN, WeatherIcons.openWeatherMapToHuaweiIcon(900))
  }

  @Test
  fun beaufortUsesGbBounds() {
    assertEquals(0, Beaufort.fromKmh(0.0))
    assertEquals(0, Beaufort.fromKmh(2.0))
    assertEquals(1, Beaufort.fromKmh(2.1))
    assertEquals(3, Beaufort.fromKmh(14.0))
    assertEquals(12, Beaufort.fromKmh(200.0))
  }

  @Test
  fun moonPhaseTracksKnownNewAndFullMoons() {
    // New moon 2024-01-11 11:57 UTC, full moon 2024-01-25 17:54 UTC.
    assertEquals(Weather.MoonPhase.NEW_MOON, Weather.degreesToMoonPhase(Moon.phaseDegrees(1704974220L)))
    assertEquals(Weather.MoonPhase.FULL_MOON, Weather.degreesToMoonPhase(Moon.phaseDegrees(1706205240L)))
  }

  @Test
  fun forecastJsonParses() {
    val json = """
      {"latitude":-6.9,"longitude":107.6,"timezone":"Asia/Jakarta","utc_offset_seconds":25200,
       "current":{"time":1760412600,"interval":900,"temperature_2m":27.6,"relative_humidity_2m":78,
         "apparent_temperature":30.2,"weather_code":2,"wind_speed_10m":14.0,"wind_direction_10m":90,"uv_index":5.2},
       "hourly":{"time":[1760410800,1760414400,1760418000],"temperature_2m":[27.0,28.5,null],
         "weather_code":[2,3,3],"precipitation_probability":[10,null,30],"uv_index":[5.0,6.0,null]},
       "daily":{"time":[1760374800,1760461200],"weather_code":[61,3],"temperature_2m_max":[31.4,30.0],
         "temperature_2m_min":[22.6,22.0],"sunrise":[1760395200,null],"sunset":[1760438400,1760481600],
         "moonrise":[1760418600,null],"moonset":[1760375220,1760462100]}}
    """.trimIndent()
    val place = WeatherPlace("Bandung", -6.9, 107.6)
    val report = OpenMeteo.parseForecast(json, place, 1760412700L)
    assertEquals(1760412600, report.observedAtSec)
    assertEquals(2, report.code)
    assertEquals(27.6, report.tempC, 0.001)
    assertEquals(30.2, report.feelsLikeC, 0.001)
    assertEquals(78, report.humidity)
    assertEquals(90, report.windDirection)
    assertEquals(5.2, report.uvIndex!!, 0.001)
    // The hour with a null temperature is dropped and counted; a null probability stays null.
    assertEquals(2, report.hourly.size)
    assertEquals(1, report.skippedHours)
    assertEquals(0, report.skippedDays)
    assertNull(report.hourly[1].precipProbability)
    assertEquals(2, report.daily.size)
    assertEquals(0, report.daily[1].sunrise)
    assertEquals(1760438400, report.daily[0].sunset)
    assertEquals(1760418600, report.daily[0].moonrise)
    assertEquals(1760375220, report.daily[0].moonset)
    // A day the moon does not rise (null) is 0, which the packet skips.
    assertEquals(0, report.daily[1].moonrise)
    assertEquals(1760462100, report.daily[1].moonset)
  }

  @Test
  fun errorBodyIsABadResponse() {
    val failure = runCatching {
      OpenMeteo.parseForecast("""{"error":true,"reason":"Latitude must be in range"}""", WeatherPlace(null, 0.0, 0.0), 0)
    }.exceptionOrNull()
    assertTrue(failure is OpenMeteo.BadResponseException)
  }

  @Test
  fun geocodingResultsAndQualifier() {
    val json = """
      {"results":[
        {"name":"Bandung","latitude":-6.92,"longitude":107.60,"country":"Indonesia","country_code":"ID","admin1":"West Java"},
        {"name":"Bandung","latitude":3.0,"longitude":101.0,"country":"Malaysia","country_code":"MY"}]}
    """.trimIndent()
    val places = OpenMeteo.parseGeocoding(json)
    assertEquals(2, places.size)
    assertEquals("West Java, Indonesia, ID", places[0].detail)
    assertEquals("Malaysia, MY", places[1].detail)
    assertEquals(places, OpenMeteo.matchQualifier(places, ""))
    assertEquals(listOf(places[1]), OpenMeteo.matchQualifier(places, "malaysia"))
    assertEquals(listOf(places[0]), OpenMeteo.matchQualifier(places, "ID"))
    assertTrue(OpenMeteo.parseGeocoding("{}").isEmpty())
  }

  @Test
  fun urlsAreCoarseAndEncoded() {
    val url = OpenMeteo.forecastUrl(-6.9147444, 107.6098111)
    assertTrue(url.startsWith("https://api.open-meteo.com/v1/forecast?latitude=-6.91&longitude=107.61&"))
    assertTrue(url.contains("timeformat=unixtime"))
    assertTrue(url.contains("&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,moonrise,moonset&"))
    assertEquals(
      "https://geocoding-api.open-meteo.com/v1/search?name=S%C3%A3o+Paulo&count=1&language=en&format=json",
      OpenMeteo.geocodingUrl("São Paulo", 1),
    )
  }

  @Test
  fun temperaturesRoundAndClamp() {
    assertEquals(28.toByte(), WeatherPackets.temperatureByte(27.6))
    assertEquals((-4).toByte(), WeatherPackets.temperatureByte(-3.6))
    assertEquals(127.toByte(), WeatherPackets.temperatureByte(300.0))
    assertEquals((-128).toByte(), WeatherPackets.temperatureByte(-300.0))
  }

  @Test
  fun currentWeatherCarriesGbTags() {
    val packet = WeatherPackets.current(params(), allSupported(), report(), TemperatureUnit.FAHRENHEIT)
    assertEquals(Weather.id, packet.serviceId)
    assertEquals(Weather.CurrentWeatherRequest.id, packet.commandId)
    val tlv = packet.tlv
    val inner = tlv.getObject(0x81)
    assertEquals(0x01.toByte(), inner.getByte(0x02)) // CLOUDY for WMO 2
    // Beaufort 3 for 14 km/h in the low byte, direction E (2) in the high byte.
    assertEquals(0x0203.toShort(), inner.getShort(0x03))
    val range = tlv.getObject(0x85)
    assertEquals(23.toByte(), range.getByte(0x06)) // today's low 22.6 rounds to 23
    assertEquals(31.toByte(), range.getByte(0x07))
    assertEquals("Bandung", tlv.getString(0x08))
    assertEquals(28.toByte(), tlv.getByte(0x09))
    assertEquals(1.toByte(), tlv.getByte(0x0a)) // Fahrenheit display
    assertEquals(now.toInt(), tlv.getInteger(0x0c))
    assertEquals("Open-Meteo", tlv.getString(0x0e))
    assertEquals(5.toByte(), tlv.getByte(0x0f)) // UV index 5.2
    assertEquals(78.toByte(), tlv.getByte(0x10))
    assertEquals(14, tlv.getInteger(0x11))
    assertEquals(30, tlv.getInteger(0x12))
    assertFalse(tlv.contains(0x04)) // no pm25
    assertFalse(tlv.contains(0x0b)) // no air quality index
  }

  @Test
  fun currentWeatherOmitsWhatTheWatchDoesNotSupport() {
    val packet = WeatherPackets.current(params(), Weather.Settings(), report(), TemperatureUnit.CELSIUS)
    val tlv = packet.tlv
    assertFalse(tlv.contains(0x08))
    assertFalse(tlv.contains(0x09))
    assertFalse(tlv.contains(0x0a))
    assertFalse(tlv.contains(0x85))
  }

  @Test
  fun forecastHasNext24HoursAndEightDays() {
    val packet = WeatherPackets.forecast(params(), allSupported(), report(), now, zone)
    assertEquals(Weather.WeatherForecastData.id, packet.commandId)
    val hours = packet.tlv.getObject(0x81).getObjects(0x82)
    assertEquals(24, hours.size)
    // The first hour is the first one after "now" (11:00 local = index 11).
    assertEquals((day(0) + 3600L * 11).toInt(), hours[0].getInteger(0x03))
    assertEquals(0x08.toByte(), hours[0].getByte(0x04)) // odd index = WMO 63 = RAIN (0x08)
    assertEquals(35.toByte(), hours[0].getByte(0x05))
    assertEquals(40.toByte(), hours[0].getByte(0x06))
    assertEquals(3.toByte(), hours[0].getByte(0x07))

    val days = packet.tlv.getObject(0x90).getObjects(0x91)
    assertEquals(8, days.size)
    // Today: observation time, the current icon (WMO 2 = CLOUDY 0x01).
    assertEquals(now.toInt(), days[0].getInteger(0x12))
    assertEquals(0x01.toByte(), days[0].getByte(0x13))
    assertEquals(31.toByte(), days[0].getByte(0x14))
    assertEquals(23.toByte(), days[0].getByte(0x15))
    assertEquals((day(0) + 5 * 3600 + 40 * 60).toInt(), days[0].getInteger(0x16))
    assertEquals((day(0) + 17 * 3600 + 50 * 60).toInt(), days[0].getInteger(0x17))
    assertTrue(days[0].contains(0x1e)) // moon phase
    // Open-Meteo's moon times: 12:10 rise and 00:07 set of the local day, unix seconds, after the sun times.
    assertEquals((day(0) + 12 * 3600 + 10 * 60).toInt(), days[0].getInteger(0x1a))
    assertEquals((day(0) + 7 * 60).toInt(), days[0].getInteger(0x1b))
    assertEquals((day(3) + 12 * 3600 + 10 * 60).toInt(), days[3].getInteger(0x1a))
    // GB: later days are stamped observation + whole days and use the day's own icon (WMO 61 = LIGHT_RAIN 0x07).
    assertEquals(now.toInt() + 86400, days[1].getInteger(0x12))
    assertEquals(0x07.toByte(), days[1].getByte(0x13))
  }

  @Test
  fun sunTimesOutsideTheirDayAreDropped() {
    // GB fixupWeather: out when check <= start or check > end of the local day.
    assertEquals(0, WeatherPackets.sunInDay(0, zone, now, 0))
    assertEquals((day(0) + 3600).toInt(), WeatherPackets.sunInDay((day(0) + 3600).toInt(), zone, now, 0))
    assertEquals(0, WeatherPackets.sunInDay(day(0).toInt(), zone, now, 0))
    assertEquals(0, WeatherPackets.sunInDay((day(1) + 3600).toInt(), zone, now, 0))
    assertEquals((day(1) + 3600).toInt(), WeatherPackets.sunInDay((day(1) + 3600).toInt(), zone, now, 1))
  }

  @Test
  fun moonRiseAndSetFollowTheSunRiseSetBitAndTheDayCheck() {
    val full = WeatherPackets.forecastEntries(report(), now, zone)
    // GB Weather.java:603-612: 0x1a / 0x1b sit under sunRiseSetSupported; the phase (0x1e) has its own bit.
    val phaseOnly = allSupported().apply { sunRiseSetSupported = false }
    val noPhase = allSupported().apply { moonPhaseSupported = false }
    val onlyPhase = WeatherPackets.forecast(params(), phaseOnly, full).tlv.getObject(0x90).getObjects(0x91)[0]
    assertFalse(onlyPhase.contains(0x1a))
    assertFalse(onlyPhase.contains(0x1b))
    assertTrue(onlyPhase.contains(0x1e))
    val noPhaseDay = WeatherPackets.forecast(params(), noPhase, full).tlv.getObject(0x90).getObjects(0x91)[0]
    assertTrue(noPhaseDay.contains(0x1a))
    assertTrue(noPhaseDay.contains(0x1b))
    assertFalse(noPhaseDay.contains(0x1e))

    // A moon time outside its local day is dropped like a sun time (GB fixupWeather), 0 is skipped.
    val days = report().daily.toMutableList()
    days[0] = days[0].copy(moonrise = (day(1) + 3600).toInt(), moonset = 0)
    val skipped = WeatherPackets.forecastEntries(report().copy(daily = days), now, zone).days[0]
    assertEquals(0, skipped.moonRiseTime)
    assertEquals(0, skipped.moonSetTime)
    val tlv = WeatherPackets.forecast(params(), allSupported(), WeatherPackets.forecastEntries(report().copy(daily = days), now, zone))
      .tlv.getObject(0x90).getObjects(0x91)[0]
    assertFalse(tlv.contains(0x1a))
    assertFalse(tlv.contains(0x1b))
  }

  @Test
  fun forecastKeepsShortHourlyAndDailyLists() {
    val short = report().copy(hourly = emptyList(), daily = report().daily.take(2))
    val packet = WeatherPackets.forecast(params(), allSupported(), short, now, zone)
    assertFalse(packet.tlv.contains(0x81))
    assertEquals(2, packet.tlv.getObject(0x90).getObjects(0x91).size)
  }

  @Test
  fun errorPacketPrefersTheExtendedCommand() {
    assertNull(WeatherPackets.error(params(), Weather.ErrorCode.NETWORK_ERROR))
    DeviceCaps.supportedCommands = mapOf(0x0f to byteArrayOf(0x01, 0x07))
    assertEquals(0x07.toByte(), WeatherPackets.error(params(), Weather.ErrorCode.NETWORK_ERROR)!!.commandId)
    DeviceCaps.supportedCommands = mapOf(0x0f to byteArrayOf(0x01, 0x07, 0x0c))
    val extended = WeatherPackets.error(params(), Weather.ErrorCode.WEATHER_DISABLED)!!
    assertEquals(0x0c.toByte(), extended.commandId)
    assertEquals(2.toByte(), extended.tlv.getObject(0x81).getByte(0x02))
  }

  @Test
  fun gpsPacketRoundsAndBackdates() {
    val packet = WeatherPackets.gps(params(), now, WeatherPlace("x", -6.91474449, 107.60981119))
    assertEquals(0x18.toByte(), packet.serviceId)
    assertEquals(0x07.toByte(), packet.commandId)
    assertEquals((now - 86400).toInt(), packet.tlv.getInteger(0x01))
    assertTrue(packet.tlv.contains(0x02))
    assertTrue(packet.tlv.contains(0x03))
  }

  @Test
  fun everyPacketSerializesToWireFrames() {
    val settings = allSupported()
    val current = WeatherPackets.current(params(), settings, report(), TemperatureUnit.CELSIUS).serialize()
    assertEquals(0x5A.toByte(), current[0][0])
    val forecast = WeatherPackets.forecast(params(), settings, report(), now, zone).serialize()
    assertTrue("forecast is sliced", forecast.size > 1)
    assertEquals(0x5A.toByte(), forecast[0][0])
  }

  @Test
  fun supportFollowsSupportedCommands() {
    assertFalse(DeviceCaps.supports(0x0f, 0x01))
    DeviceCaps.supportedCommands = mapOf(0x0f to byteArrayOf(0x01, 0x02))
    assertTrue(DeviceCaps.supports(0x0f, 0x01))
  }

  @Test
  fun settingsWireNames() {
    assertEquals(TemperatureUnit.FAHRENHEIT, TemperatureUnit.fromWire("fahrenheit"))
    assertNull(TemperatureUnit.fromWire("kelvin"))
    assertEquals(WeatherLocationMode.CITY, WeatherLocationMode.fromWire("city"))
    assertNull(WeatherLocationMode.fromWire("gps"))
    assertEquals(Weather.ErrorCode.GPS_PERMISSION_ERROR, WeatherErrorCodes.watchError(WeatherErrorCodes.LOCATION))
    assertEquals(Weather.ErrorCode.NETWORK_ERROR, WeatherErrorCodes.watchError(WeatherErrorCodes.NETWORK))
    assertEquals(Weather.ErrorCode.WEATHER_DISABLED, WeatherErrorCodes.watchError(WeatherErrorCodes.DISABLED))
    assertNull(WeatherErrorCodes.watchError(ErrorCodes.TIMEOUT))
  }

  @Test
  fun forecastShapeReadsBackWhatTheSupportFlagsKept() {
    val full = WeatherPackets.forecastEntries(report(), now, zone)
    val everything = WeatherPackets.forecast(params(), allSupported(), full)
    assertEquals("24 hours (tags 03 04 05 06 07), 8 days (tags 12 13 14 15 16 17 1a 1b 1e)", WeatherPackets.forecastShape(everything, full))

    // What a watch without the extended and sun/moon commands is left with: no icon, no sun times, no moon phase.
    val plain = Weather.Settings().apply {
      weatherSupported = true
      temperatureSupported = true
      currentTemperatureSupported = true
    }
    assertEquals("24 hours (tags 03 05), 8 days (tags 12 14 15)", WeatherPackets.forecastShape(WeatherPackets.forecast(params(), plain, full), full))

    val nothing = WeatherPackets.forecast(params(), Weather.Settings(), full)
    assertEquals("24 hours (tags 03), 8 days (tags 12)", WeatherPackets.forecastShape(nothing, full))

    val empty = ForecastEntries(emptyList(), emptyList())
    assertEquals("0 hours (tags none), 0 days (tags none)", WeatherPackets.forecastShape(WeatherPackets.forecast(params(), allSupported(), empty), empty))
  }

  @Test
  fun theWatchGetsExactly24HoursAnd8DaysWhenTheDataHasThem() {
    assertTrue(WeatherPackets.countsAreComplete(WeatherPackets.forecastEntries(report(), now, zone)))
    // More data than the watch takes is cut to it.
    val long = report().let { it.copy(hourly = it.hourly + it.hourly.map { h -> h.copy(timestamp = h.timestamp + 48 * 3600) }) }
    assertEquals(24, WeatherPackets.forecastEntries(long, now, zone).hours.size)
    // Fewer days, or hours running out, are visible instead of passing for a full forecast.
    assertFalse(WeatherPackets.countsAreComplete(WeatherPackets.forecastEntries(report().copy(daily = report().daily.take(7)), now, zone)))
    val lateInTheData = WeatherPackets.forecastEntries(report(), day(1) + 20 * 3600, zone)
    // Index 44 is "now" (20:00 on day 1); only 45, 46 and 47 are still ahead.
    assertEquals(3, lateInTheData.hours.size)
    assertFalse(WeatherPackets.countsAreComplete(lateInTheData))
  }

  @Test
  fun gatesLineNamesEveryCommandAndCapabilityBit() {
    val line = WeatherGates.describe({ service, command -> service == 0x0f && command in setOf(0x01, 0x08) }, { it == 0xc0 })
    assertEquals(
      "current(0f/01)=yes unit(0f/05)=no extended(0f/06)=no forecast(0f/08)=yes sunMoon(0f/0a)=no errorSimple(0f/07)=no " +
        "errorExtended(0f/0c)=no gps(18/06)=no uvIndex(cap 0x2f)=no extendedHourly(cap 0xc0)=yes",
      line,
    )
  }

  @Test
  fun forecastOutcomeIsTheJsShape() {
    val outcome = ForecastOutcome(ForecastState.REJECTED, 24, 8, 0x000186A4, now)
    assertEquals(mapOf("state" to "rejected", "hours" to 24, "days" to 8, "replyCode" to 100004, "at" to now), outcome.toJs())
    assertEquals(setOf("sent", "unsupported", "unacknowledged", "rejected"), ForecastState.values().map { it.wire }.toSet())
  }
}
