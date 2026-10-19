package com.joyodigitama.huaweiwear

import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** `UserProfile` in `HuaweiWear.types.ts`. */
class UserProfileRecord : Record {
  @Field var heightCm: Int = 0
  @Field var weightKg: Double = 0.0
  @Field var birthYear: Int = 0
  @Field var sex: String = "unknown"
  @Field var dailyStepGoal: Int = 0
}

/** `HealthSensorsUpdate` in `HuaweiWear.types.ts`. */
class HealthSensorsRecord : Record {
  @Field var automaticHeartRate: Boolean = true
  @Field var automaticSpo2: Boolean = true
  @Field var truSleep: Boolean = true
  @Field var highHeartRateAlert: Int = 0
  @Field var lowHeartRateAlert: Int = 0

  internal fun toConfig() = HealthSensorConfig(automaticHeartRate, automaticSpo2, truSleep, highHeartRateAlert, lowHeartRateAlert)
}

/**
 * Expo module implementing `HuaweiWearModule.ts`. All protocol work lives in [WearLink], reached
 * through the process-wide [WearRuntime] that the background service shares; this class wires the
 * TS contract to it and forwards runtime events (`onStateChange` / `onBattery` / `onLog` /
 * `onSyncComplete`) to JS while the module is alive.
 */
class HuaweiWearModule : Module() {
  // After OnDestroy the module may no longer emit; a JS reload starts from a fresh module.
  @Volatile
  private var destroyed = false

  private val listener = object : WearEvents {
    override fun state(state: LinkState, error: String?) {
      emit("onStateChange", mapOf("state" to state.wire, "error" to error))
    }

    override fun battery(level: Int) {
      emit("onBattery", mapOf("level" to level))
    }

    override fun syncComplete(summary: SyncSummary) {
      emit("onSyncComplete", summary.toJs())
    }

    override fun log(direction: LogDirection, serviceId: Int?, commandId: Int?, hex: String?, message: String) {
      emit(
        "onLog",
        mapOf(
          "ts" to System.currentTimeMillis(),
          "direction" to direction.wire,
          "serviceId" to serviceId,
          "commandId" to commandId,
          "hex" to hex,
          "message" to message,
        ),
      )
    }

    override fun uploadProgress(bytes: Int, total: Int) {
      emit("onUploadProgress", mapOf("bytes" to bytes, "total" to total))
    }

    override fun uploadResult(ok: Boolean, fileName: String, code: Int?, message: String) {
      emit("onUploadResult", mapOf("ok" to ok, "fileName" to fileName, "code" to code, "message" to message))
    }

    override fun heartRate(bpm: Int, tsMs: Long) {
      emit("onHeartRate", mapOf("bpm" to bpm, "ts" to tsMs))
    }

    override fun watchMealLogged(payload: Map<String, Any?>) {
      emit("onWatchMealLogged", payload)
    }

    override fun faceCustomization(payload: Map<String, Any?>) {
      emit("onFaceCustomization", payload)
    }

    override fun liveWorkout(payload: Map<String, Any?>) {
      emit("onLiveWorkout", payload)
    }

    override fun hrvProgress(secondsLeft: Int, beats: Int) {
      emit("onHrvProgress", mapOf("secondsLeft" to secondsLeft, "beats" to beats))
    }

    override fun deviceDiscovered(device: DiscoveredDevice) {
      emit("onDeviceDiscovered", device.toJs())
    }

    override fun scanState(scanning: Boolean, error: String?) {
      emit("onScanStateChange", mapOf("scanning" to scanning, "error" to error))
    }

    fun emit(name: String, payload: Map<String, Any?>) {
      if (destroyed) return
      try {
        sendEvent(name, payload)
      } catch (e: Exception) {
        // The JS runtime may be gone (reload); losing an event must never break the link.
        android.util.Log.w(TAG, "Dropped $name event: ${e.message}")
      }
    }
  }

  // Kept so OnDestroy can still reach the runtime after the React context is gone.
  @Volatile
  private var runtimeRef: WearRuntime? = null

