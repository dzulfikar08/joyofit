import XCTest
@testable import HuaweiWearLogic

private final class UploadEvents2: WearEvents, @unchecked Sendable {
    private let lock = NSLock()
    private var _progress: [(Int, Int)] = []
    private var _results: [(ok: Bool, fileName: String, code: Int?, message: String)] = []
    var progress: [(Int, Int)] { lock.locked { _progress } }
    var results: [(ok: Bool, fileName: String, code: Int?, message: String)] { lock.locked { _results } }
    func state(_ state: LinkState, error: String?) {}
    func battery(_ level: Int) {}
    func syncComplete(_ summary: SyncSummary) {}
    func log(_ entry: LogEntry) {}
    func uploadProgress(bytes: Int, total: Int) { lock.locked { _progress.append((bytes, total)) } }
    func uploadResult(ok: Bool, fileName: String, code: Int?, message: String) { lock.locked { _results.append((ok, fileName, code, message)) } }
}

/// A watch with a photo face: 27/01 params, 27/02 list, 27/06 names, 27/03 operations, 27/08 info, 27/09 save, and the 28/xx upload dance for the
/// photos it asks for. The screen is 4 x 3 so a test PNG is a few bytes.
private final class PhotoWatch: FrameSink, @unchecked Sendable {
    private let lock = NSLock()
    private var assembler = PacketAssembler()
    var session: HuaweiSession!
    var hasPhotoFace = true
    var faceCurrent = false
    var photos: [String]
    var maxPhotos: Int
    var saveStatus: Int32 = 100_000
    var applyStatus: Int32 = 100_000
    /// Every 27/03 the phone sent: face id, version and operation.
    private(set) var operations: [(id: String, version: String, operation: Int)] = []
    private(set) var received: [String: Bytes] = [:]
    private var pending: [String] = []
    private var current = ""
    private var expected = 0
    private var buffer = Bytes()
    private var requestedEnd = 0
    private(set) var seen: [(UInt8, UInt8)] = []

    init(photos: [String] = [], maxPhotos: Int = 8) {
        self.photos = photos
        self.maxPhotos = maxPhotos
    }

    private func frame(_ service: UInt8, _ command: UInt8, _ tlv: HuaweiTLV) -> Bytes {
        var body = Bytes([huaweiMagic])
        let inner = Bytes([service, command]) + tlv.serialize()
        body.appendBE(UInt16(inner.count + 1))
        body.append(0)
        body += inner
        body.appendBE(CRC16.checksum(body))
        return body
    }

    private func nextRequest() -> Bytes {
        let size = min(40, expected - requestedEnd)
        var t = HuaweiTLV()
        t.put(0x02, int: Int32(requestedEnd))
        t.put(0x03, int: Int32(size))
        requestedEnd += size
        return frame(0x28, 0x05, t)
    }

    func write(_ frames: [Bytes]) async throws {
        for f in frames {
            var local = lock.locked { assembler }
            let result = try local.feed(f, params: session.params)
            lock.locked { assembler = local }
            guard let packet = result.packet else { continue }
            lock.locked { seen.append((packet.serviceId, packet.commandId)) }
            for r in respond(packet) { session.onData(r) }
        }
    }

