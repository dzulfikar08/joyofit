import XCTest
@testable import HuaweiWearLogic

/// The pure parts of the satellite-data job (port of the Kotlin AgpsTest): schedule, validation, the bytes the phone sends, the store and the
/// source rules.
final class AgpsTests: XCTestCase {
    private func lto(_ size: Int = 115_749) -> Bytes {
        var data = Bytes((0..<size).map { UInt8(truncatingIfNeeded: $0 * 31) })
        data[0] = 0xFF
        data[1] = 0xCA
        data[2] = 0xDE
        return data
    }

    // MARK: policy

    func testRetryWaitsGrowThenStayAtSixHours() {
        let minute = 60_000
        XCTAssertEqual(AgpsPolicy.retryDelayMs(failures: 0), 0)
        XCTAssertEqual(AgpsPolicy.retryDelayMs(failures: 1), 1 * minute)
        XCTAssertEqual(AgpsPolicy.retryDelayMs(failures: 2), 5 * minute)
        XCTAssertEqual(AgpsPolicy.retryDelayMs(failures: 3), 15 * minute)
        XCTAssertEqual(AgpsPolicy.retryDelayMs(failures: 4), 60 * minute)
        XCTAssertEqual(AgpsPolicy.retryDelayMs(failures: 5), 360 * minute)
        XCTAssertEqual(AgpsPolicy.retryDelayMs(failures: 50), 360 * minute)
        XCTAssertEqual(AgpsPolicy.retryAtMs(lastFailureMs: 10_000, failures: 2), 10_000 + 5 * minute)
        XCTAssertEqual(AgpsPolicy.retryAtMs(lastFailureMs: 10_000, failures: 0), 0)
    }

    func testPrefetchIsDueWhenTheCopyIsMissingOrSixHoursOldAndNoRetryWaits() {
        let hour = 60 * 60_000
        let now = 100 * hour
        XCTAssertTrue(AgpsPolicy.prefetchDue(cachedAtMs: 0, nowMs: now, retryAtMs: 0))
        XCTAssertFalse(AgpsPolicy.prefetchDue(cachedAtMs: now - 5 * hour, nowMs: now, retryAtMs: 0))
        XCTAssertTrue(AgpsPolicy.prefetchDue(cachedAtMs: now - 6 * hour, nowMs: now, retryAtMs: 0))
        XCTAssertFalse(AgpsPolicy.prefetchDue(cachedAtMs: 0, nowMs: now, retryAtMs: now + 1), "a retry wait blocks it")
        XCTAssertTrue(AgpsPolicy.prefetchDue(cachedAtMs: 0, nowMs: now, retryAtMs: now))
    }

    func testDeliveryIsDueAfterADay() {
        let hour = 60 * 60_000
        let now = 1_000 * hour
        XCTAssertTrue(AgpsPolicy.deliveryDue(deliveredAtMs: 0, nowMs: now))
        XCTAssertFalse(AgpsPolicy.deliveryDue(deliveredAtMs: now - 23 * hour, nowMs: now))
        XCTAssertTrue(AgpsPolicy.deliveryDue(deliveredAtMs: now - 24 * hour, nowMs: now))
        XCTAssertEqual(AgpsPolicy.expiresAtMs(dataTimeMs: now), now + 7 * 24 * hour)
        XCTAssertEqual(AgpsPolicy.expiresAtMs(dataTimeMs: 0), 0)
    }

    func testTheConstantsAreTheSafetyRulesOfTheDoc() {
        XCTAssertEqual(AgpsPolicy.transferStallMs, 30_000)
        XCTAssertEqual(AgpsPolicy.pullWaitMs, 60_000)
        XCTAssertEqual(AgpsPolicy.downloadTimeoutMs, 120_000)
        XCTAssertEqual(AgpsPolicy.cacheFreshMs, 6 * 60 * 60_000)
        XCTAssertEqual(AgpsPolicy.deliverEveryMs, 24 * 60 * 60_000)
        XCTAssertEqual(AgpsPolicy.validMs, 7 * 24 * 60 * 60_000)
        XCTAssertEqual(AgpsPolicy.ltoMinBytes, 16 * 1024)
        XCTAssertEqual(AgpsPolicy.ltoMaxBytes, 1024 * 1024)
        XCTAssertEqual(AgpsPolicy.maxDataPerRequest, 1024 * 1024)
        XCTAssertEqual(AgpsPolicy.maxFrames, 65_535)
        XCTAssertEqual(EphemerisNet.ltoHost + EphemerisNet.ltoPath, "https://gllto.glpals.com/7day/v6/latest/lto.dat")
    }

    func testAGoodLtoFilePasses() {
        XCTAssertNil(AgpsPolicy.validateLto(lto()))
        XCTAssertNil(AgpsPolicy.validateLto(lto(AgpsPolicy.ltoMinBytes)))
        XCTAssertNil(AgpsPolicy.validateLto(lto(AgpsPolicy.ltoMaxBytes)))
    }

    func testLtoFilesOutsideTheBoundsOrWithAnotherHeaderAreRefused() {
        XCTAssertNotNil(AgpsPolicy.validateLto(lto(AgpsPolicy.ltoMinBytes - 1)))
        XCTAssertNotNil(AgpsPolicy.validateLto(lto(AgpsPolicy.ltoMaxBytes + 1)))
        var wrong = lto()
        wrong[2] = 0
        XCTAssertNotNil(AgpsPolicy.validateLto(wrong))
        let page = Array("<html>".utf8) + Bytes(repeating: 0, count: 40_000)
        XCTAssertTrue(AgpsPolicy.validateLto(page)!.contains("header"))
        XCTAssertNotNil(AgpsPolicy.validateLto([]))
    }

    func testFrameCountRoundsUpAndRefusesAbsurdTransfers() {
        XCTAssertEqual(AgpsPolicy.frameCount(size: 1, frameSize: 100), 1)
        XCTAssertEqual(AgpsPolicy.frameCount(size: 100, frameSize: 100), 1)
        XCTAssertEqual(AgpsPolicy.frameCount(size: 101, frameSize: 100), 2)
        XCTAssertEqual(AgpsPolicy.frameCount(size: 115_749, frameSize: 100), 1158)
        XCTAssertNil(AgpsPolicy.frameCount(size: 0, frameSize: 100))
        XCTAssertNil(AgpsPolicy.frameCount(size: 100, frameSize: 0))
        XCTAssertNil(AgpsPolicy.frameCount(size: 1024 * 1024, frameSize: 1), "one byte per frame of a megabyte")
        XCTAssertEqual(AgpsPolicy.frameCount(size: AgpsPolicy.maxFrames, frameSize: 1), AgpsPolicy.maxFrames)
    }

    // MARK: the bytes the phone sends

    func testOperatorAndRefusalAnswersCarryTheWireCodes() {
        XCTAssertEqual(AgpsMessages.operatorAnswer(code: AgpsMessages.codeOk).serialize().hexLower, "7f04000186a0")
        XCTAssertEqual(AgpsMessages.operatorAnswer(code: AgpsMessages.codeNoNetwork).serialize().hexLower, "7f04000186a7")
        XCTAssertEqual(AgpsMessages.refused().serialize().hexLower, "7f04000186a1")
        XCTAssertEqual(AgpsMessages.accepted().serialize().hexLower, "7f04000186a0")
    }

    func testParameterConsultIsAnEmptyContainer() {
        XCTAssertEqual(AgpsMessages.parameterConsult().serialize().hexLower, "8100")
    }

