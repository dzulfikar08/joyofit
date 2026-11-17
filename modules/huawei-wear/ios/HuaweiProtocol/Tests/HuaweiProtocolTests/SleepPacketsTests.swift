import XCTest
@testable import HuaweiProtocol

/// The file download packets (Packets/FileDownloadPackets.swift) against FileDownloadService2C.java / FileDownloadService0A.java
/// (GoldenGen/src/GoldenSleepPackets.java): requests byte for byte, responses and data blocks field for field, errors as errors.
final class SleepPacketsTests: XCTestCase {
    let g = try! Golden.load("sleep_packets")

    // MARK: requests

    private func requestBuilders() -> [String: () throws -> HuaweiPacket] {
        var r = [String: () throws -> HuaweiPacket]()
        let types: [(String, FileDownloadService2C.FileType)] = [
            ("SLEEP_STATE", .sleepState), ("SLEEP_DATA", .sleepData), ("RRI", .rri), ("GPS", .gps), ("PDR", .pdr),
            ("SEQUENCE_DATA", .sequenceData), ("ECG_ANALYSIS_DATA", .ecgAnalysisData), ("UNKNOWN", .unknown),
        ]
        for (n, t) in types {
            r["2C init \(n)"] = { try FileDownloadService2C.FileDownloadInit.request(filename: "file_\(n).bin", fileType: t, startTime: 1_700_000_000, endTime: 1_700_086_400, dictId: 0) }
            r["2C init \(n) dict"] = { try FileDownloadService2C.FileDownloadInit.request(filename: "file_\(n)", fileType: t, startTime: -5, endTime: 7, dictId: 700013) }
        }
        r["2C init long name sliced"] = { try FileDownloadService2C.FileDownloadInit.request(filename: String(repeating: "x", count: 400), fileType: .sleepData, startTime: 1, endTime: 2, dictId: 0) }
        r["2C init negative dict"] = { try FileDownloadService2C.FileDownloadInit.request(filename: "sequence_data", fileType: .sequenceData, startTime: 1, endTime: 2, dictId: -1) }
        r["2C hash"] = { FileDownloadService2C.FileRequestHash.request(fileId: 0x85) }
        r["2C info"] = { FileDownloadService2C.FileInfo.request(fileId: 0x16) }
        r["2C info 0xff"] = { FileDownloadService2C.FileInfo.request(fileId: 0xff) }
        r["2C block"] = { FileDownloadService2C.RequestBlock.request(fileId: 5, offset: 0, size: 4096, noEncrypt: false, dictId: 0) }
        r["2C block noEncrypt"] = { FileDownloadService2C.RequestBlock.request(fileId: 5, offset: 4096, size: 1000, noEncrypt: true, dictId: 0) }
        r["2C block dict, file id 0x16"] = { FileDownloadService2C.RequestBlock.request(fileId: 0x16, offset: 8192, size: 100, noEncrypt: false, dictId: 700013) }
        r["2C block dict, file id 5 (no dict sent)"] = { FileDownloadService2C.RequestBlock.request(fileId: 5, offset: 8192, size: 100, noEncrypt: false, dictId: 700013) }
        r["2C block dict, file id 0x16, noEncrypt"] = { FileDownloadService2C.RequestBlock.request(fileId: 0x16, offset: -1, size: -2, noEncrypt: true, dictId: 1) }
        r["2C complete ok"] = { FileDownloadService2C.FileDownloadCompleteRequest.request(fileId: 7, status: 1) }
        r["2C complete failed"] = { FileDownloadService2C.FileDownloadCompleteRequest.request(fileId: 0x80, status: 2) }
        r["2C incoming init with packages"] = {
            FileDownloadService2C.IncomingInitRequest.request(filename: "a.bin", fileType: 0x10, fileId: 3, fileSize: 99, srcPackage: "src.pkg", dstPackage: "dst.pkg", srcFingerprint: "srcfp", dstFingerprint: "dstfp", status: 1)
        }
        r["2C incoming init without packages"] = {
            FileDownloadService2C.IncomingInitRequest.request(filename: "a.bin", fileType: 0x10, fileId: 3, fileSize: 99, srcPackage: nil, dstPackage: nil, srcFingerprint: nil, dstFingerprint: nil, status: 0)
        }
        r["2C incoming init packages, null fingerprints"] = {
            FileDownloadService2C.IncomingInitRequest.request(filename: "a.bin", fileType: 0x10, fileId: 3, fileSize: 99, srcPackage: "s", dstPackage: "d", srcFingerprint: nil, dstFingerprint: nil, status: 0)
        }
        r["2C incoming init only src"] = {
            FileDownloadService2C.IncomingInitRequest.request(filename: "a.bin", fileType: 0x10, fileId: 3, fileSize: 99, srcPackage: "s", dstPackage: nil, srcFingerprint: "x", dstFingerprint: "y", status: 0)
        }

        r["0A init debug"] = { FileDownloadService0A.FileDownloadInit.debugFilesRequest() }
        r["0A init sleep"] = { FileDownloadService0A.FileDownloadInit.sleepFilesRequest(startTime: 1_700_000_000, endTime: 1_700_086_400) }
        r["0A init sleep negative"] = { FileDownloadService0A.FileDownloadInit.sleepFilesRequest(startTime: -1, endTime: 0) }
        r["0A init gps"] = { FileDownloadService0A.FileDownloadInit.gpsFileRequest(workoutId: 0x1234) }
        r["0A init gps negative"] = { FileDownloadService0A.FileDownloadInit.gpsFileRequest(workoutId: -2) }
        r["0A init rri"] = { FileDownloadService0A.FileDownloadInit.rriFileRequest(startTime: 1_700_000_000, endTime: 1_700_086_400) }
        for type in [0, 1, 2, 4, 0x7f, 0xff] {
            r["0A parameters \(type)"] = { FileDownloadService0A.FileParameters.request(fileType: UInt8(type)) }
        }
        r["0A info"] = { FileDownloadService0A.FileInfo.request(fileName: "sleep_state.bin") }
        r["0A info long name sliced"] = { FileDownloadService0A.FileInfo.request(fileName: String(repeating: "y", count: 300)) }
        r["0A block"] = { FileDownloadService0A.RequestBlock.request(fileName: "sleep_data.bin", offset: 0, size: 1024) }
        r["0A block offset"] = { FileDownloadService0A.RequestBlock.request(fileName: "sleep_data.bin", offset: 65536, size: 100_000) }
        r["0A complete"] = { FileDownloadService0A.FileDownloadCompleteRequest.request() }
        return r
    }

