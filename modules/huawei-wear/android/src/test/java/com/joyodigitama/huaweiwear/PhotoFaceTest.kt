package com.joyodigitama.huaweiwear

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.Collections
import kotlinx.coroutines.runBlocking
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.PhotoFace
import nodomain.freeyourgadget.gadgetbridge.util.CheckSums
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * The photo face wire formats and flow. The `.bin` vectors are reference outputs generated outside this repository for the same pixels; they pin
 * the bytes the watch is sent. No Huawei code is part of this project.
 */
class PhotoFaceTest {
  private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it.toInt() and 0xFF) }

  /** The Fit 4 Pro's 27/08 answer after one photo was saved (decrypted, 2026-10-14 23:10:41). */
  private val capturedInfo = (
    "010114020101030102844C854A0601000711313739313939343232393634342E706E670C01020D01000E01010F09233030303030303030" +
      "10092330303030303030301801001901001A01001B01001C01001D01001E01000801020901010A01000B010111010012010093309406150100" +
      "160100940615010016010094061501001601009406150100160100940615010016010094061501001601001701009F0AA003210100A003210100"
    ).chunked(2).map { it.toInt(16).toByte() }.toByteArray()

  private fun px(vararg colours: Long) = IntArray(colours.size) { colours[it].toInt() }

  private class Vector(val format: Int, val pixels: IntArray, val hex: String)

  private fun formatOf(i: Int) = PhotoBin.Format.entries.first { it.option == i }

  // ---- the .bin image ---------------------------------------------------------------------------------------------

  private val vectors = listOf(
      Vector(0, px(0xFFFF0000), "45238888010001000000ffff"),
      Vector(0, px(0xFFFF0000, 0xFF00FF00), "45238888020001000000ffff00ff00ff"),
      Vector(0, px(0xFFFF0000, 0xFF00FF00, 0xFF0000FF), "45238888030001000000ffff00ff00ffff0000ff"),
      Vector(0, px(0xFFFF0000, 0xFFFF0000, 0xFFFF0000), "45238888030001000000ffff0000ffff0000ffff"),
      Vector(0, px(0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFFFF0000), "4523888804000100896745230000ffff04000000"),
      Vector(0, px(0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFFFF0000), "4523888805000100896745230000ffff05000000"),
      Vector(0, px(0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFF00FF00), "4523888806000100896745230000ffff0500000000ff00ff"),
      Vector(0, px(0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFF00FF00, 0xFF0000FF), "452388880a000100896745230000ffff0800000000ff00ffff0000ff"),
      Vector(0, px(0xFFFF0000, 0xFF00FF00, 0xFF0000FF, 0xFFFFFFFF, 0xFF000000, 0xFFFFFF00), "45238888060001000000ffff00ff00ffff0000ffffffffff000000ff00ffffff"),
      Vector(0, px(0xFF456789, 0xFF00FF00, 0xFF456789, 0xFF456789), "4523888804000100896745ff00ff00ff896745ff896745ff"),
      Vector(0, px(0xFF456789, 0xFF456789, 0xFF456789, 0xFF456789, 0xFF456789, 0xFF456789, 0xFF456789, 0xFF456789), "452388880800010089674523896745ff08000000"),
      Vector(0, px(0xFFFF0000, 0xFFFF0000, 0xFF00FF00, 0xFF00FF00, 0xFF00FF00, 0xFF0000FF, 0xFF0000FF, 0xFF0000FF, 0xFF0000FF, 0xFF0000FF, 0xFF0000FF, 0xFF0000FF, 0xFF0000FF, 0xFF0000FF, 0xFF000000), "452388880f0001000000ffff0000ffff00ff00ff00ff00ff00ff00ff89674523ff0000ff09000000000000ff"),
      Vector(0, px(0xFF102030, 0xFF102030, 0xFF405060, 0xFF405060, 0xFF405060, 0xFF405060, 0xFF123456), "4523888807000100302010ff302010ff89674523605040ff04000000563412ff"),
      Vector(1, px(0xFFFF0000), "45238808010001000000ff"),
      Vector(1, px(0xFFFF0000, 0xFF00FF00), "45238808020001000000ff00ff00"),
      Vector(1, px(0xFFFF0000, 0xFF00FF00, 0xFF0000FF), "45238808030001000000ff00ff00ff0000"),
      Vector(1, px(0xFFFF0000, 0xFFFF0000, 0xFFFF0000), "45238808030001000000ff0000ff0000ff"),
      Vector(1, px(0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFFFF0000), "45238808040001008967450000ff040000"),
      Vector(1, px(0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFFFF0000), "45238808050001008967450000ff050000"),
      Vector(1, px(0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFF00FF00), "45238808060001008967450000ff05000000ff00"),
      Vector(1, px(0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFF00FF00, 0xFF0000FF), "452388080a0001008967450000ff08000000ff00ff0000"),
      Vector(1, px(0xFFFF0000, 0xFF00FF00, 0xFF0000FF, 0xFFFFFFFF, 0xFF000000, 0xFFFFFF00), "45238808060001000000ff00ff00ff0000ffffff00000000ffff"),
      Vector(1, px(0xFF456789, 0xFF00FF00, 0xFF456789, 0xFF456789), "452388080400010089674589674501000000ff00896745896745020000"),
      Vector(1, px(0xFF456789, 0xFF456789, 0xFF456789, 0xFF456789, 0xFF456789, 0xFF456789, 0xFF456789, 0xFF456789), "4523880808000100896745896745080000"),
      Vector(1, px(0xFFFF0000, 0xFFFF0000, 0xFF00FF00, 0xFF00FF00, 0xFF00FF00, 0xFF0000FF, 0xFF0000FF, 0xFF0000FF, 0xFF0000FF, 0xFF0000FF, 0xFF0000FF, 0xFF0000FF, 0xFF0000FF, 0xFF0000FF, 0xFF000000), "452388080f0001000000ff0000ff00ff0000ff0000ff00896745ff0000090000000000"),
      Vector(1, px(0xFF102030, 0xFF102030, 0xFF405060, 0xFF405060, 0xFF405060, 0xFF405060, 0xFF123456), "4523880807000100302010302010896745605040040000563412"),
      Vector(2, px(0xFFFF0000), "452365f50100010000f80000"),
      Vector(2, px(0xFFFF0000, 0xFF00FF00), "452365f50200010000f8e007"),
      Vector(2, px(0xFFFF0000, 0xFF00FF00, 0xFF0000FF), "452365f50300010000f8e0071f000000"),
      Vector(2, px(0xFFFF0000, 0xFFFF0000, 0xFFFF0000), "452365f50300010000f800f800f80000"),
      Vector(2, px(0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFFFF0000), "452365f50400010000f800f800f800f8"),
      Vector(2, px(0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFFFF0000), "452365f50500010000f800f800f800f800f80000"),
      Vector(2, px(0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFF00FF00), "452365f50600010000f800f800f800f800f8e007"),
      Vector(2, px(0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFFFF0000, 0xFF00FF00, 0xFF0000FF), "452365f50a0001008967452300f800f804000000e0071f00"),
      Vector(2, px(0xFFFF0000, 0xFF00FF00, 0xFF0000FF, 0xFFFFFFFF, 0xFF000000, 0xFFFFFF00), "452365f50600010000f8e0071f00ffff0000e0ff"),
      Vector(2, px(0xFF456789, 0xFF00FF00, 0xFF456789, 0xFF456789), "452365f5040001003143e00731433143"),
      Vector(2, px(0xFF456789, 0xFF456789, 0xFF456789, 0xFF456789, 0xFF456789, 0xFF456789, 0xFF456789, 0xFF456789), "452365f508000100896745233143314304000000"),
      Vector(2, px(0xFFFF0000, 0xFFFF0000, 0xFF00FF00, 0xFF00FF00, 0xFF00FF00, 0xFF0000FF, 0xFF0000FF, 0xFF0000FF, 0xFF0000FF, 0xFF0000FF, 0xFF0000FF, 0xFF0000FF, 0xFF0000FF, 0xFF0000FF, 0xFF000000), "452365f50f00010000f800f8e007e007e0071f00896745231f001f000400000000000000"),
      Vector(2, px(0xFF102030, 0xFF102030, 0xFF405060, 0xFF405060, 0xFF405060, 0xFF405060, 0xFF123456), "452365f507000100061106118c428c428c428c42aa110000"),
  )

  @Test
  fun binMatchesHuaweiHealthsEncoderOnEveryVector() {
    for (v in vectors) {
      val encoded = PhotoBin.encode(v.pixels, v.pixels.size, 1, formatOf(v.format))
      assertEquals("format ${v.format} pixels ${v.pixels.joinToString { Integer.toHexString(it) }}", v.hex, hex(encoded))
    }
  }

  /** The pattern of the Huawei-encoder run that gave [digests]: flat bands, gradients, runs of 5 and 6, marker-coloured pixels. */
  private fun pattern(w: Int, h: Int): IntArray {
    val p = IntArray(w * h)
    var s = 12345L
    for (y in 0 until h) for (x in 0 until w) {
      val v: Int = when {
        y < 8 -> 0xFF102030L.toInt()
        y < 16 -> (0xFF000000L.toInt()) or ((x * 4) shl 16) or ((y * 5) shl 8) or (x xor y)
        y < 24 -> if (x / 5 % 2 == 0) 0xFFFFFFFFL.toInt() else 0xFF00FF00L.toInt()
        y < 30 -> if (x / 6 % 2 == 0) 0xFFFF0000L.toInt() else 0xFF0000FFL.toInt()
        else -> {
          s = s * 6364136223846793005L + 1442695040888963407L
          val r = (s ushr 60).toInt()
          if (r < 10) 0xFF456789L.toInt() else 0xFF000000L.toInt() or ((s ushr 20) and 0xFFFFFF).toInt()
        }
      }
      p[y * w + x] = v
    }
    return p
  }

  @Test
  fun binMatchesHuaweiHealthsEncoderOnALargerImage() {
    val digests = mapOf(
      0 to Triple(6052, "243f09e390d867ffe5fa74847b6cd9c58d6a5bd9b73eb36799ff84baff564355", PhotoBin.Format.ARGB32),
      1 to Triple(4964, "cfafdf4d3ea082a90dcc7b4a798255959be5c155430d6cd6e998908e5e25d9da", PhotoBin.Format.RGB24),
      2 to Triple(3988, "3dcf296e043da4cbea8ac3da604bb9ca1ad71511bf64a9770d4c1a83f8f0c4c8", PhotoBin.Format.RGB565),
    )
    val pixels = pattern(64, 40)
    for ((option, expected) in digests) {
      val encoded = PhotoBin.encode(pixels, 64, 40, expected.third)
      assertEquals("option $option length", expected.first, encoded.size)
      assertEquals("option $option sha256", expected.second, hex(MessageDigest.getInstance("SHA-256").digest(encoded)))
    }
  }

  @Test
  fun binHeaderCarriesTheFormatAndTheLittleEndianSize() {
    val encoded = PhotoBin.encode(IntArray(408 * 480) { 0xFF112233L.toInt() }, 408, 480, PhotoBin.Format.RGB24)
    // 45 23 88 08, 408 = 0x0198 and 480 = 0x01e0 little endian, then one run: marker 456789, the pixel (blue, green, red), count 195840 = 0x02fd00.
    assertEquals("45238808" + "9801" + "e001" + "896745" + "332211" + "00fd02", hex(encoded))
  }

  @Test
  fun optionPicksTheFormat() {
    assertEquals(PhotoBin.Format.ARGB32, PhotoBin.Format.fromOption(0))
    assertEquals(PhotoBin.Format.RGB24, PhotoBin.Format.fromOption(1))
    assertEquals(PhotoBin.Format.RGB565, PhotoBin.Format.fromOption(2))
    assertEquals("anything else is the 32-bit flavour, as in Huawei Health", PhotoBin.Format.ARGB32, PhotoBin.Format.fromOption(9))
  }

  @Test
  fun aPixelCountThatDoesNotMatchTheSizeIsRefused() {
    try {
      PhotoBin.encode(IntArray(5), 2, 2, PhotoBin.Format.ARGB32)
      fail("expected a refusal")
    } catch (_: IllegalArgumentException) {
    }
  }

  // ---- packets ----------------------------------------------------------------------------------------------------

  private val params = HuaweiPacket.ParamsProvider()

  @Test
  fun infoRequestAsksForTheTagsHuaweiHealthAsksFor() {
    val all = PhotoFace.InfoRequest(params, true, true, true)
    assertEquals(0x27.toByte(), all.serviceId)
    assertEquals(0x08.toByte(), all.commandId)
    assertEquals("0100" + "0200" + "0300" + "0400" + "0c00" + "0d00" + "0800" + "0900" + "0a00", hex(all.getTlv().serialize()))
    assertEquals("0100" + "0200" + "0300" + "0400" + "0c00" + "0d00", hex(PhotoFace.InfoRequest(params, false, false, false).getTlv().serialize()))
    assertEquals("0100" + "0200" + "0300" + "0400" + "0c00" + "0d00" + "0900", hex(PhotoFace.InfoRequest(params, false, true, false).getTlv().serialize()))
  }

  /** The Fit 4 Pro photo face's new-photo values, as in [PhotoFaceCodec.KNOWN_FACE_CONFIGS]: position 1, time style 2, font 1. */
  private val fitConfig = PhotoFaceCodec.faceConfig("2180736265")

  @Test
  fun saveMatchesTheBytesReconstructedFromHuaweiHealthsCapturedAlbumJson() {
    // Huawei Health 17.0.8.300, Fit 4 Pro, 2026-10-25 21:10:47 (after which the watch's "add photo" prompt went away): the watch's 27/08
    // answer before, and the album the page handed to makeNewPhotoInfoCommand. The expected bytes are reconstructed from that captured album
    // JSON via the encoder (not a capture of the 27/09 on the wire):
    // {"backgroundList":[{"backgroundIndex":0,"backgroundName":"20261025211044440.png","smartTimeIndex":2,"timeColor":"#01ffe7d8",
    // "backgroundColor":"#00000000","smartPosIndex":1,"portraitMode":0,"smartFontIndex":1,"timeStyleIndex":2,"portPositionIndex":1}],
    // "dataList":[],"isUseGaussColor":0,"positionIndex":1,"styleApplyAll":0,"styleIndex":2,"valueTypeIndex":0,"wristSwitch":0,
    // "optionSelectedList":[0,0]}
    val before = "01011402010103010284000801020901010A01000B010111010012010093001701009F00".chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    val info = PhotoFaceCodec.parseInfo(HuaweiTLV().parse(before))
    val fields = PhotoSaveFields(fitConfig, PhotoFaceCodec.gaussSwitch(1), mapOf("20261025211044440.png" to PhotoFaceCodec.smartColour(0xFFFFE7D8.toInt())))
    val request = PhotoFace.SaveRequest(params, PhotoFaceCodec.saveTlv(info, listOf("20261025211044440.png"), fields))
    assertEquals(0x09.toByte(), request.commandId)
    assertEquals(
      "010101824a8348040100051532303236313032353231313034343434302e706e670a01010b01000c01020d092330316666653764380e09233030303030303030" +
        "2901001501021601011701011c0100" + "0601010701020901000f0100100100" + "1c0100" + "9d0a9e031f01009e031f0100",
      hex(request.getTlv().serialize()),
    )
  }

  @Test
  fun aPhotoOnTheWatchKeepsItsValuesAndMissingOnesComeFromTheConfig() {
    val info = PhotoFaceCodec.parseInfo(HuaweiTLV().parse(capturedInfo))
    val fields = PhotoSaveFields(fitConfig, 0, mapOf("new.png" to "#01123456"))
    // The listed photo: 0a/0c from the watch's 0c/0e (2, 1), its colours, smart time / position from its style and position because the
    // watch reports 18/1a as 0; the new photo: the config's position 1, style 2, font 1 and its picked colour. Then 06/07 from the
    // config, the watch's 09/0f/10, its six data slots, 1c and the watch's two selected options.
    assertEquals(
      "01010282810283440401000511313739313939343232393634342e706e670a01020b01000c01010d092330303030303030300e09233030303030303030" +
        "2901001501011601011701021c0100" +
        "833a04010105076e65772e706e670a01010b01000c01020d092330313132333435360e092330303030303030302901001501021601011701011c0100" +
        "0601010701020901000f0100100100" + "9130" + "9206130100140100".repeat(6) + "1c0100" + "9d0a" + "9e031f0100".repeat(2),
      hex(PhotoFaceCodec.saveTlv(info, listOf("1791994229644.png", "new.png"), fields).serialize()),
    )
  }

  @Test
  fun withoutTheGaussianTagThereAreNoSmartFieldsAndTheSwitchIsMinusOne() {
    val info = PhotoFaceCodec.parseInfo(HuaweiTLV().parse(capturedInfo))
    val tlv = PhotoFaceCodec.saveTlv(info, emptyList(), PhotoSaveFields(fitConfig, PhotoFaceCodec.gaussSwitch(-1)))
    assertEquals(
      "010100" + "0601010701020901000f0100100100" + "9130" + "9206130100140100".repeat(6) + "1c01ff" + "9d0a" + "9e031f0100".repeat(2),
      hex(tlv.serialize()),
    )
    val one = PhotoFaceCodec.saveTlv(info, listOf("a.png"), PhotoSaveFields(fitConfig, -1)).getObject(0x82).getObject(0x83)
    assertFalse(one.contains(0x15))
    assertFalse(one.contains(0x1c))
  }

  @Test
  fun theSmartColourIsHuaweiHealthsMarkerAndTheRgb() {
    assertEquals("#01ffe7d8", PhotoFaceCodec.smartColour(0xFFFFE7D8.toInt()))
    assertEquals("#01000000", PhotoFaceCodec.smartColour(0xFF000000.toInt()))
    assertEquals(0, PhotoFaceCodec.gaussSwitch(1))
    assertEquals(0, PhotoFaceCodec.gaussSwitch(0))
    assertEquals(-1, PhotoFaceCodec.gaussSwitch(-1))
  }

  @Test
  fun theKnownFaceHasItsValuesAndAnUnknownOneHuaweiHealthsFallbacks() {
    val fit = PhotoFaceCodec.faceConfig("2180736265")
    assertEquals(listOf(1, 2, 1, 1, 2), listOf(fit.timePosition, fit.timeStyle, fit.font, fit.positionIndex, fit.styleIndex))
    assertArrayEquals(intArrayOf(68, 18, 406, 182), fit.positionRects[1])
    assertEquals((1..9).toSet(), fit.positionRects.keys)
    val unknown = PhotoFaceCodec.faceConfig("123")
    assertEquals(listOf(1, 2, 1, 1, 2), listOf(unknown.timePosition, unknown.timeStyle, unknown.font, unknown.positionIndex, unknown.styleIndex))
    assertTrue(unknown.positionRects.isEmpty())
  }

  @Test
  fun fileRequestAnswerEchoesTheRequestAndTheStatus() {
    val answer = PhotoFace.FileRequestAnswer(params, "x.png", 3, 1, 100000)
    assertEquals(0x28.toByte(), answer.serviceId)
    assertEquals(0x01.toByte(), answer.commandId)
    assertEquals("0105782e706e67" + "020103" + "050101" + "7f04000186a0", hex(answer.getTlv().serialize()))
    // No resource type in the request: none in the answer.
    assertEquals("0105782e706e67" + "020103" + "7f04000222e6", hex(PhotoFace.FileRequestAnswer(params, "x.png", 3, -1, 140006).getTlv().serialize()))
  }

  @Test
  fun reportAckEchoesTheFaceAndSaysOk() {
    val ack = PhotoFace.ReportAck(params, "2180736265", "2.4.11")
    assertEquals(0x27.toByte(), ack.serviceId)
    assertEquals(0x05.toByte(), ack.commandId)
    val tlv = ack.getTlv()
    assertEquals("2180736265", tlv.getString(0x01))
    assertEquals("2.4.11", tlv.getString(0x02))
    assertEquals(100000, tlv.getInteger(0x7f))
  }

  // ---- reading the watch's answers ---------------------------------------------------------------------------------

  @Test
  fun infoIsReadFromTheWatchAnswer() {
    val info = PhotoFaceCodec.parseInfo(HuaweiTLV().parse(capturedInfo))
    assertEquals(20, info.maxPhotos)
    assertTrue(info.intellectColour)
    assertEquals(2, info.backgroundType)
    assertEquals(2, info.positionIndex)
    assertEquals(1, info.styleIndex)
    assertEquals(0, info.dataIndex)
    assertEquals(1, info.imageOption)
    assertEquals(listOf("1791994229644.png"), info.photos.map { it.name })
    // 27/09 numbered it 1; the watch reports it from 0.
    assertEquals(listOf(0), info.photos.map { it.index })
    assertEquals(2, info.photos[0].portPosition)
    assertEquals(0, info.photos[0].portraitMode)
  }

  @Test
  fun photosAreOrderedByTheirIndex() {
    val photos = HuaweiTLV()
      .put(0x85, HuaweiTLV().put(0x06, 2.toByte()).put(0x07, "b.png"))
      .put(0x85, HuaweiTLV().put(0x06, 1.toByte()).put(0x07, "a.png"))
    val info = PhotoFaceCodec.parseInfo(HuaweiTLV().parse(HuaweiTLV().put(0x01, 8.toByte()).put(0x84, photos).serialize()))
    assertEquals(listOf("a.png", "b.png"), info.photos.map { it.name })
  }

  @Test
  fun infoWithoutAStructHasNoPhotos() {
    val info = PhotoFaceCodec.parseInfo(HuaweiTLV().put(0x01, 6.toByte()).put(0x03, 0.toByte()))
    assertEquals(6, info.maxPhotos)
    assertEquals(0, info.imageOption)
    assertTrue(info.photos.isEmpty())
  }

  @Test
  fun saveStatusReadsCodeAndTransferCount() {
    val status = PhotoFaceCodec.parseSaveStatus(HuaweiTLV().put(0x08, 2.toByte()).put(0x7f, 100000))
    assertEquals(100000, status.code)
    assertEquals(2, status.transferNum)
    assertEquals(0, PhotoFaceCodec.parseSaveStatus(HuaweiTLV().put(0x7f, 100000)).transferNum)
    assertEquals(-1, PhotoFaceCodec.parseSaveStatus(HuaweiTLV()).code)
  }

  @Test
  fun fileRequestDefaultsLikeHuaweiHealth() {
    val full = PhotoFaceCodec.parseFileRequest(HuaweiTLV().put(0x01, "n.png").put(0x02, 3.toByte()).put(0x05, 1.toByte()))!!
    assertEquals("n.png", full.name)
    assertEquals(3, full.fileType)
    assertEquals(1, full.resourceType)
    val bare = PhotoFaceCodec.parseFileRequest(HuaweiTLV().put(0x01, "n.png"))!!
    assertEquals(3, bare.fileType)
    assertEquals(-1, bare.resourceType)
    assertNull(PhotoFaceCodec.parseFileRequest(HuaweiTLV().put(0x02, 3.toByte())))
  }

  @Test
  fun theFileSentIsThePngOnlyForResourceTypeOne() {
    val png = byteArrayOf(1)
    val bin = byteArrayOf(2)
    assertArrayEquals(png, PhotoFaceCodec.contentFor(PhotoFileRequest("a.png", 3, 1), png, bin))
    assertArrayEquals(bin, PhotoFaceCodec.contentFor(PhotoFileRequest("a.png", 3, -1), png, bin))
    assertArrayEquals(bin, PhotoFaceCodec.contentFor(PhotoFileRequest("a.png", 3, 0), png, bin))
  }

  @Test
  fun reportReadsTypeAndFailedCount() {
    val report = PhotoFaceCodec.parseReport(
      HuaweiTLV().put(0x01, "2180736265").put(0x02, "2.4.11").put(0x03, 4.toByte()).put(0x04, 1.toByte()).put(0x7f, 100000),
    )
    assertEquals("2180736265", report.id)
    assertEquals(4, report.reportType)
    assertEquals(1, report.failedNum)
    assertEquals(100000, report.code)
  }

  @Test
  fun pngNameAddsTheSuffixOnce() {
    assertEquals("a.png", PhotoFaceCodec.pngName("a"))
    assertEquals("a.png", PhotoFaceCodec.pngName("a.png"))
  }

  // ---- the flow against a fake watch ------------------------------------------------------------------------------

  private class Msg(val service: Int, val command: Int, val tlv: HuaweiTLV?, val payload: ByteArray)

  private class RecordingEvents : WearEvents {
    val logs: MutableList<String> = Collections.synchronizedList(ArrayList())
    override fun state(state: LinkState, error: String?) = Unit
    override fun battery(level: Int) = Unit
    override fun syncComplete(summary: SyncSummary) = Unit
    override fun log(direction: LogDirection, serviceId: Int?, commandId: Int?, hex: String?, message: String) {
      logs.add("${direction.wire}: $message")
    }
  }

  private class FakeWatch(private val respond: (Msg) -> List<ByteArray>) : FrameSink {
    lateinit var session: HuaweiSession
    val messages: MutableList<Msg> = Collections.synchronizedList(ArrayList())
    private var pending: ByteArrayOutputStream? = null
    private var pendingService = 0
    private var pendingCommand = 0

    override suspend fun write(frames: List<ByteArray>) {
      for (f in frames) {
        val body: ByteArray
        when (f[3].toInt()) {
          0 -> {
            pendingService = f[4].toInt() and 0xFF
            pendingCommand = f[5].toInt() and 0xFF
            body = f.copyOfRange(6, f.size - 2)
          }
          1 -> {
            pendingService = f[5].toInt() and 0xFF
            pendingCommand = f[6].toInt() and 0xFF
            pending = ByteArrayOutputStream().also { it.write(f, 7, f.size - 9) }
            continue
          }
          2 -> {
            pending!!.write(f, 5, f.size - 7)
            continue
          }
          else -> {
            pending!!.write(f, 5, f.size - 7)
            body = pending!!.toByteArray()
            pending = null
          }
        }
        deliver(pendingService, pendingCommand, body)
      }
    }

    private fun deliver(service: Int, command: Int, body: ByteArray) {
      val msg = if (service == 0x28 && command == 0x06) {
        Msg(service, command, null, HuaweiTLV().parse(body).decryptRaw(session.params))
      } else {
        val tlv = HuaweiTLV().parse(body, 0, body.size)
        if (tlv.contains(0x7C)) tlv.decrypt(session.params)
        Msg(service, command, tlv, body)
      }
      messages.add(msg)
      for (r in respond(msg)) session.onData(r)
    }

    fun all(service: Int, command: Int) = messages.filter { it.service == service && it.command == command }
  }

  private fun tlvFrame(service: Int, command: Int, tlv: HuaweiTLV): ByteArray {
    val inner = byteArrayOf(service.toByte(), command.toByte()) + tlv.serialize()
    val head = ByteBuffer.allocate(4 + inner.size).put(0x5A.toByte()).putShort((inner.size + 1).toShort()).put(0).put(inner).array()
    return head + ByteBuffer.allocate(2).putShort(CheckSums.getCRC16(head, 0x0000).toShort()).array()
  }

  private fun setup(respond: (Msg) -> List<ByteArray>): Triple<FakeWatch, HuaweiSession, RecordingEvents> {
    val events = RecordingEvents()
    val watch = FakeWatch(respond)
    val session = HuaweiSession(watch, events).also { it.params.setSecretKey(ByteArray(16)) }
    watch.session = session
    return Triple(watch, session, events)
  }

  @After
  fun resetCaps() = DeviceCaps.reset()

  /** What the watch's file upload side does for one file: the same dance GB expects, driven by the watch. */
  private class FileSink(val unit: Int = 64, val chunk: Int = 200) {
    var fileId = 5
    var name = ""
    var expected = 0
    var received = ByteArray(0)
    var receivedBytes = 0
    var requestedEnd = 0
    var fileType = -1

    private fun nextRequest(): List<ByteArray> {
      val position = requestedEnd
      val size = minOf(chunk, expected - position)
      requestedEnd = position + size
      return listOf(frame(0x28, 0x05, HuaweiTLV().put(0x02, position).put(0x03, size)))
    }

    fun respond(m: Msg): List<ByteArray>? = when {
      m.service == 0x28 && m.command == 0x02 -> {
        name = m.tlv!!.getString(0x01)
        expected = m.tlv.getInteger(0x02)
        fileType = m.tlv.getByte(0x03).toInt()
        received = ByteArray(expected)
        receivedBytes = 0
        requestedEnd = 0
        listOf(frame(0x28, 0x02, HuaweiTLV().put(0x7f, 100000)), frame(0x28, 0x03, HuaweiTLV().put(0x01, fileId.toByte())))
      }
      m.service == 0x28 && m.command == 0x03 -> listOf(
        frame(
          0x28, 0x04,
          HuaweiTLV().put(0x01, fileId.toByte()).put(0x02, "1.0").put(0x03, 5000).put(0x04, 0).put(0x05, unit).put(0x06, chunk).put(0x07, 10).put(0x08, 0),
        ),
      )
      m.service == 0x28 && m.command == 0x04 -> nextRequest()
      m.service == 0x28 && m.command == 0x06 -> {
        val buffer = ByteBuffer.wrap(m.payload)
        buffer.get()
        buffer.get()
        val position = buffer.getInt()
        val data = ByteArray(buffer.remaining()).also { buffer.get(it) }
        System.arraycopy(data, 0, received, position, data.size)
        receivedBytes += data.size
        when {
          receivedBytes == expected -> listOf(frame(0x28, 0x07, HuaweiTLV().put(0x02, 1.toByte())))
          receivedBytes == requestedEnd -> nextRequest()
          else -> emptyList()
        }
      }
      else -> null
    }

    companion object {
      fun frame(service: Int, command: Int, tlv: HuaweiTLV): ByteArray {
        val inner = byteArrayOf(service.toByte(), command.toByte()) + tlv.serialize()
        val head = ByteBuffer.allocate(4 + inner.size).put(0x5A.toByte()).putShort((inner.size + 1).toShort()).put(0).put(inner).array()
        return head + ByteBuffer.allocate(2).putShort(CheckSums.getCRC16(head, 0x0000).toShort()).array()
      }
    }
  }

  private val face = "2180736265"

  private fun infoTlv(vararg names: String): HuaweiTLV {
    val list = HuaweiTLV()
    names.forEachIndexed { i, n -> list.put(0x85, HuaweiTLV().put(0x06, i.toByte()).put(0x07, n)) }
    val tlv = HuaweiTLV().put(0x01, 8.toByte()).put(0x02, 0.toByte()).put(0x03, 2.toByte()).put(0x08, 1.toByte()).put(0x0b, 1.toByte())
    if (names.isNotEmpty()) tlv.put(0x84, list)
    return tlv
  }

  @Test
  fun readInfoAsksAndParses() = runBlocking {
    val (watch, session, events) = setup {
      if (it.service == 0x27 && it.command == 0x08) listOf(FileSink.frame(0x27, 0x08, infoTlv("a.png"))) else emptyList()
    }
    val info = PhotoFaceOps(session, events, queryMs = 2_000).readInfo()
    assertEquals(8, info.maxPhotos)
    assertEquals(1, info.imageOption)
    assertEquals(listOf("a.png"), info.photos.map { it.name })
    val sent = watch.all(0x27, 0x08).single().tlv!!
    assertTrue(sent.contains(0x08) && sent.contains(0x09) && sent.contains(0x0a))
  }

  @Test
  fun saveWithNothingToTransferEndsAtTheStatus() = runBlocking {
    val (watch, session, events) = setup {
      if (it.service == 0x27 && it.command == 0x09) listOf(FileSink.frame(0x27, 0x09, HuaweiTLV().put(0x08, 0.toByte()).put(0x7f, 100000))) else emptyList()
    }
    val info = PhotoFaceCodec.parseInfo(infoTlv("a.png", "b.png"))
    val result = PhotoFaceOps(session, events, queryMs = 2_000).save(info, listOf("a.png"), emptyMap())
    assertEquals(0, result.transferNum)
    val sent = watch.all(0x27, 0x09).single().tlv!!
    assertEquals(1, sent.getByte(0x01).toInt())
    assertEquals("a.png", sent.getObject(0x82).getObjects(0x83).single().getString(0x05))
    // Huawei Health writes 06 / 07 from the face config (fallbacks 1 / 2 here), not the watch's 08 / 09.
    assertEquals(1, sent.getByte(0x06).toInt())
    assertEquals(2, sent.getByte(0x07).toInt())
    assertTrue("no file traffic", watch.all(0x28, 0x01).isEmpty() && watch.all(0x28, 0x02).isEmpty())
  }

  @Test
  fun saveServesTheFileTheWatchAsksForAndEndsAtTheReport() = runBlocking {
    val png = ByteArray(300) { (it * 3).toByte() }
    val bin = ByteArray(700) { (it * 5 + 1).toByte() }
    val sink = FileSink()
    val (watch, session, events) = setup {
      when {
        it.service == 0x27 && it.command == 0x09 -> listOf(
          FileSink.frame(0x27, 0x09, HuaweiTLV().put(0x08, 1.toByte()).put(0x7f, 100000)),
          // The watch goes on to ask for the new photo.
          FileSink.frame(0x28, 0x01, HuaweiTLV().put(0x01, "new.png").put(0x02, 3.toByte())),
        )
        // The phone's result ack: the watch reports the photos received.
        it.service == 0x28 && it.command == 0x07 -> listOf(
          FileSink.frame(0x27, 0x05, HuaweiTLV().put(0x01, face).put(0x02, "2.4.11").put(0x03, 4.toByte()).put(0x04, 0.toByte()).put(0x7f, 100000)),
        )
        else -> sink.respond(it) ?: emptyList()
      }
    }
    val info = PhotoFaceCodec.parseInfo(infoTlv("a.png"))
    val progress = ArrayList<Pair<Int, Int>>()
    val result = PhotoFaceOps(session, events, queryMs = 2_000, stallMs = 3_000, reportWaitMs = 500)
      .save(info, listOf("a.png", "new.png"), mapOf("new.png" to PhotoFiles(png, bin))) { done, total -> progress.add(done to total) }

    assertEquals(1, result.transferNum)
    assertEquals(0, result.failedNum)
    // The phone answers the request with the status first ...
    val answer = watch.all(0x28, 0x01).single().tlv!!
    assertEquals("new.png", answer.getString(0x01))
    assertEquals(3, answer.getByte(0x02).toInt())
    assertFalse("the watch sent no resource type", answer.contains(0x05))
    assertEquals(100000, answer.getInteger(0x7f))
    // ... then uploads under the requested name as file type 3, the .bin because no resource type said png.
    assertEquals("new.png", sink.name)
    assertEquals(3, sink.fileType)
    assertArrayEquals(bin, sink.received)
    assertEquals(700 to 700, progress.last())
    // The report is acknowledged with the face id and version it carries.
    val ack = watch.all(0x27, 0x05).single().tlv!!
    assertEquals(face, ack.getString(0x01))
    assertEquals("2.4.11", ack.getString(0x02))
    assertEquals(100000, ack.getInteger(0x7f))
  }

  @Test
  fun resourceTypeOneGetsThePng() = runBlocking {
    val png = ByteArray(150) { (it + 9).toByte() }
    val bin = ByteArray(400) { 7 }
    val sink = FileSink()
    val (_, session, events) = setup {
      when {
        it.service == 0x27 && it.command == 0x09 -> listOf(
          FileSink.frame(0x27, 0x09, HuaweiTLV().put(0x08, 1.toByte()).put(0x7f, 100000)),
          FileSink.frame(0x28, 0x01, HuaweiTLV().put(0x01, "p.png").put(0x02, 3.toByte()).put(0x05, 1.toByte())),
        )
        it.service == 0x28 && it.command == 0x07 -> listOf(
          FileSink.frame(0x27, 0x05, HuaweiTLV().put(0x01, face).put(0x02, "2.4.11").put(0x03, 4.toByte()).put(0x04, 0.toByte())),
        )
        else -> sink.respond(it) ?: emptyList()
      }
    }
    PhotoFaceOps(session, events, queryMs = 2_000, stallMs = 3_000, reportWaitMs = 500)
      .save(PhotoFaceCodec.parseInfo(infoTlv()), listOf("p.png"), mapOf("p.png" to PhotoFiles(png, bin)))
    assertArrayEquals(png, sink.received)
  }

  @Test
  fun aFileThisSaveDoesNotHoldIsAnsweredAsMissing() = runBlocking {
    val (watch, session, events) = setup {
      when {
        it.service == 0x27 && it.command == 0x09 -> listOf(
          FileSink.frame(0x27, 0x09, HuaweiTLV().put(0x08, 1.toByte()).put(0x7f, 100000)),
          FileSink.frame(0x28, 0x01, HuaweiTLV().put(0x01, "other.png").put(0x02, 3.toByte())),
        )
        else -> emptyList()
      }
    }
    try {
      PhotoFaceOps(session, events, queryMs = 2_000, stallMs = 800, reportWaitMs = 300)
        .save(PhotoFaceCodec.parseInfo(infoTlv()), listOf("p.png"), mapOf("p.png" to PhotoFiles(ByteArray(1), ByteArray(1))))
      fail("the watch never got its photo")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.TIMEOUT, e.errorCode)
    }
    assertEquals(140006, watch.all(0x28, 0x01).single().tlv!!.getInteger(0x7f))
    assertTrue(watch.all(0x28, 0x02).isEmpty())
  }

  @Test
  fun aRefusedPhotoListIsReportedWithTheStatus() = runBlocking {
    val (_, session, events) = setup {
      if (it.service == 0x27 && it.command == 0x09) listOf(FileSink.frame(0x27, 0x09, HuaweiTLV().put(0x7f, 140004))) else emptyList()
    }
    try {
      PhotoFaceOps(session, events, queryMs = 2_000).save(PhotoFaceCodec.parseInfo(infoTlv()), listOf("p.png"), emptyMap())
      fail("expected a rejection")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.UPLOAD_REJECTED, e.errorCode)
      assertEquals(140004, e.statusCode)
    }
  }
}
