package com.joyodigitama.huaweiwear

import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.P2P
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.HuaweiP2PManager
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.HuaweiBaseP2PService

/**
 * LAB ONLY (JRG-434, not for master): the Petal Maps companion probe. The watch's built-in Petal Maps app (`com.huawei.ohos.maps.app`)
 * pings the phone package `com.huawei.maps.app` when it opens and shows "scan to download Petal Maps" when nobody answers. With the
 * experimental switch [P2pSettings.petalMapsProbe] on, [PetalMapsProbeService] answers that ping with 0xca ("app present", the watch's own
 * answer to our pings), acknowledges the app's messages (cmd 2) with 0xcf like every P2P service, and logs everything the app sends as
 * `PetalProbe:` lines (logcat tag `JoyoFit`). It sends nothing else and makes no network call. For 30 s after each ping it also logs what
 * the watch sends that nothing handles. Twin: `PetalMapsProbe.swift`.
 */
internal object PetalProbeWire {
  const val WATCH_PACKAGE = "com.huawei.ohos.maps.app"
  const val PHONE_PACKAGE = "com.huawei.maps.app"

  /** P2P code "the app is there", what the watch answers our own pings with. */
  const val PRESENT = 0xca

  /** The acknowledgement every P2P service sends for a message (`HuaweiBaseP2PService.onDataPacket`). */
  const val RECEIVED = 0xcf

  /** How long after a ping the frames nothing handles are logged. */
  const val WINDOW_MS = 30_000L

  /** Bytes per data line: their hex and text preview stay under logcat's line limit (about 4 KB). */
  const val CHUNK = 512

  /** TLV values longer than this are cut in the breakdown; the data lines hold every byte. */
  const val TLV_VALUE_MAX = 64

  const val TAG = "PetalProbe:"

  private const val MAX_DEPTH = 4

  fun registeredLine(): String =
    "$TAG registered for the watch app $WATCH_PACKAGE (phone package $PHONE_PACKAGE); pings answered 0x%02x, messages acknowledged 0x%02x, nothing else is sent"
      .format(PRESENT, RECEIVED)

  /** Every field of a P2P packet from the watch, then its data ([dump]). */
  fun describe(packet: P2P.P2PCommand.Response, label: String): List<String> {
    val cmd = packet.cmdId.toInt() and 0xFF
    val head = "$TAG $label cmd=$cmd seq=${packet.sequenceId} code=${packet.respCode} (0x${packet.respCode.toString(16)}) src=${packet.srcPackage} " +
      "dst=${packet.dstPackage} srcFp=${packet.srcFingerprint ?: "none"} dstFp=${packet.dstFingerprint ?: "none"}"
    return listOf(head) + dump("$label seq=${packet.sequenceId}", packet.respData)
  }

  /** A file the watch app sent. */
  fun file(name: String, data: ByteArray): List<String> = dump("rx file $name", data)

  /** A frame nothing handles, [sinceMs] after the ping: its decoded TLV ([tlv], null when undecodable) and the raw frame's size. */
  fun unhandled(service: Int, command: Int, tlv: ByteArray?, rawSize: Int, sinceMs: Long): List<String> {
    val label = "unhandled svc=%02x cmd=%02x".format(service, command)
    val head = "$TAG $label $sinceMs ms after the ping, raw frame $rawSize bytes (its hex is on the RX line above)"
    return listOf(head) + if (tlv == null) listOf("$TAG $label tlv undecodable") else dump(label, tlv)
  }

  /** The data lines: size, full hex with a text preview in [CHUNK]-byte pieces, then the TLV breakdown attempt. */
  fun dump(label: String, data: ByteArray?): List<String> {
    if (data == null) return listOf("$TAG $label data=none")
    if (data.isEmpty()) return listOf("$TAG $label data=0 bytes")
    val lines = ArrayList<String>()
    lines += "$TAG $label data=${data.size} bytes"
    val pieces = (data.size + CHUNK - 1) / CHUNK
    for (k in 0 until pieces) {
      val piece = data.copyOfRange(k * CHUNK, minOf(data.size, (k + 1) * CHUNK))
      lines += "$TAG $label hex[${k + 1}/$pieces] ${piece.toHex()} |${preview(piece)}|"
    }
    val elements = parseTlv(data, 0)
    if (elements == null) {
      lines += "$TAG $label tlv: not a Huawei TLV"
    } else {
      flatten(elements, "", label, lines)
    }
    return lines
  }

  /** UTF-8 text of [data] with every control character and undecodable byte shown as `.`. */
  fun preview(data: ByteArray): String {
    val text = String(data, Charsets.UTF_8)
    val out = StringBuilder(text.length)
    var i = 0
    while (i < text.length) {
      val cp = text.codePointAt(i)
      if (printable(cp)) out.appendCodePoint(cp) else out.append('.')
      i += Character.charCount(cp)
    }
    return out.toString()
  }

  private class Element(val tag: Int, val value: ByteArray, val children: List<Element>?)