    private func respond(_ packet: HuaweiPacket) -> [Bytes] {
        lock.locked {
            switch (packet.serviceId, packet.commandId) {
            case (0x27, 0x01):
                var t = HuaweiTLV()
                t.put(0x01, string: "2.10")
                t.put(0x02, int: 4)
                t.put(0x03, int: 3)
                t.put(0x04, byte: 1)
                t.put(0x05, byte: 0)
                t.put(0x06, string: "2.1,2.2")
                return [frame(0x27, 0x01, t)]
            case (0x27, 0x02):
                var list = HuaweiTLV()
                var normal = HuaweiTLV()
                normal.put(0x03, string: "1000")
                normal.put(0x04, string: "1.0.0")
                normal.put(0x05, byte: faceCurrent || !hasPhotoFace ? 0b10 : 0b11)
                list.put(0x82, tlv: normal)
                if hasPhotoFace {
                    var photo = HuaweiTLV()
                    photo.put(0x03, string: "2180736265")
                    photo.put(0x04, string: "2.4.11")
                    photo.put(0x05, byte: faceCurrent ? 0b10_0001 : 0b10_0000)
                    list.put(0x82, tlv: photo)
                }
                var t = HuaweiTLV()
                t.put(0x81, tlv: list)
                return [frame(0x27, 0x02, t)]
            case (0x27, 0x06):
                var names = HuaweiTLV()
                for id in hasPhotoFace ? ["1000", "2180736265"] : ["1000"] {
                    var n = HuaweiTLV()
                    n.put(0x04, string: id)
                    n.put(0x05, string: id == "1000" ? "Plain" : "Gallery")
                    names.put(0x83, tlv: n)
                }
                var t = HuaweiTLV()
                t.put(0x82, tlv: names)
                return [frame(0x27, 0x06, t)]
            case (0x27, 0x03):
                let id = (try? packet.tlv?.string(0x01)) ?? ""
                let operation = Int(packet.tlv?.byte(0x03, default: -1) ?? -1)
                operations.append((id, (try? packet.tlv?.string(0x02)) ?? "", operation))
                if id == "2180736265" && operation == 1 && applyStatus == 100_000 { faceCurrent = true }
                var t = HuaweiTLV()
                t.put(0x7f, int: applyStatus)
                return [frame(0x27, 0x03, t)]
            case (0x27, 0x08):
                var list = HuaweiTLV()
                for (i, name) in photos.enumerated() {
                    var e = HuaweiTLV()
                    e.put(0x06, byte: UInt8(i))
                    e.put(0x07, string: name)
                    list.put(0x85, tlv: e)
                }
                var t = HuaweiTLV()
                t.put(0x01, byte: UInt8(maxPhotos))
                t.put(0x02, byte: 0)
                t.put(0x03, byte: 2)
                t.put(0x08, byte: 1)
                t.put(0x0b, byte: 1) // 24-bit
                if !photos.isEmpty { t.put(0x84, tlv: list) }
                return [frame(0x27, 0x08, t)]
            case (0x27, 0x09):
                let names = ((try? packet.tlv?.object(0x82).objects(0x83)) ?? []).compactMap { try? $0.string(0x05) }
                var status = HuaweiTLV()
                if saveStatus != 100_000 {
                    status.put(0x7f, int: saveStatus)
                    return [frame(0x27, 0x09, status)]
                }
                let fresh = names.filter { !photos.contains($0) }
                photos = names
                pending = fresh
                status.put(0x08, byte: UInt8(fresh.count))
                status.put(0x7f, int: 100_000)
                var out = [frame(0x27, 0x09, status)]
                if let first = pending.first {
                    var ask = HuaweiTLV()
                    ask.put(0x01, string: first)
                    ask.put(0x02, byte: 3)
                    out.append(frame(0x28, 0x01, ask))
                }
                return out
            case (0x28, 0x02):
                current = (try? packet.tlv?.string(0x01)) ?? ""
                expected = Int((try? packet.tlv?.int(0x02)) ?? 0)
                buffer = Bytes()
                requestedEnd = 0
                var ok = HuaweiTLV()
                ok.put(0x7f, int: 100_000)
                var id = HuaweiTLV()
                id.put(0x01, byte: 5)
                return [frame(0x28, 0x02, ok), frame(0x28, 0x03, id)]
            case (0x28, 0x03):
                var t = HuaweiTLV()
                t.put(0x01, byte: 5)
                t.put(0x02, string: "1.0")
                t.put(0x03, int: 5000)
                t.put(0x04, int: 0)
                t.put(0x05, int: 16)
                t.put(0x06, int: 40)
                t.put(0x07, int: 10)
                t.put(0x08, int: 0)
                return [frame(0x28, 0x04, t)]
            case (0x28, 0x04): return [nextRequest()]
            case (0x28, 0x06):
                guard let plain = decryptChunk(packet) else { return [] }
                buffer += Array(plain[6...])
                if buffer.count == expected {
                    received[current] = buffer
                    var t = HuaweiTLV()
                    t.put(0x02, byte: 1)
                    return [frame(0x28, 0x07, t)]
                }
                return buffer.count == requestedEnd ? [nextRequest()] : []
            case (0x28, 0x07):
                pending.removeAll { $0 == current }
                if let next = pending.first {
                    var ask = HuaweiTLV()
                    ask.put(0x01, string: next)
                    ask.put(0x02, byte: 3)
                    return [frame(0x28, 0x01, ask)]
                }
                var report = HuaweiTLV()
                report.put(0x01, string: "2180736265")
                report.put(0x02, string: "2.4.11")
                report.put(0x03, byte: 4)
                report.put(0x04, byte: 0)
                report.put(0x7f, int: 100_000)
                return [frame(0x27, 0x05, report)]
            default: return []
            }
        }
    }

