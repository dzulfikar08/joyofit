// Builds the `HW_AGNSS` file some Huawei watches ask for (tag `higeo/v1/gnssinfo?type=0x0024/HW_AGNSS` from a Watch Fit 4 Pro,
// `type=0x0004` from a Band 11 Pro, download version 3; see docs/agps.md) from public broadcast ephemeris: a RINEX 3 navigation file in, a
// stream of RTCM 3 ephemeris messages out (1019 GPS, 1020 GLONASS, 1042 BeiDou, 1046 Galileo I/NAV, each in its own CRC-24Q frame). Huawei
// Health stores the file under the name `HW_AGNSS_RTCM_33` and sends it to the watch unchanged.
//
// Pure code, no I/O: the lab CLI (`scripts/agps-rtcm.ts`) and the Worker endpoint (`server/src/agps.ts`) fetch and unpack the RINEX file
// themselves and share everything here.
//
// The watch does not validate what it is sent and nobody has confirmed that this stream is what a Huawei watch's GNSS chip accepts: the layout
// comes from the public RTCM message definitions and from the community's reading of Huawei Health's own file (Me7c7/HDataResearch,
// pgnss/HW_AGNSS_RTCM_33_info.cpp, MIT). The app sends it only behind an experimental switch that is off by default. Data source terms and the
// full reasoning: docs/agps.md.

export const BKG_BRDC = 'https://igs.bkg.bund.de/root_ftp/IGS/BRDC';

export type System = 'G' | 'R' | 'E' | 'C';

export type NavRecord = {
  sys: System;
  prn: number;
  /** Calendar epoch of the record as RINEX prints it (GPS, Galileo, BeiDou system time, GLONASS UTC), as ms since 1970 read as UTC. */
  epochMs: number;
  /** Every number of the record in file order: line 1 has three, each continuation line four. */
  v: number[];
};

const SYSTEMS = 'GREC';

/**
 * RINEX 3.x navigation file to records. Systems this tool does not encode (QZSS, NavIC, SBAS) and unparsable records are skipped. Records
 * whose epoch is before [notBeforeMs] are skipped before their numbers are read, which keeps a full day's file cheap to scan.
 */
export function parseRinexNav(text: string, notBeforeMs = -Infinity): NavRecord[] {
  const lines = text.split('\n');
  let i = lines.findIndex((l) => l.includes('END OF HEADER')) + 1;
  const out: NavRecord[] = [];
  while (i < lines.length) {
    const head = lines[i] ?? '';
    i += 1;
    if (head.length < 23 || !/^[A-Z][0-9 ]\d/.test(head)) continue;
    const from = i;
    while (i < lines.length && (lines[i] ?? '').startsWith('    ')) i += 1;
    const sys = head.charAt(0);
    if (!SYSTEMS.includes(sys)) continue;
    const m = /^(\d{4}) (\d\d) (\d\d) (\d\d) (\d\d) (\d\d)$/.exec(head.slice(4, 23));
    if (!m) continue;
    const epochMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
    if (epochMs < notBeforeMs) continue;
    const v = [...fields(head, 23, 3)];
    for (let k = from; k < i; k++) v.push(...fields(lines[k] ?? '', 4, 4));
    out.push({ sys: sys as System, prn: Number(head.slice(1, 3)), epochMs, v });
  }
  return out;
}

function* fields(line: string, from: number, count: number): Generator<number> {
  for (let k = 0; k < count; k++) {
    const raw = line.slice(from + 19 * k, from + 19 * (k + 1)).trim().replace(/[dD]/, 'e');
    yield raw === '' ? 0 : Number(raw);
  }
}

// Record layout by index into NavRecord.v (RINEX 3.05 tables A3, A4 and A6 to A9). Also read by packages/agps-pgnss (health, clocks, group delays).
export const K = {
  af0: 0, af1: 1, af2: 2, iode: 3, crs: 4, dn: 5, m0: 6, cuc: 7, e: 8, cus: 9, sqrtA: 10, toe: 11, cic: 12, omega0: 13, cis: 14,
  i0: 15, crc: 16, omega: 17, omegaDot: 18, idot: 19, codes: 20, week: 21, acc: 23, health: 24, tgd: 25, tgd2: 26, iodc: 26,
} as const;
/** GLONASS: -tauN, +gammaN, message frame time (UTC week s), then X/Y/Z km, km/s, km/s2 with health, frequency, age, and the line-5 delay. */
export const R = { tauN: 0, gamma: 1, tof: 2, x: 3, health: 6, y: 7, freq: 10, z: 11, age: 14, dgd: 16 } as const;

