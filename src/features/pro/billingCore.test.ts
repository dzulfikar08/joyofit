import { describe, expect, test } from 'bun:test';

import { fetchBillingSwitch, PRO_PRODUCT_IDS, yearlySavingPercent } from './billingCore';

describe('product ids', () => {
  test('are JoyoFit own subscriptions, the same ids on both stores', () => {
    expect(PRO_PRODUCT_IDS).toEqual({
      monthly: 'com.joyodigitama.joyofit.pro.monthly',
      yearly: 'com.joyodigitama.joyofit.pro.yearly',
    });
  });
});

describe('fetchBillingSwitch', () => {
  const config = (body: unknown, status = 200, seen?: { url: string }) =>
    (async (url: string) => {
      if (seen) seen.url = url;
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;

  test('reads the flag of the store from /api/config; anything unreadable is null, not off', async () => {
    const seen = { url: '' };
    expect(await fetchBillingSwitch('https://api.example.com', 'appleBilling', config({ appleBilling: true }, 200, seen))).toBe(true);
    expect(seen.url).toBe('https://api.example.com/api/config');
    expect(await fetchBillingSwitch('https://api.example.com', 'appleBilling', config({ appleBilling: false }))).toBe(false);
    expect(await fetchBillingSwitch('https://api.example.com', 'appleBilling', config({}))).toBeNull();
    expect(await fetchBillingSwitch('https://api.example.com', 'appleBilling', config({}, 500))).toBeNull();
    const offline = (async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    expect(await fetchBillingSwitch('https://api.example.com', 'appleBilling', offline)).toBeNull();
  });

  test('Google Play billing has its own flag, independent of Apple\'s', async () => {
    const both = config({ appleBilling: false, googlePlayBilling: true });
    expect(await fetchBillingSwitch('https://api.example.com', 'googlePlayBilling', both)).toBe(true);
    expect(await fetchBillingSwitch('https://api.example.com', 'appleBilling', both)).toBe(false);
    expect(await fetchBillingSwitch('https://api.example.com', 'googlePlayBilling', config({ appleBilling: true }))).toBeNull();
  });
});

describe('yearlySavingPercent', () => {
  test('compares a year with twelve months', () => {
    expect(yearlySavingPercent('29000', '199000')).toBe(43);
    expect(yearlySavingPercent('9.99', '59.99')).toBe(50);
  });
  test('no saving or unreadable prices is null', () => {
    expect(yearlySavingPercent('10', '120')).toBeNull();
    expect(yearlySavingPercent('10', '130')).toBeNull();
    expect(yearlySavingPercent('x', '120')).toBeNull();
    expect(yearlySavingPercent('0', '120')).toBeNull();
  });
});
