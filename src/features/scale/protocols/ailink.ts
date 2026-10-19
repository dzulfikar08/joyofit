/**
 * AiLink / eLink broadcast body-fat scales (vendor app `com.pingwang.elink`, advertised as "EL1"). Non-connectable: the whole
 * measurement repeats inside an encrypted manufacturer record, service 0xF0A0.
 *
 * Ported from openScale `scales/AiLinkBroadcastHandler.kt` and `libs/AiLinkLib.kt` (https://github.com/oliexdev/openScale),
 * Copyright (C) olie.xdev / openScale contributors, GPL-3.0-or-later. The cipher (32-round TEA over the first 8 payload bytes,
 * key derived from the CID/VID/PID ids) is documented in open source there, so it is ported as is. Vectors in ailink.test.ts come
 * from openScale tests `libs/AiLinkLibTest.kt` and `scales/AiLinkBroadcastHandlerTest.kt` (synthetic frames built with the real
 * cipher by openScale's author, not real health data).
 *
 * Record (after the "company id", which is really VID << 8 | CID): [0] PID, [1..6] MAC little-endian, [7] checksum (sum of
 * [8..17] & 0xFF over the still-encrypted bytes), [8..17] payload. Decrypted payload: [0] counter, [1] status, [2] flags (bits 1..2
 * decimals, bits 3..5 unit), [3..4] weight BE (bit 7 of [3] = negative), [5..6] impedance BE, [7] algorithm id.
 */
import type { AdFrame, BroadcastProtocol, ScaleReading } from '../types';
import { hexToBytes } from '../../sensors/gatt';

const SERVICE_BROADCAST = 'f0a0';
const RECORD_LENGTH = 18;
const PAYLOAD_OFFSET = 8;
const PAYLOAD_LENGTH = 10;
const STATUS_COMPLETE = 0xff;
const KNOWN_STATUSES = [0x00, 0x01, 0x02, 0x03, 0x04, STATUS_COMPLETE];
const UNIT_KG = 0;
const WEIGHT_MIN_KG = 1;
const WEIGHT_MAX_KG = 300;

export interface AiLinkBroadcast {
  macAddress: string;
  sequence: number;
  status: number;
  weightUnit: number;
  decimals: number;
  isNegative: boolean;
  rawWeight: number;
  /** Null unless the unit is kg (the only unit seen on hardware). */
  weightKg: number | null;
  impedance: number;
  algorithm: number;
}

const DELTA = 0x9e3779b9;
const SUM_INITIAL = 0xc6ef3720;

function fold(id: number): number {
  return id >= 0x10000 ? id - 0xffff : id;
}

export function aiLinkKey(cid: number, vid: number, pid: number): number[] {
  return [
    (fold(pid) + 0x41493000) >>> 0,
    (fold(vid) + 0x4c327900) >>> 0,
    (fold(cid) + 0x31783100) >>> 0,
    0x306c6531,
  ];
}

function readLe32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

function writeLe32(b: Uint8Array, o: number, v: number): void {
  b[o] = v & 0xff;
  b[o + 1] = (v >>> 8) & 0xff;
  b[o + 2] = (v >>> 16) & 0xff;
  b[o + 3] = (v >>> 24) & 0xff;
}

/** TEA-decrypts the first 8 bytes of a copy of `payload`; later bytes pass through untouched. */
export function aiLinkDecrypt(payload: Uint8Array, cid: number, vid: number, pid: number): Uint8Array {
  const out = payload.slice();
  if (out.length < 8) return out;
  const k = aiLinkKey(cid, vid, pid);
  let v0 = readLe32(out, 0);
  let v1 = readLe32(out, 4);
  let sum = SUM_INITIAL;
  for (let i = 0; i < 32; i++) {
    v1 = (v1 - ((((v0 << 4) + k[2]) ^ (v0 + sum) ^ ((v0 >>> 5) + k[3])) >>> 0)) >>> 0;
    v0 = (v0 - ((((v1 << 4) + k[0]) ^ (v1 + sum) ^ ((v1 >>> 5) + k[1])) >>> 0)) >>> 0;
    sum = (sum - DELTA) >>> 0;
  }
  writeLe32(out, 0, v0);
  writeLe32(out, 4, v1);
  return out;
}

/** Decodes one manufacturer record, or null when it is not a well formed AiLink broadcast. `companyId` is the numeric key. */
export function parseAiLink(companyId: number, data: Uint8Array): AiLinkBroadcast | null {
  if (data.length < RECORD_LENGTH) return null;
  const encrypted = data.slice(PAYLOAD_OFFSET, PAYLOAD_OFFSET + PAYLOAD_LENGTH);
  let sum = 0;
  for (const b of encrypted) sum += b;
  if ((sum & 0xff) !== data[7]) return null;
  const p = aiLinkDecrypt(encrypted, companyId & 0xff, (companyId >> 8) & 0xff, data[0]);
  if (!KNOWN_STATUSES.includes(p[1])) return null;
  const unit = (p[2] >> 3) & 7;
  const decimals = (p[2] >> 1) & 3;
  const rawWeight = ((p[3] & 0x7f) << 8) | p[4];
  const mac = Array.from(data.slice(1, 7))
    .reverse()
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(':');
  return {
    macAddress: mac,
    sequence: p[0],
    status: p[1],
    weightUnit: unit,
    decimals,
    isNegative: (p[3] & 0x80) !== 0,
    rawWeight,
    weightKg: unit === UNIT_KG ? rawWeight / 10 ** decimals : null,
    impedance: (p[5] << 8) | p[6],
    algorithm: p[7],
  };
}

function firstFrame(frame: AdFrame): AiLinkBroadcast | null {
  for (const [key, hex] of Object.entries(frame.manufacturerData)) {
    const id = Number.parseInt(key, 16);
    if (!Number.isFinite(id)) continue;
    const parsed = parseAiLink(id, hexToBytes(hex));
    if (parsed) return parsed;
  }
  return null;
}

export const aiLinkProtocol: BroadcastProtocol = {
  kind: 'broadcast',
  id: 'ailink-broadcast',
  label: 'AiLink / eLink (broadcast)', // i18n-ok scale model name
  brands: ['AiLink', 'eLink', 'Pingwang', 'Aicare'],
  source: ['scales/AiLinkBroadcastHandler.kt', 'libs/AiLinkLib.kt'],
  // The name ("EL1") is a meaningless default; the F0A0 service plus a record that checksums and decrypts is the fingerprint.
  matches(frame) {
    return frame.serviceUuids.includes(SERVICE_BROADCAST) && firstFrame(frame) != null;
  },
  decode(frame): ScaleReading | null {
    const f = firstFrame(frame);
    if (f == null || f.isNegative || f.rawWeight === 0 || f.weightKg == null) return null;
    if (f.weightKg < WEIGHT_MIN_KG || f.weightKg > WEIGHT_MAX_KG) return null;
    const complete = f.status === STATUS_COMPLETE;
    const reading: ScaleReading = { weightKg: Math.round(f.weightKg * 100) / 100, stable: complete, unit: 'kg' };
    // Impedance is stale until the scale's BIA pass finishes, and 0 means the pass failed.
    if (complete && f.impedance > 0) reading.impedanceOhm = f.impedance;
    return reading;
  },
};
