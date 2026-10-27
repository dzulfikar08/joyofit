import XCTest
@testable import HuaweiWearLogic

/// The songs-on-the-watch lab's gates (WatchMusicController.swift): the switch and its key, the 25/04 gate, the argument checks and the status
/// shape. The watch traffic is covered by WatchMusicTests in the HuaweiProtocol package.
final class WatchMusicControllerTests: XCTestCase {
    private func controller(
        enabled: Bool = false, connected: Bool = true, commands: [Int: Bytes] = [0x25: [0x04, 0x0D]], expandBits: [Int] = [122]
    ) -> WatchMusicController {
        let settings = WatchExtrasSettings(defaults: ephemeralDefaults())
        settings.watchMusicLab = enabled
        let events = RecordingEvents()
        let link = FakeLink(events: events, commands: commands, expandBits: expandBits)
        link.setConnected(connected)
        return WatchMusicController(settings: settings, link: link, events: events)
    }

    private func code(_ body: () async throws -> Any) async -> ErrorCode? {
        do {
            _ = try await body()
            return nil
        } catch let e as WearError { return e.code } catch { return nil }
    }

    func testTheSwitchIsOffByDefaultAndPersists() {
        let defaults = ephemeralDefaults()
        XCTAssertFalse(WatchExtrasSettings(defaults: defaults).watchMusicLab)
        WatchExtrasSettings(defaults: defaults).watchMusicLab = true
        XCTAssertTrue(WatchExtrasSettings(defaults: defaults).watchMusicLab)
        XCTAssertTrue(defaults.bool(forKey: "extras_watch_music_lab"))
    }

    func testEveryWatchCallRefusesWhileTheSwitchIsOff() async {
        let music = controller()
        var r = await code { try await music.info() }
        XCTAssertEqual(r, .unsupported)
        r = await code { try await music.list() }
        XCTAssertEqual(r, .unsupported)
        r = await code { try await music.upload(uri: "file:///tmp/x.mp3", name: "x.mp3") }
        XCTAssertEqual(r, .unsupported)
        r = await code { try await music.delete(ids: [1]) }
        XCTAssertEqual(r, .unsupported)
        XCTAssertFalse(music.cancel(), "nothing runs")
    }

    func testTheStatusHasTheTypeScriptFieldsAndTheWatchGates() {
        let status = controller(enabled: true).status()
        XCTAssertEqual(Set(status.keys), ["enabled", "connected", "uploadSupported", "extendedInfo", "moreMusic", "uploading"])
        XCTAssertEqual(status["enabled"] as? Bool, true)
        XCTAssertEqual(status["connected"] as? Bool, true)
        XCTAssertEqual(status["uploadSupported"] as? Bool, true)
        XCTAssertEqual(status["extendedInfo"] as? Bool, true)
        XCTAssertEqual(status["moreMusic"] as? Bool, true)
        XCTAssertEqual(status["uploading"] as? Bool, false)

        let offline = controller(enabled: true, connected: false).status()
        XCTAssertEqual(offline["connected"] as? Bool, false)
        XCTAssertEqual(offline["uploadSupported"] as? Bool, false, "false while not connected")
        let basic = controller(commands: [0x25: [0x04]], expandBits: []).status()
        XCTAssertEqual(basic["uploadSupported"] as? Bool, true)
        XCTAssertEqual(basic["extendedInfo"] as? Bool, false)
        XCTAssertEqual(basic["moreMusic"] as? Bool, false)
    }

    func testAWatchWithoutMusicStorageOrNoWatchIsRefused() async {
        var r = await code { try await self.controller(enabled: true, commands: [0x25: [0x01, 0x02, 0x03]]).info() }
        XCTAssertEqual(r, .unsupported)
        r = await code { try await self.controller(enabled: true, connected: false).list() }
        XCTAssertEqual(r, .notConnected)
    }

    func testDeleteChecksItsArgumentsFirst() async {
        let music = controller()
        var r = await code { try await music.delete(ids: []) }
        XCTAssertEqual(r, .invalidArgument)
        r = await code { try await music.delete(ids: [7, 70_000]) }
        XCTAssertEqual(r, .invalidArgument)
        r = await code { try await music.delete(ids: [-1]) }
        XCTAssertEqual(r, .invalidArgument)
    }

    func testUploadRefusesAFileThatIsNotMp3M4aOrAacBeforeReadingIt() async {
        let music = controller(enabled: true)
        let r = await code { try await music.upload(uri: "file:///nonexistent/song.flac", name: "song.flac") }
        XCTAssertEqual(r, .invalidArgument)
        let unreadable = await code { try await music.upload(uri: "file:///nonexistent/song.mp3", name: "song.mp3") }
        XCTAssertEqual(unreadable, .invalidArgument, "an unreadable file is an invalid argument, before any watch traffic")
    }
}
