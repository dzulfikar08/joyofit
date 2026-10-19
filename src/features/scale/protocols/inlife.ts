/**
 * Inlife fat scales ("000FatScale01" / "000FatScale02" / "042FatScale01").
 *
 * Ported from openScale (https://github.com/oliexdev/openScale): scales/InlifeHandler.kt
 * Copyright (C) olie.xdev, GPL-3.0-or-later.
 *
 * openScale has no test for this handler; the test vectors are derived from the frame layout in the source, not a capture.
 *
 * Frame (14 bytes, both directions): `02 [cmd] [params...] [xor of bytes 1..11 at 12] AA`; a received frame XORs to 0 over 1..12.
 * `D8` live weight (u16 BE /10), `DD` result, `DF` user ack, `0F` idle. The result has two variants: byte 11 = 80/81 carries
 * weight + impedance (u32 BE at 4), otherwise weight + lean body mass (u24 BE at 4, /1000 kg).
 */
import { bytesToHex, hexToBytes } from '../../sensors/gatt';
import { NOTHING, type GattAction, type GattContext, type GattProtocol, type GattSession, type GattStep, type ScaleReading } from '../types';

const SVC = 'fff0';
const CHR_NOTIFY = 'fff1';
const CHR_CMD = 'fff2';
const FRAME_LEN = 14;
const USER_ID = 1;

const CMD_SET_USER = 0xd2;
const CMD_WEIGHT = 0xd8;
const CMD_RESULT = 0xdd;
const CMD_FINISH = 0xd4;

const xorRange = (b: ArrayLike<number>, toInclusive: number) => {
  let x = 0;
  for (let i = 1; i <= toInclusive; i++) x ^= b[i];
  return x;
};

export function inlifeCommand(cmd: number, ...params: number[]): string {
  const f = new Uint8Array(FRAME_LEN);
  f[0] = 0x02;
  f[1] = cmd;
  params.slice(0, FRAME_LEN - 4).forEach((p, i) => (f[2 + i] = p & 0xff));
  f[FRAME_LEN - 2] = xorRange(f, FRAME_LEN - 3);
  f[FRAME_LEN - 1] = 0xaa;
  return bytesToHex(f);
}

/** The scale's result for one frame, or null for anything that is not a (valid) weight frame. */
export function decodeInlifeFrame(hex: string): { reading: ScaleReading; final: boolean } | null {
  const d = hexToBytes(hex);
  if (d.length !== FRAME_LEN || d[0] !== 0x02 || d[FRAME_LEN - 1] !== 0xaa || xorRange(d, FRAME_LEN - 2) !== 0) return null;
  const weightKg = ((d[2] << 8) | d[3]) / 10;
  if (d[1] === CMD_WEIGHT) {
    return weightKg > 0 ? { reading: { weightKg, stable: false, unit: 'kg' }, final: false } : null;
  }
  if (d[1] !== CMD_RESULT || !(weightKg > 0)) return null;
  const reading: ScaleReading = { weightKg, stable: true, unit: 'kg' };
  if (d[11] === 0x80 || d[11] === 0x81) {
    const imp = ((d[4] << 24) | (d[5] << 16) | (d[6] << 8) | d[7]) >>> 0;
    if (imp > 0) reading.impedanceOhm = imp;
  } else {
    const lbmRaw = (d[4] << 16) | (d[5] << 8) | d[6];
    // 0xFFFFFF is the "feet not placed correctly" sentinel.
    if (lbmRaw >= 0xffffff) return null;
    reading.reported = { leanKg: lbmRaw / 1000 };
  }
  return { reading, final: true };
}

function createSession(ctx: GattContext): GattSession {
  let last: string | null = null;
  const write = (hex: string): GattAction => ({ op: 'write', service: SVC, characteristic: CHR_CMD, hex, withResponse: true });
  return {
    start(): GattStep {
      const u = ctx.user ?? { heightCm: 170, ageYears: 30, male: true };
      // level 1 = general (no athlete correction), sex 0 = male, 1 = female
      return {
        actions: [
          { op: 'subscribe', service: SVC, characteristic: CHR_NOTIFY },
          write(inlifeCommand(CMD_SET_USER, 1, u.male ? 0 : 1, USER_ID, u.ageYears & 0xff, Math.trunc(u.heightCm) & 0xff)),
        ],
        readings: [],
      };
    },
    onValue(_service, characteristic, hex): GattStep {
      if (characteristic !== CHR_NOTIFY || hex === last) return NOTHING;
      const r = decodeInlifeFrame(hex);
      if (!r) return NOTHING;
      last = hex;
      if (!r.final) return { actions: [], readings: [r.reading] };
      return { actions: [write(inlifeCommand(CMD_FINISH))], readings: [r.reading], done: true };
    },
  };
}

export const INLIFE: GattProtocol = {
  id: 'inlife',
  kind: 'gatt',
  label: 'Inlife', // i18n-ok scale model name
  brands: ['Inlife'],
  source: ['scales/InlifeHandler.kt'],
  matches: (i) => ['000fatscale01', '000fatscale02', '042fatscale01'].includes((i.name ?? '').toLowerCase()),
  createSession,
};
