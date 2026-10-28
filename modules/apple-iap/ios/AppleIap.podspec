Pod::Spec.new do |s|
  s.name           = 'AppleIap'
  s.version        = '1.0.0'
  s.summary        = 'StoreKit 2 purchases of JoyoRogo Pro for JoyoFit'
  s.description    = 'Local Expo module bridging StoreKit 2 so JoyoFit can sell JoyoRogo Pro on iOS without a third-party billing SDK.'
  s.license        = 'AGPL-3.0-or-later'
  s.homepage       = 'https://fit.joyorogo.com'
  s.authors        = 'JoyoDigitama'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.swift'
end
