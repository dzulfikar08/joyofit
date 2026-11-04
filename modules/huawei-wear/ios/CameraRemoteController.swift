// Port of CameraRemoteController.kt (GB HuaweiSupportProvider camera parts, AsynchronousResponse.handleCameraRemote): the watch's
// Remote shutter app. At connect the phone announces its camera (01/2A, 0), which makes the watch show the app; the watch's open,
// take picture and close (01/29) go to JS as `onCameraRemote`, whose camera screen answers with `cameraStarted` / `cameraStopped`.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

public final class CameraRemoteController: LinkObserver, @unchecked Sendable {
    private let link: LinkHandleSource
    private let events: WearEvents
    private let lock = NSLock()
    private var attached: HuaweiSession?
    /// What JS last reported: the phone's viewfinder is on screen. Re-sent on a reconnect so the watch does not wait for it.
    private var phoneOpen = false

    public init(link: LinkHandleSource, events: WearEvents) {
        self.link = link
        self.events = events
    }

    private func log(_ message: String) { events.info(message) }

    public func status() -> [String: Any] {
        let handle = link.handle()
        return [
            "connected": handle != nil,
            "supported": handle.map { CameraRemote.supported($0.caps) } ?? false,
        ]
    }

    // MARK: LinkObserver

    public func linkConnected(_ handle: LinkHandle) async {
        let session = handle.session
        let fresh: Bool = lock.locked {
            if attached === session { return false }
            attached = session
            return true
        }
        if !fresh { return }
        guard CameraRemote.supported(handle.caps) else {
            log("Camera remote: the watch does not list 01/29; not announced")
            return
        }
        _ = await session.subscribe(service: CameraRemote.id, command: CameraRemote.Status.id, label: "camera remote") { [weak self] packet in
            self?.onStatus(packet)
        }
        await send(.enableCamera, session: session)
        if lock.locked({ phoneOpen }) { await send(.cameraStarted, session: session) }
    }

    public func linkDisconnected() {
        lock.locked { attached = nil }
    }

    private func onStatus(_ packet: HuaweiPacket) {
        let event: CameraRemote.Status.Event?
        do {
            event = try CameraRemote.Status.Response(packet: packet).event
        } catch {
            events.error("Camera remote: could not parse the watch's packet: \(error)")
            return
        }
        guard let event else {
            log("Camera remote: unknown event from the watch")
            return
        }
        log("Camera remote: the watch sent \(event.rawValue)")
        events.cameraRemote(["action": event.rawValue])
    }

    // MARK: from JS

    /// The camera screen is showing (`true`, "camera started") or has closed (`false`, "camera stopped").
    public func setPhoneCamera(open: Bool) async {
        lock.locked { phoneOpen = open }
        guard let handle = link.handle(), CameraRemote.supported(handle.caps) else { return }
        await send(open ? .cameraStarted : .cameraStopped, session: handle.session)
    }

    private func send(_ event: CameraRemote.Setup.Event, session: HuaweiSession) async {
        do {
            try await session.send(CameraRemote.Setup.request(event), label: "CameraRemoteSetup \(event)")
        } catch {
            events.error("Camera remote: \(event) not sent: \((error as? WearError)?.message ?? "\(error)")")
        }
    }
}

#endif
