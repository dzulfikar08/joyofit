import Foundation
import XCTest
@testable import HuaweiProtocol

/// A zip writer for tests: stored entries (method 0) with the right CRC, local headers only, which is all the reader needs.
enum TestZip {
    static func build(_ entries: [(String, Bytes)]) -> Bytes {
        var out = Bytes()
        for (name, data) in entries {
            func le16(_ v: Int) { out.append(UInt8(v & 0xFF)); out.append(UInt8((v >> 8) & 0xFF)) }
            func le32(_ v: UInt32) { le16(Int(v & 0xFFFF)); le16(Int(v >> 16)) }
            le32(0x0403_4B50)
            le16(20)
            le16(0)
            le16(0)
            le16(0)
            le16(0x21)
            le32(CRC32.checksum(data))
            le32(UInt32(data.count))
            le32(UInt32(data.count))
            le16(name.utf8.count)
            le16(0)
            out += Array(name.utf8)
            out += data
        }
        return out
    }
}

struct SeededGenerator: RandomNumberGenerator {
    var state: UInt64
    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}

final class ZipReaderTests: XCTestCase {
    func testCRC32OfTheCheckString() {
        XCTAssertEqual(CRC32.checksum(Bytes("123456789".utf8)), 0xCBF4_3926)
    }

    func testInflateMatchesZlibForFixedDynamicStoredAndLongRuns() throws {
        for v in ZipVectors.streams {
            let result = try Inflate.inflate(Bytes(hex: v.hex)!, at: 0, limit: 1 << 20)
            XCTAssertEqual(result.data, v.input, v.name)
            XCTAssertEqual(result.end, Bytes(hex: v.hex)!.count, v.name)
        }
    }

    func testInflateRefusesTruncatedAndCorruptStreams() {
        let dynamic = Bytes(hex: ZipVectors.streams.first { $0.name == "dynamic" }!.hex)!
        XCTAssertThrowsError(try Inflate.inflate(Array(dynamic.dropLast(5)), at: 0, limit: 1 << 20))
        XCTAssertThrowsError(try Inflate.inflate([0x07], at: 0, limit: 1 << 20), "reserved block type")
        XCTAssertThrowsError(try Inflate.inflate(dynamic, at: 0, limit: 100), "limit")
    }

    func testZipWithDataDescriptorsIsReadEntryByEntry() throws {
        let zip = Bytes(hex: ZipVectors.descriptorZip)!
        XCTAssertEqual(ZipReader.entry(zip, named: "a.txt"), ZipVectors.text(2000))
        XCTAssertEqual(ZipReader.entry(zip, named: "b.bin"), ZipVectors.pattern(500, 9))
        XCTAssertEqual(ZipReader.entry(zip, named: "c.txt"), Bytes("ccc".utf8))
        XCTAssertNil(ZipReader.entry(zip, named: "d.txt"))
    }

    func testACorruptEntryIsNilLikeJavaZipException() throws {
        var zip = Bytes(hex: ZipVectors.descriptorZip)!
        zip[zip.count - 20] ^= 0xFF // inside the last entry's data or descriptor
        XCTAssertNil(ZipReader.entry(zip, named: "c.txt"))
        var stored = TestZip.build([("a", [1, 2, 3])])
        stored[stored.count - 1] ^= 1
        XCTAssertNil(ZipReader.entry(stored, named: "a"), "CRC mismatch")
    }

    func testNonZipsGiveNil() {
        XCTAssertNil(ZipReader.entry(Bytes(repeating: 7, count: 50), named: "description.xml"))
        XCTAssertNil(ZipReader.entry([], named: "x"))
        XCTAssertNil(ZipReader.entry(Array("PK".utf8), named: "x"))
    }

    func testStoredEntriesAreFoundAfterOthers() {
        let zip = TestZip.build([("a", [1]), ("dir/b", [2, 2]), ("c", [3, 3, 3])])
        XCTAssertEqual(ZipReader.entry(zip, named: "c"), [3, 3, 3])
        XCTAssertEqual(ZipReader.entry(zip, named: "dir/b"), [2, 2])
    }
}

final class MiniXMLTests: XCTestCase {
    func testElementsTextAndNesting() throws {
        let root = try MiniXML.parse("<?xml version=\"1.0\"?>\n<!-- c --><R a='1'>\n <t>  Night &amp; Run &#x6A;&#106; </t><u><![CDATA[<x>]]></u><e/></R>\n")
        XCTAssertEqual(root.name, "R")
        XCTAssertEqual(root.firstElement(named: "t")?.text, "  Night & Run jj ")
        XCTAssertEqual(root.firstElement(named: "u")?.text, "<x>")
        XCTAssertNotNil(root.firstElement(named: "e"))
        XCTAssertNil(root.firstElement(named: "missing"))
    }

