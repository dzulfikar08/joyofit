import Foundation
import XCTest
@testable import HuaweiProtocol

/// `list` / set active / delete / install against a fake 0x27 + 0x28 watch (the Kotlin WatchfaceTest cases).
final class WatchfaceOpsTests: XCTestCase {
    final class Face {
        let id: String
        let version: String
        let name: String
        var type: Int
        init(_ id: String, _ version: String, _ name: String, _ type: Int) {
            self.id = id
            self.version = version
            self.name = name
            self.type = type
        }
    }

    /// A watch with a face list. The upload is accepted and appended unless `dropUploads`.
    final class WatchSim: @unchecked Sendable {
        let lock = NSLock()
        var faces = [Face("1000", "1.0.0", "Factory", 0b11), Face("2000", "1.2.0", "Mine", 0)]
        var width = 408
        var height = 480
        var dropUploads = false
        var ignoreOperations = false
        var answerNames = true
        /// 0x7f of the answer to a 27/03 that names a face the watch does not have; nil leaves the tag out.
        var announceCode: Int32? = 100_000
        /// Tag 0x04 of that answer; nil leaves it out.
        var needReceive: UInt8? = 1
        /// The watch does not answer a 27/03 that names a face it does not have.
        var silentAnnounce = false
        /// Tag 0x11 of the params answer; nil leaves it out.
        var capability: Int32?
        /// The watch sends no 27/05 after the upload.
        var confirm = true
        /// The watch reports the uploaded face deleted (27/05 type 3) right behind the confirmation and does not keep it.
        var removeAfterConfirm = false
        /// 0x7f of the answer to an activation of the uploaded face (after the upload); nil answers like an announcement.
        var rejectActivation: Int32?
        private var uploadName = ""
        private var received = 0
        private var uploadSize = 0
        private var requestedEnd = 0
        private let unit = 100
        private let chunk = 250

        private func tlvFrame(_ service: UInt8, _ command: UInt8, _ tlv: HuaweiTLV) -> Bytes { UploadFakeWatch.tlvFrame(service, command, tlv) }

        private func nextRequest() -> [Bytes] {
            let position = requestedEnd
            let size = min(chunk, uploadSize - position)
            requestedEnd = position + size
            var t = HuaweiTLV()
            t.put(0x02, int: Int32(position))
            t.put(0x03, int: Int32(size))
            return [tlvFrame(0x28, 0x05, t)]
        }

