import XCTest

@testable import SensorLogic

final class StepsLogTests: XCTestCase {
    private let start: Int64 = 1_000_000

    func testStartedAndFirstUpdateLines() {
        var log = StepsLog(label: "live", startedMs: start)
        XCTAssertEqual(log.started(cadenceAvailable: true), "Phone steps (live): started; CMPedometer, cadence available")
        XCTAssertEqual(
            log.update(nowMs: start + 1_200, endMs: start + 400, steps: 0, cadenceSpm: nil),
            "Phone steps (live): first update 1.2 s after the start, 0 steps, cadence none, stamped 0.8 s before it arrived"
        )
        XCTAssertNil(log.update(nowMs: start + 3_000, endMs: start + 2_500, steps: 4, cadenceSpm: 112.4))
    }

    func testSummarySaysWhatArrivedAndStartsTheNextPeriod() {
        var log = StepsLog(label: "live", startedMs: start)
        _ = log.update(nowMs: start + 2_000, endMs: start + 1_500, steps: 3, cadenceSpm: nil)
        _ = log.update(nowMs: start + 4_500, endMs: start + 3_500, steps: 8, cadenceSpm: 118.2)
        _ = log.update(nowMs: start + 7_000, endMs: start + 6_000, steps: 13, cadenceSpm: 120.4)
        XCTAssertEqual(
            log.summary(nowMs: start + 30_000, steps: 13),
            "Phone steps (live): 30.0 s: 3 updates (2 with a cadence, last 120 spm), +13 steps (total 13), longest gap 23.0 s, max delay 1.0 s"
        )
        // the app was in the background: nothing for 30 s
        XCTAssertEqual(
            log.summary(nowMs: start + 60_000, steps: 13),
            "Phone steps (live): 30.0 s: 0 updates (none with a cadence), +0 steps (total 13), longest gap 53.0 s, max delay -"
        )
    }

    func testStoppedCountsTheWholeRun() {
        var log = StepsLog(label: "recording", startedMs: start)
        _ = log.update(nowMs: start + 2_000, endMs: start + 1_500, steps: 3, cadenceSpm: nil)
        _ = log.summary(nowMs: start + 30_000, steps: 3)
        _ = log.update(nowMs: start + 31_000, endMs: start + 30_500, steps: 9, cadenceSpm: nil)
        XCTAssertEqual(log.stopped(nowMs: start + 95_000, steps: 9), "Phone steps (recording): stopped after 95.0 s: total 9 steps, 2 updates")
    }
}
