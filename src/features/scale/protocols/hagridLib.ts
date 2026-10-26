/**
 * Huawei Hagrid WSP: the framing, CRCs, authentication handshake and payload layouts of the HUAWEI Scale 2 Pro, Scale 3 and Scale 3 Pro
 * (and HONOR Scale 2) on their vendor characteristics under 181C / 1805 / 181B. The session that drives it is `huaweiHagrid.ts`.
 *
 * Derived from openScale (oliexdev/openScale, GPL-3.0-or-later),
 * android_app/app/src/main/java/com/health/openscale/core/bluetooth/libs/HuaweiHagridWspLib.kt at
 * 87edad4813e400cd4871109fc72a0bcf4d13f336. Copyright (C) 2026 openScale contributors. Modified for JoyoFit: TypeScript, local times
 * converted with the phone's UTC offset, the capability-bit helper (advertisement text only) left out.
 * Test material: openScale libs/HuaweiHagridWspLibTest.kt and scales/HuaweiHagridWspHandlerTest.kt (`hagridLib.test.ts`).
 *
 * The keys CAK, C1 and C2 come from the person who owns the scale, like in openScale. Nothing here contains them, derives them from
 * anything else, or says where they come from. Crypto: AES-128-CTR, SHA-256 and HMAC-SHA256 from @noble/ciphers and @noble/hashes
 * (pure JS, so this ships over the air).
 */
import { ctr } from '@noble/ciphers/aes.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

export const FRAME_WRITE_PLAIN = 0xdb;
export const FRAME_WRITE_ENCRYPTED = 0xdc;
export const FRAME_NOTIFY_PLAIN = 0xbd;
export const FRAME_NOTIFY_ENCRYPTED = 0xcd;

const MAX_SIMPLE_PAYLOAD_BYTES = 240;
const SIMPLE_CHUNK_BYTES = 15;
const USER_INFO_PAYLOAD_BYTES = 69;
const MANAGER_HUID_BYTES = 30;
const MANAGER_DEVICE_ID_BYTES = 40;
const AUTH_TOKEN_SUFFIX_TO_SCALE = Uint8Array.from([0x31, 0x31, 0x32, 0x33]); // "1123"
const AUTH_TOKEN_SUFFIX_FROM_SCALE = Uint8Array.from([0x39, 0x38, 0x35, 0x36]); // "9856"

