import XCTest
@testable import HuaweiWearLogic

/// The twin of LiveGpsTrackTest.kt: the phone's track of a live workout, and how long the phone's GPS runs for it.
final class LiveGpsTrackTests: XCTestCase {
    private let metersPerDegree = 111_194.93

    private func timeOf(_ sec: Int) -> Int64 { 1_000_000 + Int64(sec) * 1000 }

    private func fix(_ sec: Int, _ northM: Double, alt: Double? = 100, accuracy: Double? = 5, speed: Double? = 3) -> WorkoutLinkWire.Fix {
        WorkoutLinkWire.Fix(latitude: 10 + northM / metersPerDegree, longitude: 20, timeMs: timeOf(sec), speed: speed, altitude: alt, accuracy: accuracy)
    }

    // MARK: TrackAccumulator

    func testDistanceAddsUpAlongARun() {
        var track = TrackAccumulator()
        for s in 0...20 { XCTAssertTrue(track.add(fix(s, Double(s) * 4))) }
        XCTAssertEqual(track.distanceM, 80, accuracy: 0.5)
    }

    func testJitterOnTheSpotAddsNothing() {
        var track = TrackAccumulator()
        for s in 0...30 { track.add(fix(s, s % 2 == 0 ? 0 : 1.5)) }
        XCTAssertEqual(track.distanceM, 0, accuracy: 0.001)
    }

    func testABadFixAndAJumpAreDropped() {
        var track = TrackAccumulator()
        track.add(fix(0, 0))
        XCTAssertFalse(track.add(fix(1, 4, accuracy: 80)))
        // 500 m in a second.
        XCTAssertFalse(track.add(fix(2, 500)))
        XCTAssertEqual(track.distanceM, 0, accuracy: 0.001)
    }

    func testPaceFollowsTheRecentSpeedAndStandingHasNone() {
        var running = TrackAccumulator()
        for s in 0...20 { running.add(fix(s, Double(s) * 3)) }
        XCTAssertEqual(Double(running.paceSecPerKm ?? 0), 333, accuracy: 5)
        var standing = TrackAccumulator()
        for s in 0...20 { standing.add(fix(s, 0)) }
        XCTAssertNil(standing.paceSecPerKm)
        var short = TrackAccumulator()
        short.add(fix(0, 0))
        short.add(fix(1, 4))
        XCTAssertNil(short.paceSecPerKm)
    }

    func testClimbCountsARealRiseButNotNoise() {
        var ramp = TrackAccumulator()
        for s in 0...40 { ramp.add(fix(s, Double(s) * 3, alt: 100 + Double(s) * 0.5)) }
        XCTAssertTrue((14.0...20.5).contains(ramp.riseM), "rise \(ramp.riseM)")
        var flat = TrackAccumulator()
        for s in 0...40 { flat.add(fix(s, Double(s) * 3, alt: 100 + (s % 2 == 0 ? 1.5 : -1.5))) }
        XCTAssertEqual(flat.riseM, 0, accuracy: 0.001)
    }

    func testMotionStartNeedsThreeGoodMovingFixesInARow() {
        var m = MotionStart()
        XCTAssertFalse(m.onFix(speedMps: 2.5, accuracyM: 5))
        XCTAssertFalse(m.onFix(speedMps: 2.5, accuracyM: 5))
        XCTAssertFalse(m.onFix(speedMps: 0.3, accuracyM: 5))
        XCTAssertFalse(m.onFix(speedMps: 2.5, accuracyM: 80))
        XCTAssertFalse(m.onFix(speedMps: 2.5, accuracyM: 5))
        XCTAssertFalse(m.onFix(speedMps: 2.5, accuracyM: 5))
        XCTAssertTrue(m.onFix(speedMps: 2.5, accuracyM: 5))
    }

    // MARK: SessionTrack

    func testFixesWhileTheWatchPreparesShowOnTheMapButAddNoDistance() {
        var t = SessionTrack()
        for s in 0...30 { XCTAssertFalse(t.onFix(fix(s, Double(s) * 4), running: false, motionStarts: false)) }
        XCTAssertEqual(t.location?.timeMs, timeOf(30))
        XCTAssertEqual(t.track.distanceM, 0, accuracy: 0.001)
        t.startStretch(nowMs: timeOf(30) + 400)
        for s in 31...40 { _ = t.onFix(fix(s, Double(s) * 4), running: true, motionStarts: false) }
        XCTAssertEqual(t.track.distanceM, 40, accuracy: 0.5)
    }

    func testAStaleNewestFixDoesNotStartTheStretch() {
        var t = SessionTrack()
        _ = t.onFix(fix(0, 0), running: false, motionStarts: false)
        t.startStretch(nowMs: timeOf(60))
        _ = t.onFix(fix(61, 500), running: true, motionStarts: false)
        _ = t.onFix(fix(62, 506), running: true, motionStarts: false)
        XCTAssertEqual(t.track.distanceM, 6, accuracy: 0.5)
    }

