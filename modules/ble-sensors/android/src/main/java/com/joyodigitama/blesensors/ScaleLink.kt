package com.joyodigitama.blesensors

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothStatusCodes
import android.os.Build
import android.util.Log
import java.util.UUID

/**
 * One GATT connection to a bathroom scale, for a weigh-in: connect, discover, then do exactly what JS asks, one operation at a time.
 * The protocol (which characteristic to subscribe, which handshake bytes to write) lives in TypeScript (`src/features/scale/protocols`), so
 * this class has no scale knowledge and no reconnect logic: when the link ends JS hears `disconnected` and decides. Runs on the hub thread
 * (the GATT client is created with the hub's handler).
 */
@SuppressLint("MissingPermission")
internal class ScaleLink(
  private val hub: SensorHub,
  val address: String,
  private val onEnded: (ScaleLink) -> Unit,
) {
  enum class Kind { SUBSCRIBE, READ, WRITE }

  /** `done` gets null on success, else an error code for JS. */
  class Op(
    val kind: Kind,
    val service: UUID,
    val characteristic: UUID,
    val value: ByteArray?,
    val withResponse: Boolean,
    val done: (String?) -> Unit,
  )

  private var gatt: BluetoothGatt? = null
  private var connected = false
  private var ended = false
  private var closed = false
  private val queue = ArrayDeque<Op>()
  private var inFlight: Op? = null
  private var timeoutReason = ""
  private val timeout = Runnable { fail("$timeoutReason timed out") }

  private val callback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
      if (g !== gatt && !ended) return
      if (ended) {
        if (newState == BluetoothProfile.STATE_DISCONNECTED) close()
        return
      }
      log("GATT state $newState, status $status")
      if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
        arm(DISCOVERY_TIMEOUT_MS, "service discovery")
        val started = try {
          g.discoverServices()
        } catch (e: SecurityException) {
          false
        }
        if (!started) fail("Android refused to start service discovery")
      } else {
        fail("Link ended: GATT status $status")
      }
    }

    override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
      if (ended) return
      if (status != BluetoothGatt.GATT_SUCCESS) {
        fail("Service discovery failed: GATT status $status")
        return
      }
      disarm()
      connected = true
      val services = g.services.map { service ->
        mapOf(
          "uuid" to ScaleLogic.normalize(service.uuid),
          "characteristics" to service.characteristics.map { c ->
            mapOf("uuid" to ScaleLogic.normalize(c.uuid), "properties" to ScaleLogic.propertyNames(c.properties))
          },
        )
      }
      publish("connected", services, null)
    }

    override fun onDescriptorWrite(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
      if (inFlight?.kind == Kind.SUBSCRIBE) complete(status)
    }

    override fun onCharacteristicWrite(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
      if (inFlight?.kind == Kind.WRITE) complete(status)
    }

    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onCharacteristicRead(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) =
      onRead(characteristic, characteristic.value, status)

    override fun onCharacteristicRead(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray, status: Int) =
      onRead(characteristic, value, status)

    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic) =
      emitValue(characteristic, characteristic.value, System.currentTimeMillis())

    override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) =
      emitValue(characteristic, value, System.currentTimeMillis())
  }

  fun start() {
    publish("connecting", emptyList(), null)
    try {
      gatt = hub.device(address).connectGatt(
        hub.context,
        false,
        callback,
        BluetoothDevice.TRANSPORT_LE,
        BluetoothDevice.PHY_LE_1M_MASK,
        hub.handler,
      )
    } catch (e: SecurityException) {
      fail("BLUETOOTH_CONNECT permission denied")
      return
    } catch (e: RuntimeException) {
      fail("connectGatt failed: ${e.message}")
      return
    }
    if (gatt == null) {
      fail("Android did not create a GATT client")
      return
    }
    arm(CONNECT_TIMEOUT_MS, "connecting")
  }

  /** The person (or JS) is done with this scale: no `disconnected` error, queued operations fail. */
  fun stop() = finish(null)

  /** Bluetooth went off: the controller dropped the link already. */
  fun radioLost() = finish("Bluetooth turned off", linkDown = true)

  fun enqueue(op: Op) {
    if (ended || !connected) {
      op.done(ErrorCodes.SCALE_NOT_CONNECTED)
      return
    }
    queue.addLast(op)
    pump()
  }

  private fun pump() {
    if (inFlight != null) return
    val g = gatt ?: return
    while (queue.isNotEmpty()) {
      val op = queue.removeFirst()
      val started = try {
        begin(g, op)
      } catch (e: SecurityException) {
        fail("BLUETOOTH_CONNECT permission denied")
        return
      }
      if (started == null) {
        inFlight = op
        arm(OPERATION_TIMEOUT_MS, "${op.kind} ${ScaleLogic.normalize(op.characteristic)}")
        // A write without response is complete once Android queued it; not every stack calls onCharacteristicWrite for it.
        if (op.kind == Kind.WRITE && !op.withResponse) hub.handler.postDelayed({ if (inFlight === op) complete(BluetoothGatt.GATT_SUCCESS) }, NO_RESPONSE_SETTLE_MS)
        return
      }
      op.done(started)
    }
  }

  /** Starts [op]; null when it is running, else the error code. */
  @Suppress("DEPRECATION")
  private fun begin(g: BluetoothGatt, op: Op): String? {
    val characteristic = g.getService(op.service)?.getCharacteristic(op.characteristic) ?: return ErrorCodes.SCALE_NO_CHARACTERISTIC
    return when (op.kind) {
      Kind.READ -> if (g.readCharacteristic(characteristic)) null else ErrorCodes.SCALE_OPERATION_REFUSED
      Kind.WRITE -> {
        val value = op.value ?: return ErrorCodes.INVALID_ARGUMENT
        val type = if (op.withResponse) BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT else BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
        val started = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          g.writeCharacteristic(characteristic, value, type) == BluetoothStatusCodes.SUCCESS
        } else {
          characteristic.writeType = type
          characteristic.value = value
          g.writeCharacteristic(characteristic)
        }
        if (started) null else ErrorCodes.SCALE_OPERATION_REFUSED
      }
      Kind.SUBSCRIBE -> {
        val cccd = characteristic.getDescriptor(SensorProfile.CLIENT_CONFIG) ?: return ErrorCodes.SCALE_NO_CHARACTERISTIC
        if (!g.setCharacteristicNotification(characteristic, true)) return ErrorCodes.SCALE_OPERATION_REFUSED
        val indicateOnly = characteristic.properties and ScaleLogic.PROPERTY_NOTIFY == 0 &&
          characteristic.properties and ScaleLogic.PROPERTY_INDICATE != 0
        val value = if (indicateOnly) BluetoothGattDescriptor.ENABLE_INDICATION_VALUE else BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
        val started = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          g.writeDescriptor(cccd, value) == BluetoothStatusCodes.SUCCESS
        } else {
          cccd.value = value
          g.writeDescriptor(cccd)
        }
        if (started) {
          null
        } else {
          g.setCharacteristicNotification(characteristic, false)
          ErrorCodes.SCALE_OPERATION_REFUSED
        }
      }
    }
  }

  private fun onRead(characteristic: BluetoothGattCharacteristic, value: ByteArray?, status: Int) {
    val ts = System.currentTimeMillis()
    if (inFlight?.kind != Kind.READ) return
    if (status == BluetoothGatt.GATT_SUCCESS && value != null) emitValue(characteristic, value, ts)
    complete(status)
  }

  private fun complete(status: Int) {
    disarm()
    val op = inFlight ?: return
    inFlight = null
    op.done(if (status == BluetoothGatt.GATT_SUCCESS) null else "${ErrorCodes.SCALE_GATT_PREFIX}$status")
    pump()
  }

  private fun emitValue(characteristic: BluetoothGattCharacteristic, value: ByteArray, ts: Long) {
    if (ended) return
    hub.emit(
      "onScaleValue",
      mapOf(
        "id" to address,
        "ts" to ts.toDouble(),
        "service" to ScaleLogic.normalize(characteristic.service.uuid),
        "characteristic" to ScaleLogic.normalize(characteristic.uuid),
        "value" to SensorProfile.toHex(value),
      ),
    )
  }

  private fun fail(reason: String) = finish(reason)

  private fun finish(reason: String?, linkDown: Boolean = false) {
    if (ended) return
    ended = true
    disarm()
    log(if (reason == null) "closed by request" else "link failed: $reason")
    val pending = ArrayList<Op>(queue.size + 1)
    inFlight?.let { pending += it }
    pending += queue
    inFlight = null
    queue.clear()
    pending.forEach { it.done(ErrorCodes.SCALE_NOT_CONNECTED) }
    release(linkDown)
    publish("disconnected", emptyList(), reason)
    onEnded(this)
  }

  /** With the link up, ask for a disconnect and close when Android confirms (closing at once can leave the link open on some stacks). */
  private fun release(linkDown: Boolean) {
    val g = gatt
    if (g == null || linkDown) {
      close()
      return
    }
    try {
      g.disconnect()
      hub.handler.postDelayed({ close() }, CLOSE_GRACE_MS)
    } catch (e: SecurityException) {
      close()
    }
  }

  private fun close() {
    if (closed) return
    closed = true
    try {
      gatt?.close()
    } catch (ignored: SecurityException) {
      // BLUETOOTH_CONNECT was revoked: the system drops the link with the client.
    }
  }

  private fun arm(ms: Long, reason: String) {
    hub.handler.removeCallbacks(timeout)
    timeoutReason = reason
    hub.handler.postDelayed(timeout, ms)
  }

  private fun disarm() = hub.handler.removeCallbacks(timeout)

  private fun publish(state: String, services: List<Map<String, Any?>>, error: String?) {
    hub.emit("onScaleLink", mapOf("id" to address, "state" to state, "services" to services, "error" to error))
  }

  private fun log(message: String) = Log.i(TAG, "scale $address: $message")

  private companion object {
    const val TAG = "BleSensors"
    const val CONNECT_TIMEOUT_MS = 20_000L
    const val DISCOVERY_TIMEOUT_MS = 15_000L
    const val OPERATION_TIMEOUT_MS = 10_000L
    const val CLOSE_GRACE_MS = 2_000L
    const val NO_RESPONSE_SETTLE_MS = 40L
  }
}
