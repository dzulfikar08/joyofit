import XCTest
@testable import HuaweiWearLogic

/// What the fake watch received: the service and command, the TLV (decrypted), and for 1C/05 data frames the decrypted `index + bytes`.
struct AgpsMsg {
    let service: Int
    let command: Int
    let tlv: HuaweiTLV?
    let payload: Bytes
}

/// The watch's ear: reassembles what the phone writes (sliced frames included), decrypts it like the watch does and records it.
final class AgpsFakeWatch: FrameSink, @unchecked Sendable {
    private let lock = NSLock()
    private var _messages: [AgpsMsg] = []
    private var assembler = PacketAssembler()
    private var session: HuaweiSession?

    func attach(_ session: HuaweiSession) { lock.locked { self.session = session } }

    var messages: [AgpsMsg] { lock.locked { _messages } }

    func all(_ service: Int, _ command: Int) -> [AgpsMsg] { messages.filter { $0.service == service && $0.command == command } }

    func write(_ frames: [Bytes]) async throws {
        for frame in frames { try handle(frame) }
    }

    private func handle(_ frame: Bytes) throws {
        guard let session = lock.locked({ self.session }) else { throw WearError(.notConnected, "no session") }
        var local = lock.locked { assembler }
        let result = try local.feed(frame, params: session.params)
        lock.locked { assembler = local }
        guard let packet = result.packet else { return }
        var payload = Bytes()
        if packet.serviceId == 0x1C && packet.commandId == 0x05, let body = packet.payload {
            payload = try HuaweiTLV(parsing: body, offset: 2, length: body.count - 2).fileDownloadDecryptRaw(params: session.params)
        }
        lock.locked { _messages.append(AgpsMsg(service: Int(packet.serviceId), command: Int(packet.commandId), tlv: packet.tlv, payload: payload)) }
    }
}

/// A cache that never has anything.
private final class NullAgpsCache: AgpsCache, @unchecked Sendable {
    func read(_ url: String, maxAgeMs: Int) -> Bytes? { nil }
    func write(_ url: String, data: Bytes) {}
    func delete(_ url: String) {}
}

/// The 0x1F / 0x1C exchange against a fake watch that plays the watch's side step by step (GB `HuaweiEphemerisManager` flow), with a fake source and
/// an in-memory store (port of the Kotlin AgpsExchangeTest). Timings are shortened; nothing here touches the network.
final class AgpsExchangeTests: XCTestCase {
    private static let fast = AgpsTiming(downloadTimeoutMs: 5_000, pullWaitMs: 600, stallMs: 600, probeAskMs: 600, probeTransferMs: 3_000)

    private var watch: AgpsFakeWatch!
    private var session: HuaweiSession!
    private var events: RecordingEvents!
    private var store: AgpsStore!
    private var exchange: AgpsExchange?

    override func setUp() {
        events = RecordingEvents()
        watch = AgpsFakeWatch()
        session = HuaweiSession(sink: watch, log: events.sink)
        session.params.secretKey = Bytes(repeating: 0, count: 16)
        watch.attach(session)
        store = AgpsStore(defaults: ephemeralDefaults())
        exchange = nil
    }

    override func tearDown() async throws {
        await exchange?.stop()
        exchange = nil
    }

    private func start(_ source: AgpsSource, online: Bool = true, timing: AgpsTiming = AgpsExchangeTests.fast) async -> AgpsExchange {
        let ex = AgpsExchange(
            session: session, caps: DeviceCaps(), address: "AA:BB:CC:DD:EE:FF", events: events, source: source, store: store, isOnline: { online },
            timing: timing
        )
        await ex.start()
        exchange = ex
        return ex
    }

    // MARK: the watch's messages

    private func fromWatch(_ service: Int, _ command: Int, _ tlv: HuaweiTLV) {
        session.onData(WeatherScriptedWatch.tlvFrame(service: UInt8(service), command: UInt8(command), tlv))
    }

    /// The `count`-th message of that kind the phone sent, waiting up to 5 s for it.
    private func awaitMsg(_ service: Int, _ command: Int, _ count: Int = 1, file: StaticString = #filePath, line: UInt = #line) async -> AgpsMsg {
        var waited = 0
        while watch.all(service, command).count < count && waited < 5_000 {
            await sleepMs(10)
            waited += 10
        }
        let list = watch.all(service, command)
        XCTAssertGreaterThanOrEqual(list.count, count, "timed out waiting for \(service)/\(command) #\(count)", file: file, line: line)
        return list.count >= count ? list[count - 1] : AgpsMsg(service: service, command: command, tlv: HuaweiTLV(), payload: [])
    }

    private func code(_ message: AgpsMsg) -> Int32? { try? message.tlv?.int(0x7F) }

    private func state(_ message: AgpsMsg) -> Int8? { try? message.tlv?.byte(0x01) }

    private func ltoFile(_ size: Int = 2000) -> Bytes {
        var data = Bytes((0..<size).map { UInt8(truncatingIfNeeded: $0 &* 13) })
        data[0] = 0xFF
        data[1] = 0xCA
        data[2] = 0xDE
        return data
    }

    private func op1() {
        var inner = HuaweiTLV()
        inner.put(0x02, byte: 1)
        inner.put(0x03, int: 1000)
        var tlv = HuaweiTLV()
        tlv.put(0x81, tlv: inner)
        fromWatch(0x1F, 0x01, tlv)
    }

    private func progressPoll() {
        var inner = HuaweiTLV()
        inner.put(0x02, byte: 2)
        inner.put(0x03, int: 1000)
        var tlv = HuaweiTLV()
        tlv.put(0x81, tlv: inner)
        fromWatch(0x1F, 0x01, tlv)
    }

    private func consult(_ version: Int, _ tag: String = "") {
        var inner = HuaweiTLV()
        inner.put(0x04, int: 5)
        inner.put(0x05, byte: UInt8(truncatingIfNeeded: version))
        inner.put(0x06, string: tag)
        var tlv = HuaweiTLV()
        tlv.put(0x81, tlv: inner)
        fromWatch(0x1F, 0x02, tlv)
    }