    func testMalformedDocumentsAreRefused() {
        for bad in [
            "", "<a>", "<a></b>", "<a><b></a></b>", "<a/><b/>", "text<a/>", "<a>&foo;</a>", "<a b=1/>", "<a b='1' b='2'/>", "<a x='<'/>",
            "<!DOCTYPE a><a/>", "<a><!-- -- --></a>", " <?xml version=\"1.0\"?><a/>", "<a>&#xD800;</a>", "<a><![CDATA[x</a>", "<1a/>",
        ] {
            XCTAssertThrowsError(try MiniXML.parse(bad), bad)
        }
    }
}

final class WatchfacePackageTests: XCTestCase {
    func description(root: String = "HwTheme", screen: String = "HWHD13", bom: Bool = false) -> Bytes {
        let xml = """
            <?xml version="1.0" encoding="UTF-8"?>
            <\(root)>
              <title>Night Run</title>
              <title-cn>夜跑</title-cn>
              <author>Joyo</author>
              <designer>Joyo</designer>
              <screen>\(screen)</screen>
              <version>2.1.0</version>
              <font>Roboto</font>
              <font-cn>NotoSans</font-cn>
            </\(root)>
            """
        return (bom ? [0xEF, 0xBB, 0xBF] : []) + Bytes(xml.utf8)
    }

    let binary = Bytes((0..<300).map { UInt8(truncatingIfNeeded: $0 * 5 + 1) })

    func hwt(screen: String = "HWHD13", nested: Bool = true, root: String = "HwTheme", bom: Bool = false) -> Bytes {
        let inner = nested ? TestZip.build([("watchface.bin", binary), ("other.txt", [1])]) : binary
        let entry = root == "HnTheme" ? "com.honor.watchface" : "com.huawei.watchface"
        return TestZip.build([("description.xml", description(root: root, screen: screen, bom: bom)), (entry, inner), ("preview/cover.jpg", [9, 9, 9])])
    }

    func refusal(_ body: () throws -> Void) -> WearError? {
        do {
            try body()
            return nil
        } catch let e as WearError {
            return e
        } catch {
            return nil
        }
    }

    func testPackageYieldsDescriptionAndTheNestedWatchfaceBin() throws {
        let pkg = try WatchfacePackages.parse(hwt())
        XCTAssertEqual(pkg.description.title, "Night Run")
        XCTAssertEqual(pkg.description.titleCn, "夜跑")
        XCTAssertEqual(pkg.description.author, "Joyo")
        XCTAssertEqual(pkg.description.screen, "HWHD13")
        XCTAssertEqual(pkg.description.version, "2.1.0")
        XCTAssertFalse(pkg.description.isHonor)
        XCTAssertEqual(pkg.binary, binary)
        XCTAssertEqual(pkg.preview, [9, 9, 9])
    }

    func testOlderPackagesHoldTheBinaryDirectly() throws {
        XCTAssertEqual(try WatchfacePackages.parse(hwt(nested: false)).binary, binary)
    }

    func testAByteOrderMarkInDescriptionIsAccepted() throws {
        XCTAssertEqual(try WatchfacePackages.parse(hwt(bom: true)).description.title, "Night Run")
    }

    func testHonorPackagesUseTheirOwnEntry() throws {
        let pkg = try WatchfacePackages.parse(hwt(root: "HnTheme"))
        XCTAssertTrue(pkg.description.isHonor)
        XCTAssertEqual(pkg.binary, binary)
    }

    func testAFileWithoutDescriptionIsNotAWatchface() {
        for bytes in [TestZip.build([("a.txt", [1])]), Bytes(repeating: 7, count: 50)] {
            let e = refusal { _ = try WatchfacePackages.parse(bytes) }
            XCTAssertEqual(e?.code, .invalidArgument)
            XCTAssertTrue(e?.message.contains("description.xml") == true)
        }
    }

    func testAPackageWithoutTheWatchfaceEntryIsRefused() {
        let e = refusal { _ = try WatchfacePackages.parse(TestZip.build([("description.xml", description())])) }
        XCTAssertTrue(e?.message.contains("com.huawei.watchface") == true)
    }

    func testAnEmptyWatchfaceIsRefused() {
        let e = refusal { _ = try WatchfacePackages.parse(TestZip.build([("description.xml", description()), ("com.huawei.watchface", [])])) }
        XCTAssertEqual(e?.code, .invalidArgument)
        XCTAssertTrue(e?.message.contains("empty") == true)
    }

