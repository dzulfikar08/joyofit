// Expo module `HuaweiWear` for iOS: the same JS API as HuaweiWearModule.ts (and the Kotlin HuaweiWearModule.kt). All protocol work lives in
// WearLink, reached through the process-wide WearRuntime (WearApp.runtime) that the background controller shares; this class wires the TS
// contract to it and forwards runtime events (onStateChange / onBattery / onLog / onSyncComplete) to JS while the module is alive.
//
// Implemented for real: the link (getBondedDevices, connect, disconnect, getState, getDevice, getSupportReport, refreshBattery, syncActivity,
// forgetDevice), the background session, the user profile, the HealthKit export, the family monitoring upload and the satellite data exchange
// (getAgps, refreshAgps, cancelAgps). Everything else the Android module offers has no iOS
// counterpart or no ported protocol layer yet and keeps its name: getters answer with the inert status of InertStatus.swift, commands reject
// with ERR_UNSUPPORTED ("... not available on iOS yet"). Nothing claims to have reached the watch that did not.
#if canImport(ExpoModulesCore) && canImport(CoreBluetooth) && (canImport(SQLite3) || canImport(CSQLite))
import CoreBluetooth
import ExpoModulesCore
import Foundation
#if canImport(UIKit)
import UIKit
#endif
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

/// A failure that reaches JS as a coded exception, like the Android `WearException` (`ERR_...` is the code on the JS error).
final class WearException: Exception, @unchecked Sendable {
    init(_ error: WearError, file: String = #fileID, line: UInt = #line, function: String = #function) {
        super.init(name: "WearException", description: error.message, code: error.code.rawValue, file: file, line: line, function: function)
        self.cause = error.underlying
    }

    init(_ code: ErrorCode, _ message: String, file: String = #fileID, line: UInt = #line, function: String = #function) {
        super.init(name: "WearException", description: message, code: code.rawValue, file: file, line: line, function: function)
    }
}

/// The rejection of a command that is not available on iOS yet.
func iosUnsupported(_ what: String) -> WearException { WearException(.unsupported, Inert.message(what)) }

/// Runs `body` and turns the layer's `WearError` into the coded exception JS sees.
func wearCall<T>(_ body: () async throws -> T) async throws -> T {
    do {
        return try await body()
    } catch let e as WearError {
        throw WearException(e)
    }
}

/// Reads a JS number out of a dictionary value (JS numbers arrive as Double or Int).
private func number(_ value: Any?) -> Double? {
    switch value {
    case let d as Double: return d
    case let i as Int: return Double(i)
    case let n as NSNumber: return n.doubleValue
    default: return nil
    }
}

/// `UserProfile` of HuaweiWear.types.ts from the JS object; a missing or mistyped field is an invalid argument.
func parseUserProfile(_ raw: [String: Any]) throws -> UserProfileData {
    guard let height = number(raw["heightCm"]), let weight = number(raw["weightKg"]), let birth = number(raw["birthYear"]),
        let sex = raw["sex"] as? String, let goal = number(raw["dailyStepGoal"])
    else {
        throw WearException(.invalidArgument, "The profile needs heightCm, weightKg, birthYear, sex and dailyStepGoal")
    }
    return UserProfileData(heightCm: Int(height), weightKg: weight, birthYear: Int(birth), sex: sex, dailyStepGoal: Int(goal))
}

// MARK: unsupported definitions

/// A command with no arguments that rejects with ERR_UNSUPPORTED.
private func rejects(_ name: String) -> AnyDefinition {
    AsyncFunction(name) { () async throws -> Bool in throw iosUnsupported(name) }
}

private func rejects<A: AnyArgument>(_ name: String, _ a: A.Type) -> AnyDefinition {
    AsyncFunction(name) { (_: A) async throws -> Bool in throw iosUnsupported(name) }
}

private func rejects<A: AnyArgument, B: AnyArgument>(_ name: String, _ a: A.Type, _ b: B.Type) -> AnyDefinition {
    AsyncFunction(name) { (_: A, _: B) async throws -> Bool in throw iosUnsupported(name) }
}

