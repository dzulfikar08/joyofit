package com.joyodigitama.huaweiwear

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.ModuleDefinitionBuilder

/**
 * The phone-started watch workout part of the `HuaweiWear` module (`getWatchWorkout` ... `stopWatchWorkout` in `HuaweiWearModule.ts`),
 * kept out of [HuaweiWearModule]. Call once from the module definition.
 */
internal fun ModuleDefinitionBuilder.watchWorkoutApi(runtime: () -> WearRuntime) {
  Function("getWatchWorkout") {
    runtime().watchWorkout.status()
  }

  AsyncFunction("startWatchWorkout") Coroutine { sport: Int ->
    runtime().watchWorkout.start(sport).toJs()
  }

  AsyncFunction("pauseWatchWorkout") Coroutine { ->
    runtime().watchWorkout.pause().toJs()
  }

  AsyncFunction("resumeWatchWorkout") Coroutine { ->
    runtime().watchWorkout.resume().toJs()
  }

  AsyncFunction("stopWatchWorkout") Coroutine { ->
    runtime().watchWorkout.stop().toJs()
  }

  // The band's realtime heart rate for a workout the phone records (the Run recorder): held like a live workout holds it, so it also runs in
  // the background and does not depend on a screen (`setLiveHeartRate` is the screen's, and stops when the app leaves the foreground).
  Function("setWorkoutHeartRate") { active: Boolean ->
    runtime().liveHeartRate.setWorkoutActive(active)
  }

  // The phone as a Bluetooth LE heart-rate sensor for a bike computer, relaying the watch's realtime heart rate ([HrSensorPeripheral]).
  Function("getHrSensor") {
    runtime().hrSensor.status()
  }

  Function("setHrSensor") { enabled: Boolean ->
    runtime().hrSensor.setEnabled(enabled)
  }
}
