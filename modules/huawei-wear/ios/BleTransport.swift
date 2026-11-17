// CoreBluetooth link to a Huawei or Honor band: the same packet stream as the Android BleTransport.kt, carried by GATT. The phone writes to
// the write characteristic (FE01) and the watch answers with notifications on the read one (FE02), so notification payloads go to the
// delegate exactly as RFCOMM read chunks do (the session reassembles packets, whatever the chunking).
//
// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): service/btle/BtLEQueue and service/devices/huawei/HuaweiLESupport (GATT service
// 0xFE86 with FE01 to write and FE02 to notify; Honor's own service for isNewHonorProtocol models).
//
// Like GB's BtLEQueue: connect, discover services, enable notifications on the read characteristic, one GATT operation at a time. There is no
// iOS bonding: the watch authenticates through the Huawei protocol itself (HiChain), and a CoreBluetooth connect without pairing is enough
// because FE86 needs no link encryption (protocol/README.md, 2026-10-16).
//
// iOS specifics, none of which Android has:
//  - FE86 is not advertised, so no scan can filter on a service UUID. A foreground scan with no filter matches the advertised complete local
//    name (`HUAWEI WATCH FIT 4 Pro-40A`, remembered by stem) or the CoreBluetooth identifier, and logs service data for 0xFDEE and every
//    Huawei or Honor name it sees. Background scans need a service filter and so are not used: background reconnects are pending connects.
//  - The ATT MTU is negotiated by iOS itself. The chunk size of a write is `maximumWriteValueLength(for: .withoutResponse)` (capped at
//    512 like Android's MAX_ATTRIBUTE_BYTES), and writes without response honour `canSendWriteWithoutResponse` /
//    `peripheralIsReady(toSendWriteWithoutResponse:)` so no write is dropped.
//  - One process-wide central with a state restoration identifier, so iOS can relaunch the app for the remembered watch.
#if canImport(CoreBluetooth)
import CoreBluetooth
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

// MARK: discovery

/// One advertisement the scan saw.
public struct BleDiscovery: @unchecked Sendable {
    public let peripheral: CBPeripheral
    public let identifier: UUID
    /// The advertised complete local name, else the name CoreBluetooth cached for the peripheral.
    public let name: String?
    public let rssi: Int
    /// Service data for the 16-bit UUID 0xFDEE, which the Fit 4 Pro advertises.
    public let hasFdeeServiceData: Bool
    public let advertisedServices: [CBUUID]
    public let connectable: Bool?
    public let advertisement: String

    public var looksLikeHuaweiOrHonor: Bool { WatchModels.looksLikeHuaweiOrHonor(name) }
    public var isWatchCandidate: Bool { looksLikeHuaweiOrHonor || hasFdeeServiceData }
}

/// A watch iOS already holds a connection to (`BleCentral.systemConnectedWatches`).
public struct BleSystemWatch: Sendable, Equatable {
    public let identifier: UUID
    public let name: String?
}

public enum BleScanVerdict {
    case keepScanning
    case stop
}

/// What a scan has seen, shared between the scan callback (a CoreBluetooth queue) and the code that waits for its result.
final class ScanLedger: @unchecked Sendable {
    private let lock = NSLock()
    private var sighted = Set<UUID>()
    private var strongest: [UUID: BleDiscovery] = [:]

    /// True the first time this peripheral is seen in the scan (so each is logged once).
    func firstSighting(_ identifier: UUID) -> Bool { lock.locked { sighted.insert(identifier).inserted } }

    func keepStrongest(_ d: BleDiscovery) {
        lock.locked {
            if let old = strongest[d.identifier], old.rssi >= d.rssi { return }
            strongest[d.identifier] = d
        }
    }

    func all() -> [BleDiscovery] { lock.locked { Array(strongest.values) } }
}

enum BleUUID {
    static let huaweiService = CBUUID(string: "FE86")
    static let huaweiWrite = CBUUID(string: "FE01")
    static let huaweiRead = CBUUID(string: "FE02")
    static let honorService = CBUUID(string: "c5f0ad48-cc27-48fd-9f67-8dc8e8f4a9cb")
    static let honorWrite = CBUUID(string: "2a5fc8bd-3de4-43cb-9449-354bcdeccc70")
    static let honorRead = CBUUID(string: "a563d757-b216-48bc-8a0f-e8dde1f916aa")
    static let watchAdvertisement = CBUUID(string: "FDEE")
    /// Services `retrieveConnectedPeripherals` is asked for: iOS returns a connected peripheral only when it has one of them in its service cache.
    /// The Fit 4 Pro's GATT database (protocol/README.md, 2026-10-16, read over Android): 1801, 1800, 3802, 180F battery, FE86, 180D heart rate,
    /// 1812 HID and a vendor service. Other Huawei and Honor models differ, so the probe also holds the Honor service, 0xFDEE, device
    /// information and current time.
    static let systemConnectedProbe: [CBUUID] = [
        huaweiService, honorService, watchAdvertisement,
        CBUUID(string: "1800"), CBUUID(string: "1801"), CBUUID(string: "3802"), CBUUID(string: "180A"), CBUUID(string: "180F"),
        CBUUID(string: "180D"), CBUUID(string: "1805"), CBUUID(string: "1812"),
        CBUUID(string: "cc353442-be58-4ea2-876e-11d8d6976366"),
    ]
}

// MARK: central

/// The process-wide CoreBluetooth central: one `CBCentralManager` with a restoration identifier, its radio state, the scan, and the routing of
/// connection callbacks to the transport that owns the peripheral.
public final class BleCentral: NSObject, CBCentralManagerDelegate, BluetoothGate, @unchecked Sendable {
    public static let shared = BleCentral()
    /// iOS hands the connected or pending peripherals back under this identifier when it relaunches the app (UIBackgroundModes
    /// bluetooth-central).
    public static let restoreIdentifier = "com.joyodigitama.joyofit.central"

    let queue = DispatchQueue(label: "com.joyodigitama.joyofit.ble")
    private let lock = NSLock()
    private var manager: CBCentralManager?
    private var radio: CBManagerState = .unknown
    private var restored: [UUID: CBPeripheral] = [:]
    private var routes: [UUID: BleTransport] = [:]
    private var observers: [UUID: @Sendable (CBManagerState) -> Void] = [:]
    private var scanRun: ScanRun?
    private let scanLock = AsyncLock()

