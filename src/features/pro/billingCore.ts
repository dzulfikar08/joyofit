import { t } from '@/i18n';

/**
 * JoyoFit's own subscriptions that grant JoyoRogo Pro: App Store Connect auto-renewable subscriptions (group "JoyoRogo Pro") on iOS and
 * Google Play subscriptions (one product per plan, each with one base plan named like the plan) on Android. JoyoRogo's server holds the
 * same ids per app and credits JoyoRogo Pro (`founder_until`) on the signed-in JoyoRogo account.
 */
export const PRO_PRODUCT_IDS = {
  monthly: 'com.joyodigitama.joyofit.pro.monthly',
  yearly: 'com.joyodigitama.joyofit.pro.yearly',
} as const;

export type ProPlan = keyof typeof PRO_PRODUCT_IDS;

export const PRIVACY_URL = 'https://fit.joyorogo.com/privasi';

/** Why a purchase could not be credited; each has a sentence in `pro:error.<reason>`. */
export type BillingFailure =
  | 'signIn'
  | 'otherAccount'
  | 'invalid'
  | 'processing'
  | 'unavailable'
  | 'unreachable'
  | 'alreadyOwned'
  | 'failed';

/**
 * JoyoRogo did not credit a purchase. `definitive`: it never will (bad receipt, or a subscription linked to another account), so a
 * replay moves on instead of retrying it forever; every other failure leaves the purchase for the next attempt.
 */
export class BillingError extends Error {
  constructor(
    readonly reason: BillingFailure,
    readonly definitive: boolean,
  ) {
    super(t(`pro:error.${reason}`));
  }
}

/** A plan's product as the store shows it. `price` is the numeric amount in the storefront currency, for the yearly saving. */
export interface StoreProduct {
  displayPrice: string;
  price: string;
}

export type StoreProducts = Record<ProPlan, StoreProduct | null>;

/** `bought`: credited (a purchase in the store's sandbox included: it looks like a real one). `pending`: waiting for approval or payment. */
export type PurchaseOutcome = 'bought' | 'cancelled' | 'pending';

/** What the paywall needs from a store; one implementation per platform (`appleBilling.ts`, `playBilling.ts`). */
export interface ProBilling {
  /** This build can sell here: the store's native module is in the binary (a binary built before it existed has none). */
  supported: boolean;
  /** The flag of JoyoRogo's `GET /api/config` that says billing for this store is on. */
  configFlag: 'appleBilling' | 'googlePlayBilling';
  loadProducts(): Promise<StoreProducts>;
  /** Throws {@link BillingError}. */
  buyPro(plan: ProPlan): Promise<PurchaseOutcome>;
  /** Posts every active subscription the store account holds. Throws {@link BillingError}. */
  restorePurchases(): Promise<{ accepted: number; rejected: number }>;
  /** Once per app start and account; true when JoyoRogo credited anything, i.e. Pro may have changed. */
  replayPurchases(userId: string): Promise<boolean>;
  /** Whether this store account holds a JoyoFit subscription to manage. */
  canManage(): Promise<boolean>;
  manageSubscriptions(): Promise<void>;
  /** Terms of Use link shown on the paywall. */
  termsUrl: string;
}

/**
 * Whether JoyoRogo has billing for this store switched on: `flag` of `GET /api/config`. Null when it could not be read (offline, slow,
 * malformed), which is not the same as off.
 */
export async function fetchBillingSwitch(
  baseUrl: string,
  flag: ProBilling['configFlag'],
  fetchImpl: typeof fetch = fetch,
): Promise<boolean | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetchImpl(`${baseUrl}/api/config`, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) return null;
    const json = (await response.json()) as Record<string, unknown> | null;
    const value = json?.[flag];
    return typeof value === 'boolean' ? value : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * How much cheaper a year is than twelve months, in whole percent, from the store's numeric prices (the storefront's own currency, so
 * the ratio is exact). Null when either price is unreadable or the year is not cheaper.
 */
export function yearlySavingPercent(monthly: string, yearly: string): number | null {
  const m = Number(monthly);
  const y = Number(yearly);
  if (!Number.isFinite(m) || !Number.isFinite(y) || m <= 0 || y <= 0) return null;
  const percent = Math.round((1 - y / (m * 12)) * 100);
  return percent > 0 ? percent : null;
}
