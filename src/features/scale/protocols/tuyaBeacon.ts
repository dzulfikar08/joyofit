/**
 * Tuya BLE beacon scales (HAN RIVER HRTZC01, product `bbrs03yc`, and other Tuya "tzc1" body scales that advertise instead of connecting).
 * WEIGHT ONLY: what the vendor app shows as body fat is computed from the profile, and every byte of the frame past the weight is constant
 * (checked over weigh-ins from 2.5 to 108.6 kg), so no impedance or body value is read or shown.
 *
 * Not from openScale: reverse engineered by the owner of the scale and verified against it (display locked at 108.6 kg, the Tuya cloud's own
 * `broadcast_data` DP byte for byte the same value). Vectors in tuyaBeacon.test.ts are that scale's recorded frames re-encrypted under a fake key (its own local key stays out of the repo).
 *
 * Manufacturer data under company id 0xD007 (bytes `07 d0` on the air), 27 bytes after the company id:
 *   head[1] = 0x05 | mac[6] | sn[4 BE] | enc[16]
 * `head` 0x01 frames (sn 0..2, repeated about 3 times a second while the scale is awake) do not decrypt with the local key and carry no
 * reading; they only tell that the scale is around. `enc` is one XXTEA block (big endian u32 words, delta 0x9E3779B9, 19 rounds) under the 16
 * ASCII characters of the device's Tuya `local_key` (not hex decoded, not hashed). Plaintext:
 *   sn[4 BE] | dp_id | dp_type | dp_len | value[dp_len] | crc8 | 00        (crc8: poly 0x07, init 0, over everything before it)
 * The scale sends dp 1, type 0 (raw), 7 bytes; `u16be(value[0..2]) / 10` is the weight in kg. The echoed sn and the CRC make a wrong key
 * or a damaged frame reject itself.
 *
 * There is no stable flag: the weight follows the person while they settle (107.9, 107.9, 107.5, 108.6, ...) and the scale then sends the same
 * value again with a higher sn. So a frame is settled when the previous frame (lower sn) carried the same weight.
 */
import { hexToBytes } from '../../sensors/gatt';
import type { AdFrame, BroadcastProtocol, ScaleReading } from '../types';

const COMPANY_KEY = 'd007';
const HEAD_READING = 0x05;
/** Idle frames of the same scale; they identify it for the picker but never carry a weight. */
const HEAD_IDLE = 0x01;
const BEACON_LEN = 27;
const DELTA = 0x9e3779b9;
/** XXTEA rounds for a 4 word block: 6 + 52 / 4. */
const ROUNDS = 19;
const KEY_LEN = 16;
const DP_BROADCAST = 1;
const DP_RAW = 0;
const VALUE_LEN = 7;
/**
 * Frames of one weigh-in are never further apart than this; a longer silence starts a new weigh-in. The recorded sn steps of the owner's
 * weigh-in were 37, 19, 71, 58 and 17 s apart (first sight of each sn), so the longest wait seen is 71 s; 2 minutes covers it and equals
 * the gate's own "same weight again is not a new weigh-in" window.
 */
const SESSION_GAP_MS = 2 * 60 * 1000;
/** A settled weight within this of the weigh-in's earlier settled weight is the same person settling further, so it replaces that value. */
const REVISION_MAX_TENTHS = 30;
const WEIGHT_MIN_KG = 0.5;

/** 16 printable ASCII characters (a Tuya local_key is 16 letters and digits); surrounding whitespace from a paste is ignored. */
const LOCAL_KEY = /^[\x20-\x7e]{16}$/;

/** The key to keep, or null when the text is not a local key. */
export function parseLocalKey(text: string): string | null {
  const trimmed = text.trim();
  return LOCAL_KEY.test(trimmed) ? trimmed : null;
}

function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function words(bytes: Uint8Array): Uint32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Uint32Array.of(view.getUint32(0), view.getUint32(4), view.getUint32(8), view.getUint32(12));
}

