package com.joyodigitama.huaweiwear

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import java.text.DateFormat
import java.util.Date
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * Foreground service (type `connectedDevice`) that keeps the remembered watch connected. It owns no
 * link of its own: it hosts the [BackgroundController] that drives [WearRuntime.link] and shows the
 * link state in its notification. Android 14 needs the `FOREGROUND_SERVICE_CONNECTED_DEVICE`
 * permission and a granted BLUETOOTH_CONNECT before it may start.
 */
class WatchService : Service() {
  private var controller: BackgroundController? = null
  private var notificationJob: Job? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val runtime = WearRuntime.get(this)
    createChannel()
    val notification = buildNotification(runtime.status.value, runtime.settings)
    val hasFineOrCoarse =
      checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED ||
        checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED
    try {
      val fgType = if (hasFineOrCoarse) {
        ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
      } else {
        ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
      }
      try {
        startForeground(NOTIFICATION_ID, notification, fgType)
      } catch (_: SecurityException) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
      }
    } catch (e: SecurityException) {
      // Android 14: no BLUETOOTH_CONNECT (or the foreground-service permission) yet.
      runtime.sink.log(LogDirection.ERROR, null, null, null, "Background service not started: ${e.message}")
      stopSelf()
      return START_NOT_STICKY
    }
    if (!runtime.settings.backgroundEnabled || runtime.settings.watchAddress == null) {
      stopSelf()
      return START_NOT_STICKY
    }
    running = true
    startRequested = false
    runtime.loadLastSync()
    if (controller == null) {
      controller = BackgroundController(runtime).also {
        runtime.controller = it
        it.start()
      }
      notificationJob = runtime.scope.launch {
        runtime.status.collect { status ->
          getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, buildNotification(status, runtime.settings))
        }
      }
    }
    return START_STICKY
  }

  override fun onDestroy() {
    notificationJob?.cancel()
    controller?.stop()
    val runtime = WearRuntime.get(this)
    if (runtime.controller === controller) runtime.controller = null
    controller = null
    running = false
    startRequested = false
    super.onDestroy()
  }

  private fun createChannel() {
    val channel = NotificationChannel(CHANNEL_ID, "Watch connection", NotificationManager.IMPORTANCE_LOW).apply {
      description = "Shows that JoyoFit keeps your watch connected"
      setShowBadge(false)
    }
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  private fun buildNotification(status: ServiceStatus, settings: WearSettings): Notification {
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    return Notification.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_joyofit)
      .setColor(getColor(R.color.joyofit_notification_accent))
      .setContentTitle(settings.watchName ?: "JoyoFit")
      .setContentText(statusText(status))
      .setCategory(Notification.CATEGORY_SERVICE)
      .setOngoing(true)
      .setShowWhen(false)
      .setOnlyAlertOnce(true)
      .setContentIntent(open)
      .build()
  }

  private fun statusText(status: ServiceStatus): String = when (status.state) {
    LinkState.CONNECTED, LinkState.SYNCING -> buildString {
      append(if (status.state == LinkState.SYNCING) "Syncing" else "Connected")
      status.battery?.let { append(" \u00B7 battery $it%") }
      status.lastSyncSec?.let {
        append(" \u00B7 synced ")
        append(DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(it * 1000)))
      }
    }
    LinkState.DISCONNECTED -> status.note ?: "Disconnected. Reconnecting automatically."
    else -> "Connecting"
  }

  companion object {
    const val CHANNEL_ID = "watch_link"
    const val NOTIFICATION_ID = 4101

    @Volatile
    private var running = false

    /** A start was requested and onStartCommand has not run yet. */
    @Volatile
    private var startRequested = false

    /** Running, or about to be: what `getBackgroundStatus()` reports. */
    val isActive: Boolean get() = running || startRequested

    fun start(context: Context) {
      startRequested = true
      try {
        context.startForegroundService(Intent(context, WatchService::class.java))
      } catch (e: RuntimeException) {
        startRequested = false
        throw e
      }
    }

    fun stop(context: Context) {
      startRequested = false
      context.stopService(Intent(context, WatchService::class.java))
    }
  }
}
