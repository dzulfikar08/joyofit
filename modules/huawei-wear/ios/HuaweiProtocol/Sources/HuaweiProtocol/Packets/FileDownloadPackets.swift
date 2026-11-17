// Port of FileDownloadService2C.java and FileDownloadService0A.java (Gadgetbridge, AGPL-3.0-or-later): the packets of the two file
// download services. 0x2C is the newer one (init, hash, info, block request, complete); 0x0A the older one (init with a file list,
// parameters, info, block request). The data blocks of both (0x2C/0x05 and 0x0A/0x05) arrive as `HuaweiPacket.payload` without TLV.
//
// Java mapping: every `Request` class becomes a `static func request(...) -> HuaweiPacket` with the same service/command, TLV and
// `isEncrypted` as the Java constructor (isSliced stays at the Java default, true); every `Response` class a `struct Response:
// PacketResponse` over `packet.tlv`. The two `BlockResponse` classes need the link parameters (they decrypt a raw payload), so they
// are built with `init(packet:params:)` instead.
import Foundation

/// Reading a file data block: a Java runtime exception where GB would not catch one, so the packet is not usable.
private let fileDataNoPayload = SleepFilesParseError.missingInput("file data packet has no payload")

extension HuaweiTLV {
    /// `HuaweiTLV.decryptRaw(paramsProvider)`: the plain bytes behind a `{0x7D: iv, 0x7E: cipher}` element pair, not parsed as TLV.
    /// Throws `TLVError.missingTag` (Java `MissingTagException`) or `PacketError.crypto` (`CryptoException`).
    func fileDownloadDecryptRaw(params: ParamsProvider) throws -> Bytes {
        let cipher = try bytes(HuaweiTLV.tagCipherText)
        let iv = try bytes(HuaweiTLV.tagInitVector)
        guard let key = params.secretKey else { throw PacketError.crypto("Decrypt exception: no secret key") }
        do {
            return try HuaweiCrypto.decrypt(useGCM: params.useGCM, message: cipher, key: key, iv: iv)
        } catch {
            throw PacketError.crypto("Decrypt exception: \(error)")
        }
    }
}


private func fileDownloadPacket(service: UInt8, command: UInt8, tlv: HuaweiTLV?, encrypted: Bool = true) -> HuaweiPacket {
    HuaweiPacket(serviceId: service, commandId: command, tlv: tlv, isEncrypted: encrypted, isSliced: true, complete: true)
}

/// `String.split(";")` as Java does it: trailing empty strings are dropped, a string without a separator is returned whole (also "").
func javaSplitSemicolon(_ s: String) -> [String] {
    if !s.contains(";") { return [s] }
    var parts = s.split(separator: ";", omittingEmptySubsequences: false).map(String.init)
    while let last = parts.last, last.isEmpty { parts.removeLast() }
    return parts
}

// MARK: - Service 0x2C

public enum FileDownloadService2C {
    public static let id: UInt8 = 0x2c

    /// `FileDownloadService2C.FileType`. `.unknown` is never valid as input.
    public enum FileType: Equatable, Sendable {
        case sleepState, sleepData, rri, gps, pdr, sequenceData, ecgAnalysisData, unknown

        /// `fileTypeToByte`; nil where Java throws a RuntimeException (`.unknown`).
        public var wireByte: UInt8? {
            switch self {
            case .sleepState: return 0x0e
            case .sleepData: return 0x0f
            case .rri: return 0x10
            case .gps: return 0x11
            case .pdr: return 0x12
            case .sequenceData: return 0x16
            case .ecgAnalysisData: return 0x18
            case .unknown: return nil
            }
        }

        /// `byteToFileType`: any other byte is `.unknown`.
        public static func fromWire(_ b: UInt8) -> FileType {
            switch b {
            case 0x0e: return .sleepState
            case 0x0f: return .sleepData
            case 0x10: return .rri
            case 0x11: return .gps
            case 0x12: return .pdr
            case 0x16: return .sequenceData
            case 0x18: return .ecgAnalysisData
            default: return .unknown
            }
        }

