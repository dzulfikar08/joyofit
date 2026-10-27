import XCTest
@testable import HuaweiProtocol

/// The song-storage packets of service 0x25 (MusicPackets.swift) against what the real Java classes built and parsed (packetsMusic.json, written
/// by GoldenGen/src/GoldenMusic.java; the Kotlin WatchMusicTest reads the same file).
final class PacketsMusicTests: XCTestCase {
    let g = try! Golden.load("packetsMusic")

    private static func nullable(_ value: Any?) -> Any { value ?? NSNull() }

    private static func capabilities(_ c: HuaweiMusicUtils.MusicCapabilities) -> [String: Any] {
        [
            "availableSpace": Int(c.availableSpace),
            "supportedFormats": nullable(c.supportedFormats),
            "maxMusicCount": Int(c.maxMusicCount),
            "maxPlaylistCount": Int(c.maxPlaylistCount),
            "currentMusicCount": Int(c.currentMusicCount),
            "unknown": Int(c.unknown),
            "formatsRestrictions": nullable(c.formatsRestrictions.map { list in
                list.map { r -> [String: Any] in
                    [
                        "formatIdx": Int(r.formatIdx), "name": nullable(r.name), "sampleRates": nullable(r.sampleRates), "musicEncode": Int(r.musicEncode),
                        "bitrate": Int(r.bitrate), "channels": Int(r.channels), "unknownBitrate": Int(r.unknownBitrate),
                    ]
                }
            }),
        ]
    }

    func testRequestsMatchTheGoldenFrames() throws {
        let requests = g.list("requests")
        XCTAssertEqual(requests.count, 12)
        var seen = Set<Int>()
        for c in requests {
            seen.insert(c.int("command"))
            switch c.int("command") {
            case 0x04: try assertRequest(c) { MusicControl.MusicInfoParams.request() }
            case 0x0d: try assertRequest(c) { MusicControl.ExtendedMusicInfoParams.request() }
            case 0x05:
                try assertRequest(c) {
                    MusicControl.MusicList.request(
                        startFrame: Int16(truncatingIfNeeded: c.int("startFrame")), endIndex: Int16(truncatingIfNeeded: c.int("endIndex"))
                    )
                }
            case 0x08:
                let ids = (c["ids"] as? [NSNumber] ?? []).map(\.intValue)
                try assertRequest(c) {
                    MusicControl.MusicOperation.request(
                        operation: MusicControl.MusicOperation.operationRemoveSongs, playlistIndex: MusicControl.MusicOperation.playlistAllSongs,
                        playlistName: nil, musicIds: ids
                    )
                }
            default:
                try assertRequest(c) {
                    MusicControl.UploadMusicFileInfo.request(
                        songIndex: Int16(truncatingIfNeeded: c.int("songIndex")), songName: c.str("title"), songArtist: c.str("artist")
                    )
                }
            }
        }
        XCTAssertEqual(seen, [0x04, 0x05, 0x08, 0x09, 0x0d])
    }

    func testResponsesParseAsTheGoldenFile() throws {
        let responses = g.list("responses")
        XCTAssertEqual(responses.count, 18)
        XCTAssertEqual(responses.filter { !$0.bool("ok") }.count, 3, "the three MissingTagException cases")
        for c in responses {
            try assertResponse(c) { packet in
                switch c.int("command") {
                case 0x04:
                    let r = try MusicControl.MusicInfoParams.Response(packet: packet)
                    let pages = r.pageStruct.map { list in
                        list.map { p -> [String: Any] in
                            [
                                "startFrame": Int(p.startFrame), "endFrame": Int(p.endFrame), "count": Int(p.count),
                                "hashCode": PacketsKit.hex(p.hashCode),
                            ]
                        }
                    }
                    return ["frameCount": Int(r.frameCount), "params": Self.capabilities(r.params), "pageStruct": Self.nullable(pages)]
                case 0x0d:
                    return ["params": Self.capabilities(try MusicControl.ExtendedMusicInfoParams.Response(packet: packet).params)]
                case 0x05:
                    let r = try MusicControl.MusicList.Response(packet: packet)
                    return [
                        "startFrame": Int(r.startFrame), "endIndex": Int(r.endIndex),
                        "songs": r.musicList.map { ["id": Int($0.id), "title": $0.title, "artist": $0.artist, "fileName": $0.fileName] },
                    ]
                case 0x08:
                    let r = try MusicControl.MusicOperation.Response(packet: packet)
                    return [
                        "resultCode": r.resultCode, "operation": r.operation, "playlistIndex": r.playlistIndex, "playlistName": Self.nullable(r.playlistName),
                        "musicIds": Self.nullable(r.musicIds),
                    ]
                default:
                    let r = try MusicControl.UploadMusicFileInfo.UploadMusicFileInfoRequest(packet: packet)
                    return ["songIndex": Int(r.songIndex), "songFileName": r.songFileName]
                }
            }
        }
    }

    func testFormatBitsAndNamesFollowGadgetbridgesTable() {
        XCTAssertNil(HuaweiMusicUtils.parseFormatBits([]))
        XCTAssertEqual(HuaweiMusicUtils.parseFormatBits([0x05]), ["mp3", "aac"])
        // Without bit 7 the next byte is not read.
        XCTAssertEqual(HuaweiMusicUtils.parseFormatBits([0x01, 0x04]), ["mp3"])
        XCTAssertEqual(HuaweiMusicUtils.parseFormatBits([0x85, 0x04]), ["mp3", "aac", "m4a"])
        XCTAssertEqual(HuaweiMusicUtils.formatName(9), "m4a")
        XCTAssertNil(HuaweiMusicUtils.formatName(16))
        XCTAssertNil(HuaweiMusicUtils.formatName(-1))
    }
}
