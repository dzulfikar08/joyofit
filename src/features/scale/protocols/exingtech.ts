/**
 * Exingtech Y1 scales, usually advertising as "VScale".
 *
 * Ported from openScale (https://github.com/oliexdev/openScale): scales/ExingtechY1Handler.kt
 * Copyright (C) olie.xdev, GPL-3.0-or-later.
 *
 * openScale has no test for this handler; the test vectors are derived from the frame layout in the source, not a capture.
 *
 * Service f433bd80-75b8-11e2-97d9-0002a5d5c51b, notify 1a2ea400-75b9-11e2-be05-0002a5d5c51b, write 29f11080-75b9-11e2-8bf6-0002a5d5c51b.
 * Subscribe, then write the user block `10 [id] [sex 0=male 1=female] [age] [height cm]`. Results are 20 byte frames:
 * [4..5] weight /10, [6..7] fat % /10 (0xFF in byte 6 = weight-only frame, no composition yet), [8..9] water % /10,
 * [10..11] bone kg /10, [12..13] muscle % /10, [14] visceral rating.
 */
import { bytesToHex, hexToBytes } from '../../sensors/gatt';
import { NOTHING, type GattContext, type GattProtocol, type GattSession, type GattStep, type ScaleReading } from '../types';

const SERVICE = 'f433bd80-75b8-11e2-97d9-0002a5d5c51b';
const CHR_NOTIFY = '1a2ea400-75b9-11e2-be05-0002a5d5c51b';
const CHR_CMD = '29f11080-75b9-11e2-8bf6-0002a5d5c51b';
const USER_ID = 1;

export function exingtechUserBlock(user: { heightCm: number; ageYears: number; male: boolean } | undefined): string {
  const u = user ?? { heightCm: 170, ageYears: 30, male: true };
  return bytesToHex(Uint8Array.from([0x10, USER_ID, u.male ? 0 : 1, u.ageYears & 0xff, Math.trunc(u.heightCm) & 0xff]));
}

export function decodeExingtechFrame(hex: string): ScaleReading | null {
  const d = hexToBytes(hex);
  if (d.length !== 20) return null;
  const u16 = (i: number) => (d[i] << 8) | d[i + 1];
  const weightKg = u16(4) / 10;
  if (!(weightKg > 0)) return null;
  if (d[6] === 0xff) return { weightKg, stable: false, unit: 'kg' };
  const reported: NonNullable<ScaleReading['reported']> = {};
  if (u16(6) > 0) reported.bodyFatPct = u16(6) / 10;
  if (u16(8) > 0) reported.waterPct = u16(8) / 10;
  if (u16(10) > 0) reported.boneKg = u16(10) / 10;
  if (u16(12) > 0) reported.musclePct = u16(12) / 10;
  if (d[14] > 0) reported.visceralFat = d[14];
  const reading: ScaleReading = { weightKg, stable: true, unit: 'kg' };
  if (Object.keys(reported).length) reading.reported = reported;
  return reading;
}

function createSession(ctx: GattContext): GattSession {
  return {
    start: (): GattStep => ({
      actions: [
        { op: 'subscribe', service: SERVICE, characteristic: CHR_NOTIFY },
        { op: 'write', service: SERVICE, characteristic: CHR_CMD, hex: exingtechUserBlock(ctx.user), withResponse: true },
      ],
      readings: [],
    }),
    onValue(_service, characteristic, hex): GattStep {
      if (characteristic !== CHR_NOTIFY) return NOTHING;
      const r = decodeExingtechFrame(hex);
      if (!r) return NOTHING;
      return r.stable ? { actions: [], readings: [r], done: true } : { actions: [], readings: [r] };
    },
  };
}

export const EXINGTECH_Y1: GattProtocol = {
  id: 'exingtech-y1',
  kind: 'gatt',
  label: 'Exingtech Y1 (VScale)', // i18n-ok scale model name
  brands: ['Exingtech', 'VScale'],
  source: ['scales/ExingtechY1Handler.kt'],
  matches: (i) => (i.name ?? '').toLowerCase() === 'vscale' || i.serviceUuids.includes(SERVICE),
  createSession,
};
