import { t } from '@/i18n';
import type { Platform } from '@/features/onboarding/flow';

/**
 * How the app may sell JoyoRogo Pro on this build. The rules are the stores', not ours:
 *
 * - iOS: App Store Review Guideline 3.1.1 forbids buttons, links and other calls to action that lead to a way of paying other than
 *   in-app purchase, so JoyoFit sells Pro itself with StoreKit (its own subscriptions, `src/app/pro.tsx`) and never sends anyone to
 *   another app or a web checkout. https://developer.apple.com/app-store/review/guidelines/#in-app-purchase
 * - Android from Google Play: the Payments policy (section 4) forbids leading users to another payment method through in-app messaging,
 *   buttons or links, and section 6 wants in-app prices to match Play's billing screen. The guide describes Pro, shows no price, and
 *   links to the JoyoRogo app's Play listing, which is an app install and not a checkout. https://support.google.com/googleplay/android-developer/answer/9858738
 * - Android sideload (APK from the website, self-builds): not under Play's policy, so the live price and a button to joyorogo.com/pro.
 */
export type ProOffer = 'iap' | 'web' | 'store';

export function proOffer(platform: Platform, distribution: 'play' | 'sideload'): ProOffer {
  if (platform === 'ios') return 'iap';
  return distribution === 'play' ? 'store' : 'web';
}

/** What JoyoRogo's live config says about Pro. Every field is optional: a missing one is left out of the text, never guessed. */
export interface ProConfig {
  monthlyIdr: number | null;
  yearlyIdr: number | null;
  /** Monthly price once the introductory slots are taken; null when no increase is announced. */
  nextMonthlyIdr: number | null;
  /** AI meal scans a day with Pro. */
  proDailyScans: number | null;
  /** AI meal scans a day without Pro. */
  freeDailyScans: number | null;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Reads `GET /api/config` of the JoyoRogo server (`founderPriceIdr`, `founderYearlyPriceIdr`, `founderDailyCap`, `freeDailyScans`, `promo`). */
export function parseProConfig(json: unknown): ProConfig | null {
  if (typeof json !== 'object' || json === null) return null;
  const record = json as Record<string, unknown>;
  const promo = typeof record.promo === 'object' && record.promo !== null ? (record.promo as Record<string, unknown>) : null;
  const config: ProConfig = {
    monthlyIdr: positiveNumber(record.founderPriceIdr),
    yearlyIdr: positiveNumber(record.founderYearlyPriceIdr),
    nextMonthlyIdr: positiveNumber(promo?.nextPriceIdr),
    proDailyScans: positiveNumber(record.founderDailyCap),
    freeDailyScans: positiveNumber(record.freeDailyScans),
  };
  return Object.values(config).some((v) => v !== null) ? config : null;
}

const CONFIG_TIMEOUT_MS = 8_000;

/** Fetches the live config; null when offline, slow or malformed, and the step then simply shows no price. */
export async function fetchProConfig(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<ProConfig | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${baseUrl}/api/config`, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) return null;
    return parseProConfig(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Rupiah the way JoyoRogo writes it: "Rp29.000". */
export function formatIdr(amount: number): string {
  return `Rp${Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

/** The price sentence for the `web` offer, from whatever the config gave; null when it gave no price. */
export function priceLine(config: ProConfig | null): string | null {
  if (!config || (config.monthlyIdr === null && config.yearlyIdr === null)) return null;
  const monthly = config.monthlyIdr !== null ? t('onboarding:pro.price.monthly', { price: formatIdr(config.monthlyIdr) }) : null;
  const yearly = config.yearlyIdr !== null ? t('onboarding:pro.price.yearly', { price: formatIdr(config.yearlyIdr) }) : null;
  const prices = monthly && yearly ? t('onboarding:pro.price.both', { monthly, yearly }) : (monthly ?? yearly ?? '');
  if (config.nextMonthlyIdr !== null && config.monthlyIdr !== null && config.nextMonthlyIdr > config.monthlyIdr) {
    return t('onboarding:pro.price.lineWithRise', { prices, next: formatIdr(config.nextMonthlyIdr) });
  }
  return t('onboarding:pro.price.line', { prices });
}

/** The scan benefit line; the numbers come from the config, so it reads in general terms when they are not known. */
export function scansLine(config: ProConfig | null): string {
  const pro = config?.proDailyScans;
  const free = config?.freeDailyScans;
  if (pro && free) return t('onboarding:pro.scans.both', { pro, free });
  if (pro) return t('onboarding:pro.scans.pro', { pro });
  return t('onboarding:pro.scans.generic');
}
