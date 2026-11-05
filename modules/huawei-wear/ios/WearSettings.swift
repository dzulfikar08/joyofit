// Everything the user configures that must survive without JS running: the remembered watch, background mode and its sync interval,
// and the profile/goal. Port of WearSettings.kt; UserDefaults (suite `joyofit_settings`) replaces the private SharedPreferences file.
// Pure logic (Foundation only), so the logic tests run it on Linux.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

public final class WearSettings: @unchecked Sendable {
    public static let defaultSyncIntervalMin = 30
    public static let minSyncIntervalMin = 5
    public static let maxSyncIntervalMin = 1440

    private static let suiteName = "joyofit_settings"
    private let defaults: UserDefaults

    private enum Key {
        static let address = "watch_address"
        static let name = "watch_name"
        static let background = "background_enabled"
        static let interval = "sync_interval_min"
        static let profileHeight = "profile_height_cm"
        static let profileWeight = "profile_weight_kg"
        static let profileBirthYear = "profile_birth_year"
        static let profileSex = "profile_sex"
        static let profileGoal = "profile_step_goal"
        static let alarmsJson = "alarms_json"
        static let autoHeartRate = "auto_heart_rate"
        static let autoSpo2 = "auto_spo2"
        static let truSleep = "trusleep"
        static let highHrAlert = "high_hr_alert"
        static let lowHrAlert = "low_hr_alert"
        static let stressEnabled = "stress_enabled"
        static let watchLanguage = "watch_language"
        static let huaweiAccount = "huawei_account_id"
        static let zonesMethod = "hr_zones_method"
        static let zonesMaxHr = "hr_zones_max"
        static let zonesRestingHr = "hr_zones_rest"
        static let zonesLimits = "hr_zones_limits"
        static let zonesWarning = "hr_zones_warning"
        static let zonesWarningLimit = "hr_zones_warning_limit"
        static let stressCalibration = "stress_calibration"
        static let autoStressListed = "stress_auto_listed"
    }

    public init(defaults: UserDefaults? = nil) {
        self.defaults = defaults ?? UserDefaults(suiteName: WearSettings.suiteName) ?? .standard
    }

    /// The watch last connected from the app or enabled for background: the CoreBluetooth peripheral identifier (upper case UUID string),
    /// the iOS counterpart of Android's upper case MAC.
    public var watchAddress: String? {
        get { defaults.string(forKey: Key.address) }
        set { set(newValue, forKey: Key.address) }
    }

    /// The Bluetooth name the watch advertised (`HUAWEI WATCH FIT 4 Pro-40A`); the scan matches it by stem when the identifier is unknown.
    public var watchName: String? {
        get { defaults.string(forKey: Key.name) }
        set { set(newValue, forKey: Key.name) }
    }

    public var backgroundEnabled: Bool {
        get { defaults.bool(forKey: Key.background) }
        set { defaults.set(newValue, forKey: Key.background) }
    }

    public var syncIntervalMinutes: Int {
        get { defaults.object(forKey: Key.interval) == nil ? WearSettings.defaultSyncIntervalMin : defaults.integer(forKey: Key.interval) }
        set { defaults.set(newValue, forKey: Key.interval) }
    }

    /// The user's Huawei account id (17-18 digit `userId`), sent to the watch in 1A/05 so a watch set up under that account keeps its
    /// data instead of asking for a factory reset (Gadgetbridge PREF_HUAWEI_ACCOUNT). nil/blank sends the empty default. Only an
    /// account id: no signature or token.
    public var huaweiAccount: String? {
        get {
            let value = defaults.string(forKey: Key.huaweiAccount)?.trimmingCharacters(in: .whitespacesAndNewlines)
            return (value?.isEmpty ?? true) ? nil : value
        }
        set { set(newValue?.trimmingCharacters(in: .whitespacesAndNewlines), forKey: Key.huaweiAccount) }
    }

