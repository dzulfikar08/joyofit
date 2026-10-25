// Port of the WatchfaceOps part of WatchfaceManager.kt (derived from Gadgetbridge, AGPL-3.0-or-later): HuaweiWatchfaceManager
// (requestWatchfaceList, updateWatchfaceNames, setWatchface, deleteWatchface) and the requests GetWatchfaceParams, GetWatchfacesList,
// GetWatchfacesNames and SendWatchfaceOperation.
//
// The install flow follows Huawei Health 17.0.8.300 (its "install from a .hwt file" behaviour): GB uploads without announcing the face,
// Huawei Health always sends 27/03 first. The callers serialize these operations with the link's operation lock.
import Foundation

/// What the watch reports about watch faces in 0x27/0x01 (GB `WatchfaceDeviceParams`).
public struct WatchfaceScreen: Equatable, Sendable {
    public let maxVersion: String
    public let width: Int
    public let height: Int
    public let supportFileType: Int
    public let sort: Int
    public let otherVersions: String
    /// Tag 0x11, Huawei Health's `supportCapability` bit field; -1 when the watch did not send it.
    public let supportCapability: Int
    /// Tag 0x17, -1 when absent.
    public let supportSync: Int
    /// Tag 0x18 (0 = GT mode, 1 = AP mode), -1 when absent.
    public let mode: Int

    public static let capabilityDialUnite = 4
    public static let capabilitySignature = 8

    /// Huawei Health `isSupportWatchfaceSignature`: capability bit 3 (value 8).
    public var supportsSignature: Bool { supportCapability >= 0 && supportCapability & Self.capabilitySignature != 0 }
    /// Huawei Health `isSupportDialUnite`: capability bit 2 (value 4).
    public var supportsDialUnite: Bool { supportCapability >= 0 && supportCapability & Self.capabilityDialUnite != 0 }

    public init(
        maxVersion: String, width: Int, height: Int, supportFileType: Int, sort: Int, otherVersions: String,
        supportCapability: Int = -1, supportSync: Int = -1, mode: Int = -1
    ) {
        self.maxVersion = maxVersion
        self.width = width
        self.height = height
        self.supportFileType = supportFileType
        self.sort = sort
        self.otherVersions = otherVersions
        self.supportCapability = supportCapability
        self.supportSync = supportSync
        self.mode = mode
    }
}

/// One entry of the watch's face list (GB `InstalledWatchfaceInfo`) with the name from 0x27/0x06.
public struct WatchfaceEntry: Equatable, Sendable {
    /// GB `fileName`: the number the watch knows the face by, without the version.
    public let id: String
    public let version: String
    public let name: String
    public let type: Int
    public let expandedType: Int

    public init(id: String, version: String, name: String, type: Int, expandedType: Int) {
        self.id = id
        self.version = version
        self.name = name
        self.type = type
        self.expandedType = expandedType
    }

    public var isCurrent: Bool { type & 1 == 1 }
    public var isFactory: Bool { (type >> 1) & 1 == 1 }
    public var isEditable: Bool { (type >> 3) & 1 == 1 }
    public var isVideo: Bool { (type >> 4) & 1 == 1 }
    public var isPhoto: Bool { (type >> 5) & 1 == 1 }
    public var isTryout: Bool { (type >> 6) & 1 == 1 }
    public var isKaleidoscope: Bool { (type >> 7) & 1 == 1 }

    /// `WatchfaceInfo` in `HuaweiWearWatchface.types.ts`.
    public func toJS() -> [String: Any] {
        [
            "id": id, "version": version, "name": name, "active": isCurrent, "factory": isFactory, "editable": isEditable,
            "video": isVideo, "photo": isPhoto, "tryout": isTryout, "kaleidoscope": isKaleidoscope,
        ]
    }
}