    private func fileList(type: UInt8 = 1) {
        var tlv = HuaweiTLV()
        tlv.put(0x02, byte: type)
        fromWatch(0x1C, 0x01, tlv)
    }

    private func fileConsult(transferSize: Int, maxData: Int, type: UInt8 = 1) {
        var tlv = HuaweiTLV()
        tlv.put(0x01, string: "1.0")
        tlv.put(0x03, int: Int32(transferSize))
        tlv.put(0x04, int: Int32(maxData))
        tlv.put(0x06, byte: type)
        fromWatch(0x1C, 0x02, tlv)
    }

    private func fileInfo(_ name: String) {
        var tlv = HuaweiTLV()
        tlv.put(0x01, string: name)
        fromWatch(0x1C, 0x03, tlv)
    }

    private func dataRequest(_ name: String, offset: Int, length: Int) {
        var tlv = HuaweiTLV()
        tlv.put(0x01, string: name)
        tlv.put(0x02, int: Int32(offset))
        tlv.put(0x03, int: Int32(length))
        fromWatch(0x1C, 0x04, tlv)
    }

    private func uploadDone(result: UInt8) {
        var tlv = HuaweiTLV()
        tlv.put(0x01, byte: result)
        fromWatch(0x1C, 0x06, tlv)
    }

    /// Drives the whole pull of one file as the watch does (after any earlier pulls in the same test), returning the bytes it received.
    private func pull(_ name: String, size: Int, maxData: Int, transferSize: Int) async -> Bytes {
        let lists = watch.all(0x1C, 0x01).count
        let consults = watch.all(0x1C, 0x02).count
        let infos = watch.all(0x1C, 0x03).count
        var listTlv = HuaweiTLV()
        listTlv.put(0x02, byte: 1)
        listTlv.put(0x03, string: "p")
        fromWatch(0x1C, 0x01, listTlv)
        _ = await awaitMsg(0x1C, 0x01, lists + 1)
        fileConsult(transferSize: transferSize, maxData: maxData)
        _ = await awaitMsg(0x1C, 0x02, consults + 1)
        fileInfo(name)
        _ = await awaitMsg(0x1C, 0x03, infos + 1)
        var received = Bytes(repeating: 0, count: size)
        var offset = 0
        var requests = watch.all(0x1C, 0x04).count
        var frames = watch.all(0x1C, 0x05).count
        while offset < size {
            dataRequest(name, offset: offset, length: min(maxData, size - offset))
            requests += 1
            let answer = await awaitMsg(0x1C, 0x04, requests)
            XCTAssertEqual(code(answer), 100_000)
            let chunk = min(maxData, size - offset)
            let expectedFrames = (chunk + transferSize - 1) / transferSize
            await eventually(timeoutMs: 5_000, "frames") { watch.all(0x1C, 0x05).count >= frames + expectedFrames }
            let all = watch.all(0x1C, 0x05)
            for i in 0..<expectedFrames where frames + i < all.count {
                let payload = all[frames + i].payload
                guard payload.count > 1 else {
                    XCTFail("frame \(i) of the answer carries no data")
                    continue
                }
                XCTAssertEqual(Int(payload[0]), i, "frame index")
                for k in 1..<payload.count where offset + i * transferSize + k - 1 < size { received[offset + i * transferSize + k - 1] = payload[k] }
            }
            frames += expectedFrames
            offset += chunk
        }
        return received
    }

    // MARK: tests

    func testTheWatchAsksAndGetsTheFileAndTheDeliveryIsRecorded() async throws {
        let file = ltoFile(2000)
        let ex = await start(FakeAgpsSource(files: [(AgpsSources.ltoFile, file)]))

        op1()
        let operatorAnswer = await awaitMsg(0x1F, 0x01)
        XCTAssertEqual(code(operatorAnswer), 100_000)
        _ = await awaitMsg(0x1F, 0x02)
        consult(0)
        let status = await awaitMsg(0x1F, 0x03)
        XCTAssertEqual(state(status), 3)

        fileList()
        let list = await awaitMsg(0x1C, 0x01)
        XCTAssertEqual(try list.tlv!.string(0x01), AgpsSources.ltoFile)

        fileConsult(transferSize: 100, maxData: 700)
        let consultAnswer = await awaitMsg(0x1C, 0x02)
        XCTAssertEqual(code(consultAnswer), 100_000)

        fileInfo(AgpsSources.ltoFile)
        let infoMessage = await awaitMsg(0x1C, 0x03)
        let info = infoMessage.tlv!
        XCTAssertEqual(try info.int(0x02), 2000)
        XCTAssertEqual(try info.short(0x03), Int16(truncatingIfNeeded: Int(CRC16.checksum(file))))

        var received = Bytes()
        var offset = 0
        var requests = 0
        var frames = 0
        while offset < 2000 {
            dataRequest(AgpsSources.ltoFile, offset: offset, length: 700)
            requests += 1
            let answerMessage = await awaitMsg(0x1C, 0x04, requests)
            let answer = answerMessage.tlv!
            XCTAssertEqual(try answer.string(0x02), EphemerisNet.addressDigest("AA:BB:CC:DD:EE:FF") + AgpsSources.ltoFile)
            XCTAssertEqual(try answer.int(0x03), Int32(offset))
            let chunk = min(700, 2000 - offset)
            let count = (chunk + 99) / 100
            await eventually(timeoutMs: 5_000, "frames") { watch.all(0x1C, 0x05).count >= frames + count }
            let all = watch.all(0x1C, 0x05)
            for i in 0..<count where frames + i < all.count { received += all[frames + i].payload.dropFirst() }
            frames += count
            offset += chunk
        }
        XCTAssertEqual(received, file)
        XCTAssertEqual(requests, 3)

        uploadDone(result: 0)
        let done = await awaitMsg(0x1C, 0x06)
        XCTAssertEqual(code(done), 100_000)
        await eventually(timeoutMs: 5_000, "delivery recorded") { store.deliveredAtMs > 0 }
        XCTAssertEqual(store.deliveredSize, 2000)
        XCTAssertEqual(store.deliveredSource, AgpsSources.broadcom)
        XCTAssertEqual(store.deliveredAddress, "AA:BB:CC:DD:EE:FF")
        XCTAssertEqual(store.lastOutcome, AgpsOutcome.delivered)
        XCTAssertEqual(store.lastAskVersion, 0)
        XCTAssertTrue(store.cachedAtMs > 0)
        XCTAssertFalse(ex.busy, "the exchange is over")
    }

