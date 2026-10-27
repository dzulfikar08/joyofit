package com.joyodigitama.resttimer

/** What does not need Android to decide: kept apart so a plain JVM unit test covers it. */
internal object RestTimerSpec {
  /** The app's own link (`scheme` in app.json, route `strength/active`): a tap lands on the logger whatever screen was open last. */
  const val OPEN_URL = "joyofit://strength/active"

  /** The status bar and lock screen show at most this much of a title or text; a longer exercise name is cut here, not by the system mid-word. */
  const val MAX_TEXT = 80

  /** Milliseconds until the rest ends, or null when it already has (nothing to count down: the notification is removed instead). */
  fun timeoutMs(endsAt: Long, now: Long): Long? = (endsAt - now).takeIf { it > 0 }

  fun clip(text: String): String {
    val trimmed = text.trim()
    return if (trimmed.length <= MAX_TEXT) trimmed else trimmed.substring(0, MAX_TEXT - 1).trimEnd() + "\u2026"
  }
}
