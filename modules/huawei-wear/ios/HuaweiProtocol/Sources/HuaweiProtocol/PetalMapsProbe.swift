// LAB ONLY (JRG-434, not for master): the Petal Maps companion probe. Port of PetalMapsProbe.kt. The watch's built-in Petal Maps app
// (`com.huawei.ohos.maps.app`) pings the phone package `com.huawei.maps.app` when it opens and shows "scan to download Petal Maps" when nobody
// answers. With the experimental switch `P2pSettings.petalMapsProbe` on, `PetalMapsProbeService` answers that ping with 0xca ("app present",
// the watch's own answer to our pings), acknowledges the app's messages (cmd 2) with 0xcf like every P2P service, and logs everything the app
// sends as `PetalProbe:` lines. It sends nothing else and makes no network call. For 30 s after each ping it also logs what the watch sends that
// nothing handles.
import Foundation

public enum PetalProbeWire {
    public static let watchPackage = "com.huawei.ohos.maps.app"
    public static let phonePackage = "com.huawei.maps.app"
    /// P2P code "the app is there", what the watch answers our own pings with.
    public static let present = 0xca
    /// The acknowledgement every P2P service sends for a message (`P2PService.onDataPacket`).
    public static let received = 0xcf
    /// How long after a ping the frames nothing handles are logged.
    public static let windowMs: Int64 = 30_000
    /// Bytes per data line: their hex and text preview stay under logcat's line limit (about 4 KB).
    public static let chunk = 512
    /// TLV values longer than this are cut in the breakdown; the data lines hold every byte.
    public static let tlvValueMax = 64
    public static let tag = "PetalProbe:"
    private static let maxDepth = 4

    public static func registeredLine() -> String {
        "\(tag) registered for the watch app \(watchPackage) (phone package \(phonePackage)); pings answered 0x\(String(present, radix: 16)), messages acknowledged 0x\(String(received, radix: 16)), nothing else is sent"
    }

    /// Every field of a P2P packet from the watch, then its data (`dump`).
    public static func describe(_ packet: P2P.P2PCommand.Response, label: String) -> [String] {
        let cmd = Int(UInt8(bitPattern: packet.cmdId))
        let head = "\(tag) \(label) cmd=\(cmd) seq=\(packet.sequenceId) code=\(packet.respCode) (0x\(String(packet.respCode, radix: 16))) src=\(packet.srcPackage) "
            + "dst=\(packet.dstPackage) srcFp=\(packet.srcFingerprint ?? "none") dstFp=\(packet.dstFingerprint ?? "none")"
        return [head] + dump("\(label) seq=\(packet.sequenceId)", packet.respData)
    }

    /// A file the watch app sent.
    public static func file(_ name: String, _ data: Bytes) -> [String] { dump("rx file \(name)", data) }

    /// A frame nothing handles, `sinceMs` after the ping: its decoded TLV (`tlv`, nil when undecodable) and the raw frame's size.
    public static func unhandled(service: Int, command: Int, tlv: Bytes?, rawSize: Int, sinceMs: Int64) -> [String] {
        let label = "unhandled svc=\(hex2(service).lowercased()) cmd=\(hex2(command).lowercased())"
        let head = "\(tag) \(label) \(sinceMs) ms after the ping, raw frame \(rawSize) bytes (its hex is on the RX line above)"
        guard let tlv else { return [head, "\(tag) \(label) tlv undecodable"] }
        return [head] + dump(label, tlv)
    }

    /// The data lines: size, full hex with a text preview in `chunk`-byte pieces, then the TLV breakdown attempt.
    public static func dump(_ label: String, _ data: Bytes?) -> [String] {
        guard let data else { return ["\(tag) \(label) data=none"] }
        if data.isEmpty { return ["\(tag) \(label) data=0 bytes"] }
        var lines = ["\(tag) \(label) data=\(data.count) bytes"]
        let pieces = (data.count + chunk - 1) / chunk
        for k in 0..<pieces {
            let piece = Array(data[(k * chunk)..<min(data.count, (k + 1) * chunk)])
            lines.append("\(tag) \(label) hex[\(k + 1)/\(pieces)] \(piece.hexUpper) |\(preview(piece))|")
        }
        if let elements = parseTLV(data, depth: 0) {
            flatten(elements, parent: "", label: label, into: &lines)
        } else {
            lines.append("\(tag) \(label) tlv: not a Huawei TLV")
        }
        return lines
    }

    /// UTF-8 text of `data` with every control character and undecodable byte shown as `.`.
    public static func preview(_ data: Bytes) -> String {
        var out = String.UnicodeScalarView()
        for scalar in String(decoding: data, as: UTF8.self).unicodeScalars {
            out.append(printable(scalar.value) ? scalar : ".")
        }
        return String(out)
    }

    private struct Element {
        let tag: Int
        let value: Bytes
        let children: [Element]?
    }

    /// Huawei TLVs: tag byte, length as a 7-bit big-endian varint, value; tags with bit 0x80 may nest. Nil unless every byte fits.
    private static func parseTLV(_ data: Bytes, depth: Int) -> [Element]? {
        var out: [Element] = []
        var i = 0
        while i < data.count {
            let tag = Int(data[i])
            i += 1
            var length = 0
            var digits = 0
            while true {
                if i >= data.count || digits == 4 { return nil }
                let b = Int(data[i])
                i += 1
                digits += 1
                length = (length << 7) | (b & 0x7F)
                if b & 0x80 == 0 { break }
            }
            if length > data.count - i { return nil }
            let value = Array(data[i..<(i + length)])
            i += length
            let children = tag & 0x80 != 0 && depth < maxDepth && !value.isEmpty ? parseTLV(value, depth: depth + 1) : nil
            out.append(Element(tag: tag, value: value, children: children))
        }
        return out.isEmpty ? nil : out
    }