        func respond(_ m: UploadFakeWatch.Msg) -> [Bytes] {
            lock.lock()
            defer { lock.unlock() }
            switch (m.service, m.command) {
            case (0x27, 0x01):
                var t = HuaweiTLV()
                t.put(0x01, string: "2.10")
                t.put(0x02, int: Int32(width))
                t.put(0x03, int: Int32(height))
                t.put(0x04, byte: 1)
                t.put(0x05, byte: 0)
                t.put(0x06, string: "2.1,2.2,2.3,2.4,2.5,2.6,2.7,2.8,2.9,2.10")
                if let capability { t.put(0x11, int: capability) }
                return [tlvFrame(0x27, 0x01, t)]
            case (0x27, 0x02):
                var list = HuaweiTLV()
                for face in faces {
                    var f = HuaweiTLV()
                    f.put(0x03, string: face.id)
                    f.put(0x04, string: face.version)
                    f.put(0x05, byte: UInt8(face.type))
                    list.put(0x82, tlv: f)
                }
                var t = HuaweiTLV()
                t.put(0x81, tlv: list)
                return [tlvFrame(0x27, 0x02, t)]
            case (0x27, 0x06):
                guard answerNames else { return [] }
                var names = HuaweiTLV()
                for face in faces {
                    var f = HuaweiTLV()
                    f.put(0x04, string: face.id)
                    f.put(0x05, string: face.name)
                    names.put(0x83, tlv: f)
                }
                var t = HuaweiTLV()
                t.put(0x82, tlv: names)
                return [tlvFrame(0x27, 0x06, t)]
            case (0x27, 0x03):
                let tlv = m.tlv!
                let id = (try? tlv.string(0x01)) ?? ""
                let version = (try? tlv.string(0x02)) ?? ""
                let op = (try? tlv.byte(0x03)) ?? 0
                let known = faces.contains { $0.id == id && $0.version == version }
                if op == 1 && !known {
                    // Announcement of a face the watch does not have: nothing changes, the watch only answers.
                    if silentAnnounce { return [] }
                    var answer = HuaweiTLV()
                    answer.put(0x01, string: id)
                    answer.put(0x02, string: version)
                    if let needReceive { answer.put(0x04, byte: needReceive) }
                    let code = (!uploadName.isEmpty && rejectActivation != nil) ? rejectActivation : announceCode
                    if let code { answer.put(0x7f, int: code) }
                    return [tlvFrame(0x27, 0x03, answer)]
                }
                if !ignoreOperations {
                    if op == 1 {
                        faces.forEach { $0.type &= ~1 }
                        faces.first { $0.id == id && $0.version == version }?.type |= 1
                    } else if op == 2 {
                        faces.removeAll { $0.id == id }
                    }
                }
                var t = HuaweiTLV()
                t.put(0x7f, int: 100_000)
                return [tlvFrame(0x27, 0x03, t)]
            case (0x28, 0x02):
                uploadName = (try? m.tlv?.string(0x01)) ?? ""
                uploadSize = Int((try? m.tlv?.int(0x02)) ?? 0)
                var ok = HuaweiTLV()
                ok.put(0x7f, int: 100_000)
                var id = HuaweiTLV()
                id.put(0x01, byte: 4)
                return [tlvFrame(0x28, 0x02, ok), tlvFrame(0x28, 0x03, id)]
            case (0x28, 0x03):
                var t = HuaweiTLV()
                t.put(0x01, byte: 4)
                t.put(0x02, string: "1.0")
                t.put(0x03, int: 5000)
                t.put(0x04, int: 0)
                t.put(0x05, int: Int32(unit))
                t.put(0x06, int: Int32(chunk))
                t.put(0x07, int: 10)
                t.put(0x08, int: 0)
                return [tlvFrame(0x28, 0x04, t)]
            case (0x28, 0x04):
                return nextRequest()
            case (0x28, 0x06):
                received += m.payload.count - 6
                if received == uploadSize {
                    var t = HuaweiTLV()
                    t.put(0x02, byte: 0)
                    return [tlvFrame(0x28, 0x07, t)]
                }
                return received == requestedEnd ? nextRequest() : []
            case (0x28, 0x07):
                let parts = javaSplit(uploadName, separator: "_")
                let id = parts[0]
                let version = parts[1]
                if !dropUploads && !removeAfterConfirm { faces.append(Face(id, version, "Night Run", 0)) }
                guard confirm else { return [] }
                var c = HuaweiTLV()
                c.put(0x01, string: id)
                c.put(0x02, string: version)
                c.put(0x03, int: 2)
                var frames = [tlvFrame(0x27, 0x05, c)]
                if removeAfterConfirm {
                    var d = HuaweiTLV()
                    d.put(0x01, string: id)
                    d.put(0x02, string: version)
                    d.put(0x03, int: 3)
                    d.put(0x04, byte: 0)
                    frames.append(tlvFrame(0x27, 0x05, d))
                }
                return frames
            default:
                return []
            }
        }
    }

    func setup(
        _ sim: WatchSim = WatchSim(), commands: [Int: Bytes]? = [0x27: [1, 2, 3, 5, 6]]
    ) -> (sim: WatchSim, watch: UploadFakeWatch, ops: WatchfaceOps, logs: SleepFilesLogCollector, caps: DeviceCaps) {
        let logs = SleepFilesLogCollector()
        let watch = UploadFakeWatch { sim.respond($0) }
        let session = HuaweiSession(sink: watch, log: logs.sink)
        session.params.secretKey = Bytes(repeating: 0, count: 16)
        watch.attach(session)
        let caps = DeviceCaps()
        if let commands { caps.supportedCommands = commands }
        let ops = WatchfaceOps(
            session: session, caps: caps, log: logs.sink, uploadStallMs: 2_000, confirmWaitMs: 500, settleMs: 200, queryMs: 400, now: { 1_700_000_000_000 }
        )
        return (sim, watch, ops, logs, caps)
    }

