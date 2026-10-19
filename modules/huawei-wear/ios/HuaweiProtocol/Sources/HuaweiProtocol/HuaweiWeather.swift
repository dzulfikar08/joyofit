// Port of HuaweiWeather.kt (derived from Gadgetbridge's HuaweiWeatherManager.{sendWeather,fixupWeather,handleAsyncMessage} and the SendWeather*Request
// chain): builds the weather packets from a `WeatherReport` (no I/O, `WeatherPackets`) and runs GB's request sequence over one session
// (`HuaweiWeatherSender`).
import Foundation

/// What the forecast step (0f/08) of a push did; `wire` is `WeatherForecastState` in `HuaweiWear.types.ts`.
public enum ForecastState: String, Sendable {
    case sent
    case unsupported
    case unacknowledged
    case rejected

    public var wire: String { rawValue }
}

public struct ForecastOutcome: Equatable, Sendable {
    public var state: ForecastState
    public var hours: Int
    public var days: Int
    public var replyCode: Int32?
    public var atSec: Int64

    public init(state: ForecastState, hours: Int, days: Int, replyCode: Int32?, atSec: Int64) {
        self.state = state
        self.hours = hours
        self.days = days
        self.replyCode = replyCode
        self.atSec = atSec
    }

    /// `WeatherForecastStatus` in `HuaweiWear.types.ts`.
    public func toJS() -> [String: Any] {
        [
            "state": state.wire,
            "hours": hours,
            "days": days,
            "replyCode": replyCode.map { Int($0) as Any } ?? NSNull(),
            "at": atSec,
        ]
    }
}

/// The hourly and daily rows of a forecast request.
public struct ForecastEntries: Equatable, Sendable {
    public var hours: [Weather.WeatherForecastData.TimeData]
    public var days: [Weather.WeatherForecastData.DayData]

    public init(hours: [Weather.WeatherForecastData.TimeData], days: [Weather.WeatherForecastData.DayData]) {
        self.hours = hours
        self.days = days
    }
}
public enum WeatherPackets {
    /// Whole degrees, clamped to the signed byte the watch takes.
    public static func temperatureByte(_ celsius: Double) -> Int8 {
        Int8(clamping: Weather.javaRound(celsius))
    }

    /// Hours the forecast request carries (SendWeatherForecastRequest).
    public static let maxHours = 24
    /// Days including today (SendWeatherForecastRequest).
    public static let maxDays = 8

    /// SendWeatherCurrentRequest. Temperatures are always Celsius, like GB (`K - 273`); the unit tag (0x0a) is what tells the watch to display Fahrenheit.
    public static func current(settings: Weather.Settings, report: WeatherReport, unit: TemperatureUnit) -> HuaweiPacket {
        let today = report.daily[0]
        return Weather.CurrentWeatherRequest.request(
            settings: settings,
            icon: WeatherIcons.forWmo(report.code),
            windDirection: report.windDirection,
            windSpeed: Int8(truncatingIfNeeded: Beaufort.fromKmh(report.windSpeedKmh)),
            lowestTemperature: temperatureByte(today.minC),
            highestTemperature: temperatureByte(today.maxC),
            pm25: nil, // Open-Meteo's forecast API has no air quality
            locationName: report.place.name,
            currentTemperature: temperatureByte(report.tempC),
            temperatureUnit: unit.format,
            airQualityIndex: nil,
            observationTime: report.observedAtSec,
            uvIndex: report.uvIndex.map { Float($0) },
            sourceName: sourceName,
            humidity: Int8(truncatingIfNeeded: min(max(report.humidity, 0), 100)),
            windSpeedValue: Weather.javaRound(report.windSpeedKmh),
            feelLikeTemperature: Weather.javaRound(report.feelsLikeC)
        )
    }

