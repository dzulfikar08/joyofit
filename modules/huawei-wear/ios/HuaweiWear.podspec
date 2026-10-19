# iOS side of the HuaweiWear Expo module.
#
# ONE pod, ONE Swift module (`HuaweiWear`): the pure-Swift protocol package (ios/HuaweiProtocol/Sources/HuaweiProtocol, Foundation only, no
# dependencies) is compiled into the pod together with the module's own sources. Code in the pod never writes `import HuaweiProtocol`: that name
# only exists in the SwiftPM package (its Linux tests) and in the logic tests under ios/ModuleLogicTests, which build the very same file set as one
# module too. CocoaPods compiles podspec source_files only, so Package.swift, the tests and the golden generator are excluded.
Pod::Spec.new do |s|
  s.name           = 'HuaweiWear'
  s.version        = '1.0.0'
  s.summary        = 'Huawei and Honor watch link for JoyoFit over Bluetooth LE'
  s.description    = 'Expo module that talks the Huawei watch protocol (HiChain3 auth, battery, activity and sleep sync) over CoreBluetooth and exports the data to Apple Health.'
  s.license        = 'AGPL-3.0-or-later'
  s.author         = 'JoyoDigitama'
  s.homepage       = 'https://fit.joyorogo.com'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # The SQLite library joyofit.db is opened with from JS; native code uses the same copy (SQLiteDatabase.swift), never Apple's libsqlite3.
  s.dependency 'ExpoSQLite'
  s.frameworks = 'CoreBluetooth', 'CoreLocation', 'HealthKit', 'Security', 'UIKit'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }

  s.source_files  = ['*.swift', 'HuaweiProtocol/Sources/HuaweiProtocol/**/*.swift']
  s.exclude_files = ['ModuleLogicTests/**/*', 'HuaweiProtocol/Tests/**/*', 'HuaweiProtocol/GoldenGen/**/*', 'scripts/**/*']
end
