// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): util/MediaManager and
// externalevents/NotificationListener.handleMediaSessionNotification.
package com.joyodigitama.huaweiwear

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSession
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Build
import android.os.Handler
import android.service.notification.StatusBarNotification

internal class MediaSessionTracker(
  private val appContext: Context,
  private val mainHandler: Handler,
  private val onChanged: () -> Unit,
) {
  private val lock = Any()
  @Volatile private var active = false
  private var lastToken: MediaSession.Token? = null
  private var lastPackage: String? = null
  private var watchedControllers = emptyList<MediaController>()
  private var sessionsListenerRegistered = false

  private val controllerCallback = object : MediaController.Callback() {
    override fun onPlaybackStateChanged(state: PlaybackState?) = onChanged()
    override fun onMetadataChanged(metadata: MediaMetadata?) = onChanged()
    override fun onAudioInfoChanged(info: MediaController.PlaybackInfo) = onChanged()
    override fun onSessionDestroyed() = onChanged()
  }

  private val activeSessionsListener = MediaSessionManager.OnActiveSessionsChangedListener { controllers ->
    bindControllers(controllers.orEmpty())
    onChanged()
  }

  fun attach() {
    active = true
    mainHandler.post {
      if (!active) return@post
      registerActiveSessionsListener()
      refreshSessionCallbacks()
    }
  }

  fun detach() {
    active = false
    synchronized(lock) {
      lastToken = null
      lastPackage = null
    }
    mainHandler.post {
      unregisterActiveSessionsListener()
      unbindControllers()
    }
  }

  fun onNotificationPosted(sbn: StatusBarNotification): Boolean {
    val notification = sbn.notification ?: return false
    val token = extractMediaToken(notification) ?: return false
    synchronized(lock) {
      lastToken = token
      lastPackage = sbn.packageName
    }
    mainHandler.post { if (active) refreshSessionCallbacks() }
    onChanged()
    return true
  }

  fun onNotificationRemoved(sbn: StatusBarNotification) {
    val notification = sbn.notification
    val hadToken = notification != null && extractMediaToken(notification) != null
    var cleared = false
    synchronized(lock) {
      if (sbn.packageName == lastPackage || hadToken) {
        if (sbn.packageName == lastPackage) {
          lastToken = null
          lastPackage = null
        }
        cleared = true
      }
    }
    if (cleared) onChanged()
  }

  fun onNotificationListenerReady() {
    mainHandler.post {
      if (!active) return@post
      registerActiveSessionsListener()
      refreshSessionCallbacks()
      onChanged()
    }
  }

  fun activeController(): MediaController? {
    val manager = appContext.getSystemService(MediaSessionManager::class.java)
    if (manager != null) {
      val component = ComponentName(appContext, WatchNotificationListener::class.java)
      val list = runCatching { manager.getActiveSessions(component) }.getOrNull()
      if (!list.isNullOrEmpty()) {
        return list.firstOrNull { it.playbackState?.state == PlaybackState.STATE_PLAYING } ?: list[0]
      }
    }
    val token = synchronized(lock) { lastToken }
    if (token != null) {
      runCatching { return MediaController(appContext, token) }
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && manager != null) {
      val keyToken = runCatching { manager.mediaKeyEventSession }.getOrNull()
      if (keyToken != null) runCatching { return MediaController(appContext, keyToken) }
    }
    return null
  }

  private fun registerActiveSessionsListener() {
    if (sessionsListenerRegistered) return
    val manager = appContext.getSystemService(MediaSessionManager::class.java) ?: return
    runCatching {
      val component = ComponentName(appContext, WatchNotificationListener::class.java)
      manager.addOnActiveSessionsChangedListener(activeSessionsListener, component, mainHandler)
      sessionsListenerRegistered = true
    }
  }

  private fun unregisterActiveSessionsListener() {
    if (!sessionsListenerRegistered) return
    sessionsListenerRegistered = false
    val manager = appContext.getSystemService(MediaSessionManager::class.java) ?: return
    runCatching { manager.removeOnActiveSessionsChangedListener(activeSessionsListener) }
  }

  private fun refreshSessionCallbacks() {
    val manager = appContext.getSystemService(MediaSessionManager::class.java)
    val list = ArrayList<MediaController>()
    if (manager != null) {
      val component = ComponentName(appContext, WatchNotificationListener::class.java)
      runCatching { list.addAll(manager.getActiveSessions(component)) }
    }
    if (list.isEmpty()) {
      val token = synchronized(lock) { lastToken }
      if (token != null) runCatching { list.add(MediaController(appContext, token)) }
    }
    bindControllers(list)
  }

  private fun bindControllers(controllers: List<MediaController>) {
    unbindControllers()
    val bound = ArrayList<MediaController>(controllers.size)
    for (controller in controllers) {
      runCatching {
        controller.registerCallback(controllerCallback, mainHandler)
        bound.add(controller)
      }
    }
    watchedControllers = bound
  }

  private fun unbindControllers() {
    for (controller in watchedControllers) {
      runCatching { controller.unregisterCallback(controllerCallback) }
    }
    watchedControllers = emptyList()
  }

  private fun extractMediaToken(notification: Notification): MediaSession.Token? {
    val extras = notification.extras ?: return null
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      extras.getParcelable(Notification.EXTRA_MEDIA_SESSION, MediaSession.Token::class.java)
    } else {
      @Suppress("DEPRECATION")
      extras.getParcelable(Notification.EXTRA_MEDIA_SESSION)
    }
  }
}
