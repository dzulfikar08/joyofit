/**
 * Vectors from openScale `QNHandlerBroadcastFT26RTest.kt` (frames captured 2026-09-07 from a FITINDEX FT-26R-W whose display read
 * 155.0 lb = 70.31 kg; device address replaced by openScale). Copyright (C) olie.xdev, GPL-3.0-or-later.
 */
import { describe, expect, it } from 'bun:test';
import type { AdFrame } from '../types';
import { qnBroadcastProtocol } from './qnBroadcast';

const moving1 = 'aabb00005e0053016d000000ffffff1400671b510e032100';
const moving2 = 'aabb00005e0053016e000000ffffff14007b1b510e032300';
const settled1 = 'aabb00005e00530172000000ffffff1500761b510e032300';
const settled2 = 'aabb00005e0053017b000000ffffff1500761b510e032300';
const moving3 = 'aabb00005e005301ef000000ffffff14007b1b510e034900';
const settled3 = 'aabb00005e005301f0000000ffffff15007b1b510e034400';
const idle = 'aabb00005e00530100f09f6affffff15a00000510e03500f';

const ad = (hex: string, key = 'ffff'): AdFrame => ({
  id: '00:00:5E:00:53:01',
  name: null,
  rssi: -60,
  ts: 0,
  serviceUuids: [],
  serviceData: { },
  manufacturerData: { [key]: hex },
});

describe('QN broadcast (AABB)', () => {
  it('decodes the settled FT-26R frames as stable', () => {
    expect(qnBroadcastProtocol.decode(ad(settled1))).toEqual({ weightKg: 70.3, stable: true });
    expect(qnBroadcastProtocol.decode(ad(settled2))).toEqual({ weightKg: 70.3, stable: true });
    expect(qnBroadcastProtocol.decode(ad(settled3))).toEqual({ weightKg: 70.35, stable: true });
  });
  it('decodes the moving frames as live', () => {
    expect(qnBroadcastProtocol.decode(ad(moving1))).toEqual({ weightKg: 70.15, stable: false });
    expect(qnBroadcastProtocol.decode(ad(moving2))).toEqual({ weightKg: 70.35, stable: false });
    expect(qnBroadcastProtocol.decode(ad(moving3))?.stable).toBe(false);
  });
  it('rejects the zero weight idle frame', () => {
    expect(qnBroadcastProtocol.decode(ad(idle))).toBeNull();
  });
  it('honours bit 0 only with the FT-26R signature', () => {
    const foreign = settled1.slice(0, 38) + '000000' + settled1.slice(44);
    expect(qnBroadcastProtocol.decode(ad(foreign))).toEqual({ weightKg: 70.3, stable: false });
    const bit5 = foreign.slice(0, 30) + '20' + foreign.slice(32);
    expect(qnBroadcastProtocol.decode(ad(bit5))?.stable).toBe(true);
  });
  it('matches on the AABB magic under company id ffff only', () => {
    expect(qnBroadcastProtocol.matches(ad(settled1))).toBe(true);
    expect(qnBroadcastProtocol.matches(ad(settled1, '1234'))).toBe(false);
    expect(qnBroadcastProtocol.matches(ad('0000' + settled1.slice(4)))).toBe(false);
  });
  it('never throws on short or odd data', () => {
    for (const hex of ['', 'aa', 'aabb', 'aabb00', 'zz', settled1.slice(0, 30)]) {
      expect(() => qnBroadcastProtocol.decode(ad(hex))).not.toThrow();
      expect(qnBroadcastProtocol.decode(ad(hex))).toBeNull();
    }
    expect(qnBroadcastProtocol.decode(ad(settled1, '1234'))).toBeNull();
  });
});
