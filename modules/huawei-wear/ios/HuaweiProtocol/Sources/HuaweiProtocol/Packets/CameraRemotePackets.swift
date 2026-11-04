// Port of CameraRemote.java (Gadgetbridge, AGPL-3.0-or-later; see NOTICE): the watch's remote shutter. It shares service 0x01 with
// DeviceConfig. The phone announces the camera at connect (01/2A, tag 01 = 0); only then does the watch list its Remote shutter app.
// The watch pushes open, take picture and close (01/29, tag 01 = 1, 2, 3); the phone answers "camera started" (01/2A, 1) once its
// viewfinder runs and "camera stopped" (01/2A, 2) when it closes.
import Foundation

public enum CameraRemote {
    public static let id: UInt8 = 0x01

    /// The watch lists the status command: GB's `supportsCameraRemote` (`supportsCommandForService(0x01, 0x29)`).
    public static func supported(_ caps: DeviceCaps) -> Bool { caps.supports(Int(id), Int(Status.id)) }

    public enum Setup {
        public static let id: UInt8 = 0x2A

        public enum Event: UInt8, Sendable {
            case enableCamera = 0x00
            case cameraStarted = 0x01
            case cameraStopped = 0x02
        }

        public static func request(_ event: Event) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, byte: event.rawValue)
            return HuaweiPacket(serviceId: CameraRemote.id, commandId: id, tlv: tlv, isEncrypted: true)
        }
    }

    public enum Status {
        public static let id: UInt8 = 0x29

        public enum Event: String, Sendable {
            case openCamera = "open"
            case takePicture = "shutter"
            case closeCamera = "close"
        }

        public struct Response: PacketResponse {
            /// Nil for a value GB does not know (it leaves its event unset and does nothing).
            public var event: Event?

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "CameraRemoteStatus")
                let raw = try PacketsJava.parsing("CameraRemoteStatus") { try tlv.byte(0x01) }
                switch raw {
                case 1: event = .openCamera
                case 2: event = .takePicture
                case 3: event = .closeCamera
                default: event = nil
                }
            }
        }
    }
}
