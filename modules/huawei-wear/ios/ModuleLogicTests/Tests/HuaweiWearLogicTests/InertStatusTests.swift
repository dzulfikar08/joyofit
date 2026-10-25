import XCTest
@testable import HuaweiWearLogic

/// The inert answers keep the exact field names of HuaweiWear*.types.ts. `inert-shapes.check.ts` (run by `scripts/check-inert-shapes.sh`)
/// type-checks the JSON this test dumps against the real TypeScript types.
final class InertStatusTests: XCTestCase {
    private func keys(_ d: [String: Any]) -> Set<String> { Set(d.keys) }

    func testPhoneFeaturesAllOff() {
        let f = Inert.phoneFeatures()
        XCTAssertEqual(keys(f), ["findPhoneEnabled", "callsEnabled", "callControlEnabled", "readPhoneState", "readCallLog", "readContacts", "callerIdSupported", "answerPhoneCalls", "findWatchSupported"])
        XCTAssertTrue(f.values.allSatisfy { ($0 as? Bool) == false })
    }

    func testNotificationAccessIsNotGrantedAndNotEnabled() {
        XCTAssertEqual(Inert.notificationAccess() as NSDictionary, ["granted": false, "enabled": false] as NSDictionary)
    }

    func testStatusObjectsHaveTheirTypeScriptFields() {
        XCTAssertEqual(
            keys(Inert.safety()),
            ["fallSupported", "fallNote", "fallSwitch", "fallUpdatedMs", "sosRelayEnabled", "smsSupported", "smsPermission", "telephony", "simReady", "sosReady", "sosBlockers", "sosListedByWatch", "sleepReportEnabled", "sleepReportSupported"]
        )
        XCTAssertEqual(Inert.safety()["fallSwitch"] as? Int, -1)
        XCTAssertEqual(keys(Inert.sosRelayTest()), ["ready", "blockers"])
        XCTAssertEqual(Inert.sosRelayTest()["ready"] as? Bool, false)
        XCTAssertEqual((Inert.sosRelayTest()["blockers"] as? [String])?.count, 1)
    }

