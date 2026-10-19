// CoreBluetooth transport for bathroom scales, the iOS twin of ScaleRadio.kt and ScaleLink.kt: an UNFILTERED scan (a scale that broadcasts its
// weight hides it in manufacturer data, there is no service to filter by) and one GATT link per scale being weighed on. It moves bytes only:
// advertisements go to JS as `onScaleAdvertisement`, GATT as `onScaleLink` / `onScaleValue`; which device is a scale and what a frame means is
// decided by the TypeScript decoders (src/features/scale/protocols). It shares the serial queue, the event sink and the radio state of
// `SensorCentral`, but owns a CBCentralManager of its own so the sensor scan and the scale scan never fight over one scan.
// An unfiltered scan works in the foreground only (iOS drops it in the background), which is all a weigh-in needs.
#if canImport(CoreBluetooth)
import CoreBluetooth
import Foundation

private func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

private func log(_ message: String) { NSLog("BleSensors: %@", message) }

private let scaleNotConnected = "ERR_SCALE_NOT_CONNECTED"
private let scaleNoCharacteristic = "ERR_SCALE_NO_CHARACTERISTIC"
private let scaleOperationRefused = "ERR_SCALE_OPERATION_REFUSED"
private let scaleGattPrefix = "ERR_SCALE_GATT_"

final class ScaleCentral: NSObject, CBCentralManagerDelegate, @unchecked Sendable {
    static let shared = ScaleCentral()
    private static let repeatMs: Int64 = 2000
    private static let minScanSeconds: Double = 5
    private static let maxScanSeconds: Double = 180

    private let sensors = SensorCentral.shared
    private var queue: DispatchQueue { sensors.queue }

    private var _manager: CBCentralManager?
    private var scanning = false
    private var scanGeneration = 0
    private var wanted: Set<UUID>?
    private var throttle = AdvertisementThrottle(repeatMs: ScaleCentral.repeatMs)
    private var seen: [UUID: CBPeripheral] = [:]
    private var links: [UUID: ScaleGatt] = [:]

    private override init() { super.init() }

    /// Creating the manager raises the system Bluetooth prompt if that has not happened yet (SensorCentral did it when it settled the radio). Queue only.
    private var manager: CBCentralManager {
        if let existing = _manager { return existing }
        let created = CBCentralManager(delegate: self, queue: queue, options: [CBCentralManagerOptionShowPowerAlertKey: false])
        _manager = created
        return created
    }

    private func onQueue<T>(_ body: @escaping () -> T) async -> T {
        await withCheckedContinuation { (continuation: CheckedContinuation<T, Never>) in
            queue.async { continuation.resume(returning: body()) }
        }
    }

    func emit(_ name: String, _ payload: [String: Any?]) { sensors.emit(name, payload) }

    // MARK: scan

    /// `ids` restricts the scan to those peripheral identifiers (a scale picked earlier); empty reports everything around.
    func startScan(ids: [String], durationMs: Int) async throws {
        try await sensors.requireOn()
        await onQueue {
            _ = self.manager
            self.wanted = ids.isEmpty ? nil : Set(ids.compactMap { UUID(uuidString: $0) })
            self.scanGeneration += 1
            let generation = self.scanGeneration
            let seconds = min(max(Double(durationMs) / 1000, ScaleCentral.minScanSeconds), ScaleCentral.maxScanSeconds)
            if !self.scanning {
                self.throttle.clear()
                self.scanning = true
                self.beginScanning()
                self.emit("onScaleScanState", ["scanning": true, "error": nil as String?])
            }
            self.queue.asyncAfter(deadline: .now() + seconds) {
                if self.scanGeneration == generation { self.endScan(error: nil) }
            }
        }
    }

    func stopScan() async {
        await onQueue { self.endScan(error: nil) }
    }

    private func beginScanning() {
        guard manager.state == .poweredOn else { return }
        manager.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
    }

