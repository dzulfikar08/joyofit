// Port of AgpsStore.kt: what the satellite-data job remembers between runs: the newest download on the phone, the last delivery to the watch,
// what the watch last asked for, and the retry state. Own UserDefaults suite; nothing here is personal data (only tag names, never the paths
// and URLs the watch names, which can carry a rough position).
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

public final class AgpsStore: @unchecked Sendable {
    private static let suiteName = "joyofit_agps"
    private let defaults: UserDefaults
    /// The multi-key records below are written together.
    private let lock = NSLock()

    private enum Key {
        static let cachedAt = "cached_at"
        static let cachedData = "cached_data"
        static let cachedSize = "cached_size"
        static let cachedSource = "cached_source"
        static let deliveredAt = "delivered_at"
        static let deliveredData = "delivered_data"
        static let deliveredSize = "delivered_size"
        static let deliveredSource = "delivered_source"
        static let deliveredAddress = "delivered_address"
        static let askAt = "ask_at"
        static let askVersion = "ask_version"
        static let askTags = "ask_tags"
        static let outcome = "outcome"
        static let error = "error"
        static let attemptAt = "attempt_at"
        static let failures = "failures"
        static let failureAt = "failure_at"
        static let labAgnss = "lab_agnss"
    }

    private static let maxTagsChars = 120
    private static let maxErrorChars = 200

    public init(defaults: UserDefaults? = nil) {
        self.defaults = defaults ?? UserDefaults(suiteName: AgpsStore.suiteName) ?? .standard
    }

    private func int(_ key: String, _ fallback: Int = 0) -> Int { defaults.object(forKey: key) == nil ? fallback : defaults.integer(forKey: key) }
    private func string(_ key: String, _ fallback: String = "") -> String { defaults.string(forKey: key) ?? fallback }

    /// When the newest download finished (phone clock, ms); 0 when none.
    public var cachedAtMs: Int { int(Key.cachedAt) }

    /// The age of that data itself (the server's Last-Modified, else the download time).
    public var cachedDataMs: Int { int(Key.cachedData) }
    public var cachedSize: Int { int(Key.cachedSize) }
    public var cachedSource: String { string(Key.cachedSource) }

    public var deliveredAtMs: Int { int(Key.deliveredAt) }
    public var deliveredDataMs: Int { int(Key.deliveredData) }
    public var deliveredSize: Int { int(Key.deliveredSize) }
    public var deliveredSource: String { string(Key.deliveredSource) }

    /// The watch (its address) the last delivery went to; the screen shows a delivery only for the watch it is looking at.
    public var deliveredAddress: String { string(Key.deliveredAddress) }

    public var lastAskMs: Int { int(Key.askAt) }

    /// The download version the watch named in its last consult; -1 when it never asked.
    public var lastAskVersion: Int { int(Key.askVersion, -1) }

    /// Tag names of that consult (the last `/` segment of each entry), joined by `,`.
    public var lastAskTags: String { string(Key.askTags) }

    public var lastOutcome: String { string(Key.outcome, AgpsOutcome.none) }
    public var lastError: String { string(Key.error) }
    public var lastAttemptMs: Int { int(Key.attemptAt) }

    /// Failed downloads in a row, and when the last one happened.
    public var failures: Int { int(Key.failures) }
    public var lastFailureMs: Int { int(Key.failureAt) }

    public func retryAtMs() -> Int { AgpsPolicy.retryAtMs(lastFailureMs: lastFailureMs, failures: failures) }

    /// The experimental switch (`AgpsLab`): serve JoyoFit's HW_AGNSS file to a watch that asks for exactly that kind. Off by default.
    public var labAgnss: Bool { defaults.bool(forKey: Key.labAgnss) }

    public func setLabAgnss(_ enabled: Bool) {
        lock.locked { defaults.set(enabled, forKey: Key.labAgnss) }
    }

    /// The watch asked (its op 1) but has not yet said what kind of data it wants.
    public func touchAsk(nowMs: Int) {
        lock.locked { defaults.set(nowMs, forKey: Key.askAt) }
    }

    public func recordAsk(nowMs: Int, version: Int, tags: String) {
        lock.locked {
            defaults.set(nowMs, forKey: Key.askAt)
            defaults.set(version, forKey: Key.askVersion)
            defaults.set(String(tags.prefix(AgpsStore.maxTagsChars)), forKey: Key.askTags)
        }
    }

    public func recordDownloaded(nowMs: Int, dataMs: Int, size: Int, source: String) {
        lock.locked {
            defaults.set(nowMs, forKey: Key.cachedAt)
            defaults.set(dataMs, forKey: Key.cachedData)
            defaults.set(size, forKey: Key.cachedSize)
            defaults.set(source, forKey: Key.cachedSource)
            defaults.set(0, forKey: Key.failures)
            defaults.set(0, forKey: Key.failureAt)
        }
    }

    public func recordDelivered(nowMs: Int, dataMs: Int, size: Int, source: String, address: String) {
        lock.locked {
            defaults.set(address, forKey: Key.deliveredAddress)
            defaults.set(nowMs, forKey: Key.deliveredAt)
            defaults.set(dataMs, forKey: Key.deliveredData)
            defaults.set(size, forKey: Key.deliveredSize)
            defaults.set(source, forKey: Key.deliveredSource)
            defaults.set(AgpsOutcome.delivered, forKey: Key.outcome)
            defaults.set("", forKey: Key.error)
            defaults.set(nowMs, forKey: Key.attemptAt)
        }
    }

    /// An attempt that ended without a delivery. `countsAsFailure` feeds the retry schedule (download problems only).
    public func recordOutcome(nowMs: Int, outcome: String, error: String, countsAsFailure: Bool) {
        lock.locked {
            defaults.set(outcome, forKey: Key.outcome)
            defaults.set(String(error.prefix(AgpsStore.maxErrorChars)), forKey: Key.error)
            defaults.set(nowMs, forKey: Key.attemptAt)
            if countsAsFailure {
                defaults.set(failures + 1, forKey: Key.failures)
                defaults.set(nowMs, forKey: Key.failureAt)
            }
        }
    }

    /// The user asked for a refresh: the retry wait ends.
    public func clearRetry() {
        lock.locked {
            defaults.set(0, forKey: Key.failures)
            defaults.set(0, forKey: Key.failureAt)
        }
    }
}
