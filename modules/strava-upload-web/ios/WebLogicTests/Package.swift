// swift-tools-version:5.9
import PackageDescription

// Logic tests for the pure part of the iOS StravaUploadWeb module (WebPolicy.swift), runnable on Linux and macOS.
// The target's only source is a symlink to ../../WebPolicy.swift: the file the CocoaPods pod compiles.
let package = Package(
    name: "WebLogicTests",
    platforms: [.iOS(.v15), .macOS(.v12)],
    targets: [
        .target(name: "WebLogic"),
        .testTarget(name: "WebLogicTests", dependencies: ["WebLogic"]),
    ]
)
