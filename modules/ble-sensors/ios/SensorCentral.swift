// CoreBluetooth transport for external sensors: scanning, one self-healing `SensorLink` per desired sensor, raw characteristic bytes out as hex.
// It never parses a payload (the shared TypeScript parser does). It owns a CBCentralManager of its own on its own serial queue, with no restore
// identifier, so it is independent from the Huawei watch central of modules/huawei-wear. Everything below runs on `queue`: CoreBluetooth delivers
// the central and peripheral delegate callbacks there, and every public entry point hops onto it first, so no state needs a lock.
#if canImport(CoreBluetooth)
import CoreBluetooth
import Foundation

/// A failure that reaches JS as a coded exception (see BleSensorsModule.swift).
struct SensorError: Error {
    let code: String
    let message: String

    static let permission = SensorError(code: "ERR_BLUETOOTH_PERMISSION", message: "Bluetooth permission is not granted")
    static let off = SensorError(code: "ERR_BLUETOOTH_OFF", message: "Bluetooth is turned off")
    static let unavailable = SensorError(code: "ERR_BLUETOOTH_UNAVAILABLE", message: "Bluetooth LE is not available on this device")
    static func invalidId(_ id: String) -> SensorError {
        SensorError(code: "ERR_INVALID_ARGUMENT", message: "'\(id)' is not a sensor identifier (a peripheral UUID from onScanResult)")
    }
}

typealias EventSink = @Sendable (String, [String: Any?]) -> Void

private func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

private func log(_ message: String) { NSLog("BleSensors: %@", message) }

final class SensorCentral: NSObject, CBCentralManagerDelegate, @unchecked Sendable {
    static let shared = SensorCentral()
    static let scanSeconds: TimeInterval = 20
    /// How long the first call waits for the radio state (the system Bluetooth prompt may be on screen).
    private static let settleSeconds: TimeInterval = 30

    let queue = DispatchQueue(label: "com.joyodigitama.blesensors.central")

    private let sinkLock = NSLock()
    private var sink: EventSink?
    private var sinkOwner: ObjectIdentifier?

    private var _manager: CBCentralManager?
    private(set) var radio = "unknown"
    private var radioWaiters: [CheckedContinuation<String, Never>] = []

    private var links: [UUID: SensorLink] = [:]
    private var userScan = false
    private var scanGeneration = 0
    private var centralScanning = false

    private override init() { super.init() }

    // MARK: events

    /// Installed by the module while it is alive; events are dropped while nil (the links keep running).
    func setSink(owner: AnyObject, _ newSink: @escaping EventSink) {
        sinkLock.withLock {
            sink = newSink
            sinkOwner = ObjectIdentifier(owner)
        }
    }

    /// A module instance created by a reload may have replaced the sink already; only the owner clears it.
    func clearSink(owner: AnyObject) {
        sinkLock.withLock {
            guard sinkOwner == ObjectIdentifier(owner) else { return }
            sink = nil
            sinkOwner = nil
        }
    }

    func emit(_ name: String, _ payload: [String: Any?]) {
        let current = sinkLock.withLock { sink }
        current?(name, payload)
    }

    // MARK: radio

    private static func map(_ state: CBManagerState) -> String {
        switch state {
        case .poweredOn: return "on"
        case .poweredOff: return "off"
        case .unauthorized: return "unauthorized"
        case .unsupported: return "unsupported"
        default: return "unknown"
        }
    }

    /// Creating the manager is what raises the system Bluetooth permission prompt. Queue only.
    var manager: CBCentralManager {
        if let existing = _manager { return existing }
        let created = CBCentralManager(delegate: self, queue: queue, options: [CBCentralManagerOptionShowPowerAlertKey: false])
        _manager = created
        radio = SensorCentral.map(created.state)
        return created
    }

    private func onQueue<T>(_ body: @escaping () -> T) async -> T {
        await withCheckedContinuation { (continuation: CheckedContinuation<T, Never>) in
            queue.async { continuation.resume(returning: body()) }
        }
    }

    private func flushRadioWaiters() {
        let pending = radioWaiters
        radioWaiters = []
        for waiter in pending { waiter.resume(returning: radio) }
    }

    /// The radio state once CoreBluetooth has one (it starts as unknown until the first delegate callback).
    private func settledRadio() async -> String {
        await withCheckedContinuation { (continuation: CheckedContinuation<String, Never>) in
            queue.async {
                _ = self.manager
                if self.radio != "unknown" {
                    continuation.resume(returning: self.radio)
                    return
                }
                self.radioWaiters.append(continuation)
                self.queue.asyncAfter(deadline: .now() + SensorCentral.settleSeconds) { self.flushRadioWaiters() }
            }
        }
    }

