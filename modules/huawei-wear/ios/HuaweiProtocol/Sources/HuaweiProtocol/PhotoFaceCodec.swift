// Port of PhotoFaceCodec.kt. Photo face wire formats, from Huawei Health 17.0.8.300:
//  - 27/08 and 27/09: photo info, background list, custom data and option selection (the layout the Fit 4 Pro answers in; an older layout
//    lists photos under 82{83} and the watch does not use it)
//  - 28/01 (the watch asks for a file): the device request and its report
//  - the .bin image: run-length coded pixels
// No signature or account data is part of any of these. The values a new photo gets come from a table of known faces
// (`PhotoFaceCodec.knownFaceConfigs`). Verified against the byte examples of the Kotlin PhotoFaceTest (the `.bin` vectors there are reference
// outputs generated outside the repository for the same pixels).
import Foundation

/// One photo of the face, as the watch lists it in 27/08 (`84{85{...}}`). The settings are the watch's own; JoyoFit has no editor for them and
/// sends them back so a save does not reset them. Nil = the watch did not report it.
public struct PhotoSlot: Equatable, Sendable {
    /// Tag 0x06: position in the face's list; the watch counts from 0.
    public var index: Int
    /// Tag 0x07: the name the watch knows the photo by, `<name>.png`.
    public var name: String
    /// Tag 0x0c (written as 0x0a).
    public var portPosition: Int?
    /// Tag 0x0d (written as 0x0b).
    public var portraitMode: Int?
    /// Tag 0x0e (written as 0x0c).
    public var timeStyle: Int?
    /// Tag 0x0f (written as 0x0d), a `#AARRGGBB` string.
    public var timeColour: String?
    /// Tag 0x10 (written as 0x0e), a `#AARRGGBB` string.
    public var backgroundColour: String?
    /// Tag 0x29, the same tag both ways.
    public var timeSize: Int?
    /// Tags 0x18 / 0x19 / 0x1a: smart time style, font and position (written as 0x15 / 0x16 / 0x17).
    public var smartTime: Int?
    public var smartFont: Int?
    public var smartPosition: Int?

    public init(
        index: Int, name: String, portPosition: Int? = nil, portraitMode: Int? = nil, timeStyle: Int? = nil, timeColour: String? = nil,
        backgroundColour: String? = nil, timeSize: Int? = nil, smartTime: Int? = nil, smartFont: Int? = nil, smartPosition: Int? = nil
    ) {
        self.index = index
        self.name = name
        self.portPosition = portPosition
        self.portraitMode = portraitMode
        self.timeStyle = timeStyle
        self.timeColour = timeColour
        self.backgroundColour = backgroundColour
        self.timeSize = timeSize
        self.smartTime = smartTime
        self.smartFont = smartFont
        self.smartPosition = smartPosition
    }
}

/// The values Huawei Health's My watch faces page gives a photo it adds, which it takes from the face's `watch_face_config.xml` (`<config>`),
/// with the page's fallbacks when the face is unknown (app.js module 221: `RN` 1, `jY` 2, `m$` 1). JoyoFit does not fetch that file: the faces
/// whose values are known are in `PhotoFaceCodec.knownFaceConfigs` (protocol/README.md, "Photo faces"). Port of PhotoFaceConfig.
public struct PhotoFaceConfig: Equatable, Sendable {
    /// `timeStylePostions selected_index`: a new photo's time position (`0a` and smart `17`).
    public var timePosition: Int
    /// `timeStyles selected_index`: a new photo's time style (`0c` and smart `15`).
    public var timeStyle: Int
    /// `fontStyles selected_index`: a new photo's smart font (`16`).
    public var font: Int
    /// `positions` / `styles selected_index`: the top-level `06` / `07`.
    public var positionIndex: Int
    public var styleIndex: Int
    /// `timeStylePostions/position position_rect` (left, top, right, bottom) by index: where the time is drawn, the area the time colour is chosen for.
    public var positionRects: [Int: [Int]]

    public init(
        timePosition: Int = 1, timeStyle: Int = 2, font: Int = 1, positionIndex: Int = 1, styleIndex: Int = 2, positionRects: [Int: [Int]] = [:]
    ) {
        self.timePosition = timePosition
        self.timeStyle = timeStyle
        self.font = font
        self.positionIndex = positionIndex
        self.styleIndex = styleIndex
        self.positionRects = positionRects
    }
}

