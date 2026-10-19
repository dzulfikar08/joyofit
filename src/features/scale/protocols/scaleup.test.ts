/**
 * Scaleup decoder (ported from openScale `scales/ScaleupHandler.kt`, Copyright (C) olie.xdev, GPL-3.0-or-later). openScale has no
 * test or capture for it; frames are built from the documented layout. The catalog fixture there uses key 0x1DD0.
 * Raw AD `d0 1d 5e 00 00 ...` becomes key 0x1DD0, data `5e 00 00 <mac>`: weight 0x1D5E = 7518 -> 75.18 kg.
 */
import { describe, expect, it } from 'bun:test';
import type { AdFrame } from '../types';
import { scaleupProtocol } from './scaleup';

const DATA = '5e0000aabbccddeeff';

const ad = (manufacturerData: Record<string, string>, name: string | null = null): AdFrame => ({
  id: 'AA:BB:CC:DD:EE:FF',
  name,
  rssi: -60,
  ts: 0,
  serviceUuids: [],
  serviceData: {},
  manufacturerData,
});

describe('Scaleup', () => {
  it('decodes a measuring frame (0xD0) as live', () => {
    expect(scaleupProtocol.decode(ad({ '1dd0': DATA }))).toEqual({ weightKg: 75.18, stable: false });
  });
  it('decodes a stabilised frame (0xE0)', () => {
    expect(scaleupProtocol.decode(ad({ '1de0': '5e03e8aabbccddeeff' }))).toEqual({ weightKg: 75.18, stable: true });
  });
  it('matches by name "da" or by the flag byte', () => {
    expect(scaleupProtocol.matches(ad({}, 'da'))).toBe(true);
    expect(scaleupProtocol.matches(ad({}, ' DA '))).toBe(true);
    expect(scaleupProtocol.matches(ad({ '1dd0': DATA }))).toBe(true);
    expect(scaleupProtocol.matches(ad({ '1de0': DATA }))).toBe(true);
    expect(scaleupProtocol.matches(ad({ '1de1': DATA }))).toBe(false);
  });
  it('discards out of range weights, short data and garbage', () => {
    expect(scaleupProtocol.decode(ad({ '00d0': '10' + DATA.slice(2) }))).toBeNull(); // 0.16 kg
    expect(scaleupProtocol.decode(ad({ ffd0: 'ff' + DATA.slice(2) }))).toBeNull(); // 655.35 kg
    expect(scaleupProtocol.decode(ad({ '1dd0': '5e0000' }))).toBeNull();
    expect(scaleupProtocol.decode(ad({ '1dd0': '' }))).toBeNull();
    expect(scaleupProtocol.decode(ad({}, 'da'))).toBeNull();
  });
});
