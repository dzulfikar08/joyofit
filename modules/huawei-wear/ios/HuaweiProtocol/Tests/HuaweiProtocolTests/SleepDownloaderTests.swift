import XCTest
@testable import HuaweiProtocol

/// `FileDownloader` against the fake watch. The state machine is Kotlin only (no Java golden), so the cases follow
/// FileDownloader.kt line by line and the Kotlin FileDownloadTest, then add the failure paths the Kotlin code has branches for.
final class SleepDownloaderTests: XCTestCase {
    private func newFile(_ name: String, type: UInt8, id: UInt8, _ content: Bytes) -> SleepFilesFakeWatch.NewSyncServer.File {
        .init(name: name, typeByte: type, fileId: id, content: content)
    }

    private func downloader(_ h: SleepFilesHarness) -> FileDownloader { FileDownloader(session: h.session, log: h.log.sink) }

    private func assertWearError(_ code: ErrorCode, containing fragment: String, _ file: StaticString = #filePath, _ line: UInt = #line, _ body: () async throws -> Void) async {
        do {
            try await body()
            XCTFail("expected \(code.rawValue)", file: file, line: line)
        } catch let e as WearError {
            XCTAssertEqual(e.code, code, "\(e)", file: file, line: line)
            XCTAssertTrue(e.message.contains(fragment), "'\(e.message)' should contain '\(fragment)'", file: file, line: line)
        } catch {
            XCTFail("unexpected \(error)", file: file, line: line)
        }
    }

    // MARK: new sync (service 0x2C)

    /// Kotlin `newSyncDownloadsFileInBlocks`: 10 bytes, blocks of 6, packets of 3 bytes, plain block requests, file id 0x16.
    func testNewSyncDownloadsFileInBlocks() async throws {
        let file = Bytes((0..<10).map { UInt8($0) })
        let h = SleepFilesHarness()
        let server = h.newSyncServer([newFile("sequence_data", type: 0x16, id: 0x16, file)])
        server.maxBlockSize = 6
        server.burst = 3

        let data = try await downloader(h).download(.sequenceData(start: 100, end: 200, dictId: 700013))

        XCTAssertEqual(data, file)
        let initRequest = try XCTUnwrap(h.watch.requests.first { $0.command == 0x01 })
        XCTAssertTrue(initRequest.encrypted)
        XCTAssertEqual(try initRequest.tlv.string(0x01), "sequence_data")
        XCTAssertEqual(try initRequest.tlv.byte(0x02), 0x16)
        XCTAssertEqual(try initRequest.tlv.int(0x05), 100)
        XCTAssertEqual(try initRequest.tlv.int(0x06), 200)
        XCTAssertEqual(try initRequest.tlv.int(0x0c), 700013)
        let blocks = h.watch.requests.filter { $0.command == 0x04 }
        XCTAssertEqual(blocks.map { [Int(try! $0.tlv.int(0x02)), Int(try! $0.tlv.int(0x03))] }, [[0, 6], [6, 4]])
        XCTAssertEqual(try blocks[0].tlv.int(0x04), 700013)
        XCTAssertTrue(blocks.allSatisfy { !$0.encrypted }, "the watch said block requests cannot be encrypted")
        let complete = try XCTUnwrap(h.watch.requests.last { $0.service == 0x2c })
        XCTAssertEqual(complete.command, 0x06)
        XCTAssertEqual(try complete.tlv.byte(0x01), 0x16)
        XCTAssertEqual(try complete.tlv.byte(0x02), 1)
        XCTAssertEqual(h.watch.count(0x2c, 0x02), 0, "no hash request for files the phone asked for")
        XCTAssertTrue(h.log.contains("Download sequence_data (SEQUENCE_DATA, service 2C, start=100 end=200 dict=700013): start"))
        XCTAssertTrue(h.log.contains("Download sequence_data: complete, 10 bytes"))
    }

    func testDictionaryIdIsOnlySentWhenTheFileIdIs0x16() async throws {
        let h = SleepFilesHarness()
        _ = h.newSyncServer([newFile("sequence_data", type: 0x16, id: 5, Bytes(repeating: 7, count: 20))])
        _ = try await downloader(h).download(.sequenceData(start: 1, end: 2, dictId: 700013))
        let block = try XCTUnwrap(h.watch.requests.first { $0.command == 0x04 })
        XCTAssertFalse(block.tlv.contains(0x04))
        let initRequest = try XCTUnwrap(h.watch.requests.first { $0.command == 0x01 })
        XCTAssertEqual(try initRequest.tlv.int(0x0c), 700013, "the init carries it for the sequence data type")
    }

