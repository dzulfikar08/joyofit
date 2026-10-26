import Foundation
import XCTest
@testable import HuaweiProtocol

/// Collects what the protocol layers log.
final class PacketsLogBox: @unchecked Sendable {
    private let lock = NSLock()
    private var entries: [LogEntry] = []

    var sink: LogSink {
        { [self] entry in
            lock.lock(); entries.append(entry); lock.unlock()
        }
    }

    var all: [LogEntry] { lock.lock(); defer { lock.unlock() }; return entries }
    var messages: [String] { all.map { $0.message } }
    func contains(_ fragment: String) -> Bool { messages.contains { $0.contains(fragment) } }
}

/// An in-process Huawei watch speaking the WATCH side of the link over a loopback `FrameSink`: it reassembles what the phone writes with
/// `PacketAssembler`, answers like the Fit 4 Pro does over BLE (LinkParams, SecurityNegotiation, PinCode, the HiChain ISO exchanges with
/// real HMAC/HKDF/AES-GCM derived from the phone side mirrored, Auth/BondParams/Bond for the normal mode) and, once bound, encrypts its
/// TLVs with the negotiated key. Everything it receives is recorded in `seen`.
final class PacketsAuthFakeWatch: FrameSink, @unchecked Sendable {
    struct Config {
        /// LinkParams: deviceSupportType 4 is HiChain3 (the Fit 4 Pro); 0 selects the normal mode.
        var deviceSupportType: UInt8 = 4
        var authVersion: UInt8 = 1
        var authAlgo: UInt8 = 0
        var encryptMethod: UInt8 = 0
        var protocolVersion: UInt8 = 2
        var sliceSize = 1022
        var mtu = 514
        var bondState: UInt8 = 0
        /// Frames from the watch reach the phone in pieces of this size (a BLE notification).
        var notifySize = 180

        /// The watch's own 64-character ASCII hex auth id and its MAC.
        var authId = Array("5B3F0A1C77D2E9486AB0C3D41E5F6071829A3B4C5D6E7F8091A2B3C4D5E6F708".utf8)
        var mac = "30:A9:98:FC:64:0A"
        /// 64 bytes the PinCode answer carries.
        var pin = Bytes((0..<64).map { (i: Int) -> UInt8 in UInt8((i % 10) << 4 | ((i + 3) % 10)) })

        /// The auth token handed to a phone during op 1 (nil: random).
        var authToken: Bytes?

        // Behaviour switches
        var silent = false
        var silentCommands: Set<String> = []
        /// How many of the first requests with each label (`"01/01"`) the watch ignores before it starts answering them.
        var ignoreFirst: [String: Int] = [:]
        var corruptHiChainToken = false
        var hiChainErrorCode: Int?
        var deviceStatus: Int8? = nil

        // What the watch reports after the bind
        var productModel = "SYA-B29"
        var softwareVersion = "6.1.0.117(SP20C00M05)"
        var hardwareVersion = "1.0.0.5"
        var serialNumber = "SN123456"
        var deviceName = "HUAWEI WATCH FIT 4 Pro-40A"
        var batteryLevel: UInt8 = 71
        var batteryMulti: Bytes?
        /// Seconds the watch clock is ahead of what the phone sends.
        var clockOffset: Int32 = 1
        var services: Set<Int> = [0x01, 0x02, 0x04, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0f, 0x14, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x20]
        var commands: [Int: Set<Int>] = [
            0x01: [0x04, 0x07, 0x08, 0x2F, 0x30, 0x31, 0x35, 0x37],
            0x1A: [0x01, 0x03, 0x05, 0x06, 0x07],
            0x07: [0x01, 0x03, 0x16],
        ]
        var expandCapabilityBits: Set<Int> = [109, 182]
        var settingRelatedFlags: UInt8 = 0x02

        // Fitness data
        struct StepPage { var timestamp: Int32; var subs: [(offset: Int8, data: Bytes)]; var number: Int16? }
        var stepPages: [StepPage] = []
        /// Each page: (state byte, start seconds, minutes) per sleep record. nil: answer the count without the 0x81 container (Fit 4).
        var sleepPages: [[(type: UInt8, start: Int, minutes: Int)]]? = []
        var totals: (steps: Int32, calories: Int16, distance: Int32)?
        /// Answer every message data request with this wrong `number`.
        var sleepCountWithoutContainer = false
    }