    func requireOn() async throws {
        switch await settledRadio() {
        case "on": return
        case "off": throw SensorError.off
        case "unauthorized": throw SensorError.permission
        default: throw SensorError.unavailable
        }
    }

    func bluetoothState() async -> String { await settledRadio() }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        let state = SensorCentral.map(central.state)
        guard state != radio else { return }
        radio = state
        if state != "unknown" { flushRadioWaiters() }
        emit("onBluetoothState", ["state": state])
        if state == "on" {
            for link in links.values { link.radioOn() }
        } else {
            let reason = state == "off" ? "Bluetooth turned off" : "Bluetooth unavailable"
            for link in links.values { link.radioLost(reason) }
            if userScan { endUserScan(error: state == "off" ? SensorError.off.code : SensorError.permission.code) }
        }
        refreshScan()
    }

    // MARK: scan

    func startScan() async throws {
        try await requireOn()
        await onQueue {
            self.scanGeneration += 1
            let generation = self.scanGeneration
            let began = !self.userScan
            self.userScan = true
            self.refreshScan()
            if began { self.emit("onScanState", ["scanning": true, "error": nil as String?]) }
            self.queue.asyncAfter(deadline: .now() + SensorCentral.scanSeconds) {
                if self.scanGeneration == generation { self.endUserScan(error: nil) }
            }
        }
    }

    func stopScan() async {
        await onQueue { self.endUserScan(error: nil) }
    }

    private func endUserScan(error: String?) {
        guard userScan else { return }
        userScan = false
        scanGeneration += 1
        refreshScan()
        emit("onScanState", ["scanning": false, "error": error])
    }

    /// One radio scan serves both the JS scan and links that look for their peripheral. Queue only.
    func refreshScan() {
        let needed = radio == "on" && (userScan || links.values.contains { $0.isSearching })
        if needed && !centralScanning {
            let services = SensorProfile.scanServices.map { CBUUID(string: $0) }
            manager.scanForPeripherals(withServices: services, options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
            centralScanning = true
        } else if !needed && centralScanning {
            manager.stopScan()
            centralScanning = false
        }
    }

    func centralManager(
        _ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber
    ) {
        if userScan {
            let advertised = (advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID]) ?? []
            let services = advertised.compactMap { SensorProfile.short($0.uuidString) }.filter { SensorProfile.scanServices.contains($0) }
            let name = peripheral.name ?? (advertisementData[CBAdvertisementDataLocalNameKey] as? String)
            emit(
                "onScanResult",
                ["id": peripheral.identifier.uuidString, "name": name, "rssi": RSSI.intValue, "services": services]
            )
        }
        links[peripheral.identifier]?.found(peripheral)
    }

    // MARK: links

    private static func parse(_ id: String) throws -> UUID {
        guard let uuid = UUID(uuidString: id) else { throw SensorError.invalidId(id) }
        return uuid
    }

    func connect(_ id: String) async throws {
        let uuid = try SensorCentral.parse(id)
        try await requireOn()
        await onQueue {
            if let existing = self.links[uuid] {
                existing.emitState()
                return
            }
            let link = SensorLink(id: uuid, central: self)
            self.links[uuid] = link
            link.begin()
        }
    }

    func disconnect(_ id: String) async {
        guard let uuid = UUID(uuidString: id) else { return }
        await onQueue { self.remove(uuid) }
    }

    func disconnectAll() async {
        await onQueue { for uuid in Array(self.links.keys) { self.remove(uuid) } }
    }

    private func remove(_ uuid: UUID) {
        guard let link = links.removeValue(forKey: uuid) else { return }
        link.teardown()
        emit("onConnection", ["id": uuid.uuidString, "state": "disconnected", "services": [String](), "error": nil as String?])
        refreshScan()
    }

    func connectionStates() async -> [[String: Any?]] {
        await onQueue { self.links.values.map { $0.payload } }
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        links[peripheral.identifier]?.didConnect()
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        links[peripheral.identifier]?.didFail(error?.localizedDescription ?? "Connection failed")
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        links[peripheral.identifier]?.didFail(error?.localizedDescription ?? "Disconnected by the sensor")
    }
}

/// One desired sensor: connects, sets up the GATT plan, reconnects forever with a growing delay. Queue-confined.
final class SensorLink: NSObject, CBPeripheralDelegate {
    private enum Phase { case idle, searching, connecting, discovering, setup, ready }
    private enum Awaiting: Equatable { case none, read(String), notifyState(String) }