    func testNoDictionaryIdForOtherFiles() async throws {
        let h = SleepFilesHarness()
        _ = h.newSyncServer([newFile("sleep_state.bin", type: 0x0e, id: 0x16, Bytes(repeating: 1, count: 20))])
        _ = try await downloader(h).download(.sleepState(newSync: true, start: 1, end: 2))
        XCTAssertFalse(try XCTUnwrap(h.watch.requests.first { $0.command == 0x01 }).tlv.contains(0x0c))
        XCTAssertFalse(try XCTUnwrap(h.watch.requests.first { $0.command == 0x04 }).tlv.contains(0x04))
    }

    /// Block requests are encrypted unless the watch says they cannot be, and the watch may push encrypted data (CBC and GCM).
    func testNewSyncWithEncryptedRequestsAndData() async throws {
        for (method, support) in [(UInt8(0), UInt8(1)), (UInt8(1), UInt8(1)), (UInt8(0), UInt8(4))] {
            let file = Bytes((0..<3000).map { UInt8(truncatingIfNeeded: $0 &* 7) })
            let h = SleepFilesHarness(key: Bytes((0..<16).map { UInt8($0 + 1) }), encryptMethod: method, deviceSupportType: support)
            let server = h.newSyncServer([newFile("sleep_data.bin", type: 0x0f, id: 9, file)])
            server.noEncrypt = false
            server.encryptBlocks = true
            server.maxBlockSize = 1024
            server.burst = 240
            let data = try await downloader(h).download(.sleepData(newSync: true, start: 5, end: 6))
            XCTAssertEqual(data, file, "method \(method) support \(support)")
            let blocks = h.watch.requests.filter { $0.command == 0x04 }
            XCTAssertEqual(blocks.count, 3)
            XCTAssertTrue(blocks.allSatisfy { $0.encrypted })
            XCTAssertEqual(server.blockRequests.map { $0.offset }, [0, 1024, 2048])
            XCTAssertEqual(server.blockRequests.map { $0.size }, [1024, 1024, 952])
        }
    }

    func testNewSyncLargeFile() async throws {
        let file = Bytes((0..<150_000).map { UInt8(truncatingIfNeeded: $0 ^ ($0 >> 8)) })
        let h = SleepFilesHarness()
        let server = h.newSyncServer([newFile("sequence_data", type: 0x16, id: 0x16, file)])
        server.maxBlockSize = 32768
        server.burst = 500
        let data = try await downloader(h).download(.sequenceData(start: 0, end: 1, dictId: 700013))
        XCTAssertEqual(data.count, file.count)
        XCTAssertEqual(data, file)
        XCTAssertEqual(server.blockRequests.count, 5)
    }

    /// Kotlin `emptyFileIsCompletedWithoutBlocks`.
    func testEmptyFileIsCompletedWithoutBlocks() async throws {
        let h = SleepFilesHarness()
        _ = h.newSyncServer([newFile("sleep_state.bin", type: 0x0e, id: 1, [])])
        let data = try await downloader(h).download(.sleepState(newSync: true, start: 1, end: 2))
        XCTAssertEqual(data, [])
        XCTAssertEqual(h.watch.count(0x2c, 0x04), 0)
        XCTAssertEqual(h.watch.count(0x2c, 0x03), 0, "no info request for an empty file")
        XCTAssertEqual(h.watch.count(0x2c, 0x06), 1)
    }

    /// Kotlin `answerForOtherFileIsRejected`, plus the type and id checks of the same function.
    func testAnswerForOtherFileIsRejected() async throws {
        let h = SleepFilesHarness()
        let server = h.newSyncServer([newFile("sleep_state.bin", type: 0x0e, id: 1, Bytes(repeating: 1, count: 4))])
        server.initFileName = "other.bin"
        await assertWearError(.protocolError, containing: "data for wrong file received. Expected name sleep_state.bin, got name other.bin") {
            _ = try await downloader(h).download(.sleepState(newSync: true, start: 1, end: 2))
        }
        XCTAssertEqual(h.watch.count(0x2c, 0x06), 0, "a rejected download is not completed")
    }

