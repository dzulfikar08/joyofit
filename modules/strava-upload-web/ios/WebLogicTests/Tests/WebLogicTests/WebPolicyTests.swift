import XCTest

@testable import WebLogic

/// The same cases as `WebPolicyTest.kt`: the Kotlin and Swift twins keep the same pages in the web view.
final class WebPolicyTests: XCTestCase {
    func testKeepsWebSchemesInTheView() {
        for scheme in ["https", "http", "HTTPS", "about", "blob", "data"] {
            XCTAssertTrue(WebPolicy.opensInWebView(scheme), scheme)
        }
    }

    func testOpensNoAppOrOtherScheme() {
        for scheme in ["intent", "strava", "mailto", "tel", "file", "content", "javascript", ""] {
            XCTAssertFalse(WebPolicy.opensInWebView(scheme), scheme)
        }
        XCTAssertFalse(WebPolicy.opensInWebView(nil))
    }
}
