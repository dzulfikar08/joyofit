import XCTest
@testable import HuaweiWearLogic

/// The watch-navigation controller's gates (WatchNav.swift): the switch, the settings key, sends without a session or a link.
final class WatchNavTests: XCTestCase {
    private func nav(enabled: Bool) -> (WatchNav, P2pSettings) {
        let settings = P2pSettings(defaults: ephemeralDefaults())
        settings.watchNavLab = enabled
        let events = RecordingEvents()
        let link = FakeLink(events: events, commands: [0x34: [0x01]])
        return (WatchNav(settings: settings, link: link, events: events, phonePackage: "com.joyodigitama.joyofit"), settings)
    }

    private let config = WatchNavConfig(phoneFingerprint: "PLACEHOLDER_PHONE", watchFingerprint: "PLACEHOLDER_WATCH")

    func testTheSwitchIsOffByDefaultAndPersists() {
        let defaults = ephemeralDefaults()
        XCTAssertFalse(P2pSettings(defaults: defaults).watchNavLab)
        P2pSettings(defaults: defaults).watchNavLab = true
        XCTAssertTrue(defaults.bool(forKey: "watch_nav_lab"))
    }

    func testStartRefusesWhileTheSwitchIsOff() {
        let (nav, _) = nav(enabled: false)
        XCTAssertThrowsError(try nav.start(config)) { XCTAssertEqual(($0 as? WearError)?.code, .unsupported) }
        XCTAssertEqual(try nav.send("{}"), false)
    }

    func testBlankFingerprintsAreRejected() {
        let (nav, _) = nav(enabled: true)
        XCTAssertThrowsError(try nav.start(WatchNavConfig(phoneFingerprint: " ", watchFingerprint: "x"))) {
            XCTAssertEqual(($0 as? WearError)?.code, .invalidArgument)
        }
    }

    func testNotConnectedSessionSendsNothingAndTheStatusHasTheContractKeys() throws {
        let (nav, _) = nav(enabled: true)
        let status = try nav.start(config)
        XCTAssertEqual(
            Set(status.keys),
            [
                "enabled", "active", "p2p", "registered", "phonePackage", "watchBundle", "placeholderFingerprints", "watchApp", "lastCode", "lastHeardAt",
                "sent", "acked", "received",
            ]
        )
        XCTAssertEqual(status["active"] as? Bool, true)
        XCTAssertEqual(status["p2p"] as? Bool, false)
        XCTAssertEqual(status["watchBundle"] as? String, "com.joyodigitama.navi")
        XCTAssertEqual(status["placeholderFingerprints"] as? Bool, true)
        XCTAssertEqual(status["watchApp"] as? String, "unknown")
        XCTAssertTrue(status["lastCode"] is NSNull)
        XCTAssertEqual(try nav.send(#"{"t":"step","n":1}"#), false)
        nav.setEnabled(false)
        XCTAssertEqual(nav.status()["active"] as? Bool, false)
    }
}
