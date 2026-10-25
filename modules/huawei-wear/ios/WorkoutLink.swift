// Port of WorkoutLink.kt: what a workout started on the watch actually sends this phone (Fit 4 Pro, 6.1.0.117): no reverse linkage, but
// GpsAndTime `18/02` `{01: 1}` about every 20 s while the workout runs ("send me the phone's GPS").
//  - Phone GPS (GB `AsynchronousResponse.handleGpsRequest`, `SendGpsDataRequest`): answer `18/02 {7F: 100000}`, read the watch's wanted fields
//    once (`18/01`), then stream every phone fix as `18/03 81{82{...}}` until `{01: 0}`. The location updates themselves run until the live
//    session ends (`PhoneGpsSession`): the watch withdraws its request once its own GPS has a fix, and the phone's track (`LiveWorkout.onLocation`)
//    is the only distance and pace there is. On iOS the stream is CoreLocation with when-in-use authorization and no background location, so
//    fixes flow while the app is in the foreground.
//  - Live numbers (as Huawei Health does): open the realtime report with `17/12 {01: 1}`; the watch pushes `17/11`, decoded into `LiveWorkout`.
//  - The 30 s `17/03` status poll: the only signal an indoor workout gives.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

public final class WorkoutLink: LinkObserver, @unchecked Sendable {
    public static let requestMs = 5_000
    public static let statusFirstMs = 5_000
    public static let statusEveryMs = 30_000

    private let link: LinkHandleSource
    private let events: WearEvents
    private let live: LiveWorkout
    private let gps: LiveGpsSource
    private let statusFirstMs: Int
    private let statusEveryMs: Int
    private let nowMs: @Sendable () -> Int64

    private let lock = NSLock()
    private var attached: HuaweiSession?
    private var reportOpenOn: HuaweiSession?
    private var gpsParams: WorkoutLinkWire.GpsParams?
    private var phoneGps: PhoneGpsSession!
    private var lastFix: WorkoutLinkWire.Fix?
    private var statusPoll: Task<Void, Never>?
    private var lastStatusLog: String?
    private var reportsLogged = 0
    private var phoneGpsPrompted = false