    private override init() { super.init() }

    /// Creates the manager. The app delegate calls this at launch when background mode is on, so a restoration event is not missed; the
    /// first connect or scan calls it otherwise (which is what triggers the Bluetooth permission prompt).
    public func start() {
        lock.locked {
            if manager == nil {
                manager = CBCentralManager(
                    delegate: self, queue: queue,
                    options: [CBCentralManagerOptionRestoreIdentifierKey: BleCentral.restoreIdentifier, CBCentralManagerOptionShowPowerAlertKey: false]
                )
            }
        }
    }

    public var state: CBManagerState { lock.locked { radio } }

    /// Calls `handler` on every radio state change until the returned token is passed to `removeObserver`.
    public func addObserver(_ handler: @escaping @Sendable (CBManagerState) -> Void) -> UUID {
        let token = UUID()
        lock.locked { observers[token] = handler }
        return token
    }

    public func removeObserver(_ token: UUID) { lock.locked { observers[token] = nil } }

    // MARK: BluetoothGate

    /// Resolves when the radio is on; throws the coded error for off, not permitted and missing.
    public func requireReady() async throws {
        switch CBCentralManager.authorization {
        case .denied, .restricted:
            throw WearError(
                .bluetoothPermission,
                "Bluetooth access is not allowed for JoyoFit; allow it in Settings > Privacy & Security > Bluetooth"
            )
        default: break
        }
        start()
        // The first state arrives right after the manager is created; `resetting` and `unknown` are transient.
        for _ in 0..<50 {
            let current = state
            if current != .unknown && current != .resetting { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        switch state {
        case .poweredOn: return
        case .poweredOff: throw WearError(.bluetoothOff, "Bluetooth is turned off; turn it on and try again")
        case .unauthorized:
            throw WearError(
                .bluetoothPermission,
                "Bluetooth access is not allowed for JoyoFit; allow it in Settings > Privacy & Security > Bluetooth"
            )
        case .unsupported: throw WearError(.bluetoothUnavailable, "This device has no Bluetooth LE")
        default: throw WearError(.bluetoothUnavailable, "Bluetooth is not ready (state \(state.rawValue))")
        }
    }

    // MARK: CBCentralManagerDelegate

    public func centralManagerDidUpdateState(_ central: CBCentralManager) {
        let new = central.state
        let handlers: [@Sendable (CBManagerState) -> Void] = lock.locked {
            radio = new
            return Array(observers.values)
        }
        WearConsole.ble("central state \(BleCentral.describe(new))")
        handlers.forEach { $0(new) }
        if new != .poweredOn {
            let active = lock.locked { Array(routes.values) }
            for transport in active { transport.radioChanged(new) }
            lock.locked({ scanRun })?.finish(nil)
        }
    }

    public func centralManager(_ central: CBCentralManager, willRestoreState dict: [String: Any]) {
        let peripherals = (dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral]) ?? []
        lock.locked {
            for p in peripherals { restored[p.identifier] = p }
        }
        WearConsole.ble("state restoration: \(peripherals.map { "\($0.identifier) \(BleCentral.describe($0.state))" }.joined(separator: ", "))")
    }

    public func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let local = (advertisementData[CBAdvertisementDataLocalNameKey] as? String) ?? peripheral.name
        let serviceData = advertisementData[CBAdvertisementDataServiceDataKey] as? [CBUUID: Data] ?? [:]
        let services = advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? []
        let connectable = (advertisementData[CBAdvertisementDataIsConnectable] as? NSNumber)?.boolValue
        let described = serviceData.map { "\($0.key.uuidString)=\($0.value.map { String(format: "%02x", $0) }.joined())" }.sorted().joined(separator: ",")
        let discovery = BleDiscovery(
            peripheral: peripheral, identifier: peripheral.identifier, name: local, rssi: RSSI.intValue,
            hasFdeeServiceData: serviceData.keys.contains(BleUUID.watchAdvertisement),
            advertisedServices: services, connectable: connectable,
            advertisement: "service data [\(described)], services \(services.map(\.uuidString))"
        )
        lock.locked({ scanRun })?.handle(discovery)
    }

