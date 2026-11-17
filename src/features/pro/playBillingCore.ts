import { BillingError, type ProPlan, TRIAL_PLANS } from './billingCore';

/** JoyoFit's Google Play package. JoyoRogo's server verifies a purchase under the package named in the request, and only for JoyoFit's own products. */
export const PLAY_PACKAGE_NAME = 'com.joyodigitama.joyofit';

/** Terms of Use of the Play build: JoyoRogo's, the service that sells Pro. */
export const PLAY_TERMS_URL = 'https://joyorogo.com/syarat';

/** Play's subscription page for this app; with `productId` it opens that subscription (cancel, payment method, next charge). */
export function playManageUrl(productId?: string): string {
  const sku = productId ? `sku=${encodeURIComponent(productId)}&` : '';
  return `https://play.google.com/store/account/subscriptions?${sku}package=${PLAY_PACKAGE_NAME}`;
}

/** What JoyoRogo answers for a submitted purchase token: `granted` credited now, `already` credited before, `pending` not paid yet, `inactive` no longer entitled. */
export type PostedPurchase = { status: 'granted' | 'already' | 'pending' | 'inactive' };

const STATUSES: readonly PostedPurchase['status'][] = ['granted', 'already', 'pending', 'inactive'];

/**
 * `POST <joyorogo>/api/billing/google` with the purchase token, the package name and the JoyoRogo session cookie; idempotent per Play
 * order, and JoyoRogo acknowledges the purchase in Play only after crediting it. 200 `{status}`; refusals carry a stable `code`:
 * 400 `invalidReceipt`, 401 `signIn`, 409 `otherAccount` (the subscription is linked to another JoyoRogo account) or `processing`,
 * 404 `unavailable`/`userNotFound`, 502 `unreachable` (JoyoRogo could not reach Google). Throws {@link BillingError}.
 */
export async function postPurchaseToken(args: {
  baseUrl: string;
  cookie: string | null;
  purchaseToken: string;
  fetchImpl?: typeof fetch;
}): Promise<PostedPurchase> {
  const { baseUrl, cookie, purchaseToken, fetchImpl = fetch } = args;
  if (!cookie) throw new BillingError('signIn', false);
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/api/billing/google`, {
      method: 'POST',
      headers: { Cookie: cookie, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ purchaseToken, packageName: PLAY_PACKAGE_NAME }),
      credentials: 'omit',
    });
  } catch {
    throw new BillingError('unreachable', false);
  }
  const body = (await response.json().catch(() => null)) as { status?: unknown; code?: unknown } | null;
  if (response.status === 401) throw new BillingError('signIn', false);
  if (response.status === 400) throw new BillingError('invalid', true);
  if (response.status === 409) {
    if (body?.code === 'otherAccount') throw new BillingError('otherAccount', true);
    throw new BillingError('processing', false);
  }
  if (response.status === 404 || response.status === 502) throw new BillingError('unavailable', false);
  if (!response.ok) throw new BillingError('failed', false);
  const status = STATUSES.find((s) => s === body?.status);
  if (!status) throw new BillingError('failed', false);
  return { status };
}

/** The part of an expo-iap subscription product that picks a plan's offer, structurally typed so the choice is unit tested without the native module. */
export interface PlayOfferLike {
  basePlanIdAndroid?: string | null;
  offerTokenAndroid?: string | null;
  displayPrice?: string;
  pricingPhasesAndroid?: {
    pricingPhaseList?: readonly {
      formattedPrice?: string;
      priceAmountMicros?: string;
      priceCurrencyCode?: string;
      /** ISO 8601 duration of one cycle of the phase, e.g. "P1Y", "P7D", "P1W". */
      billingPeriod?: string;
      /** Cycles in the phase (a finite phase such as a trial); 0 for the recurring one. */
      billingCycleCount?: number;
    }[];
  } | null;
}

export interface PlayPlanOffer {
  /** Play's localized recurring price, e.g. "Rp29.000". */
  displayPrice: string;
  /** The same price as a plain number string (units), for the yearly saving. */
  price: string;
  offerToken: string;
  /** Length of the free trial this offer starts with, in days; null for the plain base plan. */
  trialDays: number | null;
}

/**
 * Days in an ISO 8601 duration made of days and weeks only ("P7D", "P1W", "P1W3D"); null for anything else. Months and years have no
 * fixed length in days, so a trial counted in them is not shown as days (and not offered: see {@link pickPlanOffer}).
 */
export function isoDurationDays(duration: string | null | undefined): number | null {
  const match = /^P(?:(\d+)W)?(?:(\d+)D)?$/.exec(duration ?? '');
  if (!match || (match[1] === undefined && match[2] === undefined)) return null;
  const days = Number(match[1] ?? 0) * 7 + Number(match[2] ?? 0);
  return days > 0 ? days : null;
}

/**
 * The offer of `plan` to sell. With `withTrial` (by default for the plans in {@link TRIAL_PLANS}), a free-trial offer of the plan's
 * base plan wins: exactly two phases, the first free (price 0) and counted in days or weeks, the second the recurring price. Play only
 * lists offers this Google account is eligible for, so a listed trial is one Play will apply. Otherwise, and when no such offer is
 * listed, it is the plain base-plan offer: promotional offers carry extra pricing phases (trial, intro price), so the offer with the
 * fewest phases is the base plan itself; its last phase is the recurring price. Null when Play lists no offer for the base plan, or
 * one without a readable price.
 */
export function pickPlanOffer(offers: readonly PlayOfferLike[], plan: ProPlan, withTrial = TRIAL_PLANS.includes(plan)): PlayPlanOffer | null {
  let best: { phases: number; offer: PlayPlanOffer } | null = null;
  let trial: PlayPlanOffer | null = null;
  for (const offer of offers) {
    if (offer.basePlanIdAndroid !== plan || !offer.offerTokenAndroid) continue;
    const phases = offer.pricingPhasesAndroid?.pricingPhaseList ?? [];
    const recurring = phases[phases.length - 1];
    const micros = Number(recurring?.priceAmountMicros);
    const displayPrice = recurring?.formattedPrice ?? offer.displayPrice;
    if (!displayPrice || !Number.isFinite(micros) || micros <= 0) continue;
    const price = String(micros / 1e6);
    if (withTrial && !trial && phases.length === 2 && phases[0]?.priceAmountMicros === '0') {
      const cycleDays = isoDurationDays(phases[0].billingPeriod);
      const trialDays = cycleDays === null ? null : cycleDays * Math.max(1, phases[0].billingCycleCount ?? 1);
      if (trialDays !== null) trial = { displayPrice, price, offerToken: offer.offerTokenAndroid, trialDays };
    }
    if (best && best.phases <= phases.length) continue;
    best = { phases: phases.length, offer: { displayPrice, price, offerToken: offer.offerTokenAndroid, trialDays: null } };
  }
  return trial ?? best?.offer ?? null;
}
