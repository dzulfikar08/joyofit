package com.joyodigitama.metronomeclick

import android.content.Context
import android.media.AudioAttributes
import android.media.SoundPool
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * Expo module implementing `MetronomeClick.ts`. A `SoundPool` plays the synthesized click as media audio
 * (`USAGE_MEDIA`, `CONTENT_TYPE_SONIFICATION`): it follows the media route (a Bluetooth headset when one is connected) and the media
 * volume. Nothing here requests audio focus or creates a `MediaSession`, so music keeps playing at full volume and media buttons
 * (earbuds, the watch's music control through `MediaSessionTracker`) keep going to the music app.
 *
 * Every call is posted to one `HandlerThread`, so `start`, `click` and `stop` run in the order JS called them and never block JS.
 * The pool exists only between `start` and `stop`. `SoundPool.load` finishes asynchronously; a click before it did is skipped.
 */
class MetronomeClickModule : Module() {
  private var thread: HandlerThread? = null
  private var handler: Handler? = null

  // Touched only on the handler thread.
  private var pool: SoundPool? = null
  private var soundId = 0
  private var loaded = false

  override fun definition() = ModuleDefinition {
    Name("MetronomeClick")

    OnCreate {
      val worker = HandlerThread("MetronomeClick").apply { start() }
      thread = worker
      handler = Handler(worker.looper)
    }

    // A JS reload must not leave a pool behind.
    OnDestroy {
      handler?.post { release() }
      thread?.quitSafely()
      handler = null
      thread = null
    }

    Function("start") { post { open() } }
    Function("click") { post { play() } }
    Function("stop") { post { release() } }
  }

  private fun post(work: () -> Unit) {
    handler?.post {
      try {
        work()
      } catch (e: Exception) {
        Log.w(TAG, "click sound failed", e)
      }
    }
  }

  private fun open() {
    if (pool != null) return
    val context: Context = appContext.reactContext?.applicationContext ?: return
    val file = File(context.cacheDir, "metronome-click.wav")
    file.writeBytes(ClickSound.wav())
    val attributes = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_MEDIA)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()
    // Two streams: a click still sounding when the next one starts (35 ms against at least 300 ms) is not cut.
    val created = SoundPool.Builder().setMaxStreams(2).setAudioAttributes(attributes).build()
    // Called on this thread (the pool was built on its looper).
    created.setOnLoadCompleteListener { loadedPool, id, status ->
      if (loadedPool === pool && id == soundId && status == 0) loaded = true
    }
    pool = created
    loaded = false
    soundId = created.load(file.path, 1)
  }

  private fun play() {
    val current = pool ?: return
    if (loaded) current.play(soundId, 1f, 1f, 1, 0, 1f)
  }

  private fun release() {
    pool?.release()
    pool = null
    soundId = 0
    loaded = false
  }

  private companion object {
    const val TAG = "MetronomeClick"
  }
}
