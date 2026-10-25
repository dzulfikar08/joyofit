// Twin of PhotoTimeColour.kt: JoyoFit's own rule for a photo's time colour, sent as "#01" + RRGGBB when the watch asks for colours picked from
// the picture (27/01 tag 0x1b = 1). Not derived from Huawei code. Both platforms do the same integer and double arithmetic in the same order
// (no pow outside the 256-entry table, whose entries are at least 0.0016 away from a rounding edge), so they pick the same colour.
//
// The rule:
// 1. The area is the time rect cut to the photo, or the whole photo when nothing of it is left.
// 2. Its mean colour in linear-light sRGB: fully transparent pixels are skipped, a semi-transparent one counts as composited over black.
//    Linear light because that is how the eye mixes a busy area seen from arm's length; averaging the gamma-encoded values makes a
//    70 % black / 30 % white area look much darker than it is.
// 3. Its WCAG 2 relative luminance L, and four candidates: white #FFFFFF, near-black #111111 (softer than pure black on an OLED face, still
//    above 18:1 on white), and two that keep the area's hue: a light tint HSV(H, 0.25, 0.95) and a dark shade HSV(H, 0.60, 0.25). The tint
//    and shade constants are our own choice: pale and deep enough to stay readable, saturated enough that the hue shows.
// 4. The winner is the candidate with the highest WCAG contrast ratio against L, except that a hue-keeping candidate whose contrast is at
//    least 4.5 (WCAG AA for text) and within 1.0 of the best is preferred: a colour that matches the photo beats a slightly harder black or
//    white. A grey area (HSV saturation of its mean below 0.08) has no hue worth keeping and gets only white or near-black.
import Foundation

public enum PhotoTimeColour {
    private static let white: UInt32 = 0xFFFF_FFFF
    private static let nearBlack: UInt32 = 0xFF11_1111
    private static let tintSaturation = 0.25
    private static let tintValue = 0.95
    private static let shadeSaturation = 0.60
    private static let shadeValue = 0.25
    private static let greySaturationPercent = 8
    private static let minHueContrast = 4.5
    private static let huePreference = 1.0

    /// The time colour (0xFFRRGGBB) for the rect (left, top, right, bottom) of `argb` (0xAARRGGBB, row by row); the whole photo when the rect
    /// has nothing inside it. Nil only for an empty photo or pixels that do not match the size.
    public static func pick(_ argb: [UInt32], width: Int, height: Int, left: Int, top: Int, right: Int, bottom: Int) -> UInt32? {
        guard width > 0, height > 0, argb.count >= width * height else { return nil }
        var x0 = min(max(left, 0), width), x1 = min(max(right, 0), width)
        var y0 = min(max(top, 0), height), y1 = min(max(bottom, 0), height)
        if x1 <= x0 || y1 <= y0 {
            (x0, y0, x1, y1) = (0, 0, width, height)
        }
        var n = 0, sumR = 0, sumG = 0, sumB = 0
        for y in y0..<y1 {
            for x in x0..<x1 {
                let p = argb[y * width + x]
                let a = Int(p >> 24)
                if a == 0 { continue }
                n += 1
                sumR += linear[Int((p >> 16) & 0xFF)] * a
                sumG += linear[Int((p >> 8) & 0xFF)] * a
                sumB += linear[Int(p & 0xFF)] * a
            }
        }
        // Mean linear channels (0...65535), rounded; an area with no visible pixel is black.
        let d = n * 255
        let r = n == 0 ? 0 : (sumR + d / 2) / d
        let g = n == 0 ? 0 : (sumG + d / 2) / d
        let b = n == 0 ? 0 : (sumB + d / 2) / d
        let area = luminance(r, g, b)

        var candidates: [UInt32] = [white, nearBlack]
        // Hue and saturation of the mean, back in 8-bit sRGB.
        let r8 = encode(r), g8 = encode(g), b8 = encode(b)
        let maxC = max(r8, g8, b8)
        let delta = maxC - min(r8, g8, b8)
        let grey = maxC == 0 || delta * 100 < greySaturationPercent * maxC
        if !grey {
            var hue: Double
            if maxC == r8 {
                hue = 60.0 * Double(g8 - b8) / Double(delta)
            } else if maxC == g8 {
                hue = 60.0 * Double(b8 - r8) / Double(delta) + 120.0
            } else {
                hue = 60.0 * Double(r8 - g8) / Double(delta) + 240.0
            }
            if hue < 0.0 { hue += 360.0 }
            candidates.append(hsv(hue, tintSaturation, tintValue))
            candidates.append(hsv(hue, shadeSaturation, shadeValue))
        }

        let contrasts = candidates.map { contrast(luminance(of: $0), area) }
        var best = 0
        for i in 1..<candidates.count where contrasts[i] > contrasts[best] { best = i }
        var keep = -1
        for i in stride(from: 2, to: candidates.count, by: 1) {
            let c = contrasts[i]
            if c >= minHueContrast && c >= contrasts[best] - huePreference && (keep < 0 || c > contrasts[keep]) { keep = i }
        }
        return candidates[keep >= 0 ? keep : best]
    }

