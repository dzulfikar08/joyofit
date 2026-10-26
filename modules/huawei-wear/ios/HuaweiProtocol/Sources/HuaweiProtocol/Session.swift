// Request/response layer over a frame sink: port of the Kotlin HuaweiSession (GB ResponseManager + Request).
import Foundation

/// Where serialized frames go. The CoreBluetooth transport implements it: it cuts frames to the ATT payload and writes them in order.
public protocol FrameSink: AnyObject, Sendable {
    func write(_ frames: [Bytes]) async throws
}

/// A typed view of a response packet (GB `Response` classes with `parseTlv()`).
public protocol PacketResponse {
    init(packet: HuaweiPacket) throws
}

extension ParamsProvider: @unchecked Sendable {}

/// One value delivered once; `value()` may be awaited before or after `complete`.
final class Promise<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var result: Result<T, Error>?
    private var continuation: CheckedContinuation<T, Error>?

    func complete(_ r: Result<T, Error>) {
        lock.lock()
        if result != nil { lock.unlock(); return }
        result = r
        let c = continuation
        continuation = nil
        lock.unlock()
        c?.resume(with: r)
    }

    func value() async throws -> T {
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<T, Error>) in
            lock.lock()
            if let r = result {
                lock.unlock()
                c.resume(with: r)
            } else {
                continuation = c
                lock.unlock()
            }
        }
    }
}

