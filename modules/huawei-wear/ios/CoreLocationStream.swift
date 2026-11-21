// `LiveGpsSource` over CoreLocation: best-accuracy fixes while a workout runs. With the `location` background mode declared,
// fixes keep flowing when the app is backgrounded or the screen is locked, matching the Run recorder.
#if canImport(CoreLocation)
import CoreLocation
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

public final class CoreLocationStream: NSObject, LiveGpsSource, CLLocationManagerDelegate, @unchecked Sendable {
    /// How long a caller of `requestAuthorization` waits for the user to answer the system prompt.
    static let promptTimeoutMs = 120_000

    private let lock = NSLock()
    private var _manager: CLLocationManager?
    private var handler: (@Sendable (WorkoutLinkWire.Fix) -> Void)?
    private var waiters: [CheckedContinuation<LocationAuthorization, Never>] = []

    public override init() { super.init() }

    private func manager() -> CLLocationManager {
        if let existing = lock.locked({ _manager }) { return existing }
        let make = { () -> CLLocationManager in
            let manager = CLLocationManager()
            manager.desiredAccuracy = kCLLocationAccuracyBest
            manager.distanceFilter = kCLDistanceFilterNone
            manager.activityType = .fitness
            manager.pausesLocationUpdatesAutomatically = false
            manager.delegate = self
            return manager
        }
        let manager = Thread.isMainThread ? make() : DispatchQueue.main.sync(execute: make)
        return lock.locked {
            if let existing = _manager { return existing }
            _manager = manager
            return manager
        }
    }

    private static func map(_ status: CLAuthorizationStatus) -> LocationAuthorization {
        switch status {
        case .authorizedAlways, .authorizedWhenInUse: return .granted
        case .notDetermined: return .notDetermined
        default: return .denied
        }
    }

    public var authorization: LocationAuthorization { CoreLocationStream.map(manager().authorizationStatus) }

    public func requestAuthorization() async -> LocationAuthorization {
        let manager = manager()
        let current = CoreLocationStream.map(manager.authorizationStatus)
        if current != .notDetermined { return current }
        return await withCheckedContinuation { (continuation: CheckedContinuation<LocationAuthorization, Never>) in
            lock.locked { waiters.append(continuation) }
            DispatchQueue.main.async { manager.requestWhenInUseAuthorization() }
            Task { [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(CoreLocationStream.promptTimeoutMs) * 1_000_000)
                self?.resolve()
            }
        }
    }

    private func resolve() {
        let status = CoreLocationStream.map(manager().authorizationStatus)
        let pending: [CheckedContinuation<LocationAuthorization, Never>] = lock.locked {
            let w = waiters
            waiters = []
            return w
        }
        for waiter in pending { waiter.resume(returning: status) }
    }

    /// Whether the app declared the `location` background mode; setting allowsBackgroundLocationUpdates without it raises an exception.
    private static var declaresBackgroundLocation: Bool {
        let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String]
        return modes?.contains("location") ?? false
    }

    public func start(_ onFix: @escaping @Sendable (WorkoutLinkWire.Fix) -> Void) -> Bool {
        guard authorization == .granted else { return false }
        lock.locked { handler = onFix }
        let manager = manager()
        DispatchQueue.main.async {
            if CoreLocationStream.declaresBackgroundLocation {
                manager.allowsBackgroundLocationUpdates = true
                manager.showsBackgroundLocationIndicator = true
            }
            manager.startUpdatingLocation()
        }
        return true
    }

    public func stop() {
        lock.locked { handler = nil }
        guard let manager = lock.locked({ _manager }) else { return }
        DispatchQueue.main.async {
            manager.stopUpdatingLocation()
            if CoreLocationStream.declaresBackgroundLocation {
                manager.showsBackgroundLocationIndicator = false
                manager.allowsBackgroundLocationUpdates = false
            }
        }
    }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus != .notDetermined { resolve() }
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let onFix = lock.locked({ handler }) else { return }
        for location in locations {
            // CoreLocation marks a value it does not have with a negative number (speed, course, accuracy).
            onFix(
                WorkoutLinkWire.Fix(
                    latitude: location.coordinate.latitude, longitude: location.coordinate.longitude,
                    timeMs: Int64(location.timestamp.timeIntervalSince1970 * 1000),
                    speed: location.speed >= 0 ? location.speed : nil,
                    altitude: location.verticalAccuracy >= 0 ? location.altitude : nil,
                    bearing: location.course >= 0 ? location.course : nil,
                    accuracy: location.horizontalAccuracy >= 0 ? location.horizontalAccuracy : nil
                )
            )
        }
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}
}
#endif
