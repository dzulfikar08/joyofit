// Port of the PhotoFaceOps part of PhotoFaceUploader.kt. The photo ("gallery") watch face: its photos live on the watch, put there by the phone.
// The flow is Huawei Health 17.0.8.300's: 27/08 reads the face's settings and photo list, 27/09 sends the list the face should hold, and for
// every photo the watch does not have yet it then asks for the file itself (28/01), after which the phone runs the ordinary 28/02 .. 28/07
// upload with file type 3. The watch ends with a 27/05 report (type 4, photos received). No watch face signature is involved anywhere in it.
import Foundation

/// FileUpload file type 3, "background image": what Huawei Health uses for a photo (`getFileType()` of `WatchFacePhotoAlbumManager`).
public let fileTypeBackground: UInt8 = 3

/// The two files Huawei Health keeps for a photo: the PNG it shows and the `.bin` it sends.
public struct PhotoFiles: Sendable {
    public let png: Bytes
    public let bin: Bytes

    public init(png: Bytes, bin: Bytes) {
        self.png = png
        self.bin = bin
    }
}

/// What `PhotoFaceOps.save` did.
public struct PhotoSaveResult: Equatable, Sendable {
    /// Tag 0x08 of the watch's answer to 27/09: how many photos it still wanted.
    public let transferNum: Int
    /// The names the phone sent, in order.
    public let sent: [String]
    /// `failedNum` of the watch's type 4 report; nil when none arrived.
    public let failedNum: Int?
}

/// 27/08, 27/09 and the photo transfer on a connected session. The caller holds the link's operation lock.
public final class PhotoFaceOps: @unchecked Sendable {
    public static let reportWaitMs = 15_000

    private let session: HuaweiSession
    private let caps: DeviceCaps?
    private let log: LogSink
    private let queryMs: Int
    private let stallMs: Int
    /// How long to wait for the watch's type 4 report once every photo it asked for has been sent.
    private let reportWaitMs: Int
    private var params: ParamsProvider { session.params }

    public init(
        session: HuaweiSession, caps: DeviceCaps? = nil, log: @escaping LogSink, queryMs: Int = Timeouts.queryMs, stallMs: Int = FileUploader.stallMs,
        reportWaitMs: Int = PhotoFaceOps.reportWaitMs
    ) {
        self.session = session
        self.caps = caps
        self.log = log
        self.queryMs = queryMs
        self.stallMs = stallMs
        self.reportWaitMs = reportWaitMs
    }

    /// 27/08. The three optional indexes are always asked for: the watch answers the ones its face has.
    public func readInfo() async throws -> PhotoFaceInfo {
        let request = PhotoFace.InfoRequest.request(position: true, style: true, data: true)
        note("PhotoInfo TLV before encryption: \(describeTlv(request.tlv))")
        let answer = try await session.request(request, timeoutMs: queryMs, label: "PhotoInfo")
        guard let tlv = answer.tlv else { throw WearError(.protocolError, "PhotoInfo: the watch's answer has no TLV") }
        note("PhotoInfo: watch answered \(describeTlv(tlv))")
        let info: PhotoFaceInfo
        do {
            info = try PhotoFaceCodec.parseInfo(tlv)
        } catch {
            throw WearError(.protocolError, "PhotoInfo could not be read: \(error)", underlying: error)
        }
        note(
            "PhotoInfo: max=\(info.maxPhotos) backgroundType=\(info.backgroundType) imageOption=\(info.imageOption) "
                + "intellectColour=\(info.intellectColour) position=\(info.positionIndex.map(String.init) ?? "nil") style=\(info.styleIndex.map(String.init) ?? "nil") "
                + "data=\(info.dataIndex.map(String.init) ?? "nil") photos=\(info.photos.isEmpty ? "none" : info.photos.map { "\($0.index):\($0.name)" }.joined(separator: ", "))"
        )
        return info
    }

    /// 27/09 with `names` (every photo the face should hold, `<name>.png`), then serves every file the watch asks for from `files`. `info` and
    /// `fields` supply the values written for each photo and the face (`PhotoFaceCodec.saveTlv`).
    public func save(
        _ info: PhotoFaceInfo, names: [String], files: [String: PhotoFiles], fields: PhotoSaveFields = PhotoSaveFields(),
        progress: @escaping @Sendable (_ bytes: Int, _ total: Int) -> Void = { _, _ in }
    ) async throws -> PhotoSaveResult {
        let inbox = FileBlockInbox()
        var subscriptions = [Int]()
        subscriptions.append(await session.subscribe(service: PhotoFace.fileUploadId, command: PhotoFace.FileRequestAnswer.id, label: "photo file request") { inbox.push($0) })
        subscriptions.append(await session.subscribe(service: PhotoFace.watchfaceId, command: PhotoFace.ReportAck.id, label: "photo face report") { inbox.push($0) })
        do {
            let result = try await run(info, names, files, fields, progress, inbox)
            await release(inbox, subscriptions)
            return result
        } catch {
            await release(inbox, subscriptions)
            throw error
        }
    }

