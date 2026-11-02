import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import type * as ExpoIap from 'expo-iap';

import { authClient } from '@/cloud/auth';
import { JOYOROGO_URL } from '@/cloud/config';
import { cloudLog } from '@/cloud/log';
import { errorMessage } from '@/format';
import { HuaweiWear } from '@/wear';

import { BillingError, PRO_PRODUCT_IDS, type ProBilling, type ProPlan, type PurchaseOutcome, type StoreProducts } from './billingCore';
import { pickPlanOffer, playManageUrl, postPurchaseToken, PLAY_TERMS_URL, type PlayPlanOffer, type PostedPurchase } from './playBillingCore';

type Iap = typeof ExpoIap;

/**
 * Google Play Billing over expo-iap (the library JoyoRogo's own Play build uses). Autolinked on Android only (`expo.autolinking.apple.exclude` in
 * package.json: iOS sells with its own StoreKit module) and loaded lazily, so a binary built before it existed, iOS, and a sideloaded
 * build, which Play cannot bill, never load it and read as "cannot buy here".
 */
const iap: Iap | null = (() => {
  if (Platform.OS !== 'android' || HuaweiWear.distribution !== 'play') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy on purpose: an older binary lacks the native module
    return require('expo-iap') as Iap;
  } catch {
    return null;
  }
})();

const PRODUCT_IDS: readonly string[] = Object.values(PRO_PRODUCT_IDS);

let connection: Promise<unknown> | null = null;

/** One shared connection to the Play Billing service; a failed attempt is retried by the next call. */
function connect(api: Iap): Promise<unknown> {
  connection ??= api.initConnection().catch((error: unknown) => {
    connection = null;
    throw error;
  });
  return connection;
}

/** The base-plan offer of each plan; null while Play does not list it (not created or not active yet, no network, Play missing). */
async function loadOffers(api: Iap): Promise<Record<ProPlan, PlayPlanOffer | null>> {
  await connect(api);
  const products = ((await api.fetchProducts({ skus: Object.values(PRO_PRODUCT_IDS), type: 'subs' })) ?? []) as ExpoIap.ProductSubscription[];
  const offerOf = (plan: ProPlan): PlayPlanOffer | null => {
    const product = products.find((p) => p.platform === 'android' && p.id === PRO_PRODUCT_IDS[plan]);
    return product ? pickPlanOffer(product.subscriptionOffers ?? [], plan) : null;
  };
  return { monthly: offerOf('monthly'), yearly: offerOf('yearly') };
}

async function loadProducts(): Promise<StoreProducts> {
  if (!iap) return { monthly: null, yearly: null };
  try {
    const offers = await loadOffers(iap);
    const show = (offer: PlayPlanOffer | null) => (offer ? { displayPrice: offer.displayPrice, price: offer.price } : null);
    return { monthly: show(offers.monthly), yearly: show(offers.yearly) };
  } catch (error) {
    cloudLog(`Play products failed: ${errorMessage(error)}`, 'error');
    return { monthly: null, yearly: null };
  }
}

async function post(purchaseToken: string): Promise<PostedPurchase> {
  return postPurchaseToken({ baseUrl: JOYOROGO_URL, cookie: await authClient.getCookie(), purchaseToken });
}

/** True when JoyoRogo accepted the purchase, false when it never will (bad token, or another account's subscription); throws on a transient failure. */
async function postOrReject(purchaseToken: string): Promise<PostedPurchase | null> {
  try {
    return await post(purchaseToken);
  } catch (error) {
    if (error instanceof BillingError && error.definitive) return null;
    throw error;
  }
}

type PurchaseResult = { status: 'purchased'; purchaseToken: string } | { status: 'pending'; purchaseToken?: string } | { status: 'cancelled' };

/**
 * Opens Play's purchase sheet for one plan and resolves with its outcome. `accountId` (the JoyoRogo user id) rides along as
 * obfuscatedAccountId so JoyoRogo can refuse a purchase made for a different account.
 */
function requestPlan(api: Iap, offer: PlayPlanOffer, plan: ProPlan, accountId: string): Promise<PurchaseResult> {
  const productId = PRO_PRODUCT_IDS[plan];
  return new Promise<PurchaseResult>((resolve, reject) => {
    const subscriptions: { remove: () => void }[] = [];
    const settle = (finish: () => void) => {
      for (const subscription of subscriptions) subscription.remove();
      finish();
    };
    subscriptions.push(
      api.purchaseUpdatedListener((purchase) => {
        if (purchase.productId !== productId) return;
        if (purchase.purchaseState === 'pending') {
          const purchaseToken = purchase.purchaseToken ?? undefined;
          settle(() => resolve({ status: 'pending', purchaseToken }));
        } else if (purchase.purchaseState === 'purchased' && purchase.purchaseToken) {
          const purchaseToken = purchase.purchaseToken;
          settle(() => resolve({ status: 'purchased', purchaseToken }));
        }
      }),
      api.purchaseErrorListener((error) => {
        settle(() => {
          if (error.code === api.ErrorCode.UserCancelled) resolve({ status: 'cancelled' });
          else if (error.code === api.ErrorCode.AlreadyOwned) reject(new BillingError('alreadyOwned', false));
          else reject(new Error(error.message));
        });
      }),
    );
    api
      .requestPurchase({
        type: 'subs',
        request: { google: { skus: [productId], subscriptionOffers: [{ sku: productId, offerToken: offer.offerToken }], obfuscatedAccountId: accountId } },
      })
      .catch((error: unknown) => settle(() => reject(error instanceof Error ? error : new Error(String(error)))));
  });
}