    private static func flatten(_ elements: [Element], parent: String, label: String, into lines: inout [String]) {
        for e in elements {
            let path = parent + hex2(e.tag)
            if let children = e.children {
                lines.append("\(tag) \(label) tlv \(path) len=\(e.value.count): nested")
                flatten(children, parent: "\(path).", label: label, into: &lines)
            } else {
                lines.append("\(tag) \(label) tlv \(path) len=\(e.value.count): \(leaf(e.value))")
            }
        }
    }

    private static func leaf(_ value: Bytes) -> String {
        if value.isEmpty { return "(empty)" }
        if value.count > tlvValueMax { return Array(value.prefix(tlvValueMax)).hexUpper + "..." }
        var parts = value.hexUpper
        if value.count <= 4 {
            let n = value.reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
            parts += " = \(n)"
        }
        if let text = text(value) { parts += " \"\(text)\"" }
        return parts
    }

    /// The value as text when it is valid UTF-8 of two or more printable characters.
    private static func text(_ value: Bytes) -> String? {
        if value.count < 2 { return nil }
        let decoded = String(decoding: value, as: UTF8.self)
        if Array(decoded.utf8) != value { return nil }
        return decoded.unicodeScalars.allSatisfy { printable($0.value) } ? decoded : nil
    }

    private static func printable(_ cp: UInt32) -> Bool { cp >= 0x20 && !(0x7F...0x9F).contains(cp) && cp != 0xFFFD }

    private static func hex2(_ v: Int) -> String { String(format: "%02X", UInt32(truncatingIfNeeded: v)) }
}

/// See `PetalProbeWire`. Registered by `P2PStack.registerPetalProbe` while the switch is on.
public final class PetalMapsProbeService: P2PService, @unchecked Sendable {
    private let log: LogSink
    private let nowMs: @Sendable () -> Int64
    private let lock = NSLock()
    private var pingAtMs: Int64?

    public init(manager: P2PManager, log: @escaping LogSink, nowMs: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }) {
        self.log = log
        self.nowMs = nowMs
        super.init(manager: manager)
    }

    public override var module: String { PetalProbeWire.phonePackage }
    public override var package: String { PetalProbeWire.watchPackage }
    /// Unknown: the app's ping carries none, and only a message the phone sends (cmd 2) would use it; the probe sends none.
    public override var fingerprint: String { "" }

    private func note(_ message: String) { log(LogEntry(.info, service: 0x34, command: 0x01, message)) }

    public override func registered() { note(PetalProbeWire.registeredLine()) }

    public override func unregister() {
        clearPending()
        lock.p2pLocked { pingAtMs = nil }
    }

    public override func handlePacket(_ packet: P2P.P2PCommand.Response) throws {
        for line in PetalProbeWire.describe(packet, label: "rx P2P") { note(line) }
        if packet.cmdId == 1 {
            let now = nowMs()
            lock.p2pLocked { pingAtMs = now }
        }
        try super.handlePacket(packet)
    }

    public override func onPingPacket(_ packet: P2P.P2PCommand.Response) -> Int {
        note("\(PetalProbeWire.tag) answering ping seq=\(packet.sequenceId) with 0x\(String(PetalProbeWire.present, radix: 16)) (app present)")
        return PetalProbeWire.present
    }

    public override func onDataPacket(_ packet: P2P.P2PCommand.Response) -> Int {
        note("\(PetalProbeWire.tag) acknowledging message seq=\(packet.sequenceId) with 0x\(String(PetalProbeWire.received, radix: 16))")
        return PetalProbeWire.received
    }

    /// Already logged by `handlePacket`.
    public override func handleData(_ data: Bytes) throws {}

    public override func handleFile(filename: String, data: Bytes) {
        for line in PetalProbeWire.file(filename, data) { note(line) }
    }

    /// Milliseconds since the last ping while that is under `PetalProbeWire.windowMs`, else nil.
    public func sincePing() -> Int64? {
        guard let at = lock.p2pLocked({ pingAtMs }) else { return nil }
        let since = nowMs() - at
        return (0...PetalProbeWire.windowMs).contains(since) ? since : nil
    }

    /// A frame of another service/command nobody handles (`HuaweiSession.observeUnhandled`); logged inside the window only.
    public func onUnhandled(service: Int, command: Int, tlv: Bytes?, raw: Bytes) {
        guard let since = sincePing() else { return }
        for line in PetalProbeWire.unhandled(service: service, command: command, tlv: tlv, rawSize: raw.count, sinceMs: since) { note(line) }
    }

    /// A P2P packet for a package no service has (`P2PManager.setUnclaimedListener`); logged inside the window only.
    public func onUnclaimed(_ packet: P2P.P2PCommand.Response) {
        guard let since = sincePing() else { return }
        note("\(PetalProbeWire.tag) \(since) ms after the ping, a P2P packet from \(packet.srcPackage), which no service has:")
        for line in PetalProbeWire.describe(packet, label: "unclaimed P2P") { note(line) }
    }
}
