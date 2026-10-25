// Port of LiveWorkout.kt: a workout on the watch, followed live on the phone. Two sources:
//  - the watch's own numbers, when it sends them (Huawei Health's reverse linkage `LiveWorkoutWire`, or the `17/11` report);
//  - otherwise JoyoFit's own session (`gps` / `status` / `manual`): the Fit 4 Pro (6.1.0.117) sends neither, but asks for the phone's GPS about
//    every 20 s from the moment its workout screen looks for a fix, answers the `17/03` status poll, and pushes realtime heart rate when asked.
//    The session runs on that heart rate: calories from `HeartRateEnergy`, time from the phone's clock (`WorkoutClock`), which starts only when
//    the watch says the workout runs (its `17/03` status, `WatchPhase`; a `17/11` report; a start event; a watch that gives none of these starts it
//    by the person moving, `MotionStart`). A GPS request alone never starts it: the watch asks for the phone's GPS from its pre-start (GO) screen
//    on, so until the watch says otherwise the session is `preparing`. It ends when the status poll says "no workout"
//    `LiveWorkoutPolicy.idleAnswersToEnd` times in a row (once after the watch closed its workout screen, `18/08`), or the user taps Finish; a watch
//    that is not conclusive (still asks for GPS, or answers nothing) makes the screen ask the user (`endSuspected`) instead of dropping the session.
// Either way it keeps JoyoFit's fat and carbohydrate estimate (`SubstrateEstimator`) and reports every change to JS (`onLiveWorkout`). The state
// decisions live in `LiveWorkoutPolicy`.
// A workout the watch asked the phone's GPS for also gets the phone's own track (`SessionTrack`, fed by `WorkoutLink` until the session ends,
// `PhoneGpsSession`): the `location` for the map and `gpsDistanceM`, `gpsRiseM`, `gpsPaceSecPerKm`, the figures a watch that sends none lacks.
// Not ported: the ongoing notification of Android (iOS has no equivalent that does not need a notification permission prompt).
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

public final class LiveWorkout: DataSyncFeature, @unchecked Sendable {
    public let name = "live workout"

    public typealias Status = LiveWorkoutStatus

    /// Where the numbers come from: the watch, or JoyoFit's heart-rate session started by the GPS requests, the status poll or by hand.
    public enum Source: String, Sendable { case watch, gps, status, manual }

    /// Age used for the maximum heart rate when no profile is saved (220 - 35 = 185 bpm).
    public static let defaultAge = 35
    /// Weight for the heart-rate energy estimate when no profile is saved.
    public static let defaultWeightKg = 70.0
    /// How often the GPS-request session's watchdog looks at the silence (`LiveWorkoutPolicy.silenceVerdict`).
    public static let watchdogEveryMs = 15_000

    private struct Session {
        let id: Int64
        var sportType: Int?
        var status: Status
        var metrics = LiveMetrics()
        var estimator: SubstrateEstimator
        let maxHeartRate: Int
        var updatedAtMs: Int64
        var source: Source
        var endedAtMs: Int64?
        /// Phone-side session: kcal so far, last heart-rate time, last GPS request.
        var estimatedKcal = 0.0
        var lastHeartRateAtMs: Int64?
        var lastGpsAtMs: Int64 = 0
        /// Phone-side session: workout time, counted from the moment the watch really ran the workout.
        var clock = WorkoutClock()
        /// Phone-side session: the watch's own status said the workout runs (a GPS request alone does not).
        var confirmed = false
        /// The watch looks to have stopped but did not say so: JS asks the user (Finish / keep going).
        var endSuspected = false
        /// The phone's GPS for this session: the newest fix for the map (also while the workout only prepares), and distance, climb and speed
        /// from the fixes of the running stretches.
        var phoneTrack = SessionTrack()
        /// The watch asked for the phone's GPS during this session: an outdoor sport, whatever sport tag it did or did not send.
        var gpsRequested = false
        /// `onEnded` was called for this session.
        var endReported = false

