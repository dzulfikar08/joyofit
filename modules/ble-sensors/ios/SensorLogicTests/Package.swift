// swift-tools-version:5.9
import PackageDescription

// Logic tests for the pure part of the iOS BleSensors module, runnable on Linux and macOS. The target's sources are symlinks to the
// Foundation-only files the CocoaPods pod compiles (../../SensorProfile.swift, ScaleLogic.swift, StepsLog.swift).
let package = Package(
    name: "SensorLogicTests",
    platforms: [.iOS(.v15), .macOS(.v12)],
    targets: [
        .target(name: "SensorLogic"),
        .testTarget(name: "SensorLogicTests", dependencies: ["SensorLogic"]),
    ]
)
