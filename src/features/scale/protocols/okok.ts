/**
 * OKOK International / Chipsea broadcast scales (advertisement only, no connection). Four frame layouts ("V20", "V11", "VF0",
 * "C0") that openScale folds into one handler.
 *
 * Ported from openScale `scales/OkOkHandler.kt` (https://github.com/oliexdev/openScale), Copyright (C) olie.xdev,
 * GPL-3.0-or-later. The body-composition formulas of `libs/OkOkV2Lib.kt` are NOT part of the wire protocol and are not ported.
 * openScale has no unit test for this handler; the test file builds its vectors from the documented layout and checksum rule
 * (see okok.test.ts).
 *
 * Recognition: advertised name `ADV`, `Chipsea-BLE`, `Yoda0*` / `Yoda1*` (case-insensitive) or no name at all, AND a manufacturer
 * record whose company id is 0x20CA (V20), 0x11CA (V11), 0xF0FF (VF0) or whose low byte is 0xC0 (C0, the nameless variant).
 */
import type { AdFrame, BroadcastProtocol, ScaleReading, WeightUnit } from '../types';
import { hexToBytes } from '../../sensors/gatt';

const COMPANY_V20 = 0x20ca;
const COMPANY_V11 = 0x11ca;
const COMPANY_VF0 = 0xf0ff;

const V20_LENGTH = 19;
const V11_LENGTH = 23;

const KG_PER_LB = 0.45359237;

export type OkokVariant = 'V20' | 'V11' | 'VF0' | 'C0';

