import XCTest
@testable import HuaweiProtocol

/// Port of PhotoTimeColourTest.kt: JoyoFit's time colour heuristic on synthetic 408 x 480 pictures with the Fit 4 Pro photo face's top time area
/// (68, 18, 406, 182).
final class PhotoTimeColourTests: XCTestCase {
    let w = 408
    let h = 480

    func flat(_ colour: UInt32) -> [UInt32] { [UInt32](repeating: colour, count: w * h) }

    func pickTop(_ pixels: [UInt32]) -> UInt32? { PhotoTimeColour.pick(pixels, width: w, height: h, left: 68, top: 18, right: 406, bottom: 182) }

    func testADarkAreaGetsAPaleTintOfItsHueAndALightOneADarkShade() {
        XCTAssertEqual(pickTop(flat(0xFF10_2060)), 0xFFD9_E0FF)
        XCTAssertEqual(pickTop(flat(0xFFF0_E68C)), 0xFF33_2D00)
    }

    func testGreyAreasGetWhiteOrDarkGrey() {
        XCTAssertEqual(pickTop(flat(0xFF00_0000)), 0xFFFF_FFFF)
        XCTAssertEqual(pickTop(flat(0xFFFF_FFFF)), 0xFF33_3333)
        XCTAssertEqual(pickTop(flat(0xFF80_8080)), 0xFF33_3333)
    }

    func testTheDominantColourWinsOverAMinority() {
        let limit = (406 - 68) * 7 / 10
        let pixels = (0..<(w * h)).map { i -> UInt32 in i % w - 68 < limit ? 0xFF10_2060 : 0xFFFF_FFFF }
        XCTAssertEqual(pickTop(pixels), 0xFFD9_E0FF)
    }

    func testOnlyTheTimeAreaCounts() {
        let pixels = (0..<(w * h)).map { i -> UInt32 in
            let x = i % w, y = i / w
            return (68..<406).contains(x) && (18..<182).contains(y) ? 0xFFF0_E68C : 0xFFFF_0000
        }
        XCTAssertEqual(pickTop(pixels), 0xFF33_2D00)
    }

    func testSmallNoiseDoesNotMoveTheDominantColour() {
        let pixels = (0..<(w * h)).map { i -> UInt32 in
            let d = (i * 7) % 9 - 4
            return 0xFF00_0000 | UInt32(40 + d) << 16 | UInt32(90 + d) << 8 | UInt32(60 + d)
        }
        XCTAssertEqual(PhotoTimeColour.dominant(pixels, width: w, x0: 68, y0: 18, x1: 406, y1: 182), 0x27_593B)
        XCTAssertEqual(pickTop(pixels), 0xFFD9_FFE8)
    }

    func testTheAreaIsCutToThePictureAndAnEmptyOneHasNoColour() {
        XCTAssertEqual(PhotoTimeColour.pick(flat(0xFF10_2060), width: w, height: h, left: 300, top: 400, right: 600, bottom: 600), 0xFFD9_E0FF)
        XCTAssertNil(PhotoTimeColour.pick(flat(0xFF10_2060), width: w, height: h, left: 500, top: 500, right: 600, bottom: 600))
        // A tie between two bins goes to the lower bin (dark blue before white).
        let tie: [UInt32] = [0xFF10_2060, 0xFF10_2060, 0xFFFF_FFFF, 0xFF10_2060, 0xFFFF_FFFF, 0xFFFF_FFFF]
        XCTAssertEqual(PhotoTimeColour.pick(tie, width: 3, height: 2, left: 0, top: 0, right: 3, bottom: 2), 0xFFD9_E0FF)
    }
}