  private fun runtime(): WearRuntime =
    runtimeRef ?: WearRuntime.get(appContext.reactContext ?: throw Exceptions.ReactContextLost()).also { runtimeRef = it }

  private fun profileOf(record: UserProfileRecord) = UserProfileData(
    heightCm = record.heightCm,
    weightKg = record.weightKg,
    birthYear = record.birthYear,
    sex = record.sex,
    dailyStepGoal = record.dailyStepGoal,
  )

  override fun definition() = ModuleDefinition {
    Name("HuaweiWear")

    // "play" for the Google Play build, "sideload" otherwise (see Distribution.kt).
    Constant("distribution") { Distribution.name }

    Events("onStateChange", "onBattery", "onLog", "onSyncComplete", "onUploadProgress", "onUploadResult", "onHeartRate", "onWatchMealLogged", "onFaceCustomization", "onLiveWorkout", "onHrvProgress", "onHuaweiImportProgress", "onDeviceDiscovered", "onScanStateChange")

    OnCreate {
      val runtime = runtime()
      runtime.addListener(listener)
      runtime.ensureServiceRunning()
    }

    // A workout started on the watch, followed live (LiveWorkout.kt).
    Function("getLiveWorkout") {
      runtime().liveWorkout.snapshot()
    }

    Function("dismissLiveWorkout") {
      runtime().liveWorkout.dismiss()
    }

    // A phone-side live session on the watch's realtime heart rate, for workouts the watch does not announce (indoor).
    Function("startLiveWorkout") {
      runtime().liveWorkout.startManual()
    }

    Function("finishLiveWorkout") {
      runtime().liveWorkout.finish()
    }

    AsyncFunction("getBondedDevices") {
      runtime().link.bondedDevices()
    }

    // Same list: Android reads the system's bonded devices without a scan.
    AsyncFunction("refreshBondedDevices") {
      runtime().link.bondedDevices()
    }

    // Lets the next connect(address) start a first bind, which replaces the watch's current phone pairing. Single use.
    Function("confirmBind") { address: String ->
      runtime().confirmBind(address)
    }

    AsyncFunction("startScan") {
      runtime().link.startScan()
    }

    AsyncFunction("stopScan") {
      runtime().link.stopScan()
    }

    Function("getDiscoveredDevices") {
      runtime().link.getDiscoveredDevices()
    }

    AsyncFunction("connect") Coroutine { address: String ->
      runtime().connectFromApp(address)
    }

    AsyncFunction("disconnect") {
      runtime().disconnectFromApp()
    }

    // The link outlives JS reloads when the background service owns it.
    Function("getState") {
      runtime().link.currentState()
    }

    Function("getDevice") {
      val runtime = runtime()
      runtime.link.deviceInfo()?.let { info ->
        runtime.status.value.battery?.let { info + ("batteryLevel" to it) } ?: info
      }
    }

    AsyncFunction("getSupportReport") {
      runtime().supportReport()
    }

    AsyncFunction("refreshBattery") Coroutine { ->
      runtime().link.refreshBattery()
    }

    AsyncFunction("syncActivity") Coroutine { ->
      runtime().link.syncActivity().toJs()
    }

    AsyncFunction("syncFullHistory") Coroutine { ->
      runtime().link.syncActivity(fullHistory = true).toJs()
    }

    AsyncFunction("forgetDevice") { address: String ->
      runtime().forget(address)
    }

    AsyncFunction("setBackgroundEnabled") { address: String? ->
      runtime().setBackground(address)
    }

    // The repair of a damaged joyofit.db (src/db/recovery) replaces the file: the native connection must not be open meanwhile.
    AsyncFunction("releaseDatabase") {
      runtime().syncStore.release()
    }

    AsyncFunction("resumeDatabase") {
      runtime().syncStore.resume()
    }

    Function("getBackgroundStatus") {
      runtime().backgroundStatus()
    }

    AsyncFunction("setSyncIntervalMinutes") { minutes: Int ->
      runtime().setSyncInterval(minutes)
    }

    AsyncFunction("openNotificationAccess") {
      runtime().openNotificationAccess()
    }

    Function("getNotificationAccess") {
      runtime().notificationAccessStatus()
    }

    AsyncFunction("setNotificationsEnabled") Coroutine { enabled: Boolean ->
      runtime().setNotificationsEnabled(enabled)
    }

    // Developer switch: connect over Bluetooth LE GATT (BleTransport) whatever the model's own link is.
    Function("getForceBle") {
      runtime().forceBle()
    }

    AsyncFunction("setForceBle") { enabled: Boolean ->
      runtime().setForceBle(enabled)
    }

    Function("getMorningSummaryEnabled") {
      runtime().morningSummaryEnabled()
    }

    AsyncFunction("setMorningSummaryEnabled") { enabled: Boolean ->
      runtime().setMorningSummaryEnabled(enabled)
    }

    AsyncFunction("getNotificationApps") Coroutine { ->
      runtime().notificationApps()
    }

    AsyncFunction("setNotificationAppEnabled") { packageName: String, enabled: Boolean ->
      runtime().settings.setAppChoice(packageName, enabled)
    }

    Function("getUserProfile") {
      runtime().settings.profile?.toJs()
    }

    AsyncFunction("setUserProfile") Coroutine { profile: UserProfileRecord ->
      runtime().setUserProfile(profileOf(profile))
    }

    // The watch's own heart rate, SpO2 and sleep sensors, and the live heart rate on Today (HealthSensors.kt, LiveHeartRate.kt).
    Function("getHealthSensors") {
      runtime().healthSensorsStatus()
    }

    AsyncFunction("setHealthSensors") Coroutine { sensors: HealthSensorsRecord ->
      runtime().setHealthSensors(sensors.toConfig())
    }

    AsyncFunction("setLiveHeartRate") { active: Boolean ->
      runtime().liveHeartRate.setActive(active)
    }

    // Realtime heart rate drains the watch: it never outlives the app being on screen.
    OnActivityEntersBackground {
      runtimeRef?.liveHeartRate?.setActive(false)
    }

    // 1-minute HRV measurement and the watch's automatic stress switch (HrvModuleApi.kt, HrvSpot.kt, StressSwitch.kt).
    hrvApi { runtime() }

    // Find my watch / find my phone, calls and alarms (PhoneFeaturesModuleApi.kt).
    phoneFeaturesApi { runtime() }

    // Calorie intake, body metrics and activity-ring goals over DataSync (DietModuleApi.kt).
    dietApi { runtime() }

    // Health Connect export: status, permission request, enable + backfill (HealthConnectModuleApi.kt).
    healthConnectApi { runtime() }

    // One-time import of the Huawei Privacy Centre health export (HuaweiImportModuleApi.kt).
    huaweiImportApi({ runtime() }) { name, payload -> listener.emit(name, payload) }

    // Weather: settings, status, refresh (WeatherModuleApi.kt).
    weatherApi { runtime() }

    // Watch faces: list, install a .hwt, set active, delete (WatchfaceModuleApi.kt).
    watchfaceApi { runtime() }

    // Editable watch faces: read and apply a face's style, background, colour, widgets (FaceCustomModuleApi.kt).
    faceCustomApi { runtime() }

    // The photo face: list, add and delete photos, make it active (PhotoFaceModuleApi.kt).
    photoFaceApi { runtime() }

    // Fall detection, SOS SMS relay, morning sleep report and the cycle calendar (WatchExtrasModuleApi.kt).
    watchExtrasApi { runtime() }

    // P2P (service 0x34): Healthy Living replies and the experimental running courses (P2pModuleApi.kt).
    p2pApi { runtime() }

    // Family monitoring, monitored side: config, upload now, last result (FamilyModuleApi.kt, FamilyUploader.kt).
    familyApi { runtime() }

    // Satellite data (A-GPS): status, update now, cancel, the watch maker's servers switch (AgpsModuleApi.kt, Ephemeris.kt).
    agpsApi { runtime() }

    OnDestroy {
      destroyed = true
      runtimeRef?.let {
        it.removeListener(listener)
        it.onModuleDestroyed()
      }
    }
  }

  private companion object {
    const val TAG = "HuaweiWear"
  }
}