    public func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        route(peripheral)?.didConnect()
    }

    public func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        route(peripheral)?.didFailToConnect(error)
    }

    public func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        route(peripheral)?.didDisconnect(error)
    }

    /// The user answered iOS's "share notifications with this accessory" question (or changed Settings > Bluetooth > the watch >
    /// Show Notifications): the watch reads the iPhone's notifications over ANCS only while this is true.
    public func centralManager(_ central: CBCentralManager, didUpdateANCSAuthorizationFor peripheral: CBPeripheral) {
        route(peripheral)?.ancsChanged(peripheral.ancsAuthorized)
    }

    private func route(_ peripheral: CBPeripheral) -> BleTransport? { lock.locked { routes[peripheral.identifier] } }

    // MARK: used by BleTransport (always on `queue` unless noted)

    func register(_ transport: BleTransport, for identifier: UUID) { lock.locked { routes[identifier] = transport } }

    func unregister(_ transport: BleTransport, for identifier: UUID) {
        lock.locked { if routes[identifier] === transport { routes[identifier] = nil } }
    }

    func takeRestored(_ identifier: UUID) -> CBPeripheral? { lock.locked { restored.removeValue(forKey: identifier) } }

    /// The peripheral iOS remembers for `identifier` (it knew it from an earlier scan or connect), else one already connected system-wide, by
    /// identifier and then by the watch's full Bluetooth name (`named`): after a re-pair or a Bluetooth reset iOS hands the same watch a new
    /// identifier, and a watch iOS holds a connection to never advertises, so no scan would find it either.
    func knownPeripheral(_ identifier: UUID, named: String? = nil) -> CBPeripheral? {
        guard let manager else { return nil }
        if let found = manager.retrievePeripherals(withIdentifiers: [identifier]).first { return found }
        let connected = manager.retrieveConnectedPeripherals(withServices: BleUUID.systemConnectedProbe)
        if let found = connected.first(where: { $0.identifier == identifier }) { return found }
        guard let wanted = named?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), !wanted.isEmpty else { return nil }
        return connected.first { $0.name?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == wanted }
    }

    /// True when iOS already lists a connection to the watch with `identifier` before this app opens one: the watch is paired in Settings >
    /// Bluetooth, or another app (Huawei Health) is connected to it. That link carries the other side's Huawei session. Needs a started central.
    func holdsConnection(_ identifier: UUID) -> Bool {
        guard let manager else { return false }
        return manager.retrieveConnectedPeripherals(withServices: BleUUID.systemConnectedProbe).contains { $0.identifier == identifier }
    }

    /// Huawei and Honor watches iOS already holds a connection to (paired in Settings > Bluetooth, or held by ANCS or another app). They do not
    /// advertise, so no scan sees them; `retrieveConnectedPeripherals` lists them by the services they expose, and iOS gives no way to ask
    /// for "all", so the probe is a broad list (`BleUUID.systemConnectedProbe`). Only named Huawei/Honor devices, and the remembered one
    /// whatever its name, are returned. Needs a started central (`requireReady`).
    public func systemConnectedWatches(remembered: UUID?) -> [BleSystemWatch] {
        guard let manager = lock.locked({ self.manager }) else { return [] }
        var seen = Set<UUID>()
        var found: [BleSystemWatch] = []
        for peripheral in manager.retrieveConnectedPeripherals(withServices: BleUUID.systemConnectedProbe) {
            guard seen.insert(peripheral.identifier).inserted else { continue }
            guard WatchModels.looksLikeHuaweiOrHonor(peripheral.name) || peripheral.identifier == remembered else { continue }
            found.append(BleSystemWatch(identifier: peripheral.identifier, name: peripheral.name))
        }
        WearConsole.ble("connected to the system: \(found.map { "\($0.identifier) \"\($0.name ?? "no name")\"" }.joined(separator: ", "))")
        return found
    }

    func connect(_ peripheral: CBPeripheral) { manager?.connect(peripheral, options: nil) }
    func cancel(_ peripheral: CBPeripheral) { manager?.cancelPeripheralConnection(peripheral) }

    // MARK: scan

    private final class ScanRun: @unchecked Sendable {
        private let lock = NSLock()
        private var done = false
        private var continuation: CheckedContinuation<BleDiscovery?, Never>?
        private let onDiscovery: @Sendable (BleDiscovery) -> BleScanVerdict
        private unowned let central: BleCentral

        init(central: BleCentral, onDiscovery: @escaping @Sendable (BleDiscovery) -> BleScanVerdict) {
            self.central = central
            self.onDiscovery = onDiscovery
        }

        func attach(_ c: CheckedContinuation<BleDiscovery?, Never>) { lock.locked { continuation = c } }

        func handle(_ d: BleDiscovery) {
            if lock.locked({ done }) { return }
            if onDiscovery(d) == .stop { finish(d) }
        }

        func finish(_ result: BleDiscovery?) {
            let c: CheckedContinuation<BleDiscovery?, Never>? = lock.locked {
                if done { return nil }
                done = true
                let c = continuation
                continuation = nil
                return c
            }
            guard let c else { return }
            central.manager?.stopScan()
            central.lock.locked { if central.scanRun === self { central.scanRun = nil } }
            c.resume(returning: result)
        }
    }

    /// An unfiltered foreground scan for up to `timeoutMs`, handing every advertisement to `onDiscovery`; returns the discovery it stopped on,
    /// or nil at the timeout (or when the radio went away). Scans are serialized.
    public func scan(timeoutMs: Int, onDiscovery: @escaping @Sendable (BleDiscovery) -> BleScanVerdict) async -> BleDiscovery? {
        await scanLock.withLock {
            guard (try? await requireReady()) != nil else { return nil }
            let run = ScanRun(central: self, onDiscovery: onDiscovery)
            return await withTaskCancellationHandler {
                await withCheckedContinuation { (c: CheckedContinuation<BleDiscovery?, Never>) in
                    run.attach(c)
                    queue.async {
                        self.lock.locked { self.scanRun = run }
                        // Duplicates on: a watch whose name or 0xFDEE service data comes in a later packet than its first one (scan response)
                        // would never be reported otherwise. The scan is short and in the foreground.
                        self.manager?.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
                        self.queue.asyncAfter(deadline: .now() + .milliseconds(timeoutMs)) { run.finish(nil) }
                    }
                }
            } onCancel: {
                run.finish(nil)
            }
        }
    }

    /// Watches that advertise for `timeoutMs`: Huawei or Honor names and 0xFDEE service data, one entry per peripheral (strongest signal).
    public func nearbyWatches(timeoutMs: Int) async -> [BleDiscovery] {
        let ledger = ScanLedger()
        _ = await scan(timeoutMs: timeoutMs) { d in
            if d.isWatchCandidate { ledger.keepStrongest(d) }
            return .keepScanning
        }
        return ledger.all()
    }

    static func describe(_ state: CBManagerState) -> String {
        switch state {
        case .unknown: return "unknown"
        case .resetting: return "resetting"
        case .unsupported: return "unsupported"
        case .unauthorized: return "unauthorized"
        case .poweredOff: return "poweredOff"
        case .poweredOn: return "poweredOn"
        @unknown default: return "state \(state.rawValue)"
        }
    }

    static func describe(_ state: CBPeripheralState) -> String {
        switch state {
        case .disconnected: return "disconnected"
        case .connecting: return "connecting"
        case .connected: return "connected"
        case .disconnecting: return "disconnecting"
        @unknown default: return "state \(state.rawValue)"
        }
    }
}

/// iOS refuses the link with `CBError.peerRemovedPairingInformation` when the watch deleted its Bluetooth bond (a reset, or a pairing with
/// another phone) while iOS still holds the old keys. No retry or scan gets past it: only Forget This Device in Settings > Bluetooth does
/// (JRG-494..496, Watch GT 5 on iOS 27). The JS side (`connectFailure.ts`) recognises the failure by `marker`.
enum BondRemoved {
    static let marker = "removed its Bluetooth pairing with this iPhone"
    static let message =
        "The watch \(marker) (it was reset, or paired with another phone), but iOS still keeps the old pairing: " +
        "forget the watch in Settings > Bluetooth, then connect again"

