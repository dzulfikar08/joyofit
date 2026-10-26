import Foundation
import XCTest
@testable import HuaweiProtocol

final class PacketsPhotoFaceTests: XCTestCase {
    let g = try! Golden.load("packetsPhotoFace")

    func testRequestsMatchJava() throws {
        let requests = g.list("requests")
        XCTAssertEqual(requests.count, 13)
        for c in requests {
            switch c.str("kind") {
            case "info":
                try assertRequest(c) { PhotoFace.InfoRequest.request(position: c.bool("position"), style: c.bool("style"), data: c.bool("data")) }
            case "save":
                let body = try HuaweiTLV(parsing: c.bytes("body"))
                try assertRequest(c) { PhotoFace.SaveRequest.request(body) }
            case "answer":
                try assertRequest(c) {
                    PhotoFace.FileRequestAnswer.request(fileName: c.str("name"), fileType: c.int("fileType"), resourceType: c.int("resourceType"), status: c.int("status"))
                }
            default:
                try assertRequest(c) { PhotoFace.ReportAck.request(watchfaceId: c.str("faceId"), version: c.str("version")) }
            }
        }
    }
}

final class PhotoFaceCodecTests: XCTestCase {
    func hex(_ b: Bytes) -> String { b.hexLower }

    // MARK: the .bin image

    func testBinMatchesHuaweiHealthsEncoderOnEveryVector() throws {
        XCTAssertEqual(PhotoBinVectors.vectors.count, 39)
        for v in PhotoBinVectors.vectors {
            let encoded = try PhotoBin.encode(v.pixels, width: v.pixels.count, height: 1, format: PhotoBin.Format.from(option: v.format))
            XCTAssertEqual(hex(encoded), v.hex, "format \(v.format) pixels \(v.pixels.map { String($0, radix: 16) })")
        }
    }

    /// The pattern of the Huawei-encoder run that gave the digests: flat bands, gradients, runs of 5 and 6, marker-coloured pixels.
    func pattern(_ w: Int, _ h: Int) -> [UInt32] {
        var p = [UInt32](repeating: 0, count: w * h)
        var s: Int64 = 12345
        for y in 0..<h {
            for x in 0..<w {
                let v: UInt32
                if y < 8 {
                    v = 0xFF10_2030
                } else if y < 16 {
                    v = 0xFF00_0000 | UInt32(x * 4) << 16 | UInt32(y * 5) << 8 | UInt32(x ^ y)
                } else if y < 24 {
                    v = (x / 5) % 2 == 0 ? 0xFFFF_FFFF : 0xFF00_FF00
                } else if y < 30 {
                    v = (x / 6) % 2 == 0 ? 0xFFFF_0000 : 0xFF00_00FF
                } else {
                    s = s &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
                    let r = Int(UInt64(bitPattern: s) >> 60)
                    v = r < 10 ? 0xFF45_6789 : 0xFF00_0000 | UInt32((UInt64(bitPattern: s) >> 20) & 0xFF_FFFF)
                }
                p[y * w + x] = v
            }
        }
        return p
    }

    func testBinMatchesHuaweiHealthsEncoderOnALargerImage() throws {
        let digests: [(PhotoBin.Format, Int, String)] = [
            (.argb32, 6052, "243f09e390d867ffe5fa74847b6cd9c58d6a5bd9b73eb36799ff84baff564355"),
            (.rgb24, 4964, "cfafdf4d3ea082a90dcc7b4a798255959be5c155430d6cd6e998908e5e25d9da"),
            (.rgb565, 3988, "3dcf296e043da4cbea8ac3da604bb9ca1ad71511bf64a9770d4c1a83f8f0c4c8"),
        ]
        let pixels = pattern(64, 40)
        for (format, length, sha) in digests {
            let encoded = try PhotoBin.encode(pixels, width: 64, height: 40, format: format)
            XCTAssertEqual(encoded.count, length, "\(format) length")
            XCTAssertEqual(hex(SHA256.hash(encoded)), sha, "\(format) sha256")
        }
    }

