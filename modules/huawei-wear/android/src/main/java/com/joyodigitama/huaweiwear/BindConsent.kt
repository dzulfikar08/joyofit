package com.joyodigitama.huaweiwear

import java.io.IOException
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CancellationException
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiCoordinator.HuaweiDeviceType

/**
 * Whether a connect may start a first bind. A watch keeps one phone credential and a first bind (PinCode, HiChain operationCode 1)
 * replaces the credential of the phone that holds it, so only an interactive connect the user confirmed may do it.
 */
internal object FirstBind {
  const val MESSAGE =
    "This watch has to be paired with this phone first. Pairing replaces the watch's current phone pairing."

  /** SecurityNegotiation authType of authMode 4: the watch does not know this phone's authId. */
  const val AUTH_TYPE_UNKNOWN_PHONE = 5

  /** SecurityNegotiation authType of authMode 4: the watch knows this phone's authId. */
  const val AUTH_TYPE_KNOWN_PHONE = 6

  /** What the authenticator follows: [firstConnection] and the line for the log that says why. */
  class Decision(val firstConnection: Boolean, val note: String)

  /**
   * The HiChain first-bind decision, as the iOS port makes it. A stored key the watch does not recognise (authMode 4, authType 5:
   * another phone bound the watch since) is a first bind, not an operationCode 2 that the watch refuses. The watch knowing this
   * phone (authType 6) while no bind is stored here follows the local state.
   */
  fun decide(authMode: Int, authType: Int, storedFirstConnection: Boolean): Decision = when {
    authMode == 4 && authType == AUTH_TYPE_UNKNOWN_PHONE && !storedFirstConnection -> Decision(
      true,
      "the watch does not know this identity (authType 5) although a bind key is stored locally: first bind (PinCode, HiChain op 1, op 2)",
    )
    authMode == 4 && authType == AUTH_TYPE_KNOWN_PHONE && storedFirstConnection -> Decision(
      true,
      "the watch already knows this identity (authType 6) but no bind is stored locally: following the local state (first bind)",
    )
    authMode == 4 -> Decision(storedFirstConnection, "the watch and the local state agree (authType $authType, firstConnection=$storedFirstConnection)")
    else -> Decision(storedFirstConnection, "firstConnection=$storedFirstConnection")
  }

  /** True when the authentication has to stop before any PinCode request: a first bind is needed and nobody confirmed it. */
  fun needsConfirmation(firstConnection: Boolean, firstBindAllowed: Boolean): Boolean = firstConnection && !firstBindAllowed

  /** First Android release whose stack asks for ATT MTU 517 whatever the app requests (UPSIDE_DOWN_CAKE). */
  const val ANDROID_14_SDK = 34

  /**
   * Said when the reply to HiChain operationCode 1 step 1 never arrived on a phone that cannot receive it: over Bluetooth LE
   * (not RFCOMM) on Android 14+, the watch answers in 514-byte notifications and the stack discards them (protocol/README.md,
   * 2026-10-16 bind lab). Null where the cause may be something else (Classic link, Android 13 and older).
   */
  fun leStepOneTimeoutHint(deviceType: HuaweiDeviceType, sdk: Int): String? =
    if (deviceType != HuaweiDeviceType.BR && sdk >= ANDROID_14_SDK) {
      "Android 14 and newer cannot receive the watch's first pairing reply over Bluetooth LE (the system drops 514-byte notifications), " +
        "so this watch cannot be paired with this phone. A phone with Android 13 or older does not have this limit"
    } else {
      null
    }
}

/**
 * The watches the user confirmed a first bind for (`confirmBind`). One use per address: [take] consumes it, and it is dropped by
 * [clear] (disconnect, forget). Only the interactive connect takes it, so the background reconnect can never use it.
 */
internal class BindConsent {
  private val confirmed: MutableSet<String> = ConcurrentHashMap.newKeySet()

  fun grant(address: String) {
    confirmed.add(normalize(address))
  }

  /** True once for an address that was granted. */
  fun take(address: String): Boolean = confirmed.remove(normalize(address))

  fun clear(address: String) {
    confirmed.remove(normalize(address))
  }

  fun clearAll() = confirmed.clear()

  private fun normalize(address: String) = address.trim().uppercase(Locale.ROOT)
}

/** The Bluetooth LE link of a connect attempt ended after the GATT callbacks reported it ([statusText] is in the message). */
internal class LinkEndedException(message: String) : IOException(message)

/** What [WearLink.connect] rejects with, as one coded [WearException]; [closeCause] is what closed the connection, if anything. */
internal fun connectFailure(t: Throwable, closeCause: WearException?): WearException = when {
  closeCause != null && (t !is WearException || t.errorCode == ErrorCodes.DISCONNECTED || t.errorCode == ErrorCodes.CONNECT_FAILED) -> closeCause
  t is WearException -> t
  else -> WearException(ErrorCodes.CONNECT_FAILED, "Connect failed: ${t.message ?: t.javaClass.simpleName}", t)
}

/**
 * The error text the `disconnected` state event carries after a failed connect. A stop for the bind confirmation is not an error:
 * JS shows a confirmation dialog for the rejection, so the state event stays without text.
 */
internal fun stateError(failure: WearException): String? = if (failure.errorCode == ErrorCodes.BIND_CONFIRMATION) null else failure.message

/** True when the failure of one link is worth moving the same connect to the other one: not a permission problem, which both links share, and not a cancel. */
internal fun shouldTryOtherLink(t: Throwable): Boolean =
  t !is CancellationException && t !is SecurityException && !(t is WearException && t.errorCode == ErrorCodes.BLUETOOTH_PERMISSION)

/** The LE failure after RFCOMM failed first: the LE code stays, the message also says what Classic did. */
internal fun afterRfcommFailure(le: WearException, rfcomm: Throwable): WearException {
  val rfcommText = rfcomm.message ?: rfcomm.javaClass.simpleName
  return WearException(le.errorCode, "${le.message} (Bluetooth Classic RFCOMM had failed first: $rfcommText)", le, le.statusCode)
}

/** The RFCOMM failure after LE failed first: the LE code and text stay (LE was the link the watch's model asked for), the message also says what Classic did. */
internal fun afterLeFailure(le: Throwable, rfcomm: Throwable): WearException {
  val first = le as? WearException ?: WearException(ErrorCodes.CONNECT_FAILED, "Connect failed: ${le.message ?: le.javaClass.simpleName}", le)
  val rfcommText = rfcomm.message ?: rfcomm.javaClass.simpleName
  return WearException(first.errorCode, "${first.message} (Bluetooth Classic RFCOMM was tried next and failed too: $rfcommText)", first, first.statusCode)
}