    /// SendWeatherForecastRequest after GB's fixupWeather: the next 24 hours, then today (current icon, as GB does) and up to seven more days.
    /// Moon rise/set come from Open-Meteo's daily `moonrise`/`moonset` and go through the same day check as the sun times (GB fixupWeather does
    /// it for moonRise/moonSet too); the moon phase is computed (`Moon`).
    public static func forecast(settings: Weather.Settings, report: WeatherReport, nowSec: Int64, zone: TimeZone) -> HuaweiPacket {
        forecast(settings: settings, entries: forecastEntries(report: report, nowSec: nowSec, zone: zone))
    }

    public static func forecast(settings: Weather.Settings, entries: ForecastEntries) -> HuaweiPacket {
        Weather.WeatherForecastData.request(settings: settings, hours: entries.hours, days: entries.days)
    }

    /// The hourly and daily rows of a forecast request, before the watch's support flags decide which tags each row keeps.
    public static func forecastEntries(report: WeatherReport, nowSec: Int64, zone: TimeZone) -> ForecastEntries {
        let hours: [Weather.WeatherForecastData.TimeData] = Array(report.hourly.lazy.filter { Int64($0.timestamp) > nowSec }.prefix(maxHours)).map { hour in
            Weather.WeatherForecastData.TimeData(
                timestamp: hour.timestamp,
                icon: WeatherIcons.forWmo(hour.code),
                temperature: temperatureByte(hour.tempC),
                precipitation: Int8(truncatingIfNeeded: min(max(hour.precipProbability ?? 0, 0), 100)),
                uvIndex: Int8(truncatingIfNeeded: min(max(Weather.javaRound(hour.uvIndex ?? 0), 0), 127))
            )
        }

        let calendar = dayCalendar(zone)
        let dayCount = min(report.daily.count, maxDays)
        var days: [Weather.WeatherForecastData.DayData] = []
        days.reserveCapacity(dayCount)
        let today = report.daily[0]
        days.append(
            day(
                timestamp: report.observedAtSec,
                code: report.code,
                source: today,
                sunrise: sunInDay(today.sunrise, calendar: calendar, nowSec: nowSec, day: 0),
                sunset: sunInDay(today.sunset, calendar: calendar, nowSec: nowSec, day: 0),
                moonrise: sunInDay(today.moonrise, calendar: calendar, nowSec: nowSec, day: 0),
                moonset: sunInDay(today.moonset, calendar: calendar, nowSec: nowSec, day: 0),
                moonPhaseAt: dayStartSec(calendar, nowSec, 0) + 12 * 3600
            )
        )
        for i in 1..<max(dayCount, 1) {
            let forecast = report.daily[i]
            days.append(
                day(
                    // GB: the observation time plus whole days, not the day's own midnight.
                    timestamp: report.observedAtSec &+ Int32(truncatingIfNeeded: 24 * 3600 * i),
                    code: forecast.code,
                    source: forecast,
                    sunrise: sunInDay(forecast.sunrise, calendar: calendar, nowSec: nowSec, day: i),
                    sunset: sunInDay(forecast.sunset, calendar: calendar, nowSec: nowSec, day: i),
                    moonrise: sunInDay(forecast.moonrise, calendar: calendar, nowSec: nowSec, day: i),
                    moonset: sunInDay(forecast.moonset, calendar: calendar, nowSec: nowSec, day: i),
                    moonPhaseAt: dayStartSec(calendar, nowSec, i) + 12 * 3600
                )
            )
        }
        return ForecastEntries(hours: hours, days: days)
    }

    /// What the request will carry, read back from the packet's own TLV so it shows what GB's `Weather.Request` kept after the watch's support
    /// flags, not what we meant to send: "24 hours (tags 03 04 05), 8 days (tags 12 13 14 15 1e)".
    public static func forecastShape(packet: HuaweiPacket, entries: ForecastEntries) -> String {
        func tags(_ container: Int, _ row: Int) -> String {
            guard let tlv = packet.tlv, tlv.contains(container), let rows = try? tlv.object(container).objects(row), let first = rows.first else { return "none" }
            return first.entries.map { String(format: "%02x", $0.tag) }.joined(separator: " ")
        }
        return "\(entries.hours.count) hours (tags \(tags(0x81, 0x82))), \(entries.days.count) days (tags \(tags(0x90, 0x91)))"
    }