    private func endScan(error: String?) {
        guard scanning else { return }
        scanning = false
        scanGeneration += 1
        if manager.state == .poweredOn { manager.stopScan() }
        emit("onScaleScanState", ["scanning": false, "error": error])
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state == .poweredOn {
            if scanning { beginScanning() }
            return
        }
        let reason = central.state == .poweredOff ? "Bluetooth turned off" : "Bluetooth unavailable"
        endScan(error: central.state == .poweredOff ? SensorError.off.code : SensorError.permission.code)
        for link in links.values { link.ended(reason, linkDown: true) }
    }

    func centralManager(
        _ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber
    ) {
        guard scanning else { return }
        let id = peripheral.identifier
        if let filter = wanted, !filter.contains(id) { return }
        seen[id] = peripheral

        var serviceUuids: [String] = []
        for uuid in (advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID]) ?? [] { serviceUuids.append(ScaleLogic.normalize(uuid.uuidString)) }
        var serviceData: [String: String] = [:]
        if let data = advertisementData[CBAdvertisementDataServiceDataKey] as? [CBUUID: Data] {
            for (uuid, bytes) in data { serviceData[ScaleLogic.normalize(uuid.uuidString)] = hexString(bytes) }
        }
        var manufacturerData: [String: String] = [:]
        var manufacturerHex = ""
        if let blob = advertisementData[CBAdvertisementDataManufacturerDataKey] as? Data {
            manufacturerHex = hexString(blob)
            if let split = ScaleLogic.splitManufacturer(blob) { manufacturerData[split.key] = split.payloadHex }
        }
        let name = (advertisementData[CBAdvertisementDataLocalNameKey] as? String) ?? peripheral.name

        let now = nowMs()
        let fingerprint = "\(name ?? "")|\(manufacturerHex)|\(serviceData.sorted { $0.key < $1.key })|\(serviceUuids.sorted())"
        guard throttle.shouldEmit(id: id.uuidString, fingerprint: fingerprint, now: now) else { return }
        emit(
            "onScaleAdvertisement",
            [
                "id": id.uuidString, "name": name, "rssi": RSSI.intValue, "ts": Double(now),
                "serviceUuids": serviceUuids, "serviceData": serviceData, "manufacturerData": manufacturerData,
            ]
        )
    }

    // MARK: links

    private static func parse(_ id: String) throws -> UUID {
        guard let uuid = UUID(uuidString: id) else { throw SensorError.invalidId(id) }
        return uuid
    }

    func connect(_ id: String) async throws {
        let uuid = try ScaleCentral.parse(id)
        try await sensors.requireOn()
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            queue.async {
                guard let peripheral = self.seen[uuid] ?? self.manager.retrievePeripherals(withIdentifiers: [uuid]).first else {
                    continuation.resume(throwing: SensorError.invalidId(id))
                    return
                }
                self.links.removeValue(forKey: uuid)?.stop()
                let link = ScaleGatt(peripheral: peripheral, central: self)
                self.links[uuid] = link
                link.begin()
                continuation.resume()
            }
        }
    }

    func disconnect(_ id: String) async {
        guard let uuid = UUID(uuidString: id) else { return }
        await onQueue { self.links.removeValue(forKey: uuid)?.stop() }
    }

    func operation(
        id: String, kind: ScaleGatt.Kind, service: String, characteristic: String, value: Data?, withResponse: Bool
    ) async throws {
        guard let uuid = UUID(uuidString: id) else { throw SensorError.invalidId(id) }
        let failure: String? = await withCheckedContinuation { (continuation: CheckedContinuation<String?, Never>) in
            queue.async {
                guard let link = self.links[uuid] else {
                    continuation.resume(returning: scaleNotConnected)
                    return
                }
                link.enqueue(
                    ScaleGatt.Op(
                        kind: kind, service: ScaleLogic.normalize(service), characteristic: ScaleLogic.normalize(characteristic),
                        value: value, withResponse: withResponse
                    ) { error in continuation.resume(returning: error) })
            }
        }
        if let failure { throw SensorError(code: failure, message: "Scale operation failed: \(failure)") }
    }

    func linkEnded(_ link: ScaleGatt) {
        if links[link.id] === link { links.removeValue(forKey: link.id) }
    }

    func connectPeripheral(_ peripheral: CBPeripheral) { manager.connect(peripheral, options: nil) }

    func cancelPeripheral(_ peripheral: CBPeripheral) { manager.cancelPeripheralConnection(peripheral) }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        links[peripheral.identifier]?.didConnect()
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        links[peripheral.identifier]?.ended(error?.localizedDescription ?? "Connection failed", linkDown: true)
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        links[peripheral.identifier]?.ended(error?.localizedDescription ?? "Disconnected by the scale", linkDown: true)
    }
}

