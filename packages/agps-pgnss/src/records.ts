// Byte layouts of the HW_PGNSS_* files, from the static analysis of Huawei Health 17.0.8.300 `libPgnssJni.so` (`~/re/agps/FORMAT.md`
// sections 2 to 4; offsets, types, scales and the values Huawei always writes are quoted there with the function each comes from). Every
// multi-byte field is little-endian; padding is zero. Packers truncate toward zero like the C casts Huawei's code uses, and throw RangeError
// for a value that does not fit its field (Huawei's range check drops the satellite from that slot; so does the caller here).

import type { Constellation, Elements } from './orbit';

/** 84 header entries of {u32 time, u32 offset, u32 size}; the first 36 are used in 3-day mode, the rest stay zero. */
export const HEADER_BYTES = 1008;
export const HEADER_ENTRIES = 84;
export const SLOTS = 36;
export const SLOT_SECONDS = 7200;

/** Block size, record size and capacity per file (FORMAT.md 2.2). GLONASS: per 900 s sub-block, 8 sub-blocks per header entry. */
export const LAYOUT = {
  G: { block: 2564, record: 80, capacity: 32 },
  J: { block: 764, record: 76, capacity: 10 },
  E: { block: 2740, record: 76, capacity: 36 },
  C: { block: 5800, record: 92, capacity: 63 },
  R: { block: 1252, record: 52, capacity: 24 },
} as const;
export const GLO_SUBBLOCKS = 8;

export type FileKind = keyof typeof LAYOUT;

/** Header entry size field: the block, or 8 GLONASS sub-blocks (10016). */
export const entrySize = (k: FileKind): number => (k === 'R' ? GLO_SUBBLOCKS * LAYOUT.R.block : LAYOUT[k].block);

/** File size in 3-day mode: GPS 93 312, QZS 28 512, GAL 99 648, BDS 209 808, GLO 361 584 (FORMAT.md 2.2 and the 2026-10-25 capture). */
export const fileSize = (k: FileKind): number => HEADER_BYTES + SLOTS * entrySize(k);

const PI = Math.PI;

/** value × scale truncated toward zero; RangeError unless it fits a signed field of `bits` bits. */
function sInt(name: string, value: number, scale: number, bits: number): number {
  const v = Math.trunc(value * scale);
  const lim = 2 ** (bits - 1);
  if (!Number.isFinite(v) || v < -lim || v >= lim) throw new RangeError(`${name} out of range: ${value}`);
  return v;
}

/** value × scale truncated toward zero; RangeError unless it fits an unsigned field of `bits` bits. */
function uInt(name: string, value: number, scale: number, bits: number): number {
  const v = Math.trunc(value * scale);
  if (!Number.isFinite(v) || v < 0 || v >= 2 ** bits) throw new RangeError(`${name} out of range: ${value}`);
  return v;
}

/** An angle moved into [-pi, pi), so its semicircle value fits a signed 32-bit field. */
const wrap = (a: number): number => a - 2 * PI * Math.floor((a + PI) / (2 * PI));

const SC = 2 ** 31 / PI; // semicircles × 2^31
const RATE = 2 ** 43 / PI; // semicircles/s × 2^43

/** Clock and group delay of a record (seconds, s/s, s/s^2), already referred to toe. */
export type Clock = { af0: number; af1: number; af2: number; tgd: number };

/** Kepler record input: elements (toe = seconds of week of the record epoch in the constellation's time), clock, PRN, full week. */
export type KeplerRecord = { prn: number; week: number; el: Elements; clock: Clock };

/** The orbit fields as stored integers. */
type OrbitInts = Record<Exclude<keyof Elements, 'toe'>, number>;

