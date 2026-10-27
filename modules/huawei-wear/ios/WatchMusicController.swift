// Songs on the watch, the module side (`getWatchMusic` ... `deleteWatchSongs` in HuaweiWearModule.ts, types in HuaweiWearMusic.types.ts;
// docs/watch-music.md): the lab switch `WatchExtrasSettings.watchMusicLab` (off: every call refuses), the 25/04 gate, one music operation at
// a time under the link's operation lock, reading the picked file and its tags, and cancelling a running upload. Watch traffic is
// `WatchMusicOps` (HuaweiProtocol/WatchMusic.swift). Every step is logged (`Music:` lines). Port of WatchMusicController.kt; the tags come
// from AVFoundation's common metadata where Android uses MediaMetadataRetriever.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif
#if canImport(AVFoundation)
import AVFoundation
#endif

#if canImport(SQLite3) || canImport(CSQLite)

public final class WatchMusicController: @unchecked Sendable {
    public static let progressIntervalMs = 200

    private let settings: WatchExtrasSettings
    private let link: LinkHandleSource
    private let events: WearEvents
    private let progressIntervalMs: Int
    private let lock = NSLock()
    private var busy = false
    private var upload: Task<SongUploadOutcome, Error>?
    private var cancelRequested = false

    public init(settings: WatchExtrasSettings, link: LinkHandleSource, events: WearEvents, progressIntervalMs: Int = WatchMusicController.progressIntervalMs) {
        self.settings = settings
        self.link = link
        self.events = events
        self.progressIntervalMs = progressIntervalMs
    }

    private func log(_ message: String) { events.log(LogEntry(.info, service: Int(MusicControl.id), "Music: \(message)")) }

    /// `WatchMusicStatus` of HuaweiWearMusic.types.ts.
    public func status() -> [String: Any] {
        let caps = link.handle()?.caps
        return [
            "enabled": settings.watchMusicLab,
            "connected": caps != nil,
            "uploadSupported": caps?.supports(Int(MusicControl.id), Int(MusicControl.MusicInfoParams.id)) ?? false,
            "extendedInfo": caps?.supports(Int(MusicControl.id), Int(MusicControl.ExtendedMusicInfoParams.id)) ?? false,
            "moreMusic": caps?.expandCapability(WatchMusicOps.bitMoreMusic) ?? false,
            "uploading": lock.locked { upload != nil },
        ]
    }

    public func setEnabled(_ enabled: Bool) {
        settings.watchMusicLab = enabled
        log("lab switch \(enabled ? "on" : "off")")
        if !enabled { _ = cancel() }
    }

    public func info() async throws -> [String: Any] {
        try await withWatch { ops, caps in try await ops.info(extended: Self.extended(caps)).toJS() }
    }

    public func list() async throws -> [String: Any] {
        try await withWatch { ops, caps in
            let info = try await ops.info(extended: Self.extended(caps))
            let list = try await ops.list(info: info, moreMusic: caps.expandCapability(WatchMusicOps.bitMoreMusic))
            return Self.listJS(info, list)
        }
    }

    public func delete(ids: [Int]) async throws -> [String: Any] {
        if ids.isEmpty { throw WearError(.invalidArgument, "No songs to delete") }
        if ids.contains(where: { !(0...0xFFFF).contains($0) }) { throw WearError(.invalidArgument, "Song ids are 16-bit numbers, got \(kotlinList(ids))") }
        return try await withWatch { ops, _ in Self.deleteJS(try await ops.delete(ids: ids)) }
    }

    /// Reads and checks `uri` (named `name`), then sends it. The send runs as a child task that `cancel` stops; the call then resolves with
    /// status `cancelled`, the watch is left without its next chunk and drops the partial file on its own [INFERENCE, unverified].
    public func upload(uri: String, name: String) async throws -> [String: Any] {
        try await withWatch { ops, caps in
            let fileName = MusicFiles.watchFileName(name)
            if MusicFiles.formatOfExtension(fileName) == nil {
                throw WearError(.invalidArgument, "'\(fileName)' is not an MP3, M4A or AAC file. JoyoFit sends these as they are and converts nothing.")
            }
            let data = try await Task.detached {
                try PickedFile.read(
                    uri: uri, maxBytes: MusicFiles.maxFileBytes,
                    tooLarge: "Songs up to \(MusicFiles.maxFileBytes / 1024 / 1024) MiB can be sent (the upload holds the file in memory)"
                )
            }.value
            let info = try await ops.info(extended: Self.extended(caps))
            let probe = try MusicFiles.check(name: fileName, data: data, info: info)
            let (title, artist) = await tags(uri: uri, fileName: fileName)
            let song = SongFile(fileName: fileName, data: data, probe: probe, title: title, artist: artist)
            if let limit = info.limits.first(where: { $0.format == probe.format.wire }) {
                let rate = probe.sampleRate
                let outside = rate != nil && !limit.sampleRates.isEmpty && !limit.sampleRates.contains(String(rate!))
                log(
                    "25/0D limits for \(probe.format.wire): rates \(kotlinList(limit.sampleRates)) bitrate \(limit.bitrate.map(String.init) ?? "?") "
                        + "channels \(limit.channels); the file's first frame: \(rate.map(String.init) ?? "?") Hz"
                        + (outside ? " (NOT in the list; sent anyway, the table is unverified)" : "")
                )
            }
            let throttle = ProgressThrottle(intervalMs: progressIntervalMs)
            let events = self.events
            let progress: @Sendable (Int, Int) -> Void = { done, total in
                if throttle.shouldEmit(done: done, total: total) { events.uploadProgress(bytes: done, total: total) }
            }
            let started = Self.nowMs()
            let task = Task { try await ops.upload(song, onProgress: progress) }
            lock.locked {
                upload = task
                cancelRequested = false
            }
            defer {
                lock.locked {
                    upload = nil
                    cancelRequested = false
                }
            }
            do {
                let outcome = try await withTaskCancellationHandler { try await task.value } onCancel: { task.cancel() }
                events.uploadResult(ok: true, fileName: fileName, code: outcome.uploadStatus, message: "uploaded")
                return Self.uploadJS(song, status: "uploaded", ms: outcome.uploadMs, uploadStatus: outcome.uploadStatus, infoAnswered: outcome.infoAnswered)
            } catch where !Task.isCancelled && lock.locked({ cancelRequested }) {
                // `cancel` stopped it: whatever the stopped transfer threw, the user's cancel is the outcome.
                let elapsed = Self.nowMs() - started
                log("upload of \(fileName) cancelled after \(elapsed / 1000) s")
                events.uploadResult(ok: false, fileName: fileName, code: nil, message: "cancelled")
                return Self.uploadJS(song, status: "cancelled", ms: elapsed, uploadStatus: nil, infoAnswered: false)
            } catch let e as WearError {
                events.uploadResult(ok: false, fileName: fileName, code: e.statusCode, message: e.message)
                throw e
            }
        }
    }