/** Field `i` of a record; a field the record does not have reads as 0, like an empty column. */
const at = (r: NavRecord, i: number): number => r.v[i] ?? 0;

const PI = Math.PI;
const p2 = (n: number) => 2 ** -n;
const GPS_EPOCH_MS = Date.UTC(1980, 0, 6);
const WEEK_S = 604800;

/** Seconds into the GPS-aligned week of a calendar epoch; GPS, Galileo and BeiDou weeks all start on the same Sunday. */
export const secondsOfWeek = (epochMs: number): number => (((epochMs - GPS_EPOCH_MS) / 1000) % WEEK_S + WEEK_S) % WEEK_S;

class Bits {
  private readonly bytes: number[] = [];
  private used = 0;

  /** Appends `bits` bits (at most 32) of an integer; throws RangeError when it does not fit. */
  uint(value: number, bits: number): void {
    if (!Number.isInteger(value) || value < 0 || value >= 2 ** bits) throw new RangeError(`${value} does not fit ${bits} bits`);
    this.put(value, bits);
  }

  /** Two's complement. */
  int(value: number, bits: number): void {
    const r = Math.round(value);
    if (!Number.isFinite(r) || r < -(2 ** (bits - 1)) || r >= 2 ** (bits - 1)) throw new RangeError(`${value} does not fit ${bits} signed bits`);
    this.put(r < 0 ? r + 2 ** bits : r, bits);
  }

  /** Sign and magnitude (GLONASS). */
  sm(value: number, bits: number): void {
    const r = Math.round(value);
    if (!Number.isFinite(r) || Math.abs(r) >= 2 ** (bits - 1)) throw new RangeError(`${value} does not fit ${bits} sign-magnitude bits`);
    this.put(r < 0 ? 1 : 0, 1);
    this.put(Math.abs(r), bits - 1);
  }

  private put(value: number, bits: number): void {
    for (let b = bits - 1; b >= 0; b--) {
      const bit = Math.floor(value / 2 ** b) % 2;
      if (this.used % 8 === 0) this.bytes.push(0);
      if (bit) {
        const last = this.bytes.length - 1;
        this.bytes[last] = (this.bytes[last] ?? 0) | (0x80 >> (this.used % 8));
      }
      this.used += 1;
    }
  }

  get length(): number {
    return this.used;
  }