    func testProgressAnswerEchoesTheWatchTimeAndTheState() {
        let answer = AgpsMessages.progressAnswer(timeBytes: [0, 0, 1, 2], state: AgpsMessages.stateReady)
        XCTAssertEqual(answer.serialize().hexLower, "810c020102030400000102040103")
    }

    func testFileStatusIsOneByte() {
        XCTAssertEqual(AgpsMessages.fileStatus(state: AgpsMessages.stateReady).serialize().hexLower, "010103")
        XCTAssertEqual(AgpsMessages.fileStatus(state: AgpsMessages.stateFailed).serialize().hexLower, "010104")
        XCTAssertEqual(AgpsMessages.fileStatus(state: AgpsMessages.stateUnsupported).serialize().hexLower, "010105")
    }

    func testFileListJoinsNamesWithSemicolons() {
        XCTAssertEqual(AgpsMessages.fileList(names: ["a", "b"]).serialize().hexLower, "010361" + "3b62")
        XCTAssertEqual(AgpsMessages.fileList(names: ["gpslocation.dat"]).serialize().hexLower, "010f" + Array("gpslocation.dat".utf8).hexLower)
    }

    func testFileInfoCarriesSizeAndCrc() throws {
        // 115749 = 0x0001C425 as i32; the CRC as i16.
        XCTAssertEqual(AgpsMessages.fileInfo(size: 115_749, crc16: 0x1234).serialize().hexLower, "020400" + "01c425" + "03021234")
        let data = lto(1000)
        let crc = Int(CRC16.checksum(data))
        let tlv = try HuaweiTLV(parsing: AgpsMessages.fileInfo(size: data.count, crc16: crc).serialize())
        XCTAssertEqual(try tlv.int(0x02), 1000)
        XCTAssertEqual(try tlv.short(0x03), Int16(truncatingIfNeeded: crc))
    }

    func testDataAnswerCarriesTheStoredNameAndOffset() {
        let answer = AgpsMessages.dataAnswer(storedName: "ab", offset: 4096)
        XCTAssertEqual(answer.serialize().hexLower, "7f04000186a0" + "020261" + "62" + "0304" + "00001000")
    }

