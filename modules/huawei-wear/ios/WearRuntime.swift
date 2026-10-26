// Process-wide owner of the one WearLink. The JS module, the background controller and the app delegate all reach the watch through this
// object, so there is never a second link. Events fan out to whichever JS module instance is alive (none, when the app has no JS running)
// and update `status`. Port of WearRuntime.kt (the parts that exist on iOS).
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

/// What a status screen shows.
public struct ServiceStatus: Equatable, Sendable {
    public var state: LinkState
    public var battery: Int?
    /// `SyncResult.to` of the last stored sync of this process, unix seconds.
    public var lastSyncSec: Int64?
    /// Why the link is down, when the background loop knows (waiting for Bluetooth, retry, paused...).
    public var note: String?
}

/// A watch seen advertising: what `getBondedDevices` lists on iOS, which has no list of bonded devices.
public struct NearbyWatch: Sendable, Equatable {
    public let identifier: String
    public let name: String?

    public init(identifier: String, name: String?) {
        self.identifier = identifier
        self.name = name
    }
}

public final class WearRuntime: @unchecked Sendable {
    public let settings: WearSettings
    public let syncStore: SyncStore
    /// What the support report quotes; fed from `events` whether or not a screen listens.
    public let supportLog = SupportLog()
    public let environment: SupportReport.Environment

    /// The fan-out `WearLink`, the background controller and the module log through.
    public var events: WearEvents { fanOut }
    public private(set) var link: WearLink!
    public private(set) var controller: BackgroundController!
    /// Features that act on the live session register here; see `LinkObservers`.
    public let linkObservers = LinkObservers()
    /// Find my watch.
    public private(set) var features: PhoneFeatures!
    /// The watch's notification switch and iOS's ANCS state.
    public private(set) var notifications: WatchNotifications!
    /// The per-app notification switches (02/0B) and the test that finds the encoding the watch takes.
    public private(set) var notificationFilter: NotificationAppFilter!
    /// Alarms, health sensor switches, live heart rate, HRV and stress (the watch settings that are plain protocol commands).
    public private(set) var watchSettings: WatchSettingsFeatures!
    /// Weather push (settings, the watch's weather requests, the refresh timer).
    public private(set) var weather: WeatherController!
    /// Watch face list, install, activate and delete.
    public private(set) var watchfaces: WatchfaceController!
    /// The watch's photo face and its photos.
    public private(set) var photoFaces: PhotoFaceController!
    /// The one subscriber of DataSync (service 0x37); features register their handlers on it.
    public private(set) var dataSync: DataSyncService!
    /// Editable watch-face options over DataSync.
    public private(set) var faceCustomizer: WatchfaceCustomizer!
    /// The Huawei Health history import (one at a time; the module forwards its progress as `onHuaweiImportProgress`).
    public private(set) var huaweiImport: HuaweiImportController!
    /// The P2P service (0x34): Healthy Living, running courses, heart-rate zones of Track watches and the health dictionary sync.
    public private(set) var p2p: P2pController!
    /// Activity-ring goals and reminders.
    public private(set) var activityGoals: ActivityGoals!
    /// Weight, body fat, resting metabolism and the Health Glance card.
    public private(set) var bodyMetrics: BodyMetrics!
    /// The menstrual calendar: the log, the watch's 0x32 requests and the flow dictionary.
    public private(set) var cycle: MenstrualFeature!
    /// Fall detection (DataSync config) and the morning sleep report (DataSync event); the SOS relay is not possible on iOS.
    public private(set) var safety: SafetyFeatures!
    public private(set) var sleepReport: SleepReportFeature!
    /// Calorie intake on the watch (meals, goals, the watch's quick-log).
    public private(set) var diet: DietSync!
    /// A workout started on the watch, followed live (and the phone's GPS for it).
    public private(set) var liveWorkout: LiveWorkout!
    public private(set) var workoutLink: WorkoutLink!
    /// A workout started on the watch from the phone (the strength logger); `liveWorkout` does not mirror it while it is open.
    public private(set) var watchWorkout: WatchWorkoutControl!
    /// Family monitoring, monitored side: the daily summary for the watcher, uploaded after every background watch sync.
    public private(set) var family: FamilyUploader!
    /// Satellite data (A-GPS) for the watch: the watch's 0x1F / 0x1C exchange, the phone copy kept fresh after every sync, "update now".
    public private(set) var ephemeris: EphemerisLink!

