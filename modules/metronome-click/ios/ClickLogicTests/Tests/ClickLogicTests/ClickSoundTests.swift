import XCTest

@testable import ClickLogic

final class ClickSoundTests: XCTestCase {
    private let samples = ClickSound.samples()

    private func assertNear(_ expected: Int, _ actual: Int16, file: StaticString = #filePath, line: UInt = #line) {
        // libm differences between platforms may move a rounded sample by one step.
        XCTAssertLessThanOrEqual(abs(expected - Int(actual)), 1, "expected \(expected), got \(actual)", file: file, line: line)
    }

    func testIsThirtyFiveMillisecondsAt44kHz() {
        XCTAssertEqual(samples.count, 1_544)
        XCTAssertEqual(Double(samples.count) * 1000 / Double(ClickSound.sampleRate), 35, accuracy: 0.02)
    }

    func testStartsAtTheFirstSampleAndDecaysToSilence() {
        XCTAssertEqual(samples[0], 0)
        XCTAssertGreaterThan(abs(Int(samples[5])), 10_000)
        XCTAssertTrue(samples.suffix(20).allSatisfy { abs(Int($0)) < 400 })
    }

    func testPeaksAtAboutMinusOneDbfs() {
        let peak = samples.map { abs(Int($0)) }.max() ?? 0
        XCTAssertTrue((29_162...29_163).contains(peak), "peak \(peak)")
    }

    /// The same values `ClickSoundTest.kt` checks: the Kotlin and Swift twins make the same sound.
    func testMatchesTheKotlinTwin() {
        assertNear(806, samples[1])
        assertNear(12_417, samples[5])
        assertNear(-12_353, samples[13])
        assertNear(-29_163, samples[42])
        assertNear(4_697, samples[100])
        assertNear(5_294, samples[400])
        assertNear(-362, samples[1_000])
    }

    func testWavHeaderDescribesSixteenBitMonoPcm() {
        let wav = [UInt8](ClickSound.wav())
        XCTAssertEqual(wav.count, 44 + 1_544 * 2)
        XCTAssertEqual(Array(wav[0..<4]), Array("RIFF".utf8))
        XCTAssertEqual(Array(wav[8..<16]), Array("WAVEfmt ".utf8))
        XCTAssertEqual(Array(wav[36..<40]), Array("data".utf8))
        func u32(_ at: Int) -> Int { (0..<4).reduce(0) { $0 | Int(wav[at + $1]) << (8 * $1) } }
        func u16(_ at: Int) -> Int { Int(wav[at]) | Int(wav[at + 1]) << 8 }
        XCTAssertEqual(u32(4), wav.count - 8)
        XCTAssertEqual(u16(20), 1)
        XCTAssertEqual(u16(22), 1)
        XCTAssertEqual(u32(24), 44_100)
        XCTAssertEqual(u32(28), 88_200)
        XCTAssertEqual(u16(34), 16)
        XCTAssertEqual(u32(40), 1_544 * 2)
        XCTAssertEqual(u16(44 + 5 * 2), Int(UInt16(bitPattern: samples[5])))
    }
}
