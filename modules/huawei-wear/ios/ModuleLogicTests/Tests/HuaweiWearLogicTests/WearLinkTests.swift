import XCTest
@testable import HuaweiWearLogic

/// A transport that never touches Bluetooth: `connect` fails or hangs as the test says.
final class FakeTransport: WatchTransport, @unchecked Sendable {
    enum Behavior { case failConnect(WearError), hangConnect, hangWait }
    private let lock = NSLock()
    private var _closed = 0
    private var _connects = 0
    private var _waits = 0
    private var wakeContinuations: [CheckedContinuation<Void, Error>] = []
    let behavior: Behavior
    let request: TransportRequest
    weak var delegate: WatchTransportDelegate?

    init(_ behavior: Behavior, request: TransportRequest, delegate: WatchTransportDelegate) {
        self.behavior = behavior
        self.request = request
        self.delegate = delegate
    }

    var peripheralName: String? { nil }
    var closeCount: Int { lock.locked { _closed } }
    var connectCount: Int { lock.locked { _connects } }
    var waitCount: Int { lock.locked { _waits } }

    func write(_ frames: [Bytes]) async throws {}

    func waitForWatch() async throws {
        lock.locked { _waits += 1 }
        if case .hangWait = behavior { try await hang() }
    }

    func connect(timeoutMs: Int) async throws {
        lock.locked { _connects += 1 }
        switch behavior {
        case .failConnect(let error): throw error
        case .hangConnect, .hangWait: try await hang()
        }
    }

    private func hang() async throws {
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            lock.locked { wakeContinuations.append(c) }
        }
    }

    func close() {
        let pending: [CheckedContinuation<Void, Error>] = lock.locked {
            _closed += 1
            let p = wakeContinuations
            wakeContinuations = []
            return p
        }
        for c in pending { c.resume(throwing: WearError(.disconnected, "Bluetooth LE link closed")) }
    }
}

struct FailingGate: BluetoothGate {
    let error: WearError
    func requireReady() async throws { throw error }
}

final class TransportLog: @unchecked Sendable {
    private let lock = NSLock()
    private(set) var made: [FakeTransport] = []
    func add(_ t: FakeTransport) { lock.locked { made.append(t) } }
    var last: FakeTransport? { lock.locked { made.last } }
    var count: Int { lock.locked { made.count } }
}

final class WearLinkTests: XCTestCase {
    private let watch = "6B1C2A55-3E21-4A7B-9D6E-5F1A0C0C9B77"
    private var events: RecordingEvents!
    private var settings: WearSettings!
    private var transports: TransportLog!

    override func setUp() {
        events = RecordingEvents()
        settings = WearSettings(defaults: ephemeralDefaults())
        transports = TransportLog()
    }

    private func makeLink(_ behavior: FakeTransport.Behavior, gate: BluetoothGate = AlwaysReadyGate()) -> WearLink {
        let log = transports!
        return WearLink(
            events: events, settings: settings, syncStore: SyncStore(url: temporaryDatabaseURL()), deviceStore: DeviceStore(secrets: MemorySecretStore()),
            gate: gate, phoneModel: "iPhone15,2",
            transportFactory: { request, delegate in
                let t = FakeTransport(behavior, request: request, delegate: delegate)
                log.add(t)
                return t
            }
        )
    }

