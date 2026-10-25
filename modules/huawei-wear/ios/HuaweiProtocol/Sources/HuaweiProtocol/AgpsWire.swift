// Port of the pure parts of the Kotlin satellite-data job (AgpsPolicy.kt, AgpsMessages and AgpsConsult in Ephemeris.kt / AgpsSource.kt), derived from
// Gadgetbridge (AGPL-3.0-or-later; see NOTICE): service/devices/huawei/HuaweiEphemerisManager, requests/SendEphemeris*, packets/{Ephemeris,EphemerisFileUpload}.
// What the phone says to the watch as TLVs, the schedule and the validation rules; no network, no session.
import Foundation

/// Outcome codes of the last satellite-data attempt; the same strings are read by `AgpsOutcome` in `HuaweiWearExtras.types.ts`.
public enum AgpsOutcome {
    public static let none = "none"
    /// The watch pulled the whole file and closed the transfer.
    public static let delivered = "delivered"
    /// Downloaded to the phone while no watch was connected; it goes out when the watch asks.
    public static let stored = "stored"
    /// The watch did not answer the phone's question, or never came to fetch what was ready.
    public static let watchSilent = "watch_silent"
    public static let noNetwork = "no_network"
    public static let downloadFailed = "download_failed"
    public static let invalidFile = "invalid_file"
    /// The watch asked for a kind of data this app cannot and must not make (only the watch maker's own app prepares it).
    public static let unsupported = "unsupported"
    public static let watchRefused = "watch_refused"
    public static let timeout = "timeout"
    public static let cancelled = "cancelled"
    public static let busy = "busy"
    public static let linkLost = "link_lost"
}

/// The rules of the satellite-data (A-GPS / ephemeris) job that need no link: how long data is kept, when a refresh is due, the retry schedule,
/// and what a file must look like before it is allowed near the watch.
public enum AgpsPolicy {
    /// The Broadcom LTO file predicts seven days ahead; the watch warns when its copy is older than that.
    public static let validMs = 7 * 24 * 60 * 60 * 1000

    /// A download younger than this is reused for the watch's repeated requests instead of fetching again.
    public static let cacheFreshMs = 6 * 60 * 60 * 1000

    /// Data is offered to the watch again once its last delivery is this old, well inside `validMs`.
    public static let deliverEveryMs = 24 * 60 * 60 * 1000

