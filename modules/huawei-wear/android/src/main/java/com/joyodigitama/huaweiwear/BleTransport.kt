// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): service/btle/BtLEQueue and service/devices/huawei/HuaweiLESupport
// (GATT service 0xFE86 with FE01 to write and FE02 to notify; Honor's own service for isNewHonorProtocol models).
package com.joyodigitama.huaweiwear

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothStatusCodes
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelUuid
import android.util.Log
import java.io.IOException
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiConstants

/**
 * Bluetooth LE link to a Huawei or Honor band: the same packet stream as [RfcommTransport], carried by GATT. The phone writes
 * to the write characteristic and the watch answers with notifications on the read one, so notification payloads go to
 * [onData] exactly as RFCOMM read chunks do (the session reassembles packets, whatever the chunking).
 *
 * Like GB's BtLEQueue: discover services, enable notifications on the read characteristic, and run one GATT operation at a time.
 * There is no Android bonding: GB's HuaweiLECoordinator uses BONDING_STYLE_NONE because the watch authenticates through the Huawei
 * protocol itself. Opening the link follows [LeConnectPlan]: two direct connects, then autoConnect (as GB's HuaweiLESupport uses it
 * from the start), so a watch that is switched off or out of range at the moment is connected as soon as it comes back, within the
 * budget [connect] is given, without another scan.
 */
