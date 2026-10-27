import Foundation
import XCTest
@testable import HuaweiProtocol

/// Songs on the watch (WatchMusic.swift): the file checks and `WatchMusicOps` against a fake watch (info, paging, delete, the upload with
/// its 25/09 question, cancellation). The cases of the Kotlin WatchMusicTest; its golden-file cases are PacketsMusicTests.swift.
final class WatchMusicTests: XCTestCase {
    // MARK: file checks

    private let mp3Frame: Bytes = [0xFF, 0xFB, 0x90, 0x64] + Bytes(repeating: 0, count: 60)
    private let mpeg2Frame: Bytes = [0xFF, 0xF3, 0x90, 0x64] + Bytes(repeating: 0, count: 60)
    private let adtsFrame: Bytes = [0xFF, 0xF1, 0x50, 0x80] + Bytes(repeating: 0, count: 60)
    private func id3(_ body: Int) -> Bytes { Array("ID3".utf8) + [4, 0, 0, 0, 0, UInt8(body >> 7), UInt8(body & 0x7F)] + Bytes(repeating: 0, count: body) }
    private let m4a: Bytes = [0, 0, 0, 0x20] + Array("ftypM4A ".utf8) + Bytes(repeating: 0, count: 40)

    private func info(formats: [String] = ["mp3", "aac", "m4a"], free: Int? = 100) -> MusicInfo {
        MusicInfo(freeSpaceMb: free, formats: formats, maxSongs: 500, songCount: 0, maxPlaylists: nil, frameCount: 1, limits: [], extended: false)
    }

    func testProbesFormatsByContent() {
        XCTAssertEqual(MusicFiles.probe(mp3Frame), SongProbe(format: .mp3, sampleRate: 44100, detail: "MPEG audio frame at 0"))
        XCTAssertEqual(MusicFiles.probe(mpeg2Frame)?.sampleRate, 22050)
        XCTAssertEqual(MusicFiles.probe(id3(300) + mp3Frame)?.format, .mp3)
        XCTAssertEqual(MusicFiles.probe(id3(300) + mp3Frame)?.detail, "ID3v2.4 tag of 310 bytes, MPEG audio frame at 310")
        XCTAssertEqual(MusicFiles.probe(adtsFrame), SongProbe(format: .aac, sampleRate: 44100, detail: "ADTS at 0"))
        XCTAssertEqual(MusicFiles.probe(id3(20) + adtsFrame)?.format, .aac)
        XCTAssertEqual(MusicFiles.probe(m4a), SongProbe(format: .m4a, sampleRate: nil, detail: "MP4 brand 'M4A '"))
        XCTAssertNil(MusicFiles.probe(Array("fLaC".utf8) + Bytes(repeating: 0, count: 40)))
        XCTAssertNil(MusicFiles.probe(Array("RIFF....WAVE".utf8) + Bytes(repeating: 0, count: 40)))
        // MPEG Layer II is not MP3.
        XCTAssertNil(MusicFiles.probe([0xFF, 0xFD, 0x90, 0x64]))
        XCTAssertNil(MusicFiles.probe([]))
    }

    private func rejected(_ name: String, _ data: Bytes, _ info: MusicInfo?, file: StaticString = #filePath, line: UInt = #line) -> String {
        do {
            _ = try MusicFiles.check(name: name, data: data, info: info)
        } catch let e as WearError {
            XCTAssertEqual(e.code, .invalidArgument, file: file, line: line)
            return e.message
        } catch {
            XCTFail("\(name): \(error)", file: file, line: line)
            return ""
        }
        XCTFail("\(name) was accepted", file: file, line: line)
        return ""
    }

