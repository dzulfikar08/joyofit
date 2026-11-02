import { BillingError, type ProPlan } from './billingCore';

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
    pricingPhaseList?: readonly { formattedPrice?: string; priceAmountMicros?: string; priceCurrencyCode?: string }[];
  } | null;
}

export interface PlayPlanOffer {
  /** Play's localized price, e.g. "Rp29.000". */
  displayPrice: string;
  /** The same price as a plain number string (units), for the yearly saving. */
  price: string;
  offerToken: string;
}

/**
 * The plain base-plan offer of `plan`. Promotional offers carry extra pricing phases (trial, intro price), so the offer with the fewest
 * phases is the base plan itself; its last phase is the recurring price. Null when Play lists no offer for the base plan, or one
 * without a readable price.
 */
export function pickPlanOffer(offers: readonly PlayOfferLike[], plan: ProPlan): PlayPlanOffer | null {
  let best: { phases: number; offer: PlayPlanOffer } | null = null;
  for (const offer of offers) {
    if (offer.basePlanIdAndroid !== plan || !offer.offerTokenAndroid) continue;
    const phases = offer.pricingPhasesAndroid?.pricingPhaseList ?? [];
    const recurring = phases[phases.length - 1];
    const micros = Number(recurring?.priceAmountMicros);
    const displayPrice = recurring?.formattedPrice ?? offer.displayPrice;
    if (!displayPrice || !Number.isFinite(micros) || micros <= 0) continue;
    if (best && best.phases <= phases.length) continue;
    best = { phases: phases.length, offer: { displayPrice, price: String(micros / 1e6), offerToken: offer.offerTokenAndroid } };
  }
  return best?.offer ?? null;
}
