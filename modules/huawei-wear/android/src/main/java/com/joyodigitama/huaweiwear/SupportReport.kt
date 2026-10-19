package com.joyodigitama.huaweiwear

import android.content.Context
import android.os.Build
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Log lines kept in the process for the support report, so it also covers connects no screen saw (the background
 * service). The lines of the last connect attempt are kept apart from the rolling tail: a day of syncs cannot push
 * out what the watch answered while connecting, which is what a report on a new model is for.
 */
internal class SupportLog {
  internal class Line(val seq: Long, val atMs: Long, val text: String)

  private var connect = ArrayList<Line>()
  private val tail = ArrayDeque<Line>()
  private var seq = 0L

  /** A connect attempt starts: from here, lines also go to the connect part until it is full. */
  @Synchronized
  fun connectStarted() {
    connect = ArrayList()
  }

  @Synchronized
  fun add(text: String, atMs: Long = System.currentTimeMillis()) {
    val line = Line(seq++, atMs, text)
    if (connect.size < CONNECT_LINES) connect.add(line)
    tail.addLast(line)
    if (tail.size > TAIL_LINES) tail.removeFirst()
  }

  /** The connect part and the tail, oldest first, each line once. */
  @Synchronized
  fun lines(): List<Line> = (connect + tail).distinctBy { it.seq }.sortedBy { it.seq }

  companion object {
    const val CONNECT_LINES = 600
    const val TAIL_LINES = 400
  }
}

internal object SupportReport {
  private val MAC = Regex("(?i)\\b[0-9a-f]{2}(?::[0-9a-f]{2}){5}\\b")
  private val SERIAL = Regex("(?i)serial=\\S+")

  /** Bluetooth addresses and the serial number are left out: the report is shared with people outside the app. */
  fun redact(text: String, serial: String?): String {
    var out = MAC.replace(text, "XX:XX:XX:XX:XX:XX")
    out = SERIAL.replace(out, "serial=(left out)")
    if (!serial.isNullOrBlank() && serial.length >= 4) out = out.replace(serial, "(serial left out)")
    return out
  }

  /** `SupportReport` in `HuaweiWear.types.ts`: the summary (fits a GitHub issue link) apart from the long log. */
  fun build(
    context: Context,
    watchName: String?,
    device: Map<String, Any?>?,
    linkState: String,
    log: List<SupportLog.Line>,
    /** The link the last connect attempt opened; the same model name can need either, so it is recorded rather than derived. */
    transport: ModelTransport? = null,
    nowMs: Long = System.currentTimeMillis(),
    /**
     * Lines about why the link may drop (background mode, battery limits, the latest disconnects), put right after `Link:` so the cut of the
     * GitHub issue link (it keeps only the start of the summary) never loses them.
     */
    connection: List<String> = emptyList(),
    /** Every kept disconnect row, at the top of the log part: the summary holds only the latest few. */
    disconnectLog: List<String> = emptyList(),
    /** Feature lines kept apart from the capability dump (weather pushes, night HRV), each already one line. */
    extraSummary: List<String> = emptyList(),
  ): Map<String, Any?> {
    val serial = device?.get("serialNumber") as String?
    val name = device?.get("name") as String? ?: watchName
    val match = WatchModels.match(name)
    val stamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss Z", Locale.ROOT)
    val clock = SimpleDateFormat("HH:mm:ss.SSS", Locale.ROOT)
    val summary = StringBuilder()
    summary.appendLine("JoyoFit support report")
    summary.appendLine("Created: ${stamp.format(Date(nowMs))}")
    summary.appendLine("App: ${appVersion(context)}")
    summary.appendLine("Phone: ${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
    summary.appendLine("Watch: ${name ?: "none yet"}")
    summary.appendLine("Model: ${match.model?.name ?: "not in the list"} (${match.support.wire})")
    if (device != null) {
      summary.appendLine(
        "Product: ${device["productModel"] ?: "?"}, software ${device["softwareVersion"] ?: "?"}, " +
          "hardware ${device["hardwareVersion"] ?: "?"}, auth ${device["authMode"] ?: "?"}",
      )
    }
    summary.appendLine("Transport: ${transport?.label ?: "none yet"}")
    summary.appendLine("Link: $linkState")
    for (line in connection) summary.appendLine(line)
    val commands = DeviceCaps.supportedCommands
    if (commands.isNotEmpty()) {
      summary.appendLine("Supported commands (last connect, service: commands):")
      for ((service, list) in commands.toSortedMap()) {
        summary.appendLine("  %02x: %s".format(service, list.joinToString(" ") { "%02x".format(it.toInt() and 0xFF) }))
      }
    }
    summary.appendLine("ExpandCapability: ${DeviceCaps.expandCapabilities?.toHex() ?: "none"}")
    for (line in extraSummary) summary.appendLine(line)
    summary.append("Bluetooth addresses and the serial number are left out.")
    val text = StringBuilder()
    for (line in disconnectLog) text.appendLine(line)
    if (disconnectLog.isNotEmpty()) text.appendLine()
    text.appendLine("Log, oldest first (${log.size} lines):")
    var previous: Long? = null
    for (line in log) {
      if (previous != null && line.seq > previous + 1) text.appendLine("... ${line.seq - previous - 1} lines left out ...")
      text.append(clock.format(Date(line.atMs))).append(' ').appendLine(line.text)
      previous = line.seq
    }
    return mapOf(
      "summary" to redact(summary.toString(), serial),
      "log" to redact(text.toString(), serial),
      "watch" to name,
      "model" to match.model?.name,
      "support" to match.support.wire,
    )
  }

  private fun appVersion(context: Context): String =
    try {
      val info = context.packageManager.getPackageInfo(context.packageName, 0)
      "${context.packageName} ${info.versionName} (${if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()})"
    } catch (e: Exception) {
      context.packageName
    }
}
