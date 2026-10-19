// Port of WeatherModel.kt and the value types of WeatherSettings.kt (derived from Gadgetbridge's HuaweiWeatherManager.openWeatherMapConditionCodeToHuaweiIcon
// and WeatherSpec.toBeaufort): what Open-Meteo returned, the WMO code to Huawei icon table, Beaufort and the moon phase.
import Foundation

/// Wire names match `TemperatureUnit` in HuaweiWear.types.ts.
public enum TemperatureUnit: String, Sendable {
    case celsius
    case fahrenheit

    public init?(wire: String) { self.init(rawValue: wire) }
    public var wire: String { rawValue }
    var format: Weather.TemperatureFormat { self == .fahrenheit ? .fahrenheit : .celsius }
}

/// Wire names match `WeatherLocationMode` in HuaweiWear.types.ts.
public enum WeatherLocationMode: String, Sendable {
    /// The phone's coarse location.
    case current
    /// The city the user searched for (Open-Meteo geocoding).
    case city

    public init?(wire: String) { self.init(rawValue: wire) }
    public var wire: String { rawValue }
}

/// A named point on Earth: a geocoded city, or the last position the phone reported.
public struct WeatherPlace: Equatable, Sendable {
    /// Shown on the watch; nil when a current position could not be named.
    public var name: String?
    public var latitude: Double
    public var longitude: Double
    /// Region and country of a geocoded city, e.g. "West Java, Indonesia".
    public var detail: String?

    public init(name: String?, latitude: Double, longitude: Double, detail: String? = nil) {
        self.name = name
        self.latitude = latitude
        self.longitude = longitude
        self.detail = detail
    }

    /// `WeatherPlace` in HuaweiWear.types.ts.
    public func toJS() -> [String: Any] {
        ["name": name ?? NSNull(), "latitude": latitude, "longitude": longitude, "detail": detail ?? NSNull()]
    }
}

/// One forecast hour. Temperatures are degrees Celsius; `code` is a WMO weather code.
public struct WeatherHour: Equatable, Sendable {
    public var timestamp: Int32
    public var code: Int32
    public var tempC: Double
    /// Percent, nil when the model gives none.
    public var precipProbability: Int32?
    public var uvIndex: Double?

    public init(timestamp: Int32, code: Int32, tempC: Double, precipProbability: Int32?, uvIndex: Double?) {
        self.timestamp = timestamp
        self.code = code
        self.tempC = tempC
        self.precipProbability = precipProbability
        self.uvIndex = uvIndex
    }
}

/// One forecast day. Sun and moon times are unix seconds, 0 when the body does not rise or set that day (polar sun, or the day the moon skips its
/// rise or set).
public struct WeatherDay: Equatable, Sendable {
    /// Local midnight at the place, unix seconds.
    public var timestamp: Int32
    public var code: Int32
    public var maxC: Double
    public var minC: Double
    public var sunrise: Int32
    public var sunset: Int32
    public var moonrise: Int32
    public var moonset: Int32

    public init(timestamp: Int32, code: Int32, maxC: Double, minC: Double, sunrise: Int32, sunset: Int32, moonrise: Int32 = 0, moonset: Int32 = 0) {
        self.timestamp = timestamp
        self.code = code
        self.maxC = maxC
        self.minC = minC
        self.sunrise = sunrise
        self.sunset = sunset
        self.moonrise = moonrise
        self.moonset = moonset
    }
}

/// What Open-Meteo returned, in the units GB's WeatherSpec uses (km/h, degrees Celsius, unix seconds).
public struct WeatherReport: Equatable, Sendable {
    public var fetchedAtSec: Int64
    public var observedAtSec: Int32
    public var place: WeatherPlace
    /// WMO weather code of the current conditions.
    public var code: Int32
    public var tempC: Double
    public var feelsLikeC: Double
    public var humidity: Int32
    public var windSpeedKmh: Double
    public var windDirection: Int32
    public var uvIndex: Double?
    public var hourly: [WeatherHour]
    /// Today first.
    public var daily: [WeatherDay]
    /// Rows Open-Meteo listed but without a temperature or weather code, left out of `hourly`; the watch wants whole lists.
    public var skippedHours: Int
    /// Same for `daily`.
    public var skippedDays: Int

