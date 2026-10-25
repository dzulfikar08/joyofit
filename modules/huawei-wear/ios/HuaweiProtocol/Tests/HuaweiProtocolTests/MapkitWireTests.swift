import XCTest
@testable import HuaweiProtocol

/// The mapkit P2P frames against `Fixtures/mapkit.json`, built by hand from the documented layouts (docs/offline-maps.md); MapkitWireTest.kt
/// reads the same file, so both ports send and read the same bytes and log the same lines.
final class MapkitWireTests: XCTestCase {
    private struct BadFixture: Error {}

    private static func fixture() throws -> [String: Any] {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures/mapkit.json")
        guard let root = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any] else { throw BadFixture() }
        return root
    }

    private func hex(_ s: String) -> Bytes { Bytes(hex: s)! }

    private func optInt(_ d: [String: Any], _ key: String) -> Int? { (d[key] as? NSNumber)?.intValue }

    private func optLong(_ d: [String: Any], _ key: String) -> Int64? { (d[key] as? NSNumber)?.int64Value }

    func testBuildersMatchTheDocumentedLayouts() throws {
        let cases = try Self.fixture().list("builders")
        XCTAssertEqual(cases.count, 10)
        for c in cases {
            let actual: Bytes
            switch c.str("name") {
            case "freeSpaceQuery": actual = MapkitWire.freeSpaceQuery()
            case "politicalView": actual = MapkitWire.politicalView(c.str("view"), msgId: c.int("msgId"))
            case "listQuery": actual = MapkitWire.listQuery(msgId: c.int("msgId"))
            case "handshake":
                actual = try MapkitWire.handshake(sizeMb: c.int("sizeMb"), mapType: c.int("mapType"), update: c.bool("update"), msgId: c.int("msgId"))
            case "delete":
                let maps = (c["maps"] as? [[Any]]) ?? []
                actual = try MapkitWire.delete(maps.map { (id: UInt64($0[0] as! String)!, type: ($0[1] as! NSNumber).intValue) }, msgId: c.int("msgId"))
            case "sizeAnswer": actual = MapkitWire.sizeAnswer(sizeMb: c.int("sizeMb"))
            case "noNetwork": actual = MapkitWire.noNetwork(msgId: c.int("msgId"))
            default: XCTFail("unknown builder \(c.str("name"))"); continue
            }
            XCTAssertEqual(actual.hexUpper, c.str("hex"), "\(c)")
        }
    }

    private func assertMaps(_ expected: [[String: Any]], _ actual: [MapkitMap]) {
        XCTAssertEqual(expected.count, actual.count)
        for (e, map) in zip(expected, actual) {
            XCTAssertEqual(e.str("id"), String(map.id))
            XCTAssertEqual(e.int("type"), map.type)
            if e.keys.contains("version") { XCTAssertEqual(optLong(e, "version"), map.version) }
            if e.keys.contains("downloadType") { XCTAssertEqual(optInt(e, "downloadType"), map.downloadType) }
            if e.keys.contains("result") { XCTAssertEqual(optInt(e, "result"), map.result) }
        }
    }

    func testWatchFramesParse() throws {
        for c in try Self.fixture().list("parses") {
            let message = MapkitWire.parse(hex(c.str("hex")))
            guard let e = c["expect"] as? [String: Any] else {
                XCTAssertNil(message, "\(c)")
                continue
            }
            switch e.str("kind") {
            case "freeSpace": XCTAssertEqual(message, .freeSpace(value: optLong(e, "value")))
            case "politicalView": XCTAssertEqual(message, .politicalView(result: e.str("result"), msgId: optLong(e, "msgId")))
            case "handshake": XCTAssertEqual(message, .handshake(code: e.int("code"), msgId: optLong(e, "msgId")))
            case "parsed": XCTAssertEqual(message, .parsed(MapkitParsed(mapId: UInt64(e.str("mapId")), mapType: e.int("mapType"), code: e.int("code"))))
            case "watchAsk": XCTAssertEqual(message, .watchAsk(type: e.int("type")))
            case "other": XCTAssertEqual(message, .other(type: e.int("type")))
            case "mapList":
                guard case let .mapList(frames, index, total, msgId, maps)? = message else { XCTFail("\(c)"); continue }
                XCTAssertEqual(frames, e.int("frames"))
                XCTAssertEqual(index, e.int("index"))
                XCTAssertEqual(total, e.int("total"))
                XCTAssertEqual(msgId, optLong(e, "msgId"))
                assertMaps(e.list("maps"), maps)
            case "delete":
                guard case let .delete(frames, _, total, msgId, maps)? = message else { XCTFail("\(c)"); continue }
                XCTAssertEqual(frames, e.int("frames"))
                XCTAssertEqual(total, e.int("total"))
                XCTAssertEqual(msgId, optLong(e, "msgId"))
                assertMaps(e.list("maps"), maps)
            default: XCTFail("unknown kind \(e.str("kind"))")
            }
        }
    }

    func testEveryFrameHasTheSameLogLineOnBothPlatforms() throws {
        for c in try Self.fixture().list("describes") {
            XCTAssertEqual(MapkitWire.describe(hex(c.str("hex"))), c.str("text"))
        }
    }

    func testTheMapIdAndTypeComeFromTheFileName() throws {
        for c in try Self.fixture().list("files") {
            let file = MapkitWire.fileOf(c.str("name"))
            if c["mapId"] is NSNull || c["mapId"] == nil {
                XCTAssertNil(file, "\(c)")
            } else {
                XCTAssertEqual(file.map { String($0.mapId) }, c.str("mapId"), "\(c)")
                XCTAssertEqual(file?.mapType, c.int("mapType"), "\(c)")
            }
        }
    }

    func testTheHandshakeSizeIsWholeMegabytesRoundedUp() throws {
        for pair in (try Self.fixture()["sizeMb"] as? [[NSNumber]]) ?? [] {
            XCTAssertEqual(MapkitWire.sizeMb(pair[0].int64Value), pair[1].intValue)
        }
        XCTAssertEqual(MapkitWire.parseBudgetMs(4), 50_000)
    }

    func testTheOffvmpHeaderIsRead() throws {
        let root = try Self.fixture()
        let h = root["header"] as! [String: Any]
        let header = try XCTUnwrap(MapkitWire.header(hex(h.str("hex"))))
        XCTAssertEqual(header.version, optLong(h, "version"))
        XCTAssertEqual(header.indexOffset, optLong(h, "indexOffset"))
        XCTAssertEqual(header.region, h.str("region"))
        XCTAssertEqual(header.zooms, (h["zooms"] as? [NSNumber])?.map(\.intValue))
        XCTAssertNil(MapkitWire.header(hex(root.str("badHeaderHex"))))
        XCTAssertNil(MapkitWire.header(Bytes(repeating: 0, count: 16)))
    }

    func testADeleteFrameTakesOneToFortyMaps() {
        XCTAssertThrowsError(try MapkitWire.delete([], msgId: 1))
        XCTAssertThrowsError(try MapkitWire.delete((0..<41).map { (id: UInt64($0), type: 0) }, msgId: 1))
    }
}
