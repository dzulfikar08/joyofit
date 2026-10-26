import XCTest
@testable import HuaweiProtocol

/// Twin of PhotoTimeColourTest.kt (same values): JoyoFit's time colour rule on synthetic 408 x 480 pictures with the Fit 4 Pro photo face's top
/// time area (68, 18, 406, 182), sampled every 4th pixel (3485 samples). Scores in the comments are 20th-percentile contrasts.
final class PhotoTimeColourTests: XCTestCase {
    let w = 408
    let h = 480

    func flat(_ colour: UInt32) -> [UInt32] { [UInt32](repeating: colour, count: w * h) }

    func picture(_ colour: (Int, Int) -> UInt32) -> [UInt32] { (0..<(w * h)).map { colour($0 % w, $0 / w) } }

    func pickTop(_ pixels: [UInt32]) -> UInt32? { PhotoTimeColour.pick(pixels, width: w, height: h, left: 68, top: 18, right: 406, bottom: 182) }

    func testTheLinearTableIsTheSameOnBothPlatforms() {
        XCTAssertEqual(PhotoTimeColour.linear[0], 0)
        XCTAssertEqual(PhotoTimeColour.linear[128], 14146)
        XCTAssertEqual(PhotoTimeColour.linear[255], 65535)
        XCTAssertEqual(PhotoTimeColour.linear.reduce(0, +), 5_217_863)
    }

    func testAFlatDarkAreaGetsWhiteAndAFlatLightOneNearBlack() {
        XCTAssertEqual(pickTop(flat(0xFF10_2060)), 0xFFFF_FFFF) // navy: white 15.0, tint 12.2
        XCTAssertEqual(pickTop(flat(0xFFF0_E0C0)), 0xFF11_1111) // beige: near-black 14.5, shade 13.4
    }

    func testAHueKeepingCandidateWinsWithinHalfAPointOfTheBest() {
        XCTAssertEqual(pickTop(flat(0xFFD0_1010)), 0xFFFF_FFFF) // red: white 5.6, tint 4.5
        XCTAssertEqual(pickTop(flat(0xFF10_30D0)), 0xFFFF_FFFF) // blue: white 8.9, tint 7.2
        XCTAssertEqual(pickTop(flat(0xFF60_6030)), 0xFFFF_FFE0) // olive: tint 6.4, white 6.5
        XCTAssertEqual(pickTop(flat(0xFF00_5050)), 0xFFE0_FFFF) // dark teal: tint 8.8, white 9.3
        XCTAssertEqual(pickTop(flat(0xFFA0_A0F0)), 0xFF0F_0F1F) // lavender: shade 7.92, near-black 7.90
        XCTAssertEqual(pickTop(flat(0xFFFF_C0CB)), 0xFF1F_0F12) // pink: shade 12.0, near-black 12.3
    }

    func testTexturedColourfulAreasKeepTheirHue() {
        // A noisy orange sunset: shade 5.2, near-black 5.5.
        XCTAssertEqual(pickTop(picture { x, y in rgb(220 + noise(x, y) / 3, 90 + noise(x, y), 20 + noise(y, x) / 2) }), 0xFF1F_160F)
        // A noisy dark teal: tint 6.9, white 7.3.
        XCTAssertEqual(pickTop(picture { x, y in rgb(10, 50 + noise(x, y), 50 + noise(y, x)) }), 0xFFE0_FFFF)
        // Pastel pink with about 10 % black specks: shade 12.6, near-black 12.9.
        XCTAssertEqual(pickTop(picture { x, y in (x * 31 + y * 17) % 97 < 10 ? 0xFF00_0000 : 0xFFFA_C8D7 }), 0xFF1F_0F14)
    }

    /// Deterministic noise 0...60.
    func noise(_ x: Int, _ y: Int) -> Int { ((x * 7919) ^ (y * 104_729)) % 61 }

    func rgb(_ r: Int, _ g: Int, _ b: Int) -> UInt32 { 0xFF00_0000 | UInt32(r) << 16 | UInt32(g) << 8 | UInt32(b) }

