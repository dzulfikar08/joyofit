// The photo ("gallery") watch face: its photos live on the watch, put there by the phone. The flow is Huawei Health 17.0.8.300's
// (RE notes in protocol/README.md, "Photo faces"): 27/08 reads the face's settings and photo list, 27/09 sends the list the face
// should hold, and for every photo the watch does not have yet it then asks for the file itself (28/01), after which the phone runs
// the ordinary 28/02 .. 28/07 upload with file type 3. The watch ends with a 27/05 report (type 4, photos received), after which the
// face is applied again with 27/03 (operation 1), as Huawei Health's Apply does. No watch face signature is involved anywhere in it.
package com.joyodigitama.huaweiwear

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import java.io.File
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.PhotoFace

/** FileUpload file type 3, "background image": what Huawei Health uses for a photo (`getFileType()` of `WatchFacePhotoAlbumManager`). */
internal const val FILE_TYPE_BACKGROUND: Byte = 3

/** The two files Huawei Health keeps for a photo: the PNG it shows and the `.bin` it sends. */
internal class PhotoFiles(val png: ByteArray, val bin: ByteArray)

/** What [PhotoFaceOps.save] did. */
internal class PhotoSaveResult(
  /** Tag 0x08 of the watch's answer to 27/09: how many photos it still wanted. */
  val transferNum: Int,
  /** The names the phone sent, in order. */
  val sent: List<String>,
  /** `failedNum` of the watch's type 4 report; null when none arrived. */
  val failedNum: Int?,
)

/**
 * 27/08, 27/09 and the photo transfer on a connected [session]. The caller holds the link's operation lock.
 */
