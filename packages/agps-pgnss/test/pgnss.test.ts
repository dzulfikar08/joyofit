import { describe, expect, test } from 'bun:test';

import { K, parseRinexNav, R, type NavRecord } from '../../agps-rtcm/src/rtcm';
import {
  BUNDLE_MAX_AGE_MS,
  decodeBundle,
  encodeBundle,
  gpsSecondsAt,
  PGNSS_FILES,
  PGNSS_SIZES,
  validatePgnssBundle,
  validatePgnssFile,
  type PgnssFile,
} from '../src/bundle';
import { elementsFromState, FIT_KEYS, fitElements, glonassPropagate, keplerPosition, lunisolarAcceleration, type Elements } from '../src/orbit';
import {
  bkgBrdmUrls,
  buildPgnss,
  codePredictionUrls,
  GATE,
  parseNavHeader,
  qualityGate,
  sp3Window,
  type BuildInput,
  type PgnssBuild,
} from '../src/pgnss';
import {
  assembleFile,
  buildExtra,
  decodeGlo,
  decodeKepler,
  EXTRA_BYTES,
  fileSize,
  packBds,
  packGal,
  packGlo,
  packGps,
  packQzs,
  readBlocks,
  type FileKind,
  type KeplerRecord,
} from '../src/records';
import { calendarToGps, interpolate, parseSp3 } from '../src/sp3';
import { BRDC_NAV, BRDM_HEADER, NOW, ULTRA_SP3 } from './fixture';

const nav = parseRinexNav(BRDC_NAV);
const header = parseNavHeader(BRDM_HEADER);
const [FROM, TO] = sp3Window(gpsSecondsAt(NOW));
const ultra = parseSp3(ULTRA_SP3, FROM, TO);
const input = (over: Partial<BuildInput> = {}): BuildInput => ({ nowMs: NOW, orbits: [ultra], nav, ion: header.ion, utc: header.utc, ...over });

function built(over: Partial<BuildInput> = {}): PgnssBuild {
  const result = buildPgnss(input(over));
  if ('problem' in result) throw new Error(result.problem);
  return result.build;
}

const record = (id: string, hhmm: string): NavRecord => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const r = nav.find((x) => `${x.sys}${String(x.prn).padStart(2, '0')}` === id && x.epochMs === Date.UTC(2026, 9, 25, h, m));
  if (!r) throw new Error(`no ${id} ${hhmm} in the fixture`);
  return r;
};

const elementsOf = (r: NavRecord): Elements => {
  const v = (i: number) => r.v[i] as number;
  return {
    sqrtA: v(K.sqrtA), e: v(K.e), i0: v(K.i0), omega0: v(K.omega0), omega: v(K.omega), m0: v(K.m0), deltaN: v(K.dn), omegaDot: v(K.omegaDot),
    idot: v(K.idot), cuc: v(K.cuc), cus: v(K.cus), crc: v(K.crc), crs: v(K.crs), cic: v(K.cic), cis: v(K.cis), toe: v(K.toe),
  };
};

const dist = (a: Float64Array, b: Float64Array) => Math.hypot((a[0] as number) - (b[0] as number), (a[1] as number) - (b[1] as number), (a[2] as number) - (b[2] as number));

describe('SP3', () => {
  test('reads the trimmed CODE file: GPS time, 1800 s, 20 satellites, km to m, us to s', () => {
    expect(ultra.step).toBe(1800);
    expect(ultra.sats.size).toBe(20);
    // The build reads only from 1 h before the first slot base (03:00 GPS), though the cut file starts at 23:00.
    expect(ultra.t0).toBe(FROM);
    expect(FROM).toBe(calendarToGps(Date.UTC(2026, 9, 25, 3)));
    // Interpolation is exact on an epoch.
    const t = calendarToGps(Date.UTC(2026, 9, 25, 6));
    const out = new Float64Array(6);
    expect(interpolate(ultra, 'G01', t, out)).toBe(true);
    const line = ULTRA_SP3.split('\n*  2026 10 25  6  0  0.00000000\n')[1]?.split('\n')[0] as string;
    expect(line.startsWith('PG01')).toBe(true);
    expect(out[0]).toBeCloseTo(Number(line.slice(4, 18)) * 1000, 6);
    expect(Math.hypot(out[3] as number, out[4] as number, out[5] as number)).toBeGreaterThan(2500); // ECEF speed of a GPS satellite, m/s
    expect(interpolate(ultra, 'G01', TO + 7200, out)).toBe(false);
    expect(interpolate(ultra, 'G03', t, out)).toBe(false);
  });

  test('refuses a file that is not in GPS time, and reads 999999.999999 as no clock', () => {
    expect(() => parseSp3(ULTRA_SP3.replace('%c M  cc GPS', '%c M  cc UTC'))).toThrow('time system UTC');
    const noClock = ULTRA_SP3.replace(/^(PG01.{42}).{14}/m, '$1 999999.999999');
    const parsed = parseSp3(noClock);
    expect(Number.isNaN(parsed.sats.get('G01')?.clk[0] as number)).toBe(true);
  });
});