    func testBinHeaderCarriesTheFormatAndTheLittleEndianSize() throws {
        let encoded = try PhotoBin.encode([UInt32](repeating: 0xFF11_2233, count: 408 * 480), width: 408, height: 480, format: .rgb24)
        // 45 23 88 08, 408 = 0x0198 and 480 = 0x01e0 little endian, then one run: marker 456789, the pixel (blue, green, red), count 195840 = 0x02fd00.
        XCTAssertEqual(hex(encoded), "45238808" + "9801" + "e001" + "896745" + "332211" + "00fd02")
    }

    func testOptionPicksTheFormat() {
        XCTAssertEqual(PhotoBin.Format.from(option: 0), .argb32)
        XCTAssertEqual(PhotoBin.Format.from(option: 1), .rgb24)
        XCTAssertEqual(PhotoBin.Format.from(option: 2), .rgb565)
        XCTAssertEqual(PhotoBin.Format.from(option: 9), .argb32, "anything else is the 32-bit flavour, as in Huawei Health")
    }

    func testAPixelCountThatDoesNotMatchTheSizeIsRefused() {
        XCTAssertThrowsError(try PhotoBin.encode([0, 0, 0, 0, 0], width: 2, height: 2, format: .argb32))
        XCTAssertThrowsError(try PhotoBin.encode([], width: 0, height: 0, format: .argb32))
    }

    // MARK: reading the watch's answers

    func captured() throws -> HuaweiTLV { try HuaweiTLV(parsing: Bytes(hex: PhotoBinVectors.capturedInfo)!) }

    func testInfoIsReadFromTheWatchAnswer() throws {
        let info = try PhotoFaceCodec.parseInfo(try captured())
        XCTAssertEqual(info.maxPhotos, 20)
        XCTAssertTrue(info.intellectColour)
        XCTAssertEqual(info.backgroundType, 2)
        XCTAssertEqual(info.positionIndex, 2)
        XCTAssertEqual(info.styleIndex, 1)
        XCTAssertEqual(info.dataIndex, 0)
        XCTAssertEqual(info.imageOption, 1)
        XCTAssertEqual(info.photos.map(\.name), ["1791994229644.png"])
        // 27/09 numbered it 1; the watch reports it from 0.
        XCTAssertEqual(info.photos.map(\.index), [0])
        XCTAssertEqual(info.photos[0].portPosition, 2)
        XCTAssertEqual(info.photos[0].portraitMode, 0)
        XCTAssertEqual(info.dataSlots.count, 6)
        XCTAssertEqual(info.selectedOptions, [0, 0])
    }

    func photoList(_ entries: [(Int, String)]) -> HuaweiTLV {
        var list = HuaweiTLV()
        for (index, name) in entries {
            var e = HuaweiTLV()
            e.put(0x06, byte: UInt8(index))
            e.put(0x07, string: name)
            list.put(0x85, tlv: e)
        }
        return list
    }

    func testPhotosAreOrderedByTheirIndex() throws {
        var tlv = HuaweiTLV()
        tlv.put(0x01, byte: 8)
        tlv.put(0x84, tlv: photoList([(2, "b.png"), (1, "a.png"), (1, "z.png")]))
        let info = try PhotoFaceCodec.parseInfo(try HuaweiTLV(parsing: tlv.serialize()))
        XCTAssertEqual(info.photos.map(\.name), ["a.png", "z.png", "b.png"], "stable for equal indexes")
    }

    func testInfoWithoutAStructHasNoPhotos() throws {
        var tlv = HuaweiTLV()
        tlv.put(0x01, byte: 6)
        tlv.put(0x03, byte: 0)
        let info = try PhotoFaceCodec.parseInfo(tlv)
        XCTAssertEqual(info.maxPhotos, 6)
        XCTAssertEqual(info.imageOption, 0)
        XCTAssertTrue(info.photos.isEmpty)
    }