    /// Called after every stored sync (the HealthKit export hooks in here).
    public var onSyncComplete: (@Sendable (SyncSummary) -> Void)?

    private let nearby: @Sendable (_ timeoutMs: Int) async throws -> [NearbyWatch]
    private let systemConnected: @Sendable () async throws -> [NearbyWatch]
    private let fanOut = FanOut()
    private let lock = NSLock()
    private var listeners: [UUID: WearEvents] = [:]
    private var _paused = false
    private var _status = ServiceStatus(state: .disconnected, battery: nil, lastSyncSec: nil, note: nil)
    private var nearbyCache: (atMs: Int, list: [NearbyWatch])?
    private let nowMs: @Sendable () -> Int

    /// The user disconnected in the app while background mode is on: auto-reconnect waits until a connect from the app, or background being
    /// switched off and on again.
    public var paused: Bool { lock.locked { _paused } }

    public var status: ServiceStatus { lock.locked { _status } }

    public init(
        settings: WearSettings,
        syncStore: SyncStore,
        deviceStore: DeviceStore,
        gate: BluetoothGate,
        environment: SupportReport.Environment,
        phoneModel: String,
        transportFactory: @escaping TransportFactory,
        nearby: @escaping @Sendable (_ timeoutMs: Int) async throws -> [NearbyWatch] = { _ in [] },
        systemConnected: @escaping @Sendable () async throws -> [NearbyWatch] = { [] },
        expiring: @escaping ExpiringWork = { _, work in await work() },
        now: @escaping @Sendable () -> Date = { Date() },
        clock: @escaping @Sendable () -> Int = BackgroundController.uptimeMs,
        weatherLocation: LocationSource = UnavailableLocationSource(),
        weatherFetch: @escaping WeatherFetch = WeatherNetwork.fetch,
        weatherDefaults: UserDefaults? = nil,
        goalsDefaults: UserDefaults? = nil,
        cycleDefaults: UserDefaults? = nil,
        notificationFilterDefaults: UserDefaults? = nil,
        liveGps: LiveGpsSource = UnavailableLiveGps(),
        p2pDefaults: UserDefaults? = nil,
        familyDefaults: UserDefaults? = nil,
        familySecrets: SecretStore = MemorySecretStore(),
        familySend: @escaping FamilySend = FamilyNetwork.send,
        familyBackground: FamilyBackgroundUploading? = nil,
        familyDirectory: URL = FamilyUploader.defaultDirectory(),
        agpsDefaults: UserDefaults? = nil,
        agpsSource: AgpsSource? = nil,
        agpsCache: AgpsCache? = nil,
        agpsOnline: @escaping @Sendable () -> Bool = AgpsReachability.isOnline
    ) {
        self.settings = settings
        self.syncStore = syncStore
        self.environment = environment
        self.nearby = nearby
        self.systemConnected = systemConnected
        self.nowMs = clock
        fanOut.runtime = self
        link = WearLink(
            events: fanOut, settings: settings, syncStore: syncStore, deviceStore: deviceStore, gate: gate, phoneModel: phoneModel,
            transportFactory: transportFactory, now: now
        )
        controller = BackgroundController(runtime: self, expiring: expiring, clock: clock)
        features = PhoneFeatures(link: link, events: fanOut)
        notifications = WatchNotifications(link: link, events: fanOut)
        linkObservers.add(notifications)
        notificationFilter = NotificationAppFilter(link: link, events: fanOut, settings: NotificationFilterSettings(defaults: notificationFilterDefaults))
        linkObservers.add(notificationFilter)
        watchSettings = WatchSettingsFeatures(handle: { [link] in link?.handle() }, settings: settings, syncStore: syncStore, events: fanOut)
        linkObservers.add(watchSettings)
        weather = WeatherController(
            settings: WeatherSettings(defaults: weatherDefaults), link: link, events: fanOut, location: weatherLocation, fetch: weatherFetch, expiring: expiring, now: now
        )
        linkObservers.add(weather)
        watchfaces = WatchfaceController(link: link, events: fanOut)
        photoFaces = PhotoFaceController(link: link, events: fanOut)
        dataSync = DataSyncService(link: link, events: fanOut)
        faceCustomizer = WatchfaceCustomizer(events: fanOut, faces: { [watchfaces] in try await watchfaces!.entries() })
        dataSync.register(faceCustomizer)
        activityGoals = ActivityGoals(defaults: goalsDefaults, service: dataSync, events: fanOut, settings: settings)
        dataSync.register(activityGoals)
        bodyMetrics = BodyMetrics(store: syncStore, service: dataSync, events: fanOut, settings: settings)
        dataSync.register(bodyMetrics)
        cycle = MenstrualFeature(settings: CycleSettings(defaults: cycleDefaults), store: CycleStore(store: syncStore), link: link, events: fanOut)
        dataSync.register(cycle)
        linkObservers.add(cycle)
        diet = DietSync.wired(store: syncStore, events: fanOut, settings: settings, now: now, goals: activityGoals, body: bodyMetrics)
        dataSync.register(diet)
        linkObservers.add(dataSync)
        huaweiImport = HuaweiImportController(syncStore: syncStore)
        let extrasSettings = WatchExtrasSettings(defaults: weatherDefaults)
        safety = SafetyFeatures(link: link, settings: extrasSettings, events: fanOut)
        dataSync.register(safety)
        sleepReport = SleepReportFeature(settings: extrasSettings, syncStore: syncStore, events: fanOut)
        dataSync.register(sleepReport)
        liveWorkout = LiveWorkout(
            dataSync: dataSync, events: fanOut, settings: settings, setHeartRateActive: { [watchSettings] in watchSettings?.liveHeartRate.setWorkoutActive($0) }
        )
        dataSync.register(liveWorkout)
        workoutLink = WorkoutLink(link: link, events: fanOut, live: liveWorkout, gps: liveGps)
        linkObservers.add(workoutLink)
        watchWorkout = WatchWorkoutControl(link: link, events: fanOut)
        linkObservers.add(watchWorkout)
        liveWorkout.phoneOwned = { [watchWorkout] in watchWorkout?.owns() ?? false }
        p2p = P2pController(
            settings: P2pSettings(defaults: p2pDefaults), link: link, addSyncExtension: { [link] in link?.addSyncExtension($0) }, wearSettings: settings,
            syncStore: syncStore, events: fanOut
        )
        linkObservers.add(p2p)
        family = FamilyUploader(
            settings: FamilySettings(defaults: familyDefaults, secrets: familySecrets), store: syncStore, events: fanOut,
            battery: { [weak self] in self?.status.battery }, send: familySend, background: familyBackground, directory: familyDirectory, now: now
        )
        let agpsStore = AgpsStore(defaults: agpsDefaults)
        ephemeris = EphemerisLink(
            link: link, events: fanOut, settings: settings, store: agpsStore,
            source: agpsSource ?? EphemerisLink.networkSource(store: agpsStore, events: fanOut, cache: agpsCache ?? EphemerisCache(), isOnline: agpsOnline),
            isOnline: agpsOnline
        )
        linkObservers.add(ephemeris)
    }