    func testChecksNameContentWatchFormatsAndSpace() throws {
        XCTAssertEqual(try MusicFiles.check(name: "Lari Pagi.MP3", data: mp3Frame, info: info()).format, .mp3)
        XCTAssertEqual(try MusicFiles.check(name: "a.m4a", data: m4a, info: info()).format, .m4a)
        XCTAssertEqual(try MusicFiles.check(name: "a.aac", data: adtsFrame, info: nil).format, .aac)
        XCTAssertTrue(rejected("song.flac", Array("fLaC".utf8), info()).contains("not an MP3, M4A or AAC"))
        XCTAssertTrue(rejected("song.wav", Bytes(repeating: 0, count: 10), info()).contains("not an MP3"))
        XCTAssertTrue(rejected("song", mp3Frame, info()).contains("not an MP3"))
        XCTAssertEqual(rejected("empty.mp3", [], info()), "'empty.mp3' is empty.")
        XCTAssertEqual(rejected("x.mp3", m4a, info()), "'x.mp3' is named .mp3 but contains M4A audio; rename it to .m4a.")
        XCTAssertEqual(rejected("x.mp3", Bytes(repeating: 1, count: 64), info()), "'x.mp3' does not contain MP3 audio JoyoFit recognises.")
        XCTAssertEqual(rejected("x.m4a", m4a, info(formats: ["mp3", "aac"])), "The watch does not take M4A files (it lists mp3, aac).")
        XCTAssertEqual(
            rejected("x.mp3", mp3Frame + Bytes(repeating: 0, count: 2 * 1024 * 1024), info(free: 1)), "'x.mp3' is 3 MB; the watch has 1 MB free."
        )
        // An empty format list (the watch sent no bits) or no free space value does not block the file.
        XCTAssertEqual(try MusicFiles.check(name: "x.mp3", data: mp3Frame, info: info(formats: [], free: nil)).format, .mp3)
        XCTAssertEqual(MusicFiles.titleFallback("Lari Pagi.mp3"), "Lari Pagi")
        XCTAssertEqual(MusicFiles.titleFallback(".mp3"), ".mp3")
        XCTAssertEqual(MusicFiles.titleFallback("a.b.mp3"), "a.b")
        XCTAssertEqual(MusicFiles.watchFileName("/storage/x/a b.mp3"), "a b.mp3")
        XCTAssertEqual(MusicFiles.watchFileName("C:\\music\\ lagu.m4a "), "lagu.m4a")
        XCTAssertEqual(MusicFiles.extension("x."), nil)
        XCTAssertEqual(MusicFiles.extension("Lagu.AaC"), "aac")
    }

    func testInfoJsHasEveryFieldOfTheTypeScriptInterface() {
        let full = MusicInfo(
            freeSpaceMb: 800, formats: ["mp3"], maxSongs: 300, songCount: 4, maxPlaylists: 5, frameCount: 3,
            limits: [MusicFormatLimit(formatIndex: 40, format: nil, sampleRates: [], bitrate: nil, channels: 2)], extended: true
        ).toJS()
        XCTAssertEqual(Set(full.keys), ["freeSpaceMb", "formats", "maxSongs", "songCount", "maxPlaylists", "frameCount", "limits", "extended"])
        let limit = (full["limits"] as? [[String: Any]])?.first ?? [:]
        XCTAssertEqual(Set(limit.keys), ["formatIndex", "format", "sampleRates", "bitrate", "channels"])
        XCTAssertTrue(limit["format"] is NSNull)
        XCTAssertTrue(limit["bitrate"] is NSNull)
        let empty = info(free: nil).toJS()
        XCTAssertTrue(empty["freeSpaceMb"] is NSNull)
        XCTAssertTrue(empty["maxPlaylists"] is NSNull)
        XCTAssertEqual(Set(WatchSong(id: 1, title: "t", artist: "a", fileName: "f.mp3").toJS().keys), ["id", "title", "artist", "fileName"])
    }

    // MARK: WatchMusicOps against a fake watch

    private func setup(
        queryMs: Int = 2_000, infoGraceMs: Int = 300, _ respond: @escaping UploadFakeWatch.Responder
    ) -> (watch: UploadFakeWatch, ops: WatchMusicOps, logs: SleepFilesLogCollector, session: HuaweiSession) {
        let logs = SleepFilesLogCollector()
        let watch = UploadFakeWatch(respond)
        let session = HuaweiSession(sink: watch, log: logs.sink)
        session.params.secretKey = Bytes(repeating: 0, count: 16)
        watch.attach(session)
        return (watch, WatchMusicOps(session: session, caps: nil, log: logs.sink, queryMs: queryMs, infoGraceMs: infoGraceMs, stallMs: 2_000), logs, session)
    }

