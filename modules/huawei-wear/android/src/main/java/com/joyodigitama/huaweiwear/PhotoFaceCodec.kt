// Photo face wire formats, from Huawei Health 17.0.8.300:
//  - 27/08 and 27/09: photo info, background list, custom data and option selection (the layout the Fit 4 Pro answers in; an older
//    layout lists photos under 82{83} and the watch does not use it)
//  - 28/01 (the watch asks for a file): the device request and its report
//  - the .bin image: run-length coded pixels
// No signature or account data is part of any of these. The values a new photo gets come from a table of known faces
// ([PhotoFaceCodec.KNOWN_FACE_CONFIGS]).
package com.joyodigitama.huaweiwear

import java.io.ByteArrayOutputStream
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV

/**
 * One photo of the face, as the watch lists it in 27/08 (`84{85{…}}`). The settings are the watch's own; JoyoFit has no editor for them
 * and sends them back so a save does not reset them. Null = the watch did not report it.
 */
internal class PhotoSlot(
  /** Tag 0x06: position in the face's list; the watch counts from 0. */
  val index: Int,
  /** Tag 0x07: the name the watch knows the photo by, `<name>.png`. */
  val name: String,
  /** Tag 0x0c (written as 0x0a). */
  val portPosition: Int? = null,
  /** Tag 0x0d (written as 0x0b). */
  val portraitMode: Int? = null,
  /** Tag 0x0e (written as 0x0c). */
  val timeStyle: Int? = null,
  /** Tag 0x0f (written as 0x0d), a `#AARRGGBB` string. */
  val timeColour: String? = null,
  /** Tag 0x10 (written as 0x0e), a `#AARRGGBB` string. */
  val backgroundColour: String? = null,
  /** Tag 0x29, the same tag both ways. */
  val timeSize: Int? = null,
  /** Tags 0x18 / 0x19 / 0x1a: smart time style, font and position (written as 0x15 / 0x16 / 0x17). */
  val smartTime: Int? = null,
  val smartFont: Int? = null,
  val smartPosition: Int? = null,
)

/**
 * The values Huawei Health's My watch faces page gives a photo it adds, which it takes from the face's `watch_face_config.xml`
 * (`<config>`), with the page's fallbacks when the face is unknown (app.js module 221: `RN` 1, `jY` 2, `m$` 1). JoyoFit does not fetch
 * that file: the faces whose values are known are in [PhotoFaceCodec.KNOWN_FACE_CONFIGS] (protocol/README.md, "Photo faces").
 */
internal class PhotoFaceConfig(
  /** `timeStylePostions selected_index`: a new photo's time position (`0a` and smart `17`). */
  val timePosition: Int = 1,
  /** `timeStyles selected_index`: a new photo's time style (`0c` and smart `15`). */
  val timeStyle: Int = 2,
  /** `fontStyles selected_index`: a new photo's smart font (`16`). */
  val font: Int = 1,
  /** `positions` / `styles selected_index`: the top-level `06` / `07`. */
  val positionIndex: Int = 1,
  val styleIndex: Int = 2,
  /** `timeStylePostions/position position_rect` (left, top, right, bottom) by index: where the time is drawn, the area the time colour is chosen for. */
  val positionRects: Map<Int, IntArray> = emptyMap(),
)

/** What [PhotoFaceCodec.saveTlv] needs besides the watch's 27/08 answer. */
internal class PhotoSaveFields(
  val config: PhotoFaceConfig = PhotoFaceConfig(),
  /** [PhotoFaceCodec.gaussSwitch] of the watch's 27/01; -1 leaves the smart fields out. */
  val gaussSwitch: Int = -1,
  /** Time colours picked from the phone's copy of a photo ([PhotoFaceCodec.smartColour]), by name. */
  val timeColours: Map<String, String> = emptyMap(),
)

