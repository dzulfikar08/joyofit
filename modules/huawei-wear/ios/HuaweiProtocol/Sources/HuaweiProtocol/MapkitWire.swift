// Frames of the P2P module `hw.unitedevice.mapkit` (phone) <-> `in.huawei.mapkit` (watch), Huawei's offline-map transfer, and the P2P service
// that speaks them. Port of MapkitWire.kt and MapkitService.kt; both are tested against `Fixtures/mapkit.json`. Every message is one type byte
// followed by Huawei TLV (tag byte, 7-bit varint length, big-endian values). Layouts: docs/offline-maps.md, protocol/README.md "Offline maps
// (mapkit P2P)". EXPERIMENTAL: lab switch only.
import Foundation

/// One map entry of a watch list (`03`, item `88`) or of a delete (`05`, item `91`).
public struct MapkitMap: Equatable, Sendable {
    public let id: UInt64
    public let type: Int
    /// List: tag `0B` (the map version). Nil when absent.
    public let version: Int64?
    /// List: tag `16` (0 user, 1 asked by the watch). Nil when absent.
    public let downloadType: Int?
    /// Delete answer: tag `12` (0 = deleted). Nil when absent.
    public let result: Int?

    public init(id: UInt64, type: Int, version: Int64? = nil, downloadType: Int? = nil, result: Int? = nil) {
        self.id = id
        self.type = type
        self.version = version
        self.downloadType = downloadType
        self.result = result
    }
}

/// A frame of the mapkit P2P module, decoded. The raw frame is always logged too (`MapkitWire.describe`).
public enum MapkitMessage: Equatable, Sendable {
    /// `01`: tag `01`, the watch's free space (huac reads KiB, Huawei Health compares it with sizes in MB; unverified).
    case freeSpace(value: Int64?)
    /// `02` answer to the political view: `"0"` ok, `"1"` failed.
    case politicalView(result: String?, msgId: Int64?)
    /// `03` one frame of the watch's map list.
    case mapList(frames: Int?, index: Int?, total: Int?, msgId: Int64?, maps: [MapkitMap])
    /// `04` answer to the transfer handshake: `0C` 0 go on, 1 no space, 2 no update, 3 map in use, 4 device error.
    case handshake(code: Int?, msgId: Int64?)
    /// `05` one frame of the watch's delete answer; each map carries its result in tag `12`.
    case delete(frames: Int?, index: Int?, total: Int?, msgId: Int64?, maps: [MapkitMap])
    /// `08` the watch parsed a received file: `09` map id, `0A` map type, `15` code (0 = ok).
    case parsed(MapkitParsed)
    /// `07` political view again, `09` the size of the map around its position, `0B` a download for its position.
    case watchAsk(type: Int)
    /// Any other type.
    case other(type: Int)

    public var type: Int {
        switch self {
        case .freeSpace: return MapkitWire.typeFreeSpace
        case .politicalView: return MapkitWire.typePoliticalView
        case .mapList: return MapkitWire.typeMapList
        case .handshake: return MapkitWire.typeHandshake
        case .delete: return MapkitWire.typeDelete
        case .parsed: return MapkitWire.typeParsed
        case .watchAsk(let type), .other(let type): return type
        }
    }
}

/// The watch's `08` parse result.
public struct MapkitParsed: Equatable, Sendable {
    public let mapId: UInt64?
    public let mapType: Int?
    public let code: Int?

    public init(mapId: UInt64?, mapType: Int?, code: Int?) {
        self.mapId = mapId
        self.mapType = mapType
        self.code = code
    }
}

/// What the `offvmp` header of a map file says (HDataResearch `offvmp/src/data_offvmp.h`, Gadgetbridge `HuaweiFwHelper.parseAsOfflineMap`).
public struct OffvmpHeader: Equatable, Sendable {
    public let version: Int64
    public let indexOffset: Int64
    public let region: String
    public let zooms: [Int]
}

/// A map file as JoyoFit sends it: the id and type come from the file name only (the watch reads them from `<id>.bin`).
public struct OfflineMapFile: Equatable, Sendable {
    public let fileName: String
    public let mapId: UInt64
    public let mapType: Int
}