        /// Java enum constant name, for logs and golden files.
        public var name: String {
            switch self {
            case .sleepState: return "SLEEP_STATE"
            case .sleepData: return "SLEEP_DATA"
            case .rri: return "RRI"
            case .gps: return "GPS"
            case .pdr: return "PDR"
            case .sequenceData: return "SEQUENCE_DATA"
            case .ecgAnalysisData: return "ECG_ANALYSIS_DATA"
            case .unknown: return "UNKNOWN"
            }
        }
    }

    public enum FileDownloadInit {
        public static let id: UInt8 = 0x01

        /// `FileDownloadInit.Request`. `fileType == .unknown` throws as the Java constructor's RuntimeException does.
        public static func request(filename: String, fileType: FileType, startTime: Int32, endTime: Int32, dictId: Int32) throws -> HuaweiPacket {
            guard let fileId = fileType.wireByte else { throw PacketError.serialize("FileDownloadInit: file type \(fileType.name) cannot be requested") }
            var tlv = HuaweiTLV()
            tlv.put(0x01, string: filename)
            tlv.put(0x02, byte: fileId)
            tlv.put(0x05, int: startTime)
            tlv.put(0x06, int: endTime)
            if dictId > 0 && fileId == 0x16 { // SEQUENCE_DATA
                tlv.put(0x0c, int: dictId)
            }
            return fileDownloadPacket(service: FileDownloadService2C.id, command: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            public let fileName: String
            public let fileType: FileType
            public let fileId: UInt8
            public let fileSize: Int32

            public init(packet: HuaweiPacket) throws {
                guard let tlv = packet.tlv else { throw TLVError.missingTag(0x01) }
                fileName = try tlv.string(0x01)
                fileType = FileType.fromWire(UInt8(bitPattern: try tlv.byte(0x02)))
                fileId = UInt8(bitPattern: try tlv.byte(0x03))
                fileSize = try tlv.int(0x04)
            }
        }
    }

    public enum FileRequestHash {
        public static let id: UInt8 = 0x02

        public static func request(fileId: UInt8) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, byte: fileId)
            tlv.put(0x02, byte: 0x01)
            return fileDownloadPacket(service: FileDownloadService2C.id, command: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            public let fileId: UInt8
            public let fileHash: Bytes

            public init(packet: HuaweiPacket) throws {
                guard let tlv = packet.tlv else { throw TLVError.missingTag(0x01) }
                fileId = UInt8(bitPattern: try tlv.byte(0x01))
                fileHash = try tlv.bytes(0x03)
            }
        }
    }

    public enum FileInfo {
        public static let id: UInt8 = 0x03