/// `WatchfaceList` in `HuaweiWearWatchface.types.ts`.
public struct WatchfaceList: Equatable, Sendable {
    public let screen: WatchfaceScreen?
    public let faces: [WatchfaceEntry]
    public let updatedAtMs: Int64

    public init(screen: WatchfaceScreen?, faces: [WatchfaceEntry], updatedAtMs: Int64) {
        self.screen = screen
        self.faces = faces
        self.updatedAtMs = updatedAtMs
    }

    public func toJS() -> [String: Any] {
        [
            "width": screen.map { $0.width as Any } ?? NSNull(),
            "height": screen.map { $0.height as Any } ?? NSNull(),
            "maxVersion": screen.map { $0.maxVersion as Any } ?? NSNull(),
            "requiresSignature": screen.flatMap { s -> Any? in s.supportCapability >= 0 ? s.supportsSignature : nil } ?? NSNull(),
            "faces": faces.map { $0.toJS() },
            "updatedAt": updatedAtMs,
        ]
    }
}

/// `WatchfaceInstallResult` in `HuaweiWearWatchface.types.ts`.
public struct InstallResult: Equatable, Sendable {
    public let fileName: String
    public let id: String
    public let version: String
    public let name: String
    public let bytes: Int
    /// Tag 0x02 of the watch's 0x28/0x07 packet (not interpreted by GB).
    public let uploadStatus: Int?
    /// `reportType` of the watch's 0x27/0x05 confirmation.
    public let confirmReportType: Int?
    /// The new face is in the watch's list after the upload.
    public let listed: Bool
    /// The new face is the active one after the upload.
    public let active: Bool
    public let message: String
    public let list: WatchfaceList?

    public func toJS() -> [String: Any] {
        [
            "fileName": fileName, "id": id, "version": version, "name": name, "bytes": bytes,
            "uploadStatus": uploadStatus.map { $0 as Any } ?? NSNull(),
            "confirmReportType": confirmReportType.map { $0 as Any } ?? NSNull(),
            "listed": listed, "active": active, "message": message,
            "list": list.map { $0.toJS() as Any } ?? NSNull(),
        ]
    }
}

/// Announcement error codes Huawei Health treats as a signature failure.
public let signatureFailureCodes: Set<Int> = [100_007, 100_014]

/// The watch's answer to the 27/03 that announces a face before its upload; nil for a field the watch did not send.
struct Announcement {
    let code: Int?
    let needReceive: Int?
}

/// Huawei Health's reading of a refused announcement (100007 and 100014 are signature failures; it passes 100015 on to its UI as well).
public func describeAnnounceCode(_ code: Int) -> String {
    switch code {
    case 100_007, 100_014:
        return "The watch refused the face before the upload (code \(code)). Huawei Health treats 100007 and 100014 as a watch face "
            + "signature failure: it fetches a signature for the face from Huawei's servers and sends it in this request, which "
            + "JoyoFit cannot do."
    case 100_015:
        return "The watch refused the face before the upload (code 100015). Huawei Health shows this code in its own UI; its meaning is not documented."
    default:
        return "The watch refused the face before the upload with code \(code); what it means is not documented."
    }
}

/// Watch face list, set active, delete and install over the 0x27 / 0x28 services, on a connected session.
public final class WatchfaceOps: @unchecked Sendable {
    private let session: HuaweiSession
    private let caps: DeviceCaps
    private let log: LogSink
    private let uploadStallMs: Int
    private let confirmWaitMs: Int
    private let settleMs: Int
    private let queryMs: Int
    private let now: @Sendable () -> Int64
    private var params: ParamsProvider { session.params }

