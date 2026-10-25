package com.joyodigitama.huaweiwear

/** Outcome codes of the last satellite-data attempt; the same strings are read by `AgpsOutcome` in `HuaweiWearExtras.types.ts`. */
internal object AgpsOutcome {
  const val NONE = "none"

  /** The watch pulled the whole file and closed the transfer. */
  const val DELIVERED = "delivered"

  /** Downloaded to the phone while no watch was connected; it goes out when the watch asks. */
  const val STORED = "stored"

  /** The watch did not answer the phone's question, or never came to fetch what was ready. */
  const val WATCH_SILENT = "watch_silent"
  const val NO_NETWORK = "no_network"
  const val DOWNLOAD_FAILED = "download_failed"
  const val INVALID_FILE = "invalid_file"

  /** The watch asked for a kind of data this app cannot and must not make (only the watch maker's own app prepares it). */
  const val UNSUPPORTED = "unsupported"
  const val WATCH_REFUSED = "watch_refused"
  const val TIMEOUT = "timeout"
  const val CANCELLED = "cancelled"
  const val BUSY = "busy"
  const val LINK_LOST = "link_lost"
}

/**
 * The rules of the satellite-data (A-GPS / ephemeris) job that need no Android: how long data is kept, when a
 * refresh is due, the retry schedule, and what a file must look like before it is allowed near the watch.
 */
internal object AgpsPolicy {
  /** The Broadcom LTO file predicts seven days ahead; the watch warns when its copy is older than that. */
  const val VALID_MS = 7L * 24 * 60 * 60 * 1000

  /** A download younger than this is reused for the watch's repeated requests instead of fetching again. */
  const val CACHE_FRESH_MS = 6L * 60 * 60 * 1000

  /** Data is offered to the watch again once its last delivery is this old, well inside [VALID_MS]. */
  const val DELIVER_EVERY_MS = 24L * 60 * 60 * 1000

  /** Wait after the 1st, 2nd, ... failed download; the last step repeats. Reset by a success or by the user. */
  private val RETRY_STEPS_MS = longArrayOf(60_000L, 5 * 60_000L, 15 * 60_000L, 60 * 60_000L, 6 * 60 * 60_000L)

  fun retryDelayMs(failures: Int): Long =
    if (failures <= 0) 0L else RETRY_STEPS_MS[minOf(failures, RETRY_STEPS_MS.size) - 1]

  /** When the next automatic attempt may start after [failures] failures, the last at [lastFailureMs]; 0 when nothing waits. */
  fun retryAtMs(lastFailureMs: Long, failures: Int): Long = if (failures <= 0) 0L else lastFailureMs + retryDelayMs(failures)

  /** The phone-side copy is missing or old, and no retry wait is running. */
  fun prefetchDue(cachedAtMs: Long, nowMs: Long, retryAtMs: Long): Boolean =
    nowMs >= retryAtMs && (cachedAtMs <= 0L || nowMs - cachedAtMs >= CACHE_FRESH_MS)

  /** The watch has not been given data for a day (or ever): worth offering it again. */
  fun deliveryDue(deliveredAtMs: Long, nowMs: Long): Boolean = deliveredAtMs <= 0L || nowMs - deliveredAtMs >= DELIVER_EVERY_MS

  /** When the data the watch holds stops being good; 0 when it was never delivered. The experimental HW_AGNSS file ([AgpsLab]) is good for hours, not days. */
  fun expiresAtMs(dataTimeMs: Long, source: String = ""): Long =
    if (dataTimeMs <= 0L) 0L else dataTimeMs + if (source == AgpsLab.SOURCE) AGNSS_VALID_MS else VALID_MS

  /** Broadcom LTO size bounds: the real file is about 115 KB; anything far outside is not that file. */
  const val LTO_MIN_BYTES = 16 * 1024
  const val LTO_MAX_BYTES = 1024 * 1024

