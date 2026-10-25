package com.joyodigitama.huaweiwear

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Looper
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV

/** A request built from a ready TLV, encrypted like every post-auth packet. */
internal class RawPacket(params: HuaweiPacket.ParamsProvider, service: Int, command: Int, content: HuaweiTLV) : HuaweiPacket(params) {
  init {
    serviceId = service.toByte()
    commandId = command.toByte()
    tlv = content
    isEncrypted = true
    complete = true
  }
}

/**
 * What a workout started on the watch actually sends this phone (Fit 4 Pro, 6.1.0.117, observed 2026-10-15): no reverse
 * linkage, but GpsAndTime `18/02` `{01: 1}` about every 20 s while the workout runs ("send me the phone's GPS").
 *  - Phone GPS (GB `AsynchronousResponse.handleGpsRequest`, `SendGpsDataRequest`): answer `18/02 {7F: 100000}`, read the
 *    watch's wanted fields once (`18/01`), then stream every phone fix as `18/03 81{82{...}}` until `{01: 0}`. The phone's
 *    location updates themselves run until the live session ends ([PhoneGpsSession]): the watch withdraws its request once its
 *    own GPS has a fix, and the phone's track is the only distance and pace there is.
 *  - Live numbers (as Huawei Health does):
 *    open the realtime report with `17/12 {01: 1}`; the watch pushes `17/11`, decoded into [LiveWorkout].
 */
