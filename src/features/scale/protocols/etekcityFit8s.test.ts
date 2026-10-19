/**
 * Etekcity Fit 8S decoder (ported from openScale `scales/EtekcityFit8SHandler.kt`, Copyright (C) olie.xdev, GPL-3.0-or-later).
 * openScale has no capture for this scale and `EtekcityLibTest.kt` only covers the body-composition formulas, which are not ported,
 * so these frames are built from the layout documented in the handler (70.350 kg, 527 ohm, company id 0x06D0, service 0xFFD0).
 */
import { describe, expect, it } from 'bun:test';
import type { AdFrame } from '../types';
import { etekcityFit8sProtocol } from './etekcityFit8s';

const STABLE = '015f4e3d2c1b0a000000ce12010f0201' + '00' + '000000';
const LIVE = '015f4e3d2c1b0a000000ce1201' + '0000' + '00' + '00' + '000000';
const LB = STABLE.slice(0, 32) + '01' + '000000';

const ad = (hex: string, services = ['ffd0'], key = '06d0'): AdFrame => ({
  id: 'AA:BB:CC:DD:EE:FF',
  name: null,
  rssi: -60,
  ts: 0,
  serviceUuids: services,
  serviceData: {},
  manufacturerData: { [key]: hex },
});

describe('Etekcity Fit 8S', () => {
  it('decodes a stable frame with impedance', () => {
    expect(etekcityFit8sProtocol.decode(ad(STABLE))).toEqual({ weightKg: 70.35, stable: true, unit: 'kg', impedanceOhm: 527 });
  });
  it('reports the display unit but still converts from grams', () => {
    expect(etekcityFit8sProtocol.decode(ad(LB))).toMatchObject({ weightKg: 70.35, unit: 'lb' });
  });
  it('reports an unstable frame as live without impedance', () => {
    expect(etekcityFit8sProtocol.decode(ad(LIVE))).toEqual({ weightKg: 70.35, stable: false, unit: 'kg' });
  });
  it('omits a zero impedance', () => {
    const noImp = STABLE.slice(0, 26) + '0000' + STABLE.slice(30);
    expect(etekcityFit8sProtocol.decode(ad(noImp))).toEqual({ weightKg: 70.35, stable: true, unit: 'kg' });
  });
  it('matches company id 0x06D0 together with service 0xFFD0 only', () => {
    expect(etekcityFit8sProtocol.matches(ad(STABLE))).toBe(true);
    expect(etekcityFit8sProtocol.matches(ad(STABLE, []))).toBe(false);
    expect(etekcityFit8sProtocol.matches(ad(STABLE, ['ffd0'], '1234'))).toBe(false);
  });
  it('rejects wrong lengths, zero weight and garbage without throwing', () => {
    for (const hex of ['', 'zz', STABLE.slice(0, 38), STABLE + '00']) expect(etekcityFit8sProtocol.decode(ad(hex))).toBeNull();
    expect(etekcityFit8sProtocol.decode(ad('01' + '00'.repeat(19)))).toBeNull();
    expect(etekcityFit8sProtocol.decode(ad(STABLE, ['ffd0'], '1234'))).toBeNull();
  });
});
