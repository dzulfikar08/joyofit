// swift-tools-version:5.9
import PackageDescription

// Logic tests for the pure part of the iOS MetronomeClick module (ClickSound.swift), runnable on Linux and macOS.
// The target's only source is a symlink to ../../ClickSound.swift: the file the CocoaPods pod compiles.
let package = Package(
    name: "ClickLogicTests",
    platforms: [.iOS(.v15), .macOS(.v12)],
    targets: [
        .target(name: "ClickLogic"),
        .testTarget(name: "ClickLogicTests", dependencies: ["ClickLogic"]),
    ]
)
