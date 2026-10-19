/**
 * Tests for the OKOK / Chipsea broadcast decoder (okok.ts). Ported from openScale `scales/OkOkHandler.kt` (Copyright (C)
 * olie.xdev, GPL-3.0-or-later). openScale ships no unit test for this handler, so every vector below is built from the layout and
 * the checksum rule in that source (hex literals computed once with the handler's XOR rule, readings checked by hand).
 */
import { describe, expect, it } from 'bun:test';
import type { AdFrame } from '../types';
import { okokProtocol } from './okok';

function ad(manufacturerData: Record<string, string>, name: string | null = 'ADV'): AdFrame {
  return { id: 'AA:BB:CC:DD:EE:FF', name, rssi: -60, ts: 0, serviceUuids: [], serviceData: {}, manufacturerData };
}

const V20_FINAL = '01020304050605001b8f12c561112233445566'; // 70.55 kg, 480.5 ohm, final, /100
const V20_LIVE = '01020304050604001b8f0000b7112233445566'; // same weight, not final
const V20_DIV10 = '010203040506010002bc12c54f112233445566'; // 70.0 kg, /10

describe('OKOK V20 (0x20CA)', () => {
  it('decodes a final frame with weight and impedance', () => {
    const r = okokProtocol.decode(ad({ '20ca': V20_FINAL }));
    expect(r).toEqual({ weightKg: 70.55, stable: true, unit: 'kg', impedanceOhm: 480.5 });
  });
  it('uses divider 10 when the resolution bit is clear', () => {
    expect(okokProtocol.decode(ad({ '20ca': V20_DIV10 }))?.weightKg).toBe(70);
  });
  it('reports a non final frame as live, without impedance', () => {
    const r = okokProtocol.decode(ad({ '20ca': V20_LIVE }));
    expect(r?.stable).toBe(false);
    expect(r?.weightKg).toBe(70.55);
    expect(r?.impedanceOhm).toBeUndefined();
  });
  it('rejects a bad checksum and a wrong length', () => {
    expect(okokProtocol.decode(ad({ '20ca': V20_FINAL.replace('c561', 'c562') }))).toBeNull();
    expect(okokProtocol.decode(ad({ '20ca': V20_FINAL.slice(0, -2) }))).toBeNull();
  });
});

describe('OKOK V11 (0x11CA)', () => {
  const v11 = {
    kg: '01020302c1000000000000000000000018000000000000',
    kg100: '0102031b8f00000000040000000000004b000000000000',
    jin: '0102030582000000000800000000000054000000000000',
    lb: '010203060e0000000010000000000000c3000000000000',
    st: '0102030b140000000018000000000000dc000000000000',
  };
  it('decodes kg with resolution 0.1 and 0.01', () => {
    expect(okokProtocol.decode(ad({ '11ca': v11.kg }))).toEqual({ weightKg: 70.5, stable: true, unit: 'kg' });
    expect(okokProtocol.decode(ad({ '11ca': v11.kg100 }))?.weightKg).toBe(70.55);
  });
  it('converts jin, lb and st+lb', () => {
    expect(okokProtocol.decode(ad({ '11ca': v11.jin }))).toEqual({ weightKg: 70.5, stable: true, unit: 'jin' });
    expect(okokProtocol.decode(ad({ '11ca': v11.lb }))).toEqual({ weightKg: 70.31, stable: true, unit: 'lb' });
    expect(okokProtocol.decode(ad({ '11ca': v11.st }))).toEqual({ weightKg: 70.76, stable: true, unit: 'st' });
  });
  it('rejects a bad checksum', () => {
    expect(okokProtocol.decode(ad({ '11ca': v11.kg.replace('18000000000000', '19000000000000') }))).toBeNull();
  });
});

describe('OKOK VF0 (0xF0FF)', () => {
  it('reads the weight at bytes 3 (msb) and 2 (lsb)', () => {
    expect(okokProtocol.decode(ad({ f0ff: '0000bd0200' }))?.weightKg).toBe(70.1);
  });
  it('needs 4 bytes', () => {
    expect(okokProtocol.decode(ad({ f0ff: '0000bd' }))).toBeNull();
  });
});

describe('OKOK C0 (company id low byte 0xC0)', () => {
  const kg = '1aa41403000005aa0000000000'; // 68.20 kg, stable, 512.3 ohm
  const live = '1aa40000000004aa0000000000';
  const lb = '05dc1388000011aa0000000000'; // 150.0 lb, 500 ohm
  const st = '0a461388000019aa0000000000'; // 10 st 7.0 lb
  const jin = '05780000000009aa0000000000'; // 140.0 jin
  it('decodes a stable frame with impedance', () => {
    expect(okokProtocol.decode(ad({ '01c0': kg }, null))).toEqual({ weightKg: 68.2, stable: true, unit: 'kg', impedanceOhm: 512.3 });
  });
  it('treats a frame without the stable bit as live', () => {
    const r = okokProtocol.decode(ad({ '01c0': live }, null));
    expect(r).toEqual({ weightKg: 68.2, stable: false, unit: 'kg' });
  });
  it('converts lb, st and jin', () => {
    expect(okokProtocol.decode(ad({ '01c0': lb }, null))).toEqual({ weightKg: 68.04, stable: true, unit: 'lb', impedanceOhm: 500 });
    expect(okokProtocol.decode(ad({ '01c0': st }, null))?.weightKg).toBe(66.68);
    expect(okokProtocol.decode(ad({ '01c0': jin }, null))).toMatchObject({ weightKg: 70, unit: 'jin' });
  });
  it('needs 13 bytes', () => {
    expect(okokProtocol.decode(ad({ '01c0': kg.slice(0, 24) }, null))).toBeNull();
  });
});

describe('OKOK recognition', () => {
  it('accepts the known names with a known company id', () => {
    for (const name of ['ADV', 'Chipsea-BLE', 'Yoda0abc', 'YODA1x']) {
      expect(okokProtocol.matches(ad({ '20ca': V20_FINAL }, name))).toBe(true);
    }
    expect(okokProtocol.matches(ad({ '11ca': '00' }, 'ADV'))).toBe(true);
    expect(okokProtocol.matches(ad({ f0ff: '00' }, 'ADV'))).toBe(true);
  });
  it('accepts a nameless device only with a 0xC0 low byte record', () => {
    expect(okokProtocol.matches(ad({ '01c0': '00' }, null))).toBe(true);
    expect(okokProtocol.matches(ad({ '01c0': '00' }, ''))).toBe(true);
    expect(okokProtocol.matches(ad({ '20ca': V20_FINAL }, null))).toBe(false);
  });
  it('rejects other names and other company ids', () => {
    expect(okokProtocol.matches(ad({ '20ca': V20_FINAL }, 'Mi Scale'))).toBe(false);
    expect(okokProtocol.matches(ad({ '1234': '00' }, 'ADV'))).toBe(false);
  });
});

describe('OKOK robustness', () => {
  it('never throws on garbage', () => {
    for (const data of ['', 'z', '00', 'ff'.repeat(40)]) {
      for (const key of ['20ca', '11ca', 'f0ff', '01c0']) {
        expect(() => okokProtocol.decode(ad({ [key]: data }))).not.toThrow();
      }
    }
    expect(okokProtocol.decode(ad({}))).toBeNull();
  });
  it('returns null for a zero weight', () => {
    expect(okokProtocol.decode(ad({ '01c0': '00000000000001aa0000000000' }, null))).toBeNull();
  });
});
