// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): service/devices/huawei/HuaweiWatchfaceManager
// (requestWatchfaceList, updateWatchfaceNames, setWatchface, deleteWatchface, getFullFileName) and
// requests/{GetWatchfaceParams,GetWatchfacesList,GetWatchfacesNames,SendWatchfaceOperation}.
//
// The install flow follows Huawei Health 17.0.8.300 (RE of its "install from a .hwt file" path):
// com.huawei.watchface.f2.{b,a} (local install), HwWatchFaceBtManager.{sendOperateType,handleApply,getDeviceInfo,
// handleDeviceInfoTlv} and WatchFaceWearService.sendWatchFace. GB uploads without announcing the face; Huawei Health
// always sends 27/03 first.
package com.joyodigitama.huaweiwear

import android.content.Context
import android.net.Uri
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Watchface

/** What the watch reports about watch faces in 0x27/0x01 (GB `WatchfaceDeviceParams`). */
internal class WatchfaceScreen(
  val maxVersion: String,
  val width: Int,
  val height: Int,
  val supportFileType: Int,
  val sort: Int,
  val otherVersions: String,
  /** Tag 0x11, Huawei Health's `supportCapability` bit field; -1 when the watch did not send it. */
  val supportCapability: Int = -1,
  /** Tag 0x17, -1 when absent. */
  val supportSync: Int = -1,
  /** Tag 0x18 (0 = GT mode, 1 = AP mode), -1 when absent. */
  val mode: Int = -1,
  /** Tag 0x1a, Huawei Health `supportGaussianColor`; -1 when absent. */
  val gaussianColour: Int = -1,
  /** Tag 0x1b, Huawei Health `supportAestheticAlbumColor` (1 = a photo's time colour is picked from the photo); -1 when absent. */
  val aestheticAlbumColour: Int = -1,
) {
  /** Huawei Health `isSupportWatchfaceSignature`: capability bit 3 (value 8). */
  val supportsSignature: Boolean get() = supportCapability >= 0 && (supportCapability and CAPABILITY_SIGNATURE) != 0

  /** Huawei Health `isSupportDialUnite`: capability bit 2 (value 4). */
  val supportsDialUnite: Boolean get() = supportCapability >= 0 && (supportCapability and CAPABILITY_DIAL_UNITE) != 0

  companion object {
    const val CAPABILITY_DIAL_UNITE = 4
    const val CAPABILITY_SIGNATURE = 8
  }
}

/** One entry of the watch's face list (GB `InstalledWatchfaceInfo`) with the name from 0x27/0x06. */
internal class WatchfaceEntry(
  /** GB `fileName`: the number the watch knows the face by, without the version. */
  val id: String,
  val version: String,
  val name: String,
  val type: Int,
  val expandedType: Int,
) {
  val isCurrent: Boolean get() = (type and 1) == 1
  val isFactory: Boolean get() = ((type shr 1) and 1) == 1
  val isEditable: Boolean get() = ((type shr 3) and 1) == 1
  val isVideo: Boolean get() = ((type shr 4) and 1) == 1
  val isPhoto: Boolean get() = ((type shr 5) and 1) == 1
  val isTryout: Boolean get() = ((type shr 6) and 1) == 1
  val isKaleidoscope: Boolean get() = ((type shr 7) and 1) == 1

  fun toJs(): Map<String, Any?> = mapOf(
    "id" to id,
    "version" to version,
    "name" to name,
    "active" to isCurrent,
    "factory" to isFactory,
    "editable" to isEditable,
    "video" to isVideo,
    "photo" to isPhoto,
    "tryout" to isTryout,
    "kaleidoscope" to isKaleidoscope,
  )
}

/** `WatchfaceList` in `HuaweiWearWatchface.types.ts`. */
internal class WatchfaceList(
  val screen: WatchfaceScreen?,
  val faces: List<WatchfaceEntry>,
  val updatedAtMs: Long,
) {
  fun toJs(): Map<String, Any?> = mapOf(
    "width" to screen?.width,
    "height" to screen?.height,
    "maxVersion" to screen?.maxVersion,
    "requiresSignature" to screen?.takeIf { it.supportCapability >= 0 }?.supportsSignature,
    "faces" to faces.map { it.toJs() },
    "updatedAt" to updatedAtMs,
  )
}

