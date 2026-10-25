package com.joyodigitama.huaweiwear

import android.content.Context
import android.net.Uri
import java.io.IOException
import java.security.MessageDigest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/**
 * The offline-map lab (docs/offline-maps.md, "Lab"): sends an OSM-built `offvmp` map file the user picked to the watch over the mapkit P2P
 * module, the way Huawei Health does with its own maps, and lists and deletes maps on the watch. Behind the experimental switch
 * [P2pSettings.offlineMapLab] (off by default); with it off nothing registers and every call refuses. Every step and frame is logged
 * (`Mapkit:` lines, also in logcat under the `JoyoFit` tag). Twin: `OfflineMapLab.swift`.
 *
 * The send: ping `in.huawei.mapkit` (0xca = there) → `01` free space → `03` list (update flag when the id is already there) → `04` handshake
 * (size MB, type, update, msgId) and its `0C` code → the file over FileUpload 28 as P2P file type 7 named `<id>.bin` (the watch checks the
 * SHA-256) → the watch's `08` parse result within Huawei Health's budget (5 s per MB + 30 s).
 */
internal class OfflineMapLab(
  context: Context,
  private val settings: P2pSettings,
  private val link: WearLink,
  private val events: WearEvents,
  private val scope: CoroutineScope,
  private val stack: () -> P2pStack?,
) {
  private val appContext = context.applicationContext
  private val busy = Mutex()

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, "Mapkit: $message")

  private fun service(current: P2pStack?): MapkitService? = current?.manager?.getRegisteredService(MapkitWire.MODULE) as? MapkitService

  fun status(): Map<String, Any?> {
    val current = stack()
    val service = service(current)
    val parsed = service?.lastParsed
    return mapOf(
      "enabled" to settings.offlineMapLab,
      "p2p" to (current != null),
      "gateMap" to DeviceCaps.expandCapability(BIT_MAP),
      "gateContour" to DeviceCaps.expandCapability(BIT_CONTOUR),
      "gateAutoDownload" to DeviceCaps.expandCapability(BIT_AUTO_DOWNLOAD),
      "registered" to (service != null),
      "pingCode" to service?.pingCode,
      "politicalView" to MapkitWire.POLITICAL_VIEW,
      "politicalViewResult" to service?.politicalViewResult,
      "lastParsed" to parsed?.let { parsedJs(it) + ("at" to service?.lastParsedAt) },
    )
  }

  /** Switching on registers the module now when connected; switching off takes full effect at the next connect (every call refuses at once). */
  fun setEnabled(enabled: Boolean) {
    settings.offlineMapLab = enabled
    log("lab switch ${if (enabled) "on" else "off"}")
    if (enabled) stack()?.let { attach(it) }
  }

  /** Called on every new P2P stack: registers the mapkit module when the switch is on and the watch sets ExpandCapability 201. */
  fun attach(current: P2pStack) {
    if (!settings.offlineMapLab || !DeviceCaps.supports(0x34, 0x01)) return
    val gate = DeviceCaps.expandCapability(BIT_MAP)
    log("ExpandCapability 201 (offline map)=$gate 202 (contour)=${DeviceCaps.expandCapability(BIT_CONTOUR)} 284 (auto download)=${DeviceCaps.expandCapability(BIT_AUTO_DOWNLOAD)} 317 (ski)=${DeviceCaps.expandCapability(BIT_SKI)}")
    if (!gate) {
      log("the watch does not set ExpandCapability 201; mapkit not registered")
      return
    }
    if (service(current) == null) MapkitService(current.manager, events, scope).register()
  }

  /** The registered service of this link, after its ping answered (or [PING_WAIT_MS] passed). Refuses while the switch is off. */
  private suspend fun ready(): Pair<LinkHandle, MapkitService> {
    if (!settings.offlineMapLab) throw WearException(ErrorCodes.UNSUPPORTED, "Offline maps are a lab feature; switch them on under Experimental first")
    val handle = link.handle() ?: throw WearException(ErrorCodes.NOT_CONNECTED, "Not connected to a watch")
    val current = stack() ?: throw WearException(ErrorCodes.UNSUPPORTED, "The watch does not list the P2P service (34/01)")
    if (!DeviceCaps.expandCapability(BIT_MAP)) {
      throw WearException(ErrorCodes.UNSUPPORTED, "The watch does not set ExpandCapability 201, the offline-map bit Huawei Health checks")
    }
    attach(current)
    val service = service(current) ?: throw WearException(ErrorCodes.UNSUPPORTED, "The mapkit module could not be registered")
    withTimeoutOrNull(PING_WAIT_MS) { while (service.pingCode == null) delay(100) }
    val ping = service.pingCode
    log("ping of ${MapkitWire.PACKAGE} -> ${ping?.let { "0x%02x".format(it and 0xFF) } ?: "no answer in $PING_WAIT_MS ms"}")
    if (ping != null && (ping and 0xFF) != PING_THERE) {
      throw WearException(ErrorCodes.UNSUPPORTED, "The watch's map app did not answer the ping (0x%02x, expected 0xca)".format(ping and 0xFF), statusCode = ping and 0xFF)
    }
    return handle to service
  }

  /**
   * Sends [frame] and returns the first non-null [pick] of the watch's frames within [timeoutMs], or null. [pick] sees every decoded frame
   * (the list and delete answers come in several).
   */
  private suspend fun <T : Any> exchange(service: MapkitService, frame: ByteArray, timeoutMs: Long, pick: (MapkitMessage) -> T?): T? {
    val inbox = Channel<MapkitMessage>(Channel.UNLIMITED)
    val subscription = service.subscribe { inbox.trySend(it) }
    try {
      service.send(frame)
      return withTimeoutOrNull(timeoutMs) {
        var found: T? = null
        for (message in inbox) {
          found = pick(message)
          if (found != null) break
        }
        found
      }
    } finally {
      subscription.close()
      inbox.close()
    }
  }

  private suspend fun queryFreeSpace(service: MapkitService): Long? =
    exchange(service, MapkitWire.freeSpaceQuery(), ANSWER_WAIT_MS) { it as? MapkitMessage.FreeSpace }?.value

  private class Listing(val maps: List<MapkitMap>, val total: Int?, val complete: Boolean)

  private suspend fun queryList(service: MapkitService): Listing {
    val msgId = service.nextMsgId()
    val maps = mutableListOf<MapkitMap>()
    var total: Int? = null
    val done = exchange(service, MapkitWire.listQuery(msgId), LIST_WAIT_MS) { message ->
      if (message !is MapkitMessage.MapList) return@exchange null
      if (message.msgId != null && message.msgId != msgId.toLong()) return@exchange null
      maps += message.maps
      total = message.total
      val expected = message.total ?: 0
      if (expected == 0 || (message.frames ?: 1) <= 1 || maps.size >= expected) true else null
    }
    log("list: ${maps.size} of ${total ?: "?"} maps${if (done == null) " (incomplete after ${LIST_WAIT_MS / 1000} s)" else ""}: " +
      maps.joinToString { "${it.id} type ${it.type} version ${it.version ?: "?"}" })
    return Listing(maps, total, done != null)
  }

  /** One map operation at a time: a second one while a send runs (minutes) fails at once instead of queueing behind it. */
  private suspend fun <T> exclusive(block: suspend () -> T): T {
    if (!busy.tryLock()) throw WearException(ErrorCodes.BUSY, "Another map operation is running")
    try {
      return block()
    } finally {
      busy.unlock()
    }
  }

  suspend fun freeSpace(): Map<String, Any?> = exclusive {
    val (_, service) = ready()
    val value = queryFreeSpace(service)
    log("free space: ${value ?: "no answer in ${ANSWER_WAIT_MS / 1000} s"} (KiB per huac, MB per Huawei Health; unverified)")
    mapOf("value" to value)
  }

  suspend fun list(): Map<String, Any?> = exclusive {
    val (_, service) = ready()
    val listing = queryList(service)
    mapOf("maps" to listing.maps.map { mapJs(it) }, "total" to listing.total, "complete" to listing.complete)
  }

  /** Reads and checks the picked file without sending it. */
  suspend fun inspect(uri: String, name: String): Map<String, Any?> {
    val (file, bytes, header) = load(uri, name)
    return fileJs(file, bytes, header)
  }

  suspend fun send(uri: String, name: String): Map<String, Any?> = exclusive {
    val (file, bytes, header) = load(uri, name)
    val (handle, service) = ready()
    val info = fileJs(file, bytes, header)
    log("send ${file.fileName}: ${bytes.size} bytes (${info["sizeMb"]} MB), offvmp version ${header.version}, region \"${header.region}\", zooms ${header.zooms}, sha256 ${info["sha256"]}")

    val free = queryFreeSpace(service)
    log("free space before: ${free ?: "no answer"} (file ${bytes.size / 1024} KiB)")
    val listing = queryList(service)
    val update = listing.maps.any { it.id == file.mapId && it.type == file.mapType }
    val sizeMb = MapkitWire.sizeMb(bytes.size.toLong())
    val budget = MapkitWire.parseBudgetMs(sizeMb)

    // The parse result can arrive right after the upload: listen from the handshake on.
    val parsedInbox = Channel<MapkitMessage.Parsed>(Channel.UNLIMITED)
    val subscription = service.subscribe { if (it is MapkitMessage.Parsed) parsedInbox.trySend(it) }
    try {
      val started = System.currentTimeMillis()
      val uploaded = handle.operationLock.withLock {
        val msgId = service.nextMsgId()
        val answer = exchange(service, MapkitWire.handshake(sizeMb, file.mapType, update, msgId), HANDSHAKE_WAIT_MS) { it as? MapkitMessage.Handshake }
        val code = answer?.code
        log("handshake (size $sizeMb MB, type ${file.mapType}, update $update, msgId $msgId) -> ${code?.let { "0C=$it (${handshakeText(it)})" } ?: "no answer in ${HANDSHAKE_WAIT_MS / 1000} s"}")
        if (answer == null) throw WearException(ErrorCodes.TIMEOUT, "The watch did not answer the map handshake within ${HANDSHAKE_WAIT_MS / 1000} s")
        if (code != 0) throw WearException(ErrorCodes.UPLOAD_REJECTED, "The watch refused the map: ${handshakeText(code)}", statusCode = code)

        val route = P2pRoute(MapkitWire.MODULE, MapkitWire.PACKAGE, service.localFingerprint, MapkitWire.FINGERPRINT)
        var lastLogged = 0L
        FileUploader(handle.session, events, { done, total ->
          events.uploadProgress(done, total)
          val now = System.currentTimeMillis()
          if (now - lastLogged >= PROGRESS_LOG_MS || done >= total) {
            lastLogged = now
            log("upload $done / $total bytes after ${(now - started) / 1000} s")
          }
        }).upload(UploadFile(file.fileName, FILE_TYPE_P2P, bytes, route))
      }
      val uploadMs = System.currentTimeMillis() - started
      val rate = if (uploadMs > 0) bytes.size * 1000L / uploadMs else null
      log("upload finished in ${uploadMs / 1000} s (${rate ?: "?"} B/s), 28/07 status ${uploaded.resultStatus ?: "none"}; waiting for the watch's parse result (budget ${budget / 1000} s)")

      val parseStart = System.currentTimeMillis()
      val parsed = withTimeoutOrNull(budget) {
        var found: MapkitMessage.Parsed? = null
        for (message in parsedInbox) {
          if (message.mapId == null || message.mapId == file.mapId) {
            found = message
            break
          }
        }
        found
      }
      val parseMs = System.currentTimeMillis() - parseStart
      log(
        if (parsed == null) "no parse result (08) within ${budget / 1000} s"
        else "parse result after ${parseMs / 1000} s: map ${parsed.mapId} type ${parsed.mapType} code ${parsed.code} (${if (parsed.code == 0) "the watch took the map" else "the watch could not read the map"})",
      )
      mapOf(
        "file" to info,
        "update" to update,
        "freeSpace" to free,
        "handshakeCode" to 0,
        "uploadStatus" to uploaded.resultStatus,
        "uploadMs" to uploadMs,
        "bytesPerSecond" to rate,
        "parsed" to parsed?.let { parsedJs(it) },
        "parseMs" to if (parsed != null) parseMs else null,
        "parseBudgetMs" to budget,
      )
    } finally {
      subscription.close()
      parsedInbox.close()
    }
  }

  suspend fun delete(mapId: String, mapType: Int): Map<String, Any?> = exclusive {
    val id = mapId.toULongOrNull() ?: throw WearException(ErrorCodes.INVALID_ARGUMENT, "Map id must be a decimal number, got '$mapId'")
    if (mapType !in 0..3) throw WearException(ErrorCodes.INVALID_ARGUMENT, "Map type must be 0 to 3, got $mapType")
    val (_, service) = ready()
    val msgId = service.nextMsgId()
    val answer = exchange(service, MapkitWire.delete(listOf(id to mapType), msgId), ANSWER_WAIT_MS) { message ->
      (message as? MapkitMessage.Delete)?.takeIf { it.msgId == null || it.msgId == msgId.toLong() }
    }
    val result = answer?.maps?.firstOrNull { it.id == id }?.result
    log("delete $id type $mapType -> ${answer?.let { "12=${result ?: "none"} (0 = deleted)" } ?: "no answer in ${ANSWER_WAIT_MS / 1000} s"}")
    mapOf("mapId" to mapId, "mapType" to mapType, "answered" to (answer != null), "code" to result)
  }

  private data class Loaded(val file: OfflineMapFile, val bytes: ByteArray, val header: OffvmpHeader)

  private suspend fun load(uri: String, name: String): Loaded {
    val file = MapkitWire.fileOf(name)
      ?: throw WearException(ErrorCodes.INVALID_ARGUMENT, "The file must be named <map id>.bin, <map id>_contour.bin or global.bin (got '$name'): the watch takes the map id from the name")
    val bytes = withContext(Dispatchers.IO) { readUri(uri) }
    val header = MapkitWire.header(bytes)
      ?: throw WearException(ErrorCodes.INVALID_ARGUMENT, "'$name' is not an offvmp map (no offvmp header)")
    return Loaded(file, bytes, header)
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
          if (out.size() > MAX_FILE_BYTES) {
            throw WearException(ErrorCodes.INVALID_ARGUMENT, "The lab sends maps up to ${MAX_FILE_BYTES / 1024 / 1024} MiB (the upload holds the file in memory)")
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

  companion object {
    /** ExpandCapability bits of Huawei Health's map SDK (`consts/a.java:7`). */
    const val BIT_MAP = 201
    const val BIT_CONTOUR = 202
    const val BIT_AUTO_DOWNLOAD = 284
    const val BIT_SKI = 317

    const val PING_THERE = 0xCA
    const val PING_WAIT_MS = 4_000L
    const val ANSWER_WAIT_MS = 10_000L
    const val LIST_WAIT_MS = 10_000L
    const val HANDSHAKE_WAIT_MS = 15_000L
    const val PROGRESS_LOG_MS = 10_000L
    const val MAX_FILE_BYTES = 64 * 1024 * 1024

    /** GB uses file type 7 for every P2P file. */
    const val FILE_TYPE_P2P: Byte = 7

    fun handshakeText(code: Int?): String = when (code) {
      0 -> "go on"
      1 -> "not enough space on the watch"
      2 -> "the watch has this version already"
      3 -> "the map is in use on the watch"
      4 -> "device error"
      MapkitWire.CODE_NO_NETWORK -> "no network"
      null -> "no code"
      else -> "code $code"
    }

    fun mapJs(map: MapkitMap): Map<String, Any?> = mapOf(
      "mapId" to map.id.toString(),
      "mapType" to map.type,
      "version" to map.version,
      "downloadType" to map.downloadType,
    )

    fun parsedJs(parsed: MapkitMessage.Parsed): Map<String, Any?> = mapOf(
      "mapId" to parsed.mapId?.toString(),
      "mapType" to parsed.mapType,
      "code" to parsed.code,
    )

    private fun fileJs(file: OfflineMapFile, bytes: ByteArray, header: OffvmpHeader): Map<String, Any?> = mapOf(
      "fileName" to file.fileName,
      "mapId" to file.mapId.toString(),
      "mapType" to file.mapType,
      "bytes" to bytes.size,
      "sizeMb" to MapkitWire.sizeMb(bytes.size.toLong()),
      "formatVersion" to header.version,
      "region" to header.region,
      "zooms" to header.zooms,
      "sha256" to MessageDigest.getInstance("SHA-256").digest(bytes).toHex(),
    )
  }
}
