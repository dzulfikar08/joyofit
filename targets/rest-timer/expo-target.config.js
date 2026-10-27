/**
 * Live Activity of the rest timer (WidgetKit extension with an ActivityConfiguration): the countdown on the lock screen and in the
 * Dynamic Island while the logger rests between sets. Built by @bacons/apple-targets during `expo prebuild`; docs/strength.md,
 * "Rest timer on the lock screen".
 *
 * - Bundle id com.joyodigitama.joyofit.resttimer (the app's id plus ".resttimer"); it needs its own App ID and App Store profile in the
 *   Apple Developer portal, like the app. No App Group: the app hands the activity its content through ActivityKit, not shared storage.
 * - iOS 16.4 like the app. ActivityKit's content API needs 16.2; the Swift code is @available(iOS 16.2, *).
 * - `NSSupportsLiveActivities` is set in app.json (ios.infoPlist), on the app, not here.
 * - RestTimerAttributes.swift is the same file as modules/rest-timer/ios/RestTimerAttributes.swift (src/features/strength/restLiveLogic.test.ts
 *   compares them). It is not under `_shared`: the app target does not use the type, the RestTimer pod (a separate Swift module) does.
 *
 * @type {import('@bacons/apple-targets/app.plugin').ConfigFunction}
 */
module.exports = () => ({
  type: 'widget',
  name: 'RestTimerActivity',
  displayName: 'Rest timer',
  bundleIdentifier: '.resttimer',
  deploymentTarget: '16.4',
});
