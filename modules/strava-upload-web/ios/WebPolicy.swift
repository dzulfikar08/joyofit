// The pure rules of the upload web view (Foundation only, so WebLogicTests can compile this file on Linux). The Android twin is
// android/.../WebPolicy.kt; iOS asks for the desktop site with WKWebpagePreferences instead of a user agent string.
import Foundation

enum WebPolicy {
    /// Schemes a page may navigate to inside the web view. Anything else (`strava:`, `mailto:`, `itms-apps:`) is not opened at all.
    private static let inView: Set<String> = ["http", "https", "about", "blob", "data"]

    static func opensInWebView(_ scheme: String?) -> Bool {
        guard let scheme else { return false }
        return inView.contains(scheme.lowercased())
    }
}
