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
 * The phone's step counter (TYPE_STEP_COUNTER, one event per change), delivered as `eventName` (`onSteps` for a recorded workout,
 * `onLiveSteps` for a workout started on the watch) with the steps counted since this counter started and the wall-clock time of
 * the event. It never throws: without the sensor or the ACTIVITY_RECOGNITION permission it simply does not start, and the workout
 * runs without steps.
 */
internal class WorkoutSteps(private val context: Context, private val hub: SensorHub, private val eventName: String = "onSteps") {
  private var listener: SensorEventListener? = null

  /** Returns whether the counter runs now. */
  @Synchronized
  fun start(): Boolean {
    if (listener != null) return true
    if (!hasPermission(context)) return false
    val manager = context.getSystemService(SensorManager::class.java) ?: return false
    val sensor = manager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) ?: return false
    val logic = StepCounterLogic()
    val l = object : SensorEventListener {
      override fun onSensorChanged(event: SensorEvent) {
        if (event.values.isEmpty()) return
        val ts = StepCounterLogic.eventWallMs(event.timestamp, System.currentTimeMillis(), SystemClock.elapsedRealtimeNanos())
        hub.emit(eventName, mapOf("ts" to ts.toDouble(), "steps" to logic.total(event.values[0]).toDouble()))
      }

      override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
    }
    return try {
      // An on-change sensor: the delay does not matter, it reports when the counter moved.
      val ok = manager.registerListener(l, sensor, SensorManager.SENSOR_DELAY_NORMAL)
      if (ok) listener = l
      ok
    } catch (e: RuntimeException) {
      Log.w("BleSensors", "step counter did not start: ${e.message}")
      false
    }
  }

  @Synchronized
  fun stop() {
    val l = listener ?: return
    listener = null
    context.getSystemService(SensorManager::class.java)?.unregisterListener(l)
  }

  companion object {
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
    (steps ?: WorkoutSteps(context, hub, "onLiveSteps").also { steps = it }).start()

  @Synchronized
  fun stop() {
    steps?.stop()
    steps = null
  }
}
