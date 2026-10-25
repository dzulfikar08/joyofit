// The photo face part of the module (`getPhotoFace` ... `setPhotoFaceActive` in HuaweiWearModule.ts): finds the watch's photo face, serializes
// every operation with the link's operation lock, decodes the picked photo and turns progress and outcome into `onUploadProgress` /
// `onUploadResult` events. Port of the PhotoFaceController of PhotoFaceUploader.kt.
//
// The picture must be a PNG of exactly the watch's screen size (the crop screen produces it): the Android code lets BitmapFactory read any
// format, here the PNG decoder of the protocol package reads the pixels, which keeps the conversion to the watch's `.bin` testable anywhere.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

/// Photos kept on the phone for the ones JoyoFit uploaded, so the screen can show them; the watch itself offers no preview.
public final class PhotoStore: @unchecked Sendable {
    private let dir: URL

    public init(directory: URL) { dir = directory }

    /// `Application Support/photoface`, the counterpart of Android's `filesDir/photoface`.
    public static var defaultDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("photoface", isDirectory: true)
    }

    func file(_ name: String) -> URL { dir.appendingPathComponent(name.replacingOccurrences(of: "/", with: "_")) }

    func save(_ name: String, _ png: Bytes) throws {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try Data(png).write(to: file(name), options: .atomic)
    }

    func delete(_ name: String) { try? FileManager.default.removeItem(at: file(name)) }

    /// The local copy's `file://` URI, nil when this phone never uploaded the photo.
    func uri(_ name: String) -> String? {
        let url = file(name)
        return FileManager.default.fileExists(atPath: url.path) ? url.absoluteString : nil
    }

    /// Drops copies of photos the watch no longer lists.
    func keepOnly(_ names: [String]) {
        guard let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else { return }
        for url in files where !names.contains(url.lastPathComponent) { try? FileManager.default.removeItem(at: url) }
    }
}

/// The photo face on the watch with its settings and the screen it was read with.
struct PhotoFaceState {
    let face: WatchfaceEntry
    let info: PhotoFaceInfo
    let width: Int
    let height: Int
    let updatedAtMs: Int64
}

public final class PhotoFaceController: @unchecked Sendable {
    private let link: LinkHandleSource
    private let events: WearEvents
    private let store: PhotoStore
    private let progressIntervalMs: Int
    private let maxPhotoBytes = 16_000_000

    public init(link: LinkHandleSource, events: WearEvents, store: PhotoStore = PhotoStore(directory: PhotoStore.defaultDirectory), progressIntervalMs: Int = 100) {
        self.link = link
        self.events = events
        self.store = store
        self.progressIntervalMs = progressIntervalMs
    }

    public func info() async throws -> [String: Any] {
        try await withWatch { watchfaces, photos in try await self.state(watchfaces, photos).toJS(self.store) }
    }

    /// `uri` is a PNG already cropped to the face's resolution (the crop screen does it); anything else is refused.
    public func add(uri: String) async throws -> [String: Any] {
        guard link.handle() != nil else { throw notConnected() }
        let max = maxPhotoBytes
        let png = try await Task.detached { try PickedFile.read(uri: uri, maxBytes: max, tooLarge: "The photo is larger than \(max / 1_000_000) MB.") }.value
        let throttle = ProgressThrottle(intervalMs: progressIntervalMs)
        let events = self.events
        let progress: @Sendable (Int, Int) -> Void = { done, total in
            if throttle.shouldEmit(done: done, total: total) { events.uploadProgress(bytes: done, total: total) }
        }
        return try await withWatch { watchfaces, photos in
            let before = try await self.state(watchfaces, photos)
            var name = ""
            do {
                let max = before.info.maxPhotos
                if max > 0 && before.info.photos.count >= max {
                    throw WearError(.invalidArgument, "The photo face holds \(max) photos already; delete one first.")
                }
                let pixels = try Self.decode(png, before.width, before.height)
                let format = PhotoBin.Format.from(option: before.info.imageOption)
                let bin: Bytes
                do {
                    bin = try PhotoBin.encode(pixels, width: before.width, height: before.height, format: format)
                } catch {
                    throw WearError(.invalidArgument, "The photo cannot be converted for the watch: \(error)")
                }
                name = Self.freshName(before.info.photos.map(\.name))
                events.info("Photo face: adding \(name) (\(before.width)x\(before.height), \(png.count) byte png, \(bin.count) byte \(format.name) bin)")
                let names = before.info.photos.map(\.name) + [name]
                let result = try await photos.save(before.info, names: names, files: [name: PhotoFiles(png: png, bin: bin)], progress: progress)
                do {
                    try self.store.save(name, png)
                } catch {
                    events.error("Photo face: the local copy of \(name) could not be kept: \(error)")
                }
                let applyProblem = try await self.reapply(watchfaces, before.face)
                let after = try await self.state(watchfaces, photos)
                let failed = result.failedNum ?? 0
                let listed = after.info.photos.contains { $0.name == name }
                let message: String
                if !listed {
                    message = "The watch took the photo but does not list it."
                } else if failed > 0 {
                    message = "The watch reported \(failed) photo(s) it could not take."
                } else if let applyProblem {
                    message = "Photo added, but \(applyProblem)."
                } else {
                    message = "Photo added."
                }
                events.uploadResult(ok: listed && failed == 0, fileName: name, code: nil, message: message)
                return after.toJS(self.store)
            } catch let e as WearError {
                events.uploadResult(ok: false, fileName: name.isEmpty ? "photo" : name, code: e.statusCode, message: e.message)
                throw e
            }
        }
    }

