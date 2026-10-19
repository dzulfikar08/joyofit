package com.joyodigitama.huaweiwear

/**
 * How [BleTransport] opens the GATT link of a watch it already knows by address: a scan for the advertiser, two direct connects, then one
 * with autoConnect, which Android keeps pending until the watch answers.
 *
 * A direct connect that gets no answer gives up by itself only after about 30 s (GATT status 147, protocol/README.md 2026-10-16), longer
 * than the whole connect used to be allowed, so the autoConnect attempt that waits for a watch which has just been switched on was never
 * reached. Each direct attempt is now cut off after [DIRECT_ATTEMPT_MS], and the autoConnect attempt gets the budget the caller asks for.
 */
internal object LeConnectPlan {
  /** Attempts at opening the link; the last one uses autoConnect. */
  const val ATTEMPTS = 3

  /** The pause between two attempts. */
  const val RETRY_DELAY_MS = 1_500L

  /** How long a direct (no autoConnect) attempt waits for the link before the next one starts. */
  const val DIRECT_ATTEMPT_MS = 8_000L

  /** How long the scan waits for the watch before falling back to the stored address. */
  const val SCAN_MS = 6_000L

  fun usesAutoConnect(attempt: Int): Boolean = attempt >= ATTEMPTS

  /** The longest [attempt] may wait for the link before the next one starts; null for the autoConnect attempt, which waits as long as the connect lasts. */
  fun attemptBudgetMs(attempt: Int): Long? = if (usesAutoConnect(attempt)) null else DIRECT_ATTEMPT_MS

  /** The deadline of a whole connect: the scan, the bounded direct attempts with their pauses, then [patientMs] for the autoConnect attempt. */
  fun totalMs(patientMs: Long): Long = SCAN_MS + (ATTEMPTS - 1) * (DIRECT_ATTEMPT_MS + RETRY_DELAY_MS) + patientMs
}
