package com.joyodigitama.huaweiwear

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV

/**
 * A workout started from the phone: Huawei Health's "phone-started linkage" over the legacy workout service. Reconstructed from Huawei
 * Health 17.0.8.300 (`HwExerciseCommandUtil.notifyOperatorStatus`, `HwWorkoutServiceUtils.getOperator*StringTlv`, `fjq.a`/`fjq.a(JSONObject)`),
 * UNVERIFIED on a watch; Gadgetbridge has no phone-started workout.
 *
 *  - `17/01` SetOperator, phone to watch: `81{02 operator, 03 linkage kind, 05 workout type, 06 operation time s, 87{08 distance dm,
 *    09 calories, 0A duration} , [0B version], 0C start time s, [0D run course version], [0E forbid pause]}`. Operator 1 start, 2 pause,
 *    3 resume, 4 stop. The watch answers `7F <code>` (100000 accepts) or an empty body.
 *  - `17/02` operator notice, watch to phone, when the person pauses, resumes or stops on the watch: `81{02 operator, 03 kind, 05 workout
 *    type, 06 time}`, answered `7F 04 <100000>`.
 *  - `17/03` operator status, phone to watch, `81 00`: used once after a start to see whether the watch really runs it.
 * Support: Huawei gates the whole feature on `17/01` being listed in SupportedCommands (DeviceCapability "23.1"); the optional tags on `17/12`
 * (23.18, "version" and "run course version") and `17/15` (23.21, "forbid pause"). The workout type is in the watch's own sport space (the
 * Gadgetbridge sport table, [WorkoutSportTypes]); Huawei Health itself only passes 1, 2, 3, 5, 7, 134, 135, 137 and 255 through, so 140 is
 * the one value here that no Huawei Health code path was seen to send.
 */
internal object WatchWorkoutWire {
  const val SERVICE = 0x17
  const val SET_OPERATOR = 0x01
  const val OPERATOR_NOTICE = 0x02
  const val GET_OPERATOR = 0x03
  const val OPEN_CLOSE_REPORT = 0x12
  const val WORKOUT_CAPABILITY = 0x15

  const val OP_START = 1
  const val OP_PAUSE = 2
  const val OP_RESUME = 3
  const val OP_STOP = 4

  /** Tag 03: 1 is a single track workout (`fjq.b(int)`); 2 is a run-plan session, which JoyoFit never sends. */
  const val LINK_SINGLE_TRACK = 1

  /** GB sport table: STRENGTH_TRAINING. */
  const val SPORT_STRENGTH_TRAINING = 140

  const val OK = 100_000

  /** Optional tags the watch's SupportedCommands ask for. */
  class Shape(val linkTags: Boolean, val forbidPause: Boolean)

  /** `17/12` listed: Huawei sends the version and run course tags; `17/15` listed: it sends forbid pause. */
  fun shapeFor(supports: (service: Int, command: Int) -> Boolean) =
    Shape(linkTags = supports(SERVICE, OPEN_CLOSE_REPORT), forbidPause = supports(SERVICE, WORKOUT_CAPABILITY))

  /** `ego.e(int)`: the shortest big-endian bytes of a non-negative value, at least one. */
  fun minimalBytes(value: Int): ByteArray {
    require(value >= 0) { "negative value $value" }
    var size = 1
    while (size < 4 && (value ushr (8 * size)) != 0) size++
    return ByteArray(size) { (value ushr (8 * (size - 1 - it))).toByte() }
  }

  /** The `17/01` TLV. [nowMs] is the operation time, [startMs] the moment the workout started (also sent with pause, resume and stop). */
  fun operatorTlv(operator: Int, workoutType: Int, nowMs: Long, startMs: Long, shape: Shape): HuaweiTLV {
    val body = HuaweiTLV()
      .put(0x02, minimalBytes(operator))
      .put(0x03, minimalBytes(LINK_SINGLE_TRACK))
      .put(0x05, minimalBytes(workoutType))
      .put(0x06, (nowMs / 1000).toInt())
      .put(0x87, HuaweiTLV().put(0x08, 0).put(0x09, 0).put(0x0A, 0))
    if (shape.linkTags) body.put(0x0B, minimalBytes(0))
    body.put(0x0C, (startMs / 1000).toInt())
    if (shape.linkTags) body.put(0x0D, minimalBytes(0))
    if (shape.forbidPause) body.put(0x0E, minimalBytes(0))
    return HuaweiTLV().put(0x81, body)
  }

