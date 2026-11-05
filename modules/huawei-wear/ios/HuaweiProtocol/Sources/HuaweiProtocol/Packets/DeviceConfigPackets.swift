// Port of the DeviceConfig.java packets (service 0x01) the proven BLE link uses, plus the Java quirks around them.
// A Java request class becomes `static func request(...) -> HuaweiPacket` that sets serviceId/commandId/tlv and the same
// isEncrypted/isSliced flags as the Java constructor (Java default: encrypted and sliced). A Java `Response` becomes a
// `Response: PacketResponse` whose `init(packet:)` is `parseTlv()`.
//
// Failure classes follow the Java exceptions because `HuaweiSession.request(as:)` and ActivitySync tell them apart: a Java
// ParseException (MissingTagException, JsonException, CryptoException, SupportedCommandsListException) is thrown as `PacketError`
// (the session reports it with `isParseFailure`); every other Java failure inside parseTlv (ArrayIndexOutOfBounds, BufferUnderflow,
// NullPointer, StringIndexOutOfBounds) is a plain ERR_PROTOCOL `WearError`.
import Foundation

// MARK: - Java semantics shared by the packet files

enum PacketsJava {
    /// A Java runtime exception inside `parseTlv()`: ERR_PROTOCOL, not a parse failure.
    static func runtimeFailure(_ what: String, _ detail: String, underlying: Error? = nil) -> WearError {
        WearError(.protocolError, "\(what): failed to parse response: \(detail)", underlying: underlying)
    }

    /// Runs a `parseTlv()` body: the TLV errors map to the Java exception class they stand for.
    static func parsing<T>(_ what: String, _ body: () throws -> T) throws -> T {
        do {
            return try body()
        } catch let e as TLVError {
            switch e {
            case .missingTag(let tag): throw PacketError.missingTag(tag)
            case .malformed(let detail): throw runtimeFailure(what, detail, underlying: e)
            }
        }
    }

    static func tlv(of packet: HuaweiPacket, _ what: String) throws -> HuaweiTLV {
        guard let tlv = packet.tlv else { throw runtimeFailure(what, "NullPointerException: the packet has no TLV") }
        return tlv
    }

    /// `String.trim()`: drops every leading and trailing char up to U+0020.
    static func trim(_ s: String) -> String {
        var scalars = Array(s.unicodeScalars)
        while let last = scalars.last, last.value <= 0x20 { scalars.removeLast() }
        var start = 0
        while start < scalars.count, scalars[start].value <= 0x20 { start += 1 }
        var out = String.UnicodeScalarView()
        out.append(contentsOf: scalars[start...])
        return String(out)
    }

    /// GB `hexStringToByteArray`: no validation. A non-hex digit is `Character.digit` = -1 and goes into the arithmetic; an odd length
    /// reads past the end (StringIndexOutOfBounds, a runtime failure).
    static func hexBytes(_ s: String, _ what: String) throws -> Bytes {
        let chars = Array(s.utf16)
        func digit(_ c: UInt16) -> Int {
            switch c {
            case 0x30...0x39: return Int(c) - 0x30
            case 0x41...0x46: return Int(c) - 0x41 + 10
            case 0x61...0x66: return Int(c) - 0x61 + 10
            default: return -1
            }
        }
        var out = Bytes()
        out.reserveCapacity(chars.count / 2)
        var i = 0
        while i < chars.count {
            guard i + 1 < chars.count else {
                throw runtimeFailure(what, "StringIndexOutOfBoundsException: hex string of odd length \(chars.count)")
            }
            out.append(UInt8(truncatingIfNeeded: (digit(chars[i]) << 4) + digit(chars[i + 1])))
            i += 2
        }
        return out
    }

    /// `(int) floatValue`: toward zero, saturating, NaN is 0.
    static func floatToInt(_ f: Float) -> Int32 {
        if f.isNaN { return 0 }
        if f >= 2_147_483_648 { return Int32.max }
        if f <= -2_147_483_648 { return Int32.min }
        return Int32(f)
    }

    /// `Math.round(float)`: floor(x + 1/2), saturating, NaN is 0.
    static func round(_ f: Float) -> Int32 {
        if f.isNaN { return 0 }
        let r = (Double(f) + 0.5).rounded(.down)
        if r >= 2_147_483_647 { return Int32.max }
        if r <= -2_147_483_648 { return Int32.min }
        return Int32(r)
    }
}

// MARK: - DeviceConfig

public enum DeviceConfig {
    public static let id: UInt8 = 0x01

    // MARK: LinkParams

    public enum LinkParams {
        public static let id: UInt8 = 0x01