    func testEntriesWithoutANameAreSkippedAndAMissingIndexIsThePosition() throws {
        var list = HuaweiTLV()
        var noName = HuaweiTLV()
        noName.put(0x06, byte: 0)
        list.put(0x85, tlv: noName)
        var noIndex = HuaweiTLV()
        noIndex.put(0x07, string: "n.png")
        list.put(0x85, tlv: noIndex)
        var tlv = HuaweiTLV()
        tlv.put(0x84, tlv: list)
        let info = try PhotoFaceCodec.parseInfo(tlv)
        XCTAssertEqual(info.photos, [PhotoSlot(index: 0, name: "n.png")])
    }

    /// The Fit 4 Pro photo face's new-photo values, as in `PhotoFaceCodec.knownFaceConfigs`: position 1, time style 2, font 1.
    let fitConfig = PhotoFaceCodec.faceConfig("2180736265")

    func testSaveMatchesTheBytesReconstructedFromHuaweiHealthsCapturedAlbumJson() throws {
        // Huawei Health 17.0.8.300, Fit 4 Pro, 2026-10-25 21:10:47 (after which the watch's "add photo" prompt went away): the watch's 27/08
        // answer before, and the album the page handed to makeNewPhotoInfoCommand (see the Kotlin PhotoFaceTest for the JSON). The expected
        // bytes are reconstructed from that captured album JSON via the encoder (not a capture of the 27/09 on the wire).
        let before = try HuaweiTLV(parsing: Bytes(hex: "01011402010103010284000801020901010A01000B010111010012010093001701009F00")!)
        let info = try PhotoFaceCodec.parseInfo(before)
        let fields = PhotoSaveFields(
            config: fitConfig, gaussSwitch: PhotoFaceCodec.gaussSwitch(1), timeColours: ["20261025211044440.png": PhotoFaceCodec.smartColour(0xFFFF_E7D8)]
        )
        let request = PhotoFace.SaveRequest.request(PhotoFaceCodec.saveTlv(info, ["20261025211044440.png"], fields))
        XCTAssertEqual(request.commandId, 0x09)
        let expected = "010101824a8348040100051532303236313032353231313034343434302e706e670a01010b01000c01020d092330316666653764380e09233030303030303030"
            + "2901001501021601011701011c0100" + "0601010701020901000f0100100100" + "1c0100" + "9d0a9e031f01009e031f0100"
        XCTAssertEqual(hex(request.tlv!.serialize()), expected)
    }

    func testAPhotoOnTheWatchKeepsItsValuesAndMissingOnesComeFromTheConfig() throws {
        let info = try PhotoFaceCodec.parseInfo(try captured())
        let fields = PhotoSaveFields(config: fitConfig, gaussSwitch: 0, timeColours: ["new.png": "#01123456"])
        let expected = "01010282810283440401000511313739313939343232393634342e706e670a01020b01000c01010d092330303030303030300e09233030303030303030"
            + "2901001501011601011701021c0100"
            + "833a04010105076e65772e706e670a01010b01000c01020d092330313132333435360e092330303030303030302901001501021601011701011c0100"
            + "0601010701020901000f0100100100" + "9130" + String(repeating: "9206130100140100", count: 6) + "1c0100" + "9d0a"
            + String(repeating: "9e031f0100", count: 2)
        XCTAssertEqual(hex(PhotoFaceCodec.saveTlv(info, ["1791994229644.png", "new.png"], fields).serialize()), expected)
    }