  toBytes(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

/** URA index (RTCM DF 1019 / 1042): the smallest class whose limit covers the accuracy in metres. */
const URA_LIMITS = [2.4, 3.4, 4.85, 6.85, 9.65, 13.65, 24, 48, 96, 192, 384, 768, 1536, 3072, 6144];
const uraIndex = (metres: number): number => {
  if (!(metres >= 0)) return 15;
  const i = URA_LIMITS.findIndex((l) => l >= metres);
  return i < 0 ? 15 : i;
};

/** Galileo SISA index (Galileo OS SIS ICD 5.1 table 76); 255 is "no accuracy prediction available". */
const sisaIndex = (metres: number): number => {
  if (!(metres >= 0) || metres > 6) return 255;
  if (metres <= 0.5) return Math.floor(metres / 0.01);
  if (metres <= 1) return Math.floor((metres - 0.5) / 0.02) + 50;
  if (metres <= 2) return Math.floor((metres - 1) / 0.04) + 75;
  return Math.floor((metres - 2) / 0.16) + 100;
};

const sc = (x: number, scale: number): number => x / scale;

/** Message 1019, GPS ephemeris, 488 bits. */
export function encode1019(r: NavRecord): Uint8Array {
  const v = (i: number) => at(r, i);
  const b = new Bits();
  b.uint(1019, 12);
  b.uint(r.prn, 6);
  b.uint(v(K.week) % 1024, 10);
  b.uint(uraIndex(v(K.acc)), 4);
  b.uint(v(K.codes) & 3, 2);
  b.int(sc(v(K.idot), p2(43) * PI), 14);
  b.uint(v(K.iode) & 255, 8);
  b.uint(secondsOfWeek(r.epochMs) / 16, 16);
  b.int(sc(v(K.af2), p2(55)), 8);
  b.int(sc(v(K.af1), p2(43)), 16);
  b.int(sc(v(K.af0), p2(31)), 22);
  b.uint(v(K.iodc) & 1023, 10);
  b.int(sc(v(K.crs), p2(5)), 16);
  b.int(sc(v(K.dn), p2(43) * PI), 16);
  b.int(sc(v(K.m0), p2(31) * PI), 32);
  b.int(sc(v(K.cuc), p2(29)), 16);
  b.uint(Math.round(sc(v(K.e), p2(33))), 32);
  b.int(sc(v(K.cus), p2(29)), 16);
  b.uint(Math.round(sc(v(K.sqrtA), p2(19))), 32);
  b.uint(Math.round(v(K.toe) / 16), 16);
  b.int(sc(v(K.cic), p2(29)), 16);
  b.int(sc(v(K.omega0), p2(31) * PI), 32);
  b.int(sc(v(K.cis), p2(29)), 16);
  b.int(sc(v(K.i0), p2(31) * PI), 32);
  b.int(sc(v(K.crc), p2(5)), 16);
  b.int(sc(v(K.omega), p2(31) * PI), 32);
  b.int(sc(v(K.omegaDot), p2(43) * PI), 24);
  b.int(sc(v(K.tgd), p2(31)), 8);
  b.uint(v(K.health) & 63, 6);
  b.uint(v(22) ? 1 : 0, 1); // L2 P data flag
  b.uint(v(28) > 4 && v(28) < 1e8 ? 1 : 0, 1); // fit interval above 4 h
  return b.toBytes();
}

/** Message 1042, BeiDou ephemeris, 511 bits padded to 512. */
export function encode1042(r: NavRecord): Uint8Array {
  const v = (i: number) => at(r, i);
  const b = new Bits();
  b.uint(1042, 12);
  b.uint(r.prn, 6);
  b.uint(v(K.week), 13);
  b.uint(uraIndex(v(K.acc)), 4);
  b.int(sc(v(K.idot), p2(43) * PI), 14);
  b.uint(v(K.iode) & 31, 5);
  b.uint(secondsOfWeek(r.epochMs) / 8, 17);
  b.int(sc(v(K.af2), p2(66)), 11);
  b.int(sc(v(K.af1), p2(50)), 22);
  b.int(sc(v(K.af0), p2(33)), 24);
  b.uint(v(28) & 31, 5); // AODC
  b.int(sc(v(K.crs), p2(6)), 18);
  b.int(sc(v(K.dn), p2(43) * PI), 16);
  b.int(sc(v(K.m0), p2(31) * PI), 32);
  b.int(sc(v(K.cuc), p2(31)), 18);
  b.uint(Math.round(sc(v(K.e), p2(33))), 32);
  b.int(sc(v(K.cus), p2(31)), 18);
  b.uint(Math.round(sc(v(K.sqrtA), p2(19))), 32);
  b.uint(Math.round(v(K.toe) / 8), 17);
  b.int(sc(v(K.cic), p2(31)), 18);
  b.int(sc(v(K.omega0), p2(31) * PI), 32);
  b.int(sc(v(K.cis), p2(31)), 18);
  b.int(sc(v(K.i0), p2(31) * PI), 32);
  b.int(sc(v(K.crc), p2(6)), 18);
  b.int(sc(v(K.omega), p2(31) * PI), 32);
  b.int(sc(v(K.omegaDot), p2(43) * PI), 24);
  b.int(sc(v(K.tgd), 1e-10), 10);
  b.int(sc(v(K.tgd2), 1e-10), 10);
  b.uint(v(K.health) & 1, 1);
  return b.toBytes();
}

/** Message 1046, Galileo I/NAV ephemeris, 502 bits and 2 reserved. RINEX prints the Galileo week aligned to GPS; the message counts from the Galileo epoch. */
export function encode1046(r: NavRecord): Uint8Array {
  const v = (i: number) => at(r, i);
  const h = v(K.health);
  const b = new Bits();
  b.uint(1046, 12);
  b.uint(r.prn, 6);
  b.uint((v(K.week) - 1024) % 4096, 12);
  b.uint(v(K.iode) & 1023, 10); // IODnav
  b.uint(sisaIndex(v(K.acc)), 8);
  b.int(sc(v(K.idot), p2(43) * PI), 14);
  b.uint(secondsOfWeek(r.epochMs) / 60, 14);
  b.int(sc(v(K.af2), p2(59)), 6);
  b.int(sc(v(K.af1), p2(46)), 21);
  b.int(sc(v(K.af0), p2(34)), 31);
  b.int(sc(v(K.crs), p2(5)), 16);
  b.int(sc(v(K.dn), p2(43) * PI), 16);
  b.int(sc(v(K.m0), p2(31) * PI), 32);
  b.int(sc(v(K.cuc), p2(29)), 16);
  b.uint(Math.round(sc(v(K.e), p2(33))), 32);
  b.int(sc(v(K.cus), p2(29)), 16);
  b.uint(Math.round(sc(v(K.sqrtA), p2(19))), 32);
  b.uint(Math.round(v(K.toe) / 60), 14);
  b.int(sc(v(K.cic), p2(29)), 16);
  b.int(sc(v(K.omega0), p2(31) * PI), 32);
  b.int(sc(v(K.cis), p2(29)), 16);
  b.int(sc(v(K.i0), p2(31) * PI), 32);
  b.int(sc(v(K.crc), p2(5)), 16);
  b.int(sc(v(K.omega), p2(31) * PI), 32);
  b.int(sc(v(K.omegaDot), p2(43) * PI), 24);
  b.int(sc(v(K.tgd), p2(32)), 10); // BGD E5a/E1
  b.int(sc(v(K.tgd2), p2(32)), 10); // BGD E5b/E1
  b.uint((h >> 7) & 3, 2); // E5b signal health
  b.uint((h >> 6) & 1, 1); // E5b data validity
  b.uint((h >> 1) & 3, 2); // E1-B signal health
  b.uint(h & 1, 1); // E1-B data validity
  b.uint(0, 2);
  return b.toBytes();
}

const MOSCOW_S = 3 * 3600;
const GLONASS_EPOCH_MS = Date.UTC(1996, 0, 1);

/** Message 1020, GLONASS ephemeris, 353 bits and 7 reserved. Fields RINEX does not carry (almanac, tau_c, tau_GPS) are sent as "not available". */
export function encode1020(r: NavRecord): Uint8Array {
  const v = (i: number) => at(r, i);
  const sod = (r.epochMs / 1000) % 86400;
  const tbSlots = Math.round(((sod + MOSCOW_S) % 86400) / 900) % 96;
  const frameTime = (((v(R.tof) % 86400) + 86400) % 86400 + MOSCOW_S) % 86400;
  const day = Math.floor((r.epochMs + MOSCOW_S * 1000 - GLONASS_EPOCH_MS) / 86400000);
  const unhealthy = v(R.health) ? 1 : 0;
  const b = new Bits();
  b.uint(1020, 12);
  b.uint(r.prn, 6);
  b.uint(v(R.freq) + 7, 5);
  b.uint(0, 1); // almanac health
  b.uint(0, 1); // almanac health availability: 0 = not available
  b.uint(1, 2); // P1: 30 minute tb interval
  b.uint(Math.floor(frameTime / 3600), 5);
  b.uint(Math.floor((frameTime % 3600) / 60), 6);
  b.uint(Math.floor((frameTime % 60) / 30), 1);
  b.uint(unhealthy, 1); // Bn
  b.uint(tbSlots & 1, 1); // P2: tb odd
  b.uint(tbSlots, 7);
  for (const [pos, vel, acc] of [[R.x, R.x + 1, R.x + 2], [R.y, R.y + 1, R.y + 2], [R.z, R.z + 1, R.z + 2]] as const) {
    // RINEX holds km, km/s, km/s2 in the same order as the fields; the message scales are those units too.
    b.sm(sc(v(vel), p2(20)), 24);
    b.sm(sc(v(pos), p2(11)), 27);
    b.sm(sc(v(acc), p2(30)), 5);
  }
  b.uint(1, 1); // P3: five satellites in the almanac frame
  b.sm(sc(v(R.gamma), p2(40)), 11);
  b.uint(0, 2); // P
  b.uint(unhealthy, 1); // ln (third string)
  b.sm(sc(-v(R.tauN), p2(30)), 22); // RINEX prints -tau_n
  b.sm(sc(v(R.dgd), p2(30)), 5);
  b.uint(Math.min(31, Math.max(0, Math.round(v(R.age)))), 5);
  b.uint(0, 1); // P4
  b.uint(0, 4); // FT
  b.uint((day % 1461) + 1, 11);
  b.uint(1, 2); // M: GLONASS-M
  b.uint(0, 1); // additional data (N_A, tau_c, N4, tau_GPS) not available
  b.uint(0, 11);
  b.uint(0, 32);
  b.uint(0, 5);
  b.uint(0, 22);
  b.uint(0, 1); // ln (fifth string)
  b.uint(0, 7);
  return b.toBytes();
}

/** CRC-24Q of RTCM 3 (polynomial 0x1864CFB). */
export function crc24q(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte << 16;
    for (let k = 0; k < 8; k++) {
      crc <<= 1;
      if (crc & 0x1000000) crc ^= 0x1864cfb;
    }
  }
  return crc & 0xffffff;
}

/** `D3`, 6 reserved bits, 10 bit length, the message, then the CRC over everything before it. */
export function frame(payload: Uint8Array): Uint8Array {
  if (payload.length > 1023) throw new RangeError('RTCM 3 message longer than 1023 bytes');
  const out = new Uint8Array(payload.length + 6);
  out[0] = 0xd3;
  out[1] = payload.length >> 8;
  out[2] = payload.length & 255;
  out.set(payload, 3);
  const crc = crc24q(out.subarray(0, payload.length + 3));
  out[payload.length + 3] = crc >> 16;
  out[payload.length + 4] = (crc >> 8) & 255;
  out[payload.length + 5] = crc & 255;
  return out;
}

/** How old a record may be at `now` and still be sent, by system (seconds since its epoch). */
export const MAX_AGE_S: Record<System, number> = { G: 4 * 3600, E: 3 * 3600, C: 3 * 3600, R: 3600 };

function usable(r: NavRecord): boolean {
  const h = at(r, K.health);
  switch (r.sys) {
    case 'G':
      return h === 0;
    case 'C':
      return h === 0;
    case 'R':
      return at(r, R.health) === 0;
    case 'E': {
      // I/NAV only (data source bit 0 or 2), both signals healthy and valid.
      const src = at(r, K.codes);
      return (src & 5) !== 0 && ((h >> 1) & 3) === 0 && ((h >> 7) & 3) === 0 && (h & 1) === 0 && ((h >> 6) & 1) === 0;
    }
  }
}

/** The newest usable record of every satellite that is not older than [MAX_AGE_S] and not from the future. */
export function selectCurrent(records: NavRecord[], nowMs: number): NavRecord[] {
  const best = new Map<string, NavRecord>();
  for (const r of records) {
    const age = (nowMs - r.epochMs) / 1000;
    if (age < -300 || age > MAX_AGE_S[r.sys] || !usable(r)) continue;
    const key = r.sys + r.prn;
    const have = best.get(key);
    if (!have || r.epochMs > have.epochMs) best.set(key, r);
  }
  return [...best.values()].sort((a, b) => SYSTEMS.indexOf(a.sys) - SYSTEMS.indexOf(b.sys) || a.prn - b.prn);
}

const ENCODERS: Record<System, (r: NavRecord) => Uint8Array> = { G: encode1019, R: encode1020, C: encode1042, E: encode1046 };

export type Built = { bytes: Uint8Array; counts: Record<System, number>; skipped: number };

/** The file: one frame per selected satellite. A record that does not fit its message (RangeError) is skipped and counted. */
export function buildHwAgnss(records: NavRecord[], nowMs: number): Built {
  const parts: Uint8Array[] = [];
  const counts: Record<System, number> = { G: 0, R: 0, E: 0, C: 0 };
  let skipped = 0;
  for (const r of selectCurrent(records, nowMs)) {
    try {
      parts.push(frame(ENCODERS[r.sys](r)));
      counts[r.sys] += 1;
    } catch (e) {
      if (!(e instanceof RangeError)) throw e;
      skipped += 1;
    }
  }
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    bytes.set(p, offset);
    offset += p.length;
  }
  return { bytes, counts, skipped };
}

