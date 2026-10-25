// Port of LiveWorkoutPolicy.kt: the pure decisions of a live workout followed on the phone (`LiveWorkout`), so they are tested without a watch.
import Foundation

/// State of a live workout on the phone (LiveWorkout.kt `Status`); `LiveWorkout.Status` is this type.
public enum LiveWorkoutStatus: String, Sendable { case preparing, running, paused, ended }

/// Workout time of a phone-side live session (`LiveWorkout`): counted from the moment the watch really started the workout, without the pauses,
/// frozen once it ends.
public struct WorkoutClock: Sendable {
    private var startedAtMs: Int64?
    private var pausedAtMs: Int64?
    private var pausedTotalMs: Int64 = 0

    public init() {}

    public var started: Bool { startedAtMs != nil }

    public mutating func start(_ nowMs: Int64) {
        if startedAtMs == nil { startedAtMs = nowMs }
    }

    public mutating func pause(_ nowMs: Int64) {
        start(nowMs)
        if pausedAtMs == nil { pausedAtMs = nowMs }
    }

    public mutating func resume(_ nowMs: Int64) {
        guard let since = pausedAtMs else {
            start(nowMs)
            return
        }
        pausedTotalMs += max(nowMs - since, 0)
        pausedAtMs = nil
    }

    /// Whole seconds of workout time at `nowMs`, nil before the workout started.
    public func seconds(_ nowMs: Int64) -> Int? {
        guard let start = startedAtMs else { return nil }
        let end = pausedAtMs ?? nowMs
        return Int(max(end - start - pausedTotalMs, 0) / 1000)
    }
}

/// What the watch's `17/03` answer says about its workout. The answer is `81{02 trainMonitorState, 03 operatorType, [04 sport], [06 workout
/// type]}` (Huawei Health 17.0.8.300 `HwLinkageServiceManager.handleGetOperatorStatusTlvData`). Huawei Health reads tag 02 as "the watch is busy
/// with a workout" (`dfj.getDeviceBusyStatus`; `MyPlanInfoAdapter`: 0 is "device is not running"); JoyoFit read only tag 03 before.
/// Observed on the Fit 4 Pro 6.1.0.117 (2026-10-25, Outdoor walk, the owner's times; `docs/live-run.md`):
///  - `02 00, 03 00`: nothing open, also once the workout is finished (`idle`);
///  - `02 00, 03 01`: the workout's pre-start (GO) screen is open (it comes with the first GPS request, `18/02` and `18/08` `{01: 1}`); read by
///    tag 03 alone it looked like a running workout and started the phone's clock before GO (`open`);
///  - `02 01, 03 03`: running, from GO on (17:43:50, 6 s after the screen opened) (`running`);
///  - `02 01, 03 04`: paused (17:44:50) (`paused`); `02 01, 03 05`: running again after a resume (17:45:10) (`running`);
///  - the finish: `18/08 {01: 0}` (17:45:33), then `02 00, 03 00` (17:45:40).
/// Tag 02 is 1 from GO to the finish. With it, tag 03 is the watch's own phase (1 open, 3 running, 4 paused, 5 resumed), not the `17/02`
/// operators (1 start, 2 pause, 3 resume, 4 stop): the old reading took the pause (4) and the resume (5) for "no workout" and ended the phone's
/// session 20 s into the pause. Operator 2 with tag 02 set is read as a pause too (not seen). A watch that sends no tag 02 is read by the `17/02`
/// operators, as before: 1 or 3 running, 2 paused, anything else no workout.
public enum WatchPhase: Sendable, Equatable {
    case idle, open, running, paused

    public static func of(trainMonitorState: Int?, operator op: Int?) -> WatchPhase {
        guard let trainMonitorState else {
            switch op {
            case 1, 3: return .running
            case 2: return .paused
            default: return .idle
            }
        }
        // Tag 02 set with operator 0 or 1 (not seen): read like tag 02 = 0, idle and the GO screen.
        if op == nil || op == 0 { return .idle }
        if op == 1 { return .open }
        if trainMonitorState != 0 { return op == 2 || op == 4 ? .paused : .running }
        return .open
    }
}

/// When a phone-side session may start counting and when it ends, from what the watch reports. The watch asks for the phone's GPS (`18/02`) from
/// the moment its workout screen starts looking for a fix, which is before the workout runs, so a GPS request alone is only "preparing"; the
/// `17/03` status poll (`WatchPhase`, or the watch's own numbers) says when it runs.
public enum LiveWorkoutPolicy {
    /// "No workout" answers in a row that end a session (one per status poll, every `livePollMs` while a session is live).
    public static let idleAnswersToEnd = 3
    /// Status poll period while no workout is followed.
    public static let idlePollMs: Int64 = 30_000
    /// Status poll period while a session is live, so a stop on the watch reaches the phone in about 15 s.
    public static let livePollMs: Int64 = 5_000
    /// Status poll period while a session waits for GO on the watch: the phone's clock starts at most this late.
    public static let preparingPollMs: Int64 = 2_000
    /// The watch closed its workout screen (`18/08 {01: 0}`) this recently: one "no workout" answer is enough to end.
    public static let screenClosedMs: Int64 = 60_000
    /// No GPS request for this long counts as GPS silence (the watch asks about every 20 s until its own GPS has a fix).
    public static let gpsSilenceMs: Int64 = 120_000
    /// A session still preparing (the watch never started the workout) is dropped after this much GPS silence.
    public static let preparingSilenceMs: Int64 = 60_000
    /// No status answer for this long means the poll is not answered (the watch does not support 17/03, or the link is quiet).
    public static let statusStaleMs: Int64 = 90_000
    /// With no status answers at all, silence this long ends the session when the user did not answer the prompt.
    public static let giveUpMs: Int64 = 300_000
    /// Frames of a workout that just ended are ignored for this long, so late numbers do not open a second session.
    public static let restartGuardMs: Int64 = 60_000
    /// The watch's own numbers stopped for this long while it says "no workout": the stop frame was lost.
    public static let framesStaleMs: Int64 = 30_000