internal class WorkoutLink(
  context: Context,
  private val link: WearLink,
  private val events: WearEvents,
  private val scope: CoroutineScope,
  private val live: LiveWorkout,
) {
  private val appContext = context.applicationContext
  private val lock = Any()
  private var attached: HuaweiSession? = null
  private val subscriptions = ArrayList<AutoCloseable>()
  private var reportOpenOn: HuaweiSession? = null

  /** Read by the location listener on the main thread, written by the `18/01` request. */
  @Volatile
  private var gpsParams: GpsParams? = null
  private var listener: LocationListener? = null
  private var lastLocation: Location? = null
  private val phoneGps = PhoneGpsSession(start = ::startLocation, stop = ::stopLocation)

  init {
    live.onEnded = { phoneGps.sessionEnded() }
  }

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, message)

  /** `18/01` answer: which fields the watch takes (GB `GpsParameters.Response`). */
  class GpsParams(bitmap: Int) {
    val speed = bitmap and 0x01 != 0
    val distance = bitmap and 0x02 != 0
    val altitude = bitmap and 0x04 != 0
    val latLon = bitmap and 0x10 != 0
    val direction = bitmap and 0x40 != 0
    val precision = bitmap and 0x80 != 0
  }

  fun onLinkState(state: LinkState) {
    when (state) {
      LinkState.CONNECTED, LinkState.SYNCING -> {
        val session = link.handle()?.session ?: return
        synchronized(lock) {
          if (session === attached) return
          subscriptions.forEach { it.close() }
          subscriptions.clear()
          attached = session
          reportOpenOn = null
          gpsParams = null
          subscriptions += session.subscribe(GPS_SERVICE.toByte(), GPS_STATUS.toByte(), "phone GPS request") { onGpsStatus(it) }
          subscriptions += session.subscribe(WORKOUT_SERVICE.toByte(), REPORT_DATA.toByte(), "workout realtime report") { onReport(it) }
        }
        log(
          "Workout link: watch lists 18/01=${DeviceCaps.supports(GPS_SERVICE, 1)} 18/02=${DeviceCaps.supports(GPS_SERVICE, GPS_STATUS)} " +
            "18/03=${DeviceCaps.supports(GPS_SERVICE, GPS_DATA)} 17/11=${DeviceCaps.supports(WORKOUT_SERVICE, REPORT_DATA)} " +
            "17/12=${DeviceCaps.supports(WORKOUT_SERVICE, REPORT_OPEN)}",
        )
        // A workout may already be running (the app restarted mid-walk); the watch only pushes after an open.
        if (DeviceCaps.supports(WORKOUT_SERVICE, REPORT_OPEN)) scope.launch { openReport() }
        startStatusPoll(session)
      }
      LinkState.DISCONNECTED -> {
        synchronized(lock) {
          subscriptions.forEach { it.close() }
          subscriptions.clear()
          attached = null
          reportOpenOn = null
        }
        statusPoll?.cancel()
        statusPoll = null
        synchronized(lock) { lastLocation = null }
        phoneGps.linkLost(sessionEndsWithoutLink = live.endsWithoutLink)
      }
      else -> Unit
    }
  }

  // Workout status poll (17/03, Huawei Health): the only signal an indoor workout
  // gives. Request `81 00`; the answer's 81 holds 02 trainMonitorState, 03 operatorType (1 start, 2 pause, 3 resume,
  // 4 stop), 04 sportType, 06 workoutType.

  private var statusPoll: kotlinx.coroutines.Job? = null
  private var lastStatusLog: String? = null

  /** The watch has answered the poll with a workout state at least once on this link. */
  @Volatile
  private var statusAnswered = false

  private fun startStatusPoll(session: HuaweiSession) {
    statusPoll?.cancel()
    statusAnswered = false
    // The Fit 4 Pro does not list 17/03; it is probed anyway and the poll stops on the first failure.
    if (!DeviceCaps.supports(WORKOUT_SERVICE, STATUS)) log("Workout link: the watch does not list 17/03; probing it")
    statusPoll = scope.launch {
      kotlinx.coroutines.delay(STATUS_FIRST_MS)
      while (true) {
        val handle = link.handle() ?: return@launch
        if (handle.session !== session) return@launch
        // Once the watch has answered, a failed poll is a busy or briefly lost link, not a missing command: keep polling,
        // or a running workout would lose its end signal.
        if (!pollStatus(handle.session) && !statusAnswered) {
          log("Workout link: no workout status from the watch; indoor workouts need Start on the phone")
          return@launch
        }
        // A stop on the watch reaches the phone within a few answers: poll faster while a workout is followed.
        kotlinx.coroutines.delay(if (live.isLive) LiveWorkoutPolicy.LIVE_POLL_MS else LiveWorkoutPolicy.IDLE_POLL_MS)
      }
    }
  }

  /** Asks the status now, outside the poll's rhythm (a GPS request opened a session that waits for the answer). */
  private fun pollSoon() {
    val handle = link.handle() ?: return
    scope.launch { pollStatus(handle.session) }
  }

  /** False when the watch does not answer with a status (unsupported, or no answer yet). */
  private suspend fun pollStatus(session: HuaweiSession): Boolean {
    val answer = try {
      session.request(RawPacket(session.params, WORKOUT_SERVICE, STATUS, HuaweiTLV().put(0x81)), REQUEST_MS, "workout status")
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      log("Workout link: workout status failed: ${e.message}")
      return false
    }
    val tlv = answer.getTlv()
    val text = tlv?.toString() ?: "(empty)"
    // Logged when it changes, so the log shows what each state looks like.
    if (text != lastStatusLog) {
      lastStatusLog = text
      log("Workout link: workout status $text")
    }
    if (tlv == null || !tlv.contains(0x81)) {
      // A watch that already answered with a workout state and now sends none has no workout to report.
      if (!statusAnswered) return false
      live.watchStatus(running = false, paused = false, workoutType = null)
      return true
    }
    statusAnswered = true
    val body = tlv.getObject(0x81)
    fun int(tag: Int) = body.getBytes(tag, null)?.let { LiveWorkoutWire.unsigned(it)?.toInt() }
    val operator = int(0x03)
    // The sport is in tag 06 ("workout type") or 04 ("sport type"); only a code of the sport table is believed (a small enum
    // in one of them must not turn into "Running"). UNVERIFIED on a Band 11: the status line above shows both tags.
    val workoutType = WorkoutSportTypes.pick(int(0x06), int(0x04))
    when (operator) {
      1, 3 -> live.watchStatus(running = true, paused = false, workoutType = workoutType)
      2 -> live.watchStatus(running = true, paused = true, workoutType = workoutType)
      else -> live.watchStatus(running = false, paused = false, workoutType = workoutType)
    }
    return true
  }

  // Phone GPS

  private fun onGpsStatus(packet: HuaweiPacket) {
    val tlv = packet.getTlv() ?: return
    val enable = tlv.getBytes(0x01, null)?.firstOrNull()?.toInt() == 1
    scope.launch {
      val handle = link.handle() ?: return@launch
      try {
        handle.session.send(RawPacket(handle.session.params, GPS_SERVICE, GPS_STATUS, HuaweiTLV().put(0x7F, OK)), "phone GPS request OK")
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        log("Workout link: GPS answer not sent: ${e.message}")
      }
      if (enable) {
        // A workout screen is open on the watch: follow it. The request comes before the workout runs (the watch is still
        // looking for a fix), so the session only prepares until the status poll says it runs; ask it right away.
        if (live.gpsPing()) pollSoon()
        // The phone's own track does not wait for the watch's fields: they only shape the `18/03` feed.
        phoneGps.watchAsks()
        openReport()
        loadGpsParams()
      } else {
        synchronized(lock) { lastLocation = null }
        val following = live.isLive
        phoneGps.watchWithdraws(following)
        if (following) log("Workout link: the watch stopped asking for the phone's GPS; feed stopped, the workout's track goes on")
      }
    }
  }

  private suspend fun loadGpsParams(): GpsParams? {
    gpsParams?.let { return it }
    val handle = link.handle() ?: return null
    return try {
      val answer = handle.session.request(RawPacket(handle.session.params, GPS_SERVICE, 0x01, HuaweiTLV().put(0x81)), REQUEST_MS, "GpsParameters")
      val sub = answer.getTlv()?.getObject(0x81) ?: return null
      val bitmap = sub.getBytes(0x02, null)?.firstOrNull()?.toInt()?.and(0xFF) ?: return null
      log("Workout link: watch takes GPS fields bitmap 0x%02x".format(bitmap))
      GpsParams(bitmap).also { gpsParams = it }
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      log("Workout link: GpsParameters failed: ${e.message}")
      null
    }
  }

  private fun hasFineLocation() =
    appContext.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

  /** Starts the phone's location updates ([PhoneGpsSession]); every fix goes to the live session, and to the watch while it asks. */
  @SuppressLint("MissingPermission")
  private fun startLocation(): Boolean {
    if (!hasFineLocation()) {
      log("Workout link: the watch asks for the phone's GPS, but JoyoFit has no precise location permission")
      return false
    }
    val manager = appContext.getSystemService(LocationManager::class.java) ?: return false
    val l = LocationListener { location ->
      live.onLocation(
        TrackFix(
          timeMs = location.time,
          lat = location.latitude,
          lon = location.longitude,
          altitudeM = if (location.hasAltitude()) location.altitude else null,
          accuracyM = if (location.hasAccuracy()) location.accuracy else null,
          speedMps = if (location.hasSpeed()) location.speed else null,
          bearingDeg = if (location.hasBearing()) location.bearing else null,
        ),
      )
      // The `18/03` feed needs the fields the watch takes (`18/01`); without them yet, the fix is the track's only.
      val params = gpsParams
      if (phoneGps.feeding && params != null) scope.launch { sendLocation(location, params) }
    }
    synchronized(lock) {
      listener = l
      lastLocation = null
    }
    return try {
      manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, l, Looper.getMainLooper())
      log("Workout link: phone GPS started for the workout")
      true
    } catch (e: Exception) {
      synchronized(lock) { listener = null }
      log("Workout link: phone GPS not started: ${e.message}")
      false
    }
  }

  private fun stopLocation() {
    val l = synchronized(lock) { listener.also { listener = null; lastLocation = null } } ?: return
    appContext.getSystemService(LocationManager::class.java)?.removeUpdates(l)
    log("Workout link: phone GPS stopped")
  }

  private suspend fun sendLocation(location: Location, params: GpsParams) {
    val handle = link.handle() ?: return
    val last = synchronized(lock) { lastLocation.also { lastLocation = location } }
    val offsetMs = if (last != null) location.time - last.time else 1000L
    val point = HuaweiTLV()
    if (params.speed && location.hasSpeed()) point.put(0x03, location.speed.toInt().toShort())
    if (params.distance) point.put(0x04, (last?.let { location.distanceTo(it) } ?: 0f).toInt())
    if (params.altitude && location.hasAltitude()) point.put(0x05, location.altitude.toInt().toShort())
    val now = System.currentTimeMillis()
    point.put(0x07, ((now - offsetMs) / 1000).toInt())
    point.put(0x08, (now / 1000).toInt())
    if (params.latLon) point.put(0x09, location.latitude).put(0x0A, location.longitude)
    if (params.direction && location.hasBearing()) point.put(0x0D, location.bearing.toDouble())
    if (params.precision && location.hasAccuracy()) point.put(0x0E, location.accuracy.toDouble())
    try {
      handle.session.send(
        RawPacket(handle.session.params, GPS_SERVICE, GPS_DATA, HuaweiTLV().put(0x81, HuaweiTLV().put(0x82, point))),
        "phone GPS fix",
        logFrames = false,
      )
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      log("Workout link: GPS fix not sent: ${e.message}")
    }
  }

  // Realtime report

  private suspend fun openReport() {
    val handle = link.handle() ?: return
    if (synchronized(lock) { reportOpenOn === handle.session }) return
    try {
      val answer = handle.session.request(
        RawPacket(handle.session.params, WORKOUT_SERVICE, REPORT_OPEN, HuaweiTLV().put(0x01, 1.toByte())),
        REQUEST_MS,
        "workout realtime report open",
      )
      log("Workout link: realtime report open answered ${answer.getTlv()}")
      synchronized(lock) { reportOpenOn = handle.session }
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      log("Workout link: realtime report not opened: ${e.message}")
    }
  }

  private var reportsLogged = 0

  private fun onReport(packet: HuaweiPacket) {
    val tlv = packet.getTlv() ?: return
    // The decoded TLV is what checks the units against the watch screen: the first three, then every 30th.
    if (reportsLogged++ % 30 < 3) log("Workout link: realtime report $tlv")
    val values = if (tlv.contains(0x81)) tlv.getObject(0x81) else tlv
    live.onReport(WorkoutReport.parse(values))
  }

  companion object {
    const val GPS_SERVICE = 0x18
    const val GPS_STATUS = 0x02
    const val GPS_DATA = 0x03
    const val WORKOUT_SERVICE = 0x17
    const val REPORT_DATA = 0x11
    const val REPORT_OPEN = 0x12
    const val OK = 100000
    const val REQUEST_MS = 5_000L
    const val STATUS = 0x03
    const val STATUS_FIRST_MS = 5_000L
  }
}