/** Huawei's s16/24-bit/14-bit range check on the harmonic and rate terms (FUN_00134030; BDS FUN_0013a304 with 18-bit harmonics). */
function checkedOrbit(el: Elements, harmonicBits: number, rScale: number, angScale: number): OrbitInts {
  return {
    deltaN: sInt('deltaN', el.deltaN, RATE, 16),
    omegaDot: sInt('omegaDot', el.omegaDot, RATE, 24),
    idot: sInt('idot', el.idot, RATE, 14),
    cuc: sInt('cuc', el.cuc, angScale, harmonicBits),
    cus: sInt('cus', el.cus, angScale, harmonicBits),
    crc: sInt('crc', el.crc, rScale, harmonicBits),
    crs: sInt('crs', el.crs, rScale, harmonicBits),
    cic: sInt('cic', el.cic, angScale, harmonicBits),
    cis: sInt('cis', el.cis, angScale, harmonicBits),
    m0: sInt('m0', wrap(el.m0), SC, 32),
    e: uInt('e', el.e, 2 ** 33, 32),
    sqrtA: uInt('sqrtA', el.sqrtA, 2 ** 19, 32),
    omega0: sInt('omega0', wrap(el.omega0), SC, 32),
    i0: sInt('i0', wrap(el.i0), SC, 32),
    omega: sInt('omega', wrap(el.omega), SC, 32),
  };
}

/** GPS record, 80 bytes (FORMAT.md 3.1). */
export function packGps(r: KeplerRecord): Uint8Array {
  const o = checkedOrbit(r.el, 16, 2 ** 5, 2 ** 29);
  const out = new Uint8Array(80);
  const d = new DataView(out.buffer);
  const t16 = Math.floor(r.el.toe) >> 4;
  d.setUint8(0x00, r.prn - 1);
  d.setUint16(0x02, r.week, true);
  // ura 0, iode 0
  d.setInt32(0x08, o.m0, true);
  d.setInt16(0x0c, o.deltaN, true);
  d.setUint32(0x10, o.e, true);
  d.setUint32(0x14, o.sqrtA, true);
  d.setInt32(0x18, o.omega0, true);
  d.setInt32(0x1c, o.i0, true);
  d.setInt32(0x20, o.omega, true);
  d.setInt32(0x24, o.omegaDot, true);
  d.setInt16(0x28, o.idot, true);
  d.setInt16(0x2a, o.cuc, true);
  d.setInt16(0x2c, o.cus, true);
  d.setInt16(0x2e, o.crc, true);
  d.setInt16(0x30, o.crs, true);
  d.setInt16(0x32, o.cic, true);
  d.setInt16(0x34, o.cis, true);
  d.setInt8(0x36, sInt('tgd', r.clock.tgd, 2 ** 31, 8));
  d.setInt32(0x38, sInt('af0', r.clock.af0, 2 ** 31, 32), true);
  d.setInt32(0x3c, sInt('af1', r.clock.af1, 2 ** 43, 32), true);
  d.setInt32(0x40, sInt('af2', r.clock.af2, 2 ** 55, 32), true);
  // aodc 0, health 0
  d.setUint16(0x48, t16, true);
  d.setUint16(0x4a, t16, true);
  // fit_interval_flag 0
  d.setUint8(0x4d, 0xff); // aodo
  return out;
}

/** The orbit fields QZSS and Galileo share at 0x1C to 0x4B (FORMAT.md 3.2, 3.3). */
function putQzsGalOrbit(d: DataView, o: OrbitInts): void {
  d.setInt32(0x1c, o.omega, true);
  d.setInt16(0x20, o.deltaN, true);
  d.setInt32(0x24, o.m0, true);
  d.setInt32(0x28, o.omegaDot, true);
  d.setUint32(0x2c, o.e, true);
  d.setInt16(0x30, o.idot, true);
  d.setUint32(0x34, o.sqrtA, true);
  d.setInt32(0x38, o.i0, true);
  d.setInt32(0x3c, o.omega0, true);
  d.setInt16(0x40, o.crs, true);
  d.setInt16(0x42, o.cis, true);
  d.setInt16(0x44, o.cus, true);
  d.setInt16(0x46, o.crc, true);
  d.setInt16(0x48, o.cic, true);
  d.setInt16(0x4a, o.cuc, true);
}

