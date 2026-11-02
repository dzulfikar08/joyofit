import { describe, expect, test } from 'bun:test';

import type { Platform } from '@/features/onboarding/flow';
import { applyLocale, t } from '@/i18n';

import {
  dismissalExpired,
  DISMISS_MS,
  JOYOROGO_APP_URL,
  openProUpgrade,
  PRO_PAYWALL_ROUTE,
  type ProUpgradeAction,
  type ProUpgradeOpeners,
  proUpgradeAction,
  type Distribution,
  type ProMoment,
} from './offer';

/** The action of a build that links out; the paywall has no link. */
const linked = (action: ProUpgradeAction) => {
  if (action.kind === 'paywall') throw new Error('the paywall has no link');
  return action;
};

const MOMENTS: ProMoment[] = ['coach-chat', 'coach', 'coach-today', 'cloud', 'workout', 'koneksi', 'family', 'onboarding', 'onboarding-cloud'];

describe('proUpgradeAction: store rules per platform and distribution', () => {
  test('Google Play: the in-app paywall (Play Billing), no price here, no link to another app, a listing or a web checkout', () => {
    for (const moment of MOMENTS) {
      const action = proUpgradeAction('android', 'play', moment);
      expect(action).toEqual({ kind: 'paywall', showPrice: false });
      expect(JSON.stringify(action)).not.toContain('joyorogo');
    }
  });

  test('iOS: the in-app paywall, no price here, no link to another app or a web checkout, whatever the distribution constant says', () => {
    for (const distribution of ['play', 'sideload'] as Distribution[]) {
      for (const moment of MOMENTS) {
        const action = proUpgradeAction('ios', distribution, moment);
        expect(action).toEqual({ kind: 'paywall', showPrice: false });
      }
    }
  });

  test('sideloaded Android: the web page with utm tags and the live price', () => {
    for (const moment of MOMENTS) {
      const action = linked(proUpgradeAction('android', 'sideload', moment));
      expect(action.kind).toBe('web');
      expect(action.showPrice).toBe(true);
      expect(action.primaryUrl).toBe(
        `https://joyorogo.com/pro?from=joyofit&utm_source=joyofit&utm_medium=app&utm_campaign=evergreen-pro-${moment}`,
      );
    }
  });

  test('a sideloaded build tries the JoyoRogo app first, by its custom scheme; the stores\' builds have no such link at all', () => {
    const action = linked(proUpgradeAction('android', 'sideload', 'koneksi'));
    expect(action.appUrl).toBe(JOYOROGO_APP_URL);
    expect(JOYOROGO_APP_URL).toBe('joyorogo://founder?from=joyofit');
    expect(JSON.stringify(proUpgradeAction('ios', 'play', 'koneksi'))).not.toContain('joyorogo');
    expect(JSON.stringify(proUpgradeAction('android', 'play', 'koneksi'))).not.toContain('joyorogo');
  });

  test('only a sideloaded build ever shows a price', () => {
    const shown = (['ios', 'android'] as Platform[]).flatMap((platform) =>
      (['play', 'sideload'] as Distribution[]).filter((distribution) => proUpgradeAction(platform, distribution, 'cloud').showPrice).map((d) => `${platform}/${d}`),
    );
    expect(shown).toEqual(['android/sideload']);
  });
});

describe('openProUpgrade', () => {
  const fakeOpen = (installed: (url: string) => boolean) => {
    const tried: string[] = [];
    let paywall = 0;
    const openers: ProUpgradeOpeners = {
      open: async (url: string) => {
        tried.push(url);
        if (!installed(url)) throw new Error('Could not open URL');
      },
      showPaywall: () => {
        paywall += 1;
      },
    };
    return { tried, openers, paywalls: () => paywall };
  };

  test('iOS and Google Play: show the paywall and open no link', async () => {
    for (const platform of ['ios', 'android'] as Platform[]) {
      const { tried, openers, paywalls } = fakeOpen(() => true);
      expect(await openProUpgrade(proUpgradeAction(platform, 'play', 'cloud'), openers)).toBe(true);
      expect(paywalls()).toBe(1);
      expect(tried).toEqual([]);
    }
    expect(PRO_PAYWALL_ROUTE).toBe('/pro');
  });

  test('sideload with the JoyoRogo app installed: opens its app and stops', async () => {
    const { tried, openers, paywalls } = fakeOpen(() => true);
    expect(await openProUpgrade(proUpgradeAction('android', 'sideload', 'cloud'), openers)).toBe(true);
    expect(tried).toEqual([JOYOROGO_APP_URL]);
    expect(paywalls()).toBe(0);
  });

  test('sideload without the app: the web page', async () => {
    const action = linked(proUpgradeAction('android', 'sideload', 'koneksi'));
    const { tried, openers } = fakeOpen((url) => url.startsWith('https://'));
    expect(await openProUpgrade(action, openers)).toBe(true);
    expect(tried).toEqual([JOYOROGO_APP_URL, action.primaryUrl]);
  });

  test('nothing opens: false, never a throw', async () => {
    const { openers } = fakeOpen(() => false);
    expect(await openProUpgrade(proUpgradeAction('android', 'sideload', 'cloud'), openers)).toBe(false);
  });
});

describe('dismissal', () => {
  const now = 1_800_000_000_000;
  test('never dismissed or garbage: shows', () => {
    expect(dismissalExpired(null, now)).toBe(true);
    expect(dismissalExpired(Number.NaN, now)).toBe(true);
  });
  test('hidden for two weeks, then shows again', () => {
    expect(dismissalExpired(now - 1000, now)).toBe(false);
    expect(dismissalExpired(now - DISMISS_MS + 1, now)).toBe(false);
    expect(dismissalExpired(now - DISMISS_MS, now)).toBe(true);
  });
  test('a clock set back does not hide the card for good', () => {
    expect(dismissalExpired(now + 1000, now)).toBe(true);
  });
});

describe('copy', () => {
  test('every moment has text in both languages, the button reads "Upgrade ke Pro" and no moment text has an em dash or a price', () => {
    for (const locale of ['id', 'en'] as const) {
      applyLocale(locale);
      for (const moment of MOMENTS) {
        const body = t(`pro:upgrade.moment.${moment}`);
        expect(body.length).toBeGreaterThan(20);
        expect(body).not.toContain('\u2014');
        expect(body).not.toMatch(/Rp\s?\d/);
      }
    }
    applyLocale('id');
    expect(t('pro:upgrade.cta')).toBe('Upgrade ke Pro');
    expect(t('pro:upgrade.title')).toBe('Upgrade ke Pro');
    expect(t('pro:upgrade.later')).toBe('Nanti');
  });
});