    func testWithoutTheGaussianTagThereAreNoSmartFieldsAndTheSwitchIsMinusOne() throws {
        let info = try PhotoFaceCodec.parseInfo(try captured())
        let tlv = PhotoFaceCodec.saveTlv(info, [], PhotoSaveFields(config: fitConfig, gaussSwitch: PhotoFaceCodec.gaussSwitch(-1)))
        let expected = "010100" + "0601010701020901000f0100100100" + "9130" + String(repeating: "9206130100140100", count: 6) + "1c01ff" + "9d0a"
            + String(repeating: "9e031f0100", count: 2)
        XCTAssertEqual(hex(tlv.serialize()), expected)
        let one = try PhotoFaceCodec.saveTlv(info, ["a.png"], PhotoSaveFields(config: fitConfig, gaussSwitch: -1)).object(0x82).object(0x83)
        XCTAssertFalse(one.contains(0x15))
        XCTAssertFalse(one.contains(0x1c))
    }

    func testTheSmartColourIsHuaweiHealthsMarkerAndTheRgb() {
        XCTAssertEqual(PhotoFaceCodec.smartColour(0xFFFF_E7D8), "#01ffe7d8")
        XCTAssertEqual(PhotoFaceCodec.smartColour(0xFF00_0000), "#01000000")
        XCTAssertEqual(PhotoFaceCodec.gaussSwitch(1), 0)
        XCTAssertEqual(PhotoFaceCodec.gaussSwitch(0), 0)
        XCTAssertEqual(PhotoFaceCodec.gaussSwitch(-1), -1)
    }

    func testTheKnownFaceHasItsValuesAndAnUnknownOneHuaweiHealthsFallbacks() {
        let fit = PhotoFaceCodec.faceConfig("2180736265")
        XCTAssertEqual([fit.timePosition, fit.timeStyle, fit.font, fit.positionIndex, fit.styleIndex], [1, 2, 1, 1, 2])
        XCTAssertEqual(fit.positionRects[1], [68, 18, 406, 182])
        XCTAssertEqual(Set(fit.positionRects.keys), Set(1...9))
        let unknown = PhotoFaceCodec.faceConfig("123")
        XCTAssertEqual([unknown.timePosition, unknown.timeStyle, unknown.font, unknown.positionIndex, unknown.styleIndex], [1, 2, 1, 1, 2])
        XCTAssertTrue(unknown.positionRects.isEmpty)
    }

    func testSaveStatusReadsCodeAndTransferCount() {
        var t = HuaweiTLV()
        t.put(0x08, byte: 2)
        t.put(0x7f, int: 100_000)
        XCTAssertEqual(PhotoFaceCodec.parseSaveStatus(t), PhotoSaveStatus(code: 100_000, transferNum: 2))
        var only = HuaweiTLV()
        only.put(0x7f, int: 100_000)
        XCTAssertEqual(PhotoFaceCodec.parseSaveStatus(only).transferNum, 0)
        XCTAssertEqual(PhotoFaceCodec.parseSaveStatus(HuaweiTLV()).code, -1)
    }

    func testFileRequestDefaultsLikeHuaweiHealth() throws {
        var full = HuaweiTLV()
        full.put(0x01, string: "n.png")
        full.put(0x02, byte: 3)
        full.put(0x05, byte: 1)
        XCTAssertEqual(try PhotoFaceCodec.parseFileRequest(full), PhotoFileRequest(name: "n.png", fileType: 3, resourceType: 1))
        var bare = HuaweiTLV()
        bare.put(0x01, string: "n.png")
        XCTAssertEqual(try PhotoFaceCodec.parseFileRequest(bare), PhotoFileRequest(name: "n.png", fileType: 3, resourceType: -1))
        var noName = HuaweiTLV()
        noName.put(0x02, byte: 3)
        XCTAssertNil(try PhotoFaceCodec.parseFileRequest(noName))
    }