    /// The two counts the watch is known to want (Gadgetbridge issue 6973: a Watch GT 4 shows no forecast unless it gets exactly these).
    public static func countsAreComplete(_ entries: ForecastEntries) -> Bool { entries.hours.count == maxHours && entries.days.count == maxDays }

    private static func day(
        timestamp: Int32, code: Int32, source: WeatherDay, sunrise: Int32, sunset: Int32, moonrise: Int32, moonset: Int32, moonPhaseAt: Int64
    ) -> Weather.WeatherForecastData.DayData {
        Weather.WeatherForecastData.DayData(
            timestamp: timestamp,
            icon: WeatherIcons.forWmo(code),
            highTemperature: temperatureByte(source.maxC),
            lowTemperature: temperatureByte(source.minC),
            sunriseTime: sunrise,
            sunsetTime: sunset,
            // Tags 0x1a / 0x1b: encoded and gated by `Weather.WeatherForecastData.request` (GB Weather.java:603-612: both under
            // `sunRiseSetSupported`, bit 0 of the 0f/0a answer; the phase, 0x1e, follows `moonPhaseSupported`). GB feeds them from
            // WeatherSpec.moonRise/moonSet (SendWeatherForecastRequest.java:64-65, 78-79) after fixupWeather (HuaweiWeatherManager.java:163-170, 184-191).
            moonRiseTime: moonrise,
            moonSetTime: moonset,
            moonPhase: Weather.degreesToMoonPhase(Moon.phaseDegrees(moonPhaseAt))
        )
    }

    /// GB fixupWeather: "if this is wrong the watch does not display any weather data at all", so a sun time outside the local day it belongs to
    /// (`day` days after today) is sent as 0.
    public static func sunInDay(_ timeSec: Int32, zone: TimeZone, nowSec: Int64, day: Int) -> Int32 {
        sunInDay(timeSec, calendar: dayCalendar(zone), nowSec: nowSec, day: day)
    }

    private static func sunInDay(_ timeSec: Int32, calendar: Calendar, nowSec: Int64, day: Int) -> Int32 {
        if timeSec == 0 { return 0 }
        let start = dayStartSec(calendar, nowSec, day)
        let end = dayStartSec(calendar, nowSec, day + 1)
        // GB timeOutOfDateInterval: out when check <= start or check > end.
        let check = Int64(timeSec)
        return (check <= start || check > end) ? 0 : timeSec
    }

    private static func dayCalendar(_ zone: TimeZone) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        return calendar
    }

    /// Midnight, `plusDays` calendar days after the day of `nowSec`, in the calendar's zone (`LocalDate.plusDays(n).atStartOfDay(zone)`).
    private static func dayStartSec(_ calendar: Calendar, _ nowSec: Int64, _ plusDays: Int) -> Int64 {
        let today = calendar.startOfDay(for: Date(timeIntervalSince1970: TimeInterval(nowSec)))
        let shifted = calendar.date(byAdding: .day, value: plusDays, to: today) ?? today.addingTimeInterval(TimeInterval(plusDays * 86400))
        return Int64(calendar.startOfDay(for: shifted).timeIntervalSince1970)
    }

    /// SendWeatherCurrentRequest: GB passes its app name as the source.
    public static let sourceName = "Open-Meteo"

    /// SendWeatherErrorRequest: the extended packet when the watch lists 0f/0c, else the simple one (0f/07).
    public static func error(caps: DeviceCaps, code: Weather.ErrorCode) -> HuaweiPacket? {
        if caps.supports(Int(Weather.id), Int(Weather.WeatherErrorExtended.id)) {
            return Weather.WeatherErrorExtended.request(errorCode: code, serverError: false)
        }
        if caps.supports(Int(Weather.id), Int(Weather.WeatherErrorSimple.id)) {
            return Weather.WeatherErrorSimple.request(errorCode: code)
        }
        return nil
    }

    /// GB rounds the position to 7 decimals and back-dates the timestamp by a day so a workout's GPS wins.
    public static func gps(nowSec: Int64, place: WeatherPlace) -> HuaweiPacket {
        GpsAndTime.CurrentGPSRequest.request(
            timestamp: Int32(truncatingIfNeeded: nowSec - 86400),
            latitude: JavaNumbers.roundedToSevenDecimals(place.latitude),
            longitude: JavaNumbers.roundedToSevenDecimals(place.longitude)
        )
    }
}