    private func frame(_ service: UInt8, _ command: UInt8, _ build: (inout HuaweiTLV) -> Void) -> Bytes {
        var tlv = HuaweiTLV()
        build(&tlv)
        return UploadFakeWatch.tlvFrame(service, command, tlv)
    }

    private func song(_ id: Int16, _ title: String) -> HuaweiTLV {
        var t = HuaweiTLV()
        t.put(0x04, short: id)
        t.put(0x05, string: title)
        t.put(0x06, string: "Artist")
        t.put(0x07, string: "\(title).mp3")
        return t
    }

    private func page(_ endIndex: Int, _ songs: HuaweiTLV...) -> Bytes {
        var list = HuaweiTLV()
        for s in songs { list.put(0x83, tlv: s) }
        return frame(0x25, 0x05) {
            $0.put(0x01, short: 0)
            $0.put(0x04, short: Int16(truncatingIfNeeded: endIndex))
            $0.put(0x82, tlv: list)
        }
    }

    func testInfoReadsBothCapabilityAnswers() async throws {
        let (watch, ops, _, _) = setup { m in
            switch m.command {
            case 0x04:
                return [
                    self.frame(0x25, 0x04) {
                        $0.put(0x01, short: 3)
                        $0.put(0x02, int: 900)
                        $0.put(0x03, bytes: [0x01])
                        $0.put(0x04, short: 300)
                        $0.put(0x05, short: 4)
                    }
                ]
            case 0x0d:
                var restriction = HuaweiTLV()
                restriction.put(0x08, byte: 0)
                restriction.put(0x09, string: "44100,48000")
                restriction.put(0x0b, short: 320)
                var list = HuaweiTLV()
                list.put(0x87, tlv: restriction)
                return [
                    self.frame(0x25, 0x0d) {
                        $0.put(0x01, int: 800)
                        $0.put(0x02, bytes: [0x85, 0x04])
                        $0.put(0x04, byte: 5)
                        $0.put(0x86, tlv: list)
                    }
                ]
            default:
                return []
            }
        }
        let info = try await ops.info(extended: true)
        XCTAssertEqual(
            info,
            MusicInfo(
                freeSpaceMb: 800, formats: ["mp3", "aac", "m4a"], maxSongs: 300, songCount: 4, maxPlaylists: 5, frameCount: 3,
                limits: [MusicFormatLimit(formatIndex: 0, format: "mp3", sampleRates: ["44100", "48000"], bitrate: 320, channels: 2)], extended: true
            )
        )
        XCTAssertEqual(watch.all(0x25, 0x04).count, 1)
        XCTAssertEqual(watch.all(0x25, 0x04).first?.tlv?.serialize().hexLower, "010002000300")
        XCTAssertEqual(watch.messages.map { $0.command }, [0x04, 0x0d], "25/04 first, then 25/0D")
        let basicOnly = try await ops.info(extended: false)
        XCTAssertEqual(
            basicOnly,
            MusicInfo(freeSpaceMb: 900, formats: ["mp3"], maxSongs: 300, songCount: 4, maxPlaylists: nil, frameCount: 3, limits: [], extended: false)
        )
    }

    func testAnUnansweredExtendedInfoFallsBackTo2504() async throws {
        let (_, ops, logs, _) = setup(queryMs: 300) { m in
            m.command == 0x04 ? [self.frame(0x25, 0x04) { $0.put(0x01, short: 1); $0.put(0x02, int: 50) }] : []
        }
        let info = try await ops.info(extended: true)
        XCTAssertFalse(info.extended)
        XCTAssertEqual(info.freeSpaceMb, 50)
        XCTAssertNil(info.maxSongs, "0 / missing reads as not reported")
        XCTAssertEqual(info.songCount, 0)
        XCTAssertTrue(logs.contains("Music: 25/0D: no answer within 300 ms; using 25/04 only"))
        XCTAssertTrue(logs.entries.allSatisfy { !$0.message.hasPrefix("Music:") || $0.serviceId == 0x25 })
    }

