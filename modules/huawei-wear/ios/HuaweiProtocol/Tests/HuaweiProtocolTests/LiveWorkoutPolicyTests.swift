import XCTest
@testable import HuaweiProtocol

/// Translation of Kotlin LiveWorkoutPolicyTest.
final class LiveWorkoutPolicyTests: XCTestCase {
    private typealias P = LiveWorkoutPolicy

    func testClockIsEmptyUntilTheWorkoutStarts() {
        let clock = WorkoutClock()
        XCTAssertNil(clock.seconds(1_000_000))
        XCTAssertFalse(clock.started)
    }

    func testClockCountsFromTheStartNotFromTheGpsSearch() {
        var clock = WorkoutClock()
        // GPS search began at t=0 (nothing counted); the watch reports the workout running at t=90 s.
        clock.start(90_000)
        XCTAssertEqual(clock.seconds(90_000), 0)
        XCTAssertEqual(clock.seconds(120_500), 30)
    }

    func testClockLeavesPausesOut() {
        var clock = WorkoutClock()
        clock.start(0)
        clock.pause(60_000)
        XCTAssertEqual(clock.seconds(300_000), 60)
        clock.resume(300_000)
        XCTAssertEqual(clock.seconds(310_000), 70)
        // A second pause call while paused does not move the pause point.
        clock.pause(320_000)
        clock.pause(400_000)
        XCTAssertEqual(clock.seconds(500_000), 80)
    }

    func testClockFreezesWhenTheWorkoutEnds() {
        var clock = WorkoutClock()
        clock.start(0)
        clock.pause(45_000)
        XCTAssertEqual(clock.seconds(10_000_000), 45)
    }

    func testResumeBeforeStartStartsTheClock() {
        var clock = WorkoutClock()
        clock.resume(5_000)
        XCTAssertTrue(clock.started)
        XCTAssertEqual(clock.seconds(7_500), 2)
    }

    func testPauseBeforeStartIsAFrozenZero() {
        var clock = WorkoutClock()
        clock.pause(5_000)
        XCTAssertEqual(clock.seconds(50_000), 0)
    }

    func testASessionStillSearchingForGpsIsNotEndedByIdleAnswersWhileTheWatchAsks() {
        XCTAssertEqual(P.idleVerdict(preparing: true, confirmed: false, idleAnswers: 9, msSinceGps: 20_000), .keep)
    }

    func testASearchTheWatchGaveUpIsDropped() {
        XCTAssertEqual(P.idleVerdict(preparing: true, confirmed: false, idleAnswers: 3, msSinceGps: 61_000), .end)
        XCTAssertEqual(P.idleVerdict(preparing: true, confirmed: false, idleAnswers: 2, msSinceGps: 61_000), .keep)
    }

    func testAWorkoutTheWatchConfirmedEndsOnIdleAnswersEvenWhileGpsRequestsContinue() {
        XCTAssertEqual(P.idleVerdict(preparing: false, confirmed: true, idleAnswers: 2, msSinceGps: 5_000), .keep)
        XCTAssertEqual(P.idleVerdict(preparing: false, confirmed: true, idleAnswers: 3, msSinceGps: 5_000), .end)
    }

    func testAnUnconfirmedWorkoutThatStillAsksForGpsPromptsInsteadOfEnding() {
        XCTAssertEqual(P.idleVerdict(preparing: false, confirmed: false, idleAnswers: 3, msSinceGps: 30_000), .suspect)
        XCTAssertEqual(P.idleVerdict(preparing: false, confirmed: false, idleAnswers: 3, msSinceGps: 130_000), .end)
    }

    func testSilenceDefersToAStatusPollThatAnswers() {
        XCTAssertEqual(P.silenceVerdict(preparing: false, msSinceGps: 500_000, msSinceStatus: 30_000), .keep)
    }

    func testSilenceWithoutStatusAnswersPromptsThenEnds() {
        let stale = P.statusStaleMs + 1
        XCTAssertEqual(P.silenceVerdict(preparing: false, msSinceGps: 60_000, msSinceStatus: stale), .keep)
        XCTAssertEqual(P.silenceVerdict(preparing: false, msSinceGps: 121_000, msSinceStatus: stale), .suspect)
        XCTAssertEqual(P.silenceVerdict(preparing: false, msSinceGps: 301_000, msSinceStatus: stale), .end)
    }