describe('ICD orbit models', () => {
  const g01 = elementsOf(record('G01', '06:00'));

  test('the analytic partial derivatives match finite differences', () => {
    const jac = new Float64Array(3 * FIT_KEYS.length);
    const p0 = new Float64Array(3);
    const p1 = new Float64Array(3);
    const p2 = new Float64Array(3);
    for (const tk of [-7000, 0, 5400]) {
      keplerPosition(g01, tk, 'G', p0, jac);
      FIT_KEYS.forEach((key, i) => {
        const h = Math.max(Math.abs(g01[key]) * 1e-6, key.startsWith('c') ? 1e-9 : 1e-12);
        keplerPosition({ ...g01, [key]: g01[key] + h }, tk, 'G', p1);
        keplerPosition({ ...g01, [key]: g01[key] - h }, tk, 'G', p2);
        for (let ax = 0; ax < 3; ax++) {
          const numeric = ((p1[ax] as number) - (p2[ax] as number)) / (2 * h);
          expect(Math.abs((jac[3 * i + ax] as number) - numeric)).toBeLessThan(1e-4 * Math.max(1, Math.abs(numeric)));
        }
      });
    }
  });

  test('a real broadcast record evaluated at its toe lands within a few metres of CODE (broadcast vs precise orbit)', () => {
    const p = new Float64Array(3);
    const truth = new Float64Array(6);
    keplerPosition(g01, 0, 'G', p);
    expect(interpolate(ultra, 'G01', calendarToGps(Date.UTC(2026, 9, 25, 6)), truth)).toBe(true);
    expect(dist(p, truth)).toBeLessThan(5);
  });

  test('the fit recovers an orbit drawn from known elements, from osculating starting values', () => {
    const tk = Float64Array.from({ length: 49 }, (_, j) => (j - 24) * 300);
    const obs = new Float64Array(147);
    const p = new Float64Array(3);
    tk.forEach((t, j) => {
      keplerPosition(g01, t, 'G', p);
      obs.set(p, 3 * j);
    });
    // Velocity at toe by a central difference, then osculating elements as the start.
    const s = new Float64Array(6);
    const a = new Float64Array(3);
    const b = new Float64Array(3);
    keplerPosition(g01, 0, 'G', p);
    keplerPosition(g01, -1, 'G', a);
    keplerPosition(g01, 1, 'G', b);
    s.set(p);
    for (let ax = 0; ax < 3; ax++) s[3 + ax] = ((b[ax] as number) - (a[ax] as number)) / 2;
    const fit = fitElements(elementsFromState(s, g01.toe, 'G'), tk, obs, 'G');
    expect(fit).not.toBeNull();
    expect(fit?.rms).toBeLessThan(0.01);
    expect(fit?.el.sqrtA).toBeCloseTo(g01.sqrtA, 3);
  });

  test('luni-solar accelerations agree with the GLONASS broadcast values, and the ICD propagation follows CODE for 15 minutes', () => {
    for (const id of ['R02', 'R03', 'R04', 'R05', 'R06', 'R07']) {
      const r = record(id, '04:45');
      const v = (i: number) => r.v[i] as number;
      const gps = calendarToGps(r.epochMs) + 18;
      const state = Float64Array.of(v(R.x), v(R.y), v(R.z), v(R.x + 1), v(R.y + 1), v(R.z + 1));
      const acc = new Float64Array(3);
      lunisolarAcceleration(state, gps, 18, acc);
      // One unit of the 5-bit field is 2^-30 km/s^2; the broadcast value is rounded to it.
      for (const [ax, i] of [R.x + 2, R.y + 2, R.z + 2].entries()) expect(Math.abs((acc[ax] as number) - v(i))).toBeLessThan(1.6 * 2 ** -30);
      const p = new Float64Array(3);
      const truth = new Float64Array(6);
      glonassPropagate(state, Float64Array.of(v(R.x + 2), v(R.y + 2), v(R.z + 2)), 900, p);
      expect(interpolate(ultra, id, gps + 900, truth)).toBe(true);
      expect(dist(p, truth)).toBeLessThan(25); // broadcast state error plus 15 min of propagation
    }
  });
});