/// One GATT connection to a scale, for a weigh-in: connect, discover everything, then do exactly what JS asks, one operation at a time.
/// No scale knowledge and no reconnect logic. Queue-confined.
final class ScaleGatt: NSObject, CBPeripheralDelegate {
    enum Kind { case subscribe, read, write }

    /// `done` gets nil on success, else an error code for JS.
    struct Op {
        let kind: Kind
        let service: String
        let characteristic: String
        let value: Data?
        let withResponse: Bool
        let done: (String?) -> Void
    }

    private static let connectSeconds: TimeInterval = 20
    private static let discoverySeconds: TimeInterval = 15
    private static let operationSeconds: TimeInterval = 10

    let id: UUID
    private let peripheral: CBPeripheral
    private unowned let central: ScaleCentral
    private var connected = false
    private var finished = false
    private var pendingCharacteristicDiscoveries = 0
    private var queued: [Op] = []
    private var inFlight: Op?
    private var watchdogGeneration = 0

    init(peripheral: CBPeripheral, central: ScaleCentral) {
        self.id = peripheral.identifier
        self.peripheral = peripheral
        self.central = central
        super.init()
        peripheral.delegate = self
    }

    // MARK: lifecycle

    func begin() {
        publish("connecting", services: [], error: nil)
        central.connectPeripheral(peripheral)
        arm(ScaleGatt.connectSeconds, "connecting")
    }

    /// JS is done with this scale: queued operations fail, no `disconnected` error.
    func stop() { finish(nil, linkDown: false) }

    func ended(_ reason: String, linkDown: Bool) { finish(reason, linkDown: linkDown) }

    func didConnect() {
        guard !finished else { return }
        arm(ScaleGatt.discoverySeconds, "service discovery")
        peripheral.discoverServices(nil)
    }

    private func finish(_ reason: String?, linkDown: Bool) {
        guard !finished else { return }
        finished = true
        watchdogGeneration += 1
        log("scale \(id.uuidString): \(reason.map { "link failed: \($0)" } ?? "closed by request")")
        let pending = (inFlight.map { [$0] } ?? []) + queued
        inFlight = nil
        queued = []
        for op in pending { op.done(scaleNotConnected) }
        if !linkDown { central.cancelPeripheral(peripheral) }
        publish("disconnected", services: [], error: reason)
        central.linkEnded(self)
    }

