package com.joyodigitama.huaweiwear

/**
 * The experimental HW_PGNSS_PRED path (docs/agps.md, "Lab path for HW_PGNSS_PRED"): Huawei-layout predicted ephemeris built by JoyoFit's server
 * from public data, three days of two-hour slots in six files, sent only when the user turned its own switch on (off by default,
 * [AgpsStore.labPgnss]) and the watch asked for that kind. The watch does not check the data; wrong data has wedged GPS on other watches.
 */
internal object AgpsPgnss {
  /** The kind (last tag segment) the Fit 4 Pro names: `com.huawei.higeo_dataModule_PGNSSConfig?type=HW_EEV2/HW_PGNSS_PRED;`. */
  const val KIND = "HW_PGNSS_PRED"

  /** [AgpsFetch.source] and the stored delivery source of this data. */
  const val SOURCE = "joyofit_pgnss"

  /** Huawei Health's seven-day ("SEVEN") variant is gzipped and 84 slots long; the server builds the three-day one only. */
  private const val SEVEN = "SEVEN"

  /** One tag entry (already split at `;`) names this kind: its last `/` segment is exactly [KIND] and it is not the seven-day variant. */
  fun isPredEntry(entry: String): Boolean = entry.substringAfterLast('/') == KIND && !entry.contains(SEVEN)

  /** The stored last ask (version, tag names only) was for exactly this kind. */
  fun askedPred(version: Int, tagNames: String): Boolean = version in 1..3 && tagNames == KIND
}

/** One file of the bundle: its name, exact size, and for the five ephemeris files the block layout of `~/re/agps/FORMAT.md` sections 2 and 3. */
internal class PgnssFileSpec(
  val name: String,
  /** Bytes per header entry (GLONASS: 8 sub-blocks of 1252); 0 for `HW_PGNSS_EXTRA`, which has no header. */
  val blockBytes: Int,
  /** Bytes per record group that starts with its own count byte (GLONASS: one 1252-byte sub-block per 900 s epoch). */
  val subBlockBytes: Int,
  /** Most records one (sub-)block may list. */
  val capacity: Int,
  /** The exact file size: the header plus 36 blocks, or 6 248 bytes for `HW_PGNSS_EXTRA`. */
  val size: Int,
  /** Seconds the slot times sit after the GPS ones (BeiDou: 14, FORMAT.md 2.3); taken off before the first-slot window check. */
  val slotOffsetS: Long = 0L,
)

/**
 * The bundle `GET /v1/agps/hw-pgnss` answers (contract shared with `server/src/agps.ts`): ASCII `JFPG`, u8 version 1, u8 file count 6, then per
 * file in the watch's pull order u8 name length, ASCII name, u32 little-endian size, bytes. Nothing follows the last file. The server checks the
 * same rules before serving (`validatePgnssBundle` in the shared package); the phone checks them again before anything reaches the watch.
 */
internal object PgnssBundle {
  private val MAGIC = byteArrayOf('J'.code.toByte(), 'F'.code.toByte(), 'P'.code.toByte(), 'G'.code.toByte())
  const val VERSION = 1

  /** 84 header entries of {u32 GPS-second slot time, u32 offset, u32 size}; three-day mode fills the first [SLOTS]. */
  const val HEADER_BYTES = 1008
  const val HEADER_ENTRIES = 84
  const val SLOTS = 36
  const val SLOT_SECONDS = 7200L

  /** The first slot lies within this many seconds of the build time (HH: the next two-hour boundary after "now"). */
  const val FIRST_SLOT_WINDOW_S = 7200L

  /** GPS time is unix time minus 1980-01-06 plus the 18 leap seconds Huawei Health hard-codes (`unixSeconds - 315964782`). */
  private const val GPS_EPOCH_UNIX_S = 315_964_800L
  private const val LEAP_SECONDS = 18L

  private fun eph(name: String, block: Int, sub: Int, capacity: Int, slotOffsetS: Long = 0L) =
    PgnssFileSpec(name, block, sub, capacity, HEADER_BYTES + SLOTS * block, slotOffsetS)

  /** The six files in the order the Fit 4 Pro pulled them from Huawei Health on 2026-10-25 (FORMAT.md section 8), with their exact sizes. */
  val FILES: List<PgnssFileSpec> = listOf(
    eph("HW_PGNSS_GPS", 2564, 2564, 32),
    eph("HW_PGNSS_BDS", 5800, 5800, 63, slotOffsetS = 14L),
    eph("HW_PGNSS_GLONASS", 8 * 1252, 1252, 24),
    eph("HW_PGNSS_GALILEO", 2740, 2740, 36),
    eph("HW_PGNSS_QZS", 764, 764, 10),
    PgnssFileSpec("HW_PGNSS_EXTRA", 0, 0, 0, 6248),
  )

  /** The exact size of a valid bundle (799 230 bytes); also the download cap. */
  val BUNDLE_BYTES: Int = MAGIC.size + 2 + FILES.sumOf { 1 + it.name.length + 4 + it.size }

  /** A bundle the server built longer ago than this (its Last-Modified) is not offered; the phone copy is reused up to the same age. */
  const val MAX_AGE_MS = 6L * 60 * 60 * 1000

