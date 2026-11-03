import { describe, expect, test } from 'bun:test';

import { guardHosted } from './hostedChat';
import {
  grantHostedConsent,
  HOSTED_CONSENT_CATEGORIES,
  HOSTED_CONSENT_VERSION,
  HostedConsentError,
  hasHostedConsent,
  SNAPSHOT_FIELD_CATEGORY,
  withdrawHostedConsent,
} from './hostedConsent';
import type { KvStore } from './kv';
import { createSettingsStore, DEFAULT_SETTINGS, parseSettings } from './settings';

function memoryKv(): KvStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

/** A chat function that counts what reaches "the network". */
function fakeChat() {
  const sent: string[] = [];
  return { sent, send: async (text: string) => (sent.push(text), `answer to ${text}`) };
}

describe('the hosted Joyo AI gate', () => {
  test('no consent: the request is refused and nothing is sent', async () => {
    const store = createSettingsStore(memoryKv());
    const chat = fakeChat();
    const ask = guardHosted(store, chat.send);
    expect(hasHostedConsent(store.get())).toBe(false);
    await expect(ask('how did I sleep?')).rejects.toBeInstanceOf(HostedConsentError);
    expect(chat.sent).toEqual([]);
  });

  test('an explicit yes opens it, and the request goes through', async () => {
    const store = createSettingsStore(memoryKv());
    const chat = fakeChat();
    const ask = guardHosted(store, chat.send);
    grantHostedConsent(store, 1_800_000_000);
    expect(store.get().hostedConsent).toEqual({ version: HOSTED_CONSENT_VERSION, at: 1_800_000_000 });
    expect(await ask('hi')).toBe('answer to hi');
    expect(chat.sent).toEqual(['hi']);
  });

  test('a yes for an older list of data no longer counts: the person is asked again', async () => {
    const store = createSettingsStore(memoryKv());
    store.update({ hostedConsent: { version: HOSTED_CONSENT_VERSION - 1, at: 1 } });
    const chat = fakeChat();
    const ask = guardHosted(store, chat.send);
    expect(hasHostedConsent(store.get())).toBe(false);
    await expect(ask('hi')).rejects.toBeInstanceOf(HostedConsentError);
    expect(chat.sent).toEqual([]);
    // A yes for a later version than this build knows is not this build's yes either.
    store.update({ hostedConsent: { version: HOSTED_CONSENT_VERSION + 1, at: 1 } });
    expect(hasHostedConsent(store.get())).toBe(false);
  });

  test('withdrawing closes it on the very next request, with the same function', async () => {
    const store = createSettingsStore(memoryKv());
    const chat = fakeChat();
    const ask = guardHosted(store, chat.send);
    grantHostedConsent(store, 1);
    await ask('one');
    withdrawHostedConsent(store);
    expect(store.get().hostedConsent).toBeNull();
    await expect(ask('two')).rejects.toBeInstanceOf(HostedConsentError);
    expect(chat.sent).toEqual(['one']);
  });

  test('the yes survives a restart (stored on the phone), and a damaged record counts as no', () => {
    const kv = memoryKv();
    grantHostedConsent(createSettingsStore(kv), 42);
    expect(hasHostedConsent(createSettingsStore(kv).get())).toBe(true);
    expect(parseSettings({ hostedConsent: { version: 'x', at: 1 } }).hostedConsent).toBeNull();
    expect(parseSettings({ hostedConsent: 'yes' }).hostedConsent).toBeNull();
    expect(hasHostedConsent(DEFAULT_SETTINGS)).toBe(false);
    // Resetting Joyo AI (delete everything) withdraws it too.
    const store = createSettingsStore(kv);
    store.reset();
    expect(hasHostedConsent(store.get())).toBe(false);
  });

  test('a failing request is not a refusal: the error of the send function passes through untouched', async () => {
    const store = createSettingsStore(memoryKv());
    grantHostedConsent(store, 1);
    const ask = guardHosted(store, async () => {
      throw new Error('network');
    });
    await expect(ask()).rejects.toThrow('network');
  });
});

describe('consent is tied to the list of data', () => {
  test('the list pinned for the current HOSTED_CONSENT_VERSION: change the list, bump the version, ask everyone again', () => {
    // Frozen: if this fails, the data the hosted AI receives changed. Bump HOSTED_CONSENT_VERSION and add a new entry, never edit an old one.
    const pinned: Record<number, string> = { 1: 'chat,profile,recovery,sleep,workouts,plan,food' };
    expect(pinned[HOSTED_CONSENT_VERSION]).toBe(HOSTED_CONSENT_CATEGORIES.join(','));
  });
  test('every field of the snapshot the phone sends belongs to a listed kind of data', () => {
    for (const category of Object.values(SNAPSHOT_FIELD_CATEGORY)) expect(HOSTED_CONSENT_CATEGORIES).toContain(category);
  });
});
