# JoyoRogo Pro on Android: Google Play Billing inside JoyoFit

Google Play's Payments policy forbids leading users to another way of paying (in-app messaging, buttons, links) for digital goods sold in a Play app, and
JoyoFit unlocks Pro that people bought elsewhere. So the **Play build** sells Pro itself, with Google Play Billing, and links to nothing else. It mirrors the
iOS In-App Purchase ([pro-ios.md](pro-ios.md)): JoyoFit has its **own** subscriptions that grant exactly JoyoRogo Pro, the entitlement JoyoRogo's own Play
subscription grants (`founder_until` on the JoyoRogo account). A **sideloaded APK** (the website download, self-builds) cannot be billed by Play and keeps
the web page with the live price (`src/features/pro/offer.ts`, `proOffer`).

"[INFERENCE]" marks reasoning where I read no source.

## Products

Play Console, JoyoFit's own app (package `com.joyodigitama.joyofit`), Monetize with Play, Subscriptions. Two subscriptions, one base plan each. The ids are
exact and can never change or be reused:

| Subscription (product id) | Base plan id | Period | Price |
| --- | --- | --- | --- |
| `com.joyodigitama.joyofit.pro.monthly` | `monthly` | 1 month, auto-renewing | Rp29.000 in Indonesia, JoyoRogo's Play price in every other region |
| `com.joyodigitama.joyofit.pro.yearly` | `yearly` | 1 year, auto-renewing | Rp199.000 in Indonesia, JoyoRogo's Play price in every other region |

Same ids as the iOS products (`PRO_PRODUCT_IDS`, `src/features/pro/billingCore.ts`). JoyoRogo's server (PR #30 in the joyorogo repo, `GOOGLE_PLAY_PRODUCTS`)
accepts a product only under its own package and base plan: a JoyoFit product under JoyoRogo's package, or the reverse, is rejected. Prices are never written
in the app: the paywall shows the price Play returns for the buyer's country, and only there.

Matching JoyoRogo's prices per region (read on 2026-11-02 with the Android Publisher API, `monetization.subscriptions.list` for
`com.joyodigitama.joyorogo`, subscription `pro`, 128 regions each; grace period 7 days monthly and 14 days yearly, `SUBSCRIPTION_PRORATION_MODE_CHARGE_ON_NEXT_BILLING_DATE`):

| Region | Monthly | Yearly |
| --- | --- | --- |
| ID | IDR 29,000 | IDR 199,000 |
| US | USD 9.99 | USD 59.99 |
| MY | MYR 43.99 | MYR 264.99 |
| SG | SGD 13.98 | SGD 83.98 |
| AU | AUD 15.99 | AUD 94.99 |
| GB | GBP 8.99 | GBP 53.99 |
| DE (euro area) | EUR 10.99 | EUR 64.99 |
| BR | BRL 50.99 | BRL 304.99 |
| JP | JPY 1,740 | JPY 10,400 |
| PH | PHP 705 | PHP 4,250 |
| TH | THB 350 | THB 2,150 |
| VN | VND 259,000 | VND 1,550,000 |

The other regions: open JoyoRogo's `pro` subscription in Play Console and copy each base plan's price table (it is the same list).

## Pieces

| Piece | File |
| --- | --- |
| Play Billing Library through OpenIAP: `expo-iap` 6.0.2, the library and version JoyoRogo's own Play build uses. Autolinked on Android only (`expo.autolinking.apple.exclude` in `package.json`, so iOS keeps its StoreKit module and never links it) | `package.json` |
| Token post, error mapping, offer choice (pure, unit tested) | `src/features/pro/playBillingCore.ts`, `src/features/pro/billingCore.ts` |
| Products, purchase sheet, restore, replay, manage (expo-iap + session), loaded lazily and only in the Play build | `src/features/pro/playBilling.ts` |
| One interface over both stores, picked per platform | `src/features/pro/billing.ts` (`ProBilling`) |
| Paywall screen, route `/pro` | `src/features/pro/ProPaywallScreen.tsx`, `src/app/pro.tsx` |
| Launch replay | `src/features/pro/BillingSync.tsx`, mounted in `src/app/_layout.tsx` |
| Unlock without a restart | `CloudProvider.refreshPro()` |
| Entry points | `UpgradeCard`, onboarding `ProStep` and `CloudStep` (all through `openUpgrade`), Settings > Akun on a Pro account ("Kelola langganan JoyoRogo Pro") |