internal class PhotoFaceOps(
  private val session: HuaweiSession,
  private val events: WearEvents,
  private val queryMs: Long = Timeouts.QUERY_MS,
  private val stallMs: Long = FileUploader.STALL_MS,
  /** How long to wait for the watch's type 4 report once every photo it asked for has been sent. */
  private val reportWaitMs: Long = REPORT_WAIT_MS,
) {
  private val params get() = session.params

  /** 27/08. The three optional indexes are always asked for: the watch answers the ones its face has. */
  suspend fun readInfo(): PhotoFaceInfo {
    val request = PhotoFace.InfoRequest(params, true, true, true)
    log("PhotoInfo TLV before encryption: ${describeTlv(request.getTlv())}")
    val answer = session.request(request, queryMs, "PhotoInfo")
    val tlv = answer.getTlv() ?: throw WearException(ErrorCodes.PROTOCOL, "PhotoInfo: the watch's answer has no TLV")
    log("PhotoInfo: watch answered ${describeTlv(tlv)}")
    val info = try {
      PhotoFaceCodec.parseInfo(tlv)
    } catch (e: HuaweiPacket.ParseException) {
      throw WearException(ErrorCodes.PROTOCOL, "PhotoInfo could not be read: ${e.message}", e)
    }
    log(
      "PhotoInfo: max=${info.maxPhotos} backgroundType=${info.backgroundType} imageOption=${info.imageOption} " +
        "intellectColour=${info.intellectColour} position=${info.positionIndex} style=${info.styleIndex} data=${info.dataIndex} " +
        "photos=${info.photos.joinToString { "${it.index}:${it.name}" }.ifEmpty { "none" }}",
    )
    return info
  }

  /**
   * 27/09 with [names] (every photo the face should hold, `<name>.png`), then serves every file the watch asks for from [files].
   * [info] and [fields] supply the values written for each photo and the face ([PhotoFaceCodec.saveTlv]).
   */
  suspend fun save(
    info: PhotoFaceInfo,
    names: List<String>,
    files: Map<String, PhotoFiles>,
    fields: PhotoSaveFields = PhotoSaveFields(),
    progress: (bytes: Int, total: Int) -> Unit = { _, _ -> },
  ): PhotoSaveResult {
    val incoming = Channel<HuaweiPacket>(Channel.UNLIMITED)
    val subscriptions = listOf(
      session.subscribe(PhotoFace.fileUploadId, PhotoFace.FileRequestAnswer.id, "photo file request") { incoming.trySend(it) },
      session.subscribe(PhotoFace.watchfaceId, PhotoFace.ReportAck.id, "photo face report") { incoming.trySend(it) },
    )
    try {
      val request = PhotoFace.SaveRequest(params, PhotoFaceCodec.saveTlv(info, names, fields))
      log("PhotoSave ${names.size} photo(s) TLV before encryption: ${describeTlv(request.getTlv())}")
      val answer = session.request(request, queryMs, "PhotoSave")
      val tlv = answer.getTlv() ?: throw WearException(ErrorCodes.PROTOCOL, "PhotoSave: the watch's answer has no TLV")
      val status = PhotoFaceCodec.parseSaveStatus(tlv)
      log("PhotoSave: watch answered status=${status.code} transferNum=${status.transferNum} TLV ${describeTlv(tlv)}")
      if (status.code != PhotoFaceCodec.STATUS_OK) {
        throw WearException(
          ErrorCodes.UPLOAD_REJECTED,
          "The watch refused the photo list with status ${status.code}; what it means is not documented.",
          statusCode = status.code,
        )
      }
      if (status.transferNum == 0) return PhotoSaveResult(0, names, null)

      var served = 0
      var failed: Int? = null
      while (failed == null) {
        val limit = if (served >= status.transferNum) reportWaitMs else stallMs
        val packet = next(incoming, limit)
        if (packet == null) {
          if (served < status.transferNum) {
            throw WearException(
              ErrorCodes.TIMEOUT,
              "The watch asked for $served of ${status.transferNum} photos and then sent nothing for ${limit / 1000} s.",
            )
          }
          log("no type 4 report within ${limit}ms after $served photo(s); going on")
          break
        }
        if (packet.serviceId == PhotoFace.watchfaceId) {
          failed = handleReport(packet)
        } else if (serveFile(packet, files, progress)) {
          served++
        }
      }
      return PhotoSaveResult(status.transferNum, names, failed)
    } finally {
      for (s in subscriptions) s.close()
      incoming.close()
    }
  }

  /** Answers the watch's 28/01; true when the file went out. */
  private suspend fun serveFile(packet: HuaweiPacket, files: Map<String, PhotoFiles>, progress: (Int, Int) -> Unit): Boolean {
    val tlv = packet.getTlv()
    log("FileRequest: watch asked ${if (tlv == null) "(no TLV)" else describeTlv(tlv)}")
    val request = tlv?.let { PhotoFaceCodec.parseFileRequest(it) } ?: return false
    val data = files[request.name]
    if (data == null || request.fileType != PhotoFaceCodec.FILE_TYPE_PHOTO) {
      log("FileRequest: \"${request.name}\" type ${request.fileType} is not a photo this save holds; answering ${PhotoFaceCodec.FILE_MISSING}")
      session.send(
        PhotoFace.FileRequestAnswer(params, request.name, request.fileType, request.resourceType, PhotoFaceCodec.FILE_MISSING),
        "FileRequest answer ${request.name} (missing)",
      )
      return false
    }
    session.send(
      PhotoFace.FileRequestAnswer(params, request.name, request.fileType, request.resourceType, PhotoFaceCodec.STATUS_OK),
      "FileRequest answer ${request.name}",
    )
    val content = PhotoFaceCodec.contentFor(request, data.png, data.bin)
    log("FileRequest: sending \"${request.name}\" as ${if (request.resourceType == 1) "png" else "bin"} (${content.size} bytes, resource type ${request.resourceType})")
    FileUploader(session, events, progress, stallMs, confirmWaitMs = 0, settleMs = 0)
      .upload(UploadFile(request.name, FILE_TYPE_BACKGROUND, content))
    return true
  }

  /** Acknowledges a 27/05 like Huawei Health's `reportAck`; the failed count of a type 4 report, otherwise null. */
  private suspend fun handleReport(packet: HuaweiPacket): Int? {
    val tlv = packet.getTlv() ?: return null
    val report = PhotoFaceCodec.parseReport(tlv)
    log("Report: type=${report.reportType} failedNum=${report.failedNum} code=${report.code} id=${report.id} version=${report.version} TLV ${describeTlv(tlv)}")
    if (report.code == PhotoFaceCodec.STATUS_OK) {
      session.send(PhotoFace.ReportAck(params, report.id, report.version), "Report ack type ${report.reportType}")
    }
    return if (report.reportType == PhotoFaceCodec.REPORT_PHOTOS_RECEIVED) report.failedNum else null
  }

  private suspend fun next(incoming: Channel<HuaweiPacket>, limitMs: Long): HuaweiPacket? {
    var waited = 0L
    while (waited < limitMs) {
      session.closeCause?.let { throw it }
      val slice = minOf(POLL_MS, limitMs - waited)
      val packet = withTimeoutOrNull(slice) { incoming.receive() }
      if (packet != null) return packet
      waited += slice
    }
    session.closeCause?.let { throw it }
    return null
  }

  private fun log(message: String, error: Boolean = false) =
    events.log(if (error) LogDirection.ERROR else LogDirection.INFO, null, null, null, "Photo face: $message")

  companion object {
    const val REPORT_WAIT_MS = 15_000L
    private const val POLL_MS = 500L
  }
}