    func testAnInvalidAddressIsRejectedBeforeAnythingElse() async {
        let link = makeLink(.hangConnect)
        do {
            _ = try await link.connect("00:11:22:33:44:55")
            XCTFail("expected ERR_INVALID_ADDRESS")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .invalidAddress)
        } catch { XCTFail("\(error)") }
        XCTAssertEqual(transports.count, 0)
    }

    func testBluetoothErrorsComeFromTheGate() async {
        for code in [ErrorCode.bluetoothOff, .bluetoothPermission, .bluetoothUnavailable] {
            let link = makeLink(.hangConnect, gate: FailingGate(error: WearError(code, "radio")))
            do {
                _ = try await link.connect(watch)
                XCTFail("expected \(code)")
            } catch let e as WearError {
                XCTAssertEqual(e.code, code)
            } catch { XCTFail("\(error)") }
            XCTAssertEqual(link.currentState(), .disconnected)
        }
        XCTAssertEqual(transports.count, 0)
    }

    func testAnUnsupportedRememberedNameIsRefusedWithItsReason() async {
        settings.watchAddress = watch
        settings.watchName = "HUAWEI FreeBuds 5-AB"
        let link = makeLink(.hangConnect)
        do {
            _ = try await link.connect(watch.lowercased())
            XCTFail("expected ERR_UNSUPPORTED")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .unsupported)
            XCTAssertEqual(e.message, "HUAWEI FreeBuds 5-AB: Earphones, not a watch")
        } catch { XCTFail("\(error)") }
        XCTAssertEqual(transports.count, 0)
    }

    func testATransportFailureTearsDownAndReportsDisconnectedWithTheError() async {
        let link = makeLink(.failConnect(WearError(.connectFailed, "The watch was not found")))
        do {
            _ = try await link.connect(watch)
            XCTFail("expected ERR_CONNECT_FAILED")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .connectFailed)
            XCTAssertEqual(e.message, "The watch was not found")
        } catch { XCTFail("\(error)") }
        XCTAssertEqual(link.currentState(), .disconnected)
        XCTAssertEqual(events.stateNames, ["connecting", "disconnected"])
        XCTAssertEqual(events.states.last?.1, "The watch was not found")
        XCTAssertEqual(transports.last?.closeCount, 1)
        XCTAssertTrue(events.messages(.error).contains("Connect failed [ERR_CONNECT_FAILED]: The watch was not found"))
        XCTAssertTrue(events.messages(.info).contains { $0.hasPrefix("Connecting to \(watch) \"no name\": unknown model (unknown), Bluetooth LE GATT (service 0xFE86)") })
        XCTAssertNil(link.lastDeviceInfo)
        // The failed attempt left nothing behind: a new connect starts a new transport.
        _ = try? await link.connect(watch)
        XCTAssertEqual(transports.count, 2)
    }

    func testARememberedNameSelectsTheModelAndHonorService() async {
        settings.watchAddress = watch
        settings.watchName = "HONOR Band 9-123"
        let link = makeLink(.failConnect(WearError(.connectFailed, "x")))
        _ = try? await link.connect(watch)
        XCTAssertEqual(transports.last?.request.newHonorProtocol, true)
        XCTAssertEqual(transports.last?.request.rememberedName, "HONOR Band 9-123")
        XCTAssertEqual(transports.last?.request.address, watch)
        XCTAssertTrue(events.messages(.info).contains { $0.contains("Honor service") })
    }

    func testASecondConnectToAnotherWatchWhileConnectingIsBusyAndJoiningTheSameWatchWaits() async throws {
        let link = makeLink(.hangConnect)
        let first = Task { try await link.connect(watch) }
        await eventually("the first transport connect") { transports.last?.connectCount == 1 }
        XCTAssertEqual(link.currentState(), .connecting)

        do {
            _ = try await link.connect("11111111-2222-3333-4444-555555555555")
            XCTFail("expected ERR_BUSY")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .busy)
            XCTAssertTrue(e.message.contains("disconnect before connecting again"))
        }

        // The same watch joins the attempt in progress instead of starting a second transport.
        let joined = Task { try await link.connect(watch) }
        await sleepMs(50)
        XCTAssertEqual(transports.count, 1)

        link.disconnect()
        for task in [first, joined] {
            do {
                _ = try await task.value
                XCTFail("expected the user's disconnect")
            } catch let e as WearError {
                XCTAssertEqual(e.code, .disconnected)
            } catch { XCTFail("\(error)") }
        }
        XCTAssertEqual(link.currentState(), .disconnected)
        XCTAssertEqual(events.stateNames.last, "disconnected")
        XCTAssertEqual(transports.last?.closeCount, 1)
    }

    func testBackgroundConnectWaitsWithoutReportingAStateUntilTheWatchAppears() async {
        let link = makeLink(.hangWait)
        let task = Task { try await link.connect(watch, mode: .background) }
        await eventually("the pending connect") { transports.last?.waitCount == 1 }
        XCTAssertEqual(link.currentState(), .disconnected, "a pending connect is not a connecting link")
        XCTAssertTrue(events.stateNames.isEmpty)
        XCTAssertEqual(transports.last?.request.mode, .background)

        link.disconnect()
        do {
            _ = try await task.value
            XCTFail("expected a disconnect")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .disconnected)
        } catch { XCTFail("\(error)") }
        XCTAssertTrue(events.stateNames.isEmpty, "nothing was ever reported, so nothing is taken back")
    }

    func testAnInteractiveConnectReplacesAWaitingBackgroundConnect() async {
        let link = makeLink(.hangWait)
        let background = Task { try await link.connect(watch, mode: .background) }
        await eventually("the pending connect") { transports.last?.waitCount == 1 }
        let interactive = Task { try await link.connect(watch) }
        await eventually("a second transport") { transports.count == 2 }
        do {
            _ = try await background.value
            XCTFail("the background wait was replaced")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .disconnected)
        } catch { XCTFail("\(error)") }
        XCTAssertEqual(link.currentState(), .connecting)
        link.disconnect()
        _ = try? await interactive.value
    }

    func testOperationsNeedAConnectedWatch() async {
        let link = makeLink(.hangConnect)
        for op in [{ _ = try await link.refreshBattery() }, { _ = try await link.syncActivity() }] as [() async throws -> Void] {
            do {
                try await op()
                XCTFail("expected ERR_NOT_CONNECTED")
            } catch let e as WearError {
                XCTAssertEqual(e.code, .notConnected)
                XCTAssertTrue(e.message.contains("state: disconnected"))
            } catch { XCTFail("\(error)") }
        }
        XCTAssertNil(link.handle())
        XCTAssertNil(link.deviceInfo())
    }

    func testForgetClearsTheIdentityAndLogsIt() {
        let secrets = MemorySecretStore()
        let store = DeviceStore(secrets: secrets)
        store.forDevice(watch).ensureCreated()
        let link = WearLink(
            events: events, settings: settings, syncStore: SyncStore(url: temporaryDatabaseURL()), deviceStore: store, gate: AlwaysReadyGate(), phoneModel: "x",
            transportFactory: { r, d in FakeTransport(.hangConnect, request: r, delegate: d) }
        )
        XCTAssertTrue(link.needsBind(watch), "an identity alone is not a bond")
        link.forget(watch.lowercased())
        XCTAssertEqual(secrets.count, 0)
        XCTAssertTrue(events.messages(.info).contains("Forgot \(watch): stored auth key and fake identity cleared"))
    }

    // MARK: bind consent (JRG-173): a first bind replaces the watch's one phone pairing, so it only runs after the user agreed in the app

    private func firstBindStop(authType: Int = 5) -> WearError {
        WearError(.authFailed, "watch does not know this phone: first bind needed", underlying: FirstBindNeededError(authType: authType))
    }

    func testAnInteractiveStopBeforeAFirstBindAsksForConfirmation() {
        let asked = bindStop(firstBindStop(), mode: .interactive)
        XCTAssertEqual(asked.code, .bindConfirmation)
        XCTAssertEqual(asked.code.rawValue, "ERR_BIND_CONFIRMATION")
        XCTAssertTrue(asked.isFirstBindNeeded, "the cause stays attached")
        XCTAssertEqual(bindStop(firstBindStop(authType: 6), mode: .interactive).code, .bindConfirmation)
    }

    func testABackgroundStopBeforeAFirstBindStaysAnAuthFailureAndNeverAsks() {
        XCTAssertEqual(bindStop(firstBindStop(), mode: .background).code, .authFailed)
    }

    func testALostBindingSaysSoInTheConfirmationAndTheBackgroundNote() {
        // JRG-414: the watch forgot a binding stored here (Huawei Health re-bound it while JoyoFit was away).
        let lost = WearError(
            .authFailed, "watch does not know this phone: first bind needed", underlying: FirstBindNeededError(authType: 5, lostBinding: true)
        )
        let asked = bindStop(lost, mode: .interactive)
        XCTAssertEqual(asked.code, .bindConfirmation)
        XCTAssertEqual(asked.message, FirstBindMessage.lost)
        XCTAssertTrue(asked.message.contains(FirstBindMessage.marker))
        XCTAssertTrue(asked.isLostBinding, "the cause stays attached")
        // The same words as Kotlin's FirstBind.LOST_MARKER, which connectFailure.ts matches.
        XCTAssertEqual(FirstBindMessage.marker, "no longer knows this phone's pairing")
        XCTAssertEqual(bindStop(firstBindStop(), mode: .interactive).message, FirstBindMessage.notBound)
        XCTAssertFalse(FirstBindMessage.notBound.contains(FirstBindMessage.marker))
        XCTAssertNotEqual(FirstBindMessage.backgroundNote(lostBinding: true), FirstBindMessage.backgroundNote(lostBinding: false))
        XCTAssertEqual(FirstBindMessage.backgroundNote(lostBinding: false), "The watch does not know this phone. Connect from the app to bind it.")
    }

    func testOtherFailuresPassThroughUnchanged() {
        for failure in [
            WearError(.authFailed, "wrong token"), WearError(.timeout, "Timed out"), WearError(.connectFailed, "no"), WearError(.disconnected, "gone"),
        ] {
            XCTAssertEqual(bindStop(failure, mode: .interactive).code, failure.code)
            XCTAssertEqual(bindStop(failure, mode: .interactive).message, failure.message)
        }
    }

    func testConsentIsPerWatchAndSingleUse() {
        let consent = BindConsent()
        XCTAssertFalse(consent.isAllowed(watch))
        consent.allow(watch)
        XCTAssertTrue(consent.isAllowed(watch))
        XCTAssertFalse(consent.isAllowed("11111111-2222-3333-4444-555555555555"))
        consent.clear(watch)
        XCTAssertFalse(consent.isAllowed(watch))
        consent.allow(watch)
        consent.clearAll()
        XCTAssertFalse(consent.isAllowed(watch))
    }

    func testAllowBindNormalizesTheAddressAndAFailedConnectTakesItAway() async {
        let link = makeLink(.failConnect(WearError(.connectFailed, "no route")))
        link.allowBind(watch.lowercased())
        XCTAssertTrue(link.bindConsent.isAllowed(watch), "stored under the normalized identifier")
        _ = try? await link.connect(watch)
        XCTAssertFalse(link.bindConsent.isAllowed(watch), "the consent is for one connect only")
    }

    func testDisconnectAndForgetTakeAwayTheConsent() {
        let link = makeLink(.hangConnect)
        link.allowBind(watch)
        link.disconnect()
        XCTAssertFalse(link.bindConsent.isAllowed(watch))
        link.allowBind(watch)
        link.forget(watch)
        XCTAssertFalse(link.bindConsent.isAllowed(watch))
    }

    func testTheLinkReportsItsActiveWatch() async {
        let link = makeLink(.hangConnect)
        XCTAssertNil(link.activeAddress)
        let connect = Task { try await link.connect(watch) }
        await eventually("connecting") { link.currentState() == .connecting }
        XCTAssertEqual(link.activeAddress, watch)
        link.disconnect()
        _ = try? await connect.value
        XCTAssertNil(link.activeAddress)
    }
}