    static func isCause(_ error: Error?) -> Bool {
        (error as? CBError)?.code == .peerRemovedPairingInformation
    }

    /// A connect failure built from `isCause`.
    static func isFailure(_ error: Error) -> Bool {
        isCause((error as? WearError)?.underlying)
    }
}

// MARK: transport

public final class BleTransport: NSObject, WatchTransport, CBPeripheralDelegate, @unchecked Sendable {
    /// How long the scan waits for the watch before giving up.
    static let scanMs = 6_000
    /// Attempts at opening the link; the last one stays pending, as Android's last attempt uses autoConnect.
    static let connectAttempts = 3
    static let retryDelayMs = 1_500
    /// How long a connect attempt waits before the next starts (iOS keeps a connect pending for ever otherwise).
    static let attemptMs = 8_000
    /// CoreBluetooth refuses a characteristic value longer than this, whatever the ATT MTU.
    static let maxAttributeBytes = 512
    static let defaultWriteBytes = 20
    static let discoveryMs = 8_000
    // Generous because iOS can hold GATT traffic while its own pairing prompt is on screen (the watch starts LE pairing right after a first
    // bind is accepted); the Huawei request timeouts above are what ends a link that is really stuck.
    static let notifyMs = 15_000
    static let writeMs = 30_000
    /// The first chunks of a connection are also written to the support log (every chunk always goes to the console).
    static let supportLoggedChunks = 200

    private enum Step: Hashable {
        case connect
        case disconnect
        case services
        case characteristics(String)
        case notify
        case write
        case writeReady
    }

    private struct Pending {
        let token: UUID
        let continuation: CheckedContinuation<Void, Error>
    }

    private let request: TransportRequest
    private let address: String
    private let identifier: UUID
    private let central: BleCentral
    private let queue: DispatchQueue
    private weak var delegate: WatchTransportDelegate?
    private let serviceUuid: CBUUID
    private let readUuid: CBUUID
    private let writeUuid: CBUUID
    private let writeLock = AsyncLock()
    // Touched under `writeLock` only.
    private var chunksWritten = 0
    private var lastMaxWrite = -1

    // Everything below is touched on `queue` only, except `nameLock`'s value.
    private var peripheral: CBPeripheral?
    private var writeCharacteristic: CBCharacteristic?
    private var readCharacteristic: CBCharacteristic?
    private var writeType: CBCharacteristicWriteType = .withoutResponse
    private var pending: [Step: Pending] = [:]
    private var cancelled: Set<UUID> = []
    private let flagLock = NSLock()
    private var _closed = false
    private var closed: Bool {
        get { flagLock.locked { _closed } }
        set { flagLock.locked { _closed = newValue } }
    }
    private var ready = false
    private var lostBeforeReady: WearError?
    private var registered = false
    /// True between our own `cancelPeripheralConnection` and the disconnect callback it causes, which is not a lost link.
    private var cancelRequested = false
    /// Whether iOS already held a connection to the watch when `open` started (`BleCentral.holdsConnection`); for the log only.
    private var heldBeforeOpen = false

    private let nameLock = NSLock()
    private var name: String?
    /// `CBPeripheral.ancsAuthorized` as last seen; read under `nameLock`.
    private var ancs: Bool?

    public init(request: TransportRequest, delegate: WatchTransportDelegate, central: BleCentral = .shared) {
        self.request = request
        self.address = request.address
        self.identifier = UUID(uuidString: request.address) ?? UUID()
        self.central = central
        self.queue = central.queue
        self.delegate = delegate
        self.serviceUuid = request.newHonorProtocol ? BleUUID.honorService : BleUUID.huaweiService
        self.readUuid = request.newHonorProtocol ? BleUUID.honorRead : BleUUID.huaweiRead
        self.writeUuid = request.newHonorProtocol ? BleUUID.honorWrite : BleUUID.huaweiWrite
        super.init()
    }

    public var peripheralName: String? { nameLock.locked { name } }

    public var ancsAuthorized: Bool? { nameLock.locked { ancs } }

    func ancsChanged(_ authorized: Bool) {
        nameLock.locked { ancs = authorized }
        step("ANCS (iPhone notifications to the watch) authorization changed: \(authorized ? "authorized" : "not authorized")")
    }

    /// Every connect step goes to the support report (through the delegate) and to the console under the JoyoFitBle tag.
    private func step(_ message: String) {
        WearConsole.ble(message)
        delegate?.transportLog(message)
    }

    // MARK: WatchTransport

    public func waitForWatch() async throws {
        try await central.requireReady()
        let target: CBPeripheral? = await onQueue {
            self.claimRoute()
            return self.central.takeRestored(self.identifier) ?? self.central.knownPeripheral(self.identifier)
        }
        guard let target else {
            throw WearError(
                .connectFailed,
                "iOS does not know a watch with this identifier yet (\(address)); open the app and connect to the watch once to let it find the watch"
            )
        }
        await onQueue {
            self.peripheral = target
            target.delegate = self
        }
        if target.state == .connected {
            step("pending connect: \(address) is already connected at the OS level")
            return
        }
        step("pending connect to \(address): iOS holds it until the watch is in range")
        try await awaitStep(.connect, what: "connect", timeoutMs: nil) {
            self.central.connect(target)
        }
        step("pending connect completed")
    }

    public func connect(timeoutMs: Int) async throws {
        let address = self.address
        do {
            try await withDeadline(
                ms: timeoutMs + BleTransport.scanMs,
                onTimeout: { WearError(.timeout, "Timed out after \(timeoutMs) ms connecting to \(address) over Bluetooth LE") }
            ) { try await self.open() }
        } catch let e as WearError {
            close()
            throw e
        } catch {
            close()
            if error is CancellationError { throw error }
            throw WearError(.connectFailed, "Bluetooth LE connect to \(address) failed: \(error)", underlying: error)
        }
        let lost: WearError? = await onQueue {
            self.ready = true
            return self.lostBeforeReady
        }
        let isClosed = await onQueue { self.closed }
        if lost != nil || isClosed {
            close()
            throw WearError(.disconnected, "Disconnected while connecting", underlying: lost)
        }
    }

