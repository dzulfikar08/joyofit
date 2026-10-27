// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): service/devices/huawei/HuaweiMusicManager (list paging, upload info answer,
// music operation), HuaweiSupportProvider.onInstallApp (music upload over FileUpload type 2), requests/{GetMusicInfoParams,
// GetExtendedMusicInfoParams,GetMusicList,SendMusicOperation,SendUploadMusicFileInfoResponse}, AsynchronousResponse (25/09).
package com.joyodigitama.huaweiwear

import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiMusicUtils
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.FileUpload
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.MusicControl

/** The audio formats JoyoFit sends, by their name in Gadgetbridge's format table. Nothing is converted. */
internal enum class SongFormat(val wire: String) { MP3("mp3"), M4A("m4a"), AAC("aac") }

/** What a song file's first bytes say: its format and, for MP3 and ADTS AAC, the sample rate of the first frame. */
internal data class SongProbe(val format: SongFormat, val sampleRate: Int?, val detail: String)

/** One format's limits from 25/0D. */
internal data class MusicFormatLimit(val formatIndex: Int, val format: String?, val sampleRates: List<String>, val bitrate: Int?, val channels: Int)

/** The watch's music store as 25/04 (and 25/0D when it answered) report it. */
internal data class MusicInfo(
  val freeSpaceMb: Int?,
  val formats: List<String>,
  val maxSongs: Int?,
  val songCount: Int?,
  val maxPlaylists: Int?,
  val frameCount: Int,
  val limits: List<MusicFormatLimit>,
  val extended: Boolean,
) {
  fun toJs(): Map<String, Any?> = mapOf(
    "freeSpaceMb" to freeSpaceMb,
    "formats" to formats,
    "maxSongs" to maxSongs,
    "songCount" to songCount,
    "maxPlaylists" to maxPlaylists,
    "frameCount" to frameCount,
    "limits" to limits.map {
      mapOf("formatIndex" to it.formatIndex, "format" to it.format, "sampleRates" to it.sampleRates, "bitrate" to it.bitrate, "channels" to it.channels)
    },
    "extended" to extended,
  )
}

internal data class WatchSong(val id: Int, val title: String, val artist: String, val fileName: String) {
  fun toJs(): Map<String, Any?> = mapOf("id" to id, "title" to title, "artist" to artist, "fileName" to fileName)
}

internal data class WatchSongList(val songs: List<WatchSong>, val pages: Int)

/** A song ready to send: the bytes, the name the watch gets and the tags it asks for (25/09). */
internal class SongFile(val fileName: String, val data: ByteArray, val probe: SongProbe, val title: String, val artist: String)

internal data class SongUploadOutcome(val uploadStatus: Int?, val infoAnswered: Boolean, val uploadMs: Long)

internal data class SongDeleteOutcome(val ids: List<Int>, val ok: Boolean, val code: Int?)

/** Pure checks of a picked song file, shared by the controller and the tests. Twin: `MusicFiles` in WatchMusic.swift. */
internal object MusicFiles {
  /** The upload holds the whole file in memory ([UploadFile]). */
  const val MAX_FILE_BYTES = 64 * 1024 * 1024

  /** Gadgetbridge sends this artist when the file has none (`R.string.unknown`). */
  const val UNKNOWN_ARTIST = "Unknown"

  private val MPEG1_RATES = intArrayOf(44100, 48000, 32000)
  private val MPEG2_RATES = intArrayOf(22050, 24000, 16000)
  private val MPEG25_RATES = intArrayOf(11025, 12000, 8000)
  private val ADTS_RATES = intArrayOf(96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350)

  fun extension(name: String): String? {
    val dot = name.lastIndexOf('.')
    if (dot < 0 || dot == name.length - 1) return null
    return name.substring(dot + 1).lowercase(java.util.Locale.ROOT)
  }

  fun formatOfExtension(name: String): SongFormat? = when (extension(name)) {
    "mp3" -> SongFormat.MP3
    "m4a" -> SongFormat.M4A
    "aac" -> SongFormat.AAC
    else -> null
  }