/** The oldest record any system may still use: records before `nowMs` minus this are never selected. */
export const OLDEST_USABLE_MS = Math.max(...Object.values(MAX_AGE_S)) * 1000;

/** BKG's merged broadcast file of the UTC day that holds `dayMs` (`BRDC00WRD_S_<year><doy>0000_01D_MN.rnx.gz`, rebuilt every 15 minutes). */
export function bkgBrdcUrl(dayMs: number): string {
  const d = new Date(dayMs);
  const year = d.getUTCFullYear();
  const doy = String(Math.floor((dayMs - Date.UTC(year, 0, 1)) / 86400000) + 1).padStart(3, '0');
  return `${BKG_BRDC}/${year}/${doy}/BRDC00WRD_S_${year}${doy}0000_01D_MN.rnx.gz`;
}

/**
 * The BKG files that can hold records usable at `nowMs`: today's, and yesterday's while today is younger than [OLDEST_USABLE_MS] (just after
 * midnight UTC today's file holds a few minutes, or does not exist yet).
 */
export function bkgBrdcUrls(nowMs: number): string[] {
  const today = bkgBrdcUrl(nowMs);
  const yesterday = bkgBrdcUrl(nowMs - OLDEST_USABLE_MS);
  return yesterday === today ? [today] : [today, yesterday];
}

