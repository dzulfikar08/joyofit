// Port of HuaweiP2PManager.java, HuaweiBaseP2PService.java and HuaweiP2PSubMsg.java (Gadgetbridge, AGPL-3.0-or-later), the layer every P2P module
// of service 0x34 sits on. As in the Kotlin port the support provider is a small `P2PTransport` seam, and the wake-app links are all answered
// with GB's "not supported" code 0xd2 (GB's handlers for them are not ported); a lab listener hears the packets no service claims, and one
// service can be unregistered by module.
import Foundation

/// What GB takes from HuaweiSupportProvider / HuaweiState / SendP2PCommand.
public protocol P2PTransport: AnyObject, Sendable {
    /// GB `SendP2PCommand.doPerform`: one 0x34/0x01 packet, not waiting for an answer.
    func sendP2P(
        cmdId: UInt8, sequence: Int16, srcPackage: String?, dstPackage: String?, srcFingerprint: String?, dstFingerprint: String?, sendData: Bytes?,
        sendCode: Int32
    ) throws
    /// GB `HuaweiState.supportsExpandCapability(int)`.
    func supportsExpandCapability(_ which: Int) -> Bool
    /// Protocol log line.
    func log(_ message: String)
}

public final class P2PManager: @unchecked Sendable {
    private let lock = NSRecursiveLock()
    private var services: [P2PService] = []
    private var sequence: Int16 = 1
    private var unclaimedListener: (@Sendable (P2P.P2PCommand.Response) -> Void)?
    public let transport: P2PTransport

    public init(transport: P2PTransport) {
        self.transport = transport
    }

    /// Hears a watch packet no registered service claims (no service has its source package; wake-app pings excluded). Lab logging only.
    public func setUnclaimedListener(_ listener: (@Sendable (P2P.P2PCommand.Response) -> Void)?) {
        lock.p2pLocked { unclaimedListener = listener }
    }

    /// GB `getNextSequence`: `(sequence + 1) % (Short.MAX_VALUE - 1)`.
    public func nextSequence() -> Int16 {
        lock.p2pLocked {
            sequence = Int16((Int(sequence) + 1) % (Int(Int16.max) - 1))
            return sequence
        }
    }

    public func registerService(_ service: P2PService) {
        lock.p2pLocked {
            for existing in services where existing.module == service.module {
                transport.log("P2P Service already registered, unregister: \(service.module)")
                existing.unregister()
                services.removeAll { $0 === existing }
            }
            services.append(service)
            service.registered()
        }
    }

    public func registeredService(_ module: String) -> P2PService? { lock.p2pLocked { services.first { $0.module == module } } }

    public func unregisterAllServices() {
        lock.p2pLocked {
            for service in services { service.unregister() }
            services.removeAll()
        }
    }

    /// Unregisters the service of `module`, if one is registered.
    public func unregisterService(_ module: String) {
        lock.p2pLocked {
            for service in services where service.module == module { service.unregister() }
            services.removeAll { $0.module == module }
        }
    }

    private func snapshot() -> [P2PService] { lock.p2pLocked { services } }

    public func sendAck(sequence: Int16, srcPackage: String?, dstPackage: String?, code: Int) {
        do {
            try transport.sendP2P(
                cmdId: 3, sequence: sequence, srcPackage: srcPackage, dstPackage: dstPackage, srcFingerprint: nil, dstFingerprint: nil, sendData: nil,
                sendCode: Int32(truncatingIfNeeded: code)
            )
        } catch {
            transport.log("P2P Service error send ACK: \(error)")
        }
    }

    /// GB answers the links it has a handler for with 0xd1; none of those handlers is ported.
    public func handleLink(_ link: String) -> Int { 0xd2 }

    public func handleWakeApp(_ packet: P2P.P2PCommand.Response) throws -> Int {
        guard let data = packet.respData, !data.isEmpty else { return 0xcc }
        let tlv = try HuaweiTLV(parsing: data)
        var link = ""
        if tlv.contains(0x04) {
            do { link = try tlv.string(0x04) } catch { transport.log("P2P Service error get link: \(error)") }
        }
        if !link.isEmpty { return handleLink(link) }
        return 0xcd
    }