public enum MapkitWire {
    public static let module = "hw.unitedevice.mapkit"
    public static let package = "in.huawei.mapkit"
    public static let fingerprint = "SystemApp"

    public static let typeFreeSpace = 0x01
    public static let typePoliticalView = 0x02
    public static let typeMapList = 0x03
    public static let typeHandshake = 0x04
    public static let typeDelete = 0x05
    public static let typePing = 0x06
    public static let typeAskPoliticalView = 0x07
    public static let typeParsed = 0x08
    public static let typeAskSize = 0x09
    public static let typeSizeAnswer = 0x0A
    public static let typeAskDownload = 0x0B

    public static let mapTypeRegion = 0
    public static let mapTypeContour = 1
    public static let mapTypeGlobal = 2

    /// Handshake answer `0C` = 5: the phone has no network (huac and Huawei Health answer the watch's `09` / `0B` with it).
    public static let codeNoNetwork = 5

    /// The political view JoyoFit sends: its maps have one variant, built for Indonesia (Huawei Health: from Huawei's server, fallback `CN`).
    public static let politicalViewCode = "ID"

    /// Items per delete frame (Gadgetbridge `MAX_ITEM_PER_FRAME_DEL`).
    public static let maxDeleteItems = 40

    public static let headerSize = 0x440
    private static let magic: Bytes = Array("offvmp".utf8)
    private static let regionOffset = 0x3F
    private static let regionMax = 511
    private static let containers: Set<Int> = [0x87, 0x88, 0x90, 0x91]
    private static let mb: Int64 = 1024 * 1024

    public struct InvalidArgument: Error, CustomStringConvertible {
        public let description: String
    }

    private static func frame(_ type: Int, _ tlv: HuaweiTLV) -> Bytes { [UInt8(truncatingIfNeeded: type)] + tlv.serialize() }

    /// Gadgetbridge `IntToBytes` / huac `addVarBytes`: big-endian without leading zero bytes, one byte for 0..255.
    public static func minimal(_ value: Int64) -> Bytes {
        precondition(value >= 0, "negative value")
        if value < 256 { return [UInt8(value)] }
        var n = 0
        var v = value
        while v > 0 {
            v >>= 8
            n += 1
        }
        return (0..<n).map { UInt8((value >> (8 * Int64(n - 1 - $0))) & 0xFF) }
    }

    private static func u16(_ value: Int) -> Bytes { [UInt8((value >> 8) & 0xFF), UInt8(value & 0xFF)] }

    private static func u32(_ value: Int64) -> Bytes { (0..<4).map { UInt8((value >> (8 * Int64(3 - $0))) & 0xFF) } }

    private static func u64(_ value: UInt64) -> Bytes { (0..<8).map { UInt8((value >> (8 * UInt64(7 - $0))) & 0xFF) } }

    /// `01` free space query: `01` = 0.
    public static func freeSpaceQuery() -> Bytes {
        var tlv = HuaweiTLV()
        tlv.put(0x01, bytes: [0])
        return frame(typeFreeSpace, tlv)
    }

    /// `02` political view (sent on every connect): `02` view (ASCII), `14` review number (empty, as Gadgetbridge and huac), `13` msgId.
    public static func politicalView(_ view: String, msgId: Int) -> Bytes {
        var tlv = HuaweiTLV()
        tlv.put(0x02, bytes: Array(view.utf8))
        tlv.put(0x14)
        tlv.put(0x13, bytes: minimal(Int64(msgId)))
        return frame(typePoliticalView, tlv)
    }

    /// `03` the maps on the watch: `13` msgId.
    public static func listQuery(msgId: Int) -> Bytes {
        var tlv = HuaweiTLV()
        tlv.put(0x13, bytes: minimal(Int64(msgId)))
        return frame(typeMapList, tlv)
    }