/** The name Huawei Health stores the file under and the watch pulls over the file service (seen in the 2026-10-25 capture). */
export const HW_AGNSS_FILE = 'HW_AGNSS_RTCM_33';

/** Size bounds of a file worth sending: about 7.4 to 8 KB in practice (120 satellites); outside these it is not this file. */
export const HW_AGNSS_MIN_BYTES = 512;
export const HW_AGNSS_MAX_BYTES = 16 * 1024;

/** Fewer satellites than this is a broken build (a short or stale input), not something to give a watch. */
export const HW_AGNSS_MIN_SATELLITES = 20;

/** The only RTCM messages the file may hold. */
export const HW_AGNSS_MESSAGES: readonly number[] = [1019, 1020, 1042, 1046];

/**
 * Why `bytes` is not fit to send as the `HW_AGNSS` file, or null when it is: size bounds, every byte inside a frame (`D3`, reserved bits zero,
 * CRC-24Q correct), only the four ephemeris messages, at least [HW_AGNSS_MIN_SATELLITES] frames. The Kotlin and Swift twins
 * (`AgpsPolicy.validateRtcm`) apply the same rules on the phone.
 */
export function validateHwAgnss(bytes: Uint8Array): string | null {
  if (bytes.length < HW_AGNSS_MIN_BYTES) return `file too small (${bytes.length} bytes)`;
  if (bytes.length > HW_AGNSS_MAX_BYTES) return `file too large (${bytes.length} bytes)`;
  const byte = (k: number) => bytes[k] ?? 0;
  let frames = 0;
  let i = 0;
  while (i < bytes.length) {
    if (byte(i) !== 0xd3 || (byte(i + 1) & 0xfc) !== 0) return `not an RTCM 3 frame at byte ${i}`;
    const length = ((byte(i + 1) & 3) << 8) | byte(i + 2);
    const end = i + 3 + length;
    if (length < 2 || end + 3 > bytes.length) return `RTCM frame at byte ${i} is cut off`;
    const crc = (byte(end) << 16) | (byte(end + 1) << 8) | byte(end + 2);
    if (crc24q(bytes.subarray(i, end)) !== crc) return `RTCM frame at byte ${i} fails its CRC`;
    const type = (byte(i + 3) << 4) | (byte(i + 4) >> 4);
    if (!HW_AGNSS_MESSAGES.includes(type)) return `unexpected RTCM message ${type} at byte ${i}`;
    frames += 1;
    i = end + 3;
  }
  if (frames < HW_AGNSS_MIN_SATELLITES) return `only ${frames} satellites (at least ${HW_AGNSS_MIN_SATELLITES} needed)`;
  return null;
}