/// The weather commands and capability bits that decide what a push contains, on one line: in the log before every push and in the support
/// report. Which of them a Watch Fit 2 lists is not known yet; a report with this line settles it.
public enum WeatherGates {
    public static func describe(caps: DeviceCaps) -> String {
        func yn(_ value: Bool) -> String { value ? "yes" : "no" }
        func weather(_ command: Int) -> String { yn(caps.supports(0x0F, command)) }
        return "current(0f/01)=\(weather(0x01)) unit(0f/05)=\(weather(0x05)) extended(0f/06)=\(weather(0x06)) "
            + "forecast(0f/08)=\(weather(0x08)) sunMoon(0f/0a)=\(weather(0x0A)) errorSimple(0f/07)=\(weather(0x07)) "
            + "errorExtended(0f/0c)=\(weather(0x0C)) gps(18/06)=\(yn(caps.supports(0x18, 0x06))) "
            + "uvIndex(cap 0x2f)=\(yn(caps.expandCapability(0x2F))) extendedHourly(cap 0xc0)=\(yn(caps.expandCapability(0xC0)))"
    }
}

/// What the last weather push did, kept for the support report: a day of hourly pushes scrolls the push out of the log, and the one that
/// matters for a report is the last. In memory only, like the rest of the push status.
public enum WeatherDiagnostics {
    public struct Snapshot: Sendable {
        public var atSec: Int64
        public var reason: String
        /// Bitmaps the watch answered with: "support 0x7f", "extended 0x0007", "sunMoon 0x03".
        public var bitmaps: [String]
        /// One entry per step: "WeatherCurrent answered 0x000186a0 in 85 ms".
        public var steps: [String]
        public var forecast: ForecastOutcome?
        /// What the forecast request carried, see `WeatherPackets.forecastShape`.
        public var shape: String?
        /// Why the push stopped early, or nil.
        public var failure: String?

        public init(atSec: Int64, reason: String, bitmaps: [String], steps: [String], forecast: ForecastOutcome?, shape: String?, failure: String?) {
            self.atSec = atSec
            self.reason = reason
            self.bitmaps = bitmaps
            self.steps = steps
            self.forecast = forecast
            self.shape = shape
            self.failure = failure
        }
    }

    /// The pushes run on a task and the support report is built on another, so the snapshot sits behind a lock.
    private final class Box: @unchecked Sendable {
        private let lock = NSLock()
        private var value: Snapshot?

        var snapshot: Snapshot? {
            get { lock.lock(); defer { lock.unlock() }; return value }
            set { lock.lock(); value = newValue; lock.unlock() }
        }
    }

    private static let box = Box()

    public static var last: Snapshot? {
        get { box.snapshot }
        set { box.snapshot = newValue }
    }