        /// Moves the session to `status`; a phone-side session's clock follows it. The switch to running begins a new stretch of the phone's
        /// track, so the stretch before a pause (or the pre-start walk) and the one after it are not joined into one step.
        mutating func setStatus(_ status: Status, nowMs now: Int64) {
            if self.status == status { return }
            if status == .running { phoneTrack.startStretch(nowMs: now) }
            if source != .watch {
                switch status {
                case .running:
                    clock.resume(now)
                    // A pause must not count as workout time once resumed.
                    lastHeartRateAtMs = nil
                case .paused, .ended: clock.pause(now)
                case .preparing: break
                }
                if let seconds = clock.seconds(now) { metrics.durationSec = seconds }
            }
            self.status = status
            updatedAtMs = now
            endSuspected = false
            if status == .ended { endedAtMs = now }
        }
    }

    private let dataSync: DataSyncService
    private let events: WearEvents
    private let settings: WearSettings
    private let setHeartRateActive: @Sendable (Bool) -> Void
    private let nowMs: @Sendable () -> Int64
    private let watchdogEveryMs: Int

    private let lock = NSLock()
    private var session: Session?
    private var watchdog: Task<Void, Never>?
    private var notifiedEnd = false
    /// Last answer of the 17/03 status poll, and how many answers in a row said "no workout".
    private var lastStatusAtMs: Int64 = 0
    private var idleAnswers = 0
    /// A `17/11` report was received: the watch tells its own start, so movement is no signal to wait for.
    private var reportsSeen = false
    /// When the watch last said its workout screen closed (`18/08 {01: 0}`); 0 while it is open or never said.
    private var screenClosedAtMs: Int64 = 0

    /// Called once each time a session ends, never with `lock` held: the phone's location updates for it stop (`WorkoutLink`,
    /// `PhoneGpsSession.sessionEnded`).
    public var onEnded: @Sendable () -> Void {
        get { lock.locked { _onEnded } }
        set { lock.locked { _onEnded = newValue } }
    }
    private var _onEnded: @Sendable () -> Void = {}

    /// True while a workout the phone started on the watch (`WatchWorkoutControl`) is owned by a screen of its own (the strength logger): the
    /// watch's workout is then not mirrored as a live workout, which would open a second screen for the same session. A mirror that is already
    /// running is left alone; only a new one is not opened.
    public var phoneOwned: @Sendable () -> Bool {
        get { lock.locked { _phoneOwned } }
        set { lock.locked { _phoneOwned = newValue } }
    }
    private var _phoneOwned: @Sendable () -> Bool = { false }

    /// Called at the top of the entry points, never with `lock` held (`NSLock` is not reentrant).
    private func mirrorBlocked() -> Bool {
        guard phoneOwned() else { return false }
        let idle: Bool = lock.locked { session == nil || session?.status == .ended }
        return idle
    }