/** One `17/11` realtime report (`parseWorkoutReportPlayData`). Units are Huawei's model's; see the comments. */
internal object WorkoutReport {
  class Parsed(val apply: (LiveMetrics) -> LiveMetrics, val operatorType: Int?)

  private fun uint(tlv: HuaweiTLV, tag: Int): Long? {
    if (!tlv.contains(tag)) return null
    val bytes = tlv.getBytes(tag, null) ?: return null
    if (bytes.isEmpty() || bytes.size > 8) return null
    return bytes.fold(0L) { acc, b -> (acc shl 8) or (b.toLong() and 0xFF) }
  }

  fun parse(tlv: HuaweiTLV): Parsed {
    val duration = uint(tlv, 0x02) // s (Huawei stores x1000 as ms)
    val hr = uint(tlv, 0x03)
    val zone = uint(tlv, 0x04)
    val steps = uint(tlv, 0x05)
    val cadence = uint(tlv, 0x06)
    val pace = uint(tlv, 0x07) // s per km
    val distance = uint(tlv, 0x08) // m (Huawei stores x10 as dm)
    val calories = uint(tlv, 0x09) // cal, like the step frames (UNVERIFIED)
    val rise = uint(tlv, 0x0A)
    val descent = uint(tlv, 0x0B)
    val altitude = tlv.getBytes(0x0C, null)?.let { LiveWorkoutWire.signedWhenFour(it) }
    val aerobic = uint(tlv, 0x0D)
    val anaerobic = uint(tlv, 0x0E)
    // Tag 11: `CommonUtil.c(bytes, 10)`, the hex digits read as decimal.
    val operator = tlv.getBytes(0x11, null)?.joinToString("") { "%02x".format(it) }?.toIntOrNull()
    return Parsed(
      apply = { m ->
        m.copy(
          durationSec = duration?.toInt() ?: m.durationSec,
          heartRate = hr?.toInt()?.takeIf { it in 1..250 } ?: m.heartRate,
          heartRateZone = zone?.toInt() ?: m.heartRateZone,
          steps = steps?.toInt() ?: m.steps,
          stepRate = cadence?.toInt() ?: m.stepRate,
          paceSecPerKm = pace?.toInt()?.takeIf { it > 0 } ?: m.paceSecPerKm,
          distanceM = distance?.toDouble() ?: m.distanceM,
          calories = calories?.let { it / 1000.0 } ?: m.calories,
          riseM = rise?.toInt() ?: m.riseM,
          descentM = descent?.toInt() ?: m.descentM,
          altitudeM = altitude ?: m.altitudeM,
          aerobicTe = aerobic?.let { it / 10.0 } ?: m.aerobicTe,
          anaerobicTe = anaerobic?.let { it / 10.0 } ?: m.anaerobicTe,
        )
      },
      operatorType = operator,
    )
  }
}