        public static func request(fileId: UInt8) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, byte: fileId)
            tlv.put(0x02)
            tlv.put(0x03)
            tlv.put(0x04)
            tlv.put(0x05)
            return fileDownloadPacket(service: FileDownloadService2C.id, command: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            public let fileId: UInt8
            /// Seconds, probably (the Java marks the unit as unknown).
            public let timeout: UInt8
            /// How large each 0x2C/0x05 packet will be.
            public let burstSize: Int16
            /// How much can be asked for before the next block request.
            public let maxBlockSize: Int32
            /// True if the block request cannot be encrypted.
            public let noEncrypt: Bool

            public init(packet: HuaweiPacket) throws {
                guard let tlv = packet.tlv else { throw TLVError.missingTag(0x01) }
                fileId = UInt8(bitPattern: try tlv.byte(0x01))
                timeout = UInt8(bitPattern: try tlv.byte(0x02))
                burstSize = try tlv.short(0x03)
                maxBlockSize = try tlv.int(0x04)
                noEncrypt = try tlv.bool(0x05)
            }
        }
    }

    public enum RequestBlock {
        public static let id: UInt8 = 0x04

        /// `RequestBlock` constructor. The dictionary id is only sent when the *file id* is 0x16, as GB compares it (the Java names
        /// the check SEQUENCE_DATA but tests the file id, not the file type).
        public static func request(fileId: UInt8, offset: Int32, size: Int32, noEncrypt: Bool, dictId: Int32) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, byte: fileId)
            tlv.put(0x02, int: offset)
            tlv.put(0x03, int: size)
            if dictId > 0 && fileId == 0x16 {
                tlv.put(0x04, int: dictId)
            }
            return fileDownloadPacket(service: FileDownloadService2C.id, command: id, tlv: tlv, encrypted: !noEncrypt)
        }
    }

    /// One pushed data packet (0x2C/0x05). The payload is `[0x2C, 0x05, ...]`; it is either `7C 01 01 ...` (an encrypted TLV whose
    /// plain text holds the fields) or the fields themselves.
    public struct BlockResponse {
        public static let id: UInt8 = 0x05

        public let fileId: UInt8
        public let offset: Int32
        public let unknown: UInt8
        public let data: Bytes

        public init(packet: HuaweiPacket, params: ParamsProvider) throws {
            guard let payload = packet.payload else { throw fileDataNoPayload }
            guard payload.count >= 5 else { throw SleepFilesParseError.payloadTooShort(have: payload.count, need: 5) }
            var buffer: SleepFilesByteBuffer
            if payload[2] == 0x7c && payload[3] == 0x01 && payload[4] == 0x01 {
                // Encrypted TLV, so decrypt first.
                let tlv: HuaweiTLV
                do {
                    tlv = try HuaweiTLV(parsing: payload, offset: 2, length: payload.count - 2)
                } catch let TLVError.malformed(message) {
                    throw SleepFilesParseError.malformedTLV(message)
                }
                do {
                    buffer = SleepFilesByteBuffer(try tlv.fileDownloadDecryptRaw(params: params))
                } catch PacketError.crypto(let message) {
                    throw PacketError.crypto("File download decryption exception: \(message)")
                }
            } else {
                buffer = SleepFilesByteBuffer(payload, position: 2)
            }
            fileId = UInt8(bitPattern: try buffer.get())
            offset = try buffer.getInt()
            unknown = UInt8(bitPattern: try buffer.get())
            data = try buffer.get(count: buffer.remaining)
        }
    }

    public enum FileDownloadCompleteRequest {
        public static let id: UInt8 = 0x06

        public static func request(fileId: UInt8, status: UInt8) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, byte: fileId)
            tlv.put(0x02, byte: status)
            return fileDownloadPacket(service: FileDownloadService2C.id, command: id, tlv: tlv)
        }
    }

    public enum IncomingInitRequest {
        public static let id: UInt8 = 0x07

        public static func request(
            filename: String, fileType: UInt8, fileId: UInt8, fileSize: Int32,
            srcPackage: String?, dstPackage: String?, srcFingerprint: String?, dstFingerprint: String?, status: UInt8
        ) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, string: filename)
            tlv.put(0x02, byte: fileType)
            tlv.put(0x03, byte: fileId)
            tlv.put(0x04, int: fileSize)
            if srcPackage != nil && dstPackage != nil {
                tlv.put(0x08, string: srcPackage)
                tlv.put(0x09, string: dstPackage)
                tlv.put(0x0a, string: srcFingerprint)
                tlv.put(0x0b, string: dstFingerprint)
            }
            tlv.put(0x0d, byte: status)
            return fileDownloadPacket(service: FileDownloadService2C.id, command: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            public let filename: String
            public let fileType: UInt8
            public let fileId: UInt8
            public let fileSize: Int32
            public let description: String
            public let srcPackage: String
            public let dstPackage: String
            public let srcFingerprint: String?
            public let dstFingerprint: String?

            public init(packet: HuaweiPacket) throws {
                guard let tlv = packet.tlv else { throw TLVError.missingTag(0x01) }
                filename = try tlv.string(0x01)
                fileType = UInt8(bitPattern: try tlv.byte(0x02))
                fileId = UInt8(bitPattern: try tlv.byte(0x03))
                fileSize = try tlv.asInteger(0x04)
                description = try tlv.string(0x07)
                srcPackage = try tlv.string(0x08)
                dstPackage = try tlv.string(0x09)
                srcFingerprint = try tlv.contains(0x0a) ? tlv.string(0x0a) : nil
                dstFingerprint = try tlv.contains(0x0b) ? tlv.string(0x0b) : nil
            }
        }
    }
}

