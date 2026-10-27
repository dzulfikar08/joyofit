// Port of the song-storage part of MusicControl.java and of HuaweiMusicUtils.java (Gadgetbridge, AGPL-3.0-or-later; as modified for
// watch-fit: a plain `Song` instead of GBDeviceMusic, a song without title, artist or file name reads as "", ExtendedMusicInfoParams reads
// tag 0x0d for its second bitrate): the packets of service 0x25 that list, delete and describe the songs stored on the watch, and the
// watch's title-and-artist question during a song upload. The remote-control packets (01, 02, 03) and the playlists (06, 07) are not ported.
//
// Java mapping: every `Request` class becomes a `static func request(...) -> HuaweiPacket` with the same service/command, TLV and flags as
// the Java constructor (isEncrypted and isSliced stay at their Java default, true); every `Response` class a `struct Response: PacketResponse`
// over `packet.tlv`. Java `byte` / `short` fields keep their signed Swift types and their defaults; a missing tag is a `PacketError.missingTag`
// (Java MissingTagException), like the other packet files.
import Foundation

/// `HuaweiMusicUtils`: the capability structures of 25/04 and 25/0D and Gadgetbridge's format bit table.
public enum HuaweiMusicUtils {
    /// One page ("frame") of the song list as 25/04 describes it; GB logs it and does not use it.
    public struct PageStruct: Equatable, Sendable {
        public var startFrame: Int16 = 0
        public var endFrame: Int16 = 0
        public var count: Int16 = 0
        public var hashCode: Bytes?

        public init() {}
    }

    /// Per-format limits from 25/0D. GB marks musicEncode and unknownBitrate "not sure".
    public struct FormatRestrictions: Equatable, Sendable {
        public var formatIdx: Int8 = -1
        public var sampleRates: [String]?
        public var musicEncode: Int8 = -1
        public var bitrate: Int16 = -1
        public var channels: Int8 = 2
        public var unknownBitrate: Int16 = -1

        public init() {}

        public var name: String? { HuaweiMusicUtils.formatName(Int(formatIdx)) }
    }

    public struct MusicCapabilities: Equatable, Sendable {
        /// GB shows it as "Watch storage: %d MB".
        public var availableSpace: Int32 = 0
        public var supportedFormats: [String]?
        public var maxMusicCount: Int32 = 0
        public var maxPlaylistCount: Int32 = 0
        /// GB: "not sure".
        public var currentMusicCount: Int32 = 0
        /// GB: "not sure".
        public var unknown: Int32 = 0
        public var formatsRestrictions: [FormatRestrictions]?

        public init() {}
    }

    // GB: "I am not sure about this. Most of formats unknown for me."
    static let formats = ["mp3", "wav", "aac", "sbc", "msbc", "hwa", "cvsd", "pcm", "ape", "m4a", "flac", "opus", "ogg", "butt", "amr", "imy"]

    static let formatsByte0 = ["mp3", "wav", "aac", "sbc", "msbc", "hwa", "cvsd"]
    static let formatsByte1 = ["pcm", "ape", "m4a", "flac", "opus", "ogg", "butt"]
    static let formatsByte2 = ["amr", "imy"]

    /// The name of format index `index` of the 25/0D restrictions, or nil outside the table.
    public static func formatName(_ index: Int) -> String? {
        index >= 0 && index < formats.count ? formats[index] : nil
    }

    static func parseNext(_ dt: Int, _ info: [String], _ res: inout [String]) {
        for k in 0..<info.count where dt & (1 << k) != 0 {
            res.append(info[k])
        }
    }

    static func parseFormats(_ data: [Int]) -> [String] {
        var res = [String]()
        if data.count >= 1 { parseNext(data[0], formatsByte0, &res) }
        if data.count >= 2 { parseNext(data[1], formatsByte1, &res) }
        if data.count >= 3 { parseNext(data[2], formatsByte2, &res) }
        return res
    }

    /// Seven format bits per byte; bit 7 set means another byte follows. Nil for no bytes at all.
    public static func parseFormatBits(_ formatBits: Bytes) -> [String]? {
        if formatBits.isEmpty { return nil }
        var toDecode = [Int]()
        for formatBit in formatBits {
            let dt = Int(formatBit)
            toDecode.append(dt)
            if dt & 128 == 0 { break }
        }
        return parseFormats(toDecode)
    }
}

public enum MusicControl {
    public static let id: UInt8 = 0x25

    public static let successValue: Int32 = 0x0001_86A0