/** QZSS record, 76 bytes (FORMAT.md 3.2); satId 0 = PRN 193 [INFERENCE in FORMAT.md], so J01 is 0. */
export function packQzs(r: KeplerRecord): Uint8Array {
  const o = checkedOrbit(r.el, 16, 2 ** 5, 2 ** 29);
  const out = new Uint8Array(76);
  const d = new DataView(out.buffer);
  const t16 = Math.floor(r.el.toe) >> 4;
  d.setUint8(0x00, r.prn - 1);
  d.setUint16(0x04, t16, true);
  d.setInt32(0x08, sInt('af2', r.clock.af2, 2 ** 55, 32), true);
  d.setInt32(0x0c, sInt('af1', r.clock.af1, 2 ** 43, 32), true);
  d.setInt32(0x10, sInt('af0', r.clock.af0, 2 ** 31, 32), true);
  d.setInt8(0x14, sInt('tgd', r.clock.tgd, 2 ** 31, 8));
  d.setUint16(0x18, t16, true);
  putQzsGalOrbit(d, o);
  return out;
}

/** Galileo record, 76 bytes (FORMAT.md 3.3); toc/toe in 60 s units, BGD in 2^-32 s. */
export function packGal(r: KeplerRecord): Uint8Array {
  const o = checkedOrbit(r.el, 16, 2 ** 5, 2 ** 29);
  const out = new Uint8Array(76);
  const d = new DataView(out.buffer);
  const t60 = Math.floor(Math.floor(r.el.toe) / 60);
  d.setUint8(0x00, r.prn - 1);
  d.setUint32(0x04, t60, true);
  d.setInt32(0x08, sInt('af2', r.clock.af2, 2 ** 59, 32), true);
  d.setInt32(0x0c, sInt('af1', r.clock.af1, 2 ** 46, 32), true);
  d.setInt32(0x10, sInt('af0', r.clock.af0, 2 ** 34, 32), true);
  d.setInt16(0x14, sInt('bgd', r.clock.tgd, 2 ** 32, 16), true);
  d.setUint32(0x18, t60, true);
  putQzsGalOrbit(d, o);
  return out;
}

/** BeiDou record, 92 bytes (FORMAT.md 3.4); toe in BDT seconds of week, 8 s units; harmonics checked in 18 bits like Huawei's BDS check. */
export function packBds(r: KeplerRecord): Uint8Array {
  const o = checkedOrbit(r.el, 18, 2 ** 6, 2 ** 31);
  const out = new Uint8Array(92);
  const d = new DataView(out.buffer);
  const t8 = Math.floor(r.el.toe) >> 3;
  d.setUint8(0x00, r.prn - 1);
  d.setUint16(0x02, t8 & 0xffc0, true); // iod
  d.setUint32(0x08, t8, true);
  d.setInt32(0x0c, sInt('a0', r.clock.af0, 2 ** 33, 32), true);
  d.setInt32(0x10, sInt('a1', r.clock.af1, 2 ** 50, 32), true);
  d.setInt16(0x14, sInt('a2', r.clock.af2, 2 ** 66, 16), true);
  d.setInt16(0x16, sInt('tgd1', r.clock.tgd, 1e10, 16), true);
  d.setUint32(0x1c, t8, true);
  d.setUint32(0x20, o.sqrtA, true);
  d.setUint32(0x24, o.e, true);
  d.setInt32(0x28, o.omega, true);
  d.setInt16(0x2c, o.deltaN, true);
  d.setInt32(0x30, o.m0, true);
  d.setInt32(0x34, o.omega0, true);
  d.setInt32(0x38, o.omegaDot, true);
  d.setInt32(0x3c, o.i0, true);
  d.setInt16(0x40, o.idot, true);
  d.setInt32(0x44, o.cuc, true);
  d.setInt32(0x48, o.cus, true);
  d.setInt32(0x4c, o.crc, true);
  d.setInt32(0x50, o.crs, true);
  d.setInt32(0x54, o.cic, true);
  d.setInt32(0x58, o.cis, true);
  return out;
}

export const PACKERS: Record<Constellation, (r: KeplerRecord) => Uint8Array> = { G: packGps, J: packQzs, E: packGal, C: packBds };

/** What a decoder reads back from a Kepler record: PRN, elements (toe = seconds of week as stored), clock. */
export type DecodedKepler = { prn: number; el: Elements; clock: Clock };