    /// Profile and goal as the JS Settings screen stores them; nil until the user saves one.
    public var profile: UserProfileData? {
        get {
            guard defaults.object(forKey: Key.profileHeight) != nil else { return nil }
            return UserProfileData(
                heightCm: defaults.integer(forKey: Key.profileHeight),
                weightKg: defaults.double(forKey: Key.profileWeight),
                birthYear: defaults.integer(forKey: Key.profileBirthYear),
                sex: defaults.string(forKey: Key.profileSex) ?? "unknown",
                dailyStepGoal: defaults.integer(forKey: Key.profileGoal)
            )
        }
        set {
            if let p = newValue {
                defaults.set(p.heightCm, forKey: Key.profileHeight)
                defaults.set(p.weightKg, forKey: Key.profileWeight)
                defaults.set(p.birthYear, forKey: Key.profileBirthYear)
                defaults.set(p.sex, forKey: Key.profileSex)
                defaults.set(p.dailyStepGoal, forKey: Key.profileGoal)
            } else {
                for key in [Key.profileHeight, Key.profileWeight, Key.profileBirthYear, Key.profileSex, Key.profileGoal] {
                    defaults.removeObject(forKey: key)
                }
            }
        }
    }

    /// The alarms last read from or pushed to the watch as `WatchAlarms.toJson` (Android `alarmsJson`); nil before the first exchange.
    public var alarmsJson: String? {
        get { defaults.string(forKey: Key.alarmsJson) }
        set { set(newValue, forKey: Key.alarmsJson) }
    }

    /// The watch-side health sensor switches (see `HealthSensorConfig`); defaults match Huawei Health.
    public var healthSensors: HealthSensorConfig {
        get {
            HealthSensorConfig(
                automaticHeartRate: defaults.object(forKey: Key.autoHeartRate) == nil ? true : defaults.bool(forKey: Key.autoHeartRate),
                automaticSpo2: defaults.object(forKey: Key.autoSpo2) == nil ? true : defaults.bool(forKey: Key.autoSpo2),
                truSleep: defaults.object(forKey: Key.truSleep) == nil ? true : defaults.bool(forKey: Key.truSleep),
                highHeartRateAlert: defaults.integer(forKey: Key.highHrAlert),
                lowHeartRateAlert: defaults.integer(forKey: Key.lowHrAlert)
            )
        }
        set {
            defaults.set(newValue.automaticHeartRate, forKey: Key.autoHeartRate)
            defaults.set(newValue.automaticSpo2, forKey: Key.autoSpo2)
            defaults.set(newValue.truSleep, forKey: Key.truSleep)
            defaults.set(newValue.highHeartRateAlert, forKey: Key.highHrAlert)
            defaults.set(newValue.lowHeartRateAlert, forKey: Key.lowHrAlert)
        }
    }

    /// The language JoyoFit's "Bahasa" setting pinned (`id`, `en`), sent to the watch as its language; nil follows the phone.
    public var watchLanguage: String? {
        get { defaults.string(forKey: Key.watchLanguage) }
        set { set(newValue, forKey: Key.watchLanguage) }
    }

    /// The heart-rate zones the user configured (`setHeartRateZones`), sent at every connect; nil sends GB's defaults for the profile age.
    public var heartRateZones: HeartRateZonesCalc.UserZones? {
        get {
            guard let method = defaults.string(forKey: Key.zonesMethod), method == "max" || method == "hrr",
                let limits = defaults.array(forKey: Key.zonesLimits) as? [Int], defaults.object(forKey: Key.zonesMaxHr) != nil,
                defaults.object(forKey: Key.zonesRestingHr) != nil, defaults.object(forKey: Key.zonesWarningLimit) != nil
            else { return nil }
            return HeartRateZonesCalc.UserZones(
                method: method == "hrr" ? .hrr : .mhr, maxHr: defaults.integer(forKey: Key.zonesMaxHr), restingHr: defaults.integer(forKey: Key.zonesRestingHr),
                zones: limits, warningEnabled: defaults.bool(forKey: Key.zonesWarning), warningLimit: defaults.integer(forKey: Key.zonesWarningLimit)
            )
        }
        set {
            guard let zones = newValue else {
                for key in [Key.zonesMethod, Key.zonesMaxHr, Key.zonesRestingHr, Key.zonesLimits, Key.zonesWarning, Key.zonesWarningLimit] {
                    defaults.removeObject(forKey: key)
                }
                return
            }
            defaults.set(zones.method == .hrr ? "hrr" : "max", forKey: Key.zonesMethod)
            defaults.set(zones.maxHr, forKey: Key.zonesMaxHr)
            defaults.set(zones.restingHr, forKey: Key.zonesRestingHr)
            defaults.set(zones.zones, forKey: Key.zonesLimits)
            defaults.set(zones.warningEnabled, forKey: Key.zonesWarning)
            defaults.set(zones.warningLimit, forKey: Key.zonesWarningLimit)
        }
    }

