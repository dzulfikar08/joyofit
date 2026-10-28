# JoyoRogo Pro on iOS: In-App Purchase inside JoyoFit

App Review guideline 3.1.1 (3.1.3(b) for multiplatform services): JoyoFit unlocks Pro that people bought elsewhere, so the iOS app has to sell it too
and must not send an iOS user to another app or a website to buy. JoyoFit therefore has its **own** auto-renewable subscriptions that grant exactly
JoyoRogo Pro, the entitlement JoyoRogo's own In-App Purchase grants (`founder_until` on the JoyoRogo account). Android is unchanged
(`src/features/pro/offer.ts`: JoyoRogo app, Play listing or, in a sideloaded build, the web page).

## Products

App Store Connect, JoyoFit's own app record (bundle `com.joyodigitama.joyofit`), subscription group **JoyoRogo Pro**:

| Product id | Period | Price |
| --- | --- | --- |
| `com.joyodigitama.joyofit.pro.monthly` | 1 month | Rp29.000 in Indonesia, US$9.99 elsewhere (equalized) |
| `com.joyodigitama.joyofit.pro.yearly` | 1 year | Rp199.000 in Indonesia, US$59.99 elsewhere (equalized) |

The ids live in `PRO_PRODUCT_IDS` (`src/features/pro/appleBillingCore.ts`); JoyoRogo's server holds the same two ids and the JoyoFit bundle id. The
prices shown in the app are StoreKit's `displayPrice`, never written in the app, and only on the paywall.

## Pieces

