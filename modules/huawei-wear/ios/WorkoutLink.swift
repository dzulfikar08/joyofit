// Port of WorkoutLink.kt: what a workout started on the watch actually sends this phone (Fit 4 Pro, 6.1.0.117): no reverse linkage, but
// GpsAndTime `18/02` `{01: 1}` about every 20 s from the moment its workout screen looks for a fix ("send me the phone's GPS").
//  - Phone GPS (GB `AsynchronousResponse.handleGpsRequest`, `SendGpsDataRequest`): answer `18/02 {7F: 100000}`, read the watch's wanted fields
//    once (`18/01`), then stream every phone fix good enough for a track (`TrackAccumulator.maxAccuracyM`) as `18/03 81{82{...}}` until `{01: 0}`.
//    The location updates themselves run until the live session ends (`PhoneGpsSession`): the watch withdraws its request once its own GPS has
//    a fix, and the phone's track (`LiveWorkout.onLocation`) is the only distance and pace there is. On iOS the stream is CoreLocation with
//    when-in-use authorization and no background location, so fixes flow while the app is in the foreground.
//  - Live numbers (as Huawei Health does): open the realtime report with `17/12 {01: 1}`; the watch pushes `17/11`, decoded into `LiveWorkout`.
//  - The `17/03` status poll (`WatchPhase`): the only signal an indoor workout gives, and the one that tells GO from the GO screen. Every 2 s while
//    a session waits for GO, 5 s while one is followed, 30 s otherwise (`LiveWorkout.pollEveryMs`); a GPS request, its withdrawal or the watch's
//    workout screen closing asks at once.
//  - `18/08 {01: 1 | 0}`: the watch's workout screen opened or closed, answered `18/08 {7F: 100000}` (`LiveWorkout.workoutScreen`).
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

public final class WorkoutLink: LinkObserver, @unchecked Sendable {
    public static let requestMs = 5_000
    public static let statusFirstMs = 5_000

    private let link: LinkHandleSource
    private let events: WearEvents
    private let live: LiveWorkout
    private let gps: LiveGpsSource
    private let statusFirstMs: Int
    /// The wait between two status answers for the period the policy wants (`LiveWorkout.pollEveryMs`); the identity outside tests.
    private let pollDelayMs: @Sendable (Int64) -> Int64
    private let nowMs: @Sendable () -> Int64

    private let lock = NSLock()
    private var attached: HuaweiSession?
    private var reportOpenOn: HuaweiSession?
    private var gpsParams: WorkoutLinkWire.GpsParams?
    private var phoneGps: PhoneGpsSession!
    private var lastFix: WorkoutLinkWire.Fix?
    private var statusPoll: Task<Void, Never>?
    /// Which `startStatusPoll` the running poll belongs to; `pollActive` while its loop runs.
    private var pollGeneration = 0
    private var pollActive = false
    /// The poll's wait between answers (`waitForPoll`), and a wake (`pollSoon`) that came while it did not wait.
    private var pollWaiter: (id: Int, continuation: CheckedContinuation<Void, Never>)?
    private var pollWaits = 0
    private var pollWakePending = false
    /// The watch has answered the poll with a workout state at least once on this link.
    private var statusAnswered = false
    private var lastStatusLog: String?
    private var reportsLogged = 0
    private var fixesLogged = 0
    private var phoneGpsPrompted = false
    private var lastGpsRequestLog: String?

