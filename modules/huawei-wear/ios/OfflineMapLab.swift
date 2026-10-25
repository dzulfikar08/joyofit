// The offline-map lab (docs/offline-maps.md, "Lab"): sends an OSM-built `offvmp` map file the user picked to the watch over the mapkit P2P module,
// the way Huawei Health does with its own maps, and lists and deletes maps on the watch. Behind the experimental switch `P2pSettings.offlineMapLab`
// (off by default); with it off nothing registers and every call refuses. Every step and frame is logged (`Mapkit:` lines). Port of OfflineMapLab.kt.
//
// The send: ping `in.huawei.mapkit` (0xca = there) → `01` free space → `03` list (update flag when the id is already there) → `04` handshake
// (size MB, type, update, msgId) and its `0C` code → the file over FileUpload 28 as P2P file type 7 named `<id>.bin` (the watch checks the
// SHA-256) → the watch's `08` parse result within Huawei Health's budget (5 s per MB + 30 s).
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

public final class OfflineMapLab: @unchecked Sendable {
    /// ExpandCapability bits of Huawei Health's map SDK (`consts/a.java:7`).
    public static let bitMap = 201
    public static let bitContour = 202
    public static let bitAutoDownload = 284
    public static let bitSki = 317

    public static let pingThere = 0xCA
    public static let pingWaitMs = 4_000
    public static let answerWaitMs = 10_000
    public static let listWaitMs = 10_000
    public static let handshakeWaitMs = 15_000
    public static let progressLogMs: Int64 = 10_000
    public static let maxFileBytes = 64 * 1024 * 1024
    /// GB uses file type 7 for every P2P file.
    public static let fileTypeP2P: UInt8 = 7

    private let settings: P2pSettings
    private let link: LinkHandleSource
    private let events: WearEvents
    private let pingWaitMs: Int
    private let answerWaitMs: Int
    private let listWaitMs: Int
    private let handshakeWaitMs: Int
    private let lock = NSLock()
    private var busy = false
    private var stackSource: () -> P2PStack? = { nil }

    public init(
        settings: P2pSettings, link: LinkHandleSource, events: WearEvents, pingWaitMs: Int = OfflineMapLab.pingWaitMs,
        answerWaitMs: Int = OfflineMapLab.answerWaitMs, listWaitMs: Int = OfflineMapLab.listWaitMs, handshakeWaitMs: Int = OfflineMapLab.handshakeWaitMs
    ) {
        self.settings = settings
        self.link = link
        self.events = events
        self.pingWaitMs = pingWaitMs
        self.answerWaitMs = answerWaitMs
        self.listWaitMs = listWaitMs
        self.handshakeWaitMs = handshakeWaitMs
    }

    /// Where the live P2P stack comes from (the owning `P2pController`); set once, right after init.
    func bind(stack: @escaping () -> P2PStack?) { lock.locked { stackSource = stack } }

    private func stack() -> P2PStack? { lock.locked { stackSource }() }

    private func log(_ message: String) { events.info("Mapkit: \(message)") }

    private func service(_ current: P2PStack?) -> MapkitService? { current?.manager.registeredService(MapkitWire.module) as? MapkitService }

    private static func nullable(_ value: Any?) -> Any { value ?? NSNull() }

    /// `OfflineMapLabStatus` of HuaweiWearOfflineMaps.types.ts.
    public func status() -> [String: Any] {
        let current = stack()
        let service = service(current)
        let caps = link.handle()?.caps
        let lastParsed: Any = service?.lastParsed.map { parsed -> Any in
            var js = OfflineMapLab.parsedJS(parsed)
            js["at"] = service?.lastParsedAt ?? 0
            return js
        } ?? NSNull()
        return [
            "enabled": settings.offlineMapLab,
            "p2p": current != nil,
            "gateMap": caps?.expandCapability(OfflineMapLab.bitMap) ?? false,
            "gateContour": caps?.expandCapability(OfflineMapLab.bitContour) ?? false,
            "gateAutoDownload": caps?.expandCapability(OfflineMapLab.bitAutoDownload) ?? false,
            "registered": service != nil,
            "pingCode": OfflineMapLab.nullable(service?.pingCode),
            "politicalView": MapkitWire.politicalViewCode,
            "politicalViewResult": OfflineMapLab.nullable(service?.politicalViewResult),
            "lastParsed": lastParsed,
        ]
    }

