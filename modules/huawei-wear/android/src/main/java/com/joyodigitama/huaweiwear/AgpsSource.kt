package com.joyodigitama.huaweiwear

/** What the watch said in its answer to the phone's parameter question (1F/02). */
internal class AgpsConsult(val version: Int, val tag: String, val urls: List<String>) {
  /** The tag names only, each entry cut at its last `/`: the path before it can carry a rough position and is not kept. */
  val tagNames: String
    get() = tag.split(';').map { it.trim().substringAfterLast('/') }.filter { it.isNotEmpty() }.joinToString(",")

  companion object {
    /** The question the phone asks itself when no watch is involved: the default (version 0) data. */
    val DEFAULT = AgpsConsult(0, "", emptyList())
  }
}

/** The result of one fetch: files by the name the watch will ask for, or an [outcome] code and message saying why there are none. */
internal class AgpsFetch(
  val files: Map<String, ByteArray>,
  val source: String,
  val dataTimeMs: Long,
  val outcome: String,
  val message: String,
  /** Served from the phone's copy: nothing new was downloaded, so the download time must not move. */
  val fromCache: Boolean = false,
) {
  val ok: Boolean get() = files.isNotEmpty()

  companion object {
    fun failed(outcome: String, message: String) = AgpsFetch(emptyMap(), "", 0L, outcome, message)
  }
}

/** Where the data comes from. Blocking; callers run it on the IO dispatcher. Never throws for a failed download. */
internal interface AgpsSource {
  /** [force] skips the phone-side copy and goes to the network. */
  fun fetch(consult: AgpsConsult, force: Boolean): AgpsFetch
}

internal object AgpsSources {
  const val BROADCOM = "broadcom_lto"
  const val LTO_FILE = "gpslocation.dat"
}

/**
 * The real source: the public Broadcom LTO file, for version 0. Every other kind the watch can ask for is data that only the watch maker's own
 * app prepares (from servers and with a decoder this app does not use), and sending anything else to a watch that does not validate what it is
 * given can wedge its GPS: those are declined, never substituted. The exceptions are the experimental paths, each behind its own switch: a
 * watch that asks for exactly `HW_AGNSS` gets the RTCM file ([AgpsLab]), one that asks for `HW_PGNSS_PRED` gets the six HW_PGNSS_* files
 * ([AgpsPgnss]), both built by JoyoFit's server from open data.
 */