    func hwt(screen: String = "HWHD13", version: String = "2.1.0") -> WatchfacePackage {
        WatchfacePackage(
            description: WatchfaceDescription(title: "Night Run", titleCn: "夜跑", author: "Joyo", designer: "Joyo", screen: screen, version: version),
            binary: Bytes((0..<300).map { UInt8(truncatingIfNeeded: $0 * 5 + 1) }), preview: nil
        )
    }

    func expectError(_ code: ErrorCode, file: StaticString = #filePath, line: UInt = #line, _ body: () async throws -> Void) async -> WearError? {
        do {
            try await body()
            XCTFail("expected \(code.rawValue)", file: file, line: line)
            return nil
        } catch let e as WearError {
            XCTAssertEqual(e.code, code, file: file, line: line)
            return e
        } catch {
            XCTFail("unexpected \(error)", file: file, line: line)
            return nil
        }
    }

    // MARK: list

    func testListReadsParamsFacesAndNames() async throws {
        let (_, watch, ops, logs, _) = setup()

        let list = try await ops.list()

        XCTAssertEqual(list.screen?.width, 408)
        XCTAssertEqual(list.screen?.height, 480)
        XCTAssertEqual(list.screen?.maxVersion, "2.10")
        XCTAssertEqual(list.screen?.otherVersions, "2.1,2.2,2.3,2.4,2.5,2.6,2.7,2.8,2.9,2.10")
        XCTAssertEqual(list.screen?.supportsSignature, false)
        XCTAssertEqual(list.faces.map(\.id), ["1000", "2000"])
        XCTAssertEqual(list.faces.map(\.name), ["Factory", "Mine"])
        XCTAssertEqual(list.faces.map(\.isFactory), [true, false])
        XCTAssertTrue(list.faces[0].isCurrent)
        XCTAssertFalse(list.faces[1].isCurrent)
        XCTAssertEqual(list.updatedAtMs, 1_700_000_000_000)
        // The 27/06 request names every face.
        let names = try XCTUnwrap(watch.all(0x27, 0x06).first?.tlv)
        XCTAssertEqual(try names.object(0x82).objects(0x83).count, 2)
        XCTAssertTrue(logs.contains("WatchfaceParams: width=408 height=480"))
        // Every tag the watch sent is logged in the clear, text as text and the rest as hex.
        XCTAssertTrue(logs.messages.contains { $0.contains("WatchfaceParams TLV: 01=\"2.10\"") && $0.contains("06=\"2.1,2.2") })
        XCTAssertTrue(logs.messages.contains { $0.contains("1000_1.0.0") && $0.contains("[active]") })
    }

    func testListReadsTheCapabilityBitsHuaweiHealthUses() async throws {
        let sim = WatchSim()
        sim.capability = 0b1100
        let (_, _, ops, logs, _) = setup(sim)

        let list = try await ops.list()
        let screen = try XCTUnwrap(list.screen)

        XCTAssertEqual(screen.supportCapability, 0b1100)
        XCTAssertTrue(screen.supportsSignature)
        XCTAssertTrue(screen.supportsDialUnite)
        XCTAssertTrue(logs.contains("capability=0xc"))
        XCTAssertTrue(logs.contains("watch face signature=true"))
    }

    func testListWithoutNamesFallsBackToIds() async throws {
        let sim = WatchSim()
        sim.answerNames = false
        let (_, _, ops, logs, _) = setup(sim)
        // A silent names query must not fail the list.
        let list = try await ops.list()
        XCTAssertEqual(list.faces.map(\.name), ["1000", "2000"])
        XCTAssertTrue(logs.containsError("WatchfaceNames failed"))
    }

    func testParamsAreOnlyRequestedWhenTheWatchListsThem() async throws {
        let (_, watch, ops, logs, caps) = setup()
        caps.supportedCommands = [0x27: [2, 3, 6]]

        let list = try await ops.list()

        XCTAssertNil(list.screen)
        XCTAssertTrue(watch.all(0x27, 0x01).isEmpty)
        XCTAssertTrue(logs.contains("GB gate supportsWatchfaceParams"))
    }

    func testAWatchWithoutTheServiceIsUnsupported() async throws {
        let (_, watch, ops, _, caps) = setup()
        caps.supportedCommands = [0x07: [1]]
        _ = await expectError(.unsupported) { _ = try await ops.list() }
        XCTAssertTrue(watch.messages.isEmpty)
    }

