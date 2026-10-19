// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): HuaweiWeatherManager.{sendWeather,fixupWeather,handleAsyncMessage} and
// service/devices/huawei/requests/SendWeather{Start,Unit,Support,ExtendedSupport,SunMoonSupport,Current,Forecast,Error,Device}Request,
// SendGpsAndTimeToDeviceRequest, devices/huawei/packets/GpsAndTime.CurrentGPSRequest.
package com.joyodigitama.huaweiwear

import java.math.BigDecimal
import java.math.RoundingMode
import java.time.Instant
import java.time.ZoneId
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiConstants
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Weather

/** GpsAndTime (service 0x18) command 0x07: the phone's position and a timestamp, sent after the current weather. */
internal class CurrentGpsRequest(params: HuaweiPacket.ParamsProvider, timestamp: Int, latitude: Double, longitude: Double) : HuaweiPacket(params) {
  init {
    serviceId = GPS_AND_TIME_ID
    commandId = COMMAND_ID
    tlv = HuaweiTLV().put(0x01, timestamp).put(0x02, latitude).put(0x03, longitude)
    isEncrypted = true
    complete = true
  }

  companion object {
    const val GPS_AND_TIME_ID: Byte = 0x18
    const val COMMAND_ID: Byte = 0x07
  }
}

/** What the forecast step (0f/08) of a push did; [wire] is `WeatherForecastState` in `HuaweiWear.types.ts`. */
internal enum class ForecastState(val wire: String) {
  SENT("sent"),
  UNSUPPORTED("unsupported"),
  UNACKNOWLEDGED("unacknowledged"),
  REJECTED("rejected"),
}

internal class ForecastOutcome(val state: ForecastState, val hours: Int, val days: Int, val replyCode: Int?, val atSec: Long) {
  /** `WeatherForecastStatus` in `HuaweiWear.types.ts`. */
  fun toJs(): Map<String, Any?> = mapOf("state" to state.wire, "hours" to hours, "days" to days, "replyCode" to replyCode, "at" to atSec)
}

/** The hourly and daily rows of a forecast request. */
internal class ForecastEntries(
  val hours: List<Weather.WeatherForecastData.TimeData>,
  val days: List<Weather.WeatherForecastData.DayData>,
)

/** Builds GB's weather packets from a [WeatherReport]; no I/O, so it is testable on the JVM. */
internal object WeatherPackets {
  /** Whole degrees, clamped to the signed byte the watch takes. */
  fun temperatureByte(celsius: Double): Byte = Math.round(celsius).coerceIn(-128L, 127L).toByte()

  /** Hours the forecast request carries (SendWeatherForecastRequest). */
  const val MAX_HOURS = 24

  /** Days including today (SendWeatherForecastRequest). */
  const val MAX_DAYS = 8

  /**
   * SendWeatherCurrentRequest. Temperatures are always Celsius, like GB (`K - 273`); the unit tag
   * (0x0a) is what tells the watch to display Fahrenheit.
   */
  fun current(params: HuaweiPacket.ParamsProvider, settings: Weather.Settings, report: WeatherReport, unit: TemperatureUnit): HuaweiPacket {
    val today = report.daily.first()
    return Weather.CurrentWeatherRequest(
      params,
      settings,
      WeatherIcons.forWmo(report.code),
      report.windDirection,
      Beaufort.fromKmh(report.windSpeedKmh).toByte(),
      temperatureByte(today.minC),
      temperatureByte(today.maxC),
      null, // pm25: Open-Meteo's forecast API has no air quality
      report.place.name,
      temperatureByte(report.tempC),
      unitOf(unit),
      null, // air quality index
      report.observedAtSec,
      report.uvIndex?.toFloat(),
      SOURCE_NAME,
      report.humidity.coerceIn(0, 100).toByte(),
      Math.round(report.windSpeedKmh).toInt(),
      Math.round(report.feelsLikeC).toInt(),
    )
  }

