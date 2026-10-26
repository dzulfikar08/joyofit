// CoreMotion side of a workout: the phone's pedometer. `CMPedometer.startUpdates(from:)` reports the steps counted since the counter
// started, cumulative, on every update (about once a second or two while walking, only while the app runs), with the pedometer's own
// cadence when it has one; delivered through `onUpdate` as the `onSteps` / `onLiveSteps` payload. `shared` counts for a workout recorded
// on the phone, `live` for the live screen of a workout started on the watch: two pedometers, so neither stops the other.
//
// It logs (unified logging, category `JoyoFit`, `label` names the run): the start, the first update, every 30 s what arrived
// (StepsLog.swift), and the stop.
#if canImport(CoreMotion)
@preconcurrency import CoreMotion
import Foundation
import os

final class WorkoutSteps: @unchecked Sendable {
    static let shared = WorkoutSteps(label: "recording")
    static let live = WorkoutSteps(label: "live")

    /// How long `requestPermission` waits for the user to answer the system prompt.
    static let promptTimeoutSeconds = 120.0
    /// How often the log says what the pedometer delivered.
    static let summarySeconds = 30

    private static let logger = Logger(subsystem: "com.joyodigitama.joyofit", category: "JoyoFit")

    private let label: String
    private let lock = NSLock()
    private let pedometer = CMPedometer()
    private let queue: DispatchQueue
    private var running = false
    /// The current run's log, its steps so far and its summary timer; under `lock`.
    private var log: StepsLog?
    private var steps = 0
    private var timer: DispatchSourceTimer?

    private init(label: String) {
        self.label = label
        queue = DispatchQueue(label: "com.joyodigitama.blesensors.steps.\(label)")
    }

    private static func map(_ status: CMAuthorizationStatus) -> String {
        switch status {
        case .authorized: return "granted"
        case .notDetermined: return "undetermined"
        default: return "denied"
        }
    }

    private static func info(_ line: String) {
        logger.notice("\(line, privacy: .public)")
    }

    private static func nowMs() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
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
    func start(_ onUpdate: @escaping @Sendable (_ payload: [String: Any?]) -> Void) -> Bool {
        guard CMPedometer.isStepCountingAvailable() else {
            WorkoutSteps.info("Phone steps (\(label)): not started: no step counter in this phone")
            return false
        }
        let status = CMPedometer.authorizationStatus()
        guard status == .authorized || status == .notDetermined else {
            WorkoutSteps.info("Phone steps (\(label)): not started: motion permission \(WorkoutSteps.map(status))")
            return false
        }
        let startDate = Date()
        let startedMs = Int64(startDate.timeIntervalSince1970 * 1000)
        let started: String? = lock.withLock {
            if running { return nil }
            running = true
            let log = StepsLog(label: label, startedMs: startedMs)
            self.log = log
            steps = 0
            timer = makeTimer()
            return log.started(cadenceAvailable: CMPedometer.isCadenceAvailable())
        }
        guard let started else { return true }
        WorkoutSteps.info(started)
        let label = self.label
        pedometer.startUpdates(from: startDate) { [weak self] data, error in
            if let error = error {
                WorkoutSteps.info("Phone steps (\(label)): pedometer error \(error.localizedDescription)")
                return
            }
            guard let data = data, let self = self else { return }
            let tsMs = Int64(data.endDate.timeIntervalSince1970 * 1000)
            let count = data.numberOfSteps.intValue
            // CMPedometerData gives steps per second.
            let cadence = data.currentCadence.map { $0.doubleValue * 60 }.flatMap { $0 > 0 ? $0 : nil }
            let first: String? = self.lock.withLock {
                self.steps = count
                return self.log?.update(nowMs: WorkoutSteps.nowMs(), endMs: tsMs, steps: count, cadenceSpm: cadence)
            }
            if let first { WorkoutSteps.info(first) }
            var payload: [String: Any?] = ["ts": tsMs, "steps": count]
            if let cadence { payload["cadence"] = cadence }
            onUpdate(payload)
        }
        return true
    }

    func stop() {
        let stopped: String? = lock.withLock {
            guard running else { return nil }
            running = false
            timer?.cancel()
            timer = nil
            let line = log?.stopped(nowMs: WorkoutSteps.nowMs(), steps: steps)
            log = nil
            return line
        }
        guard let stopped else { return }
        pedometer.stopUpdates()
        WorkoutSteps.info(stopped)
    }

    /// The running summary timer; called under `lock` (its handler takes the lock on its own queue).
    private func makeTimer() -> DispatchSourceTimer {
        let timer = DispatchSource.makeTimerSource(queue: queue)
        let period = DispatchTimeInterval.seconds(WorkoutSteps.summarySeconds)
        timer.schedule(deadline: .now() + period, repeating: period)
        timer.setEventHandler { [weak self] in
            guard let self = self else { return }
            let line: String? = self.lock.withLock { self.log?.summary(nowMs: WorkoutSteps.nowMs(), steps: self.steps) }
            if let line { WorkoutSteps.info(line) }
        }
        timer.resume()
        return timer
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