/** Reads a Kepler record back with the ICD scales, independently of the packers' code path (used by the quality gate and the tests). */
export function decodeKepler(c: Constellation, rec: Uint8Array): DecodedKepler {
  const d = new DataView(rec.buffer, rec.byteOffset, rec.byteLength);
  const s32 = (o: number) => d.getInt32(o, true);
  const u32 = (o: number) => d.getUint32(o, true);
  const s16 = (o: number) => d.getInt16(o, true);
  const prn = d.getUint8(0) + 1;
  if (c === 'G') {
    return {
      prn,
      el: {
        m0: s32(0x08) / SC,
        deltaN: s16(0x0c) / RATE,
        e: u32(0x10) / 2 ** 33,
        sqrtA: u32(0x14) / 2 ** 19,
        omega0: s32(0x18) / SC,
        i0: s32(0x1c) / SC,
        omega: s32(0x20) / SC,
        omegaDot: s32(0x24) / RATE,
        idot: s16(0x28) / RATE,
        cuc: s16(0x2a) / 2 ** 29,
        cus: s16(0x2c) / 2 ** 29,
        crc: s16(0x2e) / 2 ** 5,
        crs: s16(0x30) / 2 ** 5,
        cic: s16(0x32) / 2 ** 29,
        cis: s16(0x34) / 2 ** 29,
        toe: d.getUint16(0x4a, true) * 16,
      },
      clock: { tgd: d.getInt8(0x36) / 2 ** 31, af0: s32(0x38) / 2 ** 31, af1: s32(0x3c) / 2 ** 43, af2: s32(0x40) / 2 ** 55 },
    };
  }
  if (c === 'C') {
    return {
      prn,
      el: {
        toe: u32(0x1c) * 8,
        sqrtA: u32(0x20) / 2 ** 19,
        e: u32(0x24) / 2 ** 33,
        omega: s32(0x28) / SC,
        deltaN: s16(0x2c) / RATE,
        m0: s32(0x30) / SC,
        omega0: s32(0x34) / SC,
        omegaDot: s32(0x38) / RATE,
        i0: s32(0x3c) / SC,
        idot: s16(0x40) / RATE,
        cuc: s32(0x44) / 2 ** 31,
        cus: s32(0x48) / 2 ** 31,
        crc: s32(0x4c) / 2 ** 6,
        crs: s32(0x50) / 2 ** 6,
        cic: s32(0x54) / 2 ** 31,
        cis: s32(0x58) / 2 ** 31,
      },
      clock: { af0: s32(0x0c) / 2 ** 33, af1: s32(0x10) / 2 ** 50, af2: s16(0x14) / 2 ** 66, tgd: s16(0x16) / 1e10 },
    };
  }
  const el: Elements = {
    toe: c === 'E' ? u32(0x18) * 60 : d.getUint16(0x18, true) * 16,
    omega: s32(0x1c) / SC,
    deltaN: s16(0x20) / RATE,
    m0: s32(0x24) / SC,
    omegaDot: s32(0x28) / RATE,
    e: u32(0x2c) / 2 ** 33,
    idot: s16(0x30) / RATE,
    sqrtA: u32(0x34) / 2 ** 19,
    i0: s32(0x38) / SC,
    omega0: s32(0x3c) / SC,
    crs: s16(0x40) / 2 ** 5,
    cis: s16(0x42) / 2 ** 29,
    cus: s16(0x44) / 2 ** 29,
    crc: s16(0x46) / 2 ** 5,
    cic: s16(0x48) / 2 ** 29,
    cuc: s16(0x4a) / 2 ** 29,
  };
  const clock =
    c === 'E'
      ? { af2: s32(0x08) / 2 ** 59, af1: s32(0x0c) / 2 ** 46, af0: s32(0x10) / 2 ** 34, tgd: s16(0x14) / 2 ** 32 }
      : { af2: s32(0x08) / 2 ** 55, af1: s32(0x0c) / 2 ** 43, af0: s32(0x10) / 2 ** 31, tgd: d.getInt8(0x14) / 2 ** 31 };
  return { prn, el, clock };
}

/** GLONASS record input: slot number, tb index, clock (tauN [s], gammaN), state (km, km/s) and luni-solar acceleration (km/s^2), ECEF. */
export type GloRecord = { slot: number; tb: number; tauN: number; gammaN: number; state: Float64Array; acc: Float64Array };

