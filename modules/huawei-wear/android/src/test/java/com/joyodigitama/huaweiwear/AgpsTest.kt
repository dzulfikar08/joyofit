package com.joyodigitama.huaweiwear

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.util.CheckSums
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The pure parts of the satellite-data job: schedule, validation, the bytes the phone sends, the store and the source rules. */
class AgpsTest {
  private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }

  private fun lto(size: Int = 115_749) = ByteArray(size) { (it * 31).toByte() }.also {
    it[0] = 0xFF.toByte()
    it[1] = 0xCA.toByte()
    it[2] = 0xDE.toByte()
  }

  // Policy

  @Test
  fun retryWaitsGrowThenStayAtSixHours() {
    val minute = 60_000L
    assertEquals(0L, AgpsPolicy.retryDelayMs(0))
    assertEquals(1 * minute, AgpsPolicy.retryDelayMs(1))
    assertEquals(5 * minute, AgpsPolicy.retryDelayMs(2))
    assertEquals(15 * minute, AgpsPolicy.retryDelayMs(3))
    assertEquals(60 * minute, AgpsPolicy.retryDelayMs(4))
    assertEquals(360 * minute, AgpsPolicy.retryDelayMs(5))
    assertEquals(360 * minute, AgpsPolicy.retryDelayMs(50))
    assertEquals(10_000L + 5 * minute, AgpsPolicy.retryAtMs(10_000L, 2))
    assertEquals(0L, AgpsPolicy.retryAtMs(10_000L, 0))
  }

  @Test
  fun prefetchIsDueWhenTheCopyIsMissingOrSixHoursOldAndNoRetryWaits() {
    val hour = 60 * 60_000L
    val now = 100 * hour
    assertTrue(AgpsPolicy.prefetchDue(0L, now, 0L))
    assertFalse(AgpsPolicy.prefetchDue(now - 5 * hour, now, 0L))
    assertTrue(AgpsPolicy.prefetchDue(now - 6 * hour, now, 0L))
    assertFalse("a retry wait blocks it", AgpsPolicy.prefetchDue(0L, now, now + 1))
    assertTrue(AgpsPolicy.prefetchDue(0L, now, now))
  }

  @Test
  fun deliveryIsDueAfterADay() {
    val hour = 60 * 60_000L
    val now = 1_000 * hour
    assertTrue(AgpsPolicy.deliveryDue(0L, now))
    assertFalse(AgpsPolicy.deliveryDue(now - 23 * hour, now))
    assertTrue(AgpsPolicy.deliveryDue(now - 24 * hour, now))
    assertEquals(now + 7 * 24 * hour, AgpsPolicy.expiresAtMs(now))
    assertEquals(0L, AgpsPolicy.expiresAtMs(0L))
  }

  @Test
  fun aGoodLtoFilePasses() {
    assertNull(AgpsPolicy.validateLto(lto()))
    assertNull(AgpsPolicy.validateLto(lto(AgpsPolicy.LTO_MIN_BYTES)))
    assertNull(AgpsPolicy.validateLto(lto(AgpsPolicy.LTO_MAX_BYTES)))
  }

  @Test
  fun ltoFilesOutsideTheBoundsOrWithAnotherHeaderAreRefused() {
    assertNotNull(AgpsPolicy.validateLto(lto(AgpsPolicy.LTO_MIN_BYTES - 1)))
    assertNotNull(AgpsPolicy.validateLto(lto(AgpsPolicy.LTO_MAX_BYTES + 1)))
    assertNotNull(AgpsPolicy.validateLto(lto().also { it[2] = 0 }))
    val page = "<html>".toByteArray() + ByteArray(40_000)
    assertTrue(AgpsPolicy.validateLto(page)!!.contains("header"))
    assertNotNull(AgpsPolicy.validateLto(ByteArray(0)))
  }

  @Test
  fun frameCountRoundsUpAndRefusesAbsurdTransfers() {
    assertEquals(1, AgpsPolicy.frameCount(1, 100))
    assertEquals(1, AgpsPolicy.frameCount(100, 100))
    assertEquals(2, AgpsPolicy.frameCount(101, 100))
    assertEquals(1158, AgpsPolicy.frameCount(115_749, 100))
    assertNull(AgpsPolicy.frameCount(0, 100))
    assertNull(AgpsPolicy.frameCount(100, 0))
    assertNull("one byte per frame of a megabyte", AgpsPolicy.frameCount(1024 * 1024, 1))
    assertEquals(AgpsPolicy.MAX_FRAMES, AgpsPolicy.frameCount(AgpsPolicy.MAX_FRAMES, 1))
  }

  // The bytes the phone sends

  @Test
  fun operatorAndRefusalAnswersCarryTheWireCodes() {
    assertEquals("7f04000186a0", hex(AgpsMessages.operatorAnswer(AgpsMessages.CODE_OK).serialize()))
    assertEquals("7f04000186a7", hex(AgpsMessages.operatorAnswer(AgpsMessages.CODE_NO_NETWORK).serialize()))
    assertEquals("7f04000186a1", hex(AgpsMessages.refused().serialize()))
    assertEquals("7f04000186a0", hex(AgpsMessages.accepted().serialize()))
  }

  @Test
  fun parameterConsultIsAnEmptyContainer() {
    assertEquals("8100", hex(AgpsMessages.parameterConsult().serialize()))
  }

  @Test
  fun progressAnswerEchoesTheWatchTimeAndTheState() {
    val answer = AgpsMessages.progressAnswer(byteArrayOf(0, 0, 1, 2), AgpsMessages.STATE_READY)
    assertEquals("810c020102030400000102040103", hex(answer.serialize()))
  }

  @Test
  fun fileStatusIsOneByte() {
    assertEquals("010103", hex(AgpsMessages.fileStatus(AgpsMessages.STATE_READY).serialize()))
    assertEquals("010104", hex(AgpsMessages.fileStatus(AgpsMessages.STATE_FAILED).serialize()))
    assertEquals("010105", hex(AgpsMessages.fileStatus(AgpsMessages.STATE_UNSUPPORTED).serialize()))
  }

  @Test
  fun fileListJoinsNamesWithSemicolons() {
    assertEquals("010361" + "3b62", hex(AgpsMessages.fileList(listOf("a", "b")).serialize()))
    assertEquals("010f" + hex("gpslocation.dat".toByteArray()), hex(AgpsMessages.fileList(listOf("gpslocation.dat")).serialize()))
  }

  @Test
  fun fileInfoCarriesSizeAndCrc() {
    // 115749 = 0x0001C425 as i32; the CRC as i16.
    assertEquals("020400" + "01c425" + "03021234", hex(AgpsMessages.fileInfo(115_749, 0x1234).serialize()))
    val data = lto(1000)
    val crc = CheckSums.getCRC16(data, 0x0000)
    val tlv = HuaweiTLV().parse(AgpsMessages.fileInfo(data.size, crc).serialize())
    assertEquals(1000, tlv.getInteger(0x02))
    assertEquals(crc.toShort(), tlv.getShort(0x03))
  }

  @Test
  fun dataAnswerCarriesTheStoredNameAndOffset() {
    val answer = AgpsMessages.dataAnswer("ab", 4096)
    assertEquals("7f04000186a0" + "020261" + "62" + "0304" + "00001000", hex(answer.serialize()))
  }

  @Test
  fun storedNameIsTheDigestOfTheAddressWithoutColons() {
    // SHA-256 of "AABBCCDDEEFF" (GB getHexDigest), checked against the digest of the colon-less text.
    val digest = java.security.MessageDigest.getInstance("SHA-256").digest("AABBCCDDEEFF".toByteArray()).joinToString("") { "%02x".format(it) }
    assertEquals(digest, EphemerisNet.addressDigest("AA:BB:CC:DD:EE:FF"))
    assertEquals(64, EphemerisNet.addressDigest("AA:BB:CC:DD:EE:FF").length)
  }

  @Test
  fun theConsultAnswerIsParsedIntoVersionTagAndUrls() {
    val body = HuaweiTLV().put(0x04, 5).put(0x05, 3.toByte()).put(0x06, "a/b/HW_AGNSS;x/HW_PGNSS_PRED")
    val consult = AgpsMessages.parseConsult(HuaweiTLV().put(0x81, body))!!
    assertEquals(3, consult.version)
    assertEquals("a/b/HW_AGNSS;x/HW_PGNSS_PRED", consult.tag)
    assertEquals("only the names, never the paths", "HW_AGNSS,HW_PGNSS_PRED", consult.tagNames)
    assertNull(AgpsMessages.parseConsult(HuaweiTLV().put(0x7F, 100001)))
    assertNull(AgpsMessages.parseConsult(null))
  }

  // Frames

  @Test
  fun dataFramesAreIndexedAndCutAtTheTransferSize() {
    val params = HuaweiPacket.ParamsProvider().also { it.setTransactionsCrypted(false) }
    val data = ByteArray(250) { it.toByte() }
    val frames = AgpsChunkPacket(params, data, 100.toShort(), 3).serialize()
    assertEquals(3, frames.size)
    var rebuilt = ByteArray(0)
    for ((index, f) in frames.withIndex()) {
      // 5A, length (2), 00, service 1C, command 05, index, data..., CRC16 (2)
      assertEquals(0x5A, f[0].toInt() and 0xFF)
      assertEquals(0x1C, f[4].toInt())
      assertEquals(0x05, f[5].toInt())
      assertEquals(index, f[6].toInt())
      rebuilt += f.copyOfRange(7, f.size - 2)
      val crc = CheckSums.getCRC16(f.copyOfRange(0, f.size - 2), 0x0000)
      assertEquals(crc.toShort(), java.nio.ByteBuffer.wrap(f, f.size - 2, 2).short)
    }
    assertArrayEquals(data, rebuilt)
    assertEquals(100, frames[0].size - 9)
    assertEquals(50, frames[2].size - 9)
  }

  // The store

  @Test
  fun theStoreStartsEmpty() {
    val store = AgpsStore(MemoryPrefs())
    assertEquals(0L, store.cachedAtMs)
    assertEquals(-1, store.lastAskVersion)
    assertEquals(AgpsOutcome.NONE, store.lastOutcome)
    assertEquals(0L, store.retryAtMs())
  }

  @Test
  fun failuresAccumulateIntoTheRetryWaitAndASuccessOrTheUserClearsThem() {
    val store = AgpsStore(MemoryPrefs())
    store.recordOutcome(1_000L, AgpsOutcome.DOWNLOAD_FAILED, "HTTP 503", true)
    assertEquals(1, store.failures)
    assertEquals(1_000L + 60_000L, store.retryAtMs())
    store.recordOutcome(2_000L, AgpsOutcome.DOWNLOAD_FAILED, "HTTP 503", true)
    assertEquals(2, store.failures)
    assertEquals(2_000L + 5 * 60_000L, store.retryAtMs())
    store.recordOutcome(3_000L, AgpsOutcome.WATCH_SILENT, "no answer", false)
    assertEquals("a silent watch is not a download failure", 2, store.failures)
    assertEquals(AgpsOutcome.WATCH_SILENT, store.lastOutcome)
    store.clearRetry()
    assertEquals(0L, store.retryAtMs())
    store.recordOutcome(4_000L, AgpsOutcome.DOWNLOAD_FAILED, "x", true)
    store.recordDownloaded(5_000L, 4_500L, 1234, AgpsSources.BROADCOM)
    assertEquals(0, store.failures)
    assertEquals(1234, store.cachedSize)
    assertEquals(4_500L, store.cachedDataMs)
  }

  @Test
  fun aDeliveryIsRememberedPerWatchAndCountsAsTheOutcome() {
    val store = AgpsStore(MemoryPrefs())
    store.recordDelivered(9_000L, 8_000L, 115_749, AgpsSources.BROADCOM, "AA:BB:CC:DD:EE:FF")
    assertEquals(9_000L, store.deliveredAtMs)
    assertEquals(115_749, store.deliveredSize)
    assertEquals("AA:BB:CC:DD:EE:FF", store.deliveredAddress)
    assertEquals(AgpsOutcome.DELIVERED, store.lastOutcome)
    assertEquals("", store.lastError)
  }

  @Test
  fun theAskKeepsTagNamesOnlyAndIsCapped() {
    val store = AgpsStore(MemoryPrefs())
    store.recordAsk(7L, 3, "x".repeat(500))
    assertEquals(120, store.lastAskTags.length)
    assertEquals(3, store.lastAskVersion)
    assertEquals(7L, store.lastAskMs)
  }

  // The source

  private class MemoryCache : AgpsCache {
    val entries = HashMap<String, ByteArray>()
    var ageOk = true
    override fun read(url: String, maxAgeMs: Long): ByteArray? = if (ageOk) entries[url] else null
    override fun write(url: String, data: ByteArray) {
      entries[url] = data
    }
    override fun delete(url: String) {
      entries.remove(url)
    }
  }

  private val ltoUrl = EphemerisNet.LTO_HOST + EphemerisNet.LTO_PATH

  private fun source(cache: AgpsCache, store: AgpsStore, online: Boolean = true) =
    NetworkAgpsSource(cache, store, log = { }, isOnline = { online }, nowMs = { 50_000L })

  @Test
  fun versionZeroServesAGoodCachedFileAndMarksItAsCached() {
    val cache = MemoryCache().also { it.entries[ltoUrl] = lto() }
    val store = AgpsStore(MemoryPrefs()).also { it.recordDownloaded(40_000L, 39_000L, 115_749, AgpsSources.BROADCOM) }
    val fetch = source(cache, store).fetch(AgpsConsult.DEFAULT, force = false)
    assertTrue(fetch.ok)
    assertTrue(fetch.fromCache)
    assertEquals(AgpsSources.BROADCOM, fetch.source)
    assertEquals(39_000L, fetch.dataTimeMs)
    assertEquals(setOf(AgpsSources.LTO_FILE), fetch.files.keys)
  }

  @Test
  fun aBrokenCachedFileIsDroppedAndOfflineThenSaysSo() {
    val cache = MemoryCache().also { it.entries[ltoUrl] = ByteArray(100) }
    val fetch = source(cache, AgpsStore(MemoryPrefs()), online = false).fetch(AgpsConsult.DEFAULT, force = false)
    assertFalse(fetch.ok)
    assertEquals(AgpsOutcome.NO_NETWORK, fetch.outcome)
    assertTrue("the bad copy is gone", cache.entries.isEmpty())
  }

  @Test
  fun forceSkipsTheCacheAndOfflineReportsNoNetwork() {
    val cache = MemoryCache().also { it.entries[ltoUrl] = lto() }
    val fetch = source(cache, AgpsStore(MemoryPrefs()), online = false).fetch(AgpsConsult.DEFAULT, force = true)
    assertEquals(AgpsOutcome.NO_NETWORK, fetch.outcome)
  }

  @Test
  fun versionsOneToThreeAreDeclinedAsUnsupportedWithoutTouchingTheNetworkOrTheCache() {
    val cache = MemoryCache().also { it.entries[ltoUrl] = lto() }
    val store = AgpsStore(MemoryPrefs())
    for (version in 1..3) {
      val fetch = source(cache, store).fetch(AgpsConsult(version, "p/q/HW_AGNSS;x/HW_PGNSS_PRED", emptyList()), force = false)
      assertFalse("the Broadcom file is never offered to a watch that asked for another kind", fetch.ok)
      assertEquals(AgpsOutcome.UNSUPPORTED, fetch.outcome)
      assertTrue(fetch.message.contains("HW_AGNSS,HW_PGNSS_PRED"))
      assertFalse("paths are not echoed", fetch.message.contains("p/q"))
    }
  }

  @Test
  fun unknownVersionsAreUnsupported() {
    val fetch = source(MemoryCache(), AgpsStore(MemoryPrefs())).fetch(AgpsConsult(9, "", emptyList()), false)
    assertEquals(AgpsOutcome.UNSUPPORTED, fetch.outcome)
  }

  // The experimental HW_AGNSS path

  @Test
  fun crc24qMatchesThePublishedCheckValue() {
    assertEquals(0xCDE703, AgpsPolicy.crc24q("123456789".toByteArray()))
  }

  @Test
  fun aFullRtcmFilePassesAndBrokenOnesAreRefusedWithTheServersWords() {
    assertNull(AgpsPolicy.validateRtcm(rtcmFile(24)))
    assertEquals(24, AgpsPolicy.rtcmFrames(rtcmFile(24)))
    assertEquals("only 19 satellites (at least 20 needed)", AgpsPolicy.validateRtcm(rtcmFile(19)))
    assertEquals("file too small (100 bytes)", AgpsPolicy.validateRtcm(ByteArray(100)))
    assertEquals("file too large (16385 bytes)", AgpsPolicy.validateRtcm(ByteArray(16 * 1024 + 1)))
    val flipped = rtcmFile(24).also { it[10] = (it[10].toInt() xor 1).toByte() }
    assertEquals("RTCM frame at byte 0 fails its CRC", AgpsPolicy.validateRtcm(flipped))
    val cut = rtcmFile(24).let { it.copyOfRange(0, it.size - 1) }
    assertEquals("RTCM frame at byte ${23 * 67} is cut off", AgpsPolicy.validateRtcm(cut))
    assertEquals("not an RTCM 3 frame at byte ${24 * 67}", AgpsPolicy.validateRtcm(rtcmFile(24) + byteArrayOf(0)))
    assertEquals("unexpected RTCM message 1005 at byte 0", AgpsPolicy.validateRtcm(rtcmFile(24, type = 1005)))
  }

  @Test
  fun theHwAgnssFileMustBeFreshFromTheServer() {
    val hour = 3_600_000L
    val now = 10 * hour
    assertNull(AgpsPolicy.validateAgnss(rtcmFile(24), now - hour, now))
    assertEquals("the file was built 121 minutes ago", AgpsPolicy.validateAgnss(rtcmFile(24), now - 2 * hour - 60_000L, now))
    assertEquals("the server did not say when the file was built", AgpsPolicy.validateAgnss(rtcmFile(24), 0L, now))
    assertEquals("only 10 satellites (at least 20 needed)", AgpsPolicy.validateAgnss(rtcmFile(10), now, now))
    assertEquals("expires four hours after it was built", now + 4 * hour, AgpsPolicy.expiresAtMs(now, AgpsLab.SOURCE))
    assertEquals(now + 7 * 24 * hour, AgpsPolicy.expiresAtMs(now, AgpsSources.BROADCOM))
  }

  /** The HW_AGNSS switch alone serves exactly the HW_AGNSS kind for [consult]. */
  private fun asksHwAgnss(consult: AgpsConsult) = AgpsLab.servedKinds(consult, agnssOn = true, pgnssOn = false) == listOf(AgpsLab.KIND)

  @Test
  fun onlyAConsultForExactlyOneHwAgnssKindQualifies() {
    assertTrue(asksHwAgnss(AgpsConsult(3, "higeo/v1/gnssinfo?type=0x0024/HW_AGNSS", emptyList())))
    assertTrue(asksHwAgnss(AgpsConsult(3, " higeo/v1/gnssinfo?type=0x0004/HW_AGNSS; ", emptyList())))
    assertFalse(asksHwAgnss(AgpsConsult(0, "higeo/v1/gnssinfo?type=0x0024/HW_AGNSS", emptyList())))
    assertFalse(asksHwAgnss(AgpsConsult(4, "higeo/v1/gnssinfo?type=0x0024/HW_AGNSS", emptyList())))
    assertFalse(asksHwAgnss(AgpsConsult(3, "a/HW_AGNSS;b/HW_PGNSS_GPS", emptyList())))
    assertFalse(asksHwAgnss(AgpsConsult(3, "com.huawei.higeo_dataModule_PGNSSConfig?type=HW_EEV2/HW_PGNSS_PRED;", emptyList())))
    assertFalse(asksHwAgnss(AgpsConsult(3, "x/HW_AGNSS_RTCM_33", emptyList())))
    assertTrue(AgpsLab.askedHwAgnss(3, "HW_AGNSS"))
    assertFalse(AgpsLab.askedHwAgnss(3, "HW_AGNSS,HW_PGNSS_GPS"))
  }

  @Test
  fun theRetryScheduleCoversBroadcomAndHwAgnssWithTheSwitchOnOnly() {
    val agnss = AgpsConsult(3, "higeo/v1/gnssinfo?type=0x0024/HW_AGNSS", emptyList())
    assertTrue(AgpsLab.downloads(AgpsConsult.DEFAULT, agnssOn = false, pgnssOn = false))
    assertTrue(AgpsLab.downloads(agnss, agnssOn = true, pgnssOn = false))
    assertFalse("switch off: declined, the retry wait does not apply", AgpsLab.downloads(agnss, agnssOn = false, pgnssOn = true))
    assertFalse(AgpsLab.downloads(AgpsConsult(3, "x/HW_PGNSS_PRED;", emptyList()), agnssOn = true, pgnssOn = false))
  }

  @Test
  fun theSwitchIsOffByDefaultAndRemembered() {
    val prefs = MemoryPrefs()
    assertFalse(AgpsStore(prefs).labAgnss)
    AgpsStore(prefs).setLabAgnss(true)
    assertTrue(AgpsStore(prefs).labAgnss)
  }

  private val agnss = AgpsConsult(3, "higeo/v1/gnssinfo?type=0x0024/HW_AGNSS", emptyList())

  private fun labSource(cache: AgpsCache, store: AgpsStore, online: Boolean = true, answer: () -> AgpsDownload) =
    NetworkAgpsSource(cache, store, log = { }, isOnline = { online }, nowMs = { 10_000_000L }, http = { url, max ->
      assertEquals(EphemerisNet.AGNSS_URL, url)
      assertEquals(AgpsPolicy.RTCM_MAX_BYTES, max)
      answer()
    })

  @Test
  fun withTheSwitchOffHwAgnssIsDeclinedWithoutTheNetwork() {
    val fetch = labSource(MemoryCache(), AgpsStore(MemoryPrefs())) { throw AssertionError("the network must not be used") }.fetch(agnss, false)
    assertEquals(AgpsOutcome.UNSUPPORTED, fetch.outcome)
    assertEquals("the watch asked for kinds only the watch maker's app prepares (version 3: HW_AGNSS)", fetch.message)
  }

  @Test
  fun withTheSwitchOnTheServersFileIsCheckedKeptAndReused() {
    val cache = MemoryCache()
    val store = AgpsStore(MemoryPrefs()).also { it.setLabAgnss(true) }
    val file = rtcmFile(24)
    var calls = 0
    val source = labSource(cache, store) {
      calls++
      AgpsDownload(file, 9_000_000L)
    }
    val fetch = source.fetch(agnss, false)
    assertTrue(fetch.ok)
    assertEquals(AgpsLab.SOURCE, fetch.source)
    assertEquals(9_000_000L, fetch.dataTimeMs)
    assertArrayEquals(file, fetch.files[AgpsLab.FILE])
    assertArrayEquals(file, cache.entries[EphemerisNet.AGNSS_URL])
    // The exchange records the download; the watch's next ask is answered from the phone's copy.
    store.recordDownloaded(9_500_000L, fetch.dataTimeMs, file.size, fetch.source)
    val again = source.fetch(agnss, false)
    assertTrue(again.fromCache)
    assertEquals(9_000_000L, again.dataTimeMs)
    assertEquals(1, calls)
    // A Broadcom copy's record does not vouch for the cached RTCM file: it is fetched again.
    store.recordDownloaded(9_600_000L, 9_600_000L, 115_749, AgpsSources.BROADCOM)
    assertFalse(source.fetch(agnss, false).fromCache)
    assertEquals(2, calls)
  }

  @Test
  fun withTheSwitchOnABrokenStaleOrMissingFileIsNotOffered() {
    val store = AgpsStore(MemoryPrefs()).also { it.setLabAgnss(true) }
    val bad = rtcmFile(24).also { it[30] = (it[30].toInt() xor 0xFF).toByte() }
    val cache = MemoryCache()
    val broken = labSource(cache, store) { AgpsDownload(bad, 9_000_000L) }.fetch(agnss, true)
    assertEquals(AgpsOutcome.INVALID_FILE, broken.outcome)
    assertEquals("HW_AGNSS: RTCM frame at byte 0 fails its CRC", broken.message)
    assertTrue("a bad file is never kept", cache.entries.isEmpty())
    val stale = labSource(cache, store) { AgpsDownload(rtcmFile(24), 1_000L) }.fetch(agnss, true)
    assertEquals(AgpsOutcome.INVALID_FILE, stale.outcome)
    val down = labSource(cache, store) { throw AgpsFetchException("HTTP 503") }.fetch(agnss, true)
    assertEquals(AgpsOutcome.DOWNLOAD_FAILED, down.outcome)
    assertEquals("HW_AGNSS: HTTP 503", down.message)
    val offline = labSource(cache, store, online = false) { throw AssertionError("offline") }.fetch(agnss, true)
    assertEquals(AgpsOutcome.NO_NETWORK, offline.outcome)
  }

  @Test
  fun withTheSwitchOnOtherKindsStayDeclined() {
    val store = AgpsStore(MemoryPrefs()).also { it.setLabAgnss(true) }
    val source = labSource(MemoryCache(), store) { throw AssertionError("the network must not be used") }
    assertEquals(AgpsOutcome.UNSUPPORTED, source.fetch(AgpsConsult(3, "a/HW_AGNSS;b/HW_PGNSS_GPS", emptyList()), false).outcome)
    assertEquals(AgpsOutcome.UNSUPPORTED, source.fetch(AgpsConsult(3, "x/HW_PGNSS_PRED;", emptyList()), false).outcome)
  }

  // The experimental HW_PGNSS_PRED path

  private val pred = AgpsConsult(3, "com.huawei.higeo_dataModule_PGNSSConfig?type=HW_EEV2/HW_PGNSS_PRED;", emptyList())

  /** 2026-10-25 01:47 UTC (08:47 WIB, the Huawei Health capture), the build time of the test bundles. */
  private val built = 1_792_892_820_000L

  @Test
  fun theBundleLayoutHasTheExactSizesOfHuaweiHealthsFiles() {
    assertEquals(
      listOf("HW_PGNSS_GPS", "HW_PGNSS_BDS", "HW_PGNSS_GLONASS", "HW_PGNSS_GALILEO", "HW_PGNSS_QZS", "HW_PGNSS_EXTRA"),
      PgnssBundle.FILES.map { it.name },
    )
    assertEquals(listOf(93_312, 209_808, 361_584, 99_648, 28_512, 6_248), PgnssBundle.FILES.map { it.size })
    assertEquals(799_230, PgnssBundle.BUNDLE_BYTES)
    assertEquals("HH's gpsTime = unixSeconds - 315964782", 1_792_892_820L - 315_964_782L, PgnssBundle.gpsSeconds(built))
  }

  @Test
  fun aGoodBundlePassesAndSplitsIntoTheSixFilesInPullOrder() {
    val files = pgnssFiles(built)
    val bundle = pgnssBundle(files)
    assertEquals(PgnssBundle.BUNDLE_BYTES, bundle.size)
    assertNull(PgnssBundle.validate(bundle, built, built + 60_000L))
    assertNull("six hours old is still good", PgnssBundle.validate(bundle, built, built + 6 * 3_600_000L))
    val split = PgnssBundle.files(bundle)
    assertEquals(files.keys.toList(), split.keys.toList())
    for ((name, data) in files) assertArrayEquals(name, data, split[name])
  }

  @Test
  fun aBundleWithAWrongContainerIsRefused() {
    val files = pgnssFiles(built)
    fun check(bundle: ByteArray) = PgnssBundle.validate(bundle, built, built)
    assertEquals("not a PGNSS bundle (unexpected header)", check(byteArrayOf(1, 2, 3)))
    assertEquals("not a PGNSS bundle (unexpected header)", check(pgnssBundle(files).also { it[0] = 'X'.code.toByte() }))
    assertEquals("bundle version 2 is not known", check(pgnssBundle(files, version = 2)))
    assertEquals("the bundle has 5 files (6 expected)", check(pgnssBundle(files, count = 5)))
    val swapped = listOf("HW_PGNSS_BDS", "HW_PGNSS_GPS", "HW_PGNSS_GLONASS", "HW_PGNSS_GALILEO", "HW_PGNSS_QZS", "HW_PGNSS_EXTRA")
    assertEquals("file 1 is \"HW_PGNSS_BDS\" (HW_PGNSS_GPS expected)", check(pgnssBundle(files, order = swapped)))
    val short = LinkedHashMap(files).also { it["HW_PGNSS_QZS"] = it["HW_PGNSS_QZS"]!!.copyOfRange(0, 28_511) }
    assertEquals("HW_PGNSS_QZS is 28511 bytes (28512 expected)", check(pgnssBundle(short)))
    assertEquals("1 bytes after the last file", check(pgnssBundle(files) + byteArrayOf(0)))
    val cut = pgnssBundle(files).let { it.copyOfRange(0, it.size - 10) }
    assertEquals("the bundle is cut off in HW_PGNSS_EXTRA", check(cut))
  }

  @Test
  fun aBundleWithABadHeaderOrTooManySatellitesIsRefused() {
    fun withFile(name: String, change: (ByteArray) -> Unit): String? {
      val files = pgnssFiles(built)
      change(files[name]!!)
      return PgnssBundle.validate(pgnssBundle(files), built, built)
    }
    assertEquals("HW_PGNSS_GPS header entry 3 points at 0 (8700 expected)", withFile("HW_PGNSS_GPS") { putU32(it, 12 * 3 + 4, 0) })
    assertEquals("HW_PGNSS_BDS header entry 0 has size 5801 (5800 expected)", withFile("HW_PGNSS_BDS") { putU32(it, 8, 5801) })
    assertEquals("HW_PGNSS_GALILEO slot 5 is not 7200 s after the one before", withFile("HW_PGNSS_GALILEO") { putU32(it, 12 * 5, 1) })
    assertEquals("HW_PGNSS_QZS header entry 36 is not empty", withFile("HW_PGNSS_QZS") { putU32(it, 12 * 36, 1) })
    assertEquals("HW_PGNSS_GPS block 0 lists 33 satellites (at most 32)", withFile("HW_PGNSS_GPS") { it[1008] = 33 })
    // GLONASS: 8 sub-blocks of 1252 bytes per header entry, each with its own count.
    assertEquals("HW_PGNSS_GLONASS block 9 lists 25 satellites (at most 24)", withFile("HW_PGNSS_GLONASS") { it[1008 + 9 * 1252] = 25 })
    assertEquals("HW_PGNSS_GLONASS header entry 1 points at 2260 (11024 expected)", withFile("HW_PGNSS_GLONASS") { putU32(it, 12 + 4, 1008L + 1252L) })
    assertNull("EXTRA has no header to check", withFile("HW_PGNSS_EXTRA") { it.fill(0x7F) })
  }

  @Test
  fun aStaleUndatedOrMistimedBundleIsRefused() {
    val bundle = pgnssBundle(pgnssFiles(built))
    assertEquals("the bundle was built 361 minutes ago", PgnssBundle.validate(bundle, built, built + 6 * 3_600_000L + 60_000L))
    assertEquals("the server did not say when the bundle was built", PgnssBundle.validate(bundle, 0L, built))
    // Slots made for a build five hours earlier than the server says: the first slot is too far from the build time.
    val early = pgnssBundle(pgnssFiles(built - 5 * 3_600_000L))
    assertTrue(PgnssBundle.validate(early, built, built)!!.startsWith("HW_PGNSS_GPS starts -"))
  }

  @Test
  fun onlyAPredConsultQualifiesAndOnlyWithItsOwnSwitch() {
    assertEquals(listOf(AgpsPgnss.KIND), AgpsLab.servedKinds(pred, agnssOn = false, pgnssOn = true))
    assertEquals(emptyList<String>(), AgpsLab.servedKinds(pred, agnssOn = true, pgnssOn = false))
    assertEquals(emptyList<String>(), AgpsLab.servedKinds(AgpsConsult(0, pred.tag, emptyList()), agnssOn = true, pgnssOn = true))
    assertEquals(emptyList<String>(), AgpsLab.servedKinds(AgpsConsult(4, pred.tag, emptyList()), agnssOn = true, pgnssOn = true))
    val seven = AgpsConsult(3, "com.huawei.higeo_dataModule_PGNSSConfig?type=HW_EEV2_SEVEN/HW_PGNSS_PRED;", emptyList())
    assertEquals("the seven-day variant is gzipped and longer: not served", emptyList<String>(), AgpsLab.servedKinds(seven, true, true))
    assertEquals(emptyList<String>(), AgpsLab.servedKinds(AgpsConsult(3, "x/HW_PGNSS_PRED_X", emptyList()), true, true))
    assertEquals(emptyList<String>(), AgpsLab.servedKinds(AgpsConsult(3, "x/HW_PGNSS_PRED;y/HW_PGNSS_GPS", emptyList()), true, true))
    assertEquals(listOf(AgpsLab.KIND), AgpsLab.servedKinds(agnss, agnssOn = true, pgnssOn = true))
    assertTrue(AgpsPgnss.askedPred(3, "HW_PGNSS_PRED"))
    assertFalse(AgpsPgnss.askedPred(0, "HW_PGNSS_PRED"))
    assertFalse(AgpsPgnss.askedPred(3, "HW_AGNSS,HW_PGNSS_PRED"))
    assertTrue(AgpsLab.downloads(pred, agnssOn = false, pgnssOn = true))
    assertFalse(AgpsLab.downloads(pred, agnssOn = true, pgnssOn = false))
  }

  @Test
  fun aConsultNamingBothKindsServesWhatIsSwitchedOnAndOnlyWithThePredSwitch() {
    val both = AgpsConsult(3, "a/HW_AGNSS;${pred.tag}", emptyList())
    assertEquals(listOf(AgpsLab.KIND, AgpsPgnss.KIND), AgpsLab.servedKinds(both, agnssOn = true, pgnssOn = true))
    assertEquals(listOf(AgpsPgnss.KIND), AgpsLab.servedKinds(both, agnssOn = false, pgnssOn = true))
    assertEquals("PRED switch off: declined as before", emptyList<String>(), AgpsLab.servedKinds(both, agnssOn = true, pgnssOn = false))
  }

  @Test
  fun thePgnssSwitchIsOffByDefaultSeparateAndRemembered() {
    val prefs = MemoryPrefs()
    assertFalse(AgpsStore(prefs).labPgnss)
    AgpsStore(prefs).setLabAgnss(true)
    assertFalse("the HW_AGNSS switch does not turn it on", AgpsStore(prefs).labPgnss)
    AgpsStore(prefs).setLabPgnss(true)
    assertTrue(AgpsStore(prefs).labPgnss)
    AgpsStore(prefs).recordPgnssBuilt(42L)
    assertEquals(42L, AgpsStore(prefs).pgnssBuiltMs)
  }

  @Test
  fun pgnssDataIsShownValidForTheThreeDaysItCovers() {
    assertEquals(built + 72 * 3_600_000L, AgpsPolicy.expiresAtMs(built, AgpsPgnss.SOURCE))
  }

  private fun pgnssSource(cache: AgpsCache, store: AgpsStore, now: Long = built + 60_000L, online: Boolean = true, answer: () -> AgpsDownload) =
    NetworkAgpsSource(cache, store, log = { }, isOnline = { online }, nowMs = { now }, http = { url, max ->
      assertEquals(EphemerisNet.PGNSS_URL, url)
      assertEquals(PgnssBundle.BUNDLE_BYTES, max)
      answer()
    })

  @Test
  fun withThePgnssSwitchOffPredIsDeclinedWithoutTheNetworkAsToday() {
    val store = AgpsStore(MemoryPrefs()).also { it.setLabAgnss(true) }
    val fetch = pgnssSource(MemoryCache(), store) { throw AssertionError("the network must not be used") }.fetch(pred, false)
    assertEquals(AgpsOutcome.UNSUPPORTED, fetch.outcome)
    assertEquals("the watch asked for kinds only the watch maker's app prepares (version 3: HW_PGNSS_PRED)", fetch.message)
  }

  @Test
  fun withThePgnssSwitchOnTheBundleIsCheckedSplitKeptAndReused() {
    val cache = MemoryCache()
    val store = AgpsStore(MemoryPrefs()).also { it.setLabPgnss(true) }
    val files = pgnssFiles(built)
    val bundle = pgnssBundle(files)
    var calls = 0
    val source = pgnssSource(cache, store) {
      calls++
      AgpsDownload(bundle, built)
    }
    val fetch = source.fetch(pred, false)
    assertTrue(fetch.message, fetch.ok)
    assertFalse(fetch.fromCache)
    assertEquals(AgpsPgnss.SOURCE, fetch.source)
    assertEquals(built, fetch.dataTimeMs)
    assertEquals(files.keys.toList(), fetch.files.keys.toList())
    assertArrayEquals(files["HW_PGNSS_GLONASS"], fetch.files["HW_PGNSS_GLONASS"])
    assertArrayEquals(bundle, cache.entries[EphemerisNet.PGNSS_URL])
    assertEquals(built, store.pgnssBuiltMs)
    // The watch's next ask is answered from the phone's copy, even after an HW_AGNSS download changed the general copy record.
    store.recordDownloaded(built + 1_000L, built, 7_000, AgpsLab.SOURCE)
    val again = source.fetch(pred, false)
    assertTrue(again.fromCache)
    assertEquals(built, again.dataTimeMs)
    assertEquals(1, calls)
    // A forced update goes to the server.
    assertFalse(source.fetch(pred, true).fromCache)
    assertEquals(2, calls)
  }

  @Test
  fun withThePgnssSwitchOnABrokenStaleOrMissingBundleIsNotOffered() {
    val store = AgpsStore(MemoryPrefs()).also { it.setLabPgnss(true) }
    val cache = MemoryCache()
    val files = pgnssFiles(built)
    val wrong = pgnssBundle(LinkedHashMap(files).also { it["HW_PGNSS_EXTRA"] = ByteArray(6_000) })
    val broken = pgnssSource(cache, store) { AgpsDownload(wrong, built) }.fetch(pred, true)
    assertEquals(AgpsOutcome.INVALID_FILE, broken.outcome)
    assertEquals("HW_PGNSS_PRED: HW_PGNSS_EXTRA is 6000 bytes (6248 expected)", broken.message)
    assertTrue("a bad bundle is never kept", cache.entries.isEmpty())
    assertEquals(0L, store.pgnssBuiltMs)
    val stale = pgnssSource(cache, store, now = built + 7 * 3_600_000L) { AgpsDownload(pgnssBundle(files), built) }.fetch(pred, true)
    assertEquals(AgpsOutcome.INVALID_FILE, stale.outcome)
    assertEquals("HW_PGNSS_PRED: the bundle was built 420 minutes ago", stale.message)
    // A phone copy that got too old is dropped and fetched again.
    cache.entries[EphemerisNet.PGNSS_URL] = pgnssBundle(files)
    store.recordPgnssBuilt(built)
    val down = pgnssSource(cache, store, now = built + 7 * 3_600_000L) { throw AgpsFetchException("HTTP 503") }.fetch(pred, false)
    assertEquals(AgpsOutcome.DOWNLOAD_FAILED, down.outcome)
    assertEquals("HW_PGNSS_PRED: HTTP 503", down.message)
    assertTrue(cache.entries.isEmpty())
    val offline = pgnssSource(cache, store, online = false) { throw AssertionError("offline") }.fetch(pred, true)
    assertEquals(AgpsOutcome.NO_NETWORK, offline.outcome)
  }

  @Test
  fun aConsultNamingBothKindsWithBothSwitchesOnGetsTheSevenFilesOrNothing() {
    val store = AgpsStore(MemoryPrefs()).also {
      it.setLabAgnss(true)
      it.setLabPgnss(true)
    }
    val rtcm = rtcmFile(24)
    val bundle = pgnssBundle(pgnssFiles(built))
    var agnssUp = true
    val source = NetworkAgpsSource(MemoryCache(), store, log = { }, isOnline = { true }, nowMs = { built + 60_000L }, http = { url, _ ->
      when (url) {
        EphemerisNet.AGNSS_URL -> if (agnssUp) AgpsDownload(rtcm, built) else throw AgpsFetchException("HTTP 503")
        else -> AgpsDownload(bundle, built)
      }
    })
    val both = AgpsConsult(3, "a/HW_AGNSS;${pred.tag}", emptyList())
    val fetch = source.fetch(both, true)
    assertEquals(listOf(AgpsLab.FILE) + PgnssBundle.FILES.map { it.name }, fetch.files.keys.toList())
    assertEquals(AgpsPgnss.SOURCE, fetch.source)
    agnssUp = false
    val half = source.fetch(both, true)
    assertFalse("every kind offered or none", half.ok)
    assertEquals("HW_AGNSS: HTTP 503", half.message)
  }
}