    private func release(_ inbox: FileBlockInbox, _ subscriptions: [Int]) async {
        inbox.close()
        for id in subscriptions { await session.unsubscribe(id) }
    }

    private func run(
        _ info: PhotoFaceInfo, _ names: [String], _ files: [String: PhotoFiles], _ fields: PhotoSaveFields,
        _ progress: @escaping @Sendable (Int, Int) -> Void, _ inbox: FileBlockInbox
    ) async throws -> PhotoSaveResult {
        let request = PhotoFace.SaveRequest.request(PhotoFaceCodec.saveTlv(info, names, fields))
        note("PhotoSave \(names.count) photo(s) TLV before encryption: \(describeTlv(request.tlv))")
        let answer = try await session.request(request, timeoutMs: queryMs, label: "PhotoSave")
        guard let tlv = answer.tlv else { throw WearError(.protocolError, "PhotoSave: the watch's answer has no TLV") }
        let status = PhotoFaceCodec.parseSaveStatus(tlv)
        note("PhotoSave: watch answered status=\(status.code) transferNum=\(status.transferNum) TLV \(describeTlv(tlv))")
        if status.code != PhotoFaceCodec.statusOK {
            throw WearError(
                .uploadRejected, "The watch refused the photo list with status \(status.code); what it means is not documented.", statusCode: status.code
            )
        }
        if status.transferNum == 0 { return PhotoSaveResult(transferNum: 0, sent: names, failedNum: nil) }

        var served = 0
        var failed: Int?
        while failed == nil {
            let limit = served >= status.transferNum ? reportWaitMs : stallMs
            guard let packet = try await inbox.next(session: session, limitMs: limit) else {
                if served < status.transferNum {
                    throw WearError(.timeout, "The watch asked for \(served) of \(status.transferNum) photos and then sent nothing for \(limit / 1000) s.")
                }
                note("no type 4 report within \(limit)ms after \(served) photo(s); going on")
                break
            }
            if packet.serviceId == PhotoFace.watchfaceId {
                failed = try await handleReport(packet)
            } else if try await serveFile(packet, files, progress) {
                served += 1
            }
        }
        return PhotoSaveResult(transferNum: status.transferNum, sent: names, failedNum: failed)
    }

    /// Answers the watch's 28/01; true when the file went out.
    private func serveFile(_ packet: HuaweiPacket, _ files: [String: PhotoFiles], _ progress: @escaping @Sendable (Int, Int) -> Void) async throws -> Bool {
        note("FileRequest: watch asked \(packet.tlv.map { describeTlv($0) } ?? "(no TLV)")")
        guard let tlv = packet.tlv, let request = try? PhotoFaceCodec.parseFileRequest(tlv) else { return false }
        guard let data = files[request.name], request.fileType == PhotoFaceCodec.fileTypePhoto else {
            note("FileRequest: \"\(request.name)\" type \(request.fileType) is not a photo this save holds; answering \(PhotoFaceCodec.fileMissing)")
            try await session.send(
                PhotoFace.FileRequestAnswer.request(fileName: request.name, fileType: request.fileType, resourceType: request.resourceType, status: PhotoFaceCodec.fileMissing),
                label: "FileRequest answer \(request.name) (missing)"
            )
            return false
        }
        try await session.send(
            PhotoFace.FileRequestAnswer.request(fileName: request.name, fileType: request.fileType, resourceType: request.resourceType, status: PhotoFaceCodec.statusOK),
            label: "FileRequest answer \(request.name)"
        )
        let content = PhotoFaceCodec.contentFor(request, png: data.png, bin: data.bin)
        note("FileRequest: sending \"\(request.name)\" as \(request.resourceType == 1 ? "png" : "bin") (\(content.count) bytes, resource type \(request.resourceType))")
        _ = try await FileUploader(session: session, caps: caps, log: log, onProgress: progress, stallMs: stallMs, confirmWaitMs: 0, settleMs: 0, queryMs: queryMs)
            .upload(UploadFile(fileName: request.name, fileType: fileTypeBackground, data: content))
        return true
    }

    /// Acknowledges a 27/05 like Huawei Health's `reportAck`; the failed count of a type 4 report, otherwise nil.
    private func handleReport(_ packet: HuaweiPacket) async throws -> Int? {
        guard let tlv = packet.tlv, let report = try? PhotoFaceCodec.parseReport(tlv) else { return nil }
        note(
            "Report: type=\(report.reportType) failedNum=\(report.failedNum) code=\(report.code) id=\(report.id) version=\(report.version) TLV \(describeTlv(tlv))"
        )
        if report.code == PhotoFaceCodec.statusOK {
            try await session.send(PhotoFace.ReportAck.request(watchfaceId: report.id, version: report.version), label: "Report ack type \(report.reportType)")
        }
        return report.reportType == PhotoFaceCodec.reportPhotosReceived ? report.failedNum : nil
    }

    private func note(_ message: String) { log(LogEntry(.info, "Photo face: \(message)")) }
}