    func testRequestsMatchJava() throws {
        let builders = requestBuilders()
        let golden = g.list("requests")
        XCTAssertEqual(golden.count, builders.count, "every Java request has a Swift builder and the other way round")
        XCTAssertEqual(golden.filter { $0["error"] != nil }.count, 3)
        for c in golden {
            let name = c.str("name")
            guard let build = builders[name] else { XCTFail("no Swift builder for '\(name)'"); continue }
            let javaError = c.opt("error")
            let packet: HuaweiPacket
            do {
                packet = try build()
            } catch {
                XCTAssertNotNil(javaError, "\(name): Swift throws \(error) but Java builds the packet")
                continue
            }
            if javaError == "RuntimeException" {
                XCTFail("\(name): Java throws \(javaError!), Swift builds a packet")
                continue
            }
            XCTAssertEqual(Int(packet.serviceId), c.int("service"), name)
            XCTAssertEqual(Int(packet.commandId), c.int("command"), name)
            XCTAssertEqual(packet.isEncrypted, c.bool("encrypted"), "\(name): encrypted flag")
            XCTAssertEqual(packet.isSliced, c.bool("sliced"), "\(name): sliced flag")
            XCTAssertEqual(packet.complete, c.bool("complete"), name)
            if let expected = c["tlv"] as? [[String: Any]] {
                let actual = packet.tlv?.entries.map { ["tag": Int($0.tag), "value": $0.value.hexLower] as [String: Any] }
                XCTAssertNotNil(actual, "\(name): tlv")
                XCTAssertEqual(actual?.count, expected.count, "\(name): tlv entries")
                for (a, e) in zip(actual ?? [], expected) {
                    XCTAssertEqual(a.int("tag"), e.int("tag"), name)
                    XCTAssertEqual(a.str("value"), e.str("value"), name)
                }
            } else {
                XCTAssertNil(packet.tlv, "\(name): Java has no TLV")
            }
            // Java's serialize() throws on a packet without a TLV ("0A parameters 0"); everything else is compared frame by frame.
            if javaError == nil {
                let params = ParamsProvider()
                params.sliceSize = 0xf4
                params.secretKey = g.optBytes("key")
                params.transactionsCrypted = false
                let frames = try packet.serialize(params: params)
                let expected = (c["frames"] as? [String] ?? []).map { Bytes(hex: $0)! }
                XCTAssertEqual(frames.count, expected.count, name)
                for (a, e) in zip(frames, expected) { XCTAssertEqual(a.hexLower, e.hexLower, name) }
            } else {
                XCTAssertEqual(javaError, "NullPointerException", name)
                XCTAssertNil(packet.tlv, name)
            }
        }
    }

