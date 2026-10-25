import XCTest
@testable import HuaweiProtocol

/// Translation of Kotlin LiveWorkoutTest, plus the 17/11 report, the phone-GPS and status packets against the Java HuaweiTLV
/// (Fixtures/liveworkout.json, from GoldenGen/src/GoldenLiveWorkout.java).
final class LiveWorkoutTests: XCTestCase {
    private func hex(_ s: String) -> Bytes { Bytes(hex: s.replacingOccurrences(of: " ", with: ""))! }

    private func plain() -> ParamsProvider {
        let p = ParamsProvider()
        p.transactionsCrypted = false
        p.sliceSize = 1022
        return p
    }

    func testAcceptingAStartMatchesHuaweiHealthsReply() throws {
        let packet = DataSyncWire.event(
            srcPkg: LiveWorkoutWire.phonePkg, wearPkg: LiveWorkoutWire.watchPkg, eventId: LiveWorkoutWire.eventControl, level: 0,
            data: LiveWorkoutWire.reply(LiveWorkoutWire.opStart)
        )
        XCTAssertEqual(
            packet.tlv?.serialize(),
            hex("011468772e73706f72742e6c696e6b6167652e617070021768772e73706f72742e6c696e6b6167652e64657669636503042fb5228e0401000506020100040100")
        )
        _ = try packet.serialize(params: plain())
    }

    func testReplyForStopAndResume() {
        XCTAssertEqual(LiveWorkoutWire.reply(LiveWorkoutWire.opStop), [0x02, 0x01, 0x01, 0x04, 0x01, 0x00])
        XCTAssertEqual(LiveWorkoutWire.reply(LiveWorkoutWire.opResume, code: 5), [0x02, 0x01, 0x02, 0x04, 0x01, 0x05])
    }

    func testControlEventCarriesTypeOperationAndStatus() {
        let control = LiveWorkoutWire.parseControl(hex("01 01 02  02 01 00  03 08 00 00 01 92 00 00 00 00  05 01 01"))
        XCTAssertEqual(control.workoutType, 2)
        XCTAssertEqual(control.operation, LiveWorkoutWire.opStart)
        XCTAssertEqual(control.status, LiveWorkoutWire.watchRunning)
    }

    func testControlAndTypeOfAnEmptyOrBrokenEventAreNil() {
        XCTAssertEqual(LiveWorkoutWire.parseControl(nil), LiveWorkoutWire.Control(workoutType: nil, operation: nil, status: nil))
        XCTAssertEqual(LiveWorkoutWire.parseControl([0x01, 0x09, 0x00]), LiveWorkoutWire.Control(workoutType: nil, operation: nil, status: nil))
        XCTAssertNil(LiveWorkoutWire.parseWorkoutType(nil))
        XCTAssertEqual(LiveWorkoutWire.parseWorkoutType(hex("02 01 03")), 3)
    }

    func testPointsAreScaledToDisplayUnits() {
        let values = [
            PointValue(key: LiveWorkoutWire.keyHeartRate, value: hex("78")),
            PointValue(key: LiveWorkoutWire.keyDuration, value: hex("41")),
            PointValue(key: LiveWorkoutWire.keyDistance, value: hex("05DC")), // 1500 dm
            PointValue(key: LiveWorkoutWire.keyCalories, value: hex("01E078")), // 123000 cal
            PointValue(key: LiveWorkoutWire.keySpeed, value: hex("01F4")), // 5.00 km/h
            PointValue(key: LiveWorkoutWire.keyAerobicTe, value: hex("1F")),
            PointValue(key: 12345, value: hex("FF")),
        ]
        let m = LiveMetrics().applyPoint(values)
        XCTAssertEqual(m.heartRate, 120)
        XCTAssertEqual(m.durationSec, 65)
        XCTAssertEqual(m.distanceM!, 150.0, accuracy: 1e-9)
        XCTAssertEqual(m.calories!, 123.0, accuracy: 1e-9)
        XCTAssertEqual(m.speedKmh!, 5.0, accuracy: 1e-9)
        XCTAssertEqual(m.aerobicTe!, 3.1, accuracy: 1e-9)
    }

