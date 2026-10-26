package com.joyodigitama.huaweiwear

import java.nio.ByteBuffer
import java.nio.ByteOrder
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV

/** One map entry of a watch list (`03`, item `88`) or of a delete (`05`, item `91`). */
internal data class MapkitMap(
  val id: ULong,
  val type: Int,
  /** List: tag `0B` (the map version). Null when absent. */
  val version: Long? = null,
  /** List: tag `16` (0 user, 1 asked by the watch). Null when absent. */
  val downloadType: Int? = null,
  /** Delete answer: tag `12` (0 = deleted). Null when absent. */
  val result: Int? = null,
)

/** A frame of the mapkit P2P module, decoded. The raw frame is always logged too ([MapkitWire.describe]). */
internal sealed class MapkitMessage {
  abstract val type: Int

  /** `01`: tag `01`, the watch's free space (huac reads KiB, Huawei Health compares it with sizes in MB; unverified). */
  data class FreeSpace(val value: Long?) : MapkitMessage() {
    override val type = MapkitWire.TYPE_FREE_SPACE
  }

  /** `02` answer to the political view: `"0"` ok, `"1"` failed. */
  data class PoliticalView(val result: String?, val msgId: Long?) : MapkitMessage() {
    override val type = MapkitWire.TYPE_POLITICAL_VIEW
  }

  /** `03` one frame of the watch's map list. */
  data class MapList(val frames: Int?, val index: Int?, val total: Int?, val msgId: Long?, val maps: List<MapkitMap>) : MapkitMessage() {
    override val type = MapkitWire.TYPE_MAP_LIST
  }

  /** `04` answer to the transfer handshake: `0C` 0 go on, 1 no space, 2 no update, 3 map in use, 4 device error. */
  data class Handshake(val code: Int?, val msgId: Long?) : MapkitMessage() {
    override val type = MapkitWire.TYPE_HANDSHAKE
  }

  /** `05` one frame of the watch's delete answer; each map carries its result in tag `12`. */
  data class Delete(val frames: Int?, val index: Int?, val total: Int?, val msgId: Long?, val maps: List<MapkitMap>) : MapkitMessage() {
    override val type = MapkitWire.TYPE_DELETE
  }

  /** `08` the watch parsed a received file: `09` map id, `0A` map type, `15` code (0 = ok). */
  data class Parsed(val mapId: ULong?, val mapType: Int?, val code: Int?) : MapkitMessage() {
    override val type = MapkitWire.TYPE_PARSED
  }

  /** `07` the watch asks for the political view again, `09` the size of the map around its position, `0B` a download for its position. */
  data class WatchAsk(override val type: Int) : MapkitMessage()

  /** Any other type. */
  data class Other(override val type: Int) : MapkitMessage()
}

/** What the `offvmp` header of a map file says (HDataResearch `offvmp/src/data_offvmp.h`, Gadgetbridge `HuaweiFwHelper.parseAsOfflineMap`). */
internal data class OffvmpHeader(val version: Long, val indexOffset: Long, val region: String, val zooms: List<Int>)

/** A map file as JoyoFit sends it: the id and type come from the file name only (the watch reads them from `<id>.bin`). */
internal data class OfflineMapFile(val fileName: String, val mapId: ULong, val mapType: Int)

/**
 * Frames of the P2P module `hw.unitedevice.mapkit` (phone) <-> `in.huawei.mapkit` (watch), Huawei's offline-map transfer. Every
 * message is one type byte followed by Huawei TLV (tag byte, 7-bit varint length, big-endian values). Layouts: `docs/offline-maps.md`,
 * `protocol/README.md` "Offline maps (mapkit P2P)"; from Huawei Health's map SDK (`service/device/d.java:379-566`), Gadgetbridge's
 * `HuaweiP2PMapkitService` and huac's `P2PMapkitService`. Twin: `MapkitWire.swift`; both are tested against `Fixtures/mapkit.json`.
 * EXPERIMENTAL: lab switch only.
 */
internal object MapkitWire {
  const val MODULE = "hw.unitedevice.mapkit"
  const val PACKAGE = "in.huawei.mapkit"
  const val FINGERPRINT = "SystemApp"

  const val TYPE_FREE_SPACE = 0x01
  const val TYPE_POLITICAL_VIEW = 0x02
  const val TYPE_MAP_LIST = 0x03
  const val TYPE_HANDSHAKE = 0x04
  const val TYPE_DELETE = 0x05
  const val TYPE_PING = 0x06
  const val TYPE_ASK_POLITICAL_VIEW = 0x07
  const val TYPE_PARSED = 0x08
  const val TYPE_ASK_SIZE = 0x09
  const val TYPE_SIZE_ANSWER = 0x0A
  const val TYPE_ASK_DOWNLOAD = 0x0B

