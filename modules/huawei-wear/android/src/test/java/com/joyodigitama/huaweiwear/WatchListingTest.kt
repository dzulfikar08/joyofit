package com.joyodigitama.huaweiwear

import android.bluetooth.BluetoothDevice
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class WatchListingTest {
  private val gt6 = "AA:BB:CC:DD:EE:01"
  private val gt6Name = "HUAWEI WATCH GT 6-1A2"
  private val band = "AA:BB:CC:DD:EE:02"
  private val bandName = "HUAWEI Band 9-ABC"
  private val earphones = "AA:BB:CC:DD:EE:03"

  private fun rows(
    paired: List<SystemPaired> = emptyList(),
    linked: DiscoveredDevice? = null,
    remembered: SystemPaired? = null,
    scan: Map<String, String> = emptyMap(),
  ) = WatchListing.build(paired, linked, remembered, scan)

  private fun List<DiscoveredDevice>.at(address: String) = single { it.address == address }

  @Test
  fun aWatchAndroidListsAsPairedIsListedAsPaired() {
    val list = rows(paired = listOf(SystemPaired(gt6, gt6Name)))
    val row = list.single()
    assertEquals(gt6Name, row.name)
    assertEquals("Huawei Watch GT 6", row.model)
    assertEquals(true, row.paired)
    assertEquals(true, row.classic)
    assertFalse(row.remembered)
  }

  @Test
  fun theRememberedWatchIsListedEvenWhenAndroidDoesNotListItAsPaired() {
    val list = rows(remembered = SystemPaired(gt6, gt6Name))
    val row = list.single()
    assertEquals(gt6, row.address)
    assertEquals(gt6Name, row.name)
    assertEquals("Huawei Watch GT 6", row.model)
    assertEquals(false, row.paired)
    assertEquals(true, row.classic)
    assertTrue(row.remembered)
  }

  @Test
  fun theRememberedWatchThatAndroidAlsoListsIsOneRowMarkedRemembered() {
    val list = rows(paired = listOf(SystemPaired(gt6, gt6Name)), remembered = SystemPaired(gt6, "an older name"))
    val row = list.single()
    assertEquals("the system's name wins", gt6Name, row.name)
    assertEquals(true, row.paired)
    assertTrue(row.remembered)
  }

  @Test
  fun aRememberedBandIsNeverReportedAsMissingAndroidPairing() {
    // Bands are not paired in Android at all: the row must not suggest a lost pairing.
    val row = rows(remembered = SystemPaired(band, bandName)).single()
    assertEquals(false, row.paired)
    assertEquals(false, row.classic)
    assertTrue(row.remembered)
  }

  @Test
  fun aRememberedWatchWithoutANameKeepsItsAddressAndStaysConnectable() {
    val row = rows(remembered = SystemPaired(gt6, null)).single()
    assertEquals(gt6, row.name)
    assertNull(row.model)
    assertNull(row.classic)
    assertEquals("unknown", row.support)
    assertTrue(row.remembered)
  }

  @Test
  fun theLinkInUseIsListedOnceWhateverElseKnowsIt() {
    val linked = DiscoveredDevice(address = gt6, name = gt6Name, model = "Huawei Watch GT 6", support = "experimental", classic = true)
    val list = rows(linked = linked, remembered = SystemPaired(gt6, gt6Name))
    val row = list.single()
    assertEquals(false, row.paired)
    assertTrue(row.remembered)
    assertEquals("Huawei Watch GT 6", row.model)

    val system = rows(paired = listOf(SystemPaired(gt6, gt6Name)), linked = linked).single()
    assertEquals("a paired watch keeps its paired flag", true, system.paired)
  }

  @Test
  fun scanResultsAddOnlyConnectableWatchesNotAlreadyListed() {
    val list = rows(
      paired = listOf(SystemPaired(gt6, gt6Name)),
      scan = mapOf(gt6 to "scan name", band to bandName, earphones to "HUAWEI FreeBuds 5"),
    )
    assertEquals(setOf(gt6, band), list.map { it.address }.toSet())
    assertEquals("a scan never renames a listed watch", gt6Name, list.at(gt6).name)
    assertEquals(false, list.at(band).paired)
    assertFalse(list.at(band).remembered)
  }

  @Test
  fun rowsAreSortedByNameWithoutRegardToCase() {
    val list = rows(
      paired = listOf(SystemPaired(band, "huawei band 9-abc"), SystemPaired(gt6, gt6Name)),
      remembered = SystemPaired("AA:BB:CC:DD:EE:04", "Alpha watch"),
    )
    assertEquals(listOf("Alpha watch", "huawei band 9-abc", gt6Name), list.map { it.name })
  }

  @Test
  fun theJsRowCarriesTheFlagsOnlyWhenTheyAreKnown() {
    val remembered = rows(remembered = SystemPaired(gt6, gt6Name)).single().toJs()
    assertEquals(false, remembered["paired"])
    assertEquals(true, remembered["remembered"])
    assertEquals(true, remembered["classic"])

    val scanned = DiscoveredDevice(address = band, name = bandName, rssi = -60).toJs()
    assertFalse(scanned.containsKey("paired"))
    assertFalse(scanned.containsKey("remembered"))
    assertFalse(scanned.containsKey("classic"))
    assertEquals(-60, scanned["rssi"])
  }
}

class PairingStateTest {
  private val classic = WatchModels.match("HUAWEI WATCH GT 6-1A2")
  private val band = WatchModels.match("HUAWEI Band 9-ABC")
  private val unknown = WatchModels.match(null)

