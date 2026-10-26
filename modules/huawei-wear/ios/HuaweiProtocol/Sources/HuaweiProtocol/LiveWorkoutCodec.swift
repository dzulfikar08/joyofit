// Port of LiveWorkoutCodec.kt and of the pure parts of WorkoutLink.kt (the 17/11 report decoder, the phone-GPS packets).
//
// Huawei Health's "reverse linkage": a workout started on the watch, mirrored live on the phone. Everything is DataSync (0x37) between the
// watch's `hw.sport.linkage.device` and the phone's `hw.sport.linkage.app`:
//  - `37/02` events: `eventControl` (start / stop / resume / report, the phone answers start, stop and resume) and `eventStart` .. `eventResume`
//    (no answer),
//  - `37/03` points: one list of `{dict field id, big-endian value}` per push, see `LiveMetrics.applyPoint`.
import Foundation

public enum LiveWorkoutWire {
    public static let phonePkg = "hw.sport.linkage.app"
    public static let watchPkg = "hw.sport.linkage.device"

    /// 800400014: linkage control; data `01 workoutType, 02 operation, 03 time ms, 04 reply code, 05 status`.
    public static let eventControl = 800_400_014
    public static let eventStart = 800_400_002
    public static let eventStop = 800_400_003
    public static let eventPause = 800_400_004
    public static let eventResume = 800_400_005

    public static let opStart = 0
    public static let opStop = 1
    public static let opResume = 2
    public static let opReport = 3

    /// Tag 05 of a control event: the watch's own state (`TrackMainMapActivity.initStatus`).
    public static let watchPreSport = 0
    public static let watchRunning = 1
    public static let watchPaused = 2

    public struct Control: Equatable, Sendable {
        public let workoutType: Int?
        public let operation: Int?
        public let status: Int?
    }

    public static func parseControl(_ data: Bytes?) -> Control {
        let tlv = (try? HuaweiTLV(parsing: data ?? [])) ?? HuaweiTLV()
        return Control(workoutType: uint(tlv, 0x01).map(toInt), operation: uint(tlv, 0x02).map(toInt), status: uint(tlv, 0x05).map(toInt))
    }

    /// Tag 02 of a start / stop / pause / resume event.
    public static func parseWorkoutType(_ data: Bytes?) -> Int? {
        let tlv = (try? HuaweiTLV(parsing: data ?? [])) ?? HuaweiTLV()
        return uint(tlv, 0x02).map(toInt)
    }

    /// Control reply layout: `02 <operation> 04 <code>`, code 0 accepts. Huawei writes both as minimal-length ints.
    public static func reply(_ operation: Int, code: Int = 0) -> Bytes { [0x02, 0x01, UInt8(truncatingIfNeeded: operation), 0x04, 0x01, UInt8(truncatingIfNeeded: code)] }

    // Live point keys (dictionary field ids; `olk.c` allow-list, units from `MirrorLinkDataSource` / `getLinkageBundle`).
    public static let keyDuration = 50_004_396 // s
    public static let keyHeartRate = 50_004_838 // bpm
    public static let keyDistance = 50_004_765 // dm
    public static let keyCalories = 50_004_829 // cal (kcal x 1000)
    public static let keyActiveCalories = 50_004_617 // cal, as calories (unverified)
    public static let keySpeed = 50_004_799 // km/h x 100
    public static let keyPace = 50_004_979 // s per km
    public static let keyStepRate = 50_004_721 // steps/min
    public static let keySteps = 50_004_684
    public static let keyCadence = 50_004_254 // cycling rpm
    public static let keyAltitude = 50_004_286 // m, signed when 4 bytes
    public static let keyRise = 50_004_395 // m
    public static let keyDescent = 50_004_774 // m
    public static let keyAerobicTe = 50_004_172 // x10
    public static let keyAnaerobicTe = 50_004_881 // x10
    public static let keyHrZone = 50_004_146 // zone number (inferred)
    public static let keyState = 50_004_770 // 1 running, 2 paused, 3 stopped, 7 pre-sport

