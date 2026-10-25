// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): service/devices/huawei/HuaweiEphemerisManager and
// requests/SendEphemeris*; packets/{Ephemeris,EphemerisFileUpload}.
package com.joyodigitama.huaweiwear

import android.content.Context
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.util.CheckSums

/** The 0x1C packet that carries file bytes to the watch: `index, bytes` per frame (GB `FileNextChunkSend.serializeFileChunk1c`). */
internal class AgpsChunkPacket(
  params: HuaweiPacket.ParamsProvider,
  private val chunk: ByteArray,
  private val transferSize: Short,
  private val packetCount: Int,
) : HuaweiPacket(params) {
  init {
    serviceId = 0x1C.toByte()
    commandId = 0x05.toByte()
    complete = true
    isEncrypted = params.areTransactionsCrypted()
  }

  override fun serialize(): List<ByteArray> = serializeFileChunk1c(chunk, transferSize, packetCount)
}

private fun agpsUnsigned(bytes: ByteArray?): Long? {
  if (bytes == null || bytes.isEmpty() || bytes.size > 8) return null
  var value = 0L
  for (b in bytes) value = (value shl 8) or (b.toLong() and 0xFF)
  return value
}

private fun HuaweiTLV.agpsInt(tag: Int): Long? = agpsUnsigned(getBytes(tag, null))

private fun HuaweiTLV.agpsString(tag: Int): String? = getBytes(tag, null)?.let { String(it, Charsets.UTF_8) }

/** What the phone says to the watch, as TLVs; kept apart from the state machine so the bytes can be checked on their own. */
internal object AgpsMessages {
  const val AGPS_SERVICE = 0x1F
  const val FILE_SERVICE = 0x1C

  const val CODE_OK = 100000
  const val CODE_FAILED = 100001
  const val CODE_NO_NETWORK = 100007

  /** 1F/03 download states. */
  const val STATE_READY = 3
  const val STATE_FAILED = 4
  const val STATE_UNSUPPORTED = 5

  /** 1F/01: `7F code`. */
  fun operatorAnswer(code: Int) = HuaweiTLV().put(0x7F, code)

  /** 1F/02: the phone asks the watch for its parameters. */
  fun parameterConsult() = HuaweiTLV().put(0x81)

  /** 1F/01 for the watch's progress poll: `81{02: 02, 03: the watch's own time bytes, 04: state}`. */
  fun progressAnswer(timeBytes: ByteArray, state: Int) =
    HuaweiTLV().put(0x81, HuaweiTLV().put(0x02, 2.toByte()).put(0x03, timeBytes).put(0x04, state.toByte()))

  /** 1F/03: `01 state`. */
  fun fileStatus(state: Int) = HuaweiTLV().put(0x01, state.toByte())

  /** 1C/01 with the file names (`a;b`). */
  fun fileList(names: List<String>) = HuaweiTLV().put(0x01, names.joinToString(";"))

  /** The answer to anything the phone refuses: `7F 100001`. */
  fun refused() = HuaweiTLV().put(0x7F, CODE_FAILED)

  /** 1C/02, 1C/06 accept: `7F 100000`. */
  fun accepted() = HuaweiTLV().put(0x7F, CODE_OK)

  /** 1C/03: `02 size (i32), 03 CRC16 (init 0, i16)`. */
  fun fileInfo(size: Int, crc16: Int) = HuaweiTLV().put(0x02, size).put(0x03, crc16.toShort())

  /** 1C/04: `7F, 02 stored name, 03 offset`; the frames follow as 1C/05. */
  fun dataAnswer(storedName: String, offset: Int) = HuaweiTLV().put(0x7F, CODE_OK).put(0x02, storedName).put(0x03, offset)

  /** The consult answer of the watch: `81{04 time, 05 version, 06 tags, children 8x{03 url}}`. */
  fun parseConsult(tlv: HuaweiTLV?): AgpsConsult? {
    val body = if (tlv != null && tlv.contains(0x81)) tlv.getObject(0x81) else return null
    val version = body.agpsInt(0x05)?.toInt() ?: -1
    val tag = body.agpsString(0x06).orEmpty()
    val urls = body.allContainerObjects.mapNotNull { child -> if (child.contains(0x03)) child.agpsString(0x03) else null }
    return AgpsConsult(version, tag, urls)
  }
}

/** Test and tuning knobs of one [AgpsExchange]; the defaults are the real values. */
internal class AgpsTiming(
  val downloadTimeoutMs: Long = 120_000L,
  val pullWaitMs: Long = AgpsPolicy.PULL_WAIT_MS,
  val stallMs: Long = AgpsPolicy.TRANSFER_STALL_MS,
  val probeAskMs: Long = 15_000L,
  val probeTransferMs: Long = 90_000L,
)

