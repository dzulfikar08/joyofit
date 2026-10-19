// Expo module `BleSensors` for iOS: the JS API of src/BleSensorsModule.ts. Sensor links live in the process-wide SensorCentral, the phone GPS in
// WorkoutLocation. The module only forwards their events to JS while it is alive; destroying it (a JS reload) never drops a sensor link or a
// running workout session.
#if canImport(ExpoModulesCore) && canImport(CoreBluetooth)
import CoreBluetooth
import ExpoModulesCore
import Foundation

/// A failure that reaches JS as a coded exception (`ERR_...` is the code on the JS error).
final class BleSensorsException: Exception, @unchecked Sendable {
    init(_ code: String, _ message: String, file: String = #fileID, line: UInt = #line, function: String = #function) {
        super.init(name: "BleSensorsException", description: message, code: code, file: file, line: line, function: function)
    }
}

/// Runs `body` and turns the transport's `SensorError` into the coded exception JS sees.
private func bleCall<T>(_ body: () async throws -> T) async throws -> T {
    do {
        return try await body()
    } catch let error as SensorError {
        throw BleSensorsException(error.code, error.message)
    }
}

/// The workout session is process-wide like the links, so a recreated module instance still sees it.
private enum WorkoutSession {
    private static let lock = NSLock()
    private static var _active = false

    static var active: Bool {
        get { lock.withLock { _active } }
        set { lock.withLock { _active = newValue } }
    }
}

public final class BleSensorsModule: Module {
    public func definition() -> ModuleDefinition {
        let central = SensorCentral.shared
        let location = WorkoutLocation.shared
        let scales = ScaleCentral.shared

        Name("BleSensors")

        Events(
            "onScanResult", "onScanState", "onConnection", "onValue", "onLocation", "onBluetoothState", "onWorkoutAction",
            "onScaleAdvertisement", "onScaleScanState", "onScaleLink", "onScaleValue"
        )

        OnCreate {
            let module = self
            central.setSink(owner: module) { [weak module] name, payload in module?.sendEvent(name, payload) }
        }

        // Sensor links and the workout session keep running: a recording may continue across a JS reload.
        OnDestroy {
            central.clearSink(owner: self)
        }

        AsyncFunction("bluetoothState") { () async -> String in
            await central.bluetoothState()
        }

        AsyncFunction("startScan") { () async throws -> Void in
            try await bleCall { try await central.startScan() }
        }

        AsyncFunction("stopScan") { () async -> Void in
            await central.stopScan()
        }

        // Bathroom scales: the transport behind src/features/scale. See BleSensorsModule.ts for the contract.
        AsyncFunction("startScaleScan") { (ids: [String], durationMs: Int, lowLatency: Bool) async throws -> Void in
            try await bleCall { try await scales.startScan(ids: ids, durationMs: durationMs) }
        }

        AsyncFunction("stopScaleScan") { () async -> Void in
            await scales.stopScan()
        }

        AsyncFunction("scaleConnect") { (id: String) async throws -> Void in
            try await bleCall { try await scales.connect(id) }
        }

        AsyncFunction("scaleDisconnect") { (id: String) async -> Void in
            await scales.disconnect(id)
        }

        AsyncFunction("scaleSubscribe") { (id: String, service: String, characteristic: String) async throws -> Void in
            try await bleCall {
                try await scales.operation(id: id, kind: .subscribe, service: service, characteristic: characteristic, value: nil, withResponse: false)
            }
        }

        AsyncFunction("scaleRead") { (id: String, service: String, characteristic: String) async throws -> Void in
            try await bleCall {
                try await scales.operation(id: id, kind: .read, service: service, characteristic: characteristic, value: nil, withResponse: false)
            }
        }

        AsyncFunction("scaleWrite") { (id: String, service: String, characteristic: String, hex: String, withResponse: Bool) async throws -> Void in
            guard let bytes = ScaleLogic.fromHex(hex) else { throw BleSensorsException("ERR_INVALID_ARGUMENT", "Not hex: \(hex)") }
            try await bleCall {
                try await scales.operation(id: id, kind: .write, service: service, characteristic: characteristic, value: bytes, withResponse: withResponse)
            }
        }

        AsyncFunction("connect") { (id: String) async throws -> Void in
            try await bleCall { try await central.connect(id) }
        }

        AsyncFunction("disconnect") { (id: String) async -> Void in
            await central.disconnect(id)
        }

        AsyncFunction("disconnectAll") { () async -> Void in
            await central.disconnectAll()
        }

        AsyncFunction("connectionStates") { () async -> [[String: Any?]] in
            await central.connectionStates()
        }

        AsyncFunction("locationPermission") { () async -> String in
            location.permission()
        }

        AsyncFunction("requestLocationPermission") { () async -> String in
            await location.requestPermission()
        }

        // `options` is WorkoutSessionOptions: title, text, gps and `openUrl` and `controls` (the Android notification's link and buttons). Only `gps` matters here: iOS has no notification.
        AsyncFunction("startWorkoutSession") { (options: [String: Any]) async throws -> Void in
            let gps = options["gps"] as? Bool ?? false
            if gps {
                guard location.permission() == "granted" else {
                    throw BleSensorsException("ERR_LOCATION_PERMISSION", "Precise location is not granted")
                }
                _ = location.start { fix in central.emit("onLocation", fix.payload) }
            } else {
                location.stop()
            }
            WorkoutSession.active = true
        }

        // The notification only exists on Android (its numbers, chronometer and buttons).
        AsyncFunction("updateWorkoutSession") { (state: [String: Any]) async -> Void in }

        AsyncFunction("endWorkoutSession") { () async -> Void in
            location.stop()
            WorkoutSession.active = false
        }

        Function("isWorkoutSessionActive") { () -> Bool in
            WorkoutSession.active
        }
    }
}
#endif
