// Port of WatchMusic.kt (derived from Gadgetbridge, AGPL-3.0-or-later; see NOTICE): service/devices/huawei/HuaweiMusicManager (list paging,
// upload info answer, music operation), HuaweiSupportProvider.onInstallApp (music upload over FileUpload type 2), requests/{GetMusicInfoParams,
// GetExtendedMusicInfoParams,GetMusicList,SendMusicOperation,SendUploadMusicFileInfoResponse}, AsynchronousResponse (25/09).
//
// Songs on the watch (docs/watch-music.md): the pure checks of a picked song file (`MusicFiles`) and the watch traffic (`WatchMusicOps`). The
// module side (the lab switch, the 25/04 gate, the operation lock, reading the file and its tags, cancel) is WatchMusicController.swift.
// Same behaviour, log lines (`Music: ...`) and error messages as the Kotlin twin.
import Foundation

/// The audio formats JoyoFit sends, by their name in Gadgetbridge's format table. Nothing is converted.
public enum SongFormat: String, Sendable {
    case mp3
    case m4a
    case aac

    public var wire: String { rawValue }
}

/// What a song file's first bytes say: its format and, for MP3 and ADTS AAC, the sample rate of the first frame.
public struct SongProbe: Equatable, Sendable {
    public let format: SongFormat
    public let sampleRate: Int?
    public let detail: String

    public init(format: SongFormat, sampleRate: Int?, detail: String) {
        self.format = format
        self.sampleRate = sampleRate
        self.detail = detail
    }
}

/// One format's limits from 25/0D.
public struct MusicFormatLimit: Equatable, Sendable {
    public let formatIndex: Int
    public let format: String?
    public let sampleRates: [String]
    public let bitrate: Int?
    public let channels: Int
}

/// The watch's music store as 25/04 (and 25/0D when it answered) report it. `WatchMusicInfo` in HuaweiWearMusic.types.ts.
public struct MusicInfo: Equatable, Sendable {
    public let freeSpaceMb: Int?
    public let formats: [String]
    public let maxSongs: Int?
    public let songCount: Int?
    public let maxPlaylists: Int?
    public let frameCount: Int
    public let limits: [MusicFormatLimit]
    public let extended: Bool

    public init(
        freeSpaceMb: Int?, formats: [String], maxSongs: Int?, songCount: Int?, maxPlaylists: Int?, frameCount: Int, limits: [MusicFormatLimit],
        extended: Bool
    ) {
        self.freeSpaceMb = freeSpaceMb
        self.formats = formats
        self.maxSongs = maxSongs
        self.songCount = songCount
        self.maxPlaylists = maxPlaylists
        self.frameCount = frameCount
        self.limits = limits
        self.extended = extended
    }

    public func toJS() -> [String: Any] {
        [
            "freeSpaceMb": freeSpaceMb.map { $0 as Any } ?? NSNull(),
            "formats": formats,
            "maxSongs": maxSongs.map { $0 as Any } ?? NSNull(),
            "songCount": songCount.map { $0 as Any } ?? NSNull(),
            "maxPlaylists": maxPlaylists.map { $0 as Any } ?? NSNull(),
            "frameCount": frameCount,
            "limits": limits.map { l -> [String: Any] in
                [
                    "formatIndex": l.formatIndex, "format": l.format.map { $0 as Any } ?? NSNull(), "sampleRates": l.sampleRates,
                    "bitrate": l.bitrate.map { $0 as Any } ?? NSNull(), "channels": l.channels,
                ]
            },
            "extended": extended,
        ]
    }
}

/// `WatchSong` in HuaweiWearMusic.types.ts.
public struct WatchSong: Equatable, Sendable {
    public let id: Int
    public let title: String
    public let artist: String
    public let fileName: String

    public init(id: Int, title: String, artist: String, fileName: String) {
        self.id = id
        self.title = title
        self.artist = artist
        self.fileName = fileName
    }

    public func toJS() -> [String: Any] { ["id": id, "title": title, "artist": artist, "fileName": fileName] }
}

public struct WatchSongList: Equatable, Sendable {
    public let songs: [WatchSong]
    public let pages: Int
}

