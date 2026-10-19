/**
 * Material: openScale test scales/MiScaleHandlerVariantTest.kt (GATT shapes, name matching, 10 byte frame: status 0x20, weight x200,
 * year LE, month, day, hour, minute, second). Copyright (C) olie.xdev, GPL-3.0-or-later.
 * The 13 byte v2 frames are built from the layout MiScaleHandler.parseLive13 reads; openScale has no captured one.
 */
import { describe, expect, it } from 'bun:test';
import type { DiscoveredService, GattAction, GattContext } from '../types';
import { NOTHING } from '../types';
import { MI_SCALE_PROTOCOL, detectVariant, miTimePayload, parseHistory10, parseLive13 } from './miscale';

const HIST = '00002a2f-0000-3512-2118-0009af100700';
const CFG = '00001530-0000-3512-2118-0009af100700';
const CFG_CHR = '00001542-0000-3512-2118-0009af100700';
const NOW = Date.UTC(2025, 2, 1, 10, 20, 0);
const ctx: GattContext = { now: NOW, timezoneOffsetMin: 0 };

const svc = (uuid: string, ...chars: string[]): DiscoveredService => ({
  uuid,
  characteristics: chars.map((c) => ({ uuid: c, properties: ['notify', 'write'] as ('notify' | 'write')[] })),
});

const le16 = (v: number): string => (v & 0xff).toString(16).padStart(2, '0') + (v >> 8).toString(16).padStart(2, '0');
const h = (n: number): string => n.toString(16).padStart(2, '0');

/** openScale's history10Frame test helper, with a fixed date of 2025-03-01 10:20:00. */
function history10(weightKg: number, status = 0x20): string {
  return h(status) + le16(Math.round(weightKg * 200)) + le16(2025) + h(3) + h(1) + h(10) + h(20) + h(0);
}

/** v2 frame: c0, c1, year, month, day, hour, minute, imp, weight. */
function live13(weightRaw: number, c0: number, c1: number, imp = 0): string {
  return h(c0) + h(c1) + le16(2025) + h(3) + h(1) + h(10) + h(20) + h(0) + le16(imp) + le16(weightRaw);
}

const writes = (actions: GattAction[]) => actions.filter((a): a is Extract<GattAction, { op: 'write' }> => a.op === 'write');

describe('Mi Scale matching (name rules of MiScaleHandler.supportFor)', () => {
  const m = (name: string | null) => MI_SCALE_PROTOCOL.matches({ id: 'x', name, serviceUuids: [] });
  it('accepts the Mi names, case insensitive', () => {
    for (const n of ['MI SCALE2', 'MIBFS', 'MIBCS', 'MI_SCALE', 'mi_scale', 'MIBFS-1234', 'MI_SCALE_ab']) expect(m(n)).toBe(true);
  });
  it('rejects others', () => {
    for (const n of ['MI SCALE', 'MI SCALE3', 'BF600', '', null]) expect(m(n)).toBe(false);
  });
});

describe('Mi Scale variant detection from the GATT table (MiScaleHandlerVariantTest)', () => {
  it('weight-only XMTZC04HM: history under 0x181D plus vendor cfg is v1 and never touches 0x181B', () => {
    const services = [svc('181d', HIST), svc(CFG, CFG_CHR)];
    expect(detectVariant(services)?.variant).toBe('v1');
    const step = MI_SCALE_PROTOCOL.createSession(ctx).start(services);
    const touched = new Set(step.actions.map((a) => a.service));
    expect(touched.has('181d')).toBe(true);
    expect(touched.has('181b')).toBe(false);
    expect(touched.has(CFG)).toBe(false);
  });

  it('genuine v2: history under 0x181B', () => {
    const services = [svc('181b', HIST), svc(CFG, CFG_CHR)];
    expect(detectVariant(services)?.variant).toBe('v2');
    const touched = new Set(MI_SCALE_PROTOCOL.createSession(ctx).start(services).actions.map((a) => a.service));
    expect(touched.has('181b')).toBe(true);
    expect(touched.has('181d')).toBe(false);
  });

  it('neither service: nothing written, session is done', () => {
    const step = MI_SCALE_PROTOCOL.createSession(ctx).start([]);
    expect(step.actions).toEqual([]);
    expect(step.done).toBe(true);
  });

  it('clone with only 0x181D / 0x2A9D connects and parses a live 10 byte frame', () => {
    const session = MI_SCALE_PROTOCOL.createSession(ctx);
    const step = session.start([svc('181d', '2a9d')]);
    expect(step.done).toBeUndefined();
    expect(step.actions.some((a) => a.op === 'subscribe' && a.characteristic === '2a9d')).toBe(true);
    const r = session.onValue('181d', '2a9d', history10(70), NOW);
    expect(r.readings).toHaveLength(1);
    expect(r.readings[0].weightKg).toBe(70);
    expect(r.readings[0].stable).toBe(true);
    expect(r.readings[0].scaleTime).toBe(NOW);
  });

  it('a later detection of the same name does not change the session variant (v1 frames on 0x2A9D still parse)', () => {
    const session = MI_SCALE_PROTOCOL.createSession(ctx);
    session.start([svc('181d', HIST, '2a9d')]);
    MI_SCALE_PROTOCOL.matches({ id: 'x', name: 'MI SCALE2', serviceUuids: [CFG] });
    expect(session.onValue('181d', '2a9d', history10(70), NOW).readings).toHaveLength(1);
  });
});

