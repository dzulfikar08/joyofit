import { sha256 } from '@noble/hashes/sha2.js';

import { t } from '@/i18n';

/**
 * App Store Connect auto-renewable subscriptions of JoyoFit (group "JoyoRogo Pro"). JoyoRogo's server verifies these ids, the bundle
 * `com.joyodigitama.joyofit` and credits JoyoRogo Pro (`founder_until`) on the signed-in JoyoRogo account.
 */
export const PRO_PRODUCT_IDS = {
  monthly: 'com.joyodigitama.joyofit.pro.monthly',
  yearly: 'com.joyodigitama.joyofit.pro.yearly',
} as const;

export type ProPlan = keyof typeof PRO_PRODUCT_IDS;

/** Apple's standard licensed-application EULA: JoyoFit has no custom one, so this is its Terms of Use. */
export const APPLE_TERMS_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';

export const PRIVACY_URL = 'https://fit.joyorogo.com/privasi';

/**
 * StoreKit `appAccountToken` of a JoyoRogo user: SHA-256("joyorogo-apple:<userId>"), first 16 bytes, UUID version 5 and RFC 4122
 * variant. Identical to `appleAccountToken` in JoyoRogo's `packages/api/src/lib/apple.ts` and to JoyoRogo's own app: the server
 * rejects a transaction whose token belongs to another account, and one subscription is shared by both apps' accounts.
 */
export function appleAccountToken(userId: string): string {
  const bytes = sha256(new TextEncoder().encode(`joyorogo-apple:${userId}`)).slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Why a purchase could not be credited; each has a sentence in `pro:error.<reason>`. */
export type BillingFailure = 'signIn' | 'otherAccount' | 'invalid' | 'processing' | 'unavailable' | 'unreachable' | 'failed';

/**
 * JoyoRogo did not credit a transaction. `definitive`: it never will (bad receipt, or a subscription linked to another account),
 * so the transaction is finished instead of replayed forever; every other failure leaves it unfinished for the next attempt.
 */
export class AppleBillingError extends Error {
  constructor(
    readonly reason: BillingFailure,
    readonly definitive: boolean,
  ) {
    super(t(`pro:error.${reason}`));
  }
}

export interface PostedTransaction {
  /** JoyoRogo says this was Apple's Sandbox and nothing was charged (Pro then lasts a day). Omitted for review accounts. */
  sandbox: boolean;
}

/**
 * `POST <joyorogo>/api/billing/apple` with the signed transaction (JWS) and the JoyoRogo session cookie; idempotent per transaction.
 * 200 `{activated, founderUntil, sandbox}` credited (or already credited, or an old period: nothing to add), 400 bad receipt,
 * 401 no session, 403 the subscription belongs to another JoyoRogo account, 404 Apple billing is off on that server,
 * 409 still processing. Throws {@link AppleBillingError}.
 */
export async function postSignedTransaction(args: {
  baseUrl: string;
  cookie: string | null;
  signedTransaction: string;
  fetchImpl?: typeof fetch;
}): Promise<PostedTransaction> {
  const { baseUrl, cookie, signedTransaction, fetchImpl = fetch } = args;
  if (!cookie) throw new AppleBillingError('signIn', false);
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/api/billing/apple`, {
      method: 'POST',
      headers: { Cookie: cookie, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedTransaction }),
      credentials: 'omit',
    });
  } catch {
    throw new AppleBillingError('unreachable', false);
  }
  if (response.status === 401) throw new AppleBillingError('signIn', false);
  if (response.status === 400) throw new AppleBillingError('invalid', true);
  if (response.status === 403) throw new AppleBillingError('otherAccount', true);
  if (response.status === 404) throw new AppleBillingError('unavailable', false);
  if (response.status === 409) throw new AppleBillingError('processing', false);
  if (!response.ok) throw new AppleBillingError('failed', false);
  const body = (await response.json().catch(() => null)) as { sandbox?: unknown } | null;
  return { sandbox: body?.sandbox === true };
}

/**
 * Whether JoyoRogo has Apple billing switched on: `appleBilling` of `GET /api/config`. Null when it could not be read (offline,
 * slow, malformed), which is not the same as off.
 */
export async function fetchAppleBilling(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<boolean | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetchImpl(`${baseUrl}/api/config`, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) return null;
    const json = (await response.json()) as { appleBilling?: unknown } | null;
    return typeof json?.appleBilling === 'boolean' ? json.appleBilling : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * How much cheaper a year is than twelve months, in whole percent, from StoreKit's numeric prices (the storefront's own currency, so
 * the ratio is exact). Null when either price is unreadable or the year is not cheaper.
 */
export function yearlySavingPercent(monthly: string, yearly: string): number | null {
  const m = Number(monthly);
  const y = Number(yearly);
  if (!Number.isFinite(m) || !Number.isFinite(y) || m <= 0 || y <= 0) return null;
  const percent = Math.round((1 - y / (m * 12)) * 100);
  return percent > 0 ? percent : null;
}