    // MARK: events

    /// Fans every event of the link out to `listener` until `removeListener`.
    public func addListener(_ listener: WearEvents) -> UUID {
        let token = UUID()
        lock.locked { listeners[token] = listener }
        return token
    }

    public func removeListener(_ token: UUID) { lock.locked { listeners[token] = nil } }

    fileprivate func currentListeners() -> [WearEvents] { lock.locked { Array(listeners.values) } }

    fileprivate func handleState(_ state: LinkState, _ error: String?) {
        if state == .connecting { supportLog.connectStarted() }
        supportLog.add("STATE \(state.rawValue)" + (error.map { ": \($0)" } ?? ""))
        lock.locked {
            _status.state = state
            if state != .disconnected { _status.note = nil }
        }
        if state == .connected, let handle = link.handle() { linkObservers.connected(handle) }
        if state == .disconnected { linkObservers.disconnected() }
        currentListeners().forEach { $0.state(state, error: error) }
        if state == .disconnected || state == .connected { controller?.onLinkChanged() }
    }

    fileprivate func handleBattery(_ level: Int) {
        lock.locked { _status.battery = level }
        currentListeners().forEach { $0.battery(level) }
    }

    fileprivate func handleSyncComplete(_ summary: SyncSummary) {
        lock.locked { _status.lastSyncSec = summary.to }
        onSyncComplete?(summary)
        sleepReport?.onSyncComplete(summary)
        ephemeris?.onSyncCycle()
        currentListeners().forEach { $0.syncComplete(summary) }
    }