    /// `04` transfer handshake (Huawei Health `d.java:480-505`): `02` political view, `14` review number, `0D` size in MB (u16), `0A` map type,
    /// `0E` 0 new / 1 update, `13` msgId (u32), `16` download type 0 (the user asked).
    public static func handshake(sizeMb: Int, mapType: Int, update: Bool, msgId: Int, view: String = politicalViewCode) throws -> Bytes {
        guard (0...0xFFFF).contains(sizeMb) else { throw InvalidArgument(description: "size \(sizeMb) MB out of u16") }
        var tlv = HuaweiTLV()
        tlv.put(0x02, bytes: Array(view.utf8))
        tlv.put(0x14)
        tlv.put(0x0D, bytes: u16(sizeMb))
        tlv.put(0x0A, bytes: [UInt8(truncatingIfNeeded: mapType)])
        tlv.put(0x0E, bytes: [update ? 1 : 0])
        tlv.put(0x13, bytes: u32(Int64(msgId)))
        tlv.put(0x16, bytes: [0])
        return frame(typeHandshake, tlv)
    }

    /// `05` delete, one frame: `04` frames, `05` frame index (from 0), `06` total count (u32), `13` msgId (u32), `90{91{09 id, 0A type, 0B 4}}`.
    public static func delete(_ maps: [(id: UInt64, type: Int)], msgId: Int, frames: Int = 1, index: Int = 0, total: Int? = nil) throws -> Bytes {
        guard !maps.isEmpty, maps.count <= maxDeleteItems else { throw InvalidArgument(description: "1 to \(maxDeleteItems) maps per delete frame") }
        var list = HuaweiTLV()
        for map in maps {
            var item = HuaweiTLV()
            item.put(0x09, bytes: u64(map.id))
            item.put(0x0A, bytes: [UInt8(truncatingIfNeeded: map.type)])
            item.put(0x0B, bytes: [4])
            list.put(0x91, tlv: item)
        }
        var tlv = HuaweiTLV()
        tlv.put(0x04, bytes: [UInt8(truncatingIfNeeded: frames)])
        tlv.put(0x05, bytes: [UInt8(truncatingIfNeeded: index)])
        tlv.put(0x06, bytes: u32(Int64(total ?? maps.count)))
        tlv.put(0x13, bytes: u32(Int64(msgId)))
        tlv.put(0x90, tlv: list)
        return frame(typeDelete, tlv)
    }

    /// `0A` the answer to the watch's `09`: `0D` size in MB; 0 = JoyoFit has no map for that position (huac).
    public static func sizeAnswer(sizeMb: Int) -> Bytes {
        var tlv = HuaweiTLV()
        tlv.put(0x0D, bytes: minimal(Int64(sizeMb)))
        return frame(typeSizeAnswer, tlv)
    }

    /// `04` "no network" answer to the watch's `0B` (Huawei Health `receivers/d.java:134`, huac): `13` msgId, `0C` 5, `16` 1.
    public static func noNetwork(msgId: Int) -> Bytes {
        var tlv = HuaweiTLV()
        tlv.put(0x13, bytes: u32(Int64(msgId)))
        tlv.put(0x0C, bytes: [UInt8(codeNoNetwork)])
        tlv.put(0x16, bytes: [1])
        return frame(typeHandshake, tlv)
    }

    /// Big-endian unsigned value of any length up to 8 bytes; nil for an empty or longer value.
    public static func unsigned(_ value: Bytes?) -> UInt64? {
        guard let value, !value.isEmpty, value.count <= 8 else { return nil }
        return value.reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
    }

    private static func value(_ tlv: HuaweiTLV, _ tag: Int) -> Bytes? { tlv.entries.first { Int($0.tag) == tag }?.value }

    private static func uint(_ tlv: HuaweiTLV, _ tag: Int) -> Int64? { unsigned(value(tlv, tag)).map { Int64(bitPattern: $0) } }

    private static func int(_ tlv: HuaweiTLV, _ tag: Int) -> Int? { uint(tlv, tag).map { Int(truncatingIfNeeded: Int32(truncatingIfNeeded: $0)) } }

    private static func text(_ tlv: HuaweiTLV, _ tag: Int) -> String? { value(tlv, tag).map { String(decoding: $0, as: UTF8.self) } }

    private static func tlvOf(_ bytes: Bytes, offset: Int = 0) -> HuaweiTLV? { try? HuaweiTLV(parsing: bytes, offset: offset) }