    private static let discoverySeconds: TimeInterval = 15
    private static let stepSeconds: TimeInterval = 10

    let id: UUID
    private unowned let central: SensorCentral
    private var phase = Phase.idle
    private var state = "disconnected"
    private var lastError: String?
    private var services: [String] = []
    private var peripheral: CBPeripheral?
    private var attempt = 0
    private var retryWork: DispatchWorkItem?
    private var watchdogGeneration = 0

    private var pendingCharacteristicDiscoveries = 0
    private var characteristics: [String: CBCharacteristic] = [:]
    private var steps: [GattStep] = []
    private var stepIndex = 0
    private var awaiting = Awaiting.none

    init(id: UUID, central: SensorCentral) {
        self.id = id
        self.central = central
        super.init()
    }

    var isSearching: Bool { phase == .searching }

    var payload: [String: Any?] { ["id": id.uuidString, "state": state, "services": services, "error": lastError] }

    func emitState() { central.emit("onConnection", payload) }

    private func setState(_ newState: String, services newServices: [String], error: String?) {
        state = newState
        services = newServices
        lastError = error
        emitState()
    }

    // MARK: lifecycle

    func begin() { attemptConnect() }

    private func attemptConnect() {
        retryWork = nil
        guard central.radio == "on" else { return }
        setState("connecting", services: [], error: nil)
        if peripheral == nil { peripheral = central.manager.retrievePeripherals(withIdentifiers: [id]).first }
        guard let target = peripheral else {
            // iOS does not know this peripheral yet (new launch, or it was never seen): wait for it to advertise.
            phase = .searching
            central.refreshScan()
            return
        }
        startConnect(target)
    }

    private func startConnect(_ target: CBPeripheral) {
        phase = .connecting
        peripheral = target
        target.delegate = self
        central.manager.connect(target, options: nil)
    }

    /// The scan saw this sensor while the link was searching for it.
    func found(_ discovered: CBPeripheral) {
        guard phase == .searching else { return }
        startConnect(discovered)
        central.refreshScan()
    }

    func didConnect() {
        guard phase == .connecting, let target = peripheral else { return }
        phase = .discovering
        arm(SensorLink.discoverySeconds) { [weak self] in self?.lose("GATT discovery timed out") }
        target.discoverServices(SensorProfile.discoveryServices.map { CBUUID(string: $0) })
    }

    func didFail(_ reason: String) {
        guard phase != .idle, phase != .searching else { return }
        lose(reason)
    }

    /// The link is gone: release it, report, and retry after the backoff delay.
    private func lose(_ reason: String) {
        let wasSearching = phase == .searching
        release()
        log("\(id.uuidString) lost: \(reason)")
        setState("disconnected", services: [], error: reason)
        if wasSearching { central.refreshScan() }
        guard central.radio == "on" else { return }
        let delay = Double(Backoff.nextDelayMs(attempt: attempt)) / 1000
        attempt += 1
        let work = DispatchWorkItem { [weak self] in self?.attemptConnect() }
        retryWork = work
        central.queue.asyncAfter(deadline: .now() + delay, execute: work)
    }

    /// Cancels timers and the GATT connection and forgets the setup state; keeps the peripheral for the next attempt.
    private func release() {
        disarm()
        retryWork?.cancel()
        retryWork = nil
        let active = phase == .connecting || phase == .discovering || phase == .setup || phase == .ready
        if active, let target = peripheral { central.manager.cancelPeripheralConnection(target) }
        phase = .idle
        characteristics.removeAll()
        steps = []
        stepIndex = 0
        awaiting = .none
        pendingCharacteristicDiscoveries = 0
    }

    func radioLost(_ reason: String) {
        // The radio drops the connection by itself, and a peripheral object may not survive a reset.
        release()
        peripheral = nil
        if state != "disconnected" { setState("disconnected", services: [], error: reason) }
    }

    func radioOn() {
        guard phase == .idle, retryWork == nil else { return }
        attempt = 0
        attemptConnect()
    }

    /// `disconnect(id)`: the central reports the final state.
    func teardown() {
        release()
        peripheral?.delegate = nil
        peripheral = nil
    }

    // MARK: watchdog

    private func arm(_ seconds: TimeInterval, _ action: @escaping () -> Void) {
        watchdogGeneration += 1
        let generation = watchdogGeneration
        central.queue.asyncAfter(deadline: .now() + seconds) { [weak self] in
            guard let self, self.watchdogGeneration == generation else { return }
            action()
        }
    }

