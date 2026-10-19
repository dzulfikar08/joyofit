/**
 * AAA002 / AAA007 / AAA013 / AAA07A broadcast scales (Posture FG220LB and others, Fitdays app): weight in manufacturer data,
 * obfuscated with an XOR mask taken from the company id high byte plus a 5 bit checksum.
 *
 * Ported from openScale `scales/AAAxHandler.kt` (https://github.com/oliexdev/openScale), Copyright (C) olie.xdev,
 * GPL-3.0-or-later. Vectors in aaax.test.ts come from openScale's test `scales/AAAxHandlerTest.kt` (company id 0xA0AC, address
 * C0:FF:EE:12:34:56; synthetic weights in the captured layout).
 *
 * Record (>= 12 bytes): [0..5] advertiser MAC reversed, [6..11] payload XOR (companyId >> 8). Payload: [0..3] big endian
 * `state:1 | reserved:13 | grams:18` (state 1 = final), [4] type (0xAD weight, 0xA6 impedance), [5] checksum, low 5 bits of the
 * sum of [0..4].
 */
import type { AdFrame, BroadcastProtocol, ScaleReading } from '../types';
import { hexToBytes } from '../../sensors/gatt';

const KNOWN_NAMES = ['AAA002', 'AAA007', 'AAA013', 'AAA07A'];
const MAC_PATTERN = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i;

/** Deobfuscates bytes 6..11; null when too short or the checksum fails. */
export function decodeAaaxPayload(companyId: number, data: Uint8Array): Uint8Array | null {
  if (data.length < 12) return null;
  const key = (companyId >> 8) & 0xff;
  const payload = new Uint8Array(6);
  for (let i = 0; i < 6; i++) payload[i] = data[6 + i] ^ key;
  let sum = 0;
  for (let i = 0; i < 5; i++) sum += payload[i];
  return (sum & 0x1f) === (payload[5] & 0x1f) ? payload : null;
}

/** True if bytes 0..5 are `address` ("AA:BB:CC:DD:EE:FF") in reverse byte order. */
function echoesAddress(data: Uint8Array, address: string): boolean {
  if (!MAC_PATTERN.test(address) || data.length < 6) return false;
  const mac = address.split(':').map((h) => Number.parseInt(h, 16));
  return mac.every((b, i) => data[5 - i] === b);
}

function records(frame: AdFrame): { id: number; data: Uint8Array }[] {
  return Object.entries(frame.manufacturerData)
    .map(([key, hex]) => ({ id: Number.parseInt(key, 16), data: hexToBytes(hex) }))
    .filter((r) => Number.isFinite(r.id));
}

export const aaaxProtocol: BroadcastProtocol = {
  kind: 'broadcast',
  id: 'aaax-broadcast',
  label: 'AAA-series (broadcast)', // i18n-ok scale model name
  brands: ['Fitdays', 'Posture FG220LB', 'AAA002', 'AAA007', 'AAA013', 'AAA07A'],
  source: ['scales/AAAxHandler.kt'],
  matches(frame) {
    if (KNOWN_NAMES.includes((frame.name ?? '').trim())) return true;
    // Other names: the frame has to echo the advertiser's MAC (Android only; iOS ids are not MAC addresses) and checksum.
    return records(frame).some((r) => echoesAddress(r.data, frame.id) && decodeAaaxPayload(r.id, r.data) != null);
  },
  decode(frame): ScaleReading | null {
    const macKnown = MAC_PATTERN.test(frame.id);
    for (const r of records(frame)) {
      if (macKnown && !KNOWN_NAMES.includes((frame.name ?? '').trim()) && !echoesAddress(r.data, frame.id)) continue;
      const p = decodeAaaxPayload(r.id, r.data);
      // 0xA6 (impedance) frames are known but not implemented by openScale either.
      if (p == null || p[4] !== 0xad) continue;
      const value = ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
      const grams = value & 0x3ffff;
      if (grams === 0) continue;
      return { weightKg: Math.round(grams / 10) / 100, stable: value >>> 31 === 1 };
    }
    return null;
  },
};