/**
 * The phone's half of the watch's satellite-data request (service 0x1F, files over 0x1C), for one connection. The watch drives;
 * every step is its own message:
 *
 * ```
 * watch 1F/01 {81{02 op, 03 time}}          phone 1F/01 {7F 100000}   (100007 without network)
 *                                           phone 1F/02 {81}          ParameterConsult
 * watch 1F/02 {81{04 time, 05 version,      phone downloads, then 1F/03 {01 state}   3 ready, 4 failed, 5 unsupported
 *               06 tag list, children 03 urls}}
 * watch 1C/01 file list, 1C/02 consult, 1C/03 file info, 1C/04 data request, 1C/06 done
 *                                           phone 1C/01..04 answers, 1C/05 data frames, 1C/06 answer
 * ```
 *
 * [probe] starts the same exchange from the phone (no op 1): it asks the watch for its parameters and, when the watch
 * answers, carries on from there.
 *
 * Watch safety: files are validated before they are offered; every request is bounded (data per answer, frames per answer);
 * a transfer that goes silent is dropped after [AgpsTiming.stallMs] and a "ready" nobody collects after
 * [AgpsTiming.pullWaitMs]; a refused or cancelled exchange tells the watch "failed" so it does not wait; nothing here touches
 * pairing or keys. Network work runs on the IO dispatcher; the watch's messages are handled in order on one coroutine and never on
 * the session's reader thread.
 */
