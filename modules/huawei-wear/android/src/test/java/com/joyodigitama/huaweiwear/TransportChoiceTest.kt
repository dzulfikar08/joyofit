package com.joyodigitama.huaweiwear

import java.io.IOException
import kotlinx.coroutines.CancellationException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The reported case: a HUAWEI Band 11 Pro-107 (Candy-B49WG, Infinix X6882) connected over RFCOMM the first time, when Android gave the
 * device no name and it was tried as an unlisted watch. The name was stored after that, and every reconnect asked the model table, which
 * lists the Band 11 Pro as LE: 45 s of GATT attempts that this watch never answers.
 */
class TransportChoiceTest {
  private val bandName = "HUAWEI Band 11 Pro-107"
  private val band = WatchModels.match(bandName)
  private val gt6 = WatchModels.match("HUAWEI WATCH GT 6-1A2")
  private val unnamed = WatchModels.match(null)

  private fun first(
    model: ModelMatch,
    remembered: ModelTransport? = null,
    leOnlyDevice: Boolean = false,
    forceBle: Boolean = false,
  ) = TransportChoice.first(model, leOnlyDevice, remembered, forceBle)

  private val timeout = WearException(ErrorCodes.TIMEOUT, "Timed out after 45000 ms")

  private fun fallback(
    first: ModelTransport,
    remembered: ModelTransport? = null,
    forceBle: Boolean = false,
    bonded: Boolean = false,
    allowPairing: Boolean = false,
    failure: Throwable = timeout,
  ) = TransportChoice.fallback(first, remembered, forceBle, bonded, allowPairing, failure)

  // The choice of the first link

  @Test
  fun theReportedBandReconnectsOverTheLinkItWorkedOnNotTheTablesGuess() {
    // First connect: Android had no name for the device, so it was an unlisted name and went over RFCOMM, which answered.
    assertEquals(ModelTransport.BR, first(unnamed))
    // Without a memory the stored name sent the next connect to LE: the bug.
    assertEquals(ModelTransport.LE, first(band))
    // With the memory of the connect that worked, the same name stays on RFCOMM.
    assertEquals(ModelTransport.BR, first(band, remembered = ModelTransport.BR))
  }

  @Test
  fun theRememberedLinkOutranksTheTableBothWays() {
    assertEquals(ModelTransport.BR, first(band, remembered = ModelTransport.BR))
    assertEquals(ModelTransport.LE, first(gt6, remembered = ModelTransport.LE))
  }

  @Test
  fun withNothingRememberedAListedModelUsesItsOwnLink() {
    assertEquals(ModelTransport.BR, first(gt6))
    assertEquals(ModelTransport.LE, first(band))
    // The table is the guess whatever Android says of the device.
    assertEquals(ModelTransport.BR, first(gt6, leOnlyDevice = true))
  }

  @Test
  fun anUnlistedNameWithNothingRememberedFollowsWhatAndroidKnowsOfTheDevice() {
    assertEquals(ModelTransport.BR, first(unnamed))
    assertEquals(ModelTransport.LE, first(unnamed, leOnlyDevice = true))
    assertEquals(ModelTransport.BR, first(unnamed, remembered = ModelTransport.BR, leOnlyDevice = true))
  }

  @Test
  fun theDeveloperSwitchOverridesEverythingForThatConnectOnly() {
    assertEquals(ModelTransport.LE, first(gt6, remembered = ModelTransport.BR, forceBle = true))
    assertEquals(ModelTransport.LE, first(unnamed, forceBle = true))
    // The switch off again: the remembered link is back in charge.
    assertEquals(ModelTransport.BR, first(gt6, remembered = ModelTransport.BR))
  }

  @Test
  fun knownIsOnlyWhatThereIsEvidenceFor() {
    assertEquals(ModelTransport.BR, TransportChoice.known(gt6, null))
    assertEquals(ModelTransport.LE, TransportChoice.known(band, null))
    assertNull("a name in no list is a guess, not evidence", TransportChoice.known(unnamed, null))
    assertEquals(ModelTransport.BR, TransportChoice.known(unnamed, ModelTransport.BR))
    assertEquals(ModelTransport.BR, TransportChoice.known(band, ModelTransport.BR))
  }

  // Moving to the other link when the first one did not open

  @Test
  fun aClassicLinkThatDidNotOpenAlwaysTriesLe() {
    assertEquals(ModelTransport.LE, fallback(ModelTransport.BR))
    assertEquals(ModelTransport.LE, fallback(ModelTransport.BR, remembered = ModelTransport.BR))
    assertEquals(ModelTransport.LE, fallback(ModelTransport.BR, failure = IOException("read failed, socket might closed")))
  }

  @Test
  fun anLeLinkThatDidNotOpenTriesClassicOnlyForAWatchLeNeverWorkedFor() {
    // A table that lists the wrong link: nothing remembered, and Android already holds a pairing, so no dialog can follow.
    assertEquals(ModelTransport.BR, fallback(ModelTransport.LE, bonded = true))
    // Or the person asked for this very connect (a tap), so a pairing prompt is theirs.
    assertEquals(ModelTransport.BR, fallback(ModelTransport.LE, allowPairing = true))
    // The background loop on a watch Android has no pairing with must not start one.
    assertNull(fallback(ModelTransport.LE))
    // A watch that connected over LE before is out of range now, not on the wrong link.
    assertNull(fallback(ModelTransport.LE, remembered = ModelTransport.LE, bonded = true, allowPairing = true))
  }

