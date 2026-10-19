/**
 * QN / Renpho "AABB" broadcast scales (non-connectable, company id 0xFFFF), weight only.
 *
 * Ported from openScale `scales/QNHandlerBroadcast.kt` (https://github.com/oliexdev/openScale), Copyright (C) olie.xdev,
 * GPL-3.0-or-later. Vectors in qnBroadcast.test.ts come from openScale's test `QNHandlerBroadcastFT26RTest.kt` (frames captured
 * from a FITINDEX FT-26R-W).
 *
 * Payload (after the company id): [0-1] AA BB, [2-7] device address, [15] status, [17-18] weight LE uint16 in 0.01 kg.
 * Stable flag: bit 5 (0x20) on every AABB device; bit 0 (0x01) only when bytes [19-21] are the FT-26R signature 51 0E 03.
 */
import type { AdFrame, BroadcastProtocol, ScaleReading } from '../types';
import { hexToBytes } from '../../sensors/gatt';

const MIN_LENGTH = 19;
const FT26R_SIGNATURE = [0x51, 0x0e, 0x03];
const SIGNATURE_OFFSET = 19;
const WEIGHT_MIN_KG = 0.5;
const WEIGHT_MAX_KG = 300;

function record(frame: AdFrame): Uint8Array | null {
  const hex = frame.manufacturerData.ffff;
  if (hex == null) return null;
  try {
    return hexToBytes(hex);
  } catch {
    return null;
  }
}

export const qnBroadcastProtocol: BroadcastProtocol = {
  kind: 'broadcast',
  id: 'qn-broadcast',
  label: 'QN / Renpho (broadcast)', // i18n-ok scale model name
  brands: ['QN', 'Renpho', 'FITINDEX FT-26R', 'ES-CS20M'],
  source: ['scales/QNHandlerBroadcast.kt'],
  // The name is deliberately not used: "renpho" / "qn-scale" are also names of the connectable QN variants.
  matches(frame) {
    const data = record(frame);
    return data != null && data.length >= 2 && data[0] === 0xaa && data[1] === 0xbb;
  },
  decode(frame): ScaleReading | null {
    const data = record(frame);
    if (data == null || data.length < MIN_LENGTH || data[0] !== 0xaa || data[1] !== 0xbb) return null;
    const weightKg = (data[17] | (data[18] << 8)) / 100;
    // Rejects the zero-weight idle advertisement.
    if (weightKg < WEIGHT_MIN_KG || weightKg > WEIGHT_MAX_KG) return null;
    const ft26r =
      data.length >= SIGNATURE_OFFSET + FT26R_SIGNATURE.length && FT26R_SIGNATURE.every((b, i) => data[SIGNATURE_OFFSET + i] === b);
    const stableMask = ft26r ? 0x20 | 0x01 : 0x20;
    return { weightKg: Math.round(weightKg * 100) / 100, stable: (data[15] & stableMask) !== 0 };
  },
};