    public func handleFile(srcPackage: String, dstPackage: String, srcFingerprint: String, dstFingerprint: String, filename: String, data: Bytes) {
        for service in snapshot() where service.package == srcPackage { service.handleFile(filename: filename, data: data) }
    }

    public func handlePacket(_ packet: P2P.P2PCommand.Response) throws {
        transport.log(
            "P2P rx cmd=\(packet.cmdId) src=\(packet.srcPackage) dst=\(packet.dstPackage) seq=\(packet.sequenceId) code=\(packet.respCode) data="
                + (packet.respData.map { "\($0.count) bytes" } ?? "none")
        )
        if packet.cmdId == 1 {
            let split = javaSplit(packet.dstPackage, separator: ".")
            if split.count > 2 && split[2] == "wakeapp" {
                let code = try handleWakeApp(packet)
                sendAck(sequence: packet.sequenceId, srcPackage: packet.dstPackage, dstPackage: packet.srcPackage, code: code)
                return
            }
        }
        var claimed = false
        for service in snapshot() where service.package == packet.srcPackage {
            claimed = true
            try service.handlePacket(packet)
        }
        if !claimed, let listener = lock.p2pLocked({ unclaimedListener }) { listener(packet) }
    }
}

/// `HuaweiBaseP2PService`: one module of the P2P service (a phone app talking to a watch app), with its ping / command / answer bookkeeping.
open class P2PService: @unchecked Sendable {
    public typealias Callback = @Sendable (_ code: Int, _ data: Bytes?) -> Void

    public let manager: P2PManager
    private let pendingLock = NSLock()
    private var waitPackets: [Int16: Callback] = [:]

    public init(manager: P2PManager) {
        self.manager = manager
    }

    open var module: String { fatalError("module") }
    open var package: String { fatalError("package") }
    open var fingerprint: String { fatalError("fingerprint") }
    open var localFingerprint: String { "UniteDeviceManagement" }
    open var pingPackage: String { "com.huawei.health" }

    open func registered() {}
    open func unregister() {}
    open func handleData(_ data: Bytes) throws {}
    open func handleFile(filename: String, data: Bytes) {}
    open func onPingPacket(_ packet: P2P.P2PCommand.Response) -> Int { 0xcf }
    open func onDataPacket(_ packet: P2P.P2PCommand.Response) -> Int { 0xcf }

    public func register() { manager.registerService(self) }

    private func sendP2PCommand(
        cmdId: UInt8, srcPackage: String?, dstPackage: String?, srcFingerprint: String?, dstFingerprint: String?, sendData: Bytes?, callback: Callback?
    ) {
        let seq = manager.nextSequence()
        if let callback { pendingLock.p2pLocked { waitPackets[seq] = callback } }
        do {
            manager.transport.log(
                "P2P tx cmd=\(cmdId) src=\(srcPackage ?? "nil") dst=\(dstPackage ?? "nil") seq=\(seq) data=" + (sendData.map { "\($0.count) bytes" } ?? "none")
            )
            try manager.transport.sendP2P(
                cmdId: cmdId, sequence: seq, srcPackage: srcPackage, dstPackage: dstPackage, srcFingerprint: srcFingerprint, dstFingerprint: dstFingerprint,
                sendData: sendData, sendCode: 0
            )
        } catch {
            _ = pendingLock.p2pLocked { waitPackets.removeValue(forKey: seq) }
            manager.transport.log("Failed to send p2p cmdId: \(cmdId): \(error)")
        }
    }

    public func sendPing(_ callback: Callback?) {
        sendP2PCommand(cmdId: 1, srcPackage: pingPackage, dstPackage: package, srcFingerprint: nil, dstFingerprint: nil, sendData: nil, callback: callback)
    }

    public func sendCommand(_ sendData: Bytes?, _ callback: Callback?) {
        sendP2PCommand(
            cmdId: 2, srcPackage: module, dstPackage: package, srcFingerprint: localFingerprint, dstFingerprint: fingerprint, sendData: sendData, callback: callback
        )
    }