    /// `CommonUtil.y(hex)`: unsigned big-endian, one to four bytes; anything else is nil.
    public static func unsigned(_ bytes: Bytes?) -> Int64? {
        guard let bytes, !bytes.isEmpty, bytes.count <= 4 else { return nil }
        var n: Int64 = 0
        for b in bytes { n = (n << 8) | Int64(b) }
        return n
    }

    /// `cph.e`: big-endian, signed only when it is four bytes (a negative altitude).
    public static func signedWhenFour(_ bytes: Bytes?) -> Int? {
        guard let bytes, !bytes.isEmpty, bytes.count <= 4 else { return nil }
        var n: Int32 = 0
        for b in bytes { n = (n << 8) | Int32(b) }
        return Int(n)
    }

    /// Kotlin `Long.toInt()`: the low 32 bits, signed.
    static func toInt(_ v: Int64) -> Int { Int(Int32(truncatingIfNeeded: v)) }

    static func uint(_ tlv: HuaweiTLV, _ tag: Int) -> Int64? {
        guard tlv.contains(tag), let bytes = tlv.bytes(tag, default: nil), !bytes.isEmpty, bytes.count <= 8 else { return nil }
        return bytes.reduce(Int64(0)) { ($0 << 8) | Int64($1) }
    }
}

/// What the live screen shows. Every metric is nil until the watch has sent it.
public struct LiveMetrics: Equatable, Sendable {
    public var durationSec: Int?
    public var heartRate: Int?
    public var distanceM: Double?
    public var calories: Double?
    public var activeCalories: Double?
    public var speedKmh: Double?
    public var paceSecPerKm: Int?
    public var stepRate: Int?
    public var steps: Int?
    public var cadence: Int?
    public var altitudeM: Int?
    public var riseM: Int?
    public var descentM: Int?
    public var aerobicTe: Double?
    public var anaerobicTe: Double?
    public var heartRateZone: Int?
    /// `operator_type` of the point stream: 1 running, 2 paused, 3 stopped, 7 pre-sport.
    public var watchState: Int?

    public init() {}

    /// This snapshot with the values of one `37/03` push laid over it; unknown keys and malformed values are ignored.
    public func applyPoint(_ values: [PointValue]) -> LiveMetrics {
        var m = self
        for v in values {
            let u = LiveWorkoutWire.unsigned(v.value)
            switch v.key {
            case LiveWorkoutWire.keyDuration: if let u { m.durationSec = LiveWorkoutWire.toInt(u) }
            case LiveWorkoutWire.keyHeartRate: if let u { m.heartRate = LiveWorkoutWire.toInt(u) }
            case LiveWorkoutWire.keyDistance: if let u { m.distanceM = Double(u) / 10.0 }
            case LiveWorkoutWire.keyCalories: if let u { m.calories = Double(u) / 1000.0 }
            case LiveWorkoutWire.keyActiveCalories: if let u { m.activeCalories = Double(u) / 1000.0 }
            case LiveWorkoutWire.keySpeed: if let u { m.speedKmh = Double(u) / 100.0 }
            case LiveWorkoutWire.keyPace: if let u { m.paceSecPerKm = LiveWorkoutWire.toInt(u) }
            case LiveWorkoutWire.keyStepRate: if let u { m.stepRate = LiveWorkoutWire.toInt(u) }
            case LiveWorkoutWire.keySteps: if let u { m.steps = LiveWorkoutWire.toInt(u) }
            case LiveWorkoutWire.keyCadence: if let u { m.cadence = LiveWorkoutWire.toInt(u) }
            case LiveWorkoutWire.keyAltitude: if let s = LiveWorkoutWire.signedWhenFour(v.value) { m.altitudeM = s }
            case LiveWorkoutWire.keyRise: if let u { m.riseM = LiveWorkoutWire.toInt(u) }
            case LiveWorkoutWire.keyDescent: if let u { m.descentM = LiveWorkoutWire.toInt(u) }
            case LiveWorkoutWire.keyAerobicTe: if let u { m.aerobicTe = Double(u) / 10.0 }
            case LiveWorkoutWire.keyAnaerobicTe: if let u { m.anaerobicTe = Double(u) / 10.0 }
            case LiveWorkoutWire.keyHrZone: if let u { m.heartRateZone = LiveWorkoutWire.toInt(u) }
            case LiveWorkoutWire.keyState: if let u { m.watchState = LiveWorkoutWire.toInt(u) }
            default: break
            }
        }
        return m
    }
}

