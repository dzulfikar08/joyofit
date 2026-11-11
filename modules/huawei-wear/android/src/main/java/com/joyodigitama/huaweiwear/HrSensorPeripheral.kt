package com.joyodigitama.huaweiwear

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.BatteryManager
import android.os.Build
import android.os.ParcelUuid
import android.os.SystemClock
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * The phone as a standard Bluetooth LE heart-rate sensor, for a bike computer (iGPSPORT, Magene, XOSS, Garmin over BLE) that pairs
 * "sensor Bluetooth". It relays the watch's realtime heart rate ([LiveHeartRate]), so the watch keeps its JoyoFit link instead of
 * switching to Huawei's own HR broadcast, which takes the watch away from the phone.
 *
 * GATT server: Heart Rate (0x180D: measurement 0x2A37 notify, body sensor location 0x2A38 = wrist), Battery (0x180F: the phone's
 * level, so the head unit's sensor list shows the phone's battery) and Device Information (0x180A). Open characteristics, no
 * bonding. It advertises only while no head unit listens, as real sensors do, and asks the watch for realtime heart rate
 * only while a head unit has subscribed to the measurement. The newest reading is sent once a second while it is fresh
 * ([FRESH_MS]); none is sent when the watch stops reporting, so the head unit shows its own "no data" instead of a frozen number.
 *
 * Not persisted: the switch on the bike-computer settings turns it on for the ride; it lives as long as the process (kept by
 * [WatchService] in background mode).
 */
