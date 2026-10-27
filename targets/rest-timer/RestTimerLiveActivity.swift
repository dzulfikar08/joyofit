// The rest timer on the lock screen and in the Dynamic Island. The app starts and updates the activity (modules/rest-timer/ios); this only
// draws it. The clock is `Text(timerInterval:countsDown:)`: the system keeps it ticking with no help from the app, which may be suspended.
// Copy ("Istirahat", the exercise name) arrives in the content state, in the app's language; the extension has no strings of its own.
import ActivityKit
import SwiftUI
import WidgetKit

/// Where a tap goes: the logger (`scheme` in app.json, route /strength/active), as the Android notification does.
private let openLogger = URL(string: "joyofit://strength/active")

/// The brand teal of the app (app.json, expo-notifications `color`).
private let accent = Color(red: 10 / 255, green: 101 / 255, blue: 128 / 255)

/// Now to the end of the rest. A range whose start is after its end traps, so a rest that is over gives an empty one: the clock reads 0:00.
private func remaining(until end: Date) -> ClosedRange<Date> {
    min(Date(), end)...end
}

@available(iOS 16.2, *)
struct RestTimerLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RestTimerAttributes.self) { context in
            LockScreenView(state: context.state)
                .activityBackgroundTint(Color(.systemBackground).opacity(0.85))
                .activitySystemActionForegroundColor(accent)
                .widgetURL(openLogger)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "timer").font(.title2).foregroundStyle(accent)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(timerInterval: remaining(until: context.state.endsAt), countsDown: true, showsHours: false)
                        .font(.title2.monospacedDigit().weight(.semibold))
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 80, alignment: .trailing)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.state.title).font(.headline).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(context.state.body).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                }
            } compactLeading: {
                Image(systemName: "timer").foregroundStyle(accent)
            } compactTrailing: {
                Text(timerInterval: remaining(until: context.state.endsAt), countsDown: true, showsHours: false)
                    .font(.caption.monospacedDigit().weight(.semibold))
                    .multilineTextAlignment(.trailing)
                    .frame(width: 44)
            } minimal: {
                Image(systemName: "timer").foregroundStyle(accent)
            }
            .widgetURL(openLogger)
            .keylineTint(accent)
        }
    }
}

@available(iOS 16.2, *)
private struct LockScreenView: View {
    let state: RestTimerAttributes.ContentState

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(state.title).font(.subheadline.weight(.semibold)).foregroundStyle(accent)
                Text(state.body).font(.headline).lineLimit(1)
            }
            Spacer(minLength: 8)
            Text(timerInterval: remaining(until: state.endsAt), countsDown: true, showsHours: false)
                .font(.system(size: 36, weight: .semibold).monospacedDigit())
                .multilineTextAlignment(.trailing)
                .frame(maxWidth: 120, alignment: .trailing)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}
