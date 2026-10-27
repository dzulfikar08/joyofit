package com.joyodigitama.huaweiwear

import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.util.Collections
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.MusicControl
import nodomain.freeyourgadget.gadgetbridge.util.CheckSums
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * Songs on the watch: the 25/xx packets against `packetsMusic.json` (written by GoldenGen/GoldenMusic.java from the same Java, and read by
 * PacketsMusicTests.swift), the file checks, and [WatchMusicOps] against a fake watch (info, paging, delete, the upload with its 25/09
 * question, cancellation). Twin: WatchMusicTests.swift.
 */
class WatchMusicTest {
  private val fixture: JSONObject by lazy {
    JSONObject(File("../ios/HuaweiProtocol/Tests/HuaweiProtocolTests/Fixtures/packetsMusic.json").readText())
  }

  private fun hex(s: String): ByteArray = ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
  private fun ByteArray.hexLower() = joinToString("") { "%02x".format(it.toInt() and 0xFF) }

  private fun plainParams() = HuaweiPacket.ParamsProvider().apply { setTransactionsCrypted(false) }

  private fun frame(service: Int, command: Int, body: ByteArray): ByteArray {
    val inner = byteArrayOf(service.toByte(), command.toByte()) + body
    val head = ByteBuffer.allocate(4 + inner.size).put(0x5A.toByte()).putShort((inner.size + 1).toShort()).put(0).put(inner).array()
    return head + ByteBuffer.allocate(2).putShort(CheckSums.getCRC16(head, 0x0000).toShort()).array()
  }

  private fun tlvFrame(service: Int, command: Int, tlv: HuaweiTLV) = frame(service, command, tlv.serialize())

  private fun ids(a: JSONArray) = List(a.length()) { a.getInt(it) }

  // Packets against the golden file

  @Test
  fun requestsMatchTheGoldenFrames() {
    val requests = fixture.getJSONArray("requests")
    assertEquals(12, requests.length())
    for (i in 0 until requests.length()) {
      val c = requests.getJSONObject(i)
      val name = c.getString("name")
      val p = plainParams()
      val packet: HuaweiPacket = when {
        name == "info params" -> MusicControl.MusicInfoParams.Request(p)
        name == "extended info params" -> MusicControl.ExtendedMusicInfoParams.Request(p)
        name.startsWith("list") -> MusicControl.MusicList.Request(p, c.getInt("startFrame").toShort(), c.getInt("endIndex").toShort())
        name.startsWith("delete") -> MusicControl.MusicOperation.Request(p, 4, 0, null, ids(c.getJSONArray("ids")))
        name.startsWith("upload info") ->
          MusicControl.UploadMusicFileInfo.UploadMusicFileInfoResponse(p, c.getInt("songIndex").toShort(), c.getString("title"), c.getString("artist"))
        else -> throw AssertionError("unknown case $name")
      }
      assertEquals(name, c.getInt("service"), packet.serviceId.toInt() and 0xFF)
      assertEquals(name, c.getInt("command"), packet.commandId.toInt() and 0xFF)
      val frames = packet.serialize()
      assertEquals(name, c.getString("tlv"), packet.getTlv().serialize().hexLower())
      val expected = c.getJSONArray("frames")
      assertEquals(name, expected.length(), frames.size)
      for (f in frames.indices) assertEquals(name, expected.getString(f), frames[f].hexLower())
    }
  }

