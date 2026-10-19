// The pure part of the bathroom-scale transport (ScaleCentral.swift): identifier normalisation shared with the TypeScript side
// (src/features/scale/uuid.ts), GATT property names, hex decoding and the advertisement throttle. Foundation only, so it is tested on Linux
// (SensorLogicTests). The same rules live in ScaleLogic.kt; keep the two in step.
import Foundation

public enum ScaleLogic {
    private static let baseSuffix = "-0000-1000-8000-00805f9b34fb"

    /// 4 lowercase hex digits for a Bluetooth base UUID, otherwise the full lowercase form (what `normalizeUuid` in uuid.ts returns).
    /// CoreBluetooth's `uuidString` is already short for 16-bit UUIDs ("FFE0") and full for the rest.
    public static func normalize(_ uuid: String) -> String {
        let lower = uuid.trimmingCharacters(in: .whitespaces).lowercased()
        if lower.count == 4, lower.allSatisfy(\.isHexDigit) { return lower }
        if lower.count == 8, lower.allSatisfy(\.isHexDigit) { return lower.hasPrefix("0000") ? String(lower.dropFirst(4)) : lower }
        if lower.count == 36, lower.hasPrefix("0000"), lower.hasSuffix(baseSuffix) {
            let start = lower.index(lower.startIndex, offsetBy: 4)
            return String(lower[start..<lower.index(start, offsetBy: 4)])
        }
        return lower
    }

    /// The string CoreBluetooth's `CBUUID(string:)` accepts for a normalised UUID: 4 or 8 hex digits, or the full 36-char form.
    public static func cbString(_ normalized: String) -> String { normalized.lowercased() }

    /// The company identifier key of a manufacturer record: 4 lowercase hex digits of the 16-bit value.
    public static func companyKey(_ id: Int) -> String {
        let hex = String(id & 0xFFFF, radix: 16)
        return String(repeating: "0", count: max(0, 4 - hex.count)) + hex
    }

    /// iOS reports manufacturer data as one blob whose first two bytes are the little-endian company identifier. Nil when shorter than that.
    public static func splitManufacturer(_ data: Data) -> (key: String, payloadHex: String)? {
        let bytes = [UInt8](data)
        guard bytes.count >= 2 else { return nil }
        let id = Int(bytes[0]) | (Int(bytes[1]) << 8)
        return (companyKey(id), hexString(Data(bytes.dropFirst(2))))
    }

    /// Names of the characteristic properties as `CharacteristicProperty` of src/features/scale/types.ts, in a fixed order.
    /// The raw values are the Bluetooth ones, which CBCharacteristicProperties shares.
    public static func propertyNames(_ properties: Int) -> [String] {
        var names: [String] = []
        if properties & 0x02 != 0 { names.append("read") }
        if properties & 0x08 != 0 { names.append("write") }
        if properties & 0x04 != 0 { names.append("writeNoResponse") }
        if properties & 0x10 != 0 { names.append("notify") }
        if properties & 0x20 != 0 { names.append("indicate") }
        return names
    }

    /// Lowercase or uppercase hex without separators to bytes; nil for odd length or a non-hex digit.
    public static func fromHex(_ hex: String) -> Data? {
        let chars = Array(hex.utf8)
        guard chars.count % 2 == 0 else { return nil }
        var out = Data(capacity: chars.count / 2)
        func nibble(_ c: UInt8) -> UInt8? {
            switch c {
            case 48...57: return c - 48
            case 97...102: return c - 87
            case 65...70: return c - 55
            default: return nil
            }
        }
        var index = 0
        while index < chars.count {
            guard let hi = nibble(chars[index]), let lo = nibble(chars[index + 1]) else { return nil }
            out.append((hi << 4) | lo)
            index += 2
        }
        return out
    }
}

/// Decides which advertisements of the unfiltered scale scan reach JS: a changed payload (a new reading) always passes, an identical one at
/// most once every `repeatMs`.
public struct AdvertisementThrottle: Sendable {
    private struct Last { let fingerprint: String; let at: Int64 }

    private let repeatMs: Int64
    private var last: [String: Last] = [:]

    public init(repeatMs: Int64) { self.repeatMs = repeatMs }

    public mutating func shouldEmit(id: String, fingerprint: String, now: Int64) -> Bool {
        if let previous = last[id], previous.fingerprint == fingerprint, now - previous.at < repeatMs { return false }
        last[id] = Last(fingerprint: fingerprint, at: now)
        return true
    }

    public mutating func clear() { last.removeAll() }
}