/** GLONASS record, 52 bytes (FORMAT.md 3.5); fields also checked against their GLONASS ICD widths (x 27 bits, x' 24, x'' 5, tau 22, gamma 11). */
export function packGlo(r: GloRecord): Uint8Array {
  const out = new Uint8Array(52);
  const d = new DataView(out.buffer);
  d.setUint8(0x00, r.slot - 1);
  d.setUint16(0x02, r.tb, true);
  d.setInt32(0x04, sInt('tau', r.tauN, 2 ** 30, 22), true);
  d.setInt16(0x08, sInt('gamma', r.gammaN, 2 ** 40, 11), true);
  // deltaTau 0, en 0
  d.setUint8(0x0c, 1); // p1
  // p2 0, m 0
  for (let ax = 0; ax < 3; ax++) {
    const base = 0x10 + 12 * ax;
    d.setInt32(base, sInt('pos', r.state[ax] as number, 2 ** 11, 27), true);
    d.setInt32(base + 4, sInt('vel', r.state[3 + ax] as number, 2 ** 20, 24), true);
    d.setInt8(base + 8, sInt('acc', r.acc[ax] as number, 2 ** 30, 5));
  }
  return out;
}

export function decodeGlo(rec: Uint8Array): GloRecord {
  const d = new DataView(rec.buffer, rec.byteOffset, rec.byteLength);
  const state = new Float64Array(6);
  const acc = new Float64Array(3);
  for (let ax = 0; ax < 3; ax++) {
    const base = 0x10 + 12 * ax;
    state[ax] = d.getInt32(base, true) / 2 ** 11;
    state[3 + ax] = d.getInt32(base + 4, true) / 2 ** 20;
    acc[ax] = d.getInt8(base + 8) / 2 ** 30;
  }
  return { slot: d.getUint8(0) + 1, tb: d.getUint16(2, true), tauN: d.getInt32(4, true) / 2 ** 30, gammaN: d.getInt16(8, true) / 2 ** 40, state, acc };
}

/** One header entry: slot time (GPS seconds) and its blocks' records (GLONASS: 8 sub-blocks of records). */
export type Slot = { time: number; blocks: Uint8Array[][] };

/** Header + blocks: `u8 count; u8 pad[3]; records; zero fill` per block, offsets packed from 1008 (FORMAT.md 2.1, 2.2). */
export function assembleFile(k: FileKind, slots: Slot[]): Uint8Array {
  if (slots.length !== SLOTS) throw new Error(`${k}: ${slots.length} slots, want ${SLOTS}`);
  const { block, record, capacity } = LAYOUT[k];
  const per = k === 'R' ? GLO_SUBBLOCKS : 1;
  const out = new Uint8Array(fileSize(k));
  const d = new DataView(out.buffer);
  slots.forEach((slot, i) => {
    const offset = HEADER_BYTES + i * entrySize(k);
    d.setUint32(12 * i, slot.time, true);
    d.setUint32(12 * i + 4, offset, true);
    d.setUint32(12 * i + 8, entrySize(k), true);
    if (slot.blocks.length !== per) throw new Error(`${k}: slot ${i} has ${slot.blocks.length} blocks, want ${per}`);
    slot.blocks.forEach((records, b) => {
      if (records.length > capacity) throw new Error(`${k}: ${records.length} records in a block of ${capacity}`);
      const at = offset + b * block;
      out[at] = records.length;
      records.forEach((r, n) => {
        if (r.length !== record) throw new Error(`${k}: record of ${r.length} bytes, want ${record}`);
        out.set(r, at + 4 + n * record);
      });
    });
  });
  return out;
}