    struct Seen {
        let service: UInt8
        let command: UInt8
        let tlv: HuaweiTLV
        /// The request's TLV arrived with the `{0x7C: 1}` wrapper.
        let encrypted: Bool
        var label: String { String(format: "%02x/%02x", service, command) }
    }

    var config: Config
    /// The watch's view of the link parameters: its key is what the phone must agree on.
    let params = ParamsProvider()
    /// The phones this watch has bound: android id (ASCII) -> auth token.
    var knownIdentities: [Bytes: Bytes] = [:]

    private let lock = NSLock()
    private var assembler = PacketAssembler()
    private var _seen: [Seen] = []
    private var _hichain = HiChainState()
    private var _bondKey: Bytes?
    private var _bondIV: Bytes?
    private var _serverNonce = Bytes()
    private var _userInfo: HuaweiTLV?
    private var _motionGoal: HuaweiTLV?
    private weak var session: HuaweiSession?

    private struct HiChainState {
        var op = 0
        var phoneAuthId = Bytes()
        var phoneSalt = Bytes()
        var watchSalt = Bytes()
        var psk = Bytes()
        var sessionKey: Bytes?
        var seed = Bytes()
        var requestId = Bytes(repeating: 0, count: 8)
    }

    init(config: Config = Config()) {
        self.config = config
    }

    func attach(_ session: HuaweiSession) {
        self.session = session
    }

    var seen: [Seen] { lock.lock(); defer { lock.unlock() }; return _seen }
    var labels: [String] { seen.map { $0.label } }
    var userInfo: HuaweiTLV? { lock.lock(); defer { lock.unlock() }; return _userInfo }
    var motionGoal: HuaweiTLV? { lock.lock(); defer { lock.unlock() }; return _motionGoal }
    var bondKey: Bytes? { lock.lock(); defer { lock.unlock() }; return _bondKey }
    func requests(_ label: String) -> [Seen] { seen.filter { $0.label == label } }

    // MARK: FrameSink

    func write(_ frames: [Bytes]) async throws {
        for chunk in frames { try handle(chunk: chunk) }
    }

    private func handle(chunk: Bytes) throws {
        var data = chunk
        var left = 0
        repeat {
            if left > 0 { data = Array(data[(data.count - left)...]) }
            let result = try assembler.feed(data, params: params)
            left = result.left
            if let packet = result.packet { try handle(packet: packet) }
        } while left > 0
    }

    // MARK: dispatch

    private func handle(packet: HuaweiPacket) throws {
        let tlv = packet.tlv ?? HuaweiTLV()
        let seen = Seen(service: packet.serviceId, command: packet.commandId, tlv: tlv, encrypted: packet.isEncrypted)
        lock.lock(); _seen.append(seen); lock.unlock()
        if config.silent || config.silentCommands.contains(seen.label) { return }
        if let skip = config.ignoreFirst[seen.label], requests(seen.label).count <= skip { return }

        switch (Int(packet.serviceId), Int(packet.commandId)) {
        case (1, 0x01): try linkParams()
        case (1, 0x33): try securityNegotiation(tlv)
        case (1, 0x16): try deviceStatus()
        case (1, 0x2C): try pinCode()
        case (1, 0x28): try hiChain(tlv)
        case (1, 0x13): try auth(tlv)
        case (1, 0x0F): try bondParams()
        case (1, 0x0E): try bond(tlv)
        case (1, 0x07): try productInfo()
        case (1, 0x05): try time(tlv)
        case (1, 0x08): try battery()
        case (1, 0x02): try supportedServices()
        case (1, 0x03): try supportedCommands(tlv)
        case (1, 0x37): try expandCapability()
        case (1, 0x31): try reply(1, 0x31, make { $0.put(0x01, byte: 1); $0.put(0x02, byte: self.config.settingRelatedFlags) })
        case (1, 0x30), (1, 0x3F), (1, 0x3D), (1, 0x35): try reply(packet.serviceId, packet.commandId, HuaweiTLV())
        case (1, 0x3E): break // GB: "The watch never answers to this command"
        case (0x1A, 0x05): try reply(0x1A, 0x05, HuaweiTLV())
        case (0x0C, 0x01): try reply(0x0C, 0x01, HuaweiTLV())
        case (7, 0x01): lock.lock(); _motionGoal = tlv; lock.unlock(); try reply(7, 0x01, HuaweiTLV())
        case (7, 0x02): lock.lock(); _userInfo = tlv; lock.unlock(); try reply(7, 0x02, HuaweiTLV())
        // The sensor switches, the zone configs and the capability notifications are answered with an empty TLV (what the watch does).
        case (7, 0x13), (7, 0x16), (7, 0x17), (7, 0x1C), (7, 0x1D), (7, 0x21), (7, 0x22), (7, 0x23), (7, 0x24), (0x17, 0x17):
            try reply(packet.serviceId, packet.commandId, HuaweiTLV())
        case (7, 0x0A): try messageCount(tlv, step: true)
        case (7, 0x0C): try messageCount(tlv, step: false)
        case (7, 0x0B): try stepData(tlv)
        case (7, 0x0D): try sleepData(tlv)
        case (7, 0x03): try fitnessTotals()
        default: break
        }
    }

