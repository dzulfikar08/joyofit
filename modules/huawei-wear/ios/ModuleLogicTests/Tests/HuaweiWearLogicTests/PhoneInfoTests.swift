import XCTest
@testable import HuaweiWearLogic

private final class SilentEvents: WearEvents, @unchecked Sendable {
    func state(_ state: LinkState, error: String?) {}
    func battery(_ level: Int) {}
    func syncComplete(_ summary: SyncSummary) {}
    func log(_ entry: LogEntry) {}
}

/// The watch's PhoneInfo request (01/10) is answered as an iPhone; its acknowledgement is not answered.
final class PhoneInfoTests: XCTestCase {
    /// An unsliced, unencrypted 01/10 frame from the watch.
    private func frame(_ tlv: HuaweiTLV) -> Bytes {
        var body = Bytes([huaweiMagic])
        let inner = Bytes([0x01, 0x10]) + tlv.serialize()
        body.appendBE(UInt16(inner.count + 1))
        body.append(0)
        body += inner
        body.appendBE(CRC16.checksum(body))
        return body
    }

    private func settle() async { try? await Task.sleep(nanoseconds: 150_000_000) }

    func testTheReplyCarriesThePlatformAndOsVersion() {
        let packet = DeviceConfig.PhoneInfo.reply(
            tags: [0x02, 0x08, 0x0D, 0x0E, 0x0F, 0x11, 0x16], platform: DeviceConfig.PhoneInfo.platformIos,
            manufacturer: "Apple", model: "iPhone", osVersion: "26.1"
        )
        XCTAssertEqual(packet.serviceId, 0x01)
        XCTAssertEqual(packet.commandId, 0x10)
        let tlv = packet.tlv!
        XCTAssertEqual(try tlv.string(0x02), "Apple")
        XCTAssertEqual(try tlv.string(0x08), "26.1")
        XCTAssertEqual(tlv.byte(0x0D, default: -1), 1)
        XCTAssertEqual(tlv.byte(0x0E, default: -1), 1)
        XCTAssertFalse(tlv.contains(0x0F), "GB leaves tag 0F out")
        XCTAssertEqual(tlv.int(0x11, default: 0), 1_600_103_320)
        XCTAssertEqual(tlv.byte(0x16, default: -1), 0)
    }

    func testTheWatchsRequestIsAnsweredAndItsAckIsNot() async {
        let watch = RigWatch()
        let session = HuaweiSession(sink: watch, log: { _ in })
        session.params.secretKey = Bytes(repeating: 0, count: 16)
        watch.session = session
        await PhoneInfoResponder.install(on: session, model: "iPhone", events: SilentEvents())

        var ask = HuaweiTLV()
        ask.put(0x08)
        ask.put(0x0D)
        await session.onData(frame(ask))
        await settle()
        var ack = HuaweiTLV()
        ack.put(0x7F, int: 100_000)
        await session.onData(frame(ack))
        await settle()

        let replies = watch.sent.filter { $0.service == 0x01 && $0.command == 0x10 }
        XCTAssertEqual(replies.count, 1)
        XCTAssertEqual(replies.first?.tlv.byte(0x0D, default: -1), 1)
    }
}