    public func delete(name: String) async throws -> [String: Any] {
        try await withWatch { watchfaces, photos in
            let before = try await self.state(watchfaces, photos)
            guard before.info.photos.contains(where: { $0.name == name }) else {
                throw WearError(.invalidArgument, "The photo face has no photo named '\(name)'")
            }
            let names = before.info.photos.map(\.name).filter { $0 != name }
            _ = try await photos.save(before.info, names: names, files: [:])
            self.store.delete(name)
            _ = try await self.reapply(watchfaces, before.face)
            let after = try await self.state(watchfaces, photos)
            if after.info.photos.contains(where: { $0.name == name }) {
                throw WearError(.uploadRejected, "The watch still lists the photo after it was removed.")
            }
            return after.toJS(self.store)
        }
    }

    /// Makes the photo face the active face (the ordinary 27/03 activation of an installed face).
    public func setActive() async throws -> [String: Any] {
        try await withWatch { watchfaces, photos in
            let list = try await watchfaces.list()
            guard let face = list.faces.first(where: { $0.isPhoto }) else { throw Self.noPhotoFace() }
            if !face.isCurrent { _ = try await watchfaces.setActive(face.id) }
            return try await self.state(watchfaces, photos).toJS(self.store)
        }
    }

    /// 27/03 operation 1 for the photo face after a save, as Huawei Health's Apply does (protocol/README.md, "Photo faces"): the face is
    /// applied again, current or not, so the watch rebuilds it from the new list (the expectation is that this drops its "add photo"
    /// prompt; UNVERIFIED). The photos are saved already, so a refusal is reported, not thrown. Nil when the watch took it.
    private func reapply(_ watchfaces: WatchfaceOps, _ face: WatchfaceEntry) async throws -> String? {
        let problem: String?
        do {
            if let code = try await watchfaces.apply(face), code != PhotoFaceCodec.statusOK {
                problem = "the watch answered \(code) when the photo face was applied again"
            } else {
                problem = nil
            }
        } catch let e as WearError {
            if e.code == .disconnected { throw e }
            problem = "applying the photo face again failed: \(e.message)"
        }
        if let problem { events.error("Photo face: \(problem)") }
        return problem
    }

    private func state(_ watchfaces: WatchfaceOps, _ photos: PhotoFaceOps) async throws -> PhotoFaceState {
        let list = try await watchfaces.list()
        guard let face = list.faces.first(where: { $0.isPhoto }) else { throw Self.noPhotoFace() }
        guard let screen = list.screen else {
            throw WearError(.unsupported, "The watch did not report its screen size, so photos cannot be cropped for it.")
        }
        let info = try await photos.readInfo()
        store.keepOnly(info.photos.map(\.name))
        return PhotoFaceState(face: face, info: info, width: screen.width, height: screen.height, updatedAtMs: list.updatedAtMs)
    }

    static func noPhotoFace() -> WearError {
        WearError(
            .unsupported,
            "The watch has no photo watch face. Install a photo face (type bit 5 in the watch's face list, e.g. the Gallery face) from Huawei's store first."
        )
    }

    /// `<epoch millis>.png`, bumped until it differs from every name on the watch.
    static func freshName(_ existing: [String]) -> String {
        var stamp = Int64(Date().timeIntervalSince1970 * 1000)
        while existing.contains("\(stamp).png") { stamp += 1 }
        return "\(stamp).png"
    }

    /// The pixels of `png` (0xAARRGGBB, row by row); the size must be exactly the face's.
    static func decode(_ png: Bytes, _ width: Int, _ height: Int) throws -> [UInt32] {
        let image: PngImage
        do {
            image = try PngDecoder.decode(png)
        } catch {
            throw WearError(.invalidArgument, "The photo could not be decoded as a PNG image (\(error)). The photo face needs a PNG of exactly \(width) x \(height) px.")
        }
        guard image.width == width, image.height == height else {
            throw WearError(
                .invalidArgument,
                "The photo is \(image.width) x \(image.height) px; the watch's photo face needs exactly \(width) x \(height) px. Crop it first."
            )
        }
        return image.argb
    }

    private func withWatch<T>(_ body: (WatchfaceOps, PhotoFaceOps) async throws -> T) async throws -> T {
        guard let handle = link.handle() else { throw notConnected() }
        return try await handle.operationLock.withLock {
            guard let current = link.handle(), current.session === handle.session else { throw notConnected() }
            return try await body(
                WatchfaceOps(session: handle.session, caps: handle.caps, log: events.sink),
                PhotoFaceOps(session: handle.session, caps: handle.caps, log: events.sink)
            )
        }
    }

    private func notConnected() -> WearError { WearError(.notConnected, "Not connected to a watch") }
}

extension PhotoFaceState {
    /// `PhotoFace` in `HuaweiWearPhotoFace.types.ts`.
    func toJS(_ store: PhotoStore) -> [String: Any] {
        [
            "face": face.toJS(), "width": width, "height": height, "maxPhotos": info.maxPhotos, "imageOption": info.imageOption,
            "backgroundType": info.backgroundType, "intellectColour": info.intellectColour,
            "positionIndex": info.positionIndex.map { $0 as Any } ?? NSNull(), "styleIndex": info.styleIndex.map { $0 as Any } ?? NSNull(),
            "dataIndex": info.dataIndex.map { $0 as Any } ?? NSNull(),
            "photos": info.photos.map { ["index": $0.index, "name": $0.name, "uri": store.uri($0.name).map { $0 as Any } ?? NSNull()] as [String: Any] },
            "updatedAt": updatedAtMs,
        ]
    }
}

#endif
