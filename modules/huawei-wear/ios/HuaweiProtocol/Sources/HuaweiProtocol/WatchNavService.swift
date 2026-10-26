// Watch navigation (LAB): the P2P module between JoyoFit (the phone app's own package) and JoyoFit's own watch app `com.joyodigitama.navi`
// (Wear Engine, link service 0x34/0x01). JS works out every instruction; this service only sends the JSON strings as P2P data, answers the watch
// app's ping (0xca) and data (0xcf), forwards the watch app's messages and tracks whether the watch app answers. Schema:
// protocol/watch-nav.schema.json. Twin: WatchNavService.kt.
import Foundation

public enum WatchNavWire {
    /// The watch app's bundle (P2P destination package).
    public static let package = "com.joyodigitama.navi"
    /// The largest message sent in one P2P data packet.
    public static let maxBytes = 1000
    /// The watch app's answer to a ping: it is installed and running.
    public static let pingPresent = 0xCA
    /// The watch app's acknowledgement of a data message.
    public static let ackReceived = 0xCF
    /// JS ships fingerprints starting with this until the Huawei developer account exists.
    public static let placeholderPrefix = "PLACEHOLDER"

    public static func isPlaceholder(_ fingerprint: String) -> Bool { fingerprint.hasPrefix(placeholderPrefix) }

    /// `<t> n=<n>` of a message for the log; `?` for a part that cannot be read. Never throws.
    public static func summary(_ json: String) -> String {
        guard let object = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] else { return "?" }
        return "\(text(object["t"])) n=\(text(object["n"]))"
    }

    private static func text(_ value: Any?) -> String {
        switch value {
        case let s as String: return s
        case let n as Int: return String(n)
        case let d as Double: return d == d.rounded() && abs(d) < 1e15 ? String(Int64(d)) : "\(d)"
        default: return "?"
        }
    }

    /// Why `json` cannot be sent, or nil when it can.
    public static func problem(_ json: String) -> String? {
        let bytes = json.utf8.count
        if bytes == 0 { return "empty" }
        if bytes > maxBytes { return "\(bytes) bytes, more than \(maxBytes)" }
        return nil
    }
}

/// What Wear Engine checks on both ends (`WatchNavConfig` of HuaweiWearWatchNav.types.ts).
public struct WatchNavConfig: Equatable, Sendable {
    public let phoneFingerprint: String
    public let watchFingerprint: String

    public init(phoneFingerprint: String, watchFingerprint: String) {
        self.phoneFingerprint = phoneFingerprint
        self.watchFingerprint = watchFingerprint
    }

    public var placeholder: Bool { WatchNavWire.isPlaceholder(phoneFingerprint) || WatchNavWire.isPlaceholder(watchFingerprint) }
}

/// P2P module `<phone package>` -> `com.joyodigitama.navi`. Registered by `WatchNav` while a session runs and the lab switch is on.
public final class WatchNavService: P2PService, @unchecked Sendable {
    /// Without an answer from the watch app, a send pings first when the last ping is older than this.
    public static let repingMs: Int64 = 30_000

    public let phonePackage: String
    public let config: WatchNavConfig
    private let log: LogSink
    private let emit: @Sendable ([String: Any]) -> Void
    private let now: @Sendable () -> Int64
    private let lock = NSLock()
    private var _watchApp = "unknown"
    private var _lastCode: Int?
    private var _lastHeardAt: Int64?
    private var _lastPingAt: Int64?
    private var _sent = 0
    private var _acked = 0
    private var _received = 0