/// What `PhotoFaceCodec.saveTlv` needs besides the watch's 27/08 answer.
public struct PhotoSaveFields: Equatable, Sendable {
    public var config: PhotoFaceConfig
    /// `PhotoFaceCodec.gaussSwitch` of the watch's 27/01; -1 leaves the smart fields out.
    public var gaussSwitch: Int
    /// Time colours picked from the phone's copy of a photo (`PhotoFaceCodec.smartColour`), by name.
    public var timeColours: [String: String]

    public init(config: PhotoFaceConfig = PhotoFaceConfig(), gaussSwitch: Int = -1, timeColours: [String: String] = [:]) {
        self.config = config
        self.gaussSwitch = gaussSwitch
        self.timeColours = timeColours
    }
}

/// The photo face's settings and its photo list (the answer to 27/08).
public struct PhotoFaceInfo: Equatable, Sendable {
    /// Tag 0x01: how many photos the face takes.
    public var maxPhotos: Int
    /// Tag 0x02: the face can pick its text colour from the photo.
    public var intellectColour: Bool
    /// Tag 0x03: Huawei Health writes 2 here to mean the watch's photos are `.bin` and must be converted to show them.
    public var backgroundType: Int
    /// Tags 0x08 / 0x09 / 0x0a: position, style and data index when the face has them (written as 0x06 / 0x07 / 0x09).
    public var positionIndex: Int?
    public var styleIndex: Int?
    public var dataIndex: Int?
    /// Tag 0x0b: which `.bin` flavour the watch wants (see `PhotoBin.Format`).
    public var imageOption: Int
    /// Tag 0x0d at the top level.
    public var portraitMode: Int?
    public var photos: [PhotoSlot]
    /// Tags 0x11 / 0x12 (written as 0x0f / 0x10).
    public var wristSwitch: Int?
    public var styleApplyAll: Int?
    /// Tag 0x13 `{14{15 container, 16 option}}` (written as 0x11 `{12{13, 14}}`): the option shown in each data slot.
    public var dataSlots: [(container: Int, option: Int)]
    /// Tag 0x1f `{20{21 option}}` (written as 0x1d `{1e{1f}}`); Huawei Health only reads and writes it with exactly two entries.
    public var selectedOptions: [Int]
    /// Tag 0x17. Huawei Health reads it and never writes it: there is no carousel setting in 27/09.
    public var carouselMode: Int?

    public init(
        maxPhotos: Int, intellectColour: Bool = false, backgroundType: Int = 0, positionIndex: Int? = nil, styleIndex: Int? = nil, dataIndex: Int? = nil,
        imageOption: Int = 0, portraitMode: Int? = nil, photos: [PhotoSlot] = [], wristSwitch: Int? = nil, styleApplyAll: Int? = nil,
        dataSlots: [(container: Int, option: Int)] = [], selectedOptions: [Int] = [], carouselMode: Int? = nil
    ) {
        self.maxPhotos = maxPhotos
        self.intellectColour = intellectColour
        self.backgroundType = backgroundType
        self.positionIndex = positionIndex
        self.styleIndex = styleIndex
        self.dataIndex = dataIndex
        self.imageOption = imageOption
        self.portraitMode = portraitMode
        self.photos = photos
        self.wristSwitch = wristSwitch
        self.styleApplyAll = styleApplyAll
        self.dataSlots = dataSlots
        self.selectedOptions = selectedOptions
        self.carouselMode = carouselMode
    }

    public static func == (a: PhotoFaceInfo, b: PhotoFaceInfo) -> Bool {
        a.maxPhotos == b.maxPhotos && a.intellectColour == b.intellectColour && a.backgroundType == b.backgroundType
            && a.positionIndex == b.positionIndex && a.styleIndex == b.styleIndex && a.dataIndex == b.dataIndex && a.imageOption == b.imageOption
            && a.portraitMode == b.portraitMode && a.photos == b.photos && a.wristSwitch == b.wristSwitch && a.styleApplyAll == b.styleApplyAll
            && a.dataSlots.map { [$0.container, $0.option] } == b.dataSlots.map { [$0.container, $0.option] } && a.selectedOptions == b.selectedOptions
            && a.carouselMode == b.carouselMode
    }
}

/// The answer to 27/09: tag 0x7f status (100000 = fine) and tag 0x08 the number of photos the watch still wants from the phone.
public struct PhotoSaveStatus: Equatable, Sendable {
    public let code: Int
    public let transferNum: Int
}