// MARK: - Service 0x0A

public enum FileDownloadService0A {
    public static let id: UInt8 = 0x0a

    public enum FileDownloadInit {
        public static let id: UInt8 = 0x01

        public static func debugFilesRequest() -> HuaweiPacket {
            fileDownloadPacket(service: FileDownloadService0A.id, command: id, tlv: HuaweiTLV())
        }

        public static func sleepFilesRequest(startTime: Int32, endTime: Int32) -> HuaweiPacket {
            var inner = HuaweiTLV()
            inner.put(0x04, int: startTime)
            inner.put(0x05, int: endTime)
            var tlv = HuaweiTLV()
            tlv.put(0x02, byte: 0x01)
            tlv.put(0x83, tlv: inner)
            return fileDownloadPacket(service: FileDownloadService0A.id, command: id, tlv: tlv)
        }

        public static func gpsFileRequest(workoutId: Int16) -> HuaweiPacket {
            var workout = HuaweiTLV()
            workout.put(0x09, short: workoutId)
            var inner = HuaweiTLV()
            inner.put(0x07, byte: 0x01) // might be the type
            inner.put(0x88, tlv: workout)
            var tlv = HuaweiTLV()
            tlv.put(0x02, byte: 0x02)
            tlv.put(0x86, tlv: inner)
            return fileDownloadPacket(service: FileDownloadService0A.id, command: id, tlv: tlv)
        }

        public static func rriFileRequest(startTime: Int32, endTime: Int32) -> HuaweiPacket {
            var inner = HuaweiTLV()
            inner.put(0x10, int: startTime)
            inner.put(0x11, int: endTime)
            var tlv = HuaweiTLV()
            tlv.put(0x02, byte: 0x04)
            tlv.put(0x8f, tlv: inner)
            return fileDownloadPacket(service: FileDownloadService0A.id, command: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            public let fileNames: [String]

            public init(packet: HuaweiPacket) throws {
                guard let tlv = packet.tlv else { throw TLVError.missingTag(0x01) }
                let possibleNames: String
                if tlv.contains(0x01) {
                    possibleNames = try tlv.string(0x01)
                } else { // GPS: also has the workout id (0x09) and another tag (0x0e)
                    possibleNames = try tlv.object(0x8b).object(0x8c).string(0x0d)
                }
                fileNames = javaSplitSemicolon(possibleNames)
            }
        }
    }

    public enum FileParameters {
        public static let id: UInt8 = 0x02

        /// `fileType` 0 (debug files) sends no TLV at all; 2 (GPS) adds tag 0x07.
        public static func request(fileType: UInt8) -> HuaweiPacket {
            var tlv: HuaweiTLV?
            if fileType != 0x0 {
                var t = HuaweiTLV()
                t.put(0x06, byte: fileType)
                if fileType == 0x02 { t.put(0x07, byte: 0x03) }
                tlv = t
            }
            return fileDownloadPacket(service: FileDownloadService0A.id, command: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            public let version: String
            public let unknown: Bool
            public let packetSize: Int16
            /// A signed Java short: 0x8000 and above read as negative.
            public let maxBlockSize: Int16
            public let timeout: Int16

            public init(packet: HuaweiPacket) throws {
                guard let tlv = packet.tlv else { throw TLVError.missingTag(0x01) }
                version = try tlv.string(0x01)
                unknown = try tlv.bool(0x02)
                packetSize = try tlv.short(0x03)
                maxBlockSize = try tlv.short(0x04)
                timeout = try tlv.short(0x05)
            }
        }
    }

    public enum FileInfo {
        public static let id: UInt8 = 0x03

        public static func request(fileName: String) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, string: fileName)
            return fileDownloadPacket(service: FileDownloadService0A.id, command: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            public let fileLength: Int32
            public let transferType: Int8
            public let fileCreateTime: Int32
            public let unknown: Int8

            public init(packet: HuaweiPacket) throws {
                guard let tlv = packet.tlv else { throw TLVError.missingTag(0x02) }
                var fileLength: Int32 = 0
                var transferType: Int8 = -1
                var fileCreateTime: Int32 = -1
                var unknown: Int8 = -1
                if tlv.contains(0x02) { fileLength = try tlv.int(0x02) }
                if tlv.contains(0x04) { transferType = try tlv.byte(0x04) }
                if tlv.contains(0x05) { fileCreateTime = try tlv.int(0x05) }
                if tlv.contains(0x06) { unknown = try tlv.byte(0x06) }
                self.fileLength = fileLength
                self.transferType = transferType
                self.fileCreateTime = fileCreateTime
                self.unknown = unknown
            }
        }
    }

