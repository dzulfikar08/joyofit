// The phone's GPS for a workout the watch asks it about (WorkoutLink.kt `startLocation`): a continuous, precise stream of fixes, and what is
// made of them (LiveGpsTrack.kt): the session's track, and how long the updates and the feed to the watch run. The seam keeps WorkoutLink
// testable without CoreLocation.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

public protocol LiveGpsSource: AnyObject, Sendable {
    var authorization: LocationAuthorization { get }
    /// Shows the system prompt when the user was never asked and returns the answer; returns at once otherwise.
    func requestAuthorization() async -> LocationAuthorization
    /// Starts delivering fixes to `onFix`; false when they cannot be had. Calling it while started replaces the handler.
    func start(_ onFix: @escaping @Sendable (WorkoutLinkWire.Fix) -> Void) -> Bool
    func stop()
}

/// A platform without location: never granted, never starts.
public final class UnavailableLiveGps: LiveGpsSource, @unchecked Sendable {
    public init() {}
    public var authorization: LocationAuthorization { .denied }
    public func requestAuthorization() async -> LocationAuthorization { .denied }
    public func start(_ onFix: @escaping @Sendable (WorkoutLinkWire.Fix) -> Void) -> Bool { false }
    public func stop() {}
}

/// Distance, climb and current speed of a workout from the phone's own GPS (LiveGpsTrack.kt `TrackAccumulator`), for the figures the watch
/// does not send (a watch that withdrew its GPS request, or a band without a GPS of its own, reports no distance or pace). Fed with the fixes
/// of the stretch the workout is running; the pauses are simply not fed.
///  - Fixes worse than `maxAccuracyM` are dropped, and a step shorter than `minStepM` from the last kept fix is jitter (the kept fix does not
///    move, so a slow drift still adds up once it is past the threshold).
///  - A jump faster than `maxSpeedMps` is a bad fix.
///  - The climb runs on a smoothed altitude (GPS altitude jumps by metres) with a `riseHysteresisM` dead band, so noise does not add up to
///    metres of "climb" while standing still.
///  - The current speed is the distance of the last `speedWindowMs`, once at least `speedMinSpanMs` of it is known.
public struct TrackAccumulator: Sendable {
    public static let maxAccuracyM = 30.0
    public static let minStepM = 3.0
    public static let maxSpeedMps = 30.0
    public static let altAlpha = 0.25
    public static let riseHysteresisM = 3.0
    public static let speedWindowMs: Int64 = 10_000
    public static let speedMinSpanMs: Int64 = 3_000
    /// Below this (about 1:00:00 per km) the person is standing and no pace is shown.
    public static let minPaceSpeedMps = 0.28
    public static let maxTrackPoints = 10_800

    public private(set) var distanceM = 0.0
    public private(set) var riseM = 0.0
    public private(set) var points: [WorkoutLinkWire.Fix] = []

    private var last: WorkoutLinkWire.Fix?
    private var smoothedAlt: Double?
    private var referenceAlt: Double?
    private var window: [(timeMs: Int64, distanceM: Double)] = []

    public init() {}

    /// Metres per second over the recent window, nil while there is not enough of it (or the person stands still: then 0).
    public var speedMps: Double? {
        guard let newest = window.last, let oldest = window.first else { return nil }
        let span = newest.timeMs - oldest.timeMs
        if span < Self.speedMinSpanMs { return nil }
        return (newest.distanceM - oldest.distanceM) / (Double(span) / 1000)
    }

    /// Seconds per kilometre of `speedMps`; nil when unknown or when standing (below `minPaceSpeedMps`, a pace would be meaningless).
    public var paceSecPerKm: Int? {
        guard let v = speedMps, v >= Self.minPaceSpeedMps else { return nil }
        return Int(1000 / v)
    }

    /// The workout was paused (or only starts now): the next fix begins a new stretch, nothing is added for the way in between.
    public mutating func gap() {
        last = nil
        window.removeAll()
    }

    /// Takes a fix of the running workout; false when it was dropped. `running` controls whether distance/climb/speed count; `keep` controls whether it is kept in points.
    @discardableResult
    public mutating func add(_ fix: WorkoutLinkWire.Fix, running: Bool = true, keep: Bool = true) -> Bool {
        if !fix.latitude.isFinite || !fix.longitude.isFinite || !(-90.0...90.0).contains(fix.latitude) || !(-180.0...180.0).contains(fix.longitude) {
            return false
        }
        if let accuracy = fix.accuracy, accuracy > Self.maxAccuracyM { return false }
        if !running {
            gap()
            if keep {
                recordPoint(fix)
            }
            return true
        }
        guard let prev = last else {
            last = fix
            if keep { recordPoint(fix) }
            window.append((fix.timeMs, distanceM))
            takeAltitude(fix)
            return true
        }
        let dtS = Double(fix.timeMs - prev.timeMs) / 1000
        if dtS <= 0 { return false }
        let step = prev.distance(to: fix)
        if step / dtS > Self.maxSpeedMps { return false }
        // The altitude and the speed window follow every good fix, the distance only a real step.
        takeAltitude(fix)
        if step < Self.minStepM {
            window.append((fix.timeMs, distanceM))
            trim(fix.timeMs)
            return true
        }
        distanceM += step
        last = fix
        if keep { recordPoint(fix) }
        window.append((fix.timeMs, distanceM))
        trim(fix.timeMs)
        return true
    }

