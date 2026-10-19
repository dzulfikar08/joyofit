package com.joyodigitama.huaweiwear

/**
 * Which link a connect to a watch opens, and which one it moves to when that one does not open.
 *
 * The table in [WatchModels] is Gadgetbridge's list: what its coordinator for a model uses. It is a guess for a watch the app has not
 * connected to yet, and it can be wrong for one phone and watch: a Huawei Band 11 Pro (Candy-B49WG) that the table lists as LE answered
 * over RFCOMM, and its reconnects went to LE GATT for good once the watch's name was known (the first connect had no name, so it was
 * tried as an unlisted device, over RFCOMM). What actually opened the link and authenticated is therefore remembered per watch
 * ([DeviceIdentity.linkTransport]) and wins over the table.
 */
internal object TransportChoice {
  /** The link that is known to suit [model], not guessed: what worked for this watch before, else what the table lists; null for an unlisted name. */
  fun known(model: ModelMatch, remembered: ModelTransport?): ModelTransport? = remembered ?: model.model?.transport

  /**
   * The link to open first. [forceBle] is the developer switch (debug builds), which overrides everything for that connect only.
   * An unlisted name with nothing remembered follows what Android knows of the device ([ModelMatch.transportFor]).
   */
  fun first(model: ModelMatch, leOnlyDevice: Boolean, remembered: ModelTransport?, forceBle: Boolean): ModelTransport = when {
    forceBle -> ModelTransport.LE
    else -> known(model, remembered) ?: model.transportFor(leOnlyDevice)
  }

  /**
   * The link to move the same connect to when [first] did not open ([failure]), or null to give up.
   *
   * - Classic to LE: always (a stale Classic pairing fails SDP while LE still answers). It is a stopgap, see [shouldRemember].
   * - LE to Classic: only for a watch that LE never worked for ([remembered] null), the case of a table that lists the wrong link, and
   *   only where it cannot start a pairing the person did not ask for: Android already holds a pairing ([bonded]), or the person
   *   asked for this very connect ([allowPairing], `confirmPairing`). A watch that connected over LE before and now fails is out of range, not on the wrong link.
   */
  fun fallback(first: ModelTransport, remembered: ModelTransport?, forceBle: Boolean, bonded: Boolean, allowPairing: Boolean, failure: Throwable): ModelTransport? {
    if (forceBle || !shouldTryOtherLink(failure)) return null
    return when (first) {
      ModelTransport.BR -> ModelTransport.LE
      ModelTransport.LE -> if (remembered == null && (bonded || allowPairing)) ModelTransport.BR else null
    }
  }

  /**
   * True when the link of a connect that worked says something about the watch. LE reached only because Classic did not open is the
   * degraded way (Android 14+ drops the watch's longest notifications on LE): it must not replace the Classic link the watch is meant
   * to use, or a pairing fixed later would never be used again.
   */
  fun shouldRemember(opened: ModelTransport, movedFrom: ModelTransport?, forceBle: Boolean): Boolean =
    !forceBle && !(opened == ModelTransport.LE && movedFrom == ModelTransport.BR)
}