export interface OkokFrame {
  variant: OkokVariant;
  reading: ScaleReading;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function u16be(b: Uint8Array, msb: number, lsb: number): number {
  return (b[msb] << 8) | b[lsb];
}

function companyKeys(frame: AdFrame): number[] {
  return Object.keys(frame.manufacturerData)
    .map((k) => parseInt(k, 16))
    .filter((n) => Number.isFinite(n));
}

function payloadOf(frame: AdFrame, id: number): Uint8Array | null {
  const hex = frame.manufacturerData[id.toString(16).padStart(4, '0')];
  if (hex == null) return null;
  try {
    return hexToBytes(hex);
  } catch {
    return null;
  }
}

function firstC0Key(frame: AdFrame): number | null {
  for (const id of companyKeys(frame)) if ((id & 0xff) === 0xc0) return id;
  return null;
}

function hasOkokRecord(frame: AdFrame): boolean {
  return companyKeys(frame).some((id) => id === COMPANY_V20 || id === COMPANY_V11 || id === COMPANY_VF0 || (id & 0xff) === 0xc0);
}

function nameMatches(frame: AdFrame): boolean {
  const name = (frame.name ?? '').trim();
  if (name === '') return firstC0Key(frame) != null;
  const lower = name.toLowerCase();
  return name === 'ADV' || name === 'Chipsea-BLE' || lower.startsWith('yoda0') || lower.startsWith('yoda1');
}

function reading(weightKg: number, stable: boolean, unit: WeightUnit | undefined, impedanceOhm: number | undefined): ScaleReading | null {
  if (!Number.isFinite(weightKg) || weightKg <= 0) return null;
  const r: ScaleReading = { weightKg: round2(weightKg), stable };
  if (unit) r.unit = unit;
  if (impedanceOhm != null && impedanceOhm > 0) r.impedanceOhm = impedanceOhm;
  return r;
}

/** Resolution field shared by V11 and C0: bits 1..2 of the properties byte. */
function divider(props: number): number {
  switch ((props >> 1) & 3) {
    case 1:
      return 1;
    case 2:
      return 100;
    default:
      return 10;
  }
}

function decodeV20(data: Uint8Array): ScaleReading | null {
  if (data.length !== V20_LENGTH) return null;
  let checksum = 0x20;
  for (let i = 0; i < 12; i++) checksum ^= data[i];
  if (data[12] !== (checksum & 0xff)) return null;
  const final = (data[6] & 0x01) !== 0;
  const div = (data[6] & 0x04) !== 0 ? 100 : 10;
  const weight = u16be(data, 8, 9) / div;
  const imp = u16be(data, 10, 11) / 10;
  return reading(weight, final, 'kg', final ? imp : undefined);
}

function decodeV11(data: Uint8Array): ScaleReading | null {
  if (data.length !== V11_LENGTH) return null;
  let checksum = 0xca ^ 0x11;
  for (let i = 0; i < 16; i++) checksum ^= data[i];
  if (data[16] !== (checksum & 0xff)) return null;
  const props = data[9];
  const div = divider(props);
  const raw = u16be(data, 3, 4);
  switch ((props >> 3) & 3) {
    case 0:
      return reading(raw / div, true, 'kg', undefined);
    case 1:
      return reading(raw / (div * 2), true, 'jin', undefined);
    case 2:
      return reading(raw / div / 2.204623, true, 'lb', undefined);
    default:
      return reading((raw >> 8) * 6.350293 + ((raw & 0xff) / div) * 0.453592, true, 'st', undefined);
  }
}

function decodeVF0(data: Uint8Array): ScaleReading | null {
  if (data.length < 4) return null;
  return reading(u16be(data, 3, 2) / 10, true, 'kg', undefined);
}

function decodeC0(data: Uint8Array): ScaleReading | null {
  if (data.length < 13) return null;
  const attrib = data[6];
  const stable = (attrib & 0x01) !== 0;
  const div = divider(attrib);
  const raw = u16be(data, 0, 1);
  const imp = u16be(data, 2, 3) / 10;
  let kg: number;
  let unit: WeightUnit;
  switch ((attrib >> 3) & 3) {
    case 0:
      kg = raw / div;
      unit = 'kg';
      break;
    case 1:
      kg = raw / div / 2;
      unit = 'jin';
      break;
    case 2:
      kg = (raw / div) * KG_PER_LB;
      unit = 'lb';
      break;
    default:
      kg = data[0] * 6.350293 + (data[1] / div) * 0.453592;
      unit = 'st';
  }
  return reading(kg, stable, unit, stable ? imp : undefined);
}

/** Decodes the first usable OKOK record of an advertisement, in openScale's order (V20, V11, VF0, C0). Never throws. */
export function decodeOkok(frame: AdFrame): OkokFrame | null {
  try {
    const v20 = payloadOf(frame, COMPANY_V20);
    if (v20) {
      const r = decodeV20(v20);
      if (r) return { variant: 'V20', reading: r };
    }
    const v11 = payloadOf(frame, COMPANY_V11);
    if (v11) {
      const r = decodeV11(v11);
      if (r) return { variant: 'V11', reading: r };
    }
    const vf0 = payloadOf(frame, COMPANY_VF0);
    if (vf0) {
      const r = decodeVF0(vf0);
      if (r) return { variant: 'VF0', reading: r };
    }
    const c0Key = firstC0Key(frame);
    if (c0Key != null) {
      const c0 = payloadOf(frame, c0Key);
      if (c0) {
        const r = decodeC0(c0);
        if (r) return { variant: 'C0', reading: r };
      }
    }
  } catch {
    return null;
  }
  return null;
}

export const okokProtocol: BroadcastProtocol = {
  kind: 'broadcast',
  id: 'okok-chipsea-broadcast',
  label: 'OKOK / Chipsea (broadcast)', // i18n-ok scale model name
  brands: ['OKOK International', 'Chipsea', 'Yoda'],
  source: ['scales/OkOkHandler.kt', 'libs/OkOkV2Lib.kt'],
  matches(frame) {
    return nameMatches(frame) && hasOkokRecord(frame);
  },
  decode(frame) {
    return decodeOkok(frame)?.reading ?? null;
  },
};
