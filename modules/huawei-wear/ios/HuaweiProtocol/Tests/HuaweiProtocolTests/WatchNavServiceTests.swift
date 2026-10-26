import XCTest
@testable import HuaweiProtocol

/// The watch-navigation P2P module (WatchNavService.swift). Twin: WatchNavServiceTest.kt.
final class WatchNavServiceTests: XCTestCase {
    private static let phone = "com.joyodigitama.joyofit"
    private static let navi = "com.joyodigitama.navi"
    private static let config = WatchNavConfig(phoneFingerprint: "PhoneFp", watchFingerprint: "WatchFp")

    final class Recorder: @unchecked Sendable {
        private let lock = NSLock()
        private var _events: [[String: Any]] = []
        private var _logs: [String] = []
        func emit(_ payload: [String: Any]) { lock.lock(); _events.append(payload); lock.unlock() }
        func log(_ entry: LogEntry) { lock.lock(); _logs.append(entry.message); lock.unlock() }
        var events: [[String: Any]] { lock.lock(); defer { lock.unlock() }; return _events }
        var logs: [String] { lock.lock(); defer { lock.unlock() }; return _logs }
    }

    private func make() -> (P2PManager, P2PTests.Capture, WatchNavService, Recorder) {
        let capture = P2PTests.Capture()
        let manager = P2PManager(transport: capture)
        let recorder = Recorder()
        let service = WatchNavService(
            manager: manager, phonePackage: Self.phone, config: Self.config, log: { recorder.log($0) }, emit: { recorder.emit($0) }, now: { 1_000 }
        )
        return (manager, capture, service, recorder)
    }

    /// A packet from the watch app (src navi, dst the phone).
    private func watchPacket(_ cmd: Int, _ seq: Int, _ data: Bytes?, _ code: Int?) throws -> P2P.P2PCommand.Response {
        try P2PTests.response(cmd, seq, Self.navi, Self.phone, data, code)
    }

    func testRegistrationPingsTheWatchAppFromThePhonePackageWithoutFingerprints() throws {
        let (manager, capture, service, recorder) = make()
        service.register()
        let sent = capture.take()
        XCTAssertEqual(sent.count, 1)
        XCTAssertEqual(sent[0]["cmd"] as? Int, 1)
        XCTAssertEqual(sent[0]["src"] as? String, Self.phone)
        XCTAssertEqual(sent[0]["dst"] as? String, Self.navi)
        XCTAssertTrue(sent[0]["srcFp"] is NSNull)
        XCTAssertTrue(sent[0]["dstFp"] is NSNull)
        XCTAssertTrue(recorder.logs.contains("WatchNav: registered \(Self.phone) -> \(Self.navi)"))

        try manager.handlePacket(watchPacket(3, sent[0]["seq"] as! Int, nil, 0xca))
        XCTAssertEqual(service.watchApp, "present")
        XCTAssertEqual(service.lastCode, 0xca)
        XCTAssertTrue(recorder.logs.contains("WatchNav: ping of \(Self.navi) answered 0xca (0xca = the watch app is there)"))
        let event = recorder.events.last!
        XCTAssertEqual(event["kind"] as? String, "presence")
        XCTAssertEqual(event["watchApp"] as? String, "present")
        XCTAssertEqual(event["code"] as? Int, 0xca)
        XCTAssertEqual(event["ts"] as? Int64, 1_000)
    }

    func testAnotherPingAnswerMeansAbsent() throws {
        let (manager, capture, service, recorder) = make()
        service.register()
        try manager.handlePacket(watchPacket(3, capture.take()[0]["seq"] as! Int, nil, 0xcd))
        XCTAssertEqual(service.watchApp, "absent")
        XCTAssertTrue(recorder.logs.contains("WatchNav: watch app absent (code 0xcd)"))
    }

    func testSendCarriesPackagesFingerprintsAndUtf8AndCountsTheAck() throws {
        let (manager, capture, service, recorder) = make()
        service.register()
        try manager.handlePacket(watchPacket(3, capture.take()[0]["seq"] as! Int, nil, 0xca))
        let json = #"{"t":"step","n":3,"text":"Belok kiri ké"}"#
        XCTAssertTrue(try service.send(json))
        let sent = capture.take()
        XCTAssertEqual(sent.count, 1)
        XCTAssertEqual(sent[0]["cmd"] as? Int, 2)
        XCTAssertEqual(sent[0]["src"] as? String, Self.phone)
        XCTAssertEqual(sent[0]["dst"] as? String, Self.navi)
        XCTAssertEqual(sent[0]["srcFp"] as? String, "PhoneFp")
        XCTAssertEqual(sent[0]["dstFp"] as? String, "WatchFp")
        XCTAssertEqual(sent[0]["data"] as? String, Bytes(json.utf8).hexLower)
        XCTAssertEqual(service.sent, 1)
        XCTAssertTrue(recorder.logs.contains("WatchNav: tx step n=3 (\(json.utf8.count) bytes)"))

        try manager.handlePacket(watchPacket(3, sent[0]["seq"] as! Int, nil, 0xcf))
        XCTAssertEqual(service.acked, 1)
        XCTAssertEqual(service.lastCode, 0xcf)
        XCTAssertTrue(recorder.logs.contains("WatchNav: tx step n=3 acknowledged 0xcf"))
    }

