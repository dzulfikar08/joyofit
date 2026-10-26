import XCTest
@testable import HuaweiProtocol

/// The Petal Maps companion probe (PetalMapsProbe.swift, lab JRG-434): its answers on the wire and its log lines. Twin: PetalMapsProbeTest.kt.
final class PetalMapsProbeTests: XCTestCase {
    private final class Clock: @unchecked Sendable {
        private let lock = NSLock()
        private var _now: Int64
        init(_ now: Int64) { _now = now }
        var now: Int64 {
            get { lock.p2pLocked { _now } }
            set { lock.p2pLocked { _now = newValue } }
        }
    }

    private struct Rig {
        let clock: Clock
        let capture = P2PTests.Capture()
        let manager: P2PManager
        let logs = SleepFilesLogCollector()
        let probe: PetalMapsProbeService

        init(now: Int64 = 0) {
            clock = Clock(now)
            manager = P2PManager(transport: capture)
            let clock = self.clock
            probe = PetalMapsProbeService(manager: manager, log: logs.sink, nowMs: { clock.now })
        }
    }

    private func fromWatch(
        _ cmd: Int8, _ seq: Int16, _ data: Bytes? = nil, srcFp: String? = nil, dstFp: String? = nil, src: String = PetalProbeWire.watchPackage
    ) -> P2P.P2PCommand.Response {
        P2P.P2PCommand.Response(
            cmdId: cmd, sequenceId: seq, srcPackage: src, dstPackage: PetalProbeWire.phonePackage, srcFingerprint: srcFp, dstFingerprint: dstFp, respData: data
        )
    }

    private func ascii(_ s: String) -> String { Bytes(s.utf8).hexLower }

