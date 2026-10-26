// A plain WKWebView for strava.com's own upload page, where the person does every step on Strava themselves. JoyoFit runs no
// script in it and reads nothing from it; the only thing the app does is answer the browser's file request (what
// `<input type=file>` asks for) with the file JS names, through `webView(_:runOpenPanelWith:initiatedByFrame:completionHandler:)`.
// Apple added that delegate method to iOS in 18.4 (https://developer.apple.com/documentation/webkit/wkuidelegate/webview(_:runopenpanelwith:initiatedbyframe:completionhandler:));
// before it, iOS always shows its own picker and the app has no say (`answersFileRequests` is false, JS shows the Files hint).
// Which request gets which file is decided in JS (`manualUpload.ts`): every request goes out as `onFileRequest` and waits until
// `answerFileRequest` (a file URL, or nil to cancel).
//
// The page is asked for as a desktop site (`WKWebpagePreferences.preferredContentMode`, Safari's "Request Desktop Website"): Strava
// offers the file upload only there. Cookies stay in the web view's default data store, so the Strava login is kept between visits.
#if canImport(ExpoModulesCore) && canImport(WebKit)
import ExpoModulesCore
import WebKit

final class StravaUploadWebView: ExpoView, WKNavigationDelegate, WKUIDelegate {
    let onFileRequest = EventDispatcher()
    let onNavigation = EventDispatcher()
    let onLoadError = EventDispatcher()

    private let web: WKWebView
    private var loadedUrl: String?
    /// The file request WebKit is waiting on. Its handler must be called exactly once (WebKit raises when it is dropped).
    private var pending: (id: Int, answer: ([URL]?) -> Void)?
    private var nextRequestId = 0
    private var observations: [NSKeyValueObservation] = []

    required init(appContext: AppContext? = nil) {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.preferredContentMode = .desktop
        web = WKWebView(frame: .zero, configuration: configuration)
        super.init(appContext: appContext)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = true
        clipsToBounds = true
        addSubview(web)
        observations = [
            web.observe(\.canGoBack) { [weak self] _, _ in self?.emitNavigation() },
            web.observe(\.isLoading) { [weak self] _, _ in self?.emitNavigation() },
            web.observe(\.url) { [weak self] _, _ in self?.emitNavigation() },
        ]
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        web.frame = bounds
    }

    override func willMove(toSuperview newSuperview: UIView?) {
        super.willMove(toSuperview: newSuperview)
        if newSuperview == nil { cancelPending() }
    }

    func load(_ url: String) {
        guard url != loadedUrl, let target = URL(string: url) else { return }
        loadedUrl = url
        web.load(URLRequest(url: target))
    }

    /// Answers request `id` with the file at `fileUri` (a file:// URL), or cancels it. A stale id is ignored.
    func answerFileRequest(_ id: Int, _ fileUri: String?) {
        guard let request = pending, request.id == id else { return }
        pending = nil
        request.answer(fileUri.flatMap { URL(string: $0) }.map { [$0] })
    }

    func goBack() {
        if web.canGoBack { web.goBack() }
    }

    func reload() {
        web.reload()
    }

    private func cancelPending() {
        let request = pending
        pending = nil
        request?.answer(nil)
    }

    private func emitNavigation() {
        onNavigation(["url": web.url?.absoluteString ?? "", "canGoBack": web.canGoBack, "loading": web.isLoading])
    }

    // MARK: WKNavigationDelegate

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
    ) {
        decisionHandler(WebPolicy.opensInWebView(navigationAction.request.url?.scheme) ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        reportLoadError(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        reportLoadError(error)
    }

    private func reportLoadError(_ error: Error) {
        let nsError = error as NSError
        // A navigation replaced by another one (a redirect, a tap while loading) is not a failure.
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled { return }
        onLoadError(["url": web.url?.absoluteString ?? "", "description": nsError.localizedDescription])
    }

    // MARK: WKUIDelegate

    /// `window.open` and target=_blank load in this view.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if navigationAction.targetFrame == nil { webView.load(navigationAction.request) }
        return nil
    }

    @available(iOS 18.4, *)
    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping @MainActor @Sendable ([URL]?) -> Void
    ) {
        // A request still open (the page asked again before JS answered) is cancelled first.
        cancelPending()
        nextRequestId += 1
        pending = (nextRequestId, { urls in completionHandler(urls) })
        onFileRequest([
            "requestId": nextRequestId,
            "pageUrl": webView.url?.absoluteString ?? "",
            // WKOpenPanelParameters does not expose the input's `accept` list.
            "acceptTypes": [String](),
            "multiple": parameters.allowsMultipleSelection,
        ])
    }
}
#endif