  const val MAP_TYPE_REGION = 0
  const val MAP_TYPE_CONTOUR = 1
  const val MAP_TYPE_GLOBAL = 2

  /** Handshake answer `0C` = 5: the phone has no network (huac and Huawei Health answer the watch's `09` / `0B` with it). */
  const val CODE_NO_NETWORK = 5

  /** The political view JoyoFit sends: its maps have one variant, built for Indonesia (Huawei Health: from Huawei's server, fallback `CN`). */
  const val POLITICAL_VIEW = "ID"

  /** Items per delete frame (Gadgetbridge `MAX_ITEM_PER_FRAME_DEL`). */
  const val MAX_DELETE_ITEMS = 40

  const val HEADER_SIZE = 0x440
  private val MAGIC = "offvmp".toByteArray(Charsets.US_ASCII)
  private const val REGION_OFFSET = 0x3F
  private const val REGION_MAX = 511

  private val CONTAINERS = setOf(0x87, 0x88, 0x90, 0x91)

  private fun frame(type: Int, tlv: HuaweiTLV): ByteArray = byteArrayOf(type.toByte()) + tlv.serialize()

  /** Gadgetbridge `IntToBytes` / huac `addVarBytes`: big-endian without leading zero bytes, one byte for 0..255. */
  fun minimal(value: Long): ByteArray {
    require(value >= 0) { "negative value" }
    if (value < 256) return byteArrayOf(value.toByte())
    var n = 0
    var v = value
    while (v > 0) {
      v = v ushr 8
      n++
    }
    return ByteArray(n) { ((value ushr (8 * (n - 1 - it))) and 0xFF).toByte() }
  }

  private fun u16(value: Int) = byteArrayOf((value ushr 8).toByte(), value.toByte())

  private fun u32(value: Long) = ByteBuffer.allocate(4).putInt(value.toInt()).array()

  private fun u64(value: ULong) = ByteBuffer.allocate(8).putLong(value.toLong()).array()

  /** `01` free space query: `01` = 0. */
  fun freeSpaceQuery(): ByteArray = frame(TYPE_FREE_SPACE, HuaweiTLV().put(0x01, byteArrayOf(0)))

  /** `02` political view (sent on every connect): `02` view (ASCII), `14` review number (empty, as Gadgetbridge and huac), `13` msgId. */
  fun politicalView(view: String, msgId: Int): ByteArray =
    frame(TYPE_POLITICAL_VIEW, HuaweiTLV().put(0x02, view.toByteArray(Charsets.US_ASCII)).put(0x14).put(0x13, minimal(msgId.toLong())))

  /** `03` the maps on the watch: `13` msgId. */
  fun listQuery(msgId: Int): ByteArray = frame(TYPE_MAP_LIST, HuaweiTLV().put(0x13, minimal(msgId.toLong())))

  /**
   * `04` transfer handshake (Huawei Health `d.java:480-505`): `02` political view, `14` review number, `0D` size in MB (u16), `0A` map type,
   * `0E` 0 new / 1 update, `13` msgId (u32), `16` download type 0 (the user asked).
   */
  fun handshake(sizeMb: Int, mapType: Int, update: Boolean, msgId: Int, view: String = POLITICAL_VIEW): ByteArray {
    require(sizeMb in 0..0xFFFF) { "size $sizeMb MB out of u16" }
    val tlv = HuaweiTLV()
      .put(0x02, view.toByteArray(Charsets.US_ASCII))
      .put(0x14)
      .put(0x0D, u16(sizeMb))
      .put(0x0A, byteArrayOf(mapType.toByte()))
      .put(0x0E, byteArrayOf(if (update) 1 else 0))
      .put(0x13, u32(msgId.toLong()))
      .put(0x16, byteArrayOf(0))
    return frame(TYPE_HANDSHAKE, tlv)
  }