    func testAWatchThatHasNotListedItsCommandsYetIsTried() async throws {
        let (_, _, ops, _, _) = setup(commands: nil)
        let list = try await ops.list()
        XCTAssertEqual(list.faces.count, 2)
        XCTAssertNil(list.screen, "27/01 is not known to be supported")
    }

    func testListToJSHasTheTypedShape() async throws {
        let (_, _, ops, _, _) = setup()
        let js = try await ops.list().toJS()
        XCTAssertEqual(js["width"] as? Int, 408)
        XCTAssertEqual(js["height"] as? Int, 480)
        XCTAssertEqual(js["maxVersion"] as? String, "2.10")
        XCTAssertEqual(js["updatedAt"] as? Int64, 1_700_000_000_000)
        let faces = try XCTUnwrap(js["faces"] as? [[String: Any]])
        XCTAssertEqual(faces[0]["id"] as? String, "1000")
        XCTAssertEqual(faces[0]["active"] as? Bool, true)
        XCTAssertEqual(faces[0]["factory"] as? Bool, true)
        XCTAssertEqual(Set(faces[0].keys), ["id", "version", "name", "active", "factory", "editable", "video", "photo", "tryout", "kaleidoscope"])
        let empty = WatchfaceList(screen: nil, faces: [], updatedAtMs: 1).toJS()
        XCTAssertTrue(empty["width"] is NSNull)
        XCTAssertTrue(empty["maxVersion"] is NSNull)
    }

    // MARK: set active / delete

    func testSetActiveSendsTheOperationWithTheListedVersionAndChecksTheList() async throws {
        let (_, watch, ops, _, _) = setup()

        let list = try await ops.setActive("2000")

        let op = try XCTUnwrap(watch.all(0x27, 0x03).first?.tlv)
        XCTAssertEqual(watch.all(0x27, 0x03).count, 1)
        XCTAssertEqual(try op.string(0x01), "2000")
        XCTAssertEqual(try op.string(0x02), "1.2.0")
        XCTAssertEqual(try op.byte(0x03), 1)
        XCTAssertEqual(list.faces.map(\.isCurrent), [false, true])
    }

    func testSetActiveFailsWhenTheWatchDoesNotSwitch() async throws {
        let sim = WatchSim()
        sim.ignoreOperations = true
        let (_, _, ops, _, _) = setup(sim)
        let e = await expectError(.uploadRejected) { _ = try await ops.setActive("2000") }
        XCTAssertEqual(e?.statusCode, 100_000)
        XCTAssertTrue(e?.message.contains("did not make") == true)
    }

    func testApplySendsOperationOneForTheListedFaceEvenWhenItIsCurrentAndListsNothing() async throws {
        let (_, watch, ops, _, _) = setup()
        let listed = try await ops.list()
        let current = try XCTUnwrap(listed.faces.first { $0.isCurrent })
        let listsBefore = watch.all(0x27, 0x02).count

        let code = try await ops.apply(current)

        XCTAssertEqual(code, 100_000)
        let op = try XCTUnwrap(watch.all(0x27, 0x03).first?.tlv)
        XCTAssertEqual(watch.all(0x27, 0x03).count, 1)
        XCTAssertEqual(try op.string(0x01), "1000")
        XCTAssertEqual(try op.string(0x02), "1.0.0")
        XCTAssertEqual(try op.byte(0x03), 1)
        XCTAssertEqual(watch.all(0x27, 0x02).count, listsBefore)
    }

    func testTheApplyAfterAPhotoSaveIsHuaweiHealthsOperateCommand() throws {
        // OperateWatchFaceService.buildOperateCommandUtil("2180736265", "2.4.11", -1, 1): 01 id, 02 version, 03 = 1, no instance tag.
        let packet = Watchface.WatchfaceOperation.request(id: "2180736265", version: "2.4.11", operation: Watchface.WatchfaceOperation.operationActive)
        let expected: Bytes = [0x01, 0x0a] + Bytes("2180736265".utf8) + [0x02, 0x06] + Bytes("2.4.11".utf8) + [0x03, 0x01, 0x01]
        XCTAssertEqual(packet.tlv?.serialize(), expected)
    }