/** The photo face's settings and its photo list (the answer to 27/08). */
internal class PhotoFaceInfo(
  /** Tag 0x01: how many photos the face takes. */
  val maxPhotos: Int,
  /** Tag 0x02: the face can pick its text colour from the photo. */
  val intellectColour: Boolean,
  /** Tag 0x03: Huawei Health writes 2 here to mean the watch's photos are `.bin` and must be converted to show them. */
  val backgroundType: Int,
  /** Tags 0x08 / 0x09 / 0x0a: position, style and data index when the face has them (written as 0x06 / 0x07 / 0x09). */
  val positionIndex: Int?,
  val styleIndex: Int?,
  val dataIndex: Int?,
  /** Tag 0x0b: which `.bin` flavour the watch wants (see [PhotoBin.Format]). */
  val imageOption: Int,
  /** Tag 0x0d at the top level. */
  val portraitMode: Int?,
  val photos: List<PhotoSlot>,
  /** Tags 0x11 / 0x12 (written as 0x0f / 0x10). */
  val wristSwitch: Int? = null,
  val styleApplyAll: Int? = null,
  /** Tag 0x13 `{14{15 container, 16 option}}` (written as 0x11 `{12{13, 14}}`): the option shown in each data slot. */
  val dataSlots: List<Pair<Int, Int>> = emptyList(),
  /** Tag 0x1f `{20{21 option}}` (written as 0x1d `{1e{1f}}`); Huawei Health only reads and writes it with exactly two entries. */
  val selectedOptions: List<Int> = emptyList(),
  /** Tag 0x17. Huawei Health reads it and never writes it: there is no carousel setting in 27/09. */
  val carouselMode: Int? = null,
)

/** The answer to 27/09: tag 0x7f status (100000 = fine) and tag 0x08 the number of photos the watch still wants from the phone. */
internal class PhotoSaveStatus(val code: Int, val transferNum: Int)

/** The watch's request for one file (28/01). */
internal class PhotoFileRequest(val name: String, val fileType: Int, val resourceType: Int)

/** A 27/05 status report: `reportType` 4 is "photos received", `failedNum` how many did not arrive. */
internal class WatchfaceReport(val id: String, val version: String, val reportType: Int, val failedNum: Int, val code: Int)

internal object PhotoFaceCodec {
  const val STATUS_OK = 100000
  /** Huawei Health answers a file request with this when it has no such file. */
  const val FILE_MISSING = 140006
  const val FILE_TYPE_PHOTO = 3
  const val REPORT_PHOTOS_RECEIVED = 4
  const val PNG_SUFFIX = ".png"

  fun parseInfo(tlv: HuaweiTLV): PhotoFaceInfo {
    fun HuaweiTLV.opt(tag: Int): Int? = if (contains(tag)) getAsInteger(tag, 0) else null
    fun HuaweiTLV.optString(tag: Int): String? = if (contains(tag)) getString(tag) else null
    val photos = ArrayList<PhotoSlot>()
    for (container in tlv.getObjects(0x84)) {
      for (entry in container.getObjects(0x85)) {
        val name = entry.optString(0x07)
        if (name.isNullOrEmpty()) continue
        photos.add(
          PhotoSlot(
            index = entry.getAsInteger(0x06, photos.size),
            name = name,
            portPosition = entry.opt(0x0c),
            portraitMode = entry.opt(0x0d),
            timeStyle = entry.opt(0x0e),
            timeColour = entry.optString(0x0f),
            backgroundColour = entry.optString(0x10),
            timeSize = entry.opt(0x29),
            smartTime = entry.opt(0x18),
            smartFont = entry.opt(0x19),
            smartPosition = entry.opt(0x1a),
          ),
        )
      }
    }
    photos.sortBy { it.index }
    val dataSlots = tlv.getObjects(0x93).flatMap { it.getObjects(0x94) }.mapNotNull { slot ->
      val container = slot.opt(0x15)
      val option = slot.opt(0x16)
      if (container != null && option != null) container to option else null
    }
    val selected = tlv.getObjects(0x9f).flatMap { it.getObjects(0xa0) }.map { it.opt(0x21) }
    return PhotoFaceInfo(
      maxPhotos = tlv.getAsInteger(0x01, 0),
      intellectColour = tlv.getAsInteger(0x02, 0) == 1,
      backgroundType = tlv.getAsInteger(0x03, 0),
      positionIndex = tlv.opt(0x08),
      styleIndex = tlv.opt(0x09),
      dataIndex = tlv.opt(0x0a),
      imageOption = tlv.getAsInteger(0x0b, 0),
      portraitMode = tlv.opt(0x0d),
      photos = photos,
      wristSwitch = tlv.opt(0x11),
      styleApplyAll = tlv.opt(0x12),
      dataSlots = dataSlots,
      selectedOptions = if (selected.size == 2 && selected.all { it != null }) selected.map { it!! } else emptyList(),
      carouselMode = tlv.opt(0x17),
    )
  }

