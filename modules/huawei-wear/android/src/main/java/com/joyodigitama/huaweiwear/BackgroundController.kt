package com.joyodigitama.huaweiwear

import android.app.AlarmManager
import android.app.PendingIntent
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.database.sqlite.SQLiteException
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/** Backoff between reconnect attempts: doubles up to a cap. */
internal fun nextBackoff(currentMs: Long): Long = minOf(currentMs * 2, BackgroundController.MAX_BACKOFF_MS)

/**
 * Keeps the remembered watch connected while [WatchService] runs: connects on start, reconnects with
 * exponential backoff when the link drops, wakes at once when Bluetooth turns on or the watch's ACL
 * link comes up, syncs and reads the battery every sync interval (timed by an idle-safe alarm), and
 * holds a partial wake lock while it works. It drives the same [WearLink] JS uses, so there is never
 * a second socket.
 */
internal class BackgroundController(private val runtime: WearRuntime) {
  private val context: Context = runtime.appContext
  private val settings = runtime.settings
  private val link = runtime.link
  private val log = runtime.sink

  /** Conflated: any number of nudges while the loop works collapse into one more pass. */
  private val wake = Channel<Unit>(Channel.CONFLATED)

  @Volatile
  private var resetBackoff = false

  private var loop: Job? = null
  private var nextSyncAtMs = 0L
  private var lastSyncAtMs = Long.MIN_VALUE / 2
  private var lastConnectedAtMs = Long.MIN_VALUE / 2
  private var wasConnected = false