    private func decryptChunk(_ packet: HuaweiPacket) -> Bytes? {
        guard let payload = packet.payload, let tlv = try? HuaweiTLV(parsing: payload, offset: 2, length: payload.count - 2) else { return nil }
        return try? tlv.fileDownloadDecryptRaw(params: session.params)
    }
}

private final class PhotoSource: LinkHandleSource, @unchecked Sendable {
    var current: LinkHandle?
    func handle() -> LinkHandle? { current }
}

final class PhotoFaceControllerTests: XCTestCase {
    private var dir: URL!

    override func setUp() {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("photoface-\(UUID().uuidString)")
    }

    override func tearDown() { try? FileManager.default.removeItem(at: dir) }

    private func make(
        photos: [String] = [], maxPhotos: Int = 8, connected: Bool = true, tweak: (PhotoWatch) -> Void = { _ in }
    ) -> (PhotoFaceController, UploadEvents2, PhotoWatch) {
        let watch = PhotoWatch(photos: photos, maxPhotos: maxPhotos)
        tweak(watch)
        let session = HuaweiSession(sink: watch, log: { _ in })
        session.params.secretKey = Bytes(repeating: 0, count: 16)
        watch.session = session
        let caps = DeviceCaps()
        caps.supportedCommands = [0x27: [1, 2, 3, 5, 6, 8, 9]]
        let source = PhotoSource()
        if connected { source.current = LinkHandle(address: "A", session: session, caps: caps, operationLock: AsyncLock()) }
        let events = UploadEvents2()
        return (PhotoFaceController(link: source, events: events, store: PhotoStore(directory: dir), progressIntervalMs: 0), events, watch)
    }