    /// Support report lines: the switch and the gates, then the last push.
    public static func summary(enabled: Bool, caps: DeviceCaps, nowSec: Int64 = Int64(Date().timeIntervalSince1970)) -> [String] {
        var lines = ["Weather: switch \(enabled ? "on" : "off"); gates (last connect) \(WeatherGates.describe(caps: caps))"]
        guard let snapshot = last else {
            lines.append("Weather last push: none in this process")
            return lines
        }
        let ago = max(nowSec - snapshot.atSec, 0)
        let bitmaps = snapshot.bitmaps.isEmpty ? "no support bitmaps read" : snapshot.bitmaps.joined(separator: ", ")
        lines.append("Weather last push: \(snapshot.reason), \(ago / 60) min ago; \(bitmaps)")
        lines.append("  steps: \(snapshot.steps.isEmpty ? "none" : snapshot.steps.joined(separator: "; "))")
        if let failure = snapshot.failure { lines.append("  stopped: \(failure)") }
        if let forecast = snapshot.forecast {
            let code = forecast.replyCode.map { " reply " + String(format: "0x%08x", UInt32(bitPattern: $0)) } ?? ""
            lines.append("  forecast: \(forecast.state.wire)\(code)\(snapshot.shape.map { ", " + $0 } ?? "")")
        }
        return lines
    }
}

/// The weather packet sequence of GB's HuaweiWeatherManager.sendWeather, over one `HuaweiSession`.
public struct HuaweiWeatherSender: Sendable {
    /// Tag 0x7f of a reply the watch accepts: GB's `WeatherStart.Response.success`.
    static let okReplyCodes: Set<Int32> = [0x000186A0, 0x000186A3]

    private let session: HuaweiSession
    private let caps: DeviceCaps
    private let log: LogSink
    private let answerTimeoutMs: Int

    public init(session: HuaweiSession, caps: DeviceCaps, log: @escaping LogSink, answerTimeoutMs: Int = Timeouts.queryMs) {
        self.session = session
        self.answerTimeoutMs = answerTimeoutMs
        self.caps = caps
        self.log = log
    }

    /// Whether the watch lists the weather service at all (HuaweiState.supportsWeather: 0f/01).
    public static func supported(_ caps: DeviceCaps) -> Bool { caps.supports(Int(Weather.id), Int(Weather.CurrentWeatherRequest.id)) }

    public func supported() -> Bool { HuaweiWeatherSender.supported(caps) }

    private struct Trace {
        let atSec: Int64
        let reason: String
        var bitmaps: [String] = []
        var steps: [String] = []
        var forecast: ForecastOutcome?
        var shape: String?
        var failure: String?

        init(atSec: Int64, reason: String) {
            self.atSec = atSec
            self.reason = reason
        }

        func snapshot() -> WeatherDiagnostics.Snapshot {
            WeatherDiagnostics.Snapshot(atSec: atSec, reason: reason, bitmaps: bitmaps, steps: steps, forecast: forecast, shape: shape, failure: failure)
        }
    }

    /// The watch's answer to a push: the code in tag 0x7f, or nil when it answered without one.
    private struct Receipt {
        let code: Int32?
    }

    /// Start, unit, support flags, current weather, position, forecast, each waiting for the watch's reply like GB's request chain. `zone` is
    /// the phone's: it decides which sun times fall in "today". Returns what the forecast step did; the steps before it throw a `WearError`
    /// when the watch does not answer, because what they ask for decides what the later ones may carry.
    @discardableResult
    public func send(report: WeatherReport, unit: TemperatureUnit, nowSec: Int64, zone: TimeZone = .current, reason: String = "push") async throws -> ForecastOutcome {
        if !supported() { throw WearError(.unsupported, "The watch does not list the weather service (0f/01)") }
        info("Weather gates: " + WeatherGates.describe(caps: caps))
        var trace = Trace(atSec: nowSec, reason: reason)
        defer { WeatherDiagnostics.last = trace.snapshot() }
        do {
            return try await run(report, unit, nowSec, zone, &trace)
        } catch let e as WearError {
            trace.failure = "\(e.code.rawValue): \(e.message)"
            throw e
        }
    }