  @Test
  fun responsesParseAsTheGoldenFile() {
    val responses = fixture.getJSONArray("responses")
    assertEquals(18, responses.length())
    for (i in 0 until responses.length()) {
      val c = responses.getJSONObject(i)
      val name = c.getString("name")
      val parsed = try {
        HuaweiPacket(plainParams()).parse(frame(c.getInt("service"), c.getInt("command"), hex(c.getString("tlv")))).also { it.parseTlv() }
      } catch (e: HuaweiPacket.ParseException) {
        assertFalse("$name: Java parsed in the golden run but failed here: $e", c.getBoolean("ok"))
        assertEquals(name, c.getString("exception"), e.javaClass.simpleName)
        continue
      }
      assertTrue("$name: parsed here but failed in the golden run", c.getBoolean("ok"))
      val fields = c.getJSONObject("fields")
      when (parsed) {
        is MusicControl.MusicInfoParams.Response -> {
          assertEquals(name, fields.getInt("frameCount"), parsed.frameCount)
          assertCapabilities(name, fields.getJSONObject("params"), parsed.params)
          assertEquals(name, fields.isNull("pageStruct"), parsed.pageStruct == null)
        }
        is MusicControl.ExtendedMusicInfoParams.Response -> assertCapabilities(name, fields.getJSONObject("params"), parsed.params)
        is MusicControl.MusicList.Response -> {
          val songs = fields.getJSONArray("songs")
          assertEquals(name, songs.length(), parsed.musicList.size)
          for (s in 0 until songs.length()) {
            val e = songs.getJSONObject(s)
            val a = parsed.musicList[s]
            assertEquals(name, e.getInt("id"), a.id)
            assertEquals(name, e.getString("title"), a.title)
            assertEquals(name, e.getString("artist"), a.artist)
            assertEquals(name, e.getString("fileName"), a.fileName)
          }
          assertEquals(name, fields.getInt("endIndex"), parsed.endIndex.toInt())
        }
        is MusicControl.MusicOperation.Response -> {
          assertEquals(name, fields.getInt("resultCode"), parsed.resultCode)
          assertEquals(name, fields.isNull("musicIds"), parsed.musicIds == null)
          if (!fields.isNull("musicIds")) assertEquals(name, ids(fields.getJSONArray("musicIds")), parsed.musicIds)
        }
        is MusicControl.UploadMusicFileInfo.UploadMusicFileInfoRequest -> {
          assertEquals(name, fields.getInt("songIndex"), parsed.songIndex.toInt())
          assertEquals(name, fields.getString("songFileName"), parsed.songFileName)
        }
        else -> fail("$name: unexpected class ${parsed.javaClass}")
      }
    }
  }

  private fun assertCapabilities(name: String, e: JSONObject, a: nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiMusicUtils.MusicCapabilities) {
    assertEquals(name, e.getInt("availableSpace"), a.availableSpace)
    assertEquals(name, e.getInt("maxMusicCount"), a.maxMusicCount)
    assertEquals(name, e.getInt("currentMusicCount"), a.currentMusicCount)
    assertEquals(name, e.getInt("maxPlaylistCount"), a.maxPlaylistCount)
    if (e.isNull("supportedFormats")) assertNull(name, a.supportedFormats)
    else assertEquals(name, List(e.getJSONArray("supportedFormats").length()) { e.getJSONArray("supportedFormats").getString(it) }, a.supportedFormats)
    if (e.isNull("formatsRestrictions")) assertNull(name, a.formatsRestrictions)
    else {
      val list = e.getJSONArray("formatsRestrictions")
      assertEquals(name, list.length(), a.formatsRestrictions.size)
      for (i in 0 until list.length()) {
        assertEquals(name, list.getJSONObject(i).getInt("bitrate"), a.formatsRestrictions[i].bitrate.toInt())
        assertEquals(name, list.getJSONObject(i).getInt("unknownBitrate"), a.formatsRestrictions[i].unknownBitrate.toInt())
      }
    }
  }

  // File checks