  /**
   * The format by content: an MP4 `ftyp` box is M4A; after an optional ID3v2 tag, an MPEG-1/2/2.5 Layer III frame header is MP3 and an
   * ADTS header (sync, layer 00) is AAC. Anything else is null.
   */
  fun probe(data: ByteArray): SongProbe? {
    if (data.size >= 12 && data[4] == 'f'.code.toByte() && data[5] == 't'.code.toByte() && data[6] == 'y'.code.toByte() && data[7] == 'p'.code.toByte()) {
      val brand = String(data, 8, 4, Charsets.ISO_8859_1)
      return SongProbe(SongFormat.M4A, null, "MP4 brand '$brand'")
    }
    var at = 0
    var id3 = ""
    if (data.size >= 10 && data[0] == 'I'.code.toByte() && data[1] == 'D'.code.toByte() && data[2] == '3'.code.toByte()) {
      val size = ((data[6].toInt() and 0x7F) shl 21) or ((data[7].toInt() and 0x7F) shl 14) or ((data[8].toInt() and 0x7F) shl 7) or (data[9].toInt() and 0x7F)
      val footer = if ((data[5].toInt() and 0x10) != 0) 10 else 0
      at = 10 + size + footer
      id3 = "ID3v2.${data[3].toInt() and 0xFF} tag of ${10 + size + footer} bytes, "
    }
    // Some encoders pad the tag with zeros beyond its declared size.
    while (at < data.size && data[at].toInt() == 0) at++
    if (at + 4 > data.size) return null
    val b0 = data[at].toInt() and 0xFF
    val b1 = data[at + 1].toInt() and 0xFF
    val b2 = data[at + 2].toInt() and 0xFF
    if (b0 != 0xFF || (b1 and 0xE0) != 0xE0) return null
    val layer = (b1 shr 1) and 0x03
    if ((b1 and 0xF0) == 0xF0 && layer == 0) {
      val index = (b2 shr 2) and 0x0F
      val rate = ADTS_RATES.getOrNull(index)
      return SongProbe(SongFormat.AAC, rate, "${id3}ADTS at $at")
    }
    if (layer != 0x01) return null // Layer III only
    val version = (b1 shr 3) and 0x03
    val rates = when (version) {
      3 -> MPEG1_RATES
      2 -> MPEG2_RATES
      0 -> MPEG25_RATES
      else -> return null
    }
    val rate = rates.getOrNull((b2 shr 2) and 0x03)
    return SongProbe(SongFormat.MP3, rate, "${id3}MPEG audio frame at $at")
  }

  /**
   * Checks a picked file against what JoyoFit sends and what the watch reported, and returns its probe. Throws [WearException]
   * ERR_INVALID_ARGUMENT with a message for the user.
   */
  fun check(name: String, data: ByteArray, info: MusicInfo?): SongProbe {
    val byName = formatOfExtension(name)
      ?: throw invalid("'$name' is not an MP3, M4A or AAC file. JoyoFit sends these as they are and converts nothing.")
    if (data.isEmpty()) throw invalid("'$name' is empty.")
    if (data.size > MAX_FILE_BYTES) throw invalid("'$name' is larger than ${MAX_FILE_BYTES / 1024 / 1024} MiB.")
    val probe = probe(data)
      ?: throw invalid("'$name' does not contain ${byName.wire.uppercase(java.util.Locale.ROOT)} audio JoyoFit recognises.")
    if (probe.format != byName) {
      throw invalid("'$name' is named .${extension(name)} but contains ${probe.format.wire.uppercase(java.util.Locale.ROOT)} audio; rename it to .${probe.format.wire}.")
    }
    if (info != null && info.formats.isNotEmpty() && probe.format.wire !in info.formats) {
      throw invalid("The watch does not take ${probe.format.wire.uppercase(java.util.Locale.ROOT)} files (it lists ${info.formats.joinToString(", ")}).")
    }
    val free = info?.freeSpaceMb
    if (free != null && data.size.toLong() > free.toLong() * 1024 * 1024) {
      throw invalid("'$name' is ${(data.size + 1024 * 1024 - 1) / (1024 * 1024)} MB; the watch has $free MB free.")
    }
    return probe
  }