    func testAnOperationAnsweredWithZeroOrNoStatusIsAccepted() {
        // WatchFaceWearService.isSuccessErrorCode: 0 or 100000; the Fit 4 Pro answers the photo face apply with 0.
        XCTAssertTrue(WatchfaceOps.operationAccepted(0))
        XCTAssertTrue(WatchfaceOps.operationAccepted(100_000))
        XCTAssertTrue(WatchfaceOps.operationAccepted(nil))
        XCTAssertFalse(WatchfaceOps.operationAccepted(140_004))
        XCTAssertFalse(WatchfaceOps.operationAccepted(100_007))
    }

    func testDeleteSendsOperationTwoAndChecksTheFaceIsGone() async throws {
        let (_, watch, ops, _, _) = setup()

        let list = try await ops.delete("2000")

        XCTAssertEqual(try watch.all(0x27, 0x03).first!.tlv!.byte(0x03), 2)
        XCTAssertEqual(watch.all(0x27, 0x03).count, 1)
        XCTAssertEqual(list.faces.map(\.id), ["1000"])
    }

    func testDeleteFailsWhenTheFaceStaysOnTheWatch() async throws {
        let sim = WatchSim()
        sim.ignoreOperations = true
        let (_, _, ops, _, _) = setup(sim)
        let e = await expectError(.uploadRejected) { _ = try await ops.delete("2000") }
        XCTAssertTrue(e?.message.contains("did not delete") == true)
    }

    func testOperationOnAnUnknownIdIsRejectedBeforeAnythingIsSent() async throws {
        let (_, watch, ops, _, _) = setup()
        _ = await expectError(.invalidArgument) { _ = try await ops.delete("999") }
        XCTAssertTrue(watch.all(0x27, 0x03).isEmpty)
    }

    func testAFaceWithoutAVersionStillGetsAnOperation() throws {
        let packet = Watchface.WatchfaceOperation.request(joinedName: "123_", operation: 1)
        XCTAssertEqual(try packet.tlv!.string(0x01), "123")
        XCTAssertEqual(try packet.tlv!.string(0x02), "")
        XCTAssertEqual(packet.serviceId, 0x27)
        XCTAssertEqual(packet.commandId, 0x03)
        let bare = Watchface.WatchfaceOperation.request(joinedName: "123", operation: 2)
        XCTAssertEqual(try bare.tlv!.string(0x01), "123")
        XCTAssertEqual(try bare.tlv!.string(0x02), "")
        let two = Watchface.WatchfaceOperation.request(joinedName: "1_2.0_x", operation: 2)
        XCTAssertEqual(try two.tlv!.string(0x02), "2.0_x", "the version is everything after the first underscore")
    }

    // MARK: install

    func testInstallUploadsTheBinaryAndReportsTheNewFace() async throws {
        let (_, watch, ops, logs, _) = setup()
        let progress = ProgressRecorder()
        let package = hwt()

        let result = try await ops.install(package, progress: progress.callback, fileName: "123456789_1.0.0")

        let info = try XCTUnwrap(watch.all(0x28, 0x02).first?.tlv)
        XCTAssertEqual(watch.all(0x28, 0x02).count, 1)
        XCTAssertEqual(try info.string(0x01), "123456789_1.0.0")
        XCTAssertEqual(Int(try info.int(0x02)), package.binary.count)
        XCTAssertEqual(try info.byte(0x03), 1)
        XCTAssertTrue(result.listed)
        XCTAssertEqual(result.id, "123456789")
        XCTAssertEqual(result.name, "Night Run")
        XCTAssertEqual(result.bytes, package.binary.count)
        XCTAssertEqual(result.uploadStatus, 0)
        XCTAssertEqual(result.confirmReportType, 2)
        // The announcement first, then reportType 2: the phone asked for the face to become active and this watch did it.
        XCTAssertEqual(watch.all(0x27, 0x03).count, 2)
        XCTAssertTrue(result.active)
        XCTAssertEqual(result.message, "Installed and active.")
        XCTAssertEqual(progress.values.last?.0, package.binary.count)
        XCTAssertEqual(progress.values.first?.0, 0)
        XCTAssertTrue(logs.contains("Install result: "))
        XCTAssertEqual(result.list?.faces.map(\.id), ["1000", "2000", "123456789"])
        let js = result.toJS()
        XCTAssertEqual(js["fileName"] as? String, "123456789_1.0.0")
        XCTAssertEqual(js["uploadStatus"] as? Int, 0)
        XCTAssertEqual(js["listed"] as? Bool, true)
        XCTAssertNotNil(js["list"] as? [String: Any])
    }

