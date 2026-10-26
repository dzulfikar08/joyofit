package com.joyodigitama.stravauploadweb

/**
 * The pure rules of the upload web view, kept apart from the Android classes so the unit tests run on the JVM.
 * The iOS twin is `ios/WebPolicy.swift`.
 */
object WebPolicy {
  /** Schemes a page may navigate to inside the web view. Anything else (`intent:`, `strava:`, `mailto:`) is not opened at all. */
  private val IN_VIEW = setOf("http", "https", "about", "blob", "data")

  fun opensInWebView(scheme: String?): Boolean = scheme != null && scheme.lowercase() in IN_VIEW

  /**
   * The user agent Chrome on Android sends with "Desktop site" ticked, built from the WebView's own: strava.com/upload/select
   * only offers the file upload to a desktop browser. Chrome reduces the version to `<major>.0.0.0` there as well.
   */
  fun desktopUserAgent(webViewDefault: String): String {
    val major = Regex("""Chrome/(\d+)""").find(webViewDefault)?.groupValues?.get(1) ?: FALLBACK_CHROME_MAJOR
    return "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$major.0.0.0 Safari/537.36"
  }

  /** Only used when the WebView's user agent names no Chrome version (never seen; a WebView is Chromium). */
  private const val FALLBACK_CHROME_MAJOR = "140"
}
