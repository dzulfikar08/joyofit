package com.joyodigitama.huaweiwear

import android.bluetooth.BluetoothDevice
import java.util.Locale

/** A device as Android's own list of paired devices reports it. */
internal class SystemPaired(val address: String, val name: String?)

/**
 * The rows of the Watch tab's list on Android: what Android lists as paired, the watch the link is on, the watch JoyoFit remembers
 * and what the last Bluetooth LE scan saw, one row per address.
 *
 * The remembered watch is always a row, as on iOS. JoyoFit keeps its address and keys itself, so a watch Android does not list as paired
 * (a band is never paired there, see [BleTransport]; a Classic watch whose pairing Android dropped) stays connectable by address and
 * never has to be found by a scan, which a watch that holds a phone does not answer.
 */
internal object WatchListing {
  /** [linkOf] is the link that last worked for an address ([DeviceIdentity.linkTransport]); it outranks the model table in `classic`. */
  fun build(
    systemPaired: List<SystemPaired>,
    current: DiscoveredDevice?,
    remembered: SystemPaired?,
    scanNames: Map<String, String>,
    linkOf: (String) -> ModelTransport? = { null },
  ): List<DiscoveredDevice> {
    val rows = LinkedHashMap<String, DiscoveredDevice>()

    fun row(address: String, name: String?, paired: Boolean): DiscoveredDevice {
      val match = WatchModels.match(name)
      // Android lists every paired device (earphones, a car): only a watch has a remembered link to look up.
      val link = if (match.connectable) linkOf(address) else null
      return DiscoveredDevice(
        address = address,
        name = name ?: address,
        model = match.model?.name,
        support = match.support.wire,
        reason = match.reason,
        paired = paired,
        classic = TransportChoice.known(match, link)?.let { it == ModelTransport.BR },
      )
    }

    for (device in systemPaired) rows[device.address] = row(device.address, device.name, paired = true)
    if (current != null && !rows.containsKey(current.address)) rows[current.address] = current.copy(paired = false)
    if (remembered != null) {
      val known = rows[remembered.address]
      rows[remembered.address] = known?.copy(remembered = true)
        ?: row(remembered.address, remembered.name, paired = false).copy(remembered = true)
    }
    for ((address, name) in scanNames) {
      if (rows.containsKey(address)) continue
      if (WatchModels.match(name).connectable) rows[address] = row(address, name, paired = false)
    }
    return rows.values.sortedBy { it.name.lowercase(Locale.ROOT) }
  }
}

/**
 * Android's pairing state of a Classic watch. A Classic link (RFCOMM, a secure socket) needs the pairing; Android starts it when a
 * connect finds none and the watch has to agree, so a connect that fails with no pairing left behind says the pairing is what is missing,
 * not that the watch is busy somewhere else. JoyoFit never removes a pairing and never deletes a key on its own: this only reads it.
 */
internal object PairingState {
  fun label(bondState: Int?): String = when (bondState) {
    BluetoothDevice.BOND_BONDED -> "paired"
    BluetoothDevice.BOND_BONDING -> "pairing in progress"
    BluetoothDevice.BOND_NONE -> "not paired"
    else -> "unknown"
  }

  const val NOT_PAIRED_NOTE =
    "Android has no Bluetooth pairing with this watch (the pairing was removed, or the watch refused to pair again). " +
      "Pair it in Android's Bluetooth settings, then connect again; JoyoFit's own keys for the watch are kept"

  /**
   * True when the watch is known to use a Classic link ([transport], from [TransportChoice.known]) and Android has no pairing with it. A
   * connect to it makes Android start a pairing (a system dialog, which the watch has to accept), so only a person who opened the connect
   * may make one; automatic reconnects leave it alone. A band is never paired in Android, an unreadable state is no evidence, and a name in
   * no list that has never connected is not known to be Classic (null).
   */
  fun missing(transport: ModelTransport?, bondState: Int?): Boolean =
    transport == ModelTransport.BR && bondState == BluetoothDevice.BOND_NONE

  /**
   * [failure] of a connect to a Classic watch, as ERR_NOT_PAIRED when Android had no pairing left after it. Only a connect that never
   * opened the link is rewritten (ERR_CONNECT_FAILED, ERR_TIMEOUT); a watch that connected and then failed keeps its own error.
   */
  fun explain(failure: WearException, transport: ModelTransport?, bondState: Int?): WearException {
    if (!missing(transport, bondState)) return failure
    if (failure.errorCode != ErrorCodes.CONNECT_FAILED && failure.errorCode != ErrorCodes.TIMEOUT) return failure
    return WearException(ErrorCodes.NOT_PAIRED, "$NOT_PAIRED_NOTE. ${failure.message}", failure)
  }
}
