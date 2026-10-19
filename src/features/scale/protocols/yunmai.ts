/**
 * Yunmai scales: connected SE / Mini (GATT) and the broadcast-only Yunmai X (YMBS-M268).
 *
 * Ported from openScale (https://github.com/oliexdev/openScale):
 *   scales/YunmaiHandler.kt, scales/YunmaiXHandler.kt (wire part of libs/YunmaiLib.kt is not needed: the body composition
 *   formulas live in bodyComposition.ts, only the impedance and values the scale itself sends are decoded here).
 * Copyright (C) olie.xdev, GPL-3.0-or-later.
 *
 * Test vectors: openScale has no capture for the connected handler; the Yunmai X fixtures are the synthetic frames of
 * test/.../scales/YunmaiXHandlerTest.kt (built to the reverse-engineered layout).
 */
import { bytesToHex, hexToBytes } from '../../sensors/gatt';
import {
  NOTHING,
  type AdFrame,
  type BroadcastProtocol,
  type DiscoveredService,
  type GattAction,
  type GattContext,
  type GattProtocol,
  type GattSession,
  type GattStep,
  type ScaleReading,
} from '../types';

const SVC_MEAS = 'ffe0';
const CHR_MEAS = 'ffe4';
const SVC_CMD = 'ffe5';
const CHR_CMD = 'ffe9';

/** openScale ignores scale clocks before 1980-01-01. */
const EARLIEST_PLAUSIBLE_MS = 315532800000;
/** User id sent to (and expected back from) the scale. openScale uses the app user id, we have a single phone-side user. */
const USER_ID = 1;

const round2 = (v: number) => Math.round(v * 100) / 100;

function xor(bytes: number[], start: number, endExclusive: number): number {
  let acc = 0;
  for (let i = start; i < endExclusive; i++) acc ^= bytes[i];
  return acc;
}

/** `0D 12 10 01 00 00 [uid hi lo] [height] [sex 1=male 2=female] [age] 55 5A 00 00 [unit 1=kg] [activity] [xor]`. */
export function yunmaiUserPacket(user: { heightCm: number; ageYears: number; male: boolean } | undefined): string {
  const u = user ?? { heightCm: 170, ageYears: 30, male: true };
  const p = [
    0x0d,
    0x12,
    0x10,
    0x01,
    0x00,
    0x00,
    (USER_ID >> 8) & 0xff,
    USER_ID & 0xff,
    Math.trunc(u.heightCm) & 0xff,
    u.male ? 0x01 : 0x02,
    u.ageYears & 0xff,
    0x55,
    0x5a,
    0x00,
    0x00,
    0x01, // kg
    0x00, // activity level: not known to the app
    0,
  ];
  p[p.length - 1] = xor(p, 1, p.length - 1);
  return bytesToHex(Uint8Array.from(p));
}

/** `0D 0D 11 [unix seconds BE] 00 00 00 00 00 [xor]`. */
export function yunmaiTimePacket(nowMs: number): string {
  const s = Math.floor(nowMs / 1000) >>> 0;
  const p = [0x0d, 0x0d, 0x11, (s >>> 24) & 0xff, (s >>> 16) & 0xff, (s >>> 8) & 0xff, s & 0xff, 0, 0, 0, 0, 0, 0];
  p[p.length - 1] = xor(p, 1, p.length - 1);
  return bytesToHex(Uint8Array.from(p));
}

/** `0D 05 13 00 16`: GET_PROTOCOL_VERSION, which starts the measurement. */
export const YUNMAI_START = '0d05130016';

/** Final result frame. `0D [ver] [size] 02 00 [ts BE4] [uid BE4] [weight BE2 /100] [res BE2] ([fat BE2 /100] when ver >= 0x1E) [xor]`. */
export function decodeYunmaiFrame(hex: string, mini: boolean): ScaleReading | null {
  const d = hexToBytes(hex);
  if (d.length < 18 || d[0] !== 0x0d || d[3] !== 0x02) return null;
  const uid = ((d[9] << 24) | (d[10] << 16) | (d[11] << 8) | d[12]) >>> 0;
  if (uid !== USER_ID) return null;
  const weightKg = round2(((d[13] << 8) | d[14]) / 100);
  if (!(weightKg > 0)) return null;
  const reading: ScaleReading = { weightKg, stable: true, unit: 'kg' };
  const ts = (((d[5] << 24) | (d[6] << 16) | (d[7] << 8) | d[8]) >>> 0) * 1000;
  if (ts >= EARLIEST_PLAUSIBLE_MS) reading.scaleTime = ts;
  if (mini) {
    const res = (d[15] << 8) | d[16];
    if (res > 0) reading.impedanceOhm = res;
    if (d[1] >= 0x1e && d.length >= 19) {
      const fat = ((d[17] << 8) | d[18]) / 100;
      if (fat > 0) reading.reported = { bodyFatPct: round2(fat) };
    }
  }
  return reading;
}

