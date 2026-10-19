/**
 * Vectors from openScale `libs/AiLinkLibTest.kt` and `scales/AiLinkBroadcastHandlerTest.kt` (Copyright (C) olie.xdev / openScale
 * contributors, GPL-3.0-or-later). Frames are synthetic (real TEA cipher over invented readings) and laid out as Android's
 * `getManufacturerSpecificData(0x0301)` returns them (company id bytes stripped).
 */
import { describe, expect, it } from 'bun:test';
import type { AdFrame } from '../types';
import { aiLinkKey, aiLinkProtocol, parseAiLink } from './ailink';
import { hexToBytes } from '../../sensors/gatt';

const COMPANY = 0x0301;
const COMPLETED = '015f4e3d2c1b0a8f10e69cf7cb452cccffff';
const COMPLETED_684 = '015f4e3d2c1b0a7e945ab8103c0b750effff';
const MEASURING = '015f4e3d2c1b0a3331c5f84954a1b455ffff';
const IDLE = '015f4e3d2c1b0a81cd9244ffe6049c5bffff';
const NO_IMPEDANCE = '015f4e3d2c1b0af995fd662927ee4283ffff';

const ad = (hex: string, key = '0301', services = ['f0a0']): AdFrame => ({
  id: '0A:1B:2C:3D:4E:5F',
  name: 'EL1',
  rssi: -85,
  ts: 0,
  serviceUuids: services,
  serviceData: {},
  manufacturerData: { [key]: hex },
});

describe('AiLink key and cipher', () => {
  it('derives the TEA key from cid/vid/pid', () => {
    expect(aiLinkKey(1, 3, 1)).toEqual([0x41493001, 0x4c327903, 0x31783101, 0x306c6531]);
  });
  it('folds ids at or above 0x10000', () => {
    expect(aiLinkKey(65537, 3, 1)[2]).toBe(0x31783100 + 2);
  });
});

describe('AiLink parse', () => {
  it('decodes the completed measurement', () => {
    const b = parseAiLink(COMPANY, hexToBytes(COMPLETED))!;
    expect(b).toMatchObject({
      macAddress: '0A:1B:2C:3D:4E:5F',
      status: 0xff,
      sequence: 42,
      weightUnit: 0,
      decimals: 1,
      isNegative: false,
      rawWeight: 700,
      weightKg: 70,
      impedance: 500,
      algorithm: 1,
    });
  });
  it('decodes the earlier completed frame, the live frame and the idle frame', () => {
    expect(parseAiLink(COMPANY, hexToBytes(COMPLETED_684))).toMatchObject({ status: 0xff, sequence: 12, weightKg: 68.4 });
    expect(parseAiLink(COMPANY, hexToBytes(MEASURING))).toMatchObject({ status: 0, sequence: 26, weightKg: 70 });
    expect(parseAiLink(COMPANY, hexToBytes(IDLE))).toMatchObject({ status: 0, rawWeight: 0, weightKg: 0 });
  });
  it('rejects corrupted checksum, corrupted payload, short frames, foreign records and wrong ids', () => {
    const bad = hexToBytes(COMPLETED);
    bad[7] = (bad[7] + 1) & 0xff;
    expect(parseAiLink(COMPANY, bad)).toBeNull();
    const bad2 = hexToBytes(COMPLETED);
    bad2[8] = (bad2[8] + 1) & 0xff;
    expect(parseAiLink(COMPANY, bad2)).toBeNull();
    expect(parseAiLink(COMPANY, hexToBytes(COMPLETED).slice(0, 17))).toBeNull();
    expect(parseAiLink(0x00ff, new Uint8Array(18))).toBeNull();
    expect(parseAiLink(0x0405, hexToBytes(COMPLETED))).toBeNull();
  });
});

describe('AiLink protocol', () => {
  it('matches the F0A0 service with a decryptable record', () => {
    expect(aiLinkProtocol.matches(ad(COMPLETED))).toBe(true);
    expect(aiLinkProtocol.matches(ad(COMPLETED, '0301', []))).toBe(false);
    expect(aiLinkProtocol.matches(ad('00'.repeat(18), '00ff'))).toBe(false);
  });
  it('reports the completed frame as stable with impedance', () => {
    expect(aiLinkProtocol.decode(ad(COMPLETED))).toEqual({ weightKg: 70, stable: true, unit: 'kg', impedanceOhm: 500 });
  });
  it('reports a completed frame without impedance as weight only', () => {
    expect(aiLinkProtocol.decode(ad(NO_IMPEDANCE))).toEqual({ weightKg: 70, stable: true, unit: 'kg' });
  });
  it('reports a measuring frame as live without impedance', () => {
    expect(aiLinkProtocol.decode(ad(MEASURING))).toEqual({ weightKg: 70, stable: false, unit: 'kg' });
  });
  it('returns null for the idle frame and for garbage', () => {
    expect(aiLinkProtocol.decode(ad(IDLE))).toBeNull();
    for (const hex of ['', 'ff', COMPLETED.slice(0, 20)]) expect(() => aiLinkProtocol.decode(ad(hex))).not.toThrow();
    expect(aiLinkProtocol.decode(ad(''))).toBeNull();
  });
});