    func testALargerFileIsPulledInSeveralDataRequests() async {
        let file = ltoFile(5000)
        _ = await start(FakeAgpsSource(files: [(AgpsSources.ltoFile, file)]))
        op1()
        _ = await awaitMsg(0x1F, 0x02)
        consult(0)
        _ = await awaitMsg(0x1F, 0x03)
        let received = await pull(AgpsSources.ltoFile, size: 5000, maxData: 2048, transferSize: 232)
        XCTAssertEqual(received, file)
    }

    func testWithoutNetworkTheWatchIsToldAndNothingIsStartedOrCounted() async {
        let source = FakeAgpsSource(files: [])
        let ex = await start(source, online: false)
        op1()
        let answer = await awaitMsg(0x1F, 0x01)
        XCTAssertEqual(code(answer), 100_007)
        XCTAssertTrue(watch.all(0x1F, 0x02).isEmpty)
        XCTAssertEqual(source.calls, 0)
        XCTAssertEqual(store.lastOutcome, AgpsOutcome.noNetwork)
        XCTAssertEqual(store.failures, 0)
        XCTAssertFalse(ex.busy)
    }

    func testAFailedDownloadTellsTheWatchFailedAndTheNextAskWaitsForTheRetryWindow() async {
        let source = FakeAgpsSource(files: [], outcome: AgpsOutcome.downloadFailed)
        _ = await start(source)
        op1()
        _ = await awaitMsg(0x1F, 0x02)
        consult(0)
        let first = await awaitMsg(0x1F, 0x03)
        XCTAssertEqual(state(first), 4)
        XCTAssertEqual(store.lastOutcome, AgpsOutcome.downloadFailed)
        XCTAssertEqual(store.failures, 1)
        XCTAssertEqual(source.calls, 1)

        // The watch asks again at once: answered "failed" without another download, and the failure count does not grow.
        op1()
        _ = await awaitMsg(0x1F, 0x02, 2)
        consult(0)
        let second = await awaitMsg(0x1F, 0x03, 2)
        XCTAssertEqual(state(second), 4)
        XCTAssertEqual(source.calls, 1)
        XCTAssertEqual(store.failures, 1)
    }

    func testAKindOnlyTheWatchMakersAppPreparesIsAnsweredFailedAndTheAskIsRecordedWithTagNamesOnly() async {
        let real = NetworkAgpsSource(
            cache: NullAgpsCache(), store: store, log: { _ in }, isOnline: { true },
            httpGet: { _, _ in throw AgpsFetchError("the network must not be used here") }
        )
        _ = await start(real)
        op1()
        _ = await awaitMsg(0x1F, 0x02)
        consult(3, "secret/path/HW_PGNSS_PRED")
        let answer = await awaitMsg(0x1F, 0x03)
        XCTAssertEqual(state(answer), 4)
        XCTAssertEqual(store.lastOutcome, AgpsOutcome.unsupported)
        XCTAssertTrue(store.lastError.contains("HW_PGNSS_PRED"), "the log says which kind was declined")
        XCTAssertEqual(store.lastAskVersion, 3)
        XCTAssertEqual(store.lastAskTags, "HW_PGNSS_PRED")
        XCTAssertEqual(store.failures, 0, "a refused kind is not a download failure")
        XCTAssertTrue(events.messages().allSatisfy { !$0.contains("secret/path") })
        XCTAssertTrue(watch.all(0x1C, 0x01).isEmpty, "no file is offered afterwards")
        fileList()
        let list = await awaitMsg(0x1C, 0x01)
        XCTAssertEqual(code(list), 100_001)
    }

    func testAWatchThatAnswersThePhoneStartedQuestionWithAnErrorEndsItWithoutAnyStatus() async {
        let ex = await start(FakeAgpsSource(files: [(AgpsSources.ltoFile, ltoFile())]))
        let outcome = Task { await ex.probe(force: true) }
        _ = await awaitMsg(0x1F, 0x02)
        // What the Fit 4 Pro answers when it has no request open: 7f 118001, no 0x81 container.
        var refusal = HuaweiTLV()
        refusal.put(0x7F, int: 118_001)
        fromWatch(0x1F, 0x02, refusal)
        let result = await outcome.value
        XCTAssertEqual(result, AgpsOutcome.watchRefused)
        XCTAssertTrue(store.lastError.contains("118001"))
        XCTAssertTrue(watch.all(0x1F, 0x03).isEmpty, "nothing was started, so no status is sent")
        XCTAssertFalse(ex.busy)
    }

    func testAnUnknownVersionIsAnsweredUnsupported() async {
        _ = await start(FakeAgpsSource(files: [], outcome: AgpsOutcome.unsupported))
        op1()
        _ = await awaitMsg(0x1F, 0x02)
        consult(9)
        let answer = await awaitMsg(0x1F, 0x03)
        XCTAssertEqual(state(answer), 5)
    }

    func testTheProgressPollIsAnsweredWithTheStateAndIgnoredWithoutARequest() async throws {
        let gate = AgpsLatch<Bool>()
        let ex = await start(FakeAgpsSource(files: [(AgpsSources.ltoFile, ltoFile())], gate: gate))
        progressPoll()
        await sleepMs(150)
        XCTAssertTrue(watch.all(0x1F, 0x01).isEmpty, "no request running: no answer")

        op1()
        _ = await awaitMsg(0x1F, 0x01)
        _ = await awaitMsg(0x1F, 0x02)
        consult(0)
        await eventually(timeoutMs: 5_000, "downloading") { ex.phase == "downloading" }
        progressPoll()
        let progress = try await awaitMsg(0x1F, 0x01, 2).tlv!.object(0x81)
        XCTAssertEqual(try progress.byte(0x02), 2)
        XCTAssertEqual(try progress.byte(0x04), 2)
        gate.complete(true)
        _ = await awaitMsg(0x1F, 0x03)
    }

