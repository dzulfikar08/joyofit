// Port of OpenMeteo.kt: Open-Meteo (https://open-meteo.com, no API key), the forecast for a point and the geocoding that turns a city name into one.
// Requests use `timeformat=unixtime`, so every time in the reply is unix seconds and no date parsing is needed. Temperatures are Celsius and wind is
// km/h (both are the API defaults), the units GB's WeatherSpec carries.
//
// The HTTP GET is injected (`WeatherFetch`): URLSession on a phone, a canned reply in tests. The JSON is read by a small reader of this file so the
// numbers and nulls behave the same on every platform, and reproduce what org.json's `getInt` / `optDouble` / `isNull` do on Android.
import Foundation

/// GETs a URL and returns the body as text, or throws (a status outside 200..299 included).
public typealias WeatherFetch = @Sendable (String) async throws -> String

/// An answer that is not the expected JSON; reported like a network failure (Kotlin `OpenMeteo.BadResponseException`, an IOException).
public struct OpenMeteoBadResponse: Error, CustomStringConvertible, Sendable {
    public let message: String
    public init(_ message: String) { self.message = message }
    public var description: String { message }
}

public enum OpenMeteo {
    static let forecastBase = "https://api.open-meteo.com/v1/forecast"
    static let geocodingBase = "https://geocoding-api.open-meteo.com/v1/search"
    /// Today plus seven days: the watch takes up to eight day entries.
    static let forecastDays = 8

    public static func forecastURL(latitude: Double, longitude: Double) -> String {
        forecastBase
            + "?latitude=\(coordinate(latitude))&longitude=\(coordinate(longitude))"
            + "&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,uv_index"
            + "&hourly=temperature_2m,weather_code,precipitation_probability,uv_index"
            + "&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,moonrise,moonset"
            + "&timezone=auto&timeformat=unixtime&forecast_days=\(forecastDays)"
    }

    public static func geocodingURL(name: String, count: Int) -> String {
        "\(geocodingBase)?name=\(JavaNumbers.urlEncode(name))&count=\(count)&language=en&format=json"
    }

    /// Coarse on purpose: two decimals is about 1 km.
    static func coordinate(_ value: Double) -> String { JavaNumbers.twoDecimals(value) }

    public static func fetchForecast(place: WeatherPlace, nowSec: Int64, fetch: WeatherFetch) async throws -> WeatherReport {
        try parseForecast(try await fetch(forecastURL(latitude: place.latitude, longitude: place.longitude)), place: place, fetchedAtSec: nowSec)
    }

