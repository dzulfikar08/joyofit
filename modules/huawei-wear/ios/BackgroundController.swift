// Keeps the remembered watch connected in the background session and syncs on a timer. Port of BackgroundController.kt.
//
// What "background" means on iOS, which has no service: the controller runs as long as the process runs. iOS keeps it running while the app
// is in the foreground, and for a short time whenever it wakes the app for the bluetooth-central session (UIBackgroundModes
// `bluetooth-central`): a pending connect to the remembered peripheral (`ConnectMode.background`, no scan, no timeout) that completes when the
// watch comes into range, or a state-restoration relaunch. On that wake the controller authenticates, syncs and reads the battery, wrapped
// in `ExpiringWork` so the process is not suspended halfway. While the process is suspended nothing runs: the interval timer only counts
// while the app is awake, and the next wake is the next time iOS finds the watch.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

/// Backoff between reconnect attempts: doubles up to a cap.
public func nextBackoff(currentMs: Int) -> Int { min(currentMs * 2, BackgroundController.maxBackoffMs) }

/// Runs a piece of work with the extra execution time iOS grants for it (`UIApplication.beginBackgroundTask`); the default just runs it.
public typealias ExpiringWork = @Sendable (_ name: String, _ work: @escaping @Sendable () async -> Void) async -> Void

/// A conflated wake-up: any number of `signal()`s while nobody waits collapse into one, `wait(timeoutMs:)` returns on the first of them or
/// at the timeout (Kotlin `Channel(CONFLATED)` with `withTimeoutOrNull`).
final class WakeSignal: @unchecked Sendable {
    private let lock = NSLock()
    private var signaled = false
    private var waiter: CheckedContinuation<Void, Never>?

    func signal() {
        let w: CheckedContinuation<Void, Never>? = lock.locked {
            if let w = waiter {
                waiter = nil
                return w
            }
            signaled = true
            return nil
        }
        w?.resume()
    }

    /// Drops a pending signal (the failed attempt's own DISCONNECTED event nudged the loop; only an outside nudge may skip the wait).
    func consume() { lock.locked { signaled = false } }

    func wait(timeoutMs: Int) async {
        let wasSignaled: Bool = lock.locked {
            let s = signaled
            signaled = false
            return s
        }
        if wasSignaled { return }
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.waitForSignal() }
            group.addTask { try? await Task.sleep(nanoseconds: UInt64(max(timeoutMs, 0)) * 1_000_000) }
            await group.next()
            group.cancelAll()
        }
    }

    private func waitForSignal() async {
        await withTaskCancellationHandler {
            await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
                let resumeNow: Bool = lock.locked {
                    if signaled {
                        signaled = false
                        return true
                    }
                    waiter = c
                    return false
                }
                if resumeNow { c.resume() }
            }
        } onCancel: {
            let w: CheckedContinuation<Void, Never>? = lock.locked {
                let w = waiter
                waiter = nil
                return w
            }
            w?.resume()
        }
    }
}

public final class BackgroundController: @unchecked Sendable {
    public static let initialBackoffMs = 5_000
    public static let maxBackoffMs = 5 * 60_000
    /// A link that stayed up this long counts as healthy.
    static let stableLinkMs = 60_000
    static let resyncAfterReconnectMs = 5 * 60_000
    static let busyPollMs = 5_000
    static let idleWaitMs = 60 * 60_000

    private enum Attempt { case connected, failed, blocked }

    /// The outcome of an attempt, written by the `ExpiringWork` closure and read after it returns.
    private final class AttemptBox: @unchecked Sendable {
        private let lock = NSLock()
        private var stored = Attempt.failed
        var value: Attempt {
            get { lock.locked { stored } }
            set { lock.locked { stored = newValue } }
        }
    }

    private weak var runtime: WearRuntime?
    private let settings: WearSettings
    private let link: WearLink
    private let log: WearEvents
    private let expiring: ExpiringWork
    private let clock: @Sendable () -> Int

    private let wake = WakeSignal()
    private let lock = NSLock()
    private var loop: Task<Void, Never>?
    private var resetBackoff = false
    private var nextSyncAtMs = 0
    private var lastSyncAtMs = Int.min / 2
    private var lastConnectedAtMs = Int.min / 2
    private var wasConnected = false

    /// `clock` is a monotonic millisecond clock; tests replace it.
    init(runtime: WearRuntime, expiring: @escaping ExpiringWork, clock: @escaping @Sendable () -> Int = BackgroundController.uptimeMs) {
        self.runtime = runtime
        self.settings = runtime.settings
        self.link = runtime.link
        self.log = runtime.events
        self.expiring = expiring
        self.clock = clock
    }

    public static let uptimeMs: @Sendable () -> Int = { Int(ProcessInfo.processInfo.systemUptime * 1000) }

    public var isRunning: Bool { lock.locked { loop != nil } }

    public func start() {
        lock.locked {
            if loop != nil { return }
            nextSyncAtMs = 0
            loop = Task { [weak self] in await self?.run() }
        }
    }

    public func stop() {
        let task: Task<Void, Never>? = lock.locked {
            let t = loop
            loop = nil
            return t
        }
        task?.cancel()
    }

    /// Wakes the loop. `reset` clears the reconnect backoff (Bluetooth came back, the watch is near).
    public func nudge(reset: Bool) {
        if reset { lock.locked { resetBackoff = true } }
        wake.signal()
    }