  private val alarmManager = context.getSystemService(AlarmManager::class.java)
  private val wakeLock: PowerManager.WakeLock =
    context.getSystemService(PowerManager::class.java)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "joyofit:background")
      .apply { setReferenceCounted(false) }

  private val tickIntent: PendingIntent = PendingIntent.getBroadcast(
    context,
    0,
    Intent(ACTION_TICK).setPackage(context.packageName),
    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
  )

  private val receiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      when (intent.action) {
        ACTION_TICK -> nudge(false)
        BluetoothAdapter.ACTION_STATE_CHANGED -> {
          if (intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, -1) == BluetoothAdapter.STATE_ON) nudge(true)
        }
        BluetoothDevice.ACTION_ACL_CONNECTED -> {
          val device = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
          } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
          }
          if (device != null && device.address.equals(settings.watchAddress, ignoreCase = true)) nudge(true)
        }
      }
    }
  }

  fun start() {
    if (loop?.isActive == true) return
    val filter = IntentFilter().apply {
      addAction(ACTION_TICK)
      addAction(BluetoothAdapter.ACTION_STATE_CHANGED)
      addAction(BluetoothDevice.ACTION_ACL_CONNECTED)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      context.registerReceiver(receiver, filter)
    }
    nextSyncAtMs = 0L
    loop = runtime.scope.launch { run() }
    scheduleTick()
  }

  fun stop() {
    loop?.cancel()
    loop = null
    try {
      context.unregisterReceiver(receiver)
    } catch (e: IllegalArgumentException) {
      // Never registered: start() was not reached.
    }
    alarmManager.cancel(tickIntent)
    if (wakeLock.isHeld) wakeLock.release()
  }

  /** Wakes the loop. [reset] clears the reconnect backoff (Bluetooth came back, the watch is near). */
  fun nudge(reset: Boolean) {
    if (reset) resetBackoff = true
    if (!wakeLock.isHeld) wakeLock.acquire(WAKE_LOCK_MS)
    wake.trySend(Unit)
  }

  /** The link dropped or came up: look at it again. */
  fun onLinkChanged() = nudge(false)

  /** The interval changed: the next sync is one new interval away. */
  fun reschedule() {
    nextSyncAtMs = SystemClock.elapsedRealtime() + intervalMs()
    scheduleTick()
  }

  private fun intervalMs() = settings.syncIntervalMinutes * 60_000L

  private fun scheduleTick() {
    alarmManager.setAndAllowWhileIdle(
      AlarmManager.ELAPSED_REALTIME_WAKEUP,
      SystemClock.elapsedRealtime() + intervalMs(),
      tickIntent,
    )
  }

  private enum class Attempt { CONNECTED, FAILED, BLOCKED }

  private suspend fun run() {
    var backoff = INITIAL_BACKOFF_MS
    while (true) {
      if (!wakeLock.isHeld) wakeLock.acquire(WAKE_LOCK_MS)
      val address = settings.watchAddress
      var waitMs: Long
      when {
        address == null || !settings.backgroundEnabled -> waitMs = IDLE_WAIT_MS
        runtime.paused -> waitMs = IDLE_WAIT_MS
        else -> when (runtime.status.value.state) {
          LinkState.DISCONNECTED -> {
            if (wasConnected) {
              wasConnected = false
              // A link that held for a while earns a fresh backoff; one that flaps keeps growing it.
              if (SystemClock.elapsedRealtime() - lastConnectedAtMs > STABLE_LINK_MS) backoff = INITIAL_BACKOFF_MS
            }
            if (resetBackoff) {
              backoff = INITIAL_BACKOFF_MS
              resetBackoff = false
            }
            when (connect(address)) {
              Attempt.CONNECTED -> continue
              Attempt.FAILED -> {
                // The failed attempt's own DISCONNECTED event nudged the loop; only an outside nudge may skip the wait.
                if (!resetBackoff) wake.tryReceive()
                runtime.setNote("Disconnected. Retrying in ${backoff / 1000} s.")
                waitMs = backoff
                backoff = nextBackoff(backoff)
              }
              Attempt.BLOCKED -> {
                wake.tryReceive()
                waitMs = IDLE_WAIT_MS
              }
            }
          }
          LinkState.CONNECTED -> {
            val now = SystemClock.elapsedRealtime()
            if (!wasConnected) {
              wasConnected = true
              lastConnectedAtMs = now
              // Sync right after (re)connecting unless one just ran.
              if (now - lastSyncAtMs > RESYNC_AFTER_RECONNECT_MS) nextSyncAtMs = 0L
            }
            if (now >= nextSyncAtMs) {
              if (cycle()) visitDueWatch()
              waitMs = maxOf(1L, nextSyncAtMs - SystemClock.elapsedRealtime())
            } else {
              waitMs = nextSyncAtMs - now
            }
          }
          // Connecting from the app, or syncing: look again soon.
          else -> waitMs = BUSY_POLL_MS
        }
      }
      if (wakeLock.isHeld) wakeLock.release()
      withTimeoutOrNull(waitMs) { wake.receive() }
    }
  }

  private suspend fun connect(address: String): Attempt {
    if (link.needsBind(address)) {
      runtime.setNote("Not bound yet. Connect once from the Device tab.")
      return Attempt.BLOCKED
    }
    if (link.needsPairing(address)) {
      // A connect would make Android start a pairing (a system dialog the watch has to accept); only a connect the person opens in the app may.
      runtime.setNote("Not paired in Android's Bluetooth settings.")
      return Attempt.BLOCKED
    }
    try {
      // The background link never starts a first bind (allowFirstBind stays false): only a connect the user confirms in the app does.
      link.connect(address, allowFirstBind = false)
      return Attempt.CONNECTED
    } catch (e: CancellationException) {
      throw e
    } catch (e: WearException) {
      when (e.errorCode) {
        ErrorCodes.BLUETOOTH_OFF -> {
          runtime.setNote("Waiting for Bluetooth.")
          return Attempt.BLOCKED
        }
        ErrorCodes.BIND_CONFIRMATION -> {
          runtime.setNote("Not bound yet. Connect once from the Device tab.")
          return Attempt.BLOCKED
        }
        ErrorCodes.BLUETOOTH_PERMISSION -> {
          runtime.setNote("Bluetooth permission is missing.")
          return Attempt.BLOCKED
        }
        ErrorCodes.NOT_PAIRED -> {
          // Android's pairing is gone: retrying with backoff cannot restore it. The next interval tick, Bluetooth coming back or the
          // watch's own ACL link (it has reconnected after the user paired it again) tries once more.
          runtime.setNote("Not paired in Android's Bluetooth settings.")
          return Attempt.BLOCKED
        }
      }
      log.log(LogDirection.INFO, null, null, null, "Background connect failed [${e.errorCode}]: ${e.message}")
      return Attempt.FAILED
    }
  }

  /**
   * One periodic round: sync, then battery, then the family summary upload. Failures are logged; the next interval retries.
   * True when the sync of the active watch went through.
   */
  private suspend fun cycle(): Boolean {
    nextSyncAtMs = SystemClock.elapsedRealtime() + intervalMs()
    scheduleTick()
    var synced = false
    try {
      link.syncActivity()
      synced = true
      lastSyncAtMs = SystemClock.elapsedRealtime()
    } catch (e: CancellationException) {
      throw e
    } catch (e: WearException) {
      if (e.errorCode != ErrorCodes.BUSY) {
        log.log(LogDirection.ERROR, null, null, null, "Background sync failed [${e.errorCode}]: ${e.message}")
      }
    }
    try {
      link.refreshBattery()
    } catch (e: CancellationException) {
      throw e
    } catch (e: WearException) {
      log.log(LogDirection.ERROR, null, null, null, "Background battery refresh failed [${e.errorCode}]: ${e.message}")
    }
    // Family monitoring posts the fresh summary and battery; it runs on its own and never fails the cycle.
    runtime.family.uploadAfterSync()
    return synced
  }

  /** A visit in progress; [aborted] is set when the user connects from the app meanwhile. */
  private class Visit(val address: String) {
    @Volatile
    var aborted = false
  }

  @Volatile
  private var visit: Visit? = null

  /** Visits tried by this process, wall-clock seconds: a failed visit waits for the next interval like a successful one. */
  private val lastVisitAttempt = HashMap<String, Long>()

  /** A connect from the app ends a visit in progress, so the app's connect does not meet a busy link. */
  fun abortVisit() {
    val current = visit ?: return
    current.aborted = true
    link.disconnectIfConnectedTo(current.address)
  }

  /**
   * After the active watch's own sync: when another watch has `bg_sync` on and is due ([nextVisit]), leaves the active link,
   * connects to it without making it the remembered watch, syncs it and disconnects. The loop reconnects the active watch
   * afterwards. A phone with one watch, or none with `bg_sync`, never gets past the first query.
   */
  private suspend fun visitDueWatch() {
    val active = settings.watchAddress ?: return
    val nowSec = System.currentTimeMillis() / 1000
    val candidates = try {
      runtime.syncStore.bgSyncWatches().filter { it.first != active }.map { (address, lastSync) ->
        VisitCandidate(address, lastSync, !link.needsBind(address), lastVisitAttempt[address])
      }
    } catch (e: SQLiteException) {
      log.log(LogDirection.ERROR, null, null, null, "Background visit: could not read the watches: ${e.message}")
      return
    }
    if (candidates.isEmpty()) return
    val busy = runtime.paused || !settings.backgroundEnabled || runtime.status.value.state != LinkState.CONNECTED ||
      runtime.liveWorkout.isLive || runtime.liveHeartRate.inUse || runtime.hrv.isRunning || link.operationRunning()
    val due = nextVisit(candidates, active, nowSec, watchVisitIntervalMinutes(settings.syncIntervalMinutes) * 60, busy) ?: return
    visit(due.address, active, nowSec)
  }

  private suspend fun visit(address: String, active: String, nowSec: Long) {
    val current = Visit(address)
    visit = current
    lastVisitAttempt[address] = nowSec
    wakeLock.acquire(WAKE_LOCK_MS)
    log.log(LogDirection.INFO, null, null, null, "Background visit: leaving $active to sync $address, then going back")
    try {
      link.disconnect()
      // A visit never starts a first bind (needsBind was checked above) and never makes the watch the remembered one.
      link.connect(address, allowFirstBind = false, remember = false)
      if (current.aborted) return
      link.syncActivity()
      log.log(LogDirection.INFO, null, null, null, "Background visit: $address synced")
    } catch (e: CancellationException) {
      throw e
    } catch (e: WearException) {
      log.log(LogDirection.ERROR, null, null, null, "Background visit to $address failed [${e.errorCode}]: ${e.message}")
    } finally {
      visit = null
      if (!current.aborted) link.disconnectIfConnectedTo(address)
    }
  }

  companion object {
    const val ACTION_TICK = "com.joyodigitama.huaweiwear.action.TICK"
    const val INITIAL_BACKOFF_MS = 5_000L
    const val MAX_BACKOFF_MS = 5 * 60_000L

    /** A link that stayed up this long counts as healthy. */
    private const val STABLE_LINK_MS = 60_000L
    private const val RESYNC_AFTER_RECONNECT_MS = 5 * 60_000L
    private const val BUSY_POLL_MS = 5_000L
    private const val IDLE_WAIT_MS = 60 * 60_000L

    /** Safety release: the lock is dropped at every wait; this only bounds a stuck pass. */
    private const val WAKE_LOCK_MS = 5 * 60_000L
  }
}