    private func run(_ report: WeatherReport, _ unit: TemperatureUnit, _ nowSec: Int64, _ zone: TimeZone, _ trace: inout Trace) async throws -> ForecastOutcome {
        var settings = Weather.Settings()
        settings.uvIndexSupported = caps.expandCapability(0x2F) // supportsWeatherUvIndex
        settings.extendedHourlyForecast = caps.expandCapability(0xC0) // supportsWeatherExtendedHourForecast

        // SendWeatherStartRequest: a non-ok code stops GB's chain.
        let start: Weather.WeatherStart.Response = try expect(try await query(Weather.WeatherStart.request(), "WeatherStart", &trace), "WeatherStart")
        if !start.success {
            throw WearError(.protocolError, "WeatherStart: the watch refused (code " + hex32(start.successCode) + ")")
        }
        settings.weatherSupported = true

        if caps.supports(Int(Weather.id), Int(Weather.WeatherUnitRequest.id)) {
            _ = try await query(Weather.WeatherUnitRequest.request(temperatureFormat: unit.format), "WeatherUnit", &trace)
        }

        let support: Weather.WeatherSupport.Response = try expect(
            try await query(Weather.WeatherSupport.request(), "WeatherSupport", &trace), "WeatherSupport"
        )
        settings.weatherSupported = support.weatherSupported
        settings.windSupported = support.windSupported
        settings.pm25Supported = support.pm25Supported
        settings.temperatureSupported = support.temperatureSupported
        settings.locationNameSupported = support.locationNameSupported
        settings.currentTemperatureSupported = support.currentTemperatureSupported
        settings.unitSupported = support.unitSupported
        settings.airQualityIndexSupported = support.airQualityIndexSupported
        let supportBitmap = hex(UInt32(UInt8(bitPattern: support.supportedBitmap)), width: 2)
        bitmap(&trace, "support " + supportBitmap, "Weather support bitmap " + supportBitmap)

        if caps.supports(Int(Weather.id), Int(Weather.WeatherExtendedSupport.id)) {
            let extended: Weather.WeatherExtendedSupport.Response = try expect(
                try await query(Weather.WeatherExtendedSupport.request(), "WeatherExtendedSupport", &trace), "WeatherExtendedSupport"
            )
            settings.timeSupported = extended.timeSupported
            settings.sourceSupported = extended.sourceSupported
            settings.weatherIconSupported = extended.weatherIconSupported
            let extendedBitmap = hex(UInt32(UInt16(bitPattern: extended.supportedBitmap)), width: 4)
            bitmap(&trace, "extended " + extendedBitmap, "Weather extended bitmap " + extendedBitmap)
        } else {
            // Without 0f/06 nothing sets the icon flag; bit 0 of the support bitmap is the nearest answer the watch gave.
            settings.weatherIconSupported = support.weatherSupported
            info("Weather: the watch lists no 0f/06, so the icon flag follows bit 0 of the support bitmap (\(support.weatherSupported))")
        }

        if caps.supports(Int(Weather.id), Int(Weather.WeatherSunMoonSupport.id)) {
            let sunMoon: Weather.WeatherSunMoonSupport.Response = try expect(
                try await query(Weather.WeatherSunMoonSupport.request(), "WeatherSunMoonSupport", &trace), "WeatherSunMoonSupport"
            )
            settings.sunRiseSetSupported = sunMoon.sunRiseSetSupported
            settings.moonPhaseSupported = sunMoon.moonPhaseSupported
            let sunMoonBitmap = hex(UInt32(bitPattern: sunMoon.supportedBitmap), width: 2)
            bitmap(&trace, "sunMoon " + sunMoonBitmap, "Weather sun/moon bitmap " + sunMoonBitmap)
        }
        info(
            "Weather flags the packets will follow: icon=\(settings.weatherIconSupported) temperatureRange=\(settings.temperatureSupported) "
                + "currentTemperature=\(settings.currentTemperatureSupported) sunRiseSet=\(settings.sunRiseSetSupported) moonPhase=\(settings.moonPhaseSupported) "
                + "extendedHourly=\(settings.extendedHourlyForecast)"
        )

        // The next two are pushes: the watch may take them without a receipt we can read, which must not keep the forecast from being sent.
        _ = try await push(WeatherPackets.current(settings: settings, report: report, unit: unit), "WeatherCurrent", &trace)
        info(
            "Weather current: \(report.place.name ?? "unnamed place") \(WeatherPackets.temperatureByte(report.tempC))\u{00B0}C "
                + "\(WeatherIcons.forWmo(report.code).name) (WMO \(report.code)), unit \(unit.wire)"
        )

        // SendGpsAndTimeToDeviceRequest: GB sends it by default when the watch lists 0x18/0x06.
        if caps.supports(Int(GpsAndTime.id), 0x06) {
            _ = try await push(WeatherPackets.gps(nowSec: nowSec, place: report.place), "WeatherGps", &trace)
        }

        return try await forecast(settings, report, nowSec, zone, &trace)
    }