  fun setOperator(params: HuaweiPacket.ParamsProvider, operator: Int, workoutType: Int, nowMs: Long, startMs: Long, shape: Shape): HuaweiPacket =
    RawPacket(params, SERVICE, SET_OPERATOR, operatorTlv(operator, workoutType, nowMs, startMs, shape))

  /** `17/03 81 00`. */
  fun statusRequest(params: HuaweiPacket.ParamsProvider): HuaweiPacket = RawPacket(params, SERVICE, GET_OPERATOR, HuaweiTLV().put(0x81))

  /** The answer's result code (`7F`), null when the watch answered without one. */
  fun resultCode(tlv: HuaweiTLV?): Int? {
    if (tlv == null || !tlv.contains(0x7F)) return null
    return tlv.getBytes(0x7F, null)?.let { LiveWorkoutWire.signedWhenFour(it) }
  }

  /**
   * What `17/03` or `17/02` says about the watch's workout. [operator]: 1 start, 2 pause, 3 resume, 4 stop. [trainMonitorState] (`17/03`
   * tag 02): non-zero while the watch counts a workout; 0 with operator 1 is its GO screen ([WatchPhase]).
   */
  class WatchOperator(val operator: Int?, val sportType: Int?, val workoutType: Int?, val trainMonitorState: Int? = null) {
    val phase: WatchPhase get() = WatchPhase.of(trainMonitorState, operator)
    val running: Boolean get() = phase == WatchPhase.RUNNING
  }

  /** `17/03` answer (`81{02 trainMonitorState, 03 operator, 04 sport, 06 workout type}`) or `17/02` notice (`81{02 operator, 03 sport, 05 workout type}`). */
  fun parseStatus(tlv: HuaweiTLV?): WatchOperator? {
    if (tlv == null || !tlv.contains(0x81)) return null
    val body = tlv.getObject(0x81)
    fun int(tag: Int) = body.getBytes(tag, null)?.let { LiveWorkoutWire.unsigned(it)?.toInt() }
    return WatchOperator(operator = int(0x03), sportType = int(0x04), workoutType = int(0x06) ?: int(0x04), trainMonitorState = int(0x02))
  }

  fun parseNotice(tlv: HuaweiTLV?): WatchOperator? {
    if (tlv == null) return null
    val body = if (tlv.contains(0x81)) tlv.getObject(0x81) else tlv
    fun int(tag: Int) = body.getBytes(tag, null)?.let { LiveWorkoutWire.unsigned(it)?.toInt() }
    return WatchOperator(operator = int(0x02), sportType = int(0x03), workoutType = int(0x05))
  }

  /** The answer to a `17/02` notice: `7F 04 <100000>`. */
  fun noticeAck(params: HuaweiPacket.ParamsProvider): HuaweiPacket = RawPacket(params, SERVICE, OPERATOR_NOTICE, HuaweiTLV().put(0x7F, OK))

  /**
   * The code the Fit 4 Pro (6.1.0.117) gives every `17/01`, whatever the operator, sport or tag subset (observed 2026-10-21): "the watch could
   * not do it". Huawei Health uses the same number in the other direction (its `17/02` answer when pausing, resuming or stopping its own
   * workout failed). The watch gives no reason in the answer.
   */
  const val ERR_FAILED = 123_002

  /** Service 0x2E command 0x03, Huawei Health's wear state query (`mrs`: service 46, command 3, request `01 00`; listed by the Fit 4 Pro). */
  const val WEAR_SERVICE = 0x2E
  const val WEAR_STATUS = 0x03