    fileprivate func handleHeartRate(_ bpm: Int, _ tsMs: Int64) {
        liveWorkout?.onHeartRate(bpm)
        currentListeners().forEach { $0.heartRate(bpm: bpm, tsMs: tsMs) }
    }

    fileprivate func handleHrvProgress(_ secondsLeft: Int, _ beats: Int) { currentListeners().forEach { $0.hrvProgress(secondsLeft: secondsLeft, beats: beats) } }

    fileprivate func handleLog(_ entry: LogEntry) {
        let ids = entry.serviceId.map { " svc=\(SupportReport.hex2($0)) cmd=\(SupportReport.hex2(entry.commandId ?? 0))" } ?? ""
        let hexForConsole = entry.hex.map { " \($0)" } ?? ""
        // Mirrored to the console under the JoyoFit tags, so the log can be read over the device syslog with the UI closed.
        WearConsole.general("\(entry.direction.rawValue.uppercased())\(ids) \(entry.message)\(hexForConsole)", error: entry.direction == .error)
        let command = (entry.serviceId != nil && entry.commandId != nil) ? " \(SupportReport.hex2(entry.serviceId!))/\(SupportReport.hex2(entry.commandId!))" : ""
        let packet = entry.hex.map { " \($0.prefix(96))\($0.count > 96 ? "..." : "")" } ?? ""
        WearConsole.ble("[\(entry.direction.rawValue)]\(command) \(entry.message)\(packet)")
        // Without the frame hex: it is encrypted with this phone's key and means nothing to anyone reading the report.
        supportLog.add("\(entry.direction.rawValue.uppercased())\(ids) \(entry.message)")
        currentListeners().forEach { $0.log(entry) }
    }

    public func setNote(_ note: String?) { lock.locked { _status.note = note } }

    private final class FanOut: WearEvents, @unchecked Sendable {
        weak var runtime: WearRuntime?
        func state(_ state: LinkState, error: String?) { runtime?.handleState(state, error) }
        func battery(_ level: Int) { runtime?.handleBattery(level) }
        func syncComplete(_ summary: SyncSummary) { runtime?.handleSyncComplete(summary) }
        func log(_ entry: LogEntry) { runtime?.handleLog(entry) }
        func heartRate(bpm: Int, tsMs: Int64) { runtime?.handleHeartRate(bpm, tsMs) }
        func hrvProgress(secondsLeft: Int, beats: Int) { runtime?.handleHrvProgress(secondsLeft, beats) }
        func uploadProgress(bytes: Int, total: Int) { runtime?.currentListeners().forEach { $0.uploadProgress(bytes: bytes, total: total) } }
        func uploadResult(ok: Bool, fileName: String, code: Int?, message: String) {
            runtime?.currentListeners().forEach { $0.uploadResult(ok: ok, fileName: fileName, code: code, message: message) }
        }
        func faceCustomization(_ payload: [String: Any]) { runtime?.currentListeners().forEach { $0.faceCustomization(payload) } }
        func watchMealLogged(_ payload: [String: Any]) { runtime?.currentListeners().forEach { $0.watchMealLogged(payload) } }
        func liveWorkout(_ payload: [String: Any]) { runtime?.currentListeners().forEach { $0.liveWorkout(payload) } }
        func watchNav(_ payload: [String: Any]) { runtime?.currentListeners().forEach { $0.watchNav(payload) } }
    }

    // MARK: bonded devices

    /// One row of the Watch tab list. `nearby`: seen right now (advertising, held by iOS, or the link's own watch); `systemConnected`: iOS already
    /// holds a connection to it (Settings > Bluetooth, ANCS, another app), so it does not advertise and a scan never shows it.
    struct ListedWatch: Equatable {
        var identifier: String
        var name: String?
        var nearby = false
        var systemConnected = false
    }