    public static func parseForecast(_ json: String, place: WeatherPlace, fetchedAtSec: Int64) throws -> WeatherReport {
        do {
            let root = try JSONReader.parseObject(json)
            if root.optBoolean("error") { throw OpenMeteoBadResponse("Open-Meteo: \(root.optString("reason") ?? "error")") }
            let current = try root.object("current")
            let hourly = try root.object("hourly")
            let daily = try root.object("daily")

            let hourTimes = try hourly.array("time")
            let hourTemps = try hourly.array("temperature_2m")
            let hourCodes = try hourly.array("weather_code")
            let hourPrecip = hourly.optArray("precipitation_probability")
            let hourUv = hourly.optArray("uv_index")
            var skippedHours = 0
            var hours: [WeatherHour] = []
            hours.reserveCapacity(hourTimes.count)
            for i in 0..<hourTimes.count {
                if hourTemps.isNull(i) || hourCodes.isNull(i) {
                    skippedHours += 1
                    continue
                }
                hours.append(
                    WeatherHour(
                        timestamp: try hourTimes.int(i),
                        code: try hourCodes.int(i),
                        tempC: try hourTemps.double(i),
                        precipProbability: try hourPrecip.roundedIntOrNil(i),
                        uvIndex: try hourUv.doubleOrNil(i)
                    )
                )
            }

            let dayTimes = try daily.array("time")
            let dayCodes = try daily.array("weather_code")
            let dayMax = try daily.array("temperature_2m_max")
            let dayMin = try daily.array("temperature_2m_min")
            let daySunrise = daily.optArray("sunrise")
            let daySunset = daily.optArray("sunset")
            let dayMoonrise = daily.optArray("moonrise")
            let dayMoonset = daily.optArray("moonset")
            var skippedDays = 0
            var days: [WeatherDay] = []
            days.reserveCapacity(dayTimes.count)
            for i in 0..<dayTimes.count {
                if dayCodes.isNull(i) || dayMax.isNull(i) || dayMin.isNull(i) {
                    skippedDays += 1
                    continue
                }
                days.append(
                    WeatherDay(
                        timestamp: try dayTimes.int(i),
                        code: try dayCodes.int(i),
                        maxC: try dayMax.double(i),
                        minC: try dayMin.double(i),
                        // Null at polar latitudes (no sunrise or sunset that day); the packet skips 0.
                        sunrise: try daySunrise.roundedIntOrNil(i) ?? 0,
                        sunset: try daySunset.roundedIntOrNil(i) ?? 0,
                        // Null on the day the moon does not rise (or set) between local midnights; the packet skips 0.
                        moonrise: try dayMoonrise.roundedIntOrNil(i) ?? 0,
                        moonset: try dayMoonset.roundedIntOrNil(i) ?? 0
                    )
                )
            }
            if days.isEmpty { throw OpenMeteoBadResponse("Open-Meteo returned no daily forecast") }

            let temperature = try current.double("temperature_2m")
            var uvIndex: Double?
            if !current.isNull("uv_index") { uvIndex = try current.double("uv_index") }
            return WeatherReport(
                fetchedAtSec: fetchedAtSec,
                observedAtSec: try current.int("time"),
                place: place,
                code: try current.int("weather_code"),
                tempC: temperature,
                feelsLikeC: current.optDouble("apparent_temperature") ?? temperature,
                humidity: Weather.javaRound(current.optDouble("relative_humidity_2m") ?? 0),
                windSpeedKmh: current.optDouble("wind_speed_10m") ?? 0,
                windDirection: Weather.javaRound(current.optDouble("wind_direction_10m") ?? 0),
                uvIndex: uvIndex,
                hourly: hours,
                daily: days,
                skippedHours: skippedHours,
                skippedDays: skippedDays
            )
        } catch let e as JSONReader.Failure {
            throw OpenMeteoBadResponse("Open-Meteo answered something unexpected: \(e.message)")
        }
    }

    /// Cities matching `query`. "Bandung, Indonesia" searches "Bandung" and keeps the results whose country, region or country code equals the text
    /// after the comma, as the API matches names only.
    public static func searchCity(_ query: String, fetch: WeatherFetch) async throws -> [WeatherPlace] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        var name = trimmed
        var qualifier = ""
        if let comma = trimmed.firstIndex(of: ",") {
            name = String(trimmed[..<comma]).trimmingCharacters(in: .whitespacesAndNewlines)
            qualifier = String(trimmed[trimmed.index(after: comma)...]).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if name.isEmpty { return [] }
        let found = try parseGeocoding(try await fetch(geocodingURL(name: name, count: qualifier.isEmpty ? 1 : 10)))
        return matchQualifier(found, qualifier: qualifier)
    }

    public static func matchQualifier(_ places: [WeatherPlace], qualifier: String) -> [WeatherPlace] {
        if qualifier.isEmpty { return places }
        return places.filter { place in
            place.detail?.components(separatedBy: ", ").contains { $0.caseInsensitiveCompare(qualifier) == .orderedSame } == true
        }
    }