    func testTheFileSentIsThePngOnlyForResourceTypeOne() {
        XCTAssertEqual(PhotoFaceCodec.contentFor(PhotoFileRequest(name: "a.png", fileType: 3, resourceType: 1), png: [1], bin: [2]), [1])
        XCTAssertEqual(PhotoFaceCodec.contentFor(PhotoFileRequest(name: "a.png", fileType: 3, resourceType: -1), png: [1], bin: [2]), [2])
        XCTAssertEqual(PhotoFaceCodec.contentFor(PhotoFileRequest(name: "a.png", fileType: 3, resourceType: 0), png: [1], bin: [2]), [2])
    }

    func testReportReadsTypeAndFailedCount() throws {
        var t = HuaweiTLV()
        t.put(0x01, string: "2180736265")
        t.put(0x02, string: "2.4.11")
        t.put(0x03, byte: 4)
        t.put(0x04, byte: 1)
        t.put(0x7f, int: 100_000)
        XCTAssertEqual(try PhotoFaceCodec.parseReport(t), WatchfaceReport(id: "2180736265", version: "2.4.11", reportType: 4, failedNum: 1, code: 100_000))
        XCTAssertEqual(try PhotoFaceCodec.parseReport(HuaweiTLV()).code, 100_000, "no status is fine")
    }

    func testPngNameAddsTheSuffixOnce() {
        XCTAssertEqual(PhotoFaceCodec.pngName("a"), "a.png")
        XCTAssertEqual(PhotoFaceCodec.pngName("a.png"), "a.png")
    }
}

// MARK: - the flow against a fake watch

final class PhotoFaceOpsTests: XCTestCase {
    let face = "2180736265"

    func frame(_ service: UInt8, _ command: UInt8, _ tlv: HuaweiTLV) -> Bytes { UploadFakeWatch.tlvFrame(service, command, tlv) }

    func infoTlv(_ names: [String]) -> HuaweiTLV {
        var list = HuaweiTLV()
        for (i, n) in names.enumerated() {
            var e = HuaweiTLV()
            e.put(0x06, byte: UInt8(i))
            e.put(0x07, string: n)
            list.put(0x85, tlv: e)
        }
        var tlv = HuaweiTLV()
        tlv.put(0x01, byte: 8)
        tlv.put(0x02, byte: 0)
        tlv.put(0x03, byte: 2)
        tlv.put(0x08, byte: 1)
        tlv.put(0x0b, byte: 1)
        if !names.isEmpty { tlv.put(0x84, tlv: list) }
        return tlv
    }

    func setup(_ responder: @escaping UploadFakeWatch.Responder) -> (UploadFakeWatch, HuaweiSession, SleepFilesLogCollector) {
        let logs = SleepFilesLogCollector()
        let watch = UploadFakeWatch(responder)
        let session = HuaweiSession(sink: watch, log: logs.sink)
        session.params.secretKey = Bytes(repeating: 0, count: 16)
        watch.attach(session)
        return (watch, session, logs)
    }

    func ops(_ session: HuaweiSession, _ logs: SleepFilesLogCollector, stallMs: Int = 3_000, reportWaitMs: Int = 500) -> PhotoFaceOps {
        PhotoFaceOps(session: session, log: logs.sink, queryMs: 2_000, stallMs: stallMs, reportWaitMs: reportWaitMs)
    }

    /// What the watch's file upload side does for one file: the same dance GB expects, driven by the watch.
    final class FileSink: @unchecked Sendable {
        let unit: Int
        let chunk: Int
        let fileId: UInt8 = 5
        private(set) var name = ""
        private(set) var expected = 0
        private(set) var received = Bytes()
        private(set) var receivedBytes = 0
        private(set) var requestedEnd = 0
        private(set) var fileType = -1

        init(unit: Int = 64, chunk: Int = 200) {
            self.unit = unit
            self.chunk = chunk
        }

        private func nextRequest() -> [Bytes] {
            let position = requestedEnd
            let size = min(chunk, expected - position)
            requestedEnd = position + size
            var t = HuaweiTLV()
            t.put(0x02, int: Int32(position))
            t.put(0x03, int: Int32(size))
            return [UploadFakeWatch.tlvFrame(0x28, 0x05, t)]
        }

