package com.joyodigitama.stravauploadweb

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WebPolicyTest {
  @Test
  fun keepsWebSchemesInTheView() {
    for (scheme in listOf("https", "http", "HTTPS", "about", "blob", "data")) assertTrue(scheme, WebPolicy.opensInWebView(scheme))
  }

  @Test
  fun opensNoAppOrOtherScheme() {
    for (scheme in listOf("intent", "strava", "mailto", "tel", "file", "content", "javascript", "")) {
      assertFalse(scheme, WebPolicy.opensInWebView(scheme))
    }
    assertFalse(WebPolicy.opensInWebView(null))
  }

  @Test
  fun asksForTheDesktopSiteWithTheWebViewsChromeVersion() {
    val webView = "Mozilla/5.0 (Linux; Android 15; SM-S921B Build/AP3A.240905.015; wv) AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Version/4.0 Chrome/141.0.7390.122 Mobile Safari/537.36"
    assertEquals(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      WebPolicy.desktopUserAgent(webView),
    )
  }

  @Test
  fun desktopAgentSaysNeitherAndroidNorMobileNorWebView() {
    val agent = WebPolicy.desktopUserAgent("Mozilla/5.0 (Linux; Android 10; wv) Version/4.0 Mobile Safari/537.36")
    assertFalse(agent.contains("Android"))
    assertFalse(agent.contains("Mobile"))
    assertFalse(agent.contains("wv"))
    assertTrue(agent.contains("Chrome/140.0.0.0"))
  }
}
