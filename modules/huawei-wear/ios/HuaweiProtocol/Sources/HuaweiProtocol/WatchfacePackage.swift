// Port of WatchfacePackage.kt (derived from Gadgetbridge, AGPL-3.0-or-later): service/devices/huawei/HuaweiFwHelper.parseAsWatchFace,
// HuaweiWatchfaceManager.{Resolution, WatchfaceDescription, getRandomName} and devices/huawei/HuaweiInstallHandler (the watch face branch of
// validateInstallation). Works on bytes, so the module layer reads the picked file and this stays testable anywhere.
import Foundation

/// GB `HuaweiWatchfaceManager.WatchfaceDescription`, from the package's `description.xml`.
public struct WatchfaceDescription: Equatable, Sendable {
    public let title: String
    public let titleCn: String
    public let author: String
    public let designer: String
    /// The theme version code, for example `HWHD13`; see `WatchfaceResolutions`.
    public let screen: String
    public let version: String
    public let font: String
    public let fontCn: String
    /// Root element `HnTheme` (Honor) instead of `HwTheme` (Huawei).
    public let isHonor: Bool

    public init(
        title: String, titleCn: String = "", author: String, designer: String = "", screen: String, version: String, font: String = "", fontCn: String = "",
        isHonor: Bool = false
    ) {
        self.title = title
        self.titleCn = titleCn
        self.author = author
        self.designer = designer
        self.screen = screen
        self.version = version
        self.font = font
        self.fontCn = fontCn
        self.isHonor = isHonor
    }
}

/// A validated `.hwt` package: the description and the `watchface.bin` the watch is sent.
public struct WatchfacePackage: Sendable {
    public let description: WatchfaceDescription
    public let binary: Bytes
    /// `preview/cover.jpg` when the package has one.
    public let preview: Bytes?

    public init(description: WatchfaceDescription, binary: Bytes, preview: Bytes?) {
        self.description = description
        self.binary = binary
        self.preview = preview
    }
}

/// GB `HuaweiWatchfaceManager.Resolution`: theme version code to `height*width`.
public enum WatchfaceResolutions {
    private static let byThemeVersion: [String: String] = [
        // Huawei sizes "height*width"
        "HWHD01": "390*390", "HWHD02": "454*454", "HWHD03": "240*120", "HWHD04": "160*80", "HWHD05": "460*188", "HWHD06": "456*280",
        "HWHD07": "368*194", "HWHD08": "320*320", "HWHD09": "466*466", "HWHD10": "360*320", "HWHD11": "480*336", "HWHD12": "240*240",
        "HWHD13": "480*408", "HWHD14": "482*286",
        // Honor sizes
        "HNHD01": "466*466", "HNHD02": "368*194", "HNHD03": "450*390", "HNHD04": "454*454", "HNHD05": "402*256", "QXHD01": "402*256",
        "QXHD02": "502*410",
    ]

    /// The Watch Fit 4 and Fit 4 Pro: a 1.82 inch AMOLED of 480 x 408 pixels, theme version `HWHD13` ("height*width" = 480*408).
    public static let fit4ThemeVersion = "HWHD13"
    public static let fit4Screen = "480*408"

    public static func isKnown(_ themeVersion: String) -> Bool { byThemeVersion[themeVersion] != nil }

    /// GB `isValid`: false for an unknown theme version.
    public static func isValid(_ themeVersion: String, _ screenResolution: String) -> Bool { byThemeVersion[themeVersion] == screenResolution }

    /// GB `screenByThemeVersion`.
    public static func screenByThemeVersion(_ themeVersion: String) -> String { byThemeVersion[themeVersion] ?? "0x0" }
}

public enum WatchfacePackages {
    /// A package is read into memory; this is far above any real watch face.
    public static let maxPackageBytes = 64 * 1024 * 1024

    private static let huaweiEntry = "com.huawei.watchface"
    private static let honorEntry = "com.honor.watchface"

    private static func bad(_ message: String) -> WearError { WearError(.invalidArgument, message) }

    /// GB `HuaweiFwHelper.parseAsWatchFace`: the package is a zip with `description.xml`, an optional `preview/cover.jpg` and an entry
    /// `com.huawei.watchface` (`com.honor.watchface` for Honor), which is itself a zip holding `watchface.bin`; older packages hold the
    /// binary directly. Throws `ERR_INVALID_ARGUMENT` with a message for the user when the file is no watch face.
    public static func parse(_ bytes: Bytes) throws -> WatchfacePackage {
        guard let descriptionBytes = entry(bytes, "description.xml") else {
            throw bad("This is not a watch face package: there is no description.xml in it. Export it as a .hwt file from the watch maker's watch-face designer.")
        }
        let description = try parseDescription(descriptionBytes)
        let entryName = description.isHonor ? honorEntry : huaweiEntry
        guard let outer = entry(bytes, entryName) else { throw bad("This watch face package has no \(entryName) entry.") }
        // GB: a nested zip with watchface.bin, else the entry itself is the binary.
        let binary = entry(outer, "watchface.bin") ?? outer
        if binary.isEmpty { throw bad("The watch face package contains an empty watch face.") }
        return WatchfacePackage(description: description, binary: binary, preview: entry(bytes, "preview/cover.jpg"))
    }

