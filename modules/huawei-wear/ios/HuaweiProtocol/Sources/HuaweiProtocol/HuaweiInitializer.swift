// Port of the connection-essential part of HuaweiInitializer.kt (GB HuaweiSupportProvider.initializeDeviceConfigure): ProductInfo,
// SetTime, BatteryLevel, SupportedServices -> SupportedCommands, ExpandCapability, ExtendedAccount, SettingRelated, AcceptAgreement,
// ReverseCapabilities, SetUpDeviceStatus (+ WearStatus), ConnectStatus, the saved profile, the heart-rate zones (FitnessData branch; the user's or GB's defaults) and the
// saved health sensor switches, and last the phone's language (SetLanguageSetting).
// Not ported on purpose: notification capabilities/constraints/state; the P2P (Track) branch of the heart-rate zones.
import Foundation

public struct InitResult: Sendable {
    public let productModel: String?
    public let softwareVersion: String?
    public let hardwareVersion: String?
    public let serialNumber: String?
    public let deviceName: String?
    public let batteryLevel: Int?

    public init(
        productModel: String?, softwareVersion: String?, hardwareVersion: String?, serialNumber: String?, deviceName: String?, batteryLevel: Int?
    ) {
        self.productModel = productModel
        self.softwareVersion = softwareVersion
        self.hardwareVersion = hardwareVersion
        self.serialNumber = serialNumber
        self.deviceName = deviceName
        self.batteryLevel = batteryLevel
    }
}

/// Same order and soft-failure semantic as the Kotlin class: every request has GB's 2 s `initTimeout`, and a missing or unreadable reply
/// only logs and goes on to the next request (`soft`). Only a lost link or cancellation aborts.
public final class HuaweiInitializer {
    private let session: HuaweiSession
    private let caps: DeviceCaps
    private let log: LogSink
    /// Bluetooth name of the watch; GB sends the device name in SetUpDeviceStatus.
    private let bondedName: String?
    /// LinkParams protocolVersion (GB `getProtocolVersion()`); read only by the notification layer, which is not part of this class.
    let protocolVersion: Int
    private let profile: UserProfileData?
    /// The sensor switches the user saved (continuous heart rate, SpO2, TruSleep, alerts); sent on every connect.
    private let healthSensors: HealthSensorConfig
    private let deviceType: HuaweiDeviceType
    /// The language JoyoFit's Settings pinned (`id`, `en`), or nil to follow `phoneLanguage`; sent as the watch's language.
    private let pinnedLanguage: String?
    /// The phone's first language as a BCP-47 tag (`Locale.preferredLanguages`).
    private let phoneLanguage: String
    /// The heart-rate zones the user configured in the app; nil sends GB's defaults for the profile age.
    private let heartRateZones: HeartRateZonesCalc.UserZones?
    /// The user's Huawei account id, sent in 1A/05 so a watch set up under that account is not asked to factory-reset; nil/empty sends
    /// GB's empty default (the behaviour before this setting). Only an account id, no signature.
    private let huaweiAccount: String?

    /// Replaced by tests: the phase timeouts, the clock SetTime reads and the zone it reports.
    var timeouts = LinkTimeouts()
    var now: () -> Date = { Date() }
    var timeZone: TimeZone = .current

    private var params: ParamsProvider { session.params }

    public init(
        session: HuaweiSession, caps: DeviceCaps, log: @escaping LogSink, bondedName: String?, protocolVersion: Int,
        profile: UserProfileData? = nil, healthSensors: HealthSensorConfig = HealthSensorConfig(), deviceType: HuaweiDeviceType = .ble,
        pinnedLanguage: String? = nil, phoneLanguage: String = LanguageSender.phoneLanguage(),
        heartRateZones: HeartRateZonesCalc.UserZones? = nil, huaweiAccount: String? = nil
    ) {
        self.session = session
        self.caps = caps
        self.log = log
        self.bondedName = bondedName
        self.protocolVersion = protocolVersion
        self.profile = profile
        self.healthSensors = healthSensors
        self.deviceType = deviceType
        self.pinnedLanguage = pinnedLanguage
        self.phoneLanguage = phoneLanguage
        self.heartRateZones = heartRateZones
        self.huaweiAccount = huaweiAccount
    }

    private func info(_ message: String) {
        log(LogEntry(.info, message))
    }