    func testInvalidXmlAndUnknownRootsAreRefused() {
        XCTAssertTrue(refusal { _ = try WatchfacePackages.parseDescription(Bytes("<HwTheme><title>x".utf8)) }?.message.contains("not valid XML") == true)
        XCTAssertTrue(refusal { _ = try WatchfacePackages.parseDescription(description(root: "Other")) }?.message.contains("root element") == true)
        XCTAssertTrue(refusal { _ = try WatchfacePackages.parseDescription(description(screen: "")) }?.message.contains("no screen") == true)
    }

    func testResolutionTableMatchesGbAndFit4IsHwhd13() {
        XCTAssertEqual(WatchfaceResolutions.screenByThemeVersion("HWHD13"), "480*408")
        XCTAssertEqual(WatchfaceResolutions.screenByThemeVersion("NOPE"), "0x0")
        XCTAssertTrue(WatchfaceResolutions.isValid("HWHD13", "480*408"))
        XCTAssertFalse(WatchfaceResolutions.isValid("HWHD13", "408*480"))
        XCTAssertFalse(WatchfaceResolutions.isValid("NOPE", "480*408"))
        XCTAssertEqual(WatchfaceResolutions.fit4Screen, WatchfaceResolutions.screenByThemeVersion(WatchfaceResolutions.fit4ThemeVersion))
    }

    func testResolutionGateUsesTheWatchsHeightAndWidth() throws {
        var logs = [String]()
        try WatchfacePackages.checkResolution(try WatchfacePackages.parse(hwt("HWHD13")).description, height: 480, width: 408) { logs.append($0) }
        XCTAssertTrue(logs.isEmpty)
        let e = refusal { try WatchfacePackages.checkResolution(try WatchfacePackages.parse(self.hwt("HWHD02")).description, height: 480, width: 408) { _ in } }
        XCTAssertEqual(e?.code, .invalidArgument)
        XCTAssertTrue(e?.message.contains("454*454") == true)
        XCTAssertTrue(e?.message.contains("480*408") == true)
        // A theme version GB does not know is left to the watch.
        try WatchfacePackages.checkResolution(try WatchfacePackages.parse(hwt("HWHD99")).description, height: 480, width: 408) { logs.append($0) }
        XCTAssertTrue(logs.first?.contains("not in GB's resolution table") == true)
    }

    func hwt(_ screen: String) -> Bytes { hwt(screen: screen) }

