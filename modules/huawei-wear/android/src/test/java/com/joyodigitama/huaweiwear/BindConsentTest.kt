package com.joyodigitama.huaweiwear

import java.io.IOException
import kotlinx.coroutines.CancellationException
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiCoordinator.HuaweiDeviceType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class BindConsentTest {
  @Test
  fun consentIsSingleUsePerAddress() {
    val consent = BindConsent()
    assertFalse(consent.take("AA:BB:CC:DD:EE:FF"))

    consent.grant("aa:bb:cc:dd:ee:ff")
    assertFalse(consent.take("11:22:33:44:55:66"))
    assertTrue(consent.take(" AA:BB:CC:DD:EE:FF "))
    assertFalse(consent.take("AA:BB:CC:DD:EE:FF"))
  }

  @Test
  fun clearDropsOneOrEveryConsent() {
    val consent = BindConsent()
    consent.grant("AA:BB:CC:DD:EE:FF")
    consent.grant("11:22:33:44:55:66")

    consent.clear("aa:bb:cc:dd:ee:ff")
    assertFalse(consent.take("AA:BB:CC:DD:EE:FF"))
    consent.clearAll()
    assertFalse(consent.take("11:22:33:44:55:66"))
  }

  @Test
  fun confirmationIsNeededOnlyForAnUnconfirmedFirstBind() {
    assertTrue(FirstBind.needsConfirmation(firstConnection = true, firstBindAllowed = false))
    assertFalse(FirstBind.needsConfirmation(firstConnection = true, firstBindAllowed = true))
    assertFalse(FirstBind.needsConfirmation(firstConnection = false, firstBindAllowed = false))
    assertFalse(FirstBind.needsConfirmation(firstConnection = false, firstBindAllowed = true))
  }

  @Test
  fun unknownPhoneWithAStoredKeyIsAFirstBind() {
    assertTrue(FirstBind.decide(authMode = 4, authType = 5, storedFirstConnection = false).firstConnection)
    assertTrue(FirstBind.decide(authMode = 4, authType = 5, storedFirstConnection = true).firstConnection)
  }

  @Test
  fun knownPhoneFollowsTheLocalState() {
    assertFalse(FirstBind.decide(authMode = 4, authType = 6, storedFirstConnection = false).firstConnection)
    assertTrue(FirstBind.decide(authMode = 4, authType = 6, storedFirstConnection = true).firstConnection)
  }

  @Test
  fun otherAuthModesFollowTheLocalStateOnly() {
    assertFalse(FirstBind.decide(authMode = 2, authType = 0x0186A0, storedFirstConnection = false).firstConnection)
    assertTrue(FirstBind.decide(authMode = 2, authType = 0x0186A0, storedFirstConnection = true).firstConnection)
    assertFalse(FirstBind.decide(authMode = 2, authType = 5, storedFirstConnection = false).firstConnection)
  }

  @Test
  fun closeCauseWinsOverTheFollowUpIoFailure() {
    val closed = WearException(ErrorCodes.DISCONNECTED, "Connection lost: the watch closed the link")

    assertSame(closed, connectFailure(IOException("socket closed"), closed))
    assertSame(closed, connectFailure(WearException(ErrorCodes.CONNECT_FAILED, "Bluetooth LE link closed"), closed))
    assertSame(closed, connectFailure(WearException(ErrorCodes.DISCONNECTED, "write failed"), closed))
  }

  @Test
  fun aFailureOfTheOperationItselfKeepsItsCode() {
    val closed = WearException(ErrorCodes.DISCONNECTED, "Disconnected")

    val timeout = WearException(ErrorCodes.TIMEOUT, "Authentication timed out: LinkParams")
    assertSame(timeout, connectFailure(timeout, closed))
    val auth = WearException(ErrorCodes.AUTH_FAILED, "Authentication failed: tokenCheck")
    assertSame(auth, connectFailure(auth, null))
    val bind = WearException(ErrorCodes.BIND_CONFIRMATION, FirstBind.MESSAGE)
    assertSame(bind, connectFailure(bind, null))
  }

  @Test
  fun everyOtherThrowableBecomesConnectFailed() {
    val io = connectFailure(IOException("read failed, socket might closed or timeout, read ret: -1"), null)
    assertEquals(ErrorCodes.CONNECT_FAILED, io.errorCode)
    assertTrue(io.message!!.contains("read ret: -1"))

    val raw = connectFailure(IllegalStateException("GATT busy"), null)
    assertEquals(ErrorCodes.CONNECT_FAILED, raw.errorCode)
    assertTrue(raw.message!!.contains("GATT busy"))

    val noMessage = connectFailure(NullPointerException(), null)
    assertEquals(ErrorCodes.CONNECT_FAILED, noMessage.errorCode)
    assertTrue(noMessage.message!!.contains("NullPointerException"))
  }

  @Test
  fun aFailedLinkMovesToTheOtherOneExceptForPermissionAndCancellation() {
    assertTrue(shouldTryOtherLink(WearException(ErrorCodes.CONNECT_FAILED, "SDP failed")))
    assertTrue(shouldTryOtherLink(WearException(ErrorCodes.TIMEOUT, "Timed out")))
    assertTrue(shouldTryOtherLink(IOException("socket")))
    assertFalse(shouldTryOtherLink(WearException(ErrorCodes.BLUETOOTH_PERMISSION, "denied")))
    assertFalse(shouldTryOtherLink(SecurityException("denied")))
    assertFalse(shouldTryOtherLink(CancellationException("cancelled")))
  }

  @Test
  fun leFailureAfterRfcommKeepsItsCodeAndNamesBoth() {
    val le = WearException(ErrorCodes.TIMEOUT, "Timed out after 26000 ms over Bluetooth LE while opening the GATT link")
    val failure = afterRfcommFailure(le, IOException("read failed, socket might closed"))

    assertEquals(ErrorCodes.TIMEOUT, failure.errorCode)
    assertTrue(failure.message!!.startsWith("Timed out after 26000 ms"))
    assertTrue(failure.message!!.contains("RFCOMM had failed first: read failed, socket might closed"))
  }

  @Test
  fun rfcommFailureAfterLeKeepsTheLeCodeAndNamesBoth() {
    val le = WearException(ErrorCodes.TIMEOUT, "Timed out after 45000 ms connecting to the watch over Bluetooth LE while opening the GATT link")
    val failure = afterLeFailure(le, WearException(ErrorCodes.CONNECT_FAILED, "RFCOMM connect failed: read failed, socket might closed"))

    assertEquals(ErrorCodes.TIMEOUT, failure.errorCode)
    assertTrue(failure.message!!.startsWith("Timed out after 45000 ms"))
    assertTrue(failure.message!!.contains("RFCOMM was tried next and failed too: RFCOMM connect failed: read failed, socket might closed"))
  }

  @Test
  fun anLeFailureThatIsNotCodedBecomesConnectFailedBeforeItIsCombined() {
    val failure = afterLeFailure(IllegalStateException("gatt gone"), IOException("closed"))

    assertEquals(ErrorCodes.CONNECT_FAILED, failure.errorCode)
    assertTrue(failure.message!!.startsWith("Connect failed: gatt gone"))
    assertTrue(failure.message!!.contains("failed too: closed"))
  }

  @Test
  fun bindConfirmationIsNotAnErrorInTheStateEvent() {
    assertNull(stateError(WearException(ErrorCodes.BIND_CONFIRMATION, FirstBind.MESSAGE)))
    assertEquals("Timed out", stateError(WearException(ErrorCodes.TIMEOUT, "Timed out")))
  }

  @Test
  fun stepOneTimeoutNamesTheAndroid14LeLimitOnlyWhereItApplies() {
    assertTrue(FirstBind.leStepOneTimeoutHint(HuaweiDeviceType.BLE, 34)!!.contains("Android 14"))
    assertTrue(FirstBind.leStepOneTimeoutHint(HuaweiDeviceType.AW, 35)!!.contains("514-byte"))
    assertNull(FirstBind.leStepOneTimeoutHint(HuaweiDeviceType.BLE, 33))
    assertNull(FirstBind.leStepOneTimeoutHint(HuaweiDeviceType.BR, 34))
  }
}