    public func run() async throws -> InitResult {
        caps.reset()
        var productModel: String?
        var softwareVersion: String?
        var hardwareVersion: String?
        var serialNumber: String?
        var deviceName: String?
        var battery: Int?

        // GetProductInformationRequest
        try await soft("ProductInfo") {
            let response = try await session.request(
                DeviceConfig.ProductInfo.request(deviceType: deviceType), as: DeviceConfig.ProductInfo.Response.self,
                timeoutMs: timeouts.initMs, label: "ProductInfo"
            )
            softwareVersion = response.softwareVersion
            hardwareVersion = response.hardwareVersion
            productModel = response.productModel
            serialNumber = response.serialNumber
            deviceName = response.deviceName
            info(
                "ProductInfo: model=\(productModel ?? "nil") software=\(softwareVersion ?? "nil") hardware=\(hardwareVersion ?? "nil") "
                    + "serial=\(serialNumber ?? "nil") name=\(deviceName ?? "nil") package=\(response.packageName ?? "nil") region=\(response.regionCode)"
            )
        }

        // SetTimeRequest(syncTime = true): read the watch clock, send the time again if it differs.
        try await soft("SetTime") {
            let response = try await session.request(
                DeviceConfig.TimeRequest.request(now: now(), timeZone: timeZone), as: DeviceConfig.TimeRequest.Response.self,
                timeoutMs: timeouts.initMs, label: "SetTime"
            )
            let deviceTime = Int(response.deviceTime)
            let systemTime = Int(Int32(truncatingIfNeeded: Int64(now().timeIntervalSince1970)))
            let diff = abs(systemTime - deviceTime)
            info("SetTime: systemTime=\(systemTime) deviceTime=\(deviceTime) diff=\(diff)")
            if diff > 0 {
                _ = try await session.request(
                    DeviceConfig.TimeRequest.request(now: now(), timeZone: timeZone), as: DeviceConfig.TimeRequest.Response.self,
                    timeoutMs: timeouts.initMs, label: "SetTime (apply)"
                )
            }
        }

        // GetBatteryLevelRequest
        try await soft("BatteryLevel") {
            battery = try await session.queryBattery(timeoutMs: timeouts.initMs)
            info("BatteryLevel: \(battery.map(String.init) ?? "nil")%")
        }

        var supportedCommands: [Int: Bytes] = [:]
        var expandCapabilities: Bytes?

        func supports(_ service: Int, _ command: Int) -> Bool {
            supportedCommands[service]?.contains(UInt8(truncatingIfNeeded: command)) == true
        }

        /// GB HuaweiState.supportsExpandCapability(int): bit `which % 8` of byte `which / 8`.
        func expandCapability(_ which: Int) -> Bool {
            guard let bitmap = expandCapabilities, which < bitmap.count * 8 else { return false }
            let bit = 1 << (which % 8)
            return Int(bitmap[which / 8]) & bit == bit
        }

        // GetSupportedServicesRequest, then GetSupportedCommandsRequest for what it activates.
        try await soft("SupportedServices") {
            let known = DeviceConfig.SupportedServices.knownSupportedServices
            let response = try await session.request(
                DeviceConfig.SupportedServices.request(allSupportedServices: known), as: DeviceConfig.SupportedServices.Response.self,
                timeoutMs: timeouts.initMs, label: "SupportedServices"
            )
            let supported = response.supportedServices

            var activated: [UInt8] = [0x01] // device always supports service 1
            for i in 0..<min(supported.count, known.count) where Int8(bitPattern: supported[i]) == 1 { activated.append(known[i]) }
            info("SupportedServices: " + activated.map { $0.hex2 }.joined(separator: " "))
            try await requestSupportedCommands(activated: &activated, into: &supportedCommands)
        }

        // GetSupportedCommandsRequest -> GetExpandCapabilityRequest, then the order of GB initializeDynamicServices up to ConnectStatus.
        if supports(0x01, Int(DeviceConfig.ExpandCapability.id)) {
            try await soft("ExpandCapability") {
                expandCapabilities = try await session.request(
                    DeviceConfig.ExpandCapability.request(), as: DeviceConfig.ExpandCapability.Response.self,
                    timeoutMs: timeouts.initMs, label: "ExpandCapability"
                ).expandCapabilities
                info("ExpandCapability: \(expandCapabilities?.count ?? 0) bytes")
            }
        }
        caps.supportedCommands = supportedCommands
        caps.expandCapabilities = expandCapabilities
        // What the support report needs to answer "can this watch take a language / music?": GB supportsLanguageSetting is 0C/01, music upload
        // is 25/04, music control 25/02, "more music" ExpandCapability 122 (docs/watch-music.md).
        func listed(_ service: Int) -> String { supportedCommands[service].map { $0.map { $0.hex2 }.joined(separator: " ") } ?? "not listed" }
        info("Language and music: 0C=[\(listed(0x0C))] 25=[\(listed(0x25))] moreMusic(ExpandCapability 122)=\(expandCapability(122))")

        // SendExtendedAccountRequest (first in GB initializeDynamicServices): the user's Huawei account id if they set one on the
        // watch-face screen, else GB's empty default. Watches that judge accounts wait for this after a bind; sending the account the
        // watch was set up under keeps it from asking for a factory reset.
        if supports(Int(AccountRelated.id), 0x05) && supports(Int(AccountRelated.id), 0x06) {
            try await soft("ExtendedAccount") {
                _ = try await session.request(
                    AccountRelated.SendExtendedAccountToDevice.request(
                        accountPairingOptimization: expandCapability(0xac), account: huaweiAccount ?? ""),
                    timeoutMs: timeouts.initMs, label: "ExtendedAccount"
                )
                info("ExtendedAccount: acknowledged (account \(huaweiAccount != nil ? "set" : "empty"))")
            }
        }
        if supports(0x01, Int(DeviceConfig.SettingRelated.id)) {
            try await soft("SettingRelated") {
                // GetSettingRelatedRequest.processResponse: the file-sync flags of tag 0x02.
                let response = try await session.request(
                    DeviceConfig.SettingRelated.request(), as: DeviceConfig.SettingRelated.Response.self,
                    timeoutMs: timeouts.initMs, label: "SettingRelated"
                )
                caps.truSleepNewSync = response.truSleepNewSync
                caps.rriNewSync = response.rriNewSync
                caps.gpsNewSync = response.gpsNewSync
                info("SettingRelated: truSleepNewSync=\(response.truSleepNewSync) rriNewSync=\(response.rriNewSync) gpsNewSync=\(response.gpsNewSync)")
            }
        }
        if supports(0x01, Int(DeviceConfig.AcceptAgreement.id)) {
            try await soft("AcceptAgreement") {
                _ = try await session.request(DeviceConfig.AcceptAgreement.request(), timeoutMs: timeouts.initMs, label: "AcceptAgreement")
                info("AcceptAgreement: acknowledged")
            }
        }
        if expandCapability(182) {
            try await soft("ReverseCapabilities") {
                _ = try await session.request(DeviceConfig.ReverseCapabilities.request(), timeoutMs: timeouts.initMs, label: "ReverseCapabilities")
            }
        }
        if expandCapability(109) {
            // SendSetUpDeviceStatusRequest: relationship 1 = main device. GB: "The watch never answers to this command" (50 ms timeout),
            // so a timeout here is the expected outcome.
            let name = bondedName ?? deviceName ?? ""
            do {
                _ = try await session.request(
                    DeviceConfig.SetUpDeviceStatusRequest.request(relationShip: 1, deviceName: name),
                    timeoutMs: timeouts.setupStatusMs, label: "SetUpDeviceStatus"
                )
            } catch let e as WearError {
                if e.code != .timeout { throw e }
            }
            info("SetUpDeviceStatus: sent as main device \"\(name)\"")
            try await soft("WearStatus") {
                _ = try await session.request(DeviceConfig.WearStatus.request(), timeoutMs: timeouts.initMs, label: "WearStatus")
            }
        }
        if supports(0x01, 0x35) {
            try await soft("ConnectStatus") {
                _ = try await session.request(DeviceConfig.ConnectStatusRequest.request(), timeoutMs: timeouts.initMs, label: "ConnectStatus")
            }
        }

        // SendFitnessUserInfoRequest + SendFitnessGoalRequest, once the user has saved a profile.
        if let saved = profile {
            try await soft("FitnessProfile") {
                try await ProfileSender.sendProfile(session: session, caps: caps, log: log, profile: saved, now: now(), timeoutMs: timeouts.initMs)
            }
        }

        // SendHeartRateZonesConfig: the zones the workout screen shows (FitnessData 07/13|21; Track watches take them over P2P).
        info(HeartRateZonesSync.capsLine(caps))
        try await soft("HeartRateZones") {
            _ = try await HeartRateZonesSync.sendFitnessData(
                session: session, caps: caps, log: log, age: HeartRateZonesSync.age(profile: profile, now: now()), user: heartRateZones,
                timeoutMs: timeouts.initMs
            )
        }

        // The heart-rate capability notifications and the sensor switches. GB sends none of these at init (only when a setting changes, all
        // off by default), so a wiped watch never records heart rate.
        try await soft("HealthSensors") {
            let gates = HealthSensorSupport.of(caps.supports)
            info(
                "HealthSensors gates: heartRate(07/17)=\(gates.heartRate) realtime(07/1c)=\(gates.realtimeHeartRate) "
                    + "spo2(07/24)=\(gates.spo2) truSleep(07/16)=\(gates.truSleep) highAlert(07/1d)=\(gates.highHeartRateAlert) "
                    + "lowAlert(07/22)=\(gates.lowHeartRateAlert) restHeartRateNotify(07/23)=\(caps.supports(0x07, 0x23)) "
                    + "workoutHeartRateNotify(17/17)=\(caps.supports(0x17, 0x17)) zones(07/13)=\(caps.supports(0x07, 0x13)) "
                    + "zonesExtended(07/21)=\(caps.supports(0x07, 0x21)) lowSpo2Alert(07/25)=\(caps.supports(0x07, 0x25))"
            )
            let plan = HealthSensors.plan(supports: caps.supports, config: healthSensors, previous: nil)
            let acknowledged = try await HealthSensors.send(session: session, log: log, plan: plan, timeoutMs: timeouts.initMs)
            info("HealthSensors: \(acknowledged) of \(plan.count) requests acknowledged")
        }

        // SetLanguageSettingRequest (GB init queue; Huawei Health sends it on every connect), see `LanguageSender`.
        try await soft("LanguageSetting") {
            _ = try await LanguageSender.send(
                session: session, caps: caps, log: log, pinned: pinnedLanguage, phone: phoneLanguage, timeoutMs: timeouts.initMs
            )
        }

        return InitResult(
            productModel: productModel, softwareVersion: softwareVersion, hardwareVersion: hardwareVersion, serialNumber: serialNumber,
            deviceName: deviceName, batteryLevel: battery
        )
    }

