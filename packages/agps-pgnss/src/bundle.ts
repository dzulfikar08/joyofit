// The bundle the Worker serves the six HW_PGNSS_PRED files in (`GET /v1/agps/hw-pgnss`, docs/agps.md "PGNSS lab path") and the check both the
// Worker and the phone run before anything reaches a watch. The Kotlin and Swift twins (`AgpsPolicy.validatePgnss`) re-implement exactly
// these rules.
//
// Bundle: ASCII `JFPG`, u8 version 1, u8 file count 6, then per file in the order the watch pulled them on 2026-10-25 (GPS, BDS, GLONASS,
// GALILEO, QZS, EXTRA): u8 name length, name (ASCII), u32 little-endian size, bytes. Nothing follows the last file.

import { EXTRA_BYTES, fileSize, HEADER_BYTES, HEADER_ENTRIES, LAYOUT, SLOTS, SLOT_SECONDS, entrySize, type FileKind } from './records';

export const BUNDLE_MAGIC = 'JFPG';
export const BUNDLE_VERSION = 1;

/** File names in pull order with their file kind (EXTRA has none). */
export const PGNSS_FILES: readonly { name: string; kind: FileKind | null }[] = [
  { name: 'HW_PGNSS_GPS', kind: 'G' },
  { name: 'HW_PGNSS_BDS', kind: 'C' },
  { name: 'HW_PGNSS_GLONASS', kind: 'R' },
  { name: 'HW_PGNSS_GALILEO', kind: 'E' },
  { name: 'HW_PGNSS_QZS', kind: 'J' },
  { name: 'HW_PGNSS_EXTRA', kind: null },
];

/** Exact size of each file in 3-day mode: 93 312, 209 808, 361 584, 99 648, 28 512, 6 248. */
export const PGNSS_SIZES: readonly number[] = PGNSS_FILES.map((f) => (f.kind ? fileSize(f.kind) : EXTRA_BYTES));

/** GPS seconds the way Huawei Health computes them (`unixSeconds - 315964782`: GPS epoch and 18 leap seconds, PgnssManager.b). */
export const HH_LEAP_SECONDS = 18;
export const gpsSecondsAt = (unixMs: number): number => Math.floor(unixMs / 1000) - 315964800 + HH_LEAP_SECONDS;

/** BeiDou slot times carry +14 s (BDT = GPST - 14 s, FORMAT.md 2.3); the window check takes it off. */
export const BDS_SLOT_SHIFT = 14;

/** The first slot must lie within this many seconds of the build time (it is the next 2 h boundary, GLONASS one hour earlier). */
export const FIRST_SLOT_WINDOW_S = 7200;

/** The phone does not offer a bundle older than this (by the server's `Last-Modified`). */
export const BUNDLE_MAX_AGE_MS = 6 * 3600 * 1000;

export type PgnssFile = { name: string; bytes: Uint8Array };

export function encodeBundle(files: PgnssFile[]): Uint8Array {
  const ascii = new TextEncoder();
  const total = 6 + files.reduce((n, f) => n + 1 + f.name.length + 4 + f.bytes.length, 0);
  const out = new Uint8Array(total);
  const d = new DataView(out.buffer);
  out.set(ascii.encode(BUNDLE_MAGIC), 0);
  out[4] = BUNDLE_VERSION;
  out[5] = files.length;
  let at = 6;
  for (const f of files) {
    out[at] = f.name.length;
    out.set(ascii.encode(f.name), at + 1);
    at += 1 + f.name.length;
    d.setUint32(at, f.bytes.length, true);
    out.set(f.bytes, at + 4);
    at += 4 + f.bytes.length;
  }
  return out;
}