/// A song ready to send: the bytes, the name the watch gets and the tags it asks for (25/09).
public struct SongFile: Sendable {
    public let fileName: String
    public let data: Bytes
    public let probe: SongProbe
    public let title: String
    public let artist: String

    public init(fileName: String, data: Bytes, probe: SongProbe, title: String, artist: String) {
        self.fileName = fileName
        self.data = data
        self.probe = probe
        self.title = title
        self.artist = artist
    }
}

public struct SongUploadOutcome: Equatable, Sendable {
    public let uploadStatus: Int?
    public let infoAnswered: Bool
    public let uploadMs: Int64
}

public struct SongDeleteOutcome: Equatable, Sendable {
    public let ids: [Int]
    public let ok: Bool
    public let code: Int?
}

/// Kotlin's `List.toString()`: `[a, b]`, and `null` for no list.
func kotlinList<T>(_ items: [T]?) -> String {
    guard let items else { return "null" }
    return "[" + items.map { "\($0)" }.joined(separator: ", ") + "]"
}

/// Pure checks of a picked song file, shared by the controller and the tests. Twin: `MusicFiles` in WatchMusic.kt.
public enum MusicFiles {
    /// The upload holds the whole file in memory (`UploadFile`).
    public static let maxFileBytes = 64 * 1024 * 1024

    /// Gadgetbridge sends this artist when the file has none (`R.string.unknown`).
    public static let unknownArtist = "Unknown"

    static let mpeg1Rates = [44100, 48000, 32000]
    static let mpeg2Rates = [22050, 24000, 16000]
    static let mpeg25Rates = [11025, 12000, 8000]
    static let adtsRates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350]

    public static func `extension`(_ name: String) -> String? {
        guard let dot = name.lastIndex(of: "."), name.index(after: dot) != name.endIndex else { return nil }
        return name[name.index(after: dot)...].lowercased()
    }

    public static func formatOfExtension(_ name: String) -> SongFormat? {
        switch `extension`(name) {
        case "mp3": return .mp3
        case "m4a": return .m4a
        case "aac": return .aac
        default: return nil
        }
    }

    /// The format by content: an MP4 `ftyp` box is M4A; after an optional ID3v2 tag, an MPEG-1/2/2.5 Layer III frame header is MP3 and an
    /// ADTS header (sync, layer 00) is AAC. Anything else is nil.
    public static func probe(_ data: Bytes) -> SongProbe? {
        if data.count >= 12 && data[4] == UInt8(ascii: "f") && data[5] == UInt8(ascii: "t") && data[6] == UInt8(ascii: "y") && data[7] == UInt8(ascii: "p") {
            let brand = String(data[8..<12].map { Character(Unicode.Scalar($0)) })
            return SongProbe(format: .m4a, sampleRate: nil, detail: "MP4 brand '\(brand)'")
        }
        var at = 0
        var id3 = ""
        if data.count >= 10 && data[0] == UInt8(ascii: "I") && data[1] == UInt8(ascii: "D") && data[2] == UInt8(ascii: "3") {
            let size = (Int(data[6]) & 0x7F) << 21 | (Int(data[7]) & 0x7F) << 14 | (Int(data[8]) & 0x7F) << 7 | (Int(data[9]) & 0x7F)
            let footer = Int(data[5]) & 0x10 != 0 ? 10 : 0
            at = 10 + size + footer
            id3 = "ID3v2.\(data[3]) tag of \(10 + size + footer) bytes, "
        }
        // Some encoders pad the tag with zeros beyond its declared size.
        while at < data.count && data[at] == 0 { at += 1 }
        if at + 4 > data.count { return nil }
        let b0 = Int(data[at])
        let b1 = Int(data[at + 1])
        let b2 = Int(data[at + 2])
        if b0 != 0xFF || b1 & 0xE0 != 0xE0 { return nil }
        let layer = (b1 >> 1) & 0x03
        if b1 & 0xF0 == 0xF0 && layer == 0 {
            let index = (b2 >> 2) & 0x0F
            let rate = index < adtsRates.count ? adtsRates[index] : nil
            return SongProbe(format: .aac, sampleRate: rate, detail: "\(id3)ADTS at \(at)")
        }
        if layer != 0x01 { return nil } // Layer III only
        let rates: [Int]
        switch (b1 >> 3) & 0x03 {
        case 3: rates = mpeg1Rates
        case 2: rates = mpeg2Rates
        case 0: rates = mpeg25Rates
        default: return nil
        }
        let index = (b2 >> 2) & 0x03
        let rate = index < rates.count ? rates[index] : nil
        return SongProbe(format: .mp3, sampleRate: rate, detail: "\(id3)MPEG audio frame at \(at)")
    }

    /// Checks a picked file against what JoyoFit sends and what the watch reported, and returns its probe. Throws `ERR_INVALID_ARGUMENT` with
    /// a message for the user.
    public static func check(name: String, data: Bytes, info: MusicInfo?) throws -> SongProbe {
        guard let byName = formatOfExtension(name) else {
            throw invalid("'\(name)' is not an MP3, M4A or AAC file. JoyoFit sends these as they are and converts nothing.")
        }
        if data.isEmpty { throw invalid("'\(name)' is empty.") }
        if data.count > maxFileBytes { throw invalid("'\(name)' is larger than \(maxFileBytes / 1024 / 1024) MiB.") }
        guard let probe = probe(data) else {
            throw invalid("'\(name)' does not contain \(byName.wire.uppercased()) audio JoyoFit recognises.")
        }
        if probe.format != byName {
            throw invalid(
                "'\(name)' is named .\(`extension`(name) ?? "") but contains \(probe.format.wire.uppercased()) audio; rename it to .\(probe.format.wire)."
            )
        }
        if let info, !info.formats.isEmpty, !info.formats.contains(probe.format.wire) {
            throw invalid("The watch does not take \(probe.format.wire.uppercased()) files (it lists \(info.formats.joined(separator: ", "))).")
        }
        if let free = info?.freeSpaceMb, Int64(data.count) > Int64(free) * 1024 * 1024 {
            throw invalid("'\(name)' is \((data.count + 1024 * 1024 - 1) / (1024 * 1024)) MB; the watch has \(free) MB free.")
        }
        return probe
    }

    /// The file name without its extension, Gadgetbridge's title when the tags have none.
    public static func titleFallback(_ name: String) -> String {
        guard let first = name.firstIndex(of: "."), first != name.startIndex, let last = name.lastIndex(of: ".") else { return name }
        return String(name[..<last])
    }

    /// The name the watch gets: the picked name without any path.
    public static func watchFileName(_ name: String) -> String {
        let afterSlash = name.split(separator: "/", omittingEmptySubsequences: false).last.map(String.init) ?? name
        let afterBackslash = afterSlash.split(separator: "\\", omittingEmptySubsequences: false).last.map(String.init) ?? afterSlash
        return afterBackslash.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func invalid(_ message: String) -> WearError { WearError(.invalidArgument, message) }
}

