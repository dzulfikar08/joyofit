// The watch face part of the module (`listWatchfaces` ... `deleteWatchface` in HuaweiWearModule.ts): serializes every operation with the
// link's operation lock, reads `.hwt` files from the picker's URI and turns progress and outcome into `onUploadProgress` / `onUploadResult`
// events. Port of the WatchfaceController of WatchfaceManager.kt.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

/// Where a feature gets the live session from; `WearLink` is the one implementation, tests bring their own.
public protocol LinkHandleSource: AnyObject, Sendable {
    func handle() -> LinkHandle?
}

extension WearLink: LinkHandleSource {}

public final class WatchfaceController: @unchecked Sendable {
    private let link: LinkHandleSource
    private let events: WearEvents
    private let progressIntervalMs: Int

    public init(link: LinkHandleSource, events: WearEvents, progressIntervalMs: Int = 200) {
        self.link = link
        self.events = events
        self.progressIntervalMs = progressIntervalMs
    }

    public func list() async throws -> [String: Any] { try await withWatch { ops in try await ops.list().toJS() } }

    /// The watch's face list as entries, for callers that need flags rather than the JS map (face customization).
    public func entries() async throws -> [WatchfaceEntry] { try await withWatch { ops in try await ops.list().faces } }

    public func setActive(_ id: String) async throws -> [String: Any] { try await withWatch { ops in try await ops.setActive(id).toJS() } }

    public func delete(_ id: String) async throws -> [String: Any] { try await withWatch { ops in try await ops.delete(id).toJS() } }

    /// `signature` is a Huawei signature response string (Huawei Health sends it in tag 0x08 of the announcement). `fileName` overrides the
    /// random `<id>_<version>` install name; a replayed signature only names the face id and version it was issued for, so both must match
    /// that face.
    public func install(uri: String, signature: String? = nil, fileName: String? = nil, gadgetbridge: Bool = false) async throws -> [String: Any] {
        guard link.handle() != nil else { throw notConnected() }
        let bytes = try await Task.detached { try PickedFile.read(uri: uri) }.value
        let package = try WatchfacePackages.parse(bytes)
        // Gadgetbridge uploads under version 1.0.0 and skips the 27/03 announce; see WatchfaceOps.install(gadgetbridge:).
        let name = fileName
            ?? (gadgetbridge ? WatchfacePackages.randomName(version: "1.0.0") : WatchfacePackages.randomName(version: package.description.version))
        if let fileName, fileName.firstIndex(of: "_") == nil || fileName.hasPrefix("_") {
            throw WearError(.invalidArgument, "The install name must be `<id>_<version>`, got '\(fileName)'")
        }
        let throttle = ProgressThrottle(intervalMs: progressIntervalMs)
        let events = self.events
        let progress: @Sendable (Int, Int) -> Void = { done, total in
            if throttle.shouldEmit(done: done, total: total) { events.uploadProgress(bytes: done, total: total) }
        }
        return try await withWatch { ops in
            do {
                let result = try await ops.install(package, progress: progress, fileName: name, signature: signature, gadgetbridge: gadgetbridge)
                events.uploadResult(ok: result.listed, fileName: result.fileName, code: result.uploadStatus, message: result.message)
                return result.toJS()
            } catch let e as WearError {
                events.uploadResult(ok: false, fileName: name, code: e.statusCode, message: e.message)
                throw e
            }
        }
    }

    private func withWatch<T>(_ body: (WatchfaceOps) async throws -> T) async throws -> T {
        guard let handle = link.handle() else { throw notConnected() }
        return try await handle.operationLock.withLock {
            // The link may have dropped while this waited for a sync to end.
            guard let current = link.handle(), current.session === handle.session else { throw notConnected() }
            return try await body(WatchfaceOps(session: handle.session, caps: handle.caps, log: events.sink))
        }
    }

    private func notConnected() -> WearError { WearError(.notConnected, "Not connected to a watch") }
}

/// Emits the first and the last progress report and at most one per interval between them.
final class ProgressThrottle: @unchecked Sendable {
    private let lock = NSLock()
    private let intervalNs: UInt64
    private var lastEmit: UInt64 = 0

    init(intervalMs: Int) { intervalNs = UInt64(max(intervalMs, 0)) * 1_000_000 }

    func shouldEmit(done: Int, total: Int) -> Bool {
        lock.locked {
            let now = DispatchTime.now().uptimeNanoseconds
            if done >= total || done == 0 || now &- lastEmit >= intervalNs {
                lastEmit = now
                return true
            }
            return false
        }
    }
}

#endif