    private func make(_ build: (inout HuaweiTLV) -> Void) -> HuaweiTLV {
        var t = HuaweiTLV()
        build(&t)
        return t
    }

    // MARK: replies

    /// Serializes with the watch's parameters and hands the frames to the phone in notification-sized pieces. Replies are encrypted
    /// once the watch holds a key, unless the real watch sends them in the clear (the auth phase).
    private func reply(_ service: UInt8, _ command: UInt8, _ tlv: HuaweiTLV, clear: Bool = false, sliced: Bool = true) throws {
        let encrypt = !clear && params.secretKey != nil
        let packet = HuaweiPacket(serviceId: service, commandId: command, tlv: tlv, isEncrypted: encrypt, isSliced: sliced)
        let frames = try packet.serialize(params: params)
        guard let session else { return }
        for frame in frames {
            var offset = 0
            while offset < frame.count {
                let end = min(offset + config.notifySize, frame.count)
                session.onData(Array(frame[offset..<end]))
                offset = end
            }
        }
    }

    private func linkParams() throws {
        _serverNonce = Entropy.bytes(16)
        var t = HuaweiTLV()
        t.put(0x01, byte: config.protocolVersion)
        t.put(0x02, short: Int16(config.sliceSize))
        t.put(0x03, short: Int16(config.mtu))
        t.put(0x04, short: 0)
        t.put(0x05, bytes: [0x00, config.authVersion] + _serverNonce)
        t.put(0x07, byte: config.deviceSupportType)
        if config.authAlgo != 0 { t.put(0x08, byte: config.authAlgo) }
        t.put(0x09, byte: config.bondState)
        if config.encryptMethod != 0 { t.put(0x0C, byte: config.encryptMethod) }
        try reply(1, 0x01, t, clear: true, sliced: false)
        params.deviceSupportType = config.deviceSupportType
        params.authVersion = config.authVersion
        params.authAlgo = config.authAlgo
        params.encryptMethod = config.encryptMethod
        params.sliceSize = config.sliceSize
        params.mtu = config.mtu
    }

    private func deviceStatus() throws {
        try reply(1, 0x16, make { $0.put(0x01, byte: UInt8(bitPattern: self.config.deviceStatus ?? 1)) }, clear: true)
    }

    private func securityNegotiation(_ request: HuaweiTLV) throws {
        let phoneId = (try? request.bytes(0x05)) ?? []
        let known = knownIdentities[phoneId] != nil
        // Real wire (Fit 4 Pro, authMode 4): 01=04 02=pairType (2 known, 1 new) 03=01 04=00 05=authId 06=18 zeros 07= 08=00 09=MAC\0 0a=00000000
        var t = HuaweiTLV()
        let authMode = (try? request.byte(0x01)) ?? 0
        t.put(0x01, byte: UInt8(bitPattern: authMode))
        if authMode == 4 {
            t.put(0x02, byte: known ? 2 : 1)
        } else {
            t.put(0x02, byte: known ? 2 : 1) // HiChain Lite: the negotiated authType
        }
        t.put(0x03, byte: 0x01)
        t.put(0x04, byte: 0x00)
        t.put(0x05, bytes: config.authId)
        t.put(0x06, bytes: Bytes(repeating: 0, count: 18))
        t.put(0x07)
        t.put(0x08, byte: 0x00)
        t.put(0x09, bytes: Array(config.mac.utf8) + [0])
        t.put(0x0A, bytes: [0, 0, 0, 0])
        try reply(1, 0x33, t, clear: true)
    }