    /// A PNG file of `width` x `height` RGB pixels (stored deflate) and its ARGB pixels.
    private func png(_ width: Int, _ height: Int) -> (URL, [UInt32]) {
        var rows = [Bytes]()
        var argb = [UInt32]()
        for y in 0..<height {
            var row = Bytes()
            for x in 0..<width {
                let r = UInt8(x * 40), g = UInt8(y * 50), b = UInt8(x + y)
                row += [r, g, b]
                argb.append(0xFF00_0000 | UInt32(r) << 16 | UInt32(g) << 8 | UInt32(b))
            }
            rows.append(row)
        }
        var raw = Bytes()
        for r in rows { raw += [0] + r }
        var ihdr = Bytes()
        ihdr.appendBE(UInt32(width))
        ihdr.appendBE(UInt32(height))
        ihdr += [8, 2, 0, 0, 0]
        var z: Bytes = [0x78, 0x01, 1, UInt8(raw.count & 0xFF), UInt8(raw.count >> 8), UInt8(~raw.count & 0xFF), UInt8((~raw.count >> 8) & 0xFF)]
        z += raw
        z.appendBE(PngDecoder.adler32(raw))
        func chunk(_ type: String, _ body: Bytes) -> Bytes {
            var out = Bytes()
            out.appendBE(UInt32(body.count))
            let typed = Bytes(type.utf8) + body
            out += typed
            out.appendBE(CRC32.checksum(typed))
            return out
        }
        let file = Bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) + chunk("IHDR", ihdr) + chunk("IDAT", z) + chunk("IEND", [])
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("photo-\(UUID().uuidString).png")
        try! Data(file).write(to: url)
        return (url, argb)
    }

    private func expectError(_ code: ErrorCode, _ body: () async throws -> Void) async -> WearError? {
        do {
            try await body()
            XCTFail("expected \(code.rawValue)")
            return nil
        } catch let e as WearError {
            XCTAssertEqual(e.code, code)
            return e
        } catch {
            XCTFail("\(error)")
            return nil
        }
    }

    func testInfoNamesThePhotoFaceItsScreenAndPhotos() async throws {
        let (controller, _, _) = make(photos: ["1.png"], maxPhotos: 6)
        let js = try await controller.info()
        XCTAssertEqual((js["face"] as? [String: Any])?["id"] as? String, "2180736265")
        XCTAssertEqual((js["face"] as? [String: Any])?["photo"] as? Bool, true)
        XCTAssertEqual(js["width"] as? Int, 4)
        XCTAssertEqual(js["height"] as? Int, 3)
        XCTAssertEqual(js["maxPhotos"] as? Int, 6)
        XCTAssertEqual(js["imageOption"] as? Int, 1)
        XCTAssertEqual(js["backgroundType"] as? Int, 2)
        XCTAssertEqual(js["intellectColour"] as? Bool, false)
        XCTAssertEqual(js["positionIndex"] as? Int, 1)
        XCTAssertTrue(js["styleIndex"] is NSNull)
        let photos = try XCTUnwrap(js["photos"] as? [[String: Any]])
        XCTAssertEqual(photos.first?["name"] as? String, "1.png")
        XCTAssertEqual(photos.first?["index"] as? Int, 0)
        XCTAssertTrue(photos.first?["uri"] is NSNull, "a photo that did not come from this phone has no local copy")
    }

    func testAWatchWithoutAPhotoFaceIsUnsupportedAndOfflineIsNotConnected() async {
        let (controller, _, _) = make(tweak: { $0.hasPhotoFace = false })
        let e = await expectError(.unsupported) { _ = try await controller.info() }
        XCTAssertTrue(e?.message.contains("photo watch face") == true)
        let (offline, _, _) = make(connected: false)
        _ = await expectError(.notConnected) { _ = try await offline.info() }
        _ = await expectError(.notConnected) { _ = try await offline.add(uri: "/x.png") }
        _ = await expectError(.notConnected) { _ = try await offline.delete(name: "a.png") }
        _ = await expectError(.notConnected) { _ = try await offline.setActive() }
    }

    func testAddingAPhotoSendsTheBinKeepsACopyAndReportsTheResult() async throws {
        let (controller, events, watch) = make()
        let (url, pixels) = png(4, 3)
        defer { try? FileManager.default.removeItem(at: url) }

        let js = try await controller.add(uri: url.absoluteString)

        let photos = try XCTUnwrap(js["photos"] as? [[String: Any]])
        XCTAssertEqual(photos.count, 1)
        let name = try XCTUnwrap(photos[0]["name"] as? String)
        XCTAssertTrue(name.hasSuffix(".png"))
        // The 24-bit flavour the watch asked for, run-length coded like Huawei Health's encoder.
        let expectedBin = try PhotoBin.encode(pixels, width: 4, height: 3, format: .rgb24)
        XCTAssertEqual(watch.received[name], expectedBin)
        // The local copy is the picked PNG, and the result says where it is.
        let uri = try XCTUnwrap(photos[0]["uri"] as? String)
        XCTAssertEqual(try Data(contentsOf: URL(string: uri)!), try Data(contentsOf: url))
        XCTAssertEqual(events.results.count, 1)
        XCTAssertEqual(events.results[0].ok, true)
        XCTAssertEqual(events.results[0].fileName, name)
        XCTAssertNil(events.results[0].code)
        XCTAssertEqual(events.results[0].message, "Photo added.")
        XCTAssertEqual(events.progress.first?.0, 0)
        XCTAssertEqual(events.progress.last?.0, expectedBin.count)
        XCTAssertEqual(events.progress.last?.1, expectedBin.count)
    }

    func testAddingAPhotoAppliesTheFaceAgainOnceTheWatchHasReported() async throws {
        let (controller, _, watch) = make()
        let (url, _) = png(4, 3)
        defer { try? FileManager.default.removeItem(at: url) }

        let js = try await controller.add(uri: url.absoluteString)

        // Huawei Health's Apply: 27/09, the upload, the 27/05 report (acknowledged), then 27/03 operation 1 for the photo face.
        XCTAssertEqual(watch.operations.count, 1)
        XCTAssertEqual(watch.operations.first?.id, "2180736265")
        XCTAssertEqual(watch.operations.first?.version, "2.4.11")
        XCTAssertEqual(watch.operations.first?.operation, 1)
        let reportAck = try XCTUnwrap(watch.seen.lastIndex { $0 == (0x27, 0x05) })
        let apply = try XCTUnwrap(watch.seen.firstIndex { $0 == (0x27, 0x03) })
        XCTAssertGreaterThan(apply, reportAck)
        XCTAssertEqual((js["face"] as? [String: Any])?["active"] as? Bool, true)
    }

    func testTheFaceIsAppliedAgainEvenWhenItIsAlreadyTheActiveFace() async throws {
        let (controller, _, watch) = make(photos: ["a.png"], tweak: { $0.faceCurrent = true })

        _ = try await controller.delete(name: "a.png")

        XCTAssertEqual(watch.operations.map(\.operation), [1])
        XCTAssertEqual(watch.operations.first?.id, "2180736265")
        let save = try XCTUnwrap(watch.seen.firstIndex { $0 == (0x27, 0x09) })
        let apply = try XCTUnwrap(watch.seen.firstIndex { $0 == (0x27, 0x03) })
        XCTAssertGreaterThan(apply, save)
    }

    func testARefusedApplyKeepsThePhotoAndSaysWhatTheWatchAnswered() async throws {
        let (controller, events, _) = make(tweak: { $0.applyStatus = 140_004 })
        let (url, _) = png(4, 3)
        defer { try? FileManager.default.removeItem(at: url) }

        let js = try await controller.add(uri: url.absoluteString)

        XCTAssertEqual((js["photos"] as? [[String: Any]])?.count, 1)
        XCTAssertEqual(events.results.first?.ok, true)
        XCTAssertEqual(events.results.first?.message, "Photo added, but the watch answered 140004 when the photo face was applied again.")
    }

    func testAPhotoOfTheWrongSizeIsRefusedBeforeAnythingIsSent() async throws {
        let (controller, events, watch) = make()
        let (url, _) = png(5, 3)
        defer { try? FileManager.default.removeItem(at: url) }
        let e = await expectError(.invalidArgument) { _ = try await controller.add(uri: url.absoluteString) }
        XCTAssertTrue(e?.message.contains("5 x 3 px") == true)
        XCTAssertTrue(e?.message.contains("exactly 4 x 3 px") == true)
        XCTAssertFalse(watch.seen.contains { $0 == (0x27, 0x09) })
        XCTAssertEqual(events.results.count, 1)
        XCTAssertEqual(events.results[0].ok, false)
        XCTAssertEqual(events.results[0].fileName, "photo")
    }

    func testAFileThatIsNoPngIsRefused() async throws {
        let (controller, events, _) = make()
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("junk-\(UUID().uuidString).jpg")
        try Data(repeating: 0xFF, count: 100).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        let e = await expectError(.invalidArgument) { _ = try await controller.add(uri: url.absoluteString) }
        XCTAssertTrue(e?.message.contains("PNG") == true)
        XCTAssertEqual(events.results.first?.ok, false)
    }

    func testAFullFaceTakesNoMorePhotos() async throws {
        let (controller, _, watch) = make(photos: ["a.png"], maxPhotos: 1)
        let (url, _) = png(4, 3)
        defer { try? FileManager.default.removeItem(at: url) }
        let e = await expectError(.invalidArgument) { _ = try await controller.add(uri: url.absoluteString) }
        XCTAssertTrue(e?.message.contains("holds 1 photos already") == true)
        XCTAssertFalse(watch.seen.contains { $0 == (0x27, 0x09) })
    }

    func testAWatchThatRefusesThePhotoListReportsItsCode() async throws {
        let (controller, events, _) = make(tweak: { $0.saveStatus = 140_004 })
        let (url, _) = png(4, 3)
        defer { try? FileManager.default.removeItem(at: url) }
        let e = await expectError(.uploadRejected) { _ = try await controller.add(uri: url.absoluteString) }
        XCTAssertEqual(e?.statusCode, 140_004)
        XCTAssertEqual(events.results.first?.ok, false)
        XCTAssertEqual(events.results.first?.code, 140_004)
    }

    func testDeletingAPhotoRemovesItFromTheWatchAndTheLocalCopy() async throws {
        let (controller, _, _) = make()
        let (url, _) = png(4, 3)
        defer { try? FileManager.default.removeItem(at: url) }
        let added = try await controller.add(uri: url.absoluteString)
        let name = try XCTUnwrap((added["photos"] as? [[String: Any]])?.first?["name"] as? String)
        let local = try XCTUnwrap(PhotoStore(directory: dir).uri(name))

        _ = await expectError(.invalidArgument) { _ = try await controller.delete(name: "nope.png") }
        let after = try await controller.delete(name: name)

        XCTAssertEqual((after["photos"] as? [[String: Any]])?.count, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: URL(string: local)!.path))
    }

    func testSettingTheFaceActiveActivatesItOnce() async throws {
        let (controller, _, watch) = make()
        let first = try await controller.setActive()
        XCTAssertEqual((first["face"] as? [String: Any])?["active"] as? Bool, true)
        XCTAssertEqual(watch.seen.filter { $0 == (0x27, 0x03) }.count, 1)
        _ = try await controller.setActive()
        XCTAssertEqual(watch.seen.filter { $0 == (0x27, 0x03) }.count, 1, "already the active face: nothing is sent")
    }

    func testTheStoreForgetsCopiesOfPhotosTheWatchNoLongerHolds() throws {
        let store = PhotoStore(directory: dir)
        try store.save("a.png", [1])
        try store.save("b.png", [2])
        store.keepOnly(["b.png"])
        XCTAssertNil(store.uri("a.png"))
        XCTAssertNotNil(store.uri("b.png"))
        XCTAssertNotNil(store.uri("b.png").flatMap { URL(string: $0) }?.isFileURL)
    }
}
