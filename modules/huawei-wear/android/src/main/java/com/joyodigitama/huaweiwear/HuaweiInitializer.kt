// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): HuaweiSupportProvider.initializeDeviceConfigure and
// service/devices/huawei/requests/{GetProductInformation,SetTime,GetBatteryLevel,GetSupportedServices,GetSupportedCommands,
// SendFitnessUserInfo,SendFitnessGoal,GetNotificationCapabilities,GetNotificationConstraints,SetNotification}Request.
package com.joyodigitama.huaweiwear

import java.util.Locale
import kotlin.math.abs
import kotlinx.coroutines.CancellationException
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiCoordinator.HuaweiDeviceType
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.AccountRelated
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.DeviceConfig
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Notifications

internal class InitResult(
  val productModel: String?,
  val softwareVersion: String?,
  val hardwareVersion: String?,
  val serialNumber: String?,
  val deviceName: String?,
  val batteryLevel: Int?,
  val notificationState: HuaweiNotificationState,
)

/**
 * Port of HuaweiSupportProvider.initializeDeviceConfigure (the same on every transport; [deviceType] only picks the
 * ProductInfo tag set, as GB does for HuaweiDeviceType.AW):
 * ProductInfo -> SetTime (get, set again if drifted) -> BatteryLevel -> SupportedServices ->
 * SupportedCommands, the profile, sensors and notification setup, and last the phone's language (SetLanguageSetting).
 * Each request has GB's 2 s `initTimeout`; like GB, a missing reply only skips to the next request.
 */
