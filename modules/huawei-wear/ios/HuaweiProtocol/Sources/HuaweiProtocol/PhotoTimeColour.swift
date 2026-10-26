// Twin of PhotoTimeColour.kt: JoyoFit's own rule for a photo's time colour, sent as "#01" + RRGGBB when the watch asks for colours picked from
// the picture (27/01 tag 0x1b = 1). Not derived from Huawei code. Both platforms do the same integer and double arithmetic in the same order
// (no pow outside the 256-entry table, whose entries are at least 0.0016 away from a rounding edge), so they pick the same colour.
//
// The rule:
// 1. The area is the time rect cut to the photo, or the whole photo when nothing of it is left. It is sampled on a grid of at most 4096 pixels
//    (every s-th column and row from the area's corner, s as small as allows). Fully transparent pixels are skipped; a semi-transparent one
//    counts as composited over black. Each sample's WCAG 2 relative luminance is taken in linear-light sRGB.
// 2. Four candidates: white #FFFFFF, near-black #111111 (softer than pure black on an OLED face, still above 18:1 on white), and two that keep
//    the hue of the samples' linear mean: a light tint HSV(H, 0.25, 0.95) and a dark shade HSV(H, 0.60, 0.25). A grey area (HSV saturation
//    of that mean below 0.08) has no hue worth keeping and gets only white and near-black.
// 3. A candidate's score is its 20th-percentile WCAG contrast ratio over the samples: the contrast it reaches on at least 80 % of the area.
//    Scoring against the mean instead lets a few bright highlights lift a mostly dark area into "light", so near-black digits end up on dark
//    ground; the percentile follows what most of the area looks like.
// 4. The best score wins, white on a tie (light digits read best on photos). A hue-keeping candidate whose score is at least 3.0 and within
//    0.5 of the best is preferred: a colour that matches the photo beats a slightly harder black or white. An area with no visible pixel gets
//    white.
import Foundation

public enum PhotoTimeColour {
    private static let maxSamples = 4096
    private static let white: UInt32 = 0xFFFF_FFFF
    private static let nearBlack: UInt32 = 0xFF11_1111
    private static let tintSaturation = 0.25
    private static let tintValue = 0.95
    private static let shadeSaturation = 0.60
    private static let shadeValue = 0.25
    private static let greySaturationPercent = 8
    private static let minHueScore = 3.0
    private static let huePreference = 0.5

    /// The time colour (0xFFRRGGBB) for the rect (left, top, right, bottom) of `argb` (0xAARRGGBB, row by row); the whole photo when the rect
    /// has nothing inside it. Nil only for an empty photo or pixels that do not match the size.
    public static func pick(_ argb: [UInt32], width: Int, height: Int, left: Int, top: Int, right: Int, bottom: Int) -> UInt32? {
        guard width > 0, height > 0, argb.count >= width * height else { return nil }
        var x0 = min(max(left, 0), width), x1 = min(max(right, 0), width)
        var y0 = min(max(top, 0), height), y1 = min(max(bottom, 0), height)
        if x1 <= x0 || y1 <= y0 {
            (x0, y0, x1, y1) = (0, 0, width, height)
        }
        let step = gridStep(x1 - x0, y1 - y0)
        var luminances = [Double]()
        luminances.reserveCapacity(maxSamples)
        var sumR = 0, sumG = 0, sumB = 0
        for y in stride(from: y0, to: y1, by: step) {
            for x in stride(from: x0, to: x1, by: step) {
                let p = argb[y * width + x]
                let a = Int(p >> 24)
                if a == 0 { continue }
                let r = (linear[Int((p >> 16) & 0xFF)] * a + 127) / 255
                let g = (linear[Int((p >> 8) & 0xFF)] * a + 127) / 255
                let b = (linear[Int(p & 0xFF)] * a + 127) / 255
                sumR += r
                sumG += g
                sumB += b
                luminances.append(luminance(r, g, b))
            }
        }
        let n = luminances.count
        if n == 0 { return white }

        var candidates: [UInt32] = [white, nearBlack]
        // Hue and saturation of the samples' linear mean, back in 8-bit sRGB.
        let r8 = encode((sumR + n / 2) / n), g8 = encode((sumG + n / 2) / n), b8 = encode((sumB + n / 2) / n)
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

        var contrasts = [Double](repeating: 0, count: n)
        let scores: [Double] = candidates.map { c in
            let candidate = luminance(of: c)
            for k in 0..<n { contrasts[k] = contrast(candidate, luminances[k]) }
            contrasts.sort()
            return contrasts[n / 5]
        }
        var best = 0
        for i in 1..<candidates.count where scores[i] > scores[best] { best = i }
        var keep = -1
        for i in stride(from: 2, to: candidates.count, by: 1) {
            let s = scores[i]
            if s >= minHueScore && s >= scores[best] - huePreference && (keep < 0 || s > scores[keep]) { keep = i }
        }
        return candidates[keep >= 0 ? keep : best]
    }

    /// The smallest grid step that samples at most `maxSamples` pixels of a `w` x `h` area.
    private static func gridStep(_ w: Int, _ h: Int) -> Int {
        var s = 1
        while ((w + s - 1) / s) * ((h + s - 1) / s) > maxSamples { s += 1 }
        return s
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