describe('record layouts (FORMAT.md 3)', () => {
  const g01 = elementsOf(record('G01', '06:00'));
  const rec: KeplerRecord = { prn: 1, week: 2442, el: g01, clock: { af0: 1.4205e-4, af1: -8.41e-12, af2: 0, tgd: -8.85e-9 } };

  test('GPS: fixed values where Huawei writes them and every field read back within its resolution', () => {
    const bytes = packGps(rec);
    const d = new DataView(bytes.buffer);
    expect(bytes.length).toBe(80);
    expect(d.getUint8(0)).toBe(0);
    expect(d.getUint16(2, true)).toBe(2442); // full week
    expect(d.getUint8(4)).toBe(0); // ura
    expect(d.getUint16(6, true)).toBe(0); // iode
    expect(d.getUint16(0x48, true)).toBe(21600 >> 4); // toc, 16 s units
    expect(d.getUint16(0x4a, true)).toBe(21600 >> 4); // toe
    expect(d.getUint8(0x46)).toBe(0); // health
    expect(d.getUint8(0x4d)).toBe(0xff); // aodo
    const back = decodeKepler('G', bytes);
    expect(back.prn).toBe(1);
    expect(back.el.toe).toBe(21600);
    expect(back.el.sqrtA).toBeCloseTo(g01.sqrtA, 5);
    expect(back.el.e).toBeCloseTo(g01.e, 9);
    expect(back.el.m0).toBeCloseTo(g01.m0, 8);
    expect(back.el.crs).toBeCloseTo(g01.crs, 1);
    expect(back.clock.af0).toBeCloseTo(1.4205e-4, 9);
    expect(back.clock.tgd).toBeCloseTo(-8.85e-9, 9);
  });

  test('QZSS, Galileo and BeiDou put the same orbit at their own offsets and scales', () => {
    const p1 = new Float64Array(3);
    const p2 = new Float64Array(3);
    for (const [c, pack, size] of [
      ['J', packQzs, 76],
      ['E', packGal, 76],
      ['C', packBds, 92],
    ] as const) {
      const bytes = pack(rec);
      expect(bytes.length).toBe(size);
      const back = decodeKepler(c, bytes);
      expect(back.el.toe).toBe(21600);
      for (const tk of [-7200, 0, 7200]) {
        keplerPosition(g01, tk, c, p1);
        keplerPosition(back.el, tk, c, p2);
        expect(dist(p1, p2)).toBeLessThan(0.5);
      }
    }
    const gal = new DataView(packGal(rec).buffer);
    expect(gal.getUint32(0x04, true)).toBe(360); // toc in minutes
    expect(gal.getUint32(0x18, true)).toBe(360);
    const bds = new DataView(packBds(rec).buffer);
    expect(bds.getUint32(0x08, true)).toBe(21600 >> 3);
    expect(bds.getUint16(0x02, true)).toBe((21600 >> 3) & 0xffc0); // iod
    expect(bds.getInt16(0x16, true)).toBe(Math.trunc(-8.85e-9 * 1e10)); // TGD1 in 0.1 ns
  });

  test("a value outside its field is a RangeError (Huawei's range check drops the satellite)", () => {
    expect(() => packGps({ ...rec, el: { ...g01, crs: 1100 } })).toThrow(RangeError); // s16 at 2^-5 m: at most 1024 m
    expect(() => packGps({ ...rec, el: { ...g01, idot: 3e-9 } })).toThrow(RangeError); // 14 bits
    expect(() => packBds({ ...rec, el: { ...g01, crs: 2100 } })).toThrow(RangeError); // 18 bits at 2^-6 m
  });

  test('GLONASS: p1 = 1, ICD scales, read back exactly', () => {
    const state = Float64Array.of(15000.5, -20000.25, 3000.125, 1.5, -2.25, 0.75);
    const bytes = packGlo({ slot: 5, tb: 19, tauN: -1.5e-4, gammaN: 9.1e-13, state, acc: Float64Array.of(2 ** -30 * 3, 0, -(2 ** -30)) });
    const d = new DataView(bytes.buffer);
    expect(bytes.length).toBe(52);
    expect([d.getUint8(0), d.getUint16(2, true), d.getUint8(0x0c)]).toEqual([4, 19, 1]);
    expect(d.getInt32(0x10, true)).toBe(15000.5 * 2048);
    expect(d.getInt8(0x18)).toBe(3);
    const back = decodeGlo(bytes);
    expect([...back.state]).toEqual([...state]);
    expect(back.tauN).toBeCloseTo(-1.5e-4, 9);
    expect(() => packGlo({ slot: 5, tb: 19, tauN: 0, gammaN: 0, state, acc: Float64Array.of(2 ** -30 * 16, 0, 0) })).toThrow(RangeError);
  });

  test('file sizes are the ones of the 2026-10-25 transfer, and the header packs offsets from 1008', () => {
    expect((['G', 'C', 'R', 'E', 'J'] as FileKind[]).map(fileSize)).toEqual([93312, 209808, 361584, 99648, 28512]);
    expect(EXTRA_BYTES).toBe(6248);
    expect(PGNSS_SIZES).toEqual([93312, 209808, 361584, 99648, 28512, 6248]);
    const slots = Array.from({ length: 36 }, (_, i) => ({ time: 1000 + 7200 * i, blocks: [i === 0 ? [packGps(rec)] : []] }));
    const file = assembleFile('G', slots);
    const d = new DataView(file.buffer);
    expect([d.getUint32(0, true), d.getUint32(4, true), d.getUint32(8, true)]).toEqual([1000, 1008, 2564]);
    expect([d.getUint32(12 * 35, true), d.getUint32(12 * 35 + 4, true)]).toEqual([1000 + 7200 * 35, 1008 + 35 * 2564]);
    expect(file.subarray(12 * 36, 1008).every((b) => b === 0)).toBe(true);
    expect([file[1008], file[1009], file[1010], file[1011]]).toEqual([1, 0, 0, 0]);
    expect(readBlocks('G', file)[0]?.records[0]).toEqual(packGps(rec));
    expect(() => assembleFile('G', slots.slice(1))).toThrow('35 slots');
    expect(() => assembleFile('J', [{ time: 0, blocks: [Array.from({ length: 11 }, () => packQzs(rec))] }, ...slots.slice(1)])).toThrow('11 records');
  });

  test('EXTRA: GPS UTC and Klobuchar raw integers, zero sections, the trailer', () => {
    const x = buildExtra({ utc: header.utc, ion: header.ion, start: 1476936000, end: 1477202400, leap: 18 });
    expect(x.length).toBe(6248);
    // A0 -2^-30 s, A1 -3 * 2^-50, tot 147456 / 4096, WNt 2442 mod 256, dtLS 18, WNlsf 1929 mod 256, dtLSF 18, DN 7.
    expect([...x.subarray(0, 16)]).toEqual([0xff, 0xff, 0xff, 0xff, 0xfd, 0xff, 0xff, 0xff, 36, 138, 18, 137, 18, 7, 0, 0]);
    // alpha 18, 0, -2, 1 (2^-30, 2^-27, 2^-24, 2^-24 s); beta 56, -1, -5, 2 (2^11, 2^14, 2^16, 2^16 s).
    expect([...new Int8Array(x.buffer, 16, 8)]).toEqual([18, 0, -2, 1, 56, -1, -5, 2]);
    expect(x.subarray(24, 6232).every((b) => b === 0)).toBe(true);
    const t = new DataView(x.buffer, 6232);
    expect([t.getUint32(0, true), t.getUint32(4, true), t.getUint32(8, true), t.getUint8(12)]).toEqual([1476936000, 1477202400, 0, 18]);
    expect(buildExtra({ utc: null, ion: null, start: 1, end: 2, leap: 18 }).subarray(0, 24).every((b) => b === 0)).toBe(true);
  });
});

