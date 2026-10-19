/**
 * Vectors: openScale test scales/StandardWeightProfileHandlerTest.kt (captures from openScale issues #635, #789, #502, #219,
 * #1164, #1399, ... and the A&D UC-352BLE indications). Copyright (C) olie.xdev, GPL-3.0-or-later.
 */
import { describe, expect, it } from 'bun:test';
import type { DiscoveredService, GattContext, ScaleReading } from '../types';
import { NOTHING } from '../types';
import { STANDARD_PROTOCOLS, STANDARD_WEIGHT_PROTOCOL, currentTimePayload, decodeBodyComposition, decodeWeightMeasurement } from './standard';

const hx = (s: string): string => s.replace(/\s+/g, '').toLowerCase();
const ctx: GattContext = { now: Date.UTC(2026, 0, 1, 0, 0, 0), timezoneOffsetMin: 0 };
const utc = (...p: [number, number, number, number, number, number]): number => Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4], p[5]);

function weighIn(weight: string, comp: string, c: GattContext = ctx): ScaleReading[] {
  const session = STANDARD_WEIGHT_PROTOCOL.createSession(c);
  const a = session.onValue('181d', '2a9d', hx(weight), c.now);
  const b = session.onValue('181b', '2a9c', hx(comp), c.now);
  return [...a.readings, ...b.readings];
}

