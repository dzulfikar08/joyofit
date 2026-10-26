// Port of P2pStack.kt (derived from Gadgetbridge's HuaweiP2PManager, SendP2PCommand, AsynchronousResponse.handleP2p and the service registration
// of HuaweiSupportProvider.initializeDynamicServices): the P2P service (0x34/0x01) of one connection, on top of a `HuaweiSession`.
//
// Every 0x34/0x01 packet the watch sends (pings, data, acknowledgements of ours) reaches the session's subscriber, which only queues it; one task
// parses and dispatches them in order, one task writes the outgoing packets in order, so the services run one at a time like in GB and never
// block the session.
import Foundation

public final class P2PStack: @unchecked Sendable {
    /// What the manager sends through: queues the packet for the writer task. A separate object so the manager does not keep the stack alive.
    private final class Bridge: P2PTransport, @unchecked Sendable {
        let outbound: AsyncStream<HuaweiPacket>.Continuation
        let caps: DeviceCaps
        let sink: LogSink

        init(outbound: AsyncStream<HuaweiPacket>.Continuation, caps: DeviceCaps, sink: @escaping LogSink) {
            self.outbound = outbound
            self.caps = caps
            self.sink = sink
        }

        func sendP2P(
            cmdId: UInt8, sequence: Int16, srcPackage: String?, dstPackage: String?, srcFingerprint: String?, dstFingerprint: String?, sendData: Bytes?,
            sendCode: Int32
        ) throws {
            outbound.yield(
                P2P.P2PCommand.request(
                    cmdId: cmdId, sequenceId: sequence, srcPackage: srcPackage, dstPackage: dstPackage, srcFingerprint: srcFingerprint,
                    dstFingerprint: dstFingerprint, sendData: sendData, sendCode: sendCode
                )
            )
        }

        func supportsExpandCapability(_ which: Int) -> Bool { caps.expandCapability(which) }

        func log(_ message: String) { sink(LogEntry(.info, service: Int(P2P.id), command: Int(P2P.P2PCommand.id), message)) }
    }

    private let session: HuaweiSession
    private let caps: DeviceCaps
    private let sink: LogSink
    private let settings: HealthLivingState
    private let healthModelFactory: @Sendable (P2PManager) -> HealthModelService
    private let heartRateAge: @Sendable () -> Int
    private let heartRateZones: @Sendable () -> HeartRateZonesCalc.UserZones?
    private let inboundStream: AsyncStream<HuaweiPacket>
    private let inbound: AsyncStream<HuaweiPacket>.Continuation
    private let outboundStream: AsyncStream<HuaweiPacket>
    private let outbound: AsyncStream<HuaweiPacket>.Continuation
    public let manager: P2PManager

    private let lock = NSLock()
    private var subscription: Int?
    private var tasks: [Task<Void, Never>] = []
    private var _track: P2PTrackService?
    private var _dictionary: P2PDictionarySyncService?
    private var _healthModel: HealthModelService?
    private var _dictionaryPing: Int?
    private var _petalProbe: PetalMapsProbeService?
    private var _petalProbeHook: Int?

    public init(
        session: HuaweiSession, caps: DeviceCaps, log: @escaping LogSink, settings: HealthLivingState,
        healthModelFactory: @escaping @Sendable (P2PManager) -> HealthModelService, heartRateAge: @escaping @Sendable () -> Int,
        heartRateZones: @escaping @Sendable () -> HeartRateZonesCalc.UserZones? = { nil }
    ) {
        self.session = session
        self.caps = caps
        self.sink = log
        self.settings = settings
        self.healthModelFactory = healthModelFactory
        self.heartRateAge = heartRateAge
        self.heartRateZones = heartRateZones
        (inboundStream, inbound) = AsyncStream<HuaweiPacket>.makeStream()
        (outboundStream, outbound) = AsyncStream<HuaweiPacket>.makeStream()
        manager = P2PManager(transport: Bridge(outbound: outbound, caps: caps, sink: log))
    }

    public var dictionary: P2PDictionarySyncService? { lock.p2pLocked { _dictionary } }
    public var healthModel: HealthModelService? { lock.p2pLocked { _healthModel } }
    public var dictionaryPing: Int? { lock.p2pLocked { _dictionaryPing } }

    private func note(_ message: String, error: Bool = false) {
        sink(LogEntry(error ? .error : .info, service: Int(P2P.id), command: Int(P2P.P2PCommand.id), message))
    }

    public func start() async {
        let inbound = self.inbound
        let id = await session.subscribe(service: P2P.id, command: P2P.P2PCommand.id, label: "P2P") { inbound.yield($0) }
        let reader = Task { [weak self, inboundStream] in
            for await packet in inboundStream {
                guard let self else { return }
                self.dispatch(packet)
            }
        }
        let session = self.session
        let writer = Task { [weak self, outboundStream] in
            for await packet in outboundStream {
                do {
                    try await session.send(packet, label: "P2P")
                } catch is CancellationError {
                    return
                } catch let e as WearError {
                    if e.code != .disconnected { self?.note("P2P send failed: \(e.message)", error: true) }
                } catch {
                    self?.note("P2P send failed: \(error)", error: true)
                }
            }
        }
        lock.p2pLocked {
            subscription = id
            tasks = [reader, writer]
        }
    }

