import { describe, expect, test } from 'bun:test';

import { applyLocale } from '@/i18n';

import {
  AppleBillingError,
  appleAccountToken,
  fetchAppleBilling,
  postSignedTransaction,
  PRO_PRODUCT_IDS,
  yearlySavingPercent,
} from './appleBillingCore';

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

describe('product ids', () => {
  test('are JoyoFit own subscriptions', () => {
    expect(PRO_PRODUCT_IDS).toEqual({
      monthly: 'com.joyodigitama.joyofit.pro.monthly',
      yearly: 'com.joyodigitama.joyofit.pro.yearly',
    });
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
    expect(await post(spy)).toEqual({ sandbox: false });
    expect(url).toBe('https://api.example.com/api/billing/apple');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Cookie).toBe('better-auth.session_token=abc');
    expect(init?.body).toBe(JSON.stringify({ signedTransaction: 'jws' }));
  });

  test('reports the sandbox verdict', async () => {
    expect(await post(answer(200, { activated: true, sandbox: true }))).toEqual({ sandbox: true });
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
      expect(error).toBeInstanceOf(AppleBillingError);
      expect((error as AppleBillingError).reason).toBe(reason as AppleBillingError['reason']);
      expect((error as AppleBillingError).definitive).toBe(definitive);
    }
  });

  test('no cookie is a sign-in error without a request; a network failure is unreachable and not final', async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      return new Response('{}');
    }) as unknown as typeof fetch;
    expect(((await post(spy, '').catch((e: unknown) => e)) as AppleBillingError).reason).toBe('signIn');
    expect(called).toBe(false);
    const offline = (async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    const error = (await post(offline).catch((e: unknown) => e)) as AppleBillingError;
    expect(error.reason).toBe('unreachable');
    expect(error.definitive).toBe(false);
  });

  test('every failure has a sentence in both languages', async () => {
    for (const locale of ['id', 'en'] as const) {
      await applyLocale(locale);
      for (const status of [400, 401, 403, 404, 409, 500]) {
        const error = (await post(answer(status)).catch((e: unknown) => e)) as AppleBillingError;
        expect(error.message.length).toBeGreaterThan(20);
        expect(error.message.startsWith('pro:')).toBe(false);
      }
    }
    await applyLocale('id');
  });
});

describe('fetchAppleBilling', () => {
  test('reads appleBilling of /api/config; anything unreadable is null, not off', async () => {
    let requested = '';
    const config = (body: unknown, status = 200) =>
      (async (url: string) => {
        requested = url;
        return new Response(JSON.stringify(body), { status });
      }) as unknown as typeof fetch;
    expect(await fetchAppleBilling('https://api.example.com', config({ appleBilling: true }))).toBe(true);
    expect(requested).toBe('https://api.example.com/api/config');
    expect(await fetchAppleBilling('https://api.example.com', config({ appleBilling: false }))).toBe(false);
    expect(await fetchAppleBilling('https://api.example.com', config({}))).toBeNull();
    expect(await fetchAppleBilling('https://api.example.com', config({}, 500))).toBeNull();
    const offline = (async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    expect(await fetchAppleBilling('https://api.example.com', offline)).toBeNull();
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