    private static func items(_ tlv: HuaweiTLV, container: Int, item: Int) -> [MapkitMap] {
        guard let raw = value(tlv, container), let list = tlvOf(raw) else { return [] }
        return list.entries.filter { Int($0.tag) == item }.compactMap { entry in
            guard let sub = tlvOf(entry.value), let id = unsigned(value(sub, 0x09)) else { return nil }
            return MapkitMap(id: id, type: int(sub, 0x0A) ?? -1, version: uint(sub, 0x0B), downloadType: int(sub, 0x16), result: int(sub, 0x12))
        }
    }

    /// The frame decoded; nil for an empty frame or a malformed TLV.
    public static func parse(_ frame: Bytes) -> MapkitMessage? {
        guard let first = frame.first else { return nil }
        let type = Int(first)
        guard let tlv = tlvOf(frame, offset: 1) else { return nil }
        switch type {
        case typeFreeSpace: return .freeSpace(value: uint(tlv, 0x01))
        case typePoliticalView: return .politicalView(result: text(tlv, 0x02), msgId: uint(tlv, 0x13))
        case typeMapList:
            return .mapList(frames: int(tlv, 0x04), index: int(tlv, 0x05), total: int(tlv, 0x06), msgId: uint(tlv, 0x13), maps: items(tlv, container: 0x87, item: 0x88))
        case typeHandshake: return .handshake(code: int(tlv, 0x0C), msgId: uint(tlv, 0x13))
        case typeDelete:
            return .delete(frames: int(tlv, 0x04), index: int(tlv, 0x05), total: int(tlv, 0x06), msgId: uint(tlv, 0x13), maps: items(tlv, container: 0x90, item: 0x91))
        case typeParsed: return .parsed(MapkitParsed(mapId: unsigned(value(tlv, 0x09)), mapType: int(tlv, 0x0A), code: int(tlv, 0x15)))
        case typeAskPoliticalView, typeAskSize, typeAskDownload: return .watchAsk(type: type)
        default: return .other(type: type)
        }
    }

    public static func typeName(_ type: Int) -> String {
        switch type {
        case typeFreeSpace: return "free space"
        case typePoliticalView: return "political view"
        case typeMapList: return "map list"
        case typeHandshake: return "transfer handshake"
        case typeDelete: return "delete"
        case typePing: return "ping"
        case typeAskPoliticalView: return "political view request"
        case typeParsed: return "parse result"
        case typeAskSize: return "size for my position"
        case typeSizeAnswer: return "size answer"
        case typeAskDownload: return "download for me"
        default: return "unknown"
        }
    }

    private static func describeTlv(_ tlv: HuaweiTLV) -> String {
        if tlv.entries.isEmpty { return "(empty)" }
        return tlv.entries.map { entry -> String in
            let tag = Int(entry.tag)
            let name = String(format: "%02X", tag)
            let value = entry.value
            if containers.contains(tag), let nested = tlvOf(value) { return "\(name){\(describeTlv(nested))}" }
            if value.isEmpty { return "\(name)=()" }
            if value.count > 1 && value.allSatisfy({ (0x20...0x7E).contains($0) }) { return "\(name)=\"\(String(decoding: value, as: UTF8.self))\"" }
            return "\(name)=\(value.hexUpper)"
        }.joined(separator: " ")
    }

    /// One log line for a frame: type byte and name, then every tag (containers `87 88 90 91` expanded).
    public static func describe(_ frame: Bytes) -> String {
        guard let first = frame.first else { return "(empty frame)" }
        let type = Int(first)
        let body = tlvOf(frame, offset: 1).map(describeTlv) ?? "malformed TLV \(frame.hexUpper)"
        return String(format: "%02X ", type) + "\(typeName(type)): \(body)"
    }

    /// The size the handshake announces: whole MB, rounded up, at least 1 (Huawei Health sends the server's `originalSize` in MB).
    public static func sizeMb(_ bytes: Int64) -> Int { Int(min(max((bytes + mb - 1) / mb, 1), 0xFFFF)) }

    /// How long Huawei Health's map page waits for the watch's parse result (`Math.ceil(originalSize / 0.2) + 30` s).
    public static func parseBudgetMs(_ sizeMb: Int) -> Int64 { (Int64(sizeMb) * 5 + 30) * 1000 }