    func testInstallRefusesAFaceForAnotherScreenBeforeSendingAnything() async throws {
        let (_, watch, ops, _, _) = setup()
        _ = await expectError(.invalidArgument) { _ = try await ops.install(self.hwt(screen: "HWHD02"), progress: { _, _ in }, fileName: "1_1.0.0") }
        XCTAssertTrue(watch.all(0x28, 0x02).isEmpty)
    }

    func testInstallWithoutKnownScreenSkipsTheCheckButStillUploads() async throws {
        let (_, watch, ops, logs, caps) = setup()
        caps.supportedCommands = [0x27: [2, 3, 6]]

        let result = try await ops.install(hwt(screen: "HWHD02"), progress: { _, _ in }, fileName: "1_1.0.0")

        XCTAssertTrue(result.listed)
        XCTAssertEqual(watch.all(0x28, 0x02).count, 1)
        XCTAssertTrue(logs.contains("screen size is unknown"))
    }

    func testAnUploadTheWatchDropsIsReportedAsNotListed() async throws {
        let sim = WatchSim()
        sim.dropUploads = true
        let (_, _, ops, _, _) = setup(sim)

        let result = try await ops.install(hwt(), progress: { _, _ in }, fileName: "77_1.0.0")

        XCTAssertFalse(result.listed)
        XCTAssertFalse(result.active)
        XCTAssertNotNil(result.list)
        XCTAssertTrue(result.message.contains("does not list the new face"))
        XCTAssertEqual(result.uploadStatus, 0)
    }

    func testInstallFailureCarriesTheWatchsExactCode() async throws {
        let sim = WatchSim()
        let (_, watch, ops, _, _) = setup(sim)
        watch.responder = { m in
            if m.service == 0x28 && m.command == 0x02 {
                var t = HuaweiTLV()
                t.put(0x7f, int: 140_008)
                return [UploadFakeWatch.tlvFrame(0x28, 0x02, t)]
            }
            return sim.respond(m)
        }
        let e = await expectError(.uploadRejected) { _ = try await ops.install(self.hwt(), progress: { _, _ in }, fileName: "5_1.0.0") }
        XCTAssertEqual(e?.statusCode, 140_008)
    }

    func testInstallRefusesANameWithoutAnUnderscore() async throws {
        let (_, watch, ops, _, _) = setup()
        _ = await expectError(.invalidArgument) { _ = try await ops.install(self.hwt(), progress: { _, _ in }, fileName: "noversion") }
        XCTAssertTrue(watch.messages.isEmpty)
    }

    // MARK: install: Huawei Health's announcement (27/03) before the upload

    func testInstallAnnouncesTheFaceWithTheOperationBeforeAnythingIsUploaded() async throws {
        let (_, watch, ops, logs, _) = setup()

        _ = try await ops.install(hwt(), progress: { _, _ in }, fileName: "123456789_2.1.0")

        XCTAssertLessThan(try XCTUnwrap(watch.index(0x27, 0x03)), try XCTUnwrap(watch.index(0x28, 0x02)), "27/03 comes before 28/02")
        let announce = try XCTUnwrap(watch.all(0x27, 0x03).first?.tlv)
        XCTAssertEqual(try announce.string(0x01), "123456789")
        XCTAssertEqual(try announce.string(0x02), "2.1.0")
        XCTAssertEqual(try announce.byte(0x03), 1)
        XCTAssertEqual(announce.entries.map { Int($0.tag) }, [0x01, 0x02, 0x03])
        XCTAssertTrue(logs.contains("announce 123456789_2.1.0 TLV before encryption: 01=\"123456789\" 02=\"2.1.0\" 03=01"))
        XCTAssertTrue(logs.contains("watch answered status=100000 needReceive=1"))
        // The file info that follows carries the name, size, type and the two watch face tags, in the clear in the log.
        XCTAssertTrue(logs.messages.contains { $0.contains("FileInfoSend TLV before encryption: 01=\"123456789_2.1.0\"") && $0.contains("05=\"123456789\" 06=\"2.1.0\"") })
    }