    /// GetSupportedCommandsRequest: as many services per request as fit, repeated until none are left.
    private func requestSupportedCommands(activated: inout [UInt8], into supportedCommands: inout [Int: Bytes]) async throws {
        let commandsPerService = DeviceConfig.SupportedCommands.commandsPerService
        // GB would NPE on a service without a known command table; those are skipped.
        activated.removeAll { service in
            let unknown = commandsPerService[Int(Int8(bitPattern: service))] == nil
            if unknown { info("SupportedCommands: no command table for service \(service.hex2), skipped") }
            return unknown
        }
        var requestNumber = 0
        var serviceCount = 0
        while !activated.isEmpty {
            var request = DeviceConfig.SupportedCommands.Request(params: params)
            var nextService = activated.removeFirst()
            var fits = request.addCommandsForService(nextService, commandsPerService[Int(Int8(bitPattern: nextService))]!)
            if !fits {
                // Not even one service fits an empty request; GB would resend the same empty request forever.
                log(LogEntry(.error, "SupportedCommands: service \(nextService.hex2) does not fit a request, skipped"))
                continue
            }
            while fits && !activated.isEmpty {
                nextService = activated.removeFirst()
                fits = request.addCommandsForService(nextService, commandsPerService[Int(Int8(bitPattern: nextService))]!)
            }
            if !fits { activated.insert(nextService, at: 0) } // put the extra back

            requestNumber += 1
            let response = try await session.request(
                request.packet, as: DeviceConfig.SupportedCommands.Response.self, timeoutMs: timeouts.queryMs,
                label: "SupportedCommands #\(requestNumber)"
            )
            serviceCount += response.commandsLists.count
            for list in response.commandsLists { supportedCommands[list.service] = list.commands }
        }
        info("SupportedCommands: \(serviceCount) services in \(requestNumber) request(s)")
    }

    private func soft(_ label: String, _ block: () async throws -> Void) async throws {
        do {
            try await block()
        } catch is CancellationError {
            throw CancellationError()
        } catch let e as WearError {
            if e.code == .disconnected { throw e }
            log(LogEntry(.error, "\(label) skipped: \(e.message)"))
        } catch {
            log(LogEntry(.error, "\(label) skipped: \(error)"))
        }
    }
}

extension HuaweiSession {
    /// GetBatteryLevelRequest: the first battery level (watches report a single one).
    public func queryBattery(timeoutMs: Int) async throws -> Int {
        let response = try await request(
            DeviceConfig.BatteryLevel.request(), as: DeviceConfig.BatteryLevel.Response.self, timeoutMs: timeoutMs, label: "BatteryLevel"
        )
        if let multi = response.multiLevel, !multi.isEmpty { return Int(multi[0]) }
        return Int(UInt8(bitPattern: response.level))
    }
}