    private func pinCode() throws {
        let iv = Entropy.bytes(16)
        let cipher = try HuaweiCrypto.encrypt(useGCM: config.encryptMethod == 1, message: config.pin, key: HuaweiCrypto.digestSecretV1, iv: iv)
        try reply(1, 0x2C, make { $0.put(0x01, bytes: cipher); $0.put(0x02, bytes: iv) }, clear: true)
    }

    // MARK: HiChain (the watch side of GetHiChainRequest)

    private func jsonText(_ payload: [(String, String)], message: Int, op: Int) -> String {
        var inner = payload.map { "\"\($0.0)\":\($0.1)" }
        inner.append("\"peerUserType\":0")
        // The watch ends its JSON with a NUL byte (real wire).
        return "{\"authForm\":0,\"payload\":{" + inner.joined(separator: ",") + "},\"groupAndModuleVersion\":\"2.0.1\",\"message\":\(message),\"isDeviceLevel\":false}\u{0}"
    }

    private func hiChainReply(op: Int, json: String, requestId: Bytes) throws {
        var t = HuaweiTLV()
        t.put(0x01, string: json)
        t.put(0x02, byte: UInt8(op))
        t.put(0x03, bytes: requestId)
        t.put(0x04, byte: 0x00)
        t.put(0x05, byte: 0x00)
        try reply(1, 0x28, t, clear: true)
    }

    private func hiChain(_ request: HuaweiTLV) throws {
        let json = try request.string(0x01)
        let op = Int(try request.byte(0x02))
        let requestId = try request.bytes(0x03)
        guard let data = HiChainJSON.firstObjectText(json).data(using: .utf8),
              let value = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let payload = value["payload"] as? [String: Any]
        else { throw NSError(domain: "FakeWatch", code: 1, userInfo: [NSLocalizedDescriptionKey: "bad HiChain JSON \(json)"]) }

        func hex(_ key: String) throws -> Bytes {
            guard let s = payload[key] as? String, let b = Bytes(hex: s) else { throw NSError(domain: "FakeWatch", code: 2, userInfo: [NSLocalizedDescriptionKey: "no \(key)"]) }
            return b
        }

        if let code = config.hiChainErrorCode {
            try hiChainReply(op: op, json: jsonText([("errorCode", "\(code)")], message: 0, op: op), requestId: requestId)
            return
        }

        var s = _hichain
        defer { _hichain = s }
        s.requestId = requestId

        if payload["isoSalt"] != nil { // step 1
            s = HiChainState()
            s.requestId = requestId
            s.op = op
            s.phoneSalt = try hex("isoSalt")
            s.phoneAuthId = try hex("peerAuthId")
            s.seed = try hex("seed")
            let key: Bytes
            if op == 1 {
                key = SHA256.hash(Array(config.pin.hexUpper.utf8))
            } else {
                guard let stored = knownIdentities[s.phoneAuthId] else {
                    try hiChainReply(op: op, json: jsonText([("errorCode", "3")], message: 0, op: op), requestId: requestId)
                    return
                }
                key = stored
            }
            s.psk = HMACSHA256.mac(key: key, message: s.seed)
            s.watchSalt = Entropy.bytes(16)
            var token = HMACSHA256.mac(key: s.psk, message: s.watchSalt + s.phoneSalt + s.phoneAuthId + config.authId)
            if config.corruptHiChainToken { token[0] ^= 0xFF }
            try hiChainReply(
                op: op,
                json: jsonText([("isoSalt", "\"\(s.watchSalt.hexUpper)\""), ("token", "\"\(token.hexUpper)\""), ("peerAuthId", "\"\(config.authId.hexUpper)\"")], message: 0x8011, op: op),
                requestId: requestId
            )
        } else if payload["token"] != nil { // step 2
            let phoneToken = try hex("token")
            let expected = HMACSHA256.mac(key: s.psk, message: s.phoneSalt + s.watchSalt + config.authId + s.phoneAuthId)
            XCTAssertEqual(phoneToken, expected, "the phone's HiChain step 2 token")
            let returnCodeMac = HMACSHA256.mac(key: s.psk, message: [0, 0, 0, 0])
            try hiChainReply(
                op: op,
                json: jsonText([("peerAuthId", "\"\(config.authId.hexUpper)\""), ("returnCodeMac", "\"\(returnCodeMac.hexUpper)\"")], message: 0x8012, op: op),
                requestId: requestId
            )
        } else if payload["encData"] != nil { // step 3, operationCode 1 only
            let sessionKey = HKDFSHA256.derive(secretKey: s.psk, salt: s.phoneSalt + s.watchSalt, info: Array("hichain_iso_session_key".utf8), outputLength: 32)
            s.sessionKey = sessionKey
            let challenge = try AES.decryptGCM(try hex("encData"), key: sessionKey, iv: try hex("nonce"), aad: Array("hichain_iso_exchange".utf8))
            let token = config.authToken ?? Entropy.bytes(32)
            knownIdentities[s.phoneAuthId] = token
            let nonce = Entropy.bytes(12)
            let enc = try AES.encryptGCM(token, key: sessionKey, iv: nonce, aad: challenge)
            try hiChainReply(
                op: op,
                json: jsonText([("nonce", "\"\(nonce.hexUpper)\""), ("encAuthToken", "\"\(enc.hexUpper)\"")], message: 0x8013, op: op),
                requestId: requestId
            )
        } else if payload["encResult"] != nil { // step 4
            let sessionKey = s.sessionKey ?? HKDFSHA256.derive(secretKey: s.psk, salt: s.phoneSalt + s.watchSalt, info: Array("hichain_iso_session_key".utf8), outputLength: 32)
            s.sessionKey = sessionKey
            let result = try AES.decryptGCM(try hex("encResult"), key: sessionKey, iv: try hex("nonce"), aad: Array("hichain_iso_result".utf8))
            XCTAssertEqual(result, [0, 0, 0, 0], "the phone's HiChain step 4 result")
            var t = HuaweiTLV()
            t.put(0x01, string: "com.huawei.health")
            t.put(0x02, byte: UInt8(op))
            t.put(0x03, bytes: Bytes(repeating: 0, count: 8))
            t.put(0x04, byte: 0x02)
            t.put(0x05, byte: 0x00)
            try reply(1, 0x28, t, clear: true)
            if op == 2 {
                params.secretKey = HKDFSHA256.derive(secretKey: sessionKey, salt: s.phoneSalt + s.watchSalt, info: Array("hichain_return_key".utf8), outputLength: 32)
            }
        }
    }

