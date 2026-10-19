/**
 * Excelvan CF36xBLE, the very common cheap scale advertising as "Electronic Scale".
 *
 * Ported from openScale (https://github.com/oliexdev/openScale): scales/ExcelvanCF36xHandler.kt
 * Copyright (C) olie.xdev, GPL-3.0-or-later.
 *
 * openScale has no test for this handler; the test vectors are derived from the frame layout in the source, not a capture.
 *
 * Service fff0: user config is written to fff1 (`FE [id] [sex 1=male] [activity] [height] [age] [unit 1=kg 2=lb 4=st] [xor of 1..6]`),
 * results arrive on fff4 as one 16 or 17 byte frame starting with CF. openScale checks no checksum on received frames (the
 * layout has none we know of), so neither do we: a frame is accepted on header and length only. The scale reports the unit the
 * config asked for; we always ask for kg.
 *
 * Result frame: [4..5] weight u16 BE /10, [6..7] fat % /10, [8] bone kg /10, [9..10] muscle % /10, [11] visceral rating,
 * [12..13] water % /10, [14..15] BMR kcal.
 */
import { hexToBytes, bytesToHex } from '../../sensors/gatt';
import { NOTHING, type GattContext, type GattProtocol, type GattSession, type GattStep, type ReportedBody, type ScaleReading } from '../types';

const SVC = 'fff0';
const CHR_WRITE = 'fff1';
const CHR_NOTIFY = 'fff4';

/** The 8 byte user config. The legacy driver always used user id 1; the activity level is not known to the app (0 = normal). */
export function excelvanConfig(user: { heightCm: number; ageYears: number; male: boolean } | undefined): string {
  const u = user ?? { heightCm: 170, ageYears: 30, male: true };
  const cfg = [0xfe, 0x01, u.male ? 1 : 0, 0x00, Math.min(255, Math.max(0, Math.round(u.heightCm))), Math.min(255, Math.max(0, u.ageYears)), 0x01, 0];
  let x = 0;
  for (let i = 1; i < 7; i++) x ^= cfg[i];
  cfg[7] = x;
  return bytesToHex(Uint8Array.from(cfg));
}

export function decodeExcelvanFrame(hex: string): ScaleReading | null {
  const d = hexToBytes(hex);
  if (d.length < 16 || d.length > 17 || d[0] !== 0xcf) return null;
  const u16 = (i: number) => (d[i] << 8) | d[i + 1];
  const weightKg = u16(4) / 10;
  if (!(weightKg > 0)) return null;
  const reported: ReportedBody = {};
  if (u16(6) > 0) reported.bodyFatPct = u16(6) / 10;
  if (d[8] > 0) reported.boneKg = d[8] / 10;
  if (u16(9) > 0) reported.musclePct = u16(9) / 10;
  if (d[11] > 0) reported.visceralFat = d[11];
  if (u16(12) > 0) reported.waterPct = u16(12) / 10;
  if (u16(14) > 0) reported.bmrKcal = u16(14);
  const reading: ScaleReading = { weightKg, stable: true, unit: 'kg' };
  if (Object.keys(reported).length) reading.reported = reported;
  return reading;
}

function createSession(ctx: GattContext): GattSession {
  let last: string | null = null;
  return {
    start: (): GattStep => ({
      actions: [
        { op: 'write', service: SVC, characteristic: CHR_WRITE, hex: excelvanConfig(ctx.user), withResponse: true },
        { op: 'subscribe', service: SVC, characteristic: CHR_NOTIFY },
      ],
      readings: [],
    }),
    onValue(_service, characteristic, hex): GattStep {
      if (characteristic !== CHR_NOTIFY || hex === last) return NOTHING;
      const r = decodeExcelvanFrame(hex);
      if (!r) return NOTHING;
      last = hex;
      return { actions: [], readings: [r], done: true };
    },
  };
}

export const EXCELVAN_CF36X: GattProtocol = {
  id: 'excelvan-cf36x',
  kind: 'gatt',
  label: 'Excelvan CF36xBLE ("Electronic Scale")', // i18n-ok scale model name
  brands: ['Excelvan', 'Electronic Scale (generic)'],
  source: ['scales/ExcelvanCF36xHandler.kt'],
  matches: (i) => (i.name ?? '').toLowerCase() === 'electronic scale',
  createSession,
};