describe('build from real data (fixture)', () => {
  const build = built();

  test('six files of the exact sizes in pull order, a bundle that passes the check, slots past the orbit data empty', () => {
    expect(build.files.map((f) => f.name)).toEqual(PGNSS_FILES.map((f) => f.name));
    expect(build.files.map((f) => f.bytes.length)).toEqual([...PGNSS_SIZES]);
    expect(validatePgnssBundle(build.bundle, NOW)).toBeNull();
    // 2026-10-25 05:30 UTC = GPS 05:30:18; slots start at the next 2 h boundary, 06:00 GPS.
    expect(build.base).toBe(calendarToGps(Date.UTC(2026, 9, 25, 4)));
    const gps = readBlocks('G', build.files[0]?.bytes as Uint8Array);
    expect(gps[0]?.time).toBe(build.base + 7200);
    expect(gps.map((b) => b.records.length)).toEqual([8, 8, 8, 8, 8, 8, 8, ...new Array(29).fill(0)]);
    expect(build.coveredUntil).toBe(build.base + 7200 * 8);
    const glo = readBlocks('R', build.files[2]?.bytes as Uint8Array);
    expect(glo).toHaveLength(288);
    expect(glo[0]?.time).toBe(build.base + 18 + 3600);
    expect(glo[0]?.records.length).toBe(6);
    // No orbit source carries BeiDou or QZSS: their files are well-formed and empty.
    for (const i of [1, 4]) expect(readBlocks(PGNSS_FILES[i]?.kind as FileKind, build.files[i]?.bytes as Uint8Array).every((b) => b.records.length === 0)).toBe(true);
  });

  test('quality gate: decoded records stay within metres of the source orbit at the slot centre and at ±2 h', () => {
    const { G, E, R: glo } = build.report;
    expect([G.records, E.records, glo.records]).toEqual([56, 42, 402]);
    for (const r of [G, E]) {
      expect(r.centre.max).toBeLessThan(1);
      expect(r.edge.max).toBeLessThan(GATE.kepler.maxM);
      expect(r.all.rms).toBeLessThan(GATE.kepler.rmsM);
    }
    expect(glo.edge.max).toBeLessThan(GATE.glonass.maxM);
    expect(glo.edge.rms).toBeLessThan(GATE.glonass.rmsM);
  });

  test('the first GPS slot agrees with the real broadcast ephemeris of the same toe (orbit within metres, clock within nanoseconds)', () => {
    const first = readBlocks('G', build.files[0]?.bytes as Uint8Array)[0]?.records ?? [];
    const p1 = new Float64Array(3);
    const p2 = new Float64Array(3);
    for (const rec of first) {
      const ours = decodeKepler('G', rec);
      const brdc = record(`G${String(ours.prn).padStart(2, '0')}`, '06:00');
      let max = 0;
      for (let tk = -7200; tk <= 7200; tk += 900) {
        keplerPosition(ours.el, tk, 'G', p1);
        keplerPosition(elementsOf(brdc), tk, 'G', p2);
        max = Math.max(max, dist(p1, p2));
      }
      expect(max).toBeLessThan(6); // broadcast orbit error and the antenna offset (SP3 is the centre of mass)
      expect(Math.abs(ours.clock.af0 - (brdc.v[K.af0] as number))).toBeLessThan(10e-9);
      expect(Math.abs(ours.clock.tgd - (brdc.v[K.tgd] as number))).toBeLessThanOrEqual(2 ** -31);
    }
  });

  test('the GLONASS sub-block at 04:45 UTC agrees with the broadcast records of that tb', () => {
    const blocks = readBlocks('R', build.files[2]?.bytes as Uint8Array);
    for (const rec of blocks[3]?.records ?? []) {
      const ours = decodeGlo(rec);
      expect(ours.tb).toBe((4 * 3600 + 45 * 60 + 3 * 3600) / 900);
      const brdc = record(`R${String(ours.slot).padStart(2, '0')}`, '04:45');
      const v = (i: number) => brdc.v[i] as number;
      expect(dist(ours.state.map((x) => x * 1000), Float64Array.of(v(R.x) * 1000, v(R.y) * 1000, v(R.z) * 1000))).toBeLessThan(15);
      expect(Math.abs(ours.tauN + v(R.tauN))).toBeLessThan(30e-9);
    }
  });

  test('the gate refuses a file whose record no longer matches its orbit', () => {
    const files = new Map(build.files.slice(0, 5).map((f, i) => [PGNSS_FILES[i]?.kind as FileKind, Uint8Array.from(f.bytes)]));
    const gps = files.get('G') as Uint8Array;
    gps[1008 + 4 + 0x0b] = (gps[1008 + 4 + 0x0b] as number) ^ 0x01; // M0's top byte of the first record
    const report = structuredClone(build.report);
    expect(qualityGate(files, [ultra], report)).toMatch(/^G: position error RMS .* exceeds the gate/);
  });

  test('refuses inputs that are too thin, and carries on without the ionosphere/UTC header', () => {
    expect(buildPgnss(input({ orbits: [] }))).toEqual({ problem: 'GPS covers 0 slots, fewer than 6' });
    const noGlonass = buildPgnss(input({ nav: nav.filter((r) => r.sys !== 'R') }));
    expect('problem' in noGlonass && noGlonass.problem).toBe('R: 0 records in the first slot, fewer than 6');
    const late = buildPgnss(input({ nowMs: NOW + 6 * 3600_000 }));
    expect('problem' in late && late.problem).toMatch(/fewer than/);
    const bare = built({ ion: null, utc: null });
    expect(bare.files[5]?.bytes.subarray(0, 24).every((b) => b === 0)).toBe(true);
    expect(validatePgnssBundle(bare.bundle, NOW)).toBeNull();
  });

  test('navigation header: Klobuchar, GPS UTC and leap seconds; no UTC from a LEAP SECONDS line with dtLS alone', () => {
    expect(header).toEqual({
      ion: { alpha: [1.6764e-8, 0, -1.1921e-7, 5.9605e-8], beta: [1.1469e5, -1.6384e4, -3.2768e5, 1.3107e5] },
      utc: { a0: -9.3132257462e-10, a1: -2.664535259e-15, tot: 147456, wnt: 2442, dtls: 18, dtlsf: 18, wnlsf: 1929, dn: 7 },
      leap: 18,
    });
    const bkgR = `     3.05           NAVIGATION DATA     MIXED               RINEX VERSION / TYPE
    18                                                      LEAP SECONDS
                                                            END OF HEADER
`;
    expect(parseNavHeader(bkgR)).toEqual({ ion: null, utc: null, leap: 18 });
    expect(parseNavHeader('')).toEqual({ ion: null, utc: null, leap: null });
  });

  test('source URLs', () => {
    expect(codePredictionUrls(NOW)).toEqual([
      'https://download.aiub.unibe.ch/CODE/COD0OPSPRD_20262970000_05D_05M_ORB.SP3',
      'https://download.aiub.unibe.ch/CODE/COD0OPSPRD_20262960000_05D_05M_ORB.SP3',
    ]);
    expect(bkgBrdmUrls(NOW)[0]).toBe('https://igs.bkg.bund.de/root_ftp/IGS/BRDC/2026/297/BRDM00DLR_S_20262970000_01D_MN.rnx.gz');
  });
});