    /// The remembered watch, the one the link is on, the watches iOS holds a connection to and the ones the scan saw, one row per watch:
    /// - the same identifier (any letter case) is one row;
    /// - a watch that shows up under another identifier but with exactly the remembered watch's full name, while the remembered identifier is
    ///   not seen at all, is the remembered watch under a new iOS identifier (after a re-pair or a Bluetooth reset): it fills the remembered
    ///   row (connecting by the remembered identifier finds it by name), so the list does not offer a second row that would bind again.
    ///   A stem match is not enough: every Fit 4 Pro advertises the same stem.
    static func listing(remembered: NearbyWatch?, active: String?, system: [NearbyWatch], scanned: [NearbyWatch]) -> [ListedWatch] {
        var rows: [ListedWatch] = []
        func index(_ identifier: String) -> Int? { rows.firstIndex { $0.identifier.caseInsensitiveCompare(identifier) == .orderedSame } }
        func mark(_ i: Int, name: String?, system: Bool) {
            rows[i].nearby = true
            rows[i].systemConnected = rows[i].systemConnected || system
            if rows[i].name == nil { rows[i].name = name }
        }
        func normalized(_ name: String?) -> String? {
            guard let trimmed = name?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else { return nil }
            return trimmed.lowercased()
        }
        if let remembered { rows.append(ListedWatch(identifier: remembered.identifier, name: remembered.name)) }
        if let active {
            if let i = index(active) { mark(i, name: nil, system: false) } else { rows.append(ListedWatch(identifier: active, name: nil, nearby: true)) }
        }
        let seen = system.map { ($0, true) } + scanned.map { ($0, false) }
        var leftovers: [(NearbyWatch, Bool)] = []
        for (watch, isSystem) in seen {
            if let i = index(watch.identifier) { mark(i, name: watch.name, system: isSystem) } else { leftovers.append((watch, isSystem)) }
        }
        for (watch, isSystem) in leftovers {
            if let i = index(watch.identifier) {
                mark(i, name: watch.name, system: isSystem)
            } else if let remembered, let i = index(remembered.identifier), !rows[i].nearby,
                normalized(watch.name) != nil, normalized(watch.name) == normalized(remembered.name) {
                mark(i, name: watch.name, system: isSystem)
            } else {
                rows.append(ListedWatch(identifier: watch.identifier, name: watch.name, nearby: true, systemConnected: isSystem))
            }
        }
        return rows
    }

    /// iOS has no list of bonded Bluetooth devices. The watches `getBondedDevices` returns are the remembered one, the watches iOS already holds
    /// a connection to (a scan never shows those), and the ones advertising within a short scan while no link is open. The scan result is
    /// cached for 30 s unless it found nothing (a watch that has just been released or woken must not stay hidden); `refresh` ignores the cache
    /// and scans longer. Each row carries the support level of its model.
    public func bondedDevices(refresh: Bool = false) async throws -> [[String: Any]] {
        let remembered = settings.watchAddress.map { NearbyWatch(identifier: $0, name: settings.watchName) }
        var system: [NearbyWatch] = []
        var scanned: [NearbyWatch] = []
        var failure: Error?
        if link.currentState() == .disconnected {
            do {
                system = try await systemConnected()
                scanned = try await cachedNearby(refresh: refresh)
            } catch {
                // Bluetooth off or not allowed: the remembered watch still lists; with none, the user needs to hear why.
                failure = error
            }
        }
        let rows = WearRuntime.listing(remembered: remembered, active: link.activeAddress, system: system, scanned: scanned)
        if rows.isEmpty, let failure { throw failure }
        return rows
            .map { watch -> [String: Any] in
                let name = watch.name ?? watch.identifier
                var entry: [String: Any] = [
                    "address": DeviceStore.normalize(watch.identifier), "name": name,
                    "nearby": watch.nearby, "systemConnected": watch.systemConnected,
                ]
                for (key, value) in WatchModels.match(watch.name).toJS() { entry[key] = value }
                return entry
            }
            .sorted { ($0["name"] as! String).lowercased() < ($1["name"] as! String).lowercased() }
    }

    private func cachedNearby(refresh: Bool) async throws -> [NearbyWatch] {
        let now = nowMs()
        if !refresh, let cache = lock.locked({ nearbyCache }), now - cache.atMs < 30_000 { return cache.list }
        let list = try await nearby(refresh ? 8_000 : 4_000)
        lock.locked { nearbyCache = list.isEmpty ? nil : (now, list) }
        return list
    }