internal class HuaweiInitializer(
  private val session: HuaweiSession,
  private val events: WearEvents,
  /** Android Bluetooth name of the watch; GB sends gbDevice.getName() in SetUpDeviceStatus. */
  private val bondedName: String?,
  /** LinkParams protocolVersion (GB `getProtocolVersion()`). */
  private val protocolVersion: Int,
  /** Profile and goal the user saved; sent when present. */
  private val profile: UserProfileData?,
  /** The notification switch GB sends from `PREF_NOTIFICATION_ENABLE`. */
  private val notificationsEnabled: Boolean,
  /** The sensor switches the user saved (continuous heart rate, SpO2, TruSleep, alerts). */
  private val healthSensors: HealthSensorConfig,
  /** GB HuaweiDeviceType of the link; AW asks ProductInfo for a shorter tag set. */
  private val deviceType: HuaweiDeviceType = HuaweiDeviceType.BR,
  /** The language JoyoFit's Settings pinned (`id`, `en`), or null to follow [phoneLocale]; sent as the watch's language. */
  private val pinnedLanguage: String? = null,
  /** The phone's first language. */
  private val phoneLocale: Locale = Locale.getDefault(),
  /** The heart-rate zones the user set in the app; null = GB's defaults for the profile age. */
  private val heartRateZones: HeartRateZonesCalc.UserZones? = null,
  /**
   * The user's Huawei account id, sent in 1A/05 so a watch set up under that account is not asked to factory-reset; null or blank =
   * GB's empty default (the behaviour before this setting). Only an account id, no signature.
   */
  private val huaweiAccount: String? = null,
) {
  private val params get() = session.params

  suspend fun run(): InitResult {
    DeviceCaps.reset()
    var productModel: String? = null
    var softwareVersion: String? = null
    var hardwareVersion: String? = null
    var serialNumber: String? = null
    var deviceName: String? = null
    var battery: Int? = null

    // GetProductInformationRequest
    soft("ProductInfo") {
      val response = session
        .request(DeviceConfig.ProductInfo.Request(params, deviceType), Timeouts.INIT_MS, "ProductInfo")
        .expect<DeviceConfig.ProductInfo.Response>("ProductInfo")
      softwareVersion = response.softwareVersion
      hardwareVersion = response.hardwareVersion
      productModel = response.productModel
      serialNumber = response.serialNumber
      deviceName = response.deviceName
      events.log(
        LogDirection.INFO,
        null,
        null,
        null,
        "ProductInfo: model=$productModel software=$softwareVersion hardware=$hardwareVersion " +
          "serial=$serialNumber name=$deviceName package=${response.packageName} region=${response.regionCode}",
      )
    }

    // SetTimeRequest(syncTime = true): read the watch clock, send the time again if it differs.
    soft("SetTime") {
      val response = session
        .request(DeviceConfig.TimeRequest(params), Timeouts.INIT_MS, "SetTime")
        .expect<DeviceConfig.TimeRequest.Response>("SetTime")
      val deviceTime = response.deviceTime
      val systemTime = (System.currentTimeMillis() / 1000).toInt()
      val diff = abs(systemTime - deviceTime)
      events.log(LogDirection.INFO, null, null, null, "SetTime: systemTime=$systemTime deviceTime=$deviceTime diff=$diff")
      if (diff > 0) {
        session
          .request(DeviceConfig.TimeRequest(params), Timeouts.INIT_MS, "SetTime (apply)")
          .expect<DeviceConfig.TimeRequest.Response>("SetTime (apply)")
      }
    }

    // GetBatteryLevelRequest
    soft("BatteryLevel") {
      battery = session.queryBattery(Timeouts.INIT_MS)
      events.log(LogDirection.INFO, null, null, null, "BatteryLevel: $battery%")
    }

    // GetSupportedServicesRequest, then GetSupportedCommandsRequest for what it activates.
    soft("SupportedServices") {
      val known = DeviceConfig.SupportedServices.knownSupportedServices
      val response = session
        .request(DeviceConfig.SupportedServices.Request(params, known), Timeouts.INIT_MS, "SupportedServices")
        .expect<DeviceConfig.SupportedServices.Response>("SupportedServices")
      val supported: ByteArray = response.supportedServices

      val activated = ArrayList<Byte>()
      activated.add(0x01.toByte()) // device always supports service 1
      for (i in 0 until minOf(supported.size, known.size)) {
        if (supported[i].toInt() == 1) activated.add(known[i])
      }
      events.log(
        LogDirection.INFO,
        null,
        null,
        null,
        "SupportedServices: " + activated.joinToString(" ") { it.hex2() },
      )
      supportedCommands(activated)
    }

    // GetSupportedCommandsRequest -> GetExpandCapabilityRequest, then the order of GB
    // initializeDynamicServices up to ConnectStatus (account requests are not ported).
    if (supports(0x01, DeviceConfig.ExpandCapability.id)) {
      soft("ExpandCapability") {
        expandCapabilities = session
          .request(DeviceConfig.ExpandCapability.Request(params), Timeouts.INIT_MS, "ExpandCapability")
          .expect<DeviceConfig.ExpandCapability.Response>("ExpandCapability")
          .expandCapabilities
        events.log(LogDirection.INFO, null, null, null, "ExpandCapability: ${expandCapabilities?.size ?: 0} bytes")
      }
    }
    DeviceCaps.supportedCommands = supportedCommands
    DeviceCaps.expandCapabilities = expandCapabilities
    // What the support report needs to answer "can this watch take a language / music?": GB supportsLanguageSetting is 0C/01, music upload
    // is 25/04, music control 25/02, "more music" ExpandCapability 122 (docs/watch-music.md).
    fun listed(service: Int) = supportedCommands[service]?.joinToString(" ") { it.hex2() } ?: "not listed"
    events.log(
      LogDirection.INFO,
      null,
      null,
      null,
      "Language and music: 0C=[${listed(0x0C)}] 25=[${listed(0x25)}] moreMusic(ExpandCapability 122)=${expandCapability(122)}",
    )
    // SendExtendedAccountRequest (first in GB initializeDynamicServices): the user's Huawei account id if they set one on the
    // watch-face screen, else GB's default empty account (the behaviour before the setting). Watches that judge accounts wait for
    // this after a bind; sending the account the watch was set up under keeps it from asking for a factory reset.
    if (supports(AccountRelated.id.toInt(), 0x05) && supports(AccountRelated.id.toInt(), 0x06)) {
      soft("ExtendedAccount") {
        session.request(
          AccountRelated.SendExtendedAccountToDevice.Request(params, expandCapability(0xac), huaweiAccount ?: ""),
          Timeouts.INIT_MS,
          "ExtendedAccount",
        )
        events.log(LogDirection.INFO, null, null, null, "ExtendedAccount: acknowledged (account ${if (huaweiAccount != null) "set" else "empty"})")
      }
    }
    if (supports(0x01, DeviceConfig.SettingRelated.id)) {
      soft("SettingRelated") {
        // GetSettingRelatedRequest.processResponse: the file-sync flags of tag 0x02.
        val response = session
          .request(DeviceConfig.SettingRelated.Request(params), Timeouts.INIT_MS, "SettingRelated")
          .expect<DeviceConfig.SettingRelated.Response>("SettingRelated")
        DeviceCaps.truSleepNewSync = response.truSleepNewSync
        DeviceCaps.rriNewSync = response.rriNewSync
        DeviceCaps.gpsNewSync = response.gpsNewSync
        events.log(
          LogDirection.INFO,
          null,
          null,
          null,
          "SettingRelated: truSleepNewSync=${response.truSleepNewSync} rriNewSync=${response.rriNewSync} gpsNewSync=${response.gpsNewSync}",
        )
      }
    }
    if (supports(0x01, DeviceConfig.AcceptAgreement.id)) {
      soft("AcceptAgreement") {
        session.request(DeviceConfig.AcceptAgreement.Request(params), Timeouts.INIT_MS, "AcceptAgreement")
        events.log(LogDirection.INFO, null, null, null, "AcceptAgreement: acknowledged")
      }
    }
    if (expandCapability(182)) {
      soft("ReverseCapabilities") {
        session.request(DeviceConfig.ReverseCapabilities.Request(params), Timeouts.INIT_MS, "ReverseCapabilities")
      }
    }
    if (expandCapability(109)) {
      // SendSetUpDeviceStatusRequest: relationship 1 = main device. GB: "The watch never answers
      // to this command" (50 ms timeout), so a timeout here is the expected outcome.
      val name = bondedName ?: deviceName ?: ""
      try {
        session.request(DeviceConfig.SetUpDeviceStatusRequest(params, 1, name), SETUP_STATUS_MS, "SetUpDeviceStatus")
      } catch (e: WearException) {
        if (e.errorCode != ErrorCodes.TIMEOUT) throw e
      }
      events.log(LogDirection.INFO, null, null, null, "SetUpDeviceStatus: sent as main device \"$name\"")
      soft("WearStatus") {
        session.request(DeviceConfig.WearStatus.Request(params), Timeouts.INIT_MS, "WearStatus")
      }
    }
    if (supports(0x01, 0x35)) {
      soft("ConnectStatus") {
        session.request(DeviceConfig.ConnectStatusRequest(params), Timeouts.INIT_MS, "ConnectStatus")
      }
    }

    // SendFitnessUserInfoRequest + SendFitnessGoalRequest, once the user has saved a profile.
    profile?.let { saved ->
      soft("FitnessProfile") { ProfileSender.sendProfile(session, events, saved) }
    }

    // SendHeartRateZonesConfig: the zones the workout screen shows; Track watches get them over P2P once it registers.
    events.log(LogDirection.INFO, null, null, null, HeartRateZonesSync.capsLine())
    soft("HeartRateZones") { HeartRateZonesSync.sendFitnessData(session, events, HeartRateZonesSync.age(profile), heartRateZones) }

    // The heart-rate capability notifications and the sensor switches. GB sends none of these at init
    // (only when a setting changes, all off by default), so a wiped watch never records heart rate.
    soft("HealthSensors") {
      val gates = HealthSensorSupport.of(DeviceCaps::supports)
      events.log(
        LogDirection.INFO,
        null,
        null,
        null,
        "HealthSensors gates: heartRate(07/17)=${gates.heartRate} realtime(07/1c)=${gates.realtimeHeartRate} " +
          "spo2(07/24)=${gates.spo2} truSleep(07/16)=${gates.truSleep} highAlert(07/1d)=${gates.highHeartRateAlert} " +
          "lowAlert(07/22)=${gates.lowHeartRateAlert} restHeartRateNotify(07/23)=${supports(0x07, 0x23)} " +
          "workoutHeartRateNotify(17/17)=${supports(0x17, 0x17)} zones(07/13)=${supports(0x07, 0x13)} " +
          "zonesExtended(07/21)=${supports(0x07, 0x21)} lowSpo2Alert(07/25)=${supports(0x07, 0x25)}",
      )
      val plan = HealthSensors.plan(DeviceCaps::supports, healthSensors, null)
      val acknowledged = HealthSensors.send(session, events, plan)
      events.log(LogDirection.INFO, null, null, null, "HealthSensors: $acknowledged of ${plan.size} requests acknowledged")
    }

    // GetNotificationCapabilitiesRequest, GetNotificationConstraintsRequest, SetNotificationRequest.
    val notificationState = HuaweiNotificationState(protocolVersion)
    if (notificationState.shouldAskCapabilities) {
      soft("NotificationCapabilities") {
        notificationState.capabilities = session
          .request(Notifications.NotificationCapabilities.Request(params), Timeouts.INIT_MS, "NotificationCapabilities")
          .expect<Notifications.NotificationCapabilities.Response>("NotificationCapabilities")
          .capabilities
      }
    }
    if (notificationState.shouldAskConstraints) {
      soft("NotificationConstraints") {
        notificationState.constraints = session
          .request(Notifications.NotificationConstraints.Request(params), Timeouts.INIT_MS, "NotificationConstraints")
          .expect<Notifications.NotificationConstraints.Response>("NotificationConstraints")
          .constraints
        events.log(
          LogDirection.INFO,
          null,
          null,
          null,
          "NotificationConstraints: contentFormat=${notificationState.contentFormat} contentLength=${notificationState.contentLength}",
        )
      }
    }
    soft("NotificationState") { ProfileSender.sendNotificationSwitch(session, events, notificationsEnabled) }
    // SetLanguageSettingRequest (GB init queue; Huawei Health sends it on every connect), see [LanguageSender].
    soft("LanguageSetting") { LanguageSender.send(session, events, pinnedLanguage, phoneLocale) }

    return InitResult(productModel, softwareVersion, hardwareVersion, serialNumber, deviceName, battery, notificationState)
  }

  /** GetSupportedCommandsRequest: as many services per request as fit, repeated until none are left. */
  private suspend fun supportedCommands(activated: MutableList<Byte>) {
    val commandsPerService = DeviceConfig.SupportedCommands.commandsPerService
    // GB would NPE on a service without a known command table; those are skipped.
    activated.removeAll { service ->
      val unknown = commandsPerService[service.toInt()] == null
      if (unknown) {
        events.log(LogDirection.INFO, null, null, null, "SupportedCommands: no command table for service ${service.hex2()}, skipped")
      }
      unknown
    }
    var requestNumber = 0
    var serviceCount = 0
    while (activated.isNotEmpty()) {
      val request = DeviceConfig.SupportedCommands.Request(params)
      var nextService = activated.removeAt(0)
      var fits = request.addCommandsForService(nextService, commandsPerService.getValue(nextService.toInt()))
      if (!fits) {
        // Not even one service fits an empty request; GB would resend the same empty request forever.
        events.log(LogDirection.ERROR, null, null, null, "SupportedCommands: service ${nextService.hex2()} does not fit a request, skipped")
        continue
      }
      while (fits && activated.isNotEmpty()) {
        nextService = activated.removeAt(0)
        fits = request.addCommandsForService(nextService, commandsPerService.getValue(nextService.toInt()))
      }
      if (!fits) activated.add(0, nextService) // put the extra back

      requestNumber++
      val response = session
        .request(request, Timeouts.QUERY_MS, "SupportedCommands #$requestNumber")
        .expect<DeviceConfig.SupportedCommands.Response>("SupportedCommands #$requestNumber")
      serviceCount += response.commandsLists.size
      for (list in response.commandsLists) supportedCommands[list.service] = list.commands
    }
    events.log(LogDirection.INFO, null, null, null, "SupportedCommands: $serviceCount services in $requestNumber request(s)")
  }

  /** Commands per service from SupportedCommands (GB HuaweiState.commandsPerService). */
  private val supportedCommands = HashMap<Int, ByteArray>()

  /** GB HuaweiState.supportsCommandForService. */
  private fun supports(service: Int, command: Int): Boolean =
    supportedCommands[service]?.any { it == command.toByte() } == true

  /** ExpandCapability bitmap (GB HuaweiState.expandCapabilities). */
  private var expandCapabilities: ByteArray? = null

  /** GB HuaweiState.supportsExpandCapability(int): bit `which % 8` of byte `which / 8`. */
  private fun expandCapability(which: Int): Boolean {
    val caps = expandCapabilities ?: return false
    if (which >= caps.size * 8) return false
    val bit = 1 shl (which % 8)
    return (caps[which / 8].toInt() and bit) == bit
  }

  private suspend fun soft(label: String, block: suspend () -> Unit) {
    try {
      block()
    } catch (e: CancellationException) {
      throw e
    } catch (e: WearException) {
      if (e.errorCode == ErrorCodes.DISCONNECTED) throw e
      events.log(LogDirection.ERROR, null, null, null, "$label skipped: ${e.message}")
    } catch (e: Exception) {
      events.log(LogDirection.ERROR, null, null, null, "$label skipped: ${e.message ?: e.javaClass.simpleName}")
    }
  }
}

private const val SETUP_STATUS_MS = 300L

/** GetBatteryLevelRequest: the first battery level (watches report a single one). */
internal suspend fun HuaweiSession.queryBattery(timeoutMs: Long): Int {
  val response = request(DeviceConfig.BatteryLevel.Request(params), timeoutMs, "BatteryLevel")
    .expect<DeviceConfig.BatteryLevel.Response>("BatteryLevel")
  val multi: ByteArray? = response.multi_level
  return if (multi == null || multi.isEmpty()) {
    response.level.toInt() and 0xFF
  } else {
    multi[0].toInt() and 0xFF
  }
}