  /** Huawei TLVs: tag byte, length as a 7-bit big-endian varint, value; tags with bit 0x80 may nest. Null unless every byte fits. */
  private fun parseTlv(data: ByteArray, depth: Int): List<Element>? {
    val out = ArrayList<Element>()
    var i = 0
    while (i < data.size) {
      val tag = data[i].toInt() and 0xFF
      i++
      var length = 0
      var digits = 0
      while (true) {
        if (i >= data.size || digits == 4) return null
        val b = data[i].toInt() and 0xFF
        i++
        digits++
        length = (length shl 7) or (b and 0x7F)
        if (b and 0x80 == 0) break
      }
      if (length > data.size - i) return null
      val value = data.copyOfRange(i, i + length)
      i += length
      val children = if (tag and 0x80 != 0 && depth < MAX_DEPTH && value.isNotEmpty()) parseTlv(value, depth + 1) else null
      out += Element(tag, value, children)
    }
    return if (out.isEmpty()) null else out
  }

  private fun flatten(elements: List<Element>, parent: String, label: String, into: MutableList<String>) {
    for (e in elements) {
      val path = parent + "%02X".format(e.tag)
      val children = e.children
      if (children != null) {
        into += "$TAG $label tlv $path len=${e.value.size}: nested"
        flatten(children, "$path.", label, into)
      } else {
        into += "$TAG $label tlv $path len=${e.value.size}: ${leaf(e.value)}"
      }
    }
  }

  private fun leaf(value: ByteArray): String {
    if (value.isEmpty()) return "(empty)"
    if (value.size > TLV_VALUE_MAX) return value.copyOfRange(0, TLV_VALUE_MAX).toHex() + "..."
    val parts = StringBuilder(value.toHex())
    if (value.size <= 4) {
      var n = 0L
      for (b in value) n = (n shl 8) or (b.toLong() and 0xFF)
      parts.append(" = ").append(n)
    }
    text(value)?.let { parts.append(" \"").append(it).append('"') }
    return parts.toString()
  }

  /** The value as text when it is valid UTF-8 of two or more printable characters. */
  private fun text(value: ByteArray): String? {
    if (value.size < 2) return null
    val decoded = try {
      Charsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(ByteBuffer.wrap(value))
        .toString()
    } catch (e: CharacterCodingException) {
      return null
    }
    var i = 0
    while (i < decoded.length) {
      val cp = decoded.codePointAt(i)
      if (!printable(cp)) return null
      i += Character.charCount(cp)
    }
    return decoded
  }

  private fun printable(cp: Int): Boolean = cp >= 0x20 && cp !in 0x7F..0x9F && cp != 0xFFFD
}

/** See [PetalProbeWire]. Registered by [P2pStack.registerPetalProbe] while the switch is on. */
internal class PetalMapsProbeService(
  manager: HuaweiP2PManager,
  private val log: (String) -> Unit,
  private val nowMs: () -> Long = System::currentTimeMillis,
) : HuaweiBaseP2PService(manager) {
  @Volatile
  private var pingAtMs: Long? = null

  override fun getModule() = PetalProbeWire.PHONE_PACKAGE

  override fun getPackage() = PetalProbeWire.WATCH_PACKAGE

  /** Unknown: the app's ping carries none, and only a message the phone sends (cmd 2) would use it; the probe sends none. */
  override fun getFingerprint() = ""

  override fun registered() = log(PetalProbeWire.registeredLine())

  override fun unregister() {
    clearPending()
    pingAtMs = null
  }

  override fun handlePacket(packet: P2P.P2PCommand.Response) {
    PetalProbeWire.describe(packet, "rx P2P").forEach(log)
    if (packet.cmdId.toInt() == 1) pingAtMs = nowMs()
    super.handlePacket(packet)
  }

  override fun onPingPacket(packet: P2P.P2PCommand.Response): Int {
    log("${PetalProbeWire.TAG} answering ping seq=${packet.sequenceId} with 0x%02x (app present)".format(PetalProbeWire.PRESENT))
    return PetalProbeWire.PRESENT
  }

  override fun onDataPacket(packet: P2P.P2PCommand.Response): Int {
    log("${PetalProbeWire.TAG} acknowledging message seq=${packet.sequenceId} with 0x%02x".format(PetalProbeWire.RECEIVED))
    return PetalProbeWire.RECEIVED
  }

  /** Already logged by [handlePacket]. */
  override fun handleData(data: ByteArray) = Unit

  override fun handleFile(filename: String, data: ByteArray) = PetalProbeWire.file(filename, data).forEach(log)

  /** Milliseconds since the last ping while that is under [PetalProbeWire.WINDOW_MS], else null. */
  fun sincePing(): Long? {
    val at = pingAtMs ?: return null
    val since = nowMs() - at
    return if (since in 0..PetalProbeWire.WINDOW_MS) since else null
  }

  /** A frame of another service/command nobody handles ([HuaweiSession.observeUnhandled]); logged inside the window only. */
  fun onUnhandled(service: Int, command: Int, tlv: ByteArray?, raw: ByteArray) {
    val since = sincePing() ?: return
    PetalProbeWire.unhandled(service, command, tlv, raw.size, since).forEach(log)
  }

  /** A P2P packet for a package no service has ([HuaweiP2PManager.setUnclaimedListener]); logged inside the window only. */
  fun onUnclaimed(packet: P2P.P2PCommand.Response) {
    val since = sincePing() ?: return
    log("${PetalProbeWire.TAG} $since ms after the ping, a P2P packet from ${packet.srcPackage}, which no service has:")
    PetalProbeWire.describe(packet, "unclaimed P2P").forEach(log)
  }
}