function wordsToBytes(v: Uint32Array): Uint8Array {
  const out = new Uint8Array(16);
  const view = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) view.setUint32(i * 4, v[i]);
  return out;
}

/** Mixing function of XXTEA; every sum is taken modulo 2^32 by the `^` / `>>> 0` that follows. */
const mix = (z: number, y: number, s: number, keyWord: number): number =>
  (((z >>> 5) ^ (y << 2)) + ((y >>> 3) ^ (z << 4))) ^ ((s ^ y) + (keyWord ^ z));

/** XXTEA decryption of one 16 byte block under a 16 byte key (big endian words). */
export function xxteaDecrypt(block: Uint8Array, key: Uint8Array): Uint8Array {
  if (block.length !== 16 || key.length !== 16) throw new Error('block and key must be 16 bytes');
  const k = words(key);
  const v = words(block);
  let s = Math.imul(ROUNDS, DELTA) >>> 0;
  let y = v[0];
  while (s !== 0) {
    const e = (s >>> 2) & 3;
    for (let p = 3; p >= 0; p--) {
      const z = v[(p + 3) & 3];
      v[p] = (v[p] - mix(z, y, s, k[(p & 3) ^ e])) >>> 0;
      y = v[p];
    }
    s = (s - DELTA) >>> 0;
  }
  return wordsToBytes(v);
}

/** XXTEA encryption (the inverse; the scale does this, tests use it to build frames). */
export function xxteaEncrypt(block: Uint8Array, key: Uint8Array): Uint8Array {
  if (block.length !== 16 || key.length !== 16) throw new Error('block and key must be 16 bytes');
  const k = words(key);
  const v = words(block);
  let s = 0;
  let z = v[3];
  for (let round = 0; round < ROUNDS; round++) {
    s = (s + DELTA) >>> 0;
    const e = (s >>> 2) & 3;
    for (let p = 0; p < 4; p++) {
      const y = v[(p + 1) & 3];
      v[p] = (v[p] + mix(z, y, s, k[(p & 3) ^ e])) >>> 0;
      z = v[p];
    }
  }
  return wordsToBytes(v);
}

