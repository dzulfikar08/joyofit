package com.joyodigitama.blesensors

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.SystemClock
import android.util.Log

/**
 * The phone's step counter, delivered as `eventName` (`onSteps` for a recorded workout, `onLiveSteps` for a workout started on the
 * watch) with the steps counted since this counter started and the wall-clock time of the newest of them, on the sensor's clock.
 * `TYPE_STEP_COUNTER` keeps the count and `TYPE_STEP_DETECTOR`, when the phone has one, moves it on step by step between two counter
 * events ([StepCounterLogic]); both are asked for at the fastest rate without batching, on the hub thread. It never throws: without
 * the counter or the ACTIVITY_RECOGNITION permission it simply does not start, and the workout runs without steps.
 *
 * It logs to logcat (tag `JoyoFit`, `label` names the run): the start with the sensors found, the first event of each sensor, every
 * 30 s what arrived ([StepLog]), and the stop.
 */
internal class WorkoutSteps(
  private val context: Context,
  private val hub: SensorHub,
  private val eventName: String = "onSteps",
  private val label: String = "recording",
) {
  private var active: Run? = null

  /** One counter run: the sensors' listener, its counting and its log. Its state lives on the hub thread. */
  private inner class Run(startedMs: Long) : SensorEventListener {
    val logic = StepCounterLogic(startedMs)
    val log = StepLog(label, startedMs)
    var steps = 0L

    val summary: Runnable = object : Runnable {
      override fun run() {
        info(log.summary(System.currentTimeMillis(), steps))
        hub.handler.postDelayed(this, SUMMARY_MS)
      }
    }

    override fun onSensorChanged(event: SensorEvent) {
      val now = System.currentTimeMillis()
      val ts = StepCounterLogic.eventWallMs(event.timestamp, now, SystemClock.elapsedRealtimeNanos())
      val reading = when (event.sensor.type) {
        Sensor.TYPE_STEP_COUNTER -> {
          val raw = event.values.firstOrNull() ?: return
          log.event(false, now, ts, raw)?.let { info(it) }
          logic.counter(raw, ts)
        }
        Sensor.TYPE_STEP_DETECTOR -> {
          log.event(true, now, ts, null)?.let { info(it) }
          logic.detector(ts)
        }
        else -> null
      } ?: return
      steps = reading.steps
      hub.emit(eventName, mapOf("ts" to reading.tsMs.toDouble(), "steps" to reading.steps.toDouble()))
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
  }

  /** Returns whether the counter runs now. */
  @Synchronized
  fun start(): Boolean {
    if (active != null) return true
    if (!hasPermission(context)) return notStarted("no ACTIVITY_RECOGNITION permission")
    val manager = context.getSystemService(SensorManager::class.java) ?: return notStarted("no sensor service")
    val counter = manager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) ?: return notStarted("this phone has no step counter")
    val detector = manager.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR)
    val r = Run(System.currentTimeMillis())
    return try {
      // Every step as soon as the phone has it: the fastest rate, maxReportLatencyUs 0 (no batching). The sensors report only when
      // they counted a step, and a phone may still hold its events back (src/features/sensors/phoneSteps.ts allows for that).
      if (manager.registerListener(r, counter, SensorManager.SENSOR_DELAY_FASTEST, 0, hub.handler)) {
        val withDetector = detector != null && manager.registerListener(r, detector, SensorManager.SENSOR_DELAY_FASTEST, 0, hub.handler)
        active = r
        info(r.log.started(describe(counter), if (withDetector) detector?.let { describe(it) } else null))
        hub.handler.postDelayed(r.summary, SUMMARY_MS)
        true
      } else {
        notStarted("the step counter refused the listener")
      }
    } catch (e: RuntimeException) {
      manager.unregisterListener(r)
      notStarted("${e.javaClass.simpleName}: ${e.message}")
    }
  }

  @Synchronized
  fun stop() {
    val r = active ?: return
    active = null
    context.getSystemService(SensorManager::class.java)?.unregisterListener(r)
    hub.handler.removeCallbacks(r.summary)
    // On the hub thread, after the events still queued there.
    hub.handler.post { info(r.log.stopped(System.currentTimeMillis(), r.steps)) }
  }

  private fun notStarted(why: String): Boolean {
    info("Phone steps ($label): not started: $why")
    return false
  }

  companion object {
    /** How often the log says what the sensors delivered. */
    private const val SUMMARY_MS = 30_000L

    /** Mirrors the watch link's lines (`WearRuntime.log`), so `adb logcat -s JoyoFit` shows the steps beside the workout. */
    private fun info(line: String) {
      Log.i("JoyoFit", "INFO $line")
    }

    private fun describe(sensor: Sensor): String =
      "\"${sensor.name}\" (${sensor.vendor}, wake-up ${sensor.isWakeUpSensor}, fifo ${sensor.fifoReservedEventCount}/${sensor.fifoMaxEventCount})"

    fun hasPermission(context: Context): Boolean =
      Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
        context.checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION) == PackageManager.PERMISSION_GRANTED

    fun hasSensor(context: Context): Boolean =
      context.getSystemService(SensorManager::class.java)?.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) != null
  }
}

/**
 * The step counter of the live screen of a workout started on the watch (`startLiveSteps`): a counter of its own, apart from the
 * recorded workout's in [WorkoutSession], so starting or ending one never touches the other. Process-wide: a JS reload keeps it.
 */
internal object LiveSteps {
  private var steps: WorkoutSteps? = null

  @Synchronized
  fun start(context: Context, hub: SensorHub): Boolean =
    (steps ?: WorkoutSteps(context, hub, "onLiveSteps", "live").also { steps = it }).start()

  @Synchronized
  fun stop() {
    steps?.stop()
    steps = null
  }
}