    /// The forecast step: only when the watch lists 0f/08 (GB supportsWeatherForecasts), and what became of it is returned.
    private func forecast(_ settings: Weather.Settings, _ report: WeatherReport, _ nowSec: Int64, _ zone: TimeZone, _ trace: inout Trace) async throws -> ForecastOutcome {
        if !caps.supports(Int(Weather.id), Int(Weather.WeatherForecastData.id)) {
            info("Weather forecast skipped: the watch does not list 0f/08, so it only gets current weather (GB supportsWeatherForecasts)")
            let outcome = ForecastOutcome(state: .unsupported, hours: 0, days: 0, replyCode: nil, atSec: nowSec)
            trace.forecast = outcome
            return outcome
        }
        let entries = WeatherPackets.forecastEntries(report: report, nowSec: nowSec, zone: zone)
        let packet = WeatherPackets.forecast(settings: settings, entries: entries)
        let shape = WeatherPackets.forecastShape(packet: packet, entries: entries)
        trace.shape = shape
        info("Weather forecast: \(shape), first hour \(entries.hours.first.map { iso8601(Int64($0.timestamp)) } ?? "none")")
        if !WeatherPackets.countsAreComplete(entries) {
            log(
                LogEntry(
                    .error,
                    "Weather forecast has \(entries.hours.count) hours and \(entries.days.count) days, not \(WeatherPackets.maxHours) and \(WeatherPackets.maxDays); "
                        + "some watches show no forecast at all unless they get exactly those"
                )
            )
        }
        let receipt = try await push(packet, "WeatherForecast", &trace)
        let code = receipt?.code
        let state: ForecastState
        if receipt == nil {
            state = .unacknowledged
        } else if let code, !HuaweiWeatherSender.okReplyCodes.contains(code) {
            state = .rejected
        } else {
            state = .sent
        }
        let outcome = ForecastOutcome(state: state, hours: entries.hours.count, days: entries.days.count, replyCode: code, atSec: nowSec)
        trace.forecast = outcome
        switch state {
        case .sent:
            info("Weather forecast sent: \(entries.hours.count) hours, \(entries.days.count) days")
        case .rejected:
            log(LogEntry(.error, "Weather forecast not taken: the watch answered " + hex32(code ?? 0)))
        default:
            log(LogEntry(.error, "Weather forecast sent but never acknowledged"))
        }
        return outcome
    }

    /// SendWeatherErrorRequest; returns false when the watch lists neither error command.
    public func sendError(_ code: Weather.ErrorCode) async throws -> Bool {
        guard let packet = WeatherPackets.error(caps: caps, code: code) else { return false }
        _ = try await session.request(packet, timeoutMs: answerTimeoutMs, label: "WeatherError (\(code.rawValue))")
        info("Weather error sent to the watch: \(code.rawValue)")
        return true
    }