/**
 * An HW_AGNSS-shaped file for the tests: [satellites] frames of 61-byte messages of [type] (1019, GPS, by default), each `D3`, length,
 * message and CRC-24Q, so 67 bytes per frame. The message bodies are filler; only the framing is real.
 */
internal fun rtcmFile(satellites: Int, type: Int = 1019): ByteArray {
  var out = ByteArray(0)
  repeat(satellites) { k ->
    val message = ByteArray(61) { (it * 7 + k).toByte() }
    message[0] = (type shr 4).toByte()
    message[1] = (((type and 0xF) shl 4) or (message[1].toInt() and 0x0F)).toByte()
    val head = byteArrayOf(0xD3.toByte(), 0, message.size.toByte()) + message
    val crc = AgpsPolicy.crc24q(head)
    out += head + byteArrayOf((crc shr 16).toByte(), (crc shr 8).toByte(), crc.toByte())
  }
  return out
}

private fun putU32(data: ByteArray, at: Int, value: Long) {
  for (k in 0 until 4) data[at + k] = (value shr (8 * k)).toByte()
}

/**
 * The six PGNSS files for the tests, at their exact sizes: each ephemeris file with the header of a server build at [builtMs] (36 slots 7200 s
 * apart from the next two-hour boundary, BeiDou +14 s, GLONASS +18 + 3600 s; packed offsets; the other 48 entries zero) and every (sub-)block
 * listing its full capacity of satellites; the record bytes are filler.
 */