    /// Idempotent; does not call the delegate's `transportDidClose`.
    public func close() {
        queue.async {
            self.closed = true
            self.failAll(WearError(.disconnected, "Bluetooth LE link closed"))
            self.release()
        }
    }

    /// The watch said nothing to LinkParams although the link is up and notifications are on. Attempt 2 stays on the link: notifications off
    /// and on (the watch sees a fresh descriptor write) and the GATT database read again (no stale handle). Attempt 3 closes the link, opens
    /// it anew, reads the database again and, when the write characteristic allows both write types, writes the other way.
    public func recoverLink(beforeAttempt attempt: Int) async throws -> String? {
        guard let target = await onQueue({ self.closed ? nil : self.peripheral }) else {
            throw WearError(.disconnected, "Bluetooth LE link is closed or not ready")
        }
        let state = await snapshot(target)
        step("link before LinkParams attempt \(attempt): \(state)")
        if attempt <= 2 {
            if let read = await onQueue({ self.readCharacteristic }), read.isNotifying {
                try await awaitStep(.notify, what: "disable notifications", timeoutMs: BleTransport.notifyMs) {
                    target.setNotifyValue(false, for: read)
                }
            }
            try await rediscover(target, alternateWrite: false)
            return "notifications switched off and on, GATT services discovered again"
        }
        try await disconnectAndWait(target)
        try await connectOnce(target, timeoutMs: BleTransport.attemptMs)
        step("GATT link up again")
        try await rediscover(target, alternateWrite: true)
        let type = await onQueue { self.writeType }
        return "GATT link closed and opened again, services discovered again, writing \(type == .withoutResponse ? "without" : "with") response"
    }

    // MARK: open

    private func open() async throws {
        try await central.requireReady()
        await onQueue { self.claimRoute() }
        let heldByOthers = await onQueue { () -> Bool in
            let held = self.central.holdsConnection(self.identifier)
            self.heldBeforeOpen = held
            return held
        }
        if heldByOthers {
            step(
                "iOS already holds a connection to this watch before JoyoFit opens its own: the watch is paired in Settings > Bluetooth, " +
                    "another app such as Huawei Health is connected to it, or JoyoFit's own link of a moment ago is still closing; " +
                    "the Huawei session on that link may not answer a second app"
            )
        }
        let target = try await findTarget()
        try await connectWithRetry(target)
        step("GATT connected")

        let withoutResponse = target.maximumWriteValueLength(for: .withoutResponse)
        let withResponse = target.maximumWriteValueLength(for: .withResponse)
        step("ATT write size without response \(withoutResponse) bytes (MTU \(withoutResponse + 3)), with response \(withResponse) bytes; iOS negotiates the MTU itself")

        try await discover(target)
        try await enableNotifications(target)
        nameLock.locked {
            name = target.name ?? name
            ancs = target.ancsAuthorized
        }
        step("ANCS (iPhone notifications to the watch) authorized: \(target.ancsAuthorized ? "yes" : "no")")
    }

    /// The identifier of a peripheral that is this transport's watch under another identifier than `identifier`; `queue` only.
    private var extraRoute: UUID?

    /// Registers this transport for connection callbacks of its peripheral; `queue` only.
    private func claimRoute() {
        if !registered {
            registered = true
            central.register(self, for: identifier)
        }
    }

    /// The remembered peripheral when iOS still knows it (reconnect without a scan), else the advertiser found by a scan.
    private func findTarget() async throws -> CBPeripheral {
        let known: CBPeripheral? = await onQueue {
            if let restored = self.central.takeRestored(self.identifier) {
                self.step("state restoration handed back \(restored.identifier) (\(BleCentral.describe(restored.state)))")
                return restored
            }
            return self.central.knownPeripheral(self.identifier, named: self.request.rememberedName)
        }
        if let known {
            await onQueue { self.adopt(known) }
            if known.state == .connected || known.state == .connecting {
                // A link iOS holds from an earlier session of this process or a restored one has no Huawei session behind it any more: drop it
                // and open a fresh one, the way Android's process death does.
                step("peripheral \(address) is \(BleCentral.describe(known.state)) at the OS level; closing it first")
                try await disconnectAndWait(known)
            }
            step("reconnecting to the remembered peripheral \(address) (retrievePeripherals) before scanning")
            do {
                try await connectOnce(known, timeoutMs: BleTransport.attemptMs)
                step("direct reconnect worked")
                return known
            } catch let e as WearError where e.code == .disconnected && closed {
                throw e
            } catch let e as WearError where BondRemoved.isFailure(e) {
                // A scan finds the same peripheral and iOS refuses it the same way.
                step("direct reconnect failed (\(e)); not scanning, iOS has to forget the watch first")
                throw e
            } catch {
                step("direct reconnect failed (\(error)); scanning for the watch")
                try await disconnectAndWait(known)
            }
        } else {
            step("iOS does not remember \(address); scanning for the watch")
        }
        let found = try await scanForWatch()
        await onQueue { self.adopt(found.peripheral) }
        return found.peripheral
    }

    /// Makes `target` the peripheral of this transport; `queue` only. A watch iOS knows under another identifier than the remembered one (found
    /// by name) gets its connection callbacks routed here too, or the connect would never complete.
    private func adopt(_ target: CBPeripheral) {
        peripheral = target
        target.delegate = self
        if target.identifier != identifier, extraRoute != target.identifier {
            if let old = extraRoute { central.unregister(self, for: old) }
            extraRoute = target.identifier
            central.register(self, for: target.identifier)
            step("iOS knows this watch as \(target.identifier), not \(address); routing its connection events here")
        }
    }


