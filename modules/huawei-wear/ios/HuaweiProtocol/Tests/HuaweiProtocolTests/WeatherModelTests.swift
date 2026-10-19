import XCTest
@testable import HuaweiProtocol

/// The cases of the Kotlin WeatherTest (the model, Open-Meteo parsing and the packet builders), plus Open-Meteo answers recorded from the real API.
final class WeatherModelTests: XCTestCase {
    private let zone = TimeZone(identifier: "Asia/Jakarta")!
    private var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = zone
        return c
    }

    /// 2026-10-14 10:30 in Jakarta.
    private var now: Int64 { epoch(2026, 10, 14, 10, 30) }

    private func epoch(_ y: Int, _ m: Int, _ d: Int, _ h: Int, _ min: Int) -> Int64 {
        Int64(calendar.date(from: DateComponents(year: y, month: m, day: d, hour: h, minute: min))!.timeIntervalSince1970)
    }

    private func day(_ offset: Int) -> Int64 { epoch(2026, 10, 14 + offset, 0, 0) }

    private func allSupported() -> Weather.Settings {
        var s = Weather.Settings()
        s.weatherSupported = true
        s.windSupported = true
        s.pm25Supported = true
        s.temperatureSupported = true
        s.locationNameSupported = true
        s.currentTemperatureSupported = true
        s.unitSupported = true
        s.airQualityIndexSupported = true
        s.timeSupported = true
        s.sourceSupported = true
        s.weatherIconSupported = true
        s.sunRiseSetSupported = true
        s.moonPhaseSupported = true
        s.extendedHourlyForecast = true
        s.uvIndexSupported = true
        return s
    }

    static func report(now: Int64, day: (Int) -> Int64) -> WeatherReport {
        var hours: [WeatherHour] = []
        for i in 0..<48 {
            let timestamp = Int32(day(0) + 3600 * Int64(i))
            let code: Int32 = i % 2 == 0 ? 0 : 63
            let probability: Int32? = i == 5 ? nil : 40
            hours.append(WeatherHour(timestamp: timestamp, code: code, tempC: 24.0 + Double(i), precipProbability: probability, uvIndex: 3.4))
        }
        var days: [WeatherDay] = []
        for i in 0..<8 {
            let midnight = day(i)
            days.append(
                WeatherDay(
                    timestamp: Int32(midnight), code: 61, maxC: 31.4 + Double(i), minC: 22.6 - Double(i),
                    sunrise: Int32(midnight + 5 * 3600 + 40 * 60), sunset: Int32(midnight + 17 * 3600 + 50 * 60),
                    moonrise: Int32(midnight + 12 * 3600 + 10 * 60), moonset: Int32(midnight + 7 * 60)
                )
            )
        }
        return WeatherReport(
            fetchedAtSec: now, observedAtSec: Int32(now), place: WeatherPlace(name: "Bandung", latitude: -6.91, longitude: 107.61), code: 2, tempC: 27.6,
            feelsLikeC: 30.2, humidity: 78, windSpeedKmh: 14.0, windDirection: 90, uvIndex: 5.2, hourly: hours, daily: days
        )
    }

    private func report() -> WeatherReport { Self.report(now: now, day: day) }

    func testWmoCodesMapThroughOpenWeatherMapToHuaweiIcons() {
        let expected: [Int32: Weather.Icon] = [
            0: .sunny, 1: .cloudy, 2: .cloudy, 3: .overcast, 45: .fog, 48: .fog, 51: .lightRain, 55: .lightRain, 56: .freezingRain, 61: .lightRain, 63: .rain,
            65: .heavyRain, 67: .freezingRain, 71: .lightSnow, 73: .snow, 75: .heavySnow, 77: .lightSnow, 80: .lightRain, 81: .rain, 82: .heavyRain,
            85: .lightSnow, 86: .heavySnow, 95: .thunderstorms, 96: .thunderstorms, 99: .thunderstorms, 42: .unknown,
        ]
        for (wmo, icon) in expected { XCTAssertEqual(WeatherIcons.forWmo(wmo), icon, "WMO \(wmo)") }
        XCTAssertEqual(Weather.Icon.sunny.byte, 0x00)
        XCTAssertEqual(Weather.Icon.rain.byte, 0x08)
        XCTAssertEqual(Weather.Icon.windy.byte, 0x23)
        XCTAssertEqual(Weather.Icon.hazy.byte, 0x35)
        XCTAssertEqual(Weather.Icon.unknown.byte, 0x63)
    }

    func testOpenWeatherMapGroupsFollowGb() {
        XCTAssertEqual(WeatherIcons.openWeatherMapToHuaweiIcon(231), .thunderstorms)
        XCTAssertEqual(WeatherIcons.openWeatherMapToHuaweiIcon(321), .lightRain)
        XCTAssertEqual(WeatherIcons.openWeatherMapToHuaweiIcon(522), .rain)
        XCTAssertEqual(WeatherIcons.openWeatherMapToHuaweiIcon(621), .snow)
        XCTAssertEqual(WeatherIcons.openWeatherMapToHuaweiIcon(721), .hazy)
        XCTAssertEqual(WeatherIcons.openWeatherMapToHuaweiIcon(900), .unknown)
    }

    func testBeaufortUsesGbBounds() {
        XCTAssertEqual(Beaufort.fromKmh(0.0), 0)
        XCTAssertEqual(Beaufort.fromKmh(2.0), 0)
        XCTAssertEqual(Beaufort.fromKmh(2.1), 1)
        XCTAssertEqual(Beaufort.fromKmh(14.0), 3)
        XCTAssertEqual(Beaufort.fromKmh(200.0), 12)
    }

    func testMoonPhaseTracksKnownNewAndFullMoons() {
        // New moon 2024-01-11 11:57 UTC, full moon 2024-01-25 17:54 UTC.
        XCTAssertEqual(Weather.degreesToMoonPhase(Moon.phaseDegrees(1_704_974_220)), .newMoon)
        XCTAssertEqual(Weather.degreesToMoonPhase(Moon.phaseDegrees(1_706_205_240)), .fullMoon)
    }

    func testForecastJsonParses() throws {
        let json = """
        {"latitude":-6.9,"longitude":107.6,"timezone":"Asia/Jakarta","utc_offset_seconds":25200,
         "current":{"time":1760412600,"interval":900,"temperature_2m":27.6,"relative_humidity_2m":78,
           "apparent_temperature":30.2,"weather_code":2,"wind_speed_10m":14.0,"wind_direction_10m":90,"uv_index":5.2},
         "hourly":{"time":[1760410800,1760414400,1760418000],"temperature_2m":[27.0,28.5,null],
           "weather_code":[2,3,3],"precipitation_probability":[10,null,30],"uv_index":[5.0,6.0,null]},
         "daily":{"time":[1760374800,1760461200],"weather_code":[61,3],"temperature_2m_max":[31.4,30.0],
           "temperature_2m_min":[22.6,22.0],"sunrise":[1760395200,null],"sunset":[1760438400,1760481600],
           "moonrise":[1760418600,null],"moonset":[1760375220,1760462100]}}
        """
        let place = WeatherPlace(name: "Bandung", latitude: -6.9, longitude: 107.6)
        let report = try OpenMeteo.parseForecast(json, place: place, fetchedAtSec: 1_760_412_700)
        XCTAssertEqual(report.observedAtSec, 1_760_412_600)
        XCTAssertEqual(report.code, 2)
        XCTAssertEqual(report.tempC, 27.6, accuracy: 0.001)
        XCTAssertEqual(report.feelsLikeC, 30.2, accuracy: 0.001)
        XCTAssertEqual(report.humidity, 78)
        XCTAssertEqual(report.windDirection, 90)
        XCTAssertEqual(report.uvIndex!, 5.2, accuracy: 0.001)
        // The hour with a null temperature is dropped; a null probability stays null.
        XCTAssertEqual(report.hourly.count, 2)
        XCTAssertNil(report.hourly[1].precipProbability)
        XCTAssertEqual(report.daily.count, 2)
        XCTAssertEqual(report.daily[1].sunrise, 0)
        XCTAssertEqual(report.daily[0].sunset, 1_760_438_400)
        XCTAssertEqual(report.daily[0].moonrise, 1_760_418_600)
        XCTAssertEqual(report.daily[0].moonset, 1_760_375_220)
        // A day the moon does not rise (null) is 0, which the packet skips.
        XCTAssertEqual(report.daily[1].moonrise, 0)
        XCTAssertEqual(report.daily[1].moonset, 1_760_462_100)
        XCTAssertEqual(report.fetchedAtSec, 1_760_412_700)
    }

    func testErrorBodyIsABadResponse() {
        XCTAssertThrowsError(try OpenMeteo.parseForecast(#"{"error":true,"reason":"Latitude must be in range"}"#, place: WeatherPlace(name: nil, latitude: 0, longitude: 0), fetchedAtSec: 0)) {
            XCTAssertEqual(($0 as? OpenMeteoBadResponse)?.message, "Open-Meteo: Latitude must be in range")
        }
    }

    func testAnswersThatAreNotTheExpectedJsonAreBadResponses() {
        let place = WeatherPlace(name: nil, latitude: 0, longitude: 0)
        for body in ["", "not json", "[]", "{}", #"{"current":{}}"#, #"{"current":{"time":1,"weather_code":0,"temperature_2m":1},"hourly":{},"daily":{}}"#,
                     #"{"current":{"time":1,"weather_code":0,"temperature_2m":1},"hourly":{"time":[],"temperature_2m":[],"weather_code":[]},"daily":{"time":[],"weather_code":[],"temperature_2m_max":[],"temperature_2m_min":[]}}"#,
                     #"{"current":{"time":"x","weather_code":0,"temperature_2m":1},"hourly":{"time":[],"temperature_2m":[],"weather_code":[]},"daily":{"time":[1],"weather_code":[1],"temperature_2m_max":[1],"temperature_2m_min":[1]}}"#] {
            XCTAssertThrowsError(try OpenMeteo.parseForecast(body, place: place, fetchedAtSec: 0), body) { XCTAssertTrue($0 is OpenMeteoBadResponse, "\($0)") }
        }
        XCTAssertThrowsError(try OpenMeteo.parseGeocoding("<html>")) { XCTAssertTrue($0 is OpenMeteoBadResponse) }
    }

    func testGeocodingResultsAndQualifier() throws {
        let json = """
        {"results":[
          {"name":"Bandung","latitude":-6.92,"longitude":107.60,"country":"Indonesia","country_code":"ID","admin1":"West Java"},
          {"name":"Bandung","latitude":3.0,"longitude":101.0,"country":"Malaysia","country_code":"MY"}]}
        """
        let places = try OpenMeteo.parseGeocoding(json)
        XCTAssertEqual(places.count, 2)
        XCTAssertEqual(places[0].detail, "West Java, Indonesia, ID")
        XCTAssertEqual(places[1].detail, "Malaysia, MY")
        XCTAssertEqual(OpenMeteo.matchQualifier(places, qualifier: ""), places)
        XCTAssertEqual(OpenMeteo.matchQualifier(places, qualifier: "malaysia"), [places[1]])
        XCTAssertEqual(OpenMeteo.matchQualifier(places, qualifier: "ID"), [places[0]])
        XCTAssertTrue(try OpenMeteo.parseGeocoding("{}").isEmpty)
    }

    func testUrlsAreCoarseAndEncoded() {
        let url = OpenMeteo.forecastURL(latitude: -6.9147444, longitude: 107.6098111)
        XCTAssertTrue(url.hasPrefix("https://api.open-meteo.com/v1/forecast?latitude=-6.91&longitude=107.61&"))
        XCTAssertTrue(url.contains("timeformat=unixtime"))
        XCTAssertTrue(url.contains("&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,moonrise,moonset&"))
        XCTAssertEqual(
            OpenMeteo.geocodingURL(name: "S\u{00E3}o Paulo", count: 1),
            "https://geocoding-api.open-meteo.com/v1/search?name=S%C3%A3o+Paulo&count=1&language=en&format=json"
        )
    }

    func testTemperaturesRoundAndClamp() {
        XCTAssertEqual(WeatherPackets.temperatureByte(27.6), 28)
        XCTAssertEqual(WeatherPackets.temperatureByte(-3.6), -4)
        XCTAssertEqual(WeatherPackets.temperatureByte(-3.5), -3, "Math.round rounds half up, also below zero")
        XCTAssertEqual(WeatherPackets.temperatureByte(300.0), 127)
        XCTAssertEqual(WeatherPackets.temperatureByte(-300.0), -128)
    }

    func testCurrentWeatherCarriesGbTags() throws {
        let packet = WeatherPackets.current(settings: allSupported(), report: report(), unit: .fahrenheit)
        XCTAssertEqual(packet.serviceId, Weather.id)
        XCTAssertEqual(packet.commandId, Weather.CurrentWeatherRequest.id)
        let tlv = packet.tlv!
        let inner = try tlv.object(0x81)
        XCTAssertEqual(try inner.byte(0x02), 0x01) // CLOUDY for WMO 2
        // Beaufort 3 for 14 km/h in the low byte, direction E (2) in the high byte.
        XCTAssertEqual(try inner.short(0x03), 0x0203)
        let range = try tlv.object(0x85)
        XCTAssertEqual(try range.byte(0x06), 23) // today's low 22.6 rounds to 23
        XCTAssertEqual(try range.byte(0x07), 31)
        XCTAssertEqual(try tlv.string(0x08), "Bandung")
        XCTAssertEqual(try tlv.byte(0x09), 28)
        XCTAssertEqual(try tlv.byte(0x0A), 1) // Fahrenheit display
        XCTAssertEqual(try tlv.int(0x0C), Int32(now))
        XCTAssertEqual(try tlv.string(0x0E), "Open-Meteo")
        XCTAssertEqual(try tlv.byte(0x0F), 5) // UV index 5.2
        XCTAssertEqual(try tlv.byte(0x10), 78)
        XCTAssertEqual(try tlv.int(0x11), 14)
        XCTAssertEqual(try tlv.int(0x12), 30)
        XCTAssertFalse(tlv.contains(0x04)) // no pm25
        XCTAssertFalse(tlv.contains(0x0B)) // no air quality index
    }

    func testCurrentWeatherOmitsWhatTheWatchDoesNotSupport() {
        let tlv = WeatherPackets.current(settings: Weather.Settings(), report: report(), unit: .celsius).tlv!
        XCTAssertFalse(tlv.contains(0x08))
        XCTAssertFalse(tlv.contains(0x09))
        XCTAssertFalse(tlv.contains(0x0A))
        XCTAssertFalse(tlv.contains(0x85))
    }

    func testForecastHasNext24HoursAndEightDays() throws {
        let packet = WeatherPackets.forecast(settings: allSupported(), report: report(), nowSec: now, zone: zone)
        XCTAssertEqual(packet.commandId, Weather.WeatherForecastData.id)
        let hours = try packet.tlv!.object(0x81).objects(0x82)
        XCTAssertEqual(hours.count, 24)
        // The first hour is the first one after "now" (11:00 local = index 11).
        XCTAssertEqual(try hours[0].int(0x03), Int32(day(0) + 3600 * 11))
        XCTAssertEqual(try hours[0].byte(0x04), 0x08) // odd index = WMO 63 = RAIN (0x08)
        XCTAssertEqual(try hours[0].byte(0x05), 35)
        XCTAssertEqual(try hours[0].byte(0x06), 40)
        XCTAssertEqual(try hours[0].byte(0x07), 3)

        let days = try packet.tlv!.object(0x90).objects(0x91)
        XCTAssertEqual(days.count, 8)
        // Today: observation time, the current icon (WMO 2 = CLOUDY 0x01).
        XCTAssertEqual(try days[0].int(0x12), Int32(now))
        XCTAssertEqual(try days[0].byte(0x13), 0x01)
        XCTAssertEqual(try days[0].byte(0x14), 31)
        XCTAssertEqual(try days[0].byte(0x15), 23)
        XCTAssertEqual(try days[0].int(0x16), Int32(day(0) + 5 * 3600 + 40 * 60))
        XCTAssertEqual(try days[0].int(0x17), Int32(day(0) + 17 * 3600 + 50 * 60))
        XCTAssertTrue(days[0].contains(0x1E)) // moon phase
        // Open-Meteo's moon times: 12:10 rise and 00:07 set of the local day, unix seconds, after the sun times.
        XCTAssertEqual(try days[0].int(0x1A), Int32(day(0) + 12 * 3600 + 10 * 60))
        XCTAssertEqual(try days[0].int(0x1B), Int32(day(0) + 7 * 60))
        XCTAssertEqual(try days[3].int(0x1A), Int32(day(3) + 12 * 3600 + 10 * 60))
        // GB: later days are stamped observation + whole days and use the day's own icon (WMO 61 = LIGHT_RAIN 0x07).
        XCTAssertEqual(try days[1].int(0x12), Int32(now) + 86400)
        XCTAssertEqual(try days[1].byte(0x13), 0x07)
    }

    func testSunTimesOutsideTheirDayAreDropped() {
        // GB fixupWeather: out when check <= start or check > end of the local day.
        XCTAssertEqual(WeatherPackets.sunInDay(0, zone: zone, nowSec: now, day: 0), 0)
        XCTAssertEqual(WeatherPackets.sunInDay(Int32(day(0) + 3600), zone: zone, nowSec: now, day: 0), Int32(day(0) + 3600))
        XCTAssertEqual(WeatherPackets.sunInDay(Int32(day(0)), zone: zone, nowSec: now, day: 0), 0)
        XCTAssertEqual(WeatherPackets.sunInDay(Int32(day(1) + 3600), zone: zone, nowSec: now, day: 0), 0)
        XCTAssertEqual(WeatherPackets.sunInDay(Int32(day(1) + 3600), zone: zone, nowSec: now, day: 1), Int32(day(1) + 3600))
        XCTAssertEqual(WeatherPackets.sunInDay(Int32(day(1)), zone: zone, nowSec: now, day: 0), Int32(day(1)), "the end of the day is still inside it")
    }

    func testMoonRiseAndSetFollowTheSunRiseSetBitAndTheDayCheck() throws {
        let entries = WeatherPackets.forecastEntries(report: report(), nowSec: now, zone: zone)
        // GB Weather.java:603-612: 0x1a / 0x1b sit under sunRiseSetSupported; the phase (0x1e) has its own bit.
        var phaseOnly = allSupported()
        phaseOnly.sunRiseSetSupported = false
        let onlyPhase = try WeatherPackets.forecast(settings: phaseOnly, entries: entries).tlv!.object(0x90).objects(0x91)[0]
        XCTAssertFalse(onlyPhase.contains(0x1A))
        XCTAssertFalse(onlyPhase.contains(0x1B))
        XCTAssertTrue(onlyPhase.contains(0x1E))
        var noPhase = allSupported()
        noPhase.moonPhaseSupported = false
        let noPhaseDay = try WeatherPackets.forecast(settings: noPhase, entries: entries).tlv!.object(0x90).objects(0x91)[0]
        XCTAssertTrue(noPhaseDay.contains(0x1A))
        XCTAssertTrue(noPhaseDay.contains(0x1B))
        XCTAssertFalse(noPhaseDay.contains(0x1E))

        // A moon time outside its local day is dropped like a sun time (GB fixupWeather), 0 is skipped.
        var outside = report()
        outside.daily[0].moonrise = Int32(day(1) + 3600)
        outside.daily[0].moonset = 0
        let dropped = WeatherPackets.forecastEntries(report: outside, nowSec: now, zone: zone).days[0]
        XCTAssertEqual(dropped.moonRiseTime, 0)
        XCTAssertEqual(dropped.moonSetTime, 0)
        let tlv = try WeatherPackets.forecast(settings: allSupported(), report: outside, nowSec: now, zone: zone).tlv!.object(0x90).objects(0x91)[0]
        XCTAssertFalse(tlv.contains(0x1A))
        XCTAssertFalse(tlv.contains(0x1B))
    }

    func testTheLocalDayFollowsTheZoneAcrossDst() {
        // New York, spring forward on 2026-03-08: that day has 23 hours, so "tomorrow" starts 23 hours after midnight.
        let ny = TimeZone(identifier: "America/New_York")!
        var c = Calendar(identifier: .gregorian)
        c.timeZone = ny
        let midnight = Int64(c.date(from: DateComponents(year: 2026, month: 3, day: 8, hour: 0, minute: 0))!.timeIntervalSince1970)
        let noon = midnight + 13 * 3600
        let nextMidnight = midnight + 23 * 3600
        XCTAssertEqual(WeatherPackets.sunInDay(Int32(nextMidnight), zone: ny, nowSec: noon, day: 0), Int32(nextMidnight))
        XCTAssertEqual(WeatherPackets.sunInDay(Int32(nextMidnight + 1), zone: ny, nowSec: noon, day: 0), 0)
        XCTAssertEqual(WeatherPackets.sunInDay(Int32(midnight), zone: ny, nowSec: noon, day: 0), 0)
        XCTAssertEqual(WeatherPackets.sunInDay(Int32(midnight + 1), zone: ny, nowSec: noon, day: 0), Int32(midnight + 1))
    }

    func testForecastKeepsShortHourlyAndDailyLists() throws {
        var short = report()
        short.hourly = []
        short.daily = Array(short.daily.prefix(2))
        let packet = WeatherPackets.forecast(settings: allSupported(), report: short, nowSec: now, zone: zone)
        XCTAssertFalse(packet.tlv!.contains(0x81))
        XCTAssertEqual(try packet.tlv!.object(0x90).objects(0x91).count, 2)

        short.daily = Array(short.daily.prefix(1))
        XCTAssertEqual(try WeatherPackets.forecast(settings: allSupported(), report: short, nowSec: now, zone: zone).tlv!.object(0x90).objects(0x91).count, 1)
    }

    func testForecastEntriesCountWhatTheRequestCarries() {
        let entries = WeatherPackets.forecastEntries(report: report(), nowSec: now, zone: zone)
        XCTAssertEqual(entries.hours.count, 24)
        XCTAssertEqual(entries.days.count, 8)
        XCTAssertEqual(entries.hours[0].timestamp, Int32(day(0) + 3600 * 11))
        XCTAssertTrue(WeatherPackets.countsAreComplete(entries))

        var short = report()
        short.hourly = Array(short.hourly.prefix(20)) // 11 of them are already past, so 9 are still ahead
        XCTAssertEqual(WeatherPackets.forecastEntries(report: short, nowSec: now, zone: zone).hours.count, 9)
        XCTAssertFalse(WeatherPackets.countsAreComplete(WeatherPackets.forecastEntries(report: short, nowSec: now, zone: zone)))
        short = report()
        short.daily = Array(short.daily.prefix(7))
        XCTAssertFalse(WeatherPackets.countsAreComplete(WeatherPackets.forecastEntries(report: short, nowSec: now, zone: zone)))
    }

    func testForecastShapeReadsTheTagsBackFromThePacket() {
        let entries = WeatherPackets.forecastEntries(report: report(), nowSec: now, zone: zone)
        let all = WeatherPackets.forecast(settings: allSupported(), entries: entries)
        XCTAssertEqual(
            WeatherPackets.forecastShape(packet: all, entries: entries),
            "24 hours (tags 03 04 05 06 07), 8 days (tags 12 13 14 15 16 17 1a 1b 1e)"
        )

        // A Watch Fit 2 as far as is known: the support bitmap, but no extended bitmap, no sun/moon bitmap and no extended hourly capability.
        var fit2 = Weather.Settings()
        fit2.weatherSupported = true
        fit2.windSupported = true
        fit2.temperatureSupported = true
        fit2.locationNameSupported = true
        fit2.currentTemperatureSupported = true
        fit2.unitSupported = true
        let packet = WeatherPackets.forecast(settings: fit2, entries: entries)
        XCTAssertEqual(WeatherPackets.forecastShape(packet: packet, entries: entries), "24 hours (tags 03 05), 8 days (tags 12 14 15)")
        XCTAssertTrue(WeatherPackets.countsAreComplete(entries))

        var empty = report()
        empty.hourly = []
        let none = WeatherPackets.forecastEntries(report: empty, nowSec: now, zone: zone)
        XCTAssertEqual(
            WeatherPackets.forecastShape(packet: WeatherPackets.forecast(settings: fit2, entries: none), entries: none),
            "0 hours (tags none), 8 days (tags 12 14 15)"
        )
    }

    func testRowsWithMissingValuesAreCountedAsSkipped() throws {
        let place = WeatherPlace(name: "Bandung", latitude: -6.9, longitude: 107.6)
        let json = """
        {"current":{"time":1760412600,"temperature_2m":27.6,"weather_code":2},
         "hourly":{"time":[1760410800,1760414400,1760418000,1760421600],"temperature_2m":[27.0,null,null,29.0],
           "weather_code":[2,3,null,3]},
         "daily":{"time":[1760374800,1760461200,1760547600],"weather_code":[61,null,3],"temperature_2m_max":[31.4,30.0,null],
           "temperature_2m_min":[22.6,22.0,21.0]}}
        """
        let report = try OpenMeteo.parseForecast(json, place: place, fetchedAtSec: 1_760_412_700)
        XCTAssertEqual(report.hourly.count, 2)
        XCTAssertEqual(report.skippedHours, 2)
        XCTAssertEqual(report.daily.count, 1)
        XCTAssertEqual(report.skippedDays, 2)

        let whole = try OpenMeteo.parseForecast(
            """
            {"current":{"time":1760412600,"temperature_2m":27.6,"weather_code":2},
             "hourly":{"time":[1760410800],"temperature_2m":[27.0],"weather_code":[2]},
             "daily":{"time":[1760374800],"weather_code":[61],"temperature_2m_max":[31.4],"temperature_2m_min":[22.6]}}
            """, place: place, fetchedAtSec: 0
        )
        XCTAssertEqual(whole.skippedHours, 0)
        XCTAssertEqual(whole.skippedDays, 0)
        XCTAssertEqual(self.report().skippedHours, 0)
    }

    func testErrorPacketPrefersTheExtendedCommand() throws {
        let caps = DeviceCaps()
        XCTAssertNil(WeatherPackets.error(caps: caps, code: .networkError))
        caps.supportedCommands = [0x0F: [0x01, 0x07]]
        XCTAssertEqual(WeatherPackets.error(caps: caps, code: .networkError)!.commandId, 0x07)
        caps.supportedCommands = [0x0F: [0x01, 0x07, 0x0C]]
        let extended = WeatherPackets.error(caps: caps, code: .weatherDisabled)!
        XCTAssertEqual(extended.commandId, 0x0C)
        XCTAssertEqual(try extended.tlv!.object(0x81).byte(0x02), 2)
    }

    func testGpsPacketRoundsAndBackdates() throws {
        let packet = WeatherPackets.gps(nowSec: now, place: WeatherPlace(name: "x", latitude: -6.91474449, longitude: 107.60981119))
        XCTAssertEqual(packet.serviceId, 0x18)
        XCTAssertEqual(packet.commandId, 0x07)
        XCTAssertEqual(try packet.tlv!.int(0x01), Int32(now - 86400))
        XCTAssertTrue(packet.tlv!.contains(0x02))
        XCTAssertTrue(packet.tlv!.contains(0x03))
        // Little-endian doubles, rounded half up to 7 decimals.
        let latitude = Double(bitPattern: try packet.tlv!.bytes(0x02).enumerated().reduce(UInt64(0)) { $0 | UInt64($1.element) << UInt64(8 * $1.offset) })
        XCTAssertEqual(latitude, -6.9147445)
    }

    func testEveryPacketSerializesToWireFrames() throws {
        let params = ParamsProvider()
        params.secretKey = Bytes(repeating: 0, count: 16)
        let settings = allSupported()
        let current = try WeatherPackets.current(settings: settings, report: report(), unit: .celsius).serialize(params: params)
        XCTAssertEqual(current[0][0], 0x5A)
        let forecast = try WeatherPackets.forecast(settings: settings, report: report(), nowSec: now, zone: zone).serialize(params: params)
        XCTAssertGreaterThan(forecast.count, 1, "forecast is sliced")
        XCTAssertEqual(forecast[0][0], 0x5A)
    }

    func testSupportFollowsSupportedCommands() {
        let caps = DeviceCaps()
        XCTAssertFalse(caps.supports(0x0F, 0x01))
        XCTAssertFalse(HuaweiWeatherSender.supported(caps))
        caps.supportedCommands = [0x0F: [0x01, 0x02]]
        XCTAssertTrue(caps.supports(0x0F, 0x01))
        XCTAssertTrue(HuaweiWeatherSender.supported(caps))
    }

    func testSettingsWireNames() {
        XCTAssertEqual(TemperatureUnit(wire: "fahrenheit"), .fahrenheit)
        XCTAssertNil(TemperatureUnit(wire: "kelvin"))
        XCTAssertEqual(WeatherLocationMode(wire: "city"), .city)
        XCTAssertNil(WeatherLocationMode(wire: "gps"))
        XCTAssertEqual(WeatherErrorCodes.watchError(.weatherLocation), .gpsPermissionError)
        XCTAssertEqual(WeatherErrorCodes.watchError(.weatherNetwork), .networkError)
        XCTAssertEqual(WeatherErrorCodes.watchError(.weatherDisabled), .weatherDisabled)
        XCTAssertNil(WeatherErrorCodes.watchError(.timeout))
    }

    // MARK: recorded Open-Meteo answers

    private func fixture(_ name: String) throws -> String {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures/\(name)")
        return try String(contentsOf: url, encoding: .utf8)
    }

    func testARecordedForecastOfBandungParses() throws {
        let json = try fixture("openmeteo_forecast_bandung.json")
        let place = WeatherPlace(name: "Bandung", latitude: -6.91, longitude: 107.61)
        let report = try OpenMeteo.parseForecast(json, place: place, fetchedAtSec: 1_792_110_700)
        XCTAssertEqual(report.observedAtSec, 1_792_110_600)
        XCTAssertEqual(report.tempC, 23.6, accuracy: 0.001)
        XCTAssertEqual(report.feelsLikeC, 25.4, accuracy: 0.001)
        XCTAssertEqual(report.humidity, 63)
        XCTAssertEqual(report.windSpeedKmh, 2.4, accuracy: 0.001)
        XCTAssertEqual(report.windDirection, 126)
        XCTAssertEqual(report.code, 0)
        XCTAssertEqual(report.uvIndex!, 2.9, accuracy: 0.001)
        XCTAssertEqual(report.hourly.count, 192, "8 days of hours")
        XCTAssertEqual(report.daily.count, 8)
        XCTAssertEqual(report.hourly[0].timestamp, 1_792_083_600)
        XCTAssertEqual(report.hourly[1].timestamp - report.hourly[0].timestamp, 3600)
        XCTAssertTrue(report.daily.allSatisfy { $0.sunrise > $0.timestamp && $0.sunset > $0.sunrise }, "every day has a sunrise and a sunset inside it")
        XCTAssertEqual(report.daily[0].timestamp, 1_792_083_600)

        // Pushed at the observation time, the sun times of each day fall inside that local day, so none is dropped.
        let packet = WeatherPackets.forecast(settings: allSupported(), report: report, nowSec: Int64(report.observedAtSec), zone: TimeZone(identifier: "Asia/Jakarta")!)
        let days = try packet.tlv!.object(0x90).objects(0x91)
        XCTAssertEqual(days.count, 8)
        XCTAssertTrue(days.allSatisfy { $0.contains(0x16) && $0.contains(0x17) })
        XCTAssertEqual(try packet.tlv!.object(0x81).objects(0x82).count, 24)
    }

    func testARecordedGeocodingAnswerParses() throws {
        let places = try OpenMeteo.parseGeocoding(try fixture("openmeteo_geocoding_bandung.json"))
        XCTAssertGreaterThanOrEqual(places.count, 2)
        XCTAssertEqual(places[0].name, "Bandung")
        XCTAssertEqual(places[0].detail, "West Java, Indonesia, ID")
        XCTAssertEqual(places[0].latitude, -6.92222, accuracy: 0.0001)
        XCTAssertEqual(OpenMeteo.matchQualifier(places, qualifier: "East Java").first?.detail, "East Java, Indonesia, ID")
        XCTAssertTrue(try OpenMeteo.parseGeocoding(try fixture("openmeteo_geocoding_none.json")).isEmpty, "no results key is no places")
    }

    func testARecordedErrorBodyIsABadResponse() throws {
        XCTAssertThrowsError(try OpenMeteo.parseForecast(try fixture("openmeteo_error.json"), place: WeatherPlace(name: nil, latitude: 999, longitude: 0), fetchedAtSec: 0)) {
            XCTAssertTrue(($0 as? OpenMeteoBadResponse)?.message.hasPrefix("Open-Meteo: Latitude must be in range") == true)
        }
    }

    func testSearchCityQueriesTheNameAndFiltersByTheQualifier() async throws {
        let json = try fixture("openmeteo_geocoding_bandung.json")
        let urls = URLLog()
        let fetch: WeatherFetch = { url in
            urls.add(url)
            return json
        }
        let plain = try await OpenMeteo.searchCity("  Bandung ", fetch: fetch)
        XCTAssertEqual(urls.all.last, "https://geocoding-api.open-meteo.com/v1/search?name=Bandung&count=1&language=en&format=json")
        XCTAssertGreaterThanOrEqual(plain.count, 2, "the canned reply has more than one; the real API would return one for count=1")

        let qualified = try await OpenMeteo.searchCity("Bandung, East Java", fetch: fetch)
        XCTAssertEqual(urls.all.last, "https://geocoding-api.open-meteo.com/v1/search?name=Bandung&count=10&language=en&format=json")
        XCTAssertFalse(qualified.isEmpty)
        XCTAssertTrue(qualified.allSatisfy { $0.detail == "East Java, Indonesia, ID" }, "only the East Java ones are kept")

        let none = try await OpenMeteo.searchCity("Bandung, Narnia", fetch: fetch)
        XCTAssertTrue(none.isEmpty)
        let before = urls.all.count
        let blank = try await OpenMeteo.searchCity(" , Indonesia", fetch: fetch)
        XCTAssertTrue(blank.isEmpty)
        XCTAssertEqual(urls.all.count, before, "no request without a name")
    }
}

final class URLLog: @unchecked Sendable {
    private let lock = NSLock()
    private var urls: [String] = []
    func add(_ url: String) { lock.lock(); urls.append(url); lock.unlock() }
    var all: [String] { lock.lock(); defer { lock.unlock() }; return urls }
}
