// Expo module `StravaUploadWeb` for iOS: the JS API of src/StravaUploadWeb.tsx, the upload page web view (StravaUploadWebView.swift).
#if canImport(ExpoModulesCore) && canImport(WebKit)
import ExpoModulesCore
import WebKit

public final class StravaUploadWebModule: Module {
    public func definition() -> ModuleDefinition {
        Name("StravaUploadWeb")

        // WebKit hands file requests to the app only from iOS 18.4; before, it always shows its own picker.
        Constant("answersFileRequests") { () -> Bool in
            if #available(iOS 18.4, *) { return true }
            return false
        }

        View(StravaUploadWebView.self) {
            Events("onFileRequest", "onNavigation", "onLoadError")

            Prop("sourceUrl") { (view: StravaUploadWebView, url: String) in
                view.load(url)
            }

            AsyncFunction("answerFileRequest") { (view: StravaUploadWebView, requestId: Int, fileUri: String?) in
                view.answerFileRequest(requestId, fileUri)
            }

            AsyncFunction("goBack") { (view: StravaUploadWebView) in
                view.goBack()
            }

            AsyncFunction("reload") { (view: StravaUploadWebView) in
                view.reload()
            }
        }
    }
}
#endif