  /** The files hold 36 two-hour slots from the build time: three days. */
  const val VALID_MS = 3L * 24 * 60 * 60 * 1000

  /** Unix milliseconds as GPS seconds, the way Huawei Health counts them. */
  fun gpsSeconds(unixMs: Long): Long = unixMs / 1000 - GPS_EPOCH_UNIX_S + LEAP_SECONDS

  private fun u32(data: ByteArray, at: Int): Long =
    (data[at].toLong() and 0xFF) or ((data[at + 1].toLong() and 0xFF) shl 8) or ((data[at + 2].toLong() and 0xFF) shl 16) or
      ((data[at + 3].toLong() and 0xFF) shl 24)

  /**
   * Why [data] is not a bundle the watch may be sent, or null when it is: magic, version, count; every file present in pull order with its
   * exact name and size and nothing after the last; each ephemeris header with 36 entries at the packed block offsets and sizes, slot times 7200 s
   * apart and the first within two hours of the build time [builtMs], the other 48 entries zero; every (sub-)block count within its capacity; and
   * the server's build time known and at most [MAX_AGE_MS] before [nowMs].
   */
  fun validate(data: ByteArray, builtMs: Long, nowMs: Long): String? {
    if (data.size < MAGIC.size + 2 || !data.copyOfRange(0, MAGIC.size).contentEquals(MAGIC)) return "not a PGNSS bundle (unexpected header)"
    val version = data[4].toInt() and 0xFF
    if (version != VERSION) return "bundle version $version is not known"
    val count = data[5].toInt() and 0xFF
    if (count != FILES.size) return "the bundle has $count files (${FILES.size} expected)"
    var at = MAGIC.size + 2
    val starts = IntArray(FILES.size)
    for ((index, spec) in FILES.withIndex()) {
      if (at >= data.size) return "the bundle is cut off before ${spec.name}"
      val nameLength = data[at].toInt() and 0xFF
      if (at + 1 + nameLength > data.size) return "the bundle is cut off before ${spec.name}"
      val name = String(data, at + 1, nameLength, Charsets.US_ASCII)
      if (name != spec.name) return "file ${index + 1} is \"${name.take(32)}\" (${spec.name} expected)"
      at += 1 + nameLength
      if (at + 4 > data.size) return "the bundle is cut off in ${spec.name}"
      val size = u32(data, at)
      if (size != spec.size.toLong()) return "${spec.name} is $size bytes (${spec.size} expected)"
      at += 4
      if (at + spec.size > data.size) return "the bundle is cut off in ${spec.name}"
      starts[index] = at
      at += spec.size
    }
    if (at != data.size) return "${data.size - at} bytes after the last file"
    for ((index, spec) in FILES.withIndex()) {
      if (spec.blockBytes == 0) continue
      checkHeader(data, starts[index], spec)?.let { return it }
    }
    if (builtMs <= 0L) return "the server did not say when the bundle was built"
    if (nowMs - builtMs > MAX_AGE_MS) return "the bundle was built ${(nowMs - builtMs) / 60_000} minutes ago"
    val built = gpsSeconds(builtMs)
    for ((index, spec) in FILES.withIndex()) {
      if (spec.blockBytes == 0) continue
      val first = u32(data, starts[index]) - spec.slotOffsetS
      if (first < built - FIRST_SLOT_WINDOW_S || first > built + FIRST_SLOT_WINDOW_S) {
        return "${spec.name} starts ${first - built} s from the build time (at most $FIRST_SLOT_WINDOW_S)"
      }
    }
    return null
  }

  /** The header and block counts of one ephemeris file starting at [start]. */
  private fun checkHeader(data: ByteArray, start: Int, spec: PgnssFileSpec): String? {
    val first = u32(data, start)
    for (i in 0 until HEADER_ENTRIES) {
      val entry = start + 12 * i
      val time = u32(data, entry)
      val offset = u32(data, entry + 4)
      val size = u32(data, entry + 8)
      if (i >= SLOTS) {
        if (time != 0L || offset != 0L || size != 0L) return "${spec.name} header entry $i is not empty"
        continue
      }
      val wantOffset = HEADER_BYTES.toLong() + i.toLong() * spec.blockBytes
      if (offset != wantOffset) return "${spec.name} header entry $i points at $offset ($wantOffset expected)"
      if (size != spec.blockBytes.toLong()) return "${spec.name} header entry $i has size $size (${spec.blockBytes} expected)"
      if (time != first + i * SLOT_SECONDS) return "${spec.name} slot $i is not ${SLOT_SECONDS} s after the one before"
    }
    var block = start + HEADER_BYTES
    val end = start + spec.size
    var index = 0
    while (block < end) {
      val listed = data[block].toInt() and 0xFF
      if (listed > spec.capacity) return "${spec.name} block $index lists $listed satellites (at most ${spec.capacity})"
      block += spec.subBlockBytes
      index++
    }
    return null
  }

  /** The six files of a bundle that passed [validate], by name in pull order. */
  fun files(data: ByteArray): LinkedHashMap<String, ByteArray> {
    val out = LinkedHashMap<String, ByteArray>()
    var at = MAGIC.size + 2
    for (spec in FILES) {
      at += 1 + spec.name.length + 4
      out[spec.name] = data.copyOfRange(at, at + spec.size)
      at += spec.size
    }
    return out
  }
}
