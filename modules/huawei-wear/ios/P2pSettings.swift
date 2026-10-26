// Switches and bookkeeping of the P2P (service 0x34) features: Healthy Living replies and the experimental running-course push. Port of
// P2pSettings.kt (Android: SharedPreferences file `joyofit_p2p`); here a UserDefaults suite of the same name. Foundation only.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

public final class P2pSettings: HealthLivingState, @unchecked Sendable {
    private static let suiteName = "joyofit_p2p"
    private let defaults: UserDefaults

    private enum Key {
        static let healthLiving = "health_living"
        static let version = "hl_ver"
        static let packageSize = "hl_package"
        static let request = "hl_request_ms"
        static let report = "hl_report_ms"
        static let summary = "hl_summary"
        static let courses = "courses_experimental"
        static let offlineMapLab = "offline_map_lab"
    }

    public init(defaults: UserDefaults? = nil) {
        self.defaults = defaults ?? UserDefaults(suiteName: P2pSettings.suiteName) ?? .standard
    }

    /// Answer the watch's Healthy Living requests and push the day when data changes. On by default: the watch only asks when the user opens the app.
    public var healthLivingEnabled: Bool {
        get { defaults.object(forKey: Key.healthLiving) == nil ? true : defaults.bool(forKey: Key.healthLiving) }
        set { defaults.set(newValue, forKey: Key.healthLiving) }
    }

    /// The watch asked at least once, with this `msgVer` (0 = never); Huawei Health only pushes unasked after a request.
    public var healthLivingMsgVer: Float {
        get { defaults.float(forKey: Key.version) }
        set { defaults.set(newValue, forKey: Key.version) }
    }

    public var healthLivingPackageSize: Int {
        get { defaults.integer(forKey: Key.packageSize) }
        set { defaults.set(newValue, forKey: Key.packageSize) }
    }

    public var healthLivingLastRequestMs: Int64 {
        get { Int64(defaults.double(forKey: Key.request)) }
        set { defaults.set(Double(newValue), forKey: Key.request) }
    }

    public var healthLivingLastReportMs: Int64 {
        get { Int64(defaults.double(forKey: Key.report)) }
        set { defaults.set(Double(newValue), forKey: Key.report) }
    }

    public var healthLivingLastSummary: String? {
        get { defaults.string(forKey: Key.summary) }
        set {
            if let newValue { defaults.set(newValue, forKey: Key.summary) } else { defaults.removeObject(forKey: Key.summary) }
        }
    }

    /// The running-course editor and push (service `fitness`). Off: the static analysis behind it is not complete, see protocol/README.md.
    public var experimentalCourses: Bool {
        get { defaults.bool(forKey: Key.courses) }
        set { defaults.set(newValue, forKey: Key.courses) }
    }

    /// The offline-map lab (P2P module `mapkit`, docs/offline-maps.md). Off: the module is not registered and every map call refuses.
    public var offlineMapLab: Bool {
        get { defaults.bool(forKey: Key.offlineMapLab) }
        set { defaults.set(newValue, forKey: Key.offlineMapLab) }
    }
}
