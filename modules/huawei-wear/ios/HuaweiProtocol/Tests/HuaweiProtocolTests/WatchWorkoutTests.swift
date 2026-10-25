import XCTest
@testable import HuaweiProtocol

/// Translation of Kotlin WatchWorkoutTest.
final class WatchWorkoutTests: XCTestCase {
    private func hex(_ s: String) -> Bytes { Bytes(hex: s.replacingOccurrences(of: " ", with: ""))! }

    // 1_700_000_000 s = 0x6553F100; the workout started 60 s earlier.
    private let now: Int64 = 1_700_000_000_000
    private var started: Int64 { now - 60_000 }

    private let plainShape = WatchWorkoutWire.Shape(linkTags: false, forbidPause: false)
    private let fullShape = WatchWorkoutWire.Shape(linkTags: true, forbidPause: true)

    func testStartOfStrengthTrainingIsHuaweiHealthsOperatorLayout() {
        let tlv = WatchWorkoutWire.operatorTLV(op: WatchWorkoutWire.opStart, workoutType: WatchWorkoutWire.sportStrengthTraining, nowMs: now, startMs: now, shape: plainShape)
        XCTAssertEqual(
            tlv.serialize(),
            hex("81 29  02 01 01  03 01 01  05 01 8c  06 04 6553f100  87 12 08 04 00000000 09 04 00000000 0a 04 00000000  0c 04 6553f100")
        )
    }

    func testVersionRunCourseAndForbidPauseTagsFollowHuaweisOrder() {
        let tlv = WatchWorkoutWire.operatorTLV(op: WatchWorkoutWire.opStop, workoutType: WatchWorkoutWire.sportStrengthTraining, nowMs: now, startMs: started, shape: fullShape)
        XCTAssertEqual(
            tlv.serialize(),
            hex("81 32  02 01 04  03 01 01  05 01 8c  06 04 6553f100  87 12 08 04 00000000 09 04 00000000 0a 04 00000000  0b 01 00  0c 04 6553f0c4  0d 01 00  0e 01 00")
        )
    }

    func testPacketCarriesServiceAndCommand() {
        let packet = WatchWorkoutWire.setOperatorRequest(op: WatchWorkoutWire.opPause, workoutType: WatchWorkoutWire.sportStrengthTraining, nowMs: now, startMs: started, shape: plainShape)
        XCTAssertEqual(packet.serviceId, 0x17)
        XCTAssertEqual(packet.commandId, 0x01)
    }

    func testStatusRequestIsAnEmptyContainer() {
        let packet = WatchWorkoutWire.statusRequest()
        XCTAssertEqual(packet.commandId, 0x03)
        XCTAssertEqual(packet.tlv?.serialize(), hex("81 00"))
    }

    func testWorkoutTypesUseTheShortestBigEndianBytes() {
        XCTAssertEqual(WatchWorkoutWire.minimalBytes(0), hex("00"))
        XCTAssertEqual(WatchWorkoutWire.minimalBytes(1), hex("01"))
        XCTAssertEqual(WatchWorkoutWire.minimalBytes(140), hex("8c"))
        XCTAssertEqual(WatchWorkoutWire.minimalBytes(255), hex("ff"))
        XCTAssertEqual(WatchWorkoutWire.minimalBytes(256), hex("0100"))
        XCTAssertEqual(WatchWorkoutWire.minimalBytes(0x010203), hex("010203"))
    }

    func testOptionalTagsFollowTheWatchsSupportedCommands() {
        let shape = WatchWorkoutWire.shape { service, command in (service == 0x17 && command == 0x12) || (service == 0x17 && command == 0x15) }
        XCTAssertTrue(shape.linkTags)
        XCTAssertTrue(shape.forbidPause)
        let none = WatchWorkoutWire.shape { _, _ in false }
        XCTAssertFalse(none.linkTags)
        XCTAssertFalse(none.forbidPause)
    }

