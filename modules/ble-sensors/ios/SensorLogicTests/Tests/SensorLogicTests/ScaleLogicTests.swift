import XCTest

@testable import SensorLogic

final class ScaleLogicTests: XCTestCase {
    func testNormalizeShortensBaseUuidsOnly() {
        XCTAssertEqual(ScaleLogic.normalize("FFE0"), "ffe0")
        XCTAssertEqual(ScaleLogic.normalize("0000FFE0-0000-1000-8000-00805F9B34FB"), "ffe0")
        XCTAssertEqual(ScaleLogic.normalize("0000181d"), "181d")
        XCTAssertEqual(
            ScaleLogic.normalize("6E400001-B5A3-F393-E0A9-E50E24DCCA9E"), "6e400001-b5a3-f393-e0a9-e50e24dcca9e")
        XCTAssertEqual(
            ScaleLogic.normalize("0000FE86-0000-1000-8000-00805F9B34FC"), "0000fe86-0000-1000-8000-00805f9b34fc")
    }

    func testCompanyKeyAndManufacturerSplit() {
        XCTAssertEqual(ScaleLogic.companyKey(0x20CA), "20ca")
        XCTAssertEqual(ScaleLogic.companyKey(1), "0001")
        // iOS blob: little-endian company id, then the payload.
        let split = ScaleLogic.splitManufacturer(Data([0xCA, 0x20, 0x01, 0xFF]))
        XCTAssertEqual(split?.key, "20ca")
        XCTAssertEqual(split?.payloadHex, "01ff")
        XCTAssertNil(ScaleLogic.splitManufacturer(Data([0xCA])))
        XCTAssertEqual(ScaleLogic.splitManufacturer(Data([0xFF, 0xFF]))?.payloadHex, "")
    }

    func testPropertyNames() {
        XCTAssertEqual(ScaleLogic.propertyNames(0x02 | 0x10), ["read", "notify"])
        XCTAssertEqual(ScaleLogic.propertyNames(0x08 | 0x04 | 0x20), ["write", "writeNoResponse", "indicate"])
        XCTAssertEqual(ScaleLogic.propertyNames(0), [])
    }

    func testFromHex() {
        XCTAssertEqual(ScaleLogic.fromHex("1309ff"), Data([0x13, 0x09, 0xFF]))
        XCTAssertEqual(ScaleLogic.fromHex("AB"), Data([0xAB]))
        XCTAssertEqual(ScaleLogic.fromHex(""), Data())
        XCTAssertNil(ScaleLogic.fromHex("abc"))
        XCTAssertNil(ScaleLogic.fromHex("zz"))
    }

    func testThrottle() {
        var throttle = AdvertisementThrottle(repeatMs: 2000)
        XCTAssertTrue(throttle.shouldEmit(id: "A", fingerprint: "aa", now: 0))
        XCTAssertFalse(throttle.shouldEmit(id: "A", fingerprint: "aa", now: 500))
        XCTAssertTrue(throttle.shouldEmit(id: "A", fingerprint: "ab", now: 600))
        XCTAssertFalse(throttle.shouldEmit(id: "A", fingerprint: "ab", now: 2500))
        XCTAssertTrue(throttle.shouldEmit(id: "A", fingerprint: "ab", now: 2600))
        XCTAssertTrue(throttle.shouldEmit(id: "B", fingerprint: "aa", now: 700))
        throttle.clear()
        XCTAssertTrue(throttle.shouldEmit(id: "A", fingerprint: "ab", now: 2700))
    }
}
