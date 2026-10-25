// The metronome's click: 35 ms of a woodblock-like tick (two partials, 1.8 and 2.9 kHz, decaying with a 5 ms time constant after a 0.3 ms
// attack), 16-bit mono PCM at 44.1 kHz, peak about -1 dBFS. The sound starts at the first sample, so the tick lands when playback starts.
// Synthesized rather than shipped as a file: no asset to bundle per platform. Foundation only, so ClickLogicTests compiles it on Linux.
// Twin of ../android/src/main/java/com/joyodigitama/metronomeclick/ClickSound.kt; keep them in step (both test suites check the same samples).
import Foundation

enum ClickSound {
    static let sampleRate = 44_100
    static let sampleCount = 1_544 // 35 ms
    private static let decaySeconds = 0.005
    private static let attackSeconds = 0.0003
    private static let peak = 0.89

    static func samples() -> [Int16] {
        let raw = (0..<sampleCount).map { index -> Double in
            let t = Double(index) / Double(sampleRate)
            let envelope = min(1, t / attackSeconds) * exp(-t / decaySeconds)
            return envelope * (0.7 * sin(2 * Double.pi * 1800 * t) + 0.3 * sin(2 * Double.pi * 2900 * t))
        }
        let maximum = raw.map { abs($0) }.max() ?? 1
        return raw.map { Int16(($0 / maximum * peak * Double(Int16.max)).rounded()) }
    }

    /// The samples as a canonical 44-byte-header PCM WAV file.
    static func wav() -> Data {
        let pcm = samples()
        let dataBytes = pcm.count * 2
        var out = Data(capacity: 44 + dataBytes)
        func u32(_ value: Int) { withUnsafeBytes(of: UInt32(value).littleEndian) { out.append(contentsOf: $0) } }
        func u16(_ value: Int) { withUnsafeBytes(of: UInt16(value).littleEndian) { out.append(contentsOf: $0) } }
        out.append(contentsOf: Array("RIFF".utf8))
        u32(36 + dataBytes)
        out.append(contentsOf: Array("WAVEfmt ".utf8))
        u32(16) // fmt chunk size
        u16(1) // PCM
        u16(1) // mono
        u32(sampleRate)
        u32(sampleRate * 2) // byte rate
        u16(2) // block align
        u16(16) // bits per sample
        out.append(contentsOf: Array("data".utf8))
        u32(dataBytes)
        for sample in pcm {
            withUnsafeBytes(of: sample.littleEndian) { out.append(contentsOf: $0) }
        }
        return out
    }
}