export const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const u16le = (d: Uint8Array, at: number): number => d[at] | (d[at + 1] << 8);
const u16leOrNull = (d: Uint8Array, at: number): number | null => (at + 1 < d.length ? u16le(d, at) : null);
const u8OrNull = (d: Uint8Array, at: number): number | null => (at < d.length ? d[at] : null);
const putU16le = (d: Uint8Array, at: number, value: number): void => {
  d[at] = value & 0xff;
  d[at + 1] = (value >>> 8) & 0xff;
};
const upperHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** CRC-16 of the frames the phone writes: polynomial 0x1021, initial 0, not reflected (openScale `crc16`, a table of the same polynomial). */
export function crc16(data: Uint8Array): number {
  let crc = 0;
  for (const b of data) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/** CRC-16/MODBUS of the frames the scale sends. */
export function crc16Modbus(data: Uint8Array): number {
  let crc = 0xffff;
  for (const b of data) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc & 0xffff;
}

/**
 * A message as the phone writes it: chunks of at most 15 bytes, each `prefix | len+3 | (total-1)<<4 | index | chunk | crc16 LE`, the CRC
 * taken over the whole frame with the CRC bytes zero (20 bytes at
 * most, so no MTU negotiation is needed). An empty message is one frame with no chunk.
 */
export function buildWriteFrames(payload: Uint8Array, encrypted = false): Uint8Array[] {
  if (payload.length > MAX_SIMPLE_PAYLOAD_BYTES) throw new Error(`WSP payloads over ${MAX_SIMPLE_PAYLOAD_BYTES} bytes are not implemented`);
  const total = Math.max(1, Math.ceil(payload.length / SIMPLE_CHUNK_BYTES));
  const frames: Uint8Array[] = [];
  let offset = 0;
  for (let index = 0; index < total; index++) {
    const chunkLen = Math.max(0, Math.min(SIMPLE_CHUNK_BYTES, payload.length - offset));
    const frame = new Uint8Array(chunkLen + 5);
    frame[0] = encrypted ? FRAME_WRITE_ENCRYPTED : FRAME_WRITE_PLAIN;
    frame[1] = chunkLen + 3;
    frame[2] = (((total - 1) & 0x0f) << 4) | (index & 0x0f);
    frame.set(payload.subarray(offset, offset + chunkLen), 3);
    offset += chunkLen;
    // Over the whole frame with its two CRC bytes still zero (openScale `putCrc`).
    const crc = crc16(frame);
    frame[frame.length - 2] = crc & 0xff;
    frame[frame.length - 1] = crc >>> 8;
    frames.push(frame);
  }
  return frames;
}

export interface WspFrame {
  encrypted: boolean;
  totalFrames: number;
  frameIndex: number;
  payload: Uint8Array;
  crcValid: boolean;
}

export const hasNotificationFramePrefix = (frame: Uint8Array): boolean =>
  frame.length > 0 && (frame[0] === FRAME_NOTIFY_PLAIN || frame[0] === FRAME_NOTIFY_ENCRYPTED);

export function hasValidNotificationCrc(frame: Uint8Array): boolean {
  if (frame.length < 5) return false;
  return crc16Modbus(frame.subarray(0, frame.length - 2)) === u16le(frame, frame.length - 2);
}

/** One notification frame `BD|CD | len+3 | (total-1)<<4 | index | chunk | crc16/modbus LE`, or null when it is not one. */
export function parseNotificationFrame(frame: Uint8Array, requireValidCrc = true): WspFrame | null {
  if (frame.length < 5 || !hasNotificationFramePrefix(frame)) return null;
  const crcValid = hasValidNotificationCrc(frame);
  if (requireValidCrc && !crcValid) return null;
  const payloadLen = frame[1] - 3;
  if (payloadLen < 0 || frame.length < payloadLen + 5) return null;
  const totalFrames = ((frame[2] >>> 4) & 0x0f) + 1;
  const frameIndex = frame[2] & 0x0f;
  if (frameIndex >= totalFrames) return null;
  return { encrypted: frame[0] === FRAME_NOTIFY_ENCRYPTED, totalFrames, frameIndex, payload: frame.slice(3, 3 + payloadLen), crcValid };
}

/** Reassembles the notification frames of one characteristic into messages. */
export class FrameAccumulator {
  private expectedFrames = 0;
  private encrypted = false;
  private chunks = new Map<number, Uint8Array>();
  /** Whether the last message `ingest` returned was encrypted. */
  lastCompletedEncrypted = false;

  constructor(private readonly requireValidCrc = true) {}

  ingest(rawFrame: Uint8Array): Uint8Array | null {
    const frame = parseNotificationFrame(rawFrame, this.requireValidCrc);
    if (!frame) return null;
    if (frame.totalFrames <= 1) {
      this.lastCompletedEncrypted = frame.encrypted;
      this.reset();
      return frame.payload;
    }
    if (frame.frameIndex === 0) {
      // Index 0 always starts a new message.
      this.reset();
      this.expectedFrames = frame.totalFrames;
      this.encrypted = frame.encrypted;
    } else {
      // An orphan continuation before any start is dropped; a change of shape mid-message drops the partial one.
      if (this.expectedFrames === 0) return null;
      if (this.expectedFrames !== frame.totalFrames || this.encrypted !== frame.encrypted) {
        this.reset();
        return null;
      }
    }
    this.chunks.set(frame.frameIndex, frame.payload);
    if (this.chunks.size < this.expectedFrames) return null;
    const parts: Uint8Array[] = [];
    for (let i = 0; i < this.expectedFrames; i++) {
      const chunk = this.chunks.get(i);
      if (!chunk) {
        this.reset();
        return null;
      }
      parts.push(chunk);
    }
    this.lastCompletedEncrypted = this.encrypted;
    this.reset();
    return concat(...parts);
  }

  reset(): void {
    this.expectedFrames = 0;
    this.encrypted = false;
    this.chunks.clear();
  }
}

function authToken(randA: Uint8Array, randB: Uint8Array, cak: Uint8Array, suffix: Uint8Array): Uint8Array {
  const rand = concat(randA, randB);
  const inner = hmac(sha256, concat(cak, suffix), rand);
  return hmac(sha256, inner, rand);
}

function require16(name: string, value: Uint8Array): void {
  if (value.length !== 16) throw new Error(`${name} must be 16 bytes`);
}

/** What the phone writes to the auth-token characteristic: `randB | HMAC(rand, HMAC(rand, CAK|"1123"))`, 48 bytes. */
export function buildAuthTokenPayload(randA: Uint8Array, randB: Uint8Array, cak: Uint8Array): Uint8Array {
  require16('randA', randA);
  require16('randB', randB);
  require16('CAK', cak);
  return concat(randB, authToken(randA, randB, cak, AUTH_TOKEN_SUFFIX_TO_SCALE));
}

/** What a scale that knows the same CAK answers: `HMAC(rand, HMAC(rand, CAK|"9856"))`, 32 bytes. */
export function expectedAuthResponsePayload(randA: Uint8Array, randB: Uint8Array, cak: Uint8Array): Uint8Array {
  require16('randA', randA);
  require16('randB', randB);
  require16('CAK', cak);
  return authToken(randA, randB, cak, AUTH_TOKEN_SUFFIX_FROM_SCALE);
}

/** Some firmwares append a status byte after the answer, so only the first 32 bytes are compared. */
export function isValidAuthResponsePayload(response: Uint8Array, randA: Uint8Array, randB: Uint8Array, cak: Uint8Array): boolean {
  const expected = expectedAuthResponsePayload(randA, randB, cak);
  return response.length >= expected.length && expected.every((v, i) => v === response[i]);
}

/** `AA:BB:CC:DD:EE:FF` / `aabbccddeeff` / `AA-BB-...`: the 12 hex digits in upper case, or null. */
export function compactBluetoothAddress(address: string): string | null {
  const compact = address.trim().replace(/[:-]/g, '').toUpperCase();
  return /^[0-9A-F]{12}$/.test(compact) ? compact : null;
}

/** C3, the per-scale part of the root key: the ASCII of the scale's 12 address digits in upper case followed by "0000". */
export function c3FromBluetoothAddress(address: string): Uint8Array {
  const compact = compactBluetoothAddress(address);
  if (!compact) throw new Error('Bluetooth address must contain 12 hex digits');
  return new TextEncoder().encode(`${compact}0000`);
}

const sha256First16 = (data: Uint8Array): Uint8Array => sha256(data).slice(0, 16);

/** Root key = SHA-256/16 of `(SHA-256/16 of (C1 << 4 ^ C2)) >> 6 ^ C3`, byte by byte. */
export function deriveRootKey(c1: Uint8Array, c2: Uint8Array, c3: Uint8Array): Uint8Array {
  if (c1.length !== c2.length || c1.length === 0 || c3.length !== c1.length) throw new Error('C1, C2 and C3 must have the same, non-zero length');
  const mixed = c1.map((v, i) => ((v << 4) ^ c2[i]) & 0xff);
  const keyData = sha256First16(mixed);
  const folded = keyData.map((v, i) => (v >>> 6) ^ c3[i]);
  return sha256First16(folded);
}

/** AES-128-CTR; the same call encrypts and decrypts. */
export function aesCtr(input: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array {
  require16('AES-CTR key', key);
  require16('AES-CTR IV', iv);
  return ctr(key, iv).encrypt(input);
}

/** An encrypted message: `iv | AES-CTR(plaintext)`. */
export const encryptedPayloadWithIv = (plaintext: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array =>
  concat(iv, aesCtr(plaintext, key, iv));

export function decryptPayload(ciphertextWithIv: Uint8Array, key: Uint8Array): Uint8Array {
  if (ciphertextWithIv.length < 16) throw new Error('an encrypted payload starts with a 16-byte IV');
  return aesCtr(ciphertextWithIv.subarray(16), key, ciphertextWithIv.subarray(0, 16));
}

export const buildEncryptedWriteFrames = (plaintext: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array[] =>
  buildWriteFrames(encryptedPayloadWithIv(plaintext, key, iv), true);

export interface HagridUserInfo {
  huid: string;
  uid: string;
  gender: number;
  ageYears: number;
  heightCm: number;
  weightKg: number;
  userType?: number;
}

function copyUtf8Fixed(value: string, target: Uint8Array, offset: number, length: number): void {
  const bytes = new TextEncoder().encode(value);
  target.set(bytes.subarray(0, Math.min(bytes.length, length)), offset);
}

/** Set-user-info plaintext, 69 bytes: huid[30] uid[32] gender age heightCm u16 weight centi-kg u16 userType. */
export function buildUserInfoPayload(info: HagridUserInfo): Uint8Array {
  const payload = new Uint8Array(USER_INFO_PAYLOAD_BYTES);
  copyUtf8Fixed(info.huid, payload, 0, 30);
  copyUtf8Fixed(info.uid, payload, 30, 32);
  payload[62] = clamp(info.gender, 0, 255);
  payload[63] = clamp(info.ageYears, 0, 255);
  putU16le(payload, 64, clamp(info.heightCm, 0, 0xffff));
  const centiKg = Number.isFinite(info.weightKg) && info.weightKg > 0 ? clamp(Math.round(info.weightKg * 100), 0, 0xffff) : 0;
  putU16le(payload, 66, centiKg);
  payload[68] = clamp(info.userType ?? 0, 0, 255);
  return payload;
}

/** The manager-info layout (huid[30] deviceId[40] [len account]); the app only reads it, tests build it. */
export function buildManagerInfoPayload(huid: string, deviceId: string, accountInfo?: string): Uint8Array {
  const account = accountInfo === undefined ? null : new TextEncoder().encode(accountInfo).subarray(0, 255);
  const payload = new Uint8Array(MANAGER_HUID_BYTES + MANAGER_DEVICE_ID_BYTES + (account ? 1 + account.length : 0));
  copyUtf8Fixed(huid, payload, 0, MANAGER_HUID_BYTES);
  copyUtf8Fixed(deviceId, payload, MANAGER_HUID_BYTES, MANAGER_DEVICE_ID_BYTES);
  if (account) {
    payload[MANAGER_HUID_BYTES + MANAGER_DEVICE_ID_BYTES] = account.length;
    payload.set(account, MANAGER_HUID_BYTES + MANAGER_DEVICE_ID_BYTES + 1);
  }
  return payload;
}

/** Text up to the first NUL, trailing NUL / space dropped; non-printable content becomes `hex:<HEX>`. */
function decodeFixedText(bytes: Uint8Array): string {
  const nul = bytes.indexOf(0);
  let end = nul >= 0 ? nul : bytes.length;
  while (end > 0 && (bytes[end - 1] === 0 || bytes[end - 1] === 0x20)) end--;
  const trimmed = bytes.subarray(0, end);
  if (trimmed.length === 0) return '';
  return trimmed.every((c) => c >= 0x20 && c <= 0x7e) ? String.fromCharCode(...trimmed) : `hex:${upperHex(trimmed)}`;
}

export interface HagridManagerInfo {
  huid: string;
  deviceId: string;
  accountInfo: string | null;
  rawLength: number;
}

export function parseManagerInfo(payload: Uint8Array): HagridManagerInfo | null {
  if (payload.length === 0) return { huid: '', deviceId: '', accountInfo: null, rawLength: 0 };
  if (payload.length <= MANAGER_HUID_BYTES) return null;
  const huid = decodeFixedText(payload.subarray(0, MANAGER_HUID_BYTES));
  const extended = payload.length > MANAGER_HUID_BYTES + MANAGER_DEVICE_ID_BYTES;
  const deviceIdEnd = extended ? MANAGER_HUID_BYTES + MANAGER_DEVICE_ID_BYTES : payload.length;
  const deviceId = decodeFixedText(payload.subarray(MANAGER_HUID_BYTES, deviceIdEnd));
  let accountInfo: string | null = null;
  if (extended) {
    const at = MANAGER_HUID_BYTES + MANAGER_DEVICE_ID_BYTES;
    const end = Math.min(payload.length, at + 1 + payload[at]);
    if (end > at + 1) {
      const text = decodeFixedText(payload.subarray(at + 1, end));
      accountInfo = text.trim() === '' ? null : text;
    }
  }
  return { huid, deviceId, accountInfo, rawLength: payload.length };
}

/** A local date and time (`year u16 LE, month, day, hour, minute, second`) as epoch ms, given the phone's minutes east of UTC; null when invalid. */
function readTimestamp(d: Uint8Array, at: number, tzMin: number): number | null {
  if (at + 6 >= d.length) return null;
  const year = u16le(d, at);
  const [month, day, hour, minute, second] = [d[at + 2], d[at + 3], d[at + 4], d[at + 5], d[at + 6]];
  if (year < 2000 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  return Date.UTC(year, month - 1, day, hour, minute, second) - tzMin * 60_000;
}

const massToKg = (raw: number, imperial: boolean): number => (imperial ? raw * 0.01 * 0.45359237 : raw * 0.005);

export interface StandardMeasurement {
  weightKg?: number;
  fatPercent?: number;
  musclePercent?: number;
  bodyWaterMassKg?: number;
  impedanceOhm?: number;
  scaleUserIndex?: number;
  timestamp?: number;
}

/** Bluetooth SIG Weight Measurement (2A9D), when a Hagrid scale sends it unframed. */
export function parseStandardWeightMeasurement(payload: Uint8Array, tzMin = 0): StandardMeasurement | null {
  if (payload.length < 3) return null;
  let at = 0;
  const flags = payload[at++];
  const imperial = (flags & 0x01) !== 0;
  const raw = u16leOrNull(payload, at);
  if (raw === null) return null;
  at += 2;
  const out: StandardMeasurement = { weightKg: massToKg(raw, imperial) };
  if (flags & 0x02) {
    const ts = readTimestamp(payload, at, tzMin);
    if (ts === null) return null;
    out.timestamp = ts;
    at += 7;
  }
  if (flags & 0x04) {
    const user = u8OrNull(payload, at);
    if (user === null) return null;
    out.scaleUserIndex = user;
    at += 1;
  }
  if (flags & 0x08) {
    if (u16leOrNull(payload, at) === null || u16leOrNull(payload, at + 2) === null) return null;
  }
  return out;
}

/** Bluetooth SIG Body Composition Measurement (2A9C), when a Hagrid scale sends it unframed. */
export function parseStandardBodyCompositionMeasurement(payload: Uint8Array, tzMin = 0): StandardMeasurement | null {
  if (payload.length < 4) return null;
  let at = 0;
  const flags = u16le(payload, at);
  at += 2;
  const imperial = (flags & 0x0001) !== 0;
  const fatRaw = u16leOrNull(payload, at);
  if (fatRaw === null) return null;
  at += 2;
  const out: StandardMeasurement = { fatPercent: fatRaw * 0.1 };
  const skip16 = (): boolean => {
    if (u16leOrNull(payload, at) === null) return false;
    at += 2;
    return true;
  };
  if (flags & 0x0002) {
    const ts = readTimestamp(payload, at, tzMin);
    if (ts === null) return null;
    out.timestamp = ts;
    at += 7;
  }
  if (flags & 0x0004) {
    const user = u8OrNull(payload, at);
    if (user === null) return null;
    out.scaleUserIndex = user;
    at += 1;
  }
  if (flags & 0x0008 && !skip16()) return null; // basal metabolism
  if (flags & 0x0010) {
    const raw = u16leOrNull(payload, at);
    if (raw === null) return null;
    out.musclePercent = raw * 0.1;
    at += 2;
  }
  if (flags & 0x0020 && !skip16()) return null; // muscle mass
  if (flags & 0x0040 && !skip16()) return null; // fat free mass
  if (flags & 0x0080 && !skip16()) return null; // soft lean mass
  if (flags & 0x0100) {
    const raw = u16leOrNull(payload, at);
    if (raw === null) return null;
    out.bodyWaterMassKg = massToKg(raw, imperial);
    at += 2;
  }
  if (flags & 0x0200) {
    const raw = u16leOrNull(payload, at);
    if (raw === null) return null;
    out.impedanceOhm = raw * 0.1;
    at += 2;
  }
  if (flags & 0x0400) {
    const raw = u16leOrNull(payload, at);
    if (raw === null) return null;
    out.weightKg = massToKg(raw, imperial);
    at += 2;
  }
  if (flags & 0x0800 && u16leOrNull(payload, at) === null) return null;
  return out;
}

/** openScale's reading of a raw impedance sample: 1..3999 are ohms, 4000..39999 tenths of an ohm, anything else no value. */
export function hagridImpedanceOhm(raw: number): number | null {
  if (raw >= 1 && raw <= 3999) return raw;
  if (raw >= 4000 && raw <= 39999) return raw / 10;
  return null;
}

export interface HagridMeasurement {
  rawLength: number;
  weightKg: number;
  fatPercent: number;
  /** Epoch ms of the scale's local time in bytes 4..10, when valid. */
  timestamp: number | null;
  /** The six low-frequency impedance samples as sent (u16 each), uninterpreted. */
  lowFrequencyImpedance: number[];
  /** The six high-frequency samples (38+ byte payloads only, the Scale 3 Pro), uninterpreted. */
  highFrequencyImpedance: number[];
  heartRateBpm: number | null;
  trailingBytesHex: string | null;
  historySuspectedFlag: number | null;
  historyCompleteFlag: number | null;
}

export const representativeLowOhm = (m: HagridMeasurement): number | null =>
  m.lowFrequencyImpedance.map(hagridImpedanceOhm).find((v) => v !== null) ?? null;

export const representativeHighOhm = (m: HagridMeasurement): number | null =>
  m.highFrequencyImpedance.map(hagridImpedanceOhm).find((v) => v !== null) ?? null;

/** True when the history record says it is the last one (flag 0), null when it carries no flag. */
export const isHistoryComplete = (m: HagridMeasurement): boolean | null => (m.historyCompleteFlag === null ? null : m.historyCompleteFlag === 0);

/** Identifies one history record (time, weight, fat, heart rate, impedances), so a record sent twice is kept once. */
export function historyDedupeKey(m: HagridMeasurement): string | null {
  if (m.timestamp === null) return null;
  return [
    String(m.timestamp),
    String(Math.round(m.weightKg * 100)),
    String(Math.round(m.fatPercent * 10)),
    m.heartRateBpm === null ? '' : String(m.heartRateBpm),
    m.lowFrequencyImpedance.join(','),
    m.highFrequencyImpedance.join(','),
  ].join('|');
}

/**
 * `weight u16 /100 | fat u16 /10 | time[8] | low[6] u16 | heart rate u16 | (high[6] u16) | (history: suspected, complete)`, all little endian.
 * Lengths other than the allowed ones are not a measurement.
 */
function parseMeasurement(payload: Uint8Array, allowed: readonly number[], timestampRequired: boolean, tzMin: number): HagridMeasurement | null {
  if (!allowed.includes(payload.length)) return null;
  const high = payload.length >= 38;
  const baseLength = high ? 38 : 26;
  const timestamp = readTimestamp(payload, 4, tzMin);
  if (timestamp === null && timestampRequired) return null;
  const heartRateRaw = u16le(payload, 24);
  return {
    rawLength: payload.length,
    weightKg: u16le(payload, 0) / 100,
    fatPercent: u16le(payload, 2) / 10,
    timestamp,
    lowFrequencyImpedance: [0, 1, 2, 3, 4, 5].map((i) => u16le(payload, 12 + i * 2)),
    highFrequencyImpedance: high ? [0, 1, 2, 3, 4, 5].map((i) => u16le(payload, 26 + i * 2)) : [],
    heartRateBpm: heartRateRaw >= 1 && heartRateRaw <= 240 ? heartRateRaw : null,
    trailingBytesHex: payload.length > baseLength ? upperHex(payload.subarray(baseLength)) : null,
    historySuspectedFlag: payload.length > baseLength ? payload[baseLength] : null,
    historyCompleteFlag: payload.length > baseLength + 1 ? payload[baseLength + 1] : null,
  };
}

/** Realtime weight (26 or 38 bytes). The time is read when valid, never required: some models send other bytes there while weighing. */
export const parseRealtimeMeasurement = (payload: Uint8Array, tzMin = 0): HagridMeasurement | null =>
  parseMeasurement(payload, [26, 38], false, tzMin);

/** History record (27, 28, 39 or 40 bytes); a record without a valid time is rejected. */
export const parseHistoryMeasurement = (payload: Uint8Array, tzMin = 0): HagridMeasurement | null =>
  parseMeasurement(payload, [27, 28, 39, 40], true, tzMin);

/** Firmware version from the scale-version answer: bits of bytes 1..3 as major.minor.patch.build, then a text. */
export function parseScaleVersion(payload: Uint8Array): { version: string; serialOrDataInfo: string; rawLength: number } | null {
  if (payload.length < 5 || payload.length > 20) return null;
  const bits = (payload[1] << 16) | (payload[2] << 8) | payload[3];
  const major = (bits >>> 20) & 0x0f;
  const minor = (bits >>> 16) & 0x0f;
  const patch = (bits >>> 12) & 0x0f;
  const build = (bits >>> 2) & 0x3ff;
  return { version: `${major}.${minor}.${patch}.${build}`, serialOrDataInfo: decodeFixedText(payload.subarray(4)), rawLength: payload.length };
}

export function parseWeightUnit(payload: Uint8Array): { raw: number; parsed: number; label: string } | null {
  if (payload.length === 0) return null;
  const raw = payload[0];
  // openScale reads the byte's hex digits as a decimal number (0x01 -> 1, 0x1a -> 26 as it is not one).
  const digits = raw.toString(16);
  const value = /^\d+$/.test(digits) ? Number(digits) : raw;
  const label = value === 1 ? 'kg' : value === 2 ? 'lb' : value === 3 ? 'g' : 'unknown';
  return { raw, parsed: value, label };
}

export function parseProductInfo(payload: Uint8Array): { rawText: string; smartProductId: string; variant: string } | null {
  if (payload.length === 0) return null;
  const text = decodeFixedText(payload);
  if (text.trim() === '' || text.startsWith('hex:')) return null;
  return { rawText: text, smartProductId: text.slice(0, 4), variant: text.slice(4) };
}

export type HagridFamily = 'scale-2-pro' | 'scale-3-pro' | 'scale-3' | 'honor-scale-2' | 'dobby' | 'unknown';

export interface HagridProductProfile {
  family: HagridFamily;
  displayName: string;
  smartProductId: string | null;
  expectedHighFrequencyImpedance: boolean | null;
}

/** The model a name or product id stands for. */
export function productProfileForMarker(marker: string | null): HagridProductProfile {
  const m = (marker ?? '').trim().toUpperCase();
  switch (m) {
    case '007B':
    case 'HAG-B19':
    case 'HAGRID-B19':
    case 'HUAWEI SCALE 2 PRO':
      return { family: 'scale-2-pro', displayName: 'HUAWEI Scale 2 Pro', smartProductId: '007B', expectedHighFrequencyImpedance: false };
    case 'M00F':
    case 'HAGRID-B29':
    case 'HAGRID2021-B19':
    case 'HUAWEI SCALE 3 PRO':
      return { family: 'scale-3-pro', displayName: 'HUAWEI Scale 3 Pro', smartProductId: 'M00F', expectedHighFrequencyImpedance: true };
    case 'M00D':
    case 'HEM-B19':
    case 'HERM-B19':
    case 'HUAWEI SCALE 3':
      return { family: 'scale-3', displayName: 'HUAWEI Scale 3', smartProductId: 'M00D', expectedHighFrequencyImpedance: false };
    case 'N001':
    case 'LUP-B19':
    case 'LUPIN-B19HN':
      return { family: 'honor-scale-2', displayName: 'HONOR Scale 2', smartProductId: 'N001', expectedHighFrequencyImpedance: false };
    case 'M0CJ':
    case 'DOBBY-B19':
      return { family: 'dobby', displayName: 'Huawei/Honor WSP Scale', smartProductId: 'M0CJ', expectedHighFrequencyImpedance: null };
    default:
      return { family: 'unknown', displayName: 'Huawei/Honor WSP Scale', smartProductId: m === '' ? null : m, expectedHighFrequencyImpedance: null };
  }
}

/** Searched in this order (a "HUAWEI SCALE 3 PRO" name must not stop at "HUAWEI SCALE 3"). */
export const PRODUCT_MARKERS = [
  'HUAWEI SCALE 2 PRO',
  'HAG-B19',
  'HAGRID-B19',
  'HUAWEI SCALE 3 PRO',
  'HAGRID-B29',
  'HAGRID2021-B19',
  'HUAWEI SCALE 3',
  'HEM-B19',
  'HERM-B19',
  'HONOR SCALE 2',
  'LUP-B19',
  'LUPIN-B19HN',
  'DOBBY-B19',
  'M00F',
  'M00D',
  'M0CJ',
  'N001',
  '007B',
] as const;

/** The first product marker the text contains (case-insensitive), or null. */
export function extractProductMarker(text: string | null): string | null {
  if (!text) return null;
  const upper = text.toUpperCase();
  return PRODUCT_MARKERS.find((marker) => upper.includes(marker)) ?? null;
}

export const isGenericFamily = (family: HagridFamily): boolean => family === 'unknown' || family === 'dobby';

/** Current Time (2A2B) payload in the phone's local time: year u16 LE, month, day, hour, minute, second, weekday (Monday 1 .. Sunday 7). */
export function currentTimePayload(nowMs: number, tzMin: number): Uint8Array {
  const d = new Date(nowMs + tzMin * 60_000);
  const year = d.getUTCFullYear();
  const weekday = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  return Uint8Array.from([year & 0xff, (year >>> 8) & 0xff, d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), weekday]);
}