    /// Watch to phone during a song upload: which song index and file name it needs the title and artist for; the phone answers.
    public enum UploadMusicFileInfo {
        public static let id: UInt8 = 0x09

        /// Java `UploadMusicFileInfoRequest`: the watch's question (the Java class is parsed like a response).
        public struct UploadMusicFileInfoRequest: PacketResponse {
            public let songIndex: Int16
            public let songFileName: String

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "UploadMusicFileInfo")
                (songIndex, songFileName) = try PacketsJava.parsing("UploadMusicFileInfo") { (try tlv.short(0x01), try tlv.string(0x02)) }
            }
        }

        /// Java `UploadMusicFileInfoResponse`: the phone's answer, the song's title and artist.
        public static func request(songIndex: Int16, songName: String, songArtist: String) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, short: songIndex)
            tlv.put(0x03, string: songName)
            tlv.put(0x04, string: songArtist)
            return HuaweiPacket(serviceId: MusicControl.id, commandId: id, tlv: tlv)
        }
    }

    /// Free space, formats and song counts of the watch's music store, and the list's frame count.
    public enum MusicInfoParams {
        public static let id: UInt8 = 0x04

        public static func request() -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01)
            tlv.put(0x02)
            tlv.put(0x03)
            return HuaweiPacket(serviceId: MusicControl.id, commandId: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            public let params: HuaweiMusicUtils.MusicCapabilities
            public let frameCount: Int32
            public let pageStruct: [HuaweiMusicUtils.PageStruct]?

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "MusicInfoParams")
                (frameCount, params, pageStruct) = try PacketsJava.parsing("MusicInfoParams") {
                    let frameCount = try tlv.asInteger(0x01)
                    var params = HuaweiMusicUtils.MusicCapabilities()
                    if tlv.contains(0x02) { params.availableSpace = try tlv.asInteger(0x02) }
                    if tlv.contains(0x03) { params.supportedFormats = HuaweiMusicUtils.parseFormatBits(try tlv.bytes(0x03)) }
                    if tlv.contains(0x04) { params.maxMusicCount = try tlv.asInteger(0x04) }
                    if tlv.contains(0x05) { params.currentMusicCount = try tlv.asInteger(0x05) }
                    var pages: [HuaweiMusicUtils.PageStruct]?
                    if tlv.contains(0x86) {
                        pages = try tlv.object(0x86).objects(0x87).map { sub in
                            var page = HuaweiMusicUtils.PageStruct()
                            if sub.contains(0x08) { page.startFrame = try sub.short(0x08) }
                            if sub.contains(0x09) { page.endFrame = try sub.short(0x09) }
                            if sub.contains(0x0a) { page.count = try sub.short(0x0a) }
                            if sub.contains(0x0b) { page.hashCode = try sub.bytes(0x0b) }
                            return page
                        }
                    }
                    return (frameCount, params, pages)
                }
            }
        }
    }

    /// One page ("frame") of the songs on the watch.
    public enum MusicList {
        public static let id: UInt8 = 0x05

        public struct Song: Equatable, Sendable {
            public let id: Int32
            public let title: String
            public let artist: String
            public let fileName: String

            public init(id: Int32, title: String, artist: String, fileName: String) {
                self.id = id
                self.title = title
                self.artist = artist
                self.fileName = fileName
            }
        }

        public static func request(startFrame: Int16, endIndex: Int16) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, short: startFrame)
            tlv.put(0x04, short: endIndex)
            return HuaweiPacket(serviceId: MusicControl.id, commandId: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            public let startFrame: Int16
            public let endIndex: Int16
            public let musicList: [Song]

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "MusicList")
                (startFrame, endIndex, musicList) = try PacketsJava.parsing("MusicList") {
                    let startFrame = tlv.contains(0x1) ? try tlv.short(0x1) : 0
                    let endIndex = tlv.contains(0x4) ? try tlv.short(0x4) : 0
                    var songs = [Song]()
                    if tlv.contains(0x82) {
                        for sub in try tlv.object(0x82).objects(0x83) {
                            let index = try sub.asInteger(0x4)
                            let title = sub.contains(0x5) ? try sub.string(0x5) : ""
                            let artist = sub.contains(0x6) ? try sub.string(0x6) : ""
                            let fileName = sub.contains(0x7) ? try sub.string(0x7) : ""
                            songs.append(Song(id: index, title: title, artist: artist, fileName: fileName))
                        }
                    }
                    return (startFrame, endIndex, songs)
                }
            }
        }
    }

    /// Playlist and song operations, as Gadgetbridge's music manager uses them: 0 new playlist (name), 1 delete playlist, 2 rename playlist,
    /// 3 add songs to a playlist, 4 remove songs from a playlist; operation 4 on playlist 0 ("all songs") deletes the songs from the watch.
    public enum MusicOperation {
        public static let id: UInt8 = 0x08

        public static let operationRemoveSongs = 4
        public static let playlistAllSongs = 0

        /// Java `(byte) operation`, `(short) playlistIndex` and `musicId.shortValue()`: every number is truncated to its wire width.
        public static func request(operation: Int, playlistIndex: Int, playlistName: String?, musicIds: [Int]) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, byte: UInt8(truncatingIfNeeded: operation))
            if (1...4).contains(operation) {
                tlv.put(0x02, short: Int16(truncatingIfNeeded: playlistIndex))
            }
            if operation == 0 || operation == 2 {
                tlv.put(0x03, string: playlistName)
            }
            if operation == 3 || operation == 4 {
                var ids = Bytes()
                ids.reserveCapacity(musicIds.count * 2)
                for musicId in musicIds { ids.appendBE(UInt16(truncatingIfNeeded: musicId)) }
                tlv.put(0x04, bytes: ids)
            }
            return HuaweiPacket(serviceId: MusicControl.id, commandId: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            public let operation: Int
            public let playlistIndex: Int
            public let playlistName: String?
            public let musicIds: [Int]?
            public let resultCode: Int

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "MusicOperation")
                (resultCode, operation, playlistIndex, playlistName, musicIds) = try PacketsJava.parsing("MusicOperation") {
                    let resultCode = tlv.contains(0x7f) ? Int(try tlv.int(0x7f)) : -1
                    let operation = tlv.contains(0x1) ? Int(try tlv.byte(0x1)) : -1
                    let playlistIndex = tlv.contains(0x2) ? Int(try tlv.asInteger(0x2)) : -1
                    let playlistName = tlv.contains(0x3) ? try tlv.string(0x3) : nil
                    var musicIds: [Int]?
                    if tlv.contains(0x4) {
                        let raw = try tlv.bytes(0x4)
                        var ids = [Int]()
                        var at = 0
                        while raw.count - at >= 2 {
                            ids.append(Int(Int16(bitPattern: raw.u16be(at))))
                            at += 2
                        }
                        musicIds = ids
                    }
                    return (resultCode, operation, playlistIndex, playlistName, musicIds)
                }
            }
        }
    }

    /// The newer capability read: free space, formats, song and playlist limits, and per-format sample rate, bitrate and channel limits.
    public enum ExtendedMusicInfoParams {
        public static let id: UInt8 = 0x0d

        public static func request() -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01)
            tlv.put(0x02)
            tlv.put(0x03)
            tlv.put(0x04)
            tlv.put(0x05)
            return HuaweiPacket(serviceId: MusicControl.id, commandId: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            public let params: HuaweiMusicUtils.MusicCapabilities

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "ExtendedMusicInfoParams")
                params = try PacketsJava.parsing("ExtendedMusicInfoParams") {
                    var params = HuaweiMusicUtils.MusicCapabilities()
                    if tlv.contains(0x01) { params.availableSpace = try tlv.asInteger(0x01) }
                    if tlv.contains(0x02) { params.supportedFormats = HuaweiMusicUtils.parseFormatBits(try tlv.bytes(0x02)) }
                    if tlv.contains(0x03) { params.maxMusicCount = try tlv.asInteger(0x03) }
                    if tlv.contains(0x04) { params.maxPlaylistCount = try tlv.asInteger(0x04) }
                    if tlv.contains(0x05) { params.unknown = Int32(try tlv.byte(0x05)) }
                    if tlv.contains(0x86) {
                        params.formatsRestrictions = try tlv.object(0x86).objects(0x87).map { sub in
                            var restriction = HuaweiMusicUtils.FormatRestrictions()
                            if sub.contains(0x08) { restriction.formatIdx = try sub.byte(0x08) }
                            if sub.contains(0x09) { restriction.sampleRates = javaSplit(try sub.string(0x09), separator: ",") }
                            if sub.contains(0x0a) { restriction.musicEncode = try sub.byte(0x0a) }
                            if sub.contains(0x0b) { restriction.bitrate = try sub.short(0x0b) }
                            if sub.contains(0x0c) { restriction.channels = try sub.byte(0x0c) }
                            if sub.contains(0x0d) { restriction.unknownBitrate = try sub.short(0x0d) }
                            return restriction
                        }
                    }
                    return params
                }
            }
        }
    }
}