  /**
   * SendWeatherForecastRequest after GB's fixupWeather: the next 24 hours, then today (current icon,
   * as GB does) and up to seven more days. Sun and moon rise/set come from Open-Meteo's daily `moonrise`/`moonset`
   * and go through the same day check as the sun times (GB fixupWeather does it for moonRise/moonSet too);
   * the moon phase is computed ([Moon]).
   */
  fun forecast(
    params: HuaweiPacket.ParamsProvider,
    settings: Weather.Settings,
    report: WeatherReport,
    nowSec: Long,
    zone: ZoneId,
  ): HuaweiPacket = forecast(params, settings, forecastEntries(report, nowSec, zone))

  fun forecast(params: HuaweiPacket.ParamsProvider, settings: Weather.Settings, entries: ForecastEntries): HuaweiPacket =
    Weather.WeatherForecastData.Request(params, settings, entries.hours, entries.days)

  /** The hourly and daily rows of a forecast request, before the watch's support flags decide which tags each row keeps. */
  fun forecastEntries(report: WeatherReport, nowSec: Long, zone: ZoneId): ForecastEntries {
    val hours = report.hourly.filter { it.timestamp > nowSec }.take(MAX_HOURS).map { hour ->
      Weather.WeatherForecastData.TimeData().apply {
        timestamp = hour.timestamp
        icon = WeatherIcons.forWmo(hour.code)
        temperature = temperatureByte(hour.tempC)
        precipitation = (hour.precipProbability ?: 0).coerceIn(0, 100).toByte()
        uvIndex = Math.round(hour.uvIndex ?: 0.0).coerceIn(0L, 127L).toByte()
      }
    }

    val dayCount = minOf(report.daily.size, MAX_DAYS)
    val days = ArrayList<Weather.WeatherForecastData.DayData>(dayCount)
    val today = report.daily.first()
    val todayStart = zone.dayStartSec(nowSec, 0)
    days.add(
      day(
        timestamp = report.observedAtSec,
        code = report.code,
        source = today,
        sunrise = sunInDay(today.sunrise, zone, nowSec, 0),
        sunset = sunInDay(today.sunset, zone, nowSec, 0),
        moonrise = sunInDay(today.moonrise, zone, nowSec, 0),
        moonset = sunInDay(today.moonset, zone, nowSec, 0),
        moonPhaseAt = todayStart + 12 * 3600L,
      ),
    )
    for (i in 1 until dayCount) {
      val forecast = report.daily[i]
      days.add(
        day(
          // GB: the observation time plus whole days, not the day's own midnight.
          timestamp = report.observedAtSec + 24 * 3600 * i,
          code = forecast.code,
          source = forecast,
          sunrise = sunInDay(forecast.sunrise, zone, nowSec, i),
          sunset = sunInDay(forecast.sunset, zone, nowSec, i),
          moonrise = sunInDay(forecast.moonrise, zone, nowSec, i),
          moonset = sunInDay(forecast.moonset, zone, nowSec, i),
          moonPhaseAt = zone.dayStartSec(nowSec, i) + 12 * 3600L,
        ),
      )
    }
    return ForecastEntries(hours, days)
  }

  /**
   * What the request will carry, read back from the packet's own TLV so it shows what GB's `Weather.Request` kept after the
   * watch's support flags, not what we meant to send: "24 hours (tags 03 04 05), 8 days (tags 12 13 14 15 1e)".
   */
  fun forecastShape(packet: HuaweiPacket, entries: ForecastEntries): String {
    fun tags(container: Int, row: Int): String {
      val rows = packet.tlv?.takeIf { it.contains(container) }?.getObject(container)?.getObjects(row).orEmpty()
      val first = rows.firstOrNull() ?: return "none"
      return first.get().joinToString(" ") { "%02x".format(it.tag.toInt() and 0xFF) }
    }
    return "${entries.hours.size} hours (tags ${tags(0x81, 0x82)}), ${entries.days.size} days (tags ${tags(0x90, 0x91)})"
  }