    /// SendWeatherDeviceRequest: GB's answer to a watch weather message that is not a request (`addToResponse = false`).
    public func acknowledge() async throws {
        try await session.send(Weather.WeatherDeviceRequest.request(responseValue: Weather.resultSuccess), label: "WeatherDeviceRequest ack")
    }

    private func info(_ message: String) { log(LogEntry(.info, message)) }

    private func bitmap(_ trace: inout Trace, _ short: String, _ line: String) {
        trace.bitmaps.append(short)
        info(line)
    }

    private func elapsedMs(_ begun: UInt64) -> UInt64 { (DispatchTime.now().uptimeNanoseconds - begun) / 1_000_000 }

    private func codeText(_ response: HuaweiPacket) -> String {
        guard let tlv = response.tlv, let code = try? tlv.int(0x7F) else { return "" }
        return " " + hex32(code)
    }

    private func step(_ trace: inout Trace, _ label: String, _ text: String, error: Bool = false) {
        trace.steps.append("\(label) \(text)")
        log(LogEntry(error ? .error : .info, "Weather step \(label): \(text)"))
    }

    /// The typed parse of an answer; a parse failure is an `ERR_PROTOCOL` flagged `isParseFailure`, as in `HuaweiSession.request`.
    private func expect<R: PacketResponse>(_ response: HuaweiPacket, _ label: String) throws -> R {
        do {
            return try R(packet: response)
        } catch let e as WearError {
            throw e
        } catch {
            throw WearError(.protocolError, "\(label): failed to parse response: \(error)", underlying: error, isParseFailure: true)
        }
    }

    /// A request whose answer the next steps depend on (start, unit, support flags): no answer ends the push.
    private func query(_ packet: HuaweiPacket, _ label: String, _ trace: inout Trace) async throws -> HuaweiPacket {
        let begun = DispatchTime.now().uptimeNanoseconds
        let response = try await session.request(packet, timeoutMs: answerTimeoutMs, label: label)
        step(&trace, label, "answered\(codeText(response)) in \(elapsedMs(begun)) ms")
        return response
    }

    /// A packet that carries data (current weather, position, forecast): the answer is only a receipt, so a missing one is logged and the
    /// sequence goes on. Returns nil when the watch did not answer; a lost link still ends the push.
    private func push(_ packet: HuaweiPacket, _ label: String, _ trace: inout Trace) async throws -> Receipt? {
        let begun = DispatchTime.now().uptimeNanoseconds
        let response: HuaweiPacket
        do {
            response = try await session.request(packet, timeoutMs: answerTimeoutMs, label: label)
        } catch let e as WearError {
            if e.code != .timeout { throw e }
            step(&trace, label, "no answer within \(answerTimeoutMs) ms", error: true)
            return nil
        }
        step(&trace, label, "answered\(codeText(response)) in \(elapsedMs(begun)) ms")
        return Receipt(code: response.tlv.flatMap { try? $0.int(0x7F) })
    }

    private func hex32(_ value: Int32) -> String { hex(UInt32(bitPattern: value), width: 8) }

    /// `0x%0Nx`.
    private func hex(_ value: UInt32, width: Int) -> String {
        let digits = String(value, radix: 16)
        return "0x" + String(repeating: "0", count: max(0, width - digits.count)) + digits
    }

    /// `Instant.toString()` for whole seconds.
    private func iso8601(_ epochSec: Int64) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: Date(timeIntervalSince1970: TimeInterval(epochSec)))
    }
}

/// Error codes of the weather feature (`WeatherErrorCodes` in WeatherController.kt) and what the watch is told for each.
public enum WeatherErrorCodes {
    public static func watchError(_ code: ErrorCode) -> Weather.ErrorCode? {
        switch code {
        case .weatherLocation: return .gpsPermissionError
        case .weatherNetwork: return .networkError
        case .weatherDisabled: return .weatherDisabled
        default: return nil
        }
    }
}
