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
        // Watch opened (GO screen) for 20 s, GO, a pause, resume. Before this change the first OPEN answer started the clock (16:09:32).
        XCTAssertEqual(follow(.open, .open, .running, .running, .paused, .running), [s, s, r, r, p, r])
        // A watch that stops counting but keeps its workout screen open (a pause told only by tag 02) pauses the phone too.
        XCTAssertEqual(follow(.running, .open, .running), [r, p, r])
        // Idle answers move nothing here: the end is idleVerdict's.
        XCTAssertNil(P.statusTarget(.running, .idle))
    }

    func testAClosedWorkoutScreenEndsOnTheFirstIdleAnswer() {
        // Finish on the watch: 18/08 {01: 0}, then 17/03 idle 5 s later (12:07:58 / 12:08:03). One answer is enough.
        XCTAssertEqual(P.idleVerdict(preparing: false, confirmed: true, idleAnswers: 1, msSinceGps: 5_000, screenClosed: true), .end)
        // The person left the GO screen without starting: ends too, even with a GPS request seconds ago.
        XCTAssertEqual(P.idleVerdict(preparing: true, confirmed: false, idleAnswers: 1, msSinceGps: 1_000, screenClosed: true), .end)
        // Without the close, one idle answer is not enough.
        XCTAssertEqual(P.idleVerdict(preparing: false, confirmed: true, idleAnswers: 1, msSinceGps: 5_000), .keep)
        XCTAssertEqual(P.idleVerdict(preparing: false, confirmed: true, idleAnswers: 3, msSinceGps: 5_000), .end)
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