private func rejects<A: AnyArgument, B: AnyArgument, C: AnyArgument>(_ name: String, _ a: A.Type, _ b: B.Type, _ c: C.Type) -> AnyDefinition {
    AsyncFunction(name) { (_: A, _: B, _: C) async throws -> Bool in throw iosUnsupported(name) }
}

/// A phone-side switch of a feature that is always off here: switching it off is already the state (resolves), switching it on rejects.
private func switchRejectingOn(_ name: String) -> AnyDefinition {
    AsyncFunction(name) { (enabled: Bool) async throws -> Void in
        if enabled { throw iosUnsupported(name) }
    }
}

public final class HuaweiWearModule: Module {
    private let runtime = WearApp.runtime
    private let bridge = EventBridge()
    private var listenerToken: UUID?

    /// Forwards runtime events to JS while the module is alive.
    private final class EventBridge: WearEvents, @unchecked Sendable {
        private let lock = NSLock()
        private var destroyed = false
        weak var module: HuaweiWearModule?

        func destroy() { lock.locked { destroyed = true } }

        private func emit(_ name: String, _ payload: [String: Any?]) {
            guard !lock.locked({ destroyed }), let module else { return }
            module.sendEvent(name, payload)
        }

        func state(_ state: LinkState, error: String?) { emit("onStateChange", ["state": state.rawValue, "error": error]) }
        func battery(_ level: Int) { emit("onBattery", ["level": level]) }
        func syncComplete(_ summary: SyncSummary) { emit("onSyncComplete", summary.toJS()) }
        func heartRate(bpm: Int, tsMs: Int64) { emit("onHeartRate", ["bpm": bpm, "ts": tsMs]) }
        func hrvProgress(secondsLeft: Int, beats: Int) { emit("onHrvProgress", ["secondsLeft": secondsLeft, "beats": beats]) }
        func uploadProgress(bytes: Int, total: Int) { emit("onUploadProgress", ["bytes": bytes, "total": total]) }
        func uploadResult(ok: Bool, fileName: String, code: Int?, message: String) {
            emit("onUploadResult", ["ok": ok, "fileName": fileName, "code": code, "message": message])
        }
        func faceCustomization(_ payload: [String: Any]) { emit("onFaceCustomization", payload) }
        /// `onHuaweiImportProgress`: not part of `WearEvents`; the import controller reports to the module that started it.
        func huaweiImportProgress(_ payload: [String: Any]) { emit("onHuaweiImportProgress", payload) }
        func watchMealLogged(_ payload: [String: Any]) { emit("onWatchMealLogged", payload) }
        func liveWorkout(_ payload: [String: Any]) { emit("onLiveWorkout", payload) }
        func log(_ entry: LogEntry) {
            emit(
                "onLog",
                [
                    "ts": Int64(Date().timeIntervalSince1970 * 1000),
                    "direction": entry.direction.rawValue,
                    "serviceId": entry.serviceId,
                    "commandId": entry.commandId,
                    "hex": entry.hex,
                    "message": entry.message,
                ]
            )
        }
    }

