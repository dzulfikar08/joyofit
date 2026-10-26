package com.joyodigitama.stravauploadweb

import android.annotation.SuppressLint
import android.content.Context
import android.net.Uri
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/**
 * A plain WebView for strava.com's own upload page, where the person does every step on Strava themselves. JoyoFit runs no script
 * in it and reads nothing from it: the page's own scripts run (`javaScriptEnabled`), and the only thing the app does is answer the
 * browser's file request (`onShowFileChooser`, what `<input type=file>` asks for) with the file JS names, instead of the system
 * picker. Which request gets which file is decided in JS (`manualUpload.ts`): every request goes out as `onFileRequest` and waits,
 * holding Android's callback, until `answerFileRequest` (a file URI, or null to cancel).
 *
 * The page is asked for as a desktop browser (`WebPolicy.desktopUserAgent`), like Chrome's "Desktop site": Strava offers the file
 * upload only there. Cookies stay in the WebView's own store (`CookieManager`), so the Strava login is kept between visits.
 */
@SuppressLint("SetJavaScriptEnabled", "ViewConstructor")
class StravaUploadWebView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onFileRequest by EventDispatcher()
  private val onNavigation by EventDispatcher()
  private val onLoadError by EventDispatcher()

  private val web = WebView(context)
  private var loadedUrl: String? = null

  /** The file request Android is waiting on. Its callback must be called exactly once, or the page's next request never comes. */
  private var pending: Pair<Int, ValueCallback<Array<Uri>>>? = null
  private var nextRequestId = 0

  init {
    web.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    web.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      userAgentString = WebPolicy.desktopUserAgent(WebSettings.getDefaultUserAgent(context))
      // A desktop page zoomed out to the screen width, pinch to zoom in.
      useWideViewPort = true
      loadWithOverviewMode = true
      builtInZoomControls = true
      displayZoomControls = false
      // `window.open` and target=_blank load in this view.
      setSupportMultipleWindows(false)
      // The page cannot load file:// or content:// addresses; the answer to a file request is not a page load.
      allowFileAccess = false
      allowContentAccess = false
    }
    CookieManager.getInstance().setAcceptCookie(true)
    // Strava's sign-in providers (Apple) answer from their own domain.
    CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)

    web.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
        !WebPolicy.opensInWebView(request.url.scheme)

      override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
        emitNavigation(loading = true)
      }

      override fun onPageFinished(view: WebView, url: String?) {
        emitNavigation(loading = false)
      }

      override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
        emitNavigation(loading = view.progress < 100)
      }

      override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        if (!request.isForMainFrame) return
        onLoadError(mapOf("url" to request.url.toString(), "description" to error.description.toString()))
      }
    }

    web.webChromeClient = object : WebChromeClient() {
      override fun onShowFileChooser(
        view: WebView,
        callback: ValueCallback<Array<Uri>>,
        params: WebChromeClient.FileChooserParams,
      ): Boolean {
        // A request still open (the page asked again before JS answered) is cancelled first.
        pending?.second?.onReceiveValue(null)
        val id = ++nextRequestId
        pending = id to callback
        onFileRequest(
          mapOf(
            "requestId" to id,
            "pageUrl" to (view.url ?: ""),
            "acceptTypes" to params.acceptTypes.filter { it.isNotBlank() },
            "multiple" to (params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE),
          ),
        )
        return true
      }
    }

    addView(web)
  }

  fun load(url: String) {
    if (url == loadedUrl) return
    loadedUrl = url
    web.loadUrl(url)
  }

  /** Answers request `id` with the file at `fileUri` (a file:// URI), or cancels it. A stale id is ignored. */
  fun answerFileRequest(id: Int, fileUri: String?) {
    val (pendingId, callback) = pending ?: return
    if (pendingId != id) return
    pending = null
    callback.onReceiveValue(fileUri?.let { arrayOf(Uri.parse(it)) })
  }

  fun goBack() {
    if (web.canGoBack()) web.goBack()
  }

  fun reload() {
    web.reload()
  }

  fun destroy() {
    pending?.second?.onReceiveValue(null)
    pending = null
    web.stopLoading()
    removeView(web)
    web.destroy()
  }

  private fun emitNavigation(loading: Boolean) {
    onNavigation(mapOf("url" to (web.url ?: ""), "canGoBack" to web.canGoBack(), "loading" to loading))
  }
}