    /// Forgets the scan result: the next list scans again (a watch that was linked to this app advertises again once it is released).
    private func dropNearbyCache() { lock.locked { nearbyCache = nil } }

    // MARK: support report

    /// The support report: the last watch, its capabilities and the kept log, without addresses or serial.
    public func supportReport() -> [String: Any] {
        let device = link.deviceInfo() ?? link.lastDeviceInfo
        var identifiers = [String]()
        if let a = settings.watchAddress { identifiers.append(a) }
        if let a = device?.address { identifiers.append(a) }
        return SupportReport.build(
            environment: environment,
            watchName: link.lastAttemptName ?? settings.watchName,
            device: device,
            linkState: link.currentState().rawValue,
            log: supportLog.lines(),
            caps: link.lastCaps,
            transport: .le,
            identifiers: identifiers,
            extraSummary: weather.supportSummary(caps: link.lastCaps)
                + notificationFilter.supportSummary(caps: link.lastCaps)
                + [SupportReport.nightHrvLine(listed: settings.autoStressListed, enabled: settings.stressEnabled)]
        )
    }

    // MARK: link actions from the app

    public func connectFromApp(_ address: String) async throws -> WatchDeviceInfo {
        lock.locked { _paused = false }
        return try await link.connect(address)
    }

    /// The user agreed in the app that the next connect to `address` may start a first bind (it replaces the watch's current phone pairing).
    public func confirmBind(_ address: String) { link.allowBind(address) }

    public func disconnectFromApp() {
        if settings.backgroundEnabled {
            lock.locked { _paused = true }
            setNote("Disconnected in the app. Connect there to resume.")
        }
        link.disconnect()
        dropNearbyCache()
    }

    public func forget(_ rawAddress: String) {
        let address = DeviceStore.normalize(rawAddress)
        settings.switchBackfillDone(address)
        link.forget(address)
        dropNearbyCache()
        if let remembered = settings.watchAddress, remembered.caseInsensitiveCompare(address) == .orderedSame {
            try? setBackground(nil)
            settings.watchAddress = nil
            settings.watchName = nil
        }
    }

    /// JS reload with background off: nothing keeps the link, so it is closed as before.
    public func onModuleDestroyed() {
        watchSettings.liveHeartRate.setActive(false)
        watchSettings.hrv.cancel()
        if !settings.backgroundEnabled { link.shutdown() }
    }

    // MARK: background mode

    /// Starts the background session for `rawAddress` (the controller connects, reconnects and syncs while iOS keeps the process alive), or
    /// stops it when `rawAddress` is nil.
    public func setBackground(_ rawAddress: String?) throws {
        guard let rawAddress else {
            settings.backgroundEnabled = false
            lock.locked { _paused = false }
            setNote(nil)
            controller.stop()
            return
        }
        let address = DeviceStore.normalize(rawAddress)
        guard UUID(uuidString: address) != nil else {
            throw WearError(.invalidAddress, "'\(rawAddress)' is not a Bluetooth peripheral identifier")
        }
        if settings.watchAddress != address { settings.watchName = nil }
        settings.watchAddress = address
        settings.backgroundEnabled = true
        lock.locked { _paused = false }
        setNote(nil)
        controller.start()
        controller.nudge(reset: true)
    }

    /// Brings the controller back when background mode is on but it is not running (a relaunch by iOS, an app update).
    public func ensureBackgroundRunning() {
        if settings.backgroundEnabled && settings.watchAddress != nil && !controller.isRunning { controller.start() }
    }

    public func backgroundStatus() -> [String: Any] {
        [
            "enabled": settings.backgroundEnabled,
            "address": settings.watchAddress ?? NSNull(),
            "name": settings.watchName ?? NSNull(),
            "running": controller.isRunning,
            "paused": paused,
            "syncIntervalMinutes": settings.syncIntervalMinutes,
        ]
    }

    public func setSyncInterval(_ minutes: Int) throws {
        if minutes < WearSettings.minSyncIntervalMin || minutes > WearSettings.maxSyncIntervalMin {
            throw WearError(
                .invalidArgument,
                "Sync interval must be \(WearSettings.minSyncIntervalMin) to \(WearSettings.maxSyncIntervalMin) minutes, got \(minutes)"
            )
        }
        settings.syncIntervalMinutes = minutes
        controller.reschedule()
    }