    /// Switching on registers the module now when connected; switching off takes full effect at the next connect (every call refuses at once).
    public func setEnabled(_ enabled: Bool) {
        settings.offlineMapLab = enabled
        log("lab switch \(enabled ? "on" : "off")")
        if enabled, let current = stack() { attach(current) }
    }

    /// Called on every new P2P stack: registers the mapkit module when the switch is on and the watch sets ExpandCapability 201.
    public func attach(_ current: P2PStack) {
        guard settings.offlineMapLab, let caps = link.handle()?.caps, caps.supports(0x34, 0x01) else { return }
        let gate = caps.expandCapability(OfflineMapLab.bitMap)
        log(
            "ExpandCapability 201 (offline map)=\(gate) 202 (contour)=\(caps.expandCapability(OfflineMapLab.bitContour)) 284 (auto download)=\(caps.expandCapability(OfflineMapLab.bitAutoDownload)) 317 (ski)=\(caps.expandCapability(OfflineMapLab.bitSki))"
        )
        if !gate {
            log("the watch does not set ExpandCapability 201; mapkit not registered")
            return
        }
        if service(current) == nil { MapkitService(manager: current.manager, log: events.sink).register() }
    }

    /// The registered service of this link, after its ping answered (or `pingWaitMs` passed). Refuses while the switch is off.
    private func ready() async throws -> (LinkHandle, MapkitService) {
        if !settings.offlineMapLab {
            throw WearError(.unsupported, "Offline maps are a lab feature; switch them on under Experimental first")
        }
        guard let handle = link.handle() else { throw WearError(.notConnected, "Not connected to a watch") }
        guard let current = stack() else { throw WearError(.unsupported, "The watch does not list the P2P service (34/01)") }
        if !handle.caps.expandCapability(OfflineMapLab.bitMap) {
            throw WearError(.unsupported, "The watch does not set ExpandCapability 201, the offline-map bit Huawei Health checks")
        }
        attach(current)
        guard let service = service(current) else { throw WearError(.unsupported, "The mapkit module could not be registered") }
        _ = await p2pWithTimeout(ms: pingWaitMs) {
            while service.pingCode == nil { try await Task.sleep(nanoseconds: 100_000_000) }
            return true
        }
        let ping = service.pingCode
        log("ping of \(MapkitWire.package) -> \(ping.map { String(format: "0x%02x", $0 & 0xFF) } ?? "no answer in \(pingWaitMs) ms")")
        if let ping, (ping & 0xFF) != OfflineMapLab.pingThere {
            throw WearError(
                .unsupported, "The watch's map app did not answer the ping (\(String(format: "0x%02x", ping & 0xFF)), expected 0xca)", statusCode: ping & 0xFF
            )
        }
        return (handle, service)
    }

    /// Sends `frame` and returns the first non-nil `pick` of the watch's frames within `timeoutMs`, or nil. `pick` sees every decoded frame
    /// (the list and delete answers come in several).
    private func exchange<T: Sendable>(
        _ service: MapkitService, _ frame: Bytes, timeoutMs: Int, pick: @escaping @Sendable (MapkitMessage) -> T?
    ) async -> T? {
        let (inbox, continuation) = AsyncStream.makeStream(of: MapkitMessage.self)
        let token = service.subscribe { continuation.yield($0) }
        defer {
            service.unsubscribe(token)
            continuation.finish()
        }
        service.send(frame)
        return await p2pWithTimeout(ms: timeoutMs) { () -> T? in
            for await message in inbox {
                if let found = pick(message) { return found }
            }
            return nil
        } ?? nil
    }

    private func queryFreeSpace(_ service: MapkitService) async -> Int64? {
        let answer: Int64?? = await exchange(service, MapkitWire.freeSpaceQuery(), timeoutMs: answerWaitMs) { message -> Int64?? in
            if case .freeSpace(let value) = message { return .some(value) }
            return nil
        }
        return answer ?? nil
    }

    private struct Listing {
        let maps: [MapkitMap]
        let total: Int?
        let complete: Bool
    }

    private final class ListBox: @unchecked Sendable {
        var maps: [MapkitMap] = []
        var total: Int?
    }

