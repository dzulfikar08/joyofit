package com.joyodigitama.stravauploadweb

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Expo module implementing `src/StravaUploadWeb.tsx`: the upload page web view (`StravaUploadWebView`). */
class StravaUploadWebModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("StravaUploadWeb")

    // Android's WebView hands every file request to `onShowFileChooser` (API 21), so the app can always answer it.
    Constant("answersFileRequests") { true }

    View(StravaUploadWebView::class) {
      Events("onFileRequest", "onNavigation", "onLoadError")

      Prop("sourceUrl") { view: StravaUploadWebView, url: String -> view.load(url) }

      AsyncFunction("answerFileRequest") { view: StravaUploadWebView, requestId: Int, fileUri: String? ->
        view.answerFileRequest(requestId, fileUri)
      }
      AsyncFunction("goBack") { view: StravaUploadWebView -> view.goBack() }
      AsyncFunction("reload") { view: StravaUploadWebView -> view.reload() }

      OnViewDestroys { view: StravaUploadWebView -> view.destroy() }
    }
  }
}
