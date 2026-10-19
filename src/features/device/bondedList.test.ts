import { describe, expect, test } from 'bun:test';

import type { BondedDevice } from '@/wear';

import { listBonded, sortBonded, withDiscovered } from './bondedList';

const GT6 = 'AA:BB:CC:DD:EE:01';
const BAND = 'AA:BB:CC:DD:EE:02';

function device(address: string, name: string, extra: Partial<BondedDevice> = {}): BondedDevice {
  return { address, name, model: null, support: 'experimental', reason: null, ...extra };
}

const NONE = { address: null, name: null };

describe('listBonded', () => {
  test('lists what the system lists, then what a scan added', () => {
    const list = listBonded({
      bonded: [device(GT6, 'HUAWEI WATCH GT 6-1A2')],
      discovered: [device(BAND, 'HUAWEI Band 9-ABC'), device(GT6, 'a scan name')],
      active: null,
      remembered: NONE,
    });
    expect(list.map((d) => d.address).sort()).toEqual([GT6, BAND].sort());
    expect(list.find((d) => d.address === GT6)?.name).toBe('HUAWEI WATCH GT 6-1A2');
  });

  test('the remembered watch is a row even when nothing lists it and no scan sees it', () => {
    const list = listBonded({ bonded: [], discovered: [], active: null, remembered: { address: GT6, name: 'HUAWEI WATCH GT 6-1A2' } });
    expect(list).toEqual([
      { address: GT6, name: 'HUAWEI WATCH GT 6-1A2', model: null, support: 'unknown', reason: null, remembered: true },
    ]);
  });

  test('a remembered watch without a name is listed under its address and can still be connected', () => {
    const [row] = listBonded({ bonded: [], discovered: [], active: null, remembered: { address: GT6, name: null } });
    expect(row.name).toBe(GT6);
    expect(row.support).toBe('unknown');
  });

  test('the remembered watch that the system also lists is one row and keeps what the native list knew', () => {
    const native = device(GT6, 'HUAWEI WATCH GT 6-1A2', { model: 'Huawei Watch GT 6', paired: true, classic: true });
    const list = listBonded({ bonded: [native], discovered: [], active: null, remembered: { address: GT6.toLowerCase(), name: 'older' } });
    expect(list).toEqual([{ ...native, remembered: true }]);
  });

  test('the watch in use is a row too, and does not duplicate a listed one', () => {
    const active = { address: BAND, name: 'HUAWEI Band 9-ABC', model: 'Huawei Band 9', support: 'experimental' as const };
    const list = listBonded({ bonded: [], discovered: [], active, remembered: NONE });
    expect(list).toEqual([device(BAND, 'HUAWEI Band 9-ABC', { model: 'Huawei Band 9' })]);
    expect(listBonded({ bonded: [device(BAND, 'listed')], discovered: [], active, remembered: NONE })).toHaveLength(1);
  });

  test('tested watches come before experimental and unknown ones', () => {
    const list = listBonded({
      bonded: [device(BAND, 'B', { support: 'unknown' }), device(GT6, 'Z', { support: 'tested' })],
      discovered: [],
      active: null,
      remembered: NONE,
    });
    expect(list.map((d) => d.support)).toEqual(['tested', 'unknown']);
  });
});

describe('withDiscovered', () => {
  test('a scan result for a listed watch keeps the flags the scan cannot know', () => {
    const listed = device(GT6, 'HUAWEI WATCH GT 6-1A2', { remembered: true, paired: false, classic: true });
    const merged = withDiscovered(listed, device(GT6, 'HUAWEI WATCH GT 6-1A2', { rssi: -58 }));
    expect(merged).toEqual({ ...listed, rssi: -58 });
  });

  test('a scan result for an unlisted device is taken as it is', () => {
    const found = device(BAND, 'HUAWEI Band 9-ABC', { rssi: -70 });
    expect(withDiscovered(undefined, found)).toBe(found);
  });
});

describe('sortBonded', () => {
  test('sorts by support and then by name without changing the input', () => {
    const input = [device('1', 'b'), device('2', 'a'), device('3', 'z', { support: 'tested' })];
    expect(sortBonded(input).map((d) => d.name)).toEqual(['z', 'a', 'b']);
    expect(input.map((d) => d.name)).toEqual(['b', 'a', 'z']);
  });
});