    private func queryList(_ service: MapkitService) async -> Listing {
        let msgId = service.nextMsgId()
        let box = ListBox()
        let done: Bool? = await exchange(service, MapkitWire.listQuery(msgId: msgId), timeoutMs: listWaitMs) { message in
            guard case let .mapList(frames, _, total, id, maps) = message else { return nil }
            if let id, id != Int64(msgId) { return nil }
            box.maps += maps
            box.total = total
            let expected = total ?? 0
            return expected == 0 || (frames ?? 1) <= 1 || box.maps.count >= expected ? true : nil
        }
        let listText = box.maps.map { "\($0.id) type \($0.type) version \($0.version.map { String($0) } ?? "?")" }.joined(separator: ", ")
        log(
            "list: \(box.maps.count) of \(box.total.map(String.init) ?? "?") maps\(done == nil ? " (incomplete after \(listWaitMs / 1000) s)" : ""): \(listText)"
        )
        return Listing(maps: box.maps, total: box.total, complete: done != nil)
    }

    /// One map operation at a time: a second one while a send runs (minutes) fails at once instead of queueing behind it.
    private func exclusive<T>(_ body: () async throws -> T) async throws -> T {
        let taken = lock.locked { () -> Bool in
            if busy { return false }
            busy = true
            return true
        }
        if !taken { throw WearError(.busy, "Another map operation is running") }
        defer { lock.locked { busy = false } }
        return try await body()
    }

    public func freeSpace() async throws -> [String: Any] {
        try await exclusive {
            let (_, service) = try await ready()
            let value = await queryFreeSpace(service)
            log("free space: \(value.map { String($0) } ?? "no answer in \(answerWaitMs / 1000) s") (KiB per huac, MB per Huawei Health; unverified)")
            return ["value": OfflineMapLab.nullable(value)]
        }
    }

    public func list() async throws -> [String: Any] {
        try await exclusive {
            let (_, service) = try await ready()
            let listing = await queryList(service)
            return ["maps": listing.maps.map(OfflineMapLab.mapJS), "total": OfflineMapLab.nullable(listing.total), "complete": listing.complete]
        }
    }

    /// Reads and checks the picked file without sending it.
    public func inspect(uri: String, name: String) async throws -> [String: Any] {
        let loaded = try load(uri: uri, name: name)
        return OfflineMapLab.fileJS(loaded.file, loaded.bytes, loaded.header)
    }

    private final class ParsedBox: @unchecked Sendable {
        let lock = NSLock()
        var started: Int64 = 0
        var lastLogged: Int64 = 0
    }

    private static func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

