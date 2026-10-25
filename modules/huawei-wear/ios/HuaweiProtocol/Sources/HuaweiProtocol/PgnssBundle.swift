// Port of PgnssBundle.kt: the experimental HW_PGNSS_PRED path (docs/agps.md, "Lab path for HW_PGNSS_PRED"), the kind rules and the check of the
// bundle JoyoFit's server answers before any of its six files may reach the watch. No network, no session.
import Foundation

/// Huawei-layout predicted ephemeris built by JoyoFit's server from public data, three days of two-hour slots in six files, sent only when the user
/// turned its own switch on (off by default, `AgpsStore.labPgnss`) and the watch asked for that kind. The watch does not check the data; wrong data
/// has wedged GPS on other watches.
public enum AgpsPgnss {
    /// The kind (last tag segment) the Fit 4 Pro names: `com.huawei.higeo_dataModule_PGNSSConfig?type=HW_EEV2/HW_PGNSS_PRED;`.
    public static let kind = "HW_PGNSS_PRED"

    /// `AgpsFetch.source` and the stored delivery source of this data.
    public static let source = "joyofit_pgnss"

    /// Huawei Health's seven-day ("SEVEN") variant is gzipped and 84 slots long; the server builds the three-day one only.
    private static let seven = "SEVEN"

    /// One tag entry (already split at `;`) names this kind: its last `/` segment is exactly `kind` and it is not the seven-day variant.
    public static func isPredEntry(_ entry: String) -> Bool {
        let last = entry.lastIndex(of: "/").map { String(entry[entry.index(after: $0)...]) } ?? entry
        return last == kind && !entry.contains(seven)
    }

    /// The stored last ask (version, tag names only) was for exactly this kind.
    public static func askedPred(version: Int, tagNames: String) -> Bool { (1...3).contains(version) && tagNames == kind }
}

/// One file of the bundle: its name, exact size, and for the five ephemeris files the block layout of `~/re/agps/FORMAT.md` sections 2 and 3.
public struct PgnssFileSpec: Sendable, Equatable {
    public let name: String
    /// Bytes per header entry (GLONASS: 8 sub-blocks of 1252); 0 for `HW_PGNSS_EXTRA`, which has no header.
    public let blockBytes: Int
    /// Bytes per record group that starts with its own count byte (GLONASS: one 1252-byte sub-block per 900 s epoch).
    public let subBlockBytes: Int
    /// Most records one (sub-)block may list.
    public let capacity: Int
    /// The exact file size: the header plus 36 blocks, or 6 248 bytes for `HW_PGNSS_EXTRA`.
    public let size: Int
    /// Seconds the slot times sit after the GPS ones (BeiDou: 14, FORMAT.md 2.3); taken off before the first-slot window check.
    public let slotOffsetS: Int
}

/// The bundle `GET /v1/agps/hw-pgnss` answers (contract shared with `server/src/agps.ts`): ASCII `JFPG`, u8 version 1, u8 file count 6, then per file
/// in the watch's pull order u8 name length, ASCII name, u32 little-endian size, bytes. Nothing follows the last file. The server checks the same
/// rules before serving (`validatePgnssBundle` in the shared package); the phone checks them again before anything reaches the watch.
public enum PgnssBundle {
    private static let magic: Bytes = Array("JFPG".utf8)
    public static let version = 1

    /// 84 header entries of {u32 GPS-second slot time, u32 offset, u32 size}; three-day mode fills the first `slots`.
    public static let headerBytes = 1008
    public static let headerEntries = 84
    public static let slots = 36
    public static let slotSeconds = 7200

    /// The first slot lies within this many seconds of the build time (HH: the next two-hour boundary after "now").
    public static let firstSlotWindowS = 7200

    /// GPS time is unix time minus 1980-01-06 plus the 18 leap seconds Huawei Health hard-codes (`unixSeconds - 315964782`).
    private static let gpsEpochUnixS = 315_964_800
    private static let leapSeconds = 18

    private static func eph(_ name: String, _ block: Int, _ sub: Int, _ capacity: Int, slotOffsetS: Int = 0) -> PgnssFileSpec {
        PgnssFileSpec(name: name, blockBytes: block, subBlockBytes: sub, capacity: capacity, size: headerBytes + slots * block, slotOffsetS: slotOffsetS)
    }

    /// The six files in the order the Fit 4 Pro pulled them from Huawei Health on 2026-10-25 (FORMAT.md section 8), with their exact sizes.
    public static let files: [PgnssFileSpec] = [
        eph("HW_PGNSS_GPS", 2564, 2564, 32),
        eph("HW_PGNSS_BDS", 5800, 5800, 63, slotOffsetS: 14),
        eph("HW_PGNSS_GLONASS", 8 * 1252, 1252, 24),
        eph("HW_PGNSS_GALILEO", 2740, 2740, 36),
        eph("HW_PGNSS_QZS", 764, 764, 10),
        PgnssFileSpec(name: "HW_PGNSS_EXTRA", blockBytes: 0, subBlockBytes: 0, capacity: 0, size: 6248, slotOffsetS: 0),
    ]

    /// The exact size of a valid bundle (799 230 bytes); also the download cap.
    public static let bundleBytes = magic.count + 2 + files.reduce(0) { $0 + 1 + $1.name.utf8.count + 4 + $1.size }

