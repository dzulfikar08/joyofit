/**
 * Hesley scales advertising as "YunChen".
 *
 * Ported from openScale (https://github.com/oliexdev/openScale): scales/HesleyHandler.kt
 * Copyright (C) olie.xdev, GPL-3.0-or-later.
 *
 * openScale has no test for this handler; the test vectors are derived from the frame layout in the source, not a capture.
 *
 * Service fff0: subscribe to fff4, then write the arming bytes `A5 01 2C AB 50 5A 29` to fff1. The result is one 20 byte frame:
 * [2..3] weight u16 BE /100 kg, [4..5] fat % /10, [8..9] water % /10, [10..11] muscle % /10, [12..13] bone kg /10,
 * [14..15] kcal, [17] metabolic age (accepted when 10..99). openScale publishes every 20 byte frame, so we do too.
 */
import { hexToBytes } from '../../sensors/gatt';
import { NOTHING, type GattProtocol, type GattSession, type GattStep, type ReportedBody, type ScaleReading } from '../types';

const SVC = 'fff0';
const CHR_CMD = 'fff1';
const CHR_NOTIFY = 'fff4';
export const HESLEY_ARM = 'a5012cab505a29';

export function decodeHesleyFrame(hex: string): ScaleReading | null {
  const d = hexToBytes(hex);
  if (d.length !== 20) return null;
  const u16 = (i: number) => (d[i] << 8) | d[i + 1];
  const weightKg = u16(2) / 100;
  if (!(weightKg > 0)) return null;
  const reported: ReportedBody = {};
  if (u16(4) > 0) reported.bodyFatPct = u16(4) / 10;
  if (u16(8) > 0) reported.waterPct = u16(8) / 10;
  if (u16(10) > 0) reported.musclePct = u16(10) / 10;
  if (u16(12) > 0) reported.boneKg = u16(12) / 10;
  if (d[17] >= 10 && d[17] <= 99) reported.bodyAge = d[17];
  const reading: ScaleReading = { weightKg, stable: true, unit: 'kg' };
  if (Object.keys(reported).length) reading.reported = reported;
  return reading;
}

function createSession(): GattSession {
  return {
    start: (): GattStep => ({
      actions: [
        { op: 'subscribe', service: SVC, characteristic: CHR_NOTIFY },
        { op: 'write', service: SVC, characteristic: CHR_CMD, hex: HESLEY_ARM, withResponse: true },
      ],
      readings: [],
    }),
    onValue(_service, characteristic, hex): GattStep {
      if (characteristic !== CHR_NOTIFY) return NOTHING;
      const r = decodeHesleyFrame(hex);
      return r ? { actions: [], readings: [r], done: true } : NOTHING;
    },
  };
}

export const HESLEY: GattProtocol = {
  id: 'hesley-yunchen',
  kind: 'gatt',
  label: 'Hesley (YunChen)', // i18n-ok scale model name
  brands: ['Hesley', 'YunChen'],
  source: ['scales/HesleyHandler.kt'],
  matches: (i) => (i.name ?? '').toLowerCase() === 'yunchen',
  createSession,
};