  /** Most data one 1C/04 answer may carry, whatever the watch asks for. */
  const val MAX_DATA_PER_REQUEST = 1024 * 1024

  /** Most frames one data answer may be cut into. */
  const val MAX_FRAMES = 65_535

  /** A transfer that is silent this long is dropped and counted as failed, so the watch is not left waiting on a dead phone. */
  const val TRANSFER_STALL_MS = 30_000L

  /** After "ready" is announced the watch has this long to come and fetch. */
  const val PULL_WAIT_MS = 60_000L

  /** The Broadcom LTO file starts with these three bytes (checked on the public file, 115749 bytes, 2026-10-18). */
  private val LTO_MAGIC = byteArrayOf(0xFF.toByte(), 0xCA.toByte(), 0xDE.toByte())

  /** Why [data] is not fit to send as the Broadcom LTO file, or null when it is. */
  fun validateLto(data: ByteArray): String? = when {
    data.size < LTO_MIN_BYTES -> "file too small (${data.size} bytes)"
    data.size > LTO_MAX_BYTES -> "file too large (${data.size} bytes)"
    !data.copyOfRange(0, LTO_MAGIC.size).contentEquals(LTO_MAGIC) -> "not an LTO file (unexpected header)"
    else -> null
  }

  /** Frames needed to send [size] bytes in frames of [frameSize]; null when that is not a sane transfer. */
  fun frameCount(size: Int, frameSize: Int): Int? {
    if (size <= 0 || frameSize <= 0) return null
    val count = (size + frameSize - 1) / frameSize
    return if (count > MAX_FRAMES) null else count
  }

  /** Broadcast ephemeris is good for about four hours around its epoch; the file holds GPS records up to four hours old. */
  const val AGNSS_VALID_MS = 4L * 60 * 60 * 1000

  /** The server rebuilds the HW_AGNSS file every 15 minutes; a phone copy that young is reused for the watch's repeated asks. */
  const val AGNSS_CACHE_FRESH_MS = 15L * 60 * 1000

  /** A HW_AGNSS file the server built longer ago than this (its Last-Modified) is not offered. */
  const val AGNSS_MAX_AGE_MS = 2L * 60 * 60 * 1000

  /** HW_AGNSS file bounds, the same as the server's (`packages/agps-rtcm`, `validateHwAgnss`): about 7.4 to 8 KB for 120 satellites in practice. */
  const val RTCM_MIN_BYTES = 512
  const val RTCM_MAX_BYTES = 16 * 1024
  const val RTCM_MIN_SATELLITES = 20

  /** The four RTCM 3 ephemeris messages: GPS, GLONASS, BeiDou, Galileo I/NAV. */
  private val RTCM_MESSAGES = setOf(1019, 1020, 1042, 1046)

  /** CRC-24Q of RTCM 3 (polynomial 0x1864CFB) over `data[from until to]`. */
  fun crc24q(data: ByteArray, from: Int = 0, to: Int = data.size): Int {
    var crc = 0
    for (i in from until to) {
      crc = crc xor ((data[i].toInt() and 0xFF) shl 16)
      repeat(8) {
        crc = crc shl 1
        if (crc and 0x1000000 != 0) crc = crc xor 0x1864CFB
      }
    }
    return crc and 0xFFFFFF
  }