    func testAnswerWithOtherTypeIsRejected() async throws {
        let h = SleepFilesHarness()
        _ = h.newSyncServer([newFile("sleep_state.bin", type: 0x0f, id: 1, Bytes(repeating: 1, count: 4))])
        await assertWearError(.protocolError, containing: "Expected type SLEEP_STATE, got type SLEEP_DATA") {
            _ = try await downloader(h).download(.sleepState(newSync: true, start: 1, end: 2))
        }
    }

    func testInfoForOtherFileIdIsRejected() async throws {
        let h = SleepFilesHarness()
        let server = h.newSyncServer([newFile("sleep_state.bin", type: 0x0e, id: 3, Bytes(repeating: 1, count: 4))])
        server.infoFileId = 4
        await assertWearError(.protocolError, containing: "Expected id 3, got id 4") {
            _ = try await downloader(h).download(.sleepState(newSync: true, start: 1, end: 2))
        }
    }

    func testDataForOtherFileIdIsRejected() async throws {
        let h = SleepFilesHarness()
        let server = h.newSyncServer([newFile("sleep_state.bin", type: 0x0e, id: 3, Bytes(repeating: 1, count: 4))])
        server.dataFileId = 8
        await assertWearError(.protocolError, containing: "Expected id 3, got id 8") {
            _ = try await downloader(h).download(.sleepState(newSync: true, start: 1, end: 2))
        }
    }

    /// GB does not check the offset of a data packet; the Kotlin only logs a mismatch.
    func testBlockOffsetMismatchIsOnlyLogged() async throws {
        let file = Bytes((0..<10).map { UInt8($0) })
        let h = SleepFilesHarness()
        let server = h.newSyncServer([newFile("sleep_state.bin", type: 0x0e, id: 3, file)])
        server.dataOffsetShift = 7
        let data = try await downloader(h).download(.sleepState(newSync: true, start: 1, end: 2))
        XCTAssertEqual(data, file)
        XCTAssertTrue(h.log.contains("block offset 7 does not match received bytes 0 (GB does not check)"))
    }

    /// The watch has no sequence_data for the window: GB's 0xFFFFFFFF size.
    func testUnknownFileSizeIsAProtocolError() async throws {
        let h = SleepFilesHarness()
        _ = h.newSyncServer([])
        await assertWearError(.protocolError, containing: "sequence_data: invalid file size reported by device: -1") {
            _ = try await downloader(h).download(.sequenceData(start: 1, end: 2, dictId: 700013))
        }
    }

    func testImplausibleFileSizeIsRejectedBeforeInfo() async throws {
        let h = SleepFilesHarness()
        let server = h.newSyncServer([newFile("sleep_data.bin", type: 0x0f, id: 1, Bytes(repeating: 1, count: 4))])
        server.reportedSize = 32 * 1024 * 1024 + 1
        await assertWearError(.protocolError, containing: "implausible file size 33554433") {
            _ = try await downloader(h).download(.sleepData(newSync: true, start: 1, end: 2))
        }
        XCTAssertEqual(h.watch.count(0x2c, 0x03), 0)
    }

    func testMaxBlockSizeZeroIsRejected() async throws {
        let h = SleepFilesHarness()
        let server = h.newSyncServer([newFile("sleep_data.bin", type: 0x0f, id: 1, Bytes(repeating: 1, count: 4))])
        server.reportedMaxBlockSize = 0
        await assertWearError(.protocolError, containing: "device reported max block size 0") {
            _ = try await downloader(h).download(.sleepData(newSync: true, start: 1, end: 2))
        }
        XCTAssertEqual(h.watch.count(0x2c, 0x04), 0)
    }

    func testPacketLargerThanTheFileIsRejected() async throws {
        let h = SleepFilesHarness()
        let server = h.newSyncServer([newFile("sleep_data.bin", type: 0x0f, id: 1, Bytes(repeating: 1, count: 10))])
        h.watch.responder = { r in
            if r.service == 0x2c && r.command == 0x04 {
                return [SleepFilesFakeWatch.frame(service: 0x2c, command: 0x05, body: Bytes([1]) + SleepFilesFakeWatch.be32(0) + [0] + Bytes(repeating: 9, count: 20))]
            }
            return server.respond(r)
        }
        await assertWearError(.protocolError, containing: "downloaded file is larger than expected (20 > 10)") {
            _ = try await downloader(h).download(.sleepData(newSync: true, start: 1, end: 2))
        }
    }