    func testTodayIsALocalIsoDay() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 7 * 3600)!
        XCTAssertEqual(Inert.today(now: Date(timeIntervalSince1970: 1_700_000_000), calendar: calendar), "2023-11-15")
    }

    func testMessagesSayNotAvailableOnIos() {
        XCTAssertEqual(Inert.message("findWatch"), "findWatch: not available on iOS yet")
    }

    /// Writes every inert shape (and the other plain-Swift JS shapes) for the TypeScript check when INERT_SHAPES_OUT is set.
    func testDumpShapesForTheTypeScriptCheck() throws {
        guard let out = ProcessInfo.processInfo.environment["INERT_SHAPES_OUT"] else { return }
        let info = WatchDeviceInfo(
            address: "6B1C2A55-3E21-4A7B-9D6E-5F1A0C0C9B77", name: "HUAWEI WATCH FIT 4 Pro-40A", productModel: nil, softwareVersion: "6.1", hardwareVersion: nil,
            serialNumber: nil, batteryLevel: 50, authMode: .hichain3, model: "Huawei Watch Fit 4 Pro", support: .tested
        )
        let features = WatchSettingsFeatures(
            handle: { nil }, settings: WearSettings(defaults: ephemeralDefaults()), syncStore: SyncStore(url: temporaryDatabaseURL()), events: RecordingEvents()
        )
        // A watch that listed automatic stress (20/09) the last time it connected: `knownSupported` is true even with nothing connected now.
        let listedSettings = WearSettings(defaults: ephemeralDefaults())
        listedSettings.autoStressListed = true
        let listedStress = WatchSettingsFeatures(handle: { nil }, settings: listedSettings, syncStore: SyncStore(url: temporaryDatabaseURL()), events: RecordingEvents())
        let events = RecordingEvents()
        let weather = WeatherController(settings: WeatherSettings(defaults: ephemeralDefaults()), link: FakeLink(events: events), events: events, location: UnavailableLocationSource())
        let runtime = WearRuntime(
            settings: WearSettings(defaults: ephemeralDefaults()), syncStore: SyncStore(url: temporaryDatabaseURL()),
            deviceStore: DeviceStore(secrets: MemorySecretStore()), gate: AlwaysReadyGate(), environment: .init(app: "app 1 (1)", phone: "Apple test"),
            phoneModel: "test", transportFactory: { request, delegate in FakeTransport(.hangConnect, request: request, delegate: delegate) },
            p2pDefaults: ephemeralDefaults(), agpsDefaults: ephemeralDefaults()
        )
        let p2p = runtime.p2p!
        let populatedHealthyLiving: [String: Any] = {
            p2p.settings.healthLivingMsgVer = 3.0
            p2p.settings.healthLivingPackageSize = 8192
            p2p.settings.healthLivingLastRequestMs = 1_792_110_700_000
            p2p.settings.healthLivingLastReportMs = 1_792_110_701_000
            p2p.settings.healthLivingLastSummary = "day 20261016: #1=-/23✓"
            return p2p.healthLivingStatus()
        }()
        let extras = WatchExtrasSettings(defaults: ephemeralDefaults())
        extras.fallSwitch = 1
        extras.fallUpdatedMs = 1_792_110_700_000
        let liveSafety = SafetyFeatures(link: RigSource(), settings: extras, events: RecordingEvents()).status()
        // A phone-side live workout with and without readings: the objects `getLiveWorkout` and `onLiveWorkout` carry.
        let liveSettings = WearSettings(defaults: ephemeralDefaults())
        let live = LiveWorkout(dataSync: DataSyncService(link: RigSource(), events: events), events: events, settings: liveSettings, setHeartRateActive: { _ in })
        live.startManual()
        let emptyLive = live.snapshot()!
        live.onHeartRate(120)
        live.onHeartRate(121)
        live.finish()
        let populatedWeather: [String: Any] = [
            "enabled": true, "unit": "fahrenheit", "locationMode": "city", "intervalMinutes": 30,
            "city": WeatherPlace(name: "Bandung", latitude: -6.9, longitude: 107.6, detail: "West Java, Indonesia").toJS(),
            "locationPermission": true, "watchSupported": true, "lastPushAt": Int64(1_792_110_700), "lastError": "x", "lastTemperatureC": -3,
            "lastCondition": "LIGHT_RAIN", "lastLocationName": "Bandung",
            "lastForecast": ForecastOutcome(state: .sent, hours: 24, days: 8, replyCode: 100_000, atSec: 1_792_110_700).toJS(),
        ]
        // The real overview: a fresh install, and one with an open period, symptoms and the watch connected.
        let cycleStore = CycleStore(store: SyncStore(url: temporaryDatabaseURL()))
        let cycle = MenstrualFeature(settings: CycleSettings(defaults: ephemeralDefaults()), store: cycleStore, link: RigSource(), events: events)
        let populatedStore = CycleStore(store: SyncStore(url: temporaryDatabaseURL()))
        try populatedStore.addPeriod(start: CivilDate("2026-08-26")!, end: CivilDate("2026-08-30")!, nowSec: 1)
        try populatedStore.startPeriod(CivilDate("2026-09-23")!, nowSec: 2)
        try populatedStore.logDay(CivilDate("2026-09-24")!, flow: 2, cramps: 1, nowSec: 3)
        let populatedLink = DataSyncRig()
        var bitmap = Bytes(repeating: 0, count: 40)
        for bit in [173, 174, 265] { bitmap[bit / 8] |= UInt8(1 << (bit % 8)) }
        populatedLink.caps.expandCapabilities = bitmap
        populatedLink.caps.supportedCommands = [0x32: [0x01]]
        let populatedSettings = CycleSettings(defaults: ephemeralDefaults())
        populatedSettings.enabled = true
        populatedSettings.switches = MenstrualCodec.Switches(master: true)
        let populatedCycle = MenstrualFeature(settings: populatedSettings, store: populatedStore, link: populatedLink.source, events: events)
        // The live meals status: nothing stored, and a day with a goal, a watch-logged meal, a push and its result.
        let diet = DietSync(store: SyncStore(url: temporaryDatabaseURL()), events: events, settings: WearSettings(defaults: ephemeralDefaults()), defaults: ephemeralDefaults())
        let dietStore = SyncStore(url: temporaryDatabaseURL())
        let dietDefaults = ephemeralDefaults()
        dietDefaults.set(1_792_110_700_000, forKey: "pushed_at")
        dietDefaults.set("sent (set)", forKey: "last_result")
        try DietStore(dietStore).put(
            DietDay(
                date: Inert.today(),
                meals: [
                    DietMeal(id: "app-1", eatTime: 1_792_100_000, kcal: 350.5, whichMeal: 10, carbs: 40, protein: 12.5, fat: 9),
                    DietMeal(id: "watch-1792105000-20-0", eatTime: 1_792_105_000, kcal: 600, whichMeal: 20, src: "watch", synced: false),
                ],
                goals: DietGoals(dailyKcal: 2000, deficitKcal: 500, weightInitKg: 70, targetWeightKg: 65, weightManagerType: 1, activityCalGoal: 300),
                updatedAt: 1_792_110_600_000
            )
        )
        let populatedDiet = DietSync(store: dietStore, events: events, settings: WearSettings(defaults: ephemeralDefaults()), defaults: dietDefaults)
        let rig = DataSyncRig(connected: false)
        let goals = ActivityGoals(defaults: ephemeralDefaults(), service: rig.service, events: rig.events, settings: WearSettings(defaults: ephemeralDefaults()))
        let body = BodyMetrics(store: SyncStore(url: temporaryDatabaseURL()), service: rig.service, events: rig.events, settings: WearSettings(defaults: ephemeralDefaults()))
        var populatedGoals = goals.status()
        populatedGoals["configSupported"] = true
        populatedGoals["lastSentAt"] = Int64(1_792_110_700_000)
        let populatedBody = BodyMetricsData(
            weightKg: 70.5, weightTsMs: 1_760_400_000_000, bodyFatPct: 22.5, bodyFatTsMs: 1_760_400_000_000, restingKcal: 1650, systolic: 120, diastolic: 80, bpTsMs: 5
        ).toJS()
        let populatedAgps: [String: Any] = {
            let store = AgpsStore(defaults: ephemeralDefaults())
            store.recordAsk(nowMs: 1_792_110_600_000, version: 3, tags: "HW_AGNSS,HW_PGNSS_PRED")
            store.recordDownloaded(nowMs: 1_792_110_650_000, dataMs: 1_792_100_000_000, size: 115_749, source: AgpsSources.broadcom)
            store.recordDelivered(nowMs: 1_792_110_700_000, dataMs: 1_792_100_000_000, size: 115_749, source: AgpsSources.broadcom, address: "A")
            store.recordOutcome(nowMs: 1_792_110_800_000, outcome: AgpsOutcome.downloadFailed, error: "LTO: HTTP 503", countsAsFailure: true)
            let link = EphemerisLink(
                link: RigSource(), events: events, settings: WearSettings(defaults: ephemeralDefaults()), store: store, source: FakeAgpsSource(files: []),
                isOnline: { true }
            )
            return link.status()
        }()
        let shapes: [String: Any] = [
            "PhoneFeatures": Inert.phoneFeatures(),
            "NotificationAccessStatus": Inert.notificationAccess(),
            // The live watch settings with nothing connected and nothing stored: the same objects the module returns at launch.
            "WatchAlarms": features.cachedAlarms(),
            "HealthSensorsStatus": features.healthSensorsStatus(),
            "StressStatus": features.stress.status(),
            "StressStatus#listed": listedStress.stress.status(),
            "HrvReading": HrvReadingData(start: 1, end: 61, rmssd: 42.5, sdnn: 50.1, meanRr: 850.2, beats: 70, heartRate: 71).toJS(),
            "WeatherStatus": weather.status(),
            "WeatherStatus#populated": populatedWeather,
            "LiveWorkout": emptyLive,
            "LiveWorkout#ended": live.snapshot()!,
            "SafetyStatus": Inert.safety(),
            "SafetyStatus#live": liveSafety,
            "SosRelayTest": Inert.sosRelayTest(),
            // The real satellite-data status: a fresh install, and one that has downloaded, been asked, and delivered.
            "AgpsStatus": runtime.ephemeris.status(),
            "AgpsStatus#populated": populatedAgps,
            "CycleOverview": try cycle.overview(),
            "CycleOverview#populated": try populatedCycle.overview(),
            "DietStatus": diet.status(),
            "DietStatus#populated": populatedDiet.status(),
            "BodyMetrics": body.load().toJS(),
            "BodyMetrics#populated": populatedBody,
            "ActivityGoalsStatus": goals.status(),
            "ActivityGoalsStatus#populated": populatedGoals,
            // The P2P statuses of the real controller, nothing connected, and with what a watch's request leaves behind.
            "HealthyLivingStatus": p2p.healthLivingStatus(),
            "HealthyLivingStatus#populated": populatedHealthyLiving,
            "CoursesStatus": p2p.coursesStatus(),
            "RunningCoursePushResult": P2pController.pushResultJS(messageId: 12, fileName: "12courseInfo.bin", bytes: 80, uploadStatus: nil, answer: nil),
            "RunningCoursePushResult#answered": P2pController.pushResultJS(messageId: 12, fileName: "12courseInfo.bin", bytes: 80, uploadStatus: 1, answer: [0x01, 0xAB]),
            "OfflineMapLabStatus": p2p.offlineMaps.status(),
            "RoutesStatus": p2p.routesStatus(),
            "RoutePushResult": P2pController.routePushResult(
                alreadyOnWatch: true, handshakeCode: 3, maxPoints: nil, version: 0, sentPoints: 0, bytes: 0, uploadStatus: nil, answerCode: nil
            ),
            "RoutePushResult#sent": P2pController.routePushResult(
                alreadyOnWatch: false, handshakeCode: 1, maxPoints: 200, version: 2, sentPoints: 57, bytes: 7000, uploadStatus: 1, answerCode: 1
            ),
            "DeviceInfo": info.toJS(),
            "BondedDevice": ["address": info.address, "name": info.name].merging(WatchModels.match(info.name).toJS()) { a, _ in a },
            "UserProfile": UserProfileData(heightCm: 170, weightKg: 65.5, birthYear: 1990, sex: "male", dailyStepGoal: 8000).toJS(),
            "SyncSummary": SyncSummary(from: 1, to: 2, samples: 3, sleep: 4, totalSteps: 5, totalCalories: 6, totalDistance: 7).toJS(),
            "HealthConnectExportResult": HealthExportCounts().toJS(),
            "SupportReport": SupportReport.build(
                environment: .init(app: "a", phone: "p"), watchName: nil, device: nil, linkState: "disconnected", log: [], caps: nil, transport: nil
            ),
        ]
        let data = try JSONSerialization.data(withJSONObject: shapes, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: URL(fileURLWithPath: out))
    }
}