    public init(
        dataSync: DataSyncService, events: WearEvents, settings: WearSettings, setHeartRateActive: @escaping @Sendable (Bool) -> Void,
        nowMs: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }, watchdogEveryMs: Int = LiveWorkout.watchdogEveryMs
    ) {
        self.dataSync = dataSync
        self.events = events
        self.settings = settings
        self.setHeartRateActive = setHeartRateActive
        self.nowMs = nowMs
        self.watchdogEveryMs = watchdogEveryMs
    }

    private func log(_ message: String) { events.info(message) }

    public func register(service: DataSyncService) {
        service.onEvent(phonePkg: LiveWorkoutWire.phonePkg, watchPkg: LiveWorkoutWire.watchPkg, eventId: nil) { [weak self] in await self?.onEvent($0) }
        service.onPoint(phonePkg: LiveWorkoutWire.phonePkg, watchPkg: LiveWorkoutWire.watchPkg, dictId: nil) { [weak self] in self?.onPoint($0) }
    }

    /// The current or last workout for JS (`getLiveWorkout`), nil when none was seen since the app started.
    public func snapshot() -> [String: Any]? { lock.locked { session.map(toJS) } }

    /// True from a workout's start until it ends.
    public var isLive: Bool { lock.locked { session.map { $0.status != .ended } ?? false } }

    /// How often `WorkoutLink` asks the status now: fast while a session waits for GO, so the phone's clock starts with the watch's.
    public func pollEveryMs() -> Int64 { LiveWorkoutPolicy.pollEveryMs(lock.locked { session?.status }) }

    /// The watch's `18/08` (Huawei Health's activity-recognition switch, `HwGpsUtil.arKitSwitch`): `{01: 1}` comes with the first GPS request when
    /// a workout screen opens, `{01: 0}` when it closes (Fit 4 Pro, 2026-10-25: 5 s before `17/03` said idle, each time). A close makes the next
    /// "no workout" answer end the session at once (`LiveWorkoutPolicy.idleVerdict`). A watch that never answers the status poll gives no other
    /// sign of its finish, so the screen asks the person at once (`endSuspected`) instead of after two minutes of GPS silence; not ended outright,
    /// because whether a band sends the close on a pause too is not known. Returns true when the status should be asked now.
    public func workoutScreen(open: Bool) -> Bool {
        if mirrorBlocked() { return false }
        let (live, suspect): (Bool, Bool) = lock.locked {
            screenClosedAtMs = open ? 0 : nowMs()
            guard var s = session, s.status != .ended else { return (false, false) }
            if !open && s.source == .gps && lastStatusAtMs == 0 && !reportsSeen && !s.endSuspected {
                s.endSuspected = true
                session = s
                return (true, true)
            }
            return (true, false)
        }
        if suspect {
            log("Live workout: the watch closed its workout screen and does not answer the status poll; asking the user")
            publish(force: true)
        }
        return live && !open
    }

    /// Whether a live session of `source` ends by itself once the watch is gone (LiveWorkoutPolicy.kt `endsWithoutLink`): only the GPS-request
    /// session has the watchdog for that (`LiveWorkoutPolicy.silenceVerdict`); the others end on the watch's word or Finish. Decides whether the
    /// phone's GPS survives a lost link.
    public static func endsWithoutLink(_ source: Source) -> Bool { source == .gps }

    /// True while the live session ends by itself once the watch is gone, so it may keep the phone's GPS through a lost link
    /// (`PhoneGpsSession.linkLost`).
    public var endsWithoutLink: Bool { lock.locked { session.map { $0.status != .ended && Self.endsWithoutLink($0.source) } ?? false } }

    /// The user closed the finished workout on the phone.
    public func dismiss() {
        lock.locked {
            if session?.status == .ended { session = nil }
            notifiedEnd = false
        }
    }

    /// Live screen "Start": a phone-side session for a workout the watch does not announce (indoor).
    public func startManual() {
        let started: Bool = lock.locked {
            if let s = session, s.status != .ended { return false }
            session = newSession(nil, .running, .manual)
            return true
        }
        if !started { return }
        log("Live workout: started on the phone")
        setHeartRateActive(true)
        publish(force: true)
    }

    /// Live screen "Finish".
    public func finish() { end("finished on the phone") }

    private func end(_ why: String) {
        let ended: Bool = lock.locked {
            guard var s = session, s.status != .ended else { return false }
            s.setStatus(.ended, nowMs: nowMs())
            session = s
            return true
        }
        if !ended { return }
        log("Live workout: ended (\(why))")
        lock.locked {
            watchdog?.cancel()
            watchdog = nil
        }
        publish(force: true)
    }

    /// Realtime heart rate from the watch: drives a phone-side session; a watch-fed one has its own heart rate. While the watch only prepares
    /// (its GO screen, the GPS search) the heart rate shows but no time or energy is counted.
    public func onHeartRate(_ bpm: Int) {
        let updated: Bool = lock.locked {
            guard var s = session, s.source != .watch, s.status == .running || s.status == .preparing else { return false }
            let now = nowMs()
            if s.status == .preparing {
                s.metrics.heartRate = bpm
                s.updatedAtMs = now
                session = s
                return true
            }
            let last = s.lastHeartRateAtMs
            s.lastHeartRateAtMs = now
            if let last {
                // A reading covers the time since the previous one, at most 10 s (the link may have dropped in between).
                let minutes = Double(min(max(now - last, 0), 10_000)) / 60_000.0
                let profile = settings.profile
                let age = (profile?.birthYear).flatMap { $0 > 0 ? $0 : nil }.map { ProfileSender.age(birthYear: $0, now: Date(timeIntervalSince1970: Double(now) / 1000)) } ?? Self.defaultAge
                let weight = (profile?.weightKg).flatMap { $0 > 0 ? $0 : nil } ?? Self.defaultWeightKg
                s.estimatedKcal += HeartRateEnergy.kcalPerMinute(heartRate: bpm, weightKg: weight, age: age, sex: profile?.sex ?? "unknown") * minutes
            }
            s.metrics.heartRate = bpm
            s.metrics.calories = s.estimatedKcal
            s.metrics.durationSec = s.clock.seconds(now) ?? s.metrics.durationSec
            s.updatedAtMs = now
            s.estimator.update(totalCalories: s.estimatedKcal, heartRate: bpm)
            session = s
            return true
        }
        if updated { publish(force: false) }
    }

    private func onEvent(_ event: SampleEvent) async {
        if mirrorBlocked() { return }
        switch event.eventId {
        case LiveWorkoutWire.eventControl: await onControl(LiveWorkoutWire.parseControl(event.data))
        case LiveWorkoutWire.eventStart: change(LiveWorkoutWire.parseWorkoutType(event.data), .running, "started", opens: true)
        case LiveWorkoutWire.eventPause: change(LiveWorkoutWire.parseWorkoutType(event.data), .paused, "paused")
        case LiveWorkoutWire.eventResume: change(LiveWorkoutWire.parseWorkoutType(event.data), .running, "resumed")
        case LiveWorkoutWire.eventStop: change(LiveWorkoutWire.parseWorkoutType(event.data), .ended, "stopped")
        default: log("Live workout: event \(event.eventId) not handled, data=\(DataSyncWire.describe(event.data))")
        }
    }

    private func onControl(_ control: LiveWorkoutWire.Control) async {
        log("Live workout: control op=\(control.operation.map(String.init) ?? "null") type=\(control.workoutType.map(String.init) ?? "null") status=\(control.status.map(String.init) ?? "null")")
        let watchStatus: Status
        switch control.status {
        case LiveWorkoutWire.watchRunning: watchStatus = .running
        case LiveWorkoutWire.watchPaused: watchStatus = .paused
        default: watchStatus = .preparing
        }
        switch control.operation {
        case LiveWorkoutWire.opStart:
            // A new workout on the watch: always a fresh session, even if the last one never saw its stop.
            lock.locked { session = newSession(control.workoutType, watchStatus) }
            publish(force: true)
            await reply(LiveWorkoutWire.opStart, "start")
        case LiveWorkoutWire.opResume:
            // The watch picks the phone up again (after a reconnect) with its current state.
            change(control.workoutType, control.status == LiveWorkoutWire.watchPaused ? .paused : .running, "linked again")
            await reply(LiveWorkoutWire.opResume, "resume")
        case LiveWorkoutWire.opStop:
            change(control.workoutType, .ended, "stopped (control)")
            await reply(LiveWorkoutWire.opStop, "stop")
        case LiveWorkoutWire.opReport:
            log("Live workout: watch reports linkage status \(control.status.map(String.init) ?? "null")")
        default:
            log("Live workout: unknown control operation \(control.operation.map(String.init) ?? "null")")
        }
    }

    private func reply(_ operation: Int, _ what: String) async {
        _ = try? await dataSync.sendEvent(
            phonePkg: LiveWorkoutWire.phonePkg, watchPkg: LiveWorkoutWire.watchPkg, eventId: LiveWorkoutWire.eventControl,
            data: LiveWorkoutWire.reply(operation), what: "live workout \(what) reply"
        )
    }

    private func change(_ workoutType: Int?, _ status: Status, _ what: String, opens: Bool = false) {
        let proceed: Bool = lock.locked {
            let now = nowMs()
            if var current = session, current.status != .ended {
                if let workoutType { current.sportType = workoutType }
                current.setStatus(status, nowMs: now)
                session = current
                return true
            }
            // Nothing to stop; right after a workout ended only a start opens a new one (a late pause or resume is a straggler).
            if status == .ended { return false }
            if !opens, let endedAt = session?.endedAtMs, now - endedAt < LiveWorkoutPolicy.restartGuardMs { return false }
            // A pause or resume without a known start (the app started mid-workout) still opens a session.
            session = newSession(workoutType, status)
            return true
        }
        if !proceed { return }
        log("Live workout: \(what) (type \(workoutType.map(String.init) ?? "null"))")
        publish(force: true)
    }

    private func onPoint(_ point: SamplePointIn) {
        if mirrorBlocked() { return }
        let accepted: Bool = lock.locked {
            let now = nowMs()
            let frame = LiveMetrics().applyPoint(point.values)
            let running = frame.watchState == 1 || frame.watchState == 2
            guard acceptsWatchFrame(running: running, durationSec: frame.durationSec, stop: frame.watchState == 3, now: now) else { return false }
            var current = watchSession(LiveWorkoutPolicy.isRunningFrame(running: running, durationSec: frame.durationSec) ? .running : .preparing)
            let metrics = current.metrics.applyPoint(point.values)
            current.metrics = metrics
            current.updatedAtMs = now
            current.estimator.update(totalCalories: metrics.calories, heartRate: metrics.heartRate)
            let next: Status?
            switch metrics.watchState {
            case 1: next = .running
            case 2: next = .paused
            case 3: next = .ended
            default:
                next = current.status == .preparing && LiveWorkoutPolicy.isRunningFrame(running: running, durationSec: metrics.durationSec) ? .running : nil
            }
            if let next { current.setStatus(next, nowMs: now) }
            session = current
            return true
        }
        if accepted { publish(force: false) }
    }

    /// The watch's answer to the status poll (`17/03`, `WatchPhase`): the watch says when the workout really runs (after GO and its countdown), so
    /// this is what starts the phone's timer for a session opened by a GPS request, and what starts one for a running workout nothing else
    /// announced (indoor ones included). An open workout screen (`WatchPhase.open`, the GO screen) is not a start. It follows pause and resume,
    /// and ends a session once the watch is idle (`LiveWorkoutPolicy.idleVerdict`; at once after the watch closed its workout screen,
    /// `workoutScreen`).
    public func watchStatus(phase: WatchPhase, workoutType: Int?) {
        if mirrorBlocked() { return }
        var created = false
        var ended = false
        var changed = false
        var note: String?
        var idle = 0
        let running = phase == .running || phase == .paused
        lock.locked {
            let now = nowMs()
            lastStatusAtMs = now
            idleAnswers = phase == .idle ? idleAnswers + 1 : 0
            idle = idleAnswers
            guard var s = session, s.status != .ended else {
                if running {
                    var fresh = newSession(workoutType, phase == .paused ? .paused : .running, .status)
                    fresh.confirmed = true
                    session = fresh
                    created = true
                }
                return
            }
            if phase != .idle {
                if let workoutType, s.sportType == nil { s.sportType = workoutType }
                if s.source != .watch {
                    if running { s.confirmed = true }
                    if let want = LiveWorkoutPolicy.statusTarget(s.status, phase), s.status != want {
                        if phase == .open {
                            note = "the watch stopped counting (paused, or back on its start screen); timer paused"
                        } else if want == .paused {
                            note = "the watch paused the workout"
                        } else if s.status == .paused {
                            note = "the watch resumed the workout"
                        } else {
                            note = "the watch started the workout (GO); timer running"
                        }
                        s.setStatus(want, nowMs: now)
                        changed = true
                    } else if s.endSuspected {
                        s.endSuspected = false
                        changed = true
                    }
                }
                session = s
            } else if s.source == .status || s.source == .gps {
                let screenClosed = screenClosedAtMs != 0 && now - screenClosedAtMs <= LiveWorkoutPolicy.screenClosedMs
                switch LiveWorkoutPolicy.idleVerdict(
                    preparing: s.status == .preparing, confirmed: s.confirmed, idleAnswers: idleAnswers, msSinceGps: now - s.lastGpsAtMs,
                    screenClosed: screenClosed
                ) {
                case .end: ended = true
                case .suspect:
                    if !s.endSuspected {
                        s.endSuspected = true
                        session = s
                        changed = true
                        note = "the watch reports no workout but still asks for GPS; asking the user"
                    }
                case .keep: break
                }
            } else if s.source == .watch {
                // A watch-fed session normally ends on the watch's stop frame; with the frames silent and the poll idle, a lost stop does not
                // leave it running.
                ended = LiveWorkoutPolicy.watchFedEnds(preparing: s.status == .preparing, idleAnswers: idleAnswers, msSinceFrame: now - s.updatedAtMs)
            }
        }
        if let note { log("Live workout: \(note)") }
        if created {
            log("Live workout: the watch reports a workout running (type \(workoutType.map(String.init) ?? "null")); following its heart rate")
            setHeartRateActive(true)
            publish(force: true)
        } else if ended {
            end("the watch reported no workout \(idle) times in a row")
        } else if changed {
            publish(force: true)
        }
    }

    /// The watch asked for the phone's GPS (the request repeats about every 20 s). It asks from the moment its workout screen starts looking for a
    /// fix, which is before the workout runs, so this opens a session that is only preparing (the timer waits); `watchStatus` or the watch's own
    /// numbers start it. A watch that never answers the status poll gives nothing else to wait for than movement (`onLocation`). Returns true while
    /// the status should be asked now (the session was just opened, or still prepares).
    @discardableResult
    public func gpsPing() -> Bool {
        if mirrorBlocked() { return false }
        var created = false
        var changed = false
        let askStatus: Bool = lock.locked {
            let now = nowMs()
            if var s = session, s.status != .ended {
                s.lastGpsAtMs = now
                s.gpsRequested = true
                if s.endSuspected {
                    s.endSuspected = false
                    changed = true
                }
                session = s
                return s.status == .preparing
            }
            // A straggling request right after a workout ended does not open a second one.
            if let endedAt = session?.endedAtMs, now - endedAt < LiveWorkoutPolicy.restartGuardMs { return false }
            // Always preparing: the watch asks for GPS from its pre-start (GO) screen on, so the request says nothing about the workout running.
            // The status poll, a `17/11` report or a start event starts the clock; a watch that gives none of those starts it by movement.
            var fresh = newSession(nil, .preparing, .gps)
            fresh.lastGpsAtMs = now
            fresh.gpsRequested = true
            session = fresh
            created = true
            return true
        }
        if !created {
            if changed { publish(force: true) }
            return askStatus
        }
        log("Live workout: the watch asked for the phone's GPS; following its heart rate (timer waits for the watch to start the workout)")
        setHeartRateActive(true)
        lock.locked {
            watchdog?.cancel()
            watchdog = Task { [weak self] in
                while !Task.isCancelled {
                    guard let every = self?.watchdogEveryMs else { return }
                    try? await Task.sleep(nanoseconds: UInt64(every) * 1_000_000)
                    if Task.isCancelled { return }
                    guard let self else { return }
                    self.watchdogTick()
                }
            }
        }
        publish(force: true)
        return askStatus
    }

    /// The GPS-request session's watchdog (`LiveWorkoutPolicy.silenceVerdict`): the watch stops asking once its own GPS has a fix, so silence alone
    /// says nothing while the status poll answers; then the poll decides. Without answers, silence asks the user first and ends the session later.
    private func watchdogTick() {
        let verdict: LiveWorkoutPolicy.Verdict = lock.locked {
            guard var s = session, s.source == .gps, s.status != .ended else { return .keep }
            let now = nowMs()
            let silence = LiveWorkoutPolicy.silenceVerdict(preparing: s.status == .preparing, msSinceGps: now - s.lastGpsAtMs, msSinceStatus: now - lastStatusAtMs)
            if silence != .suspect { return silence }
            if s.endSuspected { return .keep }
            s.endSuspected = true
            session = s
            return .suspect
        }
        switch verdict {
        case .end: end("the watch stopped asking for GPS and does not answer the status poll")
        case .suspect:
            log("Live workout: the watch stopped asking for GPS and does not answer the status poll; asking the user")
            publish(force: true)
        case .keep: break
        }
    }

    /// A `17/11` realtime report (`WorkoutReport`); operator type 1 running, 2 paused, 3 resumed, 4 stopped.
    public func onReport(_ report: WorkoutReport) {
        if mirrorBlocked() { return }
        let accepted: Bool = lock.locked {
            reportsSeen = true
            let now = nowMs()
            let op = report.operatorType
            let running = op == 1 || op == 2 || op == 3
            let frame = report.apply(to: LiveMetrics())
            guard acceptsWatchFrame(running: running, durationSec: frame.durationSec, stop: op == 4, now: now) else { return false }
            var current = watchSession(LiveWorkoutPolicy.isRunningFrame(running: running, durationSec: frame.durationSec) ? .running : .preparing)
            let metrics = report.apply(to: current.metrics)
            current.metrics = metrics
            current.updatedAtMs = now
            current.estimator.update(totalCalories: metrics.calories, heartRate: metrics.heartRate)
            let next: Status?
            switch op {
            case 1, 3: next = .running
            case 2: next = .paused
            case 4: next = .ended
            default:
                next = current.status == .preparing && LiveWorkoutPolicy.isRunningFrame(running: running, durationSec: metrics.durationSec) ? .running : nil
            }
            if let next { current.setStatus(next, nowMs: now) }
            session = current
            return true
        }
        if accepted { publish(force: false) }
    }

    /// A fix of the phone's GPS (LiveWorkout.kt `onLocation`). It runs from the watch's first GPS request to the end of the session, also after
    /// the watch stopped asking (`PhoneGpsSession`). Kept for the map; while the workout runs it also feeds the phone's own distance, climb and
    /// speed (`SessionTrack`), which JS shows when the watch sends none. Fixes while the session prepares or is paused count nothing. A watch
    /// that never says when its workout starts (no `17/03` answer, no `17/11` report) has no other sign than the person moving: `MotionStart`
    /// starts the clock then, and only then.
    public func onLocation(_ fix: WorkoutLinkWire.Fix) {
        if mirrorBlocked() { return }
        let outcome: (live: Bool, started: Bool) = lock.locked {
            guard var s = session, s.status != .ended else { return (false, false) }
            let silentWatch = lastStatusAtMs == 0 && !reportsSeen && s.source != .watch
            let moving = s.phoneTrack.onFix(fix, running: s.status == .running, motionStarts: s.status == .preparing && silentWatch)
            if moving { s.setStatus(.running, nowMs: nowMs()) }
            session = s
            return (true, moving)
        }
        if !outcome.live { return }
        if outcome.started { log("Live workout: the watch gives no sign of a start; the person is moving, timer running") }
        publish(force: outcome.started)
    }

    /// The session watch numbers go into. A phone-side session is replaced by a watch-fed one with the same id, because the watch's cumulative
    /// calories and its estimate would otherwise be mixed. `initial` is the state of a session opened by the frame. Callers hold `lock`.
    private func watchSession(_ initial: Status = .running) -> Session {
        let current = session.flatMap { $0.status != .ended ? $0 : nil }
        if let current, current.source == .watch { return current }
        let status = current.map { $0.status != .preparing ? $0.status : initial } ?? initial
        var fresh = newSession(current?.sportType, status, .watch, id: current?.id)
        if let current {
            // The phone's own GPS follows the session whoever feeds the numbers.
            fresh.phoneTrack = current.phoneTrack
            fresh.gpsRequested = current.gpsRequested
            fresh.lastGpsAtMs = current.lastGpsAtMs
            // Opened running from a session that only prepared: the running stretch begins now, as with `setStatus`.
            if current.status == .preparing && status == .running { fresh.phoneTrack.startStretch(nowMs: fresh.updatedAtMs) }
        }
        session = fresh
        if current != nil { log("Live workout: the watch sends its own numbers; using them instead of the heart-rate estimate") }
        return fresh
    }

    /// Whether a frame with the watch's own numbers belongs to a workout to follow. Not: a stop with nothing to stop; right after a workout ended,
    /// anything but the start of a new one (stragglers must not open a second session); while a phone-side session still only prepares, a frame
    /// that shows no running workout (the watch is searching for GPS). Callers hold `lock`.
    private func acceptsWatchFrame(running: Bool, durationSec: Int?, stop: Bool, now: Int64) -> Bool {
        let last = session
        let current = last.flatMap { $0.status != .ended ? $0 : nil }
        if stop { return current != nil }
        guard let current else {
            guard let endedAt = last?.endedAtMs else { return true }
            return now - endedAt >= LiveWorkoutPolicy.restartGuardMs || LiveWorkoutPolicy.isFreshStart(running: running, durationSec: durationSec)
        }
        if current.status == .preparing && current.source != .watch { return LiveWorkoutPolicy.isRunningFrame(running: running, durationSec: durationSec) }
        return true
    }

    private func newSession(_ workoutType: Int?, _ status: Status, _ source: Source = .watch, id: Int64? = nil) -> Session {
        let now = nowMs()
        let birthYear = settings.profile?.birthYear
        let age = (birthYear.flatMap { $0 > 0 ? $0 : nil }).map { ProfileSender.age(birthYear: $0, now: Date(timeIntervalSince1970: Double(now) / 1000)) } ?? Self.defaultAge
        let maxHr = SubstrateEstimator.maxHeartRate(age: age)
        var s = Session(
            id: id ?? now, sportType: workoutType, status: status, estimator: SubstrateEstimator(maxHeartRate: maxHr), maxHeartRate: maxHr, updatedAtMs: now,
            source: source
        )
        // A phone-side session counts its own time, from the moment the workout is really running (not while it only prepares).
        if source != .watch && status != .preparing {
            s.clock.start(now)
            if status == .paused { s.clock.pause(now) }
            s.metrics.durationSec = 0
        }
        return s
    }

    private func toJS(_ s: Session) -> [String: Any] {
        let m = s.metrics
        let located = s.phoneTrack.location
        let track = s.phoneTrack.track
        let confirmed: Bool
        switch s.source {
        case .watch, .manual: confirmed = true
        case .gps, .status: confirmed = s.confirmed
        }
        func v(_ x: Any?) -> Any { x ?? NSNull() }
        return [
            "id": Double(s.id),
            "status": s.status.rawValue,
            "source": s.source.rawValue,
            "sportType": v(s.sportType),
            "sportName": v(s.sportType.map { WorkoutSportTypes.name($0) }),
            "updatedAt": Double(s.updatedAtMs),
            "endedAt": v(s.endedAtMs.map { Double($0) }),
            "durationSec": v(m.durationSec),
            "heartRate": v(m.heartRate),
            "heartRateZone": v(m.heartRateZone),
            "maxHeartRate": s.maxHeartRate,
            "distanceM": v(m.distanceM),
            "calories": v(m.calories),
            "activeCalories": v(m.activeCalories),
            "speedKmh": v(m.speedKmh),
            "paceSecPerKm": v(m.paceSecPerKm),
            "stepRate": v(m.stepRate),
            "steps": v(m.steps),
            "cadence": v(m.cadence),
            "altitudeM": v(m.altitudeM),
            "riseM": v(m.riseM),
            "descentM": v(m.descentM),
            "aerobicTe": v(m.aerobicTe),
            "anaerobicTe": v(m.anaerobicTe),
            "fatGrams": s.estimator.fatGrams,
            "carbGrams": s.estimator.carbGrams,
            "fatShare": v(m.heartRate.map { SubstrateEstimator.fatShare(heartRate: $0, maxHeartRate: s.maxHeartRate) }),
            "endSuspected": s.endSuspected,
            "clockConfirmed": confirmed,
            "gpsRequested": s.gpsRequested,
            "location": v(located.map { ["lat": $0.latitude, "lon": $0.longitude, "accuracy": v($0.accuracy), "bearing": v($0.bearing)] as [String: Any] }),
            "locationAt": v(located.map { Double($0.timeMs) }),
            "gpsDistanceM": v(located.map { _ in track.distanceM }),
            "gpsRiseM": v(located.map { _ in track.riseM }),
            "gpsPaceSecPerKm": v(track.paceSecPerKm),
        ]
    }

    private func publish(force: Bool) {
        guard let (payload, status, justEnded) = lock.locked({ () -> ([String: Any], Status, Bool)? in
            guard var s = session else { return nil }
            let justEnded = s.status == .ended && !s.endReported
            if justEnded {
                s.endReported = true
                session = s
            }
            return (toJS(s), s.status, justEnded)
        }) else { return }
        events.liveWorkout(payload)
        if justEnded { onEnded() }
        // The heart-rate sensor is released once, however many pushes the ended workout still gets.
        if status == .ended {
            let first: Bool = lock.locked {
                defer { notifiedEnd = true }
                return force || !notifiedEnd
            }
            if first { setHeartRateActive(false) }
        } else {
            lock.locked { notifiedEnd = false }
        }
    }
}

#endif