  private val mp3Frame = byteArrayOf(0xFF.toByte(), 0xFB.toByte(), 0x90.toByte(), 0x64) + ByteArray(60)
  private val mpeg2Frame = byteArrayOf(0xFF.toByte(), 0xF3.toByte(), 0x90.toByte(), 0x64) + ByteArray(60)
  private val adtsFrame = byteArrayOf(0xFF.toByte(), 0xF1.toByte(), 0x50, 0x80.toByte()) + ByteArray(60)
  private fun id3(body: Int) = byteArrayOf('I'.code.toByte(), 'D'.code.toByte(), '3'.code.toByte(), 4, 0, 0, 0, 0, (body shr 7).toByte(), (body and 0x7F).toByte()) + ByteArray(body)
  private val m4a = byteArrayOf(0, 0, 0, 0x20) + "ftypM4A ".toByteArray(Charsets.ISO_8859_1) + ByteArray(40)
  private fun b(vararg v: Int) = ByteArray(v.size) { v[it].toByte() }
  private fun s(text: String) = text.toByteArray(Charsets.ISO_8859_1)
  // fLaC, STREAMINFO block header, min/max block and frame sizes, then 44100 Hz in 20 bits.
  private val flac = s("fLaC") + b(0x80, 0, 0, 34) + ByteArray(10) + b(0x0A, 0xC4, 0x42) + ByteArray(30)
  // A LIST chunk before fmt: the chunk walk skips it. 48000 Hz.
  private val wav = s("RIFF") + ByteArray(4) + s("WAVE") + s("LIST") + b(3, 0, 0, 0) + b(1, 2, 3, 0) + s("fmt ") + b(16, 0, 0, 0) + b(1, 0, 2, 0, 0x80, 0xBB, 0, 0) + ByteArray(40)
  private fun ogg(packet: ByteArray) = s("OggS") + ByteArray(22) + b(1, packet.size) + packet
  private val opus = ogg(s("OpusHead") + b(1, 2, 0, 0, 0x80, 0xBB, 0, 0) + ByteArray(3))
  private val vorbis = ogg(b(1) + s("vorbis") + b(0, 0, 0, 0, 2, 0x44, 0xAC, 0, 0) + ByteArray(10))
  private val fit4Pro = listOf("mp3", "wav", "aac", "m4a", "flac", "opus")

  private fun info(formats: List<String> = listOf("mp3", "aac", "m4a"), free: Int? = 100) =
    MusicInfo(free, formats, 500, 0, null, 1, emptyList(), false)

  @Test
  fun probesFormatsByContent() {
    assertEquals(SongProbe(SongFormat.MP3, 44100, "MPEG audio frame at 0"), MusicFiles.probe(mp3Frame))
    assertEquals(22050, MusicFiles.probe(mpeg2Frame)?.sampleRate)
    assertEquals(SongFormat.MP3, MusicFiles.probe(id3(300) + mp3Frame)?.format)
    assertEquals(310, MusicFiles.probe(id3(300) + mp3Frame)?.detail?.substringAfterLast(' ')?.toInt())
    assertEquals(SongProbe(SongFormat.AAC, 44100, "ADTS at 0"), MusicFiles.probe(adtsFrame))
    assertEquals(SongFormat.AAC, MusicFiles.probe(id3(20) + adtsFrame)?.format)
    assertEquals(SongFormat.M4A, MusicFiles.probe(m4a)?.format)
    assertEquals(SongProbe(SongFormat.FLAC, 44100, "FLAC stream at 0"), MusicFiles.probe(flac))
    assertEquals(SongProbe(SongFormat.FLAC, 44100, "ID3v2.4 tag of 30 bytes, FLAC stream at 30"), MusicFiles.probe(id3(20) + flac))
    assertEquals(SongProbe(SongFormat.WAV, 48000, "RIFF WAVE, fmt chunk at 24"), MusicFiles.probe(wav))
    assertEquals(SongProbe(SongFormat.WAV, null, "RIFF WAVE without fmt chunk"), MusicFiles.probe(s("RIFF....WAVE")))
    assertEquals(SongProbe(SongFormat.OPUS, 48000, "Ogg Opus"), MusicFiles.probe(opus))
    assertEquals(SongProbe(SongFormat.OGG, 44100, "Ogg Vorbis"), MusicFiles.probe(vorbis))
    assertNull(MusicFiles.probe(ogg(s("FLAC") + ByteArray(20))))
    // MPEG Layer II is not MP3.
    assertNull(MusicFiles.probe(byteArrayOf(0xFF.toByte(), 0xFD.toByte(), 0x90.toByte(), 0x64)))
    assertNull(MusicFiles.probe(ByteArray(0)))
  }