  /** The two counts the watch is known to want (Gadgetbridge issue 6973: a Watch GT 4 shows no forecast unless it gets exactly these). */
  fun countsAreComplete(entries: ForecastEntries): Boolean = entries.hours.size == MAX_HOURS && entries.days.size == MAX_DAYS

  private fun day(
    timestamp: Int,
    code: Int,
    source: WeatherDay,
    sunrise: Int,
    sunset: Int,
    moonrise: Int,
    moonset: Int,
    moonPhaseAt: Long,
  ) = Weather.WeatherForecastData.DayData().apply {
    this.timestamp = timestamp
    icon = WeatherIcons.forWmo(code)
    highTemperature = temperatureByte(source.maxC)
    lowTemperature = temperatureByte(source.minC)
    sunriseTime = sunrise
    sunsetTime = sunset
    // Tags 0x1a / 0x1b (unix-second ints, written only when non-zero) are encoded and gated by the vendored
    // Weather.WeatherForecastData.Request, GB Weather.java:603-612: both sit under `settings.sunRiseSetSupported`, bit 0 of the 0f/0a
    // answer (not the moon phase bit; 0x1e at lines 613-614 follows `moonPhaseSupported`). GB feeds them from
    // WeatherSpec.moonRise/moonSet (SendWeatherForecastRequest.java:64-65, 78-79) after HuaweiWeatherManager.fixupWeather, which
    // zeroes a moon time outside its day exactly like a sun time (lines 163-170, 184-191; upstream master, 2026-10).
    moonRiseTime = moonrise
    moonSetTime = moonset
    moonPhase = Weather.degreesToMoonPhase(Moon.phaseDegrees(moonPhaseAt))
  }

  /**
   * GB fixupWeather: "if this is wrong the watch does not display any weather data at all", so a sun
   * time outside the local day it belongs to (`day` days after today) is sent as 0.
   */
  fun sunInDay(timeSec: Int, zone: ZoneId, nowSec: Long, day: Int): Int {
    if (timeSec == 0) return 0
    val start = zone.dayStartSec(nowSec, day)
    val end = zone.dayStartSec(nowSec, day + 1)
    // GB timeOutOfDateInterval: out when check <= start or check > end.
    return if (timeSec <= start || timeSec > end) 0 else timeSec
  }

  private fun ZoneId.dayStartSec(nowSec: Long, plusDays: Int): Long =
    Instant.ofEpochSecond(nowSec).atZone(this).toLocalDate().plusDays(plusDays.toLong()).atStartOfDay(this).toEpochSecond()

  private fun unitOf(unit: TemperatureUnit) =
    if (unit == TemperatureUnit.FAHRENHEIT) Weather.HuaweiTemperatureFormat.FAHRENHEIT else Weather.HuaweiTemperatureFormat.CELSIUS

  /** SendWeatherCurrentRequest: GB passes its app name as the source. */
  const val SOURCE_NAME = "Open-Meteo"

  /** SendWeatherErrorRequest: the extended packet when the watch lists 0f/0c, else the simple one (0f/07). */
  fun error(params: HuaweiPacket.ParamsProvider, code: Weather.ErrorCode): HuaweiPacket? = when {
    DeviceCaps.supports(Weather.id.toInt(), Weather.WeatherErrorExtended.id.toInt()) -> Weather.WeatherErrorExtended.Request(params, code, false)
    DeviceCaps.supports(Weather.id.toInt(), Weather.WeatherErrorSimple.id.toInt()) -> Weather.WeatherErrorSimple.Request(params, code)
    else -> null
  }

  /** GB rounds the position to 7 decimals and back-dates the timestamp by a day so a workout's GPS wins. */
  fun gps(params: HuaweiPacket.ParamsProvider, nowSec: Long, place: WeatherPlace): HuaweiPacket {
    val latitude = BigDecimal(place.latitude).setScale(7, RoundingMode.HALF_UP).toDouble()
    val longitude = BigDecimal(place.longitude).setScale(7, RoundingMode.HALF_UP).toDouble()
    return CurrentGpsRequest(params, (nowSec - 86400).toInt(), latitude, longitude)
  }
}