  /**
   * Tag 01 of the `2E/03` answer: 2 is "not worn" (Huawei Health shows its "not worn" dialog for it, `RateControlCourseDetailFragment` / `etj`), anything
   * else is worn. Never captured on a watch: JoyoFit has not yet seen this answer. Not the same as DeviceConfig `01/3D`, whose answer `01 01 02` on the
   * Fit 4 Pro is something else (Huawei Health does not read the wear state from it).
   */
  const val WEAR_NOT_WORN = 2

  fun wearRequest(params: HuaweiPacket.ParamsProvider): HuaweiPacket = RawPacket(params, WEAR_SERVICE, WEAR_STATUS, HuaweiTLV().put(0x01))

  /** The wear state in a `2E/03` answer: false not worn, true worn, null when the answer has no state. */
  fun wornFrom(tlv: HuaweiTLV?): Boolean? {
    val state = tlv?.getBytes(0x01, null)?.firstOrNull()?.toInt() ?: return null
    return state != WEAR_NOT_WORN
  }

  /** [tlv] as the plaintext hex the watch gets or gave (the wire frame is encrypted), for the log. */
  fun plain(tlv: HuaweiTLV?): String = tlv?.serialize()?.toHex() ?: "(empty)"
}

/** What a start, pause, resume or stop came to. [wire] is the string JS reads. */
internal enum class WatchWorkoutOutcome(val wire: String) {
  /** The watch accepted the command (and, for a start, reports the workout running). */
  CONFIRMED("confirmed"),

  /** The command went out; the watch did not confirm it (no answer, or a start the status poll does not show). */
  SENT("sent"),

  /** The watch answered with an error code. */
  REFUSED("refused"),

  /** The watch does not list `17/01`. */
  UNSUPPORTED("unsupported"),

  NOT_CONNECTED("not_connected"),
}

internal class WatchWorkoutResult(val outcome: WatchWorkoutOutcome, val code: Int? = null, val worn: Boolean? = null) {
  /** [worn]: the wear state the watch reported right after a refusal (false: not on the wrist), null when it was not asked or did not say. */
  fun toJs(): Map<String, Any?> = mapOf("outcome" to outcome.wire, "code" to code, "worn" to worn)
}

/**
 * Starts, pauses, resumes and stops a workout on the watch from the phone ([WatchWorkoutWire]). One workout at a time, owned by the caller
 * (the strength logger): while it is owned [LiveWorkout] does not open a mirror of it, because the phone already has its own screen for it.
 */