        /// Unencrypted and unsliced; the Anywear (AW) type also asks tag 0x06.
        public static func request(deviceType: HuaweiDeviceType) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01); tlv.put(0x02); tlv.put(0x03); tlv.put(0x04)
            if deviceType == .aw { tlv.put(0x06) }
            return HuaweiPacket(serviceId: DeviceConfig.id, commandId: id, tlv: tlv, isEncrypted: false, isSliced: false)
        }

        /// Java `byte`/`short` fields stay signed; a field the watch leaves out keeps the Java default.
        public struct Response: PacketResponse {
            public var protocolVersion: Int8 = 0x00
            public var mtu: Int16 = 0x0014
            public var sliceSize: Int16 = 0x00f4
            public var authVersion: Int8 = 0x00
            public var serverNonce: Bytes = Bytes(repeating: 0, count: 16)
            public var deviceSupportType: Int8 = 0x00
            public var authAlgo: Int8 = 0x00
            public var bondState: Int8 = 0x00
            public var interval: Int16 = 0x0
            public var encryptMethod: Int8 = 0x00

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "LinkParams")
                try PacketsJava.parsing("LinkParams") {
                    if tlv.contains(0x01) { protocolVersion = try tlv.byte(0x01) }
                    if tlv.contains(0x02) { sliceSize = try tlv.short(0x02) }
                    if tlv.contains(0x03) { mtu = try tlv.short(0x03) }
                    if tlv.contains(0x04) { interval = try tlv.short(0x04) }

                    // System.arraycopy(getBytes(0x05), 2, serverNonce, 0, 16) then getBytes(0x05)[1]
                    let tag5 = try tlv.bytes(0x05)
                    guard tag5.count >= 18 else {
                        throw PacketsJava.runtimeFailure("LinkParams", "ArrayIndexOutOfBoundsException: tag 5 has \(tag5.count) bytes, wanted at least 18")
                    }
                    serverNonce = Array(tag5[2..<18])
                    authVersion = Int8(bitPattern: tag5[1])

                    if tlv.contains(0x07) { deviceSupportType = try tlv.byte(0x07) }
                    if tlv.contains(0x08) { authAlgo = try tlv.byte(0x08) }
                    if tlv.contains(0x09) { bondState = try tlv.byte(0x09) }
                    if tlv.contains(0x0C) { encryptMethod = try tlv.byte(0x0C) }
                }
            }
        }
    }

    // MARK: SupportedServices

    public enum SupportedServices {
        public static let id: UInt8 = 0x02

        public static let knownSupportedServices: Bytes = [
            0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A,
            0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x10, 0x11, 0x12, 0x13, 0x14,
            0x15, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x1B, 0x1D, 0x20,
            0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x2A, 0x2B, 0x2D, 0x2E,
            0x30, 0x32, 0x33, 0x34, 0x35,
        ]

        public static func request(allSupportedServices: Bytes) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, bytes: allSupportedServices)
            return HuaweiPacket(serviceId: DeviceConfig.id, commandId: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            public var supportedServices: Bytes

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "SupportedServices")
                supportedServices = try PacketsJava.parsing("SupportedServices") { try tlv.bytes(0x02) }
            }
        }
    }

    // MARK: SupportedCommands

    public enum SupportedCommands {
        public static let id: UInt8 = 0x03

        /// `commandsPerService`: for each service, the commands in the order the watch's bitmap lists them.
        public static let commandsPerService: [Int: Bytes] = [
            0x01: [0x04, 0x07, 0x08, 0x09, 0x0A, 0x0D, 0x0E, 0x10, 0x11, 0x12, 0x13, 0x14, 0x1B, 0x1A, 0x1D, 0x21, 0x22, 0x23, 0x24, 0x29, 0x2A, 0x2B, 0x32, 0x2E, 0x31, 0x30, 0x35, 0x36, 0x37, 0x2F],
            0x02: [0x01, 0x04, 0x05, 0x06, 0x07, 0x08],
            0x03: [0x01, 0x03, 0x04],
            0x04: [0x01],
            0x05: [0x01],
            0x06: [0x01],
            0x07: [0x01, 0x03, 0x05, 0x07, 0x08, 0x09, 0x0A, 0x0E, 0x10, 0x13, 0x16, 0x15, 0x17, 0x18, 0x1B, 0x1C, 0x1D, 0x1E, 0x21, 0x22, 0x23, 0x24, 0x25, 0x28, 0x29, 0x06, 0x1F],
            0x08: [0x01, 0x02, 0x03],
            0x09: [0x01, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F],
            0x0A: [0x01, 0x09, 0x0A],
            0x0B: [0x01, 0x03],
            0x0C: [0x01],
            0x0D: [0x01],
            0x0F: [0x01, 0x03, 0x05, 0x06, 0x07, 0x08, 0x0A, 0x0B, 0x0C],
            0x10: [0x01],
            0x11: [0x01],
            0x12: [0x01],
            0x13: [0x01],
            0x14: [0x01],
            0x15: [0x01],
            0x16: [0x01, 0x03, 0x07],
            0x17: [0x01, 0x04, 0x06, 0x07, 0x0B, 0x0C, 0x10, 0x12, 0x15, 0x17],
            0x18: [0x01, 0x02, 0x04, 0x05, 0x06, 0x09],
            0x19: [0x01, 0x04],
            0x1A: [0x01, 0x03, 0x07, 0x05, 0x06],
            0x1B: [0x01, 0x0F, 0x19, 0x1A],
            // No 0x1C
            0x1D: [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A],
            // No 0x1E, 0x1F
            0x20: [0x01, 0x02, 0x03, 0x04, 0x09, 0x0A],
            // 0x21 is commented out in Java
            0x22: [0x01],
            0x23: [0x02, 0x0B],
            0x24: [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C],
            0x25: [0x02, 0x04, 0x0E],
            0x26: [0x02, 0x03],
            0x27: [0x01, 0x0E],
            // No 0x28, 0x29
            0x2A: [0x01, 0x06],
            0x2B: [0x12],
            // No 0x2C
            0x2D: [0x01],
            0x2E: [0x01, 0x02, 0x03],
            // No 0x2F
            0x30: [0x01],
            // No 0x31
            0x32: [0x01],
            0x33: [0x01, 0x02],
            0x34: [0x01],
            0x35: [0x03, 0x04],
        ]

        /// The Java request packs services until `addCommandsForService` says no; `serialize()` wraps the list in tag 0x81, which
        /// `packet` does.
        public struct Request {
            private var tlv = HuaweiTLV()
            private let maxSize: Int

            public init(params: ParamsProvider) {
                // slice size is the max size; minus a 4 byte header, a 2 byte body header, a 2 byte footer, 3 bytes for the 0x81 tag and
                // 21 for the encryption; then aligned to 16 byte blocks, a header and two length bytes (and one byte of CBC padding).
                var size = params.sliceSize - 32
                size = size - (size % 16) - 4
                maxSize = size
            }

            /// False (and nothing added) when the service's commands do not fit.
            @discardableResult
            public mutating func addCommandsForService(_ service: UInt8, _ commands: Bytes) -> Bool {
                // tlv length is what we have already; commands is what we add, with a 3-byte 0x02 tag and two bytes for length
                if tlv.length + commands.count + 5 > maxSize { return false }
                tlv.put(0x02, byte: service)
                tlv.put(0x03, bytes: commands)
                return true
            }

            public var packet: HuaweiPacket {
                var outer = HuaweiTLV()
                outer.put(0x81, tlv: tlv)
                return HuaweiPacket(serviceId: DeviceConfig.id, commandId: SupportedCommands.id, tlv: outer)
            }
        }

        public struct Response: PacketResponse {
            public struct CommandsList: Equatable {
                /// A Java `int` read from a signed byte.
                public var service: Int
                public var commands: Bytes
            }

            public var commandsLists: [CommandsList] = []

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "SupportedCommands")
                let what = "SupportedCommands"
                try PacketsJava.parsing(what) {
                    let container = try tlv.object(0x81)
                    // Java adds the same CommandsList object on every tag 0x04 that follows a tag 0x02, so a second 0x04 rewrites the
                    // commands of the entry added before it. `current` is the entries that share the object.
                    var service: Int?
                    var shared: [Int] = []
                    for entry in container.entries {
                        if entry.tag == 0x02 {
                            guard let first = entry.value.first else {
                                throw PacketsJava.runtimeFailure(what, "BufferUnderflowException: empty service tag")
                            }
                            service = Int(Int8(bitPattern: first))
                            shared = []
                        } else if entry.tag == 0x04 {
                            guard let service else { throw PacketError.supportedCommandsList("Commandslist is not yet set") }
                            var commands = Bytes()
                            for (i, flag) in entry.value.enumerated() where Int8(bitPattern: flag) == 1 {
                                guard let table = SupportedCommands.commandsPerService[service] else {
                                    throw PacketsJava.runtimeFailure(what, "NullPointerException: no command table for service \(service)")
                                }
                                guard i < table.count else {
                                    throw PacketsJava.runtimeFailure(what, "ArrayIndexOutOfBoundsException: command index \(i) of service \(service)")
                                }
                                commands.append(table[i])
                            }
                            for index in shared { commandsLists[index].commands = commands }
                            commandsLists.append(CommandsList(service: service, commands: commands))
                            shared.append(commandsLists.count - 1)
                        } else {
                            throw PacketError.supportedCommandsList("Unknown tag encountered")
                        }
                    }
                    if commandsLists.isEmpty { throw PacketError.supportedCommandsList("CommandLists is empty") }
                }
            }
        }
    }

    // MARK: TimeRequest

    public enum TimeRequest {
        public static let id: UInt8 = 0x05

        /// `HuaweiUtil.getTimeAndZoneId(now)`: the epoch seconds (int), the zone offset as hours (+128 when negative) and minutes
        /// (both Java bytes), then the zone id.
        public static func timeAndZoneId(now: Date, timeZone: TimeZone) -> Bytes {
            // ZONE_OFFSET + DST_OFFSET
            let zoneRawOffset = timeZone.secondsFromGMT(for: now)
            var out = Bytes()
            out.appendBE(UInt32(truncatingIfNeeded: Int64((now.timeIntervalSince1970 * 1000).rounded(.down)) / 1000))
            out.append(UInt8(truncatingIfNeeded: zoneRawOffset < 0 ? (-zoneRawOffset / 3600 + 128) : zoneRawOffset / 3600))
            out.append(UInt8(truncatingIfNeeded: zoneRawOffset / 60 % 60))
            out += Array(timeZone.identifier.utf8)
            return out
        }

        public static func request(now: Date = Date(), timeZone: TimeZone = .current) -> HuaweiPacket {
            let timeAndZone = timeAndZoneId(now: now, timeZone: timeZone)
            var tlv = HuaweiTLV()
            tlv.put(0x01, int: Int32(bitPattern: timeAndZone.u32be(0)))
            tlv.put(0x02, short: Int16(bitPattern: timeAndZone.u16be(4)))
            return HuaweiPacket(serviceId: DeviceConfig.id, commandId: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            /// Epoch seconds as the Java `int`.
            public var deviceTime: Int32 = 0

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "TimeRequest")
                try PacketsJava.parsing("TimeRequest") {
                    if tlv.contains(0x01) { deviceTime = try tlv.int(0x01) }
                }
            }
        }
    }

    // MARK: ProductInfo

    public enum ProductInfo {
        public static let id: UInt8 = 0x07

        public static func request(deviceType: HuaweiDeviceType) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            let tags: [Int] = deviceType == .aw
                ? [0x01, 0x02, 0x03, 0x07, 0x09, 0x0A, 0x0c, 0x11]
                : [0x01, 0x02, 0x07, 0x09, 0x0A, 0x11, 0x12, 0x16, 0x1A, 0x1D, 0x1E, 0x1F, 0x20, 0x21, 0x22, 0x23]
            for tag in tags { tlv.put(tag) }
            return HuaweiPacket(serviceId: DeviceConfig.id, commandId: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            public var hardwareVersion: String?
            public var softwareVersion: String?
            public var serialNumber: String?
            public var productModel: String?
            public var packageName: String?
            public var deviceName: String?
            public var regionCode: Int32 = 0
            public var otaSignatureLength: Int32 = 256

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "ProductInfo")
                try PacketsJava.parsing("ProductInfo") {
                    if tlv.contains(0x03) { hardwareVersion = try tlv.string(0x03) }
                    softwareVersion = try tlv.string(0x07)
                    if tlv.contains(0x09) { serialNumber = try tlv.string(0x09) }
                    productModel = PacketsJava.trim(try tlv.string(0x0A))
                    if tlv.contains(0x0F) { packageName = try tlv.string(0x0F) }
                    if tlv.contains(0x11) { deviceName = try tlv.string(0x11) }
                    if tlv.contains(0x14) { regionCode = try tlv.asInteger(0x14) }
                    if tlv.contains(0x27) { otaSignatureLength = try tlv.asInteger(0x27) }
                }
            }
        }
    }

    // MARK: Bond, BondParams

    public enum Bond {
        public static let id: UInt8 = 0x0E

        public static func request(clientSerial: Bytes, key: Bytes, iv: Bytes) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01)
            tlv.put(0x03, byte: 0x00)
            tlv.put(0x05, bytes: clientSerial)
            tlv.put(0x06, bytes: key)
            tlv.put(0x07, bytes: iv)
            return HuaweiPacket(serviceId: DeviceConfig.id, commandId: id, tlv: tlv, isEncrypted: false)
        }
    }

    public enum BondParams {
        public static let id: UInt8 = 0x0F

        public static func request(clientSerial: Bytes, mac: Bytes) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01)
            tlv.put(0x03, bytes: clientSerial)
            tlv.put(0x04, byte: 0x02)
            tlv.put(0x05)
            tlv.put(0x07, bytes: mac)
            tlv.put(0x09)
            return HuaweiPacket(serviceId: DeviceConfig.id, commandId: id, tlv: tlv, isEncrypted: false)
        }

        public struct Response: PacketResponse {
            public var status: Int8
            /// `getInteger(0x09) & 0xFFFFFFFFL`.
            public var encryptionCounter: UInt32

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "BondParams")
                (status, encryptionCounter) = try PacketsJava.parsing("BondParams") {
                    (try tlv.byte(0x01), UInt32(bitPattern: try tlv.int(0x09)))
                }
            }
        }
    }

    // MARK: Auth

    public enum Auth {
        public static let id: UInt8 = 0x13

        /// `params.authMode == 0x02` adds the auth algorithm as tag 0x03.
        public static func request(params: ParamsProvider, challenge: Bytes, nonce: Bytes) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, bytes: challenge)
            tlv.put(0x02, bytes: nonce)
            if params.authMode == 0x02 { tlv.put(0x03, byte: params.authAlgo) }
            return HuaweiPacket(serviceId: DeviceConfig.id, commandId: id, tlv: tlv, isEncrypted: false)
        }

        public struct Response: PacketResponse {
            public var challengeResponse: Bytes

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "Auth")
                challengeResponse = try PacketsJava.parsing("Auth") { try tlv.bytes(0x01) }
            }
        }
    }

    // MARK: BatteryLevel

    public enum BatteryLevel {
        public static let id: UInt8 = 0x08
        /// Same format, pushed by the watch (receive only).
        public static let idChange: UInt8 = 0x27

        public static func request() -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01)
            return HuaweiPacket(serviceId: DeviceConfig.id, commandId: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            /// A Java `byte`: the percentage as the watch wrote it (use `& 0xFF`).
            public var level: Int8
            public var multiLevel: Bytes?
            public var status: Bytes?

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "BatteryLevel")
                (level, multiLevel, status) = try PacketsJava.parsing("BatteryLevel") {
                    (try tlv.byte(0x01), tlv.bytes(0x02, default: nil), tlv.bytes(0x03, default: nil))
                }
            }
        }
    }

    // MARK: DeviceStatus

    public enum DeviceStatus {
        public static let id: UInt8 = 0x16

        public static func request(askStatus: Bool) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            if askStatus { tlv.put(0x01) } else { tlv.put(0x02, byte: 0x00) }
            return HuaweiPacket(serviceId: DeviceConfig.id, commandId: id, tlv: tlv, isEncrypted: false)
        }

        public struct Response: PacketResponse {
            /// -1 when the watch sends none (the AW70 does not).
            public var status: Int8 = -1

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "DeviceStatus")
                try PacketsJava.parsing("DeviceStatus") {
                    if tlv.contains(0x01) { status = try tlv.byte(0x01) }
                }
            }
        }
    }

    // MARK: PinCode

    public enum PinCode {
        public static let id: UInt8 = 0x2C

        public static func request() -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01)
            return HuaweiPacket(serviceId: DeviceConfig.id, commandId: id, tlv: tlv, isEncrypted: false)
        }

        public struct Response {
            /// The decrypted pin (64 bytes on the Fit 4 Pro): tag 0x01 is the ciphertext, 0x02 the IV, decrypted under the digest secret of
            /// `params.authVersion`. Needs the link parameters, so it is not a `PacketResponse`.
            public var pinCode: Bytes

            public init(packet: HuaweiPacket, params: ParamsProvider) throws {
                let tlv = try PacketsJava.tlv(of: packet, "PinCode")
                let (message, iv) = try PacketsJava.parsing("PinCode") { (try tlv.bytes(0x01), try tlv.bytes(0x02)) }
                let crypto = HuaweiCrypto(
                    authVersion: Int(Int8(bitPattern: params.authVersion)), authAlgo: params.authAlgo,
                    deviceSupportType: Int(Int8(bitPattern: params.deviceSupportType)), authMode: params.authMode
                )
                do {
                    pinCode = try crypto.decryptPinCode(encryptMethod: params.encryptMethod, message: message, iv: iv)
                } catch {
                    throw PacketError.crypto("Could not decrypt pinCode: \(error)")
                }
            }
        }
    }

    // MARK: HiChain

    public enum HiChain {
        public static let id: UInt8 = 0x28

        /// One HiChain exchange: `operationCode` 1 pairs (PIN derived key), 2 authenticates. The Java `StepOne..StepFour` build the JSON
        /// with `org.json` on Android, which keeps INSERTION order and writes `/` as `\/`; the text is built here in that order.
        public struct Request {
            public let operationCode: Int
            public let requestId: Int64
            public let selfAuthId: Bytes
            public let groupId: String

            public init(operationCode: Int, requestId: Int64, selfAuthId: Bytes, groupId: String) {
                self.operationCode = operationCode
                self.requestId = requestId
                self.selfAuthId = selfAuthId
                self.groupId = groupId
            }

            public func stepOne(messageId: Int, isoSalt: Bytes, seed: Bytes) -> HuaweiPacket {
                var payload = basePayload()
                payload.put("isoSalt", .string(isoSalt.hexUpper))
                payload.put("peerAuthId", .string(selfAuthId.hexUpper))
                payload.put("operationCode", .int(operationCode))
                payload.put("seed", .string(seed.hexUpper))
                payload.put("peerUserType", .int(0x00))
                var extra: [(String, HiChainJSON.Value)] = []
                if operationCode == 0x02 {
                    payload.put("pkgName", .string("com.huawei.devicegroupmanage"))
                    payload.put("serviceType", .string(groupId))
                    payload.put("keyLength", .int(0x20))
                    extra.append(("isDeviceLevel", .bool(false)))
                }
                return packet(messageId: messageId, payload: payload, extra: extra)
            }

            public func stepTwo(messageId: Int, token: Bytes) -> HuaweiPacket {
                var payload = basePayload()
                payload.put("peerAuthId", .string(selfAuthId.hexUpper))
                payload.put("token", .string(token.hexUpper))
                return packet(messageId: messageId, payload: payload, extra: operationCode == 0x02 ? [("isDeviceLevel", .bool(false))] : [])
            }

            public func stepThree(messageId: Int, nonce: Bytes, encData: Bytes) -> HuaweiPacket {
                var payload = basePayload()
                payload.put("nonce", .string(nonce.hexUpper))
                payload.put("encData", .string(encData.hexUpper))
                return packet(messageId: messageId, payload: payload, extra: [])
            }

            public func stepFour(messageId: Int, nonce: Bytes, encResult: Bytes) -> HuaweiPacket {
                var payload = basePayload()
                payload.put("nonce", .string(nonce.hexUpper))
                payload.put("encResult", .string(encResult.hexUpper))
                payload.put("operationCode", .int(operationCode))
                return packet(messageId: messageId, payload: payload, extra: [])
            }

            /// `createJson`'s `version` member of the payload.
            private func basePayload() -> HiChainJSON {
                var version = HiChainJSON()
                version.put("minVersion", .string("1.0.0"))
                version.put("currentVersion", .string("2.0.16"))
                var payload = HiChainJSON()
                payload.put("version", .object(version))
                return payload
            }

            private func packet(messageId: Int, payload: HiChainJSON, extra: [(String, HiChainJSON.Value)]) -> HuaweiPacket {
                var messageId = messageId
                if operationCode == 0x02 { messageId |= 0x10 }
                var value = HiChainJSON()
                value.put("authForm", .int(0x00))
                value.put("payload", .object(payload))
                value.put("groupAndModuleVersion", .string("2.0.1"))
                value.put("message", .int(messageId))
                if operationCode == 0x01 {
                    value.put("requestId", .string(String(requestId)))
                    value.put("groupId", .string(groupId))
                    value.put("groupName", .string("health_group_name"))
                    value.put("groupOp", .int(2))
                    value.put("groupType", .int(256))
                    value.put("peerDeviceId", .string(String(decoding: selfAuthId, as: UTF8.self)))
                    value.put("connDeviceId", .string(String(decoding: selfAuthId, as: UTF8.self)))
                    value.put("appId", .string("com.huawei.health"))
                    value.put("ownerName", .string(""))
                }
                for (key, member) in extra { value.put(key, member) }
                var tlv = HuaweiTLV()
                tlv.put(0x01, string: value.render())
                tlv.put(0x02, byte: UInt8(truncatingIfNeeded: operationCode))
                tlv.put(0x03, long: requestId)
                return HuaweiPacket(serviceId: DeviceConfig.id, commandId: DeviceConfig.HiChain.id, tlv: tlv, isEncrypted: false, isSliced: true)
            }
        }

        public struct Response: PacketResponse {
            public struct Step1Data: Equatable {
                public var isoSalt: Bytes
                public var peerAuthId: Bytes
                public var peerUserType: Int
                public var token: Bytes
            }

            public struct Step2Data: Equatable {
                public var returnCodeMac: Bytes
            }

            public struct Step3Data: Equatable {
                public var nonce: Bytes
                public var encAuthToken: Bytes
            }

            public struct Step4Data: Equatable {
                public var data: String?
            }

            /// 0 is JSON, anything else a raw string.
            public var type: Int8 = 0
            /// 0 when the JSON carries none of the three step markers; 1 isoSalt, 2 returnCodeMac, 3 encAuthToken, 4 the final message.
            public var step: Int8 = 0
            public var errorCode: Int = 0
            public var step1Data: Step1Data?
            public var step2Data: Step2Data?
            public var step3Data: Step3Data?
            public var step4Data: Step4Data?

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "HiChain")
                // Classic Huawei HiChain framing: tag 0x04 is the type, the JSON is in tag 0x01. The Honor MBB framing (X25519, PAKE,
                // STS) is not ported.
                guard tlv.contains(0x04) else { throw PacketError.json("unsupported Honor PAKE framing") }
                try PacketsJava.parsing("HiChain") {
                    type = try tlv.byte(0x04)
                    if type == 0x00 {
                        try parseHiChainJsonPayload(try tlv.string(0x01))
                    } else {
                        step = 0x04
                        step4Data = Step4Data(data: tlv.contains(0x01) ? try tlv.string(0x01) : nil)
                    }
                }
            }

            private mutating func parseHiChainJsonPayload(_ json: String) throws {
                let payload = try Response.parseJsonEnvelope(json, errorCode: &errorCode)
                func string(_ key: String) throws -> String {
                    guard let s = payload[key] as? String else { throw PacketError.json("JSONObject[\"\(key)\"] is not a string") }
                    return s
                }
                if payload["isoSalt"] != nil {
                    step = 0x01
                    let isoSalt = try PacketsJava.hexBytes(try string("isoSalt"), "HiChain")
                    let peerAuthId = try PacketsJava.hexBytes(try string("peerAuthId"), "HiChain")
                    let peerUserType = try Response.int(payload, "peerUserType")
                    let token = try PacketsJava.hexBytes(try string("token"), "HiChain")
                    step1Data = Step1Data(isoSalt: isoSalt, peerAuthId: peerAuthId, peerUserType: peerUserType, token: token)
                } else if payload["returnCodeMac"] != nil {
                    step = 0x02
                    step2Data = Step2Data(returnCodeMac: try PacketsJava.hexBytes(try string("returnCodeMac"), "HiChain"))
                } else if payload["encAuthToken"] != nil {
                    step = 0x03
                    let nonce = try PacketsJava.hexBytes(try string("nonce"), "HiChain")
                    step3Data = Step3Data(nonce: nonce, encAuthToken: try PacketsJava.hexBytes(try string("encAuthToken"), "HiChain"))
                }
            }

            /// `{message, payload, errorCode}`: sets `errorCode` and returns the payload. org.json (Android) reads the first JSON value of
            /// the text and ignores whatever follows; the watch ends its JSON with a NUL byte, which Foundation would reject.
            private static func parseJsonEnvelope(_ json: String, errorCode: inout Int) throws -> [String: Any] {
                guard let data = HiChainJSON.firstObjectText(json).data(using: .utf8),
                      let value = (try? JSONSerialization.jsonObject(with: data, options: [])) as? [String: Any]
                else { throw PacketError.json("Value \(json.prefix(40)) of type String cannot be converted to JSONObject") }
                guard let payload = value["payload"] as? [String: Any] else {
                    throw PacketError.json("No value for payload")
                }
                if payload["errorCode"] != nil { errorCode = try int(payload, "errorCode") }
                return payload
            }

            /// `JSONObject.getInt`: a number (truncated like `Number.intValue()`) or a string holding one.
            private static func int(_ object: [String: Any], _ key: String) throws -> Int {
                func clamp(_ d: Double) -> Int { Int(max(min(d.rounded(.towardZero), Double(Int32.max)), Double(Int32.min))) }
                switch object[key] {
                case let n as NSNumber:
                    let d = n.doubleValue
                    if d.isNaN { return 0 }
                    if abs(d) < 9.0e18, d == d.rounded() { return Int(Int32(truncatingIfNeeded: n.int64Value)) }
                    return clamp(d)
                case let s as String:
                    let trimmed = s.trimmingCharacters(in: .whitespaces)
                    if let i = Int(trimmed) { return Int(Int32(truncatingIfNeeded: i)) }
                    if let d = Double(trimmed) { return clamp(d) }
                    throw PacketError.json("Value \(s) at \(key) of type String cannot be converted to int")
                default:
                    throw PacketError.json("JSONObject[\"\(key)\"] is not an int")
                }
            }
        }
    }

    // MARK: AcceptAgreement

    public enum AcceptAgreement {
        public static let id: UInt8 = 0x30

        /// The three agreements the Java request carries, each stamped with the current time in milliseconds.
        public static func request(timestampMillis: Int64 = Int64((Date().timeIntervalSince1970 * 1000).rounded(.down))) -> HuaweiPacket {
            let stamp = String(timestampMillis)
            func agreement(_ name: String) -> HuaweiTLV {
                var t = HuaweiTLV()
                t.put(0x03, string: name)
                t.put(0x04, byte: 0x01)
                t.put(0x05, string: "20230508-20230508-0-0")
                t.put(0x06, string: stamp)
                return t
            }
            var list = HuaweiTLV()
            list.put(0x82, tlv: agreement("software_update_service_statement"))
            list.put(0x82, tlv: agreement("device_information_management"))
            list.put(0x82, tlv: agreement("user_license_agreement"))
            var tlv = HuaweiTLV()
            tlv.put(0x81, tlv: list)
            return HuaweiPacket(serviceId: DeviceConfig.id, commandId: id, tlv: tlv)
        }
    }

    // MARK: SettingRelated

    public enum SettingRelated {
        public static let id: UInt8 = 0x31

        public static func request() -> HuaweiPacket {
            var tlv = HuaweiTLV()
            for tag in 0x01...0x06 { tlv.put(tag) }
            return HuaweiPacket(serviceId: DeviceConfig.id, commandId: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            public var truSleepNewSync = false
            public var rriNewSync = false
            public var gpsNewSync = false

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "SettingRelated")
                try PacketsJava.parsing("SettingRelated") {
                    // Tag 1 is the legal stuff; tag 2 is a bitmap of the file support
                    if tlv.contains(0x02) {
                        let value = try tlv.byte(0x02)
                        truSleepNewSync = (value & 2) != 0
                        rriNewSync = (value & 4) != 0
                        gpsNewSync = (value & 8) != 0
                    }
                }
            }
        }
    }

    // MARK: SecurityNegotiation

    public enum SecurityNegotiation {
        public static let id: UInt8 = 0x33

        /// The non-Honor request. `authMode` 4 (deviceSupportType 4) also sends the phone model as tag 0x07.
        public static func request(params: ParamsProvider, authMode: UInt8, deviceUUID: Bytes, phoneModel: String?) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, byte: authMode)
            if authMode == 0x02 || authMode == 0x04 { tlv.put(0x02, byte: 0x01) } // force "not reconnected"
            tlv.put(0x05, bytes: deviceUUID)
            tlv.put(0x03, byte: 0x01)
            tlv.put(0x04, byte: 0x00)
            if authMode == 0x04 {
                tlv.put(0x06)
                tlv.put(0x07, string: phoneModel)
            }
            if params.encryptMethod == 1 { tlv.put(0xd, byte: 0x1) }
            return HuaweiPacket(serviceId: DeviceConfig.id, commandId: id, tlv: tlv, isEncrypted: false)
        }

        public struct Response: PacketResponse {
            /// 0x0186A0 for tag 0x01 = 1; with tag 0x01 = 4 and tag 0x02 = pairType the watch says whether it knows our authId
            /// (`pairType ^ 4`: 6 known, 5 new); tag 0x7F overrides. -1 when the watch sends none.
            public var authType: Int = -1
            /// Tag 0x02 as a signed byte; -1 when absent.
            public var honorPairType: Int = -1
            public var responseNonce: Bytes?

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "SecurityNegotiation")
                try PacketsJava.parsing("SecurityNegotiation") {
                    var pw = -0x1
                    if tlv.contains(0x01) {
                        if try tlv.byte(0x01) == 0x01 { authType = 0x0186A0 }
                        if try tlv.byte(0x01) == 0x04 { pw = 4 }
                    }
                    if tlv.contains(0x02) {
                        honorPairType = Int(try tlv.byte(0x02))
                        authType = Int(try tlv.byte(0x02))
                        if pw != -0x1 { authType ^= pw }
                    }
                    if tlv.contains(0x7F) { authType = Int(try tlv.byte(0x7F)) }
                    if tlv.contains(0x03) { responseNonce = try tlv.bytes(0x03) }
                }
            }
        }
    }

    // MARK: ConnectStatus, ExpandCapability, WearStatus, SetUpDeviceStatus, ReverseCapabilities

    public enum ConnectStatusRequest {
        public static let id: UInt8 = 0x35

        public static func request() -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, byte: 0x01)
            return HuaweiPacket(serviceId: DeviceConfig.id, commandId: id, tlv: tlv)
        }
    }

    public enum ExpandCapability {
        public static let id: UInt8 = 0x37

        public static func request() -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01)
            return HuaweiPacket(serviceId: DeviceConfig.id, commandId: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            public var expandCapabilities: Bytes?

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "ExpandCapability")
                try PacketsJava.parsing("ExpandCapability") {
                    if tlv.contains(0x01) { expandCapabilities = try tlv.bytes(0x01) }
                }
            }
        }
    }

    public enum WearStatus {
        public static let id: UInt8 = 0x3D

        public static func request() -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01)
            return HuaweiPacket(serviceId: DeviceConfig.id, commandId: id, tlv: tlv)
        }

        /// The Java response reads nothing.
        public struct Response: PacketResponse {
            public init(packet: HuaweiPacket) throws {}
        }
    }

    public enum SetUpDeviceStatusRequest {
        public static let id: UInt8 = 0x3E

        /// `relationShip` is cast to a Java byte.
        public static func request(relationShip: Int, deviceName: String) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, byte: UInt8(truncatingIfNeeded: relationShip))
            tlv.put(0x02, string: deviceName)
            tlv.put(0x03, byte: 0x00)
            return HuaweiPacket(serviceId: DeviceConfig.id, commandId: id, tlv: tlv)
        }
    }

    public enum ReverseCapabilities {
        public static let id: UInt8 = 0x3F

        /// JoyoFit: Huawei Health 17.0.8.300's own bitmap for this watch (GB's bits plus 22, 43 and 47..59; GB sent `FD F7 33 FA 29 37`).
        public static let capabilities: Bytes = [0xFD, 0xF7, 0x73, 0xFA, 0x29, 0xBF, 0xFF, 0x0F]

        public static func request() -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, bytes: capabilities)
            return HuaweiPacket(serviceId: DeviceConfig.id, commandId: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            public init(packet: HuaweiPacket) throws {}
        }
    }

    /// The watch asks for the phone's details (01/10, GB `PhoneInfo`): it pushes the tags it wants, empty, and the phone answers with
    /// the same tags filled in; the watch then acknowledges (tag 7F = 100000). Tag meanings from GB and from Huawei Health 15.1.4
    /// (`kjk.getHandsetInfo`, `kjs`): 02 manufacturer, 04 model, 08 OS version, 0D the phone's platform (Huawei Health on Android
    /// always sends 2; JoyoFit on iOS sends 1, an inference: the band's Remote shutter showed the Android flow while this was unanswered),
    /// 0E always 1 in Huawei Health, 11 app version, 15 OS platform version, 16 phone capability bits.
    public enum PhoneInfo {
        public static let id: UInt8 = 0x10
        /// Tag 0D as Huawei Health on Android sends it.
        public static let platformAndroid: UInt8 = 2
        /// Tag 0D for an iPhone (inferred, see above).
        public static let platformIos: UInt8 = 1

        /// The watch's acknowledgement of an answer (only tag 7F = 100000), which needs no reply.
        public static func isAck(_ tlv: HuaweiTLV) -> Bool {
            tlv.entries.count == 1 && tlv.contains(0x7F) && tlv.int(0x7F, default: 0) == 100_000
        }

        /// The tags the watch asked for, in its order.
        public static func requestedTags(_ tlv: HuaweiTLV) -> [UInt8] { tlv.entries.map(\.tag) }

        /// GB's answer (empty manufacturer and model, zero for unknown tags, app version 16.1.3.320) with this phone's platform and
        /// OS version.
        public static func reply(tags: [UInt8], platform: UInt8, manufacturer: String, model: String, osVersion: String) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            for tag in tags {
                let t = Int(tag)
                switch tag {
                case 0x00, 0x0F: break
                case 0x02: tlv.put(t, string: manufacturer)
                case 0x04: tlv.put(t, string: model)
                case 0x08: tlv.put(t, string: osVersion)
                case 0x0D: tlv.put(t, byte: platform)
                case 0x0E: tlv.put(t, byte: 1)
                case 0x11: tlv.put(t, int: 1_600_103_320)
                case 0x15: tlv.put(t)
                default: tlv.put(t, byte: 0)
                }
            }
            return HuaweiPacket(serviceId: DeviceConfig.id, commandId: id, tlv: tlv)
        }
    }
}