/** `WatchfaceInstallResult` in `HuaweiWearWatchface.types.ts`. */
internal class InstallResult(
  val fileName: String,
  val id: String,
  val version: String,
  val name: String,
  val bytes: Int,
  /** Tag 0x02 of the watch's 0x28/0x07 packet (not interpreted by GB). */
  val uploadStatus: Int?,
  /** `reportType` of the watch's 0x27/0x05 confirmation. */
  val confirmReportType: Int?,
  /** The new face is in the watch's list after the upload. */
  val listed: Boolean,
  /** The new face is the active one after the upload. */
  val active: Boolean,
  val message: String,
  val list: WatchfaceList?,
) {
  fun toJs(): Map<String, Any?> = mapOf(
    "fileName" to fileName,
    "id" to id,
    "version" to version,
    "name" to name,
    "bytes" to bytes,
    "uploadStatus" to uploadStatus,
    "confirmReportType" to confirmReportType,
    "listed" to listed,
    "active" to active,
    "message" to message,
    "list" to list?.toJs(),
  )
}

/** GB `Watchface.WatchfaceOperation.Request` without its `split("_")[1]`, which throws for a face without a version. */
internal fun watchfaceOperationPacket(params: HuaweiPacket.ParamsProvider, fileName: String, operation: Byte): HuaweiPacket {
  val separator = fileName.indexOf('_')
  val id = if (separator < 0) fileName else fileName.substring(0, separator)
  val version = if (separator < 0) "" else fileName.substring(separator + 1)
  return watchfaceOperationPacket(params, id, version, operation)
}

internal fun watchfaceOperationPacket(
  params: HuaweiPacket.ParamsProvider,
  id: String,
  version: String,
  operation: Byte,
  signature: String? = null,
): HuaweiPacket = HuaweiPacket(params).also {
  it.serviceId = Watchface.id
  it.commandId = Watchface.WatchfaceOperation.id
  val tlv = HuaweiTLV().put(0x01, id).put(0x02, version).put(0x03, operation)
  // Huawei Health sends the whole getresourcesign response string in tag 0x08 of the announcement
  // (HwWatchFaceBtManager.setWatchfaceSignature). The activation that follows carries no signature.
  if (signature != null) tlv.put(0x08, signature)
  it.setTlv(tlv)
}

/**
 * Whether a 27/03 answer's status (tag 0x7f, null when absent) means the watch took the operation. Huawei Health reads a missing
 * 0x7f as 0 (`WatchFaceDeviceService.handleApply`) and counts 0 and 100000 as success (`WatchFaceWearService.isSuccessErrorCode`);
 * the Fit 4 Pro answers an apply of its photo face with 0 (2026-10-25).
 */
internal fun operationAccepted(code: Int?): Boolean = code == null || code == 0 || code == UPLOAD_OK

/** Huawei Health `WatchFaceWearService.isSignFailErrorCode`. */
internal val SIGNATURE_FAILURE_CODES = setOf(100007, 100014)

/** The watch's answer to the 27/03 that announces a face before its upload; null for a field the watch did not send. */
internal class Announcement(val code: Int?, val needReceive: Int?)

/**
 * Huawei Health's reading of a refused announcement (`WatchFaceWearService.isSignFailErrorCode`: 100007 and 100014;
 * `HwWatchFaceBtManager.dealReport` passes 100015 on to its UI as well).
 */
internal fun describeAnnounceCode(code: Int): String = when (code) {
  100007, 100014 ->
    "The watch refused the face before the upload (code $code). Huawei Health treats 100007 and 100014 as a watch face " +
      "signature failure: it fetches a signature for the face from Huawei's servers and sends it in this request, which " +
      "JoyoFit cannot do."
  100015 -> "The watch refused the face before the upload (code 100015). Huawei Health shows this code in its own UI; its meaning is not documented."
  else -> "The watch refused the face before the upload with code $code; what it means is not documented."
}

/**
 * Watch face list, set active, delete and install over the 0x27 / 0x28 services, on a connected
 * [session]. The callers serialize these with the link's operation lock.
 */
