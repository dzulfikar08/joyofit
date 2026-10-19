package com.joyodigitama.blesensors

import android.annotation.SuppressLint
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.util.Log
import java.util.UUID

/**
 * Bathroom scales on top of the [SensorHub]: an UNFILTERED scan (a scale that broadcasts its weight has no service to filter by; it hides
 * the reading in manufacturer data) and one [ScaleLink] per scale being weighed on. It only moves bytes: advertisements go to JS as
 * `onScaleAdvertisement`, GATT as `onScaleLink` / `onScaleValue`, and every decision (which scale is a scale, what a frame means) is made
 * by the TypeScript decoders. All of it runs on the hub thread.
 */
@SuppressLint("MissingPermission")
internal class ScaleRadio(private val hub: SensorHub) {
  private var scanCallback: ScanCallback? = null
  private var wanted: Set<String>? = null
  private var scanLowLatency = true
  private val throttle = AdvertisementThrottle(REPEAT_MS)
  private val links = HashMap<String, ScaleLink>()
  private val scanTimeout = Runnable { stopScan(null) }

  /** [ids] restricts the scan to those addresses (the scale the person already picked); null reports everything around. */
  fun startScan(ids: List<String>?, durationMs: Long, lowLatency: Boolean) {
    val scanner = hub.scanner() ?: throw SensorException(ErrorCodes.BLUETOOTH_OFF, "Bluetooth is off")
    wanted = ids?.map { it.trim().uppercase() }?.toSet()
    hub.handler.removeCallbacks(scanTimeout)
    hub.handler.postDelayed(scanTimeout, durationMs.coerceIn(MIN_SCAN_MS, MAX_SCAN_MS))
    if (scanCallback != null) {
      if (lowLatency == scanLowLatency) return
      // The radio duty cycle is fixed when a scan starts: restart it for the other one.
      stopScan(null)
      hub.handler.postDelayed(scanTimeout, durationMs.coerceIn(MIN_SCAN_MS, MAX_SCAN_MS))
    }
    scanLowLatency = lowLatency
    throttle.clear()
    val callback = object : ScanCallback() {
      override fun onScanResult(callbackType: Int, result: ScanResult) {
        val ts = System.currentTimeMillis()
        hub.handler.post { if (scanCallback === this) emitAdvertisement(result, ts) }
      }

      override fun onScanFailed(errorCode: Int) {
        hub.handler.post {
          if (scanCallback !== this) return@post
          Log.w(TAG, "Scale scan failed, error $errorCode")
          scanCallback = null
          hub.handler.removeCallbacks(scanTimeout)
          hub.emit("onScaleScanState", mapOf("scanning" to false, "error" to ErrorCodes.BLUETOOTH_UNAVAILABLE))
        }
      }
    }
    val mode = if (lowLatency) ScanSettings.SCAN_MODE_LOW_LATENCY else ScanSettings.SCAN_MODE_BALANCED
    val settings = ScanSettings.Builder().setScanMode(mode).build()
    try {
      scanner.startScan(null, settings, callback)
    } catch (e: SecurityException) {
      throw SensorException(ErrorCodes.BLUETOOTH_PERMISSION, "Scan permission denied", e)
    } catch (e: IllegalStateException) {
      throw SensorException(ErrorCodes.BLUETOOTH_OFF, "Bluetooth is off", e)
    }
    scanCallback = callback
    hub.emit("onScaleScanState", mapOf("scanning" to true, "error" to null))
  }

  fun stopScan(error: String?) {
    val callback = scanCallback ?: return
    scanCallback = null
    hub.handler.removeCallbacks(scanTimeout)
    try {
      hub.scanner()?.stopScan(callback)
    } catch (e: SecurityException) {
      Log.w(TAG, "stopScan: ${e.message}")
    } catch (e: IllegalStateException) {
      // Bluetooth turned off meanwhile: the scan is gone already.
    }
    hub.emit("onScaleScanState", mapOf("scanning" to false, "error" to error))
  }

  private fun emitAdvertisement(result: ScanResult, ts: Long) {
    val address = result.device.address
    val filter = wanted
    if (filter != null && address.uppercase() !in filter) return
    val record = result.scanRecord
    val fingerprint = SensorProfile.toHex(record?.bytes ?: ByteArray(0))
    if (!throttle.shouldEmit(address, fingerprint, ts)) return

    val serviceUuids = ArrayList<String>()
    record?.serviceUuids?.forEach { serviceUuids += ScaleLogic.normalize(it.uuid) }
    val serviceData = HashMap<String, String>()
    record?.serviceData?.forEach { (uuid, bytes) -> serviceData[ScaleLogic.normalize(uuid.uuid)] = SensorProfile.toHex(bytes) }
    val manufacturerData = HashMap<String, String>()
    val manufacturer = record?.manufacturerSpecificData
    if (manufacturer != null) {
      for (i in 0 until manufacturer.size()) manufacturerData[ScaleLogic.companyKey(manufacturer.keyAt(i))] = SensorProfile.toHex(manufacturer.valueAt(i))
    }
    val name = record?.deviceName ?: if (hub.canConnect()) result.device.name else null
    hub.emit(
      "onScaleAdvertisement",
      mapOf(
        "id" to address,
        "name" to name,
        "rssi" to result.rssi,
        "ts" to ts.toDouble(),
        "serviceUuids" to serviceUuids,
        "serviceData" to serviceData,
        "manufacturerData" to manufacturerData,
      ),
    )
  }

  fun connect(address: String) {
    links[address]?.stop()
    val link = ScaleLink(hub, address) { ended -> if (links[ended.address] === ended) links.remove(ended.address) }
    links[address] = link
    link.start()
  }

  fun disconnect(address: String) {
    links.remove(address)?.stop()
  }

  fun operation(
    address: String,
    kind: ScaleLink.Kind,
    service: String,
    characteristic: String,
    value: ByteArray?,
    withResponse: Boolean,
    done: (String?) -> Unit,
  ) {
    val link = links[address]
    if (link == null) {
      done(ErrorCodes.SCALE_NOT_CONNECTED)
      return
    }
    val serviceUuid: UUID
    val characteristicUuid: UUID
    try {
      serviceUuid = ScaleLogic.parse(service)
      characteristicUuid = ScaleLogic.parse(characteristic)
    } catch (e: IllegalArgumentException) {
      done(ErrorCodes.INVALID_ARGUMENT)
      return
    }
    link.enqueue(ScaleLink.Op(kind, serviceUuid, characteristicUuid, value, withResponse, done))
  }

  /** Bluetooth went off. */
  fun radioLost() {
    stopScan(ErrorCodes.BLUETOOTH_OFF)
    val all = links.values.toList()
    links.clear()
    all.forEach { it.radioLost() }
  }

  private companion object {
    const val TAG = "BleSensors"
    const val REPEAT_MS = 2_000L
    const val MIN_SCAN_MS = 5_000L
    const val MAX_SCAN_MS = 180_000L
  }
}
