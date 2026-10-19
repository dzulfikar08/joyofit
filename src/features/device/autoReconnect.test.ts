import { describe, expect, test } from 'bun:test';

import type { BondedDevice } from '@/wear';

import {
  androidPairingAllowsAutoReconnect,
  autoReconnectDelayMs,
  autoReconnectVerdict,
  BUSY_RECHECK_MS,
  outcomeOfFailure,
  shouldAutoReconnect,
  type AutoReconnectFacts,
} from './autoReconnect';

const READY: AutoReconnectFacts = {
  address: 'AA:BB:CC:DD:EE:01',
  linkState: 'disconnected',
  backgroundEnabled: false,
  disconnectedByUser: false,
  busy: false,
  permitted: true,
  appActive: true,
  failures: 0,
  blocked: false,
  pairingAllows: true,
};

describe('shouldAutoReconnect', () => {
  test('a remembered watch that is not linked is reconnected while the app is open', () => {
    expect(shouldAutoReconnect(READY)).toBe(true);
  });

  test('no remembered watch, nothing to reconnect', () => {
    expect(shouldAutoReconnect({ ...READY, address: null })).toBe(false);
  });

  test('only a disconnected link is reconnected', () => {
    for (const linkState of ['connecting', 'authenticating', 'initializing', 'connected', 'syncing'] as const) {
      expect(shouldAutoReconnect({ ...READY, linkState })).toBe(false);
    }
  });

  test('background mode reconnects by itself, so the app does not race it', () => {
    expect(shouldAutoReconnect({ ...READY, backgroundEnabled: true })).toBe(false);
  });

  test('a disconnect the person chose is respected, also after a restart', () => {
    expect(shouldAutoReconnect({ ...READY, disconnectedByUser: true })).toBe(false);
  });

  test('it waits while a connect, a sync or the first-bind question is open', () => {
    expect(shouldAutoReconnect({ ...READY, busy: true })).toBe(false);
  });

  test('it never asks for the Bluetooth permission, so without it nothing happens', () => {
    expect(shouldAutoReconnect({ ...READY, permitted: false })).toBe(false);
  });

  test('it only runs while the app is in the foreground', () => {
    expect(shouldAutoReconnect({ ...READY, appActive: false })).toBe(false);
  });

  test('a watch that needs the person (a first bind) is left alone until they connect', () => {
    expect(shouldAutoReconnect({ ...READY, blocked: true })).toBe(false);
  });

  test('the attempts end after the last delay until the app comes forward again', () => {
    expect(shouldAutoReconnect({ ...READY, failures: 2 })).toBe(true);
    expect(shouldAutoReconnect({ ...READY, failures: 3 })).toBe(false);
  });
});

describe('autoReconnectDelayMs', () => {
  test('the first attempt is soon, each next one further apart', () => {
    expect([0, 1, 2].map(autoReconnectDelayMs)).toEqual([1_500, 30_000, 120_000]);
  });

  test('after the last delay there is no next attempt', () => {
    expect(autoReconnectDelayMs(3)).toBeNull();
    expect(autoReconnectDelayMs(99)).toBeNull();
  });
});

describe('outcomeOfFailure', () => {
  test('a first bind, a refused permission and an unsupported model need the person: no more attempts', () => {
    expect(outcomeOfFailure('ERR_BIND_CONFIRMATION')).toBe('blocked');
    expect(outcomeOfFailure('ERR_BLUETOOTH_PERMISSION')).toBe('blocked');
    expect(outcomeOfFailure('ERR_UNSUPPORTED')).toBe('blocked');
  });

  test('a watch that is off, out of reach or busy is tried again later', () => {
    for (const code of ['ERR_CONNECT_FAILED', 'ERR_TIMEOUT', 'ERR_DISCONNECTED', 'ERR_AUTH_FAILED', 'ERR_NOT_PAIRED', 'ERR_BLUETOOTH_OFF', null]) {
      expect(outcomeOfFailure(code)).toBe('failed');
    }
  });
});

function row(address: string, extra: Partial<BondedDevice>): BondedDevice {
  return { address, name: 'HUAWEI WATCH GT 6-1A2', model: 'Huawei Watch GT 6', support: 'experimental', reason: null, ...extra };
}

describe('Android pairing and the automatic reconnect', () => {
  const address = 'AA:BB:CC:DD:EE:01';

  test('a Classic watch without a pairing is left to a tap on Connect: connecting would make Android open a pairing dialog by itself', () => {
    expect(shouldAutoReconnect({ ...READY, pairingAllows: false })).toBe(false);
  });

  test('a paired Classic watch and a band (Android never pairs those) are fine', () => {
    expect(androidPairingAllowsAutoReconnect([row(address, { paired: true, classic: true })], 'aa:bb:cc:dd:ee:01')).toBe(true);
    expect(androidPairingAllowsAutoReconnect([row(address, { paired: false, classic: false })], address)).toBe(true);
    expect(androidPairingAllowsAutoReconnect([row(address, { paired: true })], address)).toBe(true);
  });

  test('a Classic watch Android does not list as paired, or one the list does not know to be a band, is not', () => {
    expect(androidPairingAllowsAutoReconnect([row(address, { paired: false, classic: true, remembered: true })], address)).toBe(false);
    expect(androidPairingAllowsAutoReconnect([row(address, { paired: false })], address)).toBe(false);
  });

  test('an older build, whose list says nothing about pairing or leaves an unpaired remembered watch out, never reconnects by itself', () => {
    // No paired/classic fields: a paired watch cannot be told from an unpaired one, so a connect might open Android's pairing dialog.
    expect(androidPairingAllowsAutoReconnect([row(address, {})], address)).toBe(false);
    expect(androidPairingAllowsAutoReconnect([], address)).toBe(false);
    expect(androidPairingAllowsAutoReconnect([row('AA:BB:CC:DD:EE:02', { paired: true, classic: true })], address)).toBe(false);
  });
});

describe('autoReconnectVerdict', () => {
  test('go when nothing stands in the way', () => {
    expect(autoReconnectVerdict(READY)).toBe('go');
  });

  test('wait, and look again, when only a connect, a sync or the first-bind question is open', () => {
    expect(autoReconnectVerdict({ ...READY, busy: true })).toBe('wait');
    expect(BUSY_RECHECK_MS).toBeGreaterThan(0);
  });

  test('stop for everything else, also when busy: nothing would wake it up again', () => {
    for (const facts of [
      { ...READY, address: null },
      { ...READY, linkState: 'connected' as const },
      { ...READY, backgroundEnabled: true },
      { ...READY, disconnectedByUser: true },
      { ...READY, permitted: false },
      { ...READY, appActive: false },
      { ...READY, blocked: true },
      { ...READY, pairingAllows: false },
      { ...READY, failures: 3 },
    ]) {
      expect(autoReconnectVerdict(facts)).toBe('stop');
      expect(autoReconnectVerdict({ ...facts, busy: true })).toBe('stop');
    }
  });
});