/** Records of each block of a file, read back by the header (for the quality gate and tests). */
export function readBlocks(k: FileKind, file: Uint8Array): { time: number; records: Uint8Array[] }[] {
  const { block, record } = LAYOUT[k];
  const d = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const out: { time: number; records: Uint8Array[] }[] = [];
  for (let i = 0; i < SLOTS; i++) {
    const time = d.getUint32(12 * i, true);
    const offset = d.getUint32(12 * i + 4, true);
    const size = d.getUint32(12 * i + 8, true);
    for (let at = offset; at < offset + size; at += block) {
      const n = file[at] as number;
      const records: Uint8Array[] = [];
      for (let r = 0; r < n; r++) records.push(file.subarray(at + 4 + r * record, at + 4 + (r + 1) * record));
      out.push({ time, records });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// HW_PGNSS_EXTRA (FORMAT.md 4): 12 fixed sections, 6248 bytes, never compressed.

export const EXTRA_BYTES = 6248;
/** Section offsets: GPS UTC 0, GPS ION 16, GLO AUX 24, GPS RTI 288, GLO RTI 568, GAL RTI 832, BDS RTI 1096, GPS ALM 1360, GLO ALM 2388, GAL ALM 3160, BDS ALM 3960, seed trailer 6232. */
export const EXTRA_OFFSETS = { gpsUtc: 0, gpsIon: 16, gloAux: 24, gpsRti: 288, gloRti: 568, galRti: 832, bdsRti: 1096, gpsAlm: 1360, gloAlm: 2388, galAlm: 3160, bdsAlm: 3960, trailer: 6232 } as const;

/** GPS UTC parameters as broadcast (IS-GPS-200 20.3.3.5.1.6), SI units; weeks full. */
export type GpsUtc = { a0: number; a1: number; tot: number; wnt: number; dtls: number; wnlsf: number; dn: number; dtlsf: number };
/** Klobuchar coefficients as broadcast: alpha [s, s/sc, s/sc^2, s/sc^3], beta [s, ...]. */
export type GpsIon = { alpha: [number, number, number, number]; beta: [number, number, number, number] };

export type ExtraInput = {
  utc: GpsUtc | null;
  ion: GpsIon | null;
  /** Trailer: data window start and end (GPS seconds) and leap seconds. */
  start: number;
  end: number;
  leap: number;
};

/**
 * The EXTRA file. Filled: GPS UTC, GPS ION and the trailer. Every other section is written as zeros, which is what Huawei Health writes for a
 * section its seed lacks (FORMAT.md 4: "if a section is missing or fails to decode it is still written, as zeros"); their field meanings
 * (almanac satellite numbering, RTI flags, GLONASS AUX third byte) are not known well enough to fill them without guessing.
 *
 * GPS UTC layout [INFERENCE]: +0 s32 A0 × 2^30, +4 s32 A1 × 2^50, +8 u8 tot / 2^12, +9 u8 WNt mod 256, +0xA s8 dtLS, +0xB u8 WNlsf mod 256,
 * +0xC s8 dtLSF, +0xD u8 DN. The signed bytes are where the code sign-extends (FUN_00142100), and the only signed quantities among the six
 * are the two leap second counts; while dtLS = dtLSF (no leap second announced) any assignment consistent with that gives the same UTC.
 */
export function buildExtra(x: ExtraInput): Uint8Array {
  const out = new Uint8Array(EXTRA_BYTES);
  const d = new DataView(out.buffer);
  if (x.utc) {
    const u = x.utc;
    const o = EXTRA_OFFSETS.gpsUtc;
    d.setInt32(o, Math.round(u.a0 * 2 ** 30), true);
    d.setInt32(o + 4, Math.round(u.a1 * 2 ** 50), true);
    d.setUint8(o + 8, Math.round(u.tot / 4096) & 0xff);
    d.setUint8(o + 9, u.wnt & 0xff);
    d.setInt8(o + 0xa, u.dtls);
    d.setUint8(o + 0xb, u.wnlsf & 0xff);
    d.setInt8(o + 0xc, u.dtlsf);
    d.setUint8(o + 0xd, u.dn);
  }
  if (x.ion) {
    const o = EXTRA_OFFSETS.gpsIon;
    const aScale = [2 ** 30, 2 ** 27, 2 ** 24, 2 ** 24];
    const bScale = [2 ** -11, 2 ** -14, 2 ** -16, 2 ** -16];
    for (let i = 0; i < 4; i++) {
      d.setInt8(o + i, sInt('ion alpha', Math.round((x.ion.alpha[i] as number) * (aScale[i] as number)), 1, 8));
      d.setInt8(o + 4 + i, sInt('ion beta', Math.round((x.ion.beta[i] as number) * (bScale[i] as number)), 1, 8));
    }
  }
  const t = EXTRA_OFFSETS.trailer;
  d.setUint32(t, x.start, true);
  d.setUint32(t + 4, x.end, true);
  // +8: Huawei's last GPS slot field, reset to 0 by GetSeedInfo on every first run in a process (FORMAT.md 4, item 12).
  d.setUint8(t + 12, x.leap);
  return out;
}