internal fun pgnssFiles(builtMs: Long): LinkedHashMap<String, ByteArray> {
  val base = PgnssBundle.gpsSeconds(builtMs) / 7200 * 7200
  val out = LinkedHashMap<String, ByteArray>()
  for (spec in PgnssBundle.FILES) {
    val file = ByteArray(spec.size) { (it * 7 + spec.name.length).toByte() }
    if (spec.blockBytes > 0) {
      file.fill(0, 0, PgnssBundle.HEADER_BYTES)
      val first = when (spec.name) {
        "HW_PGNSS_BDS" -> base + 7214
        "HW_PGNSS_GLONASS" -> base + 18 + 3600
        else -> base + 7200
      }
      for (i in 0 until PgnssBundle.SLOTS) {
        putU32(file, 12 * i, first + 7200L * i)
        putU32(file, 12 * i + 4, PgnssBundle.HEADER_BYTES + i.toLong() * spec.blockBytes)
        putU32(file, 12 * i + 8, spec.blockBytes.toLong())
      }
      var block = PgnssBundle.HEADER_BYTES
      while (block < spec.size) {
        file[block] = spec.capacity.toByte()
        block += spec.subBlockBytes
      }
    }
    out[spec.name] = file
  }
  return out
}

/** [files] as the server's bundle: `JFPG`, [version], [count], then name, u32 LE size and bytes per file in [order]. */
internal fun pgnssBundle(
  files: Map<String, ByteArray>,
  order: List<String> = files.keys.toList(),
  version: Int = 1,
  count: Int = order.size,
): ByteArray {
  val out = java.io.ByteArrayOutputStream()
  out.write("JFPG".toByteArray(Charsets.US_ASCII))
  out.write(version)
  out.write(count)
  for (name in order) {
    val data = files.getValue(name)
    out.write(name.length)
    out.write(name.toByteArray(Charsets.US_ASCII))
    for (k in 0 until 4) out.write(data.size shr (8 * k))
    out.write(data)
  }
  return out.toByteArray()
}
