import { describe, expect, test } from 'bun:test';

import type { KvStore } from '@/features/ai/kv';
import { createSettingsStore, DEFAULT_SETTINGS, parseSettings } from '@/features/ai/settings';
import {
  CONNECTOR_CONSENT_SCOPES,
  CONNECTOR_CONSENT_VERSION,
  connectorView,
  grantConnectorConsent,
  hasConnectorConsent,
  withdrawConnectorConsent,
} from './consent';

function memoryKv(): KvStore {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

describe('the AI connector consent', () => {
  test('no consent by default: the address stays hidden even with Pro', () => {
    expect(hasConnectorConsent(DEFAULT_SETTINGS)).toBe(false);
    expect(connectorView(true, DEFAULT_SETTINGS)).toBe('consent');
  });

  test('without Pro the upgrade card shows, consent or not', () => {
    const store = createSettingsStore(memoryKv());
    expect(connectorView(false, store.get())).toBe('upgrade');
    grantConnectorConsent(store, 1);
    expect(connectorView(false, store.get())).toBe('upgrade');
  });

  test('a yes with Pro shows the address; withdrawing hides it again', () => {
    const store = createSettingsStore(memoryKv());
    grantConnectorConsent(store, 1_800_000_000);
    expect(store.get().connectorConsent).toEqual({ version: CONNECTOR_CONSENT_VERSION, at: 1_800_000_000 });
    expect(connectorView(true, store.get())).toBe('address');
    withdrawConnectorConsent(store);
    expect(store.get().connectorConsent).toBeNull();
    expect(connectorView(true, store.get())).toBe('consent');
  });

  test('a yes for another version of the list does not count', () => {
    const store = createSettingsStore(memoryKv());
    store.update({ connectorConsent: { version: CONNECTOR_CONSENT_VERSION - 1, at: 1 } });
    expect(hasConnectorConsent(store.get())).toBe(false);
    store.update({ connectorConsent: { version: CONNECTOR_CONSENT_VERSION + 1, at: 1 } });
    expect(hasConnectorConsent(store.get())).toBe(false);
  });

  test('the yes survives a restart, is separate from the hosted Joyo AI consent, and a damaged record counts as no', () => {
    const kv = memoryKv();
    grantConnectorConsent(createSettingsStore(kv), 42);
    const again = createSettingsStore(kv).get();
    expect(hasConnectorConsent(again)).toBe(true);
    expect(again.hostedConsent).toBeNull();
    expect(parseSettings({ connectorConsent: 'yes' }).connectorConsent).toBeNull();
    expect(parseSettings({ connectorConsent: { version: 'x', at: 1 } }).connectorConsent).toBeNull();
  });

  test('the list pinned for the current version: change the list, bump the version, ask everyone again', () => {
    // Frozen: if this fails, the data an AI app can read changed. Bump CONNECTOR_CONSENT_VERSION and add a new entry, never edit an old one.
    const pinned: Record<number, string> = { 1: 'profile:read,food:read,weight:read,workouts:read,recovery:read' };
    expect(pinned[CONNECTOR_CONSENT_VERSION]).toBe(CONNECTOR_CONSENT_SCOPES.join(','));
  });
});