/** The photo face on the watch with its settings and the screen it was read with. */
internal class PhotoFaceState(
  val face: WatchfaceEntry,
  val info: PhotoFaceInfo,
  val width: Int,
  val height: Int,
  val updatedAtMs: Long,
  val screen: WatchfaceScreen,
)

/** Photos kept on the phone for the ones JoyoFit uploaded, so the screen can show them; the watch itself offers no preview. */
internal class PhotoStore(private val dir: File) {
  fun file(name: String) = File(dir, name.replace('/', '_'))

  fun save(name: String, png: ByteArray) {
    dir.mkdirs()
    file(name).writeBytes(png)
  }

  fun delete(name: String) {
    file(name).delete()
  }

  /** The local copy's `file://` URI, null when this phone never uploaded the photo. */
  fun uri(name: String): String? = file(name).takeIf { it.isFile }?.let { Uri.fromFile(it).toString() }

  /** Drops copies of photos the watch no longer lists. */
  fun keepOnly(names: Collection<String>) {
    dir.listFiles()?.forEach { if (it.name !in names) it.delete() }
  }
}

/**
 * The photo face part of the module: finds the watch's photo face, serializes every operation with the link's operation lock,
 * decodes the picked photo and turns progress and outcome into `onUploadProgress` / `onUploadResult` events.
 */