        func respond(_ m: UploadFakeWatch.Msg) -> [Bytes]? {
            switch (m.service, m.command) {
            case (0x28, 0x02):
                name = (try? m.tlv?.string(0x01)) ?? ""
                expected = Int((try? m.tlv?.int(0x02)) ?? 0)
                fileType = Int((try? m.tlv?.byte(0x03)) ?? -1)
                received = Bytes(repeating: 0, count: expected)
                receivedBytes = 0
                requestedEnd = 0
                var ok = HuaweiTLV()
                ok.put(0x7f, int: 100_000)
                var id = HuaweiTLV()
                id.put(0x01, byte: fileId)
                return [UploadFakeWatch.tlvFrame(0x28, 0x02, ok), UploadFakeWatch.tlvFrame(0x28, 0x03, id)]
            case (0x28, 0x03):
                var t = HuaweiTLV()
                t.put(0x01, byte: fileId)
                t.put(0x02, string: "1.0")
                t.put(0x03, int: 5000)
                t.put(0x04, int: 0)
                t.put(0x05, int: Int32(unit))
                t.put(0x06, int: Int32(chunk))
                t.put(0x07, int: 10)
                t.put(0x08, int: 0)
                return [UploadFakeWatch.tlvFrame(0x28, 0x04, t)]
            case (0x28, 0x04): return nextRequest()
            case (0x28, 0x06):
                let p = m.payload
                let position = Int(p.u32be(2))
                let data = Array(p[6...])
                received.replaceSubrange(position..<position + data.count, with: data)
                receivedBytes += data.count
                if receivedBytes == expected {
                    var t = HuaweiTLV()
                    t.put(0x02, byte: 1)
                    return [UploadFakeWatch.tlvFrame(0x28, 0x07, t)]
                }
                return receivedBytes == requestedEnd ? nextRequest() : []
            default: return nil
            }
        }
    }

    func testReadInfoAsksAndParses() async throws {
        let (watch, session, logs) = setup { [self] m in
            m.service == 0x27 && m.command == 0x08 ? [frame(0x27, 0x08, infoTlv(["a.png"]))] : []
        }
        let info = try await ops(session, logs).readInfo()
        XCTAssertEqual(info.maxPhotos, 8)
        XCTAssertEqual(info.imageOption, 1)
        XCTAssertEqual(info.photos.map(\.name), ["a.png"])
        let sent = try XCTUnwrap(watch.all(0x27, 0x08).first?.tlv)
        XCTAssertTrue(sent.contains(0x08) && sent.contains(0x09) && sent.contains(0x0a))
        XCTAssertTrue(logs.contains("PhotoInfo: max=8 backgroundType=2 imageOption=1"))
    }