    private func dispatch(_ packet: HuaweiPacket) {
        do {
            let response: P2P.P2PCommand.Response
            do {
                response = try P2P.P2PCommand.Response(packet: packet)
            } catch {
                note("P2P packet could not be decoded (service \(packet.serviceId.hex2) command \(packet.commandId.hex2)): \(error)", error: true)
                return
            }
            try manager.handlePacket(response)
        } catch {
            note("P2P: handling a packet failed: \(error)", error: true)
        }
    }

    /// GB's registration block of `initializeDynamicServices`, limited to the services JoyoFit has.
    public func registerServices() {
        let listed = caps.supports(0x34, 0x01)
        let capsLine = "P2P: SupportedCommands 34/01=\(listed)"
        if !listed {
            note("\(capsLine); the watch does not list the P2P service (GB supportsP2PService), no P2P service registered")
            return
        }
        note("\(capsLine); registering P2P services")

        let dictionary = P2PDictionarySyncService(manager: manager)
        dictionary.setAvailabilityListener { [weak self] code in
            self?.lock.p2pLocked { self?._dictionaryPing = code }
            self?.note("P2P dictionary sync: ping answered \(String(format: "0x%02x", code & 0xFF)) (0xca = the watch app is there)")
        }
        lock.p2pLocked { _dictionary = dictionary }
        dictionary.register()

        if !caps.expandCapability(37) {
            note("Healthy Living: ExpandCapability 37 is not set, the watch will not ask for tasks; service not registered")
        } else if !settings.healthLivingEnabled {
            note("Healthy Living: switched off in the app; service not registered")
        } else {
            note("Healthy Living: ExpandCapability 37 set (Huawei's gate); registering module healthmodel")
            let service = healthModelFactory(manager)
            lock.p2pLocked { _healthModel = service }
            service.register()
        }

        note(HeartRateZonesSync.capsLine(caps))
        if HeartRateZonesSync.supportsTrack(caps) {
            let service = P2PTrackService(manager: manager, log: sink, age: heartRateAge, user: heartRateZones)
            lock.p2pLocked { _track = service }
            service.register()
        }
    }

    /// Re-sends the zones after the profile age or the configured zones changed; false when this watch takes them another way.
    public func resendHeartRateZones() -> Bool {
        guard let service = lock.p2pLocked({ _track }) else { return false }
        service.resend()
        return true
    }

    /// The Petal Maps companion probe (lab, `PetalProbeWire`); nil unless its switch is on.
    public var petalProbe: PetalMapsProbeService? { lock.p2pLocked { _petalProbe } }

    /// Registers the Petal Maps companion probe and its listeners for unhandled frames; `P2pController` checks the lab switch.
    public func registerPetalProbe() async {
        if !caps.supports(0x34, 0x01) {
            note("\(PetalProbeWire.tag) the watch does not list the P2P service (34/01); probe not registered")
            return
        }
        let service = PetalMapsProbeService(manager: manager, log: sink)
        let fresh = lock.p2pLocked { () -> Bool in
            if _petalProbe != nil { return false }
            _petalProbe = service
            return true
        }
        if !fresh { return }
        manager.setUnclaimedListener { [weak service] in service?.onUnclaimed($0) }
        service.register()
        let hook = await session.observeUnhandled { [weak service] s, c, tlv, raw in service?.onUnhandled(service: s, command: c, tlv: tlv, raw: raw) }
        let kept = lock.p2pLocked { () -> Bool in
            guard _petalProbe === service else { return false }
            _petalProbeHook = hook
            return true
        }
        if !kept { await session.unsubscribe(hook) }
    }

    public func unregisterPetalProbe() {
        let (service, hook) = lock.p2pLocked { () -> (PetalMapsProbeService?, Int?) in
            defer {
                _petalProbe = nil
                _petalProbeHook = nil
            }
            return (_petalProbe, _petalProbeHook)
        }
        guard service != nil else { return }
        if let hook {
            let session = self.session
            Task { await session.unsubscribe(hook) }
        }
        manager.setUnclaimedListener(nil)
        manager.unregisterService(PetalProbeWire.phonePackage)
        note("\(PetalProbeWire.tag) unregistered")
    }

    public func close() {
        let (id, hook, running) = lock.p2pLocked { () -> (Int?, Int?, [Task<Void, Never>]) in
            defer {
                subscription = nil
                _petalProbeHook = nil
                tasks = []
            }
            return (subscription, _petalProbeHook, tasks)
        }
        let session = self.session
        for id in [id, hook].compactMap({ $0 }) {
            Task { await session.unsubscribe(id) }
        }
        manager.unregisterAllServices()
        inbound.finish()
        outbound.finish()
        for task in running { task.cancel() }
    }
}