  private fun failure(code: String) = WearException(code, "native detail")

  @Test
  fun labelsNameEveryAndroidPairingState() {
    assertEquals("paired", PairingState.label(BluetoothDevice.BOND_BONDED))
    assertEquals("not paired", PairingState.label(BluetoothDevice.BOND_NONE))
    assertEquals("pairing in progress", PairingState.label(BluetoothDevice.BOND_BONDING))
    assertEquals("unknown", PairingState.label(null))
  }

  @Test
  fun aClassicWatchThatCouldNotBeReachedWithoutAPairingIsReportedAsNotPaired() {
    for (code in listOf(ErrorCodes.CONNECT_FAILED, ErrorCodes.TIMEOUT)) {
      val original = failure(code)
      val explained = PairingState.explain(original, classic, BluetoothDevice.BOND_NONE)
      assertEquals(ErrorCodes.NOT_PAIRED, explained.errorCode)
      assertTrue(explained.message!!.startsWith(PairingState.NOT_PAIRED_NOTE))
      assertTrue("keeps what failed", explained.message!!.endsWith("native detail"))
    }
  }

  @Test
  fun everyOtherFailureKeepsItsOwnCode() {
    for (code in listOf(ErrorCodes.AUTH_FAILED, ErrorCodes.BIND_CONFIRMATION, ErrorCodes.DISCONNECTED, ErrorCodes.BLUETOOTH_PERMISSION)) {
      val original = failure(code)
      assertSame(code, original, PairingState.explain(original, classic, BluetoothDevice.BOND_NONE))
    }
  }

  @Test
  fun aPairedOrPairingWatchIsNeverBlamedOnThePairing() {
    val original = failure(ErrorCodes.TIMEOUT)
    assertSame(original, PairingState.explain(original, classic, BluetoothDevice.BOND_BONDED))
    assertSame(original, PairingState.explain(original, classic, BluetoothDevice.BOND_BONDING))
    assertSame("unreadable state is no evidence", original, PairingState.explain(original, classic, null))
  }

  @Test
  fun bandsAndUnlistedNamesAreNotPairedInAndroidByDesign() {
    val original = failure(ErrorCodes.CONNECT_FAILED)
    assertSame(original, PairingState.explain(original, band, BluetoothDevice.BOND_NONE))
    assertSame(original, PairingState.explain(original, unknown, BluetoothDevice.BOND_NONE))
    assertNotNull(classic.model)
  }

  @Test
  fun anAutomaticReconnectLeavesAClassicWatchWithoutAPairingToThePerson() {
    // Connecting would make Android start a pairing (a system dialog); only a connect the person opened may do that.
    assertTrue(PairingState.missing(classic, BluetoothDevice.BOND_NONE))
    assertFalse(PairingState.missing(classic, BluetoothDevice.BOND_BONDED))
    assertFalse(PairingState.missing(classic, BluetoothDevice.BOND_BONDING))
    assertFalse(PairingState.missing(classic, null))
    assertFalse("a band is never paired in Android", PairingState.missing(band, BluetoothDevice.BOND_NONE))
    assertFalse("an unlisted name is not known to be Classic", PairingState.missing(unknown, BluetoothDevice.BOND_NONE))
  }
}

class LeConnectPlanTest {
  @Test
  fun onlyTheLastAttemptUsesAutoConnectAndWaitsForTheWholeBudget() {
    assertFalse(LeConnectPlan.usesAutoConnect(1))
    assertFalse(LeConnectPlan.usesAutoConnect(2))
    assertTrue(LeConnectPlan.usesAutoConnect(3))
    assertEquals(LeConnectPlan.DIRECT_ATTEMPT_MS, LeConnectPlan.attemptBudgetMs(1))
    assertEquals(LeConnectPlan.DIRECT_ATTEMPT_MS, LeConnectPlan.attemptBudgetMs(2))
    assertNull(LeConnectPlan.attemptBudgetMs(3))
  }

  @Test
  fun aDirectAttemptGivesUpBeforeAndroidWouldAndBeforeTheConnectDeadline() {
    // Android's own direct connect gives up after about 30 s; the old whole-connect deadline was 26 s, so autoConnect was never reached.
    assertTrue(LeConnectPlan.DIRECT_ATTEMPT_MS < 30_000L)
    val deadline = LeConnectPlan.totalMs(Timeouts.CONNECT_MS)
    val beforeAutoConnect = LeConnectPlan.SCAN_MS + 2 * (LeConnectPlan.DIRECT_ATTEMPT_MS + LeConnectPlan.RETRY_DELAY_MS)
    assertTrue(deadline > beforeAutoConnect)
    assertEquals("the autoConnect attempt gets the budget the caller asked for", Timeouts.CONNECT_MS, deadline - beforeAutoConnect)
  }

  @Test
  fun aClassicWatchWhoseRfcommFailedOnlyChecksLeBriefly() {
    assertTrue(Timeouts.LE_AFTER_RFCOMM_MS < Timeouts.CONNECT_MS)
    assertEquals(
      LeConnectPlan.SCAN_MS + 2 * (LeConnectPlan.DIRECT_ATTEMPT_MS + LeConnectPlan.RETRY_DELAY_MS) + Timeouts.LE_AFTER_RFCOMM_MS,
      LeConnectPlan.totalMs(Timeouts.LE_AFTER_RFCOMM_MS),
    )
  }
}