    func testInstallSendsTheSignatureOnlyInTheAnnouncement() async throws {
        let (_, watch, ops, _, _) = setup()

        _ = try await ops.install(hwt(), progress: { _, _ in }, fileName: "123456789_2.1.0", signature: "captured-signature")

        let operations = watch.all(0x27, 0x03)
        XCTAssertEqual(try operations.first!.tlv!.string(0x08), "captured-signature")
        // Huawei Health signs the announcement; the activation that follows 27/05 type 2 carries no signature.
        let activation = try XCTUnwrap(operations.last?.tlv)
        XCTAssertEqual(try activation.byte(0x03), 1)
        XCTAssertEqual(activation.entries.map { Int($0.tag) }, [0x01, 0x02, 0x03])
    }

    func testInstallNamesTheFaceAfterItsOwnVersionByDefault() async throws {
        let (_, watch, ops, _, _) = setup()

        let result = try await ops.install(hwt(), progress: { _, _ in })

        let name = try watch.all(0x28, 0x02).first!.tlv!.string(0x01)
        XCTAssertNotNil(name.range(of: #"^\d{9}_2\.1\.0$"#, options: .regularExpression), name)
        XCTAssertEqual(result.version, "2.1.0")
    }

    func testInstallStopsWhenTheWatchRefusesTheAnnouncement() async throws {
        let sim = WatchSim()
        sim.announceCode = 100_014
        sim.needReceive = nil
        sim.capability = 8
        let (_, watch, ops, _, _) = setup(sim)

        let e = await expectError(.uploadRejected) { _ = try await ops.install(self.hwt(), progress: { _, _ in }, fileName: "123456789_2.1.0") }

        XCTAssertEqual(e?.statusCode, 100_014)
        XCTAssertTrue(e?.message.contains("signature") == true)
        XCTAssertTrue(watch.all(0x28, 0x02).isEmpty, "nothing was uploaded")
    }

    func testAnAnnouncementCodeOfNoteIsDescribedWithoutInventingAMeaning() {
        XCTAssertTrue(describeAnnounceCode(100_007).contains("signature failure"))
        XCTAssertTrue(describeAnnounceCode(100_015).contains("not documented"))
        XCTAssertTrue(describeAnnounceCode(4242).contains("4242"))
        XCTAssertTrue(describeAnnounceCode(4242).contains("not documented"))
    }

    func testAnAnswerWithoutStatusOrNeedReceiveMeansUpload() async throws {
        let sim = WatchSim()
        sim.announceCode = nil
        sim.needReceive = nil
        let (_, watch, ops, _, _) = setup(sim)

        let result = try await ops.install(hwt(), progress: { _, _ in }, fileName: "55_2.1.0")

        XCTAssertEqual(watch.all(0x28, 0x02).count, 1)
        XCTAssertTrue(result.listed)
    }

    func testInstallUploadsNothingWhenTheWatchHasTheFaceAlready() async throws {
        let sim = WatchSim()
        sim.needReceive = 0
        let (_, watch, ops, logs, _) = setup(sim)

        let result = try await ops.install(hwt(), progress: { _, _ in }, fileName: "66_2.1.0")

        XCTAssertTrue(watch.all(0x28, 0x02).isEmpty)
        XCTAssertNil(result.uploadStatus)
        XCTAssertNil(result.confirmReportType)
        XCTAssertFalse(result.listed, "the sim only knows the face after an upload")
        XCTAssertTrue(logs.messages.contains { $0.contains("needReceive=0") && $0.contains("nothing is uploaded") })
    }

    func testInstallUploadsAnywayWhenTheAnnouncementIsNotAnswered() async throws {
        let sim = WatchSim()
        sim.silentAnnounce = true
        let (_, watch, ops, logs, _) = setup(sim)

        let result = try await ops.install(hwt(), progress: { _, _ in }, fileName: "88_2.1.0")

        XCTAssertEqual(watch.all(0x28, 0x02).count, 1)
        XCTAssertTrue(result.listed)
        XCTAssertTrue(logs.contains("no answer from the watch"))
    }

    func testInstallRefusesAFaceTheWatchsVersionRangeDoesNotCover() async throws {
        let (_, watch, ops, _, _) = setup()
        _ = await expectError(.invalidArgument) { _ = try await ops.install(self.hwt(version: "1.0.0"), progress: { _, _ in }, fileName: "9_1.0.0") }
        XCTAssertTrue(watch.all(0x27, 0x03).isEmpty, "not announced either")
        XCTAssertTrue(watch.all(0x28, 0x02).isEmpty)
    }

    func testAMissingConfirmationOnASignatureCapableWatchIsExplained() async throws {
        let sim = WatchSim()
        sim.dropUploads = true
        sim.confirm = false
        sim.capability = 8
        let (_, _, ops, _, _) = setup(sim)

        let result = try await ops.install(hwt(), progress: { _, _ in }, fileName: "77_2.1.0")

        XCTAssertFalse(result.listed)
        XCTAssertNil(result.confirmReportType)
        XCTAssertTrue(result.message.contains("sent no install confirmation (27/05)"))
        XCTAssertTrue(result.message.contains("signature capability"))
    }

    func testAMissingConfirmationOnAWatchWithoutTheCapabilityDoesNotBlameTheSignature() async throws {
        let sim = WatchSim()
        sim.dropUploads = true
        sim.confirm = false
        let (_, _, ops, _, _) = setup(sim)

        let result = try await ops.install(hwt(), progress: { _, _ in }, fileName: "77_2.1.0")

        XCTAssertTrue(result.message.contains("sent no install confirmation (27/05)"))
        XCTAssertFalse(result.message.contains("signature"))
    }

    // The behaviour seen on a Watch Fit 4 Pro (capability 0x3d): the unsigned face is confirmed, its activation is refused with 100014, and
    // the watch reports it deleted about 3 s later.

    func testAFaceTheWatchDeletesAfterConfirmingItIsReportedWithTheSignatureReason() async throws {
        let sim = WatchSim()
        sim.removeAfterConfirm = true
        sim.rejectActivation = 100_014
        sim.capability = 0x3d
        let (_, watch, ops, logs, _) = setup(sim)

        let result = try await ops.install(hwt(), progress: { _, _ in }, fileName: "5551_2.1.0")

        XCTAssertFalse(result.listed)
        XCTAssertFalse(result.active)
        XCTAssertEqual(result.confirmReportType, 2)
        XCTAssertTrue(result.message.hasPrefix("The watch received the face and then deleted it"), result.message)
        XCTAssertTrue(result.message.contains("code 100014"))
        XCTAssertTrue(result.message.contains("27/05 type 3"))
        XCTAssertTrue(result.message.contains("Huawei-issued signature"))
        XCTAssertTrue(logs.contains("the watch reports 5551_2.1.0 deleted"))
        XCTAssertTrue(logs.messages.contains { $0.contains("activation status=100014") && $0.contains("removed by the watch=true") })
        // The announcement, then the activation the confirmation asks for.
        XCTAssertEqual(try watch.all(0x27, 0x03).map { try $0.tlv!.byte(0x03) }, [1, 1])
    }

    func testARefusedActivationAloneIsReportedWithTheSignatureReason() async throws {
        let sim = WatchSim()
        sim.rejectActivation = 100_007
        sim.dropUploads = true
        sim.capability = 0x3d
        let (_, _, ops, _, _) = setup(sim)

        let result = try await ops.install(hwt(), progress: { _, _ in }, fileName: "5552_2.1.0")

        XCTAssertFalse(result.listed)
        XCTAssertTrue(result.message.contains("code 100007"), result.message)
        XCTAssertFalse(result.message.contains("27/05 type 3"))
    }

    func testAKeptFaceIsNotBlamedOnTheSignature() async throws {
        let sim = WatchSim()
        sim.capability = 0x3d
        let (_, _, ops, _, _) = setup(sim)

        let result = try await ops.install(hwt(), progress: { _, _ in }, fileName: "5553_2.1.0")

        XCTAssertTrue(result.listed)
        XCTAssertEqual(result.message, "Installed and active.")
    }
}