describe('Mi Scale handshake bytes', () => {
  const tzCtx: GattContext = { now: Date.UTC(2026, 6, 4, 3, 5, 6), timezoneOffsetMin: 420 };

  it('v1: time, magic, subscribe, only-last, trigger (MiScaleHandler.onConnected order)', () => {
    const step = MI_SCALE_PROTOCOL.createSession(tzCtx).start([svc('181d', HIST, '2a2b', '2a9d')]);
    expect(step.actions).toEqual([
      { op: 'write', service: '181d', characteristic: '2a2b', hex: 'ea0707040a0506' + '000001', withResponse: true },
      { op: 'write', service: '181d', characteristic: HIST, hex: '01968abd62', withResponse: true },
      { op: 'subscribe', service: '181d', characteristic: HIST },
      { op: 'subscribe', service: '181d', characteristic: '2a9d' },
      { op: 'write', service: '181d', characteristic: HIST, hex: '01ffff0001', withResponse: true },
      { op: 'write', service: '181d', characteristic: HIST, hex: '02', withResponse: true },
    ]);
  });

  it('v2: unit config on the vendor service, then subscribe before the magic', () => {
    const step = MI_SCALE_PROTOCOL.createSession(tzCtx).start([svc('181b', HIST, '2a2b'), svc(CFG, CFG_CHR)]);
    expect(step.actions).toEqual([
      { op: 'write', service: CFG, characteristic: CFG_CHR, hex: '06040000', withResponse: true },
      { op: 'write', service: '181b', characteristic: '2a2b', hex: 'ea0707040a0506' + '000001', withResponse: true },
      { op: 'subscribe', service: '181b', characteristic: HIST },
      { op: 'write', service: '181b', characteristic: HIST, hex: '01968abd62', withResponse: true },
      { op: 'write', service: '181b', characteristic: HIST, hex: '01ffff0001', withResponse: true },
      { op: 'write', service: '181b', characteristic: HIST, hex: '02', withResponse: true },
    ]);
  });

  it('time falls back to the alternate service', () => {
    const step = MI_SCALE_PROTOCOL.createSession(tzCtx).start([svc('181b', HIST), svc('181d', '2a2b')]);
    expect(writes(step.actions)[0]).toMatchObject({ service: '181d', characteristic: '2a2b' });
  });

  it('time payload is local time', () => {
    expect(miTimePayload(Date.UTC(2026, 6, 4, 3, 5, 6), 420)).toBe('ea0707040a0506000001');
  });
});

