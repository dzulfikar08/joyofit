// Port of Watchface.java (Gadgetbridge, AGPL-3.0-or-later; as modified for watch-fit: WatchfaceOperation.Response and
// WatchfaceParams.Response read the extra tags Huawei Health uses): the packets of service 0x27, the watch face list and operations.
//
// Java mapping: every `Request` class becomes a `static func request(...) -> HuaweiPacket` with the same service/command, TLV and
// flags as the Java constructor (isEncrypted and isSliced stay at their Java default, true); every `Response` class a `struct Response:
// PacketResponse` over `packet.tlv`.
import Foundation

public enum Watchface {
    public static let id: UInt8 = 0x27

    /// `Watchface.WatchfaceDeviceParams`.
    public struct WatchfaceDeviceParams: Equatable, Sendable {
        public var maxVersion = ""
        public var width: Int32 = 0
        public var height: Int32 = 0
        public var supportFileType: Int8 = 1
        public var sort: Int8 = 1
        public var otherWatchfaceVersions = ""
        /// Tag 0x11 (Huawei Health `supportCapability`), -1 when the watch did not send it. Bit 2 (value 4) dial unite, bit 3 (8) signature.
        public var supportCapability: Int32 = -1
        /// Tag 0x17, -1 when absent.
        public var supportSync: Int32 = -1
        /// Tag 0x18 (0 = GT mode, 1 = AP mode), -1 when absent.
        public var mode: Int32 = -1
        /// Tag 0x1a (Huawei Health `supportGaussianColor`), -1 when absent.
        public var gaussianColor: Int32 = -1
        /// Tag 0x1b (Huawei Health `supportAestheticAlbumColor`; 1 = a photo's time colour is picked from the photo), -1 when absent.
        public var aestheticAlbumColor: Int32 = -1
        /// Tag 0x7f, -1 when absent.
        public var status: Int32 = -1

        public init() {}
    }

    /// `Watchface.InstalledWatchfaceInfo`: one entry of the watch's face list.
    public struct InstalledWatchfaceInfo: Equatable, Sendable {
        public let fileName: String
        public let version: String
        /// bit 0 current, 1 factory preset, 2 ???, 3 editable, 4 video, 5 photo, 6 tryout (trial), 7 kaleidoscope.
        public let type: Int8
        public let expandedType: Int8

        public init(fileName: String, version: String, type: Int8, expandedType: Int8 = 0) {
            self.fileName = fileName
            self.version = version
            self.type = type
            self.expandedType = expandedType
        }

        /// `new InstalledWatchfaceInfo(tlv)`; throws the way the Java constructor does (a missing tag, an empty byte).
        public init(tlv: HuaweiTLV) throws {
            fileName = try tlv.string(0x03)
            version = try tlv.string(0x04)
            type = try tlv.byte(0x05)
            expandedType = tlv.contains(0x07) ? try tlv.byte(0x07) : 0 // optional
        }

        public var isCurrent: Bool { type & 1 == 1 }
        public var isFactory: Bool { (type >> 1) & 1 == 1 }
        public var isEditable: Bool { (type >> 3) & 1 == 1 }
        public var isVideo: Bool { (type >> 4) & 1 == 1 }
        public var isPhoto: Bool { (type >> 5) & 1 == 1 }
        public var isTryout: Bool { (type >> 6) & 1 == 1 }
        public var isKaleidoscope: Bool { (type >> 7) & 1 == 1 }
    }

    public enum WatchfaceParams {
        public static let id: UInt8 = 0x01