    /// Each result's detail is "region, country, COUNTRY_CODE" (the parts that exist).
    public static func parseGeocoding(_ json: String) throws -> [WeatherPlace] {
        do {
            guard let results = try JSONReader.parseObject(json).optArray("results") else { return [] }
            var out: [WeatherPlace] = []
            out.reserveCapacity(results.count)
            for i in 0..<results.count {
                let item = try results.object(i)
                let parts = [item.optString("admin1") ?? "", item.optString("country") ?? "", item.optString("country_code") ?? ""]
                    .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
                out.append(
                    WeatherPlace(
                        name: try item.string("name"),
                        latitude: try item.double("latitude"),
                        longitude: try item.double("longitude"),
                        detail: parts.isEmpty ? nil : parts.joined(separator: ", ")
                    )
                )
            }
            return out
        } catch let e as JSONReader.Failure {
            throw OpenMeteoBadResponse("Open-Meteo geocoding answered something unexpected: \(e.message)")
        }
    }
}

// MARK: - JSON

/// A strict JSON reader plus the accessors of org.json that `OpenMeteo` uses (`getInt`, `getDouble`, `optDouble`, `isNull`, ...).
enum JSONReader {
    struct Failure: Error {
        let message: String
    }

    indirect enum Value {
        case null
        case bool(Bool)
        case number(Double)
        case string(String)
        case array([Value])
        case object([String: Value])
    }

    static func parseObject(_ text: String) throws -> Obj {
        var parser = Parser(bytes: Array(text.utf8))
        let value = try parser.parseDocument()
        guard case .object(let fields) = value else { throw Failure(message: "the answer is not a JSON object") }
        return Obj(fields)
    }

    struct Obj {
        let fields: [String: Value]
        init(_ fields: [String: Value]) { self.fields = fields }

        func isNull(_ key: String) -> Bool {
            guard let value = fields[key] else { return true }
            if case .null = value { return true }
            return false
        }

        func object(_ key: String) throws -> Obj {
            guard case .object(let o)? = fields[key] else { throw Failure(message: "\(key) is not an object") }
            return Obj(o)
        }

        func array(_ key: String) throws -> Arr {
            guard case .array(let a)? = fields[key] else { throw Failure(message: "\(key) is not an array") }
            return Arr(a)
        }

        func optArray(_ key: String) -> Arr? {
            if case .array(let a)? = fields[key] { return Arr(a) }
            return nil
        }

        func double(_ key: String) throws -> Double {
            guard let value = fields[key], let d = JSONReader.double(value) else { throw Failure(message: "\(key) is not a number") }
            return d
        }

        func int(_ key: String) throws -> Int32 {
            guard let value = fields[key], let i = JSONReader.int(value) else { throw Failure(message: "\(key) is not an integer") }
            return i
        }

        func string(_ key: String) throws -> String {
            guard let value = fields[key], let s = JSONReader.string(value) else { throw Failure(message: "\(key) is not a string") }
            return s
        }

        /// org.json `optDouble`: a number or a numeric string, else nil (the caller's default).
        func optDouble(_ key: String) -> Double? { fields[key].flatMap { JSONReader.double($0) } }

        /// `optString` without a default: nil for a missing key or a null.
        func optString(_ key: String) -> String? {
            guard let value = fields[key] else { return nil }
            if case .null = value { return nil }
            return JSONReader.string(value) ?? ""
        }

        /// `optBoolean`: a boolean, or the strings "true" / "false".
        func optBoolean(_ key: String) -> Bool {
            switch fields[key] {
            case .bool(let b)?: return b
            case .string(let s)?: return s.lowercased() == "true"
            default: return false
            }
        }
    }

    struct Arr {
        let items: [Value]
        init(_ items: [Value]) { self.items = items }
        var count: Int { items.count }

        /// `isNull(i)`: true past the end as well, like `JSONArray.isNull`.
        func isNull(_ index: Int) -> Bool {
            guard index >= 0, index < items.count else { return true }
            if case .null = items[index] { return true }
            return false
        }

