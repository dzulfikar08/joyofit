package com.joyodigitama.huaweiwear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LiveGpsTrackTest {
  private val metersPerDegree = 111_194.93

  private fun fix(sec: Int, northM: Double, alt: Double? = 100.0, accuracy: Float? = 5f, speed: Float? = 3f) =
    TrackFix(1_000_000L + sec * 1000L, 10.0 + northM / metersPerDegree, 20.0, alt, accuracy, speed, null)

  @Test
  fun distanceAddsUpAlongARun() {
    val track = TrackAccumulator()
    for (s in 0..20) assertTrue(track.add(fix(s, s * 3.0)))
    assertEquals(60.0, track.distanceM, 0.5)
  }

  @Test
  fun jitterOnTheSpotAddsNothing() {
    val track = TrackAccumulator()
    for (s in 0..30) track.add(fix(s, if (s % 2 == 0) 0.0 else 1.5))
    assertEquals(0.0, track.distanceM, 0.001)
  }

  @Test
  fun aSlowDriftStillAddsUpOnceItIsPastTheStepThreshold() {
    val track = TrackAccumulator()
    // 1 m per second: each step alone is jitter, but the kept fix stays put until the way from it passes 3 m.
    for (s in 0..30) track.add(fix(s, s * 1.0))
    assertEquals(30.0, track.distanceM, 3.1)
  }

  @Test
  fun aBadFixIsDropped() {
    val track = TrackAccumulator()
    track.add(fix(0, 0.0))
    assertFalse(track.add(fix(1, 3.0, accuracy = 80f)))
    assertEquals(0.0, track.distanceM, 0.001)
  }

  @Test
  fun aJumpIsDropped() {
    val track = TrackAccumulator()
    track.add(fix(0, 0.0))
    // 500 m in a second.
    assertFalse(track.add(fix(1, 500.0)))
    assertEquals(0.0, track.distanceM, 0.001)
  }

  @Test
  fun aGapDoesNotJoinTheStretchesOnEitherSide() {
    val track = TrackAccumulator()
    for (s in 0..10) track.add(fix(s, s * 3.0))
    val before = track.distanceM
    track.gap()
    // The person walked 400 m while the workout was paused.
    for (s in 300..310) track.add(fix(s, 400.0 + (s - 300) * 3.0))
    assertEquals(before + 30.0, track.distanceM, 0.5)
  }

  @Test
  fun paceFollowsTheRecentSpeed() {
    val track = TrackAccumulator()
    for (s in 0..20) track.add(fix(s, s * 3.0))
    val pace = track.paceSecPerKm
    assertNotNull(pace)
    assertEquals(333.0, pace!!.toDouble(), 5.0)
  }

  @Test
  fun standingStillHasNoPace() {
    val track = TrackAccumulator()
    for (s in 0..20) track.add(fix(s, 0.0))
    assertNull(track.paceSecPerKm)
  }

  @Test
  fun noPaceBeforeEnoughOfTheWindowIsKnown() {
    val track = TrackAccumulator()
    track.add(fix(0, 0.0))
    track.add(fix(1, 3.0))
    assertNull(track.paceSecPerKm)
  }

  @Test
  fun climbCountsARealRiseButNotNoise() {
    val ramp = TrackAccumulator()
    for (s in 0..40) ramp.add(fix(s, s * 3.0, alt = 100.0 + s * 0.5))
    // 20 m up, the smoothing lags a little behind.
    assertTrue("rise ${ramp.riseM}", ramp.riseM in 14.0..20.5)

    val flat = TrackAccumulator()
    for (s in 0..40) flat.add(fix(s, s * 3.0, alt = 100.0 + if (s % 2 == 0) 1.5 else -1.5))
    assertEquals(0.0, flat.riseM, 0.001)
  }

  @Test
  fun descendingDoesNotCountAndTheNextClimbStartsFromTheBottom() {
    val track = TrackAccumulator()
    for (s in 0..30) track.add(fix(s, s * 3.0, alt = 100.0 - s * 0.5))
    assertEquals(0.0, track.riseM, 0.001)
    for (s in 31..70) track.add(fix(s, s * 3.0, alt = 85.0 + (s - 30) * 0.5))
    assertTrue("rise ${track.riseM}", track.riseM in 11.0..20.5)
  }

  @Test
  fun motionStartNeedsThreeMovingFixesInARow() {
    val m = MotionStart()
    assertFalse(m.onFix(2.5f, 5f))
    assertFalse(m.onFix(2.5f, 5f))
    assertTrue(m.onFix(2.5f, 5f))
  }

  @Test
  fun standingOnTheGoScreenNeverStartsIt() {
    val m = MotionStart()
    repeat(100) { assertFalse(m.onFix(0.2f, 5f)) }
  }

  @Test
  fun aSlowFixOrABadOneBreaksTheRun() {
    val m = MotionStart()
    m.onFix(2.5f, 5f)
    m.onFix(2.5f, 5f)
    assertFalse(m.onFix(0.3f, 5f))
    assertFalse(m.onFix(2.5f, 5f))
    assertFalse(m.onFix(2.5f, 80f))
    assertFalse(m.onFix(null, 5f))
  }

  // The session's track: what counts and when (docs/live-run.md, "Phone GPS for the whole session").

  private fun timeOf(sec: Int) = 1_000_000L + sec * 1000L

  @Test
  fun fixesWhileTheWatchPreparesShowOnTheMapButAddNoDistance() {
    val t = SessionTrack()
    // 30 s of walking to the start line while the watch searches for GPS.
    for (s in 0..30) assertFalse(t.onFix(fix(s, s * 4.0), running = false, motionStarts = false))
    assertEquals(timeOf(30), t.location?.timeMs)
    assertEquals(0.0, t.track.distanceM, 0.001)
    // The watch says the workout runs: the stretch begins at the newest fix, the walk before it is not in it.
    t.startStretch(timeOf(30) + 400L)
    for (s in 31..40) t.onFix(fix(s, s * 4.0), running = true, motionStarts = false)
    assertEquals(40.0, t.track.distanceM, 0.5)
  }

  @Test
  fun aStaleNewestFixDoesNotStartTheStretch() {
    val t = SessionTrack()
    t.onFix(fix(0, 0.0), running = false, motionStarts = false)
    // The start comes a minute after the last fix: that position is not where the person is now.
    t.startStretch(timeOf(60))
    t.onFix(fix(61, 500.0), running = true, motionStarts = false)
    t.onFix(fix(62, 506.0), running = true, motionStarts = false)
    assertEquals(6.0, t.track.distanceM, 0.5)
  }

  @Test
  fun movementStartsASilentWatchsWorkoutAndCountsFromThatFix() {
    val t = SessionTrack()
    // Standing on the GO screen never starts it; nor does moving when the watch gives a start of its own.
    for (s in 0..5) assertFalse(t.onFix(fix(s, 0.0, speed = 0.1f), running = false, motionStarts = true))
    for (s in 6..10) assertFalse(t.onFix(fix(s, (s - 5) * 4.0), running = false, motionStarts = false))
    assertFalse(t.onFix(fix(11, 24.0), running = false, motionStarts = true))
    assertFalse(t.onFix(fix(12, 28.0), running = false, motionStarts = true))
    assertTrue(t.onFix(fix(13, 32.0), running = false, motionStarts = true))
    assertEquals(0.0, t.track.distanceM, 0.001)
    t.startStretch(timeOf(13))
    for (s in 14..23) t.onFix(fix(s, 32.0 + (s - 13) * 4.0), running = true, motionStarts = false)
    assertEquals(40.0, t.track.distanceM, 0.5)
  }

  @Test
  fun aPauseAddsNothingAndTheResumeStartsFromWhereThePersonIs() {
    val t = SessionTrack()
    t.startStretch(timeOf(0))
    for (s in 0..10) t.onFix(fix(s, s * 4.0), running = true, motionStarts = false)
    for (s in 11..60) t.onFix(fix(s, 40.0 + (s - 10) * 4.0), running = false, motionStarts = false)
    t.startStretch(timeOf(60))
    for (s in 61..70) t.onFix(fix(s, 240.0 + (s - 60) * 4.0), running = true, motionStarts = false)
    assertEquals(80.0, t.track.distanceM, 0.5)
  }

  // The phone's location updates and the feed to the watch.

  private class FakeLocation {
    var starts = 0
    var stops = 0
    var grant = true
    val session = PhoneGpsSession(start = { starts++; grant }, stop = { stops++ })
  }

  @Test
  fun theWatchWithdrawingItsRequestMidRunStopsOnlyTheFeed() {
    val gps = FakeLocation()
    val t = SessionTrack()
    gps.session.watchAsks()
    assertEquals(1, gps.starts)
    assertTrue(gps.session.feeding)
    t.startStretch(timeOf(0))
    for (s in 0..80) t.onFix(fix(s, s * 4.0), running = true, motionStarts = false)
    // 80 s in, the watch has its own fix and stops asking (Fit 4 Pro, 2026-10-25).
    gps.session.watchWithdraws(liveSession = true)
    assertFalse(gps.session.feeding)
    assertTrue(gps.session.isTracking)
    assertEquals(0, gps.stops)
    for (s in 81..200) t.onFix(fix(s, s * 4.0), running = true, motionStarts = false)
    assertEquals(800.0, t.track.distanceM, 1.0)
    // Asking again restarts the feed on the same location updates.
    gps.session.watchAsks()
    assertTrue(gps.session.feeding)
    assertEquals(1, gps.starts)
  }

  @Test
  fun theEndOfTheSessionStopsTheLocationUpdatesOnce() {
    val gps = FakeLocation()
    gps.session.watchAsks()
    gps.session.watchWithdraws(liveSession = true)
    gps.session.sessionEnded()
    gps.session.sessionEnded()
    assertEquals(1, gps.stops)
    assertFalse(gps.session.isTracking)
    assertFalse(gps.session.feeding)
    // A request after the end starts both again.
    gps.session.watchAsks()
    assertEquals(2, gps.starts)
    assertTrue(gps.session.isTracking)
    assertTrue(gps.session.feeding)
  }

  @Test
  fun withNoLiveSessionAWithdrawnRequestOrALostLinkStopsTheUpdates() {
    // A phone-started run: the watch's workout is the run screen's, no live session follows it.
    val withdrawn = FakeLocation()
    withdrawn.session.watchAsks()
    withdrawn.session.watchWithdraws(liveSession = false)
    assertEquals(1, withdrawn.stops)
    assertFalse(withdrawn.session.isTracking)

    val lost = FakeLocation()
    lost.session.watchAsks()
    lost.session.linkLost(liveSession = true)
    assertEquals(0, lost.stops)
    assertFalse(lost.session.feeding)
    lost.session.linkLost(liveSession = false)
    assertEquals(1, lost.stops)
  }

  @Test
  fun updatesThatCouldNotStartAreTriedAgainOnTheNextRequest() {
    val gps = FakeLocation()
    gps.grant = false
    gps.session.watchAsks()
    assertFalse(gps.session.isTracking)
    gps.session.sessionEnded()
    assertEquals(0, gps.stops)
    gps.grant = true
    gps.session.watchAsks()
    assertEquals(2, gps.starts)
    assertTrue(gps.session.isTracking)
  }
}