function yunmaiSession(ctx: GattContext, mini: boolean): GattSession {
  let last: string | null = null;
  const write = (hex: string): GattAction => ({
    op: 'write',
    service: SVC_CMD,
    characteristic: CHR_CMD,
    hex,
    withResponse: true,
  });
  return {
    start(_services: DiscoveredService[]): GattStep {
      return {
        actions: [
          write(yunmaiUserPacket(ctx.user)),
          write(yunmaiTimePacket(ctx.now)),
          { op: 'subscribe', service: SVC_MEAS, characteristic: CHR_MEAS },
          write(YUNMAI_START),
        ],
        readings: [],
      };
    },
    onValue(_service, characteristic, hex): GattStep {
      if (characteristic !== CHR_MEAS) return NOTHING;
      const r = decodeYunmaiFrame(hex, mini);
      if (!r) return NOTHING;
      // openScale drops the repeated copy of the same result.
      if (last === hex) return NOTHING;
      last = hex;
      return { actions: [], readings: [r], done: true };
    },
  };
}

export const YUNMAI_MINI: GattProtocol = {
  id: 'yunmai-mini',
  kind: 'gatt',
  label: 'Yunmai Mini', // i18n-ok scale model name
  brands: ['Yunmai'],
  source: ['scales/YunmaiHandler.kt', 'libs/YunmaiLib.kt'],
  matches: (i) => {
    const n = i.name ?? '';
    return n.startsWith('YUNMAI-SIGNAL') || n.startsWith('YUNMAI-ISM') || n.startsWith('YUNMAI-ISC2P') || n === 'YUNMAI-Scale-3';
  },
  createSession: (ctx) => yunmaiSession(ctx, true),
};

export const YUNMAI_SE: GattProtocol = {
  id: 'yunmai-se',
  kind: 'gatt',
  label: 'Yunmai SE', // i18n-ok scale model name
  brands: ['Yunmai'],
  source: ['scales/YunmaiHandler.kt', 'libs/YunmaiLib.kt'],
  matches: (i) => (i.name ?? '').startsWith('YUNMAI-ISSE'),
  createSession: (ctx) => yunmaiSession(ctx, false),
};

/** Yunmai X: manufacturer payload (after the 2 id bytes) is 14 bytes: [mac4 reversed][0B 74 17][session][state][w BE][imp BE][xor]. */
interface YunmaiXFrame {
  state: number;
  weightKg: number;
  impedanceOhm: number;
}

function parseYunmaiX(idKey: string, payloadHex: string, address: string | null): YunmaiXFrame | null {
  if (payloadHex.length !== 28) return null;
  const p = hexToBytes(payloadHex);
  if (p[4] !== 0x0b || p[5] !== 0x74 || p[6] !== 0x17) return null;
  if (xor(Array.from(p), 7, 13) !== p[13]) return null;
  const octets = address ? address.split(':').map((o) => parseInt(o, 16)) : [];
  if (octets.length === 6 && octets.every((o) => Number.isInteger(o))) {
    const id = parseInt(idKey, 16);
    const ok =
      id === ((octets[4] << 8) | octets[5]) && p[0] === octets[3] && p[1] === octets[2] && p[2] === octets[1] && p[3] === octets[0];
    if (!ok) return null;
  }
  return { state: p[8], weightKg: ((p[9] << 8) | p[10]) / 100, impedanceOhm: (p[11] << 8) | p[12] };
}

function findYunmaiX(frame: AdFrame): YunmaiXFrame | null {
  for (const [key, payload] of Object.entries(frame.manufacturerData)) {
    const f = parseYunmaiX(key, payload, frame.id);
    if (f) return f;
  }
  return null;
}

export const YUNMAI_X: BroadcastProtocol = {
  id: 'yunmai-x',
  kind: 'broadcast',
  label: 'Yunmai X (YMBS-M268)', // i18n-ok scale model name
  brands: ['Yunmai'],
  source: ['scales/YunmaiXHandler.kt'],
  matches: (f) => findYunmaiX(f) !== null || f.serviceUuids.includes('1320'),
  decode(frame): ScaleReading | null {
    const f = findYunmaiX(frame);
    if (!f || f.state < 1 || f.state > 3 || !(f.weightKg > 0)) return null;
    const reading: ScaleReading = { weightKg: round2(f.weightKg), stable: f.state === 3, unit: 'kg' };
    if (f.state === 3 && f.impedanceOhm > 0) reading.impedanceOhm = f.impedanceOhm;
    return reading;
  },
};

export const YUNMAI_PROTOCOLS = [YUNMAI_MINI, YUNMAI_SE, YUNMAI_X];