internal class NetworkAgpsSource(
  private val cache: AgpsCache,
  private val store: AgpsStore,
  private val log: (String) -> Unit,
  private val isOnline: () -> Boolean,
  private val nowMs: () -> Long = System::currentTimeMillis,
  private val http: (url: String, maxBytes: Int) -> AgpsDownload = EphemerisNet::get,
) : AgpsSource {

  override fun fetch(consult: AgpsConsult, force: Boolean): AgpsFetch = when (consult.version) {
    0 -> fetchBroadcom(force)
    in 1..3 -> {
      val kinds = AgpsLab.servedKinds(consult, store.labAgnss, store.labPgnss)
      if (kinds.isEmpty()) {
        AgpsFetch.failed(
          AgpsOutcome.UNSUPPORTED,
          "the watch asked for kinds only the watch maker's app prepares (version ${consult.version}: ${consult.tagNames.ifEmpty { "no names" }})",
        )
      } else {
        combine(kinds.map { if (it == AgpsPgnss.KIND) fetchPgnss(force) else fetchAgnss(force) })
      }
    }
    else -> AgpsFetch.failed(AgpsOutcome.UNSUPPORTED, "download version ${consult.version} is not known")
  }

  /**
   * One fetch per served kind into one answer: the files in that order. Any failure is the answer (the watch gets every kind it is offered or
   * none). Two kinds at once (never seen) are dated by the older and carry the PGNSS source.
   */
  private fun combine(parts: List<AgpsFetch>): AgpsFetch {
    if (parts.size == 1) return parts[0]
    parts.firstOrNull { !it.ok }?.let { return it }
    val files = LinkedHashMap<String, ByteArray>()
    parts.forEach { files.putAll(it.files) }
    return AgpsFetch(files, AgpsPgnss.SOURCE, parts.minOf { it.dataTimeMs }, AgpsOutcome.NONE, "", parts.all { it.fromCache })
  }

  private class Got(val body: ByteArray, val dataMs: Long, val fromCache: Boolean)

  /** The phone-side copy when it is young enough and still a valid LTO file, else the network; saved for next time only when it passed validation. */
  private fun cachedLto(url: String, force: Boolean): Got {
    if (!force) {
      val hit = cache.read(url, AgpsPolicy.CACHE_FRESH_MS)
      if (hit != null && AgpsPolicy.validateLto(hit) == null) {
        log("LTO: from the phone's copy, ${hit.size} bytes")
        val dataMs = store.cachedDataMs.takeIf { it > 0L && store.cachedSource == AgpsSources.BROADCOM } ?: nowMs()
        return Got(hit, dataMs, true)
      }
      if (hit != null) cache.delete(url)
    }
    if (!isOnline()) throw AgpsFetchException("no network")
    val started = nowMs()
    val download = http(url, AgpsPolicy.LTO_MAX_BYTES)
    AgpsPolicy.validateLto(download.body)?.let { throw AgpsInvalidFileException(it) }
    log("LTO: downloaded ${download.body.size} bytes in ${nowMs() - started} ms")
    cache.write(url, download.body)
    return Got(download.body, download.lastModifiedMs.takeIf { it > 0L } ?: nowMs(), false)
  }

  /** Version 0: always the fixed Broadcom address, whatever address the watch names. The file is `gpslocation.dat`. */
  private fun fetchBroadcom(force: Boolean): AgpsFetch = try {
    val got = cachedLto(EphemerisNet.LTO_HOST + EphemerisNet.LTO_PATH, force)
    AgpsFetch(mapOf(AgpsSources.LTO_FILE to got.body), AgpsSources.BROADCOM, got.dataMs, AgpsOutcome.NONE, "", got.fromCache)
  } catch (e: AgpsFetchException) {
    failure(e, "LTO")
  }

  /**
   * The experimental HW_AGNSS file from JoyoFit's server (fixed address, plain GET, nothing about the user). The phone's copy is reused while it
   * is young and still passes [AgpsPolicy.validateAgnss]; a download is checked the same way before it is kept or offered.
   */
  private fun fetchAgnss(force: Boolean): AgpsFetch = try {
    val url = EphemerisNet.AGNSS_URL
    var got: Got? = null
    if (!force) {
      val hit = cache.read(url, AgpsPolicy.AGNSS_CACHE_FRESH_MS)
      val builtMs = if (store.cachedSource == AgpsLab.SOURCE) store.cachedDataMs else 0L
      if (hit != null && AgpsPolicy.validateAgnss(hit, builtMs, nowMs()) == null) {
        log("HW_AGNSS: from the phone's copy, ${hit.size} bytes")
        got = Got(hit, builtMs, true)
      } else if (hit != null) {
        cache.delete(url)
      }
    }
    if (got == null) {
      if (!isOnline()) throw AgpsFetchException("no network")
      val started = nowMs()
      val download = http(url, AgpsPolicy.RTCM_MAX_BYTES)
      AgpsPolicy.validateAgnss(download.body, download.lastModifiedMs, nowMs())?.let { throw AgpsInvalidFileException(it) }
      log("HW_AGNSS: downloaded ${download.body.size} bytes, ${AgpsPolicy.rtcmFrames(download.body)} satellites, in ${nowMs() - started} ms")
      cache.write(url, download.body)
      got = Got(download.body, download.lastModifiedMs, false)
    }
    AgpsFetch(mapOf(AgpsLab.FILE to got.body), AgpsLab.SOURCE, got.dataMs, AgpsOutcome.NONE, "", got.fromCache)
  } catch (e: AgpsFetchException) {
    failure(e, "HW_AGNSS")
  }

  /**
   * The experimental HW_PGNSS_PRED bundle from JoyoFit's server (fixed address, plain GET, nothing about the user), split into its six files in
   * the watch's pull order. The phone's copy is reused while it is at most [PgnssBundle.MAX_AGE_MS] old and still passes [PgnssBundle.validate]
   * against its recorded build time; a download is checked the same way before it is kept or offered.
   */
  private fun fetchPgnss(force: Boolean): AgpsFetch = try {
    val url = EphemerisNet.PGNSS_URL
    val cachedBuilt = store.pgnssBuiltMs
    val hit = if (force) null else cache.read(url, PgnssBundle.MAX_AGE_MS)
    if (hit != null && PgnssBundle.validate(hit, cachedBuilt, nowMs()) == null) {
      log("HW_PGNSS_PRED: from the phone's copy, ${hit.size} bytes")
      AgpsFetch(PgnssBundle.files(hit), AgpsPgnss.SOURCE, cachedBuilt, AgpsOutcome.NONE, "", fromCache = true)
    } else {
      if (hit != null) cache.delete(url)
      if (!isOnline()) throw AgpsFetchException("no network")
      val started = nowMs()
      val download = http(url, PgnssBundle.BUNDLE_BYTES)
      PgnssBundle.validate(download.body, download.lastModifiedMs, nowMs())?.let { throw AgpsInvalidFileException(it) }
      log("HW_PGNSS_PRED: downloaded ${download.body.size} bytes in ${nowMs() - started} ms")
      cache.write(url, download.body)
      store.recordPgnssBuilt(download.lastModifiedMs)
      AgpsFetch(PgnssBundle.files(download.body), AgpsPgnss.SOURCE, download.lastModifiedMs, AgpsOutcome.NONE, "")
    }
  } catch (e: AgpsFetchException) {
    failure(e, "HW_PGNSS_PRED")
  }

  private fun failure(e: AgpsFetchException, label: String): AgpsFetch {
    val outcome = when {
      e is AgpsInvalidFileException -> AgpsOutcome.INVALID_FILE
      e.message == "no network" -> AgpsOutcome.NO_NETWORK
      else -> AgpsOutcome.DOWNLOAD_FAILED
    }
    return AgpsFetch.failed(outcome, "$label: ${e.message}")
  }
}

/** The download arrived but is not a file the watch may be sent. */
internal class AgpsInvalidFileException(message: String) : AgpsFetchException(message)

/** The phone-side copies of downloads, by URL. */
internal interface AgpsCache {
  /** The cached body of [url] when it is younger than [maxAgeMs]. */
  fun read(url: String, maxAgeMs: Long): ByteArray?

  fun write(url: String, data: ByteArray)

  fun delete(url: String)
}