    func testAPreparingSessionWithNothingToWaitForIsDropped() {
        let stale = P.statusStaleMs + 1
        XCTAssertEqual(P.silenceVerdict(preparing: true, msSinceGps: 61_000, msSinceStatus: stale), .end)
        XCTAssertEqual(P.silenceVerdict(preparing: true, msSinceGps: 30_000, msSinceStatus: stale), .keep)
    }

    func testAFrameOfAWorkoutThatOnlyPreparesDoesNotStartTheTimer() {
        XCTAssertFalse(P.isRunningFrame(running: false, durationSec: 0))
        XCTAssertFalse(P.isRunningFrame(running: false, durationSec: nil))
        XCTAssertTrue(P.isRunningFrame(running: true, durationSec: nil))
        XCTAssertTrue(P.isRunningFrame(running: false, durationSec: 3))
    }

    func testOnlyAFreshStartPassesTheGuardAfterAWorkoutEnded() {
        XCTAssertTrue(P.isFreshStart(running: true, durationSec: 2))
        XCTAssertTrue(P.isFreshStart(running: true, durationSec: nil))
        XCTAssertFalse(P.isFreshStart(running: true, durationSec: 1_800))
        XCTAssertFalse(P.isFreshStart(running: false, durationSec: 0))
    }

    func testAWatchFedSessionWithALostStopEndsOnceFramesAndPollAgree() {
        XCTAssertFalse(P.watchFedEnds(preparing: false, idleAnswers: 2, msSinceFrame: 60_000))
        XCTAssertFalse(P.watchFedEnds(preparing: false, idleAnswers: 3, msSinceFrame: 5_000))
        XCTAssertTrue(P.watchFedEnds(preparing: false, idleAnswers: 3, msSinceFrame: 31_000))
        // A countdown or GPS search on the watch has no frames and an idle poll: it waits much longer.
        XCTAssertFalse(P.watchFedEnds(preparing: true, idleAnswers: 9, msSinceFrame: 120_000))
        XCTAssertTrue(P.watchFedEnds(preparing: true, idleAnswers: 9, msSinceFrame: 301_000))
    }

    func testStatusPhasesAsTheFit4ProAnswered() {
        // 2026-10-25 17:43, Outdoor walk on a Fit 4 Pro 6.1.0.117: GO at once, pause, resume after 20 s, finish (owner's times;
        // `Workout link: workout status {tag: 81 - Value: ...}`).
        XCTAssertEqual(WatchPhase.of(trainMonitorState: 0, operator: 1), .open) // 020100030101 17:43:44, pre-start screen
        XCTAssertEqual(WatchPhase.of(trainMonitorState: 1, operator: 3), .running) // 020101030103 17:43:50, GO
        XCTAssertEqual(WatchPhase.of(trainMonitorState: 1, operator: 4), .paused) // 020101030104 17:44:50, pause
        XCTAssertEqual(WatchPhase.of(trainMonitorState: 1, operator: 5), .running) // 020101030105 17:45:10, resume
        XCTAssertEqual(WatchPhase.of(trainMonitorState: 0, operator: 0), .idle) // 020100030100 17:45:40, after the finish
        // Not seen, read safely: a pause in the 17/02 numbering, an answer without an operator.
        XCTAssertEqual(WatchPhase.of(trainMonitorState: 1, operator: 2), .paused)
        XCTAssertEqual(WatchPhase.of(trainMonitorState: 1, operator: 1), .open)
        XCTAssertEqual(WatchPhase.of(trainMonitorState: 1, operator: 0), .idle)
        XCTAssertEqual(WatchPhase.of(trainMonitorState: 0, operator: nil), .idle)
        // A watch that sends no tag 02: the 17/02 operators, as before.
        XCTAssertEqual(WatchPhase.of(trainMonitorState: nil, operator: 1), .running)
        XCTAssertEqual(WatchPhase.of(trainMonitorState: nil, operator: 3), .running)
        XCTAssertEqual(WatchPhase.of(trainMonitorState: nil, operator: 2), .paused)
        XCTAssertEqual(WatchPhase.of(trainMonitorState: nil, operator: 4), .idle)
        XCTAssertEqual(WatchPhase.of(trainMonitorState: nil, operator: nil), .idle)
    }

