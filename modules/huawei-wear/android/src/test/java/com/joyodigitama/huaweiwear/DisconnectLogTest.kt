package com.joyodigitama.huaweiwear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DisconnectLogTest {
  private val prefs = MemoryPrefs()
  private val log = DisconnectLog(prefs)

  private fun dropped(at: Long, reason: String = "Connection lost: closed by the watch", heldMs: Long = 600_000, phone: String = "") =
    log.record(DisconnectLog.Kind.DROPPED, ModelTransport.BR, heldMs, phone, reason, at)

  private fun failed(at: Long, transport: ModelTransport = ModelTransport.LE, reason: String = "[ERR_TIMEOUT] Timed out after 45000 ms") =
    log.record(DisconnectLog.Kind.FAILED, transport, null, "", reason, at)

  @Test
  fun nothingIsRecordedAtFirst() {
    assertTrue(log.entries().isEmpty())
    assertEquals(listOf("Disconnects: none recorded"), DisconnectLog.lines(log.entries()) { "t$it" })
  }

  @Test
  fun aDropIsKeptWithItsTimeLinkHoldTimeAndReason() {
    dropped(1_000, phone = "screen off, idle mode (Doze)")

    val entry = log.entries().single()
    assertEquals(1_000L, entry.atMs)
    assertEquals(DisconnectLog.Kind.DROPPED, entry.kind)
    assertEquals(ModelTransport.BR, entry.transport)
    assertEquals(600_000L, entry.heldMs)
    assertEquals("screen off, idle mode (Doze)", entry.phone)
    assertEquals("Connection lost: closed by the watch", entry.reason)
    assertEquals(1, entry.count)
  }

  @Test
  fun theRowsSurviveARestartOfTheApp() {
    dropped(1_000)
    failed(2_000)

    val afterRestart = DisconnectLog(prefs)

    assertEquals(listOf(1_000L, 2_000L), afterRestart.entries().map { it.atMs })
    assertEquals(listOf(DisconnectLog.Kind.DROPPED, DisconnectLog.Kind.FAILED), afterRestart.entries().map { it.kind })
  }

  @Test
  fun theSameFailedAttemptRepeatedIsOneRowWithACount() {
    failed(1_000)
    failed(61_000)
    failed(361_000)

    val entry = log.entries().single()
    assertEquals(3, entry.count)
    assertEquals(1_000L, entry.atMs)
    assertEquals(361_000L, entry.lastAtMs)
  }

  @Test
  fun aFailingLoopCannotPushOutTheDropThatStartedIt() {
    dropped(1_000)
    repeat(200) { failed(2_000L + it) }

    val rows = log.entries()
    assertEquals(2, rows.size)
    assertEquals(DisconnectLog.Kind.DROPPED, rows[0].kind)
    assertEquals(200, rows[1].count)
  }

  @Test
  fun aFailureThatDiffersFromTheLastOneIsANewRow() {
    failed(1_000)
    failed(2_000, transport = ModelTransport.BR)
    failed(3_000, reason = "[ERR_CONNECT_FAILED] RFCOMM connect failed")
    dropped(4_000)
    failed(5_000)

    assertEquals(5, log.entries().size)
  }

  @Test
  fun dropsAreNeverMergedEvenWhenAlike() {
    dropped(1_000)
    dropped(2_000)

    assertEquals(2, log.entries().size)
  }

  @Test
  fun onlyTheLastRowsAreKept() {
    val small = DisconnectLog(MemoryPrefs(), capacity = 3)
    for (i in 1..5) small.record(DisconnectLog.Kind.DROPPED, ModelTransport.BR, null, "", "drop $i", i.toLong())

    assertEquals(listOf("drop 3", "drop 4", "drop 5"), small.entries().map { it.reason })
  }

  @Test
  fun aReasonIsOneShortLineSoTheStorageFormatHolds() {
    dropped(1_000, reason = "Connection lost:\n  End\tof stream\r\n")
    dropped(2_000, reason = "x".repeat(1_000))

    val rows = log.entries()
    assertEquals("Connection lost: End of stream", rows[0].reason)
    assertEquals(240, rows[1].reason.length)
    assertTrue(rows[1].reason.endsWith("..."))
    assertEquals("both rows are still there after a round trip", 2, DisconnectLog(prefs).entries().size)
  }

  @Test
  fun aRowInAnUnknownFormatIsSkippedNotFatal() {
    dropped(1_000)
    val stored = prefs.getString("entries", null)!!
    prefs.edit().putString("entries", "garbage\n1\t2\tNOPE\tBR\t-\t1\t-\treason\n" + stored + "\nnot-a-number\t2\tDROPPED\tBR\t-\t1\t-\treason").apply()

    assertEquals(listOf(1_000L), log.entries().map { it.atMs })
    assertNull(DisconnectLog.decode("garbage"))
    assertNotNull(DisconnectLog.decode(DisconnectLog.encode(log.entries().single())))
  }

  @Test
  fun anUnknownLinkNameReadsAsNoLink() {
    val line = "1\t1\tDROPPED\tZIGBEE\t-\t1\t-\treason"
    assertNull(DisconnectLog.decode(line)!!.transport)
  }

  @Test
  fun theReportLinesNameWhenWhatLinkHowLongAndWhy() {
    dropped(1_000, phone = "screen off, battery saver", heldMs = 12 * 60_000)
    failed(2_000)
    failed(3_000)

    val lines = DisconnectLog.lines(log.entries()) { "t$it" }

    assertEquals("Disconnects (last 2, kept across restarts, oldest first):", lines[0])
    assertEquals("  t1000 link lost, held 12 min over Bluetooth Classic (RFCOMM) [screen off, battery saver]: Connection lost: closed by the watch", lines[1])
    assertEquals("  t2000 connect failed, 2 times until t3000 over Bluetooth LE (GATT): [ERR_TIMEOUT] Timed out after 45000 ms", lines[2])
    assertEquals(3, lines.size)
  }

  @Test
  fun holdTimesReadInSecondsMinutesAndHours() {
    fun held(ms: Long): String {
      val one = DisconnectLog(MemoryPrefs())
      one.record(DisconnectLog.Kind.DROPPED, ModelTransport.BR, ms, "", "r", 1)
      return DisconnectLog.lines(one.entries()) { "t" }[1]
    }

    assertTrue(held(45_000).contains("held 45 s"))
    assertTrue(held(30 * 60_000).contains("held 30 min"))
    assertTrue(held(3 * 3_600_000 + 5 * 60_000).contains("held 3 h 5 min"))
  }

  @Test
  fun thePhoneStateNamesOnlyWhatStopsBackgroundWork() {
    assertEquals("", DisconnectLog.phoneState(interactive = true, deviceIdle = false, powerSave = false, bluetoothOn = true))
    assertEquals(
      "screen off, idle mode (Doze), battery saver, Bluetooth off",
      DisconnectLog.phoneState(interactive = false, deviceIdle = true, powerSave = true, bluetoothOn = false),
    )
    assertFalse(DisconnectLog.phoneState(interactive = false, deviceIdle = false, powerSave = false, bluetoothOn = true).contains("Doze"))
  }
}