/// Song storage on a connected watch: capabilities (25/04, 25/0D), the paged song list (25/05), delete (25/08 operation 4 on playlist 0) and
/// the upload (FileUpload 28 with file type 2, answering the watch's 25/09 with the song's title and artist). The caller holds the link's
/// operation lock. Twin: `WatchMusicOps` in WatchMusic.kt.
public final class WatchMusicOps: @unchecked Sendable {
    /// How long after the transfer a missing 25/09 is still awaited (GB's timing was not read).
    public static let infoGraceMs = 5_000
    /// GB `HuaweiMusicManager`: at most 250 frames with ExpandCapability 122.
    public static let maxFrames = 250
    public static let firstEndFrame = 65535
    /// GB `HuaweiState.supportsMoreMusic`.
    public static let bitMoreMusic = 122

    private let session: HuaweiSession
    private let caps: DeviceCaps?
    private let log: LogSink
    private let queryMs: Int
    private let infoGraceMs: Int
    private let stallMs: Int

    public init(
        session: HuaweiSession, caps: DeviceCaps?, log: @escaping LogSink, queryMs: Int = Timeouts.queryMs, infoGraceMs: Int = WatchMusicOps.infoGraceMs,
        stallMs: Int = FileUploader.stallMs
    ) {
        self.session = session
        self.caps = caps
        self.log = log
        self.queryMs = queryMs
        self.infoGraceMs = infoGraceMs
        self.stallMs = stallMs
    }

