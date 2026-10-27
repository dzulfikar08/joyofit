package com.joyodigitama.resttimer

import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Expo module implementing `RestTimer.ts` on Android: a countdown notification (`RestTimerNotification`). Calls return at once and never
 * throw: a rest timer that cannot be shown is not worth interrupting a workout for, the logger's end-of-rest alert still fires.
 */
class RestTimerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RestTimer")

    Function("isSupported") { true }

    Function("startRestTimer") { endsAt: Double, title: String, body: String, channelName: String ->
      guarded { RestTimerNotification.show(it, endsAt.toLong(), title, body, channelName) }
    }

    Function("stopRestTimer") {
      guarded { RestTimerNotification.cancel(it) }
      Unit
    }
  }

  private fun <T> guarded(work: (android.content.Context) -> T): T? {
    val context = appContext.reactContext?.applicationContext ?: return null
    return try {
      work(context)
    } catch (e: Exception) {
      Log.w(TAG, "rest timer notification failed", e)
      null
    }
  }

  private companion object {
    const val TAG = "RestTimer"
  }
}
