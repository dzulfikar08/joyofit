/**
 * Vectors from openScale `scales/AAAxHandlerTest.kt` (Copyright (C) olie.xdev, GPL-3.0-or-later): synthetic frames in the layout
 * observed on an "AAA07A" scale (Posture FG220LB, Fitdays app), company id 0xA0AC, bytes 0..5 = address C0:FF:EE:12:34:56 reversed,
 * bytes 6..11 = payload XOR 0xA0. The impedance frame is the one sent when no impedance could be measured.
 */
import { describe, expect, it } from 'bun:test';
import type { AdFrame } from '../types';
import { aaaxProtocol, decodeAaaxPayload } from './aaax';
import { bytesToHex, hexToBytes } from '../../sensors/gatt';

const ADDRESS = 'C0:FF:EE:12:34:56';
const MAC_ECHO = '563412eeffc0';
const SETTLING = MAC_ECHO + 'a0cd84660da4';
const STABLE = MAC_ECHO + '20cd84580db6';
const IMPEDANCE = MAC_ECHO + 'a0a0a0a206a8';

const ad = (hex: string | null, name: string | null = 'AAA0ZZ', id = ADDRESS): AdFrame => ({
  id,
  name,
  rssi: -60,
  ts: 0,
  serviceUuids: ['ffb0'],
  serviceData: {},
  manufacturerData: hex == null ? {} : { a0ac: hex },
});

describe('AAAx payload', () => {
  it('deobfuscates the captured frames', () => {
    expect(bytesToHex(decodeAaaxPayload(0xa0ac, hexToBytes(STABLE))!)).toBe('806d24f8ad16');
    expect(bytesToHex(decodeAaaxPayload(0xa0ac, hexToBytes(SETTLING))!)).toBe('006d24c6ad04');
    expect(decodeAaaxPayload(0xa0ac, hexToBytes(IMPEDANCE))![4]).toBe(0xa6);
  });
  it('rejects a broken checksum and short data', () => {
    expect(decodeAaaxPayload(0xa0ac, hexToBytes(STABLE.slice(0, 22) + 'b7'))).toBeNull();
    expect(decodeAaaxPayload(0xa0ac, hexToBytes(STABLE.slice(0, 22)))).toBeNull();
  });
});

describe('AAAx protocol', () => {
  it('decodes the final frame (75.00 kg) and the settling frame as live', () => {
    expect(aaaxProtocol.decode(ad(STABLE))).toEqual({ weightKg: 75, stable: true });
    expect(aaaxProtocol.decode(ad(SETTLING))).toEqual({ weightKg: 74.95, stable: false });
  });
  it('ignores the impedance frame', () => {
    expect(aaaxProtocol.decode(ad(IMPEDANCE))).toBeNull();
  });
  it('claims an unknown name by its frame fingerprint (MAC echo + checksum)', () => {
    expect(aaaxProtocol.matches(ad(STABLE))).toBe(true);
    expect(aaaxProtocol.matches(ad(IMPEDANCE, ''))).toBe(true);
  });
  it('ignores a frame that does not echo the advertiser address', () => {
    expect(aaaxProtocol.matches(ad(STABLE, 'AAA0ZZ', '11:22:33:44:55:66'))).toBe(false);
    expect(aaaxProtocol.decode(ad(STABLE, 'AAA0ZZ', '11:22:33:44:55:66'))).toBeNull();
  });
  it('matches known names without manufacturer data, and leaves other names alone', () => {
    for (const name of ['AAA002', 'AAA007', 'AAA013', 'AAA07A']) expect(aaaxProtocol.matches(ad(null, name))).toBe(true);
    expect(aaaxProtocol.matches(ad(null, 'swan'))).toBe(false);
  });
  it('decodes known names where the id is not a MAC (iOS)', () => {
    expect(aaaxProtocol.decode(ad(STABLE, 'AAA07A', '2B1C0E5F-0000-4A5D-8E00-123456789ABC'))).toEqual({ weightKg: 75, stable: true });
  });
  it('never throws on garbage', () => {
    for (const hex of ['', 'zz', '00', 'ff'.repeat(30), MAC_ECHO]) {
      expect(() => aaaxProtocol.decode(ad(hex))).not.toThrow();
      expect(aaaxProtocol.decode(ad(hex))).toBeNull();
    }
  });
});