    /// `<id>.bin`, `<id>_contour.bin` or `global.bin` (the id is only in the name; Gadgetbridge and huac read it the same way); nil otherwise.
    public static func fileOf(_ name: String) -> OfflineMapFile? {
        let base = name.split(separator: "/", omittingEmptySubsequences: false).last.map(String.init) ?? name
        guard base.hasSuffix(".bin") else { return nil }
        let stem = String(base.dropLast(4))
        if stem == "global" { return OfflineMapFile(fileName: base, mapId: 0, mapType: mapTypeGlobal) }
        let contour = stem.hasSuffix("_contour")
        let digits = contour ? String(stem.dropLast("_contour".count)) : stem
        guard !digits.isEmpty, digits.count <= 20, digits.allSatisfy({ ("0"..."9").contains($0) }), let id = UInt64(digits) else { return nil }
        return OfflineMapFile(fileName: base, mapId: id, mapType: contour ? mapTypeContour : mapTypeRegion)
    }

    /// The `offvmp` header: magic at 0, `u32 LE` version at 6, `u32 LE` index offset at 10, region name (UTF-8, NUL-ended) at 0x3F, zoom bitmap at the index.
    public static func header(_ bytes: Bytes) -> OffvmpHeader? {
        guard bytes.count >= headerSize, Array(bytes[0..<magic.count]) == magic else { return nil }
        func le32(_ at: Int) -> UInt32 { UInt32(bytes[at]) | UInt32(bytes[at + 1]) << 8 | UInt32(bytes[at + 2]) << 16 | UInt32(bytes[at + 3]) << 24 }
        let version = Int64(le32(6))
        let indexOffset = Int64(le32(10))
        var end = regionOffset
        while end < regionOffset + regionMax && bytes[end] != 0 { end += 1 }
        let region = String(decoding: bytes[regionOffset..<end], as: UTF8.self)
        var zooms: [Int] = []
        if indexOffset >= Int64(headerSize) && indexOffset <= Int64(bytes.count - 4) {
            let flags = le32(Int(indexOffset))
            zooms = (0..<32).filter { flags & (UInt32(1) << UInt32($0)) != 0 }
        }
        return OffvmpHeader(version: version, indexOffset: indexOffset, region: region, zooms: zooms)
    }
}

/// P2P module `hw.unitedevice.mapkit` <-> `in.huawei.mapkit` (fingerprint `SystemApp`). Registered only while the experimental offline-map switch
/// is on (`OfflineMapLab`). On registration it pings the watch's map app and sends the political view (`02`, as Huawei Health on every connect;
/// "1" is retried 3 times after 3 s); it answers the watch's own asks the way huac does (`07` with the political view, `09` with size 0, `0B` with
/// "no network"). Every frame in both directions is logged with `MapkitWire.describe`. Twin: MapkitService.kt.
public final class MapkitService: P2PService, @unchecked Sendable {
    public static let politicalRetries = 3
    public static let politicalRetryMs = 3_000

    private let log: LogSink
    private let retryMs: Int
    private let lock = NSLock()
    private var _pingCode: Int?
    private var _politicalViewResult: String?
    private var _lastParsed: MapkitParsed?
    private var _lastParsedAt: Int64 = 0
    private var listeners: [Int: @Sendable (MapkitMessage) -> Void] = [:]
    private var nextListener = 0
    private var counter = 0
    private var retries = 0

    public init(manager: P2PManager, log: @escaping LogSink, retryMs: Int = MapkitService.politicalRetryMs) {
        self.log = log
        self.retryMs = retryMs
        super.init(manager: manager)
    }

    public override var module: String { MapkitWire.module }
    public override var package: String { MapkitWire.package }
    public override var fingerprint: String { MapkitWire.fingerprint }

    public var pingCode: Int? { lock.p2pLocked { _pingCode } }
    /// The watch's answer to the political view: "0" ok, "1" failed; nil before one arrived.
    public var politicalViewResult: String? { lock.p2pLocked { _politicalViewResult } }
    /// The watch's last `08` parse result on this connection, and when it arrived (ms).
    public var lastParsed: MapkitParsed? { lock.p2pLocked { _lastParsed } }
    public var lastParsedAt: Int64 { lock.p2pLocked { _lastParsedAt } }