    func testAFileConsultWithNothingToSendOrWithAbsurdSizesIsRefused() async {
        _ = await start(FakeAgpsSource(files: [(AgpsSources.ltoFile, ltoFile())]))
        // No request running yet: the list is refused.
        fileList()
        let list = await awaitMsg(0x1C, 0x01)
        XCTAssertEqual(code(list), 100_001)
        fileConsult(transferSize: 0, maxData: 100)
        let first = await awaitMsg(0x1C, 0x02)
        XCTAssertEqual(code(first), 100_001)
        fileConsult(transferSize: 100, maxData: 0)
        let second = await awaitMsg(0x1C, 0x02, 2)
        XCTAssertEqual(code(second), 100_001)
    }

    func testADataRequestThatWouldNeedTooManyFramesOrNamesAnotherFileIsRefused() async {
        _ = await start(FakeAgpsSource(files: [(AgpsSources.ltoFile, ltoFile(100_000))]))
        op1()
        _ = await awaitMsg(0x1F, 0x02)
        consult(0)
        _ = await awaitMsg(0x1F, 0x03)
        fileList()
        _ = await awaitMsg(0x1C, 0x01)
        // One byte per frame of 100000 bytes is more than the frame cap allows.
        fileConsult(transferSize: 1, maxData: 100_000)
        _ = await awaitMsg(0x1C, 0x02)
        fileInfo(AgpsSources.ltoFile)
        _ = await awaitMsg(0x1C, 0x03)
        dataRequest(AgpsSources.ltoFile, offset: 0, length: 100_000)
        let refused = await awaitMsg(0x1C, 0x04)
        XCTAssertEqual(code(refused), 100_001)
        XCTAssertTrue(watch.all(0x1C, 0x05).isEmpty)
        // The refusal ended that transfer: the next request is refused too.
        dataRequest(AgpsSources.ltoFile, offset: 0, length: 10)
        let again = await awaitMsg(0x1C, 0x04, 2)
        XCTAssertEqual(code(again), 100_001)
    }

    func testADataRequestForAnotherNameOrBeyondTheEndIsRefused() async {
        _ = await start(FakeAgpsSource(files: [(AgpsSources.ltoFile, ltoFile(1000))]))
        op1()
        _ = await awaitMsg(0x1F, 0x02)
        consult(0)
        _ = await awaitMsg(0x1F, 0x03)
        fileConsult(transferSize: 100, maxData: 500)
        _ = await awaitMsg(0x1C, 0x02)
        fileInfo("nope.dat")
        let nope = await awaitMsg(0x1C, 0x03)
        XCTAssertEqual(code(nope), 100_001)
        fileConsult(transferSize: 100, maxData: 500)
        _ = await awaitMsg(0x1C, 0x02, 2)
        fileInfo(AgpsSources.ltoFile)
        _ = await awaitMsg(0x1C, 0x03, 2)
        dataRequest(AgpsSources.ltoFile, offset: 1001, length: 10)
        let beyond = await awaitMsg(0x1C, 0x04)
        XCTAssertEqual(code(beyond), 100_001)
    }

    func testATransferThatGoesSilentIsDroppedAndRecordedAsTimedOut() async {
        let ex = await start(FakeAgpsSource(files: [(AgpsSources.ltoFile, ltoFile(1000))]))
        op1()
        _ = await awaitMsg(0x1F, 0x02)
        consult(0)
        _ = await awaitMsg(0x1F, 0x03)
        fileConsult(transferSize: 100, maxData: 500)
        _ = await awaitMsg(0x1C, 0x02)
        fileInfo(AgpsSources.ltoFile)
        _ = await awaitMsg(0x1C, 0x03)
        // The watch says nothing more; after the stall time the request is dropped.
        await eventually(timeoutMs: 5_000, "timeout recorded") { store.lastOutcome == AgpsOutcome.timeout }
        XCTAssertFalse(ex.busy)
        dataRequest(AgpsSources.ltoFile, offset: 0, length: 100)
        let refused = await awaitMsg(0x1C, 0x04)
        XCTAssertEqual(code(refused), 100_001, "nothing is sent into a dropped transfer")
        XCTAssertTrue(watch.all(0x1C, 0x05).isEmpty)
        XCTAssertEqual(store.deliveredAtMs, 0)
    }

    func testAReadyFileTheWatchNeverCollectsIsDropped() async {
        let ex = await start(FakeAgpsSource(files: [(AgpsSources.ltoFile, ltoFile())]))
        op1()
        _ = await awaitMsg(0x1F, 0x02)
        consult(0)
        _ = await awaitMsg(0x1F, 0x03)
        await eventually(timeoutMs: 5_000, "pull wait expired") { store.lastOutcome == AgpsOutcome.watchSilent }
        XCTAssertFalse(ex.busy)
        fileList()
        let list = await awaitMsg(0x1C, 0x01)
        XCTAssertEqual(code(list), 100_001, "the dropped file is no longer offered")
    }

    func testATransferClosedBeforeTheEndIsNotADelivery() async {
        _ = await start(FakeAgpsSource(files: [(AgpsSources.ltoFile, ltoFile(1000))]))
        op1()
        _ = await awaitMsg(0x1F, 0x02)
        consult(0)
        _ = await awaitMsg(0x1F, 0x03)
        fileConsult(transferSize: 100, maxData: 300)
        _ = await awaitMsg(0x1C, 0x02)
        fileInfo(AgpsSources.ltoFile)
        _ = await awaitMsg(0x1C, 0x03)
        dataRequest(AgpsSources.ltoFile, offset: 0, length: 300)
        _ = await awaitMsg(0x1C, 0x04)
        await eventually(timeoutMs: 5_000, "frames") { watch.all(0x1C, 0x05).count == 3 }
        uploadDone(result: 1)
        let done = await awaitMsg(0x1C, 0x06)
        XCTAssertEqual(code(done), 100_000)
        await eventually(timeoutMs: 5_000, "outcome") { store.lastOutcome == AgpsOutcome.watchRefused }
        XCTAssertEqual(store.deliveredAtMs, 0)
    }