    private func scanForWatch() async throws -> BleDiscovery {
        let identifier = self.identifier
        let remembered = request.rememberedName
        let ledger = ScanLedger()
        step(
            "scan for \"\(remembered ?? address)\" (name stem or identifier \(address)), unfiltered because \(serviceUuid) is not advertised, up to \(BleTransport.scanMs) ms"
        )
        let logger = self.stepSink
        let found = await central.scan(timeoutMs: BleTransport.scanMs) { d in
            let sameIdentifier = d.identifier == identifier
            let sameName = WatchModels.sameWatchName(advertised: d.name, remembered: remembered)
            if !(sameIdentifier || sameName || d.isWatchCandidate) { return .keepScanning }
            if ledger.firstSighting(d.identifier) {
                logger(
                    "LE scan: \(d.identifier) \"\(d.name ?? "no name")\" rssi \(d.rssi) connectable \(d.connectable.map { "\($0)" } ?? "?"), " +
                        "FDEE service data \(d.hasFdeeServiceData ? "YES" : "no"), \(d.advertisement), same identifier \(sameIdentifier), same name \(sameName)"
                )
            }
            if d.hasFdeeServiceData && !(sameIdentifier || sameName) { ledger.keepStrongest(d) }
            return (sameIdentifier || sameName) ? .stop : .keepScanning
        }
        if let found {
            step("LE scan: matched \(found.identifier)\(found.identifier == identifier ? " (the remembered identifier)" : " by name")")
            return found
        }
        // With no remembered name and a single FDEE advertiser in reach, that is the watch (the Huawei service data marks it).
        let fallback: [BleDiscovery] = ledger.all()
        if remembered == nil, fallback.count == 1, let only = fallback.first {
            step("LE scan: no identifier or name match; the one advertiser with FDEE service data is \(only.identifier) \"\(only.name ?? "no name")\"; using it")
            return only
        }
        throw WearError(
            .connectFailed,
            "The watch was not found: no advertiser matched \(remembered ?? address) within \(BleTransport.scanMs) ms " +
                "(\(fallback.count) with FDEE service data); wake the watch, keep it close and try again"
        )
    }

    /// A `@Sendable` closure that logs a connect step; the scan callback runs off the queue.
    private var stepSink: @Sendable (String) -> Void {
        { [weak self] message in self?.step(message) }
    }

    /// Opens the link, trying again when an attempt fails before the link is up: the first two wait `attemptMs`, the last stays pending.
    private func connectWithRetry(_ target: CBPeripheral) async throws {
        if target.state == .connected { return }
        var attempt = 0
        while true {
            attempt += 1
            let last = attempt == BleTransport.connectAttempts
            step("GATT connect to \(address), attempt \(attempt) of \(BleTransport.connectAttempts) (\(last ? "pending until the watch answers" : "up to \(BleTransport.attemptMs) ms"))")
            do {
                try await connectOnce(target, timeoutMs: last ? nil : BleTransport.attemptMs)
                step("GATT link up on attempt \(attempt)")
                return
            } catch {
                if closed || last || error is CancellationError || BondRemoved.isFailure(error) { throw error }
                step("GATT attempt \(attempt) failed (\(error)); trying again in \(BleTransport.retryDelayMs) ms")
                await onQueue { self.cancelOurselves(target) }
                try await Task.sleep(nanoseconds: UInt64(BleTransport.retryDelayMs) * 1_000_000)
            }
        }
    }

    private func connectOnce(_ target: CBPeripheral, timeoutMs: Int?) async throws {
        do {
            try await awaitStep(.connect, what: "GATT connect", timeoutMs: timeoutMs) {
                // Each attempt starts clean, as Kotlin resets lostBeforeReady: a drop caused by our own cancel of the last attempt is not this one's.
                self.lostBeforeReady = nil
                self.cancelRequested = false
                self.central.connect(target)
            }
        } catch {
            // A connect that timed out must not stay pending in iOS.
            await onQueue { self.cancelOurselves(target) }
            throw error
        }
    }

    /// Cancels the OS-level connection and remembers that the disconnect callback that follows is ours; `queue` only.
    private func cancelOurselves(_ target: CBPeripheral) {
        cancelRequested = true
        central.cancel(target)
    }

    private func disconnectAndWait(_ target: CBPeripheral) async throws {
        if target.state == .disconnected { return }
        do {
            try await awaitStep(.disconnect, what: "disconnect", timeoutMs: 3_000) {
                self.cancelOurselves(target)
            }
        } catch {
            // Not fatal: the next connect attempt follows either way.
            step("disconnect of \(address): \(error)")
        }
    }

    // MARK: discovery

    private func discover(_ target: CBPeripheral, alternateWrite: Bool = false) async throws {
        try await awaitStep(.services, what: "service discovery", timeoutMs: BleTransport.discoveryMs) {
            target.discoverServices(nil)
        }
        let services = target.services ?? []
        step("GATT service discovery done: \(services.map(\.uuid.uuidString).joined(separator: ", "))")

        // GB's getCharacteristic(uuid) looks in every service: the wanted service first, then the rest until both are found.
        let ordered = services.filter { $0.uuid == serviceUuid } + services.filter { $0.uuid != serviceUuid }
        for service in ordered {
            try await awaitStep(.characteristics(service.uuid.uuidString), what: "characteristic discovery of \(service.uuid.uuidString)", timeoutMs: BleTransport.discoveryMs) {
                target.discoverCharacteristics(nil, for: service)
            }
            let characteristics = service.characteristics ?? []
            step("GATT service \(service.uuid.uuidString): " + characteristics.map { "\($0.uuid.uuidString) props 0x\(String($0.properties.rawValue, radix: 16))" }.joined(separator: ", "))
            let (read, write) = await onQueue { () -> (CBCharacteristic?, CBCharacteristic?) in
                if self.readCharacteristic == nil { self.readCharacteristic = characteristics.first { $0.uuid == self.readUuid } }
                if self.writeCharacteristic == nil { self.writeCharacteristic = characteristics.first { $0.uuid == self.writeUuid } }
                return (self.readCharacteristic, self.writeCharacteristic)
            }
            if read != nil && write != nil { break }
        }

        let (read, write) = await onQueue { (self.readCharacteristic, self.writeCharacteristic) }
        guard read != nil, let write else {
            throw WearError(
                .connectFailed,
                "The watch has no Huawei GATT characteristics (\(read == nil ? "read \(readUuid.uuidString)" : "write \(writeUuid.uuidString)") is missing); " +
                    "services found: \(services.map(\.uuid.uuidString).joined(separator: ", "))"
            )
        }
        // GB leaves the characteristic's write type as the stack sets it: no response when the characteristic allows it. A characteristic that
        // allows both is written the other way (`alternateWrite`) when the watch did not answer the first request.
        let withoutResponse = write.properties.contains(.writeWithoutResponse)
        let withResponse = write.properties.contains(.write)
        let type: CBCharacteristicWriteType
        if withoutResponse && withResponse {
            type = alternateWrite ? .withResponse : .withoutResponse
        } else if withoutResponse {
            type = .withoutResponse
        } else if withResponse {
            type = .withResponse
        } else {
            throw WearError(.connectFailed, "GATT characteristic \(writeUuid.uuidString) cannot be written")
        }
        await onQueue { self.writeType = type }
        step(
            "GATT write \(type == .withoutResponse ? "without" : "with") response (the characteristic allows \(BleTransport.writeKinds(write))); " +
                "notify characteristic \(readUuid.uuidString)"
        )
    }

