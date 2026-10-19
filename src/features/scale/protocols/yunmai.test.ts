/**
 * Vectors: Yunmai X frames follow openScale's YunmaiXHandlerTest.kt (synthetic frames built to the reverse-engineered layout,
 * placeholder MAC C0:FF:EE:12:34:56). The connected SE/Mini frames are derived from the layout comments in YunmaiHandler.kt,
 * not a capture.
 */
import { describe, expect, it } from 'bun:test';
import { bytesToHex } from '../../sensors/gatt';
import type { AdFrame } from '../types';
import { YUNMAI_MINI, YUNMAI_SE, YUNMAI_X, decodeYunmaiFrame, yunmaiTimePacket, yunmaiUserPacket } from './yunmai';

const ctx = { now: 1700000000000, timezoneOffsetMin: 0, user: { heightCm: 180, ageYears: 30, male: true } };

function xorHex(bytes: number[]): number {
  return bytes.reduce((a, b) => a ^ b, 0);
}

/** Frame per the layout comment (derived from source comments, not a capture). */
function resultFrame(ver: number, weightRaw: number, res: number, fat?: number): string {
  const b = [0x0d, ver, fat === undefined ? 0x12 : 0x14, 0x02, 0x00, 0x65, 0x53, 0xf1, 0x00, 0, 0, 0, 1, weightRaw >> 8, weightRaw & 255, res >> 8, res & 255];
  if (fat !== undefined) b.push(fat >> 8, fat & 255);
  b.push(xorHex(b.slice(1)));
  return bytesToHex(Uint8Array.from(b));
}

describe('yunmai connected (derived from source comments, not a capture)', () => {
  it('builds the handshake packets', () => {
    expect(yunmaiUserPacket(ctx.user)).toBe('0d12100100' + '0000' + '01' + 'b4' + '01' + '1e' + '555a0000' + '0100' + 'a7');
    expect(yunmaiTimePacket(ctx.now)).toBe('0d0d116553f1000000000000' + 'db');
  });

  it('start writes user, time, subscribes, then magic start', () => {
    const step = YUNMAI_MINI.createSession(ctx).start([]);
    expect(step.actions.map((a) => a.op)).toEqual(['write', 'write', 'subscribe', 'write']);
    const last = step.actions[3];
    expect(last.op === 'write' && last.hex).toBe('0d05130016');
  });

  it('decodes the final Mini frame with weight and impedance, no fat on old protocol', () => {
    const r = decodeYunmaiFrame(resultFrame(0x13, 7250, 500), true);
    expect(r).toEqual({ weightKg: 72.5, stable: true, unit: 'kg', scaleTime: 1700000000000, impedanceOhm: 500 });
  });

  it('reports the embedded fat percentage on protocol >= 0x1E', () => {
    const r = decodeYunmaiFrame(resultFrame(0x1e, 7250, 500, 2310), true);
    expect(r?.reported).toEqual({ bodyFatPct: 23.1 });
  });

  it('SE ignores resistance', () => {
    const r = decodeYunmaiFrame(resultFrame(0x13, 7250, 500), false);
    expect(r?.impedanceOhm).toBeUndefined();
  });

  it('ignores live frames, foreign users, zero weight and garbage; session emits once', () => {
    const live = resultFrame(0x13, 7250, 0).replace(/^(.{6})02/, '$101');
    expect(decodeYunmaiFrame(live, true)).toBeNull();
    expect(decodeYunmaiFrame(resultFrame(0x13, 0, 0), true)).toBeNull();
    expect(decodeYunmaiFrame('0d13', true)).toBeNull();
    expect(decodeYunmaiFrame('zz', true)).toBeNull();
    const s = YUNMAI_MINI.createSession(ctx);
    const f = resultFrame(0x13, 7250, 500);
    expect(s.onValue('ffe0', 'ffe4', f, 0).readings).toHaveLength(1);
    expect(s.onValue('ffe0', 'ffe4', f, 0).readings).toHaveLength(0);
    expect(s.onValue('ffe0', 'ffe9', f, 0).readings).toHaveLength(0);
  });

  it('matches device names', () => {
    const n = (name: string | null) => ({ id: 'x', name, serviceUuids: [] });
    expect(YUNMAI_MINI.matches(n('YUNMAI-SIGNAL-1234'))).toBe(true);
    expect(YUNMAI_MINI.matches(n('YUNMAI-Scale-3'))).toBe(true);
    expect(YUNMAI_SE.matches(n('YUNMAI-ISSE-1234'))).toBe(true);
    expect(YUNMAI_SE.matches(n('YUNMAI-SIGNAL-1234'))).toBe(false);
    expect(YUNMAI_MINI.matches(n(null))).toBe(false);
  });
});

const ADDRESS = 'C0:FF:EE:12:34:56';

function xFrame(state: number, weightRaw: number, impedance = 0, session = 0x04): string {
  const body = [0x12, 0xee, 0xff, 0xc0, 0x0b, 0x74, 0x17, session, state, weightRaw >> 8, weightRaw & 255, impedance >> 8, impedance & 255];
  body.push(xorHex(body.slice(7)));
  return bytesToHex(Uint8Array.from(body));
}

function ad(payload: string | null, id = ADDRESS, services: string[] = []): AdFrame {
  return { id, name: null, rssi: -50, ts: 0, serviceUuids: services, serviceData: {}, manufacturerData: payload ? { '3456': payload } : {} };
}

describe('yunmai x (fixtures from YunmaiXHandlerTest.kt)', () => {
  it('decodes live, stable and final frames', () => {
    expect(YUNMAI_X.decode(ad(xFrame(1, 7955)))).toEqual({ weightKg: 79.55, stable: false, unit: 'kg' });
    expect(YUNMAI_X.decode(ad(xFrame(2, 8000)))).toEqual({ weightKg: 80, stable: false, unit: 'kg' });
    expect(YUNMAI_X.decode(ad(xFrame(3, 8000, 500, 0x10)))).toEqual({ weightKg: 80, stable: true, unit: 'kg', impedanceOhm: 500 });
  });

  it('idle frame (zero weight) carries no reading but still matches', () => {
    expect(YUNMAI_X.decode(ad(xFrame(1, 0)))).toBeNull();
    expect(YUNMAI_X.matches(ad(xFrame(1, 0)))).toBe(true);
  });

  it('rejects bad checksum, signature, size and relocated MAC', () => {
    const good = xFrame(3, 8000, 500);
    expect(YUNMAI_X.decode(ad(good.slice(0, 18) + '1c' + good.slice(20)))).toBeNull();
    expect(YUNMAI_X.decode(ad(good.slice(0, 10) + '75' + good.slice(12)))).toBeNull();
    expect(YUNMAI_X.decode(ad(good.slice(0, 26)))).toBeNull();
    expect(YUNMAI_X.decode(ad(good, 'AA:BB:CC:DD:EE:FF'))).toBeNull();
    expect(YUNMAI_X.matches(ad(good, 'AA:BB:CC:DD:EE:FF'))).toBe(false);
  });

  it('matches nameless saved devices by service 0x1320 and not foreign data', () => {
    expect(YUNMAI_X.matches(ad(null, ADDRESS, ['1320']))).toBe(true);
    expect(YUNMAI_X.matches(ad('0102030405060708090a0b0c0d0e'))).toBe(false);
    expect(YUNMAI_X.matches(ad(null, ADDRESS, ['180d']))).toBe(false);
  });
});
