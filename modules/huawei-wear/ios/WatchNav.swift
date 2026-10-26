// Watch navigation (LAB, off by default; HuaweiWearWatchNav.types.ts): while a session runs (`start` ... `stop`) and the experimental switch
// `P2pSettings.watchNavLab` is on, registers `WatchNavService` on every connect and sends JS's JSON messages to JoyoFit's watch app
// `com.joyodigitama.navi`; the watch app's messages and presence reach JS as `onWatchNav`. Port of WatchNav.kt.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

public final class WatchNav: @unchecked Sendable {
    private let settings: P2pSettings
    private let link: LinkHandleSource
    private let events: WearEvents
    public let phonePackage: String
    private let lock = NSLock()
    private var stackSource: () -> P2PStack? = { nil }
    private var active = false
    private var config: WatchNavConfig?

    public init(
        settings: P2pSettings, link: LinkHandleSource, events: WearEvents,
        phonePackage: String = Bundle.main.bundleIdentifier ?? "com.joyodigitama.joyofit"
    ) {
        self.settings = settings
        self.link = link
        self.events = events
        self.phonePackage = phonePackage
    }

    /// Where the live P2P stack comes from (the owning `P2pController`); set once, right after init.
    func bind(stack: @escaping () -> P2PStack?) { lock.locked { stackSource = stack } }

    private func stack() -> P2PStack? { lock.locked { stackSource }() }

    private func log(_ message: String) { events.info("WatchNav: \(message)") }

    private func service(_ current: P2PStack?) -> WatchNavService? { current?.manager.registeredService(phonePackage) as? WatchNavService }

    private static func nullable(_ value: Any?) -> Any { value ?? NSNull() }

    /// `WatchNavStatus` of HuaweiWearWatchNav.types.ts.
    public func status() -> [String: Any] {
        let current = stack()
        let service = service(current)
        let (active, config) = lock.locked { (self.active, self.config) }
        return [
            "enabled": settings.watchNavLab,
            "active": active,
            "p2p": current != nil,
            "registered": service != nil,
            "phonePackage": phonePackage,
            "watchBundle": WatchNavWire.package,
            "placeholderFingerprints": config?.placeholder ?? true,
            "watchApp": service?.watchApp ?? "unknown",
            "lastCode": WatchNav.nullable(service?.lastCode),
            "lastHeardAt": WatchNav.nullable(service?.lastHeardAt),
            "sent": service?.sent ?? 0,
            "acked": service?.acked ?? 0,
            "received": service?.received ?? 0,
        ]
    }

    /// Switching off stops a running session.
    public func setEnabled(_ enabled: Bool) {
        settings.watchNavLab = enabled
        log("lab switch \(enabled ? "on" : "off")")
        if !enabled { stop() }
    }

    /// Starts a session: registers the service now when connected, and on every connect until `stop`.
    public func start(_ config: WatchNavConfig) throws -> [String: Any] {
        if !settings.watchNavLab {
            throw WearError(.unsupported, "Watch navigation is a lab feature; switch it on under Experimental first")
        }
        if config.phoneFingerprint.trimmingCharacters(in: .whitespaces).isEmpty || config.watchFingerprint.trimmingCharacters(in: .whitespaces).isEmpty {
            throw WearError(.invalidArgument, "Watch navigation needs phoneFingerprint and watchFingerprint")
        }
        lock.locked {
            active = true
            self.config = config
        }
        log(
            "session start (phone \(phonePackage), watch app \(WatchNavWire.package), fingerprints \(config.placeholder ? "placeholder" : "set"))"
        )
        if let current = stack() { attach(current) } else { log("not connected; registers on the next connect") }
        return status()
    }

    /// Called on every new P2P stack: registers the service while a session runs and the switch is on.
    public func attach(_ current: P2PStack) {
        let (active, config) = lock.locked { (self.active, self.config) }
        guard active, settings.watchNavLab, let config else { return }
        guard link.handle()?.caps.supports(0x34, 0x01) == true else {
            log("the watch does not list the P2P service (34/01); not registered")
            return
        }
        // A service of another config is replaced: `registerService` unregisters the old one.
        if let existing = service(current), existing.config == config { return }
        WatchNavService(
            manager: current.manager, phonePackage: phonePackage, config: config, log: events.sink,
            emit: { [weak events] payload in events?.watchNav(payload) }
        ).register()
    }

    /// Sends one message; false (logged) when no session runs or the service is not registered.
    public func send(_ json: String) throws -> Bool {
        let summary = WatchNavWire.summary(json)
        if !lock.locked({ active }) {
            log("not sent \(summary): no session")
            return false
        }
        guard let service = service(stack()) else {
            log("not sent \(summary): not connected or no P2P service")
            return false
        }
        return try service.send(json)
    }

    /// Ends the session and unregisters the service.
    public func stop() {
        let wasActive = lock.locked { () -> Bool in
            let was = active
            active = false
            return was
        }
        guard wasActive else { return }
        stack()?.manager.unregisterService(phonePackage)
        log("session stop; service unregistered")
    }
}