    /// The watch's automatic stress switch as the user last set it here (GB PREF_HUAWEI_STRESS_SWITCH).
    public var stressEnabled: Bool {
        get { defaults.bool(forKey: Key.stressEnabled) }
        set { defaults.set(newValue, forKey: Key.stressEnabled) }
    }

    /// The last stress calibration as `StressData.toJsonString` (GB PREF_HUAWEI_STRESS_LAST_DATA), so it can be sent again on reconnect.
    public var stressCalibration: String? {
        get { defaults.string(forKey: Key.stressCalibration) }
        set { set(newValue, forKey: Key.stressCalibration) }
    }

    /// Whether the watch listed the automatic stress command (20/09) the last time it connected; nil before any connect. The live answer only
    /// exists while connected, and the app has to tell a watch that cannot record night HRV from one that is just away
    /// (`StressStatus.knownSupported`).
    public var autoStressListed: Bool? {
        get { defaults.object(forKey: Key.autoStressListed) == nil ? nil : defaults.bool(forKey: Key.autoStressListed) }
        set {
            if let newValue { defaults.set(newValue, forKey: Key.autoStressListed) } else { defaults.removeObject(forKey: Key.autoStressListed) }
        }
    }

    // MARK: Backfill after a switch (docs/multi-watch.md, section 7; port of SwitchBackfill.kt)

    private static let backfillKeyPrefix = "backfill_after_switch_"

    private func backfillKey(_ address: String) -> String {
        WearSettings.backfillKeyPrefix + address.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    }

    /// A connect to `address` that made it the remembered watch: a switch when `previous`, the watch remembered until now, is another one. A
    /// switch marks `address`: its next activity sync pulls everything the watch holds, whatever its own `device.last_sync` says.
    public func noteConnect(previous: String?, address: String) {
        guard let previous, previous.caseInsensitiveCompare(address) != .orderedSame else { return }
        defaults.set(true, forKey: backfillKey(address))
    }

    public func switchBackfillPending(_ address: String) -> Bool {
        defaults.bool(forKey: backfillKey(address))
    }

    /// The steps and sleep of `address` were pulled from the beginning (or the watch was forgotten).
    public func switchBackfillDone(_ address: String) {
        defaults.removeObject(forKey: backfillKey(address))
    }

    private func set(_ value: String?, forKey key: String) {
        if let value { defaults.set(value, forKey: key) } else { defaults.removeObject(forKey: key) }
    }
}

extension UserProfileData {
    /// `UserProfile` in HuaweiWear.types.ts.
    public func toJS() -> [String: Any] {
        [
            "heightCm": heightCm,
            "weightKg": weightKg,
            "birthYear": birthYear,
            "sex": sex,
            "dailyStepGoal": dailyStepGoal,
        ]
    }

    /// `WearRuntime.validate(UserProfileData)`: the ranges the Settings screen enforces. `thisYear` is injected for tests.
    public func validationError(thisYear: Int) -> String? {
        if !(100...250).contains(heightCm) { return "Height must be 100 to 250 cm" }
        if !(weightKg >= 20.0 && weightKg <= 300.0) { return "Weight must be 20 to 300 kg" }
        if !(1900...thisYear).contains(birthYear) { return "Birth year must be 1900 to \(thisYear)" }
        if sex != "male" && sex != "female" && sex != "unknown" { return "Sex must be male, female or unknown" }
        if !(1000...100_000).contains(dailyStepGoal) { return "Step goal must be 1000 to 100000" }
        return nil
    }
}
