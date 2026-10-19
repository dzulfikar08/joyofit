/**
 * 1byone "new" scale (advertises as "1byone scale"): service 0xFFB0, notify 0xFFB2 (20-byte frames `AB 2A ...`), write 0xFFB1.
 *
 * Ported from openScale `scales/OneByoneNewHandler.kt` (wire level only; the `libs/OneByoneNewLib.kt` body-composition formulas are
 * not ported). Copyright (C) olie.xdev, GPL-3.0-or-later (https://github.com/oliexdev/openScale).
 *
 * openScale has no captured byte vectors for this protocol (OneByoneNewLibTest.kt only covers the formulas), so the tests build
 * frames from the layout documented in the handler header and check the handshake bytes against an independent hand computation
 * of its D7 / D4 checksums.
 *
 * Differences from openScale: it seeds the scale with the last stored measurement of each app user (weight and an impedance
 * back-computed from the stored lean body mass). A pure decoder has no measurement store, so those fields are sent as 0 and the
 * history refresh after a publish is not repeated. Without a `ctx.user` the entry uses 170 cm / 30 y / male.
 */
import { bytesToHex, hexToBytes } from '../../sensors/gatt';
import {
  NOTHING,
  type DiscoveredService,
  type GattContext,
  type GattInfo,
  type GattProtocol,
  type GattSession,
  type GattStep,
  type ScaleReading,
  type ScaleUser,
} from '../types';
import { normalizeUuid } from '../uuid';

const SVC = 'ffb0';
const CHR_NOTIFY = 'ffb2';
const CHR_WRITE = 'ffb1';
const MSG_LEN = 20;
const HDR_A = 0xab;
const HDR_B = 0x2a;
const FALLBACK_USER: ScaleUser = { heightCm: 170, ageYears: 30, male: true };

function sumBytes(msg: number[], from: number, length: number): number {
  let s = 0;
  for (let i = 0; i < length; i++) s = (s + msg[from + i]) & 0xff;
  return s;
}

/** Packs one 7-byte user entry: entry#, height, weight*10 int16 BE, sex<<7|age, impedance (LE: hi first as in openScale, else lo first). */
function setEntry(msg: number[], off: number, entryNum: number, user: ScaleUser, impedanceLe: boolean): void {
  // Last known weight and impedance are unknown here: 0.
  const weightTimes10 = 0;
  const imp = 0;
  msg[off] = entryNum & 0xff;
  msg[off + 1] = Math.round(user.heightCm) & 0xff;
  msg[off + 2] = (weightTimes10 >> 8) & 0xff;
  msg[off + 3] = weightTimes10 & 0xff;
  msg[off + 4] = ((user.male ? 1 : 0) << 7) | (Math.trunc(user.ageYears) & 0x7f);
  if (impedanceLe) {
    msg[off + 5] = (imp >> 8) & 0xff;
    msg[off + 6] = imp & 0xff;
  } else {
    msg[off + 5] = imp & 0xff;
    msg[off + 6] = (imp >> 8) & 0xff;
  }
}

/** Initial kick: `AB 2A <epoch s BE> 00 <unit> <entry> D7 <checksum>`. The unit is kilograms (0). */
export function buildWeightRequest(nowMs: number, user: ScaleUser): number[] {
  const msg = new Array<number>(MSG_LEN).fill(0);
  msg[0] = HDR_A;
  msg[1] = HDR_B;
  const t = Math.floor(nowMs / 1000) >>> 0;
  msg[2] = (t >>> 24) & 0xff;
  msg[3] = (t >>> 16) & 0xff;
  msg[4] = (t >>> 8) & 0xff;
  msg[5] = t & 0xff;
  msg[6] = 0;
  msg[7] = 0;
  setEntry(msg, 8, 1, user, false);
  msg[18] = 0xd7;
  // Sum of bytes 2..18, minus the age/sex byte of the entry (openScale's "remove impedance MSB").
  msg[19] = (sumBytes(msg, 2, 17) - msg[12]) & 0xff;
  return msg;
}

