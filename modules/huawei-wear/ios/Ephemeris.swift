// Port of Ephemeris.kt (AgpsExchange, EphemerisLink), derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): service/devices/huawei/
// HuaweiEphemerisManager and requests/SendEphemeris*; packets/{Ephemeris,EphemerisFileUpload}.
//
// The phone's half of the watch's satellite-data request (service 0x1F, files over 0x1C), for one connection. The watch drives; every step is its
// own message:
//
//   watch 1F/01 {81{02 op, 03 time}}          phone 1F/01 {7F 100000}   (100007 without network)
//                                             phone 1F/02 {81}          ParameterConsult
//   watch 1F/02 {81{04 time, 05 version,      phone downloads, then 1F/03 {01 state}   3 ready, 4 failed, 5 unsupported
//                 06 tag list, children 03 urls}}
//   watch 1C/01 file list, 1C/02 consult, 1C/03 file info, 1C/04 data request, 1C/06 done
//                                             phone 1C/01..04 answers, 1C/05 data frames, 1C/06 answer
//
// `probe` starts the same exchange from the phone (no op 1): it asks the watch for its parameters and, when the watch answers, carries on from there.
//
// Watch safety: files are validated before they are offered; every request is bounded (data per answer, frames per answer); a transfer that goes
// silent is dropped after `AgpsTiming.stallMs` and a "ready" nobody collects after `AgpsTiming.pullWaitMs`; a refused or cancelled exchange tells the
// watch "failed" so it does not wait; nothing here touches pairing or keys. The watch's messages are handled in order on one task and never on the
// session's executor; the download runs on its own task.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

/// Test and tuning knobs of one `AgpsExchange`; the defaults are the real values.
public struct AgpsTiming: Sendable {
    public var downloadTimeoutMs = AgpsPolicy.downloadTimeoutMs
    public var pullWaitMs = AgpsPolicy.pullWaitMs
    public var stallMs = AgpsPolicy.transferStallMs
    public var probeAskMs = 15_000
    public var probeTransferMs = 90_000

    public init(
        downloadTimeoutMs: Int = AgpsPolicy.downloadTimeoutMs, pullWaitMs: Int = AgpsPolicy.pullWaitMs, stallMs: Int = AgpsPolicy.transferStallMs,
        probeAskMs: Int = 15_000, probeTransferMs: Int = 90_000
    ) {
        self.downloadTimeoutMs = downloadTimeoutMs
        self.pullWaitMs = pullWaitMs
        self.stallMs = stallMs
        self.probeAskMs = probeAskMs
        self.probeTransferMs = probeTransferMs
    }
}

/// One value delivered once (Kotlin `CompletableDeferred`) that can be awaited with a time limit; cancelling the waiter ends the wait too.
final class AgpsLatch<T: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: T?
    private var waiters: [UUID: CheckedContinuation<T?, Never>] = [:]
    /// Waits that ended (timeout or cancellation) before their continuation was registered.
    private var expired = Set<UUID>()

    private enum Registration {
        case ready(T)
        case expired
        case waiting
    }

    func complete(_ newValue: T) {
        let pending: [CheckedContinuation<T?, Never>] = lock.locked {
            if value != nil { return [] }
            value = newValue
            let all = Array(waiters.values)
            waiters.removeAll()
            return all
        }
        for continuation in pending { continuation.resume(returning: newValue) }
    }

    /// The value, or nil when none arrived within `timeoutMs` (or the waiting task was cancelled).
    func wait(timeoutMs: Int) async -> T? {
        let id = UUID()
        let timer = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(max(timeoutMs, 0)) * 1_000_000)
            if !Task.isCancelled { self?.expire(id) }
        }
        defer { timer.cancel() }
        return await withTaskCancellationHandler {
            await withCheckedContinuation { (continuation: CheckedContinuation<T?, Never>) in
                let registration: Registration = lock.locked {
                    if let value { return .ready(value) }
                    if expired.remove(id) != nil { return .expired }
                    waiters[id] = continuation
                    return .waiting
                }
                switch registration {
                case .ready(let ready): continuation.resume(returning: ready)
                case .expired: continuation.resume(returning: nil)
                case .waiting: break
                }
            }
        } onCancel: {
            expire(id)
        }
    }

    private func expire(_ id: UUID) {
        let continuation: CheckedContinuation<T?, Never>? = lock.locked {
            if let waiting = waiters.removeValue(forKey: id) { return waiting }
            if value == nil { expired.insert(id) }
            return nil
        }
        continuation?.resume(returning: nil)
    }
}

/// Kotlin `withTimeoutOrNull`: the operation's value, or nil when it did not finish within `ms` (it is cancelled then).
func agpsTimeout<T: Sendable>(ms: Int, _ operation: @escaping @Sendable () async -> T) async -> T? {
    await withTaskGroup(of: T?.self) { group in
        group.addTask { await operation() }
        group.addTask {
            try? await Task.sleep(nanoseconds: UInt64(max(ms, 0)) * 1_000_000)
            return nil
        }
        let first = await group.next() ?? nil
        group.cancelAll()
        return first
    }
}

