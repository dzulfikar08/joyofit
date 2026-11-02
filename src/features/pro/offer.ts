import type { Platform } from '@/features/onboarding/flow';
import { proOffer } from '@/features/onboarding/pro';

/**
 * Where in the app a Pro upgrade card sits. It names the copy and the `utm_campaign` of the web link, so the moment that
 * converts is visible in RevKlik.
 */
export type ProMoment = 'coach-chat' | 'coach' | 'coach-today' | 'cloud' | 'workout' | 'koneksi' | 'family' | 'onboarding' | 'onboarding-cloud';

export type Distribution = 'play' | 'sideload';

/** The JoyoRogo app's own screen for Pro. Tried first in a sideloaded build: someone who already has JoyoRogo lands on its Pro page. */
export const JOYOROGO_APP_URL = 'joyorogo://founder?from=joyofit';

export const JOYOROGO_WEB_PRO_URL = 'https://joyorogo.com/pro';

/** The in-app paywall (`src/app/pro.tsx`): where iOS (StoreKit) and the Play build (Google Play Billing) buy JoyoRogo Pro. */
export const PRO_PAYWALL_ROUTE = '/pro';

/** utm convention: docs/utm.md in the joyorogo repo (`evergreen-<where>`). */
export const campaignOf = (moment: ProMoment): string => `evergreen-pro-${moment}`;

/**
 * `paywall`: iOS and the Play build, the in-app paywall; the purchase is JoyoFit's own in-app purchase, nothing leaves the app and no
 * price is shown outside the store's own text. `web`: a sideloaded build, which may show the live price and link to the web page.
 */
export type ProUpgradeAction =
  | { kind: 'paywall'; showPrice: false }
  | {
      kind: 'web';
      /** Tried first; rejects when the JoyoRogo app is not installed. */
      appUrl: string;
      /** The web page with utm tags. */
      primaryUrl: string;
      /** Only a sideloaded build may show a price. */
      showPrice: true;
    };

/**
 * What the upgrade button may do on this build. The stores' rules decide (see `proOffer`): iOS and Play open the paywall, which sells
 * with the store's billing and shows the store's own price; a sideloaded APK gets the web page and the live price.
 */
export function proUpgradeAction(platform: Platform, distribution: Distribution, moment: ProMoment): ProUpgradeAction {
  if (proOffer(platform, distribution) === 'iap') return { kind: 'paywall', showPrice: false };
  return {
    kind: 'web',
    appUrl: JOYOROGO_APP_URL,
    primaryUrl: `${JOYOROGO_WEB_PRO_URL}?from=joyofit&utm_source=joyofit&utm_medium=app&utm_campaign=${campaignOf(moment)}`,
    showPrice: true,
  };
}

export interface ProUpgradeOpeners {
  /** `Linking.openURL`; rejects when nothing handles the link, which is how a missing app is told apart without `canOpenURL` (that would need a native `queries` entry). */
  open: (url: string) => Promise<unknown>;
  /** Shows the in-app paywall. */
  showPaywall: () => void;
}

/** Carries out `action`: the paywall, or the first link that works (the JoyoRogo app, then the web page). Returns false when every link failed. */
export async function openProUpgrade(action: ProUpgradeAction, { open, showPaywall }: ProUpgradeOpeners): Promise<boolean> {
  if (action.kind === 'paywall') {
    showPaywall();
    return true;
  }
  for (const url of [action.appUrl, action.primaryUrl]) {
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