    public func sendGetVersion(_ callback: Callback?) {
        if manager.transport.supportsExpandCapability(14) {  // GB HuaweiState.supportsP2PGetAppVersion
            sendP2PCommand(cmdId: 4, srcPackage: module, dstPackage: package, srcFingerprint: nil, dstFingerprint: nil, sendData: nil, callback: callback)
        } else {
            manager.transport.log("P2P Get App Version is not supported")
        }
    }

    /// Drops every callback still waiting for an answer (the link is gone).
    public func clearPending() { pendingLock.p2pLocked { waitPackets.removeAll() } }

    public func handlePacket(_ packet: P2P.P2PCommand.Response) throws {
        let handler = pendingLock.p2pLocked { waitPackets.removeValue(forKey: packet.sequenceId) }
        if let handler {
            handler(Int(packet.respCode), packet.respData)
        } else if packet.cmdId == 1 {
            let ret = onPingPacket(packet)
            manager.sendAck(sequence: packet.sequenceId, srcPackage: packet.dstPackage, dstPackage: packet.srcPackage, code: ret)
        } else if packet.cmdId == 2 {
            let ret = onDataPacket(packet)
            manager.sendAck(sequence: packet.sequenceId, srcPackage: packet.dstPackage, dstPackage: packet.srcPackage, code: ret)
            if let data = packet.respData { try handleData(data) }
        }
    }
}

/// `HuaweiP2PSubMsg`: the 36-byte little-endian header (type, version, total length, unknown, message id, padding) in front of the bytes some
/// P2P modules carry.
public struct P2PSubMsg: Equatable, Sendable {
    public static let headerLength = 36

    public var type: Int32
    public var version: Int32 = 1
    public var totalLength: Int32 = 0
    public var unknown: Int32 = 0
    public var messageId: Int32
    public var data: Bytes?

    private static let counter = SubMsgCounter()

    /// GB `getNext`: 1, 2, ... 999999, 0, 1 ...
    public static func nextMessageId() -> Int { counter.next() }

    public init(type: Int, messageId: Int, data: Bytes) {
        self.type = Int32(truncatingIfNeeded: type)
        self.messageId = Int32(truncatingIfNeeded: messageId)
        self.data = data
        self.totalLength = Int32(P2PSubMsg.headerLength + data.count)
    }

    /// The parsing constructor: data that is nil or shorter than the header gives the defaults (type 0, version 1, no data).
    public init(parsing bytes: Bytes?) throws {
        type = 0
        messageId = 0
        guard let bytes, bytes.count >= P2PSubMsg.headerLength else { return }
        func int(_ at: Int) -> Int32 { Int32(bitPattern: UInt32(bytes[at]) | UInt32(bytes[at + 1]) << 8 | UInt32(bytes[at + 2]) << 16 | UInt32(bytes[at + 3]) << 24) }
        type = int(0)
        version = int(4)
        totalLength = int(8)
        unknown = int(12)
        messageId = int(16)
        let dataLen = Int(totalLength) - P2PSubMsg.headerLength
        if dataLen > 0 {
            // GB's ByteBuffer.get throws BufferUnderflowException when the header promises more than the packet holds.
            guard P2PSubMsg.headerLength + dataLen <= bytes.count else { throw PbError("P2P message shorter than its length field says") }
            data = Array(bytes[P2PSubMsg.headerLength..<(P2PSubMsg.headerLength + dataLen)])
        }
    }

    public var bytes: Bytes {
        var out = Bytes()
        for value in [type, version, totalLength, 0, messageId] {
            let v = UInt32(bitPattern: value)
            for i in 0..<4 { out.append(UInt8((v >> UInt32(8 * i)) & 0xFF)) }
        }
        out.append(contentsOf: Bytes(repeating: 0, count: P2PSubMsg.headerLength - out.count))
        out.append(contentsOf: data ?? [])
        return out
    }
}

private final class SubMsgCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0

    func next() -> Int {
        lock.p2pLocked {
            value = (value + 1) % 1_000_000
            return value
        }
    }
}

extension NSLocking {
    func p2pLocked<T>(_ body: () throws -> T) rethrows -> T {
        lock()
        defer { unlock() }
        return try body()
    }
}