| Piece | File |
| --- | --- |
| StoreKit 2 native module (`AppleIap`, copied from JoyoRogo's `apps/native/modules/apple-iap`, autolinked from `modules/`) | `modules/apple-iap/` |
| Account token, JWS post and error mapping (pure, unit tested) | `src/features/pro/appleBillingCore.ts` |
| Buy, restore, replay, manage (StoreKit + session) | `src/features/pro/appleBilling.ts` |
| Paywall screen, route `/pro` (iOS only; Android redirects to `/`) | `src/features/pro/ProPaywallScreen.tsx`, `src/app/pro.tsx` |
| Launch replay | `src/features/pro/AppleBillingSync.tsx`, mounted in `src/app/_layout.tsx` |
| Unlock without a restart | `CloudProvider.refreshPro()` (`src/state/CloudProvider.tsx`) |
| iOS entry points | `UpgradeCard`, onboarding `ProStep` and `CloudStep` (all through `openUpgrade`), Settings > Akun on a Pro account ("Kelola langganan JoyoRogo Pro") |

The module has no `Transaction.updates` listener, like JoyoRogo's: a renewal reaches JoyoRogo through App Store Server Notifications and through the
launch replay below.

## Purchase flow

1. The paywall needs a signed-in JoyoRogo session (JoyoFit signs in to JoyoRogo accounts; the user id is the same). Signed out, it explains that Pro is tied
   to the JoyoRogo account and offers the existing sign-in buttons.
2. `appleAccountToken(userId)` is SHA-256 of `joyorogo-apple:<userId>`, first 16 bytes, UUID version 5 and RFC 4122 variant bits: the same derivation as
   JoyoRogo's server and app (`packages/api/src/lib/apple.ts`). `appleBillingCore.test.ts` pins it with vectors computed from the server's function. The
   server rejects a transaction whose token belongs to another account.
3. `AppleIap.purchase(productId, token)` returns the signed transaction (JWS). JoyoFit posts `{signedTransaction}` to
   `https://api.joyorogo.com/api/billing/apple` with the session cookie (`authClient.getCookie()`, the way every JoyoRogo call in JoyoFit authenticates).
4. The transaction is finished (`AppleIap.finish`) only after the answer is 200 `{activated, founderUntil, sandbox}`, or when the answer says it will never be
   credited: 400 `receiptInvalid`, 403 `linkedOtherAccount`. Anything else leaves it unfinished so it is replayed: 401 (sign in), 404 (Apple billing off
   on JoyoRogo), 409 `processing`, other 5xx, no network.
5. `sandbox: true` (Apple's test environment, nothing charged, Pro lasts a day) shows a "Test purchase" alert. The server leaves the flag off for review accounts.

## Restore and replay

- **Restore purchases** (paywall, also on the active card): `AppleIap.currentEntitlements(true)` (`AppStore.sync()` first), each active subscription posted one
  by one. 200 counts as restored; 403 (subscription linked to another JoyoRogo account) is reported as such; other failures show their message.
- **Replay, once per app start and account** (`AppleBillingSync`, iOS, signed in): `AppleIap.unfinished()` is posted and finished as in step 4, then
  `currentEntitlements(false)` is posted so a renewal made while the app was closed is credited. A failure stops the pass quietly; the next start tries again.
  When anything was credited the app calls `refreshPro()`.
- JoyoRogo's own restore does not see a JoyoFit purchase (Apple ties a subscription to the app that sold it); JoyoFit's restore does. The server links a
  subscription to the first JoyoRogo account that redeems it (`originalTransactionId`), across both apps.

## Paywall states

| State | What shows |
| --- | --- |
| Android | Redirect to `/` (no paywall; the existing JoyoRogo app, Play or web path) |
| iOS binary without the `AppleIap` module (built before this) | Neutral "update JoyoFit" notice, no purchase, no link out |
| Signed out | Why a JoyoRogo account is needed, the sign-in buttons |
| Pro already active | "JoyoRogo Pro is active", **Manage subscription** (`showManageSubscriptions`, Apple's subscription page if the sheet cannot open), Restore |
| Signed in, `/api/config` `appleBilling` false | Neutral "not available right now" notice |
| Signed in, `/api/config` unreadable | "Could not check" notice with Try again |
| Signed in, `appleBilling` true | Yearly and monthly plans (StoreKit price, saving percent), Subscribe, Restore purchases, the Apple 3.1.2 disclosure, links to Terms of Use (Apple's standard EULA, <https://www.apple.com/legal/internet-services/itunes/dev/stdeula/>) and Privacy Policy (<https://fit.joyorogo.com/privasi>) |

The Terms and Privacy links are shown in every state. The paywall also says that this is the same JoyoRogo Pro that works in the JoyoRogo app and on the website.
Product ids StoreKit cannot load show "not available right now" per plan, and a retry when neither loads.

## Unlocking without a restart

After a credited purchase or restore, `CloudProvider.refreshPro()` clears the cloud lock, runs a sync and re-reads the account's Pro state
(`watchWorkout/status`, which `useCoachAccess` and `CloudContextValue.pro` follow), so Coach, Joyo AI, cloud sync, the strength and record syncs and the
Pro upgrade cards react at once. Screens that read from JoyoRogo on focus (Koneksi AI, workout detail) refresh when the user goes back to them, and the
Joyo AI chat drops its paywall notice when `useCoachAccess` turns `pro`. The JoyoFit Worker (`server/src/access.ts`) caches a "locked" answer for 10 s
(`ACCESS_LOCKED_CACHE_TTL_MS`), so when its answer is still "locked" `refreshPro()` syncs once more after 11 s.

## Deploy order

1. **JoyoRogo server first**: it must accept the JoyoFit bundle id, the two JoyoFit product ids and notifications for them. Until it does, every JoyoFit purchase is a 400 `receiptInvalid` and is rejected.
2. App Store Connect, JoyoFit's app record: the subscription group, the two products with prices, localizations, review screenshot, and the App Store Server
   Notifications V2 URL (production and sandbox) `https://api.joyorogo.com/api/billing/apple/notifications`.
3. Then the JoyoFit iOS build. The new native module changes the native fingerprint, so this is a **store build, not an OTA**; installed binaries without
   the module keep working and show the "update JoyoFit" notice on the paywall.

`/api/config` `appleBilling` (JoyoRogo) stays the switch that says Apple billing is on; the JoyoFit paywall follows it.

## Not verified here

StoreKit cannot run on Linux or in Expo Go. Verify on a device with a build that contains the module: a sandbox purchase of both plans, cancel, Ask to Buy
(pending), restore on a second device, an interrupted purchase (kill the app after the Apple sheet) replayed at the next start, a subscription linked to another
JoyoRogo account (403), Pro unlocking Coach and cloud sync without a restart, and Manage subscription.