    public init(
        link: LinkHandleSource, events: WearEvents, live: LiveWorkout, gps: LiveGpsSource, statusFirstMs: Int = WorkoutLink.statusFirstMs,
        pollDelayMs: @escaping @Sendable (Int64) -> Int64 = { $0 }, nowMs: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }
    ) {
        self.link = link
        self.events = events
        self.live = live
        self.gps = gps
        self.statusFirstMs = statusFirstMs
        self.pollDelayMs = pollDelayMs
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
        _ = await session.subscribe(service: WorkoutLinkWire.gpsService, command: WorkoutLinkWire.workoutScreen, label: "workout screen") { [weak self] packet in
            self?.onWorkoutScreen(packet)
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
            pollGeneration += 1
            pollActive = false
            defer { statusPoll = nil }
            return statusPoll
        }
        poll?.cancel()
        releasePollWaiter()
        lock.locked { lastFix = nil }
        phoneGps.linkLost(sessionEndsWithoutLink: live.endsWithoutLink)
    }

    // MARK: workout status poll (17/03, Huawei Health)

    // Request `81 00`; the answer's 81 holds 02 trainMonitorState, 03 operatorType, 04 sportType, 06 workoutType (`WatchPhase`).

    private func startStatusPoll(_ session: HuaweiSession, caps: DeviceCaps) {
        // The Fit 4 Pro does not list 17/03; it is probed anyway and the poll stops on the first failure.
        if !caps.supports(Int(WorkoutLinkWire.workoutService), Int(WorkoutLinkWire.status)) { log("Workout link: the watch does not list 17/03; probing it") }
        let (previous, generation): (Task<Void, Never>?, Int) = lock.locked {
            let previous = statusPoll
            statusPoll = nil
            pollGeneration += 1
            pollActive = true
            statusAnswered = false
            return (previous, pollGeneration)
        }
        previous?.cancel()
        releasePollWaiter()
        let poll = Task { [weak self] in
            guard let first = self?.statusFirstMs else { return }
            try? await Task.sleep(nanoseconds: UInt64(first) * 1_000_000)
            while !Task.isCancelled {
                guard let self, let handle = self.link.handle(), handle.session === session else { break }
                // Once the watch has answered, a failed poll is a busy or briefly lost link, not a missing command: keep polling, or a running
                // workout would lose its end signal.
                let answered = await self.pollStatus(handle.session)
                if !answered, !self.lock.locked({ self.statusAnswered }) {
                    self.log("Workout link: no workout status from the watch; indoor workouts need Start on the phone")
                    break
                }
                // Fast while a session waits for GO (the phone's clock starts with the watch's), then every few seconds while one is followed;
                // a GPS request or the watch's workout screen closing wakes it at once.
                await self.waitForPoll(self.pollDelayMs(self.live.pollEveryMs()))
            }
            self?.pollEnded(generation)
        }
        lock.locked {
            if pollGeneration == generation { statusPoll = poll } else { poll.cancel() }
        }
    }

    private func pollEnded(_ generation: Int) {
        lock.locked {
            if pollGeneration != generation { return }
            pollActive = false
            statusPoll = nil
        }
    }

    /// The poll's wait between two answers: `ms`, or less when `pollSoon` (or a cancel) wakes it.
    private func waitForPoll(_ ms: Int64) async {
        if Task.isCancelled { return }
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            let id: Int? = lock.locked {
                if pollWakePending {
                    pollWakePending = false
                    return nil
                }
                pollWaits += 1
                pollWaiter = (pollWaits, continuation)
                return pollWaits
            }
            guard let id else {
                continuation.resume()
                return
            }
            Task { [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(max(ms, 0)) * 1_000_000)
                self?.releasePollWaiter(id)
            }
        }
    }

    /// Ends the poll's wait: the one with `id` (its timer), or whichever waits (nil: a wake or a cancel).
    private func releasePollWaiter(_ id: Int? = nil) {
        let waiter: CheckedContinuation<Void, Never>? = lock.locked {
            guard let w = pollWaiter, id == nil || w.id == id else { return nil }
            pollWaiter = nil
            return w.continuation
        }
        waiter?.resume()
    }

    /// Asks the status now, outside the poll's rhythm (a GPS request opened a session that waits for GO, the watch closed its workout).
    private func pollSoon() {
        let (active, waiter): (Bool, CheckedContinuation<Void, Never>?) = lock.locked {
            guard pollActive else { return (false, nil) }
            guard let w = pollWaiter else {
                pollWakePending = true
                return (true, nil)
            }
            pollWaiter = nil
            return (true, w.continuation)
        }
        if active {
            waiter?.resume()
            return
        }
        guard let handle = link.handle() else { return }
        Task { _ = await self.pollStatus(handle.session) }
    }

    /// False when the watch does not answer with a status (unsupported, or no answer yet).
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
        let text = answer.tlv.map { "\($0)" } ?? "(empty)"
        // Logged when it changes, so the log shows what each state looks like.
        let changed: Bool = lock.locked {
            if text == lastStatusLog { return false }
            lastStatusLog = text
            return true
        }
        if changed { log("Workout link: workout status \(text)") }
        guard let tlv = answer.tlv, tlv.contains(0x81), let body = try? tlv.object(0x81) else {
            // A watch that already answered with a workout state and now sends none has no workout to report.
            if !lock.locked({ statusAnswered }) { return false }
            live.watchStatus(phase: .idle, workoutType: nil)
            return true
        }
        lock.locked { statusAnswered = true }
        func int(_ tag: Int) -> Int? { LiveWorkoutWire.unsigned(body.bytes(tag, default: nil)).map(LiveWorkoutWire.toInt) }
        // The sport is in tag 06 ("workout type") or 04 ("sport type"); only a code of the sport table is believed (a small enum in one of them
        // must not turn into "Running").
        let workoutType = WorkoutSportTypes.pick(int(0x06), int(0x04))
        live.watchStatus(phase: WatchPhase.of(trainMonitorState: int(0x02), operator: int(0x03)), workoutType: workoutType)
        return true
    }

    /// `18/08 {01: 1 | 0}`: the watch's workout screen opened or closed (Huawei Health's activity-recognition switch; it answers
    /// `18/08 7F 04 <100000>`, `HwActivityRecognitionManager.notifyDeviceReceiveSuccess`). A close asks the status now, so a finish on the watch
    /// ends the phone's session within seconds (`LiveWorkout.workoutScreen`).
    private func onWorkoutScreen(_ packet: HuaweiPacket) {
        let open = packet.tlv?.bytes(0x01, default: nil)?.first == 1
        log("Workout link: the watch's workout screen \(open ? "opened" : "closed") (18/08)")
        Task { await self.answerWorkoutScreen(open) }
    }

    private func answerWorkoutScreen(_ open: Bool) async {
        guard let handle = link.handle() else { return }
        do {
            try await handle.session.send(WorkoutLinkWire.workoutScreenAnswer(), label: "workout screen OK")
        } catch is CancellationError {
            return
        } catch {
            log("Workout link: workout screen answer not sent: \((error as? WearError)?.message ?? "\(error)")")
        }
        if live.workoutScreen(open: open) { pollSoon() }
    }

    // MARK: phone GPS

    private func onGpsStatus(_ packet: HuaweiPacket) {
        guard let tlv = packet.tlv else { return }
        let enable = tlv.bytes(0x01, default: nil)?.first == 1
        // The whole request when it changes: no watch was seen to name the sport anywhere on the link yet, a band might do it here.
        let text = "\(tlv)"
        let changed: Bool = lock.locked {
            if text == lastGpsRequestLog { return false }
            lastGpsRequestLog = text
            return true
        }
        if changed { log("Workout link: phone GPS request \(text)") }
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
            // A workout screen is open on the watch: follow it. The request comes before the workout runs (the watch is still looking for a
            // fix), so the session only prepares until the status poll says it runs; ask it right away.
            if live.gpsPing() { pollSoon() }
            await askLocationOnce()
            // The phone's own track does not wait for the watch's fields: they only shape the `18/03` feed.
            phoneGps.watchAsks()
            await openReport()
            _ = await loadGpsParams()
        } else {
            lock.locked { lastFix = nil }
            let following = live.isLive
            phoneGps.watchWithdraws(liveSession: following)
            if following {
                log("Workout link: the watch stopped asking for the phone's GPS; feed stopped, the workout's track goes on")
                // A band without GPS of its own withdraws only when its workout ends: the status tells at once.
                pollSoon()
            }
        }
    }

    private func loadGpsParams() async -> WorkoutLinkWire.GpsParams? {
        if let cached = lock.locked({ gpsParams }) { return cached }
        guard let handle = link.handle() else { return nil }
        do {
            let answer = try await handle.session.request(WorkoutLinkWire.gpsParametersRequest(), timeoutMs: Self.requestMs, label: "GpsParameters")
            guard let params = WorkoutLinkWire.parseGpsParams(answer.tlv) else { return nil }
            let bitmap = (try? answer.tlv?.object(0x81))?.bytes(0x02, default: nil)?.first ?? 0
            log("Workout link: watch takes GPS fields bitmap 0x\(String(format: "%02x", bitmap)) (answer \(answer.tlv.map { "\($0)" } ?? "nil"))")
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
        lock.locked {
            lastFix = nil
            fixesLogged = 0
        }
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
        // The first fixes say how soon a position came and how good it was.
        let n: Int = lock.locked {
            fixesLogged += 1
            return fixesLogged
        }
        if n <= 3 { log("Workout link: phone fix \(n), accuracy \(fix.accuracy.map { String(format: "%.0f m", $0) } ?? "unknown")") }
        live.onLocation(fix)
        // The `18/03` feed needs the fields the watch takes (`18/01`); without them yet, the fix is the track's only. A rough Wi-Fi or cell
        // position (worse than the track's own limit) is the map's, not the watch's: the band would count its jumps as distance.
        guard phoneGps.feeding, let params = lock.locked({ gpsParams }) else { return }
        if let accuracy = fix.accuracy, accuracy > TrackAccumulator.maxAccuracyM { return }
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
