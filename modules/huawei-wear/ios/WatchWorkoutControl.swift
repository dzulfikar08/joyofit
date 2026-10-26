// Port of WatchWorkout.kt (`WatchWorkoutControl`): starts, pauses, resumes and stops a workout on the watch from the phone
// (`WatchWorkoutWire`, `17/01`). One workout at a time, owned by the caller (the strength logger): while it is owned `LiveWorkout` does not
// open a mirror of it, because the phone already has its own screen for it. UNVERIFIED on a watch.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

/// What a start, pause, resume or stop came to. `rawValue` is the string JS reads.
public enum WatchWorkoutOutcome: String, Sendable {
    /// The watch accepted the command (and, for a start, reports the workout running).
    case confirmed
    /// The command went out; the watch did not confirm it (no answer, or a start the status poll does not show).
    case sent
    /// The watch answered with an error code.
    case refused
    /// The watch does not list `17/01`.
    case unsupported
    case notConnected = "not_connected"
}

public struct WatchWorkoutResult: Sendable {
    public let outcome: WatchWorkoutOutcome
    public let code: Int?

    public init(_ outcome: WatchWorkoutOutcome, code: Int? = nil) {
        self.outcome = outcome
        self.code = code
    }

    public func toJS() -> [String: Any] { ["outcome": outcome.rawValue, "code": code.map { $0 as Any } ?? NSNull()] }
}

public final class WatchWorkoutControl: LinkObserver, @unchecked Sendable {
    public static let requestMs = 5_000
    public static let verifyDelayMs = 1_500
    /// A workout nobody stopped (the app was killed between a start and its stop) stops being owned after this.
    public static let ownerMaxMs: Int64 = 8 * 60 * 60 * 1000

    private final class Owned {
        let sport: Int
        let startedAtMs: Int64
        var state = "running"
        init(sport: Int, startedAtMs: Int64) {
            self.sport = sport
            self.startedAtMs = startedAtMs
        }
    }

    private let link: LinkHandleSource
    private let events: WearEvents
    private let nowMs: @Sendable () -> Int64

    private let lock = NSLock()
    private var owned: Owned?
    private var attached: HuaweiSession?
    private var lastWatchOperator: Int?