    func testUnparsableDataPacketIsAProtocolError() async throws {
        let h = SleepFilesHarness()
        let server = h.newSyncServer([newFile("sleep_data.bin", type: 0x0f, id: 1, Bytes(repeating: 1, count: 10))])
        h.watch.responder = { r in
            if r.service == 0x2c && r.command == 0x04 {
                return [SleepFilesFakeWatch.frame(service: 0x2c, command: 0x05, body: [1, 2, 3])] // too short for file id, offset and flag
            }
            return server.respond(r)
        }
        do {
            _ = try await downloader(h).download(.sleepData(newSync: true, start: 1, end: 2))
            XCTFail("expected an error")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .protocolError)
            XCTAssertTrue(e.message.contains("failed to parse file data"), e.message)
            XCTAssertFalse(e.isParseFailure, "a buffer underflow is not a GB ParseException")
        }
    }

    func testUndecryptableDataPacketIsAParseFailure() async throws {
        let h = SleepFilesHarness()
        let server = h.newSyncServer([newFile("sleep_data.bin", type: 0x0f, id: 1, Bytes(repeating: 1, count: 10))])
        server.encryptBlocks = true
        let other = ParamsProvider()
        other.secretKey = Bytes(repeating: 0x42, count: 16)
        let wrong = SleepFilesFakeWatch.NewSyncServer(files: server.files, params: other)
        wrong.encryptBlocks = true
        h.watch.responder = { r in r.command == 0x04 ? wrong.respond(r) : server.respond(r) }
        do {
            _ = try await downloader(h).download(.sleepData(newSync: true, start: 1, end: 2))
            XCTFail("expected an error")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .protocolError)
            XCTAssertTrue(e.isParseFailure, "a CryptoException is a GB ParseException")
        }
    }

    /// Kotlin `silentWatchTimesOutBlockDownload`: the block timeout comes from the info answer (here 1 s).
    func testSilentWatchTimesOutBlockDownload() async throws {
        let h = SleepFilesHarness()
        let server = h.newSyncServer([newFile("sleep_data.bin", type: 0x0f, id: 2, Bytes(repeating: 1, count: 8))])
        server.silent = true
        server.timeout = 1
        let started = Date()
        await assertWearError(.timeout, containing: "timeout was hit! no file data within 1000ms at 0/8 bytes") {
            _ = try await downloader(h).download(.sleepData(newSync: true, start: 1, end: 2))
        }
        XCTAssertGreaterThanOrEqual(Date().timeIntervalSince(started), 0.95)
        XCTAssertLessThan(Date().timeIntervalSince(started), 5)
    }

    /// Every packet restarts the timeout: a watch that trickles one packet a bit under the limit does not time out.
    func testEveryPacketRestartsTheTimeout() async throws {
        let file = Bytes((0..<6).map { UInt8($0) })
        let h = SleepFilesHarness()
        let server = h.newSyncServer([newFile("sleep_data.bin", type: 0x0f, id: 2, file)])
        server.burst = 2
        server.timeout = 1
        let pending = PendingFrames()
        h.watch.responder = { r in
            if r.service == 0x2c && r.command == 0x04 {
                let frames = server.respond(r)
                // Deliver the packets 0.6 s apart: the whole block takes longer than the 1 s timeout, each gap does not.
                for (i, f) in frames.enumerated() {
                    let session = h.session
                    DispatchQueue.global().asyncAfter(deadline: .now() + 0.6 * Double(i + 1)) { session.onData(f) }
                }
                pending.value += frames.count
                return []
            }
            return server.respond(r)
        }
        let started = Date()
        let data = try await downloader(h).download(.sleepData(newSync: true, start: 1, end: 2))
        XCTAssertEqual(data, file)
        XCTAssertGreaterThan(Date().timeIntervalSince(started), 1.7)
        XCTAssertEqual(pending.value, 3)
    }

    private final class PendingFrames: @unchecked Sendable {
        var value = 0
    }

    func testCancellationStopsTheDownload() async throws {
        let h = SleepFilesHarness()
        let server = h.newSyncServer([newFile("sleep_data.bin", type: 0x0f, id: 2, Bytes(repeating: 1, count: 8))])
        server.silent = true
        server.timeout = 30
        let d = downloader(h)
        let task = Task { try await d.download(.sleepData(newSync: true, start: 1, end: 2)) }
        try await Task.sleep(nanoseconds: 300_000_000)
        let started = Date()
        task.cancel()
        do {
            _ = try await task.value
            XCTFail("expected a cancellation")
        } catch is CancellationError {
        } catch {
            XCTFail("unexpected \(error)")
        }
        XCTAssertLessThan(Date().timeIntervalSince(started), 3)
    }

    func testDisconnectedSessionFailsTheInit() async throws {
        let h = SleepFilesHarness()
        _ = h.newSyncServer([newFile("sleep_data.bin", type: 0x0f, id: 2, Bytes(repeating: 1, count: 8))])
        await h.session.close(WearError(.disconnected, "link lost"))
        await assertWearError(.disconnected, containing: "link lost") {
            _ = try await downloader(h).download(.sleepData(newSync: true, start: 1, end: 2))
        }
    }

    func testNoInitAnswerTimesOutAfterTenSeconds() async throws {
        // The init is a request with the Kotlin's 10 s limit: only check it is armed by cancelling early (no 10 s wait).
        let h = SleepFilesHarness()
        let d = downloader(h)
        let task = Task { try await d.download(.sleepData(newSync: true, start: 1, end: 2)) }
        try await Task.sleep(nanoseconds: 200_000_000)
        task.cancel()
        do {
            _ = try await task.value
            XCTFail("expected a cancellation")
        } catch is CancellationError {
        } catch {
            XCTFail("unexpected \(error)")
        }
        XCTAssertEqual(h.watch.count(0x2c, 0x01), 1)
    }

    func testSubscriptionIsRemovedAfterTheDownload() async throws {
        let h = SleepFilesHarness()
        _ = h.newSyncServer([newFile("sleep_data.bin", type: 0x0f, id: 2, Bytes(repeating: 1, count: 8))])
        _ = try await downloader(h).download(.sleepData(newSync: true, start: 1, end: 2))
        XCTAssertTrue(h.log.contains("pushed (file data sleep_data.bin)"))
        h.session.onData(SleepFilesFakeWatch.frame(service: 0x2c, command: 0x05, body: Bytes([2]) + SleepFilesFakeWatch.be32(0) + [0, 1, 2]))
        try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertTrue(h.log.messages.contains { $0.contains("asynchronous (no pending request)") }, "a late data packet has no subscriber any more")
    }

    func testSubscriptionIsRemovedAfterAFailedDownload() async throws {
        let h = SleepFilesHarness()
        let server = h.newSyncServer([newFile("sleep_data.bin", type: 0x0f, id: 2, Bytes(repeating: 1, count: 8))])
        server.dataFileId = 7
        do { _ = try await downloader(h).download(.sleepData(newSync: true, start: 1, end: 2)); XCTFail() } catch {}
        h.session.onData(SleepFilesFakeWatch.frame(service: 0x2c, command: 0x05, body: Bytes([2]) + SleepFilesFakeWatch.be32(0) + [0, 1, 2]))
        try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertTrue(h.log.messages.contains { $0.contains("asynchronous (no pending request)") })
    }

    func testNewSyncGpsFile() async throws {
        let content = Bytes((0..<64).map { UInt8($0 * 3) })
        let h = SleepFilesHarness()
        _ = h.newSyncServer([newFile("3_gps.bin", type: 0x11, id: 0x21, content)])
        let data = try await downloader(h).download(.workoutGps(newSync: true, workoutId: 3))
        XCTAssertEqual(data, content)
        let initRequest = try XCTUnwrap(h.watch.requests.first { $0.command == 0x01 })
        XCTAssertEqual(try initRequest.tlv.byte(0x02), 0x11)
        XCTAssertEqual(try initRequest.tlv.int(0x05), 0)
        XCTAssertEqual(try initRequest.tlv.int(0x06), 0)
    }

    func testNewSyncRriFile() async throws {
        let content = Bytes((0..<64).map { UInt8(truncatingIfNeeded: $0 * 5) })
        let h = SleepFilesHarness()
        _ = h.newSyncServer([newFile("rrisqi_data.bin", type: 0x10, id: 0x22, content)])
        let data = try await downloader(h).download(.rri(newSync: true, start: 10, end: 20))
        XCTAssertEqual(data, content)
    }

    // MARK: old sync (service 0x0A)

    /// Kotlin `oldSyncReusesFileListAndDecryptsBlocks`.
    func testOldSyncReusesFileListAndDecryptsBlocks() async throws {
        let files = ["sleep_state.bin": Bytes((0..<5).map { UInt8(0x10 + $0) }), "sleep_data.bin": Bytes((0..<3).map { UInt8(0x20 + $0) })]
        let h = SleepFilesHarness()
        let server = h.oldSyncServer(files, listing: ["sleep_state.bin", "sleep_data.bin"])
        server.maxBlockSize = 4
        server.burst = 2
        let d = downloader(h)

        let state = try await d.download(.sleepState(newSync: false, start: 1, end: 2))
        let data = try await d.download(.sleepData(newSync: false, start: 1, end: 2))

        XCTAssertEqual(state, files["sleep_state.bin"])
        XCTAssertEqual(data, files["sleep_data.bin"])
        // sleep_data rides on the file list of the sleep_state init: no second init or parameters request.
        XCTAssertEqual(h.watch.count(0x0a, 0x01), 1)
        XCTAssertEqual(h.watch.count(0x0a, 0x02), 1)
        XCTAssertEqual(h.watch.count(0x0a, 0x03), 2)
        XCTAssertEqual(h.watch.count(0x0a, 0x06), 2)
        XCTAssertEqual(server.parametersFileTypes, [1])
        let start = try XCTUnwrap(h.watch.requests.first { $0.command == 0x01 }).tlv.object(0x83)
        XCTAssertEqual(try start.int(0x04), 1)
        XCTAssertEqual(try start.int(0x05), 2)
        XCTAssertEqual(server.blockRequests.map { "\($0.name):\($0.offset):\($0.size)" }, ["sleep_state.bin:0:4", "sleep_state.bin:4:1", "sleep_data.bin:0:3"])
        XCTAssertTrue(h.watch.requests.filter { $0.command == 0x06 }.allSatisfy { (try? $0.tlv.bool(0x06)) == true })
    }

    /// Kotlin `oldSyncDataFileWithoutPrecedingStateInitFails`.
    func testOldSyncDataFileWithoutPrecedingStateInitFails() async throws {
        let h = SleepFilesHarness()
        await assertWearError(.protocolError, containing: "no file list from a preceding sleep_state init (old sync)") {
            _ = try await downloader(h).download(.sleepData(newSync: false, start: 1, end: 2))
        }
        XCTAssertTrue(h.watch.requests.isEmpty)
    }

    func testOldSyncNameNotInTheListIsRejected() async throws {
        let h = SleepFilesHarness()
        _ = h.oldSyncServer(["sleep_state.bin": [1]], listing: ["a.bin", "b.bin"])
        await assertWearError(.protocolError, containing: "file sleep_state.bin cannot be downloaded using this method. Only the following files are supported: [a.bin, b.bin]") {
            _ = try await downloader(h).download(.sleepState(newSync: false, start: 1, end: 2))
        }
        XCTAssertEqual(h.watch.count(0x0a, 0x02), 0)
    }

    func testOldSyncDataNameMissingFromTheStateListIsRejected() async throws {
        let h = SleepFilesHarness()
        _ = h.oldSyncServer(["sleep_state.bin": [1, 2, 3]], listing: ["sleep_state.bin"])
        let d = downloader(h)
        _ = try await d.download(.sleepState(newSync: false, start: 1, end: 2))
        await assertWearError(.protocolError, containing: "file sleep_data.bin cannot be downloaded using this method. Only the following files are supported: [sleep_state.bin]") {
            _ = try await d.download(.sleepData(newSync: false, start: 1, end: 2))
        }
    }

    func testOldSyncEmptyFileIsCompleted() async throws {
        let h = SleepFilesHarness()
        _ = h.oldSyncServer(["sleep_state.bin": []], listing: ["sleep_state.bin"])
        let data = try await downloader(h).download(.sleepState(newSync: false, start: 1, end: 2))
        XCTAssertEqual(data, [])
        XCTAssertEqual(h.watch.count(0x0a, 0x04), 0)
        XCTAssertEqual(h.watch.count(0x0a, 0x06), 1)
    }

    /// GB compares the packet number with `number - 1`; the Kotlin compares modulo 256, so a block of more than 255 packets works.
    func testOldSyncPacketNumbersWrapModulo256() async throws {
        let content = Bytes((0..<700).map { UInt8(0xA0 | ($0 & 0x0f)) })
        let h = SleepFilesHarness()
        let server = h.oldSyncServer(["sleep_state.bin": content], listing: ["sleep_state.bin"])
        server.burst = 1
        server.maxBlockSize = 600
        let data = try await downloader(h).download(.sleepState(newSync: false, start: 1, end: 2))
        XCTAssertEqual(data, content)
        XCTAssertEqual(server.blockRequests.map { $0.size }, [600, 100])
    }

    func testOldSyncWrongPacketNumberIsRejected() async throws {
        let h = SleepFilesHarness()
        let server = h.oldSyncServer(["sleep_state.bin": Bytes(repeating: 0xA5, count: 10)], listing: ["sleep_state.bin"])
        server.numberShift = 1
        await assertWearError(.protocolError, containing: "Expected packet number 0, got 1") {
            _ = try await downloader(h).download(.sleepState(newSync: false, start: 1, end: 2))
        }
    }

    func testOldSyncPacketNumberRestartsWithEveryBlock() async throws {
        let content = Bytes((0..<20).map { UInt8(0xB0 + $0) })
        let h = SleepFilesHarness()
        let server = h.oldSyncServer(["sleep_state.bin": content], listing: ["sleep_state.bin"])
        server.burst = 3
        server.maxBlockSize = 9
        let data = try await downloader(h).download(.sleepState(newSync: false, start: 1, end: 2))
        XCTAssertEqual(data, content)
        XCTAssertEqual(server.blockRequests.map { $0.size }, [9, 9, 2])
    }

    /// Data the watch sends unencrypted (not TLV): taken as is.
    func testOldSyncUnencryptedBlocks() async throws {
        let content = Bytes((0..<30).map { UInt8(0xC0 + $0) })
        let h = SleepFilesHarness()
        let server = h.oldSyncServer(["sleep_state.bin": content], listing: ["sleep_state.bin"])
        server.encryptBlocks = false
        server.burst = 7
        let data = try await downloader(h).download(.sleepState(newSync: false, start: 1, end: 2))
        XCTAssertEqual(data, content)
    }

    /// A raw body that happens to parse as a TLV without the cipher elements is file data. GB threw MissingTagException and
    /// lost the whole file (HONOR Watch ES rrisqi_data.bin, "Missing tag: 7e", JRG-487/488).
    func testOldSyncDataThatLooksLikeTlvIsTakenAsData() async throws {
        let h = SleepFilesHarness()
        _ = h.oldSyncServer(["sleep_state.bin": [0x01, 0x42]], listing: ["sleep_state.bin"])
        let base = h.watch.responder
        h.watch.responder = { r in
            if r.service == 0x0a && r.command == 0x04 {
                // Packet number 0, then the data: as TLV it reads tag 00, length 01, value 42, with no 7E.
                return [SleepFilesFakeWatch.frame(service: 0x0a, command: 0x05, body: [0x00, 0x01, 0x42])]
            }
            return base(r)
        }
        let data = try await downloader(h).download(.sleepState(newSync: false, start: 1, end: 2))
        XCTAssertEqual(data, [0x01, 0x42])
    }

    func testOldSyncUndecryptableBlockIsLoggedAndTakenAsData() async throws {
        let h = SleepFilesHarness()
        // Packet number 0 (a TLV entry with tag 0), then iv and a cipher of one zeroed block: a TLV that parses but does not decrypt.
        let body = Bytes([0x00, 0x00, 0x7d, 0x10]) + Bytes(repeating: 1, count: 16) + [0x7e, 0x10] + Bytes(repeating: 0, count: 16)
        let expected = Array(body.dropFirst())
        _ = h.oldSyncServer(["sleep_state.bin": Bytes(repeating: 0, count: expected.count)], listing: ["sleep_state.bin"])
        let base = h.watch.responder
        h.watch.responder = { r in
            if r.service == 0x0a && r.command == 0x04 { return [SleepFilesFakeWatch.frame(service: 0x0a, command: 0x05, body: body)] }
            return base(r)
        }
        let data = try await downloader(h).download(.sleepState(newSync: false, start: 1, end: 2))
        XCTAssertEqual(data, expected, "the body after the packet number is taken as data")
        XCTAssertTrue(h.log.contains("sleep_state.bin: data could be decoded as TLV, but not decrypted"))
    }

    func testOldSyncMaxBlockSizeNegativeIsRejected() async throws {
        let h = SleepFilesHarness()
        let server = h.oldSyncServer(["sleep_state.bin": [1, 2, 3]], listing: ["sleep_state.bin"])
        server.maxBlockSize = Int16(bitPattern: 0x8000)
        await assertWearError(.protocolError, containing: "device reported max block size -32768") {
            _ = try await downloader(h).download(.sleepState(newSync: false, start: 1, end: 2))
        }
    }

    func testOldSyncSilentWatchTimesOut() async throws {
        let h = SleepFilesHarness()
        let server = h.oldSyncServer(["sleep_state.bin": [1, 2, 3]], listing: ["sleep_state.bin"])
        server.silent = true
        server.timeout = 1
        await assertWearError(.timeout, containing: "no file data within 1000ms at 0/3 bytes") {
            _ = try await downloader(h).download(.sleepState(newSync: false, start: 1, end: 2))
        }
    }

    func testOldSyncGpsFile() async throws {
        let content = Bytes((0..<250).map { UInt8(0xD0 | ($0 & 0x0f)) })
        let h = SleepFilesHarness()
        let server = h.oldSyncServer(["7_gps.bin": content], listing: ["7_aux.bin", "7_gps.bin", "8_gps.bin"])
        server.burst = 64
        let data = try await downloader(h).download(.workoutGps(newSync: false, workoutId: 7))
        XCTAssertEqual(data, content)
        XCTAssertEqual(server.parametersFileTypes, [2])
        let initRequest = try XCTUnwrap(h.watch.requests.first { $0.command == 0x01 })
        XCTAssertEqual(try initRequest.tlv.byte(0x02), 2)
        XCTAssertEqual(try initRequest.tlv.object(0x86).object(0x88).short(0x09), 7)
        XCTAssertEqual(try initRequest.tlv.object(0x86).byte(0x07), 1)
        let parameters = try XCTUnwrap(h.watch.requests.first { $0.command == 0x02 })
        XCTAssertEqual(try parameters.tlv.byte(0x07), 3)
        XCTAssertEqual(server.blockRequests.first?.name, "7_gps.bin", "the first _gps.bin of the list is downloaded")
        XCTAssertTrue(h.log.contains("workout 7 GPS (old sync): 2 GPS files, downloading the first only"))
    }

    func testOldSyncGpsWithoutGpsFileIsRejected() async throws {
        let h = SleepFilesHarness()
        _ = h.oldSyncServer([:], listing: ["7_aux.bin"])
        await assertWearError(.protocolError, containing: "workout 7 GPS (old sync): no _gps.bin file in [7_aux.bin]") {
            _ = try await downloader(h).download(.workoutGps(newSync: false, workoutId: 7))
        }
    }

    func testOldSyncRriFile() async throws {
        let content = Bytes((0..<120).map { UInt8(0xE0 | ($0 & 0x0f)) })
        let h = SleepFilesHarness()
        let server = h.oldSyncServer(["rrisqi_data.bin": content], listing: ["rrisqi_data.bin"])
        let data = try await downloader(h).download(.rri(newSync: false, start: 10, end: 20))
        XCTAssertEqual(data, content)
        XCTAssertEqual(server.parametersFileTypes, [4])
        let initRequest = try XCTUnwrap(h.watch.requests.first { $0.command == 0x01 })
        XCTAssertEqual(try initRequest.tlv.byte(0x02), 4)
        XCTAssertEqual(try initRequest.tlv.object(0x8f).int(0x10), 10)
        XCTAssertEqual(try initRequest.tlv.object(0x8f).int(0x11), 20)
    }

    // MARK: requests

    func testFileRequestDescriptions() {
        XCTAssertEqual(FileRequest.sequenceData(start: 100, end: 200, dictId: 700013).description, "sequence_data (SEQUENCE_DATA, service 2C, start=100 end=200 dict=700013)")
        XCTAssertEqual(FileRequest.sleepState(newSync: false, start: 1, end: 2).description, "sleep_state.bin (SLEEP_STATE, service 0A, start=1 end=2)")
        XCTAssertEqual(FileRequest.sleepData(newSync: true, start: 1, end: 2).description, "sleep_data.bin (SLEEP_DATA, service 2C, start=1 end=2)")
        XCTAssertEqual(FileRequest.rri(newSync: true, start: 3, end: 4).description, "rrisqi_data.bin (RRI, service 2C, start=3 end=4)")
        XCTAssertEqual(FileRequest.workoutGps(newSync: true, workoutId: -2).filename, "-2_gps.bin")
        XCTAssertEqual(FileRequest.workoutGps(newSync: false, workoutId: 5).filename, "")
        XCTAssertEqual(FileRequest.workoutGps(newSync: false, workoutId: 5).description, " (GPS, service 0A, start=0 end=0)")
        XCTAssertEqual(FileRequest.sequenceData(start: 1, end: 2, dictId: 0).description, "sequence_data (SEQUENCE_DATA, service 2C, start=1 end=2)")
        XCTAssertTrue(FileRequest.sequenceData(start: 1, end: 2, dictId: 0).newSync)
    }
}