  private fun rejected(name: String, data: ByteArray, info: MusicInfo? = info()): String {
    try {
      MusicFiles.check(name, data, info)
    } catch (e: WearException) {
      assertEquals(ErrorCodes.INVALID_ARGUMENT, e.errorCode)
      return e.message!!
    }
    throw AssertionError("$name was accepted")
  }

  @Test
  fun checksNameContentWatchFormatsAndSpace() {
    assertEquals(SongFormat.MP3, MusicFiles.check("Lari Pagi.MP3", mp3Frame, info()).format)
    assertEquals(SongFormat.M4A, MusicFiles.check("a.m4a", m4a, info()).format)
    assertEquals(SongFormat.AAC, MusicFiles.check("a.aac", adtsFrame, null).format)
    assertTrue(rejected("song.wma", ByteArray(10)).contains("not an MP3, M4A, AAC, FLAC, WAV or Opus"))
    assertTrue(rejected("song.ape", ByteArray(10)).contains("not an MP3"))
    assertTrue(rejected("song", mp3Frame).contains("not an MP3"))
    assertTrue(rejected("empty.mp3", ByteArray(0)).contains("empty"))
    assertTrue(rejected("x.mp3", m4a).contains("rename it to .m4a"))
    assertTrue(rejected("x.mp3", ByteArray(64) { 1 }).contains("does not contain MP3"))
    assertTrue(rejected("x.m4a", m4a, info(formats = listOf("mp3", "aac"))).contains("does not take M4A"))
    assertTrue(rejected("x.mp3", mp3Frame + ByteArray(2 * 1024 * 1024), info(free = 1)).contains("1 MB free"))
    // FLAC, WAV and Opus go when the watch lists them (the Fit 4 Pro's 25/04 list), and are refused when it does not.
    assertEquals(SongFormat.FLAC, MusicFiles.check("a.flac", flac, info(fit4Pro)).format)
    assertEquals(SongFormat.WAV, MusicFiles.check("a.wav", wav, info(fit4Pro)).format)
    assertEquals(SongFormat.OPUS, MusicFiles.check("a.opus", opus, info(fit4Pro)).format)
    assertEquals(SongFormat.OPUS, MusicFiles.check("a.ogg", opus, info(fit4Pro)).format)
    assertEquals("The watch does not take FLAC files (it lists mp3, aac, m4a).", rejected("a.flac", flac))
    assertEquals("The watch does not take WAV files (it lists mp3, aac, m4a).", rejected("a.wav", wav))
    assertEquals("The watch does not take OPUS files (it lists mp3, aac, m4a).", rejected("a.ogg", opus))
    // Ogg Vorbis is not Opus: refused unless the watch lists ogg.
    assertEquals("The watch does not take OGG files (it lists mp3, wav, aac, m4a, flac, opus).", rejected("a.ogg", vorbis, info(fit4Pro)))
    assertEquals("'a.opus' is named .opus but contains OGG audio; rename it to .ogg.", rejected("a.opus", vorbis, info(fit4Pro)))
    assertEquals(SongFormat.OGG, MusicFiles.check("a.ogg", vorbis, info(listOf("ogg"))).format)
    assertEquals("'a.flac' is named .flac but contains WAV audio; rename it to .wav.", rejected("a.flac", wav, info(fit4Pro)))
    // An empty format list (the watch sent no bits) or no free space value does not block the file.
    assertEquals(SongFormat.MP3, MusicFiles.check("x.mp3", mp3Frame, info(formats = emptyList(), free = null)).format)
    assertEquals("Lari Pagi", MusicFiles.titleFallback("Lari Pagi.mp3"))
    assertEquals(".mp3", MusicFiles.titleFallback(".mp3"))
    assertEquals("a b.mp3", MusicFiles.watchFileName("/storage/x/a b.mp3"))
  }