/// The watch's request for one file (28/01).
public struct PhotoFileRequest: Equatable, Sendable {
    public let name: String
    public let fileType: Int
    public let resourceType: Int

    public init(name: String, fileType: Int, resourceType: Int) {
        self.name = name
        self.fileType = fileType
        self.resourceType = resourceType
    }
}

/// A 27/05 status report: `reportType` 4 is "photos received", `failedNum` how many did not arrive.
public struct WatchfaceReport: Equatable, Sendable {
    public let id: String
    public let version: String
    public let reportType: Int
    public let failedNum: Int
    public let code: Int
}

public enum PhotoFaceCodec {
    public static let statusOK = 100_000
    /// Huawei Health answers a file request with this when it has no such file.
    public static let fileMissing = 140_006
    public static let fileTypePhoto = 3
    public static let reportPhotosReceived = 4
    public static let pngSuffix = ".png"

    private static func opt(_ tlv: HuaweiTLV, _ tag: Int) -> Int? { tlv.contains(tag) ? Int(tlv.asInteger(tag, default: 0)) : nil }

    private static func optString(_ tlv: HuaweiTLV, _ tag: Int) throws -> String? { tlv.contains(tag) ? try tlv.string(tag) : nil }

    /// Throws what the Java TLV getters throw for a nested list that does not parse.
    public static func parseInfo(_ tlv: HuaweiTLV) throws -> PhotoFaceInfo {
        var photos = [PhotoSlot]()
        for container in try tlv.objects(0x84) {
            for entry in try container.objects(0x85) {
                guard let name = try optString(entry, 0x07), !name.isEmpty else { continue }
                photos.append(PhotoSlot(
                    index: Int(entry.asInteger(0x06, default: Int32(photos.count))), name: name, portPosition: opt(entry, 0x0c), portraitMode: opt(entry, 0x0d),
                    timeStyle: opt(entry, 0x0e), timeColour: try optString(entry, 0x0f), backgroundColour: try optString(entry, 0x10), timeSize: opt(entry, 0x29),
                    smartTime: opt(entry, 0x18), smartFont: opt(entry, 0x19), smartPosition: opt(entry, 0x1a)
                ))
            }
        }
        // Kotlin `sortBy` is stable.
        photos = photos.enumerated().sorted { ($0.element.index, $0.offset) < ($1.element.index, $1.offset) }.map(\.element)
        var dataSlots = [(container: Int, option: Int)]()
        for container in try tlv.objects(0x93) {
            for slot in try container.objects(0x94) {
                if let c = opt(slot, 0x15), let o = opt(slot, 0x16) { dataSlots.append((c, o)) }
            }
        }
        var selected = [Int?]()
        for container in try tlv.objects(0x9f) {
            for entry in try container.objects(0xa0) { selected.append(opt(entry, 0x21)) }
        }
        return PhotoFaceInfo(
            maxPhotos: Int(tlv.asInteger(0x01, default: 0)), intellectColour: tlv.asInteger(0x02, default: 0) == 1, backgroundType: Int(tlv.asInteger(0x03, default: 0)),
            positionIndex: opt(tlv, 0x08), styleIndex: opt(tlv, 0x09), dataIndex: opt(tlv, 0x0a), imageOption: Int(tlv.asInteger(0x0b, default: 0)),
            portraitMode: opt(tlv, 0x0d), photos: photos, wristSwitch: opt(tlv, 0x11), styleApplyAll: opt(tlv, 0x12), dataSlots: dataSlots,
            selectedOptions: selected.count == 2 && selected.allSatisfy({ $0 != nil }) ? selected.map { $0! } : [], carouselMode: opt(tlv, 0x17)
        )
    }

    /// A photo's time colour when nothing else is known: Huawei Health's `Dp`.
    public static let noColour = "#00000000"

    /// The time colour Huawei Health sends for a photo whose colour comes from the picture (when the watch's 27/01 tag 0x1b
    /// `supportAestheticAlbumColor` is 1): `#01` (the page's `xv` marker) and an RGB, e.g. `#01ffe7d8`. JoyoFit's RGB comes from `PhotoTimeColour`.
    public static func smartColour(_ picked: UInt32) -> String {
        let hex = String(picked & 0xFF_FFFF, radix: 16)
        return "#01" + String(repeating: "0", count: 6 - hex.count) + hex
    }