internal class PhotoFaceController(
  private val context: Context,
  private val link: WearLink,
  private val events: WearEvents,
) {
  private val store = PhotoStore(File(context.filesDir, "photoface"))

  suspend fun info(): Map<String, Any?> = withWatch { watchfaces, photos -> state(watchfaces, photos).toJs() }

  /** [uri] is a PNG already cropped to the face's resolution (the crop screen does it); anything else is refused. */
  suspend fun add(uri: String): Map<String, Any?> {
    link.handle() ?: throw notConnected()
    val png = withContext(Dispatchers.IO) { readUri(uri) }
    var lastEmit = 0L
    val progress = { done: Int, total: Int ->
      val now = System.nanoTime() / 1_000_000
      if (done >= total || done == 0 || now - lastEmit >= PROGRESS_INTERVAL_MS) {
        lastEmit = now
        events.uploadProgress(done, total)
      }
    }
    return withWatch { watchfaces, photos ->
      val before = state(watchfaces, photos)
      var name = ""
      try {
        val max = before.info.maxPhotos
        if (max > 0 && before.info.photos.size >= max) {
          throw WearException(ErrorCodes.INVALID_ARGUMENT, "The photo face holds $max photos already; delete one first.")
        }
        val pixels = withContext(Dispatchers.Default) { decode(png, before.width, before.height) }
        val format = PhotoBin.Format.fromOption(before.info.imageOption)
        val bin = PhotoBin.encode(pixels, before.width, before.height, format)
        name = freshName(before.info.photos.map { it.name })
        events.log(
          LogDirection.INFO, null, null, null,
          "Photo face: adding $name (${before.width}x${before.height}, ${png.size} byte png, ${bin.size} byte ${format.name} bin)",
        )
        val names = before.info.photos.map { it.name } + name
        val fields = saveFields(before, mapOf(name to pixels))
        val result = photos.save(before.info, names, mapOf(name to PhotoFiles(png, bin)), fields, progress)
        store.save(name, png)
        val applyProblem = reapply(watchfaces, before.face)
        val after = state(watchfaces, photos)
        val failed = result.failedNum ?: 0
        val listed = after.info.photos.any { it.name == name }
        val message = when {
          !listed -> "The watch took the photo but does not list it."
          failed > 0 -> "The watch reported $failed photo(s) it could not take."
          applyProblem != null -> "Photo added, but $applyProblem."
          else -> "Photo added."
        }
        events.uploadResult(listed && failed == 0, name, null, message)
        after.toJs(applyProblem)
      } catch (e: CancellationException) {
        throw e
      } catch (e: WearException) {
        events.uploadResult(false, name.ifEmpty { "photo" }, e.statusCode, e.message ?: e.errorCode)
        throw e
      }
    }
  }

  suspend fun delete(name: String): Map<String, Any?> = withWatch { watchfaces, photos ->
    val before = state(watchfaces, photos)
    if (before.info.photos.none { it.name == name }) {
      throw WearException(ErrorCodes.INVALID_ARGUMENT, "The photo face has no photo named '$name'")
    }
    val names = before.info.photos.map { it.name }.filter { it != name }
    photos.save(before.info, names, emptyMap(), saveFields(before, emptyMap()))
    store.delete(name)
    // An emptied face that was not on the screen stays off it: applying it would put the watch's "add photo" page up.
    val applyProblem = if (names.isNotEmpty() || before.face.isCurrent) reapply(watchfaces, before.face) else null
    val after = state(watchfaces, photos)
    if (after.info.photos.any { it.name == name }) {
      throw WearException(ErrorCodes.UPLOAD_REJECTED, "The watch still lists the photo after it was removed.")
    }
    after.toJs(applyProblem)
  }

  /** Makes the photo face the active face (the ordinary 27/03 activation of an installed face). */
  suspend fun setActive(): Map<String, Any?> = withWatch { watchfaces, photos ->
    val list = watchfaces.list()
    val face = list.faces.firstOrNull { it.isPhoto } ?: throw noPhotoFace()
    if (!face.isCurrent) watchfaces.setActive(face.id)
    state(watchfaces, photos).toJs()
  }

  /**
   * 27/03 operation 1 for the photo face after a save, as Huawei Health's Apply does (protocol/README.md, "Photo faces"): the face is
   * applied again, current or not, so the watch shows it with the new list. After a delete it is skipped when the face is emptied and
   * was not the current one. The photos are saved already, so a refusal is reported (log, `applyError` of the result), not thrown.
   * Null when the watch took it.
   */
  private suspend fun reapply(watchfaces: WatchfaceOps, face: WatchfaceEntry): String? {
    val problem = try {
      val code = watchfaces.apply(face)
      if (operationAccepted(code)) null else "the watch answered $code when the photo face was applied again"
    } catch (e: CancellationException) {
      throw e
    } catch (e: WearException) {
      if (e.errorCode == ErrorCodes.DISCONNECTED) throw e
      "applying the photo face again failed: ${e.message}"
    }
    if (problem != null) events.log(LogDirection.ERROR, null, null, null, "Photo face: $problem")
    return problem
  }

  /**
   * The values Huawei Health writes into 27/09 besides the watch's own ([PhotoFaceCodec.saveTlv]): the face's new-photo values
   * ([PhotoFaceCodec.faceConfig]), the Gaussian switch from 27/01 tag 0x1a and, when 27/01 tag 0x1b is 1, a time colour for each photo in
   * [newPixels] chosen for the time area of the face's selected position ([PhotoTimeColour]). Photos already on the watch keep the colour it
   * reports; with tag 0x1b not 1 a new photo gets `#00000000`, as from Huawei Health.
   */
  private suspend fun saveFields(state: PhotoFaceState, newPixels: Map<String, IntArray>): PhotoSaveFields {
    val config = PhotoFaceCodec.faceConfig(state.face.id)
    val colours = HashMap<String, String>()
    if (state.screen.aestheticAlbumColour == 1) {
      val rect = config.positionRects[config.timePosition]
      for ((name, pixels) in newPixels) {
        val picked = rect?.let {
          withContext(Dispatchers.Default) { PhotoTimeColour.pick(pixels, state.width, state.height, it[0], it[1], it[2], it[3]) }
        }
        if (picked != null) colours[name] = PhotoFaceCodec.smartColour(picked)
        log("time colour of $name: ${colours[name] ?: "none (${if (rect == null) "no time area known for face ${state.face.id}" else "the photo has no pixels"})"}")
      }
    }
    val gauss = PhotoFaceCodec.gaussSwitch(state.screen.gaussianColour)
    log("save fields: position=${config.timePosition} style=${config.timeStyle} font=${config.font} top=${config.positionIndex}/${config.styleIndex} gauss=$gauss")
    return PhotoSaveFields(config, gauss, colours)
  }

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, "Photo face: $message")

  private suspend fun state(watchfaces: WatchfaceOps, photos: PhotoFaceOps): PhotoFaceState {
    val list = watchfaces.list()
    val face = list.faces.firstOrNull { it.isPhoto } ?: throw noPhotoFace()
    val screen = list.screen ?: throw WearException(ErrorCodes.UNSUPPORTED, "The watch did not report its screen size, so photos cannot be cropped for it.")
    val info = photos.readInfo()
    store.keepOnly(info.photos.map { it.name })
    return PhotoFaceState(face, info, screen.width, screen.height, list.updatedAtMs, screen)
  }

  /** `PhotoFace` in `HuaweiWearPhotoFace.types.ts`; [applyError] is set by [add] / [delete] when the apply after the save failed. */
  private fun PhotoFaceState.toJs(applyError: String? = null): Map<String, Any?> = mapOf(
    "face" to face.toJs(),
    "width" to width,
    "height" to height,
    "maxPhotos" to info.maxPhotos,
    "imageOption" to info.imageOption,
    "backgroundType" to info.backgroundType,
    "intellectColour" to info.intellectColour,
    "positionIndex" to info.positionIndex,
    "styleIndex" to info.styleIndex,
    "dataIndex" to info.dataIndex,
    "photos" to info.photos.map { mapOf("index" to it.index, "name" to it.name, "uri" to store.uri(it.name)) },
    "updatedAt" to updatedAtMs,
    "applyError" to applyError,
  )

  private fun noPhotoFace() = WearException(
    ErrorCodes.UNSUPPORTED,
    "The watch has no photo watch face. Install a photo face (type bit 5 in the watch's face list, e.g. the Gallery face) from Huawei's store first.",
  )

  /** `<epoch millis>.png`, bumped until it differs from every name on the watch. */
  private fun freshName(existing: List<String>): String {
    var stamp = System.currentTimeMillis()
    while ("$stamp.png" in existing) stamp++
    return "$stamp.png"
  }

  /** The pixels of [png] as `Bitmap.getPixels` returns them; the size must be exactly the face's. */
  private fun decode(png: ByteArray, width: Int, height: Int): IntArray {
    val bitmap = BitmapFactory.decodeByteArray(png, 0, png.size, BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.ARGB_8888 })
      ?: throw WearException(ErrorCodes.INVALID_ARGUMENT, "The photo could not be decoded as an image.")
    try {
      if (bitmap.width != width || bitmap.height != height) {
        throw WearException(
          ErrorCodes.INVALID_ARGUMENT,
          "The photo is ${bitmap.width} x ${bitmap.height} px; the watch's photo face needs exactly $width x $height px. Crop it first.",
        )
      }
      val pixels = IntArray(width * height)
      bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
      return pixels
    } finally {
      bitmap.recycle()
    }
  }

  private suspend fun <T> withWatch(block: suspend (WatchfaceOps, PhotoFaceOps) -> T): T {
    val handle = link.handle() ?: throw notConnected()
    return handle.operationLock.withLock {
      val current = link.handle()
      if (current == null || current.session !== handle.session) throw notConnected()
      block(WatchfaceOps(handle.session, events), PhotoFaceOps(handle.session, events))
    }
  }

  private fun notConnected() = WearException(ErrorCodes.NOT_CONNECTED, "Not connected to a watch")

  private fun readUri(uri: String): ByteArray {
    try {
      val stream = context.contentResolver.openInputStream(Uri.parse(uri))
        ?: throw WearException(ErrorCodes.INVALID_ARGUMENT, "Could not open $uri")
      return stream.use {
        val out = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(16384)
        while (true) {
          val n = it.read(buffer)
          if (n < 0) break
          out.write(buffer, 0, n)
          if (out.size() > MAX_PHOTO_BYTES) throw WearException(ErrorCodes.INVALID_ARGUMENT, "The photo is larger than ${MAX_PHOTO_BYTES / 1_000_000} MB.")
        }
        out.toByteArray()
      }
    } catch (e: IOException) {
      throw WearException(ErrorCodes.INVALID_ARGUMENT, "Could not read $uri: ${e.message}", e)
    } catch (e: SecurityException) {
      throw WearException(ErrorCodes.INVALID_ARGUMENT, "No permission to read $uri", e)
    }
  }

  private companion object {
    const val PROGRESS_INTERVAL_MS = 100L
    const val MAX_PHOTO_BYTES = 16_000_000
  }
}