        func int(_ index: Int) throws -> Int32 {
            guard index >= 0, index < items.count, let i = JSONReader.int(items[index]) else { throw Failure(message: "value \(index) is not an integer") }
            return i
        }

        func double(_ index: Int) throws -> Double {
            guard index >= 0, index < items.count, let d = JSONReader.double(items[index]) else { throw Failure(message: "value \(index) is not a number") }
            return d
        }

        func object(_ index: Int) throws -> Obj {
            guard index >= 0, index < items.count, case .object(let o) = items[index] else { throw Failure(message: "value \(index) is not an object") }
            return Obj(o)
        }
    }

    /// org.json coercions: a number is itself, a string is parsed.
    static func double(_ value: Value) -> Double? {
        switch value {
        case .number(let d): return d
        case .string(let s): return Double(s.trimmingCharacters(in: .whitespaces))
        default: return nil
        }
    }

    /// `intValue` of the number: truncates toward zero and saturates.
    static func int(_ value: Value) -> Int32? {
        guard let d = double(value) else { return nil }
        if d.isNaN { return 0 }
        if d >= Double(Int32.max) { return Int32.max }
        if d <= Double(Int32.min) { return Int32.min }
        return Int32(d)
    }

    static func string(_ value: Value) -> String? {
        switch value {
        case .string(let s): return s
        case .number(let d): return d == d.rounded() && abs(d) < 1e15 ? String(Int64(d)) : "\(d)"
        case .bool(let b): return b ? "true" : "false"
        default: return nil
        }
    }

    // MARK: parser

    struct Parser {
        let bytes: [UInt8]
        var position = 0

        init(bytes: [UInt8]) { self.bytes = bytes }

        mutating func parseDocument() throws -> Value {
            skipSpace()
            let value = try parseValue()
            skipSpace()
            if position != bytes.count { throw Failure(message: "unexpected text after the JSON value") }
            return value
        }

        private mutating func skipSpace() {
            while position < bytes.count, [0x20, 0x09, 0x0A, 0x0D].contains(bytes[position]) { position += 1 }
        }

        private mutating func parseValue() throws -> Value {
            guard position < bytes.count else { throw Failure(message: "the JSON ends too early") }
            switch bytes[position] {
            case UInt8(ascii: "{"): return try parseObject()
            case UInt8(ascii: "["): return try parseArray()
            case UInt8(ascii: "\""): return .string(try parseString())
            case UInt8(ascii: "t"): try expect("true"); return .bool(true)
            case UInt8(ascii: "f"): try expect("false"); return .bool(false)
            case UInt8(ascii: "n"): try expect("null"); return .null
            default: return try parseNumber()
            }
        }

        private mutating func expect(_ word: String) throws {
            let w = Array(word.utf8)
            guard position + w.count <= bytes.count, Array(bytes[position..<position + w.count]) == w else {
                throw Failure(message: "invalid JSON literal at \(position)")
            }
            position += w.count
        }

        private mutating func parseNumber() throws -> Value {
            let start = position
            while position < bytes.count, "+-0123456789.eE".utf8.contains(bytes[position]) { position += 1 }
            guard position > start, let d = Double(String(decoding: bytes[start..<position], as: UTF8.self)), d.isFinite else {
                throw Failure(message: "invalid JSON number at \(start)")
            }
            return .number(d)
        }