    /// GeoJSON `[lon, lat]` coordinates for the live map trail, downsampled to at most `maxPoints`.
    public func trailCoordinates(maxPoints: Int = 500) -> [[Double]] {
        let n = points.count
        if n == 0 || maxPoints <= 0 { return [] }
        if n <= maxPoints { return points.map { [$0.longitude, $0.latitude] } }
        if maxPoints == 1, let p = points.last { return [[p.longitude, p.latitude]] }
        return (0 ..< maxPoints).map { i in
            let idx = (i * (n - 1)) / (maxPoints - 1)
            let p = points[idx]
            return [p.longitude, p.latitude]
        }
    }

    private mutating func recordPoint(_ fix: WorkoutLinkWire.Fix) {
        if let prevKept = points.last, fix.timeMs <= prevKept.timeMs { return }
        if points.count >= Self.maxTrackPoints {
            var compacted: [WorkoutLinkWire.Fix] = []
            compacted.reserveCapacity((points.count + 1) / 2)
            for i in stride(from: 0, to: points.count, by: 2) {
                compacted.append(points[i])
            }
            points = compacted
        }
        points.append(fix)
    }

    private mutating func trim(_ nowMs: Int64) {
        while window.count > 2, nowMs - window[0].timeMs > Self.speedWindowMs { window.removeFirst() }
    }

    private mutating func takeAltitude(_ fix: WorkoutLinkWire.Fix) {
        guard let alt = fix.altitude, alt.isFinite else { return }
        let smooth = smoothedAlt.map { $0 + Self.altAlpha * (alt - $0) } ?? alt
        smoothedAlt = smooth
        guard let ref = referenceAlt else {
            referenceAlt = smooth
            return
        }
        if smooth - ref >= Self.riseHysteresisM {
            riseM += smooth - ref
            referenceAlt = smooth
        } else if ref - smooth >= Self.riseHysteresisM {
            referenceAlt = smooth
        }
    }
}

/// Whether a watch that gives no sign of when its workout starts (it does not answer the `17/03` poll and sends no `17/11` report) has been
/// started: `fixes` fixes in a row at a walking pace or faster (LiveGpsTrack.kt `MotionStart`). The person standing on the watch's GO screen
/// does not move, so this does not start the clock early.
public struct MotionStart: Sendable {
    public static let fixes = 3
    public static let minSpeedMps = 1.0

    private var run = 0

    public init() {}

    /// True once the person has been moving for `fixes` good fixes in a row.
    public mutating func onFix(speedMps: Double?, accuracyM: Double?) -> Bool {
        let moving = (speedMps.map { $0 >= Self.minSpeedMps } ?? false) && (accuracyM.map { $0 <= TrackAccumulator.maxAccuracyM } ?? true)
        run = moving ? run + 1 : 0
        return run >= Self.fixes
    }
}

/// The phone's track of one live session (LiveGpsTrack.kt `SessionTrack`):
///  - every fix becomes the newest `location`, for the map, whatever state the session is in;
///  - only the fixes of a running stretch feed `track`: a fix while the watch only prepares (its GO screen, the GPS search, the countdown) or
///    while the workout is paused adds nothing;
///  - the switch to running begins a new stretch at the newest fix (`startStretch`).
/// Start fresh rather than buffer the preparing fixes: the clock starts at that same moment (docs/live-run.md, "state machine"), so the
/// distance and the time cover the same stretch and the average pace stays honest. A buffer would add the way to the start line, the pacing in
/// front of the GO screen or the `MotionStart` run-up, none of which is in the clock (nor in the watch's own figures).
public struct SessionTrack: Sendable {
    public static let anchorMaxAgeMs: Int64 = 5_000

    /// The newest fix, nil before the first.
    public private(set) var location: WorkoutLinkWire.Fix?
    /// Distance, climb and speed of the running stretches.
    public private(set) var track = TrackAccumulator()
    /// Counts fixes of a person on the move, for a watch that never says when its workout starts.
    private var motion = MotionStart()

    public init() {}