    func testGreyAreasGetOnlyWhiteOrNearBlack() {
        XCTAssertEqual(pickTop(flat(0xFF00_0000)), 0xFFFF_FFFF)
        XCTAssertEqual(pickTop(flat(0xFFFF_FFFF)), 0xFF11_1111)
        XCTAssertEqual(pickTop(flat(0xFF80_8080)), 0xFF11_1111)
        XCTAssertEqual(pickTop(flat(0xFF5A_5A54)), 0xFFFF_FFFF) // saturation 6 / 90 < 0.08
    }

    func testAMostlyDarkAreaWithBrightHighlightsGetsWhite() {
        // #606060 with the right 10 % of the area's columns white. The linear mean (L 0.21) would favour near-black (4.6 against 4.1);
        // the 20th percentile sees the grey: white 6.3, near-black 3.0.
        let highlights = picture { x, _ in x >= 372 ? 0xFFFF_FFFF : 0xFF60_6060 }
        XCTAssertEqual(pickTop(highlights), 0xFFFF_FFFF)
        // The same picture as a whole (fallback area, every 7th pixel).
        XCTAssertEqual(PhotoTimeColour.pick(highlights, width: w, height: h, left: -1, top: -1, right: -1, bottom: -1), 0xFFFF_FFFF)
    }

    func testAMostlyLightAreaWithDarkSpecksGetsNearBlack() {
        // #E0E0E0 with about 10 % black specks: near-black 14.3, white 1.3.
        XCTAssertEqual(pickTop(picture { x, y in (x * 31 + y * 17) % 97 < 10 ? 0xFF00_0000 : 0xFFE0_E0E0 }), 0xFF11_1111)
    }

    func testASmallMinorityDoesNotPullTheScore() {
        // 85 % black, 15 % white: white reaches 21 on the black, near-black only 1.1.
        let mix: [UInt32] = (0..<20).map { $0 < 17 ? 0xFF00_0000 : 0xFFFF_FFFF }
        XCTAssertEqual(PhotoTimeColour.pick(mix, width: 20, height: 1, left: 0, top: 0, right: 20, bottom: 1), 0xFFFF_FFFF)
    }

    func testTheAreaIsCutToThePhotoAndAnAreaOutsideItUsesTheWholePhoto() {
        // The top 60 rows navy, the rest beige.
        let bands = picture { _, y in y < 60 ? 0xFF10_2060 : 0xFFF0_E0C0 }
        XCTAssertEqual(PhotoTimeColour.pick(bands, width: w, height: h, left: 300, top: -50, right: 600, bottom: 50), 0xFFFF_FFFF)
        XCTAssertEqual(PhotoTimeColour.pick(bands, width: w, height: h, left: 500, top: 500, right: 600, bottom: 600), 0xFF11_1111)
        XCTAssertEqual(PhotoTimeColour.pick(bands, width: w, height: h, left: -50, top: -50, right: -10, bottom: -10), 0xFF11_1111)
        XCTAssertEqual(PhotoTimeColour.pick(bands, width: w, height: h, left: 100, top: 100, right: 100, bottom: 200), 0xFF11_1111)
        XCTAssertNil(PhotoTimeColour.pick([0, 0, 0], width: 2, height: 2, left: 0, top: 0, right: 2, bottom: 2))
        XCTAssertNil(PhotoTimeColour.pick([], width: 0, height: 0, left: 0, top: 0, right: 1, bottom: 1))
    }

    func testTransparentPixelsAreSkippedAndSemiTransparentOnesSitOnBlack() {
        // Every other pixel fully transparent white: the navy alone counts.
        XCTAssertEqual(pickTop((0..<(w * h)).map { $0 % 2 == 1 ? 0x00FF_FFFF : 0xFF10_2060 }), 0xFFFF_FFFF)
        // Nothing visible: white.
        XCTAssertEqual(pickTop(flat(0x00FF_FFFF)), 0xFFFF_FFFF)
        // White at alpha 0x20 over black is dark (L 0.13): white, where opaque white gets near-black.
        XCTAssertEqual(pickTop(flat(0x20FF_FFFF)), 0xFFFF_FFFF)
    }
}