    public init(link: LinkHandleSource, events: WearEvents, nowMs: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }) {
        self.link = link
        self.events = events
        self.nowMs = nowMs
    }

    private func log(_ message: String) { events.info(message) }

    /// True from a start until its stop, a stop on the watch or `ownerMaxMs`: `LiveWorkout` stays quiet meanwhile.
    public func owns() -> Bool {
        let result: Bool = lock.locked {
            guard let o = owned else { return false }
            if nowMs() - o.startedAtMs > Self.ownerMaxMs {
                owned = nil
                return false
            }
            return true
        }
        return result
    }

    private func listed(_ handle: LinkHandle?) -> Bool {
        handle?.caps.supports(Int(WatchWorkoutWire.service), Int(WatchWorkoutWire.setOperator)) ?? false
    }

    public func status() -> [String: Any] {
        let handle = link.handle()
        let (o, watchOperator): (Owned?, Int?) = lock.locked { (owned, lastWatchOperator) }
        return [
            "connected": handle != nil,
            "supported": listed(handle),
            "active": o != nil,
            "sport": o.map { $0.sport as Any } ?? NSNull(),
            "state": o.map { $0.state as Any } ?? NSNull(),
            "watchOperator": watchOperator.map { $0 as Any } ?? NSNull(),
        ]
    }

    // MARK: LinkObserver

    public func linkConnected(_ handle: LinkHandle) async {
        let session = handle.session
        let fresh: Bool = lock.locked {
            if attached === session { return false }
            attached = session
            return true
        }
        if !fresh { return }
        _ = await session.subscribe(service: WatchWorkoutWire.service, command: WatchWorkoutWire.operatorNotice, label: "workout operator notice") { [weak self] packet in
            self?.onNotice(packet, session)
        }
        let caps = handle.caps
        let service = Int(WatchWorkoutWire.service)
        log(
            "Watch workout: watch lists 17/01=\(listed(handle)) 17/02=\(caps.supports(service, Int(WatchWorkoutWire.operatorNotice))) " +
                "17/03=\(caps.supports(service, Int(WatchWorkoutWire.getOperator))) 17/12=\(caps.supports(service, Int(WatchWorkoutWire.openCloseReport))) " +
                "17/15=\(caps.supports(service, Int(WatchWorkoutWire.workoutCapability)))"
        )
    }

    public func linkDisconnected() {
        lock.locked { attached = nil }
    }

    /// The person paused, resumed or stopped on the watch. A stop there releases the workout.
    private func onNotice(_ packet: HuaweiPacket, _ session: HuaweiSession) {
        let notice = WatchWorkoutWire.parseNotice(packet.tlv)
        log("Watch workout: the watch reports operator \(notice?.operatorType.map { "\($0)" } ?? "nil") (type \(notice?.workoutType.map { "\($0)" } ?? "nil"))")
        lock.locked {
            lastWatchOperator = notice?.operatorType
            if let o = owned {
                switch notice?.operatorType {
                case WatchWorkoutWire.opPause: o.state = "paused"
                case WatchWorkoutWire.opResume: o.state = "running"
                case WatchWorkoutWire.opStop: owned = nil
                default: break
                }
            }
        }
        Task { [weak self] in
            do {
                try await session.send(WatchWorkoutWire.noticeAck(), label: "workout operator notice ack")
            } catch {
                self?.log("Watch workout: notice ack not sent: \((error as? WearError)?.message ?? "\(error)")")
            }
        }
    }

    // MARK: control

    public func start(sport: Int) async -> WatchWorkoutResult {
        let now = nowMs()
        // The workout is owned from before the command goes out: the watch's status may reach the phone before the answer does.
        let reserved = Owned(sport: sport, startedAtMs: now)
        lock.locked { owned = reserved }
        let result = await send(WatchWorkoutWire.opStart, sport: sport, now: now, startMs: now)
        if result.outcome == .unsupported || result.outcome == .notConnected || result.outcome == .refused {
            lock.locked { if owned === reserved { owned = nil } }
            return result
        }
        let running = await verifyRunning()
        if running == true { return WatchWorkoutResult(.confirmed, code: result.code) }
        if running == false { log("Watch workout: the watch does not report a workout running after the start") }
        return result
    }

    public func pause() async -> WatchWorkoutResult { await operate(WatchWorkoutWire.opPause, newState: "paused") }

    public func resume() async -> WatchWorkoutResult { await operate(WatchWorkoutWire.opResume, newState: "running") }

    public func stop() async -> WatchWorkoutResult {
        let result = await operate(WatchWorkoutWire.opStop, newState: nil)
        // Released whatever the answer: the phone's own workout is over, and the mirror must work again.
        lock.locked { owned = nil }
        return result
    }

    private func operate(_ op: Int, newState: String?) async -> WatchWorkoutResult {
        guard let o = lock.locked({ owned }) else {
            log("Watch workout: \(name(op)) without a workout started from the phone; nothing sent")
            return WatchWorkoutResult(.sent)
        }
        let result = await send(op, sport: o.sport, now: nowMs(), startMs: o.startedAtMs)
        if let newState, result.outcome != .refused { lock.locked { o.state = newState } }
        return result
    }

    private func send(_ op: Int, sport: Int, now: Int64, startMs: Int64) async -> WatchWorkoutResult {
        guard let handle = link.handle() else {
            log("Watch workout: \(name(op)) not sent, no connected watch")
            return WatchWorkoutResult(.notConnected)
        }
        guard listed(handle) else {
            log("Watch workout: \(name(op)) not sent, the watch does not list 17/01")
            return WatchWorkoutResult(.unsupported)
        }
        let shape = WatchWorkoutWire.shape { handle.caps.supports($0, $1) }
        do {
            let answer = try await handle.session.request(
                WatchWorkoutWire.setOperatorRequest(op: op, workoutType: sport, nowMs: now, startMs: startMs, shape: shape),
                timeoutMs: Self.requestMs,
                label: "workout \(name(op))"
            )
            let tlv = answer.tlv
            let code = WatchWorkoutWire.resultCode(tlv)
            log("Watch workout: \(name(op)) (type \(sport)) answered \(tlv.map { "\($0)" } ?? "(empty)")")
            if let code, code != WatchWorkoutWire.ok { return WatchWorkoutResult(.refused, code: code) }
            return WatchWorkoutResult(.confirmed, code: code)
        } catch {
            log("Watch workout: \(name(op)) not confirmed: \((error as? WearError)?.message ?? "\(error)")")
            return WatchWorkoutResult(.sent)
        }
    }

    /// `17/03` once, a moment after a start: true when the watch reports its workout open (its GO screen, `WatchPhase.open`) or running, false
    /// when it reports none, nil without an answer.
    private func verifyRunning() async -> Bool? {
        try? await Task.sleep(nanoseconds: UInt64(Self.verifyDelayMs) * 1_000_000)
        guard let handle = link.handle() else { return nil }
        do {
            let answer = try await handle.session.request(WatchWorkoutWire.statusRequest(), timeoutMs: Self.requestMs, label: "workout status after start")
            log("Watch workout: status after the start \(answer.tlv.map { "\($0)" } ?? "(empty)")")
            return (WatchWorkoutWire.parseStatus(answer.tlv)?.phase ?? .idle) != .idle
        } catch {
            log("Watch workout: status after the start failed: \((error as? WearError)?.message ?? "\(error)")")
            return nil
        }
    }

    private func name(_ op: Int) -> String {
        switch op {
        case WatchWorkoutWire.opStart: return "start"
        case WatchWorkoutWire.opPause: return "pause"
        case WatchWorkoutWire.opResume: return "resume"
        default: return "stop"
        }
    }
}

#endif