    func testANewOperatorRequestStartsOverAndClearsWhatWasReady() async {
        _ = await start(FakeAgpsSource(files: [(AgpsSources.ltoFile, ltoFile())]))
        op1()
        _ = await awaitMsg(0x1F, 0x02)
        consult(0)
        _ = await awaitMsg(0x1F, 0x03)
        op1()
        _ = await awaitMsg(0x1F, 0x02, 2)
        fileList()
        let list = await awaitMsg(0x1C, 0x01)
        XCTAssertEqual(code(list), 100_001, "cleared until the new download is ready")
    }

    func testAPhoneStartedUpdateAsksTheWatchAndCarriesOnWhenItAnswers() async {
        let file = ltoFile(1500)
        let source = FakeAgpsSource(files: [(AgpsSources.ltoFile, file)])
        let ex = await start(source)
        let outcome = Task { await ex.probe(force: true) }
        _ = await awaitMsg(0x1F, 0x02)
        XCTAssertTrue(watch.all(0x1F, 0x01).isEmpty, "no operator answer is sent for a phone-started request")
        consult(0)
        let status = await awaitMsg(0x1F, 0x03)
        XCTAssertEqual(state(status), 3)
        XCTAssertEqual(source.forces, [true])
        let received = await pull(AgpsSources.ltoFile, size: 1500, maxData: 800, transferSize: 100)
        XCTAssertEqual(received, file)
        uploadDone(result: 0)
        let result = await outcome.value
        XCTAssertEqual(result, AgpsOutcome.delivered)
    }

    func testAPhoneStartedUpdateTheWatchIgnoresEndsAsSilentAndLeavesNothingRunning() async {
        let ex = await start(FakeAgpsSource(files: [(AgpsSources.ltoFile, ltoFile())]))
        let outcome = await ex.probe(force: false)
        XCTAssertEqual(outcome, AgpsOutcome.watchSilent)
        XCTAssertFalse(ex.busy)
        XCTAssertEqual(ex.phase, "idle")
    }

    func testASecondPhoneStartedUpdateWhileOneRunsIsBusy() async {
        let ex = await start(FakeAgpsSource(files: [(AgpsSources.ltoFile, ltoFile())]))
        let first = Task { await ex.probe(force: false) }
        _ = await awaitMsg(0x1F, 0x02)
        let second = await ex.probe(force: false)
        XCTAssertEqual(second, AgpsOutcome.busy)
        let firstOutcome = await first.value
        XCTAssertEqual(firstOutcome, AgpsOutcome.watchSilent)
    }

    func testCancellingDuringTheDownloadTellsTheWatchFailedAndDropsTheRequest() async {
        let gate = AgpsLatch<Bool>()
        let ex = await start(FakeAgpsSource(files: [(AgpsSources.ltoFile, ltoFile())], gate: gate))
        let outcome = Task { await ex.probe(force: true) }
        _ = await awaitMsg(0x1F, 0x02)
        consult(0)
        await eventually(timeoutMs: 5_000, "downloading") { ex.phase == "downloading" }
        await ex.cancel()
        let status = await awaitMsg(0x1F, 0x03)
        XCTAssertEqual(state(status), 4)
        let result = await outcome.value
        XCTAssertEqual(result, AgpsOutcome.cancelled)
        XCTAssertEqual(store.lastOutcome, AgpsOutcome.cancelled)
        XCTAssertFalse(ex.busy)
        gate.complete(true)
        await sleepMs(100)
        XCTAssertEqual(watch.all(0x1F, 0x03).count, 1, "no 'ready' follows a cancelled download")
    }

    func testStoppingTheExchangeEndsAWaitingUpdateAsLinkLost() async {
        let ex = await start(FakeAgpsSource(files: [(AgpsSources.ltoFile, ltoFile())]), timing: AgpsTiming(probeAskMs: 5_000))
        let outcome = Task { await ex.probe(force: false) }
        _ = await awaitMsg(0x1F, 0x02)
        await ex.stop()
        let result = await outcome.value
        XCTAssertEqual(result, AgpsOutcome.linkLost)
        XCTAssertEqual(store.lastOutcome, AgpsOutcome.linkLost)
    }

    // MARK: the experimental HW_AGNSS path (AgpsLab), ports of the Kotlin cases

    /// The Fit 4 Pro's consult tag from the 2026-10-25 capture.
    private static let hwAgnssTag = "higeo/v1/gnssinfo?type=0x0024/HW_AGNSS"

    /// The real source with the HTTP side faked: `answer` gets the URL asked for.
    private func labSource(_ answer: @escaping @Sendable (String) throws -> AgpsDownload) -> NetworkAgpsSource {
        NetworkAgpsSource(cache: NullAgpsCache(), store: store, log: { _ in }, isOnline: { true }, httpGet: { url, _ in try answer(url) })
    }

    private final class Urls: @unchecked Sendable {
        private let lock = NSLock()
        private var list: [String] = []
        func add(_ url: String) { lock.locked { list.append(url) } }
        var all: [String] { lock.locked { list } }
    }

    private static func nowMs() -> Int { Int(Date().timeIntervalSince1970 * 1000) }