    func testResultCodeIsReadFromTag7F() throws {
        XCTAssertEqual(WatchWorkoutWire.resultCode(try HuaweiTLV(parsing: hex("7f 04 000186a0"))), WatchWorkoutWire.ok)
        XCTAssertEqual(WatchWorkoutWire.resultCode(try HuaweiTLV(parsing: hex("7f 04 0001e07a"))), 123_002)
        XCTAssertNil(WatchWorkoutWire.resultCode(try HuaweiTLV(parsing: hex("81 03 02 01 01"))))
        XCTAssertNil(WatchWorkoutWire.resultCode(nil))
    }

    func testStatusAnswerSaysWhetherTheWatchRunsAWorkout() throws {
        let running = try XCTUnwrap(WatchWorkoutWire.parseStatus(try HuaweiTLV(parsing: hex("81 0c  02 01 01  03 01 01  04 01 01  06 01 8c"))))
        XCTAssertEqual(running.operatorType, 1)
        XCTAssertEqual(running.workoutType, 140)
        XCTAssertTrue(running.running)
        XCTAssertEqual(running.trainMonitorState, 1)
        XCTAssertEqual(running.phase, .running)
        let paused = try XCTUnwrap(WatchWorkoutWire.parseStatus(try HuaweiTLV(parsing: hex("81 06  02 01 01  03 01 02"))))
        XCTAssertFalse(paused.running)
        XCTAssertEqual(paused.phase, .paused)
        let stopped = try XCTUnwrap(WatchWorkoutWire.parseStatus(try HuaweiTLV(parsing: hex("81 03  03 01 04"))))
        XCTAssertFalse(stopped.running)
        XCTAssertEqual(stopped.phase, .idle)
        XCTAssertNil(WatchWorkoutWire.parseStatus(HuaweiTLV()))
    }

    func testTheGoScreenIsOpenNotRunning() throws {
        // Fit 4 Pro, 2026-10-25 17:43: Outdoor walk opened (GO not pressed), GO, pause, resume.
        let goScreen = try XCTUnwrap(WatchWorkoutWire.parseStatus(try HuaweiTLV(parsing: hex("81 06  02 01 00  03 01 01"))))
        XCTAssertEqual(goScreen.trainMonitorState, 0)
        XCTAssertEqual(goScreen.operatorType, 1)
        XCTAssertEqual(goScreen.phase, .open)
        XCTAssertFalse(goScreen.running)
        let afterGo = try XCTUnwrap(WatchWorkoutWire.parseStatus(try HuaweiTLV(parsing: hex("81 06  02 01 01  03 01 03"))))
        XCTAssertEqual(afterGo.phase, .running)
        XCTAssertTrue(afterGo.running)
        XCTAssertEqual(try XCTUnwrap(WatchWorkoutWire.parseStatus(try HuaweiTLV(parsing: hex("81 06  02 01 01  03 01 04")))).phase, .paused)
        XCTAssertEqual(try XCTUnwrap(WatchWorkoutWire.parseStatus(try HuaweiTLV(parsing: hex("81 06  02 01 01  03 01 05")))).phase, .running)
    }

    func testNoticeFromTheWatchCarriesOperatorAndWorkoutType() throws {
        let notice = try XCTUnwrap(WatchWorkoutWire.parseNotice(try HuaweiTLV(parsing: hex("81 09  02 01 04  03 01 01  05 01 8c"))))
        XCTAssertEqual(notice.operatorType, WatchWorkoutWire.opStop)
        XCTAssertEqual(notice.workoutType, 140)
    }

    func testNoticeIsAnsweredWithTheSuccessCode() {
        let ack = WatchWorkoutWire.noticeAck()
        XCTAssertEqual(ack.commandId, 0x02)
        XCTAssertEqual(ack.tlv?.serialize(), hex("7f 04 000186a0"))
    }
}