  /** A photo's time colour when nothing else is known: Huawei Health's `Dp`. */
  const val NO_COLOUR = "#00000000"

  /**
   * The time colour Huawei Health sends for a photo whose colour comes from the picture (when the watch's 27/01 tag 0x1b
   * `supportAestheticAlbumColor` is 1): `#01` (the page's `xv` marker) and an RGB, e.g. `#01ffe7d8`. JoyoFit's RGB comes from
   * [PhotoTimeColour].
   */
  fun smartColour(picked: Int): String = "#01" + String.format("%08x", picked).substring(2)

  /**
   * The Gaussian switch Huawei Health writes (`isUseGaussColor`): the page gets the watch's 27/01 tag 0x1a with 1 turned into 0
   * (`WatchFaceApiImpl.getH5Params`), -1 when the watch did not send the tag.
   */
  fun gaussSwitch(paramsTag1a: Int): Int = if (paramsTag1a == 1) 0 else paramsTag1a

  /**
   * The 27/09 TLV as Huawei Health's `makeNewPhotoInfoCommand` writes the album its My watch faces page hands over (capture 2026-10-25,
   * Fit 4 Pro: the "add photo" prompt on the watch went away after it). `01` count, then for [names] in order (index from 0)
   * `82{83{04 index, 05 name, 0a time position, 0b portrait 0, 0c time style, 0d time colour, 0e background colour, 29 time size,
   * [15 smart time, 16 smart font, 17 smart position, 1c Gaussian switch]}}` (the bracket only when the switch is not -1), then `06`,
   * `07`, `09`, `0f`, `10`, `91{92{13, 14}}` (only when the watch reported data slots), `1c` Gaussian switch and `9d{9e{1f}…}` (the
   * watch's two selected options, or 0 and 0). A photo the watch lists keeps the values it reported; anything missing or 0 comes from
   * the face config like a new photo. A photo without a colour in [PhotoSaveFields.timeColours] keeps the watch's colour, else
   * [NO_COLOUR].
   */
  fun saveTlv(info: PhotoFaceInfo, names: List<String>, fields: PhotoSaveFields = PhotoSaveFields()): HuaweiTLV {
    val config = fields.config
    val gaussSwitch = fields.gaussSwitch
    val timeColours = fields.timeColours
    fun Int?.orElse(fallback: Int): Int = if (this == null || this <= 0) fallback else this
    val known = info.photos.associateBy { it.name }
    val tlv = HuaweiTLV().put(0x01, names.size.toByte())
    if (names.isNotEmpty()) {
      val list = HuaweiTLV()
      names.forEachIndexed { i, name ->
        val slot = known[name]
        val position = slot?.portPosition.orElse(config.timePosition)
        val timeStyle = slot?.timeStyle.orElse(config.timeStyle)
        val entry = HuaweiTLV()
          .put(0x04, i.toByte())
          .put(0x05, name)
          .put(0x0a, position.toByte())
          .put(0x0b, 0.toByte())
          .put(0x0c, timeStyle.toByte())
          .put(0x0d, timeColours[name] ?: slot?.timeColour?.takeIf { it.isNotEmpty() } ?: NO_COLOUR)
          .put(0x0e, slot?.backgroundColour?.takeIf { it.isNotEmpty() } ?: NO_COLOUR)
          .put(0x29, (slot?.timeSize ?: 0).toByte())
        if (gaussSwitch != -1) {
          entry
            .put(0x15, slot?.smartTime.orElse(timeStyle).toByte())
            .put(0x16, slot?.smartFont.orElse(config.font).toByte())
            .put(0x17, slot?.smartPosition.orElse(position).toByte())
            .put(0x1c, gaussSwitch.toByte())
        }
        list.put(0x83, entry)
      }
      tlv.put(0x82, list)
    }
    tlv.put(0x06, config.positionIndex.toByte())
    tlv.put(0x07, config.styleIndex.toByte())
    tlv.put(0x09, (info.dataIndex ?: 0).toByte())
    tlv.put(0x0f, (info.wristSwitch ?: 0).toByte())
    tlv.put(0x10, (info.styleApplyAll ?: 0).toByte())
    if (info.dataSlots.isNotEmpty()) {
      val slots = HuaweiTLV()
      for ((container, option) in info.dataSlots) slots.put(0x92, HuaweiTLV().put(0x13, container.toByte()).put(0x14, option.toByte()))
      tlv.put(0x91, slots)
    }
    tlv.put(0x1c, gaussSwitch.toByte())
    val options = HuaweiTLV()
    for (option in info.selectedOptions.ifEmpty { listOf(0, 0) }) options.put(0x9e, HuaweiTLV().put(0x1f, option.toByte()))
    tlv.put(0x9d, options)
    return tlv
  }