/// `String(format: "%04x")` without the varargs.
private func agpsHex4(_ value: Int) -> String {
    let text = String(value & 0xFFFF, radix: 16)
    return String(repeating: "0", count: max(0, 4 - text.count)) + text
}

public actor AgpsExchange {
    /// A watch message, or the stall timer routed through the same single task.
    private enum Incoming: @unchecked Sendable {
        case packet(service: Int, command: Int, packet: HuaweiPacket)
        case stall(token: Int)
    }

    /// What the watch asked for in one 1C/02 ... 1C/06 round (GB `UploadParameters` and the current file).
    private final class Transfer {
        let frameSize: Int
        let maxDataSize: Int
        let fileType: Int
        var name: String?
        var data: Bytes?
        var frames = 0
        /// The end of the furthest byte range that was sent.
        var sentEnd = 0

        init(frameSize: Int, maxDataSize: Int, fileType: Int) {
            self.frameSize = frameSize
            self.maxDataSize = maxDataSize
            self.fileType = fileType
        }
    }

    /// The few fields the screen reads without waiting for the actor.
    private final class Flags: @unchecked Sendable {
        private let lock = NSLock()
        private var _task = false
        private var _state = 0
        private var _sending = false

        var task: Bool {
            get { lock.locked { _task } }
            set { lock.locked { _task = newValue } }
        }

        var state: Int {
            get { lock.locked { _state } }
            set { lock.locked { _state = newValue } }
        }

        var sending: Bool {
            get { lock.locked { _sending } }
            set { lock.locked { _sending = newValue } }
        }

        var phase: String {
            lock.locked {
                if !_task { return "idle" }
                if _sending { return "sending" }
                if _state == 2 { return "downloading" }
                if _state == 3 { return "waiting" }
                return "asking"
            }
        }
    }

    private let session: HuaweiSession
    private let caps: DeviceCaps
    private let address: String
    private let events: WearEvents
    private let source: AgpsSource
    private let store: AgpsStore
    private let isOnline: @Sendable () -> Bool
    private let nowMs: @Sendable () -> Int
    private let timing: AgpsTiming

    private let inboxStream: AsyncStream<Incoming>
    private nonisolated let inbox: AsyncStream<Incoming>.Continuation
    private nonisolated let flags = Flags()
    private var subscriptions: [Int] = []
    private var consumer: Task<Void, Never>?
    private var stopped = false

    /// A request is running (an op 1, or a `probe`) and has not been closed by state 4, 5 or a delivery.
    private var task: Bool {
        get { flags.task }
        set { flags.task = newValue }
    }

    /// Download state: 0 idle, 1 consulted, 2 downloading, 3 ready, 4 failed, 5 unsupported.
    private var state: Int {
        get { flags.state }
        set { flags.state = newValue }
    }

    private var download: Task<Void, Never>?

    /// The next download skips the phone's copy (the user asked for a refresh).
    private var forceNext = false

    /// Files the watch may pull, by the name it asks for, in the order they are listed.
    private var ready: [(name: String, data: Bytes)] = []

    /// What the downloads behind `ready` were (source and age), for the delivery record.
    private var lastFetch: AgpsFetch?

    /// Names the watch has pulled completely in this request.
    private var delivered = Set<String>()

    private var transfer: Transfer? {
        didSet { flags.sending = transfer != nil }
    }

    private var idle: Task<Void, Never>?
    private var idleToken = 0

    /// Completed with the outcome that ends the request a `probe` is waiting for; completed once.
    private var finish: AgpsLatch<String>?
    private var consultSeen: AgpsLatch<Bool>?

    /// What the screen shows: idle, asking, downloading, waiting (ready, the watch has not come), sending.
    public nonisolated var phase: String { flags.phase }

    public nonisolated var busy: Bool { flags.task }

    public init(
        session: HuaweiSession, caps: DeviceCaps, address: String, events: WearEvents, source: AgpsSource, store: AgpsStore,
        isOnline: @escaping @Sendable () -> Bool, nowMs: @escaping @Sendable () -> Int = { Int(Date().timeIntervalSince1970 * 1000) },
        timing: AgpsTiming = AgpsTiming()
    ) {
        self.session = session
        self.caps = caps
        self.address = address
        self.events = events
        self.source = source
        self.store = store
        self.isOnline = isOnline
        self.nowMs = nowMs
        self.timing = timing
        var continuation: AsyncStream<Incoming>.Continuation!
        inboxStream = AsyncStream<Incoming> { continuation = $0 }
        inbox = continuation
    }

    private func log(_ message: String) { events.info("AGPS: \(message)") }

    private func logError(_ message: String) { events.error("AGPS: \(message)") }

    private func logRaw(_ message: String) { WearConsole.general("AGPS: \(message)") }

    private func describe(_ error: Error) -> String { (error as? WearError)?.message ?? "\(error)" }

    public func start() async {
        let wanted: [(service: Int, command: Int, label: String)] = [
            (AgpsMessages.agpsService, 0x01, "operator request"),
            (AgpsMessages.agpsService, 0x02, "parameter consult answer"),
            (AgpsMessages.agpsService, 0x03, "file status answer"),
            (AgpsMessages.fileService, 0x01, "file list request"),
            (AgpsMessages.fileService, 0x02, "file consult"),
            (AgpsMessages.fileService, 0x03, "file info request"),
            (AgpsMessages.fileService, 0x04, "data request"),
            (AgpsMessages.fileService, 0x05, "data ack"),
            (AgpsMessages.fileService, 0x06, "upload done"),
        ]
        let continuation = inbox
        for entry in wanted {
            let service = entry.service
            let command = entry.command
            let id = await session.subscribe(service: UInt8(service), command: UInt8(command), label: "AGPS \(entry.label)") { packet in
                continuation.yield(.packet(service: service, command: command, packet: packet))
            }
            subscriptions.append(id)
        }
        if stopped {
            // Stopped while subscribing.
            for id in subscriptions { await session.unsubscribe(id) }
            subscriptions.removeAll()
            return
        }
        let stream = inboxStream
        consumer = Task { [weak self] in
            for await message in stream {
                guard let self else { return }
                await self.handle(message)
            }
        }
        let agps = AgpsMessages.agpsService, files = AgpsMessages.fileService
        log(
            "ready; watch lists 1F/01=\(caps.supports(agps, 1)) 1F/02=\(caps.supports(agps, 2)) 1F/03=\(caps.supports(agps, 3)) "
                + "1C/01=\(caps.supports(files, 1)) 1C/04=\(caps.supports(files, 4))"
        )
    }

    /// The link went away: everything in flight is dropped.
    public func stop() async {
        stopped = true
        inbox.finish()
        download?.cancel()
        idle?.cancel()
        if task {
            store.recordOutcome(nowMs: nowMs(), outcome: AgpsOutcome.linkLost, error: "the connection to the watch ended during the request", countsAsFailure: false)
        }
        task = false
        consultSeen?.complete(true)
        finishWith(AgpsOutcome.linkLost)
        consumer?.cancel()
        let ids = subscriptions
        subscriptions.removeAll()
        for id in ids { await session.unsubscribe(id) }
    }

    /// Starts the request from the phone: asks the watch for its parameters (1F/02) and waits for its answer. Returns at once with
    /// `AgpsOutcome.busy` when a request is running, `AgpsOutcome.watchSilent` when the watch does not answer, else the outcome of the request the
    /// answer started (see `finishWith`).
    public func probe(force: Bool) async -> String {
        if task { return AgpsOutcome.busy }
        task = true
        state = 0
        forceNext = force
        delivered.removeAll()
        ready.removeAll()
        let ended = AgpsLatch<String>()
        let answered = AgpsLatch<Bool>()
        finish = ended
        consultSeen = answered
        log("asking the watch for its satellite-data parameters (phone-started)")
        await tx(AgpsMessages.agpsService, 0x02, AgpsMessages.parameterConsult(), "parameter consult (phone-started)")
        if await answered.wait(timeoutMs: timing.probeAskMs) == nil {
            log("the watch did not answer the phone-started question within \(timing.probeAskMs / 1000) s")
            task = false
            finish = nil
            consultSeen = nil
            return AgpsOutcome.watchSilent
        }
        consultSeen = nil
        // The watch answered: the download, the status and the watch's own pull follow. Wait for the end of that.
        let outcome = await ended.wait(timeoutMs: timing.downloadTimeoutMs + timing.pullWaitMs + timing.probeTransferMs)
        finish = nil
        return outcome ?? AgpsOutcome.timeout
    }

    /// The user cancels: a download in progress is dropped and the watch is told "failed" so it does not wait for it; a transfer in progress is
    /// dropped, so the watch's next request is refused. The watch's own state machine ends the transfer on its side.
    public func cancel() async {
        if !task { return }
        download?.cancel()
        idle?.cancel()
        let answerStatus = state == 1 || state == 2
        transfer = nil
        task = false
        ready.removeAll()
        store.recordOutcome(nowMs: nowMs(), outcome: AgpsOutcome.cancelled, error: "cancelled in the app", countsAsFailure: false)
        log("cancelled in the app")
        if answerStatus {
            await tx(AgpsMessages.agpsService, 0x03, AgpsMessages.fileStatus(state: AgpsMessages.stateFailed), "file status failed (cancelled)")
        }
        consultSeen?.complete(true)
        finishWith(AgpsOutcome.cancelled)
    }

    private func finishWith(_ outcome: String) {
        finish?.complete(outcome)
    }

    private func handle(_ message: Incoming) async {
        switch message {
        case .stall(let token):
            onIdleExpired(token)
        case .packet(let service, let command, let packet):
            if service == AgpsMessages.agpsService {
                switch command {
                case 0x01: await onOperator(packet)
                case 0x02: onConsult(packet)
                case 0x03: log("watch answered the file status: \(describeTlv(packet.tlv))")
                default: break
                }
            } else {
                switch command {
                case 0x01: await onFileList(packet)
                case 0x02: await onFileConsult(packet)
                case 0x03: await onFileInfo(packet)
                case 0x04: await onDataRequest(packet)
                case 0x05:
                    if let current = transfer {
                        current.frames += 1
                        armIdle(timing.stallMs)
                    }
                case 0x06: await onUploadDone(packet)
                default: break
                }
            }
        }
    }

    private func tx(_ service: Int, _ command: Int, _ content: HuaweiTLV, _ label: String) async {
        do {
            try await session.send(HuaweiPacket(serviceId: UInt8(service), commandId: UInt8(command), tlv: content), label: "AGPS \(label)")
        } catch is CancellationError {
            return
        } catch {
            logError("\(label) not sent: \(describe(error))")
        }
    }

    /// (Re)starts the silence timer: after `ms` without the next watch message the request is dropped.
    private func armIdle(_ ms: Int) {
        idle?.cancel()
        idleToken += 1
        let token = idleToken
        let continuation = inbox
        idle = Task {
            try? await Task.sleep(nanoseconds: UInt64(max(ms, 0)) * 1_000_000)
            if !Task.isCancelled { continuation.yield(.stall(token: token)) }
        }
    }

    private func disarmIdle() {
        idle?.cancel()
        idleToken += 1
    }

    private func onIdleExpired(_ token: Int) {
        if token != idleToken || !task { return }
        let sending = transfer != nil
        transfer = nil
        task = false
        ready.removeAll()
        let outcome = sending ? AgpsOutcome.timeout : AgpsOutcome.watchSilent
        let why = sending
            ? "the watch sent nothing for \(timing.stallMs / 1000) s during a transfer; dropped"
            : "the watch did not come for the data within \(timing.pullWaitMs / 1000) s; dropped"
        logError(why)
        store.recordOutcome(nowMs: nowMs(), outcome: outcome, error: why, countsAsFailure: false)
        finishWith(outcome)
    }

    // MARK: 1F: operator request, consult, download, status

    private func onOperator(_ packet: HuaweiPacket) async {
        var body: HuaweiTLV?
        if let tlv = packet.tlv, tlv.contains(0x81) { body = try? tlv.object(0x81) }
        let op = body?.agpsInt(0x02) ?? -1
        let timeBytes = body?.bytes(0x03, default: nil)
        log("watch asks for ephemeris data: op \(op), time \(body?.agpsLong(0x03).map(String.init) ?? "null")")
        switch op {
        case 1:
            // Every op 1 clears the record for the watch and starts over.
            download?.cancel()
            disarmIdle()
            task = true
            state = 0
            transfer = nil
            delivered.removeAll()
            ready.removeAll()
            store.touchAsk(nowMs: nowMs())
            if !isOnline() {
                task = false
                log("no network; answering 100007")
                store.recordOutcome(
                    nowMs: nowMs(), outcome: AgpsOutcome.noNetwork, error: "the watch asked and the phone has no network", countsAsFailure: false
                )
                await tx(
                    AgpsMessages.agpsService, 0x01, AgpsMessages.operatorAnswer(code: AgpsMessages.codeNoNetwork), "operator answer (no network)"
                )
                finishWith(AgpsOutcome.noNetwork)
                return
            }
            log("answering 100000 and asking the watch for its parameters (1F/02)")
            await tx(AgpsMessages.agpsService, 0x01, AgpsMessages.operatorAnswer(code: AgpsMessages.codeOk), "operator answer")
            await tx(AgpsMessages.agpsService, 0x02, AgpsMessages.parameterConsult(), "parameter consult")
        case 2:
            if !task {
                log("progress request but no request is running; ignored")
                return
            }
            log("progress request; answering state \(state)")
            await tx(AgpsMessages.agpsService, 0x01, AgpsMessages.progressAnswer(timeBytes: timeBytes ?? [], state: state), "progress answer")
        default:
            log("unknown operation \(op); ignored")
        }
    }

    private func onConsult(_ packet: HuaweiPacket) {
        if !task {
            log("consult answer without a running request; ignored")
            return
        }
        guard let consult = AgpsMessages.parseConsult(packet.tlv) else {
            // The watch refused the question itself (e.g. 118001 when no request is open on its side): nothing was started, so there is
            // nothing to tell it either; the request just ends here.
            let why = packet.tlv?.agpsLong(0x7F).map { "the watch answered the phone's question with error \($0) (it has no request open); only the watch can start one" }
                ?? "the watch's answer had no parameters"
            logError(why)
            task = false
            store.recordOutcome(nowMs: nowMs(), outcome: AgpsOutcome.watchRefused, error: why, countsAsFailure: false)
            consultSeen?.complete(true)
            finishWith(AgpsOutcome.watchRefused)
            return
        }
        log(
            "consult answer: download version \(consult.version), tag \(consult.tag.count) chars (\(consult.tagNames)), \(consult.urls.count) urls"
        )
        logRaw("consult tag=\"\(consult.tag)\" urls=\(consult.urls)")
        store.recordAsk(nowMs: nowMs(), version: consult.version, tags: consult.tagNames)
        consultSeen?.complete(true)
        state = 1
        download?.cancel()
        download = Task { await self.runDownload(consult) }
    }

    private func runDownload(_ consult: AgpsConsult) async {
        state = 2
        let started = nowMs()
        let force = forceNext
        forceNext = false
        if force { store.clearRetry() }
        let waitUntil = store.retryAtMs()
        // The last download failed a moment ago; the watch asks every few seconds, so it is not hammered with retries.
        let waiting = !force && consult.version == 0 && nowMs() < waitUntil
        let result: AgpsFetch
        if waiting {
            result = .failed(AgpsOutcome.downloadFailed, "waiting \((waitUntil - nowMs()) / 1000) s before trying the download again")
        } else {
            let source = self.source
            let timeoutMs = timing.downloadTimeoutMs
            let fetched = await agpsTimeout(ms: timeoutMs) { await source.fetch(consult, force: force) }
            result = fetched ?? .failed(AgpsOutcome.downloadFailed, "download timed out after \(timeoutMs / 1000) s")
        }
        if Task.isCancelled { return }
        if result.ok {
            lastFetch = result
            if !result.fromCache {
                store.recordDownloaded(nowMs: nowMs(), dataMs: result.dataTimeMs, size: result.totalSize, source: result.source)
            }
            ready = result.files
            let summary = result.files.map { entry in "\(entry.name) \(entry.data.count) bytes" }.joined(separator: ", ")
            log("download finished in \(nowMs() - started) ms: \(summary)")
            await sendStatus(AgpsMessages.stateReady, "")
            armIdle(timing.pullWaitMs)
        } else {
            logError(result.message)
            let countsAsFailure = !waiting && (result.outcome == AgpsOutcome.downloadFailed || result.outcome == AgpsOutcome.invalidFile)
            store.recordOutcome(nowMs: nowMs(), outcome: result.outcome, error: result.message, countsAsFailure: countsAsFailure)
            let answer = (0...3).contains(consult.version) ? AgpsMessages.stateFailed : AgpsMessages.stateUnsupported
            await sendStatus(answer, result.message)
            finishWith(result.outcome)
        }
    }

    private func sendStatus(_ newState: Int, _ why: String) async {
        if Task.isCancelled { return }
        state = newState
        if newState != AgpsMessages.stateReady { task = false }
        log("sending file status \(newState) (\(stateName(newState)))\(why.isEmpty ? "" : ": \(why)")")
        await tx(AgpsMessages.agpsService, 0x03, AgpsMessages.fileStatus(state: newState), "file status \(newState)")
    }

    private func stateName(_ state: Int) -> String {
        switch state {
        case AgpsMessages.stateReady: return "ready"
        case AgpsMessages.stateFailed: return "failed"
        case AgpsMessages.stateUnsupported: return "unsupported"
        default: return "?"
        }
    }

    // MARK: 1C: the watch pulls the files (GB handleFileSendRequest ... handleFileDoneRequest)

    private func file(_ name: String) -> Bytes? { ready.first { $0.name == name }?.data }

    private func onFileList(_ packet: HuaweiPacket) async {
        let fileType = packet.tlv?.agpsInt(0x02) ?? -1
        let productId = packet.tlv?.agpsString(0x03) ?? ""
        let names = ready.map(\.name)
        log("file list request: type \(fileType), product \"\(productId)\"; offering \(names.count) files")
        transfer = nil
        if task && !names.isEmpty { armIdle(timing.stallMs) }
        // GB leaves type 0 (files by product id) unimplemented; there is nothing to match it against here either.
        let content = (fileType == 1 && !names.isEmpty) ? AgpsMessages.fileList(names: names) : AgpsMessages.refused()
        await tx(AgpsMessages.fileService, 0x01, content, "file list")
    }

    private func onFileConsult(_ packet: HuaweiPacket) async {
        guard let tlv = packet.tlv else { return }
        if let watchCode = tlv.agpsLong(0x7F), watchCode != 0 {
            logError("watch reported error \(watchCode) in the file consult")
            transfer = nil
            return
        }
        let proto = tlv.agpsString(0x01) ?? ""
        let transferSize = tlv.agpsInt(0x03) ?? 0
        let maxDataSize = tlv.agpsInt(0x04) ?? 0
        let fileType = tlv.agpsInt(0x06) ?? 0
        log("file consult: protocol \"\(proto)\", transfer size \(transferSize), max data \(maxDataSize), type \(fileType)")
        if transferSize <= 0 || maxDataSize <= 0 || !((!proto.isEmpty && fileType == 0) || fileType == 1) {
            transfer = nil
            await tx(AgpsMessages.fileService, 0x02, AgpsMessages.refused(), "file consult answer (refused)")
            return
        }
        transfer = Transfer(
            frameSize: min(transferSize, Int(Int16.max)), maxDataSize: min(maxDataSize, AgpsPolicy.maxDataPerRequest), fileType: fileType
        )
        if task { armIdle(timing.stallMs) }
        await tx(AgpsMessages.fileService, 0x02, AgpsMessages.accepted(), "file consult answer")
    }

    private func onFileInfo(_ packet: HuaweiPacket) async {
        let name = packet.tlv?.agpsString(0x01) ?? ""
        guard let current = transfer, current.fileType == 1, let data = file(name) else {
            let why = transfer == nil ? "no consult" : file(name) == nil ? "not available" : "unsupported type"
            log("file info request for \"\(name)\" refused (\(why))")
            transfer = nil
            await tx(AgpsMessages.fileService, 0x03, AgpsMessages.refused(), "file info answer (refused)")
            return
        }
        current.name = name
        current.data = data
        current.frames = 0
        current.sentEnd = 0
        let crc = Int(CRC16.checksum(data))
        log("file info: \(name) \(data.count) bytes, crc16 \(agpsHex4(crc))")
        armIdle(timing.stallMs)
        await tx(AgpsMessages.fileService, 0x03, AgpsMessages.fileInfo(size: data.count, crc16: crc), "file info answer")
    }

    private func onDataRequest(_ packet: HuaweiPacket) async {
        guard let tlv = packet.tlv else { return }
        let name = tlv.agpsString(0x01) ?? ""
        let offset = tlv.agpsInt(0x02) ?? -1
        let wanted = tlv.agpsInt(0x03) ?? -1
        guard let current = transfer, let data = current.data, !name.isEmpty, name == current.name, offset >= 0, offset <= data.count else {
            log("data request for \"\(name)\" at \(offset) refused")
            transfer = nil
            await tx(AgpsMessages.fileService, 0x04, AgpsMessages.refused(), "data answer (refused)")
            return
        }
        let size = min(data.count - offset, current.maxDataSize)
        let frames = size > 0 ? AgpsPolicy.frameCount(size: size, frameSize: current.frameSize) : 0
        guard let count = frames else {
            logError("data request for \(name) at \(offset) would need more than \(AgpsPolicy.maxFrames) frames of \(current.frameSize) bytes; refused")
            transfer = nil
            await tx(AgpsMessages.fileService, 0x04, AgpsMessages.refused(), "data answer (refused, too many frames)")
            return
        }
        armIdle(timing.stallMs)
        // The name the watch stores the file under is the SHA-256 of this phone-side address plus the plain name (GB getHexDigest).
        let storedName = EphemerisNet.addressDigest(address) + name
        await tx(AgpsMessages.fileService, 0x04, AgpsMessages.dataAnswer(storedName: storedName, offset: offset), "data answer")
        if size <= 0 { return }
        log("sending \(name) bytes \(offset)..\(offset + size) of \(data.count) (asked for \(wanted)) in \(count) frames")
        do {
            let params = session.params
            let frames = try HuaweiPacket(serviceId: UInt8(AgpsMessages.fileService), commandId: 0x05).serializeFileChunk1c(
                Array(data[offset..<offset + size]), transferSize: current.frameSize, packetCount: count,
                useEncryption: params.transactionsCrypted, params: params
            )
            try await session.sendFrames(
                frames, service: UInt8(AgpsMessages.fileService), command: 0x05, label: "AGPS \(name) chunk", logFrames: false
            )
            current.sentEnd = max(current.sentEnd, offset + size)
        } catch is CancellationError {
            return
        } catch {
            logError("chunk of \(name) not sent: \(describe(error))")
        }
    }

    private func onUploadDone(_ packet: HuaweiPacket) async {
        let result = packet.tlv?.agpsLong(0x01)
        let current = transfer
        let name = current?.name
        let total = current?.data?.count ?? 0
        let sentEnd = current?.sentEnd ?? 0
        let complete = current != nil && name != nil && total > 0 && sentEnd >= total
        log(
            "upload done: result \(result.map(String.init) ?? "null"), file \(name ?? "null"), \(current?.frames ?? 0) data acks, sent \(sentEnd) of \(total) bytes"
        )
        transfer = nil
        disarmIdle()
        await tx(AgpsMessages.fileService, 0x06, AgpsMessages.accepted(), "upload done answer")
        if !task { return }
        if complete, let name {
            delivered.insert(name)
            let all = ready.allSatisfy { delivered.contains($0.name) }
            let fetch = lastFetch
            store.recordDelivered(nowMs: nowMs(), dataMs: fetch?.dataTimeMs ?? nowMs(), size: total, source: fetch?.source ?? "", address: address)
            if all {
                task = false
                finishWith(AgpsOutcome.delivered)
            } else {
                armIdle(timing.pullWaitMs)
            }
        } else {
            task = false
            let why = "the watch closed the transfer after \(sentEnd) of \(total) bytes (result \(result.map(String.init) ?? "null"))"
            logError(why)
            store.recordOutcome(nowMs: nowMs(), outcome: AgpsOutcome.watchRefused, error: why, countsAsFailure: false)
            finishWith(AgpsOutcome.watchRefused)
        }
    }
}