    private func enableNotifications(_ target: CBPeripheral) async throws {
        guard let read = await onQueue({ self.readCharacteristic }) else { return }
        // CoreBluetooth writes the CCCD itself: notify when the characteristic has it, else indicate.
        guard read.properties.contains(.notify) || read.properties.contains(.indicate) else {
            throw WearError(.connectFailed, "GATT characteristic \(readUuid.uuidString) can neither notify nor indicate")
        }
        try await awaitStep(.notify, what: "enable notifications", timeoutMs: BleTransport.notifyMs) {
            target.setNotifyValue(true, for: read)
        }
        step("GATT notifications on")
    }

    /// Forgets the characteristics found earlier, asks for the GATT database again and subscribes again.
    private func rediscover(_ target: CBPeripheral, alternateWrite: Bool) async throws {
        await onQueue {
            self.readCharacteristic = nil
            self.writeCharacteristic = nil
        }
        try await discover(target, alternateWrite: alternateWrite)
        try await enableNotifications(target)
    }

    /// The link as it is now, for the log when LinkParams gets no answer: what a support report needs to tell the causes apart.
    private func snapshot(_ target: CBPeripheral) async -> String {
        let (read, write, type, held) = await onQueue { (self.readCharacteristic, self.writeCharacteristic, self.writeType, self.heldBeforeOpen) }
        return "peripheral \(BleCentral.describe(target.state)), notifications on \(read?.isNotifying == true ? "yes" : "no"), " +
            "writing \(type == .withoutResponse ? "without" : "with") response (the characteristic allows \(BleTransport.writeKinds(write))), " +
            "canSendWriteWithoutResponse \(target.canSendWriteWithoutResponse), ANCS \(target.ancsAuthorized ? "yes" : "no"), " +
            "iOS held a link to the watch before JoyoFit opened one: \(held ? "yes" : "no")"
    }

    // MARK: write

    /// Every element in order, each cut to what one ATT write carries, one write in flight at a time, writes without response paced by
    /// `canSendWriteWithoutResponse`.
    public func write(_ frames: [Bytes]) async throws {
        try await writeLock.withLock {
            guard let (target, characteristic, type) = await onQueue({ () -> (CBPeripheral, CBCharacteristic, CBCharacteristicWriteType)? in
                guard !self.closed, let p = self.peripheral, let c = self.writeCharacteristic else { return nil }
                return (p, c, self.writeType)
            }) else {
                throw WearError(.disconnected, "Bluetooth LE link is closed or not ready")
            }
            for frame in frames {
                var offset = 0
                while offset < frame.count {
                    let allowed = await onQueue { target.maximumWriteValueLength(for: type) }
                    // At most what iOS says one write can carry (never more than an ATT value holds), in order.
                    let limit = allowed > 0 ? min(allowed, BleTransport.maxAttributeBytes) : BleTransport.defaultWriteBytes
                    let size = min(frame.count - offset, limit)
                    let chunk = (offset == 0 && size == frame.count) ? frame : Array(frame[offset..<(offset + size)])
                    chunksWritten += 1
                    var note = "TX chunk \(chunksWritten): \(chunk.count) bytes of max \(limit), \(BleTransport.headHex(chunk))"
                    if allowed != lastMaxWrite {
                        lastMaxWrite = allowed
                        note += " (maximumWriteValueLength \(allowed) bytes \(type == .withoutResponse ? "without" : "with") response, frame \(frame.count) bytes)"
                        step(note)
                    } else if chunksWritten <= BleTransport.supportLoggedChunks {
                        step(note)
                    } else {
                        WearConsole.ble(note)
                    }
                    if type == .withoutResponse {
                        try await awaitStep(.writeReady, what: "write", timeoutMs: BleTransport.writeMs) {
                            if target.canSendWriteWithoutResponse { self.finish(.writeReady, .success(())) }
                        }
                        await onQueue { target.writeValue(Data(chunk), for: characteristic, type: .withoutResponse) }
                    } else {
                        try await awaitStep(.write, what: "write", timeoutMs: BleTransport.writeMs) {
                            target.writeValue(Data(chunk), for: characteristic, type: .withResponse)
                        }
                    }
                    offset += size
                }
            }
        }
    }

    // MARK: CBPeripheralDelegate