    // MARK: normal mode (GetAuthRequest, GetBondParamsRequest, GetBondRequest)

    private func auth(_ request: HuaweiTLV) throws {
        let challenge = try request.bytes(0x01)
        let nonce = try request.bytes(0x02)
        let crypto = HuaweiCrypto(authVersion: Int(config.authVersion), authAlgo: config.authAlgo, deviceSupportType: Int(config.deviceSupportType), authMode: 0)
        let doubleNonce = _serverNonce + Array(nonce[2...])
        let expectedChallenge = Array(try XCTUnwrap(crypto.digestChallenge(secretKey: nil, nonce: doubleNonce))[0..<0x20])
        XCTAssertEqual(challenge, expectedChallenge, "the phone's Auth challenge")
        let response = Array(try XCTUnwrap(crypto.digestResponse(secretKey: nil, nonce: doubleNonce))[0..<0x20])
        try reply(1, 0x13, make { $0.put(0x01, bytes: response) }, clear: true)
    }

    private func bondParams() throws {
        try reply(1, 0x0F, make { $0.put(0x01, byte: 0); $0.put(0x09, int: 7) }, clear: true)
        params.encryptionCounter = 7
    }

    /// The bonding key is the phone's secret key encrypted under the key derived from the device address; the watch recovers it and
    /// uses it from then on, exactly as a bonded watch does.
    var bondAddress = ""

    private func bond(_ request: HuaweiTLV) throws {
        let encrypted = try request.bytes(0x06)
        let iv = try request.bytes(0x07)
        let crypto = HuaweiCrypto(authVersion: Int(config.authVersion), authAlgo: config.authAlgo, deviceSupportType: Int(config.deviceSupportType), authMode: 0)
        let key = try crypto.decryptBondingKey(encryptMethod: config.encryptMethod, data: encrypted, key: crypto.createSecretKey(macAddress: bondAddress), iv: iv)
        lock.lock(); _bondKey = key; _bondIV = iv; lock.unlock()
        try reply(1, 0x0E, HuaweiTLV(), clear: true)
        params.secretKey = key
    }

    // MARK: init-phase answers

    private func productInfo() throws {
        try reply(1, 0x07, make {
            $0.put(0x03, string: self.config.hardwareVersion)
            $0.put(0x07, string: self.config.softwareVersion)
            $0.put(0x09, string: self.config.serialNumber)
            $0.put(0x0A, string: self.config.productModel + " ")
            $0.put(0x11, string: self.config.deviceName)
            $0.put(0x0F, string: "com.huawei.watch")
            $0.put(0x14, byte: 0x07)
        })
    }

