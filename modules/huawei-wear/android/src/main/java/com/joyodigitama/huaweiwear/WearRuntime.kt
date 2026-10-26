package com.joyodigitama.huaweiwear

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.sqlite.SQLiteException
import android.os.Build
import android.provider.Settings
import java.text.SimpleDateFormat
import java.time.Year
import java.util.Date
import java.util.Locale
import java.util.concurrent.CopyOnWriteArraySet
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.withLock

/** What the service notification shows. */
internal data class ServiceStatus(
  val state: LinkState,
  val battery: Int?,
  /** `SyncResult.to` of the last stored sync of this process, unix seconds. */
  val lastSyncSec: Long?,
  /** Why the link is down, when the background loop knows (waiting for Bluetooth, retry, paused...). */
  val note: String?,
)

/**
 * Process-wide owner of the one [WearLink]. The JS module, the foreground service, the notification
 * listener and the boot receiver all reach the watch through this object, so there is never a
 * second socket. Events fan out to whichever JS module instance is alive (none, when the app UI
 * is closed) and update [status] for the service notification.
 */
internal class WearRuntime private constructor(context: Context) {
  val appContext: Context = context.applicationContext
  val settings = WearSettings(appContext)
  val syncStore = SyncStore(appContext)
  val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

  val status = MutableStateFlow(ServiceStatus(LinkState.DISCONNECTED, null, null, null))

  private val listeners = CopyOnWriteArraySet<WearEvents>()

  /** Set by the foreground service while it runs. */
  @Volatile
  var controller: BackgroundController? = null

  /**
   * The user disconnected in the app while background mode is on: auto-reconnect waits until a
   * connect from the app, or background being switched off and on again.
   */
  @Volatile
  var paused = false
    private set

  /** What the support report quotes; fed from [events] whether or not a screen listens. */
  val supportLog = SupportLog()

  private val events: WearEvents = object : WearEvents {
    override fun state(state: LinkState, error: String?) {
      if (state == LinkState.CONNECTING) supportLog.connectStarted()
      supportLog.add("STATE ${state.wire}" + if (error != null) ": $error" else "")
      status.update { it.copy(state = state, note = if (state == LinkState.DISCONNECTED) it.note else null) }
      listeners.forEach { it.state(state, error) }
      if (state == LinkState.DISCONNECTED || state == LinkState.CONNECTED) controller?.onLinkChanged()
      forwarder.onLinkState(state)
      mediaControl.onLinkState(state)
      dataSync.onLinkState(state)
      features.onLinkState(state)
      weather.onLinkState(state)
      liveHeartRate.onLinkState(state)
      stress.onLinkState(state)
      extras.onLinkState(state)
      workoutLink.onLinkState(state)
      watchWorkout.onLinkState(state)
      p2p.onLinkState(state)
      ephemeris.onLinkState(state)
    }

    override fun battery(level: Int) {
      status.update { it.copy(battery = level) }
      listeners.forEach { it.battery(level) }
    }

    override fun syncComplete(summary: SyncSummary) {
      status.update { it.copy(lastSyncSec = summary.to) }
      healthConnect.onSyncComplete(summary)
      extras.onSyncComplete(summary)
      // Satellite data: keeps the phone's copy fresh (app syncs and the background loop alike) so the watch's next request is answered at once.
      ephemeris.onSyncCycle()
      listeners.forEach { it.syncComplete(summary) }
    }

    override fun log(direction: LogDirection, serviceId: Int?, commandId: Int?, hex: String?, message: String) {
      // Mirrored to logcat (tag JoyoFit) so the log can be read over adb, even with the UI closed.
      val ids = if (serviceId != null) " svc=%02x cmd=%02x".format(serviceId, commandId ?: 0) else ""
      val line = "${direction.wire.uppercase()}$ids $message" + if (hex != null) " $hex" else ""
      if (direction == LogDirection.ERROR) android.util.Log.e("JoyoFit", line) else android.util.Log.i("JoyoFit", line)
      // Without the frame hex: it is encrypted with this phone's key and means nothing to anyone reading the report.
      supportLog.add("${direction.wire.uppercase()}$ids $message")
      listeners.forEach { it.log(direction, serviceId, commandId, hex, message) }
    }

    override fun uploadProgress(bytes: Int, total: Int) {
      listeners.forEach { it.uploadProgress(bytes, total) }
    }

    override fun uploadResult(ok: Boolean, fileName: String, code: Int?, message: String) {
      listeners.forEach { it.uploadResult(ok, fileName, code, message) }
    }

    override fun heartRate(bpm: Int, tsMs: Long) {
      liveWorkout.onHeartRate(bpm)
      listeners.forEach { it.heartRate(bpm, tsMs) }
    }

    override fun watchMealLogged(payload: Map<String, Any?>) {
      listeners.forEach { it.watchMealLogged(payload) }
    }

    override fun faceCustomization(payload: Map<String, Any?>) {
      listeners.forEach { it.faceCustomization(payload) }
    }

    override fun liveWorkout(payload: Map<String, Any?>) {
      listeners.forEach { it.liveWorkout(payload) }
    }

    override fun hrvProgress(secondsLeft: Int, beats: Int) {
      listeners.forEach { it.hrvProgress(secondsLeft, beats) }
    }

    override fun deviceDiscovered(device: DiscoveredDevice) {
      listeners.forEach { it.deviceDiscovered(device) }
    }

    override fun scanState(scanning: Boolean, error: String?) {
      listeners.forEach { it.scanState(scanning, error) }
    }

    override fun watchNav(payload: Map<String, Any?>) {
      listeners.forEach { it.watchNav(payload) }
    }
  }