    private final class Asked: @unchecked Sendable {
        private let lock = NSLock()
        private var _pairs = [[Int]]()
        var pairs: [[Int]] {
            get { lock.lock(); defer { lock.unlock() }; return _pairs }
            set { lock.lock(); _pairs = newValue; lock.unlock() }
        }
        func add(_ frame: Int, _ end: Int) { lock.lock(); _pairs.append([frame, end]); lock.unlock() }
    }

    func testListPagesLikeGadgetbridge() async throws {
        let asked = Asked()
        let (_, ops, logs, _) = setup { m in
            guard m.command == 0x05, let tlv = m.tlv else { return [] }
            let frame = Int((try? tlv.short(0x01)) ?? -1)
            asked.add(frame, Int(UInt16(bitPattern: (try? tlv.short(0x04)) ?? 0)))
            if frame == 0 { return [self.page(65535, self.song(1, "A"), self.song(7, "B"))] }
            return [self.page(7, self.song(7, "B"))]
        }
        let info = MusicInfo(freeSpaceMb: nil, formats: ["mp3"], maxSongs: nil, songCount: nil, maxPlaylists: nil, frameCount: 3, limits: [], extended: false)
        // Without ExpandCapability 122: a two-song page moves the end index to the second id; a one-song page ends the list.
        let list = try await ops.list(info: info, moreMusic: false)
        XCTAssertEqual(asked.pairs, [[0, 65535], [1, 7]])
        XCTAssertEqual(list.songs.map(\.id), [1, 7])
        XCTAssertEqual(list.songs.first, WatchSong(id: 1, title: "A", artist: "Artist", fileName: "A.mp3"))
        XCTAssertEqual(list.pages, 2)
        XCTAssertTrue(logs.contains("Music: 25/05 frame 0 (end 65535): startFrame=0 endIndex=-1 songs=2: 1 'A' / 'Artist' (A.mp3), 7 'B' / 'Artist' (B.mp3)"))
        XCTAssertTrue(logs.contains("Music: list: 2 songs in 2 pages (frameCount 3, moreMusic=false)"))

        asked.pairs = []
        let more = try await ops.list(info: info, moreMusic: true)
        XCTAssertEqual(asked.pairs, [[0, 65535], [1, 7], [2, 7]])
        XCTAssertEqual(more.pages, 3)
        XCTAssertEqual(more.songs.map(\.id), [1, 7], "a song seen twice is kept once")
    }

    private final class Code: @unchecked Sendable {
        var value: Int32? = MusicControl.successValue
    }

    func testDeleteSendsOperationFourOnAllSongs() async throws {
        let code = Code()
        let (watch, ops, logs, _) = setup { m in
            guard m.command == 0x08, let tlv = m.tlv else { return [] }
            return [
                self.frame(0x25, 0x08) {
                    if let value = code.value { $0.put(0x7f, int: value) }
                    $0.put(0x01, byte: 4)
                    $0.put(0x04, bytes: try? tlv.bytes(0x04))
                }
            ]
        }
        let deleted = try await ops.delete(ids: [7, 300])
        XCTAssertEqual(deleted, SongDeleteOutcome(ids: [7, 300], ok: true, code: 100_000))
        let sent = try XCTUnwrap(watch.all(0x25, 0x08).first?.tlv)
        XCTAssertEqual(try sent.byte(0x01), 4)
        XCTAssertEqual(try sent.short(0x02), 0)
        XCTAssertEqual(try sent.bytes(0x04), [0, 7, 1, 0x2c])
        XCTAssertTrue(logs.contains("Music: 25/08 delete [7, 300]: watch answered code=100000 operation=4 playlist=-1 ids=[7, 300]"))

        code.value = 140_001
        let refused = try await ops.delete(ids: [7])
        XCTAssertEqual(refused, SongDeleteOutcome(ids: [7], ok: false, code: 140_001))
        XCTAssertTrue(logs.contains("code=140001 operation=4 playlist=-1 ids=[7] (not 100000: not deleted)"))

        code.value = nil
        let silent = try await ops.delete(ids: [65535])
        XCTAssertEqual(silent, SongDeleteOutcome(ids: [65535], ok: false, code: nil))
        XCTAssertTrue(logs.contains("watch answered code=none operation=4 playlist=-1 ids=[-1] (not 100000: not deleted)"))
    }