describe('standard weight profile: captured weigh-ins', () => {
  it('BF105 #635: weight, time, and body composition from the scale', () => {
    const [live, full] = weighIn('0E 10 3E E4 07 06 11 12 33 2C 02 F5 00 08 07', '98 03 C5 00 A0 1B 7C 01 3C 2F 74 20 52 12');
    expect(live.weightKg).toBe(79.44);
    expect(live.stable).toBe(true);
    expect(live.unit).toBe('kg');
    expect(live.scaleTime).toBe(utc(2020, 6, 17, 18, 51, 44));
    expect(live.userSlot).toBe(2);
    expect(live.reported?.bmi).toBe(24.5);
    expect(full.weightKg).toBe(79.44);
    expect(full.scaleTime).toBe(live.scaleTime);
    expect(full.impedanceOhm).toBeCloseTo(469, 5);
    expect(full.reported?.bodyFatPct).toBeCloseTo(19.7, 5);
    expect(full.reported?.musclePct).toBeCloseTo(38.0, 5);
    expect(full.reported?.waterPct).toBeCloseTo(52.29, 2);
    expect(full.reported?.bmrKcal).toBeCloseTo(1689.1, 1);
  });

  it('BF600 #219: impedance with decimals, other weights', () => {
    const [, full] = weighIn('0E FA 3B E2 07 05 04 17 07 22 01 0A 01 A4 06', '98 03 E1 00 FB 1B 98 01 10 2C EC 1F 3F 0D');
    expect(full.weightKg).toBe(76.77);
    expect(full.reported?.bodyFatPct).toBeCloseTo(22.5, 5);
    expect(full.reported?.waterPct).toBeCloseTo(53.22, 2);
    expect(full.impedanceOhm).toBeCloseTo(339.1, 5);
    expect(full.scaleTime).toBe(utc(2018, 5, 4, 23, 7, 34));
  });

  it('BF950 #502 and SBF77 #681 vectors', () => {
    const [, bf950] = weighIn('0E 6C 38 E3 07 0A 04 09 03 3B 01 D3 00 3A 07', '98 03 86 00 7D 1C BE 01 5A 2E CE 22 2C 1A');
    expect(bf950.weightKg).toBe(72.22);
    expect(bf950.reported?.waterPct).toBeCloseTo(61.69, 2);
    expect(bf950.impedanceOhm).toBeCloseTo(670, 5);
    const [, sbf77] = weighIn('0E DC 3E E5 07 01 07 14 26 16 02 2E 01 5E 06', '98 03 23 01 09 1B 78 01 52 2A 3C 1E 58 11');
    expect(sbf77.weightKg).toBe(80.46);
    expect(sbf77.reported?.bodyFatPct).toBeCloseTo(29.1, 5);
    expect(sbf77.reported?.musclePct).toBeCloseTo(37.6, 5);
    expect(sbf77.impedanceOhm).toBeCloseTo(444, 5);
  });

  it('no foot contact (all-zero composition, #789): weight only, no body values', () => {
    const readings = weighIn('0E 2E 4C E5 07 0B 04 14 39 2F 02 26 01 1C 07', '98 03 00 00 00 00 00 00 00 00 00 00 00 00');
    expect(readings).toHaveLength(1);
    expect(readings[0].weightKg).toBe(97.51);
    expect(readings[0].impedanceOhm).toBeUndefined();
  });

  it('offline stored reading (#1553) with only a BMR in the composition frame', () => {
    const readings = weighIn('0E EC 36 EA 07 0A 11 0F 0A 1C 01 EB 00 C2 06', '98 03 00 00 CE 1A 00 00 00 00 00 00 00 00');
    expect(readings).toHaveLength(1);
    expect(readings[0].weightKg).toBe(70.3);
    expect(readings[0].scaleTime).toBe(utc(2026, 10, 17, 15, 10, 28));
  });

  it('consecutive weigh-ins on one session stay separate (#1164)', () => {
    const session = STANDARD_WEIGHT_PROTOCOL.createSession(ctx);
    const out: ScaleReading[] = [];
    for (const [w, c] of [
      ['0E A6 48 E9 07 08 1D 0A 03 16 01 3A 01 B8 06', '98 03 39 01 18 1E 68 01 58 2F 4A 22 EF 0C'],
      ['0E A2 48 E9 07 08 1D 0A 04 15 01 3A 01 B8 06', '98 03 39 01 18 1E 68 01 58 2F 4A 22 D4 0C'],
    ]) {
      out.push(...session.onValue('181d', '2a9d', hx(w), 0).readings, ...session.onValue('181b', '2a9c', hx(c), 0).readings);
    }
    expect(out.map((r) => r.weightKg)).toEqual([92.99, 92.99, 92.97, 92.97]);
    expect(out.map((r) => r.scaleTime)).toEqual([utc(2025, 8, 29, 10, 3, 22), utc(2025, 8, 29, 10, 3, 22), utc(2025, 8, 29, 10, 4, 21), utc(2025, 8, 29, 10, 4, 21)]);
    expect(out[1].impedanceOhm).toBeCloseTo(331.1, 5);
    expect(out[3].impedanceOhm).toBeCloseTo(328.4, 5);
  });

  it('BF450 #1399 frames use flags 0x02 with trailing bytes: weight and time still decode', () => {
    const w = decodeWeightMeasurement(Uint8Array.from(Buffer.from(hx('02 E8 53 EA 07 06 10 12 13 2C 01 4F 01 B3 00'), 'hex')));
    expect(w?.weightKg).toBe(107.4);
    expect(w?.scaleTime).toBe(utc(2026, 6, 16, 18, 19, 44));
  });

  it('A&D UC-352BLE indications: weight-only frames', () => {
    const cases: [string, number, number][] = [
      ['025433ea070816082a24', 65.7, utc(2026, 8, 22, 8, 42, 36)],
      ['024033ea070816082b0b', 65.6, utc(2026, 8, 22, 8, 43, 11)],
      ['027c33ea070816082b28', 65.9, utc(2026, 8, 22, 8, 43, 40)],
    ];
    for (const [hex, kg, t] of cases) {
      const step = STANDARD_WEIGHT_PROTOCOL.createSession(ctx).onValue('181d', '2a9d', hex, 0);
      expect(step.readings).toHaveLength(1);
      expect(step.readings[0].weightKg).toBe(kg);
      expect(step.readings[0].scaleTime).toBe(t);
    }
  });

  it('imperial masses are converted from pounds (150.00 lb, 50.00 lb water at 20.0 % fat)', () => {
    const [live, full] = weighIn('01 98 3A', '01 01 C8 00 88 13');
    expect(live.unit).toBe('lb');
    expect(live.weightKg).toBe(68.04);
    expect(full.reported?.bodyFatPct).toBeCloseTo(20, 5);
    expect(full.reported?.waterPct).toBeCloseTo(33.33, 2);
  });

  it('unknown or impossible timestamps leave the reading without a time', () => {
    for (const stamp of ['00 00 00 00 0F 0A 1C', 'EA 07 0D 11 0F 0A 1C']) {
      const step = STANDARD_WEIGHT_PROTOCOL.createSession(ctx).onValue('181d', '2a9d', hx(`06 EC 36 ${stamp} 01`), 0);
      expect(step.readings[0].weightKg).toBe(70.3);
      expect(step.readings[0].scaleTime).toBeUndefined();
      expect(step.readings[0].userSlot).toBe(1);
    }
  });

  it('timestamps are the scale clock in the phone time zone', () => {
    const tz: GattContext = { now: 0, timezoneOffsetMin: 420 };
    const step = STANDARD_WEIGHT_PROTOCOL.createSession(tz).onValue('181d', '2a9d', hx('02 54 33 EA 07 08 16 08 2A 24'), 0);
    expect(step.readings[0].scaleTime).toBe(utc(2026, 8, 22, 1, 42, 36));
  });
});

