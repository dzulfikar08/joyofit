/**
 * Etekcity Fit 8S: broadcast only. The scale has no name; it advertises service 0xFFD0 and a 20 byte manufacturer record under
 * company id 0x06D0 ("Etekcity Corporation").
 *
 * Ported from openScale `scales/EtekcityFit8SHandler.kt` (https://github.com/oliexdev/openScale), Copyright (C) olie.xdev,
 * GPL-3.0-or-later, itself based on https://github.com/ronnnnnnnnnnnnn/etekcity_esf551_ble. The body-composition formulas in
 * `libs/EtekcityLib.kt` are not part of the wire protocol and are not ported. openScale has no capture for this scale (its
 * catalog fixture is zero filled), so etekcityFit8s.test.ts builds frames from the documented layout.
 *
 * Payload: [0] 0x01, [1..6] MAC LE, [7..9] unknown, [10..12] weight in grams (LE 24 bit), [13..14] impedance ohm (LE, 0 = not
 * measured), [15] 0x01 = stable, [16] display unit (0 kg, 1 lb, 2 st; the weight is always grams), [17..19] unknown.
 */
import type { AdFrame, BroadcastProtocol, ScaleReading, WeightUnit } from '../types';
import { hexToBytes } from '../../sensors/gatt';

const PAYLOAD_SIZE = 20;
const UNITS: WeightUnit[] = ['kg', 'lb', 'st'];

export const etekcityFit8sProtocol: BroadcastProtocol = {
  kind: 'broadcast',
  id: 'etekcity-fit8s-broadcast',
  label: 'Etekcity Fit 8S', // i18n-ok scale model name
  brands: ['Etekcity', 'VeSync'],
  source: ['scales/EtekcityFit8SHandler.kt', 'libs/EtekcityLib.kt'],
  matches(frame: AdFrame) {
    return frame.manufacturerData['06d0'] != null && frame.serviceUuids.includes('ffd0');
  },
  decode(frame): ScaleReading | null {
    const hex = frame.manufacturerData['06d0'];
    if (hex == null) return null;
    const p = hexToBytes(hex);
    if (p.length !== PAYLOAD_SIZE) return null;
    const grams = p[10] | (p[11] << 8) | (p[12] << 16);
    if (grams <= 0) return null;
    const stable = p[15] === 1;
    const reading: ScaleReading = { weightKg: Math.round(grams / 10) / 100, stable };
    const unit = UNITS[p[16]];
    if (unit) reading.unit = unit;
    const impedance = p[13] | (p[14] << 8);
    if (stable && impedance > 0) reading.impedanceOhm = impedance;
    return reading;
  },
};