  // WatchMusicOps against a fake watch

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

  /** Decodes what the phone writes (sliced or not) and lets [respond] answer; chunks (28/06) are decrypted into `fileId, index, position, data`. */
  private class FakeWatch(private val respond: (Msg) -> List<ByteArray>) : FrameSink {
    lateinit var session: HuaweiSession
    val messages: MutableList<Msg> = Collections.synchronizedList(ArrayList())
    private var pending: ByteArrayOutputStream? = null
    private var service = 0
    private var command = 0

    override suspend fun write(frames: List<ByteArray>) {
      for (f in frames) {
        val body: ByteArray
        when (f[3].toInt()) {
          0 -> {
            service = f[4].toInt() and 0xFF
            command = f[5].toInt() and 0xFF
            body = f.copyOfRange(6, f.size - 2)
          }
          1 -> {
            service = f[5].toInt() and 0xFF
            command = f[6].toInt() and 0xFF
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
  }

  private fun setup(respond: (Msg) -> List<ByteArray>): Triple<FakeWatch, WatchMusicOps, RecordingEvents> {
    val events = RecordingEvents()
    val watch = FakeWatch(respond)
    val session = HuaweiSession(watch, events).also { it.params.setSecretKey(ByteArray(16)) }
    watch.session = session
    return Triple(watch, WatchMusicOps(session, events, queryMs = 2_000, infoGraceMs = 300, stallMs = 2_000), events)
  }

  private fun song(id: Int, title: String) = HuaweiTLV().put(0x04, id.toShort()).put(0x05, title).put(0x06, "Artist").put(0x07, "$title.mp3")

  private fun page(endIndex: Int, vararg songs: HuaweiTLV): HuaweiTLV {
    val list = HuaweiTLV()
    for (s in songs) list.put(0x83, s)
    return HuaweiTLV().put(0x01, 0.toShort()).put(0x04, endIndex.toShort()).put(0x82, list)
  }

  @Test
  fun infoReadsBothCapabilityAnswers() = runBlocking {
    val (watch, ops, _) = setup { m ->
      when (m.command) {
        0x04 -> listOf(tlvFrame(0x25, 0x04, HuaweiTLV().put(0x01, 3.toShort()).put(0x02, 900).put(0x03, byteArrayOf(0x01)).put(0x04, 300.toShort()).put(0x05, 4.toShort())))
        0x0d -> listOf(
          tlvFrame(
            0x25, 0x0d,
            HuaweiTLV().put(0x01, 800).put(0x02, byteArrayOf(0x85.toByte(), 0x04)).put(0x04, 5.toByte())
              .put(0x86, HuaweiTLV().put(0x87, HuaweiTLV().put(0x08, 0.toByte()).put(0x09, "44100,48000").put(0x0b, 320.toShort()))),
          ),
        )
        else -> emptyList()
      }
    }
    val info = ops.info(extended = true)
    assertEquals(MusicInfo(800, listOf("mp3", "aac", "m4a"), 300, 4, 5, 3, listOf(MusicFormatLimit(0, "mp3", listOf("44100", "48000"), 320, 2)), true), info)
    assertEquals("010002000300", watch.all(0x25, 0x04).single().tlv!!.serialize().hexLower())
    val basicOnly = ops.info(extended = false)
    assertEquals(MusicInfo(900, listOf("mp3"), 300, 4, null, 3, emptyList(), false), basicOnly)
  }

  @Test
  fun listPagesLikeGadgetbridge() = runBlocking {
    val asked = ArrayList<Pair<Int, Int>>()
    val (_, ops, _) = setup { m ->
      if (m.command != 0x05) return@setup emptyList()
      val frame = m.tlv!!.getShort(0x01).toInt()
      asked += frame to (m.tlv.getShort(0x04).toInt() and 0xFFFF)
      when (frame) {
        0 -> listOf(tlvFrame(0x25, 0x05, page(65535, song(1, "A"), song(7, "B"))))
        else -> listOf(tlvFrame(0x25, 0x05, page(7, song(7, "B"))))
      }
    }
    val info = MusicInfo(null, listOf("mp3"), null, null, null, 3, emptyList(), false)
    // Without ExpandCapability 122: a two-song page moves the end index to the second id; a one-song page ends the list.
    val list = ops.list(info, moreMusic = false)
    assertEquals(listOf(0 to 65535, 1 to 7), asked)
    assertEquals(listOf(1, 7), list.songs.map { it.id })
    assertEquals(2, list.pages)

    asked.clear()
    val more = ops.list(info, moreMusic = true)
    assertEquals(listOf(0 to 65535, 1 to 7, 2 to 7), asked)
    assertEquals(3, more.pages)
  }

  @Test
  fun deleteSendsOperationFourOnAllSongs() = runBlocking {
    var code = MusicControl.successValue
    val (watch, ops, _) = setup { m ->
      if (m.command == 0x08) listOf(tlvFrame(0x25, 0x08, HuaweiTLV().put(0x7f, code).put(0x01, 4.toByte()).put(0x04, m.tlv!!.getBytes(0x04)))) else emptyList()
    }
    assertEquals(SongDeleteOutcome(listOf(7, 300), true, 100000), ops.delete(listOf(7, 300)))
    val sent = watch.all(0x25, 0x08).single().tlv!!
    assertEquals(4, sent.getByte(0x01).toInt())
    assertEquals(0, sent.getShort(0x02).toInt())
    assertArrayEquals(byteArrayOf(0, 7, 1, 0x2c), sent.getBytes(0x04))
    code = 140001
    assertEquals(SongDeleteOutcome(listOf(7), false, 140001), ops.delete(listOf(7)))
  }

  /** The file-upload flow of FileUploadTest's StandardWatch for a song, sending 25/09 after the first chunk. */
  private class SongWatch(val size: Int, val askName: String, val stopAfterFirstChunk: Boolean = false) {
    var received = 0
    var asked = false
    val firstChunk = CompletableDeferred<Unit>()

    private fun f(service: Int, command: Int, tlv: HuaweiTLV): ByteArray {
      val inner = byteArrayOf(service.toByte(), command.toByte()) + tlv.serialize()
      val head = ByteBuffer.allocate(4 + inner.size).put(0x5A.toByte()).putShort((inner.size + 1).toShort()).put(0).put(inner).array()
      return head + ByteBuffer.allocate(2).putShort(CheckSums.getCRC16(head, 0x0000).toShort()).array()
    }

    fun respond(m: Msg): List<ByteArray> = when {
      m.service == 0x28 && m.command == 0x02 -> listOf(f(0x28, 0x02, HuaweiTLV().put(0x7f, 100000)), f(0x28, 0x03, HuaweiTLV().put(0x01, 5.toByte())))
      m.service == 0x28 && m.command == 0x03 -> listOf(
        f(0x28, 0x04, HuaweiTLV().put(0x01, 5.toByte()).put(0x02, "1.0").put(0x03, 5000).put(0x04, 0).put(0x05, 100).put(0x06, 200).put(0x07, 10).put(0x08, 0)),
      )
      m.service == 0x28 && m.command == 0x04 -> listOf(f(0x28, 0x05, HuaweiTLV().put(0x02, 0).put(0x03, minOf(200, size))))
      m.service == 0x28 && m.command == 0x06 -> {
        received += m.payload.size - 6
        firstChunk.complete(Unit)
        val out = ArrayList<ByteArray>()
        if (!asked) {
          asked = true
          out += f(0x25, 0x09, HuaweiTLV().put(0x01, 3.toShort()).put(0x02, askName))
        }
        if (stopAfterFirstChunk) out
        else if (received >= size) out + f(0x28, 0x07, HuaweiTLV().put(0x02, 1.toByte()))
        else if (received % 200 == 0) out + f(0x28, 0x05, HuaweiTLV().put(0x02, received).put(0x03, minOf(200, size - received)))
        else out
      }
      else -> emptyList()
    }
  }

  private fun songFile(name: String, size: Int) =
    SongFile(name, ByteArray(size) { (it * 3).toByte() }, SongProbe(SongFormat.MP3, 44100, "test"), "Lari Pagi", "Joyo Band")

  @Test
  fun uploadSendsTypeTwoAndAnswersTheTitleQuestion() = runBlocking {
    val song = SongWatch(500, "lari.mp3")
    val (watch, ops, events) = setup { song.respond(it) }
    val progress = ArrayList<Int>()
    val outcome = ops.upload(songFile("lari.mp3", 500)) { done, _ -> progress += done }
    assertEquals(1, outcome.uploadStatus)
    assertTrue(outcome.infoAnswered)
    val info = watch.all(0x28, 0x02).single().tlv!!
    assertEquals("lari.mp3", info.getString(0x01))
    assertEquals(500, info.getInteger(0x02))
    assertEquals(2, info.getByte(0x03).toInt())
    assertFalse("no watch face id for a song", info.contains(0x05))
    val answer = watch.all(0x25, 0x09).single().tlv!!
    assertEquals(3, answer.getShort(0x01).toInt())
    assertEquals("Lari Pagi", answer.getString(0x03))
    assertEquals("Joyo Band", answer.getString(0x04))
    assertEquals(500, progress.last())
    assertTrue(events.logs.any { it.contains("Music: 25/09 song index 3 'lari.mp3': answered title 'Lari Pagi', artist 'Joyo Band'") })
  }

  @Test
  fun uploadDoesNotAnswerAQuestionForAnotherFile() = runBlocking {
    val song = SongWatch(300, "other.mp3")
    val (watch, ops, events) = setup { song.respond(it) }
    val outcome = ops.upload(songFile("lari.mp3", 300)) { _, _ -> }
    assertFalse(outcome.infoAnswered)
    assertTrue(watch.all(0x25, 0x09).isEmpty())
    assertTrue(events.logs.any { it.contains("not answered (as Gadgetbridge)") })
  }

  @Test
  fun uploadCanBeCancelledMidTransfer() = runBlocking {
    val song = SongWatch(1000, "lari.mp3", stopAfterFirstChunk = true)
    val (watch, ops, _) = setup { song.respond(it) }
    val job = async { ops.upload(songFile("lari.mp3", 1000)) { _, _ -> } }
    withTimeout(2_000) { song.firstChunk.await() }
    job.cancel()
    try {
      job.await()
      fail("the cancelled upload finished")
    } catch (_: kotlinx.coroutines.CancellationException) {
    }
    assertTrue(job.isCancelled)
    assertEquals(0, watch.all(0x28, 0x07).size)
  }

  @Test
  fun tooManySongsIsWordedForSongs() = runBlocking {
    val (_, ops, _) = setup { m ->
      if (m.service == 0x28 && m.command == 0x02) listOf(tlvFrame(0x28, 0x02, HuaweiTLV().put(0x7f, 140004))) else emptyList()
    }
    try {
      ops.upload(songFile("x.mp3", 10)) { _, _ -> }
      fail("accepted")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.UPLOAD_REJECTED, e.errorCode)
      assertEquals(140004, e.statusCode)
      assertTrue(e.message!!.contains("no more songs"))
    }
  }
}
