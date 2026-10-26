package com.joyodigitama.huaweiwear

import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The mapkit P2P frames against `Fixtures/mapkit.json`, built by hand from the documented layouts (docs/offline-maps.md); the Swift twin
 * (`MapkitWireTests.swift`) reads the same file, so both ports send and read the same bytes and log the same lines.
 */
class MapkitWireTest {
  private val fixture: JSONObject by lazy {
    // Gradle runs unit tests with the Android project (modules/huawei-wear/android) as the working directory.
    JSONObject(File("../ios/HuaweiProtocol/Tests/HuaweiProtocolTests/Fixtures/mapkit.json").readText())
  }

  private fun JSONObject.optIntOrNull(key: String): Int? = if (isNull(key)) null else getInt(key)

  private fun JSONObject.optLongOrNull(key: String): Long? = if (!has(key) || isNull(key)) null else getLong(key)

  private fun objects(array: JSONArray): List<JSONObject> = List(array.length()) { array.getJSONObject(it) }

  @Test
  fun buildersMatchTheDocumentedLayouts() {
    val cases = objects(fixture.getJSONArray("builders"))
    assertEquals(10, cases.size)
    for (case in cases) {
      val actual = when (case.getString("name")) {
        "freeSpaceQuery" -> MapkitWire.freeSpaceQuery()
        "politicalView" -> MapkitWire.politicalView(case.getString("view"), case.getInt("msgId"))
        "listQuery" -> MapkitWire.listQuery(case.getInt("msgId"))
        "handshake" -> MapkitWire.handshake(case.getInt("sizeMb"), case.getInt("mapType"), case.getBoolean("update"), case.getInt("msgId"))
        "delete" -> {
          val maps = case.getJSONArray("maps")
          MapkitWire.delete(List(maps.length()) { maps.getJSONArray(it).getString(0).toULong() to maps.getJSONArray(it).getInt(1) }, case.getInt("msgId"))
        }
        "sizeAnswer" -> MapkitWire.sizeAnswer(case.getInt("sizeMb"))
        "noNetwork" -> MapkitWire.noNetwork(case.getInt("msgId"))
        else -> error("unknown builder ${case.getString("name")}")
      }
      assertEquals(case.toString(), case.getString("hex"), actual.toHex())
    }
  }

  private fun assertMaps(expected: JSONArray, actual: List<MapkitMap>) {
    assertEquals(expected.length(), actual.size)
    for ((i, map) in actual.withIndex()) {
      val e = expected.getJSONObject(i)
      assertEquals(e.getString("id"), map.id.toString())
      assertEquals(e.getInt("type"), map.type)
      if (e.has("version")) assertEquals(e.optLongOrNull("version"), map.version)
      if (e.has("downloadType")) assertEquals(e.optIntOrNull("downloadType"), map.downloadType)
      if (e.has("result")) assertEquals(e.optIntOrNull("result"), map.result)
    }
  }

  @Test
  fun watchFramesParse() {
    for (case in objects(fixture.getJSONArray("parses"))) {
      val message = MapkitWire.parse(case.getString("hex").hexToBytes())
      if (case.isNull("expect")) {
        assertNull(case.toString(), message)
        continue
      }
      val e = case.getJSONObject("expect")
      when (e.getString("kind")) {
        "freeSpace" -> assertEquals(MapkitMessage.FreeSpace(e.getLong("value")), message)
        "politicalView" -> assertEquals(MapkitMessage.PoliticalView(e.getString("result"), e.getLong("msgId")), message)
        "handshake" -> assertEquals(MapkitMessage.Handshake(e.getInt("code"), e.getLong("msgId")), message)
        "parsed" -> assertEquals(MapkitMessage.Parsed(e.getString("mapId").toULong(), e.getInt("mapType"), e.getInt("code")), message)
        "watchAsk" -> assertEquals(MapkitMessage.WatchAsk(e.getInt("type")), message)
        "other" -> assertEquals(MapkitMessage.Other(e.getInt("type")), message)
        "mapList" -> {
          val list = message as MapkitMessage.MapList
          assertEquals(e.getInt("frames"), list.frames)
          assertEquals(e.getInt("index"), list.index)
          assertEquals(e.getInt("total"), list.total)
          assertEquals(e.getLong("msgId"), list.msgId)
          assertMaps(e.getJSONArray("maps"), list.maps)
        }
        "delete" -> {
          val delete = message as MapkitMessage.Delete
          assertEquals(e.getInt("frames"), delete.frames)
          assertEquals(e.getInt("total"), delete.total)
          assertEquals(e.getLong("msgId"), delete.msgId)
          assertMaps(e.getJSONArray("maps"), delete.maps)
        }
        else -> error("unknown kind ${e.getString("kind")}")
      }
    }
  }

  @Test
  fun everyFrameHasTheSameLogLineOnBothPlatforms() {
    for (case in objects(fixture.getJSONArray("describes"))) {
      assertEquals(case.getString("text"), MapkitWire.describe(case.getString("hex").hexToBytes()))
    }
  }

  @Test
  fun theMapIdAndTypeComeFromTheFileName() {
    for (case in objects(fixture.getJSONArray("files"))) {
      val file = MapkitWire.fileOf(case.getString("name"))
      if (case.isNull("mapId")) {
        assertNull(case.toString(), file)
      } else {
        assertNotNull(case.toString(), file)
        assertEquals(case.getString("mapId"), file!!.mapId.toString())
        assertEquals(case.getInt("mapType"), file.mapType)
      }
    }
  }

  @Test
  fun theHandshakeSizeIsWholeMegabytesRoundedUp() {
    val sizes = fixture.getJSONArray("sizeMb")
    for (i in 0 until sizes.length()) {
      val pair = sizes.getJSONArray(i)
      assertEquals(pair.getInt(1), MapkitWire.sizeMb(pair.getLong(0)))
    }
    assertEquals(50_000L, MapkitWire.parseBudgetMs(4))
  }

  @Test
  fun theOffvmpHeaderIsRead() {
    val h = fixture.getJSONObject("header")
    val header = MapkitWire.header(h.getString("hex").hexToBytes())
    assertNotNull(header)
    assertEquals(h.getLong("version"), header!!.version)
    assertEquals(h.getLong("indexOffset"), header.indexOffset)
    assertEquals(h.getString("region"), header.region)
    val zooms = h.getJSONArray("zooms")
    assertEquals(List(zooms.length()) { zooms.getInt(it) }, header.zooms)
    assertNull(MapkitWire.header(fixture.getString("badHeaderHex").hexToBytes()))
    assertNull(MapkitWire.header(ByteArray(16)))
  }

  @Test
  fun aDeleteFrameTakesOneToFortyMaps() {
    assertTrue(runCatching { MapkitWire.delete(emptyList(), 1) }.isFailure)
    assertTrue(runCatching { MapkitWire.delete(List(41) { it.toULong() to 0 }, 1) }.isFailure)
  }
}
