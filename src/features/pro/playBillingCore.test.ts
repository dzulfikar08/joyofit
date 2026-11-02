import { describe, expect, test } from 'bun:test';

import { applyLocale } from '@/i18n';

import { BillingError } from './billingCore';
import { pickPlanOffer, PLAY_PACKAGE_NAME, playManageUrl, postPurchaseToken, type PlayOfferLike } from './playBillingCore';

describe('postPurchaseToken', () => {
  const answer = (status: number, body: unknown = {}) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  const post = (fetchImpl: typeof fetch, cookie: string | null = 'better-auth.session_token=abc') =>
    postPurchaseToken({ baseUrl: 'https://api.example.com', cookie, purchaseToken: 'token-123456', fetchImpl });
  const refusal = async (status: number, body: unknown = {}) => (await post(answer(status, body)).catch((e: unknown) => e)) as BillingError;

  test('sends the token, the JoyoFit package and the session cookie to /api/billing/google', async () => {
    let url = '';
    let init: RequestInit | undefined;
    const spy = (async (u: string, i: RequestInit) => {
      url = u;
      init = i;
      return new Response(JSON.stringify({ status: 'granted', activated: true, founderUntil: 'x' }));
    }) as unknown as typeof fetch;
    expect(await post(spy)).toEqual({ status: 'granted' });
    expect(url).toBe('https://api.example.com/api/billing/google');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Cookie).toBe('better-auth.session_token=abc');
    expect(JSON.parse(init?.body as string)).toEqual({ purchaseToken: 'token-123456', packageName: 'com.joyodigitama.joyofit' });
    expect(PLAY_PACKAGE_NAME).toBe('com.joyodigitama.joyofit');
  });

  test('every status JoyoRogo answers with is passed on; an unknown one is a failure', async () => {
    for (const status of ['granted', 'already', 'pending', 'inactive'] as const) {
      expect(await post(answer(200, { status }))).toEqual({ status });
    }
    const error = await refusal(200, { status: 'surprise' });
    expect(error).toBeInstanceOf(BillingError);
    expect(error.reason).toBe('failed');
    expect((await refusal(200, {})).reason).toBe('failed');
  });

  test('maps every refusal to a reason and says whether it is final', async () => {
    const cases: [number, unknown, string, boolean][] = [
      [400, { code: 'invalidReceipt' }, 'invalid', true],
      [401, { code: 'signIn' }, 'signIn', false],
      [409, { code: 'otherAccount' }, 'otherAccount', true],
      [409, { code: 'processing' }, 'processing', false],
      [409, {}, 'processing', false],
      [404, { code: 'unavailable' }, 'unavailable', false],
      [502, { code: 'unreachable' }, 'unavailable', false],
      [500, {}, 'failed', false],
    ];
    for (const [status, body, reason, definitive] of cases) {
      const error = await refusal(status, body);
      expect(error).toBeInstanceOf(BillingError);
      expect(error.reason).toBe(reason as BillingError['reason']);
      expect(error.definitive).toBe(definitive);
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
      for (const reason of ['signIn', 'otherAccount', 'invalid', 'processing', 'unavailable', 'unreachable', 'alreadyOwned', 'failed'] as const) {
        const message = new BillingError(reason, false).message;
        expect(message.length).toBeGreaterThan(20);
        expect(message.startsWith('pro:')).toBe(false);
      }
    }
    await applyLocale('id');
  });
});

describe('pickPlanOffer', () => {
  const phase = (formattedPrice: string, micros: string) => ({ formattedPrice, priceAmountMicros: micros, priceCurrencyCode: 'IDR' });
  const offer = (basePlan: string, token: string, phases: ReturnType<typeof phase>[]): PlayOfferLike => ({
    basePlanIdAndroid: basePlan,
    offerTokenAndroid: token,
    displayPrice: phases[phases.length - 1]?.formattedPrice,
    pricingPhasesAndroid: { pricingPhaseList: phases },
  });

  test('takes the plain base plan of the plan, with Play\'s own price text and the amount for the saving', () => {
    const offers = [offer('monthly', 'tok-m', [phase('Rp29.000', '29000000000')]), offer('yearly', 'tok-y', [phase('Rp199.000', '199000000000')])];
    expect(pickPlanOffer(offers, 'monthly')).toEqual({ displayPrice: 'Rp29.000', price: '29000', offerToken: 'tok-m' });
    expect(pickPlanOffer(offers, 'yearly')).toEqual({ displayPrice: 'Rp199.000', price: '199000', offerToken: 'tok-y' });
  });

  test('a promotional offer (extra pricing phase) never wins over the base plan, whatever the order', () => {
    const promo = offer('monthly', 'tok-promo', [phase('Rp0', '0'), phase('Rp29.000', '29000000000')]);
    const base = offer('monthly', 'tok-base', [phase('Rp29.000', '29000000000')]);
    expect(pickPlanOffer([promo, base], 'monthly')?.offerToken).toBe('tok-base');
    expect(pickPlanOffer([base, promo], 'monthly')?.offerToken).toBe('tok-base');
  });

  test('another plan\'s base plan, a missing token or an unreadable price is no offer', () => {
    expect(pickPlanOffer([offer('yearly', 'tok-y', [phase('Rp199.000', '199000000000')])], 'monthly')).toBeNull();
    expect(pickPlanOffer([{ basePlanIdAndroid: 'monthly', pricingPhasesAndroid: { pricingPhaseList: [phase('Rp29.000', '29000000000')] } }], 'monthly')).toBeNull();
    expect(pickPlanOffer([offer('monthly', 'tok', [phase('Rp29.000', 'x')])], 'monthly')).toBeNull();
    expect(pickPlanOffer([], 'monthly')).toBeNull();
  });
});

describe('playManageUrl', () => {
  test('opens the subscription this account holds, or the app\'s subscriptions without one', () => {
    expect(playManageUrl('com.joyodigitama.joyofit.pro.yearly')).toBe(
      'https://play.google.com/store/account/subscriptions?sku=com.joyodigitama.joyofit.pro.yearly&package=com.joyodigitama.joyofit',
    );
    expect(playManageUrl()).toBe('https://play.google.com/store/account/subscriptions?package=com.joyodigitama.joyofit');
  });
});