  /**
   * Why [data] is not fit to send as the HW_AGNSS file, or null when it is: size bounds, every byte inside a frame (`D3`, reserved bits zero,
   * CRC-24Q correct), only the four ephemeris messages, at least [RTCM_MIN_SATELLITES] frames. The server checks the same before serving.
   */
  fun validateRtcm(data: ByteArray): String? {
    if (data.size < RTCM_MIN_BYTES) return "file too small (${data.size} bytes)"
    if (data.size > RTCM_MAX_BYTES) return "file too large (${data.size} bytes)"
    fun byte(k: Int) = if (k < data.size) data[k].toInt() and 0xFF else 0
    var frames = 0
    var i = 0
    while (i < data.size) {
      if (byte(i) != 0xD3 || byte(i + 1) and 0xFC != 0) return "not an RTCM 3 frame at byte $i"
      val length = ((byte(i + 1) and 3) shl 8) or byte(i + 2)
      val end = i + 3 + length
      if (length < 2 || end + 3 > data.size) return "RTCM frame at byte $i is cut off"
      val crc = (byte(end) shl 16) or (byte(end + 1) shl 8) or byte(end + 2)
      if (crc24q(data, i, end) != crc) return "RTCM frame at byte $i fails its CRC"
      val type = (byte(i + 3) shl 4) or (byte(i + 4) shr 4)
      if (type !in RTCM_MESSAGES) return "unexpected RTCM message $type at byte $i"
      frames++
      i = end + 3
    }
    if (frames < RTCM_MIN_SATELLITES) return "only $frames satellites (at least $RTCM_MIN_SATELLITES needed)"
    return null
  }

  /** The satellites (frames) in a file that passed [validateRtcm]. */
  fun rtcmFrames(data: ByteArray): Int {
    var frames = 0
    var i = 0
    while (i + 2 < data.size) {
      i += 6 + (((data[i + 1].toInt() and 3) shl 8) or (data[i + 2].toInt() and 0xFF))
      frames++
    }
    return frames
  }

  /** [validateRtcm], and the server's build time [builtMs] (its Last-Modified) must be known and at most [AGNSS_MAX_AGE_MS] before [nowMs]. */
  fun validateAgnss(data: ByteArray, builtMs: Long, nowMs: Long): String? = validateRtcm(data) ?: when {
    builtMs <= 0L -> "the server did not say when the file was built"
    nowMs - builtMs > AGNSS_MAX_AGE_MS -> "the file was built ${(nowMs - builtMs) / 60_000} minutes ago"
    else -> null
  }
}

/**
 * The experimental HW_AGNSS path (docs/agps.md, "Lab path"): RTCM 3 broadcast ephemeris built by JoyoFit's server from BKG's open data, sent only
 * when the user turned the switch on (off by default, [AgpsStore.labAgnss]) and the watch asked for exactly that one kind. The watch does not
 * check the data; wrong data has wedged GPS on other watches. Everything else stays declined.
 */
internal object AgpsLab {
  /** The kind (last tag segment) the watch names: `higeo/v1/gnssinfo?type=0x0024/HW_AGNSS` (Fit 4 Pro), `type=0x0004` (Band 11 Pro). */
  const val KIND = "HW_AGNSS"

  /** The one file the watch pulls for it (2026-10-25 capture of Huawei Health). */
  const val FILE = "HW_AGNSS_RTCM_33"

  /** [AgpsFetch.source] and the stored delivery source of this data. */
  const val SOURCE = "joyofit_rtcm"

  /** The consult is a download version 1 to 3 asking for exactly one kind, a tag that ends in `/HW_AGNSS`. */
  fun asksHwAgnss(consult: AgpsConsult): Boolean {
    val entries = consult.tag.split(';').map { it.trim() }.filter { it.isNotEmpty() }
    return consult.version in 1..3 && entries.size == 1 && entries[0].endsWith("/$KIND")
  }

  /** The stored last ask (version, tag names only) was for exactly this kind. */
  fun askedHwAgnss(version: Int, tagNames: String): Boolean = version in 1..3 && tagNames == KIND

  /**
   * The consult leads to a download: version 0 (Broadcom), or exactly HW_AGNSS with the switch [labOn]. These asks share the retry schedule
   * ([AgpsPolicy.retryAtMs]); every other kind is declined without touching the network.
   */
  fun downloads(consult: AgpsConsult, labOn: Boolean): Boolean = consult.version == 0 || (labOn && asksHwAgnss(consult))
}