/// Fat and carbohydrate burned, estimated by JoyoFit (the watch sends neither and Huawei Health computes neither). Each calorie increase of
/// the workout is split by the intensity at that moment:
///  - %HRmax to %VO2max with Swain et al. (1994): `%HRmax = 0.64 x %VO2max + 37`, HRmax = 220 - age (Huawei's own rule),
///  - %VO2max to the respiratory exchange ratio along a piecewise line through typical values (Romijn 1993, Achten 2003):
///    25% 0.78, 45% 0.83, 65% 0.88, 85% 0.95, 100% 1.00,
///  - RER to the fat share of energy with the non-protein table's linear form (Lusk): `(1.00 - RER) / 0.30`,
///  - grams with Atwater: 9 kcal per gram of fat, 4 per gram of carbohydrate.
/// An estimate for motivation, not a measurement: it ignores fitness, diet and the protein share.
public struct SubstrateEstimator: Sendable {
    public static let kcalPerGFat = 9.0
    public static let kcalPerGCarb = 4.0
    private static let rerPoints: [(Double, Double)] = [(25.0, 0.78), (45.0, 0.83), (65.0, 0.88), (85.0, 0.95), (100.0, 1.00)]

    public let maxHeartRate: Int
    public private(set) var fatKcal = 0.0
    public private(set) var carbKcal = 0.0
    private var lastCalories: Double?

    public init(maxHeartRate: Int) { self.maxHeartRate = maxHeartRate }

    public var fatGrams: Double { fatKcal / Self.kcalPerGFat }
    public var carbGrams: Double { carbKcal / Self.kcalPerGCarb }

    /// Attributes the calories since the previous call to fat and carbohydrate at `heartRate`; no heart rate, no split.
    public mutating func update(totalCalories: Double?, heartRate: Int?) {
        guard let totalCalories else { return }
        let previous = lastCalories
        lastCalories = totalCalories
        guard let previous, let heartRate, heartRate > 0 else { return }
        let delta = totalCalories - previous
        if delta <= 0.0 { return }
        let fat = Self.fatShare(heartRate: heartRate, maxHeartRate: maxHeartRate)
        fatKcal += delta * fat
        carbKcal += delta * (1.0 - fat)
    }

    public static func maxHeartRate(age: Int) -> Int { min(max(220 - age, 120), 220) }

    /// Share of energy from fat (0..1) at `heartRate` for `maxHeartRate`.
    public static func fatShare(heartRate: Int, maxHeartRate: Int) -> Double {
        let pctHrMax = 100.0 * Double(heartRate) / Double(maxHeartRate)
        let pctVo2 = min(max((pctHrMax - 37.0) / 0.64, rerPoints.first!.0), rerPoints.last!.0)
        let rer = interpolate(pctVo2)
        return min(max((1.0 - rer) / 0.30, 0.0), 1.0)
    }

    private static func interpolate(_ x: Double) -> Double {
        for i in 1..<rerPoints.count {
            let (x1, y1) = rerPoints[i]
            if x <= x1 {
                let (x0, y0) = rerPoints[i - 1]
                return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
            }
        }
        return rerPoints.last!.1
    }
}

