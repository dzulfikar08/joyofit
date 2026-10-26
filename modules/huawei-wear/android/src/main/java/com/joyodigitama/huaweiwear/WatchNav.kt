package com.joyodigitama.huaweiwear

import android.content.Context

/**
 * Watch navigation (JRG-439, LAB): a session between `startWatchNav` and `stopWatchNav` registers [WatchNavService] on every connect, so JS
 * can send its navigation messages to JoyoFit's watch app. Behind the experimental switch [P2pSettings.watchNavLab] (off by default).
 * Every step is logged (`WatchNav:` lines, also in logcat under the `JoyoFit` tag). Twin: `WatchNav.swift`.
 */
internal class WatchNav(
  context: Context,
  private val settings: P2pSettings,
  private val events: WearEvents,
  private val stack: () -> P2pStack?,
) {
  private val phonePackage: String = context.applicationContext.packageName

  @Volatile
  private var active = false

  @Volatile
  private var config: WatchNavConfig? = null

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, "WatchNav: $message")

  private fun service(current: P2pStack?): WatchNavService? = current?.manager?.getRegisteredService(phonePackage) as? WatchNavService

  fun status(): Map<String, Any?> {
    val current = stack()
    val service = service(current)
    return mapOf(
      "enabled" to settings.watchNavLab,
      "active" to active,
      "p2p" to (current != null),
      "registered" to (service != null),
      "phonePackage" to phonePackage,
      "watchBundle" to WatchNavWire.PACKAGE,
      "placeholderFingerprints" to (config?.let { WatchNavWire.isPlaceholder(it.phoneFingerprint) || WatchNavWire.isPlaceholder(it.watchFingerprint) } ?: true),
      "watchApp" to (service?.watchApp ?: WatchNavService.UNKNOWN),
      "lastCode" to service?.lastCode,
      "lastHeardAt" to service?.lastHeardAt,
      "sent" to (service?.sent ?: 0),
      "acked" to (service?.acked ?: 0),
      "received" to (service?.received ?: 0),
    )
  }

  fun setEnabled(enabled: Boolean) {
    settings.watchNavLab = enabled
    log("lab switch ${if (enabled) "on" else "off"}")
    if (!enabled) stop()
  }

  @Synchronized
  fun start(config: WatchNavConfig): Map<String, Any?> {
    if (!settings.watchNavLab) {
      throw WearException(ErrorCodes.UNSUPPORTED, "Watch navigation is a lab feature; switch it on under Experimental first")
    }
    if (config.phoneFingerprint.isBlank() || config.watchFingerprint.isBlank()) {
      throw WearException(ErrorCodes.INVALID_ARGUMENT, "Watch navigation needs phoneFingerprint and watchFingerprint")
    }
    active = true
    this.config = config
    val placeholder = WatchNavWire.isPlaceholder(config.phoneFingerprint) || WatchNavWire.isPlaceholder(config.watchFingerprint)
    log("session start (phone $phonePackage, watch app ${WatchNavWire.PACKAGE}, fingerprints ${if (placeholder) "placeholder" else "set"})")
    stack()?.let { attach(it) } ?: log("not connected; registers on the next connect")
    return status()
  }

  /** Called on every new P2P stack: registers the service while a session runs and the switch is on. */
  @Synchronized
  fun attach(current: P2pStack) {
    val wanted = config
    if (!active || !settings.watchNavLab || wanted == null) return
    if (!DeviceCaps.supports(0x34, 0x01)) {
      log("the watch does not list the P2P service (34/01); not registered")
      return
    }
    val existing = service(current)
    if (existing != null && existing.config == wanted) return
    // A service with other fingerprints is replaced (registerService unregisters the old one).
    WatchNavService(current.manager, phonePackage, wanted, events).register()
  }

  fun send(json: String): Boolean {
    if (!active) {
      log("not sent ${WatchNavWire.summary(json)}: no session")
      return false
    }
    val service = service(stack())
    if (service == null) {
      log("not sent ${WatchNavWire.summary(json)}: not connected or no P2P service")
      return false
    }
    return service.send(json)
  }

  @Synchronized
  fun stop() {
    if (!active) return
    active = false
    stack()?.manager?.unregisterService(phonePackage)
    log("session stop; service unregistered")
  }
}