    func testTheSizeLimit() throws {
        let (_, capture, service, _) = make()
        service.register()
        _ = capture.take()
        let exact = String(repeating: "a", count: WatchNavWire.maxBytes)
        XCTAssertTrue(try service.send(exact))
        XCTAssertThrowsError(try service.send(exact + "a")) { XCTAssertEqual(($0 as? WearError)?.code, .invalidArgument) }
        XCTAssertThrowsError(try service.send("")) { XCTAssertEqual(($0 as? WearError)?.code, .invalidArgument) }
        XCTAssertEqual(service.sent, 1)
    }

    func testTheWatchAppsPingIsAnsweredCa() throws {
        let (manager, capture, service, recorder) = make()
        service.register()
        _ = capture.take()
        try manager.handlePacket(watchPacket(1, 77, nil, nil))
        let ack = capture.take()
        XCTAssertEqual(ack.count, 1)
        XCTAssertEqual(ack[0]["cmd"] as? Int, 3)
        XCTAssertEqual(ack[0]["seq"] as? Int, 77)
        XCTAssertEqual(ack[0]["src"] as? String, Self.phone)
        XCTAssertEqual(ack[0]["dst"] as? String, Self.navi)
        XCTAssertEqual(ack[0]["code"] as? Int, 0xca)
        XCTAssertEqual(service.watchApp, "present")
        XCTAssertTrue(recorder.logs.contains("WatchNav: the watch app pinged; answered 0xca"))
    }

    func testTheWatchAppsDataIsAckedAndEmitted() throws {
        let (manager, capture, service, recorder) = make()
        service.register()
        _ = capture.take()
        let json = #"{"t":"hello","v":1}"#
        try manager.handlePacket(watchPacket(2, 78, Bytes(json.utf8), nil))
        let ack = capture.take()
        XCTAssertEqual(ack[0]["cmd"] as? Int, 3)
        XCTAssertEqual(ack[0]["code"] as? Int, 0xcf)
        XCTAssertEqual(service.received, 1)
        XCTAssertEqual(service.lastHeardAt, 1_000)
        let message = recorder.events.last!
        XCTAssertEqual(message["kind"] as? String, "message")
        XCTAssertEqual(message["json"] as? String, json)
        XCTAssertTrue(recorder.logs.contains("WatchNav: rx \(json)"))
    }

    func testNonJsonDataIsNotEmitted() throws {
        let (manager, _, service, recorder) = make()
        service.register()
        try manager.handlePacket(watchPacket(2, 79, [0xff, 0x00], nil))
        XCTAssertEqual(service.received, 1)
        XCTAssertFalse(recorder.events.contains { $0["kind"] as? String == "message" })
        XCTAssertTrue(recorder.logs.contains("WatchNav: rx not JSON (2 bytes): ff00"))
    }

    func testUnregisterServiceRemovesItAndPresenceGoesBackToUnknown() throws {
        let (manager, capture, service, recorder) = make()
        service.register()
        try manager.handlePacket(watchPacket(3, capture.take()[0]["seq"] as! Int, nil, 0xca))
        manager.unregisterService(Self.phone)
        XCTAssertNil(manager.registeredService(Self.phone))
        XCTAssertEqual(service.watchApp, "unknown")
        XCTAssertEqual(recorder.events.last?["watchApp"] as? String, "unknown")
        XCTAssertTrue(recorder.events.last?["code"] is NSNull)
    }

    func testWire() {
        XCTAssertEqual(WatchNavWire.summary(#"{"t":"step","n":12}"#), "step n=12")
        XCTAssertEqual(WatchNavWire.summary(#"{"t":"end"}"#), "end n=?")
        XCTAssertEqual(WatchNavWire.summary("nope"), "?")
        XCTAssertNil(WatchNavWire.problem("{}"))
        XCTAssertEqual(WatchNavWire.problem(""), "empty")
        XCTAssertEqual(WatchNavWire.problem(String(repeating: "a", count: 1001)), "1001 bytes, more than 1000")
        XCTAssertTrue(WatchNavWire.isPlaceholder("PLACEHOLDER_PHONE"))
        XCTAssertFalse(WatchNavWire.isPlaceholder("AB:CD"))
    }
}
