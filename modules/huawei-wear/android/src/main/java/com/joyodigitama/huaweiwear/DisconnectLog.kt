package com.joyodigitama.huaweiwear

import android.content.SharedPreferences

/** The last [DisconnectLog.CAPACITY] links that ended on their own or never opened, kept apart from the rolling log of the support report. */
internal class DisconnectLog(private val prefs: SharedPreferences, private val capacity: Int = CAPACITY) {
  enum class Kind(val label: String) {
    /** A link that had been established, then ended by itself (the watch or Android closed it). */
    DROPPED("link lost"),

    /** A connect attempt that never reached the connected state. */
    FAILED("connect failed"),
  }

  /**
   * One row. [atMs] is when it happened first and [lastAtMs] when it happened last: an attempt that fails the same way again and again
   * (the background reconnect with its backoff) is one row with a [count], so a failing loop cannot push out the drop that started it.
   */
  data class Entry(
    val atMs: Long,
    val lastAtMs: Long,
    val kind: Kind,
    val transport: ModelTransport?,
    /** How long the link had held before it dropped ([Kind.DROPPED]); null for a failed attempt. */
    val heldMs: Long?,
    val count: Int,
    /** What the phone was doing, from [phoneState]; empty when nothing stood out. */
    val phone: String,
    val reason: String,
  )

  /** Appends a row, or counts one more on the last row when it is the same failed attempt. Oldest rows go past [capacity]. */
  @Synchronized
  fun record(kind: Kind, transport: ModelTransport?, heldMs: Long?, phone: String, reason: String, atMs: Long = System.currentTimeMillis()) {
    val text = clean(reason)
    val rows = read().toMutableList()
    val last = rows.lastOrNull()
    if (kind == Kind.FAILED && last != null && last.kind == Kind.FAILED && last.transport == transport && last.reason == text) {
      rows[rows.lastIndex] = last.copy(lastAtMs = atMs, count = last.count + 1, phone = phone)
    } else {
      rows.add(Entry(atMs, atMs, kind, transport, heldMs, 1, phone, text))
    }
    while (rows.size > capacity) rows.removeAt(0)
    prefs.edit().putString(KEY_ENTRIES, rows.joinToString("\n") { encode(it) }).apply()
  }

  /** Oldest first. */
  @Synchronized
  fun entries(): List<Entry> = read()

  private fun read(): List<Entry> =
    prefs.getString(KEY_ENTRIES, null).orEmpty().lineSequence().mapNotNull { decode(it) }.toList()

  companion object {
    const val CAPACITY = 30
    private const val KEY_ENTRIES = "entries"
    private const val MAX_REASON = 240

    /** A reason is one line of plain text: the storage format and the report both rely on it. */
    internal fun clean(reason: String): String {
      val flat = reason.replace(Regex("\\s+"), " ").trim()
      return if (flat.length > MAX_REASON) flat.take(MAX_REASON - 3) + "..." else flat
    }

    internal fun encode(e: Entry): String =
      listOf(e.atMs, e.lastAtMs, e.kind.name, e.transport?.name ?: "-", e.heldMs ?: "-", e.count, e.phone.ifEmpty { "-" }, e.reason).joinToString("\t")

    /** Null for a row that is not in this format (an older or damaged one): it is dropped rather than failing the report. */
    internal fun decode(line: String): Entry? {
      val parts = line.split('\t', limit = 8)
      if (parts.size != 8) return null
      val kind = Kind.values().firstOrNull { it.name == parts[2] } ?: return null
      return Entry(
        atMs = parts[0].toLongOrNull() ?: return null,
        lastAtMs = parts[1].toLongOrNull() ?: return null,
        kind = kind,
        transport = ModelTransport.values().firstOrNull { it.name == parts[3] },
        heldMs = parts[4].toLongOrNull(),
        count = parts[5].toIntOrNull() ?: return null,
        phone = parts[6].takeIf { it != "-" }.orEmpty(),
        reason = parts[7],
      )
    }

    /** `screen off, idle mode, battery saver`: the Android power states that stop background work, for the rows of the report. */
    fun phoneState(interactive: Boolean, deviceIdle: Boolean, powerSave: Boolean, bluetoothOn: Boolean): String =
      listOfNotNull(
        "screen off".takeIf { !interactive },
        "idle mode (Doze)".takeIf { deviceIdle },
        "battery saver".takeIf { powerSave },
        "Bluetooth off".takeIf { !bluetoothOn },
      ).joinToString(", ")

    /**
     * The report lines, oldest first: when, what, the link, how long it had held, what the phone was doing and why. [stamp] formats a time
     * (the report uses the phone's zone); a row repeated [Entry.count] times says so and when it last happened.
     */
    fun lines(entries: List<Entry>, stamp: (Long) -> String): List<String> {
      if (entries.isEmpty()) return listOf("Disconnects: none recorded")
      val out = ArrayList<String>()
      out.add("Disconnects (last ${entries.size}, kept across restarts, oldest first):")
      for (e in entries) {
        val repeat = if (e.count > 1) ", ${e.count} times until ${stamp(e.lastAtMs)}" else ""
        val held = e.heldMs?.let { ", held ${duration(it)}" }.orEmpty()
        val phone = if (e.phone.isEmpty()) "" else " [${e.phone}]"
        out.add("  ${stamp(e.atMs)} ${e.kind.label}$repeat${held} over ${e.transport?.label ?: "an unknown link"}$phone: ${e.reason}")
      }
      return out
    }

    private fun duration(ms: Long): String {
      val seconds = ms / 1000
      return when {
        seconds < 120 -> "$seconds s"
        seconds < 2 * 3600 -> "${seconds / 60} min"
        else -> "${seconds / 3600} h ${seconds % 3600 / 60} min"
      }
    }
  }
}
