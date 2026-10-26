// Owner of the P2P features across connections. Port of P2pController.kt: builds a `P2PStack` on every new session, registers the services Huawei
// gates by ExpandCapability (Healthy Living, heart-rate zones, the health dictionary sync), runs the dictionary sync as an extension of the
// activity sync and answers the watch's Healthy Living requests; also the experimental running-course push.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

public final class P2pController: LinkObserver, @unchecked Sendable {
    public static let pingWaitMs = 4_000
    public static let answerWaitMs = 10_000
    /// GB uses file type 7 for every P2P file (`HuaweiP2PFitnessData`, `HuaweiP2PContactsService`, ...).
    private static let fileTypeP2P: UInt8 = 7

    public let settings: P2pSettings
    /// The offline-map lab (P2P module `mapkit`, behind `settings.offlineMapLab`).
    public let offlineMaps: OfflineMapLab
    private let link: LinkHandleSource
    private let wearSettings: WearSettings
    private let syncStore: SyncStore
    private let events: WearEvents
    private let metrics: HealthMetricsStore
    private let nowMs: @Sendable () -> Int64
    private let pingWaitMs: Int
    private let answerWaitMs: Int
    private let lock = NSLock()
    private var _stack: P2PStack?
    private var attached: HuaweiSession?

    public init(
        settings: P2pSettings, link: LinkHandleSource, addSyncExtension: (@escaping WearLink.SyncExtension) -> Void, wearSettings: WearSettings,
        syncStore: SyncStore, events: WearEvents, nowMs: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) },
        pingWaitMs: Int = P2pController.pingWaitMs, answerWaitMs: Int = P2pController.answerWaitMs
    ) {
        self.settings = settings
        self.link = link
        self.wearSettings = wearSettings
        self.syncStore = syncStore
        self.events = events
        self.metrics = HealthMetricsStore(store: syncStore, address: { [link] in link.handle()?.address })
        self.nowMs = nowMs
        self.pingWaitMs = pingWaitMs
        self.answerWaitMs = answerWaitMs
        self.offlineMaps = OfflineMapLab(settings: settings, link: link, events: events)
        // The dictionary sync runs inside the activity sync, under its operation lock, after the workouts.
        addSyncExtension { [weak self] _ in try await self?.syncHealthMetrics() }
        offlineMaps.bind { [weak self] in self?.stack }
    }

    /// The live stack, or nil when the watch is not connected or has no P2P service.
    public var stack: P2PStack? { lock.locked { _stack } }

    // MARK: LinkObserver

    public func linkConnected(_ handle: LinkHandle) async {
        let (isNew, replaced): (Bool, P2PStack?) = lock.locked {
            if let attached, attached === handle.session { return (false, nil) }
            attached = handle.session
            let old = _stack
            _stack = nil
            return (true, old)
        }
        if !isNew { return }
        replaced?.close()
        let settings = self.settings
        let syncStore = self.syncStore
        let wearSettings = self.wearSettings
        let nowMs = self.nowMs
        let created = P2PStack(
            session: handle.session, caps: handle.caps, log: events.sink, settings: settings,
            healthModelFactory: { [events] manager in
                HealthModelService(
                    manager: manager, settings: settings, log: events.sink,
                    dayLoader: { requestedDay in
                        try syncStore.read {
                            HealthModelData.load(db: $0, requestedDay: requestedDay, stepGoal: wearSettings.profile?.dailyStepGoal ?? 0, nowMs: nowMs())
                        }
                    },
                    goals: { HealthGoals() }, nowMs: nowMs
                )
            },
            heartRateAge: { HeartRateZonesSync.age(profile: wearSettings.profile) },
            heartRateZones: { wearSettings.heartRateZones }
        )
        lock.locked { _stack = created }
        await created.start()
        created.registerServices()
        offlineMaps.attach(created)
        recordGates(created, caps: handle.caps)
    }

    public func linkDisconnected() {
        let old: P2PStack? = lock.locked {
            defer {
                _stack = nil
                attached = nil
            }
            return _stack
        }
        old?.close()
    }

    private func recordGates(_ created: P2PStack, caps: DeviceCaps) {
        guard created.dictionary != nil else { return }
        HealthMetricsSync(stack: created, store: metrics, caps: caps, log: events.sink).recordGates()
    }

    // MARK: health metrics

    /// Called from the activity sync under the operation lock; never throws except for a lost link or cancellation.
    private func syncHealthMetrics() async throws {
        guard let current = stack, let handle = link.handle() else {
            events.info("Health metrics: no P2P stack (the watch lists no 34/01); skipped")
            return
        }
        do {
            if let result = try await HealthMetricsSync(stack: current, store: metrics, caps: handle.caps, log: events.sink).sync() {
                events.info("Health metrics: \(result.total) rows stored" + (result.failed.isEmpty ? "" : ", failed: \(result.failed.joined(separator: ", "))"))
            } else {
                return
            }
        } catch is CancellationError {
            throw CancellationError()
        } catch let e as WearError {
            if e.code == .disconnected { throw e }
            events.error("Health metrics sync failed: \(e.message)")
        } catch {
            events.error("Health metrics sync failed: \(error)")
        }
        // The day may have changed with the sync: tell the watch's Healthy Living, as Huawei Health does after data changes.
        current.healthModel?.push("activity sync")
    }

    // MARK: Healthy Living

    public func healthLivingStatus() -> [String: Any] {
        let current = stack
        let service = current?.healthModel
        let gateSet = link.handle()?.caps.expandCapability(37) ?? false
        let version = settings.healthLivingMsgVer
        let request = settings.healthLivingLastRequestMs
        let report = settings.healthLivingLastReportMs
        return [
            "supported": current != nil && gateSet,
            "gate": "ExpandCapability 37",
            "gateSet": gateSet,
            "enabled": settings.healthLivingEnabled,
            "registered": service != nil,
            "pingCode": service?.pingCode.map { $0 as Any } ?? NSNull(),
            "msgVer": version > 0 ? Double(version) as Any : NSNull(),
            "packageSize": settings.healthLivingPackageSize,
            "lastRequestAt": request > 0 ? request as Any : NSNull(),
            "lastReportAt": report > 0 ? report as Any : NSNull(),
            "lastReport": settings.healthLivingLastSummary.map { $0 as Any } ?? NSNull(),
        ]
    }

    public func setHealthLivingEnabled(_ enabled: Bool) {
        settings.healthLivingEnabled = enabled
        // Registration happens on connect; the change applies from the next connection (or now when switching off).
        if !enabled { stack?.healthModel?.unregister() }
    }

    /// Sends today's report now, as a push; false when the watch has not asked before (its msgVer is unknown).
    public func pushHealthLiving() async throws -> Bool {
        guard let service = stack?.healthModel else {
            throw WearError(
                .unsupported,
                "Healthy Living is not available: the watch is not connected, does not set ExpandCapability 37, or the feature is off"
            )
        }
        if settings.healthLivingMsgVer <= 0 { return false }
        service.push("manual")
        return true
    }

    // MARK: running courses (experimental, off by default)

    public func coursesStatus() -> [String: Any] {
        let caps = link.handle()?.caps
        return [
            "enabled": settings.experimentalCourses,
            // Huawei Health gates on ExpandCapability 41 (intelligent run plan) or 169 (AI fitness plan).
            "gate41": caps?.expandCapability(41) ?? false,
            "gate169": caps?.expandCapability(169) ?? false,
            "gate295": caps?.expandCapability(295) ?? false,
            "p2p": stack != nil,
        ]
    }

    /// Pushes `course` to the watch's `in.huawei.fitness` app as `<messageId>courseInfo.bin` (see `CourseProtobuf`). The flow follows Huawei
    /// Health's behaviour; nothing of it has been seen on a watch, so every step is logged and the result reports what the watch said, including
    /// the body of its answer message.
    public func pushCourse(_ course: RunningCourse) async throws -> [String: Any] {
        if !settings.experimentalCourses {
            throw WearError(.unsupported, "Running courses are an experimental feature; switch them on in the app first")
        }
        try CourseProtobuf.validate(course)
        guard let handle = link.handle() else { throw WearError(.notConnected, "Not connected to a watch") }
        guard let current = stack else { throw WearError(.unsupported, "The watch does not list the P2P service (34/01)") }
        let gate41 = handle.caps.expandCapability(41)
        let gate169 = handle.caps.expandCapability(169)
        events.info("Courses: gates ExpandCapability 41=\(gate41) 169=\(gate169) 295=\(handle.caps.expandCapability(295)) (Huawei Health: 41 or 169)")
        if !gate41 && !gate169 {
            throw WearError(.unsupported, "The watch sets neither ExpandCapability 41 nor 169, the bits Huawei Health requires before it pushes a course")
        }
        let service = await readyFitnessService(current, label: "Courses")

        let messageId = P2PSubMsg.nextMessageId()
        let updateTime = Int(nowMs() / 1000)
        let payload = CourseProtobuf.encode(course, updateTimeSec: updateTime)
        let file = CourseProtobuf.message(businessType: CourseProtobuf.businessCustomCourse, messageId: messageId, payload: payload)
        let fileName = CourseProtobuf.fileName(messageId)
        events.info("Courses: \(course.name): \(course.actionCount) steps, CourseStorageInfo \(payload.count) bytes, \(fileName) \(file.count) bytes: \(file.hexUpper)")

        let answer = service.expectAnswer(messageId)
        defer { service.forget(messageId) }
        let events = self.events
        let outcome: UploadOutcome = try await handle.operationLock.withLock {
            let route = P2pRoute(
                srcPackage: FitnessCourseService.moduleName, dstPackage: FitnessCourseService.packageName, srcFingerprint: service.localFingerprint,
                dstFingerprint: FitnessCourseService.fingerprintValue
            )
            return try await FileUploader(session: handle.session, caps: handle.caps, log: events.sink, onProgress: { bytes, total in events.uploadProgress(bytes: bytes, total: total) })
                .upload(UploadFile(fileName: fileName, fileType: P2pController.fileTypeP2P, data: file, route: route))
        }
        let reply: Bytes? = await p2pWithTimeout(ms: answerWaitMs) { try await answer.value() }
        let replyText = reply.map { "body \($0.hexUpper.isEmpty ? "(empty)" : $0.hexUpper)" } ?? "none within \(answerWaitMs / 1000) s"
        events.info("Courses: upload finished, watch result status=\(outcome.resultStatus.map(String.init) ?? "none"); answer message \(replyText)")
        return P2pController.pushResultJS(messageId: messageId, fileName: fileName, bytes: file.count, uploadStatus: outcome.resultStatus, answer: reply)
    }

    /// The `fitness` P2P service of this connection, registered if needed, once it answered the ping (or `pingWaitMs` passed; the send goes on anyway).
    private func readyFitnessService(_ current: P2PStack, label: String) async -> FitnessCourseService {
        let service: FitnessCourseService
        if let existing = current.manager.registeredService(FitnessCourseService.moduleName) as? FitnessCourseService {
            service = existing
        } else {
            service = FitnessCourseService(manager: current.manager, log: events.sink)
            service.register()
        }
        let ready: Bool? = await p2pWithTimeout(ms: pingWaitMs) {
            while service.pingCode == nil { try await Task.sleep(nanoseconds: 100_000_000) }
            return true
        }
        let ping = service.pingCode.map { String(format: "0x%02x", $0 & 0xFF) } ?? "no answer in \(pingWaitMs) ms"
        events.info("\(label): ping of \(FitnessCourseService.packageName) -> \(ping); sending anyway")
        if ready != true { events.info("\(label): the fitness app did not answer the ping; the upload may be refused") }
        return service
    }

    /// `RunningCoursePushResult` of HuaweiWearP2p.types.ts.
    public static func pushResultJS(messageId: Int, fileName: String, bytes: Int, uploadStatus: Int?, answer: Bytes?) -> [String: Any] {
        [
            "messageId": messageId,
            "fileName": fileName,
            "bytes": bytes,
            "uploadStatus": uploadStatus.map { $0 as Any } ?? NSNull(),
            "answered": answer != nil,
            "answerHex": answer.map { $0.hexUpper as Any } ?? NSNull(),
        ]
    }

    /// `RunningCourse` of HuaweiWearP2p.types.ts from the JS object, with the Android record's defaults for a missing field; a mistyped field or an
    /// unknown name is an invalid argument. The id is a generated stable string (Huawei's exerciseId of a custom course is one too).
    public static func parseCourse(_ raw: [String: Any], nowMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) throws -> RunningCourse {
        func bad(_ what: String) -> WearError { WearError(.invalidArgument, what) }
        func int(_ value: Any?, _ name: String, _ fallback: Int) throws -> Int {
            guard let value, !(value is NSNull) else { return fallback }
            switch value {
            case let i as Int: return i
            case let d as Double where d == d.rounded(): return Int(d)
            case let n as NSNumber where n.doubleValue == n.doubleValue.rounded(): return n.intValue
            default: throw bad("'\(name)' must be a whole number")
            }
        }
        func text(_ value: Any?, _ name: String, _ fallback: String) throws -> String {
            guard let value, !(value is NSNull) else { return fallback }
            guard let s = value as? String else { throw bad("'\(name)' must be text") }
            return s
        }
        let name = try text(raw["name"], "name", "")
        var blocks = [CourseBlock]()
        for rawBlock in (raw["blocks"] as? [Any]) ?? [] {
            guard let block = rawBlock as? [String: Any] else { throw bad("Every block must be an object") }
            var steps = [CourseStep]()
            for rawStep in (block["steps"] as? [Any]) ?? [] {
                guard let s = rawStep as? [String: Any] else { throw bad("Every step must be an object") }
                let kind = try text(s["kind"], "kind", "run")
                let target = try text(s["target"], "target", "time")
                let intensity = try text(s["intensity"], "intensity", "none")
                guard let kindValue = CourseStepKind(wire: kind) else { throw bad("Unknown step kind '\(kind)'") }
                guard let targetKind = CourseTarget(wire: target) else { throw bad("Unknown target '\(target)'") }
                guard let intensityValue = CourseIntensity(wire: intensity) else { throw bad("Unknown intensity '\(intensity)'") }
                steps.append(
                    CourseStep(
                        kind: kindValue, target: targetKind, targetValue: try int(s["targetValue"], "targetValue", 0), intensity: intensityValue,
                        low: try int(s["low"], "low", 0), high: try int(s["high"], "high", 0)
                    )
                )
            }
            blocks.append(CourseBlock(repeatCount: try int(block["repeat"], "repeat", 1), steps: steps))
        }
        return RunningCourse(id: "JF" + String(nowMs, radix: 36).uppercased(), name: name.trimmingCharacters(in: .whitespacesAndNewlines), blocks: blocks)
    }

    // MARK: routes (navigation on the watch)

    private static let routeDeliverBit = 70
    private static let routeAltitudeBit = 216
    private static let routeImageBit = 218
    private static let routeSceneBit = 272
    private static let routeClimbBit = 318

    /// `RoutesStatus` of HuaweiWearRoutes.types.ts: the watch's route gates (Huawei Health's `RouteTransferDataHolder`): 70 deliver, 216 altitude profile,
    /// 218 picture, 272 scene types, 318 climb.
    public func routesStatus() -> [String: Any] {
        let caps = link.handle()?.caps
        return [
            "p2p": stack != nil,
            "deliver": caps?.expandCapability(P2pController.routeDeliverBit) ?? false,
            "altitude": caps?.expandCapability(P2pController.routeAltitudeBit) ?? false,
            "image": caps?.expandCapability(P2pController.routeImageBit) ?? false,
            "sceneTypes": caps?.expandCapability(P2pController.routeSceneBit) ?? false,
            "climb": caps?.expandCapability(P2pController.routeClimbBit) ?? false,
        ]
    }

    /// Puts `route` on the watch the way Huawei Health's "Send to wearable" does (and GB's `HuaweiP2PFitnessData.sendTrack`): a P2P message of type 5 with the
    /// route's name, the watch's answer (code, point limit), the route as a P2P file of type 6 (`byte.bin`), the watch's answer to that. Every step is logged.
    public func pushRoute(_ route: RouteTrack) async throws -> [String: Any] {
        try RouteFile.validate(route)
        guard let handle = link.handle() else { throw WearError(.notConnected, "Not connected to a watch") }
        guard let current = stack else { throw WearError(.unsupported, "The watch does not list the P2P service (34/01)") }
        let caps = handle.caps
        let deliver = caps.expandCapability(P2pController.routeDeliverBit)
        let altitudeGate = caps.expandCapability(P2pController.routeAltitudeBit)
        events.info(
            "Routes: gates ExpandCapability 70 (deliver)=\(deliver) 216 (altitude)=\(altitudeGate) 218=\(caps.expandCapability(P2pController.routeImageBit)) 272=\(caps.expandCapability(P2pController.routeSceneBit)) 318=\(caps.expandCapability(P2pController.routeClimbBit))"
        )
        if !deliver { throw WearError(.unsupported, "The watch does not set ExpandCapability 70, the bit Huawei Health requires before it sends a route") }
        let service = await readyFitnessService(current, label: "Routes")

        // Without ExpandCapability 216 Huawei Health sends the plain line: version 1, no altitude, no marker points.
        let version = altitudeGate ? 2 : 1
        let track = RouteTrack(
            id: route.id, name: route.name, fixes: route.fixes, hasAltitude: route.hasAltitude && version == 2, totalTimeSec: route.totalTimeSec, version: version
        )

        let handshakeAnswer = service.expectRouteAnswer(RouteFile.businessRouteHandshake)
        let fileAnswer = service.expectRouteAnswer(RouteFile.businessRouteFile)
        defer {
            service.forgetRouteAnswer(RouteFile.businessRouteHandshake)
            service.forgetRouteAnswer(RouteFile.businessRouteFile)
        }
        let events = self.events
        let answerWaitMs = self.answerWaitMs
        let handshake = RouteFile.message(
            businessType: RouteFile.businessRouteHandshake, messageId: P2PSubMsg.nextMessageId(), payload: RouteFile.handshakeBody(name: track.name)
        )
        events.info("Routes: handshake for \"\(track.name)\": \(handshake.hexUpper)")
        let ack = P2PWaiter<Int>()
        service.sendCommand(handshake) { code, _ in ack.complete(code) }
        let ackCode = try await P2pController.answer(within: answerWaitMs, ack)
        events.info(
            "Routes: handshake acknowledged with \(ackCode.map { String(format: "0x%02x", $0 & 0xFF) } ?? "nothing in \(answerWaitMs / 1000) s") (0xcf = received)"
        )
        if let ackCode, (ackCode & 0xFF) != 0xCF {
            throw WearError(
                .uploadRejected, "The watch did not take the route handshake (\(String(format: "0x%02x", ackCode & 0xFF)))", statusCode: ackCode & 0xFF
            )
        }
        guard let handshakeBody = try await P2pController.answer(within: answerWaitMs, handshakeAnswer) else {
            throw WearError(.timeout, "The watch did not answer the route handshake within \(answerWaitMs / 1000) s")
        }
        let answer = RouteFile.parseAnswer(handshakeBody)
        events.info(
            "Routes: handshake answer body \(handshakeBody.hexUpper.isEmpty ? "(empty)" : handshakeBody.hexUpper) -> code \(answer.map { String($0.code) } ?? "nil"), point limit \(answer?.maxPoints.map(String.init) ?? "nil")"
        )
        switch answer?.code {
        case 1: break
        case 3:
            return P2pController.routePushResult(
                alreadyOnWatch: true, handshakeCode: 3, maxPoints: answer?.maxPoints, version: 0, sentPoints: 0, bytes: 0, uploadStatus: nil, answerCode: nil
            )
        case 2: throw WearError(.routeFull, "The watch's route list is full", statusCode: 2)
        case 5: throw WearError(.routeName, "The watch does not take a route name this long", statusCode: 5)
        default:
            throw WearError(
                .uploadRejected, "The watch refused the route (handshake code \(answer.map { String($0.code) } ?? "none"))", statusCode: answer?.code
            )
        }

        let limit = RouteFile.pointLimit(answer)
        let body = RouteFile.convert(track, maxPoints: limit)
        if body.isEmpty { throw WearError(.invalidArgument, "The route could not be converted for the watch") }
        let messageId = P2PSubMsg.nextMessageId()
        let file = RouteFile.message(businessType: RouteFile.businessRouteFile, messageId: messageId, payload: body)
        let sentPoints = RouteFile.pointCount(file: body, version: version)
        events.info(
            "Routes: \(track.name): \(track.fixes.count) points -> \(sentPoints) (limit \(limit)), version \(version), \(RouteFile.fileName) \(file.count) bytes: \(file.hexUpper)"
        )

        let outcome: UploadOutcome = try await handle.operationLock.withLock {
            let p2p = P2pRoute(
                srcPackage: FitnessCourseService.moduleName, dstPackage: FitnessCourseService.packageName, srcFingerprint: service.localFingerprint,
                dstFingerprint: FitnessCourseService.fingerprintValue
            )
            return try await FileUploader(session: handle.session, caps: handle.caps, log: events.sink, onProgress: { bytes, total in events.uploadProgress(bytes: bytes, total: total) })
                .upload(UploadFile(fileName: RouteFile.fileName, fileType: P2pController.fileTypeP2P, data: file, route: p2p))
        }
        let fileBody = try await P2pController.answer(within: answerWaitMs, fileAnswer)
        let fileCode = fileBody.flatMap { RouteFile.parseAnswer($0)?.code }
        let answerText =
            fileBody.map { "body \($0.hexUpper.isEmpty ? "(empty)" : $0.hexUpper) -> code \(fileCode.map(String.init) ?? "nil")" } ?? "none within \(answerWaitMs / 1000) s"
        events.info("Routes: upload finished, watch result status=\(outcome.resultStatus.map(String.init) ?? "none"); file answer \(answerText)")
        if let fileCode, fileCode != 1 {
            throw WearError(.uploadRejected, "The watch did not save the route (code \(fileCode))", statusCode: fileCode)
        }
        return P2pController.routePushResult(
            alreadyOnWatch: false, handshakeCode: 1, maxPoints: answer?.maxPoints, version: version, sentPoints: sentPoints, bytes: file.count,
            uploadStatus: outcome.resultStatus, answerCode: fileCode
        )
    }

    /// The waiter's value, nil after `ms` without one. A waiter cancelled by the service (the link went away) is a lost connection, not a cancelled
    /// call; cancelling the awaiting task itself still throws `CancellationError`.
    private static func answer<T: Sendable>(within ms: Int, _ waiter: P2PWaiter<T>) async throws -> T? {
        try await withThrowingTaskGroup(of: T?.self) { group in
            group.addTask {
                do {
                    return try await waiter.value()
                } catch is CancellationError {
                    try Task.checkCancellation()
                    throw WearError(.disconnected, "The watch disconnected while the route was being sent")
                }
            }
            group.addTask {
                try await Task.sleep(nanoseconds: UInt64(max(ms, 0)) * 1_000_000)
                return nil
            }
            let first = try await group.next() ?? nil
            group.cancelAll()
            return first
        }
    }

    /// `RoutePushResult` of HuaweiWearRoutes.types.ts.
    public static func routePushResult(
        alreadyOnWatch: Bool, handshakeCode: Int?, maxPoints: Int?, version: Int, sentPoints: Int, bytes: Int, uploadStatus: Int?, answerCode: Int?
    ) -> [String: Any] {
        [
            "ok": true,
            "alreadyOnWatch": alreadyOnWatch,
            "handshakeCode": handshakeCode.map { $0 as Any } ?? NSNull(),
            "maxPoints": maxPoints.map { $0 as Any } ?? NSNull(),
            "version": version,
            "sentPoints": sentPoints,
            "bytes": bytes,
            "uploadStatus": uploadStatus.map { $0 as Any } ?? NSNull(),
            "answerCode": answerCode.map { $0 as Any } ?? NSNull(),
        ]
    }

    /// `WatchRoute` of HuaweiWearRoutes.types.ts from the JS object, with the Android record's defaults for a missing field; a mistyped field is an invalid
    /// argument. The id is a UUID (36 characters, as in Huawei Health), the watch lists the route by its name.
    public static func parseRoute(_ raw: [String: Any]) throws -> RouteTrack {
        func bad(_ what: String) -> WearError { WearError(.invalidArgument, what) }
        func number(_ value: Any?) -> Double? {
            switch value {
            case let d as Double: return d
            case let i as Int: return Double(i)
            case let n as NSNumber: return n.doubleValue
            default: return nil
            }
        }
        func present(_ value: Any?) -> Any? { (value == nil || value is NSNull) ? nil : value }
        var name = ""
        if let value = present(raw["name"]) {
            guard let s = value as? String else { throw bad("'name' must be text") }
            name = s
        }
        var flat = [Double]()
        if let value = present(raw["points"]) {
            guard let list = value as? [Any] else { throw bad("'points' must be a list of numbers") }
            for item in list {
                guard let d = number(item) else { throw bad("'points' must be a list of numbers") }
                flat.append(d)
            }
        }
        var hasAltitude = false
        if let value = present(raw["hasAltitude"]) {
            guard let b = value as? Bool else { throw bad("'hasAltitude' must be true or false") }
            hasAltitude = b
        }
        var duration = 0.0
        if let value = present(raw["durationSec"]) {
            guard let d = number(value), d == d.rounded(), abs(d) < 2_147_483_648 else { throw bad("'durationSec' must be a whole number") }
            duration = d
        }
        if flat.count % 3 != 0 { throw bad("A route is a list of latitude, longitude, altitude triples") }
        let fixes = (0..<(flat.count / 3)).map { RouteFix(lat: flat[$0 * 3], lon: flat[$0 * 3 + 1], alt: hasAltitude ? flat[$0 * 3 + 2] : 0.0) }
        return RouteTrack(
            id: UUID().uuidString.lowercased(), name: name.trimmingCharacters(in: .whitespacesAndNewlines), fixes: fixes, hasAltitude: hasAltitude,
            totalTimeSec: Int64(max(duration, 0))
        )
    }
}

#endif