    public init(
        fetchedAtSec: Int64, observedAtSec: Int32, place: WeatherPlace, code: Int32, tempC: Double, feelsLikeC: Double, humidity: Int32,
        windSpeedKmh: Double, windDirection: Int32, uvIndex: Double?, hourly: [WeatherHour], daily: [WeatherDay], skippedHours: Int = 0, skippedDays: Int = 0
    ) {
        self.fetchedAtSec = fetchedAtSec
        self.observedAtSec = observedAtSec
        self.place = place
        self.code = code
        self.tempC = tempC
        self.feelsLikeC = feelsLikeC
        self.humidity = humidity
        self.windSpeedKmh = windSpeedKmh
        self.windDirection = windDirection
        self.uvIndex = uvIndex
        self.hourly = hourly
        self.daily = daily
        self.skippedHours = skippedHours
        self.skippedDays = skippedDays
    }
}

/// WMO weather interpretation code (Open-Meteo `weather_code`) to the Huawei icon.
///
/// GB has no WMO mapping, but it maps OpenWeatherMap condition codes to Huawei icons (`openWeatherMapToHuaweiIcon`, a verbatim port). So a WMO code
/// is first mapped to the closest OpenWeatherMap code, then through GB's table. Any other code becomes UNKNOWN (0x63), as GB does for an unmapped
/// condition. The Huawei enum has no separate night icons; the watch picks them from the sun times it is sent.
public enum WeatherIcons {
    public static func wmoToOpenWeatherMap(_ wmo: Int32) -> Int32 {
        switch wmo {
        case 0: return 800
        case 1: return 801
        case 2: return 802
        case 3: return 804
        case 45, 48: return 741
        case 51: return 300
        case 53: return 301
        case 55: return 302
        case 56, 57, 66, 67: return 511
        case 61, 80: return 500
        case 63, 81: return 501
        case 65, 82: return 502
        case 71, 77, 85: return 600
        case 73: return 601
        case 75, 86: return 602
        case 95: return 211
        case 96, 99: return 212
        default: return -1
        }
    }

    public static func forWmo(_ wmo: Int32) -> Weather.Icon { openWeatherMapToHuaweiIcon(wmoToOpenWeatherMap(wmo)) }

    /// HuaweiWeatherManager.openWeatherMapConditionCodeToHuaweiIcon, unchanged.
    public static func openWeatherMapToHuaweiIcon(_ conditionCode: Int32) -> Weather.Icon {
        // More exact first, groups after
        switch conditionCode {
        case 500: return .lightRain
        case 501: return .rain
        case 502: return .heavyRain
        case 503: return .rainStorm
        case 504: return .severeRainStorms
        case 511: return .freezingRain
        case 600: return .lightSnow
        case 601: return .snow
        case 602: return .heavySnow
        case 611: return .sleet
        case 701, 741: return .fog
        case 721: return .hazy
        case 751: return .sand
        case 761: return .dust
        case 800: return .sunny
        case 801, 802: return .cloudy
        case 803, 804: return .overcast
        default: break
        }
        if (200...299).contains(conditionCode) { return .thunderstorms }
        if (300...399).contains(conditionCode) { return .lightRain }
        if (500...599).contains(conditionCode) { return .rain }
        if (600...699).contains(conditionCode) { return .snow }
        return .unknown
    }
}

/// GB `WeatherSpec.toBeaufort`: lower bounds of Beaufort 1 to 12 in km/h.
public enum Beaufort {
    private static let lowerBounds: [Float] = [2, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118]

    public static func fromKmh(_ speed: Double) -> Int {
        var level = 0
        while level < lowerBounds.count && Double(lowerBounds[level]) < speed { level += 1 }
        return level
    }
}

/// The moon phase is computed from the mean synodic month (not fetched; moon rise and set are). Accurate to about a day, which is what the watch's
/// eight-step phase icon needs. 0 is new moon, 180 full moon.
public enum Moon {
    private static let synodicDays = 29.530588853
    /// Julian date of a known new moon (2000-01-06 18:14 UTC).
    private static let newMoonJD = 2451550.26

    public static func phaseDegrees(_ epochSec: Int64) -> Int {
        let julianDate = Double(epochSec) / 86400.0 + 2440587.5
        var cycles = (julianDate - newMoonJD) / synodicDays
        cycles -= cycles.rounded(.down)
        return Int(Weather.javaRound(cycles * 360.0)) % 360
    }
}
