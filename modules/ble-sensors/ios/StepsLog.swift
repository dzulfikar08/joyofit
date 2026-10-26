// The device-log lines of a pedometer run (WorkoutSteps.swift, the `JoyoFit` category like the watch link's; the twin of the Android
// StepLog.kt): what the pedometer really delivers, so the log of a walk shows whether its updates come every second or two, late, or not
// at all, and whether they carry a cadence. Foundation only, so SensorLogicTests compiles it on Linux; every time is passed in (Unix ms).
import Foundation

struct StepsLog {
    let label: String
    let startedMs: Int64
    private var periodStartMs: Int64
    private var lastArrivalMs: Int64
    private var stepsAtPeriodStart = 0
    private var updates = 0
    private var allUpdates = 0
    private var withCadence = 0
    private var lastCadence: Double?
    private var longestGapMs: Int64 = 0
    private var maxDelayMs: Int64?

    init(label: String, startedMs: Int64) {
        self.label = label
        self.startedMs = startedMs
        periodStartMs = startedMs
        lastArrivalMs = startedMs
    }

    func started(cadenceAvailable: Bool) -> String {
        "Phone steps (\(label)): started; CMPedometer, cadence \(cadenceAvailable ? "available" : "not available")"
    }

    /// An update arriving at `nowMs`, its data ending at `endMs`. Returns the line of the first update, else nil.
    mutating func update(nowMs: Int64, endMs: Int64, steps: Int, cadenceSpm: Double?) -> String? {
        longestGapMs = max(longestGapMs, nowMs - lastArrivalMs)
        lastArrivalMs = nowMs
        let delay = nowMs - endMs
        maxDelayMs = max(maxDelayMs ?? delay, delay)
        updates += 1
        allUpdates += 1
        if let cadenceSpm {
            withCadence += 1
            lastCadence = cadenceSpm
        }
        guard allUpdates == 1 else { return nil }
        return "Phone steps (\(label)): first update \(seconds(nowMs - startedMs)) after the start, \(steps) steps, cadence "
            + "\(cadenceSpm.map { "\(Int($0.rounded())) spm" } ?? "none"), stamped \(seconds(delay)) before it arrived"
    }

    /// The line of the period since the last one, at `nowMs` with `steps` counted so far; starts the next period.
    mutating func summary(nowMs: Int64, steps: Int) -> String {
        let gap = max(longestGapMs, nowMs - lastArrivalMs)
        let cadence = withCadence > 0 ? "\(withCadence) with a cadence, last \(Int((lastCadence ?? 0).rounded())) spm" : "none with a cadence"
        let line = "Phone steps (\(label)): \(seconds(nowMs - periodStartMs)): \(updates) updates (\(cadence)), "
            + "+\(steps - stepsAtPeriodStart) steps (total \(steps)), longest gap \(seconds(gap)), max delay \(maxDelayMs.map(seconds) ?? "-")"
        periodStartMs = nowMs
        stepsAtPeriodStart = steps
        updates = 0
        withCadence = 0
        longestGapMs = 0
        maxDelayMs = nil
        return line
    }

    func stopped(nowMs: Int64, steps: Int) -> String {
        "Phone steps (\(label)): stopped after \(seconds(nowMs - startedMs)): total \(steps) steps, \(allUpdates) updates"
    }
}

private func seconds(_ ms: Int64) -> String {
    String(format: "%.1f s", Double(ms) / 1000)
}
