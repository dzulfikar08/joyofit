package com.joyodigitama.huaweiwear

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.MusicControl

/**
 * Songs on the watch, the module side (docs/watch-music.md): the lab switch [WatchExtrasSettings.watchMusicLab] (off: every call refuses),
 * the 25/04 gate, one music operation at a time under the link's operation lock, reading the picked file and its tags, and cancelling a
 * running upload. Watch traffic is [WatchMusicOps]. Every step is logged (`Music:` lines). Twin: `WatchMusicController.swift`.
 */
internal class WatchMusicController(
  context: Context,
  private val settings: WatchExtrasSettings,
  private val link: WearLink,
  private val events: WearEvents,
) {
  private val appContext = context.applicationContext
  private val busy = Mutex()
  private val lock = Any()
  private var upload: Deferred<*>? = null
  private var cancelRequested = false

  private fun log(message: String) = events.log(LogDirection.INFO, MusicControl.id.toInt(), null, null, "Music: $message")

  fun status(): Map<String, Any?> {
    val connected = link.handle() != null
    return mapOf(
      "enabled" to settings.watchMusicLab,
      "connected" to connected,
      "uploadSupported" to (connected && DeviceCaps.supports(MusicControl.id.toInt(), MusicControl.MusicInfoParams.id.toInt())),
      "extendedInfo" to (connected && DeviceCaps.supports(MusicControl.id.toInt(), MusicControl.ExtendedMusicInfoParams.id.toInt())),
      "moreMusic" to (connected && DeviceCaps.expandCapability(WatchMusicOps.BIT_MORE_MUSIC)),
      "uploading" to synchronized(lock) { upload != null },
    )
  }

  fun setEnabled(enabled: Boolean) {
    settings.watchMusicLab = enabled
    log("lab switch ${if (enabled) "on" else "off"}")
    if (!enabled) cancel()
  }

  suspend fun info(): Map<String, Any?> = withWatch { ops -> ops.info(extended()).toJs() }

  suspend fun list(): Map<String, Any?> = withWatch { ops ->
    val info = ops.info(extended())
    val list = ops.list(info, DeviceCaps.expandCapability(WatchMusicOps.BIT_MORE_MUSIC))
    mapOf("info" to info.toJs(), "songs" to list.songs.map { it.toJs() }, "pages" to list.pages)
  }

  suspend fun delete(ids: List<Int>): Map<String, Any?> {
    if (ids.isEmpty()) throw WearException(ErrorCodes.INVALID_ARGUMENT, "No songs to delete")
    if (ids.any { it !in 0..0xFFFF }) throw WearException(ErrorCodes.INVALID_ARGUMENT, "Song ids are 16-bit numbers, got $ids")
    return withWatch { ops ->
      val outcome = ops.delete(ids)
      mapOf("ids" to outcome.ids, "ok" to outcome.ok, "code" to outcome.code)
    }
  }

  /**
   * Reads and checks [uri] (named [name]), then sends it. The send runs as a child job that [cancel] stops; the call then resolves with
   * status `cancelled`, the watch is left without its next chunk and drops the partial file on its own [INFERENCE, unverified].
   */
  suspend fun upload(uri: String, name: String): Map<String, Any?> = withWatch { ops ->
    val fileName = MusicFiles.watchFileName(name)
    if (MusicFiles.formatOfExtension(fileName) == null) {
      throw WearException(ErrorCodes.INVALID_ARGUMENT, "'$fileName' is not an MP3, M4A or AAC file. JoyoFit sends these as they are and converts nothing.")
    }
    val data = withContext(Dispatchers.IO) { readUri(uri) }
    val info = ops.info(extended())
    val probe = MusicFiles.check(fileName, data, info)
    val (title, artist) = withContext(Dispatchers.IO) { tags(uri, fileName) }
    val song = SongFile(fileName, data, probe, title, artist)
    val limit = info.limits.firstOrNull { it.format == probe.format.wire }
    if (limit != null) {
      log("25/0D limits for ${probe.format.wire}: rates ${limit.sampleRates} bitrate ${limit.bitrate ?: "?"} channels ${limit.channels}; the file's first frame: ${probe.sampleRate ?: "?"} Hz" +
        if (probe.sampleRate != null && limit.sampleRates.isNotEmpty() && probe.sampleRate.toString() !in limit.sampleRates) " (NOT in the list; sent anyway, the table is unverified)" else "")
    }
    var lastEmit = 0L
    val progress = { done: Int, total: Int ->
      val now = System.nanoTime() / 1_000_000
      if (done >= total || done == 0 || now - lastEmit >= PROGRESS_INTERVAL_MS) {
        lastEmit = now
        events.uploadProgress(done, total)
      }
    }
    val started = System.currentTimeMillis()
    coroutineScope {
      val job = async { ops.upload(song, progress) }
      synchronized(lock) {
        upload = job
        cancelRequested = false
      }
      try {
        val outcome = job.await()
        events.uploadResult(true, fileName, outcome.uploadStatus, "uploaded")
        result(song, "uploaded", outcome.uploadMs, outcome.uploadStatus, outcome.infoAnswered)
      } catch (e: CancellationException) {
        ensureActive()
        if (!synchronized(lock) { cancelRequested }) throw e
        log("upload of $fileName cancelled after ${(System.currentTimeMillis() - started) / 1000} s")
        events.uploadResult(false, fileName, null, "cancelled")
        result(song, "cancelled", System.currentTimeMillis() - started, null, false)
      } catch (e: WearException) {
        events.uploadResult(false, fileName, e.statusCode, e.message ?: e.errorCode)
        throw e
      } finally {
        synchronized(lock) {
          upload = null
          cancelRequested = false
        }
      }
    }
  }

  /** Stops a running upload; true when one ran. */
  fun cancel(): Boolean {
    val job = synchronized(lock) {
      val running = upload ?: return false
      cancelRequested = true
      running
    }
    log("cancel requested")
    job.cancel()
    return true
  }

  private fun result(song: SongFile, status: String, ms: Long, uploadStatus: Int?, infoAnswered: Boolean) = mapOf(
    "status" to status,
    "fileName" to song.fileName,
    "title" to song.title,
    "artist" to song.artist,
    "format" to song.probe.format.wire,
    "bytes" to song.data.size,
    "uploadMs" to ms,
    "uploadStatus" to uploadStatus,
    "infoAnswered" to infoAnswered,
  )

  private fun extended() = DeviceCaps.supports(MusicControl.id.toInt(), MusicControl.ExtendedMusicInfoParams.id.toInt())

  /** The switch, a connection, the 25/04 gate, one music call at a time, then the link's operation lock (syncs wait or are waited for). */
  private suspend fun <T> withWatch(block: suspend (WatchMusicOps) -> T): T {
    if (!settings.watchMusicLab) throw WearException(ErrorCodes.UNSUPPORTED, "Songs on the watch are a lab feature; switch them on under Experimental first")
    val handle = link.handle() ?: throw notConnected()
    if (!DeviceCaps.supports(MusicControl.id.toInt(), MusicControl.MusicInfoParams.id.toInt())) {
      throw WearException(ErrorCodes.UNSUPPORTED, "The watch does not list music storage (25/04) in its supported commands")
    }
    if (!busy.tryLock()) throw WearException(ErrorCodes.BUSY, "Another music operation is running")
    try {
      return handle.operationLock.withLock {
        val current = link.handle()
        if (current == null || current.session !== handle.session) throw notConnected()
        block(WatchMusicOps(handle.session, events))
      }
    } finally {
      busy.unlock()
    }
  }

  private fun notConnected() = WearException(ErrorCodes.NOT_CONNECTED, "Not connected to a watch")

  /** Title and artist from the file's tags (Gadgetbridge `MusicUtils.audioInfoFromUri`), with its fallbacks. */
  private fun tags(uri: String, fileName: String): Pair<String, String> {
    var title: String? = null
    var artist: String? = null
    val retriever = MediaMetadataRetriever()
    try {
      val parsed = Uri.parse(uri)
      if (parsed.scheme == "file" || parsed.scheme == null) retriever.setDataSource(parsed.path ?: uri) else retriever.setDataSource(appContext, parsed)
      title = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE)
      artist = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST)
    } catch (e: RuntimeException) {
      log("tags of $fileName not readable (${e.message}); using the file name")
    } finally {
      try {
        retriever.release()
      } catch (_: Exception) {
      }
    }
    return Pair(
      title?.trim()?.takeIf { it.isNotEmpty() } ?: MusicFiles.titleFallback(fileName),
      artist?.trim()?.takeIf { it.isNotEmpty() } ?: MusicFiles.UNKNOWN_ARTIST,
    )
  }

  private fun readUri(uri: String): ByteArray {
    val parsed = Uri.parse(uri)
    try {
      val stream = if (parsed.scheme == "file" || parsed.scheme == null) {
        java.io.File(parsed.path ?: uri).inputStream()
      } else {
        appContext.contentResolver.openInputStream(parsed) ?: throw WearException(ErrorCodes.INVALID_ARGUMENT, "Could not open $uri")
      }
      return stream.use { input ->
        val out = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(64 * 1024)
        while (true) {
          val n = input.read(buffer)
          if (n < 0) break
          out.write(buffer, 0, n)
          if (out.size() > MusicFiles.MAX_FILE_BYTES) {
            throw WearException(ErrorCodes.INVALID_ARGUMENT, "Songs up to ${MusicFiles.MAX_FILE_BYTES / 1024 / 1024} MiB can be sent (the upload holds the file in memory)")
          }
        }
        out.toByteArray()
      }
    } catch (e: WearException) {
      throw e
    } catch (e: IOException) {
      throw WearException(ErrorCodes.INVALID_ARGUMENT, "Could not read the file: ${e.message}", e)
    } catch (e: SecurityException) {
      throw WearException(ErrorCodes.INVALID_ARGUMENT, "No permission to read the file: ${e.message}", e)
    }
  }

  private companion object {
    const val PROGRESS_INTERVAL_MS = 200L
  }
}