internal class WatchfaceOps(
  private val session: HuaweiSession,
  private val events: WearEvents,
  private val uploadStallMs: Long = FileUploader.STALL_MS,
  private val confirmWaitMs: Long = FileUploader.CONFIRM_WAIT_MS,
  private val settleMs: Long = FileUploader.SETTLE_MS,
  private val queryMs: Long = Timeouts.QUERY_MS,
) {
  private val params get() = session.params

  /** The watch lists its commands and service 0x27 is not among them (an empty list means "not known yet"). */
  private fun watchfaceServiceMissing(): Boolean =
    DeviceCaps.supportedCommands.isNotEmpty() && !DeviceCaps.supportedCommands.containsKey(Watchface.id.toInt())

  private fun requireService() {
    if (watchfaceServiceMissing()) {
      throw WearException(ErrorCodes.UNSUPPORTED, "The watch does not list the watch face service (0x27) in its supported commands")
    }
  }

  /** GB GetWatchfaceParams, gated by `supportsWatchfaceParams` (SupportedCommands 0x27/0x01). Null when not supported or not answered. */
  suspend fun readScreen(): WatchfaceScreen? {
    if (!DeviceCaps.supports(Watchface.id.toInt(), Watchface.WatchfaceParams.id.toInt())) {
      log("WatchfaceParams not requested: the watch does not list 27/01 (GB gate supportsWatchfaceParams)")
      return null
    }
    val response = try {
      session
        .request(Watchface.WatchfaceParams.Request(params), queryMs, "WatchfaceParams")
        .expect<Watchface.WatchfaceParams.Response>("WatchfaceParams")
    } catch (e: CancellationException) {
      throw e
    } catch (e: WearException) {
      if (e.errorCode == ErrorCodes.DISCONNECTED) throw e
      log("WatchfaceParams failed: ${e.message}", error = true)
      return null
    }
    val p = response.params
    log("WatchfaceParams TLV: ${describeTlv(response.getTlv())}")
    log(
      "WatchfaceParams: width=${p.width} height=${p.height} (screen ${p.height}*${p.width}) maxVersion=${p.maxVersion} " +
        "supportFileType=${p.supportFileType.toInt()} sort=${p.sort.toInt()} otherWatchfaceVersions=${p.otherWatchfaceVersions} " +
        "capability=${if (p.supportCapability >= 0) "0x" + p.supportCapability.toString(16) else "not sent"} " +
        "supportSync=${if (p.supportSync >= 0) p.supportSync else "not sent"} mode=${if (p.mode >= 0) p.mode else "not sent"}",
    )
    val screen = WatchfaceScreen(
      p.maxVersion, p.width, p.height, p.supportFileType.toInt(), p.sort.toInt(), p.otherWatchfaceVersions,
      p.supportCapability, p.supportSync, p.mode, p.gaussianColor, p.aestheticAlbumColor,
    )
    if (p.supportCapability >= 0) {
      log("WatchfaceParams capability: watch face signature=${screen.supportsSignature} (bit 8), dial unite=${screen.supportsDialUnite} (bit 4)")
    }
    return screen
  }

  /** GB requestWatchfaceList + updateWatchfaceNames: 0x27/0x02, then 0x27/0x06 for the names. */
  suspend fun list(): WatchfaceList {
    requireService()
    val screen = readScreen()
    val info = session
      .request(Watchface.DeviceWatchInfo.Request(params), queryMs, "WatchfaceList")
      .expect<Watchface.DeviceWatchInfo.Response>("WatchfaceList")
    val installed = info.watchfaceInfoList ?: emptyList()
    val names: Map<String, String> = if (installed.isEmpty()) {
      emptyMap()
    } else {
      try {
        session
          .request(Watchface.WatchfaceNameInfo.Request(params, installed), queryMs, "WatchfaceNames")
          .expect<Watchface.WatchfaceNameInfo.Response>("WatchfaceNames")
          .watchFaceNames
      } catch (e: CancellationException) {
        throw e
      } catch (e: WearException) {
        if (e.errorCode == ErrorCodes.DISCONNECTED) throw e
        log("WatchfaceNames failed, listing by id: ${e.message}", error = true)
        emptyMap()
      }
    }
    val faces = installed.map {
      val name = names[it.fileName]?.takeIf { n -> n.isNotBlank() } ?: it.fileName
      WatchfaceEntry(it.fileName, it.version, name, it.type.toInt() and 0xFF, it.expandedType.toInt() and 0xFF)
    }
    for (face in faces) {
      log(
        "WatchfaceList: ${face.id}_${face.version} \"${face.name}\" type=0x${face.type.toString(16)} expanded=0x${face.expandedType.toString(16)}" +
          (if (face.isCurrent) " [active]" else "") + (if (face.isFactory) " [factory]" else ""),
      )
    }
    log("WatchfaceList: ${faces.size} watch face(s)")
    return WatchfaceList(screen, faces, System.currentTimeMillis())
  }

  /** GB `HuaweiWatchfaceManager.setWatchface`, then the list again to check that it took. */
  suspend fun setActive(id: String): WatchfaceList {
    val face = find(list(), id)
    val code = operation(face, Watchface.WatchfaceOperation.operationActive, "active")
    val after = list()
    if (after.faces.firstOrNull { it.id == id }?.isCurrent != true) {
      throw WearException(
        ErrorCodes.UPLOAD_REJECTED,
        "The watch did not make \"${face.name}\" active" + (code?.let { " (it answered $it)" } ?: " (it sent no status)") + ".",
        statusCode = code,
      )
    }
    return after
  }

  /**
   * 27/03 operation 1 for [face] as listed, also when it is the current face, without listing before or after; the watch's status
   * (tag 0x7f) or null when it sends none. Huawei Health sends this after every photo face save: the Apply button of its My watch
   * faces page saves the album (27/09 and the photo upload), then calls `applyWatchFace`, which is this packet
   * (`OperateWatchFaceService.sendApplyWatchFaceCommand`). See protocol/README.md, "Photo faces".
   */
  suspend fun apply(face: WatchfaceEntry): Int? = operation(face, Watchface.WatchfaceOperation.operationActive, "apply")

  /** GB `HuaweiWatchfaceManager.deleteWatchface`, then the list again to check that it is gone. */
  suspend fun delete(id: String): WatchfaceList {
    val face = find(list(), id)
    val code = operation(face, Watchface.WatchfaceOperation.operationDelete, "delete")
    val after = list()
    if (after.faces.any { it.id == id }) {
      throw WearException(
        ErrorCodes.UPLOAD_REJECTED,
        "The watch did not delete \"${face.name}\"" + (code?.let { " (it answered $it)" } ?: " (it sent no status)") + ".",
        statusCode = code,
      )
    }
    return after
  }

  private fun find(list: WatchfaceList, id: String): WatchfaceEntry =
    list.faces.firstOrNull { it.id == id }
      ?: throw WearException(ErrorCodes.INVALID_ARGUMENT, "The watch has no watch face with id '$id'")

  /** The status the watch answers with (tag 0x7f), or null when it sends none. */
  private suspend fun operation(face: WatchfaceEntry, operation: Byte, what: String): Int? {
    val label = "WatchfaceOperation $what ${face.id}_${face.version}"
    val answer = session.request(watchfaceOperationPacket(params, face.id, face.version, operation), queryMs, label)
    val code = (answer as? Watchface.WatchfaceOperation.Response)?.code?.takeIf { it >= 0 }
    log("$label: watch answered ${code ?: "without a status"} TLV ${describeTlv(answer.getTlv())}")
    return code
  }

  /**
   * Huawei Health sends 27/03 (id, version, operation 1) before it uploads anything (`applyWatchFace` ->
   * `OperateWatchFaceService.sendApplyWatchFaceCommand`, then `transferFile` straight after, without waiting).
   * The watch answers with a status (tag 0x7f: absent or 100000 is fine) and `needReceive` (tag 0x04: 1 = send the
   * file, 0 = it has this face already). GB does not send it. A status other than success ends the install here.
   */
  private suspend fun announce(id: String, version: String, signature: String? = null): Announcement {
    val label = "WatchfaceOperation announce ${id}_$version" + (if (signature != null) " (with signature)" else "")
    val packet = watchfaceOperationPacket(params, id, version, Watchface.WatchfaceOperation.operationActive, signature)
    log("$label TLV before encryption: ${describeTlv(packet.getTlv())}")
    val answer = try {
      session.request(packet, queryMs, label)
    } catch (e: CancellationException) {
      throw e
    } catch (e: WearException) {
      if (e.errorCode != ErrorCodes.TIMEOUT) throw e
      log("$label: no answer from the watch; Huawei Health does not wait for one either, uploading anyway")
      return Announcement(null, null)
    }
    val response = answer as? Watchface.WatchfaceOperation.Response
    val code = response?.code?.takeIf { it >= 0 }
    val needReceive = response?.needReceive?.takeIf { it >= 0 }
    log("$label: watch answered status=${code ?: "none"} needReceive=${needReceive ?: "none"} TLV ${describeTlv(answer.getTlv())}")
    if (code != null && !operationAccepted(code)) {
      throw WearException(ErrorCodes.UPLOAD_REJECTED, describeAnnounceCode(code), statusCode = code)
    }
    return Announcement(code, needReceive)
  }

  /**
   * The Huawei Health flow for a face from a file (`com.huawei.watchface.f2`): check the face against the watch's
   * screen and version range, announce it with 27/03, upload it as file type 1 under `<id>_<version>`, wait for the
   * watch's 27/05 confirmation, then ask for the face list to see whether the face arrived.
   */
  suspend fun install(
    pkg: WatchfacePackage,
    progress: (bytes: Int, total: Int) -> Unit,
    fileName: String = WatchfacePackages.randomName(version = pkg.description.version),
    signature: String? = null,
  ): InstallResult {
    requireService()
    val description = pkg.description
    val separator = fileName.indexOf('_')
    val id = fileName.substring(0, separator)
    val version = fileName.substring(separator + 1)
    log(
      "Install \"${description.title}\" v${description.version} by ${description.author} (theme ${description.screen}, " +
        "${WatchfaceResolutions.screenByThemeVersion(description.screen)}, ${pkg.binary.size} bytes) as $fileName",
    )
    val screen = readScreen()
    if (screen != null) {
      WatchfacePackages.checkResolution(description, screen.height, screen.width) { log(it) }
      WatchfacePackages.checkVersion(description, screen.maxVersion, screen.otherVersions) { log(it) }
    } else {
      log("the watch's screen size is unknown; the package is not checked against it")
    }

    val announcement = announce(id, version, signature)
    val outcome = if (announcement.needReceive == 0) {
      log("the watch reports it has ${id}_$version already (needReceive=0); nothing is uploaded")
      null
    } else {
      FileUploader(session, events, progress, uploadStallMs, confirmWaitMs, settleMs)
        .upload(UploadFile(fileName, FILE_TYPE_WATCHFACE, pkg.binary))
    }

    val after = try {
      list()
    } catch (e: CancellationException) {
      throw e
    } catch (e: WearException) {
      if (e.errorCode == ErrorCodes.DISCONNECTED) throw e
      log("the list after the upload could not be read: ${e.message}", error = true)
      null
    }
    val face = after?.faces?.firstOrNull { it.id == id }?.takeIf { outcome?.removedByWatch != true }
    val refused = outcome != null && (outcome.removedByWatch || (face == null && outcome.activateCode in SIGNATURE_FAILURE_CODES))
    val message = when {
      refused -> refusedMessage(outcome!!, screen)
      after == null -> "Uploaded, but the watch did not answer when asked for its watch faces, so the result is unverified."
      face == null -> notListedMessage(outcome, screen)
      face.isCurrent -> "Installed and active."
      else -> "Installed."
    }
    log("Install result: $message")
    return InstallResult(
      fileName = fileName,
      id = id,
      version = version,
      name = description.title.ifEmpty { id },
      bytes = pkg.binary.size,
      uploadStatus = outcome?.resultStatus,
      confirmReportType = outcome?.confirmReportType,
      listed = face != null,
      active = face?.isCurrent == true,
      message = message,
      list = after,
    )
  }

  /**
   * Observed on a Watch Fit 4 Pro (27/01 tag 0x11 = 0x3d): without a signature in the announcement the watch accepts the
   * file, confirms it (27/05 type 2), answers the activation with 100014 and reports the face deleted (27/05 type 3)
   * about 3 s later. Huawei Health sends the signature, fetched from Huawei's servers, in tag 0x08 of the announcement.
   */
  private fun refusedMessage(outcome: UploadOutcome, screen: WatchfaceScreen?): String = buildString {
    append("The watch received the face and then deleted it")
    val signs = ArrayList<String>()
    outcome.activateCode?.takeIf { it != 0 && it != UPLOAD_OK }?.let { signs.add("it answered the activation with code $it") }
    if (outcome.removedByWatch) signs.add("it reported the face deleted (27/05 type 3)")
    if (signs.isNotEmpty()) append(" (${signs.joinToString(" and ")})")
    append(".")
    if (screen?.supportsSignature == true) {
      append(
        " This watch reports the watch face signature capability and expects a Huawei-issued signature in the 27/03 " +
          "announcement, as Huawei Health sends it. JoyoFit cannot get one, so a face that Huawei did not sign is thrown " +
          "away. Huawei's test procedure for .hwt files uses Huawei Health logged in with a Huawei developer account.",
      )
    }
  }

  private fun notListedMessage(outcome: UploadOutcome?, screen: WatchfaceScreen?): String = buildString {
    if (outcome == null) {
      append("The watch said it had the face already but does not list it.")
      return@buildString
    }
    append("The upload finished (watch status ${outcome.resultStatus ?: "none"}) but the watch does not list the new face")
    if (outcome.confirmReportType == null) append(" and sent no install confirmation (27/05)")
    append(".")
    if (screen?.supportsSignature == true) {
      append(
        " This watch reports the watch face signature capability. Huawei Health sends a Huawei-issued signature with " +
          "the 27/03 request; JoyoFit cannot, so the watch may be discarding faces that carry none.",
      )
    }
  }

  private fun log(message: String, error: Boolean = false) =
    events.log(if (error) LogDirection.ERROR else LogDirection.INFO, null, null, null, "Watchface: $message")
}