    /// Wait after the 1st, 2nd, ... failed download; the last step repeats. Reset by a success or by the user.
    private static let retryStepsMs = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000]

    public static func retryDelayMs(failures: Int) -> Int {
        failures <= 0 ? 0 : retryStepsMs[min(failures, retryStepsMs.count) - 1]
    }

    /// When the next automatic attempt may start after `failures` failures, the last at `lastFailureMs`; 0 when nothing waits.
    public static func retryAtMs(lastFailureMs: Int, failures: Int) -> Int {
        failures <= 0 ? 0 : lastFailureMs + retryDelayMs(failures: failures)
    }

    /// The phone-side copy is missing or old, and no retry wait is running.
    public static func prefetchDue(cachedAtMs: Int, nowMs: Int, retryAtMs: Int) -> Bool {
        nowMs >= retryAtMs && (cachedAtMs <= 0 || nowMs - cachedAtMs >= cacheFreshMs)
    }

    /// The watch has not been given data for a day (or ever): worth offering it again.
    public static func deliveryDue(deliveredAtMs: Int, nowMs: Int) -> Bool {
        deliveredAtMs <= 0 || nowMs - deliveredAtMs >= deliverEveryMs
    }

    /// When the data the watch holds stops being good; 0 when it was never delivered. The experimental HW_AGNSS file (`AgpsLab`) is good for hours,
    /// not days.
    public static func expiresAtMs(dataTimeMs: Int, source: String = "") -> Int {
        dataTimeMs <= 0 ? 0 : dataTimeMs + (source == AgpsLab.source ? agnssValidMs : validMs)
    }

    /// Broadcom LTO size bounds: the real file is about 115 KB; anything far outside is not that file.
    public static let ltoMinBytes = 16 * 1024
    public static let ltoMaxBytes = 1024 * 1024

    /// Most data one 1C/04 answer may carry, whatever the watch asks for.
    public static let maxDataPerRequest = 1024 * 1024

    /// Most frames one data answer may be cut into.
    public static let maxFrames = 65_535

    /// A transfer that is silent this long is dropped and counted as failed, so the watch is not left waiting on a dead phone.
    public static let transferStallMs = 30_000

    /// After "ready" is announced the watch has this long to come and fetch.
    public static let pullWaitMs = 60_000

    /// The download of one file may take this long.
    public static let downloadTimeoutMs = 120_000

    /// The Broadcom LTO file starts with these three bytes (checked on the public file, 115749 bytes, 2026-10-18).
    private static let ltoMagic: Bytes = [0xFF, 0xCA, 0xDE]

    /// Why `data` is not fit to send as the Broadcom LTO file, or nil when it is.
    public static func validateLto(_ data: Bytes) -> String? {
        if data.count < ltoMinBytes { return "file too small (\(data.count) bytes)" }
        if data.count > ltoMaxBytes { return "file too large (\(data.count) bytes)" }
        if Array(data[0..<ltoMagic.count]) != ltoMagic { return "not an LTO file (unexpected header)" }
        return nil
    }

    /// Frames needed to send `size` bytes in frames of `frameSize`; nil when that is not a sane transfer.
    public static func frameCount(size: Int, frameSize: Int) -> Int? {
        if size <= 0 || frameSize <= 0 { return nil }
        let count = (size + frameSize - 1) / frameSize
        return count > maxFrames ? nil : count
    }

    /// Broadcast ephemeris is good for about four hours around its epoch; the file holds GPS records up to four hours old.
    public static let agnssValidMs = 4 * 60 * 60 * 1000

    /// The server rebuilds the HW_AGNSS file every 15 minutes; a phone copy that young is reused for the watch's repeated asks.
    public static let agnssCacheFreshMs = 15 * 60 * 1000

    /// A HW_AGNSS file the server built longer ago than this (its Last-Modified) is not offered.
    public static let agnssMaxAgeMs = 2 * 60 * 60 * 1000

    /// HW_AGNSS file bounds, the same as the server's (`packages/agps-rtcm`, `validateHwAgnss`): about 7.4 to 8 KB for 120 satellites in practice.
    public static let rtcmMinBytes = 512
    public static let rtcmMaxBytes = 16 * 1024
    public static let rtcmMinSatellites = 20

    /// The four RTCM 3 ephemeris messages: GPS, GLONASS, BeiDou, Galileo I/NAV.
    private static let rtcmMessages: Set<Int> = [1019, 1020, 1042, 1046]

    /// CRC-24Q of RTCM 3 (polynomial 0x1864CFB) over `data[range]`.
    public static func crc24q(_ data: Bytes, _ range: Range<Int>? = nil) -> Int {
        var crc = 0
        for i in range ?? 0..<data.count {
            crc ^= Int(data[i]) << 16
            for _ in 0..<8 {
                crc <<= 1
                if crc & 0x1000000 != 0 { crc ^= 0x1864CFB }
            }
        }
        return crc & 0xFFFFFF
    }

    /// Why `data` is not fit to send as the HW_AGNSS file, or nil when it is: size bounds, every byte inside a frame (`D3`, reserved bits zero,
    /// CRC-24Q correct), only the four ephemeris messages, at least `rtcmMinSatellites` frames. The server checks the same before serving.
    public static func validateRtcm(_ data: Bytes) -> String? {
        if data.count < rtcmMinBytes { return "file too small (\(data.count) bytes)" }
        if data.count > rtcmMaxBytes { return "file too large (\(data.count) bytes)" }
        func byte(_ k: Int) -> Int { k < data.count ? Int(data[k]) : 0 }
        var frames = 0
        var i = 0
        while i < data.count {
            if byte(i) != 0xD3 || byte(i + 1) & 0xFC != 0 { return "not an RTCM 3 frame at byte \(i)" }
            let length = ((byte(i + 1) & 3) << 8) | byte(i + 2)
            let end = i + 3 + length
            if length < 2 || end + 3 > data.count { return "RTCM frame at byte \(i) is cut off" }
            let crc = (byte(end) << 16) | (byte(end + 1) << 8) | byte(end + 2)
            if crc24q(data, i..<end) != crc { return "RTCM frame at byte \(i) fails its CRC" }
            let type = (byte(i + 3) << 4) | (byte(i + 4) >> 4)
            if !rtcmMessages.contains(type) { return "unexpected RTCM message \(type) at byte \(i)" }
            frames += 1
            i = end + 3
        }
        if frames < rtcmMinSatellites { return "only \(frames) satellites (at least \(rtcmMinSatellites) needed)" }
        return nil
    }

    /// The satellites (frames) in a file that passed `validateRtcm`.
    public static func rtcmFrames(_ data: Bytes) -> Int {
        var frames = 0
        var i = 0
        while i + 2 < data.count {
            i += 6 + ((Int(data[i + 1]) & 3) << 8 | Int(data[i + 2]))
            frames += 1
        }
        return frames
    }

    /// `validateRtcm`, and the server's build time `builtMs` (its Last-Modified) must be known and at most `agnssMaxAgeMs` before `nowMs`.
    public static func validateAgnss(_ data: Bytes, builtMs: Int, nowMs: Int) -> String? {
        if let problem = validateRtcm(data) { return problem }
        if builtMs <= 0 { return "the server did not say when the file was built" }
        if nowMs - builtMs > agnssMaxAgeMs { return "the file was built \((nowMs - builtMs) / 60_000) minutes ago" }
        return nil
    }
}

