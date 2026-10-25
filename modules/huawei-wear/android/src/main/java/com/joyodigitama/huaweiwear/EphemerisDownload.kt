package com.joyodigitama.huaweiwear

import android.content.Context
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/** A download the watch asked for failed (no network, HTTP error, unreadable body); the message goes to the log. */
internal open class AgpsFetchException(message: String, cause: Throwable? = null) : IOException(message, cause)

/** One HTTP body and the server's idea of when it was made (0 when it did not say). */
internal class AgpsDownload(val body: ByteArray, val lastModifiedMs: Long)

/**
 * The HTTP side of the satellite-data job: blocking, so callers run it on the IO dispatcher. Only https, bodies capped by the
 * caller, a plain GET with no credentials and no app identification.
 */
internal object EphemerisNet {
  /** The public Broadcom LTO file (valid for 7 days). */
  const val LTO_HOST = "https://gllto.glpals.com"
  const val LTO_PATH = "/7day/v6/latest/lto.dat"

  /** JoyoFit's own server: the experimental HW_AGNSS file built from BKG's open broadcast ephemeris (server/src/agps.ts). Only with the switch on. */
  const val AGNSS_URL = "https://api.fit.joyorogo.com/v1/agps/hw-agnss"

  private const val CONNECT_TIMEOUT_MS = 15_000
  private const val READ_TIMEOUT_MS = 30_000

  fun get(url: String, maxBytes: Int): AgpsDownload {
    if (!url.startsWith("https://")) throw AgpsFetchException("refusing non-https url")
    val connection = try {
      URL(url).openConnection() as HttpURLConnection
    } catch (e: IOException) {
      throw AgpsFetchException("bad url: ${e.message}", e)
    }
    try {
      connection.connectTimeout = CONNECT_TIMEOUT_MS
      connection.readTimeout = READ_TIMEOUT_MS
      connection.requestMethod = "GET"
      val status = connection.responseCode
      if (status != 200) {
        val reason = try {
          connection.errorStream?.use { stream ->
            val buffer = ByteArray(256)
            String(buffer, 0, stream.read(buffer).coerceAtLeast(0), Charsets.UTF_8).take(120)
          }
        } catch (e: IOException) {
          null
        }
        throw AgpsFetchException("HTTP $status${if (reason.isNullOrBlank()) "" else ": $reason"}")
      }
      val declared = connection.contentLengthLong
      if (declared > maxBytes) throw AgpsFetchException("response larger than $maxBytes bytes")
      return AgpsDownload(connection.inputStream.use { readCapped(it, maxBytes) }, connection.lastModified)
    } catch (e: AgpsFetchException) {
      throw e
    } catch (e: IOException) {
      throw AgpsFetchException("${e.javaClass.simpleName}: ${e.message}", e)
    } finally {
      connection.disconnect()
    }
  }

  private fun readCapped(input: InputStream, limit: Int): ByteArray {
    val out = ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    while (true) {
      val n = input.read(buffer)
      if (n < 0) break
      if (out.size() + n > limit) throw AgpsFetchException("response larger than $limit bytes")
      out.write(buffer, 0, n)
    }
    return out.toByteArray()
  }

  /** SHA-256 of the watch address without colons, lowercase hex: part of the stored file name the watch's protocol expects. */
  fun addressDigest(address: String): String =
    MessageDigest.getInstance("SHA-256").digest(address.replace(":", "").toByteArray(Charsets.UTF_8)).toHex().lowercase()
}

/**
 * Downloads kept in the app's files so the watch's repeated requests (it asks again every ~20 s while it is locating) do not
 * refetch. Keyed by URL; the age is the file's modification time.
 */
internal class EphemerisCache(context: Context) : AgpsCache {
  private val dir = File(context.applicationContext.filesDir, "agps")

  private fun file(url: String): File {
    val key = MessageDigest.getInstance("SHA-256").digest(url.toByteArray(Charsets.UTF_8)).toHex().lowercase().take(32)
    return File(dir, "$key.bin")
  }

  /** The cached body of [url] when it is younger than [maxAgeMs]. */
  override fun read(url: String, maxAgeMs: Long): ByteArray? {
    val f = file(url)
    if (!f.isFile || System.currentTimeMillis() - f.lastModified() > maxAgeMs) return null
    return try {
      f.readBytes().takeIf { it.isNotEmpty() }
    } catch (e: IOException) {
      null
    }
  }

  override fun write(url: String, data: ByteArray) {
    try {
      if (!dir.isDirectory && !dir.mkdirs()) return
      val target = file(url)
      val tmp = File(dir, target.name + ".tmp")
      tmp.writeBytes(data)
      if (!tmp.renameTo(target)) tmp.delete()
      prune()
    } catch (e: IOException) {
      // A cache that cannot be written only costs a refetch.
    }
  }

  override fun delete(url: String) {
    file(url).delete()
  }

  private fun prune() {
    val cutoff = System.currentTimeMillis() - PRUNE_AGE_MS
    dir.listFiles()?.forEach { if (it.lastModified() < cutoff) it.delete() }
  }

  private companion object {
    const val PRUNE_AGE_MS = 24L * 60 * 60 * 1000
  }
}
