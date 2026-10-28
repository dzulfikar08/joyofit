import type { Platform } from '@/features/onboarding/flow';
import { proOffer } from '@/features/onboarding/pro';

/**
 * Where in the app a Pro upgrade card sits. It names the copy and the `utm_campaign` / store campaign of the link, so the moment that
 * converts is visible in RevKlik and Play Console.
 */
export type ProMoment = 'coach-chat' | 'coach' | 'coach-today' | 'cloud' | 'workout' | 'koneksi' | 'family' | 'onboarding' | 'onboarding-cloud';

export type Distribution = 'play' | 'sideload';

/** The JoyoRogo app's own screen for Pro. Tried first on Android: someone who already has JoyoRogo lands on its Pro page. */
export const JOYOROGO_APP_URL = 'joyorogo://founder?from=joyofit';

export const JOYOROGO_PLAY_ID = 'com.joyodigitama.joyorogo';

export const JOYOROGO_WEB_PRO_URL = 'https://joyorogo.com/pro';

/** The in-app paywall (`src/app/pro.tsx`): where iOS buys JoyoRogo Pro with StoreKit. */
export const PRO_PAYWALL_ROUTE = '/pro';

/** utm convention: docs/utm.md in the joyorogo repo (`evergreen-<where>`). */
export const campaignOf = (moment: ProMoment): string => `evergreen-pro-${moment}`;

/**
 * `paywall`: iOS, the in-app paywall; the purchase is JoyoFit's own in-app purchase, nothing leaves the app. `app-or-store`: Google
 * Play, the JoyoRogo app or its store listing, where Pro is bought with Play Billing; no price is shown and no checkout is linked.
 * `web`: a sideloaded build, which may show the live price and link to the web page.
 */
export type ProUpgradeAction =
  | { kind: 'paywall'; showPrice: false }
  | {
      kind: 'app-or-store';
      /** Tried first; rejects when the JoyoRogo app is not installed. */
      appUrl: string;
      /** The store app's `market://` link. */
      primaryUrl: string;
      /** The https listing, for a phone where `market://` has no handler. */
      fallbackUrl: string;
      showPrice: false;
    }
  | {
      kind: 'web';
      appUrl: string;
      /** The web page with utm tags. */
      primaryUrl: string;
      fallbackUrl: null;
      /** Only a sideloaded build may show a price. */
      showPrice: true;
    };

/**
 * What the upgrade button may do on this build. The stores' rules decide (see `proOffer`): iOS opens the paywall, which sells with
 * StoreKit; Play never gets a price or a link to a web checkout, only the JoyoRogo app or its listing; a sideloaded APK gets the web
 * page and the live price.
 */
export function proUpgradeAction(platform: Platform, distribution: Distribution, moment: ProMoment): ProUpgradeAction {
  const campaign = campaignOf(moment);
  const offer = proOffer(platform, distribution);
  if (offer === 'iap') return { kind: 'paywall', showPrice: false };
  if (offer === 'web') {
    return {
      kind: 'web',
      appUrl: JOYOROGO_APP_URL,
      primaryUrl: `${JOYOROGO_WEB_PRO_URL}?from=joyofit&utm_source=joyofit&utm_medium=app&utm_campaign=${campaign}`,
      fallbackUrl: null,
      showPrice: true,
    };
  }
  const referrer = `utm_source%3Djoyofit%26utm_medium%3Dapp%26utm_campaign%3D${campaign}`;
  return {
    kind: 'app-or-store',
    appUrl: JOYOROGO_APP_URL,
    primaryUrl: `market://details?id=${JOYOROGO_PLAY_ID}&referrer=${referrer}`,
    fallbackUrl: `https://play.google.com/store/apps/details?id=${JOYOROGO_PLAY_ID}&referrer=${referrer}`,
    showPrice: false,
  };
}

export interface ProUpgradeOpeners {
  /** `Linking.openURL`; rejects when nothing handles the link, which is how a missing app is told apart without `canOpenURL` (that would need a native `queries` entry). */
  open: (url: string) => Promise<unknown>;
  /** Shows the in-app paywall. */
  showPaywall: () => void;
}

/**
 * Carries out `action`: the paywall, or the first link that works (the JoyoRogo app, then the store or web page, then the https
 * listing). Returns false when every link failed.
 */
export async function openProUpgrade(action: ProUpgradeAction, { open, showPaywall }: ProUpgradeOpeners): Promise<boolean> {
  if (action.kind === 'paywall') {
    showPaywall();
    return true;
  }
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