    func testEveryKeyLandsInItsOwnMetric() {
        let one = hex("07")
        var m = LiveMetrics()
        let keys: [Int] = [
            LiveWorkoutWire.keyActiveCalories, LiveWorkoutWire.keyPace, LiveWorkoutWire.keyStepRate, LiveWorkoutWire.keyCadence, LiveWorkoutWire.keyRise,
            LiveWorkoutWire.keyDescent, LiveWorkoutWire.keyAnaerobicTe, LiveWorkoutWire.keyHrZone, LiveWorkoutWire.keyState,
        ]
        m = m.applyPoint(keys.map { PointValue(key: $0, value: one) })
        XCTAssertEqual(m.activeCalories!, 0.007, accuracy: 1e-12)
        XCTAssertEqual(m.paceSecPerKm, 7)
        XCTAssertEqual(m.stepRate, 7)
        XCTAssertEqual(m.cadence, 7)
        XCTAssertEqual(m.riseM, 7)
        XCTAssertEqual(m.descentM, 7)
        XCTAssertEqual(m.anaerobicTe!, 0.7, accuracy: 1e-12)
        XCTAssertEqual(m.heartRateZone, 7)
        XCTAssertEqual(m.watchState, 7)
    }

    func testAPushKeepsWhatItDoesNotRepeat() {
        let first = LiveMetrics().applyPoint([PointValue(key: LiveWorkoutWire.keySteps, value: hex("64")), PointValue(key: LiveWorkoutWire.keyHeartRate, value: hex("50"))])
        let second = first.applyPoint([PointValue(key: LiveWorkoutWire.keyHeartRate, value: hex("5A"))])
        XCTAssertEqual(second.steps, 100)
        XCTAssertEqual(second.heartRate, 90)
    }

    func testAltitudeIsSignedOnlyInFourBytes() {
        XCTAssertEqual(LiveMetrics().applyPoint([PointValue(key: LiveWorkoutWire.keyAltitude, value: hex("FFFFFFF4"))]).altitudeM, -12)
        XCTAssertEqual(LiveMetrics().applyPoint([PointValue(key: LiveWorkoutWire.keyAltitude, value: hex("F4"))]).altitudeM, 244)
    }

    func testMalformedValuesLeaveTheMetricUnset() {
        let m = LiveMetrics().applyPoint([PointValue(key: LiveWorkoutWire.keyHeartRate, value: nil), PointValue(key: LiveWorkoutWire.keySteps, value: Bytes(repeating: 0, count: 5))])
        XCTAssertNil(m.heartRate)
        XCTAssertNil(m.steps)
        XCTAssertNil(LiveWorkoutWire.unsigned([]))
    }

    func testAFourByteValueAboveTheIntRangeWrapsLikeKotlinToInt() {
        XCTAssertEqual(LiveMetrics().applyPoint([PointValue(key: LiveWorkoutWire.keySteps, value: hex("FFFFFFFF"))]).steps, -1)
    }

    func testEasyEffortBurnsMoreFatThanHardEffort() {
        let max = SubstrateEstimator.maxHeartRate(age: 35)
        XCTAssertEqual(max, 185)
        let walk = SubstrateEstimator.fatShare(heartRate: 105, maxHeartRate: max)
        let run = SubstrateEstimator.fatShare(heartRate: 165, maxHeartRate: max)
        XCTAssertTrue(walk > 0.6 && run < 0.35 && walk > run, "walk \(walk) run \(run)")
        // Clamped at both ends of the curve.
        XCTAssertEqual(SubstrateEstimator.fatShare(heartRate: 40, maxHeartRate: max), SubstrateEstimator.fatShare(heartRate: 60, maxHeartRate: max), accuracy: 1e-9)
        XCTAssertEqual(SubstrateEstimator.fatShare(heartRate: 200, maxHeartRate: max), 0.0, accuracy: 1e-9)
    }

    func testMaxHeartRateIsClamped() {
        XCTAssertEqual(SubstrateEstimator.maxHeartRate(age: 0), 220)
        XCTAssertEqual(SubstrateEstimator.maxHeartRate(age: 120), 120)
        XCTAssertEqual(SubstrateEstimator.maxHeartRate(age: 50), 170)
    }

    func testCaloriesAreSplitAsTheyAccrueAndNeverTwice() {
        let max = SubstrateEstimator.maxHeartRate(age: 35)
        var estimator = SubstrateEstimator(maxHeartRate: max)
        estimator.update(totalCalories: 10.0, heartRate: 110) // first figure: no delta yet
        estimator.update(totalCalories: 19.0, heartRate: 110)
        estimator.update(totalCalories: 19.0, heartRate: 110) // same total again: nothing
        estimator.update(totalCalories: 28.0, heartRate: nil) // no heart rate: not attributed
        estimator.update(totalCalories: 37.0, heartRate: 110)
        let share = SubstrateEstimator.fatShare(heartRate: 110, maxHeartRate: max)
        XCTAssertEqual(estimator.fatGrams, 18.0 * share / 9.0, accuracy: 1e-9)
        XCTAssertEqual(estimator.carbGrams, 18.0 * (1 - share) / 4.0, accuracy: 1e-9)
    }

