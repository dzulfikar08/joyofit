import * as Linking from 'expo-linking';

import { authClient } from '@/cloud/auth';
import { JOYOROGO_URL } from '@/cloud/config';
import { cloudLog } from '@/cloud/log';
import { errorMessage } from '@/format';

import { appleIap } from '../../../modules/apple-iap';
import { APPLE_TERMS_URL, appleAccountToken, postSignedTransaction } from './appleBillingCore';
import { BillingError, PRO_PRODUCT_IDS, type ProBilling, type ProPlan, type PurchaseOutcome, type StoreProducts } from './billingCore';

/** Apple's own subscription page, for a phone where the native management sheet cannot open. */
const APPLE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';

/** StoreKit's products with the storefront's own price text; a plan is null while its product is not available (not set up, no network). */
async function loadProducts(): Promise<StoreProducts> {
  if (!appleIap) return { monthly: null, yearly: null };
  const [monthly, yearly] = await Promise.all([
    appleIap.getProduct(PRO_PRODUCT_IDS.monthly).catch(() => null),
    appleIap.getProduct(PRO_PRODUCT_IDS.yearly).catch(() => null),
  ]);
  return { monthly, yearly };
}

async function post(signedTransaction: string): Promise<void> {
  return postSignedTransaction({ baseUrl: JOYOROGO_URL, cookie: await authClient.getCookie(), signedTransaction });
}

/** True when JoyoRogo credited the transaction, false when it never will (bad receipt, or another account's subscription); throws on a transient failure. */
async function postOrReject(signedTransaction: string): Promise<boolean> {
  try {
    await post(signedTransaction);
    return true;
  } catch (error) {
    if (error instanceof BillingError && error.definitive) return false;
    throw error;
  }
}

/**
 * Subscribes through StoreKit with the account's appAccountToken, has JoyoRogo credit it, and only then finishes the transaction. A
 * transient failure before JoyoRogo answers 200 leaves the transaction unfinished, so the next app start replays it
 * ({@link replayPurchases}); a definitive rejection finishes it at once. Throws {@link BillingError}.
 */
async function buyPro(plan: ProPlan): Promise<PurchaseOutcome> {
  if (!appleIap) throw new BillingError('unavailable', false);
  const userId = (await authClient.getSession()).data?.user.id;
  if (!userId) throw new BillingError('signIn', false);
  const result = await appleIap.purchase(PRO_PRODUCT_IDS[plan], appleAccountToken(userId)).catch((e: unknown) => {
    cloudLog(`StoreKit purchase failed: ${errorMessage(e)}`, 'error');
    throw new BillingError('failed', false);
  });
  if (result.status !== 'success') return result.status;
  try {
    await post(result.signedTransaction);
  } catch (error) {
    if (error instanceof BillingError && error.definitive) await appleIap.finish(result.transactionId);
    throw error;
  }
  await appleIap.finish(result.transactionId);
  return 'bought';
}

/**
 * "Restore purchases": asks the App Store to refresh, then posts every active subscription this Apple ID holds, one by one. A
 * subscription linked to another JoyoRogo account counts as `rejected`; any other failure throws {@link BillingError}.
 */
async function restorePurchases(): Promise<{ accepted: number; rejected: number }> {
  const summary = { accepted: 0, rejected: 0 };
  if (!appleIap) throw new BillingError('unavailable', false);
  for (const item of await appleIap.currentEntitlements(true)) {
    if (await postOrReject(item.signedTransaction)) summary.accepted++;
    else summary.rejected++;
  }
  return summary;
}

/** The JoyoRogo account the replay already ran for in this app start. */
let replayedFor: string | null = null;

/**
 * Once per app start and account: posts the purchases StoreKit still holds unfinished (an interrupted purchase), finishing each one
 * JoyoRogo credited or will never credit, then the current entitlements, so a renewal made while the app was closed is credited. A
 * failure stops the pass quietly and the next app start tries again. Resolves true when JoyoRogo accepted anything, i.e. Pro may
 * have changed.
 */
async function replayPurchases(userId: string): Promise<boolean> {
  if (!appleIap || replayedFor === userId) return false;
  replayedFor = userId;
  let credited = false;
  try {
    for (const item of await appleIap.unfinished()) {
      if (await postOrReject(item.signedTransaction)) credited = true;
      await appleIap.finish(item.transactionId);
    }
    for (const item of await appleIap.currentEntitlements(false)) {
      if (await postOrReject(item.signedTransaction)) credited = true;
    }
  } catch (error) {
    replayedFor = null;
    cloudLog(`StoreKit replay stopped: ${errorMessage(error)}`, 'error');
  }
  return credited;
}

/** Apple's subscription management sheet (cancel, change plan); Apple's subscription page when the sheet cannot open. */
async function manageSubscriptions(): Promise<void> {
  if (appleIap && (await appleIap.showManageSubscriptions().catch(() => false))) return;
  await Linking.openURL(APPLE_SUBSCRIPTIONS_URL);
}

/** The subscription is the App Store account's: the management sheet is always reachable. */
const canManage = async (): Promise<boolean> => appleIap !== null;

export const appleBilling: ProBilling = {
  /** This build can sell through StoreKit: iOS with the `AppleIap` native module (a binary built before it existed has none). */
  supported: appleIap !== null,
  configFlag: 'appleBilling',
  loadProducts,
  buyPro,
  restorePurchases,
  replayPurchases,
  canManage,
  manageSubscriptions,
  termsUrl: APPLE_TERMS_URL,
};
