import * as Linking from 'expo-linking';

import { authClient } from '@/cloud/auth';
import { JOYOROGO_URL } from '@/cloud/config';
import { cloudLog } from '@/cloud/log';
import { errorMessage } from '@/format';

import { appleIap, type AppleIapProduct } from '../../../modules/apple-iap';
import { AppleBillingError, appleAccountToken, postSignedTransaction, PRO_PRODUCT_IDS, type PostedTransaction, type ProPlan } from './appleBillingCore';

/** Apple's own subscription page, for a phone where the native management sheet cannot open. */
const APPLE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';

/** This build can sell through StoreKit: iOS with the `AppleIap` native module (a binary built before it existed has none). */
export const appleBillingSupported = appleIap !== null;

export type StoreProducts = Record<ProPlan, AppleIapProduct | null>;

/** StoreKit's products with the storefront's own price text; a plan is null while its product is not available (not set up, no network). */
export async function loadProducts(): Promise<StoreProducts> {
  if (!appleIap) return { monthly: null, yearly: null };
  const [monthly, yearly] = await Promise.all([
    appleIap.getProduct(PRO_PRODUCT_IDS.monthly).catch(() => null),
    appleIap.getProduct(PRO_PRODUCT_IDS.yearly).catch(() => null),
  ]);
  return { monthly, yearly };
}

async function post(signedTransaction: string): Promise<PostedTransaction> {
  return postSignedTransaction({ baseUrl: JOYOROGO_URL, cookie: await authClient.getCookie(), signedTransaction });
}

/** True when JoyoRogo credited the transaction, false when it never will (bad receipt, or another account's subscription); throws on a transient failure. */
async function postOrReject(signedTransaction: string): Promise<boolean> {
  try {
    await post(signedTransaction);
    return true;
  } catch (error) {
    if (error instanceof AppleBillingError && error.definitive) return false;
    throw error;
  }
}

/** `bought`: credited. `trial`: Apple's Sandbox, nothing charged, Pro lasts a day. */
export type PurchaseOutcome = 'bought' | 'trial' | 'cancelled' | 'pending';

/**
 * Subscribes through StoreKit with the account's appAccountToken, has JoyoRogo credit it, and only then finishes the transaction. A
 * transient failure before JoyoRogo answers 200 leaves the transaction unfinished, so the next app start replays it
 * ({@link replayPurchases}); a definitive rejection finishes it at once. Throws {@link AppleBillingError}.
 */
export async function buyPro(plan: ProPlan): Promise<PurchaseOutcome> {
  if (!appleIap) throw new AppleBillingError('unavailable', false);
  const userId = (await authClient.getSession()).data?.user.id;
  if (!userId) throw new AppleBillingError('signIn', false);
  const result = await appleIap.purchase(PRO_PRODUCT_IDS[plan], appleAccountToken(userId)).catch((e: unknown) => {
    cloudLog(`StoreKit purchase failed: ${errorMessage(e)}`, 'error');
    throw new AppleBillingError('failed', false);
  });
  if (result.status !== 'success') return result.status;
  let posted: PostedTransaction;
  try {
    posted = await post(result.signedTransaction);
  } catch (error) {
    if (error instanceof AppleBillingError && error.definitive) await appleIap.finish(result.transactionId);
    throw error;
  }
  await appleIap.finish(result.transactionId);
  return posted.sandbox ? 'trial' : 'bought';
}

/**
 * "Restore purchases": asks the App Store to refresh, then posts every active subscription this Apple ID holds, one by one. A
 * subscription linked to another JoyoRogo account counts as `rejected`; any other failure throws {@link AppleBillingError}.
 */
export async function restorePurchases(): Promise<{ accepted: number; rejected: number }> {
  const summary = { accepted: 0, rejected: 0 };
  if (!appleIap) throw new AppleBillingError('unavailable', false);
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
export async function replayPurchases(userId: string): Promise<boolean> {
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
export async function manageSubscriptions(): Promise<void> {
  if (appleIap && (await appleIap.showManageSubscriptions().catch(() => false))) return;
  await Linking.openURL(APPLE_SUBSCRIPTIONS_URL);
}