    public func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        finish(.services, error.map { .failure(WearError(.connectFailed, "Service discovery failed: \($0.localizedDescription)", underlying: $0)) } ?? .success(()))
    }

    public func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        finish(
            .characteristics(service.uuid.uuidString),
            error.map { .failure(WearError(.connectFailed, "Characteristic discovery failed: \($0.localizedDescription)", underlying: $0)) } ?? .success(())
        )
    }

    public func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        step("GATT characteristic \(characteristic.uuid.uuidString) notifying \(characteristic.isNotifying)\(error.map { ", error: \($0.localizedDescription)" } ?? "")")
        if characteristic.uuid != readUuid { return }
        if let error {
            finish(.notify, .failure(WearError(.connectFailed, "Enabling notifications failed: \(error.localizedDescription)", underlying: error)))
        } else {
            finish(.notify, .success(()))
        }
    }

    public func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard characteristic.uuid == readUuid, error == nil, !closed, let value = characteristic.value, !value.isEmpty else { return }
        let chunk = Bytes(value)
        WearConsole.ble("RX \(chunk.count) bytes \(BleTransport.headHex(chunk))")
        // Delivered on the central's serial queue, so the order of the notifications is the order of the session's input.
        delegate?.transportDidReceive(chunk)
    }

    public func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        if let error {
            finish(.write, .failure(WearError(.disconnected, "GATT write failed: \(error.localizedDescription)", underlying: error)))
        } else {
            finish(.write, .success(()))
        }
    }

    public func peripheralIsReady(toSendWriteWithoutResponse peripheral: CBPeripheral) {
        finish(.writeReady, .success(()))
    }

    public func peripheral(_ peripheral: CBPeripheral, didModifyServices invalidatedServices: [CBService]) {
        step("GATT services changed: \(invalidatedServices.map(\.uuid.uuidString).joined(separator: ", "))")
    }

    // MARK: connection callbacks, routed from BleCentral (on `queue`)

    func didConnect() {
        step("GATT connection state CONNECTED")
        finish(.connect, .success(()))
    }

    func didFailToConnect(_ error: Error?) {
        step("GATT connection failed: \(error?.localizedDescription ?? "no error")")
        if BondRemoved.isCause(error) {
            finish(.connect, .failure(WearError(.connectFailed, BondRemoved.message, underlying: error)))
            return
        }
        finish(.connect, .failure(WearError(.connectFailed, "Bluetooth LE connect failed: \(error?.localizedDescription ?? "unknown error")", underlying: error)))
    }

    func didDisconnect(_ error: Error?) {
        step("GATT connection state DISCONNECTED\(error.map { ", \($0.localizedDescription)" } ?? "")")
        if cancelRequested {
            // The disconnect our own cancel asked for: it ends a pending attempt or a stale link, it is not the watch dropping us.
            cancelRequested = false
            if pending[.disconnect] != nil { finish(.disconnect, .success(())) }
            return
        }
        if pending[.disconnect] != nil { finish(.disconnect, .success(())) }
        linkLost(WearError(.disconnected, "Bluetooth LE link ended: \(error?.localizedDescription ?? "the watch ended the connection")", underlying: error))
    }

    func radioChanged(_ state: CBManagerState) {
        queue.async {
            switch state {
            case .poweredOff:
                self.linkLost(WearError(.bluetoothOff, "Bluetooth was turned off"))
            case .unauthorized:
                self.linkLost(WearError(.bluetoothPermission, "Bluetooth access was revoked"))
            default:
                self.linkLost(WearError(.disconnected, "Bluetooth is \(BleCentral.describe(state))"))
            }
        }
    }

    /// The link ended: fails whatever waits for the watch, and tells the delegate if `connect` already returned. On `queue`.
    private func linkLost(_ cause: WearError) {
        if closed { return }
        failAll(cause)
        if !ready {
            // Between the first connect step and `connect` returning: remember it, `connect` checks.
            lostBeforeReady = cause
            return
        }
        closed = true
        release()
        delegate?.transportDidClose(cause)
    }

    // MARK: pending steps

    /// Starts one GATT operation with `start` (on `queue`) and waits for the callback that completes `step`; fails on timeout, on a lost
    /// link and on cancellation.
    private func awaitStep(_ step: Step, what: String, timeoutMs: Int?, start: @escaping () -> Void) async throws {
        let token = UUID()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
                queue.async {
                    if self.cancelled.remove(token) != nil {
                        c.resume(throwing: CancellationError())
                        return
                    }
                    if self.closed {
                        c.resume(throwing: WearError(.disconnected, "Bluetooth LE link is closed"))
                        return
                    }
                    if let lost = self.lostBeforeReady, !self.ready {
                        c.resume(throwing: lost)
                        return
                    }
                    self.pending[step] = Pending(token: token, continuation: c)
                    if let ms = timeoutMs {
                        self.queue.asyncAfter(deadline: .now() + .milliseconds(ms)) {
                            self.finish(step, token: token, .failure(WearError(.timeout, "\(what): no answer from the watch within \(ms) ms")))
                        }
                    }
                    start()
                }
            }
        } onCancel: {
            queue.async {
                if self.pending.values.contains(where: { $0.token == token }) {
                    self.finish(step, token: token, .failure(CancellationError()))
                } else {
                    self.cancelled.insert(token)
                }
            }
        }
    }

    /// Completes the waiting step; callable from any thread (hops onto `queue`).
    private func finish(_ step: Step, token: UUID? = nil, _ result: Result<Void, Error>) {
        let run = {
            guard let waiting = self.pending[step], token == nil || waiting.token == token else { return }
            self.pending[step] = nil
            waiting.continuation.resume(with: result)
        }
        queue.async(execute: run)
    }

    private func failAll(_ error: Error) {
        let all = pending
        pending = [:]
        for (_, waiting) in all { waiting.continuation.resume(throwing: error) }
    }

    private func release() {
        if let target = peripheral {
            central.cancel(target)
        }
        if registered {
            registered = false
            central.unregister(self, for: identifier)
        }
        if let extra = extraRoute {
            extraRoute = nil
            central.unregister(self, for: extra)
        }
        peripheral = nil
        writeCharacteristic = nil
        readCharacteristic = nil
    }

    // MARK: helpers

    /// Runs `body` on the central's queue and returns its result.
    private func onQueue<T>(_ body: @escaping () -> T) async -> T {
        await withCheckedContinuation { (c: CheckedContinuation<T, Never>) in
            queue.async { c.resume(returning: body()) }
        }
    }

    /// The first bytes of a packet, enough to see the 0x5A frame start, length, service and command.
    static func headHex(_ bytes: Bytes) -> String { Bytes(bytes.prefix(8)).hexLower }

    /// The write types a characteristic allows, for the log.
    static func writeKinds(_ characteristic: CBCharacteristic?) -> String {
        guard let characteristic else { return "unknown" }
        var kinds: [String] = []
        if characteristic.properties.contains(.writeWithoutResponse) { kinds.append("write without response") }
        if characteristic.properties.contains(.write) { kinds.append("write with response") }
        return kinds.isEmpty ? "no write" : kinds.joined(separator: " and ")
    }
}

#endif