/// The satellite-data job of the process: attaches an `AgpsExchange` to every live connection, keeps the phone-side copy fresh after every sync, and
/// answers the app's questions (status, refresh now).
public final class EphemerisLink: LinkObserver, @unchecked Sendable {
    public let store: AgpsStore
    private let link: LinkHandleSource
    private let events: WearEvents
    private let settings: WearSettings
    private let source: AgpsSource
    private let isOnline: @Sendable () -> Bool
    private let nowMs: @Sendable () -> Int
    private let timing: AgpsTiming

    private let lock = NSLock()
    private var exchange: AgpsExchange?
    private var exchangeSession: HuaweiSession?
    private var refreshing = false

    public init(
        link: LinkHandleSource, events: WearEvents, settings: WearSettings, store: AgpsStore, source: AgpsSource,
        isOnline: @escaping @Sendable () -> Bool, nowMs: @escaping @Sendable () -> Int = { Int(Date().timeIntervalSince1970 * 1000) },
        timing: AgpsTiming = AgpsTiming()
    ) {
        self.link = link
        self.events = events
        self.settings = settings
        self.store = store
        self.source = source
        self.isOnline = isOnline
        self.nowMs = nowMs
        self.timing = timing
    }

    /// The real source for this process: the Broadcom file over the network, copies in `cache`.
    public static func networkSource(store: AgpsStore, events: WearEvents, cache: AgpsCache, isOnline: @escaping @Sendable () -> Bool) -> AgpsSource {
        NetworkAgpsSource(cache: cache, store: store, log: { message in events.info("AGPS: \(message)") }, isOnline: isOnline)
    }

