package com.joyodigitama.blesensors

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.ParcelUuid
import android.util.Log
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Process-wide owner of the sensor connections, the scan and the Bluetooth state. The recording may outlive the JS runtime
 * (a reload, the module being destroyed), so none of this belongs to the Expo module: the module only installs an event sink.
 *
 * All state lives on one HandlerThread; the public functions hop onto it and wait, so callers see their request applied when
 * the call returns and nothing needs a lock.
 */
@SuppressLint("MissingPermission")
internal class SensorHub private constructor(val context: Context) {
  private val thread = HandlerThread("ble-sensors").apply { start() }
  val handler = Handler(thread.looper)

  private class Sink(val owner: Any, val send: (String, Map<String, Any?>) -> Unit)

  @Volatile private var sink: Sink? = null

  private val links = LinkedHashMap<String, SensorLink>()
  private var scanCallback: ScanCallback? = null
  private val scanTimeout = Runnable { stopScanOnHub(null) }
  private val scale = ScaleRadio(this)
  private var lastBluetoothState: String

  private val adapter: BluetoothAdapter?
    get() = context.getSystemService(BluetoothManager::class.java)?.adapter

  private val receiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      if (intent.action != BluetoothAdapter.ACTION_STATE_CHANGED) return
      onRadioState(intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR))
    }
  }

  init {
    lastBluetoothState = bluetoothState()
    val filter = IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)
    // A system broadcast: delivered to a receiver that is not exported, on the hub thread.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      context.registerReceiver(receiver, filter, null, handler, Context.RECEIVER_NOT_EXPORTED)
    } else {
      context.registerReceiver(receiver, filter, null, handler)
    }
  }

  /** The Expo module installs its `sendEvent` here; events are dropped (not queued) while nobody listens. */
  fun install(owner: Any, send: (String, Map<String, Any?>) -> Unit) {
    sink = Sink(owner, send)
  }

  /** Only the module that installed the sink removes it, so a reloaded module's sink survives the old one's destruction. */
  fun uninstall(owner: Any) {
    if (sink?.owner === owner) sink = null
  }

  fun emit(name: String, payload: Map<String, Any?>) {
    val current = sink ?: return
    try {
      current.send(name, payload)
    } catch (e: Exception) {
      // The JS runtime may be gone (reload); losing an event must never break a link.
      Log.w(TAG, "Dropped $name event: ${e.message}")
    }
  }

  fun device(address: String): BluetoothDevice =
    adapter?.getRemoteDevice(address) ?: throw SensorException(ErrorCodes.BLUETOOTH_UNAVAILABLE, "No Bluetooth adapter")

  fun radioOn(): Boolean = adapter?.state == BluetoothAdapter.STATE_ON

  // Permissions and radio state.

  private fun granted(permission: String) = context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

  private fun hasConnectPermission() = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || granted(Manifest.permission.BLUETOOTH_CONNECT)

  // Before Android 12 a scan has no Bluetooth runtime permission but needs precise location to return results.
  private fun hasScanPermission() =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) granted(Manifest.permission.BLUETOOTH_SCAN) else granted(Manifest.permission.ACCESS_FINE_LOCATION)

  fun bluetoothState(): String {
    val adapter = adapter
    if (adapter == null || !context.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)) return "unsupported"
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !(hasConnectPermission() && hasScanPermission())) return "unauthorized"
    return when (adapter.state) {
      BluetoothAdapter.STATE_ON -> "on"
      BluetoothAdapter.STATE_OFF, BluetoothAdapter.STATE_TURNING_ON, BluetoothAdapter.STATE_TURNING_OFF -> "off"
      else -> "unknown"
    }
  }

  private fun requireAdapter() {
    if (adapter == null || !context.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)) {
      throw SensorException(ErrorCodes.BLUETOOTH_UNAVAILABLE, "This device has no Bluetooth LE")
    }
  }

  private fun requireOn() {
    if (!radioOn()) throw SensorException(ErrorCodes.BLUETOOTH_OFF, "Bluetooth is off")
  }

  private fun requireScan() {
    requireAdapter()
    if (!hasScanPermission()) {
      val needed = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) "BLUETOOTH_SCAN" else "ACCESS_FINE_LOCATION"
      throw SensorException(ErrorCodes.BLUETOOTH_PERMISSION, "$needed permission is not granted")
    }
    requireOn()
  }

  private fun requireConnect() {
    requireAdapter()
    if (!hasConnectPermission()) throw SensorException(ErrorCodes.BLUETOOTH_PERMISSION, "BLUETOOTH_CONNECT permission is not granted")
    requireOn()
  }

  // Public API: callable from any thread.

  fun startScan() {
    requireScan()
    onHub { startScanOnHub() }
  }

  fun stopScan() = onHub { stopScanOnHub(null) }

  fun connect(id: String) {
    val address = id.trim().uppercase()
    if (!BluetoothAdapter.checkBluetoothAddress(address)) throw SensorException(ErrorCodes.INVALID_ARGUMENT, "Not a Bluetooth address: $id")
    requireConnect()
    onHub {
      val existing = links[address]
      if (existing != null) {
        existing.reemit()
      } else {
        val link = SensorLink(this, address)
        links[address] = link
        link.start()
      }
    }
  }

  // Bathroom scales (ScaleRadio): an unfiltered scan and one GATT link per scale, kept apart from the sensor links above.

  fun startScaleScan(ids: List<String>?, durationMs: Long, lowLatency: Boolean) {
    requireScan()
    onHub { scale.startScan(ids, durationMs, lowLatency) }
  }

  fun stopScaleScan() = onHub { scale.stopScan(null) }

  fun scaleConnect(id: String) {
    val address = scaleAddress(id)
    requireConnect()
    onHub { scale.connect(address) }
  }

  fun scaleDisconnect(id: String) = onHub { scale.disconnect(scaleAddress(id)) }

  /** Queues one GATT operation of a scale link. Returns at once; [done] runs on the hub thread with null or an error code. */
  fun scaleOperation(
    id: String,
    kind: ScaleLink.Kind,
    service: String,
    characteristic: String,
    value: ByteArray?,
    withResponse: Boolean,
    done: (String?) -> Unit,
  ) {
    val address = scaleAddress(id)
    handler.post { scale.operation(address, kind, service, characteristic, value, withResponse, done) }
  }

  private fun scaleAddress(id: String): String {
    val address = id.trim().uppercase()
    if (!BluetoothAdapter.checkBluetoothAddress(address)) throw SensorException(ErrorCodes.INVALID_ARGUMENT, "Not a Bluetooth address: $id")
    return address
  }

  fun scanner() = adapter?.bluetoothLeScanner

  fun canConnect() = hasConnectPermission()

  fun disconnect(id: String) = onHub { links.remove(id.trim().uppercase())?.stop() }

  fun disconnectAll() = onHub {
    val all = links.values.toList()
    links.clear()
    all.forEach { it.stop() }
  }

  fun connectionStates(): List<Map<String, Any?>> = onHub { links.values.map { it.lastEvent } }

  // Hub thread.

  private fun startScanOnHub() {
    val scanner = adapter?.bluetoothLeScanner ?: throw SensorException(ErrorCodes.BLUETOOTH_OFF, "Bluetooth is off")
    if (scanCallback != null) {
      // Already scanning: just run the 20 s again.
      handler.removeCallbacks(scanTimeout)
      handler.postDelayed(scanTimeout, SCAN_MS)
      return
    }
    val callback = object : ScanCallback() {
      override fun onScanResult(callbackType: Int, result: ScanResult) {
        handler.post { if (scanCallback === this) emitScanResult(result) }
      }

      override fun onScanFailed(errorCode: Int) {
        handler.post {
          if (scanCallback !== this) return@post
          Log.w(TAG, "Scan failed, error $errorCode")
          scanCallback = null
          handler.removeCallbacks(scanTimeout)
          emit("onScanState", mapOf("scanning" to false, "error" to ErrorCodes.BLUETOOTH_UNAVAILABLE))
        }
      }
    }
    val filters = SensorProfile.supportedServices.map { ScanFilter.Builder().setServiceUuid(ParcelUuid(SensorProfile.uuid16(it))).build() }
    val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
    try {
      scanner.startScan(filters, settings, callback)
    } catch (e: SecurityException) {
      throw SensorException(ErrorCodes.BLUETOOTH_PERMISSION, "Scan permission denied", e)
    } catch (e: IllegalStateException) {
      throw SensorException(ErrorCodes.BLUETOOTH_OFF, "Bluetooth is off", e)
    }
    scanCallback = callback
    handler.postDelayed(scanTimeout, SCAN_MS)
    emit("onScanState", mapOf("scanning" to true, "error" to null))
  }

  private fun stopScanOnHub(error: String?) {
    val callback = scanCallback ?: return
    scanCallback = null
    handler.removeCallbacks(scanTimeout)
    try {
      adapter?.bluetoothLeScanner?.stopScan(callback)
    } catch (e: SecurityException) {
      Log.w(TAG, "stopScan: ${e.message}")
    } catch (e: IllegalStateException) {
      // Bluetooth turned off meanwhile: the scan is gone already.
    }
    emit("onScanState", mapOf("scanning" to false, "error" to error))
  }

  private fun emitScanResult(result: ScanResult) {
    val record = result.scanRecord
    val advertised = HashSet<String>()
    record?.serviceUuids?.forEach { uuid -> SensorProfile.short(uuid.uuid)?.let(advertised::add) }
    record?.serviceData?.keys?.forEach { uuid -> SensorProfile.short(uuid.uuid)?.let(advertised::add) }
    val name = record?.deviceName ?: if (hasConnectPermission()) result.device.name else null
    emit(
      "onScanResult",
      mapOf(
        "id" to result.device.address,
        "name" to name,
        "rssi" to result.rssi,
        "services" to SensorProfile.supportedIn(advertised),
      ),
    )
  }

  private fun onRadioState(state: Int) {
    when (state) {
      BluetoothAdapter.STATE_TURNING_OFF, BluetoothAdapter.STATE_OFF -> {
        stopScanOnHub(ErrorCodes.BLUETOOTH_OFF)
        links.values.forEach { it.radioLost() }
        scale.radioLost()
      }
      BluetoothAdapter.STATE_ON -> links.values.forEach { it.radioRestored() }
    }
    val now = bluetoothState()
    if (now != lastBluetoothState) {
      lastBluetoothState = now
      emit("onBluetoothState", mapOf("state" to now))
    }
  }

  private fun <T> onHub(block: () -> T): T {
    if (Looper.myLooper() === thread.looper) return block()
    val latch = CountDownLatch(1)
    var result: Result<T>? = null
    handler.post {
      result = runCatching(block)
      latch.countDown()
    }
    if (!latch.await(HUB_WAIT_MS, TimeUnit.MILLISECONDS)) {
      throw SensorException(ErrorCodes.BLUETOOTH_UNAVAILABLE, "The Bluetooth worker did not answer")
    }
    return result!!.getOrThrow()
  }

  companion object {
    private const val TAG = "BleSensors"
    private const val SCAN_MS = 20_000L
    private const val HUB_WAIT_MS = 5_000L

    @Volatile private var instance: SensorHub? = null

    fun get(context: Context): SensorHub =
      instance ?: synchronized(this) { instance ?: SensorHub(context.applicationContext).also { instance = it } }

    /** The hub if it was created; never creates one. */
    fun peek(): SensorHub? = instance
  }
}
