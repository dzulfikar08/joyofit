// Answers the watch's PhoneInfo request (01/10, GB AsynchronousResponse.handlePhoneInfo + GetPhoneInfoRequest), telling it the phone is
// an iPhone. Unanswered, a Band 9 ran its Remote shutter as on Android (shutter button at once, expecting the app to take the picture)
// instead of the iPhone flow ("Open Camera on your phone first", then a volume key the Camera app takes as its shutter).
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif
#if canImport(UIKit)
import UIKit
#endif

enum PhoneInfoResponder {
    /// Subscribes on a fresh session, before authentication, because the watch may ask during the connect handshake.
    static func install(on session: HuaweiSession, model: String, events: WearEvents) async {
        _ = await session.subscribe(service: DeviceConfig.id, command: DeviceConfig.PhoneInfo.id, label: "phone info") { [weak session] packet in
            guard let session, let tlv = packet.tlv else { return }
            if DeviceConfig.PhoneInfo.isAck(tlv) { return }
            let tags = DeviceConfig.PhoneInfo.requestedTags(tlv)
            let reply = DeviceConfig.PhoneInfo.reply(
                tags: tags, platform: DeviceConfig.PhoneInfo.platformIos, manufacturer: "Apple", model: model, osVersion: osVersion()
            )
            events.info("Phone info: the watch asked for tags \(tags.map { String(format: "%02X", $0) }.joined(separator: " ")); answering as an iPhone")
            Task {
                do {
                    try await session.send(reply, label: "PhoneInfo")
                } catch {
                    events.error("Phone info: answer not sent: \((error as? WearError)?.message ?? "\(error)")")
                }
            }
        }
    }

    private static func osVersion() -> String {
        #if canImport(UIKit)
        return UIDevice.current.systemVersion
        #else
        let v = ProcessInfo.processInfo.operatingSystemVersion
        return "\(v.majorVersion).\(v.minorVersion)"
        #endif
    }
}