    private func log(_ message: String) { events.info("AGPS: \(message)") }

    private func logError(_ message: String) { events.error("AGPS: \(message)") }

    // MARK: LinkObserver

    public func linkConnected(_ handle: LinkHandle) async {
        guard let created = swapExchange(for: handle) else { return }
        await created.old?.stop()
        await created.fresh.start()
    }

    /// Makes the exchange for `handle`'s session; nil when that session already has one.
    private func swapExchange(for handle: LinkHandle) -> (fresh: AgpsExchange, old: AgpsExchange?)? {
        lock.locked {
            if exchangeSession === handle.session { return nil }
            let old = exchange
            let fresh = AgpsExchange(
                session: handle.session, caps: handle.caps, address: handle.address, events: events, source: source, store: store, isOnline: isOnline,
                nowMs: nowMs, timing: timing
            )
            exchange = fresh
            exchangeSession = handle.session
            return (fresh, old)
        }
    }

    public func linkDisconnected() {
        let old: AgpsExchange? = lock.locked {
            let current = exchange
            exchange = nil
            exchangeSession = nil
            return current
        }
        if let old { Task { await old.stop() } }
    }

    private func currentExchange() -> AgpsExchange? { lock.locked { exchange } }

    // MARK: the app

    /// What the Watch tab shows; cheap, read from the store and the live exchange.
    public func status() -> [String: Any] {
        let ex = currentExchange()
        let address = link.handle()?.address ?? settings.watchAddress
        let delivered = store.deliveredAddress
        let forThisWatch = delivered.isEmpty || address == nil || delivered.caseInsensitiveCompare(address!) == .orderedSame
        let exchangePhase = ex?.phase
        let phase = (exchangePhase != nil && exchangePhase != "idle") ? exchangePhase! : (lock.locked { refreshing } ? "downloading" : "idle")
        return [
            "linked": ex != nil,
            "phase": phase,
            "cachedAt": store.cachedAtMs,
            "cachedSize": store.cachedSize,
            "cachedSource": store.cachedSource,
            "deliveredAt": forThisWatch ? store.deliveredAtMs : 0,
            "deliveredSize": forThisWatch ? store.deliveredSize : 0,
            "deliveredSource": forThisWatch ? store.deliveredSource : "",
            "expiresAt": forThisWatch ? AgpsPolicy.expiresAtMs(dataTimeMs: store.deliveredDataMs, source: store.deliveredSource) : 0,
            "lastAskAt": store.lastAskMs,
            "lastAskVersion": store.lastAskVersion,
            "lastAskTags": store.lastAskTags,
            "outcome": store.lastOutcome,
            "error": store.lastError,
            "attemptAt": store.lastAttemptMs,
            "retryAt": store.retryAtMs(),
            "failures": store.failures,
            "labAgnss": store.labAgnss,
        ]
    }