    /// The file-upload flow of FileUploadTests' StandardUploadWatch for a song (unit 100, chunks of 200), sending 25/09 after the first chunk.
    private final class SongWatch: @unchecked Sendable {
        let size: Int
        let askName: String
        let stopAfterFirstChunk: Bool
        let askAfterResultMs: Int?
        private let lock = NSLock()
        private var received = 0
        private var asked = false
        var session: HuaweiSession?

        init(size: Int, askName: String, stopAfterFirstChunk: Bool = false, askAfterResultMs: Int? = nil) {
            self.size = size
            self.askName = askName
            self.stopAfterFirstChunk = stopAfterFirstChunk
            self.askAfterResultMs = askAfterResultMs
        }

        static func f(_ service: UInt8, _ command: UInt8, _ build: (inout HuaweiTLV) -> Void) -> Bytes {
            var tlv = HuaweiTLV()
            build(&tlv)
            return UploadFakeWatch.tlvFrame(service, command, tlv)
        }

        func ask() -> Bytes {
            Self.f(0x25, 0x09) {
                $0.put(0x01, short: 3)
                $0.put(0x02, string: askName)
            }
        }

        func respond(_ m: UploadFakeWatch.Msg) -> [Bytes] {
            switch (m.service, m.command) {
            case (0x28, 0x02):
                return [Self.f(0x28, 0x02) { $0.put(0x7f, int: 100_000) }, Self.f(0x28, 0x03) { $0.put(0x01, byte: 5) }]
            case (0x28, 0x03):
                return [
                    Self.f(0x28, 0x04) {
                        $0.put(0x01, byte: 5)
                        $0.put(0x02, string: "1.0")
                        $0.put(0x03, int: 5000)
                        $0.put(0x04, int: 0)
                        $0.put(0x05, int: 100)
                        $0.put(0x06, int: 200)
                        $0.put(0x07, int: 10)
                        $0.put(0x08, int: 0)
                    }
                ]
            case (0x28, 0x04):
                return [Self.f(0x28, 0x05) { $0.put(0x02, int: 0); $0.put(0x03, int: Int32(min(200, size))) }]
            case (0x28, 0x06):
                lock.lock()
                received += m.payload.count - 6
                let done = received
                let first = !asked
                asked = true
                lock.unlock()
                var out = [Bytes]()
                if first && askAfterResultMs == nil { out.append(ask()) }
                if stopAfterFirstChunk { return out }
                if done >= size { return out + [Self.f(0x28, 0x07) { $0.put(0x02, byte: 1) }] }
                if done % 200 == 0 { return out + [Self.f(0x28, 0x05) { $0.put(0x02, int: Int32(done)); $0.put(0x03, int: Int32(min(200, size - done))) }] }
                return out
            case (0x28, 0x07):
                if let delay = askAfterResultMs, let session {
                    let frame = ask()
                    Task {
                        try? await Task.sleep(nanoseconds: UInt64(delay) * 1_000_000)
                        session.onData(frame)
                    }
                }
                return []
            default:
                return []
            }
        }
    }

    private func songFile(_ name: String, _ size: Int) -> SongFile {
        SongFile(
            fileName: name, data: Bytes((0..<size).map { UInt8(truncatingIfNeeded: $0 * 3) }), probe: SongProbe(format: .mp3, sampleRate: 44100, detail: "test"),
            title: "Lari Pagi", artist: "Joyo Band"
        )
    }

