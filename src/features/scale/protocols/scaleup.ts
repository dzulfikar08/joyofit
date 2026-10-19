/**
 * Scaleup protocol scales (advertised name "da", or any manufacturer record whose company id low byte is 0xD0 or 0xE0). The weight
 * rides in the advertisement, not even the company id bytes are real.
 *
 * Ported from openScale `scales/ScaleupHandler.kt` (https://github.com/oliexdev/openScale), Copyright (C) olie.xdev,
 * GPL-3.0-or-later. openScale has no test or capture for this handler; scaleup.test.ts builds frames from its documented layout.
 *
 * Raw AD: [flag:1][weight:2 BE][impedance:2 BE][MAC:6]. Android splits the first two bytes off as company id (little endian), so
 * key = (weightMSB << 8) | flag and data = [weightLSB, impMSB, impLSB, MAC x6]. Flag 0xD0 = measuring (impedance 0), 0xE0 =
 * stabilised. Weight in 0.01 kg. openScale does not publish the impedance (its unit is unknown), so neither does this decoder.
 */
import type { AdFrame, BroadcastProtocol, ScaleReading } from '../types';
import { hexToBytes } from '../../sensors/gatt';

const FLAG_MEASURING = 0xd0;
const FLAG_STABLE = 0xe0;
const MIN_DATA_LEN = 9;
const WEIGHT_MIN_KG = 0.5;
const WEIGHT_MAX_KG = 300;

function scaleupKeys(frame: AdFrame): number[] {
  return Object.keys(frame.manufacturerData)
    .map((k) => Number.parseInt(k, 16))
    .filter((id) => Number.isFinite(id) && ((id & 0xff) === FLAG_MEASURING || (id & 0xff) === FLAG_STABLE));
}

export const scaleupProtocol: BroadcastProtocol = {
  kind: 'broadcast',
  id: 'scaleup-broadcast',
  label: 'Scale Up (broadcast)', // i18n-ok scale model name
  brands: ['Scale Up'],
  source: ['scales/ScaleupHandler.kt'],
  matches(frame) {
    return (frame.name ?? '').trim().toLowerCase() === 'da' || scaleupKeys(frame).length > 0;
  },
  decode(frame): ScaleReading | null {
    for (const id of scaleupKeys(frame)) {
      const data = hexToBytes(frame.manufacturerData[id.toString(16).padStart(4, '0')] ?? '');
      if (data.length < MIN_DATA_LEN) continue;
      const weightKg = (((id >> 8) << 8) | data[0]) / 100;
      if (weightKg < WEIGHT_MIN_KG || weightKg > WEIGHT_MAX_KG) continue;
      return { weightKg: Math.round(weightKg * 100) / 100, stable: (id & 0xff) === FLAG_STABLE };
    }
    return null;
  },
};