    private func claimRefresh() -> Bool {
        lock.locked {
            if refreshing { return false }
            refreshing = true
            return true
        }
    }

    private func releaseRefresh() { lock.locked { refreshing = false } }

    private func result(_ outcome: String, _ message: String) -> [String: Any] { ["outcome": outcome, "message": message] }

    /// "Update now": downloads fresh data and, with a watch connected, starts the exchange from the phone so the watch takes it. Without a watch the
    /// data is kept on the phone and goes out when the watch asks. Returns `{outcome, message}`.
    public func refreshNow() async -> [String: Any] {
        if !claimRefresh() { return result(AgpsOutcome.busy, "an update is already running") }
        defer { releaseRefresh() }
        store.clearRetry()
        let outcome: String
        if let ex = currentExchange() {
            let probed = await ex.probe(force: true)
            // The watch said nothing: at least keep the data ready on the phone for when it asks.
            if probed == AgpsOutcome.watchSilent {
                outcome = await downloadOnly(AgpsOutcome.watchSilent)
            } else {
                outcome = probed
            }
        } else {
            outcome = await downloadOnly(AgpsOutcome.stored)
        }
        log("update now: \(outcome)")
        return result(outcome, store.lastError)
    }

    /// What "Update now" downloads when the watch is not part of it: the HW_AGNSS file when the experimental switch is on and the watch's last ask was
    /// exactly that kind, else the default data.
    private func refreshConsult() -> AgpsConsult {
        if store.labAgnss && AgpsLab.askedHwAgnss(version: store.lastAskVersion, tagNames: store.lastAskTags) {
            return AgpsConsult(version: store.lastAskVersion, tag: "/\(AgpsLab.kind)", urls: [])
        }
        return .default
    }