    // MARK: responses

    /// A canonical rendering to compare Java's JSON with the Swift fields: sorted keys, same number and bool spelling.
    private func canon(_ value: Any) -> String {
        guard JSONSerialization.isValidJSONObject(["v": value]) else { return "\(value)" }
        let data = try! JSONSerialization.data(withJSONObject: ["v": value], options: [.sortedKeys])
        return String(decoding: data, as: UTF8.self)
    }

    private func assemble(_ frame: Bytes, params: ParamsProvider) throws -> HuaweiPacket {
        var assembler = PacketAssembler()
        let result = try assembler.feed(frame, params: params)
        XCTAssertEqual(result.left, 0)
        return try XCTUnwrap(result.packet)
    }

    private func describeResponse(_ packet: HuaweiPacket) throws -> [String: Any] {
        switch (packet.serviceId, packet.commandId) {
        case (0x2c, 0x01):
            let r = try FileDownloadService2C.FileDownloadInit.Response(packet: packet)
            return ["fileName": r.fileName, "fileType": r.fileType.name, "fileId": Int(r.fileId), "fileSize": Int(r.fileSize)]
        case (0x2c, 0x02):
            let r = try FileDownloadService2C.FileRequestHash.Response(packet: packet)
            return ["fileId": Int(r.fileId), "fileHash": r.fileHash.hexLower]
        case (0x2c, 0x03):
            let r = try FileDownloadService2C.FileInfo.Response(packet: packet)
            return ["fileId": Int(r.fileId), "timeout": Int(r.timeout), "burstSize": Int(r.burstSize), "maxBlockSize": Int(r.maxBlockSize), "noEncrypt": r.noEncrypt]
        case (0x2c, 0x07):
            let r = try FileDownloadService2C.IncomingInitRequest.Response(packet: packet)
            return [
                "filename": r.filename, "fileType": Int(r.fileType), "fileId": Int(r.fileId), "fileSize": Int(r.fileSize), "description": r.description,
                "srcPackage": r.srcPackage, "dstPackage": r.dstPackage,
                "srcFingerprint": r.srcFingerprint ?? NSNull(), "dstFingerprint": r.dstFingerprint ?? NSNull(),
            ]
        case (0x0a, 0x01):
            return ["fileNames": try FileDownloadService0A.FileDownloadInit.Response(packet: packet).fileNames]
        case (0x0a, 0x02):
            let r = try FileDownloadService0A.FileParameters.Response(packet: packet)
            return ["version": r.version, "unknown": r.unknown, "packetSize": Int(r.packetSize), "maxBlockSize": Int(r.maxBlockSize), "timeout": Int(r.timeout)]
        case (0x0a, 0x03):
            let r = try FileDownloadService0A.FileInfo.Response(packet: packet)
            return ["fileLength": Int(r.fileLength), "transferType": Int(r.transferType), "fileCreateTime": Int(r.fileCreateTime), "unknown": Int(r.unknown)]
        case (0x0a, 0x04):
            let r = try FileDownloadService0A.RequestBlock.Response(packet: packet)
            return ["isOk": r.isOk, "filename": r.filename ?? NSNull(), "offset": Int(r.offset)]
        default:
            XCTFail("no response type for \(packet.serviceId)/\(packet.commandId)")
            return [:]
        }
    }