  @Test
  fun permissionProblemsCancelsAndTheDeveloperSwitchNeverMoveToTheOtherLink() {
    val denied = WearException(ErrorCodes.BLUETOOTH_PERMISSION, "denied")
    for (first in ModelTransport.values()) {
      assertNull(fallback(first, bonded = true, allowPairing = true, failure = denied))
      assertNull(fallback(first, bonded = true, allowPairing = true, failure = SecurityException("denied")))
      assertNull(fallback(first, bonded = true, allowPairing = true, failure = CancellationException("cancelled")))
      assertNull(fallback(first, forceBle = true, bonded = true, allowPairing = true))
    }
  }

  // What a connect that worked teaches

  @Test
  fun aLinkThatWorkedIsRememberedExceptTheDegradedLeAfterClassicFailed() {
    assertTrue(TransportChoice.shouldRemember(ModelTransport.BR, movedFrom = null, forceBle = false))
    assertTrue(TransportChoice.shouldRemember(ModelTransport.LE, movedFrom = null, forceBle = false))
    // LE reached only because Classic did not open (a stale pairing): the watch stays a Classic watch.
    assertFalse(TransportChoice.shouldRemember(ModelTransport.LE, movedFrom = ModelTransport.BR, forceBle = false))
    // Classic reached after LE did not open: that is the proof a wrong table needs.
    assertTrue(TransportChoice.shouldRemember(ModelTransport.BR, movedFrom = ModelTransport.LE, forceBle = false))
    // A forced LE link says nothing about the watch.
    assertFalse(TransportChoice.shouldRemember(ModelTransport.LE, movedFrom = null, forceBle = true))
  }

  @Test
  fun theWholeStoryOfTheReportedBandEndsOnRfcomm() {
    // 1. First connect, no name: RFCOMM opened, so RFCOMM is remembered.
    var remembered: ModelTransport? = null
    val firstLink = first(unnamed, remembered)
    assertEquals(ModelTransport.BR, firstLink)
    if (TransportChoice.shouldRemember(firstLink, movedFrom = null, forceBle = false)) remembered = firstLink
    // 2. The link drops; the name is known now. The reconnect goes to RFCOMM again, not to GATT.
    assertEquals(ModelTransport.BR, first(band, remembered))

    // A phone that updated with the name already stored and nothing remembered: LE fails, the person taps Connect, RFCOMM answers.
    val stuck: ModelTransport? = null
    assertEquals(ModelTransport.LE, first(band, stuck))
    assertEquals(ModelTransport.BR, fallback(ModelTransport.LE, stuck, allowPairing = true))
    assertTrue(TransportChoice.shouldRemember(ModelTransport.BR, movedFrom = ModelTransport.LE, forceBle = false))
    // From then on it opens RFCOMM first, in the background loop too.
    assertEquals(ModelTransport.BR, first(band, remembered = ModelTransport.BR))
  }

  // The memory itself

  private val a = "AA:AA:AA:AA:AA:01"
  private val b = "BB:BB:BB:BB:BB:02"
  private val files = HashMap<String, MemoryPrefs>()
  private val store = DeviceStore { name -> files.getOrPut(name) { MemoryPrefs() } }

  @Test
  fun aWatchHasNoRememberedLinkUntilOneWorked() {
    assertNull(store.forDevice(a).linkTransport)
  }

  @Test
  fun theRememberedLinkSurvivesANewStoreOverTheSameFilesAndBelongsToOneWatch() {
    store.forDevice(a).linkTransport = ModelTransport.BR
    store.forDevice(b).linkTransport = ModelTransport.LE

    val reopened = DeviceStore { name -> files.getOrPut(name) { MemoryPrefs() } }
    assertEquals(ModelTransport.BR, reopened.forDevice(a).linkTransport)
    assertEquals(ModelTransport.LE, reopened.forDevice(b).linkTransport)
    assertEquals("the address is case-insensitive like the rest of the identity", ModelTransport.BR, reopened.forDevice(a.lowercase()).linkTransport)
  }

  @Test
  fun forgettingAWatchForgetsItsLinkAndLeavesTheOthers() {
    store.forDevice(a).linkTransport = ModelTransport.BR
    store.forDevice(b).linkTransport = ModelTransport.BR

    store.forget(a)

    assertNull(store.forDevice(a).linkTransport)
    assertEquals(ModelTransport.BR, store.forDevice(b).linkTransport)
  }

  @Test
  fun aStoredValueThatIsNotALinkReadsAsNothingRemembered() {
    files.getOrPut(identityPrefsName(a)) { MemoryPrefs() }.edit().putString("link_transport", "ZIGBEE").apply()
    assertNull(store.forDevice(a).linkTransport)
  }

  @Test
  fun settingNullClearsTheMemory() {
    store.forDevice(a).linkTransport = ModelTransport.LE
    store.forDevice(a).linkTransport = null
    assertNull(store.forDevice(a).linkTransport)
  }
}
