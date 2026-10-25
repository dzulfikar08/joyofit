// Port of PhotoTimeColour.kt: JoyoFit's own choice of a photo's time colour, sent as "#01" + RRGGBB when the watch asks for colours picked from
// the picture (27/01 tag 0x1b = 1). A simple heuristic written for JoyoFit: the dominant colour of the area where the face draws the time, then
// a readable colour of the same hue (a pale tint over a dark area, a dark shade over a light one). Integer arithmetic only, so both platforms
// give the same result.
import Foundation

/// 1. The area is the rect (left, top, right, bottom) cut to the picture.
/// 2. Its dominant colour: every pixel goes into a coarse histogram (4 bits per channel, 4096 bins); the most populated bin wins (the lowest bin
///    on a tie) and its pixels' mean RGB is the dominant colour, so a few odd pixels or a gradient do not move it.
/// 3. The time colour: hue H (0...359), saturation S and brightness of the dominant colour; luma Y = (299 R + 587 G + 114 B) / 1000. Over a dark
///    area (Y < 128) a pale tint HSV(H, 15, 100), white for a grey area (S < 10); over a light area a dark shade HSV(H, 100, 20), `0xFF333333`
///    for a grey area.
public enum PhotoTimeColour {
    private static let bins = 4096
    private static let darkLuma = 128
    private static let greySaturation = 10
    private static let tintSaturation = 15
    private static let shadeBrightness = 20
    private static let white: UInt32 = 0xFFFF_FFFF
    private static let darkGrey: UInt32 = 0xFF33_3333

    /// The time colour (0xFFRRGGBB) for the area of `argb` (0xAARRGGBB, row by row); nil when the area is empty or the pixels do not match.
    public static func pick(_ argb: [UInt32], width: Int, height: Int, left: Int, top: Int, right: Int, bottom: Int) -> UInt32? {
        guard width >= 0, height >= 0, argb.count >= width * height else { return nil }
        let x0 = min(max(left, 0), width), x1 = min(max(right, 0), width)
        let y0 = min(max(top, 0), height), y1 = min(max(bottom, 0), height)
        guard x1 > x0, y1 > y0 else { return nil }
        return readable(dominant(argb, width: width, x0: x0, y0: y0, x1: x1, y1: y1))
    }

    /// The mean RGB (0xRRGGBB) of the most populated 4-bit-per-channel bin of the area.
    public static func dominant(_ argb: [UInt32], width: Int, x0: Int, y0: Int, x1: Int, y1: Int) -> UInt32 {
        var counts = [Int](repeating: 0, count: bins)
        var sumR = [Int](repeating: 0, count: bins), sumG = [Int](repeating: 0, count: bins), sumB = [Int](repeating: 0, count: bins)
        for y in y0..<y1 {
            for x in x0..<x1 {
                let p = argb[y * width + x]
                let r = Int((p >> 16) & 0xFF), g = Int((p >> 8) & 0xFF), b = Int(p & 0xFF)
                let bin = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
                counts[bin] += 1
                sumR[bin] += r
                sumG[bin] += g
                sumB[bin] += b
            }
        }
        var best = 0
        for bin in 1..<bins where counts[bin] > counts[best] { best = bin }
        let n = counts[best]
        return UInt32(sumR[best] / n) << 16 | UInt32(sumG[best] / n) << 8 | UInt32(sumB[best] / n)
    }

    /// The readable time colour (0xFFRRGGBB) over a background of `rgb` (0xRRGGBB).
    public static func readable(_ rgb: UInt32) -> UInt32 {
        let r = Int((rgb >> 16) & 0xFF), g = Int((rgb >> 8) & 0xFF), b = Int(rgb & 0xFF)
        let maxC = max(r, g, b), minC = min(r, g, b), delta = maxC - minC
        var hue: Int
        if delta == 0 {
            hue = 0
        } else if maxC == r {
            hue = 60 * (g - b) / delta
        } else if maxC == g {
            hue = 120 + 60 * (b - r) / delta
        } else {
            hue = 240 + 60 * (r - g) / delta
        }
        hue = ((hue % 360) + 360) % 360
        let saturation = maxC == 0 ? 0 : delta * 100 / maxC
        let luma = (299 * r + 587 * g + 114 * b) / 1000
        let grey = saturation < greySaturation
        if luma < darkLuma { return grey ? white : hsv(hue, tintSaturation, 100) }
        return grey ? darkGrey : hsv(hue, 100, shadeBrightness)
    }

    /// HSV (hue 0...359, saturation and value 0...100) to 0xFFRRGGBB.
    public static func hsv(_ hue: Int, _ saturation: Int, _ value: Int) -> UInt32 {
        let v = value * 255 / 100
        let c = v * saturation / 100
        let x = c * (60 - abs(hue % 120 - 60)) / 60
        let m = v - c
        let (r, g, b): (Int, Int, Int)
        switch hue / 60 {
        case 0: (r, g, b) = (c, x, 0)
        case 1: (r, g, b) = (x, c, 0)
        case 2: (r, g, b) = (0, c, x)
        case 3: (r, g, b) = (0, x, c)
        case 4: (r, g, b) = (x, 0, c)
        default: (r, g, b) = (c, 0, x)
        }
        return 0xFF00_0000 | UInt32(r + m) << 16 | UInt32(g + m) << 8 | UInt32(b + m)
    }
}