    /// The link dropped or came up: look at it again.
    public func onLinkChanged() { nudge(reset: false) }

    /// The interval changed: the next sync is one new interval away.
    public func reschedule() {
        lock.locked { nextSyncAtMs = clock() + intervalMs() }
        wake.signal()
    }

    private func intervalMs() -> Int { settings.syncIntervalMinutes * 60_000 }

    private func takeResetBackoff() -> Bool { lock.locked { let r = resetBackoff; resetBackoff = false; return r } }
    private func peekResetBackoff() -> Bool { lock.locked { resetBackoff } }

    private func run() async {
        var backoff = BackgroundController.initialBackoffMs
        while !Task.isCancelled {
            let address = settings.watchAddress
            var waitMs: Int
            if runtime == nil { return }
            if address == nil || !settings.backgroundEnabled || runtime?.paused == true {
                waitMs = BackgroundController.idleWaitMs
            } else {
                switch link.currentState() {
                case .disconnected:
                    if wasConnected {
                        wasConnected = false
                        // A link that held for a while earns a fresh backoff; one that flaps keeps growing it.
                        if clock() - lastConnectedAtMs > BackgroundController.stableLinkMs { backoff = BackgroundController.initialBackoffMs }
                    }
                    if takeResetBackoff() { backoff = BackgroundController.initialBackoffMs }
                    switch await connect(address!) {
                    case .connected:
                        continue
                    case .failed:
                        // The failed attempt's own DISCONNECTED event nudged the loop; only an outside nudge may skip the wait.
                        if !peekResetBackoff() { wake.consume() }
                        runtime?.setNote("Disconnected. Retrying in \(backoff / 1000) s.")
                        waitMs = backoff
                        backoff = nextBackoff(currentMs: backoff)
                    case .blocked:
                        wake.consume()
                        waitMs = BackgroundController.idleWaitMs
                    }
                case .connected:
                    let now = clock()
                    if !wasConnected {
                        wasConnected = true
                        lastConnectedAtMs = now
                        // Sync right after (re)connecting unless one just ran.
                        if now - lastSyncAtMs > BackgroundController.resyncAfterReconnectMs { lock.locked { nextSyncAtMs = 0 } }
                    }
                    if now >= lock.locked({ nextSyncAtMs }) {
                        await cycle()
                        waitMs = max(1, lock.locked({ nextSyncAtMs }) - clock())
                    } else {
                        waitMs = lock.locked({ nextSyncAtMs }) - now
                    }
                default:
                    // Connecting from the app, or syncing: look again soon.
                    waitMs = BackgroundController.busyPollMs
                }
            }
            if Task.isCancelled { return }
            await wake.wait(timeoutMs: waitMs)
        }
    }

    private func connect(_ address: String) async -> Attempt {
        if link.needsBind(address) {
            runtime?.setNote("Not bound yet. Connect once from the Device tab.")
            return .blocked
        }
        let outcome = AttemptBox()
        await expiring("JoyoFit watch connect") { [self] in
            do {
                try await link.connect(address, mode: .background)
                outcome.value = .connected
            } catch let e as WearError {
                switch e.code {
                case .bluetoothOff:
                    runtime?.setNote("Waiting for Bluetooth.")
                    outcome.value = .blocked
                case .bluetoothPermission:
                    runtime?.setNote("Bluetooth permission is missing.")
                    outcome.value = .blocked
                case .authFailed where e.isFirstBindNeeded:
                    // The watch lost or replaced this phone's credential (another phone or app bound it, Huawei Health by itself in
                    // JRG-414): retrying cannot fix that, and a bind must be the user's decision.
                    runtime?.setNote(FirstBindMessage.backgroundNote(lostBinding: e.isLostBinding))
                    outcome.value = .blocked
                default:
                    log.info("Background connect failed [\(e.code.rawValue)]: \(e.message)")
                    outcome.value = .failed
                }
            } catch {
                if !(error is CancellationError) { log.info("Background connect failed: \(error)") }
                outcome.value = .failed
            }
        }
        return outcome.value
    }

    /// One periodic round: sync, then battery. Failures are logged; the next interval retries.
    private func cycle() async {
        lock.locked { nextSyncAtMs = clock() + intervalMs() }
        await expiring("JoyoFit watch sync") { [self] in
            var synced = false
            do {
                _ = try await link.syncActivity()
                lastSyncAtMs = clock()
                synced = true
            } catch let e as WearError {
                if e.code != .busy { log.error("Background sync failed [\(e.code.rawValue)]: \(e.message)") }
            } catch {
                if !(error is CancellationError) { log.error("Background sync failed: \(error)") }
            }
            do {
                _ = try await link.refreshBattery()
            } catch let e as WearError {
                log.error("Background battery refresh failed [\(e.code.rawValue)]: \(e.message)")
            } catch {
                if !(error is CancellationError) { log.error("Background battery refresh failed: \(error)") }
            }
            // The weather timer cannot run while the process is suspended: this wake is where an overdue push is made.
            await runtime?.weather.pushIfDue("background sync")
            // The family summary follows the stored sync (and the battery just read); the background URLSession carries it if iOS suspends the app now.
            if synced { await runtime?.family.uploadAfterSync() }
        }
    }
}

#endif