    func testResponsesMatchJava() throws {
        let golden = g.list("responses")
        XCTAssertGreaterThan(golden.count, 50)
        var errors = 0
        for c in golden {
            let name = c.str("name")
            let plain = ParamsProvider()
            let packet = try assemble(c.bytes("frame"), params: plain)
            // The wire TLV is what the Java put in: the assembler keeps its tags and values.
            let expectedTLV = (c["tlv"] as? [[String: Any]] ?? []).map { "\($0.int("tag")):\($0.str("value"))" }
            XCTAssertEqual(packet.tlv?.entries.map { "\(Int($0.tag)):\($0.value.hexLower)" }, expectedTLV, name)
            let expected = c["result"] as? [String: Any] ?? [:]
            if expected["error"] != nil {
                errors += 1
                XCTAssertThrowsError(try describeResponse(packet), "\(name): Java throws \(expected["error"] ?? "")")
            } else {
                let actual = try describeResponse(packet)
                XCTAssertEqual(canon(actual), canon(expected), name)
            }
        }
        XCTAssertGreaterThan(errors, 15)
    }

    func testResponseErrorsMapToTheJavaExceptionKinds() throws {
        // A missing tag is a MissingTagException, a short value a BufferUnderflowException/ArrayIndexOutOfBounds: both are thrown,
        // and `request<R>` turns either into a parse failure (ERR_PROTOCOL, isParseFailure).
        let golden = g.list("responses")
        for c in golden {
            guard let kind = (c["result"] as? [String: Any])?["error"] as? String else { continue }
            let packet = try assemble(c.bytes("frame"), params: ParamsProvider())
            do {
                _ = try describeResponse(packet)
                XCTFail("\(c.str("name")) should throw")
            } catch let e as TLVError {
                if kind == "MissingTagException" {
                    guard case .missingTag = e else { XCTFail("\(c.str("name")): \(kind) but \(e)"); continue }
                } else {
                    guard case .malformed = e else { XCTFail("\(c.str("name")): \(kind) but \(e)"); continue }
                }
            } catch {
                XCTFail("\(c.str("name")): unexpected \(error)")
            }
        }
    }

    // MARK: data blocks

    func testDataBlocksMatchJava() throws {
        let golden = g.list("blocks")
        XCTAssertGreaterThan(golden.count, 40)
        var okCount = 0
        var errorCount = 0
        for c in golden {
            let name = c.str("name")
            let params = ParamsProvider()
            params.secretKey = c.optBytes("key")
            params.encryptMethod = UInt8(c.int("encryptMethod"))
            params.deviceSupportType = UInt8(c.int("deviceSupportType"))
            let packet = try assemble(c.bytes("frame"), params: params)
            XCTAssertNil(packet.tlv, "\(name): raw payload service")
            XCTAssertNotNil(packet.payload, name)
            let expected = c["result"] as? [String: Any] ?? [:]

            func describe() throws -> [String: Any] {
                if c.int("service") == 0x2c {
                    let r = try FileDownloadService2C.BlockResponse(packet: packet, params: params)
                    return ["fileId": Int(r.fileId), "offset": Int(r.offset), "unknown": Int(r.unknown), "data": r.data.hexLower]
                }
                let r = try FileDownloadService0A.BlockResponse(packet: packet, params: params)
                let decode: Any
                switch r.decodeError {
                case nil: decode = NSNull()
                case .crypto?: decode = "crypto"
                case .notTLV?: decode = "notTLV"
                }
                // Kotlin FileDownloader tests `e is HuaweiPacket.CryptoException`, but BlockResponse stores a HuaweiCrypto.CryptoException:
                // Android never logs "could be decoded as TLV, but not decrypted". Swift logs it (the evident intent), see FileDownloader.
                return ["number": Int(r.number), "data": r.data.hexLower, "decodeError": decode, "decodeErrorIsPacketCryptoException": false]
            }

            if expected["error"] != nil {
                errorCount += 1
                XCTAssertThrowsError(try describe(), "\(name): Java throws \(expected["error"] ?? "")")
            } else {
                okCount += 1
                XCTAssertEqual(canon(try describe()), canon(expected), name)
            }
        }
        XCTAssertGreaterThan(okCount, 15)
        XCTAssertGreaterThan(errorCount, 15)
    }