    public enum Verdict: Sendable, Equatable { case keep, suspect, end }

    /// How often to ask the status for a session in `status` (nil or ended: none followed).
    public static func pollEveryMs(_ status: LiveWorkoutStatus?) -> Int64 {
        switch status {
        case .preparing: return preparingPollMs
        case .running, .paused: return livePollMs
        default: return idlePollMs
        }
    }

    /// The state a phone-side session in `current` moves to on a `17/03` answer of `phase`; nil: no change (`idle` is `idleVerdict`'s). `open`
    /// (the watch is not counting, its workout screen is open) keeps a session that waits for GO waiting, and pauses one that ran: the watch's
    /// clock stopped, whether paused or back on its start screen, so the phone's stops too.
    public static func statusTarget(_ current: LiveWorkoutStatus, _ phase: WatchPhase) -> LiveWorkoutStatus? {
        switch phase {
        case .running: return .running
        case .paused: return .paused
        case .open: return current == .running ? .paused : nil
        case .idle: return nil
        }
    }

    /// One status answer said "no workout" for the `idleAnswers`th time in a row, for a phone-side session.
    ///  - `screenClosed`: the watch said it closed its workout screen (`screenClosedMs`, `18/08 {01: 0}`), and the poll agrees: end at once (the
    ///    finish on the watch reaches the phone within seconds, not after three answers);
    ///  - `preparing`: the watch never started the workout; once its GPS requests stopped it was left, so end it;
    ///  - `confirmed`: the watch itself said the workout was running and now says it is not: end;
    ///  - otherwise the poll alone never confirmed the workout, so a watch that still asks for GPS keeps it (`suspect` asks the user), and one that
    ///    stopped asking ends it.
    public static func idleVerdict(preparing: Bool, confirmed: Bool, idleAnswers: Int, msSinceGps: Int64, screenClosed: Bool = false) -> Verdict {
        if screenClosed && idleAnswers >= 1 { return .end }
        if idleAnswers < idleAnswersToEnd { return .keep }
        if preparing { return msSinceGps > preparingSilenceMs ? .end : .keep }
        if confirmed { return .end }
        return msSinceGps > gpsSilenceMs ? .end : .suspect
    }

    /// Whether a GPS request `msSinceEnd` after a session ended opens a new one. Within `restartGuardMs` it is taken for a straggler of the
    /// workout that ended, unless that session never ran (`endedRan` false: the person left the GO screen, the close ended it, and came back) or
    /// the watch said its workout screen opened again since (`screenReopened`, `18/08 {01: 1}`). Without this the next GO would be seen only at
    /// the 30 s idle poll.
    public static func gpsReopens(msSinceEnd: Int64, endedRan: Bool, screenReopened: Bool) -> Bool {
        msSinceEnd >= restartGuardMs || !endedRan || screenReopened
    }

    /// The GPS requests of a GPS-started session stopped, for `msSinceGps`. While the status poll answers it decides; with no answers the
    /// watch's own silence is all there is: ask the user first, end by itself only much later.
    public static func silenceVerdict(preparing: Bool, msSinceGps: Int64, msSinceStatus: Int64) -> Verdict {
        if msSinceStatus <= statusStaleMs { return .keep }
        if preparing { return msSinceGps > preparingSilenceMs ? .end : .keep }
        if msSinceGps > giveUpMs { return .end }
        if msSinceGps > gpsSilenceMs { return .suspect }
        return .keep
    }

    /// Whether a frame with the watch's own numbers is a workout that really runs: a running or paused state, or time on the clock. A frame of a
    /// workout that is only being prepared (zeros, no state) must not start the timer.
    public static func isRunningFrame(running: Bool, durationSec: Int?) -> Bool { running || (durationSec ?? 0) > 0 }

    /// A frame that opens a workout (state running, a few seconds on the clock), not a straggler of the one that ended.
    public static func isFreshStart(running: Bool, durationSec: Int?) -> Bool { running && (durationSec ?? 0) < 10 }

    /// A session fed by the watch's own numbers ends on the watch's stop frame; with the frames silent and the status poll idle `idleAnswersToEnd`
    /// times in a row, a lost stop frame does not leave it running. One that only prepares gets `giveUpMs` (the watch may search for GPS for
    /// minutes).
    public static func watchFedEnds(preparing: Bool, idleAnswers: Int, msSinceFrame: Int64) -> Bool {
        idleAnswers >= idleAnswersToEnd && msSinceFrame > (preparing ? giveUpMs : framesStaleMs)
    }
}
