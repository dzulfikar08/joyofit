package com.joyodigitama.resttimer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * The countdown of a rest between sets, on the lock screen and in the shade: an ongoing, silent notification on its own low-importance
 * channel with a chronometer that counts down to `endsAt` (`setWhen` + `setChronometerCountDown`). The system draws the numbers, so nothing
 * runs in the background while it ticks: no foreground service, no wake lock. `setTimeoutAfter` removes it when the rest is over, also when
 * the app was killed in between.
 *
 * The "rest is over" alert is another notification (expo-notifications, `strength/restNotification.ts`, an alerting channel); this one never
 * makes a sound, so the two do not talk over each other.
 */
internal object RestTimerNotification {
  /** Not shared with the foreground services (4707, 4708) or the watch notifications (4101 to 4104). */
  const val ID = 4721
  const val CHANNEL_ID = "strength-rest-live"

  /** False when nothing was posted: notifications are off for the app, or the rest is already over (any earlier countdown is removed then). */
  fun show(context: Context, endsAtMs: Long, title: String, body: String, channelName: String): Boolean {
    val manager = context.getSystemService(NotificationManager::class.java) ?: return false
    val timeout = RestTimerSpec.timeoutMs(endsAtMs, System.currentTimeMillis())
    if (timeout == null || !manager.areNotificationsEnabled()) {
      manager.cancel(ID)
      return false
    }
    ensureChannel(manager, channelName)
    val builder = Notification.Builder(context, CHANNEL_ID)
      .setSmallIcon(smallIcon(context))
      .setContentTitle(RestTimerSpec.clip(title))
      .setContentText(RestTimerSpec.clip(body))
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(Notification.CATEGORY_STATUS)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      // A rest is only useful on the phone in the hand: not mirrored to a watch or other bridged device.
      .setLocalOnly(true)
      .setShowWhen(true)
      .setWhen(endsAtMs)
      .setUsesChronometer(true)
      .setChronometerCountDown(true)
      .setTimeoutAfter(timeout)
    contentIntent(context)?.let { builder.setContentIntent(it) }
    manager.notify(ID, builder.build())
    return true
  }

  fun cancel(context: Context) {
    context.getSystemService(NotificationManager::class.java)?.cancel(ID)
  }

  private fun ensureChannel(manager: NotificationManager, name: String) {
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, name, NotificationManager.IMPORTANCE_LOW).apply {
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        setShowBadge(false)
        setSound(null, null)
        enableVibration(false)
      },
    )
  }

  /** A tap opens the logger by its link when an activity of this app answers it, else the launcher activity (which resumes the last screen). */
  private fun contentIntent(context: Context): PendingIntent? {
    val view = Intent(Intent.ACTION_VIEW, Uri.parse(RestTimerSpec.OPEN_URL)).setPackage(context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    val intent = if (context.packageManager.resolveActivity(view, 0) != null) view else context.packageManager.getLaunchIntentForPackage(context.packageName)
    return intent?.let { PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT) }
  }

  /** The status bar icon lives in another module (huawei-wear's `ic_stat_joyofit`); the app icon is the fallback. */
  private fun smallIcon(context: Context): Int {
    val statIcon = context.resources.getIdentifier("ic_stat_joyofit", "drawable", context.packageName)
    if (statIcon != 0) return statIcon
    val appIcon = context.applicationInfo.icon
    return if (appIcon != 0) appIcon else android.R.drawable.ic_dialog_info
  }
}
