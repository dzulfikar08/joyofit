// Port of LiveWorkout.kt: a workout on the watch, followed live on the phone. Two sources:
//  - the watch's own numbers, when it sends them (Huawei Health's reverse linkage `LiveWorkoutWire`, or the `17/11` report);
//  - otherwise JoyoFit's own session (`gps` / `status` / `manual`): the Fit 4 Pro (6.1.0.117) sends neither, but asks for the phone's GPS about
//    every 20 s while an outdoor workout runs, answers the `17/03` status poll, and pushes realtime heart rate when asked. The session runs on
//    that heart rate: time from the phone, calories from `HeartRateEnergy`. It ends when the status poll says "no workout"
//    `idleAnswersToEnd` times in a row with no GPS request for `gpsSilenceMs`, on GPS silence alone only if the poll is not answered, or when
//    the user taps Finish.
// Either way it keeps JoyoFit's fat and carbohydrate estimate (`SubstrateEstimator`) and reports every change to JS (`onLiveWorkout`).
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

    public enum Status: String, Sendable { case preparing, running, paused, ended }

    /// Where the numbers come from: the watch, or JoyoFit's heart-rate session started by the GPS requests, the status poll or by hand.
    public enum Source: String, Sendable { case watch, gps, status, manual }

    /// Age used for the maximum heart rate when no profile is saved (220 - 35 = 185 bpm).
    public static let defaultAge = 35
    /// Weight for the heart-rate energy estimate when no profile is saved.
    public static let defaultWeightKg = 70.0
    /// No GPS request for this long counts as GPS silence (the watch asks about every 20 s until its own GPS has a fix).
    public static let gpsSilenceMs: Int64 = 120_000
    /// "No workout" answers in a row (one per 30 s poll) that end a phone-side session.
    public static let idleAnswersToEnd = 2
    /// No status answer for this long means the poll stopped (the watch does not answer 17/03).
    public static let statusStaleMs: Int64 = 90_000
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
        /// The phone's GPS for this session: the newest fix for the map, and distance, climb and speed from the fixes of the running stretches.
        var phoneTrack = SessionTrack()
        /// `onEnded` was called for this session.
        var endReported = false

        /// Moves the session to `status`; the switch to running begins a new stretch of the phone's track, so the stretch before a pause (or
        /// the pre-start walk) and the one after it are not joined into one step.
        mutating func setStatus(_ status: Status, nowMs: Int64) {
            if self.status == status { return }
            if status == .running { phoneTrack.startStretch(nowMs: nowMs) }
            self.status = status
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

    /// Whether a live session of `source` ends by itself once the watch is gone (LiveWorkoutPolicy.kt `endsWithoutLink`): only the GPS-request
    /// session has the watchdog for that (`gpsSilenceMs` without a request and `statusStaleMs` without a status answer); the others end on the
    /// watch's word or Finish. Decides whether the phone's GPS survives a lost link.
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
            s.status = .ended
            s.updatedAtMs = nowMs()
            s.endedAtMs = s.updatedAtMs
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

    /// Realtime heart rate from the watch: drives a phone-side session; a watch-fed one has its own heart rate.
    public func onHeartRate(_ bpm: Int) {
        let updated: Bool = lock.locked {
            guard var s = session, s.status == .running, s.source != .watch else { return false }
            let now = nowMs()
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
            s.metrics.durationSec = Int(Int32(truncatingIfNeeded: (now - s.id) / 1000))
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
        case LiveWorkoutWire.eventStart: change(LiveWorkoutWire.parseWorkoutType(event.data), .running, "started")
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

    private func change(_ workoutType: Int?, _ status: Status, _ what: String) {
        let proceed: Bool = lock.locked {
            if var current = session, !(current.status == .ended && status != .ended) {
                if let workoutType { current.sportType = workoutType }
                if current.status == .ended { session = current; return false }
                current.updatedAtMs = nowMs()
                current.setStatus(status, nowMs: current.updatedAtMs)
                if status == .ended { current.endedAtMs = current.updatedAtMs }
                session = current
            } else {
                // A pause or resume without a known start (the app started mid-workout) still opens a session.
                session = newSession(workoutType, status)
            }
            return true
        }
        if !proceed { return }
        log("Live workout: \(what) (type \(workoutType.map(String.init) ?? "null"))")
        publish(force: true)
    }

    private func onPoint(_ point: SamplePointIn) {
        if mirrorBlocked() { return }
        lock.locked {
            var current = watchSession()
            let metrics = current.metrics.applyPoint(point.values)
            current.metrics = metrics
            current.updatedAtMs = nowMs()
            current.estimator.update(totalCalories: metrics.calories, heartRate: metrics.heartRate)
            let fromStream: Status?
            switch metrics.watchState {
            case 1: fromStream = .running
            case 2: fromStream = .paused
            case 3: fromStream = .ended
            default: fromStream = nil
            }
            if let fromStream, fromStream != current.status, current.status != .ended {
                current.setStatus(fromStream, nowMs: current.updatedAtMs)
                if fromStream == .ended { current.endedAtMs = current.updatedAtMs }
            }
            session = current
        }
        publish(force: false)
    }

    /// The watch's answer to the 30 s status poll (`17/03`): starts a heart-rate session for a running workout (indoor ones included), follows
    /// pause and resume, and ends a session it or the GPS requests started once the watch is idle.
    public func watchStatus(running: Bool, paused: Bool, workoutType: Int?) {
        if mirrorBlocked() { return }
        var created = false
        var ended = false
        var changed = false
        var idle = 0
        lock.locked {
            let now = nowMs()
            lastStatusAtMs = now
            idleAnswers = running ? 0 : idleAnswers + 1
            idle = idleAnswers
            let existing = session.flatMap { $0.status != .ended ? $0 : nil }
            if running, existing == nil {
                session = newSession(workoutType, paused ? .paused : .running, .status)
                created = true
            } else if running, var s = existing {
                if let workoutType, s.sportType == nil { s.sportType = workoutType }
                if s.source != .watch {
                    let want: Status = paused ? .paused : .running
                    if s.status != want {
                        s.setStatus(want, nowMs: now)
                        // A pause must not count as workout time once resumed.
                        s.lastHeartRateAtMs = nil
                        changed = true
                    }
                }
                session = s
            } else if !running, let s = existing, s.source == .status || s.source == .gps {
                // One idle answer is not enough to end a workout the user is still doing, and a watch still asking for the phone's GPS is
                // running one whatever the poll says.
                ended = idleAnswers >= Self.idleAnswersToEnd && now - s.lastGpsAtMs > Self.gpsSilenceMs
            }
        }
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

    /// The watch asked for the phone's GPS: an outdoor workout is running (the request repeats about every 20 s).
    public func gpsPing() {
        if mirrorBlocked() { return }
        let created: Bool = lock.locked {
            if var s = session, s.status != .ended {
                s.lastGpsAtMs = nowMs()
                session = s
                return false
            }
            var fresh = newSession(nil, .running, .gps)
            fresh.lastGpsAtMs = fresh.id
            session = fresh
            return true
        }
        if !created { return }
        log("Live workout: running on the watch (it asked for the phone's GPS); following its heart rate")
        setHeartRateActive(true)
        lock.locked {
            watchdog?.cancel()
            watchdog = Task { [weak self] in
                while !Task.isCancelled {
                    guard let every = self?.watchdogEveryMs else { return }
                    try? await Task.sleep(nanoseconds: UInt64(every) * 1_000_000)
                    if Task.isCancelled { return }
                    guard let self else { return }
                    let silent: Bool = self.lock.locked {
                        guard let s = self.session else { return false }
                        let now = self.nowMs()
                        // The watch stops asking once its own GPS has a fix, so silence alone says nothing while the status poll answers;
                        // then the poll decides. Silence ends the session only on watches that do not answer the poll.
                        return s.source == .gps && s.status != .ended && now - s.lastGpsAtMs > Self.gpsSilenceMs && now - self.lastStatusAtMs > Self.statusStaleMs
                    }
                    if silent { self.end("the watch stopped asking for GPS and does not answer the status poll") }
                }
            }
        }
        publish(force: true)
    }

    /// A `17/11` realtime report (`WorkoutReport`); operator type 1 running, 2 paused, 3 resumed, 4 stopped.
    public func onReport(_ report: WorkoutReport) {
        if mirrorBlocked() { return }
        lock.locked {
            reportsSeen = true
            var current = watchSession()
            let metrics = report.apply(to: current.metrics)
            current.metrics = metrics
            current.updatedAtMs = nowMs()
            current.estimator.update(totalCalories: metrics.calories, heartRate: metrics.heartRate)
            switch report.operatorType {
            case 1, 3: current.setStatus(.running, nowMs: current.updatedAtMs)
            case 2: current.setStatus(.paused, nowMs: current.updatedAtMs)
            case 4:
                current.setStatus(.ended, nowMs: current.updatedAtMs)
                current.endedAtMs = current.updatedAtMs
            default: break
            }
            session = current
        }
        publish(force: false)
    }

    /// A fix of the phone's GPS (LiveWorkout.kt `onLocation`). It runs from the watch's first GPS request to the end of the session, also after
    /// the watch stopped asking (`PhoneGpsSession`). Kept for the map; while the workout runs it also feeds the phone's own distance, climb and
    /// speed (`SessionTrack`), which JS shows when the watch sends none. Fixes while the session prepares or is paused count nothing. A watch
    /// that never says when its workout starts (no `17/03` answer, no `17/11` report) has no other sign than the person moving: `MotionStart`
    /// starts the session then.
    public func onLocation(_ fix: WorkoutLinkWire.Fix) {
        if mirrorBlocked() { return }
        let outcome: (live: Bool, started: Bool) = lock.locked {
            guard var s = session, s.status != .ended else { return (false, false) }
            let silentWatch = lastStatusAtMs == 0 && !reportsSeen && s.source != .watch
            let moving = s.phoneTrack.onFix(fix, running: s.status == .running, motionStarts: s.status == .preparing && silentWatch)
            if moving {
                let now = nowMs()
                s.setStatus(.running, nowMs: now)
                s.updatedAtMs = now
            }
            session = s
            return (true, moving)
        }
        if !outcome.live { return }
        if outcome.started { log("Live workout: the watch gives no sign of a start; the person is moving") }
        publish(force: outcome.started)
    }

    /// The session watch numbers go into. A phone-side session is replaced by a watch-fed one with the same id, because the watch's cumulative
    /// calories and its estimate would otherwise be mixed. Callers hold `lock`.
    private func watchSession() -> Session {
        let current = session.flatMap { $0.status != .ended ? $0 : nil }
        if let current, current.source == .watch { return current }
        var fresh = newSession(current?.sportType, .running, .watch, id: current?.id)
        if let current {
            // The phone's own GPS follows the session whoever feeds the numbers; a session that did not run yet starts its stretch now.
            fresh.phoneTrack = current.phoneTrack
            if current.status != .running { fresh.phoneTrack.startStretch(nowMs: fresh.updatedAtMs) }
        }
        session = fresh
        if current != nil { log("Live workout: the watch sends its own numbers; using them instead of the heart-rate estimate") }
        return fresh
    }

    private func newSession(_ workoutType: Int?, _ status: Status, _ source: Source = .watch, id: Int64? = nil) -> Session {
        let now = nowMs()
        let birthYear = settings.profile?.birthYear
        let age = (birthYear.flatMap { $0 > 0 ? $0 : nil }).map { ProfileSender.age(birthYear: $0, now: Date(timeIntervalSince1970: Double(now) / 1000)) } ?? Self.defaultAge
        let maxHr = SubstrateEstimator.maxHeartRate(age: age)
        return Session(
            id: id ?? now, sportType: workoutType, status: status, estimator: SubstrateEstimator(maxHeartRate: maxHr), maxHeartRate: maxHr, updatedAtMs: now,
            source: source
        )
    }

    private func toJS(_ s: Session) -> [String: Any] {
        let m = s.metrics
        let located = s.phoneTrack.location
        let track = s.phoneTrack.track
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