    func testReadInfoWithAnAnswerThatDoesNotParseIsAProtocolError() async throws {
        var broken = HuaweiTLV()
        broken.put(0x84, bytes: [0x85, 0x09])
        let (_, session, logs) = setup { [self] m in m.service == 0x27 && m.command == 0x08 ? [frame(0x27, 0x08, broken)] : [] }
        do {
            _ = try await ops(session, logs).readInfo()
            XCTFail("expected a protocol error")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .protocolError)
        }
    }

    func testSaveWithNothingToTransferEndsAtTheStatus() async throws {
        let (watch, session, logs) = setup { [self] m in
            if m.service == 0x27 && m.command == 0x09 {
                var t = HuaweiTLV()
                t.put(0x08, byte: 0)
                t.put(0x7f, int: 100_000)
                return [frame(0x27, 0x09, t)]
            }
            return []
        }
        let info = try PhotoFaceCodec.parseInfo(infoTlv(["a.png", "b.png"]))
        let result = try await ops(session, logs).save(info, names: ["a.png"], files: [:])
        XCTAssertEqual(result.transferNum, 0)
        XCTAssertNil(result.failedNum)
        let sent = try XCTUnwrap(watch.all(0x27, 0x09).first?.tlv)
        XCTAssertEqual(try sent.byte(0x01), 1)
        XCTAssertEqual(try sent.object(0x82).objects(0x83).first?.string(0x05), "a.png")
        // Huawei Health writes 06 / 07 from the face config (fallbacks 1 / 2 here), not the watch's 08 / 09.
        XCTAssertEqual(try sent.byte(0x06), 1)
        XCTAssertEqual(try sent.byte(0x07), 2)
        XCTAssertTrue(watch.all(0x28, 0x01).isEmpty && watch.all(0x28, 0x02).isEmpty, "no file traffic")
    }

    func testSaveServesTheFileTheWatchAsksForAndEndsAtTheReport() async throws {
        let png = Bytes((0..<300).map { UInt8(truncatingIfNeeded: $0 * 3) })
        let bin = Bytes((0..<700).map { UInt8(truncatingIfNeeded: $0 * 5 + 1) })
        let sink = FileSink()
        let (watch, session, logs) = setup { [self] m in
            switch (m.service, m.command) {
            case (0x27, 0x09):
                var status = HuaweiTLV()
                status.put(0x08, byte: 1)
                status.put(0x7f, int: 100_000)
                var ask = HuaweiTLV()
                ask.put(0x01, string: "new.png")
                ask.put(0x02, byte: 3)
                // The watch goes on to ask for the new photo.
                return [frame(0x27, 0x09, status), frame(0x28, 0x01, ask)]
            case (0x28, 0x07):
                // The phone's result ack: the watch reports the photos received.
                var report = HuaweiTLV()
                report.put(0x01, string: face)
                report.put(0x02, string: "2.4.11")
                report.put(0x03, byte: 4)
                report.put(0x04, byte: 0)
                report.put(0x7f, int: 100_000)
                return [frame(0x27, 0x05, report)]
            default:
                return sink.respond(m) ?? []
            }
        }
        let info = try PhotoFaceCodec.parseInfo(infoTlv(["a.png"]))
        let progress = ProgressRecorder()

        let result = try await ops(session, logs).save(info, names: ["a.png", "new.png"], files: ["new.png": PhotoFiles(png: png, bin: bin)], progress: progress.callback)

        XCTAssertEqual(result, PhotoSaveResult(transferNum: 1, sent: ["a.png", "new.png"], failedNum: 0))
        // The phone answers the request with the status first ...
        let answer = try XCTUnwrap(watch.all(0x28, 0x01).first?.tlv)
        XCTAssertEqual(try answer.string(0x01), "new.png")
        XCTAssertEqual(try answer.byte(0x02), 3)
        XCTAssertFalse(answer.contains(0x05), "the watch sent no resource type")
        XCTAssertEqual(try answer.int(0x7f), 100_000)
        // ... then uploads under the requested name as file type 3, the .bin because no resource type said png.
        XCTAssertEqual(sink.name, "new.png")
        XCTAssertEqual(sink.fileType, 3)
        XCTAssertEqual(sink.received, bin)
        XCTAssertEqual(progress.values.last?.0, 700)
        XCTAssertEqual(progress.values.last?.1, 700)
        // The report is acknowledged with the face id and version it carries.
        let ack = try XCTUnwrap(watch.all(0x27, 0x05).first?.tlv)
        XCTAssertEqual(watch.all(0x27, 0x05).count, 1)
        XCTAssertEqual(try ack.string(0x01), face)
        XCTAssertEqual(try ack.string(0x02), "2.4.11")
        XCTAssertEqual(try ack.int(0x7f), 100_000)
    }

    func testResourceTypeOneGetsThePng() async throws {
        let png = Bytes((0..<150).map { UInt8(truncatingIfNeeded: $0 + 9) })
        let bin = Bytes(repeating: 7, count: 400)
        let sink = FileSink()
        let (_, session, logs) = setup { [self] m in
            switch (m.service, m.command) {
            case (0x27, 0x09):
                var status = HuaweiTLV()
                status.put(0x08, byte: 1)
                status.put(0x7f, int: 100_000)
                var ask = HuaweiTLV()
                ask.put(0x01, string: "p.png")
                ask.put(0x02, byte: 3)
                ask.put(0x05, byte: 1)
                return [frame(0x27, 0x09, status), frame(0x28, 0x01, ask)]
            case (0x28, 0x07):
                var report = HuaweiTLV()
                report.put(0x01, string: face)
                report.put(0x02, string: "2.4.11")
                report.put(0x03, byte: 4)
                report.put(0x04, byte: 0)
                return [frame(0x27, 0x05, report)]
            default:
                return sink.respond(m) ?? []
            }
        }
        _ = try await ops(session, logs).save(try PhotoFaceCodec.parseInfo(infoTlv([])), names: ["p.png"], files: ["p.png": PhotoFiles(png: png, bin: bin)])
        XCTAssertEqual(sink.received, png)
    }

    func testAFileThisSaveDoesNotHoldIsAnsweredAsMissing() async throws {
        let (watch, session, logs) = setup { [self] m in
            guard m.service == 0x27 && m.command == 0x09 else { return [] }
            var status = HuaweiTLV()
            status.put(0x08, byte: 1)
            status.put(0x7f, int: 100_000)
            var ask = HuaweiTLV()
            ask.put(0x01, string: "other.png")
            ask.put(0x02, byte: 3)
            return [frame(0x27, 0x09, status), frame(0x28, 0x01, ask)]
        }
        do {
            _ = try await ops(session, logs, stallMs: 800, reportWaitMs: 300).save(
                try PhotoFaceCodec.parseInfo(infoTlv([])), names: ["p.png"], files: ["p.png": PhotoFiles(png: [1], bin: [1])]
            )
            XCTFail("the watch never got its photo")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .timeout)
        }
        XCTAssertEqual(try watch.all(0x28, 0x01).first?.tlv?.int(0x7f), 140_006)
        XCTAssertTrue(watch.all(0x28, 0x02).isEmpty)
    }

    func testAMissingReportAfterTheLastPhotoIsOnlyLogged() async throws {
        let sink = FileSink()
        let (_, session, logs) = setup { [self] m in
            if m.service == 0x27 && m.command == 0x09 {
                var status = HuaweiTLV()
                status.put(0x08, byte: 1)
                status.put(0x7f, int: 100_000)
                var ask = HuaweiTLV()
                ask.put(0x01, string: "p.png")
                ask.put(0x02, byte: 3)
                return [frame(0x27, 0x09, status), frame(0x28, 0x01, ask)]
            }
            return sink.respond(m) ?? []
        }
        let result = try await ops(session, logs, reportWaitMs: 300).save(
            try PhotoFaceCodec.parseInfo(infoTlv([])), names: ["p.png"], files: ["p.png": PhotoFiles(png: [1, 2, 3], bin: Bytes(repeating: 9, count: 50))]
        )
        XCTAssertNil(result.failedNum)
        XCTAssertTrue(logs.contains("no type 4 report within 300ms after 1 photo(s)"))
    }

    func testARefusedPhotoListIsReportedWithTheStatus() async throws {
        let (_, session, logs) = setup { [self] m in
            guard m.service == 0x27 && m.command == 0x09 else { return [] }
            var t = HuaweiTLV()
            t.put(0x7f, int: 140_004)
            return [frame(0x27, 0x09, t)]
        }
        do {
            _ = try await ops(session, logs).save(try PhotoFaceCodec.parseInfo(infoTlv([])), names: ["p.png"], files: [:])
            XCTFail("expected a rejection")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .uploadRejected)
            XCTAssertEqual(e.statusCode, 140_004)
        }
    }
}