    // MARK: activity goals

    /// Stores the goals and reminders and sends them; true when they all reached the watch. The steps goal and the profile's daily step goal are
    /// one number: the profile (which goes out as MotionGoal 07/01) follows the ring's goal.
    public func setActivityGoals(_ goals: ActivityGoalsData) async throws -> Bool {
        try ActivityGoalsCodec.validate(goals)
        if let profile = settings.profile, profile.dailyStepGoal != goals.steps {
            var next = profile
            next.dailyStepGoal = goals.steps
            _ = try await setUserProfile(next)
        }
        return try await activityGoals.set(goals)
    }

    // MARK: profile

    /// Stores the profile; true when it also reached the connected watch. The heart-rate zones follow it: the defaults depend on the age, and
    /// zones the user configured go out again with the same values.
    public func setUserProfile(_ profile: UserProfileData, thisYear: Int = Calendar.current.component(.year, from: Date())) async throws -> Bool {
        if let message = profile.validationError(thisYear: thisYear) { throw WearError(.invalidArgument, message) }
        settings.profile = profile
        guard let handle = link.handle() else { return false }
        let profileSent: Bool
        do {
            profileSent = try await ProfileSender.sendProfile(session: handle.session, caps: handle.caps, log: events.sink, profile: profile) > 0
        } catch let e as WearError {
            events.error("Profile not sent: \(e.message)")
            return false
        }
        await sendHeartRateZones(handle)
        return profileSent
    }

    // MARK: heart-rate zones

    /// Stores the zones the user configured (nil: back to GB's defaults for the profile age) and sends them when a watch is connected; true when
    /// they reached the watch. A watch that takes zones neither over P2P nor as FitnessData 07/13|21 gets nothing and resolves false.
    public func setHeartRateZones(_ zones: HeartRateZonesCalc.UserZones?) async throws -> Bool {
        if let message = zones?.validationError() { throw WearError(.invalidArgument, message) }
        settings.heartRateZones = zones
        guard let handle = link.handle() else { return false }
        return await sendHeartRateZones(handle)
    }

    /// `getHeartRateZonesStatus`: whether zones are stored and how the connected watch takes them (`via` null without a watch).
    public func heartRateZonesStatus() -> [String: Any] {
        ["configured": settings.heartRateZones != nil, "via": link.handle().map { HeartRateZonesSync.route($0.caps) as Any } ?? NSNull()]
    }

    /// Sends the stored zones (or the defaults) the way this watch takes them; false when nothing was sent.
    @discardableResult
    private func sendHeartRateZones(_ handle: LinkHandle) async -> Bool {
        if HeartRateZonesSync.supportsTrack(handle.caps) {
            let sent = p2p.stack?.resendHeartRateZones() ?? false
            if !sent { events.info("HR zones: not sent, the P2P track service is not registered yet; they go out when it registers") }
            return sent
        }
        do {
            let sent = try await handle.operationLock.withLock {
                try await HeartRateZonesSync.sendFitnessData(
                    session: handle.session, caps: handle.caps, log: events.sink, age: HeartRateZonesSync.age(profile: settings.profile),
                    user: settings.heartRateZones
                )
            }
            if !sent { events.info("HR zones: not sent, this watch takes no heart-rate zones") }
            return sent
        } catch {
            events.error("HR zones not sent: \(error)")
            return false
        }
    }
}

extension DietSync {
    /// The meals feature as the runtime runs it: the ring's calories goal is the activity-calorie goal of the diet config (Android passes
    /// `{ activityGoals.goals.calories }`), and the watch's request for the latest weight (event 5) is answered by `BodyMetrics`.
    static func wired(
        store: SyncStore, events: WearEvents, settings: WearSettings, defaults: UserDefaults? = nil, now: @escaping @Sendable () -> Date,
        goals: ActivityGoals, body: BodyMetrics
    ) -> DietSync {
        DietSync(
            store: store, events: events, settings: settings, defaults: defaults, now: now, activityCalories: { goals.goals.calories },
            sendWeight: { phone, watch, reason in (try? await body.sendWeight(phonePkg: phone, watchPkg: watch, reason: reason)) ?? false }
        )
    }
}

#endif