    /// The Gaussian switch Huawei Health writes (`isUseGaussColor`): the page gets the watch's 27/01 tag 0x1a with 1 turned into 0
    /// (`WatchFaceApiImpl.getH5Params`), -1 when the watch did not send the tag.
    public static func gaussSwitch(_ paramsTag1a: Int) -> Int { paramsTag1a == 1 ? 0 : paramsTag1a }

    /// The 27/09 TLV as Huawei Health's `makeNewPhotoInfoCommand` writes the album its My watch faces page hands over (capture 2026-10-25, Fit 4
    /// Pro: the "add photo" prompt on the watch went away after it). `01` count, then for `names` in order (index from 0) `82{83{04 index, 05 name,
    /// 0a time position, 0b portrait 0, 0c time style, 0d time colour, 0e background colour, 29 time size, [15 smart time, 16 smart font, 17 smart
    /// position, 1c Gaussian switch]}}` (the bracket only when the switch is not -1), then `06`, `07`, `09`, `0f`, `10`, `91{92{13, 14}}` (only
    /// when the watch reported data slots), `1c` Gaussian switch and `9d{9e{1f}...}` (the watch's two selected options, or 0 and 0). A photo the
    /// watch lists keeps the values it reported; anything missing or 0 comes from the face config like a new photo. A photo without a colour in
    /// `fields.timeColours` keeps the watch's colour, else `noColour`.
    public static func saveTlv(_ info: PhotoFaceInfo, _ names: [String], _ fields: PhotoSaveFields = PhotoSaveFields()) -> HuaweiTLV {
        let config = fields.config
        let gauss = fields.gaussSwitch
        var known = [String: PhotoSlot]()
        for slot in info.photos { known[slot.name] = slot } // Kotlin `associateBy`: the last of a repeated name wins
        func byte(_ v: Int) -> UInt8 { UInt8(truncatingIfNeeded: v) }
        func orElse(_ v: Int?, _ fallback: Int) -> Int { if let v, v > 0 { return v } else { return fallback } }
        var tlv = HuaweiTLV()
        tlv.put(0x01, byte: byte(names.count))
        if !names.isEmpty {
            var list = HuaweiTLV()
            for (i, name) in names.enumerated() {
                let slot = known[name]
                let position = orElse(slot?.portPosition, config.timePosition)
                let timeStyle = orElse(slot?.timeStyle, config.timeStyle)
                var entry = HuaweiTLV()
                entry.put(0x04, byte: byte(i))
                entry.put(0x05, string: name)
                entry.put(0x0a, byte: byte(position))
                entry.put(0x0b, byte: 0)
                entry.put(0x0c, byte: byte(timeStyle))
                let watchColour = slot?.timeColour.flatMap { $0.isEmpty ? nil : $0 }
                entry.put(0x0d, string: fields.timeColours[name] ?? watchColour ?? noColour)
                entry.put(0x0e, string: slot?.backgroundColour.flatMap { $0.isEmpty ? nil : $0 } ?? noColour)
                entry.put(0x29, byte: byte(slot?.timeSize ?? 0))
                if gauss != -1 {
                    entry.put(0x15, byte: byte(orElse(slot?.smartTime, timeStyle)))
                    entry.put(0x16, byte: byte(orElse(slot?.smartFont, config.font)))
                    entry.put(0x17, byte: byte(orElse(slot?.smartPosition, position)))
                    entry.put(0x1c, byte: byte(gauss))
                }
                list.put(0x83, tlv: entry)
            }
            tlv.put(0x82, tlv: list)
        }
        tlv.put(0x06, byte: byte(config.positionIndex))
        tlv.put(0x07, byte: byte(config.styleIndex))
        tlv.put(0x09, byte: byte(info.dataIndex ?? 0))
        tlv.put(0x0f, byte: byte(info.wristSwitch ?? 0))
        tlv.put(0x10, byte: byte(info.styleApplyAll ?? 0))
        if !info.dataSlots.isEmpty {
            var slots = HuaweiTLV()
            for (container, option) in info.dataSlots {
                var s = HuaweiTLV()
                s.put(0x13, byte: byte(container))
                s.put(0x14, byte: byte(option))
                slots.put(0x92, tlv: s)
            }
            tlv.put(0x91, tlv: slots)
        }
        tlv.put(0x1c, byte: byte(gauss))
        var options = HuaweiTLV()
        for option in info.selectedOptions.isEmpty ? [0, 0] : info.selectedOptions {
            var o = HuaweiTLV()
            o.put(0x1f, byte: byte(option))
            options.put(0x9e, tlv: o)
        }
        tlv.put(0x9d, tlv: options)
        return tlv
    }