    func testHeartRateEnergyUsesKeytelAndNeverGoesUnderRest() {
        // 140 bpm, 70 kg, 35 y: both equations by hand.
        let male = (-55.0969 + 0.6309 * 140 + 0.1988 * 70 + 0.2017 * 35) / 4.184
        let female = (-20.4022 + 0.4472 * 140 - 0.1263 * 70 + 0.074 * 35) / 4.184
        XCTAssertEqual(HeartRateEnergy.kcalPerMinute(heartRate: 140, weightKg: 70, age: 35, sex: "male"), male, accuracy: 1e-12)
        XCTAssertEqual(HeartRateEnergy.kcalPerMinute(heartRate: 140, weightKg: 70, age: 35, sex: "female"), female, accuracy: 1e-12)
        XCTAssertEqual(HeartRateEnergy.kcalPerMinute(heartRate: 140, weightKg: 70, age: 35, sex: "unknown"), (male + female) / 2, accuracy: 1e-12)
        XCTAssertEqual(HeartRateEnergy.kcalPerMinute(heartRate: 40, weightKg: 70, age: 35, sex: "male"), 1.2, accuracy: 1e-12)
    }

    // MARK: 17/11 report

    func testAReportIsDecodedWithItsUnits() throws {
        var t = HuaweiTLV()
        t.put(0x02, bytes: hex("0100")) // 256 s
        t.put(0x03, bytes: hex("8C")) // 140 bpm
        t.put(0x04, bytes: hex("03"))
        t.put(0x05, bytes: hex("0BB8")) // 3000 steps
        t.put(0x06, bytes: hex("A0")) // step rate 160
        t.put(0x07, bytes: hex("0168")) // pace 360
        t.put(0x08, bytes: hex("0C80")) // 3200 m
        t.put(0x09, bytes: hex("01E078")) // 123.0 kcal
        t.put(0x0A, bytes: hex("0A"))
        t.put(0x0B, bytes: hex("05"))
        t.put(0x0C, bytes: hex("FFFFFFF4")) // -12 m
        t.put(0x0D, bytes: hex("23")) // 3.5
        t.put(0x0E, bytes: hex("0F")) // 1.5
        t.put(0x11, bytes: hex("04")) // operator 4: stopped (hex digits read as decimal)
        let report = WorkoutReport.parse(try HuaweiTLV(parsing: t.serialize()))
        XCTAssertEqual(report.operatorType, 4)
        let m = report.apply(to: LiveMetrics())
        XCTAssertEqual(m.durationSec, 256)
        XCTAssertEqual(m.heartRate, 140)
        XCTAssertEqual(m.heartRateZone, 3)
        XCTAssertEqual(m.steps, 3000)
        XCTAssertEqual(m.stepRate, 160)
        XCTAssertEqual(m.paceSecPerKm, 360)
        XCTAssertEqual(m.distanceM, 3200)
        XCTAssertEqual(m.calories!, 123.0, accuracy: 1e-9)
        XCTAssertEqual(m.riseM, 10)
        XCTAssertEqual(m.descentM, 5)
        XCTAssertEqual(m.altitudeM, -12)
        XCTAssertEqual(m.aerobicTe!, 3.5, accuracy: 1e-9)
        XCTAssertEqual(m.anaerobicTe!, 1.5, accuracy: 1e-9)
    }

    func testAReportKeepsWhatItDoesNotRepeatAndRejectsImplausibleValues() {
        var base = LiveMetrics()
        base.heartRate = 99
        base.paceSecPerKm = 400
        base.distanceM = 10
        var t = HuaweiTLV()
        t.put(0x03, bytes: hex("FF")) // 255 bpm: out of 1...250
        t.put(0x07, bytes: hex("00")) // pace 0: not a pace
        let m = WorkoutReport.parse(t).apply(to: base)
        XCTAssertEqual(m.heartRate, 99)
        XCTAssertEqual(m.paceSecPerKm, 400)
        XCTAssertEqual(m.distanceM, 10)
        XCTAssertNil(WorkoutReport.parse(t).operatorType)
    }

    func testTheOperatorTypeReadsHexDigitsAsDecimal() {
        func op(_ h: String) -> Int? { var t = HuaweiTLV(); t.put(0x11, bytes: hex(h)); return WorkoutReport.parse(t).operatorType }
        XCTAssertEqual(op("01"), 1)
        XCTAssertEqual(op("12"), 12)
        XCTAssertNil(op("0a"))
        XCTAssertEqual(op("0102"), 102)
        XCTAssertEqual(op("0102030405"), 102_030_405)
        XCTAssertNil(op("0102030405060708"))
    }

    // MARK: link packets against the Java