        private mutating func parseString() throws -> String {
            position += 1 // opening quote
            var out = [UInt8]()
            while true {
                guard position < bytes.count else { throw Failure(message: "unterminated JSON string") }
                let b = bytes[position]
                position += 1
                if b == UInt8(ascii: "\"") { break }
                if b != UInt8(ascii: "\\") {
                    out.append(b)
                    continue
                }
                guard position < bytes.count else { throw Failure(message: "unterminated JSON string") }
                let escape = bytes[position]
                position += 1
                switch escape {
                case UInt8(ascii: "\""), UInt8(ascii: "\\"), UInt8(ascii: "/"): out.append(escape)
                case UInt8(ascii: "b"): out.append(0x08)
                case UInt8(ascii: "f"): out.append(0x0C)
                case UInt8(ascii: "n"): out.append(0x0A)
                case UInt8(ascii: "r"): out.append(0x0D)
                case UInt8(ascii: "t"): out.append(0x09)
                case UInt8(ascii: "u"):
                    var unit = try hex4()
                    if (0xD800..<0xDC00).contains(unit), position + 1 < bytes.count, bytes[position] == UInt8(ascii: "\\"), bytes[position + 1] == UInt8(ascii: "u") {
                        position += 2
                        let low = try hex4()
                        if (0xDC00..<0xE000).contains(low) {
                            unit = 0x10000 + ((unit - 0xD800) << 10) + (low - 0xDC00)
                        } else {
                            throw Failure(message: "invalid surrogate pair in a JSON string")
                        }
                    }
                    guard let scalar = UnicodeScalar(unit) else { throw Failure(message: "invalid unicode escape in a JSON string") }
                    out.append(contentsOf: Array(String(Character(scalar)).utf8))
                default: throw Failure(message: "invalid escape in a JSON string")
                }
            }
            return String(decoding: out, as: UTF8.self)
        }

        private mutating func hex4() throws -> UInt32 {
            guard position + 4 <= bytes.count, let v = UInt32(String(decoding: bytes[position..<position + 4], as: UTF8.self), radix: 16) else {
                throw Failure(message: "invalid unicode escape in a JSON string")
            }
            position += 4
            return v
        }

        private mutating func parseArray() throws -> Value {
            position += 1
            var items: [Value] = []
            skipSpace()
            if position < bytes.count, bytes[position] == UInt8(ascii: "]") {
                position += 1
                return .array(items)
            }
            while true {
                skipSpace()
                items.append(try parseValue())
                skipSpace()
                guard position < bytes.count else { throw Failure(message: "unterminated JSON array") }
                if bytes[position] == UInt8(ascii: ",") {
                    position += 1
                } else if bytes[position] == UInt8(ascii: "]") {
                    position += 1
                    return .array(items)
                } else {
                    throw Failure(message: "expected , or ] at \(position)")
                }
            }
        }

        private mutating func parseObject() throws -> Value {
            position += 1
            var fields: [String: Value] = [:]
            skipSpace()
            if position < bytes.count, bytes[position] == UInt8(ascii: "}") {
                position += 1
                return .object(fields)
            }
            while true {
                skipSpace()
                guard position < bytes.count, bytes[position] == UInt8(ascii: "\"") else { throw Failure(message: "expected a key at \(position)") }
                let key = try parseString()
                skipSpace()
                guard position < bytes.count, bytes[position] == UInt8(ascii: ":") else { throw Failure(message: "expected : at \(position)") }
                position += 1
                skipSpace()
                fields[key] = try parseValue()
                skipSpace()
                guard position < bytes.count else { throw Failure(message: "unterminated JSON object") }
                if bytes[position] == UInt8(ascii: ",") {
                    position += 1
                } else if bytes[position] == UInt8(ascii: "}") {
                    position += 1
                    return .object(fields)
                } else {
                    throw Failure(message: "expected , or } at \(position)")
                }
            }
        }
    }
}

extension Optional where Wrapped == JSONReader.Arr {
    /// Kotlin `JSONArray?.intOrNull`: nil for a missing array, an index past the end or a null; else the rounded number.
    func roundedIntOrNil(_ index: Int) throws -> Int32? {
        guard let array = self, !array.isNull(index) else { return nil }
        return Weather.javaRound(try array.double(index))
    }

    func doubleOrNil(_ index: Int) throws -> Double? {
        guard let array = self, !array.isNull(index) else { return nil }
        return try array.double(index)
    }
}