    /// Downloads the data for `refreshConsult` to the phone; `okOutcome` is what a good download is reported as.
    private func downloadOnly(_ okOutcome: String) async -> String {
        let source = self.source
        let consult = refreshConsult()
        let fetch =
            await agpsTimeout(ms: AgpsPolicy.downloadTimeoutMs) { await source.fetch(consult, force: true) }
            ?? .failed(AgpsOutcome.downloadFailed, "download timed out after \(AgpsPolicy.downloadTimeoutMs / 1000) s")
        let now = nowMs()
        if fetch.ok {
            store.recordDownloaded(nowMs: now, dataMs: fetch.dataTimeMs, size: fetch.totalSize, source: fetch.source)
            // A silent watch is still reported as silent: the stored outcome says why nothing was sent.
            if okOutcome == AgpsOutcome.stored {
                store.recordOutcome(nowMs: now, outcome: AgpsOutcome.stored, error: "", countsAsFailure: false)
            } else {
                store.recordOutcome(nowMs: now, outcome: okOutcome, error: "the watch did not answer; the data is ready on the phone", countsAsFailure: false)
            }
            return okOutcome
        }
        logError(fetch.message)
        store.recordOutcome(
            nowMs: now, outcome: fetch.outcome, error: fetch.message,
            countsAsFailure: fetch.outcome == AgpsOutcome.downloadFailed || fetch.outcome == AgpsOutcome.invalidFile
        )
        return fetch.outcome
    }