    /// The new-photo values of the photo faces whose `watch_face_config.xml` was read during research (2026-10-25, protocol/README.md, "Photo
    /// faces"), by face id. 2180736265 is the Watch Fit 4 Pro's photo face (version 2.4.11).
    public static let knownFaceConfigs: [String: PhotoFaceConfig] = [
        "2180736265": PhotoFaceConfig(
            timePosition: 1, timeStyle: 2, font: 1, positionIndex: 1, styleIndex: 2,
            positionRects: [
                1: [68, 18, 406, 182], 2: [68, 288, 406, 432], 3: [10, 108, 276, 399], 4: [236, 108, 456, 399], 5: [68, 108, 406, 399],
                6: [10, 10, 194, 230], 7: [214, 10, 398, 230], 8: [10, 250, 194, 470], 9: [214, 250, 398, 470],
            ]
        ),
    ]

    /// `knownFaceConfigs` for `faceId`, else the page's fallbacks (position 1, style 2, font 1, no time area).
    public static func faceConfig(_ faceId: String) -> PhotoFaceConfig { knownFaceConfigs[faceId] ?? PhotoFaceConfig() }

    public static func parseSaveStatus(_ tlv: HuaweiTLV) -> PhotoSaveStatus {
        PhotoSaveStatus(code: Int(tlv.asInteger(0x7f, default: -1)), transferNum: Int(tlv.asInteger(0x08, default: 0)))
    }

    public static func parseFileRequest(_ tlv: HuaweiTLV) throws -> PhotoFileRequest? {
        guard tlv.contains(0x01) else { return nil }
        return PhotoFileRequest(
            name: try tlv.string(0x01),
            // Huawei Health defaults the type to 3 when the watch sends none and the resource type to -1.
            fileType: Int(tlv.asInteger(0x02, default: Int32(fileTypePhoto))), resourceType: Int(tlv.asInteger(0x05, default: -1))
        )
    }

    public static func parseReport(_ tlv: HuaweiTLV) throws -> WatchfaceReport {
        WatchfaceReport(
            id: tlv.contains(0x01) ? try tlv.string(0x01) : "", version: tlv.contains(0x02) ? try tlv.string(0x02) : "",
            reportType: Int(tlv.asInteger(0x03, default: -1)), failedNum: Int(tlv.asInteger(0x04, default: 0)), code: Int(tlv.asInteger(0x7f, default: Int32(statusOK)))
        )
    }

    /// The `.png` name of a photo: the watch lists and requests `<name>.png`.
    public static func pngName(_ name: String) -> String { name.hasSuffix(pngSuffix) ? name : name + pngSuffix }

    /// The bytes Huawei Health sends for a requested photo: for a resource type other than 1 the `.bin` file that goes with the `.png` name,
    /// for 1 the PNG itself.
    public static func contentFor(_ request: PhotoFileRequest, png: Bytes, bin: Bytes) -> Bytes { request.resourceType == 1 ? png : bin }
}

/// The `.bin` image the watch takes for a photo: the four bytes `45 23` + format code, width and height as little-endian 16-bit numbers, then
/// the pixels in row order, run-length coded. Three flavours; the watch names the one it wants in tag 0x0b of 27/08.
public enum PhotoBin {
    public enum Format: Int, CaseIterable, Sendable {
        /// Option 0 (anything but 1 and 2): 32-bit pixels, little-endian ARGB ints.
        case argb32 = 0
        /// Option 1: 24-bit pixels (blue, green, red).
        case rgb24 = 1
        /// Option 2: RGB565, two pixels to a 32-bit word.
        case rgb565 = 2

        public var code: Int {
            switch self {
            case .argb32: return 0x8888
            case .rgb24: return 0x8808
            case .rgb565: return 0x65F5
            }
        }

        public var name: String {
            switch self {
            case .argb32: return "ARGB32"
            case .rgb24: return "RGB24"
            case .rgb565: return "RGB565"
            }
        }

        public static func from(option: Int) -> Format { Format(rawValue: option) ?? .argb32 }
    }

    public enum EncodeError: Error, Equatable {
        case sizeMismatch(pixels: Int, width: Int, height: Int)
        case sizeOutOfRange(width: Int, height: Int)
    }