    public static func parseDescription(_ raw: Bytes) throws -> WatchfaceDescription {
        // GB strips a UTF-8 byte order mark before parsing.
        let offset = raw.count >= 3 && raw[0] == 0xEF && raw[1] == 0xBB && raw[2] == 0xBF ? 3 : 0
        let text = String(decoding: raw[offset...], as: UTF8.self)
        let root: MiniXMLElement
        do {
            root = try MiniXML.parse(text)
        } catch {
            throw bad("description.xml in this package is not valid XML: \(error)")
        }
        func element(_ tag: String) -> String { root.firstElement(named: tag).map { PacketsJava.trim($0.text) } ?? "" }
        let isHonor: Bool
        switch root.name {
        case "HnTheme": isHonor = true
        case "HwTheme": isHonor = false
        default: throw bad("description.xml has an unknown root element '\(root.name)' (expected HwTheme).")
        }
        let description = WatchfaceDescription(
            title: element("title"), titleCn: element("title-cn"), author: element("author"), designer: element("designer"),
            screen: element("screen"), version: element("version"), font: element("font"), fontCn: element("font-cn"), isHonor: isHonor
        )
        if description.screen.isEmpty { throw bad("description.xml names no screen (theme version).") }
        return description
    }

    /// GB `GBZipFile.getFileFromZip`, nil instead of an exception when the entry is missing, is a directory, or `zip` is no zip at all.
    public static func entry(_ zip: Bytes, _ name: String) -> Bytes? { ZipReader.entry(zip, named: name) }

    /// GB `HuaweiInstallHandler.validateInstallation`: the package's theme version has to name the watch's screen (`height*width`). A theme
    /// version GB does not know is allowed through (the watch decides); a known one with another size is refused.
    public static func checkResolution(_ description: WatchfaceDescription, height: Int, width: Int, log: (String) -> Void) throws {
        let deviceScreen = "\(height)*\(width)"
        if !WatchfaceResolutions.isKnown(description.screen) {
            log("watch face theme version \(description.screen) is not in GB's resolution table; not checked against the watch's \(deviceScreen)")
            return
        }
        if !WatchfaceResolutions.isValid(description.screen, deviceScreen) {
            throw bad(
                "This watch face is made for a \(WatchfaceResolutions.screenByThemeVersion(description.screen)) screen (\(description.screen)), "
                    + "but the watch reports \(deviceScreen). Make it in the watch-face designer for this watch's screen."
            )
        }
    }

    /// Huawei Health random version: three numbers from 1 to 10, joined by dots.
    public static func randomVersion<G: RandomNumberGenerator>(using random: inout G) -> String {
        let a = Int.random(in: 1...10, using: &random)
        let b = Int.random(in: 1...10, using: &random)
        let c = Int.random(in: 1...10, using: &random)
        return "\(a).\(b).\(c)"
    }

    /// `^\d+(\.\d+){1,3}$` with ASCII digits.
    private static func isUsableVersion(_ version: String) -> Bool {
        let parts = version.split(separator: ".", omittingEmptySubsequences: false)
        guard (2...4).contains(parts.count) else { return false }
        return parts.allSatisfy { !$0.isEmpty && $0.utf8.allSatisfy { (0x30...0x39).contains($0) } }
    }

    /// The `<id>_<version>` the face is uploaded under. The id is nine random digits (GB `getRandomName`; Huawei Health's local install
    /// always uses `000000001`, which would make two installed faces share an id). The version is the face's own, like a store face
    /// (`2184389193_2.10.5`), when it is a plain dotted number; otherwise a random one in Huawei Health's style. GB always used `1.0.0`, a
    /// version below the 2.1 to 2.10 range this watch lists.
    public static func randomName<G: RandomNumberGenerator>(using random: inout G, version: String? = nil) -> String {
        let trimmed = version?.trimmingCharacters(in: .whitespacesAndNewlines)
        let usable = trimmed.flatMap { isUsableVersion($0) ? $0 : nil } ?? randomVersion(using: &random)
        let digits = String(Int.random(in: 0..<1_000_000_000, using: &random))
        return String(repeating: "0", count: 9 - digits.count) + digits + "_" + usable
    }

    public static func randomName(version: String? = nil) -> String {
        var generator = SystemRandomNumberGenerator()
        return randomName(using: &generator, version: version)
    }

    /// The leading `major.minor` of a version such as `2.10.5`, or nil when it has none.
    public static func majorMinor(_ version: String) -> (Int, Int)? {
        let parts = version.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count >= 2, let major = Int(parts[0]), let minor = Int(parts[1]) else { return nil }
        return (major, minor)
    }

    /// Huawei Health's face version check, with the watch's other versions as its compatible list: the face's `<version>` has the watch's
    /// major version and a minor no higher than the watch's maximum, or is listed among the other versions the watch accepts. A version that
    /// cannot be read on either side is left to the watch.
    public static func checkVersion(_ description: WatchfaceDescription, maxVersion: String, otherVersions: String, log: (String) -> Void) throws {
        guard let face = majorMinor(description.version), let max = majorMinor(maxVersion) else {
            log("watch face version '\(description.version)' or the watch's maximum '\(maxVersion)' cannot be read; not checked")
            return
        }
        if face.0 == max.0 && face.1 <= max.1 { return }
        if otherVersions.split(separator: ",", omittingEmptySubsequences: false).contains(where: { majorMinor(String($0)).map { $0 == face } ?? false }) { return }
        let others = otherVersions.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "" : " (and \(otherVersions))"
        throw bad(
            "This watch face was made for watch face version \(face.0).\(face.1) (description.xml version \(description.version)), "
                + "but the watch supports up to \(maxVersion)\(others). Export it again from the watch-face designer for this watch."
        )
    }
}