    public func definition() -> ModuleDefinition {
        let runtime = self.runtime
        let bridge = self.bridge

        Name("HuaweiWear")

        // iOS has no store-specific build: the app is signed and shipped by this project.
        Constant("distribution") { "sideload" }

        Events(
            "onStateChange", "onBattery", "onLog", "onSyncComplete", "onUploadProgress", "onUploadResult", "onHeartRate", "onWatchMealLogged",
            "onFaceCustomization", "onLiveWorkout", "onHrvProgress", "onHuaweiImportProgress", "onDeviceDiscovered", "onScanStateChange"
        )

        OnCreate {
            self.bridge.module = self
            self.listenerToken = runtime.addListener(self.bridge)
            runtime.ensureBackgroundRunning()
            runtime.family.attach()
        }

        OnAppBecomesActive {
            runtime.ensureBackgroundRunning()
            runtime.controller.nudge(reset: false)
            Task { await runtime.weather.pushIfDue("app foreground") }
        }

        OnDestroy {
            self.bridge.destroy()
            if let token = self.listenerToken { runtime.removeListener(token) }
            runtime.onModuleDestroyed()
        }

        // MARK: link

        AsyncFunction("getBondedDevices") { () async throws -> [[String: Any]] in
            try await wearCall { try await runtime.bondedDevices() }
        }

        // The list again with the scan result of the last 30 s ignored and a longer scan.
        AsyncFunction("refreshBondedDevices") { () async throws -> [[String: Any]] in
            try await wearCall { try await runtime.bondedDevices(refresh: true) }
        }

        // The user agreed to a first bind with this watch: the next connect may start it (otherwise connect rejects ERR_BIND_CONFIRMATION).
        Function("confirmBind") { (address: String) -> Void in
            runtime.confirmBind(address)
        }

        // Android only: a connect that may open Android's Bluetooth pairing when it moves from LE to Classic. iOS has no Classic link and no such pairing.
        Function("confirmPairing") { (address: String) -> Void in }

        // The Android Bluetooth LE scan button. iOS lists nearby watches by itself (getBondedDevices / refreshBondedDevices), so these three
        // exist only to keep the JS API the same: the events never fire, the list is empty and starting a scan is unsupported.
        rejects("startScan")
        AsyncFunction("stopScan") { () -> Void in }
        Function("getDiscoveredDevices") { () -> [[String: Any]] in [] }

        AsyncFunction("connect") { (address: String) async throws -> [String: Any] in
            try await wearCall { try await runtime.connectFromApp(address).toJS() }
        }

        AsyncFunction("disconnect") { () async throws -> Void in
            runtime.disconnectFromApp()
        }

        // The link outlives JS reloads when the background session owns it.
        Function("getState") { () -> String in
            runtime.link.currentState().rawValue
        }

        Function("getDevice") { () -> [String: Any]? in
            guard var info = runtime.link.deviceInfo() else { return nil }
            if let battery = runtime.status.battery { info.batteryLevel = battery }
            return info.toJS()
        }

        AsyncFunction("getSupportReport") { () async throws -> [String: Any] in
            runtime.supportReport()
        }

        AsyncFunction("refreshBattery") { () async throws -> Int in
            try await wearCall { try await runtime.link.refreshBattery() }
        }

        AsyncFunction("syncActivity") { () async throws -> [String: Any] in
            try await wearCall { try await runtime.link.syncActivity().toJS() }
        }

        AsyncFunction("syncFullHistory") { () async throws -> [String: Any] in
            try await wearCall { try await runtime.link.syncActivity(fullHistory: true).toJS() }
        }

        AsyncFunction("forgetDevice") { (address: String) async throws -> Void in
            runtime.forget(address)
        }

        // The repair of a damaged joyofit.db (src/db/recovery) replaces the file: the native connection must not be open meanwhile.
        AsyncFunction("releaseDatabase") { () async throws -> Void in
            runtime.syncStore.release()
        }

        AsyncFunction("resumeDatabase") { () async throws -> Void in
            runtime.syncStore.resume()
        }

        // MARK: background session

        AsyncFunction("setBackgroundEnabled") { (address: String?) async throws -> Void in
            try await wearCall {
                try runtime.setBackground(address)
                // The central has to exist from launch on, or iOS cannot hand a restored connection back to it.
                if address != nil { WearApp.central.start() }
            }
        }

        Function("getBackgroundStatus") { () -> [String: Any] in
            runtime.backgroundStatus()
        }

        // Android's battery optimization and a maker's auto-start list have no iOS counterpart: nothing limits the app that way, nothing to open.
        Function("getBackgroundRestrictions") { () -> [String: Any]? in nil }

        AsyncFunction("setSyncIntervalMinutes") { (minutes: Int) async throws -> Void in
            try await wearCall { try runtime.setSyncInterval(minutes) }
        }

        // MARK: link settings

        // iOS always opens the watch over Bluetooth LE GATT: there is no Classic link to force away from.
        Function("getForceBle") { () -> Bool in true }

        AsyncFunction("setForceBle") { (enabled: Bool) async throws -> Void in }

        // MARK: profile

        Function("getUserProfile") { () -> [String: Any]? in
            runtime.settings.profile?.toJS()
        }

        AsyncFunction("setUserProfile") { (profile: [String: Any]) async throws -> Bool in
            let parsed = try parseUserProfile(profile)
            return try await wearCall { try await runtime.setUserProfile(parsed) }
        }

        // MARK: activity-ring goals and body metrics

        AsyncFunction("setBodyMetrics") { (update: [String: Any]) async throws -> [String: Any] in
            try await wearCall { try await runtime.bodyMetrics.set(BodyMetricsData.parse(update)).toJS() }
        }

        // Stores the goals and reminders and sends them; true when they all reached the watch. The steps goal also goes into the profile's.
        AsyncFunction("setActivityGoals") { (goals: [String: Any]) async throws -> Bool in
            try await wearCall { try await runtime.setActivityGoals(ActivityGoalsData.parse(goals)) }
        }

        AsyncFunction("sendActivityGoals") { () async throws -> Bool in
            try await wearCall { try await runtime.activityGoals.send("manual") }
        }

        // MARK: Apple Health (the HealthKit counterpart of the Health Connect export)

        AsyncFunction("getHealthConnectStatus") { () async throws -> [String: Any] in
            await WearApp.health.status()
        }

        AsyncFunction("requestHealthConnectPermissions") { () async throws -> [String: Any] in
            try await wearCall { try await WearApp.health.requestPermissions() }
        }

        AsyncFunction("setHealthConnectEnabled") { (enabled: Bool) async throws -> [String: Any] in
            try await wearCall {
                try await WearApp.health.setEnabled(enabled)
                return await WearApp.health.status()
            }
        }

        AsyncFunction("backfillHealthConnect") { () async throws -> [String: Any] in
            try await wearCall { try await WearApp.health.backfill().toJS() }
        }

        // The Health app is where permissions and written data are managed.
        AsyncFunction("openHealthConnectSettings") { () async throws -> Void in
            await WearApp.health.openSettings()
        }

        // MARK: no iOS counterpart or protocol layer not ported: inert getters

        Function("getNotificationAccess") { () -> [String: Any] in runtime.notifications.access() }
        Function("getMorningSummaryEnabled") { () -> Bool in false }
        Function("getHealthSensors") { () -> [String: Any] in runtime.watchSettings.healthSensorsStatus() }
        Function("getStressStatus") { () -> [String: Any] in runtime.watchSettings.stress.status() }
        Function("getLiveWorkout") { () -> [String: Any]? in runtime.liveWorkout.snapshot() }
        Function("getPhoneFeatures") { () -> [String: Any] in runtime.features.status() }
        Function("getAlarms") { () -> [String: Any] in runtime.watchSettings.cachedAlarms() }
        Function("getSafety") { () -> [String: Any] in runtime.safety.status() }
        Function("testSosRelay") { () -> [String: Any] in Inert.sosRelayTest() }
        Function("getAgps") { () -> [String: Any] in runtime.ephemeris.status() }
        Function("getDietStatus") { () -> [String: Any] in runtime.diet.status() }
        Function("getBodyMetrics") { () -> [String: Any] in runtime.bodyMetrics.load().toJS() }
        Function("getActivityGoals") { () -> [String: Any] in runtime.activityGoals.status() }
        Function("getHealthyLiving") { () -> [String: Any] in runtime.p2p.healthLivingStatus() }
        Function("getCourses") { () -> [String: Any] in runtime.p2p.coursesStatus() }
        Function("getRoutes") { () -> [String: Any] in runtime.p2p.routesStatus() }

        AsyncFunction("getNotificationApps") { () async throws -> [[String: Any]] in [] }
        AsyncFunction("getCycle") { () async throws -> [String: Any] in
            try await wearCall { try runtime.cycle.overview() }
        }

        // Nothing to do where Android's own call is a no-op with nothing running or stored.
        AsyncFunction("cancelHrvMeasurement") { () async throws -> Void in
            runtime.watchSettings.hrv.cancel()
        }
        Function("dismissLiveWorkout") { () -> Void in runtime.liveWorkout.dismiss() }
        Function("finishLiveWorkout") { () -> Void in runtime.liveWorkout.finish() }
        // Realtime heart rate drains the watch: it never outlives the app being on screen.
        AsyncFunction("setLiveHeartRate") { (active: Bool) async throws -> Void in
            runtime.watchSettings.liveHeartRate.setActive(active)
        }

        OnAppEntersBackground {
            runtime.watchSettings.liveHeartRate.setActive(false)
        }
        Function("startLiveWorkout") { () -> Void in runtime.liveWorkout.startManual() }

        AsyncFunction("setNotificationsEnabled") { (enabled: Bool) async throws -> Void in
            try await wearCall { try await runtime.notifications.setEnabled(enabled) }
        }

        AsyncFunction("setHealthSensors") { (sensors: [String: Any]) async throws -> Bool in
            try await wearCall { try await runtime.watchSettings.setHealthSensors(try HealthSensorConfig.fromJS(sensors)) }
        }

        AsyncFunction("measureHrv") { () async throws -> [String: Any] in
            try await wearCall { try await runtime.watchSettings.hrv.measure().toJS() }
        }

        AsyncFunction("setAutomaticStress") { (enabled: Bool) async throws -> [String: Any] in
            try await wearCall { try await runtime.watchSettings.stress.setEnabled(enabled) }
        }

        AsyncFunction("refreshAlarms") { () async throws -> [String: Any] in
            try await wearCall { try await runtime.watchSettings.refreshAlarms() }
        }

        AsyncFunction("setAlarms") { (alarms: [String: Any]) async throws -> [String: Any] in
            try await wearCall { try await runtime.watchSettings.setAlarms(try WatchAlarms.fromJS(alarms)) }
        }

        // MARK: fall detection and the morning sleep report

        AsyncFunction("setFallDetection") { (enabled: Bool) async throws -> Bool in
            try await wearCall { try await runtime.safety.setFall(enabled) }
        }

        AsyncFunction("queryFallDetection") { () async throws -> Bool in
            try await wearCall { try await runtime.safety.queryFall() }
        }

        AsyncFunction("setSleepReportEnabled") { (enabled: Bool) async throws -> Void in
            runtime.safety.settings.sleepReportEnabled = enabled
        }

        AsyncFunction("sendSleepReportNow") { () async throws -> String in
            try await wearCall { try await runtime.sleepReport.push(force: true) }
        }

        AsyncFunction("findWatch") { (start: Bool) async throws -> Void in
            try await wearCall { try await runtime.features.findWatch(start) }
        }

        // MARK: meals on the watch's calorie card

        AsyncFunction("setDietDay") { (day: [String: Any]) async throws -> Bool in
            guard let parsed = DietDayArgument(js: day) else {
                throw WearException(.invalidArgument, "Each meal of the day must be an object")
            }
            return try await wearCall { try await runtime.diet.setDay(date: parsed.date, meals: parsed.meals, goals: parsed.goals) }
        }

        AsyncFunction("pushDietNow") { () async throws -> Bool in
            try await wearCall { try await runtime.diet.push("manual", withConfig: true) }
        }

        AsyncFunction("markWatchMealsSynced") { (ids: [String]) async throws -> Void in
            try await wearCall { try runtime.diet.markWatchMealsSynced(ids) }
        }

        // MARK: family monitoring (the monitored person's phone)

        // Stores the config (the token goes to the Keychain), or drops it with the last result and payload and everything queued when null.
        // Nothing is read from the database or sent before a config with `enabled: true` is set.
        AsyncFunction("familyConfigure") { (config: [String: Any]?) async throws -> Void in
            try await wearCall { runtime.family.configure(try config.map(FamilyConfig.parse)) }
        }

        // Builds the summary of the granted categories and sends it now; the outcome says what happened, network errors do not reject.
        AsyncFunction("familyUploadNow") { () async throws -> [String: Any] in
            await runtime.family.uploadNow().toJS()
        }

        Function("familyUploadStatus") { () -> [String: Any] in runtime.family.status() }

        // MARK: weather

        Function("getWeatherStatus") { () -> [String: Any] in runtime.weather.status() }

        AsyncFunction("setWeatherEnabled") { (enabled: Bool) async throws -> Void in
            await runtime.weather.setEnabled(enabled)
        }

        AsyncFunction("setWeatherUnit") { (unit: String) async throws -> Void in
            try await wearCall { try runtime.weather.setUnit(unit) }
        }

        AsyncFunction("setWeatherLocationMode") { (mode: String) async throws -> Void in
            try await wearCall { try await runtime.weather.setLocationMode(mode) }
        }

        AsyncFunction("setWeatherIntervalMinutes") { (minutes: Int) async throws -> Void in
            try await wearCall { try runtime.weather.setIntervalMinutes(minutes) }
        }

        AsyncFunction("setWeatherCity") { (query: String) async throws -> [String: Any] in
            try await wearCall { try await runtime.weather.setCity(query).toJS() }
        }

        AsyncFunction("refreshWeather") { () async throws -> [String: Any] in
            try await wearCall { try await runtime.weather.refreshNow() }
        }

        // MARK: watch faces

        AsyncFunction("listWatchfaces") { () async throws -> [String: Any] in
            try await wearCall { try await runtime.watchfaces.list() }
        }

        AsyncFunction("installWatchface") { (uri: String, signature: String?, fileName: String?) async throws -> [String: Any] in
            try await wearCall { try await runtime.watchfaces.install(uri: uri, signature: signature, fileName: fileName) }
        }

        AsyncFunction("setActiveWatchface") { (id: String) async throws -> [String: Any] in
            try await wearCall { try await runtime.watchfaces.setActive(id) }
        }

        AsyncFunction("deleteWatchface") { (id: String) async throws -> [String: Any] in
            try await wearCall { try await runtime.watchfaces.delete(id) }
        }

        AsyncFunction("getFaceCustomization") { (faceId: String) async throws -> [String: Any] in
            try await wearCall { try await runtime.faceCustomizer.query(faceId).toJS() }
        }

        AsyncFunction("applyFaceCustomization") { (faceId: String, config: [String: Any]) async throws -> [String: Any] in
            guard let parsed = FaceCustomization(js: config) else {
                throw WearException(.invalidArgument, "The configuration needs marketId, styles [{mode, index}], colourIndex, customColour and widgets")
            }
            return try await wearCall { try await runtime.faceCustomizer.apply(faceId, parsed).toJS() }
        }

        AsyncFunction("getPhotoFace") { () async throws -> [String: Any] in
            try await wearCall { try await runtime.photoFaces.info() }
        }

        AsyncFunction("addPhoto") { (uri: String) async throws -> [String: Any] in
            try await wearCall { try await runtime.photoFaces.add(uri: uri) }
        }

        AsyncFunction("deletePhoto") { (name: String) async throws -> [String: Any] in
            try await wearCall { try await runtime.photoFaces.delete(name: name) }
        }

        AsyncFunction("setPhotoFaceActive") { () async throws -> [String: Any] in
            try await wearCall { try await runtime.photoFaces.setActive() }
        }

        // MARK: Huawei Health history import

        // The ZIP is opened in place from the picker's file URL; progress goes out as `onHuaweiImportProgress` through the module that started it.
        AsyncFunction("importHuaweiExport") { (uri: String, password: String) async throws -> [String: Any] in
            try await wearCall { try await runtime.huaweiImport.run(uri: uri, password: password) { bridge.huaweiImportProgress($0) } }
        }

        // Reads what Huawei Health wrote into Apple Health, once; asks for read permission only now. Same progress event and summary as the ZIP import.
        AsyncFunction("importAppleHealthHistory") { () async throws -> [String: Any] in
            try await wearCall { try await WearApp.appleHealthImport.run { bridge.huaweiImportProgress($0) } }
        }

        Function("cancelHuaweiImport") { () -> Void in
            runtime.huaweiImport.cancel()
            WearApp.appleHealthImport.cancel()
        }

        // MARK: P2P (service 0x34): Healthy Living and the experimental running courses

        AsyncFunction("setHealthyLivingEnabled") { (enabled: Bool) async throws -> Void in
            runtime.p2p.setHealthLivingEnabled(enabled)
        }

        AsyncFunction("pushHealthyLiving") { () async throws -> Bool in
            try await wearCall { try await runtime.p2p.pushHealthLiving() }
        }

        AsyncFunction("setCoursesEnabled") { (enabled: Bool) async throws -> Void in
            runtime.p2p.settings.experimentalCourses = enabled
        }

        AsyncFunction("pushRunningCourse") { (course: [String: Any]) async throws -> [String: Any] in
            try await wearCall { try await runtime.p2p.pushCourse(P2pController.parseCourse(course)) }
        }

        AsyncFunction("pushRoute") { (route: [String: Any]) async throws -> [String: Any] in
            try await wearCall { try await runtime.p2p.pushRoute(P2pController.parseRoute(route)) }
        }

        // MARK: cycle calendar

        AsyncFunction("setCycleEnabled") { (enabled: Bool) async throws -> Void in
            runtime.cycle.setEnabled(enabled)
        }

        AsyncFunction("setCycleSwitches") { (switches: [String: Any]) async throws -> Void in
            try await wearCall { runtime.cycle.setSwitches(try MenstrualCodec.Switches(js: switches)) }
        }

        AsyncFunction("startPeriod") { (day: String) async throws -> Void in
            try await wearCall { try runtime.cycle.startPeriod(day) }
        }

        AsyncFunction("endPeriod") { (day: String) async throws -> Void in
            try await wearCall { try runtime.cycle.endPeriod(day) }
        }

        AsyncFunction("addPeriod") { (start: String, end: String) async throws -> Void in
            try await wearCall { try runtime.cycle.addPeriod(start: start, end: end) }
        }

        AsyncFunction("deletePeriod") { (start: String) async throws -> Void in
            try await wearCall { try runtime.cycle.deletePeriod(start) }
        }

        AsyncFunction("logCycleDay") { (day: String, flow: Int, cramps: Int) async throws -> Void in
            try await wearCall { try runtime.cycle.logDay(day, flow: flow, cramps: cramps) }
        }

        // MARK: switches of phone-side features that are always off here

        switchRejectingOn("setMorningSummaryEnabled")
        switchRejectingOn("setFindPhoneEnabled")
        switchRejectingOn("setCallsEnabled")
        switchRejectingOn("setCallControlEnabled")
        switchRejectingOn("setSosRelayEnabled")

        // MARK: satellite data (A-GPS)

        AsyncFunction("refreshAgps") { () async throws -> [String: Any] in
            await runtime.ephemeris.refreshNow()
        }

        AsyncFunction("cancelAgps") { () async throws -> Void in
            await runtime.ephemeris.cancel()
        }

        // MARK: commands that would reach the watch or Android-only screens: ERR_UNSUPPORTED

        rejects("openNotificationAccess")
        rejects("openBatteryExemption")
        rejects("openAutoStartSettings")
        rejects("setNotificationAppEnabled", String.self, Bool.self)
        rejects("parseWatchfacePackage", String.self, Bool?.self)
        rejects("deleteLocalWatchfaceFile", String.self)
    }
}