/**
 * Subscribes through Play with the account id attached and has JoyoRogo credit it; JoyoRogo acknowledges the purchase in Play only after
 * crediting it, so this never does. A transient failure before JoyoRogo answers 200 leaves the purchase unacknowledged, and the next app
 * start replays it ({@link replayPurchases}); Play refunds a purchase left unacknowledged for 3 days. Throws {@link BillingError}.
 */
async function buyPro(plan: ProPlan): Promise<PurchaseOutcome> {
  if (!iap) throw new BillingError('unavailable', false);
  const userId = (await authClient.getSession()).data?.user.id;
  if (!userId) throw new BillingError('signIn', false);
  const offer = (await loadOffers(iap).catch(() => null))?.[plan];
  if (!offer) throw new BillingError('unavailable', false);
  const result = await requestPlan(iap, offer, plan, userId).catch((error: unknown) => {
    if (error instanceof BillingError) throw error;
    cloudLog(`Play purchase failed: ${errorMessage(error)}`, 'error');
    throw new BillingError('failed', false);
  });
  if (result.status === 'cancelled') return 'cancelled';
  if (result.status === 'pending') {
    // Linked on JoyoRogo's side now; nothing is credited until the buyer pays, and Play's notification (or the next start) credits it.
    if (result.purchaseToken) await post(result.purchaseToken).catch(() => null);
    return 'pending';
  }
  const posted = await post(result.purchaseToken);
  return posted.status === 'pending' ? 'pending' : 'bought';
}

/** Subscriptions of JoyoFit that Play says this Google account holds. */
async function ownedPurchases(api: Iap): Promise<{ purchaseToken: string; productId: string }[]> {
  await connect(api);
  const purchases = await api.getAvailablePurchases();
  return purchases
    .filter((purchase) => PRODUCT_IDS.includes(purchase.productId) && purchase.purchaseToken)
    .map((purchase) => ({ purchaseToken: purchase.purchaseToken as string, productId: purchase.productId }));
}

/**
 * "Restore purchases": reads what Play says this Google account holds and posts each subscription, one by one. One linked to another
 * JoyoRogo account counts as `rejected`; any other failure throws {@link BillingError}.
 */
async function restorePurchases(): Promise<{ accepted: number; rejected: number }> {
  const summary = { accepted: 0, rejected: 0 };
  if (!iap) throw new BillingError('unavailable', false);
  const owned = await ownedPurchases(iap).catch((error: unknown) => {
    cloudLog(`Play restore failed: ${errorMessage(error)}`, 'error');
    throw new BillingError('failed', false);
  });
  for (const item of owned) {
    const posted = await postOrReject(item.purchaseToken);
    if (posted === null) summary.rejected++;
    else if (posted.status === 'granted' || posted.status === 'already') summary.accepted++;
  }
  return summary;
}

/** The JoyoRogo account the replay already ran for in this app start. */
let replayedFor: string | null = null;

/**
 * Once per app start and account: posts every JoyoFit subscription Play holds for this Google account, so a purchase interrupted before
 * JoyoRogo answered (and still unacknowledged), a renewal made while the app was closed, or one made on another phone is credited.
 * A failure stops the pass quietly and the next app start tries again. Resolves true when JoyoRogo credited anything new.
 */
async function replayPurchases(userId: string): Promise<boolean> {
  if (!iap || replayedFor === userId) return false;
  replayedFor = userId;
  let credited = false;
  try {
    for (const item of await ownedPurchases(iap)) {
      const posted = await postOrReject(item.purchaseToken);
      if (posted?.status === 'granted') credited = true;
    }
  } catch (error) {
    replayedFor = null;
    cloudLog(`Play replay stopped: ${errorMessage(error)}`, 'error');
  }
  return credited;
}

async function canManage(): Promise<boolean> {
  if (!iap) return false;
  return (await ownedPurchases(iap).catch(() => [])).length > 0;
}

/** Play's page for the JoyoFit subscription this account holds (cancel, payment method, next charge). */
async function manageSubscriptions(): Promise<void> {
  const held = iap ? (await ownedPurchases(iap).catch(() => []))[0] : undefined;
  await Linking.openURL(playManageUrl(held?.productId));
}

export const playBilling: ProBilling = {
  supported: iap !== null,
  configFlag: 'googlePlayBilling',
  loadProducts,
  buyPro,
  restorePurchases,
  replayPurchases,
  canManage,
  manageSubscriptions,
  termsUrl: PLAY_TERMS_URL,
};
