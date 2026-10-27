// Expo module `RestTimer` for iOS: the JS API of src/RestTimer.ts as a Live Activity (ActivityKit, iOS 16.2+). The module only starts,
// updates and ends the activity; the lock screen and Dynamic Island views live in the widget extension (targets/rest-timer), and the clock
// is `Text(timerInterval:countsDown:)`, drawn by the system, so nothing here runs while the rest counts down.
//
// An activity can only be requested while the app is in the foreground, which is where the logger's rest timer starts (a tap on a set's
// tick). Updating and ending work from the background too, but the logger does them from the foreground as well.
//
// Calls return at once. The work runs in call order (each call waits for the one before it), so a stop never overtakes the start before it.
#if canImport(ExpoModulesCore) && canImport(ActivityKit)
import ActivityKit
import ExpoModulesCore

@available(iOS 16.2, *)
private final class RestTimerController {
    private let lock = NSLock()
    private var tail: Task<Void, Never>?
    /// Touched only inside queued work, which runs one piece at a time.
    private var activity: Activity<RestTimerAttributes>?

    func enqueue(_ work: @escaping (RestTimerController) async -> Void) {
        lock.lock()
        defer { lock.unlock() }
        let previous = tail
        tail = Task {
            await previous?.value
            await work(self)
        }
    }

    /// The running activity, also one left by an app that was killed and relaunched while the rest was still counting.
    private func running() -> Activity<RestTimerAttributes>? {
        if let activity, Self.isLive(activity) { return activity }
        activity = Activity<RestTimerAttributes>.activities.first(where: Self.isLive)
        return activity
    }

    /// `.stale` is an activity whose rest ran out while the app was suspended: still on the lock screen, so it is reused, not doubled.
    private static func isLive(_ activity: Activity<RestTimerAttributes>) -> Bool {
        activity.activityState == .active || activity.activityState == .stale
    }

    func start(_ state: RestTimerAttributes.ContentState) async {
        // Stale at the end: the system marks the activity then (the widget shows 0:00) while the app may be suspended and cannot end it.
        let content = ActivityContent(state: state, staleDate: state.endsAt)
        if let current = running() {
            await current.update(content)
            return
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        activity = try? Activity.request(attributes: RestTimerAttributes(), content: content, pushType: nil)
    }

    func stop() async {
        for current in Activity<RestTimerAttributes>.activities {
            await current.end(nil, dismissalPolicy: .immediate)
        }
        activity = nil
    }
}

public final class RestTimerModule: Module {
    private var controller: Any?

    public func definition() -> ModuleDefinition {
        Name("RestTimer")

        Function("isSupported") { () -> Bool in
            guard #available(iOS 16.2, *) else { return false }
            return ActivityAuthorizationInfo().areActivitiesEnabled
        }

        Function("startRestTimer") { (endsAt: Double, title: String, body: String, _: String) -> Void in
            guard #available(iOS 16.2, *) else { return }
            let state = RestTimerAttributes.ContentState(endsAt: Date(timeIntervalSince1970: endsAt / 1000), title: title, body: body)
            // A rest that is already over is not shown.
            guard state.endsAt > Date() else {
                self.controllerInstance().enqueue { await $0.stop() }
                return
            }
            self.controllerInstance().enqueue { await $0.start(state) }
        }

        Function("stopRestTimer") { () -> Void in
            guard #available(iOS 16.2, *) else { return }
            self.controllerInstance().enqueue { await $0.stop() }
        }
    }

    @available(iOS 16.2, *)
    private func controllerInstance() -> RestTimerController {
        if let existing = controller as? RestTimerController { return existing }
        let created = RestTimerController()
        controller = created
        return created
    }
}
#endif