/// Starts the CoreBluetooth central at launch when background mode is on, or when iOS relaunched the app for the bluetooth-central session:
/// the central must exist (with its restoration identifier) before the first run-loop turn for the restoration event to reach it.
public class HuaweiWearAppDelegateSubscriber: ExpoAppDelegateSubscriber {
    public func application(
        _ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        let relaunchedForBluetooth = launchOptions?[.bluetoothCentrals] != nil
        if WearSettings().backgroundEnabled || relaunchedForBluetooth {
            WearApp.central.start()
            WearApp.runtime.ensureBackgroundRunning()
        }
        return true
    }

    /// iOS relaunched or woke the app because the family upload's background session has something to report. The runtime is created first: it
    /// wires the session's result callback, which has to exist before the session delivers its events.
    public func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        guard identifier == FamilyBackgroundSession.sessionIdentifier else {
            completionHandler()
            return
        }
        _ = WearApp.runtime
        WearApp.familySession.handleEvents {
            completionHandler()
            Task { @MainActor in releaseFileSystemHandler(forSession: identifier) }
        }
    }
}

/// expo-file-system's subscriber answers every `handleEventsForBackgroundURLSession` by keeping the handler until one of ITS OWN sessions finishes, and
/// Expo calls the system's handler only after every subscriber has called its handler: for a session of ours that would never happen, and iOS would
/// wait out the app's background time instead of suspending it. Tells that subscriber the session is done. Without it (no such subscriber, or one
/// that changed) nothing is called.
@MainActor
private func releaseFileSystemHandler(forSession identifier: String) {
    let selector = NSSelectorFromString("invokeCompletionHandlerForSessionIdentifier:")
    for subscriber in ExpoAppDelegateSubscriberRepository.subscribers where subscriber.responds(to: selector) {
        _ = (subscriber as AnyObject).perform(selector, with: identifier)
    }
}

#endif