/// Energy from heart rate, for when the watch sends no calories live: Keytel et al. (2005), kJ per minute from heart rate, weight, age and sex,
/// divided by 4.184 for kcal. Sex unknown uses the mean of both equations. Below about 90 bpm the equation drifts towards zero, so it never goes
/// under a resting 1.2 kcal per minute.
public enum HeartRateEnergy {
    public static let restKcalPerMin = 1.2

    public static func kcalPerMinute(heartRate: Int, weightKg: Double, age: Int, sex: String) -> Double {
        let hr = Double(heartRate)
        let a = Double(age)
        let male = (-55.0969 + 0.6309 * hr + 0.1988 * weightKg + 0.2017 * a) / 4.184
        let female = (-20.4022 + 0.4472 * hr - 0.1263 * weightKg + 0.074 * a) / 4.184
        let kcal: Double
        switch sex {
        case "male": kcal = male
        case "female": kcal = female
        default: kcal = (male + female) / 2
        }
        return max(kcal, restKcalPerMin)
    }
}

/// One `17/11` realtime report (`parseWorkoutReportPlayData`). Units are Huawei's model's; see the comments.
public struct WorkoutReport: Sendable {
    private let duration: Int64?
    private let hr: Int64?
    private let zone: Int64?
    private let steps: Int64?
    private let cadence: Int64?
    private let pace: Int64?
    private let distance: Int64?
    private let calories: Int64?
    private let rise: Int64?
    private let descent: Int64?
    private let altitude: Int?
    private let aerobic: Int64?
    private let anaerobic: Int64?
    /// 1 running, 3 resumed, 2 paused, 4 stopped.
    public let operatorType: Int?

    public static func parse(_ tlv: HuaweiTLV) -> WorkoutReport {
        // Tag 11: `CommonUtil.c(bytes, 10)`, the hex digits read as decimal.
        let operatorType = tlv.bytes(0x11, default: nil).flatMap { bytes in Int32(bytes.map { String(format: "%02x", $0) }.joined()).map(Int.init) }
        return WorkoutReport(
            duration: LiveWorkoutWire.uint(tlv, 0x02), // s (Huawei stores x1000 as ms)
            hr: LiveWorkoutWire.uint(tlv, 0x03),
            zone: LiveWorkoutWire.uint(tlv, 0x04),
            steps: LiveWorkoutWire.uint(tlv, 0x05),
            cadence: LiveWorkoutWire.uint(tlv, 0x06),
            pace: LiveWorkoutWire.uint(tlv, 0x07), // s per km
            distance: LiveWorkoutWire.uint(tlv, 0x08), // m (Huawei stores x10 as dm)
            calories: LiveWorkoutWire.uint(tlv, 0x09), // cal, like the step frames (UNVERIFIED)
            rise: LiveWorkoutWire.uint(tlv, 0x0A),
            descent: LiveWorkoutWire.uint(tlv, 0x0B),
            altitude: tlv.bytes(0x0C, default: nil).flatMap { LiveWorkoutWire.signedWhenFour($0) },
            aerobic: LiveWorkoutWire.uint(tlv, 0x0D),
            anaerobic: LiveWorkoutWire.uint(tlv, 0x0E),
            operatorType: operatorType
        )
    }

    public func apply(to m: LiveMetrics) -> LiveMetrics {
        var r = m
        if let duration { r.durationSec = LiveWorkoutWire.toInt(duration) }
        if let hr, (1...250).contains(LiveWorkoutWire.toInt(hr)) { r.heartRate = LiveWorkoutWire.toInt(hr) }
        if let zone { r.heartRateZone = LiveWorkoutWire.toInt(zone) }
        if let steps { r.steps = LiveWorkoutWire.toInt(steps) }
        if let cadence { r.stepRate = LiveWorkoutWire.toInt(cadence) }
        if let pace, LiveWorkoutWire.toInt(pace) > 0 { r.paceSecPerKm = LiveWorkoutWire.toInt(pace) }
        if let distance { r.distanceM = Double(distance) }
        if let calories { r.calories = Double(calories) / 1000.0 }
        if let rise { r.riseM = LiveWorkoutWire.toInt(rise) }
        if let descent { r.descentM = LiveWorkoutWire.toInt(descent) }
        if let altitude { r.altitudeM = altitude }
        if let aerobic { r.aerobicTe = Double(aerobic) / 10.0 }
        if let anaerobic { r.anaerobicTe = Double(anaerobic) / 10.0 }
        return r
    }
}