  /**
   * The new-photo values of the photo faces whose `watch_face_config.xml` was read during research (2026-10-25, protocol/README.md,
   * "Photo faces"), by face id. 2180736265 is the Watch Fit 4 Pro's photo face (version 2.4.11).
   */
  val KNOWN_FACE_CONFIGS: Map<String, PhotoFaceConfig> = mapOf(
    "2180736265" to PhotoFaceConfig(
      timePosition = 1, timeStyle = 2, font = 1, positionIndex = 1, styleIndex = 2,
      positionRects = mapOf(
        1 to intArrayOf(68, 18, 406, 182),
        2 to intArrayOf(68, 288, 406, 432),
        3 to intArrayOf(10, 108, 276, 399),
        4 to intArrayOf(236, 108, 456, 399),
        5 to intArrayOf(68, 108, 406, 399),
        6 to intArrayOf(10, 10, 194, 230),
        7 to intArrayOf(214, 10, 398, 230),
        8 to intArrayOf(10, 250, 194, 470),
        9 to intArrayOf(214, 250, 398, 470),
      ),
    ),
  )

  /** [KNOWN_FACE_CONFIGS] for [faceId], else the page's fallbacks (position 1, style 2, font 1, no time area). */
  fun faceConfig(faceId: String): PhotoFaceConfig = KNOWN_FACE_CONFIGS[faceId] ?: PhotoFaceConfig()

  fun parseSaveStatus(tlv: HuaweiTLV): PhotoSaveStatus =
    PhotoSaveStatus(tlv.getAsInteger(0x7f, -1), tlv.getAsInteger(0x08, 0))

  fun parseFileRequest(tlv: HuaweiTLV): PhotoFileRequest? {
    if (!tlv.contains(0x01)) return null
    return PhotoFileRequest(
      name = tlv.getString(0x01),
      // Huawei Health defaults the type to 3 when the watch sends none and the resource type to -1.
      fileType = tlv.getAsInteger(0x02, FILE_TYPE_PHOTO),
      resourceType = tlv.getAsInteger(0x05, -1),
    )
  }

  fun parseReport(tlv: HuaweiTLV): WatchfaceReport = WatchfaceReport(
    id = if (tlv.contains(0x01)) tlv.getString(0x01) else "",
    version = if (tlv.contains(0x02)) tlv.getString(0x02) else "",
    reportType = tlv.getAsInteger(0x03, -1),
    failedNum = tlv.getAsInteger(0x04, 0),
    code = tlv.getAsInteger(0x7f, STATUS_OK),
  )

  /** The `.png` name of a photo: the watch lists and requests `<name>.png`. */
  fun pngName(name: String): String = if (name.endsWith(PNG_SUFFIX)) name else name + PNG_SUFFIX

  /**
   * The bytes Huawei Health sends for a requested photo: for a resource type other than 1 the `.bin` file that goes with the
   * `.png` name, for 1 the PNG itself.
   */
  fun contentFor(request: PhotoFileRequest, png: ByteArray, bin: ByteArray): ByteArray = if (request.resourceType == 1) png else bin
}

/**
 * The `.bin` image the watch takes for a photo: the four bytes `45 23` + format code,
 * width and height as little-endian 16-bit numbers, then the pixels in row order, run-length coded. Three flavours; the watch names
 * the one it wants in tag 0x0b of 27/08.
 */
internal object PhotoBin {
  enum class Format(val option: Int, val code: Int) {
    /** Option 0 (anything but 1 and 2): 32-bit pixels, little-endian ARGB ints. */
    ARGB32(0, 0x8888),

    /** Option 1: 24-bit pixels (blue, green, red). */
    RGB24(1, 0x8808),

    /** Option 2: RGB565, two pixels to a 32-bit word. */
    RGB565(2, 0x65F5),
    ;

    companion object {
      fun fromOption(option: Int): Format = entries.firstOrNull { it.option == option } ?: ARGB32
    }
  }