    private func time(_ request: HuaweiTLV) throws {
        let phoneTime = try request.int(0x01)
        try reply(1, 0x05, make { $0.put(0x01, int: phoneTime &+ self.config.clockOffset) })
    }

    private func battery() throws {
        try reply(1, 0x08, make {
            $0.put(0x01, byte: self.config.batteryLevel)
            if let multi = self.config.batteryMulti { $0.put(0x02, bytes: multi) }
        })
    }

    private func supportedServices() throws {
        let known = DeviceConfig.SupportedServices.knownSupportedServices
        let flags = known.map { UInt8(config.services.contains(Int($0)) ? 1 : 0) }
        try reply(1, 0x02, make { $0.put(0x02, bytes: flags) })
    }

    private func supportedCommands(_ request: HuaweiTLV) throws {
        let container = try request.object(0x81)
        var out = HuaweiTLV()
        for entry in container.entries where entry.tag == 0x02 {
            let service = Int(entry.value[0])
            let table = DeviceConfig.SupportedCommands.commandsPerService[service] ?? []
            let supported = config.commands[service] ?? []
            out.put(0x02, byte: entry.value[0])
            out.put(0x04, bytes: table.map { UInt8(supported.contains(Int($0)) ? 1 : 0) })
        }
        try reply(1, 0x03, make { $0.put(0x81, tlv: out) })
    }

    private func expandCapability() throws {
        let top = (config.expandCapabilityBits.max() ?? 0) / 8 + 1
        var bitmap = Bytes(repeating: 0, count: top)
        for bit in config.expandCapabilityBits { bitmap[bit / 8] |= UInt8(1 << (bit % 8)) }
        try reply(1, 0x37, make { $0.put(0x01, bytes: bitmap) })
    }

    // MARK: fitness data

    private func messageCount(_ request: HuaweiTLV, step: Bool) throws {
        let command: UInt8 = step ? 0x0A : 0x0C
        if !step && (config.sleepPages == nil || config.sleepCountWithoutContainer) {
            try reply(7, command, make { $0.put(0x01, byte: 0) }) // no 0x81 container
            return
        }
        let count = step ? config.stepPages.count : (config.sleepPages?.count ?? 0)
        var inner = HuaweiTLV()
        inner.put(0x02, short: Int16(count))
        try reply(7, command, make { $0.put(0x81, tlv: inner) })
    }

    private func stepData(_ request: HuaweiTLV) throws {
        let index = Int(try request.object(0x81).short(0x02))
        guard index >= 0, index < config.stepPages.count else { return }
        let page = config.stepPages[index]
        var container = HuaweiTLV()
        container.put(0x02, short: page.number ?? Int16(index))
        container.put(0x03, int: page.timestamp)
        for sub in page.subs {
            var t = HuaweiTLV()
            t.put(0x05, byte: UInt8(bitPattern: sub.offset))
            t.put(0x06, bytes: sub.data)
            container.put(0x84, tlv: t)
        }
        try reply(7, 0x0B, make { $0.put(0x81, tlv: container) })
    }

    private func sleepData(_ request: HuaweiTLV) throws {
        let index = Int(try request.object(0x81).short(0x02))
        guard let pages = config.sleepPages, index >= 0, index < pages.count else { return }
        var container = HuaweiTLV()
        container.put(0x02, short: Int16(index))
        for record in pages[index] {
            var t = HuaweiTLV()
            t.put(0x04, byte: record.type)
            var ts = Bytes()
            ts.appendBE(UInt32(record.start))
            ts.appendBE(UInt16(record.minutes))
            t.put(0x05, bytes: ts)
            container.put(0x83, tlv: t)
        }
        try reply(7, 0x0D, make { $0.put(0x81, tlv: container) })
    }

    private func fitnessTotals() throws {
        guard let totals = config.totals else {
            try reply(7, 0x03, make { $0.put(0x01, byte: 1) }) // the Fit 4 answers without the 0x81 container
            return
        }
        var sub = HuaweiTLV()
        sub.put(0x05, int: totals.steps)
        sub.put(0x06, short: totals.calories)
        sub.put(0x07, int: totals.distance)
        var container = HuaweiTLV()
        container.put(0x83, tlv: sub)
        try reply(7, 0x03, make { $0.put(0x81, tlv: container) })
    }
}