    /// sRGB channel (0...255) to linear light scaled to 0...65535, rounded.
    static let linear: [Int] = (0..<256).map { i in
        let s = Double(i) / 255.0
        let v = s <= 0.04045 ? s / 12.92 : pow((s + 0.055) / 1.055, 2.4)
        return Int(floor(v * 65535.0 + 0.5))
    }

    /// The 8-bit sRGB channel whose linear value is nearest to `value` (0...65535); the lower one on a tie.
    private static func encode(_ value: Int) -> Int {
        var lo = 0, hi = 255
        while lo < hi {
            let mid = (lo + hi) / 2
            if linear[mid] < value { lo = mid + 1 } else { hi = mid }
        }
        return lo > 0 && value - linear[lo - 1] <= linear[lo] - value ? lo - 1 : lo
    }

    /// WCAG 2 relative luminance (0...1) of linear channels scaled to 0...65535.
    private static func luminance(_ r: Int, _ g: Int, _ b: Int) -> Double {
        (0.2126 * Double(r) + 0.7152 * Double(g) + 0.0722 * Double(b)) / 65535.0
    }

    private static func luminance(of argb: UInt32) -> Double {
        luminance(linear[Int((argb >> 16) & 0xFF)], linear[Int((argb >> 8) & 0xFF)], linear[Int(argb & 0xFF)])
    }

    /// WCAG 2 contrast ratio (1...21).
    private static func contrast(_ a: Double, _ b: Double) -> Double {
        a > b ? (a + 0.05) / (b + 0.05) : (b + 0.05) / (a + 0.05)
    }

    /// HSV (hue 0..<360, saturation and value 0...1) to 0xFFRRGGBB.
    private static func hsv(_ hue: Double, _ saturation: Double, _ value: Double) -> UInt32 {
        let c = value * saturation
        let h = hue / 60.0
        let x = c * (1.0 - abs(h.truncatingRemainder(dividingBy: 2.0) - 1.0))
        let m = value - c
        let (r, g, b): (Double, Double, Double)
        switch Int(floor(h)) {
        case 0: (r, g, b) = (c, x, 0.0)
        case 1: (r, g, b) = (x, c, 0.0)
        case 2: (r, g, b) = (0.0, c, x)
        case 3: (r, g, b) = (0.0, x, c)
        case 4: (r, g, b) = (x, 0.0, c)
        default: (r, g, b) = (c, 0.0, x)
        }
        return 0xFF00_0000 | byte(r + m) << 16 | byte(g + m) << 8 | byte(b + m)
    }

    private static func byte(_ channel: Double) -> UInt32 {
        UInt32(floor(channel * 255.0 + 0.5))
    }
}