    /// A bundle the server built longer ago than this (its Last-Modified) is not offered; the phone copy is reused up to the same age.
    public static let maxAgeMs = 6 * 60 * 60 * 1000

    /// The files hold 36 two-hour slots from the build time: three days.
    public static let validMs = 3 * 24 * 60 * 60 * 1000

    /// Unix milliseconds as GPS seconds, the way Huawei Health counts them.
    public static func gpsSeconds(unixMs: Int) -> Int { unixMs / 1000 - gpsEpochUnixS + leapSeconds }

    private static func u32(_ data: Bytes, _ at: Int) -> Int {
        Int(data[at]) | Int(data[at + 1]) << 8 | Int(data[at + 2]) << 16 | Int(data[at + 3]) << 24
    }

    /// Why `data` is not a bundle the watch may be sent, or nil when it is: magic, version, count; every file present in pull order with its exact
    /// name and size and nothing after the last; each ephemeris header with 36 entries at the packed block offsets and sizes, slot times 7200 s apart
    /// and the first within two hours of the build time `builtMs`, the other 48 entries zero; every (sub-)block count within its capacity; and the
    /// server's build time known and at most `maxAgeMs` before `nowMs`.
    public static func validate(_ data: Bytes, builtMs: Int, nowMs: Int) -> String? {
        if data.count < magic.count + 2 || Array(data[0..<magic.count]) != magic { return "not a PGNSS bundle (unexpected header)" }
        let version = Int(data[4])
        if version != Self.version { return "bundle version \(version) is not known" }
        let count = Int(data[5])
        if count != files.count { return "the bundle has \(count) files (\(files.count) expected)" }
        var at = magic.count + 2
        var starts: [Int] = []
        for (index, spec) in files.enumerated() {
            if at >= data.count { return "the bundle is cut off before \(spec.name)" }
            let nameLength = Int(data[at])
            if at + 1 + nameLength > data.count { return "the bundle is cut off before \(spec.name)" }
            let name = String(decoding: data[(at + 1)..<(at + 1 + nameLength)], as: UTF8.self)
            if name != spec.name { return "file \(index + 1) is \"\(name.prefix(32))\" (\(spec.name) expected)" }
            at += 1 + nameLength
            if at + 4 > data.count { return "the bundle is cut off in \(spec.name)" }
            let size = u32(data, at)
            if size != spec.size { return "\(spec.name) is \(size) bytes (\(spec.size) expected)" }
            at += 4
            if at + spec.size > data.count { return "the bundle is cut off in \(spec.name)" }
            starts.append(at)
            at += spec.size
        }
        if at != data.count { return "\(data.count - at) bytes after the last file" }
        for (index, spec) in files.enumerated() where spec.blockBytes > 0 {
            if let problem = checkHeader(data, start: starts[index], spec) { return problem }
        }
        if builtMs <= 0 { return "the server did not say when the bundle was built" }
        if nowMs - builtMs > maxAgeMs { return "the bundle was built \((nowMs - builtMs) / 60_000) minutes ago" }
        let built = gpsSeconds(unixMs: builtMs)
        for (index, spec) in files.enumerated() where spec.blockBytes > 0 {
            let first = u32(data, starts[index]) - spec.slotOffsetS
            if first < built - firstSlotWindowS || first > built + firstSlotWindowS {
                return "\(spec.name) starts \(first - built) s from the build time (at most \(firstSlotWindowS))"
            }
        }
        return nil
    }

    /// The header and block counts of one ephemeris file starting at `start`.
    private static func checkHeader(_ data: Bytes, start: Int, _ spec: PgnssFileSpec) -> String? {
        let first = u32(data, start)
        for i in 0..<headerEntries {
            let entry = start + 12 * i
            let time = u32(data, entry)
            let offset = u32(data, entry + 4)
            let size = u32(data, entry + 8)
            if i >= slots {
                if time != 0 || offset != 0 || size != 0 { return "\(spec.name) header entry \(i) is not empty" }
                continue
            }
            let wantOffset = headerBytes + i * spec.blockBytes
            if offset != wantOffset { return "\(spec.name) header entry \(i) points at \(offset) (\(wantOffset) expected)" }
            if size != spec.blockBytes { return "\(spec.name) header entry \(i) has size \(size) (\(spec.blockBytes) expected)" }
            if time != first + i * slotSeconds { return "\(spec.name) slot \(i) is not \(slotSeconds) s after the one before" }
        }
        var block = start + headerBytes
        let end = start + spec.size
        var index = 0
        while block < end {
            let listed = Int(data[block])
            if listed > spec.capacity { return "\(spec.name) block \(index) lists \(listed) satellites (at most \(spec.capacity))" }
            block += spec.subBlockBytes
            index += 1
        }
        return nil
    }

    /// The six files of a bundle that passed `validate`, by name in pull order.
    public static func split(_ data: Bytes) -> [(name: String, data: Bytes)] {
        var out: [(name: String, data: Bytes)] = []
        var at = magic.count + 2
        for spec in files {
            at += 1 + spec.name.utf8.count + 4
            out.append((spec.name, Array(data[at..<(at + spec.size)])))
            at += spec.size
        }
        return out
    }
}
