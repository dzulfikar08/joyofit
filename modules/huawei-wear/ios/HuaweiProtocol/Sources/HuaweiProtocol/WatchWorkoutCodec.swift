// Port of WatchWorkout.kt (`WatchWorkoutWire`): a workout started from the phone, Huawei Health's "phone-started linkage" over the legacy
// workout service. Reconstructed from Huawei Health 17.0.8.300, UNVERIFIED on a watch; Gadgetbridge has no phone-started workout.
//  - `17/01` SetOperator, phone to watch: `81{02 operator, 03 linkage kind, 05 workout type, 06 operation time s, 87{08 distance dm,
//    09 calories, 0A duration}, [0B version], 0C start time s, [0D run course version], [0E forbid pause]}`. Operator 1 start, 2 pause,
//    3 resume, 4 stop. The watch answers `7F <code>` (100000 accepts) or an empty body.
//  - `17/02` operator notice, watch to phone, when the person pauses, resumes or stops on the watch; answered `7F 04 <100000>`.
//  - `17/03` operator status, phone to watch, `81 00`: asked once after a start to see whether the watch really runs it.
// Huawei gates the feature on `17/01` being listed in SupportedCommands; the optional tags on `17/12` ("version", "run course version") and
// `17/15` ("forbid pause"). The workout type is in the watch's own sport space (Gadgetbridge's sport table): 140 is strength training.
import Foundation

public enum WatchWorkoutWire {
    public static let service: UInt8 = 0x17
    public static let setOperator: UInt8 = 0x01
    public static let operatorNotice: UInt8 = 0x02
    public static let getOperator: UInt8 = 0x03
    public static let openCloseReport: UInt8 = 0x12
    public static let workoutCapability: UInt8 = 0x15

    public static let opStart = 1
    public static let opPause = 2
    public static let opResume = 3
    public static let opStop = 4

    /// Tag 03: 1 is a single track workout; 2 is a run-plan session, which JoyoFit never sends.
    public static let linkSingleTrack = 1

    /// Gadgetbridge's sport table: STRENGTH_TRAINING.
    public static let sportStrengthTraining = 140

    public static let ok = 100_000

    /// Optional tags the watch's SupportedCommands ask for.
    public struct Shape: Equatable, Sendable {
        public let linkTags: Bool
        public let forbidPause: Bool
        public init(linkTags: Bool, forbidPause: Bool) {
            self.linkTags = linkTags
            self.forbidPause = forbidPause
        }
    }

    /// `17/12` listed: Huawei sends the version and run course tags; `17/15` listed: it sends forbid pause.
    public static func shape(supports: (_ service: Int, _ command: Int) -> Bool) -> Shape {
        Shape(linkTags: supports(Int(service), Int(openCloseReport)), forbidPause: supports(Int(service), Int(workoutCapability)))
    }

    /// `ego.e(int)`: the shortest big-endian bytes of a non-negative value, at least one.
    public static func minimalBytes(_ value: Int) -> Bytes {
        precondition(value >= 0, "negative value \(value)")
        var size = 1
        while size < 4 && (value >> (8 * size)) != 0 { size += 1 }
        return (0..<size).map { UInt8(truncatingIfNeeded: value >> (8 * (size - 1 - $0))) }
    }

    /// The `17/01` TLV. `nowMs` is the operation time, `startMs` the moment the workout started (also sent with pause, resume and stop).
    public static func operatorTLV(op: Int, workoutType: Int, nowMs: Int64, startMs: Int64, shape: Shape) -> HuaweiTLV {
        var counters = HuaweiTLV()
        counters.put(0x08, int: 0)
        counters.put(0x09, int: 0)
        counters.put(0x0A, int: 0)
        var body = HuaweiTLV()
        body.put(0x02, bytes: minimalBytes(op))
        body.put(0x03, bytes: minimalBytes(linkSingleTrack))
        body.put(0x05, bytes: minimalBytes(workoutType))
        body.put(0x06, int: Int32(truncatingIfNeeded: nowMs / 1000))
        body.put(0x87, tlv: counters)
        if shape.linkTags { body.put(0x0B, bytes: minimalBytes(0)) }
        body.put(0x0C, int: Int32(truncatingIfNeeded: startMs / 1000))
        if shape.linkTags { body.put(0x0D, bytes: minimalBytes(0)) }
        if shape.forbidPause { body.put(0x0E, bytes: minimalBytes(0)) }
        var tlv = HuaweiTLV()
        tlv.put(0x81, tlv: body)
        return tlv
    }

    public static func setOperatorRequest(op: Int, workoutType: Int, nowMs: Int64, startMs: Int64, shape: Shape) -> HuaweiPacket {
        HuaweiPacket(serviceId: service, commandId: setOperator, tlv: operatorTLV(op: op, workoutType: workoutType, nowMs: nowMs, startMs: startMs, shape: shape))
    }

    /// `17/03 81 00`.
    public static func statusRequest() -> HuaweiPacket {
        var tlv = HuaweiTLV()
        tlv.put(0x81)
        return HuaweiPacket(serviceId: service, commandId: getOperator, tlv: tlv)
    }

    /// The answer's result code (`7F`), nil when the watch answered without one.
    public static func resultCode(_ tlv: HuaweiTLV?) -> Int? {
        guard let tlv, tlv.contains(0x7F) else { return nil }
        return LiveWorkoutWire.signedWhenFour(tlv.bytes(0x7F, default: nil))
    }

    /// What `17/03` or `17/02` says about the watch's workout. `operatorType`: 1 start, 2 pause, 3 resume, 4 stop. `trainMonitorState` (`17/03`
    /// tag 02): non-zero while the watch counts a workout; 0 with operator 1 is its GO screen (`WatchPhase`).
    public struct WatchOperator: Equatable, Sendable {
        public let operatorType: Int?
        public let sportType: Int?
        public let workoutType: Int?
        public let trainMonitorState: Int?
        public var phase: WatchPhase { WatchPhase.of(trainMonitorState: trainMonitorState, operator: operatorType) }
        public var running: Bool { phase == .running }
    }

    private static func int(_ body: HuaweiTLV, _ tag: Int) -> Int? {
        LiveWorkoutWire.unsigned(body.bytes(tag, default: nil)).map(LiveWorkoutWire.toInt)
    }

    /// `17/03` answer: `81{02 trainMonitorState, 03 operator, 04 sport, 06 workout type}`.
    public static func parseStatus(_ tlv: HuaweiTLV?) -> WatchOperator? {
        guard let tlv, tlv.contains(0x81), let body = try? tlv.object(0x81) else { return nil }
        return WatchOperator(
            operatorType: int(body, 0x03), sportType: int(body, 0x04), workoutType: int(body, 0x06) ?? int(body, 0x04), trainMonitorState: int(body, 0x02)
        )
    }

    /// `17/02` notice: `81{02 operator, 03 sport, 05 workout type}`.
    public static func parseNotice(_ tlv: HuaweiTLV?) -> WatchOperator? {
        guard let tlv else { return nil }
        let body = tlv.contains(0x81) ? ((try? tlv.object(0x81)) ?? tlv) : tlv
        return WatchOperator(operatorType: int(body, 0x02), sportType: int(body, 0x03), workoutType: int(body, 0x05), trainMonitorState: nil)
    }

    /// The answer to a `17/02` notice: `7F 04 <100000>`.
    public static func noticeAck() -> HuaweiPacket {
        var tlv = HuaweiTLV()
        tlv.put(0x7F, int: Int32(ok))
        return HuaweiPacket(serviceId: service, commandId: operatorNotice, tlv: tlv)
    }
}