    /// Stops a running upload; true when one ran.
    public func cancel() -> Bool {
        let running: Task<SongUploadOutcome, Error>? = lock.locked {
            guard let running = upload else { return nil }
            cancelRequested = true
            return running
        }
        guard let running else { return false }
        log("cancel requested")
        running.cancel()
        return true
    }

    // MARK: JS shapes

    /// `WatchMusicList`.
    static func listJS(_ info: MusicInfo, _ list: WatchSongList) -> [String: Any] {
        ["info": info.toJS(), "songs": list.songs.map { $0.toJS() }, "pages": list.pages]
    }

    /// `WatchSongDeleteResult`.
    static func deleteJS(_ outcome: SongDeleteOutcome) -> [String: Any] {
        ["ids": outcome.ids, "ok": outcome.ok, "code": outcome.code.map { $0 as Any } ?? NSNull()]
    }

    /// `WatchSongUploadResult`.
    static func uploadJS(_ song: SongFile, status: String, ms: Int64, uploadStatus: Int?, infoAnswered: Bool) -> [String: Any] {
        [
            "status": status,
            "fileName": song.fileName,
            "title": song.title,
            "artist": song.artist,
            "format": song.probe.format.wire,
            "bytes": song.data.count,
            "uploadMs": ms,
            "uploadStatus": uploadStatus.map { $0 as Any } ?? NSNull(),
            "infoAnswered": infoAnswered,
        ]
    }

    // MARK: helpers

    private static func extended(_ caps: DeviceCaps) -> Bool {
        caps.supports(Int(MusicControl.id), Int(MusicControl.ExtendedMusicInfoParams.id))
    }

    private static func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

    /// The switch, a connection, the 25/04 gate, one music call at a time, then the link's operation lock (syncs wait or are waited for).
    private func withWatch<T>(_ body: (WatchMusicOps, DeviceCaps) async throws -> T) async throws -> T {
        if !settings.watchMusicLab {
            throw WearError(.unsupported, "Songs on the watch are a lab feature; switch them on under Experimental first")
        }
        guard let handle = link.handle() else { throw notConnected() }
        if !handle.caps.supports(Int(MusicControl.id), Int(MusicControl.MusicInfoParams.id)) {
            throw WearError(.unsupported, "The watch does not list music storage (25/04) in its supported commands")
        }
        let taken = lock.locked { () -> Bool in
            if busy { return false }
            busy = true
            return true
        }
        if !taken { throw WearError(.busy, "Another music operation is running") }
        defer { lock.locked { busy = false } }
        return try await handle.operationLock.withLock {
            // The link may have dropped while this waited for a sync to end.
            guard let current = link.handle(), current.session === handle.session else { throw notConnected() }
            return try await body(WatchMusicOps(session: handle.session, caps: handle.caps, log: events.sink), handle.caps)
        }
    }

    private func notConnected() -> WearError { WearError(.notConnected, "Not connected to a watch") }

    /// Title and artist from the file's tags (Gadgetbridge `MusicUtils.audioInfoFromUri`), with its fallbacks.
    private func tags(uri: String, fileName: String) async -> (title: String, artist: String) {
        var title: String?
        var artist: String?
        do {
            (title, artist) = try await Self.readTags(uri: uri)
        } catch {
            log("tags of \(fileName) not readable (\(error.localizedDescription)); using the file name")
        }
        func present(_ s: String?) -> String? {
            guard let trimmed = s?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else { return nil }
            return trimmed
        }
        return (present(title) ?? MusicFiles.titleFallback(fileName), present(artist) ?? MusicFiles.unknownArtist)
    }

    /// The common-metadata title and artist of the picked file (ID3 for MP3, the iTunes atoms for M4A).
    private static func readTags(uri: String) async throws -> (String?, String?) {
        guard let url = PickedFile.fileURL(uri) else { throw WearError(.invalidArgument, "Could not open \(uri)") }
        #if canImport(AVFoundation)
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let items = try await AVURLAsset(url: url).load(.commonMetadata)
        let title = try await AVMetadataItem.metadataItems(from: items, filteredByIdentifier: .commonIdentifierTitle).first?.load(.stringValue)
        let artist = try await AVMetadataItem.metadataItems(from: items, filteredByIdentifier: .commonIdentifierArtist).first?.load(.stringValue)
        return (title, artist)
        #else
        throw WearError(.unsupported, "AVFoundation is not available")
        #endif
    }
}

#endif
