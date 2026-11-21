import { describe, expect, test } from 'bun:test';

import { CONNECTOR_CONSENT_VERSION } from '@/features/koneksi/consent';
import type { ByokAccess } from './access';
import { aiRecipients, chatGate } from './aiPrivacy';
import { CONSENT_VERSION } from './consent';
import { chatRequestBody, guardHosted } from './hostedChat';
import { grantHostedConsent, HOSTED_CONSENT_VERSION, HostedConsentError, withdrawHostedConsent } from './hostedConsent';
import type { KvStore } from './kv';
import { createSettingsStore, DEFAULT_SETTINGS, type AiSettings } from './settings';

function memoryKv(): KvStore {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

const ready: ByokAccess = { ok: true, provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'm' };
const noConsent: ByokAccess = { ok: false, reason: 'noConsent' };
const yes = { version: HOSTED_CONSENT_VERSION, at: 1_763_000_000 };
const settings = (over: Partial<AiSettings>): AiSettings => ({ ...DEFAULT_SETTINGS, ...over });

describe('the consent gate in front of the Joyo AI chat', () => {
  test('Pro on the hosted engine without a yes: the consent screen, not the chat', () => {
    expect(chatGate({ settings: settings({}), access: null, coachAccess: 'pro' })).toBe('rogoConsent');
  });

  test('a yes for an older list of data asks again', () => {
    const old = settings({ hostedConsent: { version: HOSTED_CONSENT_VERSION - 1, at: 1 } });
    expect(chatGate({ settings: old, access: null, coachAccess: 'pro' })).toBe('rogoConsent');
  });

  test('after Allow the chat opens; after withdrawing it closes again', () => {
    const store = createSettingsStore(memoryKv());
    expect(chatGate({ settings: store.get(), access: null, coachAccess: 'pro' })).toBe('rogoConsent');
    grantHostedConsent(store, 1_763_000_000);
    expect(chatGate({ settings: store.get(), access: null, coachAccess: 'pro' })).toBe('ready');
    withdrawHostedConsent(store);
    expect(chatGate({ settings: store.get(), access: null, coachAccess: 'pro' })).toBe('rogoConsent');
  });

  test('Not now sends nothing: the hosted request is refused before it reaches the network', async () => {
    const store = createSettingsStore(memoryKv());
    const sent: string[] = [];
    const ask = guardHosted(store, async (text: string) => void sent.push(text));
    expect(chatGate({ settings: store.get(), access: null, coachAccess: 'pro' })).toBe('rogoConsent');
    await expect(ask('how did I sleep?')).rejects.toBeInstanceOf(HostedConsentError);
    expect(sent).toEqual([]);
  });

  test('no Pro or signed out: the sign-in or upgrade card, never the chat', () => {
    expect(chatGate({ settings: settings({ hostedConsent: yes }), access: null, coachAccess: 'free' })).toBe('rogoUpsell');
    expect(chatGate({ settings: settings({}), access: null, coachAccess: 'signedOut' })).toBe('rogoSignIn');
    expect(chatGate({ settings: settings({}), access: null, coachAccess: 'checking' })).toBe('checking');
  });

  test('own key: the chat only with a ready key and that provider’s own consent; the hosted yes does not count for it', () => {
    const own = settings({ engine: 'byok', provider: 'openrouter', hostedConsent: yes });
    expect(chatGate({ settings: own, access: noConsent, coachAccess: 'pro' })).toBe('blocked');
    expect(chatGate({ settings: own, access: null, coachAccess: 'pro' })).toBe('checking');
    expect(chatGate({ settings: settings({ engine: 'byok', provider: 'openrouter' }), access: ready, coachAccess: 'free' })).toBe('ready');
  });
});

describe('AI and your data: the recipients listed in Settings', () => {
  test('nothing allowed: hosted and the connector are listed as not allowed, no own-key provider', () => {
    expect(aiRecipients(settings({}))).toEqual([
      { kind: 'hosted', granted: false, at: null },
      { kind: 'connector', granted: false, at: null },
    ]);
  });

  test('each yes is listed with its date and, for an own key, the provider and host it covers', () => {
    const list = aiRecipients(
      settings({
        hostedConsent: yes,
        connectorConsent: { version: CONNECTOR_CONSENT_VERSION, at: 5 },
        consents: {
          anthropic: { version: CONSENT_VERSION, at: 7, host: 'api.anthropic.com', adult: true },
          openai: { version: CONSENT_VERSION - 1, at: 3, host: 'api.openai.com', adult: true },
        },
      }),
    );
    expect(list).toEqual([
      { kind: 'hosted', granted: true, at: yes.at },
      { kind: 'own', provider: 'anthropic', host: 'api.anthropic.com', at: 7 },
      { kind: 'connector', granted: true, at: 5 },
    ]);
  });
});

describe('the hosted request carries the yes it was sent under', () => {
  test('version and time of the consent go with the messages, so the server can check them', () => {
    const body = chatRequestBody([{ role: 'user', content: 'hi' }], { today: '2026-11-18' }, 'en', yes);
    expect(body).toEqual({ messages: [{ role: 'user', content: 'hi' }], snapshot: { today: '2026-11-18' }, locale: 'en', aiConsent: { version: HOSTED_CONSENT_VERSION, at: yes.at } });
  });
});
