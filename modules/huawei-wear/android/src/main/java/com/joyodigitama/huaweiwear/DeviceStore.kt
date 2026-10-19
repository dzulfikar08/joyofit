// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): HuaweiSupportProvider.{createSecretKey,getSecretKey,setSecretKey,createRandomMacAddress,createAndroidID}.
package com.joyodigitama.huaweiwear

import android.content.Context
import android.content.SharedPreferences
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiCrypto
import nodomain.freeyourgadget.gadgetbridge.util.StringUtils

/** The private preference file of one watch's identity: one file per address, so two watches never share a key. */
internal fun identityPrefsName(address: String): String = "huawei_wear_" + address.uppercase().replace(":", "")

private fun labPrefsName(address: String, tag: String): String = "huawei_wear_lab_${tag}_" + address.uppercase().replace(":", "")

private fun privatePrefs(context: Context): (String) -> SharedPreferences {
  val app = context.applicationContext
  return { name -> app.getSharedPreferences(name, Context.MODE_PRIVATE) }
}

/**
 * Per-device private SharedPreferences holding the identity the watch binds to: auth key, the fake
 * MAC and fake Android id Gadgetbridge presents to the watch, and whether a bind has completed.
 * Mirrors HuaweiSupportProvider.createSecretKey/getSecretKey/setSecretKey/createRandomMacAddress/
 * createAndroidID. Every watch has its own file ([identityPrefsName]); nothing here reads or writes another watch's.
 */
internal class DeviceStore internal constructor(private val openPrefs: (String) -> SharedPreferences) {
  constructor(context: Context) : this(privatePrefs(context))

  fun forDevice(address: String): DeviceIdentity = DeviceIdentity(address, prefs(address))

  /** A throwaway client identity for the developer bind lab: its own auth key, fake MAC and android id, so the watch sees a new phone. */
  fun forLab(address: String, tag: String): DeviceIdentity =
    DeviceIdentity(address, openPrefs(labPrefsName(address, tag)))

  /** Makes a bound lab identity the stored one: the watch keeps one credential, so after the lab bound it the old key is dead. */
  fun adoptLab(address: String, tag: String) {
    val lab = openPrefs(labPrefsName(address, tag))
    val editor = prefs(address).edit().clear()
    for ((key, value) in lab.all) {
      when (value) {
        is String -> editor.putString(key, value)
        is Boolean -> editor.putBoolean(key, value)
      }
    }
    editor.commit()
  }

  /** Drops the auth key, fake identity and bond flag so the next connect is a first-time bind. */
  fun forget(address: String) {
    prefs(address).edit().clear().commit()
  }

  private fun prefs(address: String): SharedPreferences = openPrefs(identityPrefsName(address))
}

internal class DeviceIdentity(
  /** The watch's real Bluetooth address, as GB's `getDeviceMac()` (fed to HuaweiCrypto.createSecretKey). */
  val deviceAddress: String,
  private val prefs: SharedPreferences,
) {
  /** GB initializeDevice(): create the fake MAC and android id before the first request. */
  fun ensureCreated() {
    macAddress
    androidId
  }

  /** Fake `FF:FF:FF:xx:xx:xx` address, as GB `createRandomMacAddress`. */
  val macAddress: String
    get() {
      val stored = prefs.getString(KEY_MAC, null)
      if (!stored.isNullOrEmpty()) return stored
      val random = SecureRandom()
      val mac = StringBuilder("FF:FF:FF")
      repeat(3) { mac.append(String.format(":%02x", random.nextInt(255))) }
      val created = mac.toString().uppercase()
      prefs.edit().putString(KEY_MAC, created).apply()
      return created
    }

  /** Fake Android id, as GB `createAndroidID`: hex of 16 random bytes. */
  val androidId: String
    get() {
      val stored = prefs.getString(KEY_ANDROID_ID, null)
      if (!stored.isNullOrEmpty()) return stored
      val created = StringUtils.bytesToHex(HuaweiCrypto.generateNonce())
      prefs.edit().putString(KEY_ANDROID_ID, created).apply()
      return created
    }

  /** GB `getAndroidId()`. */
  val androidIdBytes: ByteArray
    get() = androidId.toByteArray(StandardCharsets.UTF_8)

  /** GB `getMacAddress()`. */
  val macAddressBytes: ByteArray
    get() = macAddress.toByteArray(StandardCharsets.UTF_8)

  /** GB `getSerial()`: the last three bytes of the fake MAC as 6 hex characters. */
  val serialBytes: ByteArray
    get() = macAddress.replace(":", "").substring(6, 12).toByteArray(StandardCharsets.UTF_8)

  /** Stored auth key (GB `getSecretKey()` without the NPE on a missing key). */
  var authKey: ByteArray?
    get() = prefs.getString(KEY_AUTH, null)?.takeIf { it.isNotEmpty() }?.hexToBytes()
    set(value) {
      val editor = prefs.edit()
      if (value == null) editor.remove(KEY_AUTH) else editor.putString(KEY_AUTH, value.toHex())
      editor.apply()
    }

  /** GB `createSecretKey()`: make a random 16-byte auth key if none is stored; returns the key. */
  fun createSecretKey(): ByteArray {
    authKey?.let { return it }
    val created = HuaweiCrypto.generateNonce()
    authKey = created
    return created
  }

  /**
   * GB's `firstConnection` flag: true until a bind has completed. A stored key alone does not count
   * because the HiChain bind writes the key mid-way (operationCode 1 step 3) before it has finished.
   */
  val isFirstConnection: Boolean
    get() = !prefs.getBoolean(KEY_BONDED, false) || authKey == null

  fun markBonded() {
    prefs.edit().putBoolean(KEY_BONDED, true).apply()
  }

  /**
   * The link that last opened and authenticated for this watch, or null until a connect worked. It outranks the model table when the
   * next connect picks its link ([TransportChoice]). Kept with the identity, so forgetting the watch forgets it too.
   */
  var linkTransport: ModelTransport?
    get() = prefs.getString(KEY_LINK, null)?.let { stored -> ModelTransport.values().firstOrNull { it.name == stored } }
    set(value) {
      val editor = prefs.edit()
      if (value == null) editor.remove(KEY_LINK) else editor.putString(KEY_LINK, value.name)
      editor.apply()
    }

  private companion object {
    const val KEY_AUTH = "authkey"
    const val KEY_MAC = "fake_mac_address"
    const val KEY_ANDROID_ID = "fake_android_id"
    const val KEY_BONDED = "bonded"
    const val KEY_LINK = "link_transport"
  }
}
