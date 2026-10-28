import { describe, expect, test } from 'bun:test';

import { applyLocale } from '@/i18n';

import { fetchProConfig, formatIdr, parseProConfig, priceLine, proOffer, scansLine } from './pro';

const LIVE = {
  paywall: true,
  billing: true,
  freeDailyScans: 3,
  founderDailyCap: 100,
  founderPriceIdr: 29000,
  founderYearlyPriceIdr: 199000,
  promo: { slots: 110, taken: 12, nextPriceIdr: 49000 },
  anonScans: 2,
};

describe('store rules for the Pro step', () => {
  test('iOS sells Pro with its own in-app purchase, whatever the distribution constant says', () => {
    expect(proOffer('ios', 'sideload')).toBe('iap');
    expect(proOffer('ios', 'play')).toBe('iap');
  });

  test('a Google Play build describes Pro and points at the store listing only', () => {
    expect(proOffer('android', 'play')).toBe('store');
  });

  test('a sideloaded Android build may show the price and the web page', () => {
    expect(proOffer('android', 'sideload')).toBe('web');
  });
});

describe('the live config', () => {
  test('reads the prices and scan limits JoyoRogo serves', () => {
    expect(parseProConfig(LIVE)).toEqual({
      monthlyIdr: 29000,
      yearlyIdr: 199000,
      nextMonthlyIdr: 49000,
      proDailyScans: 100,
      freeDailyScans: 3,
    });
  });

  test('a config without a promo or with junk values keeps what is valid', () => {
    const config = parseProConfig({ founderPriceIdr: 29000, founderYearlyPriceIdr: 'x', promo: null, founderDailyCap: -1 });
    expect(config).toEqual({ monthlyIdr: 29000, yearlyIdr: null, nextMonthlyIdr: null, proDailyScans: null, freeDailyScans: null });
  });

  test('something that is not a config is null', () => {
    expect(parseProConfig(null)).toBeNull();
    expect(parseProConfig('x')).toBeNull();
    expect(parseProConfig({})).toBeNull();
  });

  test('fetches from the server base URL and survives every failure', async () => {
    let requested = '';
    const ok = (async (url: string) => {
      requested = url;
      return new Response(JSON.stringify(LIVE));
    }) as unknown as typeof fetch;
    expect((await fetchProConfig('https://api.example.com', ok))?.monthlyIdr).toBe(29000);
    expect(requested).toBe('https://api.example.com/api/config');

    const bad = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    expect(await fetchProConfig('https://api.example.com', bad)).toBeNull();
    const offline = (async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    expect(await fetchProConfig('https://api.example.com', offline)).toBeNull();
    const html = (async () => new Response('<html>')) as unknown as typeof fetch;
    expect(await fetchProConfig('https://api.example.com', html)).toBeNull();
  });
});

describe('wording from the config', () => {
  test('rupiah are written with dots', () => {
    expect(formatIdr(29000)).toBe('Rp29.000');
    expect(formatIdr(1250000)).toBe('Rp1.250.000');
    expect(formatIdr(500)).toBe('Rp500');
  });

  test('the price line carries monthly, yearly and the announced rise', () => {
    expect(priceLine(parseProConfig(LIVE))).toBe(
      'Rp29.000 per bulan atau Rp199.000 per tahun. Harga bulanan itu harga perkenalan dan naik menjadi Rp49.000 setelah kuota perkenalan habis.',
    );
  });

  test('no price known means no price line', () => {
    expect(priceLine(null)).toBeNull();
    expect(priceLine(parseProConfig({ founderDailyCap: 100 }))).toBeNull();
  });

  test('only one price is shown when only one is served', () => {
    expect(priceLine(parseProConfig({ founderPriceIdr: 29000 }))).toBe('Rp29.000 per bulan.');
  });

  test('the scan line uses the served numbers and never invents them', () => {
    expect(scansLine(parseProConfig(LIVE))).toBe('Sampai 100 pindai makanan AI per hari di JoyoRogo, bukan 3.');
    expect(scansLine(parseProConfig({ founderDailyCap: 100 }))).toBe('Sampai 100 pindai makanan AI per hari di JoyoRogo.');
    expect(scansLine(null)).toBe('Batas harian pindai makanan AI di JoyoRogo jauh lebih tinggi.');
  });

  test('the lines read in English too', async () => {
    await applyLocale('en');
    try {
      expect(priceLine(parseProConfig(LIVE))).toBe(
        'Rp29.000 a month or Rp199.000 a year. The monthly price is an introductory one and rises to Rp49.000 once the intro places are taken.',
      );
      expect(scansLine(parseProConfig(LIVE))).toBe('Up to 100 AI meal scans a day in JoyoRogo, instead of 3.');
    } finally {
      await applyLocale('id');
    }
  });
});