    public func send(uri: String, name: String) async throws -> [String: Any] {
        try await exclusive {
            let loaded = try load(uri: uri, name: name)
            let file = loaded.file
            let bytes = loaded.bytes
            let header = loaded.header
            let (handle, service) = try await ready()
            let info = OfflineMapLab.fileJS(file, bytes, header)
            log(
                "send \(file.fileName): \(bytes.count) bytes (\(info["sizeMb"] ?? "?") MB), offvmp version \(header.version), region \"\(header.region)\", zooms \(header.zooms), sha256 \(info["sha256"] ?? "?")"
            )

            let free = await queryFreeSpace(service)
            log("free space before: \(free.map { String($0) } ?? "no answer") (file \(bytes.count / 1024) KiB)")
            let listing = await queryList(service)
            let update = listing.maps.contains { $0.id == file.mapId && $0.type == file.mapType }
            let sizeMb = MapkitWire.sizeMb(Int64(bytes.count))
            let budget = MapkitWire.parseBudgetMs(sizeMb)

            // The parse result can arrive right after the upload: listen from the handshake on.
            let (parsedInbox, parsedContinuation) = AsyncStream.makeStream(of: MapkitParsed.self)
            let token = service.subscribe { message in
                if case .parsed(let parsed) = message { parsedContinuation.yield(parsed) }
            }
            defer {
                service.unsubscribe(token)
                parsedContinuation.finish()
            }
            let started = OfflineMapLab.nowMs()
            let events = self.events
            let progress = ParsedBox()
            let handshakeWaitMs = self.handshakeWaitMs
            let outcome: UploadOutcome = try await handle.operationLock.withLock {
                let msgId = service.nextMsgId()
                let frame = try OfflineMapLab.argument { try MapkitWire.handshake(sizeMb: sizeMb, mapType: file.mapType, update: update, msgId: msgId) }
                let code: Int?? = await exchange(service, frame, timeoutMs: handshakeWaitMs) { message -> Int?? in
                    if case .handshake(let code, _) = message { return .some(code) }
                    return nil
                }
                let answerText = code.map { c in c.map { "0C=\($0) (\(OfflineMapLab.handshakeText($0)))" } ?? "0C=null (no code)" }
                log(
                    "handshake (size \(sizeMb) MB, type \(file.mapType), update \(update), msgId \(msgId)) -> \(answerText ?? "no answer in \(handshakeWaitMs / 1000) s")"
                )
                guard let code else {
                    throw WearError(.timeout, "The watch did not answer the map handshake within \(handshakeWaitMs / 1000) s")
                }
                if code != 0 {
                    throw WearError(.uploadRejected, "The watch refused the map: \(OfflineMapLab.handshakeText(code))", statusCode: code)
                }
                let route = P2pRoute(
                    srcPackage: MapkitWire.module, dstPackage: MapkitWire.package, srcFingerprint: service.localFingerprint, dstFingerprint: MapkitWire.fingerprint
                )
                return try await FileUploader(session: handle.session, caps: handle.caps, log: events.sink, onProgress: { done, total in
                    events.uploadProgress(bytes: done, total: total)
                    let now = OfflineMapLab.nowMs()
                    let shouldLog = progress.lock.locked { () -> Bool in
                        if now - progress.lastLogged >= OfflineMapLab.progressLogMs || done >= total {
                            progress.lastLogged = now
                            return true
                        }
                        return false
                    }
                    if shouldLog { events.info("Mapkit: upload \(done) / \(total) bytes after \((now - started) / 1000) s") }
                }).upload(UploadFile(fileName: file.fileName, fileType: OfflineMapLab.fileTypeP2P, data: bytes, route: route))
            }
            let uploadMs = OfflineMapLab.nowMs() - started
            let rate: Int64? = uploadMs > 0 ? Int64(bytes.count) * 1000 / uploadMs : nil
            log(
                "upload finished in \(uploadMs / 1000) s (\(rate.map { String($0) } ?? "?") B/s), 28/07 status \(outcome.resultStatus.map(String.init) ?? "none"); waiting for the watch's parse result (budget \(budget / 1000) s)"
            )

            let parseStart = OfflineMapLab.nowMs()
            let mapId = file.mapId
            let parsed: MapkitParsed? = await p2pWithTimeout(ms: Int(budget)) { () -> MapkitParsed? in
                for await message in parsedInbox where message.mapId == nil || message.mapId == mapId { return message }
                return nil
            } ?? nil
            let parseMs = OfflineMapLab.nowMs() - parseStart
            if let parsed {
                log(
                    "parse result after \(parseMs / 1000) s: map \(parsed.mapId.map { String($0) } ?? "null") type \(parsed.mapType.map(String.init) ?? "null") code \(parsed.code.map(String.init) ?? "null") (\(parsed.code == 0 ? "the watch took the map" : "the watch could not read the map"))"
                )
            } else {
                log("no parse result (08) within \(budget / 1000) s")
            }
            return [
                "file": info,
                "update": update,
                "freeSpace": OfflineMapLab.nullable(free),
                "handshakeCode": 0,
                "uploadStatus": OfflineMapLab.nullable(outcome.resultStatus),
                "uploadMs": uploadMs,
                "bytesPerSecond": OfflineMapLab.nullable(rate),
                "parsed": parsed.map { OfflineMapLab.parsedJS($0) as Any } ?? NSNull(),
                "parseMs": parsed != nil ? parseMs as Any : NSNull(),
                "parseBudgetMs": budget,
            ]
        }
    }