    public enum RequestBlock {
        public static let id: UInt8 = 0x04

        public static func request(fileName: String, offset: Int32, size: Int32) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, string: fileName)
            tlv.put(0x02, int: offset)
            tlv.put(0x03, int: size)
            return fileDownloadPacket(service: FileDownloadService0A.id, command: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            public let isOk: Bool
            public let filename: String?
            public let offset: Int32

            public init(packet: HuaweiPacket) throws {
                guard let tlv = packet.tlv else { throw TLVError.missingTag(0x7f) }
                isOk = try tlv.int(0x7f) == 0x0001_86A0
                var filename: String?
                var offset: Int32 = 0
                if isOk {
                    if tlv.contains(0x01) { filename = try tlv.string(0x01) }
                    if tlv.contains(0x02) { offset = try tlv.int(0x02) }
                }
                self.filename = filename
                self.offset = offset
            }
        }
    }

    /// Why a 0x0A data block could not be taken as encrypted (`BlockResponse.e`).
    public enum BlockDecodeError: Error, Equatable, CustomStringConvertible {
        /// The body did not parse as TLV (Java ArrayIndexOutOfBoundsException), or parsed without the cipher elements (Java
        /// MissingTagException): the data is not encrypted.
        case notTLV(String)
        /// It parsed as TLV but could not be decrypted (Java `CryptoException`).
        case crypto(String)

        public var description: String {
            switch self {
            case .notTLV(let m): return m
            case .crypto(let m): return m
            }
        }
    }

    /// One pushed data packet (0x0A/0x05): a packet number byte and the data, either behind `7D/7E` (encrypted TLV) or as is.
    public struct BlockResponse {
        public static let id: UInt8 = 0x05

        public let number: UInt8
        public let data: Bytes
        /// Set when the payload was taken as unencrypted data because it was not (decryptable) TLV.
        public let decodeError: BlockDecodeError?

        public init(packet: HuaweiPacket, params: ParamsProvider) throws {
            guard var payload = packet.payload else { throw fileDataNoPayload }
            var offset = 0
            var decodeError: BlockDecodeError?
            // Try to decrypt the TLV, otherwise assume the data is not encrypted. A TLV without the cipher elements is not encrypted
            // either: GB let that MissingTagException fail the whole file, the JoyoFit Java takes it as raw data like this (HONOR Watch
            // ES rrisqi_data.bin, "Missing tag: 7e", JRG-487/488).
            do {
                let tlv: HuaweiTLV
                do {
                    tlv = try HuaweiTLV(parsing: payload, offset: 2, length: payload.count - 2)
                } catch let TLVError.malformed(message) {
                    throw BlockDecodeError.notTLV(message)
                }
                do {
                    payload = try tlv.fileDownloadDecryptRaw(params: params)
                } catch PacketError.crypto(let message) {
                    throw BlockDecodeError.crypto(message)
                } catch TLVError.missingTag(let tag) {
                    throw BlockDecodeError.notTLV("Missing tag: \(String(tag, radix: 16))")
                }
                offset = 0
            } catch let e as BlockDecodeError {
                decodeError = e
                offset = 2
            }
            guard offset < payload.count else { throw SleepFilesParseError.payloadTooShort(have: payload.count, need: offset + 1) }
            number = payload[offset]
            data = Array(payload[(offset + 1)...])
            self.decodeError = decodeError
        }
    }

    public enum FileDownloadCompleteRequest {
        public static let id: UInt8 = 0x06

        public static func request() -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x06, bool: true)
            return fileDownloadPacket(service: FileDownloadService0A.id, command: id, tlv: tlv)
        }
    }
}