    private func disarm() { watchdogGeneration += 1 }

    // MARK: discovery and the GATT plan

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard phase == .discovering else { return }
        if let error { return lose("Service discovery failed: \(error.localizedDescription)") }
        let found = (peripheral.services ?? []).filter { service in
            SensorProfile.short(service.uuid.uuidString).map(SensorProfile.discoveryServices.contains) ?? false
        }
        let shortIds = found.compactMap { SensorProfile.short($0.uuid.uuidString) }
        guard shortIds.contains(where: SensorProfile.sensorServices.contains) else { return lose("no supported service") }
        pendingCharacteristicDiscoveries = found.count
        for service in found {
            let wanted = SensorProfile.table.filter { $0.service == SensorProfile.short(service.uuid.uuidString) }.map { CBUUID(string: $0.characteristic) }
            peripheral.discoverCharacteristics(wanted, for: service)
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard phase == .discovering else { return }
        if let error { log("\(id.uuidString) characteristic discovery of \(service.uuid.uuidString) failed: \(error.localizedDescription)") }
        pendingCharacteristicDiscoveries -= 1
        guard pendingCharacteristicDiscoveries <= 0 else { return }

        var foundMap: [String: [String: GattProperties]] = [:]
        characteristics = [:]
        for service in peripheral.services ?? [] {
            guard let serviceId = SensorProfile.short(service.uuid.uuidString) else { continue }
            for characteristic in service.characteristics ?? [] {
                guard let characteristicId = SensorProfile.short(characteristic.uuid.uuidString) else { continue }
                foundMap[serviceId, default: [:]][characteristicId] = GattProperties(rawValue: Int(characteristic.properties.rawValue))
                characteristics["\(serviceId)/\(characteristicId)"] = characteristic
            }
        }
        steps = SensorProfile.plan(found: foundMap)
        stepIndex = 0
        phase = .setup
        runNext()
    }

    private func runNext() {
        disarm()
        guard let target = peripheral else { return }
        guard stepIndex < steps.count else { return finishSetup() }
        switch steps[stepIndex] {
        case .read(let service, let characteristic):
            let key = "\(service)/\(characteristic)"
            guard let item = characteristics[key] else { return advance("read of \(key): characteristic missing") }
            awaiting = .read(key)
            target.readValue(for: item)
        case .subscribe(let service, let characteristic, _):
            let key = "\(service)/\(characteristic)"
            guard let item = characteristics[key] else { return advance("subscribe to \(key): characteristic missing") }
            awaiting = .notifyState(key)
            target.setNotifyValue(true, for: item)
        }
        arm(SensorLink.stepSeconds) { [weak self] in self?.advance("step timed out") }
    }

    /// Skips the current step (a sensor that refuses one item must not fail the link) and runs the next.
    private func advance(_ skipReason: String?) {
        if let skipReason { log("\(id.uuidString) skipped: \(skipReason)") }
        stepIndex += 1
        awaiting = .none
        runNext()
    }

    private func finishSetup() {
        phase = .ready
        attempt = 0
        awaiting = .none
        let found = Set((peripheral?.services ?? []).compactMap { SensorProfile.short($0.uuid.uuidString) })
        let supported = SensorProfile.scanServices.filter { found.contains($0) }
        setState("connected", services: supported, error: nil)
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        guard phase == .setup, let key = key(of: characteristic), awaiting == .notifyState(key) else { return }
        advance(error.map { "notifications of \(key) refused: \($0.localizedDescription)" })
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        let ts = nowMs()
        guard phase == .setup || phase == .ready, let key = key(of: characteristic) else { return }
        let isAwaitedRead = awaiting == .read(key)
        if let error {
            if isAwaitedRead { advance("read of \(key) failed: \(error.localizedDescription)") }
            return
        }
        if let value = characteristic.value, let service = characteristic.service,
            let serviceId = SensorProfile.short(service.uuid.uuidString), let characteristicId = SensorProfile.short(characteristic.uuid.uuidString)
        {
            central.emit(
                "onValue",
                ["id": id.uuidString, "ts": ts, "service": serviceId, "characteristic": characteristicId, "value": hexString(value)]
            )
        }
        if isAwaitedRead { advance(nil) }
    }

    private func key(of characteristic: CBCharacteristic) -> String? {
        guard let service = characteristic.service, let serviceId = SensorProfile.short(service.uuid.uuidString),
            let characteristicId = SensorProfile.short(characteristic.uuid.uuidString)
        else { return nil }
        return "\(serviceId)/\(characteristicId)"
    }
}
#endif