    // MARK: discovery

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard !finished else { return }
        if let error {
            finish("Service discovery failed: \(error.localizedDescription)", linkDown: false)
            return
        }
        let services = peripheral.services ?? []
        if services.isEmpty {
            ready()
            return
        }
        pendingCharacteristicDiscoveries = services.count
        for service in services { peripheral.discoverCharacteristics(nil, for: service) }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard !finished else { return }
        pendingCharacteristicDiscoveries -= 1
        if pendingCharacteristicDiscoveries <= 0 { ready() }
    }

    private func ready() {
        watchdogGeneration += 1
        connected = true
        let services: [[String: Any?]] = (peripheral.services ?? []).map { service in
            [
                "uuid": ScaleLogic.normalize(service.uuid.uuidString),
                "characteristics": (service.characteristics ?? []).map { characteristic -> [String: Any?] in
                    [
                        "uuid": ScaleLogic.normalize(characteristic.uuid.uuidString),
                        "properties": ScaleLogic.propertyNames(Int(characteristic.properties.rawValue)),
                    ]
                },
            ]
        }
        publish("connected", services: services, error: nil)
    }

    // MARK: operations

    func enqueue(_ op: Op) {
        if finished || !connected {
            op.done(scaleNotConnected)
            return
        }
        queued.append(op)
        pump()
    }

    private func find(_ service: String, _ characteristic: String) -> CBCharacteristic? {
        for s in peripheral.services ?? [] where ScaleLogic.normalize(s.uuid.uuidString) == service {
            for c in s.characteristics ?? [] where ScaleLogic.normalize(c.uuid.uuidString) == characteristic { return c }
        }
        return nil
    }

    private func pump() {
        guard inFlight == nil, !finished else { return }
        while !queued.isEmpty {
            let op = queued.removeFirst()
            guard let target = find(op.service, op.characteristic) else {
                op.done(scaleNoCharacteristic)
                continue
            }
            switch op.kind {
            case .read:
                inFlight = op
                arm(ScaleGatt.operationSeconds, "read \(op.characteristic)")
                peripheral.readValue(for: target)
                return
            case .subscribe:
                inFlight = op
                arm(ScaleGatt.operationSeconds, "subscribe \(op.characteristic)")
                peripheral.setNotifyValue(true, for: target)
                return
            case .write:
                guard let value = op.value else {
                    op.done("ERR_INVALID_ARGUMENT")
                    continue
                }
                let wantsResponse = op.withResponse || !target.properties.contains(.writeWithoutResponse)
                if wantsResponse {
                    inFlight = op
                    arm(ScaleGatt.operationSeconds, "write \(op.characteristic)")
                    peripheral.writeValue(value, for: target, type: .withResponse)
                    return
                }
                // Without response there is no confirmation; it is complete once CoreBluetooth took it.
                peripheral.writeValue(value, for: target, type: .withoutResponse)
                op.done(nil)
            }
        }
    }

    private func complete(_ error: Error?) {
        watchdogGeneration += 1
        guard let op = inFlight else { return }
        inFlight = nil
        op.done(error == nil ? nil : scaleGattPrefix + String((error as NSError?)?.code ?? -1))
        pump()
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        if inFlight?.kind == .subscribe { complete(error) }
    }

    func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        if inFlight?.kind == .write { complete(error) }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        let ts = nowMs()
        if error == nil, let value = characteristic.value, !finished {
            let owner = characteristic.service as CBService?
            central.emit(
                "onScaleValue",
                [
                    "id": id.uuidString, "ts": Double(ts),
                    "service": ScaleLogic.normalize(owner?.uuid.uuidString ?? ""),
                    "characteristic": ScaleLogic.normalize(characteristic.uuid.uuidString),
                    "value": hexString(value),
                ]
            )
        }
        if let op = inFlight, op.kind == .read, op.characteristic == ScaleLogic.normalize(characteristic.uuid.uuidString) { complete(error) }
    }

    // MARK: watchdog and events

    private func arm(_ seconds: TimeInterval, _ reason: String) {
        watchdogGeneration += 1
        let generation = watchdogGeneration
        central.sensorsQueue.asyncAfter(deadline: .now() + seconds) { [weak self] in
            guard let self, self.watchdogGeneration == generation, !self.finished else { return }
            self.finish("\(reason) timed out", linkDown: false)
        }
    }

    private func publish(_ state: String, services: [[String: Any?]], error: String?) {
        central.emit("onScaleLink", ["id": id.uuidString, "state": state, "services": services, "error": error])
    }
}

extension ScaleCentral {
    var sensorsQueue: DispatchQueue { SensorCentral.shared.queue }
}
#endif