/** History upload for one user: `AB 2A <users> <frame#> <entry> .. D4 <checksum>`. */
export function buildUserHistory(user: ScaleUser): number[] {
  const msg = new Array<number>(MSG_LEN).fill(0);
  msg[0] = HDR_A;
  msg[1] = HDR_B;
  msg[2] = 1;
  msg[3] = 1;
  setEntry(msg, 4, 1, user, true);
  msg[18] = 0xd4;
  msg[19] = (sumBytes(msg, 2, 18) - msg[9] - msg[13] - msg[14] - msg[16]) & 0xff;
  return msg;
}

function u16be(b: Uint8Array, i: number): number {
  return (b[i] << 8) | b[i + 1];
}
function u24be(b: Uint8Array, i: number): number {
  return (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
}
function u32be(b: Uint8Array, i: number): number {
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
}

class OneByoneNewSession implements GattSession {
  private pendingKg: number | null = null;

  constructor(private readonly ctx: GattContext) {}

  start(_services: DiscoveredService[]): GattStep {
    const user = this.ctx.user ?? FALLBACK_USER;
    const w = (bytes: number[]) =>
      ({ op: 'write', service: SVC, characteristic: CHR_WRITE, hex: bytesToHex(Uint8Array.from(bytes)), withResponse: true }) as const;
    return {
      actions: [
        { op: 'subscribe', service: SVC, characteristic: CHR_NOTIFY },
        w(buildWeightRequest(this.ctx.now, user)),
        w(buildUserHistory(user)),
      ],
      readings: [],
    };
  }

  onValue(service: string, characteristic: string, hex: string, _now: number): GattStep {
    if (normalizeUuid(service) !== SVC || normalizeUuid(characteristic) !== CHR_NOTIFY) return NOTHING;
    const b = hexToBytes(hex);
    if (b.length < MSG_LEN || b[0] !== HDR_A || b[1] !== HDR_B) return NOTHING;

    switch (b[2]) {
      case 0x80: {
        // Final weight; the impedance follows in a 0x01 frame.
        const kg = (u24be(b, 3) & 0x03ffff) / 1000;
        this.pendingKg = kg > 0 ? kg : null;
        return kg > 0 ? { actions: [], readings: [{ weightKg: round2(kg), stable: false, unit: 'kg' }] } : NOTHING;
      }
      case 0x01: {
        if (this.pendingKg === null) return NOTHING;
        const reading = this.reading(this.pendingKg, u16be(b, 4), true);
        this.pendingKg = null;
        return { actions: [], readings: [reading] };
      }
      case 0x00: {
        // Unified history / real-time frame; byte 7 == 0x80 marks a stored record.
        if (b[7] !== 0x80) return NOTHING;
        const kg = (u24be(b, 8) & 0x03ffff) / 1000;
        if (!(kg > 0)) return NOTHING;
        const reading = this.reading(kg, u16be(b, 15), true);
        reading.scaleTime = u32be(b, 3) * 1000;
        return { actions: [], readings: [reading] };
      }
      default:
        return NOTHING;
    }
  }

  private reading(kg: number, impedance: number, stable: boolean): ScaleReading {
    const r: ScaleReading = { weightKg: round2(kg), stable, unit: 'kg' };
    if (impedance > 0) r.impedanceOhm = impedance;
    return r;
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export const ONE_BY_ONE_NEW_PROTOCOL: GattProtocol = {
  kind: 'gatt',
  id: 'one-by-one-new',
  label: '1byone scale (new)', // i18n-ok scale model name
  brands: ['1byone'],
  source: ['scales/OneByoneNewHandler.kt', 'libs/OneByoneNewLib.kt'],
  matches: (info: GattInfo) => (info.name ?? '').toLowerCase() === '1byone scale',
  createSession: (ctx) => new OneByoneNewSession(ctx),
};