// MARK: - HiChain JSON text

/// An insertion-ordered JSON object rendered like Android's `org.json.JSONObject.toString()`: members in the order they were first
/// put, no whitespace, `/` escaped as `\/`.
struct HiChainJSON {
    indirect enum Value {
        case int(Int)
        case string(String)
        case bool(Bool)
        case object(HiChainJSON)
    }

    private var members: [(key: String, value: Value)] = []

    /// A second put of a key replaces the value and keeps the first position (LinkedHashMap).
    mutating func put(_ key: String, _ value: Value) {
        if let index = members.firstIndex(where: { $0.key == key }) {
            members[index].value = value
        } else {
            members.append((key, value))
        }
    }

    func render() -> String {
        var out = "{"
        for (index, member) in members.enumerated() {
            if index > 0 { out += "," }
            out += HiChainJSON.quote(member.key) + ":"
            switch member.value {
            case .int(let i): out += String(i)
            case .bool(let b): out += b ? "true" : "false"
            case .string(let s): out += HiChainJSON.quote(s)
            case .object(let o): out += o.render()
            }
        }
        return out + "}"
    }

    /// `JSONStringer.string`: `"`, `\` and `/` get a backslash, the common control characters their short escapes, the rest below 0x20 `\u00xx`.
    static func quote(_ s: String) -> String {
        var out = "\""
        for scalar in s.unicodeScalars {
            switch scalar {
            case "\"", "\\", "/": out += "\\" + String(scalar)
            case "\t": out += "\\t"
            case "\u{8}": out += "\\b"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\u{c}": out += "\\f"
            default:
                if scalar.value <= 0x1F { out += String(format: "\\u%04x", scalar.value) } else { out.unicodeScalars.append(scalar) }
            }
        }
        return out + "\""
    }

    /// The text of the first top-level JSON object: org.json's tokener stops after the first value, so bytes after the closing brace (the
    /// watch's trailing NUL) are not part of it. Returns `json` unchanged when it does not start with an object or never closes it.
    static func firstObjectText(_ json: String) -> String {
        let scalars = Array(json.unicodeScalars)
        guard let start = scalars.firstIndex(where: { !($0 == " " || $0 == "\n" || $0 == "\t" || $0 == "\r") }), scalars[start] == "{" else {
            return json
        }
        var depth = 0
        var inString = false
        var escaped = false
        for index in start..<scalars.count {
            let c = scalars[index]
            if inString {
                if escaped { escaped = false } else if c == "\\" { escaped = true } else if c == "\"" { inString = false }
                continue
            }
            if c == "\"" { inString = true } else if c == "{" { depth += 1 } else if c == "}" {
                depth -= 1
                if depth == 0 {
                    var out = String.UnicodeScalarView()
                    out.append(contentsOf: scalars[start...index])
                    return String(out)
                }
            }
        }
        return json
    }
}