    func testWithTheLabSwitchOffAHwAgnssAskIsDeclinedWithTodaysBytesAndNoDownload() async {
        XCTAssertFalse(store.labAgnss, "off by default")
        _ = await start(labSource { _ in throw AgpsFetchError("the network must not be used") })
        op1()
        _ = await awaitMsg(0x1F, 0x02)
        consult(3, Self.hwAgnssTag)
        _ = await awaitMsg(0x1F, 0x03)
        fileList()
        _ = await awaitMsg(0x1C, 0x01)
        let sent = watch.messages.map { "\($0.service)/\($0.command) \($0.tlv?.serialize() ?? [])" }
        let expected = [
            (0x1F, 0x01, AgpsMessages.operatorAnswer(code: AgpsMessages.codeOk)),
            (0x1F, 0x02, AgpsMessages.parameterConsult()),
            (0x1F, 0x03, AgpsMessages.fileStatus(state: AgpsMessages.stateFailed)),
            (0x1C, 0x01, AgpsMessages.refused()),
        ].map { "\($0.0)/\($0.1) \($0.2.serialize())" }
        XCTAssertEqual(sent, expected)
        XCTAssertEqual(store.lastOutcome, AgpsOutcome.unsupported)
        XCTAssertEqual(store.lastError, "the watch asked for kinds only the watch maker's app prepares (version 3: HW_AGNSS)")
        XCTAssertEqual(store.failures, 0)
        XCTAssertEqual(store.cachedAtMs, 0)
    }

    func testWithTheLabSwitchOnAHwAgnssAskGetsTheServersFileOverTheFileService() async throws {
        store.setLabAgnss(true)
        let file = rtcmFile(110)
        let asked = Urls()
        let ex = await start(labSource { url in
            asked.add(url)
            return AgpsDownload(body: file, lastModifiedMs: Self.nowMs() - 60_000)
        })

        op1()
        _ = await awaitMsg(0x1F, 0x02)
        consult(3, Self.hwAgnssTag)
        let status = await awaitMsg(0x1F, 0x03)
        XCTAssertEqual(state(status), 3, "ready")
        XCTAssertEqual(asked.all, [EphemerisNet.agnssUrl])

        let received = await pull(AgpsLab.file, size: file.count, maxData: 2048, transferSize: 232)
        XCTAssertEqual(received, file)
        let list = await awaitMsg(0x1C, 0x01)
        XCTAssertEqual(try list.tlv!.string(0x01), AgpsLab.file, "the one file the watch is offered")
        let infoMessage = await awaitMsg(0x1C, 0x03)
        XCTAssertEqual(try infoMessage.tlv!.int(0x02), Int32(file.count))
        XCTAssertEqual(try infoMessage.tlv!.short(0x03), Int16(truncatingIfNeeded: Int(CRC16.checksum(file))))
        let dataAnswer = await awaitMsg(0x1C, 0x04)
        XCTAssertEqual(try dataAnswer.tlv!.string(0x02), EphemerisNet.addressDigest("AA:BB:CC:DD:EE:FF") + AgpsLab.file)

        uploadDone(result: 0)
        let done = await awaitMsg(0x1C, 0x06)
        XCTAssertEqual(code(done), 100_000)
        await eventually(timeoutMs: 5_000, "delivery recorded") { store.deliveredAtMs > 0 }
        XCTAssertEqual(store.lastOutcome, AgpsOutcome.delivered)
        XCTAssertEqual(store.deliveredSource, AgpsLab.source)
        XCTAssertEqual(store.deliveredSize, file.count)
        XCTAssertEqual(store.cachedSource, AgpsLab.source)
        XCTAssertEqual(store.lastAskTags, "HW_AGNSS")
        XCTAssertFalse(ex.busy)
    }

    func testWithTheLabSwitchOnAFileThatFailsTheCheckIsDeclinedAsToday() async {
        store.setLabAgnss(true)
        let few = rtcmFile(10)
        _ = await start(labSource { _ in AgpsDownload(body: few, lastModifiedMs: Self.nowMs()) })
        op1()
        _ = await awaitMsg(0x1F, 0x02)
        consult(3, Self.hwAgnssTag)
        let status = await awaitMsg(0x1F, 0x03)
        XCTAssertEqual(state(status), 4)
        XCTAssertEqual(store.lastOutcome, AgpsOutcome.invalidFile)
        XCTAssertEqual(store.lastError, "HW_AGNSS: only 10 satellites (at least 20 needed)")
        fileList()
        let list = await awaitMsg(0x1C, 0x01)
        XCTAssertEqual(code(list), 100_001, "nothing is offered")
    }

    func testWithTheLabSwitchOnAnyOtherKindIsDeclinedWithoutADownload() async {
        store.setLabAgnss(true)
        _ = await start(labSource { _ in throw AgpsFetchError("the network must not be used") })
        op1()
        _ = await awaitMsg(0x1F, 0x02)
        consult(3, "com.huawei.higeo_dataModule_PGNSSConfig?type=HW_EEV2/HW_PGNSS_PRED;")
        let first = await awaitMsg(0x1F, 0x03)
        XCTAssertEqual(state(first), 4)
        op1()
        _ = await awaitMsg(0x1F, 0x02, 2)
        consult(3, "a/HW_AGNSS;b/HW_PGNSS_GPS")
        let second = await awaitMsg(0x1F, 0x03, 2)
        XCTAssertEqual(state(second), 4)
        XCTAssertEqual(store.lastOutcome, AgpsOutcome.unsupported)
    }

    func testWithTheLabSwitchOnAFailedDownloadWaitsForTheRetryScheduleAndAnUpdateNowSkipsIt() async {
        store.setLabAgnss(true)
        let asked = Urls()
        let ex = await start(labSource { url in
            asked.add(url)
            throw AgpsFetchError("HTTP 503")
        })
        op1()
        _ = await awaitMsg(0x1F, 0x02)
        consult(3, Self.hwAgnssTag)
        let first = await awaitMsg(0x1F, 0x03)
        XCTAssertEqual(state(first), 4)
        XCTAssertEqual(store.lastOutcome, AgpsOutcome.downloadFailed)
        XCTAssertEqual(store.lastError, "HW_AGNSS: HTTP 503")
        XCTAssertEqual(store.failures, 1)
        XCTAssertEqual(asked.all.count, 1)

        // The watch asks again at once: answered "failed" from the retry wait, without another request to the server.
        op1()
        _ = await awaitMsg(0x1F, 0x02, 2)
        consult(3, Self.hwAgnssTag)
        let second = await awaitMsg(0x1F, 0x03, 2)
        XCTAssertEqual(state(second), 4)
        XCTAssertEqual(asked.all.count, 1)
        XCTAssertEqual(store.failures, 1)
        XCTAssertTrue(store.lastError.hasPrefix("waiting "))

        // "Perbarui sekarang" (a forced, phone-started request) ends the wait and asks the server again.
        let outcome = Task { await ex.probe(force: true) }
        _ = await awaitMsg(0x1F, 0x02, 3)
        consult(3, Self.hwAgnssTag)
        let third = await awaitMsg(0x1F, 0x03, 3)
        XCTAssertEqual(state(third), 4)
        let result = await outcome.value
        XCTAssertEqual(result, AgpsOutcome.downloadFailed)
        XCTAssertEqual(asked.all.count, 2)
        XCTAssertEqual(store.failures, 1, "the forced try starts the schedule over")
    }