internal class BleTransport(
  private val context: Context,
  private val device: BluetoothDevice,
  /** GB isNewHonorProtocol: Honor's service and characteristics instead of 0xFE86 with FE01 and FE02. */
  newHonorProtocol: Boolean,
  /** The Bluetooth name the watch is bonded under: an LE advertiser with the same name (or the same address) is the watch. */
  private val watchName: String?,
  private val onData: (ByteArray) -> Unit,
  /** Called once if the link ends after [connect] returned and without [close] having been called. */
  private val onRemoteClosed: (IOException?) -> Unit,
  /** Connect progress for the support report (negotiated MTU, services, write type). */
  private val log: (String) -> Unit,
) : WatchTransport {
  private val serviceUuid: UUID =
    if (newHonorProtocol) HuaweiConstants.UUID_SERVICE_HONOR_SERVICE else HuaweiConstants.UUID_SERVICE_HUAWEI_SERVICE

  /** Every connect step goes to the support report and to logcat under [LOGCAT_TAG]. */
  private fun step(message: String) {
    Log.i(LOGCAT_TAG, message)
    log(message)
  }

  private val readUuid: UUID =
    if (newHonorProtocol) HuaweiConstants.UUID_CHARACTERISTIC_HONOR_READ else HuaweiConstants.UUID_CHARACTERISTIC_HUAWEI_READ
  private val writeUuid: UUID =
    if (newHonorProtocol) HuaweiConstants.UUID_CHARACTERISTIC_HONOR_WRITE else HuaweiConstants.UUID_CHARACTERISTIC_HUAWEI_WRITE

  private val gatt = AtomicReference<BluetoothGatt?>(null)
  private val closed = AtomicBoolean(false)
  private val writeLock = Mutex()

  @Volatile private var writeCharacteristic: BluetoothGattCharacteristic? = null
  @Volatile private var writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT

  /** ATT MTU in force; one write carries at most this minus the 3 byte ATT header. 23 until the watch agrees to more. */
  @Volatile private var attMtu = DEFAULT_ATT_MTU

  /** What [connect] is waiting for, and the last thing Android's GATT callbacks said, for the timeout and failure messages. */
  @Volatile private var stage = "starting"
  @Volatile private var lastGattEvent: String? = null

  /** True once the GATT link of this connect came up: a drop after that is the watch ending a link, not a connect that never opened. */
  @Volatile private var linkWasUp = false

  // Connect phase of the current attempt: completed by the GATT callbacks, failed when the link drops or [close] runs.
  @Volatile private var linkUp = CompletableDeferred<Unit>()
  @Volatile private var mtuDone = CompletableDeferred<Unit>()
  @Volatile private var servicesDone = CompletableDeferred<Unit>()

  /** GATT clients of earlier attempts: whatever they still report must not touch the current attempt. */
  private val staleClients = ConcurrentHashMap.newKeySet<BluetoothGatt>()

  /** The GATT status of the one write or descriptor write in flight; Android allows only one at a time. */
  private val operation = AtomicReference<CompletableDeferred<Int>?>(null)

  // Guards [ready] and [lostBeforeReady] together, so a drop between the last connect step and [connect] returning is not missed.
  private val stateLock = Any()
  private var ready = false
  private var lostBeforeReady: IOException? = null

  /** Notifications are handed over on this thread, in order, so the binder thread that delivers GATT callbacks never runs session code. */
  private val reader = Executors.newSingleThreadExecutor { r -> Thread(r, "huawei-ble-read").apply { isDaemon = true } }

  private val callback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
      if (g in staleClients) return
      step("GATT connection state ${stateText(newState)}, ${statusText(status)}")
      lastGattEvent = "${stateText(newState)}, ${statusText(status)}"
      if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
        linkUp.complete(Unit)
      } else if (newState == BluetoothProfile.STATE_DISCONNECTED || status != BluetoothGatt.GATT_SUCCESS) {
        linkLost(LinkEndedException("Bluetooth LE link ended: ${statusText(status)}"))
      }
    }

    override fun onMtuChanged(g: BluetoothGatt, mtu: Int, status: Int) {
      if (g in staleClients) return
      step("ATT MTU changed to $mtu, ${statusText(status)}")
      if (status == BluetoothGatt.GATT_SUCCESS) attMtu = mtu
      mtuDone.complete(Unit)
    }

    override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
      if (g in staleClients) return
      step("GATT service discovery done, ${statusText(status)}")
      if (status == BluetoothGatt.GATT_SUCCESS) {
        servicesDone.complete(Unit)
      } else {
        servicesDone.completeExceptionally(IOException("Service discovery failed: ${statusText(status)}"))
      }
    }

    override fun onCharacteristicWrite(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
      operation.get()?.complete(status)
    }

    override fun onDescriptorWrite(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
      step("GATT descriptor ${descriptor.characteristic.uuid} written, ${statusText(status)}")
      operation.get()?.complete(status)
    }

    // Android 12 and older call this one; 13 and newer call the one with the value.
    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
      if (characteristic.uuid == readUuid) deliver(characteristic.value)
    }

    override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
      if (characteristic.uuid == readUuid) deliver(value)
    }
  }

  /**
   * Opens the GATT link, requests a larger MTU, finds the Huawei characteristics and turns notifications on, all within
   * [timeoutMs]. Closing aborts it.
   */
  @SuppressLint("MissingPermission")
  override suspend fun connect(timeoutMs: Long) {
    val totalMs = LeConnectPlan.totalMs(timeoutMs)
    try {
      withTimeout(totalMs) { open() }
    } catch (e: TimeoutCancellationException) {
      close()
      val last = lastGattEvent?.let { "last GATT event: $it" } ?: "Android reported no GATT event"
      throw WearException(
        ErrorCodes.TIMEOUT,
        "Timed out after $totalMs ms connecting to ${device.address} over Bluetooth LE while $stage ($last)",
        e,
      )
    } catch (e: WearException) {
      close()
      throw e
    } catch (e: IOException) {
      close()
      // The watch ended a link that had come up (it is held by another phone or app, or went away): a dropped link, not a connect that never opened.
      if (e is LinkEndedException && linkWasUp) {
        throw WearException(ErrorCodes.DISCONNECTED, "The watch ended the Bluetooth LE link while $stage: ${e.message}", e)
      }
      throw WearException(ErrorCodes.CONNECT_FAILED, "Bluetooth LE connect to ${device.address} failed while $stage: ${e.message}", e)
    } catch (e: SecurityException) {
      close()
      throw WearException(ErrorCodes.BLUETOOTH_PERMISSION, "BLUETOOTH_CONNECT permission denied: ${e.message}", e)
    } catch (e: Throwable) {
      // Caller cancelled; release the GATT client.
      close()
      throw e
    }

    val lost = synchronized(stateLock) {
      ready = true
      lostBeforeReady
    }
    if (lost != null || closed.get()) {
      close()
      throw WearException(ErrorCodes.DISCONNECTED, "Disconnected while connecting", lost)
    }
  }

  @SuppressLint("MissingPermission")
  private suspend fun open() {
    stage = "scanning for the watch"
    val target = findTarget()
    val client = connectWithRetry(target)
    step("GATT connected")

    // Best effort: a watch that never answers must not hold the connect up. The frames are cut to what the ATT MTU carries
    // in write(), so a small MTU only costs speed.
    stage = "negotiating the ATT MTU"
    val mtuStarted = client.requestMtu(REQUESTED_MTU)
    step("ATT MTU request $REQUESTED_MTU ${if (mtuStarted) "sent" else "refused by Android"}")
    if (mtuStarted) withTimeoutOrNull(MTU_TIMEOUT_MS) { mtuDone.await() } ?: step("ATT MTU: no answer within $MTU_TIMEOUT_MS ms")
    step("ATT MTU $attMtu")

    stage = "discovering GATT services"
    if (!client.discoverServices()) throw IOException("Android refused to start service discovery")
    servicesDone.await()
    for (service in client.services) {
      step("GATT service ${service.uuid}: " + service.characteristics.joinToString(", ") { "${it.uuid} props 0x${Integer.toHexString(it.properties)}" })
    }

    val read = findCharacteristic(client, readUuid)
    val write = findCharacteristic(client, writeUuid)
    if (read == null || write == null) {
      throw WearException(
        ErrorCodes.CONNECT_FAILED,
        "The watch has no Huawei GATT characteristics (${if (read == null) "read $readUuid" else "write $writeUuid"} is missing); " +
          "services found: ${client.services.joinToString(", ") { it.uuid.toString() }}",
      )
    }
    // GB leaves the characteristic's write type as Android sets it: no response when the characteristic allows it.
    writeType = when {
      write.properties and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE != 0 -> BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
      write.properties and BluetoothGattCharacteristic.PROPERTY_WRITE != 0 -> BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
      else -> throw WearException(ErrorCodes.CONNECT_FAILED, "GATT characteristic $writeUuid cannot be written")
    }
    writeCharacteristic = write
    step("GATT write ${if (writeType == BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE) "without" else "with"} response; notify characteristic $readUuid")

    stage = "enabling notifications"
    enableNotifications(client, read)
    step("GATT notifications on")
  }

  /**
   * Opens the GATT link, trying again when an attempt fails before the link is up ([LeConnectPlan]): the first two without
   * autoConnect (what nRF Connect does), each cut off after [LeConnectPlan.DIRECT_ATTEMPT_MS] because Android would wait about 30 s
   * for a watch that does not answer, the last with autoConnect, which Android keeps pending until the watch is connectable (a watch
   * that has just been switched on, or that left the range and came back). Which variant connected is logged.
   */
  @SuppressLint("MissingPermission")
  private suspend fun connectWithRetry(target: BluetoothDevice): BluetoothGatt {
    var attempt = 0
    while (true) {
      attempt++
      val autoConnect = LeConnectPlan.usesAutoConnect(attempt)
      linkUp = CompletableDeferred()
      mtuDone = CompletableDeferred()
      servicesDone = CompletableDeferred()
      synchronized(stateLock) { lostBeforeReady = null }
      stage = "opening the GATT link (attempt $attempt of ${LeConnectPlan.ATTEMPTS})"
      step("GATT connect to ${target.address}, attempt $attempt of ${LeConnectPlan.ATTEMPTS} (transport LE, autoConnect ${if (autoConnect) "on" else "off"})")
      val client = target.connectGatt(context, autoConnect, callback, BluetoothDevice.TRANSPORT_LE, BluetoothDevice.PHY_LE_1M_MASK)
        ?: throw IOException("Android did not create a GATT client")
      gatt.set(client)
      // close() may have run before the client was published; it could not release it then.
      if (closed.get()) {
        release()
        throw IOException("Disconnected while connecting")
      }
      try {
        val budget = LeConnectPlan.attemptBudgetMs(attempt)
        if (budget == null) {
          linkUp.await()
        } else {
          withTimeoutOrNull(budget) { linkUp.await() } ?: throw IOException("the watch did not answer within $budget ms")
        }
        linkWasUp = true
        step("GATT link up on attempt $attempt: variant autoConnect ${if (autoConnect) "on" else "off"}, PHY LE 1M")
        return client
      } catch (e: IOException) {
        if (closed.get() || attempt >= LeConnectPlan.ATTEMPTS) throw e
        step("GATT attempt $attempt failed (${e.message}); trying again in ${LeConnectPlan.RETRY_DELAY_MS} ms")
        releaseClient()
        delay(LeConnectPlan.RETRY_DELAY_MS)
      }
    }
  }

  /**
   * The LE device to open GATT on. A watch's LE address is not always its Classic one, so with scan permission this scans
   * (filtered on the service, the bonded name and the bonded address, and logging every match) for an advertiser with the
   * bonded name or address and takes that. Without the permission, or when nothing matches, it falls back to the bonded
   * address over LE.
   */
  @SuppressLint("MissingPermission")
  private suspend fun findTarget(): BluetoothDevice {
    if (!canScan()) {
      step("LE scan skipped: scan permission not granted; using bonded address ${device.address}")
      return device
    }
    val scanner = context.getSystemService(BluetoothManager::class.java)?.adapter?.bluetoothLeScanner
    if (scanner == null) {
      step("LE scan skipped: no LE scanner; using bonded address ${device.address}")
      return device
    }
    val match = CompletableDeferred<BluetoothDevice>()
    val seen = ConcurrentHashMap.newKeySet<String>()
    var advertisedService = false
    val scanCallback = object : ScanCallback() {
      override fun onScanResult(callbackType: Int, result: ScanResult) {
        val record = result.scanRecord
        val name = record?.deviceName ?: try { result.device.name } catch (e: SecurityException) { null }
        val hasService = record?.serviceUuids?.any { it.uuid == serviceUuid } == true ||
          record?.serviceData?.keys?.any { it.uuid == serviceUuid } == true
        val sameAddress = result.device.address.equals(device.address, ignoreCase = true)
        val sameName = sameWatchName(name)
        val huaweiish = name?.lowercase(Locale.ROOT)?.let { "huawei" in it || "honor" in it } == true
        if (!hasService && !sameAddress && !sameName && !huaweiish) return
        if (hasService) advertisedService = true
        if (seen.add(result.device.address)) {
          step(
            "LE scan: ${result.device.address} \"${name ?: "no name"}\" rssi ${result.rssi} connectable ${result.isConnectable} " +
              "service $serviceUuid ${if (hasService) "ADVERTISED" else "not advertised"}, uuids ${record?.serviceUuids}, " +
              "same address ${sameAddress}, same name $sameName, raw ${record?.bytes?.joinToString("") { "%02x".format(it) }}",
          )
        }
        if (sameAddress || sameName) match.complete(result.device)
      }

      override fun onScanFailed(errorCode: Int) {
        step("LE scan failed, error $errorCode")
        match.completeExceptionally(IOException("LE scan failed, error $errorCode"))
      }
    }
    // Android pauses unfiltered scans while the screen is off, so the scan is filtered: the service, the bonded name, the bonded address.
    val filters = buildList {
      add(ScanFilter.Builder().setServiceUuid(ParcelUuid(serviceUuid)).build())
      if (watchName != null) add(ScanFilter.Builder().setDeviceName(watchName).build())
      add(ScanFilter.Builder().setDeviceAddress(device.address).build())
    }
    step("LE scan for \"${watchName ?: device.address}\", service $serviceUuid or address ${device.address}, up to ${LeConnectPlan.SCAN_MS} ms")
    scanner.startScan(filters, ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), scanCallback)
    val found = try {
      withTimeoutOrNull(LeConnectPlan.SCAN_MS) { match.await() }
    } catch (e: IOException) {
      null
    } finally {
      try {
        scanner.stopScan(scanCallback)
      } catch (ignored: IllegalStateException) {
        // Bluetooth turned off meanwhile.
      }
    }
    if (found == null) {
      step("LE scan: no advertiser matched; FE86 advertised by anything seen: $advertisedService; using bonded address ${device.address}")
      return device
    }
    step("LE scan: matched ${found.address}${if (found.address.equals(device.address, ignoreCase = true)) " (same as the bonded address)" else " (differs from the bonded address ${device.address})"}")
    return found
  }

  private fun canScan(): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      context.checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
    } else {
      context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    }

  /** Huawei names are "MODEL-XXX" with a per-watch suffix: the LE name matches when everything before the last dash is equal. */
  private fun sameWatchName(advertised: String?): Boolean {
    val bonded = watchName ?: return false
    if (advertised == null) return false
    val a = advertised.trim().lowercase(Locale.ROOT)
    val b = bonded.trim().lowercase(Locale.ROOT)
    return a == b || (a.contains('-') && b.contains('-') && a.substringBeforeLast('-') == b.substringBeforeLast('-'))
  }

  /** GB's `getCharacteristic(uuid)`: the characteristic is looked up in every service the watch offers. */
  private fun findCharacteristic(client: BluetoothGatt, uuid: UUID): BluetoothGattCharacteristic? =
    client.services.firstNotNullOfOrNull { it.getCharacteristic(uuid) }

  @SuppressLint("MissingPermission")
  @Suppress("DEPRECATION")
  private suspend fun enableNotifications(client: BluetoothGatt, read: BluetoothGattCharacteristic) {
    if (!client.setCharacteristicNotification(read, true)) throw IOException("Android refused to enable notifications on $readUuid")
    val cccd = read.getDescriptor(CLIENT_CONFIG_UUID)
    if (cccd == null) {
      // GB's notify() does the same: the local flag is set and the watch is left to push.
      log("GATT characteristic $readUuid has no client configuration descriptor")
      return
    }
    val value = if (read.properties and BluetoothGattCharacteristic.PROPERTY_NOTIFY == 0 &&
      read.properties and BluetoothGattCharacteristic.PROPERTY_INDICATE != 0
    ) {
      BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
    } else {
      BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
    }
    val status = gattOperation("enable notifications", DESCRIPTOR_TIMEOUT_MS) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        client.writeDescriptor(cccd, value) == BluetoothStatusCodes.SUCCESS
      } else {
        cccd.value = value
        client.writeDescriptor(cccd)
      }
    }
    if (status != BluetoothGatt.GATT_SUCCESS) throw IOException("Enabling notifications failed: ${statusText(status)}")
  }

  /**
   * Starts one GATT operation with [start] and waits for its callback, for the GATT status it carries. Throws [IOException]
   * when Android refuses to start it, it does not finish within [timeoutMs], or the link drops meanwhile.
   */
  private suspend fun gattOperation(what: String, timeoutMs: Long, start: () -> Boolean): Int {
    val result = CompletableDeferred<Int>()
    operation.set(result)
    try {
      if (closed.get()) throw IOException("Bluetooth LE link is closed")
      if (!start()) throw IOException("Android refused to start: $what")
      return withTimeoutOrNull(timeoutMs) { result.await() }
        ?: throw IOException("$what: no answer from the watch within $timeoutMs ms")
    } finally {
      operation.compareAndSet(result, null)
    }
  }

  /** Every element in order, each cut to what one ATT write carries, one write in flight at a time. */
  @SuppressLint("MissingPermission")
  @Suppress("DEPRECATION")
  override suspend fun write(frames: List<ByteArray>) {
    writeLock.withLock {
      val client = gatt.get()?.takeIf { !closed.get() } ?: throw IOException("Bluetooth LE link is closed")
      val characteristic = writeCharacteristic ?: throw IOException("Bluetooth LE link is not ready")
      val type = writeType
      try {
        for (frame in frames) {
          var offset = 0
          while (offset < frame.size) {
            val size = minOf(frame.size - offset, maxOf(attMtu - ATT_HEADER_BYTES, DEFAULT_ATT_MTU - ATT_HEADER_BYTES), MAX_ATTRIBUTE_BYTES)
            val chunk = if (offset == 0 && size == frame.size) frame else frame.copyOfRange(offset, offset + size)
            Log.i(LOGCAT_TAG, "TX ${chunk.size} bytes ${headHex(chunk)}")
            val status = gattOperation("write", WRITE_TIMEOUT_MS) {
              if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                client.writeCharacteristic(characteristic, chunk, type) == BluetoothStatusCodes.SUCCESS
              } else {
                characteristic.writeType = type
                characteristic.value = chunk
                client.writeCharacteristic(characteristic)
              }
            }
            if (status != BluetoothGatt.GATT_SUCCESS) throw IOException("GATT write failed: ${statusText(status)}")
            offset += size
          }
        }
      } catch (e: SecurityException) {
        throw IOException("BLUETOOTH_CONNECT permission denied: ${e.message}", e)
      }
    }
  }

  private fun deliver(value: ByteArray?) {
    if (value == null || value.isEmpty() || closed.get()) return
    // Older Android reuses the characteristic's value array for the next notification.
    val chunk = value.copyOf()
    Log.i(LOGCAT_TAG, "RX ${chunk.size} bytes ${headHex(chunk)}")
    try {
      reader.execute {
        try {
          onData(chunk)
        } catch (t: Throwable) {
          // GB logs and keeps reading; one bad frame must not end the link.
          Log.e(TAG, "onData failed", t)
        }
      }
    } catch (ignored: RejectedExecutionException) {
      // Closed while the callback was running.
    }
  }

  /** The link ended: fails whatever waits for the watch, and tells [onRemoteClosed] if [connect] already returned. */
  private fun linkLost(cause: IOException) {
    failPending(cause)
    val wasReady = synchronized(stateLock) {
      if (!ready) lostBeforeReady = cause
      ready
    }
    if (wasReady && closed.compareAndSet(false, true)) {
      release()
      onRemoteClosed(cause)
    }
  }

  private fun failPending(cause: IOException) {
    linkUp.completeExceptionally(cause)
    mtuDone.completeExceptionally(cause)
    servicesDone.completeExceptionally(cause)
    operation.get()?.completeExceptionally(cause)
  }

  /** Idempotent; does not invoke [onRemoteClosed]. */
  override fun close() {
    closed.set(true)
    failPending(IOException("Bluetooth LE link closed"))
    release()
  }

  @SuppressLint("MissingPermission")
  private fun release() {
    reader.shutdown()
    releaseClient()
  }

  /** Drops the GATT client only; the connect retry uses it between attempts. */
  @SuppressLint("MissingPermission")
  private fun releaseClient() {
    val client = gatt.getAndSet(null) ?: return
    staleClients.add(client)
    try {
      client.disconnect()
    } catch (ignored: SecurityException) {
      // BLUETOOTH_CONNECT was revoked: the system drops the link with the client below.
    }
    try {
      client.close()
    } catch (ignored: SecurityException) {
      // Same.
    }
  }

  private companion object {
    const val TAG = "HuaweiWear"

    /** The logcat tag of every connect step, scan result and packet on the LE link. */
    const val LOGCAT_TAG = "JoyoFitBle"

    /** Android refuses a characteristic value longer than this, whatever the ATT MTU. */
    const val MAX_ATTRIBUTE_BYTES = 512

    /** What Android asks for by default; the watch answers with what it supports. */
    const val REQUESTED_MTU = 512
    const val DEFAULT_ATT_MTU = 23
    const val ATT_HEADER_BYTES = 3

    const val MTU_TIMEOUT_MS = 3_000L
    const val DESCRIPTOR_TIMEOUT_MS = 5_000L
    const val WRITE_TIMEOUT_MS = 5_000L

    /** Client Characteristic Configuration descriptor. */
    val CLIENT_CONFIG_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

    /** The first bytes of a packet, enough to see the 0x5A frame start, length, service and command. */
    fun headHex(bytes: ByteArray): String = bytes.take(8).joinToString("") { "%02x".format(it) }

    fun stateText(state: Int): String = when (state) {
      BluetoothProfile.STATE_CONNECTED -> "CONNECTED"
      BluetoothProfile.STATE_DISCONNECTED -> "DISCONNECTED"
      BluetoothProfile.STATE_CONNECTING -> "CONNECTING"
      BluetoothProfile.STATE_DISCONNECTING -> "DISCONNECTING"
      else -> "state $state"
    }

    fun statusText(status: Int): String {
      val meaning = when (status) {
        BluetoothGatt.GATT_SUCCESS -> "success"
        8 -> "connection timeout"
        19 -> "the watch ended the connection"
        22 -> "the phone ended the connection"
        62 -> "connection failed to establish"
        147 -> "connection could not be established, the watch is not answering"
        133 -> "generic GATT error"
        BluetoothGatt.GATT_INSUFFICIENT_AUTHENTICATION, BluetoothGatt.GATT_INSUFFICIENT_ENCRYPTION -> "not bonded"
        else -> null
      }
      return if (meaning != null) "GATT status $status ($meaning)" else "GATT status $status"
    }
  }
}
