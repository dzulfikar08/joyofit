# iOS side of the StravaUploadWeb Expo module: a WKWebView for strava.com's upload page that answers the page's file request with the
# workout's FIT file (iOS 18.4+). WebPolicy.swift is Foundation only so WebLogicTests can compile it on Linux; CocoaPods compiles *.swift in
# this directory only, so the test package is excluded.
Pod::Spec.new do |s|
  s.name           = 'StravaUploadWeb'
  s.version        = '1.0.0'
  s.summary        = 'Web view for the manual Strava file upload in JoyoFit'
  s.description    = 'Expo module: a WKWebView on strava.com/upload/select whose file request is answered with a file JS names.'
  s.license        = 'AGPL-3.0-or-later'
  s.author         = 'JoyoDigitama'
  s.homepage       = 'https://fit.joyorogo.com'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WebKit'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }

  s.source_files  = ['*.swift']
  s.exclude_files = ['WebLogicTests/**/*']
end