describe('bundle and its check', () => {
  const build = built();
  const files = build.files;
  /** The bundle with one byte of file `i` XORed with `mask`. */
  const tamper = (i: number, at: number, mask: number): Uint8Array => {
    const copy: PgnssFile[] = files.map((f) => ({ name: f.name, bytes: Uint8Array.from(f.bytes) }));
    const bytes = (copy[i] as PgnssFile).bytes;
    bytes[at] = (bytes[at] as number) ^ mask;
    return encodeBundle(copy);
  };

  test('round trip and Huawei\'s GPS seconds', () => {
    const back = decodeBundle(build.bundle);
    expect(Array.isArray(back) && back.map((f) => [f.name, f.bytes.length])).toEqual(files.map((f) => [f.name, f.bytes.length]));
    expect([...build.bundle.subarray(0, 6)]).toEqual([0x4a, 0x46, 0x50, 0x47, 1, 6]);
    expect(build.bundle[6]).toBe('HW_PGNSS_GPS'.length);
    expect(gpsSecondsAt(Date.UTC(2026, 9, 25, 5, 30, 0, 999))).toBe(Math.floor(Date.UTC(2026, 9, 25, 5, 30) / 1000) - 315964782);
    expect(BUNDLE_MAX_AGE_MS).toBe(6 * 3600_000);
  });

  test('refuses a broken frame, order, name or size', () => {
    const b = Uint8Array.from(build.bundle);
    b[0] = 0x58;
    expect(validatePgnssBundle(b, NOW)).toBe('bundle magic is not JFPG');
    const extended = new Uint8Array(build.bundle.length + 1);
    extended.set(build.bundle);
    expect(validatePgnssBundle(extended, NOW)).toBe('1 bytes after the last file');
    expect(validatePgnssBundle(build.bundle.subarray(0, build.bundle.length - 1), NOW)).toBe('bundle ends inside HW_PGNSS_EXTRA');
    const swapped = encodeBundle([files[1], files[0], ...files.slice(2)] as PgnssFile[]);
    expect(validatePgnssBundle(swapped, NOW)).toBe('file 1 is HW_PGNSS_BDS, want HW_PGNSS_GPS');
    expect(validatePgnssBundle(encodeBundle(files.slice(0, 5)), NOW)).toBe('bundle holds 5 files, want 6');
    const short = encodeBundle(files.map((f, i) => (i === 5 ? { name: f.name, bytes: f.bytes.subarray(1) } : f)));
    expect(validatePgnssBundle(short, NOW)).toBe('HW_PGNSS_EXTRA: 6247 bytes, want 6248');
  });

  test('refuses a header that breaks the layout, and a block over capacity', () => {
    expect(validatePgnssBundle(tamper(0, 4, 0x01), NOW)).toBe('HW_PGNSS_GPS: header entry 0 has the wrong offset');
    expect(validatePgnssBundle(tamper(3, 12 * 2 + 8, 0xff), NOW)).toBe('HW_PGNSS_GALILEO: header entry 2 has the wrong size');
    expect(validatePgnssBundle(tamper(2, 12 * 5, 0x01), NOW)).toBe('HW_PGNSS_GLONASS: header entry 5 time is not 7200 s after the previous');
    expect(validatePgnssBundle(tamper(4, 12 * 40, 0x01), NOW)).toBe('HW_PGNSS_QZS: unused header entries are not zero');
    // Slot 1 holds 8 GPS records, sub-block 7 holds 6 GLONASS records: 8 ^ 41 = 33, 6 ^ 31 = 25.
    expect(validatePgnssBundle(tamper(0, 1008 + 2564, 41), NOW)).toBe('HW_PGNSS_GPS: block at 3572 holds 33 records, more than 32');
    expect(validatePgnssBundle(tamper(2, 1008 + 1252 * 7, 31), NOW)).toBe('HW_PGNSS_GLONASS: block at 9772 holds 25 records, more than 24');
  });

  test('the first slot must be within 2 h of the build time; BeiDou counts without its 14 s', () => {
    expect(validatePgnssBundle(build.bundle, NOW - 3 * 3600_000)).toMatch(/first slot is not within 2 h/);
    expect(validatePgnssBundle(build.bundle, NOW + 3 * 3600_000)).toMatch(/first slot is not within 2 h/);
    // A build 5 s after a 2 h boundary: the BeiDou first slot is 7214 - 5 s ahead, which passes once the 14 s are taken off.
    const atBoundary = (build.base + 5 - 18 + 315964800) * 1000;
    const bds = files[1]?.bytes as Uint8Array;
    expect(validatePgnssFile('C', bds, gpsSecondsAt(atBoundary))).toBeNull();
    expect(new DataView(bds.buffer, bds.byteOffset).getUint32(0, true) - gpsSecondsAt(atBoundary)).toBe(7209);
  });
});