    /// 25/04, then 25/0D when `extended` (the watch lists it); a 0D without an answer is logged and left out.
    public func info(extended: Bool) async throws -> MusicInfo {
        let basic = try await session.request(
            MusicControl.MusicInfoParams.request(), as: MusicControl.MusicInfoParams.Response.self, timeoutMs: queryMs, label: "MusicInfoParams"
        )
        let pages = basic.pageStruct.map { $0.map { "\($0.startFrame)-\($0.endFrame)x\($0.count)" }.joined(separator: ", ") } ?? "none"
        note("25/04: frameCount=\(basic.frameCount) \(Self.describe(basic.params)) pages=\(pages)")
        var ext: HuaweiMusicUtils.MusicCapabilities?
        if extended {
            do {
                ext = try await session.request(
                    MusicControl.ExtendedMusicInfoParams.request(), as: MusicControl.ExtendedMusicInfoParams.Response.self, timeoutMs: queryMs,
                    label: "ExtendedMusicInfoParams"
                ).params
                note("25/0D: \(Self.describe(ext!))")
            } catch let e as WearError {
                if e.code != .timeout { throw e }
                note("25/0D: no answer within \(queryMs) ms; using 25/04 only")
            }
        }
        return Self.merge(Int(basic.frameCount), basic.params, ext)
    }

    /// Every page of the list, the way Gadgetbridge's `HuaweiMusicManager` pages it: frames 0.. up to the frame count (at most 250 with
    /// ExpandCapability 122) with end index 65535; without 122 it stops at a page whose end index equals the one asked for (compared as GB
    /// does, the signed 16-bit answer against the int it sent) or that holds a single song, and a two-song page moves the end index to the
    /// second song's id. Songs are kept once per id.
    public func list(info: MusicInfo, moreMusic: Bool) async throws -> WatchSongList {
        var songs = [WatchSong]()
        var seen = Set<Int>()
        let limit = moreMusic ? min(info.frameCount, Self.maxFrames) : info.frameCount
        var frame = 0
        var endFrame = Self.firstEndFrame
        var pages = 0
        while frame < limit {
            let page = try await session.request(
                MusicControl.MusicList.request(startFrame: Int16(truncatingIfNeeded: frame), endIndex: Int16(truncatingIfNeeded: endFrame)),
                as: MusicControl.MusicList.Response.self, timeoutMs: queryMs, label: "MusicList \(frame)"
            )
            pages += 1
            note(
                "25/05 frame \(frame) (end \(endFrame)): startFrame=\(page.startFrame) endIndex=\(page.endIndex) songs=\(page.musicList.count): "
                    + page.musicList.map { "\($0.id) '\($0.title)' / '\($0.artist)' (\($0.fileName))" }.joined(separator: ", ")
            )
            for s in page.musicList where seen.insert(Int(s.id)).inserted {
                songs.append(WatchSong(id: Int(s.id), title: s.title, artist: s.artist, fileName: s.fileName))
            }
            if moreMusic || !(Int(page.endIndex) == endFrame || page.musicList.count == 1) {
                if page.musicList.count == 2 { endFrame = Int(page.musicList[1].id) }
                frame += 1
                continue
            }
            break
        }
        note("list: \(songs.count) songs in \(pages) pages (frameCount \(info.frameCount), moreMusic=\(moreMusic))")
        return WatchSongList(songs: songs, pages: pages)
    }

    /// 25/08 operation 4 on playlist 0: Gadgetbridge's "delete from device".
    public func delete(ids: [Int]) async throws -> SongDeleteOutcome {
        let answer = try await session.request(
            MusicControl.MusicOperation.request(
                operation: MusicControl.MusicOperation.operationRemoveSongs, playlistIndex: MusicControl.MusicOperation.playlistAllSongs, playlistName: nil,
                musicIds: ids
            ),
            as: MusicControl.MusicOperation.Response.self, timeoutMs: queryMs, label: "MusicOperation delete \(kotlinList(ids))"
        )
        let code = answer.resultCode != -1 ? answer.resultCode : nil
        let ok = code == Int(MusicControl.successValue)
        note(
            "25/08 delete \(kotlinList(ids)): watch answered code=\(code.map(String.init) ?? "none") operation=\(answer.operation) "
                + "playlist=\(answer.playlistIndex) ids=\(kotlinList(answer.musicIds))\(ok ? "" : " (not 100000: not deleted)")"
        )
        return SongDeleteOutcome(ids: ids, ok: ok, code: code)
    }