/**
 * The weather commands and capability bits that decide what a push contains, on one line: in the log before every push and in
 * the support report. Which of them a Watch Fit 2 lists is not known yet; a report with this line settles it.
 */
internal object WeatherGates {
  fun describe(
    supports: (Int, Int) -> Boolean = DeviceCaps::supports,
    expand: (Int) -> Boolean = DeviceCaps::expandCapability,
  ): String {
    fun yn(value: Boolean) = if (value) "yes" else "no"
    fun weather(command: Int) = yn(supports(0x0f, command))
    return "current(0f/01)=${weather(0x01)} unit(0f/05)=${weather(0x05)} extended(0f/06)=${weather(0x06)} " +
      "forecast(0f/08)=${weather(0x08)} sunMoon(0f/0a)=${weather(0x0a)} errorSimple(0f/07)=${weather(0x07)} " +
      "errorExtended(0f/0c)=${weather(0x0c)} gps(18/06)=${yn(supports(0x18, 0x06))} " +
      "uvIndex(cap 0x2f)=${yn(expand(0x2f))} extendedHourly(cap 0xc0)=${yn(expand(0xc0))}"
  }
}

/**
 * What the last weather push did, kept for the support report: a day of hourly pushes scrolls the push out of the log, and the
 * one that matters for a report is the last. In memory only, like the rest of the push status.
 */
internal object WeatherDiagnostics {
  class Snapshot(
    val atSec: Long,
    val reason: String,
    /** Bitmaps the watch answered with: "support 0x7f", "extended 0x0007", "sunMoon 0x03". */
    val bitmaps: List<String>,
    /** One entry per step: "WeatherCurrent answered 0x000186a0 in 85 ms". */
    val steps: List<String>,
    val forecast: ForecastOutcome?,
    /** What the forecast request carried, see [WeatherPackets.forecastShape]. */
    val shape: String?,
    /** Why the push stopped early, or null. */
    val failure: String?,
  )

  @Volatile var last: Snapshot? = null

  /** Support report lines: the switch and the gates, then the last push. */
  fun summary(enabled: Boolean, nowSec: Long = System.currentTimeMillis() / 1000): List<String> {
    val lines = ArrayList<String>()
    lines.add("Weather: switch ${if (enabled) "on" else "off"}; gates (last connect) ${WeatherGates.describe()}")
    val snapshot = last
    if (snapshot == null) {
      lines.add("Weather last push: none in this process")
      return lines
    }
    val ago = (nowSec - snapshot.atSec).coerceAtLeast(0)
    lines.add("Weather last push: ${snapshot.reason}, ${ago / 60} min ago; ${snapshot.bitmaps.joinToString(", ").ifEmpty { "no support bitmaps read" }}")
    lines.add("  steps: ${snapshot.steps.joinToString("; ").ifEmpty { "none" }}")
    snapshot.failure?.let { lines.add("  stopped: $it") }
    snapshot.forecast?.let { forecast ->
      val code = forecast.replyCode?.let { " reply 0x%08x".format(it) } ?: ""
      lines.add("  forecast: ${forecast.state.wire}$code${snapshot.shape?.let { ", $it" } ?: ""}")
    }
    return lines
  }
}