    public init(
        manager: P2PManager, phonePackage: String, config: WatchNavConfig, log: @escaping LogSink, emit: @escaping @Sendable ([String: Any]) -> Void,
        now: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }
    ) {
        self.phonePackage = phonePackage
        self.config = config
        self.log = log
        self.emit = emit
        self.now = now
        super.init(manager: manager)
    }

    public override var module: String { phonePackage }
    public override var package: String { WatchNavWire.package }
    public override var fingerprint: String { config.watchFingerprint }
    public override var localFingerprint: String { config.phoneFingerprint }
    public override var pingPackage: String { phonePackage }

    public var watchApp: String { lock.p2pLocked { _watchApp } }
    public var lastCode: Int? { lock.p2pLocked { _lastCode } }
    public var lastHeardAt: Int64? { lock.p2pLocked { _lastHeardAt } }
    public var sent: Int { lock.p2pLocked { _sent } }
    public var acked: Int { lock.p2pLocked { _acked } }
    public var received: Int { lock.p2pLocked { _received } }

    private func note(_ message: String) { log(LogEntry(.info, service: 0x34, command: 0x01, "WatchNav: \(message)")) }

    private static func hex(_ code: Int) -> String { String(format: "0x%02x", code & 0xFF) }

    public override func registered() {
        note("registered \(phonePackage) -> \(WatchNavWire.package)")
        ping()
    }

    public override func unregister() {
        clearPending()
        presence("unknown", code: nil)
    }

    /// Pings the watch app: 0xca = it is there.
    public func ping() {
        lock.p2pLocked { _lastPingAt = now() }
        sendPing { [weak self] code, _ in
            guard let self else { return }
            self.lock.p2pLocked {
                self._lastCode = code
                self._lastHeardAt = self.now()
            }
            self.note("ping of \(WatchNavWire.package) answered \(WatchNavService.hex(code)) (0xca = the watch app is there)")
            self.presence((code & 0xFF) == WatchNavWire.pingPresent ? "present" : "absent", code: code)
        }
    }

    /// Sends one message (a JSON string) as P2P data. Throws `invalidArgument` when it is empty or longer than `WatchNavWire.maxBytes`.
    @discardableResult
    public func send(_ json: String) throws -> Bool {
        if let problem = WatchNavWire.problem(json) { throw WearError(.invalidArgument, "Watch navigation message not sent: \(problem)") }
        let stale = lock.p2pLocked { _watchApp != "present" && (_lastPingAt.map { now() - $0 > WatchNavService.repingMs } ?? true) }
        if stale { ping() }
        let bytes = Bytes(json.utf8)
        let summary = WatchNavWire.summary(json)
        lock.p2pLocked { _sent += 1 }
        note("tx \(summary) (\(bytes.count) bytes)")
        sendCommand(bytes) { [weak self] code, _ in
            guard let self else { return }
            let ok = (code & 0xFF) == WatchNavWire.ackReceived
            self.lock.p2pLocked {
                self._lastCode = code
                self._lastHeardAt = self.now()
                if ok { self._acked += 1 }
            }
            self.presence(ok ? "present" : "absent", code: code)
            if ok {
                self.note("tx \(summary) acknowledged 0xcf")
            } else {
                self.note("tx \(summary) answered \(WatchNavService.hex(code))")
            }
        }
        return true
    }

    public override func onPingPacket(_ packet: P2P.P2PCommand.Response) -> Int {
        note("the watch app pinged; answered 0xca")
        lock.p2pLocked { _lastHeardAt = now() }
        presence("present", code: WatchNavWire.pingPresent)
        return WatchNavWire.pingPresent
    }

    public override func onDataPacket(_ packet: P2P.P2PCommand.Response) -> Int { WatchNavWire.ackReceived }

    public override func handleData(_ data: Bytes) throws {
        lock.p2pLocked {
            _received += 1
            _lastHeardAt = now()
        }
        presence("present", code: nil)
        let text = String(decoding: data, as: UTF8.self)
        guard (try? JSONSerialization.jsonObject(with: Data(data))) is [String: Any] else {
            note("rx not JSON (\(data.count) bytes): \(data.hexLower)")
            return
        }
        note("rx \(text)")
        emit(["kind": "message", "json": text, "ts": now()])
    }

    /// Sets the watch app's presence; logs and emits only a change.
    private func presence(_ value: String, code: Int?) {
        let changed = lock.p2pLocked { () -> Bool in
            if _watchApp == value { return false }
            _watchApp = value
            return true
        }
        guard changed else { return }
        note(value == "unknown" ? "watch app unknown" : "watch app \(value)" + (code.map { " (code \(WatchNavService.hex($0)))" } ?? ""))
        emit(["kind": "presence", "watchApp": value, "code": code.map { $0 as Any } ?? NSNull(), "ts": now()])
    }
}