    /// Huawei Health's message id: a counter mod 10000.
    public func nextMsgId() -> Int {
        lock.p2pLocked {
            counter = (counter + 1) % 10000
            return counter
        }
    }

    private func note(_ message: String) { log(LogEntry(.info, service: 0x34, command: 0x01, "Mapkit: \(message)")) }

    public override func registered() {
        note("registered \(MapkitWire.module) -> \(MapkitWire.package); political view \(MapkitWire.politicalViewCode)")
        sendPing { [weak self] code, _ in
            self?.lock.p2pLocked { self?._pingCode = code }
            self?.note("ping of \(MapkitWire.package) answered \(String(format: "0x%02x", code & 0xFF)) (0xca = the map app is there)")
        }
        sendPoliticalView(nextMsgId())
    }

    public override func unregister() {
        clearPending()
        lock.p2pLocked { listeners.removeAll() }
    }

    /// Calls `listener` with every decoded frame from the watch until `unsubscribe` is called with the returned token.
    public func subscribe(_ listener: @escaping @Sendable (MapkitMessage) -> Void) -> Int {
        lock.p2pLocked {
            nextListener += 1
            listeners[nextListener] = listener
            return nextListener
        }
    }

    public func unsubscribe(_ token: Int) { lock.p2pLocked { _ = listeners.removeValue(forKey: token) } }

    /// Sends one frame, logged; the P2P acknowledgement code (0xcf = received) is logged when it arrives.
    public func send(_ frame: Bytes) {
        note("tx \(MapkitWire.describe(frame))")
        let type = Int(frame.first ?? 0)
        sendCommand(frame) { [weak self] code, _ in
            self?.note(String(format: "tx %02X acknowledged 0x%02x", type, code & 0xFF))
        }
    }

    private func sendPoliticalView(_ msgId: Int) { send(MapkitWire.politicalView(MapkitWire.politicalViewCode, msgId: msgId)) }

    public override func handleData(_ data: Bytes) throws {
        note("rx \(MapkitWire.describe(data))")
        guard let message = MapkitWire.parse(data) else { return }
        switch message {
        case .politicalView(let result, let msgId): onPoliticalView(result: result, msgId: msgId)
        case .parsed(let parsed):
            lock.p2pLocked {
                _lastParsed = parsed
                _lastParsedAt = Int64(Date().timeIntervalSince1970 * 1000)
            }
            note(
                "the watch parsed map \(parsed.mapId.map { String($0) } ?? "null") type \(parsed.mapType.map(String.init) ?? "null"): code \(parsed.code.map(String.init) ?? "null") (0 = ok)"
            )
        case .watchAsk(let type):
            switch type {
            case MapkitWire.typeAskPoliticalView: sendPoliticalView(nextMsgId())
            case MapkitWire.typeAskSize:
                note("the watch asked for a map around its position; answering size 0 (JoyoFit downloads no maps)")
                send(MapkitWire.sizeAnswer(sizeMb: 0))
            case MapkitWire.typeAskDownload:
                note("the watch asked for a map download; answering \"no network\"")
                send(MapkitWire.noNetwork(msgId: nextMsgId()))
            default: break
            }
        default: break
        }
        for listener in lock.p2pLocked({ Array(listeners.values) }) { listener(message) }
    }

    private func onPoliticalView(result: String?, msgId: Int64?) {
        let attempt: Int? = lock.p2pLocked {
            _politicalViewResult = result
            if result == "0" {
                retries = 0
                return nil
            }
            retries += 1
            return retries
        }
        guard let attempt else { return }
        if attempt > MapkitService.politicalRetries {
            note("the watch refused the political view \(MapkitService.politicalRetries + 1) times; not retrying")
            return
        }
        let id = msgId.map { Int(truncatingIfNeeded: $0) } ?? nextMsgId()
        let delay = UInt64(max(retryMs, 0)) * 1_000_000
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: delay)
            self?.sendPoliticalView(id)
        }
    }
}