    public init(
        session: HuaweiSession, caps: DeviceCaps, log: @escaping LogSink,
        uploadStallMs: Int = FileUploader.stallMs, confirmWaitMs: Int = FileUploader.confirmWaitMs, settleMs: Int = FileUploader.settleMs,
        queryMs: Int = Timeouts.queryMs, now: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }
    ) {
        self.session = session
        self.caps = caps
        self.log = log
        self.uploadStallMs = uploadStallMs
        self.confirmWaitMs = confirmWaitMs
        self.settleMs = settleMs
        self.queryMs = queryMs
        self.now = now
    }

    /// The watch lists its commands and service 0x27 is not among them (an empty list means "not known yet").
    private func watchfaceServiceMissing() -> Bool {
        let commands = caps.supportedCommands
        return !commands.isEmpty && commands[Int(Watchface.id)] == nil
    }

    private func requireService() throws {
        if watchfaceServiceMissing() {
            throw WearError(.unsupported, "The watch does not list the watch face service (0x27) in its supported commands")
        }
    }

    /// The answer typed, or a protocol error (GB `ResponseTypeMismatchException` / `ParseException`).
    private func typed<R: PacketResponse>(_ packet: HuaweiPacket, _ what: String) throws -> R {
        do {
            return try R(packet: packet)
        } catch let e as WearError {
            throw e
        } catch {
            throw WearError(.protocolError, "\(what): failed to parse response: \(error)", underlying: error, isParseFailure: true)
        }
    }

    /// GB GetWatchfaceParams, gated by `supportsWatchfaceParams` (SupportedCommands 0x27/0x01). Nil when not supported or not answered.
    public func readScreen() async throws -> WatchfaceScreen? {
        if !caps.supports(Int(Watchface.id), Int(Watchface.WatchfaceParams.id)) {
            note("WatchfaceParams not requested: the watch does not list 27/01 (GB gate supportsWatchfaceParams)")
            return nil
        }
        let packet: HuaweiPacket
        let response: Watchface.WatchfaceParams.Response
        do {
            packet = try await session.request(Watchface.WatchfaceParams.request(), timeoutMs: queryMs, label: "WatchfaceParams")
            response = try typed(packet, "WatchfaceParams")
        } catch let e as WearError {
            if e.code == .disconnected { throw e }
            note("WatchfaceParams failed: \(e.message)", error: true)
            return nil
        }
        let p = response.params
        note("WatchfaceParams TLV: \(describeTlv(packet.tlv))")
        let capability = p.supportCapability >= 0 ? "0x" + String(p.supportCapability, radix: 16) : "not sent"
        note(
            "WatchfaceParams: width=\(p.width) height=\(p.height) (screen \(p.height)*\(p.width)) maxVersion=\(p.maxVersion) "
                + "supportFileType=\(p.supportFileType) sort=\(p.sort) otherWatchfaceVersions=\(p.otherWatchfaceVersions) "
                + "capability=\(capability) supportSync=\(p.supportSync >= 0 ? String(p.supportSync) : "not sent") mode=\(p.mode >= 0 ? String(p.mode) : "not sent")"
        )
        let screen = WatchfaceScreen(
            maxVersion: p.maxVersion, width: Int(p.width), height: Int(p.height), supportFileType: Int(p.supportFileType), sort: Int(p.sort),
            otherVersions: p.otherWatchfaceVersions, supportCapability: Int(p.supportCapability), supportSync: Int(p.supportSync), mode: Int(p.mode)
        )
        if p.supportCapability >= 0 {
            note("WatchfaceParams capability: watch face signature=\(screen.supportsSignature) (bit 8), dial unite=\(screen.supportsDialUnite) (bit 4)")
        }
        return screen
    }

    /// GB requestWatchfaceList + updateWatchfaceNames: 0x27/0x02, then 0x27/0x06 for the names.
    public func list() async throws -> WatchfaceList {
        try requireService()
        let screen = try await readScreen()
        let listPacket = try await session.request(Watchface.DeviceWatchInfo.request(), timeoutMs: queryMs, label: "WatchfaceList")
        let info: Watchface.DeviceWatchInfo.Response = try typed(listPacket, "WatchfaceList")
        let installed = info.watchfaceInfoList
        var names = [String: String]()
        if !installed.isEmpty {
            do {
                let namesPacket = try await session.request(Watchface.WatchfaceNameInfo.request(watchfaceList: installed), timeoutMs: queryMs, label: "WatchfaceNames")
                names = (try typed(namesPacket, "WatchfaceNames") as Watchface.WatchfaceNameInfo.Response).watchFaceNames
            } catch let e as WearError {
                if e.code == .disconnected { throw e }
                note("WatchfaceNames failed, listing by id: \(e.message)", error: true)
            }
        }
        let faces = installed.map { i -> WatchfaceEntry in
            let name = names[i.fileName].flatMap { $0.contains(where: { !$0.isWhitespace }) ? $0 : nil } ?? i.fileName
            return WatchfaceEntry(
                id: i.fileName, version: i.version, name: name, type: Int(UInt8(bitPattern: i.type)), expandedType: Int(UInt8(bitPattern: i.expandedType))
            )
        }
        for face in faces {
            note(
                "WatchfaceList: \(face.id)_\(face.version) \"\(face.name)\" type=0x\(String(face.type, radix: 16)) expanded=0x\(String(face.expandedType, radix: 16))"
                    + (face.isCurrent ? " [active]" : "") + (face.isFactory ? " [factory]" : "")
            )
        }
        note("WatchfaceList: \(faces.count) watch face(s)")
        return WatchfaceList(screen: screen, faces: faces, updatedAtMs: now())
    }

    /// GB `HuaweiWatchfaceManager.setWatchface`, then the list again to check that it took.
    public func setActive(_ id: String) async throws -> WatchfaceList {
        let face = try find(try await list(), id)
        let code = try await operation(face, Watchface.WatchfaceOperation.operationActive, "active")
        let after = try await list()
        if after.faces.first(where: { $0.id == id })?.isCurrent != true {
            throw WearError(
                .uploadRejected, "The watch did not make \"\(face.name)\" active" + (code.map { " (it answered \($0))" } ?? " (it sent no status)") + ".",
                statusCode: code
            )
        }
        return after
    }

    /// 27/03 operation 1 for `face` as listed, also when it is the current face, without listing before or after; the watch's status
    /// (tag 0x7f) or nil when it sends none. Huawei Health sends this after every photo face save: the Apply button of its My watch faces
    /// page saves the album (27/09 and the photo upload), then calls `applyWatchFace`, which is this packet
    /// (`OperateWatchFaceService.sendApplyWatchFaceCommand`). See protocol/README.md, "Photo faces".
    public func apply(_ face: WatchfaceEntry) async throws -> Int? {
        try await operation(face, Watchface.WatchfaceOperation.operationActive, "apply")
    }

    /// GB `HuaweiWatchfaceManager.deleteWatchface`, then the list again to check that it is gone.
    public func delete(_ id: String) async throws -> WatchfaceList {
        let face = try find(try await list(), id)
        let code = try await operation(face, Watchface.WatchfaceOperation.operationDelete, "delete")
        let after = try await list()
        if after.faces.contains(where: { $0.id == id }) {
            throw WearError(
                .uploadRejected, "The watch did not delete \"\(face.name)\"" + (code.map { " (it answered \($0))" } ?? " (it sent no status)") + ".",
                statusCode: code
            )
        }
        return after
    }

    private func find(_ list: WatchfaceList, _ id: String) throws -> WatchfaceEntry {
        guard let face = list.faces.first(where: { $0.id == id }) else {
            throw WearError(.invalidArgument, "The watch has no watch face with id '\(id)'")
        }
        return face
    }

    /// The status the watch answers with (tag 0x7f), or nil when it sends none.
    private func operation(_ face: WatchfaceEntry, _ operation: UInt8, _ what: String) async throws -> Int? {
        let label = "WatchfaceOperation \(what) \(face.id)_\(face.version)"
        let answer = try await session.request(
            Watchface.WatchfaceOperation.request(id: face.id, version: face.version, operation: operation), timeoutMs: queryMs, label: label
        )
        let code = (try? Watchface.WatchfaceOperation.Response(packet: answer))?.code
        let status = code.flatMap { $0 >= 0 ? Int($0) : nil }
        note("\(label): watch answered \(status.map(String.init) ?? "without a status")")
        return status
    }

    /// Huawei Health sends 27/03 (id, version, operation 1) before it uploads anything (`applyWatchFace` ->
    /// `OperateWatchFaceService.sendApplyWatchFaceCommand`, then `transferFile` straight after, without waiting). The watch answers with a
    /// status (tag 0x7f: absent or 100000 is fine) and `needReceive` (tag 0x04: 1 = send the file, 0 = it has this face already). GB does not
    /// send it. A status other than success ends the install here.
    private func announce(_ id: String, _ version: String, _ signature: String?) async throws -> Announcement {
        let label = "WatchfaceOperation announce \(id)_\(version)" + (signature != nil ? " (with signature)" : "")
        let packet = Watchface.WatchfaceOperation.request(id: id, version: version, operation: Watchface.WatchfaceOperation.operationActive, signature: signature)
        note("\(label) TLV before encryption: \(describeTlv(packet.tlv))")
        let answer: HuaweiPacket
        do {
            answer = try await session.request(packet, timeoutMs: queryMs, label: label)
        } catch let e as WearError {
            if e.code != .timeout { throw e }
            note("\(label): no answer from the watch; Huawei Health does not wait for one either, uploading anyway")
            return Announcement(code: nil, needReceive: nil)
        }
        let response = try? Watchface.WatchfaceOperation.Response(packet: answer)
        let code = response.flatMap { $0.code >= 0 ? Int($0.code) : nil }
        let needReceive = response.flatMap { $0.needReceive >= 0 ? Int($0.needReceive) : nil }
        note(
            "\(label): watch answered status=\(code.map(String.init) ?? "none") needReceive=\(needReceive.map(String.init) ?? "none") TLV \(describeTlv(answer.tlv))"
        )
        if let code, code != 0, code != Int(uploadOK) {
            throw WearError(.uploadRejected, describeAnnounceCode(code), statusCode: code)
        }
        return Announcement(code: code, needReceive: needReceive)
    }

    /// The Huawei Health flow for a face from a file (`com.huawei.watchface.f2`): check the face against the watch's screen and version
    /// range, announce it with 27/03, upload it as file type 1 under `<id>_<version>`, wait for the watch's 27/05 confirmation, then ask for
    /// the face list to see whether the face arrived. `fileName` must be `<id>_<version>`.
    public func install(
        _ pkg: WatchfacePackage, progress: @escaping @Sendable (_ bytes: Int, _ total: Int) -> Void, fileName: String? = nil, signature: String? = nil
    ) async throws -> InstallResult {
        try requireService()
        let description = pkg.description
        let fileName = fileName ?? WatchfacePackages.randomName(version: description.version)
        guard let separator = fileName.firstIndex(of: "_") else {
            throw WearError(.invalidArgument, "The install name must be `<id>_<version>`, got '\(fileName)'")
        }
        let id = String(fileName[..<separator])
        let version = String(fileName[fileName.index(after: separator)...])
        note(
            "Install \"\(description.title)\" v\(description.version) by \(description.author) (theme \(description.screen), "
                + "\(WatchfaceResolutions.screenByThemeVersion(description.screen)), \(pkg.binary.count) bytes) as \(fileName)"
        )
        let screen = try await readScreen()
        if let screen {
            try WatchfacePackages.checkResolution(description, height: screen.height, width: screen.width) { note($0) }
            try WatchfacePackages.checkVersion(description, maxVersion: screen.maxVersion, otherVersions: screen.otherVersions) { note($0) }
        } else {
            note("the watch's screen size is unknown; the package is not checked against it")
        }

        let announcement = try await announce(id, version, signature)
        var outcome: UploadOutcome?
        if announcement.needReceive == 0 {
            note("the watch reports it has \(id)_\(version) already (needReceive=0); nothing is uploaded")
        } else {
            outcome = try await FileUploader(
                session: session, caps: caps, log: log, onProgress: progress, stallMs: uploadStallMs, confirmWaitMs: confirmWaitMs, settleMs: settleMs,
                queryMs: queryMs
            ).upload(UploadFile(fileName: fileName, fileType: FileUpload.Filetype.watchface, data: pkg.binary))
        }

        var after: WatchfaceList?
        do {
            after = try await list()
        } catch let e as WearError {
            if e.code == .disconnected { throw e }
            note("the list after the upload could not be read: \(e.message)", error: true)
        }
        let face = outcome?.removedByWatch == true ? nil : after?.faces.first(where: { $0.id == id })
        let refused = outcome.map { $0.removedByWatch || (face == nil && $0.activateCode.map { signatureFailureCodes.contains($0) } == true) } ?? false
        let message: String
        if refused, let outcome {
            message = refusedMessage(outcome, screen)
        } else if after == nil {
            message = "Uploaded, but the watch did not answer when asked for its watch faces, so the result is unverified."
        } else if let face {
            message = face.isCurrent ? "Installed and active." : "Installed."
        } else {
            message = notListedMessage(outcome, screen)
        }
        note("Install result: \(message)")
        return InstallResult(
            fileName: fileName, id: id, version: version, name: description.title.isEmpty ? id : description.title, bytes: pkg.binary.count,
            uploadStatus: outcome?.resultStatus, confirmReportType: outcome?.confirmReportType, listed: face != nil, active: face?.isCurrent == true,
            message: message, list: after
        )
    }

    /// Observed on a Watch Fit 4 Pro (27/01 tag 0x11 = 0x3d): without a signature in the announcement the watch accepts the file, confirms it
    /// (27/05 type 2), answers the activation with 100014 and reports the face deleted (27/05 type 3) about 3 s later. Huawei Health sends the
    /// signature, fetched from Huawei's servers, in tag 0x08 of the announcement.
    private func refusedMessage(_ outcome: UploadOutcome, _ screen: WatchfaceScreen?) -> String {
        var text = "The watch received the face and then deleted it"
        var signs = [String]()
        if let code = outcome.activateCode, code != 0, code != Int(uploadOK) { signs.append("it answered the activation with code \(code)") }
        if outcome.removedByWatch { signs.append("it reported the face deleted (27/05 type 3)") }
        if !signs.isEmpty { text += " (\(signs.joined(separator: " and ")))" }
        text += "."
        if screen?.supportsSignature == true {
            text += " This watch reports the watch face signature capability and expects a Huawei-issued signature in the 27/03 "
                + "announcement, as Huawei Health sends it. JoyoFit cannot get one, so a face that Huawei did not sign is thrown "
                + "away. Huawei's test procedure for .hwt files uses Huawei Health logged in with a Huawei developer account."
        }
        return text
    }

    private func notListedMessage(_ outcome: UploadOutcome?, _ screen: WatchfaceScreen?) -> String {
        guard let outcome else { return "The watch said it had the face already but does not list it." }
        var text = "The upload finished (watch status \(outcome.resultStatus.map(String.init) ?? "none")) but the watch does not list the new face"
        if outcome.confirmReportType == nil { text += " and sent no install confirmation (27/05)" }
        text += "."
        if screen?.supportsSignature == true {
            text += " This watch reports the watch face signature capability. Huawei Health sends a Huawei-issued signature with "
                + "the 27/03 request; JoyoFit cannot, so the watch may be discarding faces that carry none."
        }
        return text
    }

    private func note(_ message: String, error: Bool = false) {
        log(LogEntry(error ? .error : .info, "Watchface: \(message)"))
    }
}
