import XCTest
@testable import HuaweiWearLogic

/// The offline-map lab's gates and file checks (OfflineMapLab.swift): the switch, the settings key, the picked file's name and header.
final class OfflineMapLabTests: XCTestCase {
    private func lab(enabled: Bool = false) -> (OfflineMapLab, P2pSettings) {
        let settings = P2pSettings(defaults: ephemeralDefaults())
        settings.offlineMapLab = enabled
        let events = RecordingEvents()
        let link = FakeLink(events: events, commands: [0x34: [0x01]], expandBits: [201])
        link.setConnected(true)
        return (OfflineMapLab(settings: settings, link: link, events: events), settings)
    }

    private func code(_ body: () async throws -> Any) async -> ErrorCode? {
        do {
            _ = try await body()
            return nil
        } catch let e as WearError { return e.code } catch { return nil }
    }

    private func temporaryFile(_ name: String, _ bytes: Bytes) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(name)
        try Data(bytes).write(to: url)
        return url
    }

    func testTheSwitchIsOffByDefaultAndPersists() {
        let defaults = ephemeralDefaults()
        XCTAssertFalse(P2pSettings(defaults: defaults).offlineMapLab)
        P2pSettings(defaults: defaults).offlineMapLab = true
        XCTAssertTrue(P2pSettings(defaults: defaults).offlineMapLab)
        XCTAssertTrue(defaults.bool(forKey: "offline_map_lab"))
    }

    func testThePetalMapsProbeSwitchIsOffByDefaultAndPersists() {
        let defaults = ephemeralDefaults()
        XCTAssertFalse(P2pSettings(defaults: defaults).petalMapsProbe)
        P2pSettings(defaults: defaults).petalMapsProbe = true
        XCTAssertTrue(P2pSettings(defaults: defaults).petalMapsProbe)
        XCTAssertTrue(defaults.bool(forKey: "petal_maps_probe"))
    }

    func testEveryWatchCallRefusesWhileTheSwitchIsOff() async {
        let (lab, _) = lab()
        var r = await code { try await lab.freeSpace() }
        XCTAssertEqual(r, .unsupported)
        r = await code { try await lab.list() }
        XCTAssertEqual(r, .unsupported)
        r = await code { try await lab.delete(mapId: "2000000000000003573", mapType: 0) }
        XCTAssertEqual(r, .unsupported)
        let status = lab.status()
        XCTAssertEqual(
            Set(status.keys),
            ["enabled", "p2p", "gateMap", "gateContour", "gateAutoDownload", "registered", "pingCode", "politicalView", "politicalViewResult", "lastParsed"]
        )
        XCTAssertEqual(status["enabled"] as? Bool, false)
        XCTAssertEqual(status["gateMap"] as? Bool, true)
        XCTAssertEqual(status["politicalView"] as? String, "ID")
        XCTAssertTrue(status["lastParsed"] is NSNull)
    }

    func testADeleteChecksItsArgumentsFirst() async {
        let (lab, _) = lab(enabled: true)
        var r = await code { try await lab.delete(mapId: "12a", mapType: 0) }
        XCTAssertEqual(r, .invalidArgument)
        r = await code { try await lab.delete(mapId: "1", mapType: 4) }
        XCTAssertEqual(r, .invalidArgument)
    }

    func testInspectRejectsAMisnamedFileAndANonOffvmpFile() async throws {
        let (lab, _) = lab()
        var map = Bytes(repeating: 0, count: MapkitWire.headerSize + 8)
        map.replaceSubrange(0..<6, with: Array("offvmp".utf8))
        let misnamed = try temporaryFile("malang.bin", map)
        var r = await code { try await lab.inspect(uri: misnamed.absoluteString, name: "malang.bin") }
        XCTAssertEqual(r, .invalidArgument)
        let notMap = try temporaryFile("2000000000000003573.bin", Bytes(repeating: 0x41, count: 4096))
        r = await code { try await lab.inspect(uri: notMap.absoluteString, name: "2000000000000003573.bin") }
        XCTAssertEqual(r, .invalidArgument)

        let good = try temporaryFile("446513991765216720_contour.bin", map)
        let info = try await lab.inspect(uri: good.absoluteString, name: good.lastPathComponent)
        XCTAssertEqual(info["mapId"] as? String, "446513991765216720")
        XCTAssertEqual(info["mapType"] as? Int, 1)
        XCTAssertEqual(info["bytes"] as? Int, map.count)
        XCTAssertEqual(info["sizeMb"] as? Int, 1)
        XCTAssertEqual(info["sha256"] as? String, SHA256.hash(map).hexUpper)
    }
}
