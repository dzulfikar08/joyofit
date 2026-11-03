import { sha256 } from '@noble/hashes/sha2.js';

import { BillingError } from './billingCore';

/** Apple's standard licensed-application EULA: JoyoFit has no custom one, so this is its Terms of Use. */
export const APPLE_TERMS_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';

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

/**
 * `POST <joyorogo>/api/billing/apple` with the signed transaction (JWS) and the JoyoRogo session cookie; idempotent per transaction.
 * 200 credited (or already credited, or an old period: nothing to add), 400 bad receipt,
 * 401 no session, 403 the subscription belongs to another JoyoRogo account, 404 Apple billing is off on that server,
 * 409 still processing. Throws {@link BillingError}.
 */
export async function postSignedTransaction(args: {
  baseUrl: string;
  cookie: string | null;
  signedTransaction: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const { baseUrl, cookie, signedTransaction, fetchImpl = fetch } = args;
  if (!cookie) throw new BillingError('signIn', false);
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/api/billing/apple`, {
      method: 'POST',
      headers: { Cookie: cookie, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedTransaction }),
      credentials: 'omit',
    });
  } catch {
    throw new BillingError('unreachable', false);
  }
  if (response.status === 401) throw new BillingError('signIn', false);
  if (response.status === 400) throw new BillingError('invalid', true);
  if (response.status === 403) throw new BillingError('otherAccount', true);
  if (response.status === 404) throw new BillingError('unavailable', false);
  if (response.status === 409) throw new BillingError('processing', false);
  if (!response.ok) throw new BillingError('failed', false);
}
