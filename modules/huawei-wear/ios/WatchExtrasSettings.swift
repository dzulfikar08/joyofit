// Switches and small state of fall detection, the morning sleep report and the songs-on-the-watch lab. Port of the matching part of
// WatchExtrasSettings.kt: own keys in the shared `joyofit_settings` defaults suite (like `WeatherSettings`). The SOS relay switch is not
// stored: iOS apps cannot send SMS.
import Foundation

public final class WatchExtrasSettings: @unchecked Sendable {
    private static let suiteName = "joyofit_settings"
    private let defaults: UserDefaults

    private enum Key {
        static let fallSwitch = "extras_fall_switch"
        static let fallUpdated = "extras_fall_updated"
        static let sleepReport = "extras_sleep_report"
        static let sleepLastEnd = "extras_sleep_last_end"
        static let watchMusicLab = "extras_watch_music_lab"
    }

    public init(defaults: UserDefaults? = nil) {
        self.defaults = defaults ?? UserDefaults(suiteName: WatchExtrasSettings.suiteName) ?? .standard
    }

    /// The watch's fall detection switch as last seen: -1 unknown, 0 off, 1 on.
    public var fallSwitch: Int {
        get { defaults.object(forKey: Key.fallSwitch) == nil ? -1 : defaults.integer(forKey: Key.fallSwitch) }
        set { defaults.set(newValue, forKey: Key.fallSwitch) }
    }

    /// When `fallSwitch` was last set or reported, unix ms; 0 when never.
    public var fallUpdatedMs: Int64 {
        get { Int64(defaults.object(forKey: Key.fallUpdated) as? Int ?? 0) }
        set { defaults.set(Int(newValue), forKey: Key.fallUpdated) }
    }

    /// Push the morning sleep report to the watch. On by default.
    public var sleepReportEnabled: Bool {
        get { defaults.object(forKey: Key.sleepReport) == nil ? true : defaults.bool(forKey: Key.sleepReport) }
        set { defaults.set(newValue, forKey: Key.sleepReport) }
    }

    /// `end` (unix s) of the last sleep session a report was pushed for; 0 when none.
    public var sleepReportLastEnd: Int64 {
        get { Int64(defaults.object(forKey: Key.sleepLastEnd) as? Int ?? 0) }
        set { defaults.set(Int(newValue), forKey: Key.sleepLastEnd) }
    }

    /// Songs on the watch (`WatchMusicController`, docs/watch-music.md). Off: a lab test, unverified on any watch.
    public var watchMusicLab: Bool {
        get { defaults.bool(forKey: Key.watchMusicLab) }
        set { defaults.set(newValue, forKey: Key.watchMusicLab) }
    }
}