    func testDataBlockErrorKinds() throws {
        func block(_ name: String) throws -> (HuaweiPacket, ParamsProvider) {
            let c = try XCTUnwrap(g.list("blocks").first { $0.str("name") == name }, name)
            let params = ParamsProvider()
            params.secretKey = c.optBytes("key")
            params.encryptMethod = UInt8(c.int("encryptMethod"))
            params.deviceSupportType = UInt8(c.int("deviceSupportType"))
            return (try assemble(c.bytes("frame"), params: params), params)
        }
        // Java CryptoException: wrong key, garbled cipher, no key.
        for name in ["2C encrypted, wrong key", "2C encrypted, garbled cipher", "2C encrypted, no key"] {
            let (p, params) = try block(name)
            XCTAssertThrowsError(try FileDownloadService2C.BlockResponse(packet: p, params: params), name) { e in
                guard case PacketError.crypto = e else { return XCTFail("\(name): \(e)") }
            }
        }
        // Java MissingTagException: a TLV marker without the cipher elements.
        for name in ["2C marker with no cipher", "2C marker with iv only"] {
            let (p, params) = try block(name)
            XCTAssertThrowsError(try FileDownloadService2C.BlockResponse(packet: p, params: params), name) { e in
                guard case TLVError.missingTag = e else { return XCTFail("\(name): \(e)") }
            }
        }
        // 0x0A: data that is a valid TLV without the cipher elements is unencrypted data (GB threw MissingTagException and lost the
        // whole file: HONOR Watch ES rrisqi_data.bin, JRG-487/488).
        for name in ["0A data that is a valid TLV without the cipher elements", "0A data that is a valid TLV with only a cipher element"] {
            let (p, params) = try block(name)
            let r = try FileDownloadService0A.BlockResponse(packet: p, params: params)
            if case .notTLV? = r.decodeError {} else { XCTFail("\(name): expected notTLV, got \(String(describing: r.decodeError))") }
            XCTAssertEqual(r.data, [0x01, 0x42], name)
        }
        // An empty body has no packet number to read.
        let (empty, emptyParams) = try block("0A empty body")
        XCTAssertThrowsError(try FileDownloadService0A.BlockResponse(packet: empty, params: emptyParams))
        // ...but a CryptoException or an unparsable body is taken as unencrypted data.
        let (p, params) = try block("0A data that is a valid TLV with iv and a block of zeros")
        let r = try FileDownloadService0A.BlockResponse(packet: p, params: params)
        XCTAssertEqual(r.number, 0x7d)
        if case .crypto? = r.decodeError {} else { XCTFail("expected a crypto decode error, got \(String(describing: r.decodeError))") }
    }

    // MARK: Java String.split

    func testJavaSplit() {
        XCTAssertEqual(javaSplitSemicolon(""), [""])
        XCTAssertEqual(javaSplitSemicolon("a"), ["a"])
        XCTAssertEqual(javaSplitSemicolon("a;b;"), ["a", "b"])
        XCTAssertEqual(javaSplitSemicolon(";"), [])
        XCTAssertEqual(javaSplitSemicolon(";a"), ["", "a"])
        XCTAssertEqual(javaSplitSemicolon("a;;b;;"), ["a", "", "b"])
    }
}