    func testUploadSendsTypeTwoAndAnswersTheTitleQuestion() async throws {
        let song = SongWatch(size: 500, askName: "lari.mp3")
        let (watch, ops, logs, _) = setup { song.respond($0) }
        let progress = ProgressRecorder()
        let outcome = try await ops.upload(songFile("lari.mp3", 500), onProgress: progress.callback)
        XCTAssertEqual(outcome.uploadStatus, 1)
        XCTAssertTrue(outcome.infoAnswered)
        let info = try XCTUnwrap(watch.all(0x28, 0x02).first?.tlv)
        XCTAssertEqual(try info.string(0x01), "lari.mp3")
        XCTAssertEqual(try info.int(0x02), 500)
        XCTAssertEqual(try info.byte(0x03), 2)
        XCTAssertFalse(info.contains(0x05), "no watch face id for a song")
        XCTAssertEqual(watch.all(0x25, 0x09).count, 1)
        let answer = try XCTUnwrap(watch.all(0x25, 0x09).first?.tlv)
        XCTAssertEqual(try answer.short(0x01), 3)
        XCTAssertEqual(try answer.string(0x03), "Lari Pagi")
        XCTAssertEqual(try answer.string(0x04), "Joyo Band")
        XCTAssertEqual(progress.values.last?.0, 500)
        XCTAssertTrue(logs.contains("Music: 25/09 song index 3 'lari.mp3': answered title 'Lari Pagi', artist 'Joyo Band'"))
        XCTAssertTrue(logs.contains("Music: upload lari.mp3: 500 bytes, mp3 (test, sample rate 44100), title 'Lari Pagi', artist 'Joyo Band'"))
        XCTAssertTrue(logs.contains("28/07 status 1, 25/09 answered=true"))
        XCTAssertFalse(logs.contains("no 25/09 during the upload"))
    }

    func testUploadWaitsForAQuestionThatComesAfterTheTransfer() async throws {
        let song = SongWatch(size: 200, askName: "lari.mp3", askAfterResultMs: 100)
        let (watch, ops, logs, session) = setup(infoGraceMs: 2_000) { song.respond($0) }
        song.session = session
        let outcome = try await ops.upload(songFile("lari.mp3", 200), onProgress: { _, _ in })
        XCTAssertTrue(outcome.infoAnswered)
        XCTAssertEqual(watch.all(0x25, 0x09).count, 1)
        XCTAssertTrue(logs.contains("Music: no 25/09 during the upload; waiting 2 s for it"))
    }

    func testUploadDoesNotAnswerAQuestionForAnotherFile() async throws {
        let song = SongWatch(size: 300, askName: "other.mp3")
        let (watch, ops, logs, _) = setup { song.respond($0) }
        let outcome = try await ops.upload(songFile("lari.mp3", 300), onProgress: { _, _ in })
        XCTAssertFalse(outcome.infoAnswered)
        XCTAssertTrue(watch.all(0x25, 0x09).isEmpty)
        XCTAssertTrue(logs.containsError("not answered (as Gadgetbridge)"))
        XCTAssertTrue(logs.contains("Music: no 25/09 during the upload; waiting 0 s for it"))
    }

    func testUploadCanBeCancelledMidTransfer() async throws {
        let song = SongWatch(size: 1000, askName: "lari.mp3", stopAfterFirstChunk: true)
        let (watch, ops, _, session) = setup { song.respond($0) }
        let file = songFile("lari.mp3", 1000)
        let task = Task { try await ops.upload(file, onProgress: { _, _ in }) }
        let started = Date()
        while watch.all(0x28, 0x06).isEmpty && Date().timeIntervalSince(started) < 2 {
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertFalse(watch.all(0x28, 0x06).isEmpty, "the first chunk went out")
        task.cancel()
        let result = await task.result
        switch result {
        case .success: XCTFail("the cancelled upload finished")
        case .failure(let error): XCTAssertTrue(error is CancellationError, "\(error)")
        }
        XCTAssertLessThan(Date().timeIntervalSince(started), 1.9, "stopped before the 2 s stall limit")
        XCTAssertTrue(watch.all(0x28, 0x07).isEmpty)
        // The 25/09 subscription is gone: a late question is not answered any more.
        let answers = watch.all(0x25, 0x09).count
        session.onData(song.ask())
        try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertEqual(watch.all(0x25, 0x09).count, answers)
    }

    func testTooManySongsIsWordedForSongs() async throws {
        let (_, ops, _, _) = setup { m in
            m.service == 0x28 && m.command == 0x02 ? [self.frame(0x28, 0x02) { $0.put(0x7f, int: 140_004) }] : []
        }
        do {
            _ = try await ops.upload(songFile("x.mp3", 10), onProgress: { _, _ in })
            XCTFail("accepted")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .uploadRejected)
            XCTAssertEqual(e.statusCode, 140_004)
            XCTAssertEqual(e.message, "The watch holds no more songs (code 140004). Delete one and try again.")
        }
    }
}
