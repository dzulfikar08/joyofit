import type { Platform } from '@/features/onboarding/flow';
import { proOffer } from '@/features/onboarding/pro';

/**
 * Where in the app a Pro upgrade card sits. It names the copy and the `utm_campaign` / store campaign of the link, so the moment that
 * converts is visible in RevKlik, Play Console and App Store Connect.
 */
export type ProMoment = 'coach-chat' | 'coach' | 'coach-today' | 'cloud' | 'workout' | 'koneksi' | 'family' | 'onboarding' | 'onboarding-cloud';

export type Distribution = 'play' | 'sideload';

/** The JoyoRogo app's own screen for Pro. Tried first on every platform: someone who already has JoyoRogo lands on its Pro page. */
export const JOYOROGO_APP_URL = 'joyorogo://founder?from=joyofit';

export const JOYOROGO_PLAY_ID = 'com.joyodigitama.joyorogo';

/**
 * JoyoRogo's App Store page (ASC app id 6823222101), live since version 1.0.0 was approved (2026-10-26); this is the one place
 * to change when the id or the page moves.
 */
export const JOYOROGO_APP_STORE_URL = 'https://apps.apple.com/app/id6823222101';

export const JOYOROGO_WEB_PRO_URL = 'https://joyorogo.com/pro';

/** utm convention: docs/utm.md in the joyorogo repo (`evergreen-<where>`); the App Store takes the same name as its `ct` token. */
export const campaignOf = (moment: ProMoment): string => `evergreen-pro-${moment}`;

export interface ProUpgradeAction {
  /**
   * `app-or-store`: the JoyoRogo app or its store listing, which is where Pro is bought in a store build (Play Billing, StoreKit); no
   * price is shown and no checkout is linked. `web`: a sideloaded build, which may show the live price and link to the web page.
   */
  kind: 'app-or-store' | 'web';
  /** Tried first on every platform; rejects when the JoyoRogo app is not installed. */
  appUrl: string;
  /** Play: the store app's `market://` link; iOS: the App Store page; sideload: the web page with utm tags. */
  primaryUrl: string;
  /** Play only: the https listing, for a phone where `market://` has no handler. */
  fallbackUrl: string | null;
  /** Only a sideloaded build may show a price. */
  showPrice: boolean;
}

/**
 * What the upgrade button may do on this build. The stores' rules decide (see `proOffer`): Play and iOS never get a price or a link to
 * a web checkout, only the JoyoRogo app or its store page; a sideloaded APK gets the web page and the live price.
 */
export function proUpgradeAction(platform: Platform, distribution: Distribution, moment: ProMoment): ProUpgradeAction {
  const campaign = campaignOf(moment);
  const offer = proOffer(platform, distribution);
  if (offer === 'web') {
    return {
      kind: 'web',
      appUrl: JOYOROGO_APP_URL,
      primaryUrl: `${JOYOROGO_WEB_PRO_URL}?from=joyofit&utm_source=joyofit&utm_medium=app&utm_campaign=${campaign}`,
      fallbackUrl: null,
      showPrice: true,
    };
  }
  if (offer === 'store') {
    const referrer = `utm_source%3Djoyofit%26utm_medium%3Dapp%26utm_campaign%3D${campaign}`;
    return {
      kind: 'app-or-store',
      appUrl: JOYOROGO_APP_URL,
      primaryUrl: `market://details?id=${JOYOROGO_PLAY_ID}&referrer=${referrer}`,
      fallbackUrl: `https://play.google.com/store/apps/details?id=${JOYOROGO_PLAY_ID}&referrer=${referrer}`,
      showPrice: false,
    };
  }
  return {
    kind: 'app-or-store',
    appUrl: JOYOROGO_APP_URL,
    primaryUrl: `${JOYOROGO_APP_STORE_URL}?ct=joyofit-${campaign}`,
    fallbackUrl: null,
    showPrice: false,
  };
}

/**
 * Opens the first link that works: the JoyoRogo app, then the store or web page, then the https listing. `open` is `Linking.openURL`;
 * it rejects when nothing handles the link, which is how a missing app is told apart without `canOpenURL` (that would need a native
 * `queries` entry). Returns false when every link failed.
 */
export async function openProUpgrade(action: ProUpgradeAction, open: (url: string) => Promise<unknown>): Promise<boolean> {
  const urls = [action.appUrl, action.primaryUrl, ...(action.fallbackUrl ? [action.fallbackUrl] : [])];
  for (const url of urls) {
    try {
      await open(url);
      return true;
    } catch {
      // Not installed or no handler: the next link.
    }
  }
  return false;
}

/** How long "Nanti" hides an inline card. */
export const DISMISS_MS = 14 * 24 * 60 * 60 * 1000;

/** Whether a card dismissed at `dismissedAt` (epoch ms, null when never) shows again at `now`. A clock set back never hides it for good. */
export function dismissalExpired(dismissedAt: number | null, now: number): boolean {
  if (dismissedAt === null || !Number.isFinite(dismissedAt)) return true;
  return now < dismissedAt || now - dismissedAt >= DISMISS_MS;
}