internal class AgpsExchange(
  private val session: HuaweiSession,
  private val address: String,
  private val events: WearEvents,
  private val scope: CoroutineScope,
  private val source: AgpsSource,
  private val store: AgpsStore,
  private val isOnline: () -> Boolean,
  private val nowMs: () -> Long = System::currentTimeMillis,
  private val timing: AgpsTiming = AgpsTiming(),
) {
  /** A watch message, or the stall timer ([service] -1) routed through the same single coroutine. */
  private class Incoming(val service: Int, val command: Int, val packet: HuaweiPacket?, val token: Long = 0L)

  /** What the watch asked for in one 1C/02 ... 1C/06 round (GB `UploadParameters` and the current file). */
  private class Transfer(val frameSize: Int, val maxDataSize: Int, val fileType: Int) {
    var name: String? = null
    var data: ByteArray? = null
    var frames = 0

    /** The end of the furthest byte range that was sent. */
    var sentEnd = 0
  }

  private val inbox = Channel<Incoming>(Channel.UNLIMITED)
  private val subscriptions = ArrayList<AutoCloseable>()
  private var actor: Job? = null

  @Volatile private var stopped = false

  /** Download state: 0 idle, 1 consulted, 2 downloading, 3 ready, 4 failed, 5 unsupported. */
  @Volatile private var state = 0

  /** A request is running (an op 1, or a [probe]) and has not been closed by state 4, 5 or a delivery. */
  @Volatile private var task = false

  @Volatile private var download: Job? = null

  /** The next download skips the phone's copy (the user asked for a refresh). */
  @Volatile private var forceNext = false

  /** Files the watch may pull, by the name it asks for. Guarded by `this`. */
  private val ready = LinkedHashMap<String, ByteArray>()

  /** What the downloads behind [ready] were (source and age), for the delivery record. */
  @Volatile private var fetched: AgpsFetch? = null

  /** Names the watch has pulled completely in this request. Only touched from [actor]. */
  private val delivered = HashSet<String>()

  /** Only touched from [actor]. */
  private var transfer: Transfer? = null

  private var idle: Job? = null
  private var idleToken = 0L

  /** Completed with the outcome that ends the request a [probe] is waiting for; completed once. */
  @Volatile private var finish: CompletableDeferred<String>? = null

  @Volatile private var consultSeen: CompletableDeferred<Unit>? = null

  /** What the screen shows: idle, asking, downloading, waiting (ready, the watch has not come), sending. */
  val phase: String
    get() = when {
      !task -> "idle"
      transfer != null -> "sending"
      state == 2 -> "downloading"
      state == 3 -> "waiting"
      else -> "asking"
    }

  val busy: Boolean get() = task

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, "AGPS: $message")

  private fun logError(message: String) = events.log(LogDirection.ERROR, null, null, null, "AGPS: $message")

  private fun logRaw(message: String) {
    android.util.Log.i("JoyoFit", "AGPS: $message")
  }

  fun start() {
    val wanted = listOf(
      Triple(AgpsMessages.AGPS_SERVICE, 0x01, "operator request"),
      Triple(AgpsMessages.AGPS_SERVICE, 0x02, "parameter consult answer"),
      Triple(AgpsMessages.AGPS_SERVICE, 0x03, "file status answer"),
      Triple(AgpsMessages.FILE_SERVICE, 0x01, "file list request"),
      Triple(AgpsMessages.FILE_SERVICE, 0x02, "file consult"),
      Triple(AgpsMessages.FILE_SERVICE, 0x03, "file info request"),
      Triple(AgpsMessages.FILE_SERVICE, 0x04, "data request"),
      Triple(AgpsMessages.FILE_SERVICE, 0x05, "data ack"),
      Triple(AgpsMessages.FILE_SERVICE, 0x06, "upload done"),
    )
    for ((service, command, label) in wanted) {
      subscriptions += session.subscribe(service.toByte(), command.toByte(), "AGPS $label") {
        inbox.trySend(Incoming(service, command, it))
      }
    }
    actor = scope.launch {
      for (message in inbox) {
        try {
          handle(message)
        } catch (e: CancellationException) {
          throw e
        } catch (e: Exception) {
          logError("%02x/%02x handler failed: %s".format(message.service, message.command, e.message ?: e.javaClass.simpleName))
        }
      }
    }
    log(
      "ready; watch lists 1F/01=${DeviceCaps.supports(AgpsMessages.AGPS_SERVICE, 1)} 1F/02=${DeviceCaps.supports(AgpsMessages.AGPS_SERVICE, 2)} " +
        "1F/03=${DeviceCaps.supports(AgpsMessages.AGPS_SERVICE, 3)} 1C/01=${DeviceCaps.supports(AgpsMessages.FILE_SERVICE, 1)} " +
        "1C/04=${DeviceCaps.supports(AgpsMessages.FILE_SERVICE, 4)}",
    )
  }

  /** The link went away: everything in flight is dropped. */
  fun stop() {
    stopped = true
    subscriptions.forEach { it.close() }
    subscriptions.clear()
    inbox.close()
    download?.cancel()
    idle?.cancel()
    if (task) store.recordOutcome(nowMs(), AgpsOutcome.LINK_LOST, "the connection to the watch ended during the request", false)
    task = false
    consultSeen?.complete(Unit)
    finishWith(AgpsOutcome.LINK_LOST)
    actor?.cancel()
  }

  /**
   * Starts the request from the phone: asks the watch for its parameters (1F/02) and waits for its answer. Returns at once with
   * [AgpsOutcome.BUSY] when a request is running, [AgpsOutcome.WATCH_SILENT] when the watch does not answer, else the outcome
   * of the request the answer started (see [finishWith]).
   */
  suspend fun probe(force: Boolean): String {
    synchronized(this) {
      if (task) return AgpsOutcome.BUSY
      task = true
    }
    state = 0
    forceNext = force
    delivered.clear()
    synchronized(this) { ready.clear() }
    val ended = CompletableDeferred<String>()
    val answered = CompletableDeferred<Unit>()
    finish = ended
    consultSeen = answered
    log("asking the watch for its satellite-data parameters (phone-started)")
    tx(AgpsMessages.AGPS_SERVICE, 0x02, AgpsMessages.parameterConsult(), "parameter consult (phone-started)")
    if (withTimeoutOrNull(timing.probeAskMs) { answered.await() } == null) {
      log("the watch did not answer the phone-started question within ${timing.probeAskMs / 1000} s")
      task = false
      finish = null
      consultSeen = null
      return AgpsOutcome.WATCH_SILENT
    }
    consultSeen = null
    // The watch answered: the download, the status and the watch's own pull follow. Wait for the end of that.
    val outcome = withTimeoutOrNull(timing.downloadTimeoutMs + timing.pullWaitMs + timing.probeTransferMs) { ended.await() }
    finish = null
    return outcome ?: AgpsOutcome.TIMEOUT
  }

  /**
   * The user cancels: a download in progress is dropped and the watch is told "failed" so it does not wait for it; a transfer in
   * progress is dropped, so the watch's next request is refused. The watch's own state machine ends the transfer on its side.
   */
  suspend fun cancel() {
    val running = synchronized(this) { task }
    if (!running) return
    download?.cancel()
    idle?.cancel()
    val answerStatus = state == 1 || state == 2
    transfer = null
    task = false
    synchronized(this) { ready.clear() }
    store.recordOutcome(nowMs(), AgpsOutcome.CANCELLED, "cancelled in the app", false)
    log("cancelled in the app")
    if (answerStatus) tx(AgpsMessages.AGPS_SERVICE, 0x03, AgpsMessages.fileStatus(AgpsMessages.STATE_FAILED), "file status failed (cancelled)")
    consultSeen?.complete(Unit)
    finishWith(AgpsOutcome.CANCELLED)
  }

  private fun finishWith(outcome: String) {
    finish?.complete(outcome)
  }

  private suspend fun handle(message: Incoming) {
    when {
      message.service == STALL -> onIdleExpired(message.token)
      message.service == AgpsMessages.AGPS_SERVICE -> {
        val packet = message.packet ?: return
        when (message.command) {
          0x01 -> onOperator(packet)
          0x02 -> onConsult(packet)
          0x03 -> log("watch answered the file status: ${describeTlv(packet.getTlv())}")
        }
      }
      else -> {
        val packet = message.packet ?: return
        when (message.command) {
          0x01 -> onFileList(packet)
          0x02 -> onFileConsult(packet)
          0x03 -> onFileInfo(packet)
          0x04 -> onDataRequest(packet)
          0x05 -> {
            transfer?.let {
              it.frames++
              armIdle(timing.stallMs)
            }
          }
          0x06 -> onUploadDone(packet)
        }
      }
    }
  }

  private suspend fun tx(service: Int, command: Int, content: HuaweiTLV, label: String) {
    try {
      session.send(RawPacket(session.params, service, command, content), "AGPS $label")
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      logError("$label not sent: ${e.message ?: e.javaClass.simpleName}")
    }
  }

  /** (Re)starts the silence timer: after [ms] without the next watch message the request is dropped. */
  private fun armIdle(ms: Long) {
    idle?.cancel()
    val token = ++idleToken
    idle = scope.launch {
      delay(ms)
      inbox.trySend(Incoming(STALL, 0, null, token))
    }
  }

  private fun disarmIdle() {
    idle?.cancel()
    idleToken++
  }

  private fun onIdleExpired(token: Long) {
    if (token != idleToken || !task) return
    val sending = transfer != null
    transfer = null
    task = false
    synchronized(this) { ready.clear() }
    val outcome = if (sending) AgpsOutcome.TIMEOUT else AgpsOutcome.WATCH_SILENT
    val why = if (sending) "the watch sent nothing for ${timing.stallMs / 1000} s during a transfer; dropped" else "the watch did not come for the data within ${timing.pullWaitMs / 1000} s; dropped"
    logError(why)
    store.recordOutcome(nowMs(), outcome, why, false)
    finishWith(outcome)
  }

  // 1F: operator request, consult, download, status

  private suspend fun onOperator(packet: HuaweiPacket) {
    val tlv = packet.getTlv()
    val body = if (tlv != null && tlv.contains(0x81)) tlv.getObject(0x81) else null
    val op = body?.agpsInt(0x02)?.toInt() ?: -1
    val timeBytes = body?.getBytes(0x03, null)
    log("watch asks for ephemeris data: op $op, time ${agpsUnsigned(timeBytes)}")
    when (op) {
      1 -> {
        // Every op 1 clears the record for the watch and starts over.
        download?.cancel()
        disarmIdle()
        task = true
        state = 0
        transfer = null
        delivered.clear()
        synchronized(this) { ready.clear() }
        store.touchAsk(nowMs())
        if (!isOnline()) {
          task = false
          log("no network; answering 100007")
          store.recordOutcome(nowMs(), AgpsOutcome.NO_NETWORK, "the watch asked and the phone has no network", false)
          tx(AgpsMessages.AGPS_SERVICE, 0x01, AgpsMessages.operatorAnswer(AgpsMessages.CODE_NO_NETWORK), "operator answer (no network)")
          finishWith(AgpsOutcome.NO_NETWORK)
          return
        }
        log("answering 100000 and asking the watch for its parameters (1F/02)")
        tx(AgpsMessages.AGPS_SERVICE, 0x01, AgpsMessages.operatorAnswer(AgpsMessages.CODE_OK), "operator answer")
        tx(AgpsMessages.AGPS_SERVICE, 0x02, AgpsMessages.parameterConsult(), "parameter consult")
      }
      2 -> {
        if (!task) {
          log("progress request but no request is running; ignored")
          return
        }
        log("progress request; answering state $state")
        tx(AgpsMessages.AGPS_SERVICE, 0x01, AgpsMessages.progressAnswer(timeBytes ?: ByteArray(0), state), "progress answer")
      }
      else -> log("unknown operation $op; ignored")
    }
  }

  private fun onConsult(packet: HuaweiPacket) {
    if (!task) {
      log("consult answer without a running request; ignored")
      return
    }
    val tlv = packet.getTlv()
    val consult = AgpsMessages.parseConsult(tlv)
    if (consult == null) {
      // The watch refused the question itself (e.g. 118001 when no request is open on its side): nothing was started, so there is
      // nothing to tell it either; the request just ends here.
      val code = tlv?.getBytes(0x7F, null)?.let { agpsUnsigned(it) }
      val why = if (code != null) "the watch answered the phone's question with error $code (it has no request open); only the watch can start one" else "the watch's answer had no parameters"
      logError(why)
      task = false
      store.recordOutcome(nowMs(), AgpsOutcome.WATCH_REFUSED, why, false)
      consultSeen?.complete(Unit)
      finishWith(AgpsOutcome.WATCH_REFUSED)
      return
    }
    log("consult answer: download version ${consult.version}, tag ${consult.tag.length} chars (${consult.tagNames}), ${consult.urls.size} urls")
    logRaw("consult tag=\"${consult.tag}\" urls=${consult.urls}")
    store.recordAsk(nowMs(), consult.version, consult.tagNames)
    consultSeen?.complete(Unit)
    state = 1
    download?.cancel()
    download = scope.launch { download(consult) }
  }

  private suspend fun download(consult: AgpsConsult) {
    state = 2
    val started = nowMs()
    val force = forceNext
    forceNext = false
    if (force) store.clearRetry()
    val waitUntil = store.retryAtMs()
    // The last download failed a moment ago; the watch asks every few seconds, so it is not hammered with retries. Only for asks that download
    // (Broadcom, or HW_AGNSS with the switch on): a declined kind keeps its own answer.
    val waiting = !force && AgpsLab.downloads(consult, store.labAgnss) && nowMs() < waitUntil
    val result = if (waiting) {
      AgpsFetch.failed(AgpsOutcome.DOWNLOAD_FAILED, "waiting ${(waitUntil - nowMs()) / 1000} s before trying the download again")
    } else {
      try {
        withTimeout(timing.downloadTimeoutMs) { withContext(Dispatchers.IO) { source.fetch(consult, force) } }
      } catch (e: TimeoutCancellationException) {
        AgpsFetch.failed(AgpsOutcome.DOWNLOAD_FAILED, "download timed out after ${timing.downloadTimeoutMs / 1000} s")
      }
    }
    kotlin.coroutines.coroutineContext.ensureActive()
    if (result.ok) {
      fetched = result
      val size = result.files.values.sumOf { it.size }
      if (!result.fromCache) store.recordDownloaded(nowMs(), result.dataTimeMs, size, result.source)
      synchronized(this) { ready.putAll(result.files) }
      log("download finished in ${nowMs() - started} ms: ${result.files.entries.joinToString { "${it.key} ${it.value.size} bytes" }}")
      sendStatus(AgpsMessages.STATE_READY, "")
      armIdle(timing.pullWaitMs)
    } else {
      logError(result.message)
      val countsAsFailure = !waiting && (result.outcome == AgpsOutcome.DOWNLOAD_FAILED || result.outcome == AgpsOutcome.INVALID_FILE)
      store.recordOutcome(nowMs(), result.outcome, result.message, countsAsFailure)
      val answer = if (consult.version !in 0..3) AgpsMessages.STATE_UNSUPPORTED else AgpsMessages.STATE_FAILED
      sendStatus(answer, result.message)
      finishWith(result.outcome)
    }
  }

  private suspend fun sendStatus(state: Int, why: String) {
    kotlin.coroutines.coroutineContext.ensureActive()
    this.state = state
    if (state != AgpsMessages.STATE_READY) task = false
    log("sending file status $state (${stateName(state)})${if (why.isEmpty()) "" else ": $why"}")
    tx(AgpsMessages.AGPS_SERVICE, 0x03, AgpsMessages.fileStatus(state), "file status $state")
  }

  private fun stateName(state: Int) = when (state) {
    AgpsMessages.STATE_READY -> "ready"
    AgpsMessages.STATE_FAILED -> "failed"
    AgpsMessages.STATE_UNSUPPORTED -> "unsupported"
    else -> "?"
  }

  // 1C: the watch pulls the files (GB handleFileSendRequest ... handleFileDoneRequest)

  private fun fileNames(): List<String> = synchronized(this) { ready.keys.toList() }

  private fun refuse() {
    transfer = null
  }

  private suspend fun onFileList(packet: HuaweiPacket) {
    val tlv = packet.getTlv()
    val fileType = tlv?.agpsInt(0x02)?.toInt() ?: -1
    val productId = tlv?.agpsString(0x03).orEmpty()
    val names = fileNames()
    log("file list request: type $fileType, product \"$productId\"; offering ${names.size} files")
    transfer = null
    if (task && names.isNotEmpty()) armIdle(timing.stallMs)
    // GB leaves type 0 (files by product id) unimplemented; there is nothing to match it against here either.
    val content = if (fileType == 1 && names.isNotEmpty()) AgpsMessages.fileList(names) else AgpsMessages.refused()
    tx(AgpsMessages.FILE_SERVICE, 0x01, content, "file list")
  }

  private suspend fun onFileConsult(packet: HuaweiPacket) {
    val tlv = packet.getTlv() ?: return
    val watchCode = tlv.agpsInt(0x7F)
    if (watchCode != null && watchCode != 0L) {
      logError("watch reported error $watchCode in the file consult")
      refuse()
      return
    }
    val protocol = tlv.agpsString(0x01).orEmpty()
    val transferSize = tlv.agpsInt(0x03)?.toInt() ?: 0
    val maxDataSize = tlv.agpsInt(0x04)?.toInt() ?: 0
    val fileType = tlv.agpsInt(0x06)?.toInt() ?: 0
    log("file consult: protocol \"$protocol\", transfer size $transferSize, max data $maxDataSize, type $fileType")
    if (transferSize <= 0 || maxDataSize <= 0 || !((protocol.isNotEmpty() && fileType == 0) || fileType == 1)) {
      refuse()
      tx(AgpsMessages.FILE_SERVICE, 0x02, AgpsMessages.refused(), "file consult answer (refused)")
      return
    }
    transfer = Transfer(minOf(transferSize, Short.MAX_VALUE.toInt()), minOf(maxDataSize, AgpsPolicy.MAX_DATA_PER_REQUEST), fileType)
    if (task) armIdle(timing.stallMs)
    tx(AgpsMessages.FILE_SERVICE, 0x02, AgpsMessages.accepted(), "file consult answer")
  }

  private suspend fun onFileInfo(packet: HuaweiPacket) {
    val name = packet.getTlv()?.agpsString(0x01).orEmpty()
    val current = transfer
    val data = synchronized(this) { ready[name] }
    if (current == null || current.fileType != 1 || data == null) {
      log("file info request for \"$name\" refused (${if (current == null) "no consult" else if (data == null) "not available" else "unsupported type"})")
      refuse()
      tx(AgpsMessages.FILE_SERVICE, 0x03, AgpsMessages.refused(), "file info answer (refused)")
      return
    }
    current.name = name
    current.data = data
    current.frames = 0
    current.sentEnd = 0
    val crc = CheckSums.getCRC16(data, 0x0000)
    log("file info: $name ${data.size} bytes, crc16 %04x".format(crc))
    armIdle(timing.stallMs)
    tx(AgpsMessages.FILE_SERVICE, 0x03, AgpsMessages.fileInfo(data.size, crc), "file info answer")
  }

  private suspend fun onDataRequest(packet: HuaweiPacket) {
    val tlv = packet.getTlv() ?: return
    val name = tlv.agpsString(0x01).orEmpty()
    val offset = tlv.agpsInt(0x02)?.toInt() ?: -1
    val wanted = tlv.agpsInt(0x03)?.toInt() ?: -1
    val current = transfer
    val data = current?.data
    if (current == null || data == null || name.isEmpty() || name != current.name || offset < 0 || offset > data.size) {
      log("data request for \"$name\" at $offset refused")
      refuse()
      tx(AgpsMessages.FILE_SERVICE, 0x04, AgpsMessages.refused(), "data answer (refused)")
      return
    }
    val size = minOf(data.size - offset, current.maxDataSize)
    val count = if (size > 0) AgpsPolicy.frameCount(size, current.frameSize) else 0
    if (count == null) {
      logError("data request for $name at $offset would need more than ${AgpsPolicy.MAX_FRAMES} frames of ${current.frameSize} bytes; refused")
      refuse()
      tx(AgpsMessages.FILE_SERVICE, 0x04, AgpsMessages.refused(), "data answer (refused, too many frames)")
      return
    }
    armIdle(timing.stallMs)
    // The name the watch stores the file under is the SHA-256 of this phone-side address plus the plain name (GB getHexDigest).
    val storedName = EphemerisNet.addressDigest(address) + name
    tx(AgpsMessages.FILE_SERVICE, 0x04, AgpsMessages.dataAnswer(storedName, offset), "data answer")
    if (size <= 0) return
    log("sending $name bytes $offset..${offset + size} of ${data.size} (asked for $wanted) in $count frames")
    try {
      session.send(
        AgpsChunkPacket(session.params, data.copyOfRange(offset, offset + size), current.frameSize.toShort(), count),
        "AGPS $name chunk",
        logFrames = false,
      )
      current.sentEnd = maxOf(current.sentEnd, offset + size)
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      logError("chunk of $name not sent: ${e.message ?: e.javaClass.simpleName}")
    }
  }

  private suspend fun onUploadDone(packet: HuaweiPacket) {
    val result = packet.getTlv()?.agpsInt(0x01)
    val current = transfer
    val name = current?.name
    val total = current?.data?.size ?: 0
    val complete = current != null && name != null && total > 0 && current.sentEnd >= total
    log("upload done: result $result, file $name, ${current?.frames ?: 0} data acks, sent ${current?.sentEnd ?: 0} of $total bytes")
    transfer = null
    disarmIdle()
    tx(AgpsMessages.FILE_SERVICE, 0x06, AgpsMessages.accepted(), "upload done answer")
    if (!task) return
    if (complete) {
      delivered += name!!
      val all = synchronized(this) { ready.keys.all { it in delivered } }
      val fetch = fetched
      store.recordDelivered(nowMs(), fetch?.dataTimeMs ?: nowMs(), total, fetch?.source ?: "", address)
      if (all) {
        task = false
        finishWith(AgpsOutcome.DELIVERED)
      } else {
        armIdle(timing.pullWaitMs)
      }
    } else {
      task = false
      val why = "the watch closed the transfer after ${current?.sentEnd ?: 0} of $total bytes (result $result)"
      logError(why)
      store.recordOutcome(nowMs(), AgpsOutcome.WATCH_REFUSED, why, false)
      finishWith(AgpsOutcome.WATCH_REFUSED)
    }
  }

  private companion object {
    const val STALL = -1
  }
}