/** CRC-8, polynomial 0x07, initial value 0, no reflection. */
export function crc8(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

export interface TuyaBeacon {
  mac: string;
  sn: number;
  /** The 7 byte `broadcast_data` value. */
  value: Uint8Array;
}

interface Dp {
  id: number;
  type: number;
  value: Uint8Array;
}

/** Walks `dp_id | dp_type | len | value` after the sn; returns the DPs and the offset where the CRC byte must sit. */
function walkDps(plain: Uint8Array): { dps: Dp[]; crcAt: number | null } {
  const dps: Dp[] = [];
  let i = 4;
  while (i + 3 <= 15) {
    const len = plain[i + 2];
    if (i + 3 + len > 14) break;
    dps.push({ id: plain[i], type: plain[i + 1], value: plain.slice(i + 3, i + 3 + len) });
    i += 3 + len;
    if (i + 2 >= 16 || crc8(plain.subarray(0, i)) === plain[i]) return { dps, crcAt: i };
  }
  return { dps, crcAt: i < 16 ? i : null };
}

/**
 * Decrypts one reading beacon. Null for anything that is not one: too short, another head, the wrong key (the echoed sn or the CRC
 * differ), or a payload that is not the scale's `broadcast_data` DP.
 */
export function parseTuyaBeacon(data: Uint8Array, key: Uint8Array): TuyaBeacon | null {
  if (data.length < BEACON_LEN || data[0] !== HEAD_READING || key.length !== KEY_LEN) return null;
  const sn = new DataView(data.buffer, data.byteOffset + 7, 4).getUint32(0);
  const plain = xxteaDecrypt(data.subarray(11, 27), key);
  if (new DataView(plain.buffer).getUint32(0) !== sn) return null;
  const { dps, crcAt } = walkDps(plain);
  if (crcAt === null || plain[crcAt] !== crc8(plain.subarray(0, crcAt))) return null;
  const dp = dps.find((d) => d.id === DP_BROADCAST && d.type === DP_RAW && d.value.length === VALUE_LEN);
  const mac = [...data.subarray(1, 7)].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
  return dp ? { mac, sn, value: dp.value } : null;
}

/** Weight in tenths of a kilogram from the 7 byte value. */
export const weightTenths = (value: Uint8Array): number => (value[0] << 8) | value[1];

function payloadOf(frame: AdFrame): Uint8Array | null {
  const hex = frame.manufacturerData[COMPANY_KEY];
  return hex === undefined ? null : hexToBytes(hex);
}

interface Seen {
  sn: number;
  tenths: number;
  settled: boolean;
  /** Settled again within the same weigh-in at a different weight: the earlier settled value was only provisional. */
  revision: boolean;
  at: number;
}

/**
 * The decoder of one scale: the key, and the last frame it saw. The same advertisement arrives many times; it keeps its verdict.
 *  - A higher sn with the same weight as the frame before settles it.
 *  - Frames less than `SESSION_GAP_MS` apart are one weigh-in. The scale can sit on one value for two frames before the person has finished
 *    settling (107.9, 107.9, then 107.5, 108.6, 108.6), so when the weigh-in settles again at another weight (within `REVISION_MAX_TENTHS`)
 *    that reading is marked `revision`: it replaces what the first settled value saved instead of adding a second row.
 *  - A lower sn (the scale restarted its counter) or a longer silence starts a new weigh-in.
 */
function createDecoder(localKey: string): (frame: AdFrame) => ScaleReading | null {
  const key = asciiBytes(parseLocalKey(localKey) ?? localKey);
  let last: Seen | null = null;
  /** The weight (tenths) this weigh-in already delivered as settled. */
  let delivered: number | null = null;
  return (frame) => {
    const data = payloadOf(frame);
    if (!data) return null;
    const beacon = parseTuyaBeacon(data, key);
    if (!beacon) return null;
    const tenths = weightTenths(beacon.value);
    if (tenths / 10 < WEIGHT_MIN_KG) return null;
    if (last && beacon.sn === last.sn && tenths === last.tenths) {
      last.at = frame.ts;
    } else {
      const sameWeighIn = last !== null && beacon.sn > last.sn && frame.ts - last.at <= SESSION_GAP_MS;
      if (!sameWeighIn) delivered = null;
      const settled = sameWeighIn && last?.tenths === tenths;
      const revision = settled && delivered !== null && delivered !== tenths && Math.abs(delivered - tenths) <= REVISION_MAX_TENTHS;
      if (settled) delivered = tenths;
      last = { sn: beacon.sn, tenths, settled, revision, at: frame.ts };
    }
    return { weightKg: tenths / 10, stable: last.settled, ...(last.revision ? { revision: true as const } : {}) };
  };
}

export const tuyaBeaconProtocol: BroadcastProtocol = {
  kind: 'broadcast',
  id: 'tuya-beacon-broadcast',
  label: 'Tuya beacon', // i18n-ok scale model name
  brands: ['HAN RIVER HRTZC01', 'Tuya Smart', 'Smart Life'],
  source: [],
  weightOnly: true,
  realScaleTested: true,
  secret: { kind: 'tuya-local-key', fields: [{ id: 'key', maxLength: 64, length: 16 }], parse: (values) => parseLocalKey(values.key ?? '') },
  matches(frame) {
    const data = payloadOf(frame);
    return data !== null && data.length >= BEACON_LEN && (data[0] === HEAD_READING || data[0] === HEAD_IDLE);
  },
  /** Without the scale's local key nothing can be read. */
  decode: () => null,
  createDecoder,
};