    /// What the 25/09 responder did, shared between it and the upload.
    private final class Answers: @unchecked Sendable {
        private let lock = NSLock()
        private var _answered = false
        private var _failure: Error?

        var answered: Bool {
            lock.lock()
            defer { lock.unlock() }
            return _answered
        }

        var failure: Error? {
            lock.lock()
            defer { lock.unlock() }
            return _failure
        }

        func markAnswered() {
            lock.lock()
            _answered = true
            lock.unlock()
        }

        func fail(_ error: Error) {
            lock.lock()
            if _failure == nil { _failure = error }
            lock.unlock()
        }
    }

    /// Sends `file` as FileUpload type 2. While it runs (and up to `infoGraceMs` after it, when the watch has not asked yet) the watch's 25/09
    /// is answered with the song's title and artist, as Gadgetbridge's `uploadMusicInfo` does when the file name matches. Cancelling the
    /// calling task stops the transfer with `CancellationError`.
    public func upload(_ file: SongFile, onProgress: @escaping @Sendable (_ bytes: Int, _ total: Int) -> Void) async throws -> SongUploadOutcome {
        let (asks, continuation) = AsyncStream.makeStream(of: HuaweiPacket.self)
        let subscription = await session.subscribe(
            service: MusicControl.id, command: MusicControl.UploadMusicFileInfo.id, label: "music upload info \(file.fileName)"
        ) { continuation.yield($0) }
        let answers = Answers()
        let responder = Task { [session] in
            for await packet in asks {
                let ask: MusicControl.UploadMusicFileInfo.UploadMusicFileInfoRequest
                do {
                    ask = try MusicControl.UploadMusicFileInfo.UploadMusicFileInfoRequest(packet: packet)
                } catch {
                    self.note("25/09 could not be read: \(Self.message(error))", error: true)
                    continue
                }
                if ask.songFileName != file.fileName {
                    // GB: "Upload file info does not exist." and no answer.
                    self.note("25/09 asks for song \(ask.songIndex) '\(ask.songFileName)', not '\(file.fileName)'; not answered (as Gadgetbridge)", error: true)
                    continue
                }
                do {
                    try await session.send(
                        MusicControl.UploadMusicFileInfo.request(songIndex: ask.songIndex, songName: file.title, songArtist: file.artist),
                        label: "UploadMusicFileInfo \(ask.songIndex)"
                    )
                } catch {
                    answers.fail(error)
                    continue
                }
                answers.markAnswered()
                self.note("25/09 song index \(ask.songIndex) '\(ask.songFileName)': answered title '\(file.title)', artist '\(file.artist)'")
            }
        }
        do {
            let outcome = try await transfer(file, answers, onProgress)
            await release(subscription, continuation, responder)
            return outcome
        } catch {
            await release(subscription, continuation, responder)
            throw error
        }
    }

