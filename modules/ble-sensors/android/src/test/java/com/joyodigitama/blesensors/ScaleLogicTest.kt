package com.joyodigitama.blesensors

import java.util.UUID
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ScaleLogicTest {
  @Test
  fun normalizeShortensBaseUuidsOnly() {
    assertEquals("ffe0", ScaleLogic.normalize(UUID.fromString("0000ffe0-0000-1000-8000-00805f9b34fb")))
    assertEquals("181d", ScaleLogic.normalize(UUID.fromString("0000181D-0000-1000-8000-00805F9B34FB")))
    assertEquals(
      "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
      ScaleLogic.normalize(UUID.fromString("6E400001-B5A3-F393-E0A9-E50E24DCCA9E")),
    )
    // Same bytes as a base UUID except the last digit: not a Bluetooth SIG UUID.
    assertEquals("0000fe86-0000-1000-8000-00805f9b34fc", ScaleLogic.normalize(UUID.fromString("0000fe86-0000-1000-8000-00805f9b34fc")))
  }

  @Test
  fun parseIsTheInverseOfNormalize() {
    assertEquals(UUID.fromString("0000ffe1-0000-1000-8000-00805f9b34fb"), ScaleLogic.parse("FFE1"))
    assertEquals(UUID.fromString("0000ffe1-0000-1000-8000-00805f9b34fb"), ScaleLogic.parse("0000ffe1"))
    val vendor = UUID.fromString("6e400001-b5a3-f393-e0a9-e50e24dcca9e")
    assertEquals(vendor, ScaleLogic.parse(vendor.toString()))
    assertEquals(vendor, ScaleLogic.parse(ScaleLogic.normalize(vendor)))
  }

  @Test(expected = IllegalArgumentException::class)
  fun parseRejectsGarbage() {
    ScaleLogic.parse("not a uuid")
  }

  @Test
  fun companyKeyIsFourLowercaseHexDigitsOfTheValue() {
    assertEquals("20ca", ScaleLogic.companyKey(0x20CA))
    assertEquals("ffff", ScaleLogic.companyKey(0xFFFF))
    assertEquals("0001", ScaleLogic.companyKey(1))
    assertEquals("004c", ScaleLogic.companyKey(0x004C))
  }

  @Test
  fun propertyNamesFollowTheTypeScriptContract() {
    assertEquals(listOf("read", "notify"), ScaleLogic.propertyNames(0x02 or 0x10))
    assertEquals(listOf("write", "writeNoResponse", "indicate"), ScaleLogic.propertyNames(0x08 or 0x04 or 0x20))
    assertEquals(emptyList<String>(), ScaleLogic.propertyNames(0))
  }

  @Test
  fun fromHexDecodesAndRejects() {
    assertArrayEquals(byteArrayOf(0x13, 0x09, 0xFF.toByte()), ScaleLogic.fromHex("1309ff"))
    assertArrayEquals(byteArrayOf(0xAB.toByte()), ScaleLogic.fromHex("AB"))
    assertArrayEquals(ByteArray(0), ScaleLogic.fromHex(""))
    assertNull(ScaleLogic.fromHex("abc"))
    assertNull(ScaleLogic.fromHex("zz"))
  }

  @Test
  fun throttlePassesChangedPayloadsAndRateLimitsRepeats() {
    val throttle = AdvertisementThrottle(2_000)
    assertTrue(throttle.shouldEmit("A", "aa", 0))
    assertFalse(throttle.shouldEmit("A", "aa", 500))
    assertTrue("a changed payload (a new reading) passes at once", throttle.shouldEmit("A", "ab", 600))
    assertFalse(throttle.shouldEmit("A", "ab", 2_500))
    assertTrue("an unchanged payload passes again after the repeat window", throttle.shouldEmit("A", "ab", 2_600))
    assertTrue("devices are independent", throttle.shouldEmit("B", "aa", 700))
    throttle.clear()
    assertTrue(throttle.shouldEmit("A", "ab", 2_700))
  }
}