/// The phone's side of a workout started on the watch (WorkoutLink.kt): services 0x18 (GpsAndTime) and 0x17 (workout).
public enum WorkoutLinkWire {
    public static let gpsService: UInt8 = 0x18
    public static let gpsParameters: UInt8 = 0x01
    public static let gpsStatus: UInt8 = 0x02
    public static let gpsData: UInt8 = 0x03
    /// `18/08`: the watch's workout screen opened or closed (Huawei Health's activity-recognition switch).
    public static let workoutScreen: UInt8 = 0x08
    public static let workoutService: UInt8 = 0x17
    public static let status: UInt8 = 0x03
    public static let reportData: UInt8 = 0x11
    public static let reportOpen: UInt8 = 0x12
    public static let ok: Int32 = 100_000

    /// `18/01` answer: which fields the watch takes (GB `GpsParameters.Response`).
    public struct GpsParams: Equatable, Sendable {
        public let speed: Bool
        public let distance: Bool
        public let altitude: Bool
        public let latLon: Bool
        public let direction: Bool
        public let precision: Bool

        public init(bitmap: Int) {
            speed = bitmap & 0x01 != 0
            distance = bitmap & 0x02 != 0
            altitude = bitmap & 0x04 != 0
            latLon = bitmap & 0x10 != 0
            direction = bitmap & 0x40 != 0
            precision = bitmap & 0x80 != 0
        }
    }

    /// A phone position. Optional fields are the ones the platform has no value for (Android `hasSpeed()` and so on).
    public struct Fix: Equatable, Sendable {
        public var latitude: Double
        public var longitude: Double
        public var timeMs: Int64
        public var speed: Double?
        public var altitude: Double?
        public var bearing: Double?
        public var accuracy: Double?

        public init(latitude: Double, longitude: Double, timeMs: Int64, speed: Double? = nil, altitude: Double? = nil, bearing: Double? = nil, accuracy: Double? = nil) {
            self.latitude = latitude
            self.longitude = longitude
            self.timeMs = timeMs
            self.speed = speed
            self.altitude = altitude
            self.bearing = bearing
            self.accuracy = accuracy
        }

        /// Metres to `other` (haversine on the WGS84 mean radius; Android's `Location.distanceTo` is the ellipsoidal figure, the two differ by under 0.5%).
        public func distance(to other: Fix) -> Double {
            let r = 6_371_008.8
            let p1 = latitude * .pi / 180, p2 = other.latitude * .pi / 180
            let dp = p2 - p1, dl = (other.longitude - longitude) * .pi / 180
            let a = sin(dp / 2) * sin(dp / 2) + cos(p1) * cos(p2) * sin(dl / 2) * sin(dl / 2)
            return 2 * r * asin(min(1, a.squareRoot()))
        }
    }

    /// `17/03` request `81 00`: the workout status poll.
    public static func statusRequest() -> HuaweiPacket {
        var tlv = HuaweiTLV()
        tlv.put(0x81)
        return HuaweiPacket(serviceId: workoutService, commandId: status, tlv: tlv)
    }

    /// `17/12 {01: 1}`: opens the realtime report; the watch then pushes `17/11`.
    public static func openReportRequest() -> HuaweiPacket {
        var tlv = HuaweiTLV()
        tlv.put(0x01, byte: 1)
        return HuaweiPacket(serviceId: workoutService, commandId: reportOpen, tlv: tlv)
    }

    /// `18/02 {7F: 100000}`: the answer to the watch's "send me the phone's GPS".
    public static func gpsAnswer() -> HuaweiPacket {
        var tlv = HuaweiTLV()
        tlv.put(0x7F, int: ok)
        return HuaweiPacket(serviceId: gpsService, commandId: gpsStatus, tlv: tlv)
    }

