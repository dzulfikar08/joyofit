package com.joyodigitama.huaweiwear

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.util.Collections
import java.util.Random
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlinx.coroutines.runBlocking
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.util.CheckSums
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.Test

/** `.hwt` validation, the resolution gate, and list / set active / delete / install against a fake 0x27 watch. */
class WatchfaceTest {
  private fun zip(vararg entries: Pair<String, ByteArray>): ByteArray {
    val out = ByteArrayOutputStream()
    ZipOutputStream(out).use { z ->
      for ((name, data) in entries) {
        z.putNextEntry(ZipEntry(name))
        z.write(data)
        z.closeEntry()
      }
    }
    return out.toByteArray()
  }

  private fun description(root: String = "HwTheme", screen: String = "HWHD13", bom: Boolean = false): ByteArray {
    val xml = """<?xml version="1.0" encoding="UTF-8"?>
<$root>
  <title>Night Run</title>
  <title-cn>夜跑</title-cn>
  <author>Joyo</author>
  <designer>Joyo</designer>
  <screen>$screen</screen>
  <version>2.1.0</version>
  <font>Roboto</font>
  <font-cn>NotoSans</font-cn>
</$root>"""
    val bytes = xml.toByteArray(Charsets.UTF_8)
    return if (bom) byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()) + bytes else bytes
  }

  private val binary = ByteArray(300) { (it * 5 + 1).toByte() }

  @Test
  fun testAllFixturesParsingAndPreview() {
    val root = java.io.File("../../../packages/hwt/fixtures")
    assumeTrue("packages/hwt/fixtures directory not found", root.exists())
    val files = root.walkTopDown().filter { it.extension == "hwt" }.toList()
    for (f in files) {
      val bytes = f.readBytes()
      val preview = WatchfacePackages.extractPreview(bytes)
      assertNotNull("Preview should be extracted for ${f.name}", preview)
      assertTrue("Preview bytes should not be empty for ${f.name}", preview!!.first.isNotEmpty())
    }
  }
  private fun hwt(screen: String = "HWHD13", nested: Boolean = true, root: String = "HwTheme", bom: Boolean = false): ByteArray {
    val inner = if (nested) zip("watchface.bin" to binary, "other.txt" to byteArrayOf(1)) else binary
    val entry = if (root == "HnTheme") "com.honor.watchface" else "com.huawei.watchface"
    return zip(
      "description.xml" to description(root, screen, bom),
      entry to inner,
      "preview/cover.jpg" to byteArrayOf(9, 9, 9),
    )
  }

  // Package

  @Test
  fun packageYieldsDescriptionAndTheNestedWatchfaceBin() {
    val pkg = WatchfacePackages.parse(hwt())
    assertEquals("Night Run", pkg.description.title)
    assertEquals("夜跑", pkg.description.titleCn)
    assertEquals("Joyo", pkg.description.author)
    assertEquals("HWHD13", pkg.description.screen)
    assertEquals("2.1.0", pkg.description.version)
    assertFalse(pkg.description.isHonor)
    assertArrayEquals(binary, pkg.binary)
    assertArrayEquals(byteArrayOf(9, 9, 9), pkg.preview)
  }

  @Test
  fun olderPackagesHoldTheBinaryDirectly() {
    assertArrayEquals(binary, WatchfacePackages.parse(hwt(nested = false)).binary)
  }

  @Test
  fun aByteOrderMarkInDescriptionIsAccepted() {
    assertEquals("Night Run", WatchfacePackages.parse(hwt(bom = true)).description.title)
  }

  @Test
  fun honorPackagesUseTheirOwnEntry() {
    val pkg = WatchfacePackages.parse(hwt(root = "HnTheme"))
    assertTrue(pkg.description.isHonor)
    assertArrayEquals(binary, pkg.binary)
  }

  @Test
  fun aFileWithoutDescriptionIsNotAWatchface() {
    for (bytes in listOf(zip("a.txt" to byteArrayOf(1)), ByteArray(50) { 7 })) {
      try {
        WatchfacePackages.parse(bytes)
        fail("expected a refusal")
      } catch (e: WearException) {
        assertEquals(ErrorCodes.INVALID_ARGUMENT, e.errorCode)
        assertTrue(e.message!!.contains("description.xml"))
      }
    }
  }

  @Test
  fun aPackageWithoutTheWatchfaceEntryIsRefused() {
    try {
      WatchfacePackages.parse(zip("description.xml" to description()))
      fail("expected a refusal")
    } catch (e: WearException) {
      assertTrue(e.message!!.contains("com.huawei.watchface"))
    }
  }

  @Test
  fun invalidXmlAndUnknownRootsAreRefused() {
    try {
      WatchfacePackages.parseDescription("<HwTheme><title>x".toByteArray())
      fail("expected a refusal")
    } catch (e: WearException) {
      assertTrue(e.message!!.contains("not valid XML"))
    }
    try {
      WatchfacePackages.parseDescription(description(root = "Other"))
      fail("expected a refusal")
    } catch (e: WearException) {
      assertTrue(e.message!!.contains("root element"))
    }
  }

  @Test
  fun resolutionTableMatchesGbAndFit4IsHwhd13() {
    assertEquals("480*408", WatchfaceResolutions.screenByThemeVersion("HWHD13"))
    assertEquals("0x0", WatchfaceResolutions.screenByThemeVersion("NOPE"))
    assertTrue(WatchfaceResolutions.isValid("HWHD13", "480*408"))
    assertFalse(WatchfaceResolutions.isValid("HWHD13", "408*480"))
    assertFalse(WatchfaceResolutions.isValid("NOPE", "480*408"))
    assertEquals(WatchfaceResolutions.FIT4_SCREEN, WatchfaceResolutions.screenByThemeVersion(WatchfaceResolutions.FIT4_THEME_VERSION))
  }

  @Test
  fun resolutionGateUsesTheWatchsHeightAndWidth() {
    val face = WatchfacePackages.parse(hwt("HWHD13")).description
    val logs = ArrayList<String>()
    WatchfacePackages.checkResolution(face, height = 480, width = 408) { logs.add(it) }
    assertTrue(logs.isEmpty())
    try {
      WatchfacePackages.checkResolution(WatchfacePackages.parse(hwt("HWHD02")).description, 480, 408) { }
      fail("expected a refusal")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.INVALID_ARGUMENT, e.errorCode)
      assertTrue(e.message!!.contains("454*454"))
      assertTrue(e.message!!.contains("480*408"))
    }
    // A theme version GB does not know is left to the watch.
    WatchfacePackages.checkResolution(WatchfacePackages.parse(hwt("HWHD99")).description, 480, 408) { logs.add(it) }
    assertTrue(logs.single().contains("not in GB's resolution table"))
  }

  @Test
  fun randomNameKeepsTheFacesOwnVersion() {
    val name = WatchfacePackages.randomName(Random(1), "2.8.2")
    assertTrue(name, Regex("^\\d{9}_2\\.8\\.2$").matches(name))
  }

  @Test
  fun randomNameFallsBackToAHuaweiHealthStyleVersion() {
    for (version in listOf(null, "", "abc", "2", "2.x", "2_1", "2.1 beta")) {
      val name = WatchfacePackages.randomName(Random(7), version)
      assertTrue(name, Regex("^\\d{9}_(10|[1-9])\\.(10|[1-9])\\.(10|[1-9])$").matches(name))
    }
  }

  @Test
  fun randomVersionStaysInOneToTen() {
    val random = Random(3)
    repeat(500) {
      val parts = WatchfacePackages.randomVersion(random).split('.').map { it.toInt() }
      assertEquals(3, parts.size)
      assertTrue(parts.all { it in 1..10 })
    }
  }

  private fun faceVersion(version: String) = WatchfaceDescription("t", "", "a", "d", "HWHD13", version, "", "", false)

  @Test
  fun versionGateFollowsHuaweiHealthMajorEqualAndMinorNotAbove() {
    val logs = ArrayList<String>()
    val others = "2.1,2.2,2.3,2.4,2.5,2.6,2.7,2.8,2.9,2.10"
    for (ok in listOf("2.1.1", "2.8.2", "2.10.5", "2.10")) {
      WatchfacePackages.checkVersion(faceVersion(ok), "2.10", others) { logs.add(it) }
    }
    assertTrue(logs.isEmpty())
    for (bad in listOf("1.0.0", "2.11.0", "3.1.0")) {
      try {
        WatchfacePackages.checkVersion(faceVersion(bad), "2.10", others) { }
        fail("expected a refusal for $bad")
      } catch (e: WearException) {
        assertEquals(ErrorCodes.INVALID_ARGUMENT, e.errorCode)
        assertTrue(e.message!!.contains("up to 2.10"))
      }
    }
  }

  @Test
  fun versionGateAcceptsAnOtherVersionTheWatchLists() {
    WatchfacePackages.checkVersion(faceVersion("1.5.0"), "2.10", "1.5,2.1") { }
  }

  @Test
  fun versionGateLeavesUnreadableVersionsToTheWatch() {
    val logs = ArrayList<String>()
    WatchfacePackages.checkVersion(faceVersion(""), "2.10", "") { logs.add(it) }
    WatchfacePackages.checkVersion(faceVersion("2.1.0"), "weird", "") { logs.add(it) }
    assertEquals(2, logs.size)
    assertTrue(logs.all { it.contains("not checked") })
  }

  // Fake 0x27 watch

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

  private fun frame(service: Int, command: Int, body: ByteArray): ByteArray {
    val inner = byteArrayOf(service.toByte(), command.toByte()) + body
    val head = ByteBuffer.allocate(4 + inner.size).put(0x5A.toByte()).putShort((inner.size + 1).toShort()).put(0).put(inner).array()
    return head + ByteBuffer.allocate(2).putShort(CheckSums.getCRC16(head, 0x0000).toShort()).array()
  }

  private fun tlvFrame(service: Int, command: Int, tlv: HuaweiTLV) = frame(service, command, tlv.serialize())

  private class Face(val id: String, val version: String, val name: String, var type: Int)

  /** A watch with a face list. The upload is accepted and appended unless [dropUploads]. */
  private inner class WatchSim(
    val faces: MutableList<Face> = mutableListOf(Face("1000", "1.0.0", "Factory", 0b11), Face("2000", "1.2.0", "Mine", 0)),
    val width: Int = 408,
    val height: Int = 480,
    val dropUploads: Boolean = false,
    val ignoreOperations: Boolean = false,
    val answerNames: Boolean = true,
    /** 0x7f of the answer to a 27/03 that names a face the watch does not have; null leaves the tag out. */
    val announceCode: Int? = 100000,
    /** Tag 0x04 of that answer; null leaves it out. */
    val needReceive: Int? = 1,
    /** The watch does not answer a 27/03 that names a face it does not have. */
    val silentAnnounce: Boolean = false,
    /** Tag 0x11 of the params answer; null leaves it out. */
    val capability: Int? = null,
    /** The watch sends no 27/05 after the upload. */
    val confirm: Boolean = true,
    /** The watch reports the uploaded face deleted (27/05 type 3) right behind the confirmation and does not keep it. */
    val removeAfterConfirm: Boolean = false,
    /** 0x7f of the answer to an activation of the uploaded face (after the upload); null answers like an announcement. */
    val rejectActivation: Int? = null,
  ) : FrameSink {
    lateinit var session: HuaweiSession
    val messages: MutableList<Msg> = Collections.synchronizedList(ArrayList())
    private var uploadName = ""
    private var received = 0
    private var uploadSize = 0
    private var requestedEnd = 0
    private val unit = 100
    private val chunk = 250

    override suspend fun write(frames: List<ByteArray>) {
      for (f in frames) {
        val service = f[4].toInt() and 0xFF
        val command = f[5].toInt() and 0xFF
        val body = f.copyOfRange(6, f.size - 2)
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
    }

    fun all(service: Int, command: Int) = messages.filter { it.service == service && it.command == command }

    private fun nextRequest(): List<ByteArray> {
      val position = requestedEnd
      val size = minOf(chunk, uploadSize - position)
      requestedEnd = position + size
      return listOf(tlvFrame(0x28, 0x05, HuaweiTLV().put(0x02, position).put(0x03, size)))
    }

    private fun respond(m: Msg): List<ByteArray> = when {
      m.service == 0x27 && m.command == 0x01 -> {
        val params = HuaweiTLV()
          .put(0x01, "2.10").put(0x02, width).put(0x03, height).put(0x04, 1.toByte()).put(0x05, 0.toByte())
          .put(0x06, "2.1,2.2,2.3,2.4,2.5,2.6,2.7,2.8,2.9,2.10")
        if (capability != null) params.put(0x11, capability)
        listOf(tlvFrame(0x27, 0x01, params))
      }
      m.service == 0x27 && m.command == 0x02 -> {
        val list = HuaweiTLV()
        for (face in faces) {
          list.put(0x82, HuaweiTLV().put(0x03, face.id).put(0x04, face.version).put(0x05, face.type.toByte()))
        }
        listOf(tlvFrame(0x27, 0x02, HuaweiTLV().put(0x81, list)))
      }
      m.service == 0x27 && m.command == 0x06 ->
        if (!answerNames) {
          emptyList()
        } else {
          val names = HuaweiTLV()
          for (face in faces) names.put(0x83, HuaweiTLV().put(0x04, face.id).put(0x05, face.name))
          listOf(tlvFrame(0x27, 0x06, HuaweiTLV().put(0x82, names)))
        }
      m.service == 0x27 && m.command == 0x03 -> {
        val id = m.tlv!!.getString(0x01)
        val version = m.tlv.getString(0x02)
        val op = m.tlv.getByte(0x03).toInt()
        val known = faces.any { it.id == id && it.version == version }
        if (op == 1 && !known) {
          // Announcement of a face the watch does not have: nothing changes, the watch only answers.
          if (silentAnnounce) {
            emptyList()
          } else {
            val answer = HuaweiTLV().put(0x01, id).put(0x02, version)
            if (needReceive != null) answer.put(0x04, needReceive.toByte())
            val code = if (uploadName.isNotEmpty() && rejectActivation != null) rejectActivation else announceCode
            if (code != null) answer.put(0x7f, code)
            listOf(tlvFrame(0x27, 0x03, answer))
          }
        } else {
          if (!ignoreOperations) {
            if (op == 1) {
              faces.forEach { it.type = it.type and 1.inv() }
              faces.firstOrNull { it.id == id && it.version == version }?.let { it.type = it.type or 1 }
            } else if (op == 2) {
              faces.removeAll { it.id == id }
            }
          }
          listOf(tlvFrame(0x27, 0x03, HuaweiTLV().put(0x7f, 100000)))
        }
      }
      m.service == 0x28 && m.command == 0x02 -> {
        uploadName = m.tlv!!.getString(0x01)
        uploadSize = m.tlv.getInteger(0x02)
        listOf(
          tlvFrame(0x28, 0x02, HuaweiTLV().put(0x7f, 100000)),
          tlvFrame(0x28, 0x03, HuaweiTLV().put(0x01, 4.toByte())),
        )
      }
      m.service == 0x28 && m.command == 0x03 -> listOf(
        tlvFrame(
          0x28,
          0x04,
          HuaweiTLV().put(0x01, 4.toByte()).put(0x02, "1.0").put(0x03, 5000).put(0x04, 0).put(0x05, unit).put(0x06, chunk).put(0x07, 10).put(0x08, 0),
        ),
      )
      m.service == 0x28 && m.command == 0x04 -> nextRequest()
      m.service == 0x28 && m.command == 0x06 -> {
        received += m.payload.size - 6
        when {
          received == uploadSize -> listOf(tlvFrame(0x28, 0x07, HuaweiTLV().put(0x02, 0.toByte())))
          received == requestedEnd -> nextRequest()
          else -> emptyList()
        }
      }
      m.service == 0x28 && m.command == 0x07 -> {
        if (!dropUploads && !removeAfterConfirm) {
          val id = uploadName.substringBefore('_')
          faces.add(Face(id, uploadName.substringAfter('_'), "Night Run", 0))
        }
        val id = uploadName.substringBefore('_')
        val version = uploadName.substringAfter('_')
        if (!confirm) {
          emptyList()
        } else {
          val frames = arrayListOf(tlvFrame(0x27, 0x05, HuaweiTLV().put(0x01, id).put(0x02, version).put(0x03, 2)))
          if (removeAfterConfirm) frames.add(tlvFrame(0x27, 0x05, HuaweiTLV().put(0x01, id).put(0x02, version).put(0x03, 3).put(0x04, 0.toByte())))
          frames
        }
      }
      else -> emptyList()
    }
  }

  private fun setup(watch: WatchSim = WatchSim()): Triple<WatchSim, WatchfaceOps, RecordingEvents> {
    val events = RecordingEvents()
    val session = HuaweiSession(watch, events).also { it.params.setSecretKey(ByteArray(16)) }
    watch.session = session
    DeviceCaps.supportedCommands = mapOf(0x27 to byteArrayOf(1, 2, 3, 5, 6))
    return Triple(watch, WatchfaceOps(session, events, uploadStallMs = 2_000, confirmWaitMs = 500, settleMs = 200, queryMs = 400), events)
  }

  @After
  fun resetCaps() = DeviceCaps.reset()

  // Ops

  @Test
  fun listReadsParamsFacesAndNames() = runBlocking {
    val (watch, ops, events) = setup()

    val list = ops.list()

    assertEquals(408, list.screen!!.width)
    assertEquals(480, list.screen!!.height)
    assertEquals("2.10", list.screen!!.maxVersion)
    assertEquals("2.1,2.2,2.3,2.4,2.5,2.6,2.7,2.8,2.9,2.10", list.screen!!.otherVersions)
    assertFalse(list.screen!!.supportsSignature)
    assertEquals(listOf("1000", "2000"), list.faces.map { it.id })
    assertEquals(listOf("Factory", "Mine"), list.faces.map { it.name })
    assertEquals(listOf(true, false), list.faces.map { it.isFactory })
    assertTrue(list.faces[0].isCurrent)
    assertFalse(list.faces[1].isCurrent)
    // The 27/02 request carries GB's tags; the 27/06 request names every face.
    val names = watch.all(0x27, 0x06).single().tlv!!
    assertEquals(2, names.getObject(0x82).getObjects(0x83).size)
    assertTrue(events.logs.any { it.contains("WatchfaceParams: width=408 height=480") })
    // Every tag the watch sent is logged in the clear, text as text and the rest as hex.
    assertTrue(events.logs.any { it.contains("WatchfaceParams TLV: 01=\"2.10\"") && it.contains("06=\"2.1,2.2") })
    assertTrue(events.logs.any { it.contains("1000_1.0.0") && it.contains("[active]") })
  }

  @Test
  fun listReadsTheCapabilityBitsHuaweiHealthUses() = runBlocking {
    val (_, ops, events) = setup(WatchSim(capability = 0b1100))

    val screen = ops.list().screen!!

    assertEquals(0b1100, screen.supportCapability)
    assertTrue(screen.supportsSignature)
    assertTrue(screen.supportsDialUnite)
    assertTrue(events.logs.any { it.contains("capability=0xc") })
    assertTrue(events.logs.any { it.contains("watch face signature=true") })
  }

  @Test
  fun listWithoutNamesFallsBackToIds() = runBlocking {
    val (_, ops, events) = setup(WatchSim(answerNames = false))
    // A silent names query must not fail the list.
    val list = ops.list()
    assertEquals(listOf("1000", "2000"), list.faces.map { it.name })
    assertTrue(events.logs.any { it.startsWith("error:") && it.contains("WatchfaceNames failed") })
  }

  @Test
  fun paramsAreOnlyRequestedWhenTheWatchListsThem() = runBlocking {
    val (watch, ops, events) = setup()
    DeviceCaps.supportedCommands = mapOf(0x27 to byteArrayOf(2, 3, 6))

    val list = ops.list()

    assertNull(list.screen)
    assertTrue(watch.all(0x27, 0x01).isEmpty())
    assertTrue(events.logs.any { it.contains("GB gate supportsWatchfaceParams") })
  }

  @Test
  fun aWatchWithoutTheServiceIsUnsupported() = runBlocking {
    val (watch, ops, _) = setup()
    DeviceCaps.supportedCommands = mapOf(0x07 to byteArrayOf(1))
    try {
      ops.list()
      fail("expected unsupported")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.UNSUPPORTED, e.errorCode)
    }
    assertTrue(watch.messages.isEmpty())
  }

  @Test
  fun setActiveSendsTheOperationWithTheListedVersionAndChecksTheList() = runBlocking {
    val (watch, ops, _) = setup()

    val list = ops.setActive("2000")

    val op = watch.all(0x27, 0x03).single().tlv!!
    assertEquals("2000", op.getString(0x01))
    assertEquals("1.2.0", op.getString(0x02))
    assertEquals(1, op.getByte(0x03).toInt())
    assertEquals(listOf(false, true), list.faces.map { it.isCurrent })
  }

  @Test
  fun setActiveFailsWhenTheWatchDoesNotSwitch() = runBlocking {
    val (_, ops, _) = setup(WatchSim(ignoreOperations = true))
    try {
      ops.setActive("2000")
      fail("expected a refusal")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.UPLOAD_REJECTED, e.errorCode)
      assertEquals(100000, e.statusCode)
      assertTrue(e.message!!.contains("did not make"))
    }
  }

  @Test
  fun applySendsOperationOneForTheListedFaceEvenWhenItIsCurrentAndListsNothing() = runBlocking {
    val (watch, ops, _) = setup()
    val current = ops.list().faces.single { it.isCurrent }
    val listsBefore = watch.all(0x27, 0x02).size

    val code = ops.apply(current)

    assertEquals(100000, code)
    val op = watch.all(0x27, 0x03).single().tlv!!
    assertEquals("1000", op.getString(0x01))
    assertEquals("1.0.0", op.getString(0x02))
    assertEquals(1, op.getByte(0x03).toInt())
    assertEquals(listsBefore, watch.all(0x27, 0x02).size)
  }

  @Test
  fun theApplyAfterAPhotoSaveIsHuaweiHealthsOperateCommand() {
    // OperateWatchFaceService.buildOperateCommandUtil("2180736265", "2.4.11", -1, 1): 01 id, 02 version, 03 = 1, no instance tag.
    val packet = watchfaceOperationPacket(HuaweiSession(object : FrameSink {
      override suspend fun write(frames: List<ByteArray>) = Unit
    }, RecordingEvents()).params, "2180736265", "2.4.11", 1)
    val expected = byteArrayOf(0x01, 0x0a) + "2180736265".toByteArray() + byteArrayOf(0x02, 0x06) + "2.4.11".toByteArray() +
      byteArrayOf(0x03, 0x01, 0x01)
    assertArrayEquals(expected, packet.getTlv().serialize())
  }

  @Test
  fun anOperationAnsweredWithZeroOrNoStatusIsAccepted() {
    // WatchFaceWearService.isSuccessErrorCode: 0 or 100000; the Fit 4 Pro answers the photo face apply with 0.
    assertTrue(operationAccepted(0))
    assertTrue(operationAccepted(100000))
    assertTrue(operationAccepted(null))
    assertFalse(operationAccepted(140004))
    assertFalse(operationAccepted(100007))
  }

  @Test
  fun deleteSendsOperationTwoAndChecksTheFaceIsGone() = runBlocking {
    val (watch, ops, _) = setup()

    val list = ops.delete("2000")

    assertEquals(2, watch.all(0x27, 0x03).single().tlv!!.getByte(0x03).toInt())
    assertEquals(listOf("1000"), list.faces.map { it.id })
  }

  @Test
  fun deleteFailsWhenTheFaceStaysOnTheWatch() = runBlocking {
    val (_, ops, _) = setup(WatchSim(ignoreOperations = true))
    try {
      ops.delete("2000")
      fail("expected a refusal")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.UPLOAD_REJECTED, e.errorCode)
    }
  }

  @Test
  fun operationOnAnUnknownIdIsRejectedBeforeAnythingIsSent() = runBlocking {
    val (watch, ops, _) = setup()
    try {
      ops.delete("999")
      fail("expected a refusal")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.INVALID_ARGUMENT, e.errorCode)
    }
    assertTrue(watch.all(0x27, 0x03).isEmpty())
  }

  @Test
  fun aFaceWithoutAVersionStillGetsAnOperation() {
    val packet = watchfaceOperationPacket(HuaweiSession(object : FrameSink {
      override suspend fun write(frames: List<ByteArray>) = Unit
    }, RecordingEvents()).params, "123_", 1)
    assertEquals("123", packet.getTlv().getString(0x01))
    assertEquals("", packet.getTlv().getString(0x02))
    assertEquals(0x27, packet.serviceId.toInt())
    assertEquals(0x03, packet.commandId.toInt())
  }

  // Install

  @Test
  fun installUploadsTheBinaryAndReportsTheNewFace() = runBlocking {
    val (watch, ops, events) = setup()
    val progress = ArrayList<Pair<Int, Int>>()

    val result = ops.install(WatchfacePackages.parse(hwt()), { done, total -> progress.add(done to total) }, "123456789_1.0.0")

    val info = watch.all(0x28, 0x02).single().tlv!!
    assertEquals("123456789_1.0.0", info.getString(0x01))
    assertEquals(binary.size, info.getInteger(0x02))
    assertEquals(1, info.getByte(0x03).toInt())
    assertTrue(result.listed)
    assertEquals("123456789", result.id)
    assertEquals("Night Run", result.name)
    assertEquals(binary.size, result.bytes)
    assertEquals(0, result.uploadStatus)
    assertEquals(2, result.confirmReportType)
    // The announcement first, then reportType 2: the phone asked for the face to become active and this watch did it.
    assertEquals(2, watch.all(0x27, 0x03).size)
    assertTrue(result.active)
    assertEquals("Installed and active.", result.message)
    assertEquals(binary.size to binary.size, progress.last())
    assertEquals(0 to binary.size, progress.first())
    assertTrue(events.logs.any { it.contains("Install result: ") })
    assertEquals(listOf("1000", "2000", "123456789"), result.list!!.faces.map { it.id })
  }

  @Test
  fun installRefusesAFaceForAnotherScreenBeforeSendingAnything() = runBlocking {
    val (watch, ops, _) = setup()
    try {
      ops.install(WatchfacePackages.parse(hwt("HWHD02")), { _, _ -> }, "1_1.0.0")
      fail("expected a refusal")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.INVALID_ARGUMENT, e.errorCode)
    }
    assertTrue(watch.all(0x28, 0x02).isEmpty())
  }

  @Test
  fun installWithoutKnownScreenSkipsTheCheckButStillUploads() = runBlocking {
    val (watch, ops, events) = setup()
    DeviceCaps.supportedCommands = mapOf(0x27 to byteArrayOf(2, 3, 6))

    val result = ops.install(WatchfacePackages.parse(hwt("HWHD02")), { _, _ -> }, "1_1.0.0")

    assertTrue(result.listed)
    assertEquals(1, watch.all(0x28, 0x02).size)
    assertTrue(events.logs.any { it.contains("screen size is unknown") })
  }

  @Test
  fun anUploadTheWatchDropsIsReportedAsNotListed() = runBlocking {
    val (_, ops, _) = setup(WatchSim(dropUploads = true))

    val result = ops.install(WatchfacePackages.parse(hwt()), { _, _ -> }, "77_1.0.0")

    assertFalse(result.listed)
    assertFalse(result.active)
    assertNotNull(result.list)
    assertTrue(result.message.contains("does not list the new face"))
    assertEquals(0, result.uploadStatus)
  }

  @Test
  fun installFailureCarriesTheWatchsExactCode() = runBlocking {
    val events = RecordingEvents()
    val sim = WatchSim()
    val rejecting = object : FrameSink {
      override suspend fun write(frames: List<ByteArray>) {
        val f = frames.first()
        if ((f[4].toInt() and 0xFF) == 0x28 && (f[5].toInt() and 0xFF) == 0x02) {
          sim.session.onData(tlvFrame(0x28, 0x02, HuaweiTLV().put(0x7f, 140008)))
        } else {
          sim.write(frames)
        }
      }
    }
    val session = HuaweiSession(rejecting, events).also { it.params.setSecretKey(ByteArray(16)) }
    sim.session = session
    DeviceCaps.supportedCommands = mapOf(0x27 to byteArrayOf(1, 2, 3, 5, 6))
    val ops = WatchfaceOps(session, events, uploadStallMs = 1_000, confirmWaitMs = 100, settleMs = 100, queryMs = 400)

    try {
      ops.install(WatchfacePackages.parse(hwt()), { _, _ -> }, "5_1.0.0")
      fail("expected a rejection")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.UPLOAD_REJECTED, e.errorCode)
      assertEquals(140008, e.statusCode)
    }
  }

  // Install: Huawei Health's announcement (27/03) before the upload

  private fun index(watch: WatchSim, service: Int, command: Int) =
    watch.messages.indexOfFirst { it.service == service && it.command == command }

  @Test
  fun installAnnouncesTheFaceWithTheOperationBeforeAnythingIsUploaded() = runBlocking {
    val (watch, ops, events) = setup()

    ops.install(WatchfacePackages.parse(hwt()), { _, _ -> }, "123456789_2.1.0")

    assertTrue("27/03 comes before 28/02", index(watch, 0x27, 0x03) in 0 until index(watch, 0x28, 0x02))
    val announce = watch.all(0x27, 0x03).first().tlv!!
    assertEquals("123456789", announce.getString(0x01))
    assertEquals("2.1.0", announce.getString(0x02))
    assertEquals(1, announce.getByte(0x03).toInt())
    assertEquals(listOf(0x01, 0x02, 0x03), announce.get().map { it.tag.toInt() })
    assertTrue(events.logs.any { it.contains("announce 123456789_2.1.0 TLV before encryption: 01=\"123456789\" 02=\"2.1.0\" 03=01") })
    assertTrue(events.logs.any { it.contains("watch answered status=100000 needReceive=1") })
    // The file info that follows carries the name, size, type and the two watch face tags, in the clear in the log.
    assertTrue(events.logs.any { it.contains("FileInfoSend TLV before encryption: 01=\"123456789_2.1.0\"") && it.contains("05=\"123456789\" 06=\"2.1.0\"") })
  }

  @Test
  fun installSendsTheSignatureOnlyInTheAnnouncement() = runBlocking {
    val (watch, ops, _) = setup()

    ops.install(WatchfacePackages.parse(hwt()), { _, _ -> }, "123456789_2.1.0", "captured-signature")

    val operations = watch.all(0x27, 0x03)
    val announce = operations.first().tlv!!
    assertEquals("captured-signature", announce.getString(0x08))
    // Huawei Health signs the announcement; the activation that follows 27/05 type 2 carries no signature.
    val activation = operations.last().tlv!!
    assertEquals(1, activation.getByte(0x03).toInt())
    assertEquals(listOf(0x01, 0x02, 0x03), activation.get().map { it.tag.toInt() })
  }

  @Test
  fun installNamesTheFaceAfterItsOwnVersionByDefault() = runBlocking {
    val (watch, ops, _) = setup()

    val result = ops.install(WatchfacePackages.parse(hwt()), { _, _ -> })

    val name = watch.all(0x28, 0x02).single().tlv!!.getString(0x01)
    assertTrue(name, Regex("^\\d{9}_2\\.1\\.0$").matches(name))
    assertEquals("2.1.0", result.version)
  }

  @Test
  fun installStopsWhenTheWatchRefusesTheAnnouncement() = runBlocking {
    val (watch, ops, _) = setup(WatchSim(announceCode = 100014, needReceive = null, capability = 8))

    try {
      ops.install(WatchfacePackages.parse(hwt()), { _, _ -> }, "123456789_2.1.0")
      fail("expected a refusal")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.UPLOAD_REJECTED, e.errorCode)
      assertEquals(100014, e.statusCode)
      assertTrue(e.message!!.contains("signature"))
    }
    assertTrue("nothing was uploaded", watch.all(0x28, 0x02).isEmpty())
  }

  @Test
  fun anAnnouncementCodeOfNoteIsDescribedWithoutInventingAMeaning() {
    assertTrue(describeAnnounceCode(100007).contains("signature failure"))
    assertTrue(describeAnnounceCode(100015).contains("not documented"))
    assertTrue(describeAnnounceCode(4242).contains("4242"))
    assertTrue(describeAnnounceCode(4242).contains("not documented"))
  }

  @Test
  fun anAnswerWithoutStatusOrNeedReceiveMeansUpload() = runBlocking {
    val (watch, ops, _) = setup(WatchSim(announceCode = null, needReceive = null))

    val result = ops.install(WatchfacePackages.parse(hwt()), { _, _ -> }, "55_2.1.0")

    assertEquals(1, watch.all(0x28, 0x02).size)
    assertTrue(result.listed)
  }

  @Test
  fun installUploadsNothingWhenTheWatchHasTheFaceAlready() = runBlocking {
    val (watch, ops, events) = setup(WatchSim(needReceive = 0))

    val result = ops.install(WatchfacePackages.parse(hwt()), { _, _ -> }, "66_2.1.0")

    assertTrue(watch.all(0x28, 0x02).isEmpty())
    assertNull(result.uploadStatus)
    assertNull(result.confirmReportType)
    assertFalse("the sim only knows the face after an upload", result.listed)
    assertTrue(events.logs.any { it.contains("needReceive=0") && it.contains("nothing is uploaded") })
  }

  @Test
  fun installUploadsAnywayWhenTheAnnouncementIsNotAnswered() = runBlocking {
    val (watch, ops, events) = setup(WatchSim(silentAnnounce = true))

    val result = ops.install(WatchfacePackages.parse(hwt()), { _, _ -> }, "88_2.1.0")

    assertEquals(1, watch.all(0x28, 0x02).size)
    assertTrue(result.listed)
    assertTrue(events.logs.any { it.contains("no answer from the watch") })
  }

  @Test
  fun installRefusesAFaceTheWatchsVersionRangeDoesNotCover() = runBlocking {
    val (watch, ops, _) = setup()
    val old = WatchfacePackages.parse(hwt()).let { WatchfacePackage(WatchfaceDescription("t", "", "a", "d", "HWHD13", "1.0.0", "", "", false), it.binary, null) }

    try {
      ops.install(old, { _, _ -> }, "9_1.0.0")
      fail("expected a refusal")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.INVALID_ARGUMENT, e.errorCode)
    }
    assertTrue("not announced either", watch.all(0x27, 0x03).isEmpty())
    assertTrue(watch.all(0x28, 0x02).isEmpty())
  }

  @Test
  fun aMissingConfirmationOnASignatureCapableWatchIsExplained() = runBlocking {
    val (_, ops, _) = setup(WatchSim(dropUploads = true, confirm = false, capability = 8))

    val result = ops.install(WatchfacePackages.parse(hwt()), { _, _ -> }, "77_2.1.0")

    assertFalse(result.listed)
    assertNull(result.confirmReportType)
    assertTrue(result.message.contains("sent no install confirmation (27/05)"))
    assertTrue(result.message.contains("signature capability"))
  }

  @Test
  fun aMissingConfirmationOnAWatchWithoutTheCapabilityDoesNotBlameTheSignature() = runBlocking {
    val (_, ops, _) = setup(WatchSim(dropUploads = true, confirm = false))

    val result = ops.install(WatchfacePackages.parse(hwt()), { _, _ -> }, "77_2.1.0")

    assertTrue(result.message.contains("sent no install confirmation (27/05)"))
    assertFalse(result.message.contains("signature"))
  }

  // The behaviour seen on a Watch Fit 4 Pro (capability 0x3d): the unsigned face is confirmed, its activation is
  // refused with 100014, and the watch reports it deleted about 3 s later.

  @Test
  fun aFaceTheWatchDeletesAfterConfirmingItIsReportedWithTheSignatureReason() = runBlocking {
    val (watch, ops, events) = setup(WatchSim(removeAfterConfirm = true, rejectActivation = 100014, capability = 0x3d))

    val result = ops.install(WatchfacePackages.parse(hwt()), { _, _ -> }, "5551_2.1.0")

    assertFalse(result.listed)
    assertFalse(result.active)
    assertEquals(2, result.confirmReportType)
    assertTrue(result.message, result.message.startsWith("The watch received the face and then deleted it"))
    assertTrue(result.message.contains("code 100014"))
    assertTrue(result.message.contains("27/05 type 3"))
    assertTrue(result.message.contains("Huawei-issued signature"))
    assertTrue(events.logs.any { it.contains("the watch reports 5551_2.1.0 deleted") })
    assertTrue(events.logs.any { it.contains("activation status=100014") && it.contains("removed by the watch=true") })
    // The announcement, then the activation the confirmation asks for.
    assertEquals(listOf(1, 1), watch.all(0x27, 0x03).map { it.tlv!!.getByte(0x03).toInt() })
  }

  @Test
  fun aRefusedActivationAloneIsReportedWithTheSignatureReason() = runBlocking {
    val (_, ops, _) = setup(WatchSim(rejectActivation = 100007, dropUploads = true, capability = 0x3d))

    val result = ops.install(WatchfacePackages.parse(hwt()), { _, _ -> }, "5552_2.1.0")

    assertFalse(result.listed)
    assertTrue(result.message, result.message.contains("code 100007"))
    assertFalse(result.message.contains("27/05 type 3"))
  }

  @Test
  fun aKeptFaceIsNotBlamedOnTheSignature() = runBlocking {
    val (_, ops, _) = setup(WatchSim(capability = 0x3d))

    val result = ops.install(WatchfacePackages.parse(hwt()), { _, _ -> }, "5553_2.1.0")

    assertTrue(result.listed)
    assertEquals("Installed and active.", result.message)
  }
  @Test(timeout = 1000)
  fun testRgb565HugeRleCountTerminatesWithoutHanging() {
    val w = 10
    val h = 10
    val data = ByteArrayOutputStream().apply {
      // Magic 0x2345
      write(0x45); write(0x23)
      // Format 0xF565 (RGB565)
      write(0x65); write(0xF5)
      // Width 10, Height 10 (little endian)
      write(w and 0xFF); write((w shr 8) and 0xFF)
      write(h and 0xFF); write((h shr 8) and 0xFF)
      // RLE marker: 0x23456789
      write(0x89); write(0x67); write(0x45); write(0x23)
      // Pixel 1 (white 0xFFFF), Pixel 2 (black 0x0000)
      write(0xFF); write(0xFF)
      write(0x00); write(0x00)
      // Pairs count: 0x7FFFFFFF (2.1 billion pairs)
      write(0xFF); write(0xFF); write(0xFF); write(0x7F)
    }.toByteArray()

    val bmp = WatchfaceBitmapDecoder.decodeBlobToBmp(data, 0, data.size)
    assertNotNull("BMP should decode without hanging or timing out", bmp)
  }
}
