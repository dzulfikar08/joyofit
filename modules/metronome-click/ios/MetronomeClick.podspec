# iOS side of the MetronomeClick Expo module: plays the metronome's synthesized click with AVAudioPlayer in a mixable AVAudioSession.
# ClickSound.swift is Foundation only so ClickLogicTests can compile it on Linux; CocoaPods compiles *.swift in this directory only, so the
# test package is excluded.
Pod::Spec.new do |s|
  s.name           = 'MetronomeClick'
  s.version        = '1.0.0'
  s.summary        = 'Metronome click for JoyoFit, mixed with other audio'
  s.description    = 'Expo module: a short synthesized click played through AVAudioPlayer in a .playback session with .mixWithOthers.'
  s.license        = 'AGPL-3.0-or-later'
  s.author         = 'JoyoDigitama'
  s.homepage       = 'https://fit.joyorogo.com'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }

  s.source_files  = ['*.swift']
  s.exclude_files = ['ClickLogicTests/**/*']
end