@SuppressLint("MissingPermission") // every entry point checks [missingPermission] first
internal class HrSensorPeripheral(
  context: Context,
  private val liveHeartRate: LiveHeartRate,
  private val events: WearEvents,
  private val scope: CoroutineScope,
) {
  private val appContext = context.applicationContext
  private val manager = appContext.getSystemService(BluetoothManager::class.java)
  private val lock = Any()

  /** The user's switch; the GATT server may be down meanwhile (Bluetooth off) and comes back with it. */
  @Volatile
  private var enabled = false

  private var server: BluetoothGattServer? = null
  private var advertising = false
  private var lastError: String? = null

  /** Services are added one at a time: the next waits for `onServiceAdded` of the previous. */
  private val pendingServices = ArrayDeque<BluetoothGattService>()
  /**
   * Devices that read or subscribed here: the head units. Android reports every LE connection of the phone to a GATT server, also the
   * app's own links to sensors, so a connection alone does not make a client.
   */
  private val clients = LinkedHashMap<String, BluetoothDevice>()
  private val hrSubscribers = HashSet<String>()
  private val batterySubscribers = HashSet<String>()

  private var hrCharacteristic: BluetoothGattCharacteristic? = null
  private var batteryCharacteristic: BluetoothGattCharacteristic? = null

  private var lastBpm = 0
  private var lastBpmAtMs = 0L
  private var sentCount = 0L
  private var batteryLevel = 0
  private var ticker: Job? = null
  private var receiversRegistered = false

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, "HR sensor: $message")

  private fun error(message: String) {
    synchronized(lock) { lastError = message }
    events.log(LogDirection.ERROR, null, null, null, "HR sensor: $message")
  }

  // Public API (module)

  fun status(): Map<String, Any?> = synchronized(lock) {
    val now = SystemClock.elapsedRealtime()
    mapOf(
      "supported" to supported(),
      "enabled" to enabled,
      "running" to (server != null),
      "advertising" to advertising,
      "connected" to clients.values.map { deviceName(it) },
      "subscribed" to hrSubscribers.size,
      "heartRate" to lastBpm.takeIf { it > 0 && now - lastBpmAtMs <= FRESH_MS },
      "sent" to sentCount.toDouble(),
      "phoneBattery" to batteryLevel,
      "error" to lastError,
      "missingPermission" to missingPermission(),
    )
  }

  /** Turns the sensor on or off. Throws when it cannot start at all (no permission, no Bluetooth LE peripheral support). */
  fun setEnabled(on: Boolean): Map<String, Any?> {
    if (!on) {
      enabled = false
      teardown("switched off")
      unregisterReceivers()
      return status()
    }
    missingPermission()?.let { throw WearException(ErrorCodes.BLUETOOTH_PERMISSION, "$it is not granted; the heart-rate sensor needs it") }
    val adapter = manager?.adapter ?: throw WearException(ErrorCodes.BLUETOOTH_UNAVAILABLE, "This phone has no Bluetooth adapter")
    if (adapter.isEnabled && !adapter.isMultipleAdvertisementSupported) {
      throw WearException(ErrorCodes.UNSUPPORTED, "This phone cannot act as a Bluetooth LE sensor (no LE advertising)")
    }
    enabled = true
    synchronized(lock) { lastError = null }
    registerReceivers()
    if (!adapter.isEnabled) {
      error("Bluetooth is off; the sensor starts when it is switched on")
      return status()
    }
    bringUp()
    return status()
  }

  /** Every realtime heart rate reading from the watch (any screen, any workout). Only stored: [ticker] sends it. */
  fun onHeartRate(bpm: Int) {
    if (!enabled) return
    synchronized(lock) {
      lastBpm = bpm
      lastBpmAtMs = SystemClock.elapsedRealtime()
    }
  }

  // Server lifecycle

  private fun supported(): Boolean =
    appContext.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE) &&
      (manager?.adapter?.let { !it.isEnabled || it.isMultipleAdvertisementSupported } ?: false)

  /** The runtime permission that is still missing, or null. Android 11 and older need only the install-time ones. */
  private fun missingPermission(): String? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return null
    for (p in listOf(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_ADVERTISE)) {
      if (appContext.checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) return p
    }
    return null
  }

  private fun bringUp() {
    if (!enabled || missingPermission() != null) return
    val manager = manager ?: return
    synchronized(lock) {
      if (server != null) return
      val opened = manager.openGattServer(appContext, callback)
      if (opened == null) {
        lastError = "Android refused to open a GATT server"
        events.log(LogDirection.ERROR, null, null, null, "HR sensor: $lastError")
        return
      }
      server = opened
      pendingServices.clear()
      pendingServices += heartRateService()
      pendingServices += batteryService()
      pendingServices += deviceInfoService()
      opened.addService(pendingServices.removeFirst())
    }
    log("GATT server opened")
  }

  /** Closes the server and advertising; [enabled] stays as it is, so Bluetooth coming back brings it up again. */
  private fun teardown(why: String) {
    stopAdvertising()
    val hadSubscribers: Boolean
    synchronized(lock) {
      ticker?.cancel()
      ticker = null
      hadSubscribers = hrSubscribers.isNotEmpty()
      try {
        server?.let { s -> clients.values.forEach { s.cancelConnection(it) } }
        server?.close()
      } catch (e: RuntimeException) {
        // The stack is already gone when Bluetooth was switched off.
      }
      server = null
      clients.clear()
      hrSubscribers.clear()
      batterySubscribers.clear()
      hrCharacteristic = null
      batteryCharacteristic = null
      pendingServices.clear()
    }
    if (hadSubscribers) liveHeartRate.setSensorActive(false)
    log("stopped ($why)")
  }

  private fun heartRateService() = BluetoothGattService(HR_SERVICE, BluetoothGattService.SERVICE_TYPE_PRIMARY).apply {
    val measurement = BluetoothGattCharacteristic(HR_MEASUREMENT, BluetoothGattCharacteristic.PROPERTY_NOTIFY, 0)
    measurement.addDescriptor(cccd())
    addCharacteristic(measurement)
    addCharacteristic(
      BluetoothGattCharacteristic(BODY_SENSOR_LOCATION, BluetoothGattCharacteristic.PROPERTY_READ, BluetoothGattCharacteristic.PERMISSION_READ),
    )
    synchronized(lock) { hrCharacteristic = measurement }
  }

  private fun batteryService() = BluetoothGattService(BATTERY_SERVICE, BluetoothGattService.SERVICE_TYPE_PRIMARY).apply {
    val level = BluetoothGattCharacteristic(
      BATTERY_LEVEL,
      BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
      BluetoothGattCharacteristic.PERMISSION_READ,
    )
    level.addDescriptor(cccd())
    addCharacteristic(level)
    synchronized(lock) { batteryCharacteristic = level }
  }

  private fun deviceInfoService() = BluetoothGattService(DEVICE_INFO_SERVICE, BluetoothGattService.SERVICE_TYPE_PRIMARY).apply {
    for (uuid in listOf(MANUFACTURER_NAME, MODEL_NUMBER)) {
      addCharacteristic(BluetoothGattCharacteristic(uuid, BluetoothGattCharacteristic.PROPERTY_READ, BluetoothGattCharacteristic.PERMISSION_READ))
    }
  }

  private fun cccd() = BluetoothGattDescriptor(CCCD, BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE)

  // Advertising

  private val advertiseCallback = object : AdvertiseCallback() {
    override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
      synchronized(lock) { advertising = true }
      log("advertising as a heart-rate sensor")
    }

    override fun onStartFailure(errorCode: Int) {
      synchronized(lock) { advertising = false }
      if (errorCode == ADVERTISE_FAILED_DATA_TOO_LARGE && withName) {
        // The phone's Bluetooth name does not fit the scan response: advertise without it.
        withName = false
        scope.launch { startAdvertising() }
        return
      }
      if (errorCode == ADVERTISE_FAILED_ALREADY_STARTED) {
        synchronized(lock) { advertising = true }
        return
      }
      error("advertising failed (code $errorCode)")
    }
  }

  /** The scan response carries the phone's Bluetooth name (the name the head unit lists) unless it is too long. */
  @Volatile
  private var withName = true

  private fun startAdvertising() {
    if (!enabled || missingPermission() != null) return
    val advertiser = manager?.adapter?.bluetoothLeAdvertiser ?: return
    synchronized(lock) {
      if (advertising || server == null || hrSubscribers.isNotEmpty()) return
    }
    val settings = AdvertiseSettings.Builder()
      .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
      .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
      .setConnectable(true)
      .setTimeout(0)
      .build()
    val data = AdvertiseData.Builder()
      .setIncludeDeviceName(false)
      .addServiceUuid(ParcelUuid(HR_SERVICE))
      .addServiceUuid(ParcelUuid(BATTERY_SERVICE))
      .build()
    val response = AdvertiseData.Builder().setIncludeDeviceName(withName).build()
    try {
      advertiser.startAdvertising(settings, data, response, advertiseCallback)
    } catch (e: RuntimeException) {
      error("advertising not started: ${e.message}")
    }
  }

  private fun stopAdvertising() {
    val wasAdvertising = synchronized(lock) { advertising.also { advertising = false } }
    if (!wasAdvertising) return
    try {
      manager?.adapter?.bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback)
    } catch (e: RuntimeException) {
      // Bluetooth already off.
    }
  }

  // GATT server callbacks (binder threads)

  private val callback = object : BluetoothGattServerCallback() {
    override fun onServiceAdded(status: Int, service: BluetoothGattService) {
      if (status != BluetoothGatt.GATT_SUCCESS) error("service ${service.uuid} not added (status $status)")
      val next = synchronized(lock) {
        if (server == null) return
        pendingServices.removeFirstOrNull()
      }
      if (next != null) {
        synchronized(lock) { server }?.addService(next)
      } else {
        startAdvertising()
      }
    }

    override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
      if (newState != BluetoothProfile.STATE_DISCONNECTED) return
      val address = device.address
      val (wasClient, lostLast) = synchronized(lock) {
        batterySubscribers.remove(address)
        (clients.remove(address) != null) to (hrSubscribers.remove(address) && hrSubscribers.isEmpty())
      }
      if (!wasClient) return
      log("${deviceName(device)} disconnected (status $status)")
      if (lostLast) subscriptionsChanged()
    }

    override fun onCharacteristicReadRequest(device: BluetoothDevice, requestId: Int, offset: Int, characteristic: BluetoothGattCharacteristic) {
      seen(device)
      val value = when (characteristic.uuid) {
        BODY_SENSOR_LOCATION -> byteArrayOf(SENSOR_LOCATION_WRIST)
        BATTERY_LEVEL -> byteArrayOf(readBattery().toByte())
        MANUFACTURER_NAME -> "JoyoFit".toByteArray()
        MODEL_NUMBER -> "Watch HR relay".toByteArray()
        else -> null
      }
      respond(device, requestId, offset, value)
    }

    override fun onDescriptorReadRequest(device: BluetoothDevice, requestId: Int, offset: Int, descriptor: BluetoothGattDescriptor) {
      seen(device)
      if (descriptor.uuid != CCCD) {
        respond(device, requestId, offset, null)
        return
      }
      val subscribed = synchronized(lock) {
        when (descriptor.characteristic.uuid) {
          HR_MEASUREMENT -> device.address in hrSubscribers
          BATTERY_LEVEL -> device.address in batterySubscribers
          else -> false
        }
      }
      respond(device, requestId, offset, if (subscribed) ENABLE_NOTIFICATION else DISABLE_NOTIFICATION)
    }

    override fun onDescriptorWriteRequest(
      device: BluetoothDevice,
      requestId: Int,
      descriptor: BluetoothGattDescriptor,
      preparedWrite: Boolean,
      responseNeeded: Boolean,
      offset: Int,
      value: ByteArray?,
    ) {
      if (descriptor.uuid != CCCD || value == null || value.size < 2) {
        if (responseNeeded) synchronized(lock) { server }?.sendResponse(device, requestId, BluetoothGatt.GATT_FAILURE, offset, null)
        return
      }
      seen(device)
      val on = (value[0].toInt() and 0x01) != 0
      var hrChanged = false
      synchronized(lock) {
        when (descriptor.characteristic.uuid) {
          HR_MEASUREMENT -> {
            val before = hrSubscribers.isNotEmpty()
            if (on) hrSubscribers += device.address else hrSubscribers -= device.address
            hrChanged = before != hrSubscribers.isNotEmpty()
          }
          BATTERY_LEVEL -> if (on) batterySubscribers += device.address else batterySubscribers -= device.address
        }
      }
      if (responseNeeded) synchronized(lock) { server }?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
      log("${deviceName(device)} ${if (on) "subscribed to" else "unsubscribed from"} ${if (descriptor.characteristic.uuid == HR_MEASUREMENT) "heart rate" else "battery"}")
      if (hrChanged) subscriptionsChanged()
      if (on && descriptor.characteristic.uuid == BATTERY_LEVEL) notifyBattery(readBattery(), device)
    }
  }

  private fun seen(device: BluetoothDevice) {
    val first = synchronized(lock) { clients.put(device.address, device) == null }
    if (first) log("${deviceName(device)} connected")
  }

  private fun respond(device: BluetoothDevice, requestId: Int, offset: Int, value: ByteArray?) {
    val s = synchronized(lock) { server } ?: return
    if (value == null) {
      s.sendResponse(device, requestId, BluetoothGatt.GATT_READ_NOT_PERMITTED, offset, null)
      return
    }
    if (offset > value.size) {
      s.sendResponse(device, requestId, BluetoothGatt.GATT_INVALID_OFFSET, offset, null)
      return
    }
    s.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value.copyOfRange(offset, value.size))
  }

  /**
   * The first head unit subscribed, or the last one left: the watch's realtime heart rate and the send loop follow, and advertising
   * stops while a head unit listens (one head unit per sensor, as a chest strap).
   */
  private fun subscriptionsChanged() {
    val any = synchronized(lock) { hrSubscribers.isNotEmpty() }
    liveHeartRate.setSensorActive(any)
    synchronized(lock) {
      ticker?.cancel()
      ticker = if (any) scope.launch { sendLoop() } else null
    }
    if (any) stopAdvertising() else startAdvertising()
  }

  private suspend fun sendLoop() {
    while (currentCoroutineContext().isActive) {
      var bpm = 0
      var targets = emptyList<BluetoothDevice>()
      var characteristic: BluetoothGattCharacteristic? = null
      var s: BluetoothGattServer? = null
      synchronized(lock) {
        if (lastBpm > 0 && SystemClock.elapsedRealtime() - lastBpmAtMs <= FRESH_MS) bpm = lastBpm
        targets = hrSubscribers.mapNotNull { clients[it] }
        characteristic = hrCharacteristic
        s = server
      }
      val c = characteristic
      val srv = s
      if (bpm > 0 && c != null && srv != null) {
        // Flags 0: heart rate as uint8, no sensor contact, energy or RR fields.
        val value = byteArrayOf(0x00, bpm.coerceIn(0, 255).toByte())
        for (device in targets) notify(srv, device, c, value)
        synchronized(lock) { sentCount += targets.size }
      }
      delay(SEND_EVERY_MS)
    }
  }

  private fun notifyBattery(level: Int, only: BluetoothDevice? = null) {
    val (targets, characteristic, s) = synchronized(lock) {
      Triple(only?.let { listOf(it) } ?: batterySubscribers.mapNotNull { clients[it] }, batteryCharacteristic, server)
    }
    if (characteristic == null || s == null) return
    for (device in targets) notify(s, device, characteristic, byteArrayOf(level.toByte()))
  }

  @Suppress("DEPRECATION")
  private fun notify(s: BluetoothGattServer, device: BluetoothDevice, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        s.notifyCharacteristicChanged(device, characteristic, false, value)
      } else {
        characteristic.value = value
        s.notifyCharacteristicChanged(device, characteristic, false)
      }
    } catch (e: RuntimeException) {
      // A device that disconnected between the snapshot and the send; its disconnect callback cleans up.
    }
  }

  // Phone battery and Bluetooth on/off

  private fun readBattery(): Int {
    val level = appContext.getSystemService(BatteryManager::class.java)?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: 0
    return level.coerceIn(0, 100).also { synchronized(lock) { batteryLevel = it } }
  }

  private val receiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      when (intent.action) {
        Intent.ACTION_BATTERY_CHANGED -> {
          val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
          val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
          if (level < 0 || scale <= 0) return
          val pct = (level * 100 / scale).coerceIn(0, 100)
          val changed = synchronized(lock) { (batteryLevel != pct).also { batteryLevel = pct } }
          if (changed) notifyBattery(pct)
        }
        BluetoothAdapter.ACTION_STATE_CHANGED -> when (intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, -1)) {
          BluetoothAdapter.STATE_TURNING_OFF, BluetoothAdapter.STATE_OFF -> if (synchronized(lock) { server != null }) teardown("Bluetooth off")
          BluetoothAdapter.STATE_ON -> if (enabled) scope.launch {
            synchronized(lock) { lastError = null }
            bringUp()
          }
        }
      }
    }
  }

  private fun registerReceivers() {
    synchronized(lock) {
      if (receiversRegistered) return
      receiversRegistered = true
    }
    val filter = IntentFilter().apply {
      addAction(Intent.ACTION_BATTERY_CHANGED)
      addAction(BluetoothAdapter.ACTION_STATE_CHANGED)
    }
    // System broadcasts only; NOT_EXPORTED is allowed for them.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      appContext.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      appContext.registerReceiver(receiver, filter)
    }
    readBattery()
  }

  private fun unregisterReceivers() {
    synchronized(lock) {
      if (!receiversRegistered) return
      receiversRegistered = false
    }
    try {
      appContext.unregisterReceiver(receiver)
    } catch (e: IllegalArgumentException) {
      // Not registered.
    }
  }

  private fun deviceName(device: BluetoothDevice): String =
    try {
      device.name?.takeIf { it.isNotBlank() } ?: "Bike computer"
    } catch (e: SecurityException) {
      "Bike computer"
    }

  private companion object {
    fun uuid16(short: Int): UUID = UUID.fromString("0000%04x-0000-1000-8000-00805f9b34fb".format(short))

    val HR_SERVICE = uuid16(0x180D)
    val HR_MEASUREMENT = uuid16(0x2A37)
    val BODY_SENSOR_LOCATION = uuid16(0x2A38)
    val BATTERY_SERVICE = uuid16(0x180F)
    val BATTERY_LEVEL = uuid16(0x2A19)
    val DEVICE_INFO_SERVICE = uuid16(0x180A)
    val MANUFACTURER_NAME = uuid16(0x2A29)
    val MODEL_NUMBER = uuid16(0x2A24)
    val CCCD = uuid16(0x2902)

    val ENABLE_NOTIFICATION = byteArrayOf(0x01, 0x00)
    val DISABLE_NOTIFICATION = byteArrayOf(0x00, 0x00)

    /** Body Sensor Location: 2 = wrist. */
    const val SENSOR_LOCATION_WRIST: Byte = 0x02

    const val SEND_EVERY_MS = 1_000L

    /** A reading older than this is not sent: the watch stopped reporting (link lost, workout over, watch off the wrist). */
    const val FRESH_MS = 10_000L
  }
}