    func testStoredNameIsTheDigestOfTheAddressWithoutColons() {
        // SHA-256 of "AABBCCDDEEFF" (GB getHexDigest), checked against the digest of the colon-less text.
        XCTAssertEqual(EphemerisNet.addressDigest("AA:BB:CC:DD:EE:FF"), SHA256.hash(Array("AABBCCDDEEFF".utf8)).hexLower)
        XCTAssertEqual(EphemerisNet.addressDigest("AA:BB:CC:DD:EE:FF").count, 64)
        // The known SHA-256 of the empty string pins the hex format (lower case).
        XCTAssertEqual(EphemerisNet.addressDigest(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
    }

    func testTheConsultAnswerIsParsedIntoVersionTagAndUrls() {
        var body = HuaweiTLV()
        body.put(0x04, int: 5)
        body.put(0x05, byte: 3)
        body.put(0x06, string: "a/b/HW_AGNSS;x/HW_PGNSS_PRED")
        var tlv = HuaweiTLV()
        tlv.put(0x81, tlv: body)
        let consult = AgpsMessages.parseConsult(tlv)!
        XCTAssertEqual(consult.version, 3)
        XCTAssertEqual(consult.tag, "a/b/HW_AGNSS;x/HW_PGNSS_PRED")
        XCTAssertEqual(consult.tagNames, "HW_AGNSS,HW_PGNSS_PRED", "only the names, never the paths")
        var other = HuaweiTLV()
        other.put(0x7F, int: 100_001)
        XCTAssertNil(AgpsMessages.parseConsult(other))
        XCTAssertNil(AgpsMessages.parseConsult(nil))
    }

    func testTheConsultAnswerListsTheUrlChildren() {
        var first = HuaweiTLV()
        first.put(0x03, string: "https://example.test/a")
        var second = HuaweiTLV()
        second.put(0x03, string: "https://example.test/b")
        var body = HuaweiTLV()
        body.put(0x05, byte: 0)
        body.put(0x83, tlv: first)
        body.put(0x83, tlv: second)
        var tlv = HuaweiTLV()
        tlv.put(0x81, tlv: body)
        let consult = AgpsMessages.parseConsult(tlv)!
        XCTAssertEqual(consult.version, 0)
        XCTAssertEqual(consult.tag, "")
        XCTAssertEqual(consult.urls, ["https://example.test/a", "https://example.test/b"])
    }

    // MARK: frames

    func testDataFramesAreIndexedAndCutAtTheTransferSize() throws {
        let params = ParamsProvider()
        params.transactionsCrypted = false
        let data = Bytes((0..<250).map { UInt8(truncatingIfNeeded: $0) })
        let frames = try HuaweiPacket(serviceId: 0x1C, commandId: 0x05).serializeFileChunk1c(
            data, transferSize: 100, packetCount: 3, useEncryption: false, params: params
        )
        XCTAssertEqual(frames.count, 3)
        var rebuilt = Bytes()
        for (index, f) in frames.enumerated() {
            // 5A, length (2), 00, service 1C, command 05, index, data..., CRC16 (2)
            XCTAssertEqual(f[0], 0x5A)
            XCTAssertEqual(f[4], 0x1C)
            XCTAssertEqual(f[5], 0x05)
            XCTAssertEqual(Int(f[6]), index)
            rebuilt += f[7..<f.count - 2]
            XCTAssertEqual(CRC16.checksum(Array(f[0..<f.count - 2])), f.u16be(f.count - 2))
        }
        XCTAssertEqual(rebuilt, data)
        XCTAssertEqual(frames[0].count - 9, 100)
        XCTAssertEqual(frames[2].count - 9, 50)
    }

    func testEncryptedDataFramesDecryptToIndexAndBytes() throws {
        let params = ParamsProvider()
        params.secretKey = Bytes(repeating: 0, count: 16)
        let data = Bytes((0..<130).map { UInt8(truncatingIfNeeded: $0 &* 7) })
        let frames = try HuaweiPacket(serviceId: 0x1C, commandId: 0x05).serializeFileChunk1c(
            data, transferSize: 60, packetCount: 3, useEncryption: true, params: params
        )
        var assembler = PacketAssembler()
        var plain = [Bytes]()
        for f in frames {
            let result = try assembler.feed(f, params: params)
            guard let packet = result.packet else { continue }
            XCTAssertEqual(packet.serviceId, 0x1C)
            XCTAssertEqual(packet.commandId, 0x05)
            let body = packet.payload!
            plain.append(try HuaweiTLV(parsing: body, offset: 2, length: body.count - 2).fileDownloadDecryptRaw(params: params))
        }
        XCTAssertEqual(plain.count, 3)
        XCTAssertEqual(plain.map { $0[0] }, [0, 1, 2])
        XCTAssertEqual(plain.flatMap { Array($0.dropFirst()) }, data)
    }

    // MARK: the store

    func testTheStoreStartsEmpty() {
        let store = AgpsStore(defaults: ephemeralDefaults())
        XCTAssertEqual(store.cachedAtMs, 0)
        XCTAssertEqual(store.lastAskVersion, -1)
        XCTAssertEqual(store.lastOutcome, AgpsOutcome.none)
        XCTAssertEqual(store.retryAtMs(), 0)
    }

    func testFailuresAccumulateIntoTheRetryWaitAndASuccessOrTheUserClearsThem() {
        let store = AgpsStore(defaults: ephemeralDefaults())
        store.recordOutcome(nowMs: 1_000, outcome: AgpsOutcome.downloadFailed, error: "HTTP 503", countsAsFailure: true)
        XCTAssertEqual(store.failures, 1)
        XCTAssertEqual(store.retryAtMs(), 1_000 + 60_000)
        store.recordOutcome(nowMs: 2_000, outcome: AgpsOutcome.downloadFailed, error: "HTTP 503", countsAsFailure: true)
        XCTAssertEqual(store.failures, 2)
        XCTAssertEqual(store.retryAtMs(), 2_000 + 5 * 60_000)
        store.recordOutcome(nowMs: 3_000, outcome: AgpsOutcome.watchSilent, error: "no answer", countsAsFailure: false)
        XCTAssertEqual(store.failures, 2, "a silent watch is not a download failure")
        XCTAssertEqual(store.lastOutcome, AgpsOutcome.watchSilent)
        store.clearRetry()
        XCTAssertEqual(store.retryAtMs(), 0)
        store.recordOutcome(nowMs: 4_000, outcome: AgpsOutcome.downloadFailed, error: "x", countsAsFailure: true)
        store.recordDownloaded(nowMs: 5_000, dataMs: 4_500, size: 1234, source: AgpsSources.broadcom)
        XCTAssertEqual(store.failures, 0)
        XCTAssertEqual(store.cachedSize, 1234)
        XCTAssertEqual(store.cachedDataMs, 4_500)
    }

    func testADeliveryIsRememberedPerWatchAndCountsAsTheOutcome() {
        let store = AgpsStore(defaults: ephemeralDefaults())
        store.recordDelivered(nowMs: 9_000, dataMs: 8_000, size: 115_749, source: AgpsSources.broadcom, address: "AA:BB:CC:DD:EE:FF")
        XCTAssertEqual(store.deliveredAtMs, 9_000)
        XCTAssertEqual(store.deliveredSize, 115_749)
        XCTAssertEqual(store.deliveredAddress, "AA:BB:CC:DD:EE:FF")
        XCTAssertEqual(store.lastOutcome, AgpsOutcome.delivered)
        XCTAssertEqual(store.lastError, "")
    }

    func testTheAskKeepsTagNamesOnlyAndIsCapped() {
        let store = AgpsStore(defaults: ephemeralDefaults())
        store.recordAsk(nowMs: 7, version: 3, tags: String(repeating: "x", count: 500))
        XCTAssertEqual(store.lastAskTags.count, 120)
        XCTAssertEqual(store.lastAskVersion, 3)
        XCTAssertEqual(store.lastAskMs, 7)
    }

    func testTheErrorTextIsCapped() {
        let store = AgpsStore(defaults: ephemeralDefaults())
        store.recordOutcome(nowMs: 1, outcome: AgpsOutcome.downloadFailed, error: String(repeating: "e", count: 500), countsAsFailure: false)
        XCTAssertEqual(store.lastError.count, 200)
    }

    // MARK: the source

    private final class MemoryCache: AgpsCache, @unchecked Sendable {
        private let lock = NSLock()
        private var _entries: [String: Bytes] = [:]
        var entries: [String: Bytes] {
            get { lock.locked { _entries } }
            set { lock.locked { _entries = newValue } }
        }
        func read(_ url: String, maxAgeMs: Int) -> Bytes? { lock.locked { _entries[url] } }
        func write(_ url: String, data: Bytes) { lock.locked { _entries[url] = data } }
        func delete(_ url: String) { lock.locked { _entries[url] = nil } }
    }

    private let ltoUrl = EphemerisNet.ltoHost + EphemerisNet.ltoPath

    private func source(
        _ cache: AgpsCache, _ store: AgpsStore, online: Bool = true,
        get: @escaping @Sendable (String, Int) async throws -> AgpsDownload = { _, _ in throw AgpsFetchError("the network must not be used here") }
    ) -> NetworkAgpsSource {
        NetworkAgpsSource(cache: cache, store: store, log: { _ in }, isOnline: { online }, nowMs: { 50_000 }, httpGet: get)
    }

    func testVersionZeroServesAGoodCachedFileAndMarksItAsCached() async {
        let cache = MemoryCache()
        cache.entries[ltoUrl] = lto()
        let store = AgpsStore(defaults: ephemeralDefaults())
        store.recordDownloaded(nowMs: 40_000, dataMs: 39_000, size: 115_749, source: AgpsSources.broadcom)
        let fetch = await source(cache, store).fetch(.default, force: false)
        XCTAssertTrue(fetch.ok)
        XCTAssertTrue(fetch.fromCache)
        XCTAssertEqual(fetch.source, AgpsSources.broadcom)
        XCTAssertEqual(fetch.dataTimeMs, 39_000)
        XCTAssertEqual(fetch.files.map(\.name), [AgpsSources.ltoFile])
    }

    func testABrokenCachedFileIsDroppedAndOfflineThenSaysSo() async {
        let cache = MemoryCache()
        cache.entries[ltoUrl] = Bytes(repeating: 0, count: 100)
        let fetch = await source(cache, AgpsStore(defaults: ephemeralDefaults()), online: false).fetch(.default, force: false)
        XCTAssertFalse(fetch.ok)
        XCTAssertEqual(fetch.outcome, AgpsOutcome.noNetwork)
        XCTAssertTrue(cache.entries.isEmpty, "the bad copy is gone")
    }

    func testForceSkipsTheCacheAndOfflineReportsNoNetwork() async {
        let cache = MemoryCache()
        cache.entries[ltoUrl] = lto()
        let fetch = await source(cache, AgpsStore(defaults: ephemeralDefaults()), online: false).fetch(.default, force: true)
        XCTAssertEqual(fetch.outcome, AgpsOutcome.noNetwork)
    }

    func testADownloadedGoodFileIsServedWithItsLastModifiedAndCached() async {
        let cache = MemoryCache()
        let file = lto()
        let fetch = await source(cache, AgpsStore(defaults: ephemeralDefaults()), get: { url, max in
            XCTAssertEqual(url, "https://gllto.glpals.com/7day/v6/latest/lto.dat")
            XCTAssertEqual(max, AgpsPolicy.ltoMaxBytes)
            return AgpsDownload(body: file, lastModifiedMs: 44_000)
        }).fetch(.default, force: false)
        XCTAssertTrue(fetch.ok)
        XCTAssertFalse(fetch.fromCache)
        XCTAssertEqual(fetch.dataTimeMs, 44_000)
        XCTAssertEqual(fetch.files[0].data, file)
        XCTAssertEqual(cache.entries[ltoUrl], file)
    }

    func testADownloadWithoutLastModifiedIsDatedByTheDownloadTime() async {
        let file = lto()
        let fetch = await source(MemoryCache(), AgpsStore(defaults: ephemeralDefaults()), get: { _, _ in
            AgpsDownload(body: file, lastModifiedMs: 0)
        }).fetch(.default, force: false)
        XCTAssertEqual(fetch.dataTimeMs, 50_000)
    }

    func testADownloadThatIsNotAnLtoFileIsInvalidAndNeverCached() async {
        let cache = MemoryCache()
        let page = Array("<html>".utf8) + Bytes(repeating: 0, count: 40_000)
        let fetch = await source(cache, AgpsStore(defaults: ephemeralDefaults()), get: { _, _ in AgpsDownload(body: page, lastModifiedMs: 1) })
            .fetch(.default, force: false)
        XCTAssertFalse(fetch.ok)
        XCTAssertEqual(fetch.outcome, AgpsOutcome.invalidFile)
        XCTAssertTrue(cache.entries.isEmpty)
    }

    func testAFailedDownloadIsADownloadFailureWithTheReason() async {
        let fetch = await source(MemoryCache(), AgpsStore(defaults: ephemeralDefaults()), get: { _, _ in throw AgpsFetchError("HTTP 503") })
            .fetch(.default, force: false)
        XCTAssertEqual(fetch.outcome, AgpsOutcome.downloadFailed)
        XCTAssertEqual(fetch.message, "LTO: HTTP 503")
    }

    func testVersionsOneToThreeAreDeclinedAsUnsupportedWithoutTouchingTheNetworkOrTheCache() async {
        let cache = MemoryCache()
        cache.entries[ltoUrl] = lto()
        let store = AgpsStore(defaults: ephemeralDefaults())
        for version in 1...3 {
            let consult = AgpsConsult(version: version, tag: "p/q/HW_AGNSS;x/HW_PGNSS_PRED", urls: [])
            let fetch = await source(cache, store).fetch(consult, force: false)
            XCTAssertFalse(fetch.ok, "the Broadcom file is never offered to a watch that asked for another kind")
            XCTAssertEqual(fetch.outcome, AgpsOutcome.unsupported)
            XCTAssertTrue(fetch.message.contains("HW_AGNSS,HW_PGNSS_PRED"))
            XCTAssertFalse(fetch.message.contains("p/q"), "paths are not echoed")
        }
        XCTAssertNotNil(cache.entries[ltoUrl], "the phone's copy is left alone")
    }

    func testUnknownVersionsAreUnsupported() async {
        let fetch = await source(MemoryCache(), AgpsStore(defaults: ephemeralDefaults())).fetch(AgpsConsult(version: 9, tag: "", urls: []), force: false)
        XCTAssertEqual(fetch.outcome, AgpsOutcome.unsupported)
    }

    // MARK: HTTP helpers

    func testHttpDatesAreReadAsUnixMilliseconds() {
        XCTAssertEqual(EphemerisNet.parseHttpDate("Sun, 06 Nov 1994 08:49:37 GMT"), 784_111_777_000)
        XCTAssertNil(EphemerisNet.parseHttpDate(nil))
        XCTAssertNil(EphemerisNet.parseHttpDate("yesterday"))
    }

    func testTheCacheKeepsAFileUntilItIsTooOld() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("agps-cache-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = EphemerisCache(directory: directory)
        XCTAssertNil(cache.read("https://x.test/a", maxAgeMs: 60_000))
        cache.write("https://x.test/a", data: [1, 2, 3])
        XCTAssertEqual(cache.read("https://x.test/a", maxAgeMs: 60_000), [1, 2, 3])
        XCTAssertNil(cache.read("https://x.test/a", maxAgeMs: -1), "older than the allowed age")
        XCTAssertNil(cache.read("https://x.test/b", maxAgeMs: 60_000))
        cache.delete("https://x.test/a")
        XCTAssertNil(cache.read("https://x.test/a", maxAgeMs: 60_000))
    }

    func testTheNetworkRefusesAnythingButHttps() async {
        do {
            _ = try await EphemerisNet.get("http://gllto.glpals.com/7day/v6/latest/lto.dat", maxBytes: 1000)
            XCTFail("a plain http request must be refused")
        } catch let error as AgpsFetchError {
            XCTAssertTrue(error.message.contains("non-https"))
        } catch {
            XCTFail("unexpected error \(error)")
        }
    }

    // MARK: the experimental HW_AGNSS path (port of the Kotlin AgpsTest cases)

    func testCrc24qMatchesThePublishedCheckValue() {
        XCTAssertEqual(AgpsPolicy.crc24q(Array("123456789".utf8)), 0xCDE703)
    }

    func testAFullRtcmFilePassesAndBrokenOnesAreRefusedWithTheServersWords() {
        XCTAssertNil(AgpsPolicy.validateRtcm(rtcmFile(24)))
        XCTAssertEqual(AgpsPolicy.rtcmFrames(rtcmFile(24)), 24)
        XCTAssertEqual(AgpsPolicy.validateRtcm(rtcmFile(19)), "only 19 satellites (at least 20 needed)")
        XCTAssertEqual(AgpsPolicy.validateRtcm(Bytes(repeating: 0, count: 100)), "file too small (100 bytes)")
        XCTAssertEqual(AgpsPolicy.validateRtcm(Bytes(repeating: 0, count: 16 * 1024 + 1)), "file too large (16385 bytes)")
        var flipped = rtcmFile(24)
        flipped[10] ^= 1
        XCTAssertEqual(AgpsPolicy.validateRtcm(flipped), "RTCM frame at byte 0 fails its CRC")
        XCTAssertEqual(AgpsPolicy.validateRtcm(Bytes(rtcmFile(24).dropLast())), "RTCM frame at byte \(23 * 67) is cut off")
        XCTAssertEqual(AgpsPolicy.validateRtcm(rtcmFile(24) + [0]), "not an RTCM 3 frame at byte \(24 * 67)")
        XCTAssertEqual(AgpsPolicy.validateRtcm(rtcmFile(24, type: 1005)), "unexpected RTCM message 1005 at byte 0")
    }

    func testTheHwAgnssFileMustBeFreshFromTheServer() {
        let hour = 3_600_000
        let now = 10 * hour
        XCTAssertNil(AgpsPolicy.validateAgnss(rtcmFile(24), builtMs: now - hour, nowMs: now))
        XCTAssertEqual(AgpsPolicy.validateAgnss(rtcmFile(24), builtMs: now - 2 * hour - 60_000, nowMs: now), "the file was built 121 minutes ago")
        XCTAssertEqual(AgpsPolicy.validateAgnss(rtcmFile(24), builtMs: 0, nowMs: now), "the server did not say when the file was built")
        XCTAssertEqual(AgpsPolicy.validateAgnss(rtcmFile(10), builtMs: now, nowMs: now), "only 10 satellites (at least 20 needed)")
        XCTAssertEqual(AgpsPolicy.expiresAtMs(dataTimeMs: now, source: AgpsLab.source), now + 4 * hour, "expires four hours after it was built")
        XCTAssertEqual(AgpsPolicy.expiresAtMs(dataTimeMs: now, source: AgpsSources.broadcom), now + 7 * 24 * hour)
    }

    /// The HW_AGNSS switch alone serves exactly the HW_AGNSS kind for `consult`.
    private func asksHwAgnss(_ consult: AgpsConsult) -> Bool { AgpsLab.servedKinds(consult, agnssOn: true, pgnssOn: false) == [AgpsLab.kind] }

    func testOnlyAConsultForExactlyOneHwAgnssKindQualifies() {
        XCTAssertTrue(asksHwAgnss(AgpsConsult(version: 3, tag: "higeo/v1/gnssinfo?type=0x0024/HW_AGNSS", urls: [])))
        XCTAssertTrue(asksHwAgnss(AgpsConsult(version: 3, tag: " higeo/v1/gnssinfo?type=0x0004/HW_AGNSS; ", urls: [])))
        XCTAssertFalse(asksHwAgnss(AgpsConsult(version: 0, tag: "higeo/v1/gnssinfo?type=0x0024/HW_AGNSS", urls: [])))
        XCTAssertFalse(asksHwAgnss(AgpsConsult(version: 4, tag: "higeo/v1/gnssinfo?type=0x0024/HW_AGNSS", urls: [])))
        XCTAssertFalse(asksHwAgnss(AgpsConsult(version: 3, tag: "a/HW_AGNSS;b/HW_PGNSS_GPS", urls: [])))
        XCTAssertFalse(asksHwAgnss(AgpsConsult(version: 3, tag: "com.huawei.higeo_dataModule_PGNSSConfig?type=HW_EEV2/HW_PGNSS_PRED;", urls: [])))
        XCTAssertFalse(asksHwAgnss(AgpsConsult(version: 3, tag: "x/HW_AGNSS_RTCM_33", urls: [])))
        XCTAssertTrue(AgpsLab.askedHwAgnss(version: 3, tagNames: "HW_AGNSS"))
        XCTAssertFalse(AgpsLab.askedHwAgnss(version: 3, tagNames: "HW_AGNSS,HW_PGNSS_GPS"))
    }

    func testTheRetryScheduleCoversBroadcomAndHwAgnssWithTheSwitchOnOnly() {
        let agnss = AgpsConsult(version: 3, tag: "higeo/v1/gnssinfo?type=0x0024/HW_AGNSS", urls: [])
        XCTAssertTrue(AgpsLab.downloads(.default, agnssOn: false, pgnssOn: false))
        XCTAssertTrue(AgpsLab.downloads(agnss, agnssOn: true, pgnssOn: false))
        XCTAssertFalse(AgpsLab.downloads(agnss, agnssOn: false, pgnssOn: true), "switch off: declined, the retry wait does not apply")
        XCTAssertFalse(AgpsLab.downloads(AgpsConsult(version: 3, tag: "x/HW_PGNSS_PRED;", urls: []), agnssOn: true, pgnssOn: false))
    }

    func testTheSwitchIsOffByDefaultAndRemembered() {
        let defaults = ephemeralDefaults()
        XCTAssertFalse(AgpsStore(defaults: defaults).labAgnss)
        AgpsStore(defaults: defaults).setLabAgnss(true)
        XCTAssertTrue(AgpsStore(defaults: defaults).labAgnss)
    }

    private let agnss = AgpsConsult(version: 3, tag: "higeo/v1/gnssinfo?type=0x0024/HW_AGNSS", urls: [])

    private final class Calls: @unchecked Sendable {
        private let lock = NSLock()
        private var n = 0
        func add() { lock.locked { n += 1 } }
        var count: Int { lock.locked { n } }
    }

    private func labSource(
        _ cache: AgpsCache, _ store: AgpsStore, online: Bool = true, _ answer: @escaping @Sendable () throws -> AgpsDownload
    ) -> NetworkAgpsSource {
        NetworkAgpsSource(cache: cache, store: store, log: { _ in }, isOnline: { online }, nowMs: { 10_000_000 }, httpGet: { url, max in
            XCTAssertEqual(url, EphemerisNet.agnssUrl)
            XCTAssertEqual(max, AgpsPolicy.rtcmMaxBytes)
            return try answer()
        })
    }

    func testWithTheSwitchOffHwAgnssIsDeclinedWithoutTheNetwork() async {
        let fetch = await labSource(MemoryCache(), AgpsStore(defaults: ephemeralDefaults())) { throw AgpsFetchError("the network must not be used") }
            .fetch(agnss, force: false)
        XCTAssertEqual(fetch.outcome, AgpsOutcome.unsupported)
        XCTAssertEqual(fetch.message, "the watch asked for kinds only the watch maker's app prepares (version 3: HW_AGNSS)")
    }

    func testWithTheSwitchOnTheServersFileIsCheckedKeptAndReused() async {
        let cache = MemoryCache()
        let store = AgpsStore(defaults: ephemeralDefaults())
        store.setLabAgnss(true)
        let file = rtcmFile(24)
        let calls = Calls()
        let source = labSource(cache, store) {
            calls.add()
            return AgpsDownload(body: file, lastModifiedMs: 9_000_000)
        }
        let fetch = await source.fetch(agnss, force: false)
        XCTAssertTrue(fetch.ok)
        XCTAssertEqual(fetch.source, AgpsLab.source)
        XCTAssertEqual(fetch.dataTimeMs, 9_000_000)
        XCTAssertEqual(fetch.files.map(\.name), [AgpsLab.file])
        XCTAssertEqual(fetch.files.first?.data, file)
        XCTAssertEqual(cache.entries[EphemerisNet.agnssUrl], file)
        // The exchange records the download; the watch's next ask is answered from the phone's copy.
        store.recordDownloaded(nowMs: 9_500_000, dataMs: fetch.dataTimeMs, size: file.count, source: fetch.source)
        let again = await source.fetch(agnss, force: false)
        XCTAssertTrue(again.fromCache)
        XCTAssertEqual(again.dataTimeMs, 9_000_000)
        XCTAssertEqual(calls.count, 1)
        // A Broadcom copy's record does not vouch for the cached RTCM file: it is fetched again.
        store.recordDownloaded(nowMs: 9_600_000, dataMs: 9_600_000, size: 115_749, source: AgpsSources.broadcom)
        let third = await source.fetch(agnss, force: false)
        XCTAssertFalse(third.fromCache)
        XCTAssertEqual(calls.count, 2)
    }

    func testWithTheSwitchOnABrokenStaleOrMissingFileIsNotOffered() async {
        let store = AgpsStore(defaults: ephemeralDefaults())
        store.setLabAgnss(true)
        var bad = rtcmFile(24)
        bad[30] ^= 0xFF
        let broken = bad
        let cache = MemoryCache()
        let first = await labSource(cache, store) { AgpsDownload(body: broken, lastModifiedMs: 9_000_000) }.fetch(agnss, force: true)
        XCTAssertEqual(first.outcome, AgpsOutcome.invalidFile)
        XCTAssertEqual(first.message, "HW_AGNSS: RTCM frame at byte 0 fails its CRC")
        XCTAssertTrue(cache.entries.isEmpty, "a bad file is never kept")
        let fresh = rtcmFile(24)
        let stale = await labSource(cache, store) { AgpsDownload(body: fresh, lastModifiedMs: 1_000) }.fetch(agnss, force: true)
        XCTAssertEqual(stale.outcome, AgpsOutcome.invalidFile)
        let down = await labSource(cache, store) { throw AgpsFetchError("HTTP 503") }.fetch(agnss, force: true)
        XCTAssertEqual(down.outcome, AgpsOutcome.downloadFailed)
        XCTAssertEqual(down.message, "HW_AGNSS: HTTP 503")
        let offline = await labSource(cache, store, online: false) { throw AgpsFetchError("offline") }.fetch(agnss, force: true)
        XCTAssertEqual(offline.outcome, AgpsOutcome.noNetwork)
    }

    func testWithTheSwitchOnOtherKindsStayDeclined() async {
        let store = AgpsStore(defaults: ephemeralDefaults())
        store.setLabAgnss(true)
        let source = labSource(MemoryCache(), store) { throw AgpsFetchError("the network must not be used") }
        let two = await source.fetch(AgpsConsult(version: 3, tag: "a/HW_AGNSS;b/HW_PGNSS_GPS", urls: []), force: false)
        XCTAssertEqual(two.outcome, AgpsOutcome.unsupported)
        let pred = await source.fetch(AgpsConsult(version: 3, tag: "x/HW_PGNSS_PRED;", urls: []), force: false)
        XCTAssertEqual(pred.outcome, AgpsOutcome.unsupported)
    }

    // MARK: the experimental HW_PGNSS_PRED path, ports of the Kotlin cases

    private let pred = AgpsConsult(version: 3, tag: "com.huawei.higeo_dataModule_PGNSSConfig?type=HW_EEV2/HW_PGNSS_PRED;", urls: [])

    /// 2026-10-25 01:47 UTC (08:47 WIB, the Huawei Health capture), the build time of the test bundles.
    private let built = 1_792_892_820_000

    func testTheBundleLayoutHasTheExactSizesOfHuaweiHealthsFiles() {
        XCTAssertEqual(
            PgnssBundle.files.map(\.name),
            ["HW_PGNSS_GPS", "HW_PGNSS_BDS", "HW_PGNSS_GLONASS", "HW_PGNSS_GALILEO", "HW_PGNSS_QZS", "HW_PGNSS_EXTRA"]
        )
        XCTAssertEqual(PgnssBundle.files.map(\.size), [93_312, 209_808, 361_584, 99_648, 28_512, 6_248])
        XCTAssertEqual(PgnssBundle.bundleBytes, 799_230)
        XCTAssertEqual(PgnssBundle.gpsSeconds(unixMs: built), 1_792_892_820 - 315_964_782, "HH's gpsTime = unixSeconds - 315964782")
    }

    func testAGoodBundlePassesAndSplitsIntoTheSixFilesInPullOrder() {
        let files = pgnssFiles(builtMs: built)
        let bundle = pgnssBundle(files)
        XCTAssertEqual(bundle.count, PgnssBundle.bundleBytes)
        XCTAssertNil(PgnssBundle.validate(bundle, builtMs: built, nowMs: built + 60_000))
        XCTAssertNil(PgnssBundle.validate(bundle, builtMs: built, nowMs: built + 6 * 3_600_000), "six hours old is still good")
        let split = PgnssBundle.split(bundle)
        XCTAssertEqual(split.map(\.name), files.map(\.name))
        for (k, file) in files.enumerated() { XCTAssertEqual(split[k].data, file.data, file.name) }
    }

    func testABundleWithAWrongContainerIsRefused() {
        let files = pgnssFiles(builtMs: built)
        func check(_ bundle: Bytes) -> String? { PgnssBundle.validate(bundle, builtMs: built, nowMs: built) }
        XCTAssertEqual(check([1, 2, 3]), "not a PGNSS bundle (unexpected header)")
        var wrongMagic = pgnssBundle(files)
        wrongMagic[0] = UInt8(ascii: "X")
        XCTAssertEqual(check(wrongMagic), "not a PGNSS bundle (unexpected header)")
        XCTAssertEqual(check(pgnssBundle(files, version: 2)), "bundle version 2 is not known")
        XCTAssertEqual(check(pgnssBundle(files, count: 5)), "the bundle has 5 files (6 expected)")
        let swapped = [files[1], files[0]] + files[2...]
        XCTAssertEqual(check(pgnssBundle(swapped)), "file 1 is \"HW_PGNSS_BDS\" (HW_PGNSS_GPS expected)")
        let short = replacing(files, "HW_PGNSS_QZS") { Array($0[0..<28_511]) }
        XCTAssertEqual(check(pgnssBundle(short)), "HW_PGNSS_QZS is 28511 bytes (28512 expected)")
        XCTAssertEqual(check(pgnssBundle(files) + [0]), "1 bytes after the last file")
        XCTAssertEqual(check(Array(pgnssBundle(files).dropLast(10))), "the bundle is cut off in HW_PGNSS_EXTRA")
    }

    func testABundleWithABadHeaderOrTooManySatellitesIsRefused() {
        func withFile(_ name: String, _ change: (inout Bytes) -> Void) -> String? {
            let files = replacing(pgnssFiles(builtMs: built), name) { data in
                var copy = data
                change(&copy)
                return copy
            }
            return PgnssBundle.validate(pgnssBundle(files), builtMs: built, nowMs: built)
        }
        XCTAssertEqual(withFile("HW_PGNSS_GPS") { putU32(&$0, 12 * 3 + 4, 0) }, "HW_PGNSS_GPS header entry 3 points at 0 (8700 expected)")
        XCTAssertEqual(withFile("HW_PGNSS_BDS") { putU32(&$0, 8, 5801) }, "HW_PGNSS_BDS header entry 0 has size 5801 (5800 expected)")
        XCTAssertEqual(withFile("HW_PGNSS_GALILEO") { putU32(&$0, 12 * 5, 1) }, "HW_PGNSS_GALILEO slot 5 is not 7200 s after the one before")
        XCTAssertEqual(withFile("HW_PGNSS_QZS") { putU32(&$0, 12 * 36, 1) }, "HW_PGNSS_QZS header entry 36 is not empty")
        XCTAssertEqual(withFile("HW_PGNSS_GPS") { $0[1008] = 33 }, "HW_PGNSS_GPS block 0 lists 33 satellites (at most 32)")
        // GLONASS: 8 sub-blocks of 1252 bytes per header entry, each with its own count.
        XCTAssertEqual(withFile("HW_PGNSS_GLONASS") { $0[1008 + 9 * 1252] = 25 }, "HW_PGNSS_GLONASS block 9 lists 25 satellites (at most 24)")
        XCTAssertEqual(
            withFile("HW_PGNSS_GLONASS") { putU32(&$0, 12 + 4, 1008 + 1252) }, "HW_PGNSS_GLONASS header entry 1 points at 2260 (11024 expected)"
        )
        XCTAssertNil(withFile("HW_PGNSS_EXTRA") { $0 = Bytes(repeating: 0x7F, count: $0.count) }, "EXTRA has no header to check")
    }

    func testAStaleUndatedOrMistimedBundleIsRefused() {
        let bundle = pgnssBundle(pgnssFiles(builtMs: built))
        XCTAssertEqual(PgnssBundle.validate(bundle, builtMs: built, nowMs: built + 6 * 3_600_000 + 60_000), "the bundle was built 361 minutes ago")
        XCTAssertEqual(PgnssBundle.validate(bundle, builtMs: 0, nowMs: built), "the server did not say when the bundle was built")
        // Slots made for a build five hours earlier than the server says: the first slot is too far from the build time.
        let early = pgnssBundle(pgnssFiles(builtMs: built - 5 * 3_600_000))
        XCTAssertTrue(PgnssBundle.validate(early, builtMs: built, nowMs: built)?.hasPrefix("HW_PGNSS_GPS starts -") ?? false)
    }

    func testOnlyAPredConsultQualifiesAndOnlyWithItsOwnSwitch() {
        XCTAssertEqual(AgpsLab.servedKinds(pred, agnssOn: false, pgnssOn: true), [AgpsPgnss.kind])
        XCTAssertEqual(AgpsLab.servedKinds(pred, agnssOn: true, pgnssOn: false), [])
        XCTAssertEqual(AgpsLab.servedKinds(AgpsConsult(version: 0, tag: pred.tag, urls: []), agnssOn: true, pgnssOn: true), [])
        XCTAssertEqual(AgpsLab.servedKinds(AgpsConsult(version: 4, tag: pred.tag, urls: []), agnssOn: true, pgnssOn: true), [])
        let seven = AgpsConsult(version: 3, tag: "com.huawei.higeo_dataModule_PGNSSConfig?type=HW_EEV2_SEVEN/HW_PGNSS_PRED;", urls: [])
        XCTAssertEqual(AgpsLab.servedKinds(seven, agnssOn: true, pgnssOn: true), [], "the seven-day variant is gzipped and longer: not served")
        XCTAssertEqual(AgpsLab.servedKinds(AgpsConsult(version: 3, tag: "x/HW_PGNSS_PRED_X", urls: []), agnssOn: true, pgnssOn: true), [])
        XCTAssertEqual(AgpsLab.servedKinds(AgpsConsult(version: 3, tag: "x/HW_PGNSS_PRED;y/HW_PGNSS_GPS", urls: []), agnssOn: true, pgnssOn: true), [])
        XCTAssertEqual(AgpsLab.servedKinds(agnss, agnssOn: true, pgnssOn: true), [AgpsLab.kind])
        XCTAssertTrue(AgpsPgnss.askedPred(version: 3, tagNames: "HW_PGNSS_PRED"))
        XCTAssertFalse(AgpsPgnss.askedPred(version: 0, tagNames: "HW_PGNSS_PRED"))
        XCTAssertFalse(AgpsPgnss.askedPred(version: 3, tagNames: "HW_AGNSS,HW_PGNSS_PRED"))
        XCTAssertTrue(AgpsLab.downloads(pred, agnssOn: false, pgnssOn: true))
        XCTAssertFalse(AgpsLab.downloads(pred, agnssOn: true, pgnssOn: false))
    }

    func testAConsultNamingBothKindsServesWhatIsSwitchedOnAndOnlyWithThePredSwitch() {
        let both = AgpsConsult(version: 3, tag: "a/HW_AGNSS;\(pred.tag)", urls: [])
        XCTAssertEqual(AgpsLab.servedKinds(both, agnssOn: true, pgnssOn: true), [AgpsLab.kind, AgpsPgnss.kind])
        XCTAssertEqual(AgpsLab.servedKinds(both, agnssOn: false, pgnssOn: true), [AgpsPgnss.kind])
        XCTAssertEqual(AgpsLab.servedKinds(both, agnssOn: true, pgnssOn: false), [], "PRED switch off: declined as before")
    }

    func testThePgnssSwitchIsOffByDefaultSeparateAndRemembered() {
        let defaults = ephemeralDefaults()
        XCTAssertFalse(AgpsStore(defaults: defaults).labPgnss)
        AgpsStore(defaults: defaults).setLabAgnss(true)
        XCTAssertFalse(AgpsStore(defaults: defaults).labPgnss, "the HW_AGNSS switch does not turn it on")
        AgpsStore(defaults: defaults).setLabPgnss(true)
        XCTAssertTrue(AgpsStore(defaults: defaults).labPgnss)
        AgpsStore(defaults: defaults).recordPgnssBuilt(42)
        XCTAssertEqual(AgpsStore(defaults: defaults).pgnssBuiltMs, 42)
    }

    func testPgnssDataIsShownValidForTheThreeDaysItCovers() {
        XCTAssertEqual(AgpsPolicy.expiresAtMs(dataTimeMs: built, source: AgpsPgnss.source), built + 72 * 3_600_000)
    }

    private func pgnssSource(
        _ cache: AgpsCache, _ store: AgpsStore, now: Int? = nil, online: Bool = true, _ answer: @escaping @Sendable () throws -> AgpsDownload
    ) -> NetworkAgpsSource {
        let nowMs = now ?? built + 60_000
        return NetworkAgpsSource(cache: cache, store: store, log: { _ in }, isOnline: { online }, nowMs: { nowMs }, httpGet: { url, max in
            XCTAssertEqual(url, EphemerisNet.pgnssUrl)
            XCTAssertEqual(max, PgnssBundle.bundleBytes)
            return try answer()
        })
    }

    func testWithThePgnssSwitchOffPredIsDeclinedWithoutTheNetworkAsToday() async {
        let store = AgpsStore(defaults: ephemeralDefaults())
        store.setLabAgnss(true)
        let fetch = await pgnssSource(MemoryCache(), store) { throw AgpsFetchError("the network must not be used") }.fetch(pred, force: false)
        XCTAssertEqual(fetch.outcome, AgpsOutcome.unsupported)
        XCTAssertEqual(fetch.message, "the watch asked for kinds only the watch maker's app prepares (version 3: HW_PGNSS_PRED)")
    }

    func testWithThePgnssSwitchOnTheBundleIsCheckedSplitKeptAndReused() async {
        let cache = MemoryCache()
        let store = AgpsStore(defaults: ephemeralDefaults())
        store.setLabPgnss(true)
        let files = pgnssFiles(builtMs: built)
        let bundle = pgnssBundle(files)
        let calls = Calls()
        let builtMs = built
        let source = pgnssSource(cache, store) {
            calls.add()
            return AgpsDownload(body: bundle, lastModifiedMs: builtMs)
        }
        let fetch = await source.fetch(pred, force: false)
        XCTAssertTrue(fetch.ok, fetch.message)
        XCTAssertFalse(fetch.fromCache)
        XCTAssertEqual(fetch.source, AgpsPgnss.source)
        XCTAssertEqual(fetch.dataTimeMs, built)
        XCTAssertEqual(fetch.files.map(\.name), files.map(\.name))
        XCTAssertEqual(fetch.files[2].data, files[2].data)
        XCTAssertEqual(cache.entries[EphemerisNet.pgnssUrl], bundle)
        XCTAssertEqual(store.pgnssBuiltMs, built)
        // The watch's next ask is answered from the phone's copy, even after an HW_AGNSS download changed the general copy record.
        store.recordDownloaded(nowMs: built + 1_000, dataMs: built, size: 7_000, source: AgpsLab.source)
        let again = await source.fetch(pred, force: false)
        XCTAssertTrue(again.fromCache)
        XCTAssertEqual(again.dataTimeMs, built)
        XCTAssertEqual(calls.count, 1)
        // A forced update goes to the server.
        let forced = await source.fetch(pred, force: true)
        XCTAssertFalse(forced.fromCache)
        XCTAssertEqual(calls.count, 2)
    }

    func testWithThePgnssSwitchOnABrokenStaleOrMissingBundleIsNotOffered() async {
        let store = AgpsStore(defaults: ephemeralDefaults())
        store.setLabPgnss(true)
        let cache = MemoryCache()
        let files = pgnssFiles(builtMs: built)
        let builtMs = built
        let wrong = pgnssBundle(replacing(files, "HW_PGNSS_EXTRA") { _ in Bytes(repeating: 0, count: 6_000) })
        let broken = await pgnssSource(cache, store) { AgpsDownload(body: wrong, lastModifiedMs: builtMs) }.fetch(pred, force: true)
        XCTAssertEqual(broken.outcome, AgpsOutcome.invalidFile)
        XCTAssertEqual(broken.message, "HW_PGNSS_PRED: HW_PGNSS_EXTRA is 6000 bytes (6248 expected)")
        XCTAssertTrue(cache.entries.isEmpty, "a bad bundle is never kept")
        XCTAssertEqual(store.pgnssBuiltMs, 0)
        let good = pgnssBundle(files)
        let stale = await pgnssSource(cache, store, now: built + 7 * 3_600_000) { AgpsDownload(body: good, lastModifiedMs: builtMs) }
            .fetch(pred, force: true)
        XCTAssertEqual(stale.outcome, AgpsOutcome.invalidFile)
        XCTAssertEqual(stale.message, "HW_PGNSS_PRED: the bundle was built 420 minutes ago")
        // A phone copy that got too old is dropped and fetched again.
        cache.entries[EphemerisNet.pgnssUrl] = good
        store.recordPgnssBuilt(built)
        let down = await pgnssSource(cache, store, now: built + 7 * 3_600_000) { throw AgpsFetchError("HTTP 503") }.fetch(pred, force: false)
        XCTAssertEqual(down.outcome, AgpsOutcome.downloadFailed)
        XCTAssertEqual(down.message, "HW_PGNSS_PRED: HTTP 503")
        XCTAssertTrue(cache.entries.isEmpty)
        let offline = await pgnssSource(cache, store, online: false) { throw AgpsFetchError("offline") }.fetch(pred, force: true)
        XCTAssertEqual(offline.outcome, AgpsOutcome.noNetwork)
    }

    private final class Flag: @unchecked Sendable {
        private let lock = NSLock()
        private var value = true
        var on: Bool {
            get { lock.locked { value } }
            set { lock.locked { value = newValue } }
        }
    }

    func testAConsultNamingBothKindsWithBothSwitchesOnGetsTheSevenFilesOrNothing() async {
        let store = AgpsStore(defaults: ephemeralDefaults())
        store.setLabAgnss(true)
        store.setLabPgnss(true)
        let rtcm = rtcmFile(24)
        let bundle = pgnssBundle(pgnssFiles(builtMs: built))
        let builtMs = built
        let agnssUp = Flag()
        let source = NetworkAgpsSource(
            cache: MemoryCache(), store: store, log: { _ in }, isOnline: { true }, nowMs: { builtMs + 60_000 },
            httpGet: { url, _ in
                if url == EphemerisNet.agnssUrl {
                    if agnssUp.on { return AgpsDownload(body: rtcm, lastModifiedMs: builtMs) }
                    throw AgpsFetchError("HTTP 503")
                }
                return AgpsDownload(body: bundle, lastModifiedMs: builtMs)
            }
        )
        let both = AgpsConsult(version: 3, tag: "a/HW_AGNSS;\(pred.tag)", urls: [])
        let fetch = await source.fetch(both, force: true)
        XCTAssertEqual(fetch.files.map(\.name), [AgpsLab.file] + PgnssBundle.files.map(\.name))
        XCTAssertEqual(fetch.source, AgpsPgnss.source)
        agnssUp.on = false
        let half = await source.fetch(both, force: true)
        XCTAssertFalse(half.ok, "every kind offered or none")
        XCTAssertEqual(half.message, "HW_AGNSS: HTTP 503")
    }
}

/// An HW_AGNSS-shaped file for the tests: `satellites` frames of 61-byte messages of `type` (1019, GPS, by default), each `D3`, length, message
/// and CRC-24Q, so 67 bytes per frame. The message bodies are filler; only the framing is real.
func rtcmFile(_ satellites: Int, type: Int = 1019) -> Bytes {
    var out = Bytes()
    for k in 0..<satellites {
        var message = Bytes((0..<61).map { UInt8(truncatingIfNeeded: $0 &* 7 &+ k) })
        message[0] = UInt8(type >> 4)
        message[1] = UInt8(((type & 0xF) << 4) | (Int(message[1]) & 0x0F))
        let head: Bytes = [0xD3, 0, UInt8(message.count)] + message
        let crc = AgpsPolicy.crc24q(head)
        out += head + [UInt8(truncatingIfNeeded: crc >> 16), UInt8(truncatingIfNeeded: crc >> 8), UInt8(truncatingIfNeeded: crc)]
    }
    return out
}

func putU32(_ data: inout Bytes, _ at: Int, _ value: Int) {
    for k in 0..<4 { data[at + k] = UInt8(truncatingIfNeeded: value >> (8 * k)) }
}

/// The six PGNSS files for the tests, at their exact sizes: each ephemeris file with the header of a server build at `builtMs` (36 slots 7200 s apart
/// from the next two-hour boundary, BeiDou +14 s, GLONASS +18 + 3600 s; packed offsets; the other 48 entries zero) and every (sub-)block listing its
/// full capacity of satellites; the record bytes are filler.
func pgnssFiles(builtMs: Int) -> [(name: String, data: Bytes)] {
    let base = PgnssBundle.gpsSeconds(unixMs: builtMs) / 7200 * 7200
    var out: [(name: String, data: Bytes)] = []
    for spec in PgnssBundle.files {
        let salt = spec.name.utf8.count
        var file = Bytes((0..<spec.size).map { UInt8(truncatingIfNeeded: $0 &* 7 &+ salt) })
        if spec.blockBytes > 0 {
            for i in 0..<PgnssBundle.headerBytes { file[i] = 0 }
            let first: Int
            switch spec.name {
            case "HW_PGNSS_BDS": first = base + 7214
            case "HW_PGNSS_GLONASS": first = base + 18 + 3600
            default: first = base + 7200
            }
            for i in 0..<PgnssBundle.slots {
                putU32(&file, 12 * i, first + 7200 * i)
                putU32(&file, 12 * i + 4, PgnssBundle.headerBytes + i * spec.blockBytes)
                putU32(&file, 12 * i + 8, spec.blockBytes)
            }
            var block = PgnssBundle.headerBytes
            while block < spec.size {
                file[block] = UInt8(spec.capacity)
                block += spec.subBlockBytes
            }
        }
        out.append((spec.name, file))
    }
    return out
}

/// `files` with the one named `name` changed by `change`.
func replacing(_ files: [(name: String, data: Bytes)], _ name: String, _ change: (Bytes) -> Bytes) -> [(name: String, data: Bytes)] {
    files.map { $0.name == name ? ($0.name, change($0.data)) : $0 }
}

/// `files` as the server's bundle: `JFPG`, `version`, `count` (the number of files by default), then name, u32 LE size and bytes per file.
func pgnssBundle(_ files: [(name: String, data: Bytes)], version: Int = 1, count: Int? = nil) -> Bytes {
    var out = Array("JFPG".utf8)
    out.append(UInt8(version))
    out.append(UInt8(count ?? files.count))
    for file in files {
        out.append(UInt8(file.name.utf8.count))
        out += Array(file.name.utf8)
        for k in 0..<4 { out.append(UInt8(truncatingIfNeeded: file.data.count >> (8 * k))) }
        out += file.data
    }
    return out
}

/// A source that answers from a list: files, or the failure `outcome`; `gate` holds the answer back until it is opened (or 5 s pass).
final class FakeAgpsSource: AgpsSource, @unchecked Sendable {
    private let lock = NSLock()
    private let files: [(name: String, data: Bytes)]
    private let outcome: String
    private let gate: AgpsLatch<Bool>?
    private var _calls = 0
    private var _forces: [Bool] = []

    init(files: [(name: String, data: Bytes)], outcome: String = AgpsOutcome.none, gate: AgpsLatch<Bool>? = nil) {
        self.files = files
        self.outcome = outcome
        self.gate = gate
    }

    var calls: Int { lock.locked { _calls } }
    var forces: [Bool] { lock.locked { _forces } }

    func fetch(_ consult: AgpsConsult, force: Bool) async -> AgpsFetch {
        lock.locked {
            _calls += 1
            _forces.append(force)
        }
        if let gate { _ = await gate.wait(timeoutMs: 5_000) }
        if !files.isEmpty {
            return AgpsFetch(files: files, source: AgpsSources.broadcom, dataTimeMs: 1_000, outcome: AgpsOutcome.none, message: "")
        }
        return .failed(outcome, "fake \(outcome)")
    }
}