    func testMovementStartsASilentWatchsWorkoutAndCountsFromThatFix() {
        var t = SessionTrack()
        for s in 0...5 { XCTAssertFalse(t.onFix(fix(s, 0, speed: 0.1), running: false, motionStarts: true)) }
        XCTAssertFalse(t.onFix(fix(11, 24), running: false, motionStarts: true))
        XCTAssertFalse(t.onFix(fix(12, 28), running: false, motionStarts: true))
        XCTAssertTrue(t.onFix(fix(13, 32), running: false, motionStarts: true))
        XCTAssertEqual(t.track.distanceM, 0, accuracy: 0.001)
        t.startStretch(nowMs: timeOf(13))
        for s in 14...23 { _ = t.onFix(fix(s, 32 + Double(s - 13) * 4), running: true, motionStarts: false) }
        XCTAssertEqual(t.track.distanceM, 40, accuracy: 0.5)
    }

    func testAPauseAddsNothingAndTheResumeStartsFromWhereThePersonIs() {
        var t = SessionTrack()
        t.startStretch(nowMs: timeOf(0))
        for s in 0...10 { _ = t.onFix(fix(s, Double(s) * 4), running: true, motionStarts: false) }
        for s in 11...60 { _ = t.onFix(fix(s, 40 + Double(s - 10) * 4), running: false, motionStarts: false) }
        t.startStretch(nowMs: timeOf(60))
        for s in 61...70 { _ = t.onFix(fix(s, 240 + Double(s - 60) * 4), running: true, motionStarts: false) }
        XCTAssertEqual(t.track.distanceM, 80, accuracy: 0.5)
    }

    // MARK: PhoneGpsSession

    private final class FakeLocation {
        var starts = 0
        var stops = 0
        var grant = true
        lazy var session = PhoneGpsSession(start: { [unowned self] in
            self.starts += 1
            return self.grant
        }, stop: { [unowned self] in self.stops += 1 })
    }

    func testTheWatchWithdrawingItsRequestMidRunStopsOnlyTheFeed() {
        let gps = FakeLocation()
        var t = SessionTrack()
        gps.session.watchAsks()
        XCTAssertEqual(gps.starts, 1)
        XCTAssertTrue(gps.session.feeding)
        for s in 0...80 { _ = t.onFix(fix(s, Double(s) * 4), running: true, motionStarts: false) }
        gps.session.watchWithdraws(liveSession: true)
        XCTAssertFalse(gps.session.feeding)
        XCTAssertTrue(gps.session.isTracking)
        XCTAssertEqual(gps.stops, 0)
        for s in 81...200 { _ = t.onFix(fix(s, Double(s) * 4), running: true, motionStarts: false) }
        XCTAssertEqual(t.track.distanceM, 800, accuracy: 1)
        gps.session.watchAsks()
        XCTAssertTrue(gps.session.feeding)
        XCTAssertEqual(gps.starts, 1)
    }

    func testTheEndOfTheSessionStopsTheLocationUpdatesOnce() {
        let gps = FakeLocation()
        gps.session.watchAsks()
        gps.session.watchWithdraws(liveSession: true)
        gps.session.sessionEnded()
        gps.session.sessionEnded()
        XCTAssertEqual(gps.stops, 1)
        XCTAssertFalse(gps.session.isTracking)
        XCTAssertFalse(gps.session.feeding)
        gps.session.watchAsks()
        XCTAssertEqual(gps.starts, 2)
        XCTAssertTrue(gps.session.isTracking)
        XCTAssertTrue(gps.session.feeding)
    }

    func testWithNoLiveSessionAWithdrawnRequestOrALostLinkStopsTheUpdates() {
        let withdrawn = FakeLocation()
        withdrawn.session.watchAsks()
        withdrawn.session.watchWithdraws(liveSession: false)
        XCTAssertEqual(withdrawn.stops, 1)
        XCTAssertFalse(withdrawn.session.isTracking)

        let lost = FakeLocation()
        lost.session.watchAsks()
        lost.session.linkLost(sessionEndsWithoutLink: true)
        XCTAssertEqual(lost.stops, 0)
        XCTAssertFalse(lost.session.feeding)
        lost.session.linkLost(sessionEndsWithoutLink: false)
        XCTAssertEqual(lost.stops, 1)
        // Only the GPS-request session ends by itself once the watch is gone (its watchdog).
        XCTAssertTrue(LiveWorkout.endsWithoutLink(.gps))
        for source in [LiveWorkout.Source.watch, .status, .manual] { XCTAssertFalse(LiveWorkout.endsWithoutLink(source), source.rawValue) }
    }

    func testUpdatesThatCouldNotStartAreTriedAgainOnTheNextRequest() {
        let gps = FakeLocation()
        gps.grant = false
        gps.session.watchAsks()
        XCTAssertFalse(gps.session.isTracking)
        gps.session.sessionEnded()
        XCTAssertEqual(gps.stops, 0)
        gps.grant = true
        gps.session.watchAsks()
        XCTAssertEqual(gps.starts, 2)
        XCTAssertTrue(gps.session.isTracking)
    }
}