describe('Mi Scale frames', () => {
  it('10 byte frame: kg, lb and jin', () => {
    expect(parseHistory10(Uint8Array.from(Buffer.from(history10(70), 'hex')), NOW)?.weightKg).toBe(70);
    const lb = parseHistory10(Uint8Array.from(Buffer.from(h(0x21) + le16(15000) + history10(0).slice(6), 'hex')), NOW);
    expect(lb?.weightKg).toBe(68.04);
    expect(lb?.unit).toBe('lb');
    const jin = parseHistory10(Uint8Array.from(Buffer.from(h(0x30) + le16(14000) + history10(0).slice(6), 'hex')), NOW);
    expect(jin?.weightKg).toBe(70);
    expect(jin?.unit).toBe('jin');
  });

  it('10 byte frame: unstable is reported as such, removed and implausible dates are dropped', () => {
    expect(parseHistory10(Uint8Array.from(Buffer.from(history10(70, 0x00), 'hex')), NOW)?.stable).toBe(false);
    expect(parseHistory10(Uint8Array.from(Buffer.from(history10(70, 0xa0), 'hex')), NOW)).toBeNull();
    expect(parseHistory10(Uint8Array.from(Buffer.from(history10(70), 'hex')), Date.UTC(2060, 0, 1))).toBeNull();
  });

  it('13 byte v2 frame with impedance, via the history characteristic', () => {
    const session = MI_SCALE_PROTOCOL.createSession(ctx);
    session.start([svc('181b', HIST)]);
    const step = session.onValue('181b', HIST, live13(14000, 0x02, 0x22, 480), NOW);
    expect(step.readings).toHaveLength(1);
    expect(step.readings[0]).toMatchObject({ weightKg: 70, stable: true, unit: 'kg', impedanceOhm: 480, scaleTime: NOW });
  });

  it('13 byte frame without the impedance flag or with zero impedance has none', () => {
    expect(parseLive13(Uint8Array.from(Buffer.from(live13(14000, 0x02, 0x20, 480), 'hex')))?.impedanceOhm).toBeUndefined();
    expect(parseLive13(Uint8Array.from(Buffer.from(live13(14000, 0x02, 0x22, 0), 'hex')))?.impedanceOhm).toBeUndefined();
  });

  it('13 byte frame: lb flag, catty flag, unstable live frame, removed', () => {
    const p = (c0: number, c1: number, raw: number) => parseLive13(Uint8Array.from(Buffer.from(live13(raw, c0, c1), 'hex')));
    expect(p(0x03, 0x20, 15000)).toMatchObject({ weightKg: 68.04, unit: 'lb' });
    expect(p(0x02, 0x60, 14000)).toMatchObject({ weightKg: 70, unit: 'jin' });
    expect(p(0x02, 0x00, 14000)).toMatchObject({ weightKg: 70, stable: false });
    expect(p(0x02, 0xa0, 14000)).toBeNull();
    expect(p(0x02, 0x20, 0)).toBeNull();
  });

  it('26 byte combined frame yields both records', () => {
    const session = MI_SCALE_PROTOCOL.createSession(ctx);
    session.start([svc('181b', HIST)]);
    const step = session.onValue('181b', HIST, live13(14000, 0x02, 0x20) + live13(14100, 0x02, 0x20), NOW);
    expect(step.readings.map((r) => r.weightKg)).toEqual([70, 70.5]);
  });

  it('history chunks: partial records are buffered across notifications, count response resets, 0x03 finishes with acks', () => {
    const session = MI_SCALE_PROTOCOL.createSession(ctx);
    session.start([svc('181d', HIST)]);
    expect(session.onValue('181d', HIST, '01010000010000', NOW)).toBe(NOTHING);
    const rec = history10(70);
    expect(session.onValue('181d', HIST, rec.slice(0, 8), NOW)).toBe(NOTHING);
    const second = session.onValue('181d', HIST, rec.slice(8) + history10(71), NOW);
    expect(second.readings.map((r) => r.weightKg)).toEqual([70, 71]);
    const end = session.onValue('181d', HIST, '03', NOW);
    expect(end.done).toBe(true);
    expect(end.actions).toEqual([
      { op: 'write', service: '181d', characteristic: HIST, hex: '03', withResponse: true },
      { op: 'write', service: '181d', characteristic: HIST, hex: '04ffff0001', withResponse: true },
    ]);
  });

  it('control response with an unknown marker is ignored, and garbage never throws', () => {
    const session = MI_SCALE_PROTOCOL.createSession(ctx);
    session.start([svc('181d', HIST, '2a9d')]);
    for (const hex of ['', '00', '01', '0196', '0101000102ab', 'ff'.repeat(7), 'zz', '0'.repeat(26), 'ff'.repeat(13), 'ff'.repeat(10)]) {
      expect(() => session.onValue('181d', HIST, hex, NOW)).not.toThrow();
      expect(() => session.onValue('181d', '2a9d', hex, NOW)).not.toThrow();
    }
    expect(parseLive13(new Uint8Array(5))).toBeNull();
    expect(parseHistory10(new Uint8Array(0), NOW)).toBeNull();
    expect(MI_SCALE_PROTOCOL.createSession(ctx).onValue('180f', '2a19', '64', NOW)).toBe(NOTHING);
  });

  it('metadata', () => {
    expect(MI_SCALE_PROTOCOL.id).toBe('xiaomi-mi-scale');
    expect(MI_SCALE_PROTOCOL.source).toEqual(['scales/MiScaleHandler.kt', 'libs/MiScaleLib.kt']);
  });
});