    /// `18/08 {7F: 100000}`: the answer to the watch's workout screen opening or closing (Huawei Health
    /// `HwActivityRecognitionManager.notifyDeviceReceiveSuccess`).
    public static func workoutScreenAnswer() -> HuaweiPacket {
        var tlv = HuaweiTLV()
        tlv.put(0x7F, int: ok)
        return HuaweiPacket(serviceId: gpsService, commandId: workoutScreen, tlv: tlv)
    }

    /// `18/01 {81}`: which GPS fields the watch wants.
    public static func gpsParametersRequest() -> HuaweiPacket {
        var tlv = HuaweiTLV()
        tlv.put(0x81)
        return HuaweiPacket(serviceId: gpsService, commandId: gpsParameters, tlv: tlv)
    }

    /// The bitmap of the `18/01` answer (`81{02: bitmap}`), nil when it is missing (Kotlin `WorkoutLink.gpsBitmap`).
    public static func parseGpsParams(_ tlv: HuaweiTLV?) -> GpsParams? {
        gpsBitmap(tlv).map { GpsParams(bitmap: $0) }
    }

    /// All bytes of the `18/01` bitmap, big-endian (Huawei Health reads an int). The Fit 4 Pro sends two, `01 DF` (2026-10-25): its first
    /// byte alone (GB's `getByte`) is 0x01, speed only, and the watch never got the position, altitude, bearing and accuracy it asks for.
    public static func gpsBitmap(_ tlv: HuaweiTLV?) -> Int? {
        guard let sub = try? tlv?.object(0x81), let bytes = sub.bytes(0x02, default: nil), !bytes.isEmpty, bytes.count <= 4 else { return nil }
        return bytes.reduce(0) { ($0 << 8) | Int($1) }
    }

    /// Kotlin `Float.toInt()` / `Double.toInt()`: truncates, saturates, NaN is 0.
    private static func kotlinInt(_ f: Double) -> Int32 {
        if f.isNaN { return 0 }
        if f >= Double(Int32.max) { return Int32.max }
        if f <= Double(Int32.min) { return Int32.min }
        return Int32(f)
    }

    /// `18/03 81{82{...}}`: one phone fix. `previous` is the fix before it (nil for the first), `distanceFromPrevious` the metres between them.
    public static func gpsFix(_ params: GpsParams, fix: Fix, previous: Fix?, distanceFromPrevious: Double?, nowMs: Int64) -> HuaweiPacket {
        let offsetMs = previous.map { fix.timeMs - $0.timeMs } ?? 1000
        var point = HuaweiTLV()
        if params.speed, let speed = fix.speed { point.put(0x03, short: Int16(truncatingIfNeeded: kotlinInt(speed))) }
        if params.distance { point.put(0x04, int: previous == nil ? 0 : kotlinInt(distanceFromPrevious ?? 0)) }
        if params.altitude, let altitude = fix.altitude { point.put(0x05, short: Int16(truncatingIfNeeded: kotlinInt(altitude))) }
        point.put(0x07, int: Int32(truncatingIfNeeded: (nowMs - offsetMs) / 1000))
        point.put(0x08, int: Int32(truncatingIfNeeded: nowMs / 1000))
        if params.latLon {
            point.put(0x09, double: fix.latitude)
            point.put(0x0A, double: fix.longitude)
        }
        if params.direction, let bearing = fix.bearing { point.put(0x0D, double: Double(Float(bearing))) }
        if params.precision, let accuracy = fix.accuracy { point.put(0x0E, double: Double(Float(accuracy))) }
        var inner = HuaweiTLV()
        inner.put(0x82, tlv: point)
        var outer = HuaweiTLV()
        outer.put(0x81, tlv: inner)
        return HuaweiPacket(serviceId: gpsService, commandId: gpsData, tlv: outer)
    }
}