public actor HuaweiSession {
    public nonisolated let params = ParamsProvider()

    private final class Waiter {
        let serviceId: UInt8
        let commandId: UInt8
        let label: String
        let promise = Promise<HuaweiPacket>()
        init(serviceId: UInt8, commandId: UInt8, label: String) {
            self.serviceId = serviceId
            self.commandId = commandId
            self.label = label
        }
    }

    private struct Subscription {
        let id: Int
        let serviceId: UInt8
        let commandId: UInt8
        let label: String
        let handler: @Sendable (HuaweiPacket) -> Void
    }

    private let sink: FrameSink
    private let log: LogSink
    private var waiters: [Waiter] = []
    private var subscriptions: [Subscription] = []
    private var nextSubscriptionId = 0
    private var unhandledObservers: [(id: Int, observer: UnhandledObserver)] = []
    private var closedBy: WearError?
    private var assembler = PacketAssembler()
    /// Raw wire bytes of the frame(s) being reassembled, for the rx log only.
    private var frame = Bytes()

    private nonisolated let inbound: AsyncStream<Bytes>.Continuation

    public init(sink: FrameSink, log: @escaping LogSink) {
        self.sink = sink
        self.log = log
        var continuation: AsyncStream<Bytes>.Continuation!
        let stream = AsyncStream<Bytes> { continuation = $0 }
        self.inbound = continuation
        // Ends when `deinit` finishes the stream; holds the session only for the duration of one chunk.
        Task { [weak self] in
            for await chunk in stream {
                guard let self else { return }
                await self.handle(chunk)
            }
        }
    }

    deinit {
        inbound.finish()
    }

    /// Entry point for notification payloads from the transport; ordered and safe to call from any thread.
    public nonisolated func onData(_ chunk: Bytes) {
        inbound.yield(chunk)
    }

    public var closeCause: WearError? { closedBy }

    // MARK: requests

    /// Sends `packet` and suspends for the first inbound packet with the same service and command (GB `Request.doPerform`).
    public func request(_ packet: HuaweiPacket, timeoutMs: Int, label: String) async throws -> HuaweiPacket {
        let frames = try serialize(packet, label: label)
        if let closedBy { throw closedBy }
        let waiter = Waiter(serviceId: packet.serviceId, commandId: packet.commandId, label: label)
        waiters.append(waiter)
        do {
            try await transmit(service: packet.serviceId, command: packet.commandId, frames: frames, label: label, logFrames: true)
        } catch {
            waiters.removeAll { $0 === waiter }
            throw error
        }
        let timer = Task {
            try await Task.sleep(nanoseconds: UInt64(max(timeoutMs, 0)) * 1_000_000)
            waiter.promise.complete(.failure(WearError(
                .timeout,
                "\(label): no response (service \(waiter.serviceId.hex2), command \(waiter.commandId.hex2)) within \(timeoutMs) ms"
            )))
        }
        defer { timer.cancel() }
        do {
            return try await withTaskCancellationHandler {
                try await waiter.promise.value()
            } onCancel: {
                waiter.promise.complete(.failure(CancellationError()))
            }
        } catch {
            waiters.removeAll { $0 === waiter }
            throw error
        }
    }

    /// `request` plus the typed parse of the answer; a parse failure is an `ERR_PROTOCOL` flagged `isParseFailure`.
    public func request<R: PacketResponse>(_ packet: HuaweiPacket, as type: R.Type = R.self, timeoutMs: Int, label: String) async throws -> R {
        let response = try await request(packet, timeoutMs: timeoutMs, label: label)
        do {
            return try R(packet: response)
        } catch let e as WearError {
            throw e
        } catch {
            throw WearError(.protocolError, "\(label): failed to parse response: \(error)", underlying: error, isParseFailure: true)
        }
    }

    /// Sends without waiting for an answer; the reply (if any) is picked up by a subscriber.
    public func send(_ packet: HuaweiPacket, label: String, logFrames: Bool = true) async throws {
        let frames = try serialize(packet, label: label)
        if let closedBy { throw closedBy }
        try await transmit(service: packet.serviceId, command: packet.commandId, frames: frames, label: label, logFrames: logFrames)
    }

    /// Sends frames that are already serialized (a file chunk, see `HuaweiPacket.serializeFileChunk`), without waiting for an answer.
    public func sendFrames(_ frames: [Bytes], service: UInt8, command: UInt8, label: String, logFrames: Bool = true) async throws {
        if let closedBy { throw closedBy }
        try await transmit(service: service, command: command, frames: frames, label: label, logFrames: logFrames)
    }

    /// Routes complete packets that no pending request waits for to `handler` until the returned id is passed to `unsubscribe`.
    /// The handler runs on the session's executor and must not block.
    public func subscribe(service: UInt8, command: UInt8, label: String, handler: @escaping @Sendable (HuaweiPacket) -> Void) -> Int {
        nextSubscriptionId += 1
        subscriptions.append(Subscription(id: nextSubscriptionId, serviceId: service, commandId: command, label: label, handler: handler))
        return nextSubscriptionId
    }

    public func unsubscribe(_ id: Int) {
        subscriptions.removeAll { $0.id == id }
        unhandledObservers.removeAll { $0.id == id }
    }

    /// What `observeUnhandled` hands over: service, command, the decoded TLV bytes (nil when undecodable) and the raw frame.
    public typealias UnhandledObserver = @Sendable (_ service: Int, _ command: Int, _ tlv: Bytes?, _ raw: Bytes) -> Void

    /// A lab hook: `observer` also hears every complete packet that no request waits for and no subscriber takes (the ones logged as
    /// "asynchronous") until the returned id is passed to `unsubscribe`. It runs on the session's executor and must not block.
    public func observeUnhandled(_ observer: @escaping UnhandledObserver) -> Int {
        nextSubscriptionId += 1
        unhandledObservers.append((id: nextSubscriptionId, observer: observer))
        return nextSubscriptionId
    }

    /// Fails everything in flight and rejects new requests. Idempotent; the first cause wins.
    public func close(_ cause: WearError) {
        guard closedBy == nil else { return }
        closedBy = cause
        let pending = waiters
        waiters.removeAll()
        assembler.reset()
        frame = []
        for w in pending { w.promise.complete(.failure(cause)) }
    }

    // MARK: outbound

    private func serialize(_ packet: HuaweiPacket, label: String) throws -> [Bytes] {
        do {
            return try packet.serialize(params: params)
        } catch {
            throw WearError(.protocolError, "\(label): request could not be created: \(error)", underlying: error)
        }
    }

    private func transmit(service: UInt8, command: UInt8, frames: [Bytes], label: String, logFrames: Bool) async throws {
        let mtu = params.mtu
        var wire = [Bytes]()
        wire.reserveCapacity(frames.count)
        for (index, f) in frames.enumerated() {
            if logFrames {
                log(LogEntry(
                    .tx, service: Int(service), command: Int(command), hex: f.hexUpper,
                    frames.count > 1 ? "\(label) (frame \(index + 1)/\(frames.count))" : label
                ))
            }
            HuaweiSession.splitToMTU(f, mtu: mtu, into: &wire)
        }
        if !logFrames {
            log(LogEntry(
                .tx, service: Int(service), command: Int(command), hex: nil,
                "\(label) (\(frames.count) frames, \(frames.reduce(0) { $0 + $1.count }) bytes, hex not logged)"
            ))
        }
        do {
            try await sink.write(wire)
        } catch let e as WearError {
            throw e
        } catch {
            throw WearError(.disconnected, "\(label): write failed: \(error)", underlying: error)
        }
    }

    /// `Request.doPerform`: a frame of `mtu` bytes or more is written in `mtu`-sized pieces.
    static func splitToMTU(_ frame: Bytes, mtu: Int, into out: inout [Bytes]) {
        if mtu <= 0 || frame.count < mtu {
            out.append(frame)
            return
        }
        var offset = 0
        while offset < frame.count {
            let end = min(offset + mtu, frame.count)
            out.append(Array(frame[offset..<end]))
            offset = end
        }
    }

    // MARK: inbound

    /// `ResponseManager.handleData` for one channel, including the loop over bytes that belong to the next frame.
    func handle(_ chunk: Bytes) {
        if closedBy != nil { return }
        var data = chunk
        var left = 0
        repeat {
            if left > 0 { data = Array(data[(data.count - left)...]) }
            frame += data
            let result: PacketAssembler.Result
            do {
                result = try assembler.feed(data, params: params)
            } catch {
                // GB drops the packet on a ParseException; any failure resets the reassembly so the buffer is not poisoned.
                log(LogEntry(.error, hex: frame.hexUpper, "Packet parse failed: \(error)"))
                assembler.reset()
                frame = []
                return
            }
            left = result.left
            if let packet = result.packet {
                let raw = Array(frame.prefix(frame.count - left))
                frame = []
                dispatch(packet, raw: raw)
            } else if left > 0 {
                frame = Array(frame.prefix(frame.count - left))
            }
        } while left > 0
    }

    private func dispatch(_ packet: HuaweiPacket, raw: Bytes) {
        let service = Int(packet.serviceId)
        let command = Int(packet.commandId)
        if let index = waiters.firstIndex(where: { $0.serviceId == packet.serviceId && $0.commandId == packet.commandId }) {
            let waiter = waiters.remove(at: index)
            log(LogEntry(.rx, service: service, command: command, hex: raw.hexUpper, "response to \(waiter.label)"))
            waiter.promise.complete(.success(packet))
        } else if let subscription = subscriptions.first(where: { $0.serviceId == packet.serviceId && $0.commandId == packet.commandId }) {
            log(LogEntry(.rx, service: service, command: command, hex: raw.hexUpper, "pushed (\(subscription.label))"))
            subscription.handler(packet)
        } else {
            let tlv = packet.tlv.map { "\($0)" } ?? "none"
            log(LogEntry(.rx, service: service, command: command, hex: raw.hexUpper, "asynchronous (no pending request) tlv=\(tlv)"))
            for entry in unhandledObservers { entry.observer(service, command, packet.tlv?.serialize(), raw) }
        }
    }
}
