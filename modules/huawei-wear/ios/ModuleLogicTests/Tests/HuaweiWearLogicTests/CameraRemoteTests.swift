import XCTest
@testable import HuaweiWearLogic

private final class CameraEvents: WearEvents, @unchecked Sendable {
    private let lock = NSLock()
    private var _actions: [String] = []
    var actions: [String] { lock.locked { _actions } }
    func state(_ state: LinkState, error: String?) {}
    func battery(_ level: Int) {}
    func syncComplete(_ summary: SyncSummary) {}
    func log(_ entry: LogEntry) {}
    func cameraRemote(_ payload: [String: Any]) { lock.locked { _actions.append(payload["action"] as? String ?? "?") } }
}

/// The watch's Remote shutter: the 01/2A announcement at connect, the watch's open and close answered natively, its 01/29 events handed on.
final class CameraRemoteTests: XCTestCase {
    private struct Rig {
        let watch = RigWatch()
        let session: HuaweiSession
        let caps = DeviceCaps()
        let source = RigSource()
        let events = CameraEvents()
        let controller: CameraRemoteController

        init(listed: Bool) {
            session = HuaweiSession(sink: watch, log: { _ in })
            session.params.secretKey = Bytes(repeating: 0, count: 16)
            watch.session = session
            caps.supportedCommands = listed ? [0x01: [0x29, 0x2A]] : [0x01: [0x04]]
            source.current = LinkHandle(address: "A", session: session, caps: caps, operationLock: AsyncLock())
            controller = CameraRemoteController(link: source, events: events)
        }

        /// The phone's 01/29 acknowledgements, as the 7F code each carries.
        func acks() -> [Int] {
            watch.sent.filter { $0.service == 0x01 && $0.command == 0x29 }.map { Int($0.tlv.int(0x7F, default: -1)) }
        }

        func setups() -> [Int8] {
            watch.sent.filter { $0.service == 0x01 && $0.command == 0x2A }.map { $0.tlv.byte(0x01, default: -1) }
        }
    }

    /// An unsliced, unencrypted 01/29 frame from the watch.
    private func statusFrame(_ value: UInt8) -> Bytes {
        var tlv = HuaweiTLV()
        tlv.put(0x01, byte: value)
        var body = Bytes([huaweiMagic])
        let inner = Bytes([0x01, 0x29]) + tlv.serialize()
        body.appendBE(UInt16(inner.count + 1))
        body.append(0)
        body += inner
        body.appendBE(CRC16.checksum(body))
        return body
    }

    private func settle() async { try? await Task.sleep(nanoseconds: 100_000_000) }

    func testRequestsMatchGadgetbridge() {
        for (event, value) in [(CameraRemote.Setup.Event.enableCamera, 0), (.cameraStarted, 1), (.cameraStopped, 2)] {
            let packet = CameraRemote.Setup.request(event)
            XCTAssertEqual(packet.serviceId, 0x01)
            XCTAssertEqual(packet.commandId, 0x2A)
            XCTAssertTrue(packet.isEncrypted)
            XCTAssertEqual(packet.tlv?.serialize(), [0x01, 0x01, UInt8(value)])
        }
    }

    func testAWatchThatListsTheCommandHearsTheCameraAtConnect() async {
        let rig = Rig(listed: true)
        await rig.controller.linkConnected(rig.source.current!)
        XCTAssertEqual(rig.setups(), [0])
        // A sync ending reports the same session again: no second announcement.
        await rig.controller.linkConnected(rig.source.current!)
        XCTAssertEqual(rig.setups(), [0])
    }

    func testAWatchWithoutTheCommandGetsNothing() async {
        let rig = Rig(listed: false)
        await rig.controller.linkConnected(rig.source.current!)
        rig.session.onData(statusFrame(1))
        await settle()
        XCTAssertTrue(rig.watch.sent.isEmpty)
        XCTAssertTrue(rig.events.actions.isEmpty)
    }

    /// Only the close is answered: an open gets no "camera started", so the watch asks the person to open the iPhone Camera first.
    func testOnlyTheCloseIsAnswered() async {
        let rig = Rig(listed: true)
        await rig.controller.linkConnected(rig.source.current!)
        for value: UInt8 in [1, 2, 2, 3, 9] {
            rig.session.onData(statusFrame(value))
            await settle()
        }
        XCTAssertEqual(rig.events.actions, ["open", "shutter", "shutter", "close"], "an unknown value is dropped, like GB")
        XCTAssertEqual(rig.setups(), [0, 2])
        XCTAssertEqual(rig.acks(), [100_000, 100_000, 100_000, 100_000], "every known event is acknowledged, the unknown one is not")
    }

    func testTheAcknowledgementMatchesGadgetbridgeAndHuaweiHealth() {
        let packet = CameraRemote.Status.ack()
        XCTAssertEqual(packet.serviceId, 0x01)
        XCTAssertEqual(packet.commandId, 0x29)
        XCTAssertTrue(packet.isEncrypted)
        XCTAssertEqual(packet.tlv?.serialize(), [0x7F, 0x04, 0x00, 0x01, 0x86, 0xA0])
    }
}