/** The files of a bundle, or why it is not a well-formed one (magic, version, count, lengths, trailing bytes). Names are not checked here. */
export function decodeBundle(bytes: Uint8Array): PgnssFile[] | string {
  if (bytes.length < 6) return 'bundle shorter than its header';
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== BUNDLE_MAGIC) return 'bundle magic is not JFPG';
  if (bytes[4] !== BUNDLE_VERSION) return `bundle version ${bytes[4]}, want ${BUNDLE_VERSION}`;
  const count = bytes[5] as number;
  if (count !== PGNSS_FILES.length) return `bundle holds ${count} files, want ${PGNSS_FILES.length}`;
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files: PgnssFile[] = [];
  let at = 6;
  for (let i = 0; i < count; i++) {
    if (at + 1 > bytes.length) return `bundle ends inside file ${i + 1}`;
    const nameLen = bytes[at] as number;
    if (at + 1 + nameLen + 4 > bytes.length) return `bundle ends inside file ${i + 1}`;
    const name = String.fromCharCode(...bytes.subarray(at + 1, at + 1 + nameLen));
    at += 1 + nameLen;
    const size = d.getUint32(at, true);
    at += 4;
    if (at + size > bytes.length) return `bundle ends inside ${name}`;
    files.push({ name, bytes: bytes.subarray(at, at + size) });
    at += size;
  }
  if (at !== bytes.length) return `${bytes.length - at} bytes after the last file`;
  return files;
}

/**
 * Why `bytes` is not one of the five ephemeris files of kind `k` built at `builtGps` (GPS seconds), or null. The layout checks of
 * FORMAT.md 2: exact size; entries 0..35 at offset 1008 + i × entry size with the entry size of the kind (GLONASS 10016); entries 36..83
 * all zero; times step by exactly 7200 s; the first within [FIRST_SLOT_WINDOW_S] of the build (BeiDou minus its 14 s); each block's (each
 * GLONASS sub-block's) count at most the capacity.
 */
export function validatePgnssFile(k: FileKind, bytes: Uint8Array, builtGps: number): string | null {
  const want = fileSize(k);
  if (bytes.length !== want) return `${bytes.length} bytes, want ${want}`;
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = entrySize(k);
  const first = d.getUint32(0, true);
  for (let i = 0; i < SLOTS; i++) {
    if (d.getUint32(12 * i + 4, true) !== HEADER_BYTES + i * size) return `header entry ${i} has the wrong offset`;
    if (d.getUint32(12 * i + 8, true) !== size) return `header entry ${i} has the wrong size`;
    if (d.getUint32(12 * i, true) !== first + i * SLOT_SECONDS) return `header entry ${i} time is not ${SLOT_SECONDS} s after the previous`;
  }
  for (let at = 12 * SLOTS; at < 12 * HEADER_ENTRIES; at++) if (bytes[at] !== 0) return 'unused header entries are not zero';
  const shift = k === 'C' ? BDS_SLOT_SHIFT : 0;
  if (Math.abs(first - shift - builtGps) > FIRST_SLOT_WINDOW_S) return 'first slot is not within 2 h of the build time';
  const { block, capacity } = LAYOUT[k];
  for (let at = HEADER_BYTES; at < bytes.length; at += block) {
    if ((bytes[at] as number) > capacity) return `block at ${at} holds ${bytes[at]} records, more than ${capacity}`;
  }
  return null;
}

/**
 * Why `bytes` is not a bundle fit to hand to the watch, or null. `builtAtMs` is the build time (on the phone: the server's `Last-Modified`,
 * not the phone clock; the bundle's age is the phone's separate [BUNDLE_MAX_AGE_MS] check). Checks: the bundle frame, six files in pull order
 * with these exact names and sizes, every ephemeris file's header and block counts ([validatePgnssFile]), EXTRA exactly 6 248 bytes.
 */
export function validatePgnssBundle(bytes: Uint8Array, builtAtMs: number): string | null {
  const files = decodeBundle(bytes);
  if (typeof files === 'string') return files;
  const builtGps = gpsSecondsAt(builtAtMs);
  for (let i = 0; i < PGNSS_FILES.length; i++) {
    const want = PGNSS_FILES[i] as { name: string; kind: FileKind | null };
    const got = files[i] as PgnssFile;
    if (got.name !== want.name) return `file ${i + 1} is ${got.name || '(empty name)'}, want ${want.name}`;
    if (got.bytes.length !== PGNSS_SIZES[i]) return `${want.name}: ${got.bytes.length} bytes, want ${PGNSS_SIZES[i]}`;
    if (want.kind) {
      const problem = validatePgnssFile(want.kind, got.bytes, builtGps);
      if (problem) return `${want.name}: ${problem}`;
    }
  }
  return null;
}