  /** `05` delete, one frame: `04` frames, `05` frame index (from 0), `06` total count (u32), `13` msgId (u32), `90{91{09 id, 0A type, 0B 4}}`. */
  fun delete(maps: List<Pair<ULong, Int>>, msgId: Int, frames: Int = 1, index: Int = 0, total: Int = maps.size): ByteArray {
    require(maps.isNotEmpty() && maps.size <= MAX_DELETE_ITEMS) { "1 to $MAX_DELETE_ITEMS maps per delete frame" }
    val list = HuaweiTLV()
    for ((id, type) in maps) {
      list.put(0x91, HuaweiTLV().put(0x09, u64(id)).put(0x0A, byteArrayOf(type.toByte())).put(0x0B, byteArrayOf(4)))
    }
    val tlv = HuaweiTLV()
      .put(0x04, byteArrayOf(frames.toByte()))
      .put(0x05, byteArrayOf(index.toByte()))
      .put(0x06, u32(total.toLong()))
      .put(0x13, u32(msgId.toLong()))
      .put(0x90, list)
    return frame(TYPE_DELETE, tlv)
  }

  /** `0A` the answer to the watch's `09`: `0D` size in MB; 0 = JoyoFit has no map for that position (huac). */
  fun sizeAnswer(sizeMb: Int): ByteArray = frame(TYPE_SIZE_ANSWER, HuaweiTLV().put(0x0D, minimal(sizeMb.toLong())))

  /** `04` "no network" answer to the watch's `0B` (Huawei Health `receivers/d.java:134`, huac): `13` msgId, `0C` 5, `16` 1. */
  fun noNetwork(msgId: Int): ByteArray =
    frame(TYPE_HANDSHAKE, HuaweiTLV().put(0x13, u32(msgId.toLong())).put(0x0C, byteArrayOf(CODE_NO_NETWORK.toByte())).put(0x16, byteArrayOf(1)))

  /** Big-endian unsigned value of any length up to 8 bytes; null for an empty or longer value. */
  fun unsigned(value: ByteArray?): ULong? {
    if (value == null || value.isEmpty() || value.size > 8) return null
    var v = 0UL
    for (b in value) v = (v shl 8) or (b.toULong() and 0xFFUL)
    return v
  }

  private fun HuaweiTLV.value(tag: Int): ByteArray? = get().firstOrNull { (it.tag.toInt() and 0xFF) == tag }?.value

  private fun HuaweiTLV.uint(tag: Int): Long? = unsigned(value(tag))?.toLong()

  private fun HuaweiTLV.int(tag: Int): Int? = uint(tag)?.toInt()

  private fun HuaweiTLV.text(tag: Int): String? = value(tag)?.toString(Charsets.UTF_8)

  private fun tlvOf(bytes: ByteArray, offset: Int = 0, length: Int = bytes.size - offset): HuaweiTLV? =
    try {
      HuaweiTLV().parse(bytes, offset, length)
    } catch (e: RuntimeException) {
      null
    }

  private fun items(tlv: HuaweiTLV, container: Int, item: Int): List<MapkitMap> {
    val list = tlv.value(container)?.let { tlvOf(it) } ?: return emptyList()
    return list.get().filter { (it.tag.toInt() and 0xFF) == item }.mapNotNull { entry ->
      val sub = tlvOf(entry.value) ?: return@mapNotNull null
      val id = unsigned(sub.value(0x09)) ?: return@mapNotNull null
      MapkitMap(id, sub.int(0x0A) ?: -1, version = sub.uint(0x0B), downloadType = sub.int(0x16), result = sub.int(0x12))
    }
  }

  /** The frame decoded; null for an empty frame or a malformed TLV. */
  fun parse(frame: ByteArray): MapkitMessage? {
    if (frame.isEmpty()) return null
    val type = frame[0].toInt() and 0xFF
    val tlv = tlvOf(frame, 1) ?: return null
    return when (type) {
      TYPE_FREE_SPACE -> MapkitMessage.FreeSpace(tlv.uint(0x01))
      TYPE_POLITICAL_VIEW -> MapkitMessage.PoliticalView(tlv.text(0x02), tlv.uint(0x13))
      TYPE_MAP_LIST -> MapkitMessage.MapList(tlv.int(0x04), tlv.int(0x05), tlv.int(0x06), tlv.uint(0x13), items(tlv, 0x87, 0x88))
      TYPE_HANDSHAKE -> MapkitMessage.Handshake(tlv.int(0x0C), tlv.uint(0x13))
      TYPE_DELETE -> MapkitMessage.Delete(tlv.int(0x04), tlv.int(0x05), tlv.int(0x06), tlv.uint(0x13), items(tlv, 0x90, 0x91))
      TYPE_PARSED -> MapkitMessage.Parsed(unsigned(tlv.value(0x09)), tlv.int(0x0A), tlv.int(0x15))
      TYPE_ASK_POLITICAL_VIEW, TYPE_ASK_SIZE, TYPE_ASK_DOWNLOAD -> MapkitMessage.WatchAsk(type)
      else -> MapkitMessage.Other(type)
    }
  }

