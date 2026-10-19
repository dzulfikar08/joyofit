package com.joyodigitama.blesensors

import java.util.UUID

/**
 * The pure part of the bathroom-scale transport (ScaleRadio.kt, ScaleLink.kt): identifier normalisation shared with the TypeScript side
 * (`src/features/scale/uuid.ts`), GATT property names and the advertisement throttle. No Android types, so it runs as a JVM unit test.
 * The same rules live in ScaleLogic.swift; keep the two in step.
 */
internal object ScaleLogic {
  private const val BASE_SUFFIX = "-0000-1000-8000-00805f9b34fb"

  /** 4 lowercase hex digits for a Bluetooth base UUID, otherwise the full lowercase form (what `normalizeUuid` in uuid.ts returns). */
  fun normalize(uuid: UUID): String {
    val full = uuid.toString().lowercase()
    return if (full.startsWith("0000") && full.endsWith(BASE_SUFFIX)) full.substring(4, 8) else full
  }

  /** The inverse: 4 or 8 hex digits expand onto the base UUID, anything else is parsed as a full UUID. Throws IllegalArgumentException. */
  fun parse(text: String): UUID {
    val lower = text.trim().lowercase()
    return when {
      Regex("^[0-9a-f]{4}$").matches(lower) -> UUID.fromString("0000$lower$BASE_SUFFIX")
      Regex("^[0-9a-f]{8}$").matches(lower) -> UUID.fromString("$lower$BASE_SUFFIX")
      else -> UUID.fromString(lower)
    }
  }

  /** The company identifier key of a manufacturer record: 4 lowercase hex digits of the 16-bit value. */
  fun companyKey(companyId: Int): String = (companyId and 0xFFFF).toString(16).padStart(4, '0')

  const val PROPERTY_READ = 0x02
  const val PROPERTY_WRITE_NO_RESPONSE = 0x04
  const val PROPERTY_WRITE = 0x08
  const val PROPERTY_NOTIFY = 0x10
  const val PROPERTY_INDICATE = 0x20

  /** `CharacteristicProperty` names of `src/features/scale/types.ts`, in a fixed order. */
  fun propertyNames(properties: Int): List<String> {
    val names = ArrayList<String>(5)
    if (properties and PROPERTY_READ != 0) names += "read"
    if (properties and PROPERTY_WRITE != 0) names += "write"
    if (properties and PROPERTY_WRITE_NO_RESPONSE != 0) names += "writeNoResponse"
    if (properties and PROPERTY_NOTIFY != 0) names += "notify"
    if (properties and PROPERTY_INDICATE != 0) names += "indicate"
    return names
  }

  /** Lowercase hex without separators to bytes; null for odd length or a non-hex digit. */
  fun fromHex(hex: String): ByteArray? {
    if (hex.length % 2 != 0) return null
    val out = ByteArray(hex.length / 2)
    for (i in out.indices) {
      val hi = Character.digit(hex[i * 2], 16)
      val lo = Character.digit(hex[i * 2 + 1], 16)
      if (hi < 0 || lo < 0) return null
      out[i] = ((hi shl 4) or lo).toByte()
    }
    return out
  }
}

/**
 * Decides which advertisements of the unfiltered scale scan reach JS. A scale that broadcasts its weight changes its payload with every
 * reading, so a changed payload always passes; an identical one passes at most once every [repeatMs] (keeps "still in range" alive, spares
 * the bridge from the dozens of beacons around).
 */
internal class AdvertisementThrottle(private val repeatMs: Long) {
  private class Last(val fingerprint: String, val at: Long)

  private val last = HashMap<String, Last>()

  fun shouldEmit(id: String, fingerprint: String, now: Long): Boolean {
    val previous = last[id]
    if (previous != null && previous.fingerprint == fingerprint && now - previous.at < repeatMs) return false
    last[id] = Last(fingerprint, now)
    return true
  }

  fun clear() = last.clear()
}