describe('standard weight profile: session and matching', () => {
  const chars = (...p: ('notify' | 'indicate' | 'write' | 'read')[]) => p;
  const services: DiscoveredService[] = [
    { uuid: '181d', characteristics: [{ uuid: '2a9d', properties: chars('indicate') }] },
    { uuid: '181b', characteristics: [{ uuid: '2a9c', properties: chars('indicate') }] },
    { uuid: '1805', characteristics: [{ uuid: '2a2b', properties: chars('write') }] },
  ];

  it('subscribes to both measurements and writes the current time', () => {
    const step = STANDARD_WEIGHT_PROTOCOL.createSession({ now: Date.UTC(2026, 7, 22, 8, 42, 36), timezoneOffsetMin: 0 }).start(services);
    expect(step.actions).toEqual([
      { op: 'subscribe', service: '181d', characteristic: '2a9d' },
      { op: 'subscribe', service: '181b', characteristic: '2a9c' },
      // 2026-08-22 is a Saturday: day of week 6.
      { op: 'write', service: '1805', characteristic: '2a2b', hex: 'ea070816082a24060000', withResponse: true },
    ]);
  });

  it('skips what the device lacks', () => {
    const step = STANDARD_WEIGHT_PROTOCOL.createSession(ctx).start([services[0]]);
    expect(step.actions).toEqual([{ op: 'subscribe', service: '181d', characteristic: '2a9d' }]);
    expect(STANDARD_WEIGHT_PROTOCOL.createSession(ctx).start([])).toBe(NOTHING);
  });

  it('current time: Sunday is 7', () => {
    expect(currentTimePayload(Date.UTC(2026, 7, 23, 1, 2, 3), 0)).toBe('ea07081701020307' + '0000');
  });

  it('matches any device exposing 181d or 181b', () => {
    const m = (name: string | null, serviceUuids: string[]) => STANDARD_WEIGHT_PROTOCOL.matches({ id: 'x', name, serviceUuids });
    expect(m('BF600', ['181d'])).toBe(true);
    expect(m(null, ['181b'])).toBe(true);
    expect(m('A&D_UC-352BLE_01166D', ['181d', '180f'])).toBe(true);
    expect(m('Band', ['180d'])).toBe(false);
    expect(m('BF600', [])).toBe(false);
  });

  it('exports the Mi Scale protocol too, ahead of the generic one', () => {
    expect(STANDARD_PROTOCOLS.map((p) => p.id)).toEqual(['xiaomi-mi-scale', 'standard-weight-profile']);
    expect(STANDARD_WEIGHT_PROTOCOL.source).toEqual(['scales/StandardWeightProfileHandler.kt']);
  });
});

describe('standard weight profile: garbage input never throws', () => {
  it('short and odd frames', () => {
    const session = STANDARD_WEIGHT_PROTOCOL.createSession(ctx);
    for (const hex of ['', '00', '0e', '0e10', '0e103e', '0e103ee407', 'ffffff', '0e ffff'.replace(' ', ''), 'zz']) {
      expect(() => session.onValue('181d', '2a9d', hex, 0)).not.toThrow();
      expect(() => session.onValue('181b', '2a9c', hex, 0)).not.toThrow();
    }
    expect(decodeWeightMeasurement(new Uint8Array([0x00, 0xff, 0xff]))).toBeNull();
    expect(decodeBodyComposition(new Uint8Array([0x98, 0x03]))).toBeNull();
    expect(decodeBodyComposition(new Uint8Array([0x98, 0x03, 0x39, 0x01, 0x18]))).not.toBeUndefined();
  });

  it('a truncated body frame yields no impedance, and body data without a weight yields nothing', () => {
    const session = STANDARD_WEIGHT_PROTOCOL.createSession(ctx);
    expect(session.onValue('181b', '2a9c', hx('98 03 39 01 18 1E 68 01 58 2F 4A 22 EF 0C'), 0)).toBe(NOTHING);
    session.onValue('181d', '2a9d', hx('00 10 3E'), 0);
    const step = session.onValue('181b', '2a9c', hx('98 03 39 01 18 1E 68 01'), 0);
    expect(step.readings.every((r) => r.impedanceOhm === undefined)).toBe(true);
  });

  it('ignores other characteristics', () => {
    expect(STANDARD_WEIGHT_PROTOCOL.createSession(ctx).onValue('180f', '2a19', '64', 0)).toBe(NOTHING);
  });
});
