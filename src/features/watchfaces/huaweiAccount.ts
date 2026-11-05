/**
 * The Huawei account id (`userId`) the user enters so JoyoFit sends it to the watch at connect (1A/05), the way Gadgetbridge does with
 * its per-watch "authentication" field. It is only an account id: no signature, no token. Sending the account the watch was set up
 * under keeps a watch that "judges accounts" from asking for a factory reset when a non-Huawei-Health app connects.
 *
 * Huawei's `userId` is a run of digits (17 on the accounts seen, Gadgetbridge allows 17-18). We accept 15-20 digits to avoid rejecting a
 * valid id on an off-by-one assumption, and strip anything that is not a digit first, so a pasted `userId=123...` or a value with spaces
 * still normalises.
 */

export const HUAWEI_ACCOUNT_MIN_DIGITS = 15;
export const HUAWEI_ACCOUNT_MAX_DIGITS = 20;

export type HuaweiAccountResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'empty' | 'non_digit' | 'too_short' | 'too_long' };

/** Normalise a pasted or typed account id to bare digits, or say why it is not a plausible Huawei `userId`. */
export function normalizeHuaweiAccountId(raw: string | null | undefined): HuaweiAccountResult {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return { ok: false, reason: 'empty' };
  const digits = trimmed.replace(/\D/g, '');
  if (digits === '') return { ok: false, reason: 'non_digit' };
  // A value that was mostly non-digits (e.g. a URL) is suspect even if some digits survive.
  if (digits.length < HUAWEI_ACCOUNT_MIN_DIGITS) return { ok: false, reason: 'too_short' };
  if (digits.length > HUAWEI_ACCOUNT_MAX_DIGITS) return { ok: false, reason: 'too_long' };
  return { ok: true, id: digits };
}

/**
 * Pull the `userId` out of a cookie string (`document.cookie`, or a `Cookie:`/`Set-Cookie` header value) from a signed-in
 * `cloud.huawei.com` session, then validate it. Huawei also sets `userID`/`userid` on some pages, so the match is case-insensitive.
 */
export function extractUserIdFromCookies(cookies: string | null | undefined): HuaweiAccountResult {
  const text = cookies ?? '';
  const match = text.match(/(?:^|[;\s])userid\s*=\s*([^;,\s]+)/i);
  if (!match) return { ok: false, reason: 'empty' };
  return normalizeHuaweiAccountId(decodeURIComponent(match[1]));
}