    func testStatusReportOpenAndGpsRequestsMatchJava() throws {
        let g = try Golden.load("liveworkout")
        XCTAssertEqual(WorkoutLinkWire.statusRequest().tlv?.serialize().hexLower, g.str("status"))
        XCTAssertEqual(WorkoutLinkWire.openReportRequest().tlv?.serialize().hexLower, g.str("reportOpen"))
        XCTAssertEqual(WorkoutLinkWire.gpsParametersRequest().tlv?.serialize().hexLower, g.str("gpsParameters"))
        XCTAssertEqual(WorkoutLinkWire.gpsAnswer().tlv?.serialize().hexLower, g.str("gpsAnswer"))
        let ids = [(WorkoutLinkWire.statusRequest(), 0x17, 0x03), (WorkoutLinkWire.openReportRequest(), 0x17, 0x12), (WorkoutLinkWire.gpsParametersRequest(), 0x18, 0x01), (WorkoutLinkWire.gpsAnswer(), 0x18, 0x02)]
        for (p, s, c) in ids {
            XCTAssertEqual(Int(p.serviceId), s)
            XCTAssertEqual(Int(p.commandId), c)
        }
    }

    func testPhoneFixesMatchJavaForEveryFieldBitmap() throws {
        let fixes = try Golden.load("liveworkout").list("fixes")
        XCTAssertGreaterThanOrEqual(fixes.count, 29)
        func num(_ v: Any?) -> Double? { (v as? NSNumber)?.doubleValue }
        for c in fixes {
            let name = c.str("name")
            let timeMs = Int64(c.int("timeMs"))
            let fix = WorkoutLinkWire.Fix(
                latitude: num(c["lat"])!, longitude: num(c["lon"])!, timeMs: timeMs, speed: num(c["speed"]), altitude: num(c["altitude"]), bearing: num(c["bearing"]),
                accuracy: num(c["accuracy"])
            )
            let previous: WorkoutLinkWire.Fix? = (c["prevTimeMs"] as? NSNumber).map { WorkoutLinkWire.Fix(latitude: 0, longitude: 0, timeMs: $0.int64Value) }
            let packet = WorkoutLinkWire.gpsFix(
                WorkoutLinkWire.GpsParams(bitmap: c.int("bitmap")), fix: fix, previous: previous, distanceFromPrevious: num(c["distance"]), nowMs: Int64(c.int("nowMs"))
            )
            XCTAssertEqual(Int(packet.serviceId), 0x18, name)
            XCTAssertEqual(Int(packet.commandId), 0x03, name)
            XCTAssertEqual(packet.tlv?.serialize().hexLower, c.str("tlv"), name)
        }
    }

    func testGpsParamsBitmapFlags() {
        let p = WorkoutLinkWire.GpsParams(bitmap: 0xD7)
        XCTAssertTrue(p.speed && p.distance && p.altitude && p.latLon && p.direction && p.precision)
        let q = WorkoutLinkWire.GpsParams(bitmap: 0x28)
        XCTAssertFalse(q.speed || q.distance || q.altitude || q.latLon || q.direction || q.precision)
    }

    func testTheGpsParametersAnswerIsReadFromTag81Then02() {
        var inner = HuaweiTLV()
        inner.put(0x02, byte: 0x15)
        var outer = HuaweiTLV()
        outer.put(0x81, tlv: inner)
        XCTAssertEqual(WorkoutLinkWire.parseGpsParams(outer), WorkoutLinkWire.GpsParams(bitmap: 0x15))
        XCTAssertNil(WorkoutLinkWire.parseGpsParams(HuaweiTLV()))
        XCTAssertNil(WorkoutLinkWire.parseGpsParams(nil))
    }

    func testTheGpsFieldBitmapIsReadWhole() throws {
        // Fit 4 Pro 18/01 answer, 2026-10-25 18:49:49: 81{02 01DF, 03 01, 05 01}.
        let tlv = try HuaweiTLV(parsing: hex("81 0a  02 02 01df  03 01 01  05 01 01"))
        XCTAssertEqual(WorkoutLinkWire.gpsBitmap(tlv), 0x1DF)
        let p = try XCTUnwrap(WorkoutLinkWire.parseGpsParams(tlv))
        XCTAssertTrue(p.speed && p.distance && p.altitude && p.latLon && p.direction && p.precision)
    }

    func testDistanceBetweenFixes() {
        let a = WorkoutLinkWire.Fix(latitude: -6.9147, longitude: 107.6098, timeMs: 0)
        let b = WorkoutLinkWire.Fix(latitude: -6.9147, longitude: 107.6198, timeMs: 0)
        // 0.01 degree of longitude at 6.9 degrees south is 1.104 km.
        XCTAssertEqual(a.distance(to: b), 1104.0, accuracy: 5.0)
        XCTAssertEqual(a.distance(to: a), 0, accuracy: 1e-6)
    }
}
