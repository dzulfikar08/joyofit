// Port of CameraRemoteController.kt (GB HuaweiSupportProvider camera parts, AsynchronousResponse.handleCameraRemote): the watch's
// Remote shutter, for the phone's own camera app. At connect the phone announces its camera (01/2A, 0), which makes the watch show the
// app. Each open, shutter and close from the watch is acknowledged (01/29, 7F = 100000) as Huawei Health does. The shutter itself is not ours: the watch is also a Bluetooth keyboard and each press sends a volume key, which the Camera app
// takes as its shutter. Unlike Android, the watch's open (01/29, 1) gets no "camera started" (see onStatus); its close (3) gets
// "camera stopped" (01/2A, 2). All of it in native code so it works while JoyoFit is in the background. The events still go to JS as
// `onCameraRemote`, for the log only.
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

    public init(link: LinkHandleSource, events: WearEvents) {
        self.link = link
        self.events = events
    }

    private func log(_ message: String) { events.info(message) }

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
        _ = await session.subscribe(service: CameraRemote.id, command: CameraRemote.Status.id, label: "camera remote") { [weak self, weak session] packet in
            guard let self, let session else { return }
            self.onStatus(packet, session: session)
        }
        await send(.enableCamera, session: session)
    }

    public func linkDisconnected() {
        lock.locked { attached = nil }
    }

    private func onStatus(_ packet: HuaweiPacket, session: HuaweiSession) {
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
        // An open is not answered with "camera started": an iPhone app cannot open the Camera, so the watch is left to tell the person
        // "Open Camera on your phone first", as with Huawei Health on an iPhone. Answering it made a Band 9 show its shutter at once,
        // the Android flow, and no picture was taken (2026-11-05). Suspected cause, not yet confirmed on a device.
        let answer: CameraRemote.Setup.Event? = event == .closeCamera ? .cameraStopped : nil
        Task {
            await self.acknowledge(session: session)
            if let answer { await self.send(answer, session: session) }
        }
        events.cameraRemote(["action": event.rawValue])
    }

    /// Every open, shutter and close is acknowledged (01/29, 7F = 100000), as Huawei Health does; the watch waits for it.
    private func acknowledge(session: HuaweiSession) async {
        do {
            try await session.send(CameraRemote.Status.ack(), label: "CameraRemoteStatus ack")
        } catch {
            events.error("Camera remote: acknowledgement not sent: \((error as? WearError)?.message ?? "\(error)")")
        }
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