internal class WatchWorkoutControl(
  private val link: WearLink,
  private val events: WearEvents,
  private val scope: CoroutineScope,
  private val nowMs: () -> Long = System::currentTimeMillis,
) {
  private class Owned(val sport: Int, val startedAtMs: Long) {
    var state = "running"
  }

  private val lock = Any()
  private var owned: Owned? = null
  private var attached: HuaweiSession? = null
  private var notices: AutoCloseable? = null
  private var lastWatchOperator: Int? = null

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, message)

  /** True from a start until its stop, a stop on the watch or [OWNER_MAX_MS]: [LiveWorkout] stays quiet meanwhile. */
  fun owns(): Boolean = synchronized(lock) {
    val o = owned ?: return false
    if (nowMs() - o.startedAtMs > OWNER_MAX_MS) {
      owned = null
      return false
    }
    true
  }

  fun listed(): Boolean = DeviceCaps.supports(WatchWorkoutWire.SERVICE, WatchWorkoutWire.SET_OPERATOR)

  fun status(): Map<String, Any?> {
    val o = synchronized(lock) { owned }
    return mapOf(
      "connected" to (link.handle() != null),
      "supported" to listed(),
      "active" to (o != null),
      "sport" to o?.sport,
      "state" to o?.state,
      "watchOperator" to synchronized(lock) { lastWatchOperator },
    )
  }

  fun onLinkState(state: LinkState) {
    when (state) {
      LinkState.CONNECTED, LinkState.SYNCING -> {
        val session = link.handle()?.session ?: return
        synchronized(lock) {
          if (session === attached) return
          notices?.close()
          attached = session
          notices = session.subscribe(WatchWorkoutWire.SERVICE.toByte(), WatchWorkoutWire.OPERATOR_NOTICE.toByte(), "workout operator notice") { onNotice(it, session) }
        }
        log(
          "Watch workout: watch lists 17/01=${listed()} 17/02=${DeviceCaps.supports(WatchWorkoutWire.SERVICE, WatchWorkoutWire.OPERATOR_NOTICE)} " +
            "17/03=${DeviceCaps.supports(WatchWorkoutWire.SERVICE, WatchWorkoutWire.GET_OPERATOR)} 17/12=${DeviceCaps.supports(WatchWorkoutWire.SERVICE, WatchWorkoutWire.OPEN_CLOSE_REPORT)} " +
            "17/15=${DeviceCaps.supports(WatchWorkoutWire.SERVICE, WatchWorkoutWire.WORKOUT_CAPABILITY)}",
        )
      }
      LinkState.DISCONNECTED -> synchronized(lock) {
        notices?.close()
        notices = null
        attached = null
      }
      else -> Unit
    }
  }

  /** The person paused, resumed or stopped on the watch. A stop there releases the workout. */
  private fun onNotice(packet: HuaweiPacket, session: HuaweiSession) {
    val notice = WatchWorkoutWire.parseNotice(packet.getTlv())
    log("Watch workout: the watch reports operator ${notice?.operator} (type ${notice?.workoutType})")
    synchronized(lock) {
      lastWatchOperator = notice?.operator
      val o = owned
      if (o != null) when (notice?.operator) {
        WatchWorkoutWire.OP_PAUSE -> o.state = "paused"
        WatchWorkoutWire.OP_RESUME -> o.state = "running"
        WatchWorkoutWire.OP_STOP -> owned = null
      }
    }
    scope.launch {
      try {
        session.send(WatchWorkoutWire.noticeAck(session.params), "workout operator notice ack")
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        log("Watch workout: notice ack not sent: ${e.message}")
      }
    }
  }

  suspend fun start(sport: Int): WatchWorkoutResult {
    synchronized(lock) { owned = null }
    val now = nowMs()
    // The workout is owned from before the command goes out: the watch's status may reach the phone before the answer does.
    val reserved = Owned(sport, now)
    synchronized(lock) { owned = reserved }
    val result = send(WatchWorkoutWire.OP_START, sport, now, now)
    if (result.outcome == WatchWorkoutOutcome.UNSUPPORTED || result.outcome == WatchWorkoutOutcome.NOT_CONNECTED || result.outcome == WatchWorkoutOutcome.REFUSED) {
      synchronized(lock) { if (owned === reserved) owned = null }
      return result
    }
    val running = verifyRunning()
    return when {
      running == true -> WatchWorkoutResult(WatchWorkoutOutcome.CONFIRMED, result.code)
      else -> result.also { if (running == false) log("Watch workout: the watch does not report a workout running after the start") }
    }
  }

  suspend fun pause(): WatchWorkoutResult = operate(WatchWorkoutWire.OP_PAUSE, "paused")

  suspend fun resume(): WatchWorkoutResult = operate(WatchWorkoutWire.OP_RESUME, "running")

  suspend fun stop(): WatchWorkoutResult {
    val result = operate(WatchWorkoutWire.OP_STOP, null)
    // Released whatever the answer: the phone's own workout is over, and the mirror must work again.
    synchronized(lock) { owned = null }
    return result
  }

  private suspend fun operate(operator: Int, newState: String?): WatchWorkoutResult {
    val o = synchronized(lock) { owned }
    if (o == null) {
      log("Watch workout: ${operatorName(operator)} without a workout started from the phone; nothing sent")
      return WatchWorkoutResult(WatchWorkoutOutcome.SENT)
    }
    val result = send(operator, o.sport, nowMs(), o.startedAtMs)
    if (newState != null && result.outcome != WatchWorkoutOutcome.REFUSED) synchronized(lock) { o.state = newState }
    return result
  }

  private suspend fun send(operator: Int, sport: Int, now: Long, startMs: Long): WatchWorkoutResult {
    val handle = link.handle()
    if (handle == null) {
      log("Watch workout: ${operatorName(operator)} not sent, no connected watch")
      return WatchWorkoutResult(WatchWorkoutOutcome.NOT_CONNECTED)
    }
    if (!listed()) {
      log("Watch workout: ${operatorName(operator)} not sent, the watch does not list 17/01")
      return WatchWorkoutResult(WatchWorkoutOutcome.UNSUPPORTED)
    }
    val shape = WatchWorkoutWire.shapeFor(DeviceCaps::supports)
    val packet = WatchWorkoutWire.setOperator(handle.session.params, operator, sport, now, startMs, shape)
    log("Watch workout: ${operatorName(operator)} (type $sport) sending 17/01 ${WatchWorkoutWire.plain(packet.getTlv())}")
    return try {
      val answer = handle.session.request(packet, REQUEST_MS, "workout ${operatorName(operator)}")
      val tlv = answer.getTlv()
      val code = WatchWorkoutWire.resultCode(tlv)
      log("Watch workout: ${operatorName(operator)} (type $sport) answered ${WatchWorkoutWire.plain(tlv)}" + if (code != null) " (code $code)" else "")
      if (code != null && code != WatchWorkoutWire.OK) {
        val worn = readWorn(handle.session)
        log("Watch workout: ${operatorName(operator)} refused with code $code, watch worn: ${worn ?: "unknown"}")
        WatchWorkoutResult(WatchWorkoutOutcome.REFUSED, code, worn)
      } else {
        WatchWorkoutResult(WatchWorkoutOutcome.CONFIRMED, code)
      }
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      log("Watch workout: ${operatorName(operator)} not confirmed: ${e.message}")
      WatchWorkoutResult(WatchWorkoutOutcome.SENT)
    }
  }

  /** `2E/03` wear state, asked after a refusal so the support log says whether the watch was on the wrist. Null when the watch does not list it or did not say. */
  private suspend fun readWorn(session: HuaweiSession): Boolean? {
    if (!DeviceCaps.supports(WatchWorkoutWire.WEAR_SERVICE, WatchWorkoutWire.WEAR_STATUS)) return null
    return try {
      val tlv = session.request(WatchWorkoutWire.wearRequest(session.params), REQUEST_MS, "wear status").getTlv()
      log("Watch workout: wear status 2E/03 answer ${WatchWorkoutWire.plain(tlv)}")
      WatchWorkoutWire.wornFrom(tlv)
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      log("Watch workout: wear status not read: ${e.message}")
      null
    }
  }

  /**
   * `17/03` once, a moment after a start: true when the watch reports its workout open (its GO screen, [WatchPhase.OPEN]) or running,
   * false when it reports none, null without an answer.
   */
  private suspend fun verifyRunning(): Boolean? {
    delay(VERIFY_DELAY_MS)
    val handle = link.handle() ?: return null
    return try {
      val answer = handle.session.request(WatchWorkoutWire.statusRequest(handle.session.params), REQUEST_MS, "workout status after start")
      val tlv = answer.getTlv()
      log("Watch workout: status after the start ${WatchWorkoutWire.plain(tlv)}")
      (WatchWorkoutWire.parseStatus(tlv)?.phase ?: WatchPhase.IDLE) != WatchPhase.IDLE
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      log("Watch workout: status after the start failed: ${e.message}")
      null
    }
  }

  private fun operatorName(operator: Int) = when (operator) {
    WatchWorkoutWire.OP_START -> "start"
    WatchWorkoutWire.OP_PAUSE -> "pause"
    WatchWorkoutWire.OP_RESUME -> "resume"
    else -> "stop"
  }

  companion object {
    const val REQUEST_MS = 5_000L
    const val VERIFY_DELAY_MS = 1_500L

    /** A workout nobody stopped (the app was killed between a start and its stop) stops being owned after this. */
    const val OWNER_MAX_MS = 8L * 60 * 60 * 1000
  }
}