    public func delete(mapId: String, mapType: Int) async throws -> [String: Any] {
        try await exclusive {
            guard !mapId.isEmpty, mapId.allSatisfy({ ("0"..."9").contains($0) }), let id = UInt64(mapId) else {
                throw WearError(.invalidArgument, "Map id must be a decimal number, got '\(mapId)'")
            }
            if !(0...3).contains(mapType) { throw WearError(.invalidArgument, "Map type must be 0 to 3, got \(mapType)") }
            let (_, service) = try await ready()
            let msgId = service.nextMsgId()
            let frame = try OfflineMapLab.argument { try MapkitWire.delete([(id: id, type: mapType)], msgId: msgId) }
            let answer: [MapkitMap]? = await exchange(service, frame, timeoutMs: answerWaitMs) { message in
                guard case let .delete(_, _, _, answerId, maps) = message else { return nil }
                return answerId == nil || answerId == Int64(msgId) ? maps : nil
            }
            let result = answer?.first { $0.id == id }?.result
            log(
                "delete \(id) type \(mapType) -> \(answer != nil ? "12=\(result.map(String.init) ?? "none") (0 = deleted)" : "no answer in \(answerWaitMs / 1000) s")"
            )
            return ["mapId": mapId, "mapType": mapType, "answered": answer != nil, "code": OfflineMapLab.nullable(result)]
        }
    }

    private static func argument<T>(_ body: () throws -> T) throws -> T {
        do {
            return try body()
        } catch let e as MapkitWire.InvalidArgument {
            throw WearError(.invalidArgument, e.description)
        }
    }

    private struct Loaded {
        let file: OfflineMapFile
        let bytes: Bytes
        let header: OffvmpHeader
    }

    private func load(uri: String, name: String) throws -> Loaded {
        guard let file = MapkitWire.fileOf(name) else {
            throw WearError(
                .invalidArgument,
                "The file must be named <map id>.bin, <map id>_contour.bin or global.bin (got '\(name)'): the watch takes the map id from the name"
            )
        }
        let bytes = try OfflineMapLab.readFile(uri)
        guard let header = MapkitWire.header(bytes) else { throw WearError(.invalidArgument, "'\(name)' is not an offvmp map (no offvmp header)") }
        return Loaded(file: file, bytes: bytes, header: header)
    }

    /// The picked file (`file://` URL or plain path), up to `maxFileBytes`.
    static func readFile(_ uri: String) throws -> Bytes {
        let url: URL
        if let parsed = URL(string: uri), parsed.scheme != nil {
            guard parsed.isFileURL else { throw WearError(.invalidArgument, "Could not open \(uri)") }
            url = parsed
        } else {
            url = URL(fileURLWithPath: uri)
        }
        let handle: FileHandle
        do {
            handle = try FileHandle(forReadingFrom: url)
        } catch {
            throw WearError(.invalidArgument, "Could not read the file: \(error.localizedDescription)", underlying: error)
        }
        defer { try? handle.close() }
        var out = Bytes()
        while true {
            let chunk: Data
            do {
                chunk = try handle.read(upToCount: 64 * 1024) ?? Data()
            } catch {
                throw WearError(.invalidArgument, "Could not read the file: \(error.localizedDescription)", underlying: error)
            }
            if chunk.isEmpty { break }
            out.append(contentsOf: chunk)
            if out.count > maxFileBytes {
                throw WearError(.invalidArgument, "The lab sends maps up to \(maxFileBytes / 1024 / 1024) MiB (the upload holds the file in memory)")
            }
        }
        return out
    }

    public static func handshakeText(_ code: Int?) -> String {
        switch code {
        case 0: return "go on"
        case 1: return "not enough space on the watch"
        case 2: return "the watch has this version already"
        case 3: return "the map is in use on the watch"
        case 4: return "device error"
        case MapkitWire.codeNoNetwork: return "no network"
        case nil: return "no code"
        case let c?: return "code \(c)"
        }
    }

    public static func mapJS(_ map: MapkitMap) -> [String: Any] {
        ["mapId": String(map.id), "mapType": map.type, "version": nullable(map.version), "downloadType": nullable(map.downloadType)]
    }

    public static func parsedJS(_ parsed: MapkitParsed) -> [String: Any] {
        ["mapId": nullable(parsed.mapId.map { String($0) }), "mapType": nullable(parsed.mapType), "code": nullable(parsed.code)]
    }

    static func fileJS(_ file: OfflineMapFile, _ bytes: Bytes, _ header: OffvmpHeader) -> [String: Any] {
        [
            "fileName": file.fileName,
            "mapId": String(file.mapId),
            "mapType": file.mapType,
            "bytes": bytes.count,
            "sizeMb": MapkitWire.sizeMb(Int64(bytes.count)),
            "formatVersion": header.version,
            "region": header.region,
            "zooms": header.zooms,
            "sha256": SHA256.hash(bytes).hexUpper,
        ]
    }
}