    /// The user cancels an update that is running.
    public func cancel() async {
        await currentExchange()?.cancel()
    }

    /// The experimental switch of Settings > Advanced (`AgpsLab`); it takes effect at the watch's next ask.
    public func setLabAgnss(_ enabled: Bool) {
        store.setLabAgnss(enabled)
        log("experimental HW_AGNSS data \(enabled ? "on" : "off")")
    }

    /// From the sync, once per round: keeps the phone-side copy fresh so the watch's next request is answered at once, and the failure wait
    /// (`AgpsPolicy.retryAtMs`) spaces the retries. Only while the watch asks for the default data (or has not asked yet): a watch that wants
    /// another kind of data gets nothing out of the Broadcom file.
    public func onSyncCycle() {
        Task { await self.prefetch() }
    }

    private func prefetch() async {
        if store.lastAskVersion > 0 { return }
        let now = nowMs()
        if !AgpsPolicy.prefetchDue(cachedAtMs: store.cachedAtMs, nowMs: now, retryAtMs: store.retryAtMs()) { return }
        if !isOnline() || lock.locked({ refreshing }) { return }
        log("keeping the phone's copy fresh (background)")
        let source = self.source
        let fetch =
            await agpsTimeout(ms: AgpsPolicy.downloadTimeoutMs) { await source.fetch(.default, force: false) }
            ?? .failed(AgpsOutcome.downloadFailed, "download timed out after \(AgpsPolicy.downloadTimeoutMs / 1000) s")
        if fetch.ok {
            if !fetch.fromCache {
                store.recordDownloaded(nowMs: nowMs(), dataMs: fetch.dataTimeMs, size: fetch.totalSize, source: fetch.source)
            }
        } else {
            logError(fetch.message)
            store.recordOutcome(
                nowMs: nowMs(), outcome: fetch.outcome, error: fetch.message,
                countsAsFailure: fetch.outcome == AgpsOutcome.downloadFailed || fetch.outcome == AgpsOutcome.invalidFile
            )
        }
    }
}

#endif