/**
 * The watch face part of the module: serializes every operation with the link's operation lock, reads
 * `.hwt` files from the picker's URI and turns progress and outcome into `onUploadProgress` /
 * `onUploadResult` events.
 */
internal class WatchfaceController(
  private val context: Context,
  private val link: WearLink,
  private val events: WearEvents,
) {
  suspend fun list(): Map<String, Any?> = withWatch { ops -> ops.list().toJs() }

  /** The watch's face list as entries, for callers that need flags rather than the JS map (face customization). */
  suspend fun entries(): List<WatchfaceEntry> = withWatch { ops -> ops.list().faces }

  suspend fun setActive(id: String): Map<String, Any?> = withWatch { ops -> ops.setActive(id).toJs() }

  suspend fun delete(id: String): Map<String, Any?> = withWatch { ops -> ops.delete(id).toJs() }

  /** Parses a .hwt package locally without requiring an active watch connection. */
  suspend fun parsePackage(uri: String, persist: Boolean = false): Map<String, Any?> = withContext(Dispatchers.IO) {
    val bytes = readUri(uri)

    if (bytes.size < 64) {
      throw WearException(ErrorCodes.INVALID_ARGUMENT, "File is too small to be a valid watch face (${bytes.size} bytes)")
    }
    val sample = String(bytes.take(256).toByteArray(), Charsets.UTF_8).lowercase(java.util.Locale.ROOT)
    if (sample.contains("<!doctype html") || sample.contains("<html")) {
      throw WearException(ErrorCodes.INVALID_ARGUMENT, "The URL returned an HTML web page instead of a direct .hwt file. Please use a direct download link.")
    }

    // 1. Parse package / description.xml to determine target screen dimensions
    val pkg = try {
      WatchfacePackages.parse(bytes)
    } catch (_: Exception) {
      null
    }
    val desc = pkg?.description ?: run {
      val descBytes = WatchfacePackages.entry(bytes, "description.xml")
      if (descBytes != null) {
        try {
          WatchfacePackages.parseDescription(descBytes)
        } catch (_: Exception) {
          null
        }
      } else null
    }

    val isRawBinary = bytes.size >= 8 && bytes[0] == 0x45.toByte() && bytes[1] == 0x23.toByte()
    val hasWatchfaceEntry = WatchfacePackages.entry(bytes, "com.huawei.watchface") != null
      || WatchfacePackages.entry(bytes, "com.honor.watchface") != null
      || WatchfacePackages.entry(bytes, "watchface.bin") != null
      || desc != null

    if (pkg == null && !hasWatchfaceEntry && !isRawBinary) {
      throw WearException(ErrorCodes.INVALID_ARGUMENT, "The file is not a valid Huawei watch face package (.hwt). It does not contain watch face binaries or description.xml.")
    }

    val title = (desc?.title ?: pkg?.description?.title ?: "").ifBlank {
      desc?.titleCn ?: pkg?.description?.titleCn ?: ""
    }
    val author = (desc?.author ?: pkg?.description?.author ?: "").ifBlank {
      desc?.designer ?: pkg?.description?.designer ?: ""
    }
    val designer = desc?.designer ?: pkg?.description?.designer ?: ""
    val version = desc?.version ?: pkg?.description?.version ?: "1.0.0"
    val screen = desc?.screen ?: pkg?.description?.screen ?: ""

    val (height, width) = if (screen.isNotBlank()) {
      val res = WatchfaceResolutions.screenByThemeVersion(screen)
      val delimiter = if (res.contains('*')) '*' else 'x'
      val parts = res.split(delimiter)
      val h = parts.getOrNull(0)?.toIntOrNull()?.takeIf { it > 0 } ?: 0
      val w = parts.getOrNull(1)?.toIntOrNull()?.takeIf { it > 0 } ?: 0
      h to w
    } else {
      0 to 0
    }

    // 2. Extract preview targeting the exact screen resolution (or best available texture)
    var previewUri: String? = null
    val previewPair = WatchfacePackages.extractPreview(
      bytes,
      targetW = if (width > 0) width else 194,
      targetH = if (height > 0) height else 368,
    )
    if (previewPair != null && previewPair.first.isNotEmpty()) {
      val (previewBytes, mime) = previewPair
      try {
        val previewDir = java.io.File(context.filesDir, "watchfaces/previews").apply { mkdirs() }
        val bitmap = try {
          android.graphics.BitmapFactory.decodeByteArray(previewBytes, 0, previewBytes.size)
        } catch (_: Throwable) {
          null
        }

        if (bitmap != null) {
          val jpgFile = java.io.File(previewDir, "prev_${System.currentTimeMillis()}_${WatchfacePackages.randomName()}.jpg")
          java.io.FileOutputStream(jpgFile).use { outStream ->
            bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 90, outStream)
          }
          previewUri = android.net.Uri.fromFile(jpgFile).toString()
        } else {
          val ext = when (mime) {
            "image/png" -> "png"
            "image/webp" -> "webp"
            "image/bmp" -> "bmp"
            else -> "jpg"
          }
          val previewFile = java.io.File(previewDir, "prev_${System.currentTimeMillis()}_${WatchfacePackages.randomName()}.$ext")
          previewFile.writeBytes(previewBytes)
          previewUri = android.net.Uri.fromFile(previewFile).toString()
        }
      } catch (_: Exception) {
        val b64 = android.util.Base64.encodeToString(previewBytes, android.util.Base64.NO_WRAP)
        previewUri = "data:$mime;base64,$b64"
      }
    }
    val rawDesc = (desc?.briefinfo ?: pkg?.description?.briefinfo ?: "").trim()
    val descriptionText = if (rawDesc.isNotBlank() && rawDesc != "{}" && rawDesc != "[]") {
      rawDesc
    } else {
      "No description provided by creator."
    }

    val localUri: String? = if (persist) {
      try {
        val dir = java.io.File(context.filesDir, "watchfaces").apply { mkdirs() }
        val fileName = "${System.currentTimeMillis()}_${WatchfacePackages.randomName(version = version)}.hwt"
        val dest = java.io.File(dir, fileName)
        dest.writeBytes(bytes)
        android.net.Uri.fromFile(dest).toString()
      } catch (_: Exception) {
        null
      }
    } else {
      null
    }

    mapOf(
      "title" to title,
      "author" to author,
      "designer" to designer,
      "description" to descriptionText,
      "version" to version,
      "screen" to screen,
      "width" to width,
      "height" to height,
      "previewUri" to previewUri,
      "sizeBytes" to bytes.size,
      "localUri" to localUri,
    )
  }
  /** Deletes an internal watchface or preview file securely, preventing directory traversal. */
  fun deleteLocalFile(uri: String): Boolean {
    return try {
      val parsed = android.net.Uri.parse(uri)
      val path = parsed.path ?: uri
      val file = java.io.File(path)
      val baseDir = java.io.File(context.filesDir, "watchfaces").canonicalPath
      if (file.exists() && file.canonicalPath.startsWith(baseDir)) {
        file.delete()
      } else {
        false
      }
    } catch (_: Exception) {
      false
    }
  }

  /**
   * [signature] is a Huawei `getresourcesign` response string (Huawei Health sends it in tag 0x08 of the
   * announcement). [fileName] overrides the random `<id>_<version>` install name; a replayed signature only
   * names the face id and version it was issued for, so both must match that face.
   */
  suspend fun install(uri: String, signature: String? = null, fileName: String? = null): Map<String, Any?> {
    link.handle() ?: throw notConnected()
    val bytes = withContext(Dispatchers.IO) { readUri(uri) }
    val pkg = WatchfacePackages.parse(bytes)
    val name = fileName ?: WatchfacePackages.randomName(version = pkg.description.version)
    if (fileName != null && fileName.indexOf('_') <= 0) {
      throw WearException(ErrorCodes.INVALID_ARGUMENT, "The install name must be `<id>_<version>`, got '$fileName'")
    }
    var lastEmit = 0L
    val progress = { done: Int, total: Int ->
      val now = System.nanoTime() / 1_000_000
      if (done >= total || done == 0 || now - lastEmit >= PROGRESS_INTERVAL_MS) {
        lastEmit = now
        events.uploadProgress(done, total)
      }
    }
    return withWatch { ops ->
      try {
        val result = ops.install(pkg, progress, name, signature)
        events.uploadResult(result.listed, result.fileName, result.uploadStatus, result.message)
        result.toJs()
      } catch (e: CancellationException) {
        throw e
      } catch (e: WearException) {
        events.uploadResult(false, name, e.statusCode, e.message ?: e.errorCode)
        throw e
      }
    }
  }

  private suspend fun <T> withWatch(block: suspend (WatchfaceOps) -> T): T {
    val handle = link.handle() ?: throw notConnected()
    return handle.operationLock.withLock {
      // The link may have dropped while this waited for a sync to end.
      val current = link.handle()
      if (current == null || current.session !== handle.session) throw notConnected()
      block(WatchfaceOps(handle.session, events))
    }
  }

  private fun notConnected() = WearException(ErrorCodes.NOT_CONNECTED, "Not connected to a watch")

  private fun readStreamBounded(stream: java.io.InputStream, limit: Int = WatchfacePackages.MAX_PACKAGE_BYTES): ByteArray {
    return stream.use {
      val out = java.io.ByteArrayOutputStream()
      val buffer = ByteArray(16384)
      while (true) {
        val n = it.read(buffer)
        if (n < 0) break
        out.write(buffer, 0, n)
        if (out.size() > limit) {
          throw WearException(ErrorCodes.INVALID_ARGUMENT, "File is larger than ${limit / 1024 / 1024} MiB limit")
        }
      }
      out.toByteArray()
    }
  }

  private fun readUri(uri: String): ByteArray {
    if (uri.startsWith("http://") || uri.startsWith("https://")) {
      throw WearException(ErrorCodes.INVALID_ARGUMENT, "Web URLs are not supported. Please select a local .hwt file.")
    }
    // Check filesystem directly for file:// schemes or raw paths
    val localFile = when {
      uri.startsWith("file://") -> {
        val path = Uri.parse(uri).path
        if (path != null) java.io.File(path) else null
      }
      uri.startsWith("/") -> java.io.File(uri)
      else -> null
    }
    if (localFile != null && localFile.exists() && localFile.canRead()) {
      if (localFile.length() > WatchfacePackages.MAX_PACKAGE_BYTES) {
        throw WearException(ErrorCodes.INVALID_ARGUMENT, "That file is larger than ${WatchfacePackages.MAX_PACKAGE_BYTES / 1024 / 1024} MiB, too big for a watch face")
      }
      return localFile.readBytes()
    }
    val parsed = Uri.parse(uri)
    try {
      val stream = context.contentResolver.openInputStream(parsed)
        ?: throw WearException(ErrorCodes.INVALID_ARGUMENT, "Could not open $uri")
      return readStreamBounded(stream)
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