    func testWithTheLabSwitchOffARunningRetryWaitLeavesTheDeclineAsItWas() async {
        store.recordOutcome(nowMs: Self.nowMs(), outcome: AgpsOutcome.downloadFailed, error: "earlier Broadcom failure", countsAsFailure: true)
        XCTAssertGreaterThan(store.retryAtMs(), Self.nowMs())
        _ = await start(labSource { _ in throw AgpsFetchError("the network must not be used") })
        op1()
        _ = await awaitMsg(0x1F, 0x02)
        consult(3, Self.hwAgnssTag)
        let status = await awaitMsg(0x1F, 0x03)
        XCTAssertEqual(state(status), 4)
        XCTAssertEqual(store.lastOutcome, AgpsOutcome.unsupported)
        XCTAssertEqual(store.lastError, "the watch asked for kinds only the watch maker's app prepares (version 3: HW_AGNSS)")
    }

    // MARK: the experimental HW_PGNSS_PRED path (AgpsPgnss), ports of the Kotlin cases

    /// The Fit 4 Pro's PRED consult tag (logcat of 2026-10-18, capture of 2026-10-25).
    private static let predTag = "com.huawei.higeo_dataModule_PGNSSConfig?type=HW_EEV2/HW_PGNSS_PRED;"

    /// What the phone sent so far, one line per message: service/command and the TLV bytes.
    private func sentSoFar() -> [String] { watch.messages.map { "\($0.service)/\($0.command) \($0.tlv?.serialize() ?? [])" } }

    /// Today's decline of a kind: operator ok, parameter consult, state 4, and the file list refused.
    private static let declineBytes = [
        (0x1F, 0x01, AgpsMessages.operatorAnswer(code: AgpsMessages.codeOk)),
        (0x1F, 0x02, AgpsMessages.parameterConsult()),
        (0x1F, 0x03, AgpsMessages.fileStatus(state: AgpsMessages.stateFailed)),
        (0x1C, 0x01, AgpsMessages.refused()),
    ].map { "\($0.0)/\($0.1) \($0.2.serialize())" }

    private final class Index: @unchecked Sendable {
        private let lock = NSLock()
        private var value = 0
        var current: Int {
            get { lock.locked { value } }
            set { lock.locked { value = newValue } }
        }
    }

    func testWithThePgnssSwitchOffAPredAskIsDeclinedWithTodaysBytesAndNoDownload() async {
        XCTAssertFalse(store.labPgnss, "off by default")
        store.setLabAgnss(true)
        _ = await start(labSource { _ in throw AgpsFetchError("the network must not be used") })
        op1()
        _ = await awaitMsg(0x1F, 0x02)
        consult(3, Self.predTag)
        _ = await awaitMsg(0x1F, 0x03)
        fileList()
        _ = await awaitMsg(0x1C, 0x01)
        XCTAssertEqual(sentSoFar(), Self.declineBytes)
        XCTAssertEqual(store.lastOutcome, AgpsOutcome.unsupported)
        XCTAssertEqual(store.lastError, "the watch asked for kinds only the watch maker's app prepares (version 3: HW_PGNSS_PRED)")
        XCTAssertEqual(store.failures, 0)
        XCTAssertEqual(store.cachedAtMs, 0)
    }

    func testWithOnlyThePgnssSwitchOnAHwAgnssAskIsStillDeclinedWithTodaysBytes() async {
        store.setLabPgnss(true)
        _ = await start(labSource { _ in throw AgpsFetchError("the network must not be used") })
        op1()
        _ = await awaitMsg(0x1F, 0x02)
        consult(3, Self.hwAgnssTag)
        _ = await awaitMsg(0x1F, 0x03)
        fileList()
        _ = await awaitMsg(0x1C, 0x01)
        XCTAssertEqual(sentSoFar(), Self.declineBytes)
        XCTAssertEqual(store.lastError, "the watch asked for kinds only the watch maker's app prepares (version 3: HW_AGNSS)")
    }

