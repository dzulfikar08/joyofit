// CoreMotion side of a workout: the phone's pedometer. `CMPedometer.startUpdates(from:)` reports the steps counted since the counter
// started, cumulative, on every update (about once a second while walking), delivered through `onUpdate`. `shared` counts for a workout
// recorded on the phone, `live` for the live screen of a workout started on the watch: two pedometers, so neither stops the other.
#if canImport(CoreMotion)
@preconcurrency import CoreMotion
import Foundation

final class WorkoutSteps: @unchecked Sendable {
    static let shared = WorkoutSteps()
    static let live = WorkoutSteps()

    /// How long `requestPermission` waits for the user to answer the system prompt.
    static let promptTimeoutSeconds = 120.0

    private let lock = NSLock()
    private let pedometer = CMPedometer()
    private var running = false

    private init() {}

    private static func map(_ status: CMAuthorizationStatus) -> String {
        switch status {
        case .authorized: return "granted"
        case .notDetermined: return "undetermined"
        default: return "denied"
        }
    }

    /// granted, denied, undetermined (the first start raises the prompt) or unavailable (no step counter in this device).
    func permission() -> String {
        guard CMPedometer.isStepCountingAvailable() else { return "unavailable" }
        return WorkoutSteps.map(CMPedometer.authorizationStatus())
    }

    /// Raises the system prompt by running a one-second query, and answers with the state once the person chose. Never throws.
    func requestPermission() async -> String {
        let current = permission()
        if current != "undetermined" { return current }
        let probe = CMPedometer()
        return await withCheckedContinuation { (continuation: CheckedContinuation<String, Never>) in
            let once = Once()
            let answer: @Sendable () -> Void = {
                guard once.first() else { return }
                probe.stopUpdates()
                continuation.resume(returning: WorkoutSteps.shared.permission())
            }
            // The completion runs once the system has an answer (data, or an error when it is denied).
            probe.queryPedometerData(from: Date(timeIntervalSinceNow: -1), to: Date()) { _, _ in answer() }
            DispatchQueue.global().asyncAfter(deadline: .now() + WorkoutSteps.promptTimeoutSeconds) { answer() }
        }
    }

    /// Starts updates counted from now. Returns false when the pedometer is unavailable or the person refused it. Calling it while running does nothing.
    func start(_ onUpdate: @escaping @Sendable (_ tsMs: Int64, _ steps: Int) -> Void) -> Bool {
        guard CMPedometer.isStepCountingAvailable() else { return false }
        let status = CMPedometer.authorizationStatus()
        guard status == .authorized || status == .notDetermined else { return false }
        let already: Bool = lock.withLock {
            let was = running
            running = true
            return was
        }
        if already { return true }
        pedometer.startUpdates(from: Date()) { data, error in
            if let error = error {
                NSLog("BleSensors: pedometer error \(error.localizedDescription)")
                return
            }
            guard let data = data else { return }
            onUpdate(Int64(data.endDate.timeIntervalSince1970 * 1000), data.numberOfSteps.intValue)
        }
        return true
    }

    func stop() {
        let was: Bool = lock.withLock {
            let w = running
            running = false
            return w
        }
        if was { pedometer.stopUpdates() }
    }
}

/// Lets exactly one of several racing completions through.
private final class Once: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false

    func first() -> Bool {
        lock.withLock {
            if done { return false }
            done = true
            return true
        }
    }
}
#endif