  /** Same fan-out the link reports through; background code logs here so the Log tab shows it. */
  val sink: WearEvents get() = events

  val link = WearLink(appContext, events, settings, syncStore)

  /** The support report: the last watch, its capabilities and the kept log, without addresses or serial. */
  fun supportReport(): Map<String, Any?> {
    val device = link.deviceInfo() ?: link.lastDeviceInfo
    val stamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.ROOT)
    val disconnects = link.disconnects.entries()
    return SupportReport.build(
      context = appContext,
      watchName = link.lastAttemptName ?: settings.watchName,
      device = device,
      linkState = link.currentState(),
      log = supportLog.lines(),
      transport = link.lastAttemptTransport,
      connection = connectionLines() + DisconnectLog.lines(disconnects.takeLast(RECENT_DISCONNECTS)) { stamp.format(Date(it)) },
      // The summary has the latest rows; when more were kept, the log part carries all of them.
      disconnectLog = if (disconnects.size > RECENT_DISCONNECTS) DisconnectLog.lines(disconnects) { stamp.format(Date(it)) } else emptyList(),
      extraSummary = WeatherDiagnostics.summary(weatherSettings.enabled) +
        NightHrvDiagnostics.summary(settings.autoStressListed, settings.stressEnabled, stress.status()["lastCalibratedAt"] as Long?),
    )
  }

  /**
   * What decides whether the watch link survives with the app closed or the screen off: the background mode switch, and whether Android
   * may stop the app ([BackgroundRestrictions]). One line each.
   */
  private fun connectionLines(): List<String> {
    val status = backgroundStatus()
    val background = "Background mode: ${if (settings.backgroundEnabled) "on" else "off (the link closes with the app)"}, " +
      "service ${if (status["running"] == true) "running" else "not running"}, " +
      "auto-reconnect ${if (paused) "paused after Disconnect in the app" else "active"}, sync every ${settings.syncIntervalMinutes} min"
    return listOf(background, BackgroundRestrictions.read(appContext).summaryLine())
  }

  val forwarder = NotificationForwarder(appContext, settings, link, events, scope)
  val features = PhoneFeatures(appContext, PhoneFeatureSettings(appContext), link, events, scope, forwarder::nextMessageId)
  val voipCalls = VoipCallNotifications(appContext, settings, features.calls)
  val mediaControl = WatchMediaControl(appContext, link, events, scope)
  val healthConnect = HealthConnectExporter(appContext, syncStore, events, scope)
  val weatherSettings = WeatherSettings(appContext)
  val weather = WeatherController(appContext, weatherSettings, link, events, scope)
  val watchfaces = WatchfaceController(appContext, link, events)
  val photoFaces = PhotoFaceController(appContext, link, events)
  val liveHeartRate = LiveHeartRate(link, settings, events, scope)
  val hrv = HrvSpot(link, liveHeartRate, syncStore, events)
  val stress = StressSwitch(link, settings, hrv, events, scope)
  val dataSync = DataSyncService(link, events, scope)
  val faceCustomizer = WatchfaceCustomizer(events, { watchfaces.entries() })
  val activityGoals = ActivityGoals(appContext, dataSync, events, settings)
  val bodyMetrics = BodyMetrics(appContext, syncStore, dataSync, events, settings)
  val diet = DietSync(appContext, syncStore, dataSync, events, settings, activityGoals, bodyMetrics)
  val liveWorkout = LiveWorkout(appContext, dataSync, events, settings, liveHeartRate, scope)
  val workoutLink = WorkoutLink(appContext, link, events, scope, liveWorkout)
  val watchWorkout = WatchWorkoutControl(link, events, scope).also { liveWorkout.phoneOwned = it::owns }
  val extras = WatchExtras(appContext, syncStore, link, events, scope)
  val language = WatchLanguage(appContext, settings, link, events, scope)
  val p2p = P2pController(appContext, P2pSettings(appContext), link, settings, syncStore, events, scope)
  val family = FamilyUploader(appContext, FamilySettings(appContext), FamilyStoreSource(syncStore), { status.value.battery }, events, scope)
  val ephemeris = EphemerisLink(appContext, link, events, scope, settings)

  init {
    DataSyncFeatures.install(this)
    repairSleepRules()
  }

  /**
   * Once after an update that changed the sleep rules ([SleepCleaning.SLEEP_RULES_VERSION]): the Health Connect sessions
   * the old rules wrote are replaced, and the night HRV rows that are no longer sleep are removed. The Today screen, the
   * sleep report, the family summary and the model data need nothing: they clean the stored rows on every read. The
   * night HRV rows that stay are recomputed by the next sync ([NightHrvSync]).
   */
  private fun repairSleepRules() {
    healthConnect.repairSleepIfDue()
    if (!SleepRulesRepair.nightHrvDue(settings)) return
    scope.launch(Dispatchers.IO) {
      try {
        val removed = SleepRulesRepair.pruneNightHrv(syncStore.db())
        events.log(LogDirection.INFO, null, null, null, "Sleep rules ${SleepCleaning.SLEEP_RULES_VERSION}: $removed stored night HRV rows were not sleep any more and were removed")
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        events.log(LogDirection.ERROR, null, null, null, "Sleep rules: could not repair the night HRV rows: ${e.message ?: e.javaClass.simpleName}")
      }
    }
  }

  fun addListener(listener: WearEvents) {
    listeners.add(listener)
  }

  fun removeListener(listener: WearEvents) {
    listeners.remove(listener)
  }

  /** Seeds the notification's "synced" time from the database before this process has synced. */
  fun loadLastSync() {
    val address = settings.watchAddress ?: return
    scope.launch(Dispatchers.IO) {
      try {
        syncStore.lastSync(address)?.let { last -> status.update { it.copy(lastSyncSec = it.lastSyncSec ?: last) } }
      } catch (e: SQLiteException) {
        events.log(LogDirection.ERROR, null, null, null, "Could not read the last sync time: ${e.message}")
      }
    }
  }

  fun setNote(note: String?) {
    status.update { it.copy(note = note) }
  }

  // Link actions from the app

  /** Watches the user confirmed a first bind for; only [connectFromApp] takes it, never the background reconnect. */
  private val bindConsent = BindConsent()

  /** The next [connectFromApp] to [rawAddress] may start a first bind, which replaces the watch's current phone pairing. */
  fun confirmBind(rawAddress: String) {
    bindConsent.grant(rawAddress)
  }

  /**
   * Watches the person asked to connect (a tap, not the automatic reconnect), agreeing to a Bluetooth pairing if Android needs one: the
   * only connect that may try a Classic link the model table does not list ([TransportChoice.fallback]). Same single-use rules as bind consent.
   */
  private val pairingConsent = BindConsent()

  /** The next [connectFromApp] to [rawAddress] may start an Android pairing when it moves from LE to Classic. Single use. */
  fun confirmPairing(rawAddress: String) {
    pairingConsent.grant(rawAddress)
  }

  /** Single use: the consent ends with this connect, whatever its outcome. */
  suspend fun connectFromApp(address: String): Map<String, Any?> {
    paused = false
    // A background visit to another watch gives the link back to the user.
    controller?.abortVisit()
    return link.connect(address, allowFirstBind = bindConsent.take(address), allowPairing = pairingConsent.take(address))
  }

  fun disconnectFromApp() {
    if (settings.backgroundEnabled) {
      paused = true
      setNote("Disconnected in the app. Connect there to resume.")
    }
    bindConsent.clearAll()
    pairingConsent.clearAll()
    link.disconnect()
  }

  fun forget(rawAddress: String) {
    val address = rawAddress.trim().uppercase(Locale.ROOT)
    bindConsent.clear(address)
    pairingConsent.clear(address)
    settings.switchBackfill.done(address)
    link.forget(address)
    if (settings.watchAddress == address) {
      setBackground(null)
      settings.watchAddress = null
      settings.watchName = null
    }
  }

  /** JS reload with background off: nothing keeps the link, so it is closed as before. */
  fun onModuleDestroyed() {
    liveHeartRate.setActive(false)
    hrv.cancel()
    if (!settings.backgroundEnabled) link.shutdown()
  }

  // Background mode

  fun setBackground(rawAddress: String?) {
    if (rawAddress == null) {
      settings.backgroundEnabled = false
      paused = false
      setNote(null)
      WatchService.stop(appContext)
      return
    }
    val address = rawAddress.trim().uppercase(Locale.ROOT)
    if (!BluetoothAdapter.checkBluetoothAddress(address)) {
      throw WearException(ErrorCodes.INVALID_ADDRESS, "'$rawAddress' is not a Bluetooth address")
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
      appContext.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED
    ) {
      throw WearException(ErrorCodes.BLUETOOTH_PERMISSION, "BLUETOOTH_CONNECT permission is not granted; the background service needs it")
    }
    if (settings.watchAddress != address) settings.watchName = null
    settings.watchAddress = address
    settings.backgroundEnabled = true
    paused = false
    setNote(null)
    WatchService.start(appContext)
    controller?.nudge(true)
  }

  /** Brings the service back if background mode is on but it is not running (process death, update). */
  fun ensureServiceRunning() {
    if (settings.backgroundEnabled && settings.watchAddress != null && !WatchService.isActive) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
        appContext.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED
      ) {
        // Android 14 refuses a connectedDevice service without it; the user has to grant it in the app.
        events.log(LogDirection.ERROR, null, null, null, "Background service not started: BLUETOOTH_CONNECT is not granted")
        return
      }
      try {
        WatchService.start(appContext)
      } catch (e: Exception) {
        events.log(LogDirection.ERROR, null, null, null, "Could not start the background service: ${e.message}")
      }
    }
  }

  fun backgroundStatus(): Map<String, Any?> = mapOf(
    "enabled" to settings.backgroundEnabled,
    "address" to settings.watchAddress,
    "name" to settings.watchName,
    "running" to WatchService.isActive,
    "paused" to paused,
    "syncIntervalMinutes" to settings.syncIntervalMinutes,
  )

  /** Whether Android may stop the background service ([BackgroundRestrictions]); `BackgroundRestrictions` in JS. */
  fun backgroundRestrictions(): Map<String, Any?> = BackgroundRestrictions.read(appContext).toJs()

  /**
   * Opens the screen where the person lets JoyoFit run in the background ([BatteryExemption.plan]): the system's own "allow" dialog in
   * the sideload build, Android's battery optimization list in the Google Play build, the app details when the app is restricted.
   */
  fun openBatteryExemption() {
    val restrictions = BackgroundRestrictions.read(appContext)
    val steps = BatteryExemption.plan(restrictions.canRequestDirectly, restrictions.ignoringBatteryOptimizations, restrictions.backgroundRestricted)
    val opened = BatteryExemption.launch(appContext, steps.map { BatteryExemption.intent(it, appContext.packageName) })
    if (!opened) throw WearException(ErrorCodes.UNSUPPORTED, "No battery settings screen opened on this phone")
  }

  /** Opens the maker's auto-start list when this phone's maker is known and the screen opens, else JoyoFit's own settings screen. */
  fun openAutoStartSettings() {
    val vendor = BackgroundRestrictions.read(appContext).vendor
    if (!BatteryExemption.launch(appContext, BatteryExemption.autoStartIntents(vendor, appContext.packageName))) {
      throw WearException(ErrorCodes.UNSUPPORTED, "No settings screen opened on this phone")
    }
  }

  fun setSyncInterval(minutes: Int) {
    if (minutes < WearSettings.MIN_SYNC_INTERVAL_MIN || minutes > WearSettings.MAX_SYNC_INTERVAL_MIN) {
      throw WearException(
        ErrorCodes.INVALID_ARGUMENT,
        "Sync interval must be ${WearSettings.MIN_SYNC_INTERVAL_MIN} to ${WearSettings.MAX_SYNC_INTERVAL_MIN} minutes, got $minutes",
      )
    }
    settings.syncIntervalMinutes = minutes
    controller?.reschedule()
  }

  // Notifications

  fun notificationAccessGranted(): Boolean {
    val manager = appContext.getSystemService(android.app.NotificationManager::class.java)
    return manager.isNotificationListenerAccessGranted(ComponentName(appContext, WatchNotificationListener::class.java))
  }

  fun notificationAccessStatus(): Map<String, Any?> = mapOf(
    "granted" to notificationAccessGranted(),
    "enabled" to settings.notificationsEnabled,
  )

  fun openNotificationAccess() {
    val list = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
      appContext.startActivity(list)
      return
    }
    // Android 11+ can open this app's own entry; fall back to the list if that screen is missing.
    val component = ComponentName(appContext, WatchNotificationListener::class.java)
    val detail = Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
      .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, component.flattenToString())
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      appContext.startActivity(detail)
    } catch (e: android.content.ActivityNotFoundException) {
      appContext.startActivity(list)
    }
  }

  fun forceBle(): Boolean = settings.forceBle

  /** Takes effect on the next connect; a live link keeps the transport it was opened with. */
  fun setForceBle(enabled: Boolean) {
    settings.forceBle = enabled
  }

  fun morningSummaryEnabled(): Boolean = settings.morningSummaryEnabled

  /** Turning it on lets the next sync post today's summary if it has not been posted yet. */
  fun setMorningSummaryEnabled(enabled: Boolean) {
    settings.morningSummaryEnabled = enabled
  }

  /** Stores the switch and, when the watch is connected, mirrors it to the watch (GB SetNotificationRequest). */
  suspend fun setNotificationsEnabled(enabled: Boolean) {
    settings.notificationsEnabled = enabled
    val handle = link.handle() ?: return
    try {
      ProfileSender.sendNotificationSwitch(handle.session, events, enabled)
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      events.log(LogDirection.ERROR, null, null, null, "NotificationState not sent: ${e.message}")
    }
  }

  suspend fun notificationApps(): List<Map<String, Any?>> =
    withContext(Dispatchers.IO) { NotificationApps.list(appContext, settings) }

  // Health sensors (continuous heart rate, SpO2, TruSleep, alerts) and live heart rate

  /** The stored switches and, while connected, which of them the watch supports (null when not connected). */
  fun healthSensorsStatus(): Map<String, Any?> {
    val config = settings.healthSensors
    return mapOf(
      "automaticHeartRate" to config.automaticHeartRate,
      "automaticSpo2" to config.automaticSpo2,
      "truSleep" to config.truSleep,
      "highHeartRateAlert" to config.highHeartRateAlert,
      "lowHeartRateAlert" to config.lowHeartRateAlert,
      "supported" to if (link.handle() != null) HealthSensorSupport.of(DeviceCaps::supports).toJs() else null,
    )
  }

  fun validate(config: HealthSensorConfig) {
    fun bad(what: String): Nothing = throw WearException(ErrorCodes.INVALID_ARGUMENT, what)
    if (config.highHeartRateAlert != 0 && config.highHeartRateAlert !in HIGH_ALERT_RANGE) {
      bad("High heart-rate alert must be 0 (off) or ${HIGH_ALERT_RANGE.first} to ${HIGH_ALERT_RANGE.last} bpm")
    }
    if (config.lowHeartRateAlert != 0 && config.lowHeartRateAlert !in LOW_ALERT_RANGE) {
      bad("Low heart-rate alert must be 0 (off) or ${LOW_ALERT_RANGE.first} to ${LOW_ALERT_RANGE.last} bpm")
    }
  }

  /** Stores the switches and, when the watch is connected, sends what changed; true when it was all acknowledged. */
  suspend fun setHealthSensors(config: HealthSensorConfig): Boolean {
    validate(config)
    val previous = settings.healthSensors
    settings.healthSensors = config
    val handle = link.handle() ?: return false
    val plan = HealthSensors.plan(DeviceCaps::supports, config, previous)
    if (plan.isEmpty()) return true
    return handle.operationLock.withLock { HealthSensors.send(handle.session, events, plan) } == plan.size
  }

  // Profile

  fun validate(profile: UserProfileData) {
    fun bad(what: String): Nothing = throw WearException(ErrorCodes.INVALID_ARGUMENT, what)
    if (profile.heightCm !in 100..250) bad("Height must be 100 to 250 cm")
    if (!(profile.weightKg in 20.0..300.0)) bad("Weight must be 20 to 300 kg")
    if (profile.birthYear !in 1900..Year.now().value) bad("Birth year must be 1900 to ${Year.now().value}")
    if (profile.sex != "male" && profile.sex != "female" && profile.sex != "unknown") bad("Sex must be male, female or unknown")
    if (profile.dailyStepGoal !in 1000..100_000) bad("Step goal must be 1000 to 100000")
  }

  /** Stores the profile; true when it also reached the connected watch. */
  suspend fun setUserProfile(profile: UserProfileData): Boolean {
    validate(profile)
    settings.profile = profile
    val handle = link.handle() ?: return false
    return try {
      val sent = ProfileSender.sendProfile(handle.session, events, profile) > 0
      // The zones depend on the age; Track watches get them again over P2P.
      if (p2p.stack()?.resendHeartRateZones() != true) {
        HeartRateZonesSync.sendFitnessData(handle.session, events, HeartRateZonesSync.age(profile), settings.heartRateZones)
      }
      sent
    } catch (e: CancellationException) {
      throw e
    } catch (e: WearException) {
      events.log(LogDirection.ERROR, null, null, null, "Profile not sent: ${e.message}")
      false
    }
  }

  // Heart-rate zones

  /** `configured`: zones stored; `via`: how this watch takes them (null when no watch is connected). */
  fun heartRateZonesStatus(): Map<String, Any?> = mapOf(
    "configured" to (settings.heartRateZones != null),
    "via" to if (link.handle() != null) HeartRateZonesSync.route() else null,
  )

  fun validate(zones: HeartRateZonesCalc.UserZones) {
    zones.problem()?.let { throw WearException(ErrorCodes.INVALID_ARGUMENT, it) }
  }

  /** Stores the zones (null = back to the defaults) and sends them to the connected watch; true when something was sent. */
  suspend fun setHeartRateZones(zones: HeartRateZonesCalc.UserZones?): Boolean {
    if (zones != null) validate(zones)
    settings.heartRateZones = zones
    val handle = link.handle() ?: return false
    return try {
      val sent = p2p.stack()?.resendHeartRateZones() == true ||
        HeartRateZonesSync.sendFitnessData(handle.session, events, HeartRateZonesSync.age(settings.profile), zones)
      if (!sent) events.log(LogDirection.INFO, null, null, null, "HR zones: stored, but this watch takes zones neither over P2P Track nor FitnessData 07/13|21 (${HeartRateZonesSync.capsLine()})")
      sent
    } catch (e: CancellationException) {
      throw e
    } catch (e: WearException) {
      events.log(LogDirection.ERROR, null, null, null, "HR zones not sent: ${e.message}")
      false
    }
  }

  companion object {
    /** The thresholds GB offers for the watch's heart-rate alerts (arrays prefs_huawei_heart_rate_{high,low}_alert_values). */
    val HIGH_ALERT_RANGE = 100..150
    val LOW_ALERT_RANGE = 40..50

    /** How many of the latest disconnects the report's summary lists (the whole kept list goes in the log part). */
    const val RECENT_DISCONNECTS = 5

    @Volatile
    private var instance: WearRuntime? = null

    fun get(context: Context): WearRuntime =
      instance ?: synchronized(this) {
        instance ?: WearRuntime(context).also { instance = it }
      }
  }
}
