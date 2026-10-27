# iOS side of the RestTimer Expo module: starts, updates and ends the Live Activity of a rest between sets (ActivityKit). The widget
# extension that draws it is targets/rest-timer (config plugin @bacons/apple-targets); RestTimerAttributes.swift is compiled into both and a
# bun test (src/features/strength/restLiveLogic.test.ts) fails when the two copies differ.
Pod::Spec.new do |s|
  s.name           = 'RestTimer'
  s.version        = '1.0.0'
  s.summary        = 'Rest timer Live Activity for JoyoFit'
  s.description    = 'Expo module: a Live Activity with a countdown to the end of a rest between sets, on the lock screen and in the Dynamic Island.'
  s.license        = 'AGPL-3.0-or-later'
  s.author         = 'JoyoDigitama'
  s.homepage       = 'https://fit.joyorogo.com'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'ActivityKit'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }

  s.source_files = ['*.swift']
end