    public init(
        link: LinkHandleSource, events: WearEvents, live: LiveWorkout, gps: LiveGpsSource, statusFirstMs: Int = WorkoutLink.statusFirstMs,
        statusEveryMs: Int = WorkoutLink.statusEveryMs, nowMs: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }
    ) {
        self.link = link
        self.events = events
        self.live = live
        self.gps = gps
        self.statusFirstMs = statusFirstMs
        self.statusEveryMs = statusEveryMs
        self.nowMs = nowMs
        phoneGps = PhoneGpsSession(start: { [weak self] in self?.startLocation() ?? false }, stop: { [weak self] in self?.stopLocation() })
        live.onEnded = { [weak self] in self?.phoneGps.sessionEnded() }
    }

    private func log(_ message: String) { events.info(message) }

    // MARK: LinkObserver

    public func linkConnected(_ handle: LinkHandle) async {
        let session = handle.session
        let fresh: Bool = lock.locked {
            if attached === session { return false }
            attached = session
            reportOpenOn = nil
            gpsParams = nil
            return true
        }
        if !fresh { return }
        _ = await session.subscribe(service: WorkoutLinkWire.gpsService, command: WorkoutLinkWire.gpsStatus, label: "phone GPS request") { [weak self] packet in
            self?.onGpsStatus(packet)
        }
        _ = await session.subscribe(service: WorkoutLinkWire.workoutService, command: WorkoutLinkWire.reportData, label: "workout realtime report") { [weak self] packet in
            self?.onReport(packet)
        }
        let caps = handle.caps
        let gpsService = Int(WorkoutLinkWire.gpsService), workoutService = Int(WorkoutLinkWire.workoutService)
        log(
            "Workout link: watch lists 18/01=\(caps.supports(gpsService, 1)) 18/02=\(caps.supports(gpsService, Int(WorkoutLinkWire.gpsStatus))) " +
                "18/03=\(caps.supports(gpsService, Int(WorkoutLinkWire.gpsData))) 17/11=\(caps.supports(workoutService, Int(WorkoutLinkWire.reportData))) " +
                "17/12=\(caps.supports(workoutService, Int(WorkoutLinkWire.reportOpen)))"
        )
        // A workout may already be running (the app restarted mid-walk); the watch only pushes after an open.
        if caps.supports(workoutService, Int(WorkoutLinkWire.reportOpen)) { Task { await self.openReport() } }
        startStatusPoll(session, caps: caps)
    }

    public func linkDisconnected() {
        let poll: Task<Void, Never>? = lock.locked {
            attached = nil
            reportOpenOn = nil
            defer { statusPoll = nil }
            return statusPoll
        }
        poll?.cancel()
        lock.locked { lastFix = nil }
        phoneGps.linkLost(sessionEndsWithoutLink: live.endsWithoutLink)
    }

    // MARK: workout status poll (17/03, Huawei Health)

    // Request `81 00`; the answer's 81 holds 02 trainMonitorState, 03 operatorType (1 start, 2 pause, 3 resume, 4 stop), 04 sportType, 06 workoutType.

    private func startStatusPoll(_ session: HuaweiSession, caps: DeviceCaps) {
        // The Fit 4 Pro does not list 17/03; it is probed anyway and the poll stops on the first failure.
        if !caps.supports(Int(WorkoutLinkWire.workoutService), Int(WorkoutLinkWire.status)) { log("Workout link: the watch does not list 17/03; probing it") }
        let poll = Task { [weak self] in
            guard let first = self?.statusFirstMs else { return }
            try? await Task.sleep(nanoseconds: UInt64(first) * 1_000_000)
            // Once the watch has answered, a failed poll is a busy or briefly lost link, not a missing command: keep polling, or a running
            // workout would lose its end signal.
            var answered = false
            while !Task.isCancelled {
                guard let self, let handle = self.link.handle(), handle.session === session else { return }
                if await self.pollStatus(handle.session) {
                    answered = true
                } else if !answered {
                    self.log("Workout link: no workout status from the watch; indoor workouts need Start on the phone")
                    return
                }
                try? await Task.sleep(nanoseconds: UInt64(self.statusEveryMs) * 1_000_000)
            }
        }
        let previous: Task<Void, Never>? = lock.locked {
            defer { statusPoll = poll }
            return statusPoll
        }
        previous?.cancel()
    }

    /// False when the watch does not answer with a status (unsupported).
    private func pollStatus(_ session: HuaweiSession) async -> Bool {
        let answer: HuaweiPacket
        do {
            answer = try await session.request(WorkoutLinkWire.statusRequest(), timeoutMs: Self.requestMs, label: "workout status")
        } catch is CancellationError {
            return false
        } catch {
            log("Workout link: workout status failed: \((error as? WearError)?.message ?? "\(error)")")
            return false
        }
        guard let tlv = answer.tlv else { return false }
        let text = "\(tlv)"
        // Logged when it changes, so the log shows what each state looks like.
        let changed: Bool = lock.locked {
            if text == lastStatusLog { return false }
            lastStatusLog = text
            return true
        }
        if changed { log("Workout link: workout status \(text)") }
        guard tlv.contains(0x81), let body = try? tlv.object(0x81) else { return false }
        func int(_ tag: Int) -> Int? { LiveWorkoutWire.unsigned(body.bytes(tag, default: nil)).map(LiveWorkoutWire.toInt) }
        let workoutType = int(0x06) ?? int(0x04)
        switch int(0x03) {
        case 1, 3: live.watchStatus(running: true, paused: false, workoutType: workoutType)
        case 2: live.watchStatus(running: true, paused: true, workoutType: workoutType)
        default: live.watchStatus(running: false, paused: false, workoutType: workoutType)
        }
        return true
    }

    // MARK: phone GPS

    private func onGpsStatus(_ packet: HuaweiPacket) {
        guard let tlv = packet.tlv else { return }
        let enable = tlv.bytes(0x01, default: nil)?.first == 1
        Task { await self.answerGps(enable) }
    }

    private func answerGps(_ enable: Bool) async {
        guard let handle = link.handle() else { return }
        do {
            try await handle.session.send(WorkoutLinkWire.gpsAnswer(), label: "phone GPS request OK")
        } catch is CancellationError {
            return
        } catch {
            log("Workout link: GPS answer not sent: \((error as? WearError)?.message ?? "\(error)")")
        }
        if enable {
            // A workout screen is open on the watch: follow it.
            live.gpsPing()
            await askLocationOnce()
            // The phone's own track does not wait for the watch's fields: they only shape the `18/03` feed.
            phoneGps.watchAsks()
            await openReport()
            _ = await loadGpsParams()
        } else {
            lock.locked { lastFix = nil }
            let following = live.isLive
            phoneGps.watchWithdraws(liveSession: following)
            if following { log("Workout link: the watch stopped asking for the phone's GPS; feed stopped, the workout's track goes on") }
        }
    }

    private func loadGpsParams() async -> WorkoutLinkWire.GpsParams? {
        if let cached = lock.locked({ gpsParams }) { return cached }
        guard let handle = link.handle() else { return nil }
        do {
            let answer = try await handle.session.request(WorkoutLinkWire.gpsParametersRequest(), timeoutMs: Self.requestMs, label: "GpsParameters")
            guard let params = WorkoutLinkWire.parseGpsParams(answer.tlv) else { return nil }
            let bitmap = (try? answer.tlv?.object(0x81))?.bytes(0x02, default: nil)?.first ?? 0
            log("Workout link: watch takes GPS fields bitmap 0x\(String(format: "%02x", bitmap))")
            lock.locked { gpsParams = params }
            return params
        } catch is CancellationError {
            return nil
        } catch {
            log("Workout link: GpsParameters failed: \((error as? WearError)?.message ?? "\(error)")")
            return nil
        }
    }

    /// The system prompt (when-in-use) appears here, the first time the watch asks while the app is in the foreground.
    private func askLocationOnce() async {
        guard gps.authorization == .notDetermined, !lock.locked({ phoneGpsPrompted }) else { return }
        lock.locked { phoneGpsPrompted = true }
        _ = await gps.requestAuthorization()
    }

    /// Starts the phone's location updates (`PhoneGpsSession`); every fix goes to the live session, and to the watch while it asks.
    private func startLocation() -> Bool {
        guard gps.authorization == .granted else {
            log("Workout link: the watch asks for the phone's GPS, but JoyoFit has no location permission")
            return false
        }
        lock.locked { lastFix = nil }
        if gps.start({ [weak self] fix in self?.onFix(fix) }) {
            log("Workout link: phone GPS started for the workout")
            return true
        }
        log("Workout link: phone GPS not started")
        return false
    }

    private func stopLocation() {
        lock.locked { lastFix = nil }
        gps.stop()
        log("Workout link: phone GPS stopped")
    }

    private func onFix(_ fix: WorkoutLinkWire.Fix) {
        live.onLocation(fix)
        // The `18/03` feed needs the fields the watch takes (`18/01`); without them yet, the fix is the track's only.
        guard phoneGps.feeding, let params = lock.locked({ gpsParams }) else { return }
        Task { await self.sendLocation(fix, params) }
    }

    private func sendLocation(_ fix: WorkoutLinkWire.Fix, _ params: WorkoutLinkWire.GpsParams) async {
        guard let handle = link.handle(), phoneGps.feeding else { return }
        let previous: WorkoutLinkWire.Fix? = lock.locked {
            defer { lastFix = fix }
            return lastFix
        }
        let packet = WorkoutLinkWire.gpsFix(params, fix: fix, previous: previous, distanceFromPrevious: previous.map { fix.distance(to: $0) }, nowMs: nowMs())
        do {
            try await handle.session.send(packet, label: "phone GPS fix", logFrames: false)
        } catch is CancellationError {
            return
        } catch {
            log("Workout link: GPS fix not sent: \((error as? WearError)?.message ?? "\(error)")")
        }
    }

    // MARK: realtime report

    private func openReport() async {
        guard let handle = link.handle() else { return }
        if lock.locked({ reportOpenOn === handle.session }) { return }
        do {
            let answer = try await handle.session.request(WorkoutLinkWire.openReportRequest(), timeoutMs: Self.requestMs, label: "workout realtime report open")
            log("Workout link: realtime report open answered \(answer.tlv.map { "\($0)" } ?? "nil")")
            lock.locked { reportOpenOn = handle.session }
        } catch is CancellationError {
            return
        } catch {
            log("Workout link: realtime report not opened: \((error as? WearError)?.message ?? "\(error)")")
        }
    }

    private func onReport(_ packet: HuaweiPacket) {
        guard let tlv = packet.tlv else { return }
        // The decoded TLV is what checks the units against the watch screen: the first three, then every 30th.
        let n = lock.locked { defer { reportsLogged += 1 }; return reportsLogged }
        if n % 30 < 3 { log("Workout link: realtime report \(tlv)") }
        let values = tlv.contains(0x81) ? ((try? tlv.object(0x81)) ?? tlv) : tlv
        live.onReport(WorkoutReport.parse(values))
    }
}

#endif