  fun typeName(type: Int): String = when (type) {
    TYPE_FREE_SPACE -> "free space"
    TYPE_POLITICAL_VIEW -> "political view"
    TYPE_MAP_LIST -> "map list"
    TYPE_HANDSHAKE -> "transfer handshake"
    TYPE_DELETE -> "delete"
    TYPE_PING -> "ping"
    TYPE_ASK_POLITICAL_VIEW -> "political view request"
    TYPE_PARSED -> "parse result"
    TYPE_ASK_SIZE -> "size for my position"
    TYPE_SIZE_ANSWER -> "size answer"
    TYPE_ASK_DOWNLOAD -> "download for me"
    else -> "unknown"
  }

  private fun describeTlv(tlv: HuaweiTLV): String {
    val entries = tlv.get()
    if (entries.isEmpty()) return "(empty)"
    return entries.joinToString(" ") { entry ->
      val tag = entry.tag.toInt() and 0xFF
      val name = "%02X".format(tag)
      val value = entry.value
      val nested = if (tag in CONTAINERS) tlvOf(value) else null
      when {
        nested != null -> "$name{${describeTlv(nested)}}"
        value.isEmpty() -> "$name=()"
        value.size > 1 && value.all { it in 0x20..0x7E } -> "$name=\"${String(value, Charsets.US_ASCII)}\""
        else -> "$name=${value.toHex()}"
      }
    }
  }

  /** One log line for a frame: type byte and name, then every tag (containers `87 88 90 91` expanded). */
  fun describe(frame: ByteArray): String {
    if (frame.isEmpty()) return "(empty frame)"
    val type = frame[0].toInt() and 0xFF
    val tlv = tlvOf(frame, 1)
    val body = tlv?.let { describeTlv(it) } ?: "malformed TLV ${frame.toHex()}"
    return "%02X %s: %s".format(type, typeName(type), body)
  }

  /** The size the handshake announces: whole MB, rounded up, at least 1 (Huawei Health sends the server's `originalSize` in MB). */
  fun sizeMb(bytes: Long): Int = ((bytes + MB - 1) / MB).coerceIn(1, 0xFFFF).toInt()

  /** How long Huawei Health's map page waits for the watch's parse result (`Math.ceil(originalSize / 0.2) + 30` s). */
  fun parseBudgetMs(sizeMb: Int): Long = (sizeMb * 5L + 30L) * 1000L

  private const val MB = 1024L * 1024L

  /** `<id>.bin`, `<id>_contour.bin` or `global.bin` (the id is only in the name; Gadgetbridge and huac read it the same way); null otherwise. */
  fun fileOf(name: String): OfflineMapFile? {
    val base = name.substringAfterLast('/')
    if (!base.endsWith(".bin")) return null
    val stem = base.removeSuffix(".bin")
    if (stem == "global") return OfflineMapFile(base, 0UL, MAP_TYPE_GLOBAL)
    val contour = stem.endsWith("_contour")
    val digits = if (contour) stem.removeSuffix("_contour") else stem
    if (digits.isEmpty() || digits.length > 20 || !digits.all { it in '0'..'9' }) return null
    val id = digits.toULongOrNull() ?: return null
    return OfflineMapFile(base, id, if (contour) MAP_TYPE_CONTOUR else MAP_TYPE_REGION)
  }

  /** The `offvmp` header: magic at 0, `u32 LE` version at 6, `u32 LE` index offset at 10, region name (UTF-8, NUL-ended) at 0x3F, zoom bitmap at the index. */
  fun header(bytes: ByteArray): OffvmpHeader? {
    if (bytes.size < HEADER_SIZE) return null
    for (i in MAGIC.indices) if (bytes[i] != MAGIC[i]) return null
    val le = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
    val version = le.getInt(6).toLong() and 0xFFFFFFFFL
    val indexOffset = le.getInt(10).toLong() and 0xFFFFFFFFL
    var end = REGION_OFFSET
    while (end < REGION_OFFSET + REGION_MAX && bytes[end] != 0.toByte()) end++
    val region = String(bytes, REGION_OFFSET, end - REGION_OFFSET, Charsets.UTF_8)
    val zooms = if (indexOffset in HEADER_SIZE.toLong()..(bytes.size - 4).toLong()) {
      val flags = le.getInt(indexOffset.toInt())
      (0 until 32).filter { flags and (1 shl it) != 0 }
    } else {
      emptyList()
    }
    return OffvmpHeader(version, indexOffset, region, zooms)
  }
}