    /// Takes a fix. `running`: the session runs, so the fix counts. `keep`: kept for the map. `motionStarts`: the session prepares for a watch that gives no sign of its
    /// start, so movement is the start. Returns true when this fix completes that movement (`MotionStart`): the caller starts the session, which
    /// calls `startStretch`.
    public mutating func onFix(_ fix: WorkoutLinkWire.Fix, running: Bool, keep: Bool = true, motionStarts: Bool) -> Bool {
        if fix.latitude.isFinite, fix.longitude.isFinite, (-90.0...90.0).contains(fix.latitude), (-180.0...180.0).contains(fix.longitude) {
            location = fix
        }
        track.add(fix, running: running, keep: keep)
        return motionStarts && motion.onFix(speedMps: fix.speed, accuracyM: fix.accuracy)
    }

    /// The workout was paused: marks a gap so subsequent running fixes do not bridge distance across the pause.
    public mutating func pause() {
        track.gap()
    }

    /// The session runs, from preparing or again after a pause: nothing from before is joined to what follows. The newest fix, when it is at
    /// most `anchorMaxAgeMs` from `nowMs`, is where the new stretch starts, so the first second after the start is not lost; an older one is not
    /// where the person is now, and the next fix starts the stretch instead.
    public mutating func startStretch(nowMs: Int64) {
        track.gap()
        guard let newest = location else { return }
        if abs(nowMs - newest.timeMs) <= Self.anchorMaxAgeMs { track.add(newest) }
    }
}

/// The phone's location updates for a live workout and the `18/03` feed of them to the watch, as two lifetimes (LiveGpsTrack.kt
/// `PhoneGpsSession`, used by `WorkoutLink`):
///  - the watch's `18/02 {01: 1}` starts both; its `{01: 0}` stops only the feed. A watch with a GPS of its own withdraws its request once it
///    has a fix (Fit 4 Pro: 80 s into a walk, 2026-10-25) and sends no figures of its own, so the phone's track stays the only source of distance
///    and pace (docs/live-run.md);
///  - the updates stop when the live session ends (`sessionEnded`: Finish, the watch's stop, the status poll, the watchdog); when the request is
///    withdrawn with no live session to follow (a phone-started run, whose screen owns the watch's workout); and when the link is lost, unless
///    the session ends by itself without it (`linkLost`);
///  - a request after that starts both again.
/// `start` returns false when the updates cannot run (no permission): the watch's next request tries again. `feeding` has a lock of its own,
/// so a fix delivered on the main thread never waits for a start or a stop.
public final class PhoneGpsSession: @unchecked Sendable {
    public static let retryBackoffMs: Int64 = 60_000

    private let lock = NSLock()
    private let feedLock = NSLock()
    private let start: () -> Bool
    private let stop: () -> Void
    private var tracking = false
    private var _feeding = false
    private var lastFailedStartMs: Int64 = 0

    public init(start: @escaping () -> Bool, stop: @escaping () -> Void) {
        self.start = start
        self.stop = stop
    }

    /// The fixes also go to the watch.
    public var feeding: Bool { feedLock.locked { _feeding } }

    /// The phone's location updates run.
    public var isTracking: Bool { lock.locked { tracking } }

    /// `18/02 {01: 1}`.
    public func watchAsks() {
        lock.locked {
            setFeeding(true)
            if !tracking {
                tracking = start()
                if !tracking { lastFailedStartMs = Int64(Date().timeIntervalSince1970 * 1000) }
            }
        }
    }

    /// Starts phone GPS tracking for an active outdoor live workout even when the wearable has not sent `18/02` (for example a Huawei Band
    /// whose workout was discovered via `17/03`, `17/11`, or `37/02`, or started from the phone). Does not turn on the `18/03` feed unless
    /// the watch explicitly asked via `watchAsks`.
    public func sessionNeedsGps(nowMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) {
        lock.locked {
            if !tracking {
                if nowMs - lastFailedStartMs < Self.retryBackoffMs { return }
                tracking = start()
                if !tracking { lastFailedStartMs = nowMs }
            }
        }
    }

    /// `18/02 {01: 0}`: the feed stops; the updates go on while `liveSession` (a live workout is followed).
    public func watchWithdraws(liveSession: Bool) {
        lock.locked {
            setFeeding(false)
            if !liveSession { stopTracking() }
        }
    }

    /// The link to the watch is gone: nothing to feed. The updates go on only while `sessionEndsWithoutLink`: a live session that ends by itself
    /// when the watch goes quiet (`LiveWorkout.endsWithoutLink`, the GPS-request session and its watchdog). Any other session would only end on
    /// Finish, so the updates stop now, and the watch's next request after a reconnect starts them again.
    public func linkLost(sessionEndsWithoutLink: Bool) { watchWithdraws(liveSession: sessionEndsWithoutLink) }

    /// The live session ended: everything stops.
    public func sessionEnded() {
        lock.locked {
            setFeeding(false)
            stopTracking()
        }
    }

    private func setFeeding(_ on: Bool) { feedLock.locked { _feeding = on } }

    /// Callers hold `lock`.
    private func stopTracking() {
        lastFailedStartMs = 0
        if !tracking { return }
        tracking = false
        stop()
    }
}