        public static func request() -> HuaweiPacket {
            var tlv = HuaweiTLV()
            for tag in [0x01, 0x02, 0x03, 0x04, 0x05, 0x0e, 0x0f] { tlv.put(tag) }
            return HuaweiPacket(serviceId: Watchface.id, commandId: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            public let params: WatchfaceDeviceParams

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "WatchfaceParams")
                params = try PacketsJava.parsing("WatchfaceParams") {
                    var p = WatchfaceDeviceParams()
                    p.maxVersion = try tlv.string(0x01)
                    p.width = try tlv.asInteger(0x02)
                    p.height = try tlv.asInteger(0x03)
                    p.supportFileType = try tlv.byte(0x04)
                    p.sort = try tlv.byte(0x05)
                    if tlv.contains(0x06) { p.otherWatchfaceVersions = try tlv.string(0x06) }
                    p.supportCapability = tlv.asInteger(0x11, default: -1)
                    p.supportSync = tlv.asInteger(0x17, default: -1)
                    p.mode = tlv.asInteger(0x18, default: -1)
                    p.gaussianColor = tlv.asInteger(0x1a, default: -1)
                    p.aestheticAlbumColor = tlv.asInteger(0x1b, default: -1)
                    p.status = tlv.asInteger(0x7f, default: -1)
                    return p
                }
            }
        }
    }

    public enum DeviceWatchInfo {
        public static let id: UInt8 = 0x02

        public static func request() -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01)
            tlv.put(0x06, byte: 0x03) // 3 - overseas non-test, 2 - test, 1 - null?
            return HuaweiPacket(serviceId: Watchface.id, commandId: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            public let watchfaceInfoList: [InstalledWatchfaceInfo]

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "WatchfaceList")
                watchfaceInfoList = try PacketsJava.parsing("WatchfaceList") {
                    var list = [InstalledWatchfaceInfo]()
                    if tlv.contains(0x81) {
                        for sub in try tlv.object(0x81).objects(0x82) { list.append(try InstalledWatchfaceInfo(tlv: sub)) }
                    }
                    return list
                }
            }
        }
    }

    public enum WatchfaceOperation {
        public static let id: UInt8 = 0x03
        public static let operationActive: UInt8 = 1
        public static let operationDelete: UInt8 = 2

        /// GB's constructor: `fileName.split("_")[0]` and `[1]`; throws where Java throws ArrayIndexOutOfBounds (no version in the name).
        public static func request(fileName: String, operation: UInt8) throws -> HuaweiPacket {
            let parts = javaSplit(fileName, separator: "_")
            guard parts.count >= 2 else {
                throw PacketError.serialize("WatchfaceOperation: '\(fileName)' is not <id>_<version> (ArrayIndexOutOfBoundsException in GB)")
            }
            var tlv = HuaweiTLV()
            tlv.put(0x01, string: parts[0])
            tlv.put(0x02, string: parts[1])
            tlv.put(0x03, byte: operation)
            return HuaweiPacket(serviceId: Watchface.id, commandId: id, tlv: tlv)
        }

        /// The operation with the id and version given separately, plus Huawei Health's signature in tag 0x08 when there is one.
        public static func request(id faceId: String, version: String, operation: UInt8, signature: String? = nil) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, string: faceId)
            tlv.put(0x02, string: version)
            tlv.put(0x03, byte: operation)
            if let signature { tlv.put(0x08, string: signature) }
            return HuaweiPacket(serviceId: Watchface.id, commandId: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            /// The watch's status in tag 0x7f, or -1 when the answer has none.
            public let code: Int32
            /// Tag 0x04 (Huawei Health `needReceive`): 1 the watch wants the file, 0 it has the face already; -1 when absent.
            public let needReceive: Int32
            /// Tags 0x01 / 0x02, empty when absent.
            public let watchfaceId: String
            public let watchfaceVersion: String

            public init(packet: HuaweiPacket) throws {
                guard let tlv = packet.tlv else {
                    (code, needReceive, watchfaceId, watchfaceVersion) = (-1, -1, "", "")
                    return
                }
                (code, needReceive, watchfaceId, watchfaceVersion) = try PacketsJava.parsing("WatchfaceOperation") {
                    (
                        tlv.asInteger(0x7f, default: -1), tlv.asInteger(0x04, default: -1),
                        tlv.contains(0x01) ? try tlv.string(0x01) : "", tlv.contains(0x02) ? try tlv.string(0x02) : ""
                    )
                }
            }
        }
    }

    public enum WatchfaceConfirm {
        public static let id: UInt8 = 0x05

        /// Throws where Java throws ArrayIndexOutOfBounds: a name that splits into no parts at all (only underscores).
        public static func request(fileName: String) throws -> HuaweiPacket {
            let parts = javaSplit(fileName, separator: "_")
            guard let file = parts.first else {
                throw PacketError.serialize("WatchfaceConfirm: '\(fileName)' has no id (ArrayIndexOutOfBoundsException in GB)")
            }
            var tlv = HuaweiTLV()
            tlv.put(0x01, string: file)
            tlv.put(0x02, string: parts.count > 1 ? parts[1] : "")
            tlv.put(0x7f, int: 0x0001_86A0)
            return HuaweiPacket(serviceId: Watchface.id, commandId: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            public let reportType: Int32
            public let fileName: String

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "WatchfaceConfirm")
                (reportType, fileName) = try PacketsJava.parsing("WatchfaceConfirm") {
                    let name = try tlv.string(0x01)
                    let version = try tlv.string(0x02)
                    let reportType: Int32 = tlv.contains(0x03) ? try tlv.asInteger(0x03) : 0
                    return (reportType, name + "_" + version)
                }
            }
        }
    }

    public enum WatchfaceNameInfo {
        public static let id: UInt8 = 0x06

        public static func request(watchfaceList: [InstalledWatchfaceInfo]) -> HuaweiPacket {
            var list = HuaweiTLV()
            for face in watchfaceList { // GB: ask the name only for custom watch faces (TODO there)
                var item = HuaweiTLV()
                item.put(0x04, string: face.fileName)
                list.put(0x83, tlv: item)
            }
            var tlv = HuaweiTLV()
            tlv.put(0x01, byte: 0x01)
            tlv.put(0x82, tlv: list)
            return HuaweiPacket(serviceId: Watchface.id, commandId: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            /// Face id to name; a later entry for the same id replaces an earlier one (Java `HashMap.put`).
            public let watchFaceNames: [String: String]

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "WatchfaceNames")
                watchFaceNames = try PacketsJava.parsing("WatchfaceNames") {
                    var names = [String: String]()
                    if tlv.contains(0x82) {
                        for sub in try tlv.object(0x82).objects(0x83) { names[try sub.string(0x04)] = try sub.string(0x05) }
                    }
                    return names
                }
            }
        }
    }
}