    private func bytes(_ hex: String) -> Bytes {
        var out = Bytes()
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2)
            out.append(UInt8(hex[index..<next], radix: 16)!)
            index = next
        }
        return out
    }

    func testRegistrationLogsOneInfoLineAndSendsNothing() {
        let rig = Rig()
        rig.probe.register()
        XCTAssertEqual(
            rig.logs.messages,
            [
                "PetalProbe: registered for the watch app com.huawei.ohos.maps.app (phone package com.huawei.maps.app); pings answered 0xca, "
                    + "messages acknowledged 0xcf, nothing else is sent"
            ]
        )
        XCTAssertEqual(rig.logs.entries.first?.direction, .info)
        XCTAssertTrue(rig.capture.take().isEmpty)
    }

    func testThePingOfTheWatchAppIsAnswered0xcaWithThisFrame() throws {
        let rig = Rig()
        rig.probe.register()
        try rig.manager.handlePacket(fromWatch(1, 90))

        let sent = rig.capture.take()
        XCTAssertEqual(sent.count, 1)
        let ack = sent[0]
        XCTAssertEqual(ack["cmd"] as? Int, 3)
        XCTAssertEqual(ack["seq"] as? Int, 90)
        XCTAssertEqual(ack["src"] as? String, PetalProbeWire.phonePackage)
        XCTAssertEqual(ack["dst"] as? String, PetalProbeWire.watchPackage)
        XCTAssertEqual(ack["code"] as? Int, 0xCA)
        // 01 cmd 3, 02 seq 90, 03 our package, 04 the watch app, 08 code 0xca; no fingerprints, no data.
        XCTAssertEqual(
            ack["tlv"] as? String,
            "010103" + "0202005a" + "0313" + ascii("com.huawei.maps.app") + "0418" + ascii("com.huawei.ohos.maps.app") + "0804000000ca"
        )
        XCTAssertEqual(
            Array(rig.logs.messages.dropFirst()),
            [
                "PetalProbe: rx P2P cmd=1 seq=90 code=0 (0x0) src=com.huawei.ohos.maps.app dst=com.huawei.maps.app srcFp=none dstFp=none",
                "PetalProbe: rx P2P seq=90 data=none",
                "PetalProbe: answering ping seq=90 with 0xca (app present)",
            ]
        )
    }

    func testAMessageIsAcknowledged0xcfAndDumpedWithItsTlvs() throws {
        let rig = Rig()
        rig.probe.register()
        try rig.manager.handlePacket(fromWatch(2, 91, bytes("0103616263820303010704020102"), srcFp: "watchFp", dstFp: "phoneFp"))

        let sent = rig.capture.take()
        XCTAssertEqual(sent.count, 1)
        XCTAssertEqual(sent[0]["code"] as? Int, 0xCF)
        XCTAssertEqual(
            sent[0]["tlv"] as? String,
            "010103" + "0202005b" + "0313" + ascii("com.huawei.maps.app") + "0418" + ascii("com.huawei.ohos.maps.app") + "0804000000cf"
        )
        XCTAssertEqual(
            Array(rig.logs.messages.dropFirst()),
            [
                "PetalProbe: rx P2P cmd=2 seq=91 code=0 (0x0) src=com.huawei.ohos.maps.app dst=com.huawei.maps.app srcFp=watchFp dstFp=phoneFp",
                "PetalProbe: rx P2P seq=91 data=14 bytes",
                "PetalProbe: rx P2P seq=91 hex[1/1] 0103616263820303010704020102 |..abc.........|",
                "PetalProbe: rx P2P seq=91 tlv 01 len=3: 616263 = 6382179 \"abc\"",
                "PetalProbe: rx P2P seq=91 tlv 82 len=3: nested",
                "PetalProbe: rx P2P seq=91 tlv 82.03 len=1: 07 = 7",
                "PetalProbe: rx P2P seq=91 tlv 04 len=2: 0102 = 258",
                "PetalProbe: acknowledging message seq=91 with 0xcf",
            ]
        )
    }

    func testLongDataIsSplitIntoLinesAndANonTlvIsSaidSo() {
        let lines = PetalProbeWire.dump("x", Bytes(repeating: 0xFF, count: 600))
        XCTAssertEqual(lines.count, 4)
        XCTAssertEqual(lines[0], "PetalProbe: x data=600 bytes")
        XCTAssertEqual(lines[1], "PetalProbe: x hex[1/2] \(String(repeating: "FF", count: 512)) |\(String(repeating: ".", count: 512))|")
        XCTAssertEqual(lines[2], "PetalProbe: x hex[2/2] \(String(repeating: "FF", count: 88)) |\(String(repeating: ".", count: 88))|")
        XCTAssertEqual(lines[3], "PetalProbe: x tlv: not a Huawei TLV")
        XCTAssertEqual(PetalProbeWire.dump("x", []), ["PetalProbe: x data=0 bytes"])
    }

    func testALongTlvValueIsCutAndUtf8IsPreviewed() {
        let text = Bytes("Malang–Surabaya".utf8)
        let long = Bytes((0..<70).map { UInt8($0) })
        let lines = PetalProbeWire.dump("y", [0x05, UInt8(text.count)] + text + [0x06, 70] + long)
        XCTAssertEqual(lines.count, 4)
        // 0x46 (the length 70) is "F"; 0x00-0x1F are control characters.
        XCTAssertTrue(lines[1].hasSuffix("|..Malang–Surabaya.F\(String(repeating: ".", count: 32)) !\"#$%&'()*+,-./0123456789:;<=>?@ABCDE|"), lines[1])
        XCTAssertEqual(lines[2], "PetalProbe: y tlv 05 len=17: \(text.hexUpper) \"Malang–Surabaya\"")
        XCTAssertEqual(lines[3], "PetalProbe: y tlv 06 len=70: \(Array(long.prefix(64)).hexUpper)...")
    }

    func testFramesNothingHandlesAreLoggedOnlyInThe30sAfterAPing() throws {
        let rig = Rig(now: 1_000)
        rig.probe.register()
        let registered = rig.logs.messages.count
        rig.probe.onUnhandled(service: 0x27, command: 0x05, tlv: [0x01, 0x01, 0xAA], raw: Bytes(repeating: 0, count: 20))
        XCTAssertEqual(rig.logs.messages.count, registered, "nothing before a ping")

        try rig.manager.handlePacket(fromWatch(1, 5))
        let afterPing = rig.logs.messages.count
        rig.clock.now = 1_500
        rig.probe.onUnhandled(service: 0x27, command: 0x05, tlv: [0x01, 0x01, 0xAA], raw: Bytes(repeating: 0, count: 20))
        XCTAssertEqual(
            Array(rig.logs.messages.dropFirst(afterPing)),
            [
                "PetalProbe: unhandled svc=27 cmd=05 500 ms after the ping, raw frame 20 bytes (its hex is on the RX line above)",
                "PetalProbe: unhandled svc=27 cmd=05 data=3 bytes",
                "PetalProbe: unhandled svc=27 cmd=05 hex[1/1] 0101AA |...|",
                "PetalProbe: unhandled svc=27 cmd=05 tlv 01 len=1: AA = 170",
            ]
        )

        let beforeUnclaimed = rig.logs.messages.count
        rig.clock.now = 2_000
        let probe = rig.probe
        rig.manager.setUnclaimedListener { probe.onUnclaimed($0) }
        try rig.manager.handlePacket(fromWatch(2, 6, src: "com.huawei.ohos.other"))
        XCTAssertEqual(
            Array(rig.logs.messages.dropFirst(beforeUnclaimed)),
            [
                "PetalProbe: 1000 ms after the ping, a P2P packet from com.huawei.ohos.other, which no service has:",
                "PetalProbe: unclaimed P2P cmd=2 seq=6 code=0 (0x0) src=com.huawei.ohos.other dst=com.huawei.maps.app srcFp=none dstFp=none",
                "PetalProbe: unclaimed P2P seq=6 data=none",
            ]
        )
        XCTAssertEqual(rig.capture.take().count, 1, "only the ping was answered; nobody answers another package")

        let beforeClose = rig.logs.messages.count
        rig.clock.now = 31_001
        rig.probe.onUnhandled(service: 0x27, command: 0x05, tlv: nil, raw: Bytes(repeating: 0, count: 20))
        try rig.manager.handlePacket(fromWatch(2, 7, src: "com.huawei.ohos.other"))
        XCTAssertEqual(rig.logs.messages.count, beforeClose, "the window closed")
    }

    func testAnUnregisteredProbeAnswersNothing() throws {
        let rig = Rig()
        rig.probe.register()
        rig.manager.unregisterService(PetalProbeWire.phonePackage)
        let before = rig.logs.messages.count
        try rig.manager.handlePacket(fromWatch(1, 9))
        XCTAssertTrue(rig.capture.take().isEmpty)
        XCTAssertEqual(rig.logs.messages.count, before)
    }

    func testFilesFromTheWatchAppAreDumped() {
        let rig = Rig()
        rig.probe.register()
        let before = rig.logs.messages.count
        rig.manager.handleFile(
            srcPackage: PetalProbeWire.watchPackage, dstPackage: PetalProbeWire.phonePackage, srcFingerprint: "a", dstFingerprint: "b", filename: "m.bin",
            data: [0x41, 0x42]
        )
        XCTAssertEqual(
            Array(rig.logs.messages.dropFirst(before)),
            ["PetalProbe: rx file m.bin data=2 bytes", "PetalProbe: rx file m.bin hex[1/1] 4142 |AB|", "PetalProbe: rx file m.bin tlv: not a Huawei TLV"]
        )
    }
}