    private func transfer(
        _ file: SongFile, _ answers: Answers, _ onProgress: @escaping @Sendable (Int, Int) -> Void
    ) async throws -> SongUploadOutcome {
        note(
            "upload \(file.fileName): \(file.data.count) bytes, \(file.probe.format.wire) (\(file.probe.detail), sample rate "
                + "\(file.probe.sampleRate.map(String.init) ?? "?")), title '\(file.title)', artist '\(file.artist)'"
        )
        let started = Self.nowMs()
        let outcome: UploadOutcome
        do {
            outcome = try await FileUploader(session: session, caps: caps, log: log, onProgress: onProgress, stallMs: stallMs, queryMs: queryMs)
                .upload(UploadFile(fileName: file.fileName, fileType: FileUpload.Filetype.music, data: file.data))
        } catch let e as WearError where e.code == .uploadRejected && e.statusCode == 140_004 {
            // FileUploader words 140004 for watch faces; GB uses the same code for "too many songs".
            throw WearError(.uploadRejected, "The watch holds no more songs (code 140004). Delete one and try again.", underlying: e, statusCode: 140_004)
        }
        if let failure = answers.failure { throw failure }
        let uploadMs = Self.nowMs() - started
        if !answers.answered {
            note("no 25/09 during the upload; waiting \(infoGraceMs / 1000) s for it")
            var waited = 0
            while !answers.answered && waited < infoGraceMs {
                try await Task.sleep(nanoseconds: 100_000_000)
                waited += 100
            }
            if let failure = answers.failure { throw failure }
        }
        let rate = uploadMs > 0 ? Int64(file.data.count) * 1000 / uploadMs : 0
        note(
            "upload \(file.fileName) done in \(uploadMs / 1000) s (\(rate) B/s): 28/07 status \(outcome.resultStatus.map(String.init) ?? "none"), "
                + "25/09 answered=\(answers.answered)"
        )
        return SongUploadOutcome(uploadStatus: outcome.resultStatus, infoAnswered: answers.answered, uploadMs: uploadMs)
    }

    private func release(_ subscription: Int, _ continuation: AsyncStream<HuaweiPacket>.Continuation, _ responder: Task<Void, Never>) async {
        await session.unsubscribe(subscription)
        continuation.finish()
        responder.cancel()
    }

    /// 25/0D wins where it has a value. `MusicCapabilities` leaves a missing tag at 0, so 0 MB free and 0 max songs read as "not reported"
    /// (a full watch still refuses the file with 140009); 0 songs is taken as reported.
    static func merge(_ frameCount: Int, _ basic: HuaweiMusicUtils.MusicCapabilities, _ ext: HuaweiMusicUtils.MusicCapabilities?) -> MusicInfo {
        let extFormats = ext?.supportedFormats.flatMap { $0.isEmpty ? nil : $0 }
        let formats = extFormats ?? basic.supportedFormats ?? []
        let extSpace = ext.flatMap { $0.availableSpace > 0 ? Int($0.availableSpace) : nil }
        let space = extSpace ?? Int(basic.availableSpace)
        let extMax = ext.flatMap { $0.maxMusicCount > 0 ? Int($0.maxMusicCount) : nil }
        let maxSongs = extMax ?? Int(basic.maxMusicCount)
        let limits = (ext?.formatsRestrictions ?? []).map { r in
            MusicFormatLimit(
                formatIndex: Int(r.formatIdx), format: r.name,
                sampleRates: (r.sampleRates ?? []).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty },
                bitrate: r.bitrate >= 0 ? Int(r.bitrate) : nil, channels: Int(r.channels)
            )
        }
        return MusicInfo(
            freeSpaceMb: space > 0 ? space : nil, formats: formats, maxSongs: maxSongs > 0 ? maxSongs : nil, songCount: Int(basic.currentMusicCount),
            maxPlaylists: ext.map { Int($0.maxPlaylistCount) }, frameCount: frameCount, limits: limits, extended: ext != nil
        )
    }

    public static func describe(_ c: HuaweiMusicUtils.MusicCapabilities) -> String {
        let restrictions = c.formatsRestrictions.map { list in
            "["
                + list.map { r in
                    "\(r.name ?? String(r.formatIdx)) rates=\(r.sampleRates.map { $0.joined(separator: "/") } ?? "null") encode=\(r.musicEncode) "
                        + "bitrate=\(r.bitrate) channels=\(r.channels) unknownBitrate=\(r.unknownBitrate)"
                }.joined(separator: ", ") + "]"
        } ?? "none"
        return "availableSpace=\(c.availableSpace) MB formats=\(kotlinList(c.supportedFormats)) maxMusicCount=\(c.maxMusicCount) "
            + "currentMusicCount=\(c.currentMusicCount) maxPlaylistCount=\(c.maxPlaylistCount) unknown=\(c.unknown) restrictions=" + restrictions
    }

    private static func message(_ error: Error) -> String {
        if let e = error as? WearError { return e.message }
        return "\(error)"
    }

    private static func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

    private func note(_ message: String, error: Bool = false) {
        log(LogEntry(error ? .error : .info, service: Int(MusicControl.id), "Music: \(message)"))
    }
}
