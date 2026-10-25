import { describe, expect, test } from 'bun:test';

import type { BondedDevice, LinkState } from '@/wear';

import { firstSyncStatus } from './firstSync';
import { cardAction, isLinkSettingUp, scanCards } from './pairing';

const FIT = 'AA:00:00:00:00:01';
const BAND = 'AA:00:00:00:00:02';

function device(address: string, name: string, extra: Partial<BondedDevice> = {}): BondedDevice {
  return { address, name, model: null, support: 'experimental', reason: null, ...extra };
}

describe('isLinkSettingUp', () => {
  test('covers the states that wait on the watch, nothing else', () => {
    const setting: LinkState[] = ['connecting', 'authenticating', 'initializing'];
    for (const s of setting) expect(isLinkSettingUp(s)).toBe(true);
    for (const s of ['disconnected', 'connected', 'syncing'] as const) expect(isLinkSettingUp(s)).toBe(false);
  });
});

describe('cardAction', () => {
  const fit = device(FIT, 'Seiya-B29F', { support: 'tested' });

  test('Connect with no link, Switch while another watch is linked', () => {
    expect(cardAction(fit, 'disconnected', null)).toBe('connect');
    expect(cardAction(fit, 'connected', BAND)).toBe('switch');
  });

  test('nothing starts while any watch is being set up or synced', () => {
    expect(cardAction(fit, 'connecting', BAND)).toBe('busy');
    expect(cardAction(fit, 'syncing', BAND)).toBe('busy');
    expect(cardAction(fit, 'authenticating', FIT)).toBe('busy');
  });

  test('the linked watch says so, an unsupported one cannot be tried', () => {
    expect(cardAction(fit, 'connected', FIT)).toBe('linked');
    expect(cardAction(fit, 'syncing', FIT)).toBe('linked');
    expect(cardAction(device(BAND, 'x', { support: 'unsupported' }), 'disconnected', null)).toBe('unsupported');
  });
});

describe('scanCards', () => {
  const list = [device(BAND, 'HUAWEI Band 9-ABC'), device(FIT, 'Seiya-B29F')];

  test('one card per watch with its catalogue model, in list order', () => {
    const cards = scanCards(list, null);
    expect(cards.map((c) => c.model)).toEqual(['Huawei Band 9', 'Huawei Watch Fit 4 Pro']);
    expect(cards.every((c) => !c.picked)).toBe(true);
  });

  test('a picked model comes first and is marked; the rest stay', () => {
    const cards = scanCards(list, 'Huawei Watch Fit 4 Pro');
    expect(cards.map((c) => [c.device.address, c.picked])).toEqual([
      [FIT, true],
      [BAND, false],
    ]);
  });

  test('an unknown name has no model and is never the picked one', () => {
    const cards = scanCards([device(FIT, 'Mystery-1')], 'Huawei Band 9');
    expect(cards[0]).toMatchObject({ model: null, picked: false });
  });
});

describe('firstSyncStatus', () => {
  const base = { started: true, pending: false, linkState: 'connected', error: null, outcome: null };

  test('hidden until the guide asked for it', () => {
    expect(firstSyncStatus({ ...base, started: false, linkState: 'syncing' })).toBe('hidden');
  });

  test('running while the request is out or the link syncs', () => {
    expect(firstSyncStatus({ ...base, pending: true })).toBe('running');
    expect(firstSyncStatus({ ...base, linkState: 'syncing' })).toBe('running');
  });

  test('done, or failed with the watch error', () => {
    expect(firstSyncStatus(base)).toBe('done');
    expect(firstSyncStatus({ ...base, error: 'Timed out' })).toBe('failed');
  });

  test('a known outcome stays: a later disconnect error does not fail a finished sync', () => {
    expect(firstSyncStatus({ ...base, outcome: 'done', error: 'Disconnected', linkState: 'disconnected' })).toBe('done');
    expect(firstSyncStatus({ ...base, outcome: 'failed' })).toBe('failed');
  });
});