/// The experimental HW_AGNSS path (docs/agps.md, "Lab path"): RTCM 3 broadcast ephemeris built by JoyoFit's server from BKG's open data, sent only
/// when the user turned the switch on (off by default, `AgpsStore.labAgnss`) and the watch asked for exactly that one kind. The watch does not
/// check the data; wrong data has wedged GPS on other watches. Everything else stays declined.
public enum AgpsLab {
    /// The kind (last tag segment) the watch names: `higeo/v1/gnssinfo?type=0x0024/HW_AGNSS` (Fit 4 Pro), `type=0x0004` (Band 11 Pro).
    public static let kind = "HW_AGNSS"

    /// The one file the watch pulls for it (2026-10-25 capture of Huawei Health).
    public static let file = "HW_AGNSS_RTCM_33"

    /// `AgpsFetch.source` and the stored delivery source of this data.
    public static let source = "joyofit_rtcm"

    /// The consult is a download version 1 to 3 asking for exactly one kind, a tag that ends in `/HW_AGNSS`.
    public static func asksHwAgnss(_ consult: AgpsConsult) -> Bool {
        let entries = consult.tag.split(separator: ";", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        return (1...3).contains(consult.version) && entries.count == 1 && entries[0].hasSuffix("/\(kind)")
    }

    /// The stored last ask (version, tag names only) was for exactly this kind.
    public static func askedHwAgnss(version: Int, tagNames: String) -> Bool { (1...3).contains(version) && tagNames == kind }
}

/// What the watch said in its answer to the phone's parameter question (1F/02).
public struct AgpsConsult: Sendable, Equatable {
    public let version: Int
    public let tag: String
    public let urls: [String]

    public init(version: Int, tag: String, urls: [String]) {
        self.version = version
        self.tag = tag
        self.urls = urls
    }

    /// The tag names only, each entry cut at its last `/`: the path before it can carry a rough position and is not kept.
    public var tagNames: String {
        tag.split(separator: ";", omittingEmptySubsequences: false)
            .map { entry -> String in
                let trimmed = entry.trimmingCharacters(in: .whitespacesAndNewlines)
                return trimmed.lastIndex(of: "/").map { String(trimmed[trimmed.index(after: $0)...]) } ?? trimmed
            }
            .filter { !$0.isEmpty }
            .joined(separator: ",")
    }

    /// The question the phone asks itself when no watch is involved: the default (version 0) data.
    public static let `default` = AgpsConsult(version: 0, tag: "", urls: [])
}

extension HuaweiTLV {
    /// Kotlin `agpsUnsigned`: 1 to 8 big-endian bytes as one number; nil when absent, empty or longer.
    func agpsLong(_ tag: Int) -> Int64? {
        guard let bytes = bytes(tag, default: nil), !bytes.isEmpty, bytes.count <= 8 else { return nil }
        var value: Int64 = 0
        for b in bytes { value = (value << 8) | Int64(b) }
        return value
    }