/** The weather packet sequence of GB's HuaweiWeatherManager.sendWeather, over one [HuaweiSession]. */
internal class HuaweiWeatherSender(
  private val session: HuaweiSession,
  private val events: WearEvents,
  /** How long a step waits for the watch's answer; a parameter so tests of a silent watch need not wait five seconds. */
  private val answerTimeoutMs: Long = Timeouts.QUERY_MS,
) {
  private val params get() = session.params

  /** Whether the watch lists the weather service at all (HuaweiState.supportsWeather: 0f/01). */
  fun supported(): Boolean = DeviceCaps.supports(Weather.id.toInt(), Weather.CurrentWeatherRequest.id.toInt())

  private class Trace(val atSec: Long, val reason: String) {
    val bitmaps = ArrayList<String>()
    val steps = ArrayList<String>()
    var forecast: ForecastOutcome? = null
    var shape: String? = null
    var failure: String? = null

    fun snapshot() = WeatherDiagnostics.Snapshot(atSec, reason, bitmaps.toList(), steps.toList(), forecast, shape, failure)
  }

  /** The watch's answer to a push: the code in tag 0x7f, or null when it answered without one. */
  private class Receipt(val code: Int?)

  /**
   * Start, unit, support flags, current weather, position, forecast, each waiting for the watch's
   * reply like GB's request chain. [zone] is the phone's: it decides which sun times fall in "today".
   * Returns what the forecast step did; the steps before it throw [WearException] when the watch does
   * not answer, because what they ask for decides what the later ones may carry.
   */
  suspend fun send(
    report: WeatherReport,
    unit: TemperatureUnit,
    nowSec: Long,
    zone: ZoneId = ZoneId.systemDefault(),
    reason: String = "push",
  ): ForecastOutcome {
    if (!supported()) throw WearException(ErrorCodes.UNSUPPORTED, "The watch does not list the weather service (0f/01)")
    info("Weather gates: ${WeatherGates.describe()}")
    val trace = Trace(nowSec, reason)
    try {
      return run(report, unit, nowSec, zone, trace)
    } catch (e: WearException) {
      trace.failure = "${e.errorCode}: ${e.message}"
      throw e
    } finally {
      WeatherDiagnostics.last = trace.snapshot()
    }
  }

  private suspend fun run(report: WeatherReport, unit: TemperatureUnit, nowSec: Long, zone: ZoneId, trace: Trace): ForecastOutcome {
    val settings = Weather.Settings()
    settings.uvIndexSupported = DeviceCaps.expandCapability(0x2f) // supportsWeatherUvIndex
    settings.extendedHourlyForecast = DeviceCaps.expandCapability(0xc0) // supportsWeatherExtendedHourForecast

    // SendWeatherStartRequest: a non-ok code stops GB's chain.
    val start = query(Weather.WeatherStart.Request(params), "WeatherStart", trace).expect<Weather.WeatherStart.Response>("WeatherStart")
    if (!start.success) {
      throw WearException(ErrorCodes.PROTOCOL, "WeatherStart: the watch refused (code 0x%08x)".format(start.successCode))
    }
    settings.weatherSupported = true

    if (DeviceCaps.supports(Weather.id.toInt(), Weather.WeatherUnitRequest.id.toInt())) {
      query(Weather.WeatherUnitRequest(params, if (unit == TemperatureUnit.FAHRENHEIT) Weather.HuaweiTemperatureFormat.FAHRENHEIT else Weather.HuaweiTemperatureFormat.CELSIUS), "WeatherUnit", trace)
    }

    val support = query(Weather.WeatherSupport.Request(params), "WeatherSupport", trace).expect<Weather.WeatherSupport.Response>("WeatherSupport")
    settings.weatherSupported = support.weatherSupported
    settings.windSupported = support.windSupported
    settings.pm25Supported = support.pm25Supported
    settings.temperatureSupported = support.temperatureSupported
    settings.locationNameSupported = support.locationNameSupported
    settings.currentTemperatureSupported = support.currentTemperatureSupported
    settings.unitSupported = support.unitSupported
    settings.airQualityIndexSupported = support.airQualityIndexSupported
    bitmap(trace, "support 0x%02x".format(support.supportedBitmap.toInt() and 0xFF), "Weather support bitmap 0x%02x".format(support.supportedBitmap.toInt() and 0xFF))

    if (DeviceCaps.supports(Weather.id.toInt(), Weather.WeatherExtendedSupport.id.toInt())) {
      val extended = query(Weather.WeatherExtendedSupport.Request(params), "WeatherExtendedSupport", trace)
        .expect<Weather.WeatherExtendedSupport.Response>("WeatherExtendedSupport")
      settings.timeSupported = extended.timeSupported
      settings.sourceSupported = extended.sourceSupported
      settings.weatherIconSupported = extended.weatherIconSupported
      bitmap(trace, "extended 0x%04x".format(extended.supportedBitmap.toInt() and 0xFFFF), "Weather extended bitmap 0x%04x".format(extended.supportedBitmap.toInt() and 0xFFFF))
    } else {
      // GB reads the icon flag only from 0f/06. A watch that does not list it cannot say, and then the current weather and every
      // forecast row would carry no weather condition at all, which a watch may answer by showing no forecast (a Watch Fit 2 shows
      // current weather only). The basic support bitmap lists the current-weather tags in order, so its bit 0 is the condition tag.
      settings.weatherIconSupported = support.weatherSupported
      info("Weather: the watch lists no 0f/06, so the icon flag follows bit 0 of the support bitmap (${support.weatherSupported})")
    }

    if (DeviceCaps.supports(Weather.id.toInt(), Weather.WeatherSunMoonSupport.id.toInt())) {
      val sunMoon = query(Weather.WeatherSunMoonSupport.Request(params), "WeatherSunMoonSupport", trace)
        .expect<Weather.WeatherSunMoonSupport.Response>("WeatherSunMoonSupport")
      settings.sunRiseSetSupported = sunMoon.sunRiseSetSupported
      settings.moonPhaseSupported = sunMoon.moonPhaseSupported
      bitmap(trace, "sunMoon 0x%02x".format(sunMoon.supportedBitmap), "Weather sun/moon bitmap 0x%02x".format(sunMoon.supportedBitmap))
    }
    info(
      "Weather flags the packets will follow: icon=${settings.weatherIconSupported} temperatureRange=${settings.temperatureSupported} " +
        "currentTemperature=${settings.currentTemperatureSupported} sunRiseSet=${settings.sunRiseSetSupported} moonPhase=${settings.moonPhaseSupported} " +
        "extendedHourly=${settings.extendedHourlyForecast}",
    )

    // The next two are pushes: the watch may take them without a receipt we can read, which must not keep the forecast from being sent.
    push(WeatherPackets.current(params, settings, report, unit), "WeatherCurrent", trace)
    info(
      "Weather current: ${report.place.name ?: "unnamed place"} ${WeatherPackets.temperatureByte(report.tempC)}\u00B0C " +
        "${WeatherIcons.forWmo(report.code)} (WMO ${report.code}), unit ${unit.wire}",
    )

    // SendGpsAndTimeToDeviceRequest: GB sends it by default when the watch lists 0x18/0x06.
    if (DeviceCaps.supports(0x18, 0x06)) {
      push(WeatherPackets.gps(params, nowSec, report.place), "WeatherGps", trace)
    }

    return forecast(settings, report, nowSec, zone, trace)
  }

  /** The forecast step: only when the watch lists 0f/08 (GB supportsWeatherForecasts), and what became of it is returned. */
  private suspend fun forecast(settings: Weather.Settings, report: WeatherReport, nowSec: Long, zone: ZoneId, trace: Trace): ForecastOutcome {
    if (!DeviceCaps.supports(Weather.id.toInt(), Weather.WeatherForecastData.id.toInt())) {
      info("Weather forecast skipped: the watch does not list 0f/08, so it only gets current weather (GB supportsWeatherForecasts)")
      return ForecastOutcome(ForecastState.UNSUPPORTED, 0, 0, null, nowSec).also { trace.forecast = it }
    }
    val entries = WeatherPackets.forecastEntries(report, nowSec, zone)
    val packet = WeatherPackets.forecast(params, settings, entries)
    val shape = WeatherPackets.forecastShape(packet, entries)
    trace.shape = shape
    info("Weather forecast: $shape, first hour ${entries.hours.firstOrNull()?.let { Instant.ofEpochSecond(it.timestamp.toLong()) } ?: "none"}")
    if (!WeatherPackets.countsAreComplete(entries)) {
      events.log(
        LogDirection.ERROR, null, null, null,
        "Weather forecast has ${entries.hours.size} hours and ${entries.days.size} days, not ${WeatherPackets.MAX_HOURS} and ${WeatherPackets.MAX_DAYS}; " +
          "some watches show no forecast at all unless they get exactly those",
      )
    }
    val receipt = push(packet, "WeatherForecast", trace)
    val code = receipt?.code
    val state = when {
      receipt == null -> ForecastState.UNACKNOWLEDGED
      code != null && code !in OK_CODES -> ForecastState.REJECTED
      else -> ForecastState.SENT
    }
    val outcome = ForecastOutcome(state, entries.hours.size, entries.days.size, code, nowSec)
    trace.forecast = outcome
    when (state) {
      ForecastState.SENT -> info("Weather forecast sent: ${entries.hours.size} hours, ${entries.days.size} days")
      ForecastState.REJECTED -> events.log(LogDirection.ERROR, null, null, null, "Weather forecast not taken: the watch answered 0x%08x".format(code))
      else -> events.log(LogDirection.ERROR, null, null, null, "Weather forecast sent but never acknowledged")
    }
    return outcome
  }

  /** SendWeatherErrorRequest; returns false when the watch lists neither error command. */
  suspend fun sendError(code: Weather.ErrorCode): Boolean {
    val packet = WeatherPackets.error(params, code) ?: return false
    session.request(packet, answerTimeoutMs, "WeatherError ($code)")
    info("Weather error sent to the watch: $code")
    return true
  }

  /** SendWeatherDeviceRequest: GB's answer to a watch weather message that is not a request (`addToResponse = false`). */
  suspend fun acknowledge() {
    session.send(Weather.WeatherDeviceRequest(params, HuaweiConstants.RESULT_SUCCESS_INT), "WeatherDeviceRequest ack")
  }

  private fun info(message: String) = events.log(LogDirection.INFO, null, null, null, message)

  private fun bitmap(trace: Trace, short: String, line: String) {
    trace.bitmaps.add(short)
    info(line)
  }

  private fun elapsedMs(begun: Long) = (System.nanoTime() - begun) / 1_000_000

  private fun codeText(response: HuaweiPacket): String = response.tlv?.getInteger(0x7f, null)?.let { " 0x%08x".format(it) } ?: ""

  private fun step(trace: Trace, label: String, text: String, error: Boolean = false) {
    trace.steps.add("$label $text")
    events.log(if (error) LogDirection.ERROR else LogDirection.INFO, null, null, null, "Weather step $label: $text")
  }

  /** A request whose answer the next steps depend on (start, unit, support flags): no answer ends the push. */
  private suspend fun query(packet: HuaweiPacket, label: String, trace: Trace): HuaweiPacket {
    val begun = System.nanoTime()
    val response = session.request(packet, answerTimeoutMs, label)
    step(trace, label, "answered${codeText(response)} in ${elapsedMs(begun)} ms")
    return response
  }

  /**
   * A packet that carries data (current weather, position, forecast): the answer is only a receipt, so a missing one is
   * logged and the sequence goes on. Returns null when the watch did not answer; a lost link still ends the push.
   */
  private suspend fun push(packet: HuaweiPacket, label: String, trace: Trace): Receipt? {
    val begun = System.nanoTime()
    val response = try {
      session.request(packet, answerTimeoutMs, label)
    } catch (e: WearException) {
      if (e.errorCode != ErrorCodes.TIMEOUT) throw e
      step(trace, label, "no answer within $answerTimeoutMs ms", error = true)
      return null
    }
    step(trace, label, "answered${codeText(response)} in ${elapsedMs(begun)} ms")
    return Receipt(response.tlv?.getInteger(0x7f, null))
  }

  companion object {
    /** Tag 0x7f of a reply the watch accepts: GB's `WeatherStart.Response.success`. */
    private val OK_CODES = setOf(0x000186A0, 0x000186A3)
  }
}
