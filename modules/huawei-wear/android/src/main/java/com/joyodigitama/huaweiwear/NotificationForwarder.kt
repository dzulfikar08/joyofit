// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): HuaweiNotificationsManager.{onNotification,onDeleteNotification,
// addNotificationToCache} and the notification extraction of externalevents/NotificationListener.
package com.joyodigitama.huaweiwear

import android.app.Notification
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.service.notification.StatusBarNotification
import java.util.LinkedList
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Notifications
/**
 * Turns [StatusBarNotification]s into GB's Notifications packets and sends them over the single
 * link, if the watch supports them. Filters: own app, ongoing, group summaries, local-only, calls,
 * media controls, progress, empty text, per-app choice (default: all except system apps) and an
 * exact repeat of the same notification.
 */
internal class NotificationForwarder(
  context: Context,
  private val settings: WearSettings,
  private val link: WearLink,
  private val events: WearEvents,
  private val scope: CoroutineScope,
) {
  private val appContext = context.applicationContext
  private val ownPackage = appContext.packageName

  private val lock = Any()
  val actionCache = NotificationActionCache()
  private var attached: HuaweiSession? = null
  private val subscriptions = ArrayList<AutoCloseable>()

  /** HuaweiNotificationsManager.notificationSpecCache: the last notifications, for remove requests. */
  private val cache = LinkedList<WatchNotification>()

  /** Notification key -> hash of what was last sent for it; identical reposts are dropped. */
  private val lastSent = HashMap<String, Int>()
  private var nextId = 1
  private var msgId: Short = 0

  /** GB's `getNotificationId` counter, shared with the call notifications so message ids never collide. */
  fun nextMessageId(): Short = synchronized(lock) {
    msgId = NotificationPackets.nextMessageId(msgId)
    msgId
  }

  fun onPosted(sbn: StatusBarNotification) {
    if (!settings.notificationsEnabled) return
    val notification = sbn.notification ?: return
    // Cheapest drops first, before any text is read or app info looked up: what the watch would never show.
    if (NotificationPolicy.skipReasonEarly(notification.flags, notification.category, sbn.packageName, ownPackage) != null) return
    val choice = settings.appChoice(sbn.packageName)
    if (choice == false) return
    if (link.handle()?.notificationState?.supportsNotificationAlert != true) return

    val extras = notification.extras
    val appInfo = applicationInfo(sbn.packageName, extras)
    if (!NotificationPolicy.appAllowed(choice, appInfo != null && NotificationPolicy.isSystemApp(appInfo.flags))) return

    val title = extras?.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.let(::sanitize)
    val big = extras?.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
    val body = (if (!big.isNullOrBlank()) big else extras?.getCharSequence(Notification.EXTRA_TEXT)?.toString())
      ?.let(::sanitize)
    if (title.isNullOrBlank() && body.isNullOrBlank()) return

    val hash = listOf(title, body, sbn.packageName).hashCode()
    val spec: WatchNotification
    synchronized(lock) {
      if (lastSent[sbn.key] == hash) return
      if (lastSent.size > MAX_TRACKED) lastSent.clear()
      lastSent[sbn.key] = hash
      val id = nextId++
      val reply = actionCache.extractAndStore(sbn, id)
      spec = WatchNotification(
        id = id,
        key = sbn.key ?: "",
        sourceAppId = sbn.packageName,
        sourceName = appInfo?.let { label(it) } ?: sbn.packageName,
        title = title,
        body = body,
        channelId = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) notification.channelId else null,
        category = notification.category,
        whenMs = notification.`when`,
        isEmail = notification.category == Notification.CATEGORY_EMAIL,
        hasReply = reply != null,
        replyKey = reply?.key,
      )
      // GB keeps the last 11 and replaces one with the same id.
      if (cache.size > 10) cache.poll()
      cache.removeAll { it.id == spec.id }
      cache.offer(spec)
    }
    scope.launch { send(spec) }
  }

  fun onRemoved(sbn: StatusBarNotification) {
    sbn.key?.let { actionCache.remove(it) }
    val spec: WatchNotification?
    synchronized(lock) {
      lastSent.remove(sbn.key)
      val found = cache.firstOrNull { it.key == sbn.key && it.sourceAppId == sbn.packageName }
      if (found != null) cache.remove(found)
      spec = found
    }
    if (spec == null) return
    scope.launch { remove(spec) }
  }

  /**
   * JoyoFit's own alert on the watch (turn alerts while the watch runs a workout with a route). Not a phone notification: it skips the
   * own-app filter, the per-app choices and the notification-access switch, and needs only the link and the watch's notification support.
   * True when the watch took it.
   */
  suspend fun sendAlert(title: String, body: String): Boolean {
    val spec = synchronized(lock) {
      WatchNotification(
        id = nextId++,
        key = "",
        sourceAppId = ownPackage,
        sourceName = ALERT_SOURCE_NAME,
        title = sanitize(title),
        body = sanitize(body),
        channelId = null,
        category = null,
        whenMs = System.currentTimeMillis(),
        isEmail = false,
      )
    }
    return send(spec)
  }

  private suspend fun send(spec: WatchNotification): Boolean {
    val handle = link.handle() ?: return false
    val state = handle.notificationState
    if (!state.supportsNotificationAlert) {
      events.log(LogDirection.INFO, null, null, null, "Notification from ${spec.sourceAppId} not sent: the watch does not support notifications")
      return false
    }
    try {
      val id = synchronized(lock) {
        msgId = NotificationPackets.nextMessageId(msgId)
        msgId
      }
      val packet = NotificationPackets.build(handle.session.params, state, spec, id)
      handle.session.request(packet, Timeouts.QUERY_MS, "Notification (${spec.sourceAppId})")
      return true
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      events.log(LogDirection.ERROR, null, null, null, "Sending notification from ${spec.sourceAppId} failed: ${e.message}")
      return false
    }
  }

  /** HuaweiNotificationsManager.onDeleteNotification: only watches that can remove a single one. */
  private suspend fun remove(spec: WatchNotification) {
    val handle = link.handle() ?: return
    val state = handle.notificationState
    if (!state.supportsNotificationsRepeatedNotify && !state.supportsNotificationsRemoveSingle) return
    try {
      handle.session.request(NotificationPackets.remove(handle.session.params, spec), Timeouts.QUERY_MS, "NotificationRemove (${spec.sourceAppId})")
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      events.log(LogDirection.ERROR, null, null, null, "Removing notification from ${spec.sourceAppId} failed: ${e.message}")
    }
  }

  @Synchronized
  fun onLinkState(state: LinkState) {
    when (state) {
      LinkState.CONNECTED, LinkState.SYNCING -> {
        val session = link.handle()?.session ?: return
        if (session === attached) return
        detach()
        attached = session
        subscriptions += session.subscribe(
          Notifications.id,
          Notifications.NotificationReply.id,
          "notification reply",
        ) { onWatchReplyPacket(it, session) }
      }
      LinkState.DISCONNECTED -> {
        detach()
        actionCache.clear()
      }
      else -> Unit
    }
  }

  private fun detach() {
    subscriptions.forEach { it.close() }
    subscriptions.clear()
    attached = null
  }

  private fun onWatchReplyPacket(packet: HuaweiPacket, session: HuaweiSession) {
    scope.launch(Dispatchers.IO) {
      try {
        val reply = packet as? Notifications.NotificationReply.ReplyResponse ?: return@launch
        reply.parseTlv()

        val text = reply.text
        val key = reply.key ?: ""
        val type = reply.type

        events.log(
          LogDirection.INFO,
          Notifications.id.toInt(),
          Notifications.NotificationReply.id.toInt(),
          null,
          "Watch reply received: type=$type, subId=${reply.subId}, length=${text?.length ?: 0}",
        )

        // Only handle type 2 (app notification); ignore other types (e.g. type 1 SMS)
        if (type != 2) {
          events.log(
            LogDirection.INFO,
            Notifications.id.toInt(),
            Notifications.NotificationReply.id.toInt(),
            null,
            "Watch reply ignored: unsupported type $type",
          )
          return@launch
        }

        if (text.isNullOrBlank()) {
          events.log(LogDirection.INFO, null, null, null, "Watch reply text is blank, nothing to forward")
          return@launch
        }

        val cachedAction = actionCache.find(key, notificationId = reply.subId.takeIf { it != 0 })
        if (cachedAction == null) {
          events.log(
            LogDirection.ERROR,
            Notifications.id.toInt(),
            Notifications.NotificationReply.id.toInt(),
            null,
            "No matching notification action found for watch reply (type=$type, subId=${reply.subId})",
          )
          sendAck(session, (0x7f).toByte())
          return@launch
        }

        try {
          NotificationActionCache.sendReply(appContext, cachedAction, text)
          events.log(
            LogDirection.INFO,
            Notifications.id.toInt(),
            Notifications.NotificationReply.id.toInt(),
            null,
            "Smart reply sent to ${cachedAction.packageName} (type=$type, length=${text.length})",
          )
          sendAck(session, (0xff).toByte())
        } catch (e: Exception) {
          events.log(
            LogDirection.ERROR,
            Notifications.id.toInt(),
            Notifications.NotificationReply.id.toInt(),
            null,
            "Failed to send smart reply to ${cachedAction.packageName}: ${e.message ?: e.javaClass.simpleName}",
          )
          sendAck(session, (0x7f).toByte())
        }
      } catch (e: Exception) {
        events.log(
          LogDirection.ERROR,
          Notifications.id.toInt(),
          Notifications.NotificationReply.id.toInt(),
          null,
          "Error processing watch notification reply: ${e.message}",
        )
      }
    }
  }

  private suspend fun sendAck(session: HuaweiSession, ackCode: Byte) {
    try {
      session.send(
        Notifications.NotificationReply.ReplyAck(session.params, ackCode),
        "NotificationReplyAck",
      )
    } catch (e: Exception) {
      events.log(LogDirection.ERROR, null, null, null, "Sending NotificationReplyAck failed: ${e.message}")
    }
  }

  private fun applicationInfo(packageName: String, extras: android.os.Bundle?): ApplicationInfo? {
    val fromExtras = extras?.let {
      @Suppress("DEPRECATION")
      it.getParcelable<ApplicationInfo>(EXTRA_BUILDER_APPLICATION_INFO)
    }
    if (fromExtras != null) return fromExtras
    return try {
      appContext.packageManager.getApplicationInfo(packageName, 0)
    } catch (e: PackageManager.NameNotFoundException) {
      null
    }
  }

  private fun label(info: ApplicationInfo): String? =
    appContext.packageManager.getApplicationLabel(info).toString().takeIf { it.isNotBlank() }

  /** GB sanitizeUnicode keeps text the watch font can show; here only control characters are dropped. */
  private fun sanitize(text: String): String = text.filter { !Character.isISOControl(it) || it == '\n' }

  private companion object {
    const val MAX_TRACKED = 256

    /** `Notification.EXTRA_BUILDER_APPLICATION_INFO`, hidden constant. */
    const val EXTRA_BUILDER_APPLICATION_INFO = "android.appInfo"
  }
}

/** The sender name the watch shows above JoyoFit's own alerts. */
private const val ALERT_SOURCE_NAME = "JoyoFit"
