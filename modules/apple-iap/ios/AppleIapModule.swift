import ExpoModulesCore
import StoreKit
import UIKit

enum AppleIapError: Error, LocalizedError {
  case productNotFound(String)
  case unverifiedTransaction

  var errorDescription: String? {
    switch self {
    case .productNotFound(let productId):
      return "Product \(productId) is not available in the App Store yet."
    case .unverifiedTransaction:
      return "This device could not verify the purchase."
    }
  }
}

/// StoreKit 2 bridge for JoyoRogo Pro, sold inside JoyoFit. Transactions stay unfinished until
/// the server confirms the purchase, so an interrupted flow can be replayed.
public class AppleIapModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AppleIap")

    AsyncFunction("getProduct") { (productId: String) -> [String: String]? in
      let products = try await Product.products(for: [productId])
      guard let product = products.first else { return nil }
      return [
        "id": product.id,
        "displayName": product.displayName,
        "displayPrice": product.displayPrice,
        "price": "\(product.price)",
      ]
    }

    // appAccountToken ties the transaction (and every renewal) to the JoyoRogo
    // account, so App Store Server Notifications can be mapped to a user.
    AsyncFunction("purchase") { (productId: String, appAccountToken: String) -> [String: String] in
      let products = try await Product.products(for: [productId])
      guard let product = products.first else {
        throw AppleIapError.productNotFound(productId)
      }
      var options: Set<Product.PurchaseOption> = []
      if let token = UUID(uuidString: appAccountToken) {
        options.insert(.appAccountToken(token))
      }
      let result = try await product.purchase(options: options)
      switch result {
      case .success(let verification):
        // Only verified transactions carry a JWS the server will accept.
        guard case .verified(let transaction) = verification else {
          throw AppleIapError.unverifiedTransaction
        }
        return [
          "status": "success",
          "signedTransaction": verification.jwsRepresentation,
          "transactionId": String(transaction.id),
        ]
      case .userCancelled:
        return ["status": "cancelled"]
      case .pending:
        return ["status": "pending"]
      @unknown default:
        return ["status": "pending"]
      }
    }

    // Transaction.unfinished yields VerificationResult<Transaction>; only
    // verified ones can be credited by the server, so only those are exposed.
    AsyncFunction("finish") { (transactionId: String) -> Bool in
      for await result in Transaction.unfinished {
        guard case .verified(let transaction) = result, String(transaction.id) == transactionId else {
          continue
        }
        await transaction.finish()
        return true
      }
      return false
    }

    // Active subscriptions this Apple ID holds (restore purchases and launch sync).
    // AppStore.sync() first so a reinstall or new device sees purchases from the store.
    AsyncFunction("currentEntitlements") { (sync: Bool) -> [[String: String]] in
      if sync { try? await AppStore.sync() }
      var items: [[String: String]] = []
      for await result in Transaction.currentEntitlements {
        guard case .verified(let transaction) = result else { continue }
        items.append([
          "signedTransaction": result.jwsRepresentation,
          "transactionId": String(transaction.id),
        ])
      }
      return items
    }

    // Apple's native subscription management sheet.
    AsyncFunction("showManageSubscriptions") { () -> Bool in
      guard let scene = await MainActor.run(body: {
        UIApplication.shared.connectedScenes.first(where: { $0 is UIWindowScene }) as? UIWindowScene
      }) else { return false }
      try await AppStore.showManageSubscriptions(in: scene)
      return true
    }

    AsyncFunction("unfinished") { () -> [[String: String]] in
      var items: [[String: String]] = []
      for await result in Transaction.unfinished {
        guard case .verified(let transaction) = result else { continue }
        items.append([
          "signedTransaction": result.jwsRepresentation,
          "transactionId": String(transaction.id),
        ])
      }
      return items
    }
  }
}