/**
 * The satellite-data job of the process: attaches an [AgpsExchange] to every live connection, keeps the phone-side copy
 * fresh from the background sync, and answers the app's questions (status, refresh now, cancel).
 */
internal class EphemerisLink(
  context: Context,
  private val link: WearLink,
  private val events: WearEvents,
  private val scope: CoroutineScope,
  private val settings: WearSettings,
) {
  private val appContext = context.applicationContext
  val store = AgpsStore(appContext)
  private val source: AgpsSource = NetworkAgpsSource(
    EphemerisCache(appContext),
    store,
    log = { message -> events.log(LogDirection.INFO, null, null, null, "AGPS: $message") },
    isOnline = { isOnline(appContext) },
  )
  private val lock = Any()
  private var exchange: AgpsExchange? = null
  private var exchangeSession: HuaweiSession? = null
  private val refreshing = AtomicBoolean(false)

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, "AGPS: $message")

  private fun logError(message: String) = events.log(LogDirection.ERROR, null, null, null, "AGPS: $message")

  fun onLinkState(state: LinkState) {
    when (state) {
      LinkState.CONNECTED, LinkState.SYNCING -> {
        val handle = link.handle() ?: return
        val fresh: AgpsExchange
        synchronized(lock) {
          if (exchangeSession === handle.session) return
          exchange?.stop()
          fresh = AgpsExchange(handle.session, handle.address, events, scope, source, store, { isOnline(appContext) })
          exchange = fresh
          exchangeSession = handle.session
        }
        fresh.start()
      }
      LinkState.DISCONNECTED -> synchronized(lock) {
        exchange?.stop()
        exchange = null
        exchangeSession = null
      }
      else -> Unit
    }
  }

  private fun currentExchange(): AgpsExchange? = synchronized(lock) { exchange }

  /** What the Watch tab shows; cheap, read from the store and the live exchange. */
  fun status(): Map<String, Any?> {
    val ex = currentExchange()
    val address = link.handle()?.address ?: settings.watchAddress
    val forThisWatch = store.deliveredAddress.isEmpty() || address == null || store.deliveredAddress.equals(address, ignoreCase = true)
    return mapOf(
      "linked" to (ex != null),
      "phase" to (ex?.phase?.takeIf { it != "idle" } ?: if (refreshing.get()) "downloading" else "idle"),
      "cachedAt" to store.cachedAtMs,
      "cachedSize" to store.cachedSize,
      "cachedSource" to store.cachedSource,
      "deliveredAt" to if (forThisWatch) store.deliveredAtMs else 0L,
      "deliveredSize" to if (forThisWatch) store.deliveredSize else 0,
      "deliveredSource" to if (forThisWatch) store.deliveredSource else "",
      "expiresAt" to if (forThisWatch) AgpsPolicy.expiresAtMs(store.deliveredDataMs, store.deliveredSource) else 0L,
      "lastAskAt" to store.lastAskMs,
      "lastAskVersion" to store.lastAskVersion,
      "lastAskTags" to store.lastAskTags,
      "outcome" to store.lastOutcome,
      "error" to store.lastError,
      "attemptAt" to store.lastAttemptMs,
      "retryAt" to store.retryAtMs(),
      "failures" to store.failures,
      "labAgnss" to store.labAgnss,
    )
  }

  /**
   * "Update now": downloads fresh data and, with a watch connected, starts the exchange from the phone so the watch takes it.
   * Without a watch the data is kept on the phone and goes out when the watch asks. Returns `{outcome, message}`.
   */
  suspend fun refreshNow(): Map<String, Any?> {
    if (!refreshing.compareAndSet(false, true)) return result(AgpsOutcome.BUSY, "an update is already running")
    try {
      store.clearRetry()
      val ex = currentExchange()
      val outcome = if (ex != null) {
        when (val probed = ex.probe(force = true)) {
          // The watch said nothing: at least keep the data ready on the phone for when it asks.
          AgpsOutcome.WATCH_SILENT -> downloadOnly(AgpsOutcome.WATCH_SILENT)
          else -> probed
        }
      } else {
        downloadOnly(AgpsOutcome.STORED)
      }
      log("update now: $outcome")
      return result(outcome, store.lastError)
    } finally {
      refreshing.set(false)
    }
  }

  private fun result(outcome: String, message: String): Map<String, Any?> = mapOf("outcome" to outcome, "message" to message)

  /**
   * What "Update now" downloads when the watch is not part of it: the HW_AGNSS file when the experimental switch is on and the watch's last ask
   * was exactly that kind, else the default data.
   */
  private fun refreshConsult(): AgpsConsult =
    if (store.labAgnss && AgpsLab.askedHwAgnss(store.lastAskVersion, store.lastAskTags)) {
      AgpsConsult(store.lastAskVersion, "/${AgpsLab.KIND}", emptyList())
    } else {
      AgpsConsult.DEFAULT
    }

  /** Downloads the data for [refreshConsult] to the phone; [okOutcome] is what a good download is reported as. */
  private suspend fun downloadOnly(okOutcome: String): String {
    val consult = refreshConsult()
    val fetch = try {
      withTimeout(DOWNLOAD_TIMEOUT_MS) { withContext(Dispatchers.IO) { source.fetch(consult, true) } }
    } catch (e: TimeoutCancellationException) {
      AgpsFetch.failed(AgpsOutcome.DOWNLOAD_FAILED, "download timed out after ${DOWNLOAD_TIMEOUT_MS / 1000} s")
    }
    val now = System.currentTimeMillis()
    if (fetch.ok) {
      store.recordDownloaded(now, fetch.dataTimeMs, fetch.files.values.sumOf { it.size }, fetch.source)
      // A silent watch is still reported as silent: the stored outcome says why nothing was sent.
      if (okOutcome == AgpsOutcome.STORED) store.recordOutcome(now, AgpsOutcome.STORED, "", false)
      else store.recordOutcome(now, okOutcome, "the watch did not answer; the data is ready on the phone", false)
      return okOutcome
    }
    logError(fetch.message)
    store.recordOutcome(now, fetch.outcome, fetch.message, fetch.outcome == AgpsOutcome.DOWNLOAD_FAILED || fetch.outcome == AgpsOutcome.INVALID_FILE)
    return fetch.outcome
  }

  /** The user cancels an update that is running. */
  suspend fun cancel() {
    currentExchange()?.cancel()
  }

  /** The experimental switch of Settings > Advanced ([AgpsLab]); it takes effect at the watch's next ask. */
  fun setLabAgnss(enabled: Boolean) {
    store.setLabAgnss(enabled)
    log("experimental HW_AGNSS data ${if (enabled) "on" else "off"}")
  }

  /**
   * From the background sync, once per round: keeps the phone-side copy fresh so the watch's next request is answered at once,
   * and the failure wait ([AgpsPolicy.retryAtMs]) spaces the retries. Only while the watch asks for the default data (or has
   * not asked yet): a watch that wants another kind of data gets nothing out of the Broadcom file.
   */
  fun onSyncCycle() {
    scope.launch {
      try {
        prefetch()
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        logError("prefetch failed: ${e.message ?: e.javaClass.simpleName}")
      }
    }
  }

  private suspend fun prefetch() {
    if (store.lastAskVersion > 0) return
    val now = System.currentTimeMillis()
    if (!AgpsPolicy.prefetchDue(store.cachedAtMs, now, store.retryAtMs())) return
    if (!isOnline(appContext) || refreshing.get()) return
    log("keeping the phone's copy fresh (background)")
    val fetch = try {
      withTimeout(DOWNLOAD_TIMEOUT_MS) { withContext(Dispatchers.IO) { source.fetch(AgpsConsult.DEFAULT, false) } }
    } catch (e: TimeoutCancellationException) {
      AgpsFetch.failed(AgpsOutcome.DOWNLOAD_FAILED, "download timed out after ${DOWNLOAD_TIMEOUT_MS / 1000} s")
    }
    if (fetch.ok) {
      if (!fetch.fromCache) store.recordDownloaded(System.currentTimeMillis(), fetch.dataTimeMs, fetch.files.values.sumOf { it.size }, fetch.source)
    } else {
      logError(fetch.message)
      store.recordOutcome(System.currentTimeMillis(), fetch.outcome, fetch.message, fetch.outcome == AgpsOutcome.DOWNLOAD_FAILED || fetch.outcome == AgpsOutcome.INVALID_FILE)
    }
  }

  private companion object {
    const val DOWNLOAD_TIMEOUT_MS = 120_000L
  }
}
