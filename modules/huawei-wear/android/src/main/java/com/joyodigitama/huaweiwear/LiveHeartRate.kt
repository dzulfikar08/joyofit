package com.joyodigitama.huaweiwear

import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.FitnessData

/**
 * The live heart rate on Today. While the UI wants it ([setActive]) and the watch is connected, the
 * watch is asked for realtime heart rate (FitnessData 07/1C, GB EnableRealtimeHeartRate) and every
 * reading it pushes becomes an `onHeartRate` event. It is switched off again when the UI no longer
 * wants it, and the watch's automatic heart rate is put back to the user's setting, because GB sends
 * both through the same boolean.
 */
internal class LiveHeartRate(
  private val link: WearLink,
  private val settings: WearSettings,
  private val events: WearEvents,
  private val scope: CoroutineScope,
) {
  private val lock = Any()
  private var attached: HuaweiSession? = null
  private var subscription: AutoCloseable? = null
  private var noticeSubscription: AutoCloseable? = null

  /** The session realtime heart rate is switched on in, so it is not asked twice and not left on. */
  private var running: HuaweiSession? = null

  @Volatile
  private var uiWanted = false

  /** A live workout ([LiveWorkout]) needs the readings, whatever screen is open and also in the background. */
  @Volatile
  private var workoutWanted = false

  /** A bike computer listens to the phone's heart-rate sensor ([HrSensorPeripheral]); separate from [workoutWanted], which a workout's end clears. */
  @Volatile
  private var sensorWanted = false

  /** A 1-minute HRV measurement ([HrvSpot]) owns service 0x19 meanwhile; live readings are off and come back after. */
  @Volatile
  private var paused = false

  private val wanted get() = (uiWanted || workoutWanted || sensorWanted) && !paused

  /** A live workout holds the heart-rate sensor; an HRV measurement must not take it over. */
  val workoutActive get() = workoutWanted || sensorWanted

  /** True while a screen or a live workout asks for live readings (even if an HRV measurement pauses them); a visit to another watch waits. */
  val inUse get() = uiWanted || workoutWanted || sensorWanted

  /** Switches the live readings off on the watch (when they were on) and keeps them off until [resume]. */
  suspend fun pause() {
    paused = true
    stop()
  }

  /** Puts the live readings back if the UI or a workout still wants them. */
  fun resume() {
    paused = false
    scope.launch { if (wanted) start() else stop() }
  }

  private val stateMutex = Mutex()
  private val undecoded = AtomicInteger()
  private val readings = AtomicInteger()

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, message)

  /** The UI asks for live heart rate (Today on screen) or stops asking (other screen, app in background). */
  fun setActive(active: Boolean) {
    uiWanted = active
    scope.launch { if (wanted) start() else stop() }
  }

  /** A live workout starts or ends. */
  fun setWorkoutActive(active: Boolean) {
    workoutWanted = active
    scope.launch { if (wanted) start() else stop() }
  }

  /** A bike computer subscribed to the phone's heart-rate sensor, or the last one left. */
  fun setSensorActive(active: Boolean) {
    sensorWanted = active
    scope.launch { if (wanted) start() else stop() }
  }

  /** Called with every link state change: subscribes on a new session, drops everything when the link is gone. */
  fun onLinkState(state: LinkState) {
    when (state) {
      LinkState.CONNECTED, LinkState.SYNCING -> {
        val session = link.handle()?.session ?: return
        val isNew = synchronized(lock) {
          if (session === attached) {
            false
          } else {
            subscription?.close()
            noticeSubscription?.close()
            attached = session
            subscription = session.subscribe(
              HealthSensors.REALTIME_SERVICE,
              HealthSensors.REALTIME_COMMAND,
              "realtime heart rate",
            ) { onPacket(it) }
            noticeSubscription = session.subscribe(HR_SERVICE.toByte(), HR_NOTICE.toByte(), "heart rate report") { onNotice(it) }
            running = null
            true
          }
        }
        if (isNew && wanted) scope.launch { start() }
      }
      LinkState.DISCONNECTED -> synchronized(lock) {
        subscription?.close()
        subscription = null
        noticeSubscription?.close()
        noticeSubscription = null
        attached = null
        running = null
      }
      else -> Unit
    }
  }

  private suspend fun start() {
    stateMutex.withLock {
      if (!wanted) return
      val handle = link.handle() ?: return
      if (synchronized(lock) { running === handle.session }) return
      // Huawei Health's own report (as observed): 19/01 {01: 1 open, 02: 2}; readings
      // arrive as 19/03. The Fit 4 Pro acknowledges 07/1C but never pushes on it, so both are asked for.
      if (DeviceCaps.supports(HR_SERVICE, HR_SWITCH)) {
        try {
          handle.session.send(
            RawPacket(handle.session.params, HR_SERVICE, HR_SWITCH, HuaweiTLV().put(0x01, 1.toByte()).put(0x02, 2.toByte())),
            "HeartRateReport on",
          )
        } catch (e: CancellationException) {
          throw e
        } catch (e: Exception) {
          events.log(LogDirection.ERROR, null, null, null, "Heart rate report not opened: ${e.message}")
        }
      } else {
        log("Live heart rate: the watch does not list 19/01")
      }
      if (!DeviceCaps.supports(FITNESS, REALTIME)) {
        synchronized(lock) { running = handle.session }
        return
      }
      try {
        handle.operationLock.withLock {
          HealthSensors.send(handle.session, events, listOf(HealthSensors.realtimeRequest(true)))
        }
        synchronized(lock) { running = handle.session }
      } catch (e: CancellationException) {
        throw e
      } catch (e: WearException) {
        events.log(LogDirection.ERROR, null, null, null, "Live heart rate not started: ${e.message}")
      }
    }
  }

  private suspend fun stop() {
    stateMutex.withLock {
      if (wanted) return
      val handle = link.handle() ?: return
      if (synchronized(lock) { running !== handle.session }) return
      try {
        if (DeviceCaps.supports(HR_SERVICE, HR_SWITCH)) {
          handle.session.send(
            RawPacket(handle.session.params, HR_SERVICE, HR_SWITCH, HuaweiTLV().put(0x01, 2.toByte()).put(0x02, 2.toByte())),
            "HeartRateReport off",
          )
        }
        handle.operationLock.withLock {
          val restore = ArrayList<SensorRequest>()
          restore += HealthSensors.realtimeRequest(false)
          if (DeviceCaps.supports(FITNESS, AUTOMATIC)) {
            restore += HealthSensors.automaticHeartRateRequest(settings.healthSensors.automaticHeartRate)
          }
          HealthSensors.send(handle.session, events, restore)
        }
        synchronized(lock) { running = null }
      } catch (e: CancellationException) {
        throw e
      } catch (e: WearException) {
        events.log(LogDirection.ERROR, null, null, null, "Live heart rate not stopped: ${e.message}")
      }
    }
  }

  /** Runs on the read thread: decode and hand off. */
  private fun onPacket(packet: HuaweiPacket) {
    val bpm = HealthSensors.decodeRealtime(packet.tlv)
    if (bpm == null) {
      // The raw frame is already in the log; say once in a while that it carried no reading.
      if (undecoded.getAndIncrement() % UNDECODED_LOG_EVERY == 0) {
        log("Live heart rate: pushed packet without a reading (${packet.tlv})")
      }
      return
    }
    events.heartRate(bpm, System.currentTimeMillis())
  }

  /** `19/03`: `81{82{03 bpm, 04 time s, 05 credibility}}`, possibly several. */
  private fun onNotice(packet: HuaweiPacket) {
    val tlv = packet.getTlv() ?: return
    val bpm = decodeNotice(tlv)
    if (bpm == null) {
      if (undecoded.getAndIncrement() % UNDECODED_LOG_EVERY == 0) log("Live heart rate: report without a reading ($tlv)")
      return
    }
    if (readings.getAndIncrement() % READINGS_LOG_EVERY == 0) log("Live heart rate: $bpm bpm (19/03)")
    events.heartRate(bpm, System.currentTimeMillis())
  }

  private companion object {
    val FITNESS = FitnessData.id.toInt()
    val REALTIME = HealthSensors.REALTIME_COMMAND.toInt()
    val AUTOMATIC = FitnessData.EnableAutomaticHeartrate.id.toInt()
    const val UNDECODED_LOG_EVERY = 10
    const val READINGS_LOG_EVERY = 12
    const val HR_SERVICE = 0x19
    const val HR_SWITCH = 0x01
    const val HR_NOTICE = 0x03

    /** The last reading in a report: tag 03 of the innermost `82` blocks. */
    fun decodeNotice(tlv: HuaweiTLV): Int? {
      var last: Int? = null
      for (outer in tlv.getObjects(0x81)) {
        for (inner in outer.getObjects(0x82)) {
          val bytes = inner.getBytes(0x03, null) ?: continue
          val bpm = LiveWorkoutWire.unsigned(bytes)?.toInt() ?: continue
          if (bpm in 25..250) last = bpm
        }
      }
      return last
    }
  }
}
