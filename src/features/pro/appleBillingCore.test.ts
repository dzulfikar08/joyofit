import { describe, expect, test } from 'bun:test';

import { applyLocale } from '@/i18n';

import { appleAccountToken, appleStoreProduct, appleTrialDays, postSignedTransaction, type AppleProductLike } from './appleBillingCore';
import { BillingError } from './billingCore';

describe('appleAccountToken', () => {
  // Vectors computed with `appleAccountToken` of JoyoRogo's packages/api/src/lib/apple.ts (the server that checks the token).
  test('matches JoyoRogo for known user ids', () => {
    expect(appleAccountToken('user-123')).toBe('71697436-9f12-580a-9f77-19134ce2c98a');
    expect(appleAccountToken('aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW')).toBe('05e1870f-8025-52f5-bb6d-07eea398f5c7');
    expect(appleAccountToken('0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b')).toBe('8bf72f5e-14aa-57f8-9cf3-0ae3f830cb54');
  });

  test('is a version 5, RFC 4122 variant UUID that StoreKit accepts', () => {
    expect(appleAccountToken('anyone')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('postSignedTransaction', () => {
  const answer = (status: number, body: unknown = {}) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  const post = (fetchImpl: typeof fetch, cookie: string | null = 'better-auth.session_token=abc') =>
    postSignedTransaction({ baseUrl: 'https://api.example.com', cookie, signedTransaction: 'jws', fetchImpl });

  test('sends the JWS and the session cookie to /api/billing/apple', async () => {
    let url = '';
    let init: RequestInit | undefined;
    const spy = (async (u: string, i: RequestInit) => {
      url = u;
      init = i;
      return new Response(JSON.stringify({ activated: true, founderUntil: 'x', sandbox: false }));
    }) as unknown as typeof fetch;
    await post(spy);
    expect(url).toBe('https://api.example.com/api/billing/apple');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Cookie).toBe('better-auth.session_token=abc');
    expect(init?.body).toBe(JSON.stringify({ signedTransaction: 'jws' }));
  });

  test('a sandbox receipt is credited like a real one', async () => {
    await post(answer(200, { activated: true, sandbox: true }));
  });

  test('maps every refusal to a reason and says whether it is final', async () => {
    const cases: [number, string, boolean][] = [
      [400, 'invalid', true],
      [403, 'otherAccount', true],
      [401, 'signIn', false],
      [404, 'unavailable', false],
      [409, 'processing', false],
      [500, 'failed', false],
    ];
    for (const [status, reason, definitive] of cases) {
      const error = await post(answer(status)).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BillingError);
      expect((error as BillingError).reason).toBe(reason as BillingError['reason']);
      expect((error as BillingError).definitive).toBe(definitive);
    }
  });

  test('no cookie is a sign-in error without a request; a network failure is unreachable and not final', async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      return new Response('{}');
    }) as unknown as typeof fetch;
    expect(((await post(spy, '').catch((e: unknown) => e)) as BillingError).reason).toBe('signIn');
    expect(called).toBe(false);
    const offline = (async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    const error = (await post(offline).catch((e: unknown) => e)) as BillingError;
    expect(error.reason).toBe('unreachable');
    expect(error.definitive).toBe(false);
  });

  test('every failure has a sentence in both languages', async () => {
    for (const locale of ['id', 'en'] as const) {
      await applyLocale(locale);
      for (const status of [400, 401, 403, 404, 409, 500]) {
        const error = (await post(answer(status)).catch((e: unknown) => e)) as BillingError;
        expect(error.message.length).toBeGreaterThan(20);
        expect(error.message.startsWith('pro:')).toBe(false);
      }
    }
    await applyLocale('id');
  });
});

describe('appleTrialDays', () => {
  const yearly: AppleProductLike = {
    displayPrice: 'Rp199.000',
    price: '199000',
    introPaymentMode: 'freeTrial',
    introPeriodUnit: 'day',
    introPeriodValue: '7',
    introPeriodCount: '1',
    introEligible: 'true',
  };

  test('an eligible Apple ID gets the free trial, in days', () => {
    expect(appleTrialDays(yearly)).toBe(7);
    expect(appleTrialDays({ ...yearly, introPeriodUnit: 'week', introPeriodValue: '1' })).toBe(7);
    expect(appleTrialDays({ ...yearly, introPeriodUnit: 'week', introPeriodValue: '2' })).toBe(14);
    expect(appleTrialDays({ ...yearly, introPeriodValue: '1', introPeriodCount: '3' })).toBe(3);
  });

  test('no trial when not eligible, eligibility unknown (older binary), a paid intro offer, or a month-long trial', () => {
    expect(appleTrialDays({ ...yearly, introEligible: 'false' })).toBeNull();
    expect(appleTrialDays({ ...yearly, introEligible: undefined })).toBeNull();
    expect(appleTrialDays({ displayPrice: 'Rp199.000', price: '199000' })).toBeNull();
    expect(appleTrialDays({ ...yearly, introPaymentMode: 'payUpFront' })).toBeNull();
    expect(appleTrialDays({ ...yearly, introPaymentMode: 'payAsYouGo' })).toBeNull();
    expect(appleTrialDays({ ...yearly, introPeriodUnit: 'month', introPeriodValue: '1' })).toBeNull();
    expect(appleTrialDays({ ...yearly, introPeriodValue: '0' })).toBeNull();
    expect(appleTrialDays({ ...yearly, introPeriodValue: 'x' })).toBeNull();
  });

  test('appleStoreProduct keeps the price and shows the trial only on a plan that has one', () => {
    expect(appleStoreProduct(yearly, true)).toEqual({ displayPrice: 'Rp199.000', price: '199000', trialDays: 7 });
    expect(appleStoreProduct(yearly, false)).toEqual({ displayPrice: 'Rp199.000', price: '199000', trialDays: null });
  });
});
