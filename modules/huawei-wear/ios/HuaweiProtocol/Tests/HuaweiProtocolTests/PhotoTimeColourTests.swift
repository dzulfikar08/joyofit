import XCTest
@testable import HuaweiProtocol

/// Twin of PhotoTimeColourTest.kt (same values): JoyoFit's time colour rule on synthetic 408 x 480 pictures with the Fit 4 Pro photo face's top
/// time area (68, 18, 406, 182).
final class PhotoTimeColourTests: XCTestCase {
    let w = 408
    let h = 480

    func flat(_ colour: UInt32) -> [UInt32] { [UInt32](repeating: colour, count: w * h) }

    func pickTop(_ pixels: [UInt32]) -> UInt32? { PhotoTimeColour.pick(pixels, width: w, height: h, left: 68, top: 18, right: 406, bottom: 182) }

    func testTheLinearTableIsTheSameOnBothPlatforms() {
        XCTAssertEqual(PhotoTimeColour.linear[0], 0)
        XCTAssertEqual(PhotoTimeColour.linear[128], 14146)
        XCTAssertEqual(PhotoTimeColour.linear[255], 65535)
        XCTAssertEqual(PhotoTimeColour.linear.reduce(0, +), 5_217_863)
    }

    func testAFlatDarkAreaGetsWhiteAndAFlatLightOneNearBlack() {
        XCTAssertEqual(pickTop(flat(0xFF10_2060)), 0xFFFF_FFFF) // navy: white 15.0, tint 8.6
        XCTAssertEqual(pickTop(flat(0xFFF0_E0C0)), 0xFF11_1111) // beige: near-black 14.5, shade 9.5
    }

    func testSaturatedAreasKeepTheirHueOnlyWhenItIsReadableAndCloseToTheBest() {
        XCTAssertEqual(pickTop(flat(0xFFD0_1010)), 0xFFFF_FFFF) // red: white 5.6, tint 3.2
        XCTAssertEqual(pickTop(flat(0xFF10_30D0)), 0xFFFF_FFFF) // blue: white 8.9, tint 5.0
        XCTAssertEqual(pickTop(flat(0xFF60_6030)), 0xFFF2_F2B6) // olive: tint 5.6 >= 4.5 and within 1.0 of white's 6.5
        XCTAssertEqual(pickTop(flat(0xFFA0_A0F0)), 0xFF1A_1A40) // lavender: shade 6.9, within 1.0 of near-black's 7.9
    }

    func testGreyAreasGetOnlyWhiteOrNearBlack() {
        XCTAssertEqual(pickTop(flat(0xFF00_0000)), 0xFFFF_FFFF)
        XCTAssertEqual(pickTop(flat(0xFFFF_FFFF)), 0xFF11_1111)
        XCTAssertEqual(pickTop(flat(0xFF80_8080)), 0xFF11_1111)
        // Saturation 6 / 90 < 0.08: white, though its yellow tint would pass the hue rule.
        XCTAssertEqual(pickTop(flat(0xFF5A_5A54)), 0xFFFF_FFFF)
    }

    func testAMixIsAveragedInLinearLight() {
        // 70 % black, 30 % white: linear mean 0.3, so near-black (6.3 against white's 3.0); a gamma-space mean (#4D4D4D) would give white.
        let mix: [UInt32] = (0..<10).map { $0 < 7 ? 0xFF00_0000 : 0xFFFF_FFFF }
        XCTAssertEqual(PhotoTimeColour.pick(mix, width: 10, height: 1, left: 0, top: 0, right: 10, bottom: 1), 0xFF11_1111)
        XCTAssertEqual(PhotoTimeColour.pick([0xFF4D_4D4D], width: 1, height: 1, left: 0, top: 0, right: 1, bottom: 1), 0xFFFF_FFFF)
    }

    func testTheAreaIsCutToThePhotoAndAnAreaOutsideItUsesTheWholePhoto() {
        // Top half beige, bottom half navy.
        let half: [UInt32] = (0..<(w * h)).map { $0 / w < 240 ? 0xFFF0_E0C0 : 0xFF10_2060 }
        XCTAssertEqual(PhotoTimeColour.pick(half, width: w, height: h, left: 300, top: 400, right: 600, bottom: 600), 0xFFFF_FFFF)
        XCTAssertEqual(PhotoTimeColour.pick(half, width: w, height: h, left: 500, top: 500, right: 600, bottom: 600), 0xFF11_1111)
        XCTAssertEqual(PhotoTimeColour.pick(half, width: w, height: h, left: -50, top: -50, right: -10, bottom: -10), 0xFF11_1111)
        XCTAssertEqual(PhotoTimeColour.pick(half, width: w, height: h, left: 100, top: 100, right: 100, bottom: 200), 0xFF11_1111)
        XCTAssertNil(PhotoTimeColour.pick([0, 0, 0], width: 2, height: 2, left: 0, top: 0, right: 2, bottom: 2))
        XCTAssertNil(PhotoTimeColour.pick([], width: 0, height: 0, left: 0, top: 0, right: 1, bottom: 1))
    }

    func testTransparentPixelsAreSkippedAndSemiTransparentOnesSitOnBlack() {
        // Every other pixel fully transparent white: the navy alone counts.
        XCTAssertEqual(pickTop((0..<(w * h)).map { $0 % 2 == 1 ? 0x00FF_FFFF : 0xFF10_2060 }), 0xFFFF_FFFF)
        // Nothing visible: black, so white.
        XCTAssertEqual(pickTop(flat(0x00FF_FFFF)), 0xFFFF_FFFF)
        // White at alpha 0x20 over black is dark (L 0.13): white, where opaque white gets near-black.
        XCTAssertEqual(pickTop(flat(0x20FF_FFFF)), 0xFFFF_FFFF)
    }
}