    func testWithThePgnssSwitchOnAPredAskGetsTheSixFilesOneAfterTheOtherOverTheFileService() async throws {
        store.setLabPgnss(true)
        let built = Self.nowMs() - 60_000
        let files = pgnssFiles(builtMs: built)
        let bundle = pgnssBundle(files)
        let asked = Urls()
        let ex = await start(labSource { url in
            asked.add(url)
            return AgpsDownload(body: bundle, lastModifiedMs: built)
        })

        op1()
        _ = await awaitMsg(0x1F, 0x02)
        consult(3, Self.predTag)
        let status = await awaitMsg(0x1F, 0x03)
        XCTAssertEqual(state(status), 3, "ready")
        XCTAssertEqual(asked.all, [EphemerisNet.pgnssUrl])

        // The order the Fit 4 Pro pulled them from Huawei Health: one 1C/01 ... 1C/06 round per file, every 1C/01 answered with all six names.
        let names = ["HW_PGNSS_GPS", "HW_PGNSS_BDS", "HW_PGNSS_GLONASS", "HW_PGNSS_GALILEO", "HW_PGNSS_QZS", "HW_PGNSS_EXTRA"]
        XCTAssertEqual(files.map(\.name), names)
        for (k, file) in files.enumerated() {
            let received = await pull(file.name, size: file.data.count, maxData: 32_768, transferSize: 862)
            XCTAssertEqual(received, file.data, file.name)
            let list = await awaitMsg(0x1C, 0x01, k + 1)
            XCTAssertEqual(try list.tlv!.string(0x01), names.joined(separator: ";"))
            let info = await awaitMsg(0x1C, 0x03, k + 1)
            XCTAssertEqual(try info.tlv!.int(0x02), Int32(file.data.count))
            XCTAssertEqual(try info.tlv!.short(0x03), Int16(truncatingIfNeeded: Int(CRC16.checksum(file.data))))
            XCTAssertEqual(try watch.all(0x1C, 0x04).last!.tlv!.string(0x02), EphemerisNet.addressDigest("AA:BB:CC:DD:EE:FF") + file.name)
            uploadDone(result: 1)
            let done = await awaitMsg(0x1C, 0x06, k + 1)
            XCTAssertEqual(code(done), 100_000)
            if k < files.count - 1 {
                XCTAssertEqual(store.deliveredAtMs, 0, "no delivery is recorded before the last file")
                XCTAssertTrue(ex.busy)
            }
        }
        await eventually(timeoutMs: 5_000, "delivery recorded") { store.deliveredAtMs > 0 }
        XCTAssertEqual(store.lastOutcome, AgpsOutcome.delivered)
        XCTAssertEqual(store.deliveredSource, AgpsPgnss.source)
        XCTAssertEqual(store.deliveredSize, 799_112, "all six files")
        XCTAssertEqual(store.deliveredDataMs, built)
        XCTAssertEqual(store.cachedSource, AgpsPgnss.source)
        XCTAssertEqual(store.lastAskTags, "HW_PGNSS_PRED")
        XCTAssertEqual(asked.all.count, 1)
        XCTAssertFalse(ex.busy)
    }

    func testWithThePgnssSwitchOnAWrongStaleOrMisorderedBundleIsDeclinedAsToday() async {
        store.setLabPgnss(true)
        let now = Self.nowMs()
        let files = pgnssFiles(builtMs: now - 60_000)
        let shortGps = replacing(files, "HW_PGNSS_GPS") { Array($0[0..<93_311]) }
        let badHeader = replacing(files, "HW_PGNSS_GPS") { data in
            var copy = data
            copy[12 * 2 + 4] = 0
            return copy
        }
        let cases: [(AgpsDownload, String)] = [
            (AgpsDownload(body: pgnssBundle(shortGps), lastModifiedMs: now - 60_000), "HW_PGNSS_PRED: HW_PGNSS_GPS is 93311 bytes (93312 expected)"),
            (
                AgpsDownload(body: pgnssBundle(Array(files.reversed())), lastModifiedMs: now - 60_000),
                "HW_PGNSS_PRED: file 1 is \"HW_PGNSS_EXTRA\" (HW_PGNSS_GPS expected)"
            ),
            (
                AgpsDownload(body: pgnssBundle(badHeader), lastModifiedMs: now - 60_000),
                "HW_PGNSS_PRED: HW_PGNSS_GPS header entry 2 points at 5888 (6136 expected)"
            ),
            (AgpsDownload(body: pgnssBundle(files), lastModifiedMs: now - 7 * 3_600_000), "HW_PGNSS_PRED: the bundle was built 420 minutes ago"),
        ]
        let answers = cases.map(\.0)
        let next = Index()
        _ = await start(labSource { _ in answers[next.current] })
        for (k, item) in cases.enumerated() {
            next.current = k
            store.clearRetry()
            op1()
            _ = await awaitMsg(0x1F, 0x02, k + 1)
            consult(3, Self.predTag)
            let status = await awaitMsg(0x1F, 0x03, k + 1)
            XCTAssertEqual(state(status), 4, item.1)
            XCTAssertEqual(store.lastOutcome, AgpsOutcome.invalidFile)
            XCTAssertEqual(store.lastError, item.1)
            fileList()
            let list = await awaitMsg(0x1C, 0x01, k + 1)
            XCTAssertEqual(code(list), 100_001, "nothing is offered")
        }
        XCTAssertTrue(watch.all(0x1C, 0x03).isEmpty)
        XCTAssertEqual(store.deliveredAtMs, 0)
    }

    func testWithBothSwitchesOnTheHwAgnssAskAndThePredAskAfterItAreEachServedOnTheirOwn() async throws {
        store.setLabAgnss(true)
        store.setLabPgnss(true)
        let built = Self.nowMs() - 60_000
        let rtcm = rtcmFile(110)
        let bundle = pgnssBundle(pgnssFiles(builtMs: built))
        _ = await start(labSource { url in
            url == EphemerisNet.agnssUrl ? AgpsDownload(body: rtcm, lastModifiedMs: built) : AgpsDownload(body: bundle, lastModifiedMs: built)
        })

        // Device run of 2026-10-25: HW_AGNSS first, then HW_PGNSS_PRED in its own 1F/01 exchange two seconds after the transfer closed.
        op1()
        _ = await awaitMsg(0x1F, 0x02)
        consult(3, Self.hwAgnssTag)
        let first = await awaitMsg(0x1F, 0x03)
        XCTAssertEqual(state(first), 3)
        let received = await pull(AgpsLab.file, size: rtcm.count, maxData: 2048, transferSize: 232)
        XCTAssertEqual(received, rtcm)
        let list = await awaitMsg(0x1C, 0x01)
        XCTAssertEqual(try list.tlv!.string(0x01), AgpsLab.file)
        uploadDone(result: 1)
        await eventually(timeoutMs: 5_000, "HW_AGNSS delivered") { store.deliveredSource == AgpsLab.source }

        op1()
        _ = await awaitMsg(0x1F, 0x02, 2)
        consult(3, Self.predTag)
        let second = await awaitMsg(0x1F, 0x03, 2)
        XCTAssertEqual(state(second), 3)
        fileList()
        let predList = await awaitMsg(0x1C, 0x01, 2)
        XCTAssertEqual(try predList.tlv!.string(0x01), PgnssBundle.files.map(\.name).joined(separator: ";"))
    }
}