`expo-iap` is `require()`d lazily and only when `Platform.OS === 'android'` and `HuaweiWear.distribution === 'play'`. A binary built before the library existed,
iOS, and a sideloaded APK read `billing.supported === false`; the paywall then shows the neutral "update JoyoFit" notice (Play build) and never a link out.
[INFERENCE: the Play Billing permission `com.android.vending.BILLING` comes from the library's manifest and merges into the sideload APK too; nothing there calls it.]

## Purchase flow

1. The paywall needs a signed-in JoyoRogo session; signed out it explains why and offers the sign-in buttons.
2. It reads `/api/config` `googlePlayBilling` (JoyoRogo's switch: true when its service account is set and the paywall is on). False shows "not available right
   now" with no link out; unreadable shows "Could not check" with Try again.
3. It loads both subscriptions from Play (`fetchProducts`) and picks, for each plan, the offer of the base plan with that plan's name that has the fewest pricing
   phases, so a promotional offer added later never replaces the plain base plan. Play's formatted price is shown; the numeric amount only feeds the saving percent.
   A plan Play does not list shows "Not available right now" and, when neither loads, a Try again.
4. Subscribe opens Play's sheet with the JoyoRogo user id as `obfuscatedAccountId`. JoyoRogo refuses a purchase whose obfuscated account id is another account.
5. On success JoyoFit posts `{purchaseToken, packageName: "com.joyodigitama.joyofit"}` to `https://api.joyorogo.com/api/billing/google` with the session
   cookie. JoyoRogo asks Google (`purchases.subscriptionsv2.get` under that package), checks product and base plan, links the token to the account (first
   account wins), credits the latest charged order once (+1 or +12 months stacked on the current period, order id `google:<Play order id>`), and only then
   **acknowledges** the purchase in Play. The app never acknowledges or consumes. Play refunds a purchase left unacknowledged for 3 days, which is why a credit is
   never lost behind a missing acknowledge: the credit comes first and the acknowledge is retried on the next call.
6. Answers (`code` is the stable field of every error body): 200 `{status: granted|already}` Pro is on; 200 `{status: pending}` Play has not charged yet
   (convenience store, bank transfer), the paywall says so and Pro turns on when Play's notification or the next start credits it; 200 `{status: inactive}` not entitled
   now (expired); 400 `invalidReceipt`; 401 `signIn`; 409 `otherAccount` (the subscription is linked to a different JoyoRogo account, final) or `processing` (retry);
   404 `unavailable`/`userNotFound` and 502 `unreachable` (JoyoRogo could not reach Google): "Pro cannot be turned on right now; if you were charged it turns on by
   itself the next time you open JoyoFit".
7. A license-tester purchase is flagged as a test by Google; JoyoRogo credits 24 hours at Rp0 unless the buyer's email is in `GOOGLE_PLAY_TEST_EMAILS`, in which case the
   full period. The answer is a plain `granted` with no sandbox flag (unlike Apple's), so the Android paywall never shows the "Test purchase" alert: a tester just sees Pro for a day.

## Restore and replay

- **Restore purchases** (paywall): `getAvailablePurchases()` filtered to the two JoyoFit product ids, each token posted one by one. `granted` and `already` count as
  restored; `otherAccount` is reported as "linked to a different JoyoRogo account"; none found says no JoyoFit subscription exists on this Google account.
- **Replay, once per app start and account** (`BillingSync`, Play build, signed in): the same owned list is posted. This credits a purchase interrupted before
  JoyoRogo answered (still unacknowledged), a renewal made while the app was closed, and a purchase made on another phone. A failure stops the pass quietly;
  the next start retries. When anything was newly credited the app calls `refreshPro()`.
- A subscription bought in **JoyoRogo's own Play app** is not seen here: Play ties a purchase to the app that sold it. Pro itself is per account, so it unlocks
  JoyoFit anyway.
- "Already subscribed" (Play refuses a second purchase of the same product on this Google account) shows a sentence that points at Restore.

## Paywall states

| State | What shows |
| --- | --- |
| Sideloaded APK | Redirect to `/` (no paywall; the web page and live price through `proUpgradeAction`) |
| Play build without the library (built before this) | Neutral "update JoyoFit" notice, no purchase, no link out |
| Signed out | Why a JoyoRogo account is needed, the sign-in buttons |
| Pro already active | "JoyoRogo Pro is active", Restore; **Manage subscription** only when this Google account holds a JoyoFit subscription (it opens `https://play.google.com/store/account/subscriptions?sku=<product>&package=com.joyodigitama.joyofit`). Pro bought elsewhere has nothing to manage here |
| Signed in, `googlePlayBilling` false / unreadable | Neutral "not available right now" / "Could not check" with Try again |
| Signed in, billing on | Yearly and monthly plans (Play price, saving percent), Subscribe, Restore purchases, the renewal disclosure (price, period, auto-renew, how to cancel in Google Play), links to Terms of Use (<https://joyorogo.com/syarat>, JoyoRogo's) and Privacy Policy (<https://fit.joyorogo.com/privasi>) |

## Policy

- Play build: no price outside the paywall, no link to joyorogo.com/pro, no market link to the JoyoRogo app, no "buy in the other app" text (`proOffer` returns `iap`
  for Play; `app-or-store` is gone). The onboarding and Settings cards open the paywall.
- Content rating: "purchase digital goods" is **Yes** (`docs/play-store.md` section 6). Data safety has a Financial info > Purchase history row (section 7).
- The privacy policy page (`site/src/Privasi.tsx`) does not mention purchase data yet; it did not for iOS either. Adding a paragraph (the Play purchase token and
  order id go to JoyoRogo's server to unlock Pro) is an owner decision because that page is deployed separately.

## Deploy order

1. **JoyoRogo server first** (joyorogo PR #30): it must accept the JoyoFit package and the two product ids, and its D1 migration `0073_google_purchase_package`
   must run before the new code (`scripts/deploy.sh` does both). Until then every JoyoFit Play purchase is a 400 `invalidReceipt` and is not credited (and stays
   unacknowledged, so Play would refund it after 3 days). Do not publish the JoyoFit build before this.
2. **Play Console, JoyoFit's app** (the Android Publisher API refused the service account here, so this is manual, see below): the two subscriptions with
   their base plans active and prices, real-time developer notifications on the same Pub/Sub topic as JoyoRogo's, the service account allowed on this app,
   license testers.
3. **Then the JoyoFit Play build** (release-android workflow, an AAB). `expo-iap` is native code, so this changes the fingerprint: a **store build, not an OTA**.
   Installed binaries without it keep working and show the "update JoyoFit" notice on the paywall.

`/api/config` `googlePlayBilling` (JoyoRogo) stays the switch that says Play billing is on; the JoyoFit paywall follows it.

### Play Console steps for the owner

The service account `joyorogo-play-billing@joyorogo.iam.gserviceaccount.com` (key `~/.config/joyorogo/play-billing-sa.json`) can read subscriptions and open edits
for `com.joyodigitama.joyofit`, but `monetization.subscriptions.create` answered `403 The caller does not have permission` for both products (and a no-op
`PATCH` on JoyoRogo's own `pro` is refused too), so it has no monetization write right. Either grant it that right in Play Console (Users and permissions, the
service account, app permissions for JoyoFit: the subscription-management permissions [INFERENCE on the exact wording]) and re-run the creation, or do this by hand:

1. Play Console, JoyoFit, **Monetize with Play, Products, Subscriptions, Create subscription**. A merchant account and a published build that includes the Billing
   Library are needed first (the same conditions as JoyoRogo's `docs/play-billing.md` 1.1 and 1.2): publish the new AAB to the closed/internal track once, then the
   Products page unlocks [INFERENCE: it is the same gate JoyoRogo's runbook describes].
2. Product id `com.joyodigitama.joyofit.pro.monthly`, name `JoyoRogo Pro`, benefits as JoyoRogo's `pro` (100 scan AI per hari, ...). Base plan `monthly`: auto-renewing,
   billing period monthly, grace 7 days, account hold default, **Rp29.000**, then set the other regions to JoyoRogo's prices (table above, rest from JoyoRogo's `pro`). Activate it.
3. Product id `com.joyodigitama.joyofit.pro.yearly`, same name. Base plan `yearly`: yearly, grace 14 days, **Rp199.000**, other regions from JoyoRogo's yearly plan. Activate it.
4. No promotional offers yet (the paywall ignores offers with extra pricing phases).
5. **Real-time developer notifications** for the JoyoFit app: Monetize with Play, Monetization setup, topic `projects/<project-id>/topics/play-rtdn` (the topic JoyoRogo
   uses), subscriptions and voided purchases, then Send test message (JoyoRogo answers 204).
6. **Users and permissions**: the service account must see the JoyoFit app with the same three permissions as for JoyoRogo (view app information, view financial data, manage
   orders and subscriptions) so `purchases.subscriptionsv2.get` and the acknowledge work under this package. [INFERENCE: if the permission is account-level this is already
   true: `GET subscriptionsv2/tokens/<bad>` under the JoyoFit package answered 400 `Invalid Value`, the same as under JoyoRogo's.]
7. **License testers** (Settings, License testing) is account-level, so the testers JoyoRogo already has cover JoyoFit.

## Testing on a phone

Play Billing only works in a build installed by Play (an internal or closed track, not an APK), signed in to Play as a license tester. Check:

1. Both plans show Play's prices; Subscribe credits and the screens unlock without a restart; the Play app shows the subscription under Payments and subscriptions.
2. Cancel in the Play sheet: no message, nothing credited. A slow test payment method: "waiting for approval or payment", then Pro after it completes.
3. Kill the app right after the Play sheet closes (before JoyoRogo answers): the next start replays the token and credits it.
4. Restore on a second phone with the same Google account; a different JoyoRogo account on that phone gets the "linked to a different account" message.
5. Pro bought on the web or in the JoyoRogo app opens the JoyoFit screens, and the paywall shows "active" without Manage.
6. Manage opens the subscription page in Play.
7. Release build specifics: R8 minification and resource shrinking are on in release builds (`app.json`, `expo-build-properties`); JoyoRogo ships the same library with
   R8 on and no extra keep rules, so none were added here [INFERENCE: not run here].

## Not verified here

Play Billing cannot run on Linux or in Expo Go, and no Gradle or Android build was run for this change (typecheck, lint and the unit tests ran). The paths above that need a
device and the Play Console are untested until the first Play build with the library: the purchase sheet, `fetchProducts` for the new product ids, the acknowledge
by JoyoRogo's server under the JoyoFit package, R8 with `expo-iap`, restore on a second device, and the Pub/Sub notification for a JoyoFit renewal.
