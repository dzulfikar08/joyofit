package com.joyodigitama.huaweiwear

import org.json.JSONObject

/**
 * Constants and checks of watch navigation (JRG-439): P2P data between JoyoFit and its own watch app `com.joyodigitama.navi`
 * (`protocol/watch-nav.schema.json`). Twin: `WatchNavWire` in `WatchNavService.swift`.
 */
internal object WatchNavWire {
  const val PACKAGE = "com.joyodigitama.navi"

  /** Largest UTF-8 message sent in one P2P data packet. */
  const val MAX_BYTES = 1000

  /** The ping answer meaning the watch app is installed and running. */
  const val PING_PRESENT = 0xCA

  /** The data acknowledgement meaning the watch app received the message. */
  const val ACK_RECEIVED = 0xCF

  const val PLACEHOLDER_PREFIX = "PLACEHOLDER"

  fun isPlaceholder(fp: String): Boolean = fp.startsWith(PLACEHOLDER_PREFIX)

  /** `<t> n=<n>` of a message, for the log; `?` when it is not a JSON object, `?` for a missing or non-scalar part. Never throws. */
  fun summary(json: String): String = try {
    val obj = JSONObject(json)
    "${part(obj.opt("t"))} n=${part(obj.opt("n"))}"
  } catch (e: Exception) {
    "?"
  }

  private fun part(value: Any?): String = when (value) {
    is Number -> value.toDouble().let { d -> if (d.isFinite() && d == Math.floor(d)) d.toLong().toString() else value.toString() }
    is String, is Boolean -> value.toString()
    else -> "?"
  }

  /** Why [json] cannot be sent, or null when it can. */
  fun problem(json: String): String? {
    val size = json.toByteArray(Charsets.UTF_8).size
    return when {
      size == 0 -> "empty"
      size > MAX_BYTES -> "$size bytes, more than $MAX_BYTES"
      else -> null
    }
  }
}