    func testRandomNameKeepsTheFacesOwnVersion() {
        var g = SeededGenerator(state: 1)
        let name = WatchfacePackages.randomName(using: &g, version: "2.8.2")
        XCTAssertNotNil(name.range(of: #"^\d{9}_2\.8\.2$"#, options: .regularExpression), name)
    }

    func testRandomNameFallsBackToAHuaweiHealthStyleVersion() {
        var g = SeededGenerator(state: 7)
        for version in [nil, "", "abc", "2", "2.x", "2_1", "2.1 beta", "1.2.3.4.5"] as [String?] {
            let name = WatchfacePackages.randomName(using: &g, version: version)
            XCTAssertNotNil(name.range(of: #"^\d{9}_(10|[1-9])\.(10|[1-9])\.(10|[1-9])$"#, options: .regularExpression), name)
        }
        XCTAssertTrue(WatchfacePackages.randomName(version: " 2.10.5 ").hasSuffix("_2.10.5"))
    }

    func testRandomVersionStaysInOneToTen() {
        var g = SeededGenerator(state: 3)
        for _ in 0..<500 {
            let parts = WatchfacePackages.randomVersion(using: &g).split(separator: ".").map { Int($0)! }
            XCTAssertEqual(parts.count, 3)
            XCTAssertTrue(parts.allSatisfy { (1...10).contains($0) })
        }
    }

    func faceVersion(_ version: String) -> WatchfaceDescription {
        WatchfaceDescription(title: "t", author: "a", designer: "d", screen: "HWHD13", version: version)
    }

    func testVersionGateFollowsHuaweiHealthMajorEqualAndMinorNotAbove() throws {
        var logs = [String]()
        let others = "2.1,2.2,2.3,2.4,2.5,2.6,2.7,2.8,2.9,2.10"
        for ok in ["2.1.1", "2.8.2", "2.10.5", "2.10"] {
            try WatchfacePackages.checkVersion(faceVersion(ok), maxVersion: "2.10", otherVersions: others) { logs.append($0) }
        }
        XCTAssertTrue(logs.isEmpty)
        for bad in ["1.0.0", "2.11.0", "3.1.0"] {
            let e = refusal { try WatchfacePackages.checkVersion(self.faceVersion(bad), maxVersion: "2.10", otherVersions: others) { _ in } }
            XCTAssertEqual(e?.code, .invalidArgument, bad)
            XCTAssertTrue(e?.message.contains("up to 2.10") == true)
        }
    }

    func testVersionGateAcceptsAnOtherVersionTheWatchLists() throws {
        try WatchfacePackages.checkVersion(faceVersion("1.5.0"), maxVersion: "2.10", otherVersions: "1.5,2.1") { _ in }
    }

    func testVersionGateLeavesUnreadableVersionsToTheWatch() throws {
        var logs = [String]()
        try WatchfacePackages.checkVersion(faceVersion(""), maxVersion: "2.10", otherVersions: "") { logs.append($0) }
        try WatchfacePackages.checkVersion(faceVersion("2.1.0"), maxVersion: "weird", otherVersions: "") { logs.append($0) }
        XCTAssertEqual(logs.count, 2)
        XCTAssertTrue(logs.allSatisfy { $0.contains("not checked") })
    }

    // The real packages of packages/hwt/fixtures, whose expected values come from Python's zipfile and hashlib (an independent reader).

    static let fixtures: [(path: String, title: String, screen: String, version: String, size: Int, sha: String)] = [
        ("fit4pro/FunctionalForHikes.hwt", "FunctionalForHikes", "HWHD13", "2.8.1", 485_529, "d98c4405900500ed"),
        ("fit4pro/FunctionalForHikes2.hwt", "FunctionalForHikes2", "HWHD13", "2.8.1", 377_171, "cabe645189554844"),
        ("fit4pro/SpaceRed.hwt", "SpaceRed", "HWHD13", "2.8.2", 1_104_372, "2db7cfea6b1a7249"),
        ("fit4pro/SpaceRed2.hwt", "SpaceRedV2", "HWHD13", "2.8.2", 1_201_549, "d7d657e189154179"),
        ("other/FocusWGTru.gt6_46_pro.hwt", "FocusWGTru", "HWHD09", "2.8.1", 830_900, "c92309d7a428ce57"),
        ("other/Unnamed.hwhd02.hwt", "Unnamed", "HWHD02", "2.1.9", 9_445, "887bf0bad85cc876"),
        ("synthetic/SynthBand.hwhd07.hwt", "SynthBand", "HWHD07", "2.1.1", 49_339, "fbe165bd73bab16e"),
        ("synthetic/SynthNested.hwhd09.hwt", "SynthNested", "HWHD09", "2.0.4", 134_835, "b207bf0583328412"),
        ("synthetic/SynthV1Glyphs.hwhd02.hwt", "SynthGlyphs", "HWHD02", "2.1.9", 195_007, "af9644b4ecb893bb"),
        ("synthetic/SynthV1Hands.hwhd02.hwt", "SynthHands", "HWHD02", "2.1.9", 721_072, "a6b7550be2d47cb0"),
    ]

    func testRealPackagesParse() throws {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<7 { root.deleteLastPathComponent() }
        let dir = root.appendingPathComponent("packages/hwt/fixtures")
        try XCTSkipUnless(FileManager.default.fileExists(atPath: dir.path), "packages/hwt/fixtures is not checked out")
        for f in Self.fixtures {
            let data = try PickedFile.read(uri: dir.appendingPathComponent(f.path).absoluteString)
            let pkg = try WatchfacePackages.parse(data)
            XCTAssertEqual(pkg.description.title, f.title, f.path)
            XCTAssertEqual(pkg.description.screen, f.screen, f.path)
            XCTAssertEqual(pkg.description.version, f.version, f.path)
            XCTAssertEqual(pkg.binary.count, f.size, f.path)
            XCTAssertEqual(SHA256.hash(pkg.binary).hexLower.prefix(16), f.sha[...], f.path)
            XCTAssertNotNil(pkg.preview, f.path)
        }
    }

    func testPickedFileReadsPathsAndFileUrlsAndRefusesTheRest() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("picked test \(UUID().uuidString).hwt")
        try Data([1, 2, 3, 4]).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        XCTAssertEqual(try PickedFile.read(uri: url.absoluteString), [1, 2, 3, 4])
        XCTAssertEqual(try PickedFile.read(uri: url.path), [1, 2, 3, 4])
        XCTAssertEqual(refusal { _ = try PickedFile.read(uri: url.absoluteString, maxBytes: 3) }?.code, .invalidArgument)
        XCTAssertEqual(refusal { _ = try PickedFile.read(uri: "content://media/1") }?.code, .invalidArgument)
        XCTAssertEqual(refusal { _ = try PickedFile.read(uri: "file:///nonexistent/dir/x.hwt") }?.code, .invalidArgument)
    }
}