    /// `agpsLong(...).toInt()` as Kotlin does it: the low 32 bits, signed.
    func agpsInt(_ tag: Int) -> Int? {
        agpsLong(tag).map { Int(Int32(truncatingIfNeeded: $0)) }
    }

    func agpsString(_ tag: Int) -> String? {
        bytes(tag, default: nil).map { String(decoding: $0, as: UTF8.self) }
    }
}

/// What the phone says to the watch, as TLVs; kept apart from the state machine so the bytes can be checked on their own.
public enum AgpsMessages {
    public static let agpsService = 0x1F
    public static let fileService = 0x1C

    public static let codeOk = 100_000
    public static let codeFailed = 100_001
    public static let codeNoNetwork = 100_007

    /// 1F/03 download states.
    public static let stateReady = 3
    public static let stateFailed = 4
    public static let stateUnsupported = 5

    /// 1F/01: `7F code`.
    public static func operatorAnswer(code: Int) -> HuaweiTLV {
        var tlv = HuaweiTLV()
        tlv.put(0x7F, int: Int32(truncatingIfNeeded: code))
        return tlv
    }

    /// 1F/02: the phone asks the watch for its parameters.
    public static func parameterConsult() -> HuaweiTLV {
        var tlv = HuaweiTLV()
        tlv.put(0x81)
        return tlv
    }

    /// 1F/01 for the watch's progress poll: `81{02: 02, 03: the watch's own time bytes, 04: state}`.
    public static func progressAnswer(timeBytes: Bytes, state: Int) -> HuaweiTLV {
        var inner = HuaweiTLV()
        inner.put(0x02, byte: 2)
        inner.put(0x03, bytes: timeBytes)
        inner.put(0x04, byte: UInt8(truncatingIfNeeded: state))
        var tlv = HuaweiTLV()
        tlv.put(0x81, tlv: inner)
        return tlv
    }

    /// 1F/03: `01 state`.
    public static func fileStatus(state: Int) -> HuaweiTLV {
        var tlv = HuaweiTLV()
        tlv.put(0x01, byte: UInt8(truncatingIfNeeded: state))
        return tlv
    }

    /// 1C/01 with the file names (`a;b`).
    public static func fileList(names: [String]) -> HuaweiTLV {
        var tlv = HuaweiTLV()
        tlv.put(0x01, string: names.joined(separator: ";"))
        return tlv
    }

    /// The answer to anything the phone refuses: `7F 100001`.
    public static func refused() -> HuaweiTLV { operatorAnswer(code: codeFailed) }

    /// 1C/02, 1C/06 accept: `7F 100000`.
    public static func accepted() -> HuaweiTLV { operatorAnswer(code: codeOk) }

    /// 1C/03: `02 size (i32), 03 CRC16 (init 0, i16)`.
    public static func fileInfo(size: Int, crc16: Int) -> HuaweiTLV {
        var tlv = HuaweiTLV()
        tlv.put(0x02, int: Int32(truncatingIfNeeded: size))
        tlv.put(0x03, short: Int16(truncatingIfNeeded: crc16))
        return tlv
    }

    /// 1C/04: `7F, 02 stored name, 03 offset`; the frames follow as 1C/05.
    public static func dataAnswer(storedName: String, offset: Int) -> HuaweiTLV {
        var tlv = HuaweiTLV()
        tlv.put(0x7F, int: Int32(truncatingIfNeeded: codeOk))
        tlv.put(0x02, string: storedName)
        tlv.put(0x03, int: Int32(truncatingIfNeeded: offset))
        return tlv
    }

    /// The consult answer of the watch: `81{04 time, 05 version, 06 tags, children 8x{03 url}}`; nil without the 0x81 container.
    public static func parseConsult(_ tlv: HuaweiTLV?) -> AgpsConsult? {
        guard let tlv, tlv.contains(0x81), let body = try? tlv.object(0x81) else { return nil }
        let version = body.agpsInt(0x05) ?? -1
        let tag = body.agpsString(0x06) ?? ""
        let children = (try? body.allContainerObjects()) ?? []
        let urls = children.compactMap { child -> String? in child.contains(0x03) ? child.agpsString(0x03) : nil }
        return AgpsConsult(version: version, tag: tag, urls: urls)
    }
}