    private static let header = 0x4523
    private static let marker32: UInt32 = 0x2345_6789
    private static let marker24: UInt32 = 0x45_6789

    /// `argb` holds `width * height` pixels as 0xAARRGGBB, row by row.
    public static func encode(_ argb: [UInt32], width: Int, height: Int, format: Format) throws -> Bytes {
        guard argb.count == width * height else { throw EncodeError.sizeMismatch(pixels: argb.count, width: width, height: height) }
        guard (1...0xFFFF).contains(width), (1...0xFFFF).contains(height) else { throw EncodeError.sizeOutOfRange(width: width, height: height) }
        var out = Bytes()
        out.reserveCapacity(argb.count / 2 + 16)
        out.append(UInt8(header >> 8))
        out.append(UInt8(header & 0xFF))
        out.append(UInt8(format.code >> 8))
        out.append(UInt8(format.code & 0xFF))
        le16(&out, UInt32(width))
        le16(&out, UInt32(height))
        switch format {
        case .argb32: encode32(&out, argb)
        case .rgb24: encode24(&out, argb)
        case .rgb565: encode565(&out, argb)
        }
        return out
    }

    private static func le16(_ out: inout Bytes, _ v: UInt32) {
        out.append(UInt8(v & 0xFF))
        out.append(UInt8((v >> 8) & 0xFF))
    }

    private static func le24(_ out: inout Bytes, _ v: UInt32) {
        le16(&out, v)
        out.append(UInt8((v >> 16) & 0xFF))
    }

    private static func le32(_ out: inout Bytes, _ v: UInt32) {
        le16(&out, v)
        le16(&out, v >> 16)
    }

    /// `c(DataOutputStream, int[])`: a run of four or more is `marker, pixel, count`; shorter runs are written out.
    private static func encode32(_ out: inout Bytes, _ px: [UInt32]) {
        var run: UInt32 = 1
        for i in px.indices {
            if i == px.count - 1 || px[i] != px[i + 1] {
                if run >= 4 {
                    le32(&out, marker32)
                    le32(&out, px[i])
                    le32(&out, run)
                } else {
                    for _ in 0..<run { le32(&out, px[i]) }
                }
                run = 1
            } else {
                run += 1
            }
        }
    }

    /// `b(DataOutputStream, int[])`: as above with three bytes a pixel; a pixel that looks like the marker is always written as a run.
    private static func encode24(_ out: inout Bytes, _ px: [UInt32]) {
        var run: UInt32 = 1
        for i in px.indices {
            if i == px.count - 1 || px[i] != px[i + 1] {
                if run >= 4 || (px[i] & 0xFF_FFFF) == marker24 {
                    le24(&out, marker24)
                    le24(&out, px[i])
                    le24(&out, run)
                } else {
                    for _ in 0..<run { le24(&out, px[i]) }
                }
                run = 1
            } else {
                run += 1
            }
        }
    }

    private static func rgb565(_ p: UInt32) -> UInt32 { (((p >> 19) & 31) << 11) + (((p >> 10) & 63) << 5) + ((p >> 3) & 31) }

    /// `a(DataOutputStream, int[])`: 16-bit pixels packed in pairs. A lone pixel is written together with the one after it (a zero when it is
    /// the last), a run of an odd length gives its last pixel to the next pair, a run of eight or more is `marker, pixel pair, pairs`.
    private static func encode565(_ out: inout Bytes, _ px: [UInt32]) {
        func emit(_ count: Int, _ at: Int) {
            if count == 1 {
                le16(&out, rgb565(px[at]))
                le16(&out, at < px.count - 1 ? rgb565(px[at + 1]) : 0)
            } else if count < 8 {
                for _ in 0..<count { le16(&out, rgb565(px[at])) }
            } else {
                le32(&out, marker32)
                le16(&out, rgb565(px[at]))
                le16(&out, rgb565(px[at]))
                le32(&out, UInt32(count / 2))
            }
        }
        var i = 0
        var run = 1
        while i < px.count {
            if i == px.count - 1 || px[i] != px[i + 1] {
                if run == 1 {
                    emit(run, i)
                    i += 1
                } else if run % 2 != 0 {
                    emit(run - 1, i)
                    i -= 1
                } else {
                    emit(run, i)
                }
                run = 1
            } else {
                run += 1
            }
            i += 1
        }
    }
}