  /** The file name without its extension, Gadgetbridge's title when the tags have none. */
  fun titleFallback(name: String): String = if (name.indexOf('.') > 0) name.substring(0, name.lastIndexOf('.')) else name

  /** The name the watch gets: the picked name without any path. */
  fun watchFileName(name: String): String = name.substringAfterLast('/').substringAfterLast('\\').trim()

  private fun invalid(message: String) = WearException(ErrorCodes.INVALID_ARGUMENT, message)
}

/**
 * Song storage on a connected watch: capabilities (25/04, 25/0D), the paged song list (25/05), delete (25/08 operation 4 on playlist 0)
 * and the upload (FileUpload 28 with file type 2, answering the watch's 25/09 with the song's title and artist). The caller holds the
 * link's operation lock. Twin: `WatchMusicOps` in WatchMusic.swift.
 */
internal class WatchMusicOps(
  private val session: HuaweiSession,
  private val events: WearEvents,
  private val queryMs: Long = Timeouts.QUERY_MS,
  private val infoGraceMs: Long = INFO_GRACE_MS,
  private val stallMs: Long = FileUploader.STALL_MS,
) {
  private val params get() = session.params

  /** 25/04, then 25/0D when [extended] (the watch lists it); a 0D without an answer is logged and left out. */
  suspend fun info(extended: Boolean): MusicInfo {
    val basic = session.request(MusicControl.MusicInfoParams.Request(params), queryMs, "MusicInfoParams")
      .expect<MusicControl.MusicInfoParams.Response>("MusicInfoParams")
    log("25/04: frameCount=${basic.frameCount} ${describe(basic.params)} pages=${basic.pageStruct?.joinToString { "${it.startFrame}-${it.endFrame}x${it.count}" } ?: "none"}")
    var ext: HuaweiMusicUtils.MusicCapabilities? = null
    if (extended) {
      try {
        ext = session.request(MusicControl.ExtendedMusicInfoParams.Request(params), queryMs, "ExtendedMusicInfoParams")
          .expect<MusicControl.ExtendedMusicInfoParams.Response>("ExtendedMusicInfoParams").params
        log("25/0D: ${describe(ext)}")
      } catch (e: CancellationException) {
        throw e
      } catch (e: WearException) {
        if (e.errorCode != ErrorCodes.TIMEOUT) throw e
        log("25/0D: no answer within $queryMs ms; using 25/04 only")
      }
    }
    return merge(basic.frameCount, basic.params, ext)
  }

  /**
   * Every page of the list, the way Gadgetbridge's `HuaweiMusicManager` pages it: frames 0.. up to the frame count (at most 250 with
   * ExpandCapability 122) with end index 65535; without 122 it stops at a page whose end index equals the one asked for (compared as GB
   * does, the signed 16-bit answer against the int it sent) or that holds a single song, and a two-song page moves the end index to the
   * second song's id. Songs are kept once per id.
   */
  suspend fun list(info: MusicInfo, moreMusic: Boolean): WatchSongList {
    val songs = LinkedHashMap<Int, WatchSong>()
    val limit = if (moreMusic) minOf(info.frameCount, MAX_FRAMES) else info.frameCount
    var frame = 0
    var endFrame = FIRST_END_FRAME
    var pages = 0
    while (frame < limit) {
      val page = session.request(MusicControl.MusicList.Request(params, frame.toShort(), endFrame.toShort()), queryMs, "MusicList $frame")
        .expect<MusicControl.MusicList.Response>("MusicList")
      pages++
      log("25/05 frame $frame (end $endFrame): startFrame=${page.startFrame} endIndex=${page.endIndex} songs=${page.musicList.size}: " +
        page.musicList.joinToString { "${it.id} '${it.title}' / '${it.artist}' (${it.fileName})" })
      for (s in page.musicList) songs.putIfAbsent(s.id, WatchSong(s.id, s.title, s.artist, s.fileName))
      if (moreMusic || !(page.endIndex.toInt() == endFrame || page.musicList.size == 1)) {
        if (page.musicList.size == 2) endFrame = page.musicList[1].id
        frame++
        continue
      }
      break
    }
    log("list: ${songs.size} songs in $pages pages (frameCount ${info.frameCount}, moreMusic=$moreMusic)")
    return WatchSongList(songs.values.toList(), pages)
  }

  /** 25/08 operation 4 on playlist 0: Gadgetbridge's "delete from device". */
  suspend fun delete(ids: List<Int>): SongDeleteOutcome {
    val answer = session.request(
      MusicControl.MusicOperation.Request(params, MusicControl.MusicOperation.OPERATION_REMOVE_SONGS, MusicControl.MusicOperation.PLAYLIST_ALL_SONGS, null, ids),
      queryMs,
      "MusicOperation delete $ids",
    ).expect<MusicControl.MusicOperation.Response>("MusicOperation")
    val code = answer.resultCode.takeIf { it != -1 }
    val ok = code == MusicControl.successValue
    log("25/08 delete $ids: watch answered code=${code ?: "none"} operation=${answer.operation} playlist=${answer.playlistIndex} ids=${answer.musicIds}${if (ok) "" else " (not 100000: not deleted)"}")
    return SongDeleteOutcome(ids, ok, code)
  }

  /**
   * Sends [file] as FileUpload type 2. While it runs (and up to [infoGraceMs] after it, when the watch has not asked yet) the watch's 25/09
   * is answered with the song's title and artist, as Gadgetbridge's `uploadMusicInfo` does when the file name matches.
   */
  suspend fun upload(file: SongFile, onProgress: (Int, Int) -> Unit): SongUploadOutcome = coroutineScope {
    val asks = Channel<HuaweiPacket>(Channel.UNLIMITED)
    val subscription = session.subscribe(MusicControl.id, MusicControl.UploadMusicFileInfo.id, "music upload info ${file.fileName}") { asks.trySend(it) }
    val answered = AtomicBoolean(false)
    val responder = launch {
      for (packet in asks) {
        val ask = try {
          packet.expect<MusicControl.UploadMusicFileInfo.UploadMusicFileInfoRequest>("UploadMusicFileInfo").also { it.parseTlv() }
        } catch (e: CancellationException) {
          throw e
        } catch (e: Exception) {
          log("25/09 could not be read: ${e.message}", error = true)
          continue
        }
        if (ask.songFileName != file.fileName) {
          // GB: "Upload file info does not exist." and no answer.
          log("25/09 asks for song ${ask.songIndex} '${ask.songFileName}', not '${file.fileName}'; not answered (as Gadgetbridge)", error = true)
          continue
        }
        session.send(
          MusicControl.UploadMusicFileInfo.UploadMusicFileInfoResponse(params, ask.songIndex, file.title, file.artist),
          "UploadMusicFileInfo ${ask.songIndex}",
        )
        answered.set(true)
        log("25/09 song index ${ask.songIndex} '${ask.songFileName}': answered title '${file.title}', artist '${file.artist}'")
      }
    }
    try {
      log("upload ${file.fileName}: ${file.data.size} bytes, ${file.probe.format.wire} (${file.probe.detail}, sample rate ${file.probe.sampleRate ?: "?"}), title '${file.title}', artist '${file.artist}'")
      val started = System.currentTimeMillis()
      val outcome = try {
        FileUploader(session, events, onProgress, stallMs = stallMs).upload(UploadFile(file.fileName, FileUpload.Filetype.music, file.data))
      } catch (e: WearException) {
        // FileUploader words 140004 for watch faces; GB uses the same code for "too many songs".
        if (e.errorCode == ErrorCodes.UPLOAD_REJECTED && e.statusCode == 140004) {
          throw WearException(ErrorCodes.UPLOAD_REJECTED, "The watch holds no more songs (code 140004). Delete one and try again.", e, statusCode = 140004)
        }
        throw e
      }
      val uploadMs = System.currentTimeMillis() - started
      if (!answered.get()) {
        log("no 25/09 during the upload; waiting ${infoGraceMs / 1000} s for it")
        withTimeoutOrNull(infoGraceMs) { while (!answered.get()) delay(100) }
      }
      log("upload ${file.fileName} done in ${uploadMs / 1000} s (${if (uploadMs > 0) file.data.size * 1000L / uploadMs else 0} B/s): 28/07 status ${outcome.resultStatus ?: "none"}, 25/09 answered=${answered.get()}")
      SongUploadOutcome(outcome.resultStatus, answered.get(), uploadMs)
    } finally {
      subscription.close()
      asks.close()
      responder.cancel()
    }
  }

  /**
   * 25/0D wins where it has a value. `MusicCapabilities` leaves a missing tag at 0, so 0 MB free and 0 max songs read as "not reported"
   * (a full watch still refuses the file with 140009); 0 songs is taken as reported.
   */
  private fun merge(frameCount: Int, basic: HuaweiMusicUtils.MusicCapabilities, ext: HuaweiMusicUtils.MusicCapabilities?): MusicInfo {
    val formats = ext?.supportedFormats?.takeIf { it.isNotEmpty() } ?: basic.supportedFormats ?: emptyList()
    return MusicInfo(
      freeSpaceMb = (ext?.availableSpace?.takeIf { it > 0 } ?: basic.availableSpace).takeIf { it > 0 },
      formats = formats,
      maxSongs = (ext?.maxMusicCount?.takeIf { it > 0 } ?: basic.maxMusicCount).takeIf { it > 0 },
      songCount = basic.currentMusicCount,
      maxPlaylists = ext?.maxPlaylistCount,
      frameCount = frameCount,
      limits = ext?.formatsRestrictions.orEmpty().map {
        MusicFormatLimit(
          formatIndex = it.formatIdx.toInt(),
          format = it.name,
          sampleRates = it.sampleRates?.map(String::trim)?.filter(String::isNotEmpty).orEmpty(),
          bitrate = it.bitrate.toInt().takeIf { b -> b >= 0 },
          channels = it.channels.toInt(),
        )
      },
      extended = ext != null,
    )
  }

  private fun log(message: String, error: Boolean = false) =
    events.log(if (error) LogDirection.ERROR else LogDirection.INFO, MusicControl.id.toInt(), null, null, "Music: $message")

  companion object {
    /** How long after the transfer a missing 25/09 is still awaited (GB's timing was not read). */
    const val INFO_GRACE_MS = 5_000L
    /** GB `HuaweiMusicManager`: at most 250 frames with ExpandCapability 122. */
    const val MAX_FRAMES = 250
    const val FIRST_END_FRAME = 65535
    /** GB `HuaweiState.supportsMoreMusic`. */
    const val BIT_MORE_MUSIC = 122

    fun describe(c: HuaweiMusicUtils.MusicCapabilities): String =
      "availableSpace=${c.availableSpace} MB formats=${c.supportedFormats} maxMusicCount=${c.maxMusicCount} currentMusicCount=${c.currentMusicCount} " +
        "maxPlaylistCount=${c.maxPlaylistCount} unknown=${c.unknown} restrictions=" +
        (c.formatsRestrictions?.joinToString(prefix = "[", postfix = "]") {
          "${it.name ?: it.formatIdx} rates=${it.sampleRates?.joinToString("/")} encode=${it.musicEncode} bitrate=${it.bitrate} channels=${it.channels} unknownBitrate=${it.unknownBitrate}"
        } ?: "none")
  }
}