  private const val HEADER = 0x4523
  private const val MARKER_32 = 591751049 // 0x23456789
  private const val MARKER_24 = 4548489 // 0x456789

  /** [argb] holds `width * height` pixels as `Bitmap.getPixels` returns them (0xAARRGGBB, row by row). */
  fun encode(argb: IntArray, width: Int, height: Int, format: Format): ByteArray {
    require(argb.size == width * height) { "${argb.size} pixels for ${width}x$height" }
    require(width in 1..0xFFFF && height in 1..0xFFFF) { "size ${width}x$height does not fit the header" }
    val out = ByteArrayOutputStream(argb.size / 2 + 16)
    out.write(HEADER shr 8)
    out.write(HEADER and 0xFF)
    out.write(format.code shr 8)
    out.write(format.code and 0xFF)
    le16(out, width)
    le16(out, height)
    when (format) {
      Format.ARGB32 -> encode32(out, argb)
      Format.RGB24 -> encode24(out, argb)
      Format.RGB565 -> encode565(out, argb)
    }
    return out.toByteArray()
  }

  private fun le16(out: ByteArrayOutputStream, v: Int) {
    out.write(v and 0xFF)
    out.write((v shr 8) and 0xFF)
  }

  private fun le24(out: ByteArrayOutputStream, v: Int) {
    out.write(v and 0xFF)
    out.write((v shr 8) and 0xFF)
    out.write((v shr 16) and 0xFF)
  }

  private fun le32(out: ByteArrayOutputStream, v: Int) {
    out.write(v and 0xFF)
    out.write((v shr 8) and 0xFF)
    out.write((v shr 16) and 0xFF)
    out.write((v shr 24) and 0xFF)
  }

  /** `c(DataOutputStream, int[])`: a run of four or more is `marker, pixel, count`; shorter runs are written out. */
  private fun encode32(out: ByteArrayOutputStream, px: IntArray) {
    var run = 1
    for (i in px.indices) {
      if (i == px.size - 1 || px[i] != px[i + 1]) {
        if (run >= 4) {
          le32(out, MARKER_32)
          le32(out, px[i])
          le32(out, run)
        } else {
          repeat(run) { le32(out, px[i]) }
        }
        run = 1
      } else {
        run++
      }
    }
  }

  /** `b(DataOutputStream, int[])`: as above with three bytes a pixel; a pixel that looks like the marker is always written as a run. */
  private fun encode24(out: ByteArrayOutputStream, px: IntArray) {
    var run = 1
    for (i in px.indices) {
      if (i == px.size - 1 || px[i] != px[i + 1]) {
        if (run >= 4 || (px[i] and 0xFFFFFF) == MARKER_24) {
          le24(out, MARKER_24)
          le24(out, px[i])
          le24(out, run)
        } else {
          repeat(run) { le24(out, px[i]) }
        }
        run = 1
      } else {
        run++
      }
    }
  }

  private fun rgb565(p: Int): Int = (((p shr 19) and 31) shl 11) + (((p shr 10) and 63) shl 5) + ((p shr 3) and 31)

  /**
   * `a(DataOutputStream, int[])`: 16-bit pixels packed in pairs. A lone pixel is written together with the one after it (a zero when it
   * is the last), a run of an odd length gives its last pixel to the next pair, a run of eight or more is
   * `marker, pixel pair, pairs`.
   */
  private fun encode565(out: ByteArrayOutputStream, px: IntArray) {
    fun emit(count: Int, at: Int) {
      when {
        count == 1 -> {
          le16(out, rgb565(px[at]))
          le16(out, if (at < px.size - 1) rgb565(px[at + 1]) else 0)
        }
        count < 8 -> repeat(count) { le16(out, rgb565(px[at])) }
        else -> {
          le32(out, MARKER_32)
          le16(out, rgb565(px[at]))
          le16(out, rgb565(px[at]))
          le32(out, count / 2)
        }
      }
    }
    var i = 0
    var run = 1
    while (i < px.size) {
      if (i == px.size - 1 || px[i] != px[i + 1]) {
        if (run == 1) {
          emit(run, i)
          i++
        } else if (run % 2 != 0) {
          emit(run - 1, i)
          i--
        } else {
          emit(run, i)
        }
        run = 1
      } else {
        run++
      }
      i++
    }
  }
}