    /// The phone-side session states a run of status answers leads to, from a session the GPS request opened (preparing).
    private func follow(_ phases: WatchPhase...) -> [LiveWorkoutStatus] {
        var status = LiveWorkoutStatus.preparing
        return phases.map { phase in
            if let next = P.statusTarget(status, phase) { status = next }
            return status
        }
    }

    func testTheGoScreenDoesNotStartTheClockGoDoes() {
        let s = LiveWorkoutStatus.preparing, r = LiveWorkoutStatus.running, p = LiveWorkoutStatus.paused
        // The 17:43 probe, polled: pre-start screen, GO, running, pause, resume (05). Before this change the first OPEN answer started the
        // clock, and the pause (04) and resume (05) counted as "no workout": the session ended 20 s into the pause.
        XCTAssertEqual(follow(.open, .running, .running, .paused, .paused, .running), [s, r, r, p, p, r])
        // A watch that stops counting but keeps its workout screen open (a pause told only by tag 02) pauses the phone too.
        XCTAssertEqual(follow(.running, .open, .running), [r, p, r])
        // Idle answers move nothing here: the end is idleVerdict's.
        XCTAssertNil(P.statusTarget(.running, .idle))
    }

    func testAClosedWorkoutScreenEndsOnTheFirstIdleAnswer() {
        // Finish on the Fit 4 Pro: 18/08 {01: 0} at 17:45:33, then 17/03 idle at 17:45:40. One answer is enough.
        XCTAssertEqual(P.idleVerdict(preparing: false, confirmed: true, idleAnswers: 1, msSinceGps: 5_000, screenClosed: true), .end)
        // The person left the GO screen without starting: ends too, even with a GPS request seconds ago.
        XCTAssertEqual(P.idleVerdict(preparing: true, confirmed: false, idleAnswers: 1, msSinceGps: 1_000, screenClosed: true), .end)
        // Without the close, one idle answer is not enough.
        XCTAssertEqual(P.idleVerdict(preparing: false, confirmed: true, idleAnswers: 1, msSinceGps: 5_000), .keep)
        XCTAssertEqual(P.idleVerdict(preparing: false, confirmed: true, idleAnswers: 3, msSinceGps: 5_000), .end)
    }

    func testLeavingTheGoScreenAndComingBackIsNoStraggler() {
        // open -> close (18/08 {01: 0}) -> one idle answer ends the preparing session -> open again 20 s later: a new session, so GO is seen at
        // the 2 s poll and not only at the 30 s idle one.
        XCTAssertEqual(P.idleVerdict(preparing: true, confirmed: false, idleAnswers: 1, msSinceGps: 1_000, screenClosed: true), .end)
        XCTAssertTrue(P.gpsReopens(msSinceEnd: 20_000, endedRan: false, screenReopened: false))
        // Then the status sequence of the new session: GO screen, GO.
        XCTAssertEqual(follow(.open, .running), [.preparing, .running])
        // A workout that ran and just ended: a late request is a straggler, unless the watch opened its workout screen again.
        XCTAssertFalse(P.gpsReopens(msSinceEnd: 20_000, endedRan: true, screenReopened: false))
        XCTAssertTrue(P.gpsReopens(msSinceEnd: 20_000, endedRan: true, screenReopened: true))
        XCTAssertTrue(P.gpsReopens(msSinceEnd: P.restartGuardMs, endedRan: true, screenReopened: false))
    }

    func testTheStatusIsAskedFastWhileWaitingForGo() {
        XCTAssertEqual(P.pollEveryMs(.preparing), P.preparingPollMs)
        XCTAssertEqual(P.pollEveryMs(.running), P.livePollMs)
        XCTAssertEqual(P.pollEveryMs(.paused), P.livePollMs)
        XCTAssertEqual(P.pollEveryMs(.ended), P.idlePollMs)
        XCTAssertEqual(P.pollEveryMs(nil), P.idlePollMs)
        XCTAssertEqual([P.preparingPollMs, P.livePollMs, P.idlePollMs], [2_000, 5_000, 30_000])
    }

    func testOnlyAKnownSportCodeIsBelieved() {
        XCTAssertEqual(WorkoutSportTypes.pick(nil, 13), 13)
        XCTAssertEqual(WorkoutSportTypes.pick(140, 1), 140)
        XCTAssertNil(WorkoutSportTypes.pick(nil, nil))
    }
}
