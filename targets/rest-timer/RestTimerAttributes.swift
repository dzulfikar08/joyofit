// The Live Activity of a rest between sets. THIS FILE EXISTS TWICE, byte for byte: here (compiled into the RestTimer pod, which starts and
// updates the activity) and in targets/rest-timer/ (compiled into the widget extension, which draws it). ActivityKit matches the two sides by
// the name of this type and decodes the content with Codable, so the copies must agree on the name and every field.
// src/features/strength/restLiveLogic.test.ts fails when they differ. Edit both.
#if canImport(ActivityKit)
import ActivityKit
import Foundation

@available(iOS 16.2, *)
struct RestTimerAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// When the rest ends. The widget counts down to it by itself (`Text(timerInterval:countsDown:)`), so nothing has to push a tick.
        var endsAt: Date
        /// First line, e.g. "Istirahat" (copy comes from the app's i18n: the extension has no strings of its own).
        var title: String
        /// Second line, the exercise name.
        var body: String
    }
}
#endif
