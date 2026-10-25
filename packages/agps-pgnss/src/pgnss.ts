// Builds the six files a Huawei watch pulls for `HW_PGNSS_PRED` (tag `com.huawei.higeo_dataModule_PGNSSConfig?type=HW_EEV2/HW_PGNSS_PRED;`,
// Watch Fit 4 Pro, download version 3) from public data, laid out like Huawei Health 17.0.8.300 writes them (`~/re/agps/FORMAT.md`, 3-day
// mode, no gzip), and checks them before anything is served.
//
// What Huawei Health does with its own seed, done here with CODE's public orbit predictions: for every 2 h slot of the next 3 days, sample
// the predicted orbit over toe ± 2 h every 300 s (49 epochs) and least-squares fit the ICD broadcast elements (GPS, Galileo; QZSS and BeiDou
// when the orbit source carries them), clock terms from the product's clocks; GLONASS gets an ICD state vector every 900 s. Every record is
// decoded back from its bytes and compared with the source orbit (the quality gate); a build whose errors exceed the gate is refused.
//
// Pure code, no I/O: the lab CLI (`scripts/agps-pgnss.ts`) and the Worker (`server/src/agpsPgnss.ts`) fetch the inputs. LAB USE ONLY: the
// watch validates nothing and nobody has confirmed what its GNSS chip accepts; data source terms and reasoning: docs/agps.md "PGNSS lab path".

import { BKG_BRDC, K, R, selectCurrent, type NavRecord } from '../../agps-rtcm/src/rtcm';
import { BDS_SLOT_SHIFT, encodeBundle, gpsSecondsAt, HH_LEAP_SECONDS, PGNSS_FILES, type PgnssFile } from './bundle';
import {
  elementsFromState,
  fitElements,
  glonassPropagate,
  keplerPosition,
  lunisolarAcceleration,
  type Constellation,
  type Elements,
} from './orbit';
import {
  assembleFile,
  buildExtra,
  decodeGlo,
  decodeKepler,
  GLO_SUBBLOCKS,
  LAYOUT,
  PACKERS,
  packGlo,
  readBlocks,
  SLOTS,
  SLOT_SECONDS,
  type Clock,
  type FileKind,
  type GpsIon,
  type GpsUtc,
  type Slot,
} from './records';
import { calendarToGps, clockAt, interpolate, type Sp3 } from './sp3';

// ---------------------------------------------------------------------------------------------------------------------------------------
// Sources

/**
 * CODE (Center for Orbit Determination in Europe, AIUB Bern) ultra-rapid GPS+GLONASS+Galileo orbits, static name for the latest solution:
 * 48 h at 5 min, about 23 h observed and 25 h predicted, renewed every 6 h about an hour after the data (00:07 UTC on 2026-10-25).
 */
export const CODE_ULTRA_URL = 'https://download.aiub.unibe.ch/CODE/COD0OPSULT.SP3';

const CODE = 'https://download.aiub.unibe.ch/CODE';

const dayPath = (dayMs: number): { year: number; doy: string } => {
  const year = new Date(dayMs).getUTCFullYear();
  return { year, doy: String(Math.floor((dayMs - Date.UTC(year, 0, 1)) / 86400000) + 1).padStart(3, '0') };
};

/**
 * CODE 5-day GPS+GLONASS+Galileo orbit predictions at 5 min (`COD0OPSPRD_<year><doy>0000_05D_05M_ORB.SP3`, named for the last observed day,
 * starting at 00:00 of the next one, published with the midnight ultra-rapid solution). Yesterday's name (today's predictions), then the
 * day before (still 4 days ahead of today). The static `COD0OPSPRD_05D.SP3` lagged a day behind these on 2026-10-25, so it is not used.
 */
export function codePredictionUrls(nowMs: number): string[] {
  return [1, 2].map((days) => {
    const { year, doy } = dayPath(nowMs - days * 86400000);
    return `${CODE}/COD0OPSPRD_${year}${doy}0000_05D_05M_ORB.SP3`;
  });
}

/**
 * DLR's merged daily broadcast file at BKG (`BRDM00DLR_S_<year><doy>0000_01D_MN.rnx.gz`, published the next day around 03:00 UTC); its header
 * carries the GPS ionosphere and UTC parameters and leap seconds that BKG's 15-minute file lacks. Yesterday's, then the day before.
 */
export function bkgBrdmUrls(nowMs: number): string[] {
  return [1, 2].map((days) => {
    const { year, doy } = dayPath(nowMs - days * 86400000);
    return `${BKG_BRDC}/${year}/${doy}/BRDM00DLR_S_${year}${doy}0000_01D_MN.rnx.gz`;
  });
}

export type NavHeader = { ion: GpsIon | null; utc: GpsUtc | null; leap: number | null };

/**
 * GPS ionosphere and UTC parameters and leap seconds from a RINEX 3 navigation header; null for what the header lacks. UTC needs the GPUT line
 * and all four LEAP SECONDS fields (a line with dtLS alone, like BKG's `_R_` file has, gives `leap` but no UTC: a missing dtLSF must not read as 0).
 */
export function parseNavHeader(text: string): NavHeader {
  const field = (s: string): number => (s.trim() === '' ? NaN : Number(s.trim().replace(/[dD]/, 'e')));
  const finite = (v: number[]): boolean => v.every(Number.isFinite);
  let alpha: number[] = [];
  let beta: number[] = [];
  let gput: number[] = [];
  let leapLine: number[] = [];
  for (const line of text.split('\n')) {
    const label = line.slice(60).trim();
    if (label === 'END OF HEADER') break;
    if (label === 'IONOSPHERIC CORR' && line.startsWith('GPSA')) alpha = [0, 1, 2, 3].map((i) => field(line.slice(5 + 12 * i, 17 + 12 * i)));
    else if (label === 'IONOSPHERIC CORR' && line.startsWith('GPSB')) beta = [0, 1, 2, 3].map((i) => field(line.slice(5 + 12 * i, 17 + 12 * i)));
    else if (label === 'TIME SYSTEM CORR' && line.startsWith('GPUT')) gput = [field(line.slice(5, 22)), field(line.slice(22, 38)), field(line.slice(38, 45)), field(line.slice(45, 50))];
    else if (label === 'LEAP SECONDS') leapLine = [0, 1, 2, 3].map((i) => field(line.slice(6 * i, 6 * i + 6)));
  }
  const [a0, a1, tot, wnt] = gput as [number, number, number, number];
  const [dtls, dtlsf, wnlsf, dn] = leapLine as [number, number, number, number];
  return {
    ion: alpha.length === 4 && beta.length === 4 && finite(alpha) && finite(beta) ? { alpha: alpha as GpsIon['alpha'], beta: beta as GpsIon['beta'] } : null,
    utc: gput.length === 4 && leapLine.length === 4 && finite(gput) && finite(leapLine) ? { a0, a1, tot, wnt, dtls, dtlsf, wnlsf, dn } : null,
    leap: Number.isFinite(dtls) ? dtls : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Build

/** Fit sampling (Huawei Health's PredictOrbClk: span 14400 s, step 300 s, 49 epochs, the middle one is toe). */
export const FIT_HALF_SPAN_S = 7200;
export const FIT_STEP_S = 300;
const FIT_POINTS = (2 * FIT_HALF_SPAN_S) / FIT_STEP_S + 1;
const GLO_STEP_S = 900;

/**
 * The quality gate. A Kepler record whose decoded orbit is more than [KEPLER_RECORD_MAX_M] from the source at any of its 49 epochs is not
 * written (Huawei's fitter rejects a sigma above 1.0 the same way); a GLONASS record more than [GLO_RECORD_MAX_M] off within ±450 s of its
 * epoch (the next record takes over after that) is not written. A whole build is refused when, decoded from the finished files, a
 * constellation's RMS or maximum error exceeds [GATE]. Broadcast ephemerides are fitted at the decimetre level (GPS URE about 0.5 m), so
 * metres is generous for an honest fit and still catches a broken one long before it could mislead a receiver by tens of metres.
 */
export const KEPLER_RECORD_MAX_M = 5;
export const GLO_RECORD_MAX_M = 10;

/** GPS seconds of product epochs a build at `builtGps` reads (first slot base - 1 h to the last slot's fit span + 1 h); parse only these. */
export function sp3Window(builtGps: number): [number, number] {
  const base = Math.floor(builtGps / SLOT_SECONDS) * SLOT_SECONDS;
  return [base - 3600, base + SLOT_SECONDS * SLOTS + FIT_HALF_SPAN_S + 3600];
}
export const GATE = {
  kepler: { rmsM: 1.5, maxM: KEPLER_RECORD_MAX_M },
  glonass: { rmsM: 3, maxM: GLO_RECORD_MAX_M },
} as const;

/**
 * Content floor: fewer records than this in the first slot (GLONASS: first sub-block) means a short or broken input (a real build on
 * 2026-10-25 had 31 GPS, 28 Galileo, 21 GLONASS); fewer satellites are still correct data, so the floor only catches inputs that are nearly empty.
 */
export const MIN_FIRST_SLOT: Record<'G' | 'E' | 'R', number> = { G: 8, E: 6, R: 6 };
/** At least this many GPS slots (2 h each, so 12 h of data) must be covered, or the build is refused. */
export const MIN_GPS_SLOTS = 6;

export type BuildInput = {
  nowMs: number;
  /** Orbit products in order of preference (freshest first); each satellite and slot takes the first that covers it. */
  orbits: Sp3[];
  /** Broadcast records (BKG): health, group delays, and the clock datum each constellation's broadcast clocks use. */
  nav: NavRecord[];
  ion: GpsIon | null;
  utc: GpsUtc | null;
};

export type ErrorStats = { rms: number; max: number; n: number };

export type SystemReport = {
  /** Slots (header entries) with at least one record. */
  slots: number;
  /** Records written. */
  records: number;
  /** Candidate records not written (range check, fit or gate failure, missing clock). */
  dropped: number;
  /** Decoded-record position error against the source orbit [m]: at the record epoch, at ±2 h (GLONASS: ±450 s), over all fit epochs. */
  centre: ErrorStats;
  edge: ErrorStats;
  all: ErrorStats;
  /** Records per source (index into BuildInput.orbits). */
  bySource: number[];
};

export type PgnssBuild = {
  files: PgnssFile[];
  bundle: Uint8Array;
  /** GPS seconds: build time (Huawei's conversion), first slot base, end of the last covered GPS slot's validity. */
  builtGps: number;
  base: number;
  coveredUntil: number;
  report: Record<FileKind, SystemReport>;
};

const SYS_SHIFT: Record<Constellation, number> = { G: 0, J: 0, E: 0, C: BDS_SLOT_SHIFT };
const WEEK = 604800;

/** Broadcast clock of a nav record at GPS time `t` [s] (GLONASS: the -tauN + gammaN (t - tb) bias). */
function navClock(r: NavRecord, t: number): number {
  const v = (i: number) => r.v[i] ?? 0;
  if (r.sys === 'R') return v(R.tauN) + v(R.gamma) * (t - (calendarToGps(r.epochMs) + HH_LEAP_SECONDS));
  const dt = t - calendarToGps(r.epochMs) - (r.sys === 'C' ? BDS_SLOT_SHIFT : 0);
  return v(K.af0) + v(K.af1) * dt + v(K.af2) * dt * dt;
}

/**
 * Per orbit product and satellite: (product clock - broadcast clock) at the build time `t`. Subtracting it puts the product's predicted clock
 * on the satellite's own broadcast clock at `t` (GLONASS time for tauN, GST and the I/NAV E1/E5b reference for Galileo, the L1/L2 reference
 * TGD belongs to for GPS), and the product supplies how it evolves over the 3 days. A satellite without both clocks at `t` gets no records.
 */
function clockDatums(orbits: Sp3[], nav: Map<string, NavRecord>, t: number): Map<string, number>[] {
  return orbits.map((o) => {
    const out = new Map<string, number>();
    for (const [id, r] of nav) {
      const c = clockAt(o, id, t);
      if (!Number.isNaN(c)) out.set(id, c - navClock(r, t));
    }
    return out;
  });
}

const emptyStats = (): ErrorStats => ({ rms: 0, max: 0, n: 0 });
const addError = (s: ErrorStats, e: number) => {
  s.rms += e * e; // sum of squares until finishStats
  s.max = Math.max(s.max, e);
  s.n += 1;
};
const finishStats = (s: ErrorStats): ErrorStats => ({ rms: s.n ? Math.sqrt(s.rms / s.n) : 0, max: s.max, n: s.n });

const newReport = (sources: number): SystemReport => ({
  slots: 0,
  records: 0,
  dropped: 0,
  centre: emptyStats(),
  edge: emptyStats(),
  all: emptyStats(),
  bySource: new Array(sources).fill(0),
});

/** Clears what the quality gate accumulates (records, error sums, records per source), so it can run again on a report. */
function resetTally(r: SystemReport): void {
  r.records = 0;
  r.centre = emptyStats();
  r.edge = emptyStats();
  r.all = emptyStats();
  r.bySource.fill(0);
}

/** The source orbit of `id` at the 49 fit epochs around `epoch`, from the first product that has all of them. */
function sampleOrbit(orbits: Sp3[], id: string, epoch: number, obs: Float64Array, state: Float64Array): number {
  const tmp = new Float64Array(6);
  for (let s = 0; s < orbits.length; s++) {
    const o = orbits[s] as Sp3;
    let ok = true;
    for (let j = 0; j < FIT_POINTS && ok; j++) {
      ok = interpolate(o, id, epoch + (j - (FIT_POINTS - 1) / 2) * FIT_STEP_S, tmp);
      obs[3 * j] = tmp[0] as number;
      obs[3 * j + 1] = tmp[1] as number;
      obs[3 * j + 2] = tmp[2] as number;
      if (j === (FIT_POINTS - 1) / 2) state.set(tmp);
    }
    if (ok) return s;
  }
  return -1;
}

/** Decoded-record errors at the 49 fit epochs [m]; the gate and the per-record check share it. */
function keplerErrors(c: Constellation, el: Elements, obs: Float64Array, tk: Float64Array): Float64Array {
  const pos = new Float64Array(3);
  const err = new Float64Array(FIT_POINTS);
  for (let j = 0; j < FIT_POINTS; j++) {
    keplerPosition(el, tk[j] as number, c, pos);
    err[j] = Math.hypot((obs[3 * j] as number) - (pos[0] as number), (obs[3 * j + 1] as number) - (pos[1] as number), (obs[3 * j + 2] as number) - (pos[2] as number));
  }
  return err;
}

/** Linear clock fit (af0 at toe, af1) to the product clock at the fit epochs, on the broadcast datum; null with fewer than half the epochs. */
function fitClock(o: Sp3, id: string, epoch: number, datum: number): { af0: number; af1: number } | null {
  let n = 0;
  let st = 0;
  let sc = 0;
  let stt = 0;
  let stc = 0;
  for (let j = 0; j < FIT_POINTS; j++) {
    const t = (j - (FIT_POINTS - 1) / 2) * FIT_STEP_S;
    const c = clockAt(o, id, epoch + t);
    if (Number.isNaN(c)) continue;
    const v = c - datum;
    n += 1;
    st += t;
    sc += v;
    stt += t * t;
    stc += t * v;
  }
  if (n < FIT_POINTS / 2) return null;
  const den = n * stt - st * st;
  const af1 = (n * stc - st * sc) / den;
  return { af0: (sc - af1 * st) / n, af1 };
}

/** One Kepler-file constellation: 36 slots of fitted, packed and self-checked records. */
function buildKepler(c: Constellation, input: BuildInput, base: number, nav: Map<string, NavRecord>, datums: Map<string, number>[], report: SystemReport): Slot[] {
  const tk = Float64Array.from({ length: FIT_POINTS }, (_, j) => (j - (FIT_POINTS - 1) / 2) * FIT_STEP_S);
  const obs = new Float64Array(3 * FIT_POINTS);
  const state = new Float64Array(6);
  const sats = [...nav.keys()].filter((id) => id[0] === c).sort();
  const warm = new Map<string, Elements>();
  const slots: Slot[] = [];
  for (let k = 0; k < SLOTS; k++) {
    const header = base + SLOT_SECONDS * (k + 1) + SYS_SHIFT[c];
    // The record epoch is the header time in GPS seconds; in the constellation's own time it is 2 h aligned (BDT = GPST - 14 s).
    const sysEpoch = header - SYS_SHIFT[c];
    const toe = ((sysEpoch % WEEK) + WEEK) % WEEK;
    const records: Uint8Array[] = [];
    for (const id of sats) {
      const source = sampleOrbit(input.orbits, id, header, obs, state);
      if (source < 0) continue;
      const navRec = nav.get(id) as NavRecord;
      const datum = datums[source]?.get(id);
      const clk = datum === undefined ? null : fitClock(input.orbits[source] as Sp3, id, header, datum);
      const previous = warm.get(id);
      let start: Elements;
      if (previous) {
        const n = Math.sqrt(3.986e14 / previous.sqrtA ** 6) + previous.deltaN;
        start = { ...previous, toe, m0: previous.m0 + n * SLOT_SECONDS, omega0: previous.omega0 + previous.omegaDot * SLOT_SECONDS };
      } else {
        start = elementsFromState(state, toe, c);
      }
      let fit = fitElements(start, tk, obs, c);
      if (previous && (!fit || fit.rms > 1)) fit = fitElements(elementsFromState(state, toe, c), tk, obs, c);
      if (!fit || !clk) {
        report.dropped += 1;
        continue;
      }
      const tgd = navRec.v[c === 'E' ? K.tgd2 : K.tgd] ?? 0;
      const clock: Clock = { af0: clk.af0, af1: clk.af1, af2: 0, tgd };
      let bytes: Uint8Array;
      try {
        bytes = PACKERS[c]({ prn: navRec.prn, week: Math.floor(sysEpoch / WEEK), el: fit.el, clock });
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        report.dropped += 1;
        continue;
      }
      const err = keplerErrors(c, decodeKepler(c, bytes).el, obs, tk);
      if (Math.max(...err) > KEPLER_RECORD_MAX_M || records.length >= LAYOUT[c].capacity) {
        report.dropped += 1;
        continue;
      }
      warm.set(id, fit.el);
      records.push(bytes);
    }
    slots.push({ time: header, blocks: [records] });
  }
  return slots;
}

/** GLONASS: 36 header entries × 8 sub-blocks, one ICD state vector per healthy satellite every 900 s. */
function buildGlonass(input: BuildInput, base: number, nav: Map<string, NavRecord>, datums: Map<string, number>[], report: SystemReport): Slot[] {
  const sats = [...nav.keys()].filter((id) => id[0] === 'R').sort();
  const s = new Float64Array(6);
  const acc = new Float64Array(3);
  const slots: Slot[] = [];
  for (let k = 0; k < SLOTS; k++) {
    const blocks: Uint8Array[][] = [];
    for (let j = 0; j < GLO_SUBBLOCKS; j++) {
      // Sub-block epochs are 900 s aligned in GLONASS time (UTC + 3 h): Huawei's base + L + 900 n with L = 18 (FORMAT.md 2.3, 3.5).
      const epoch = base + HH_LEAP_SECONDS + GLO_STEP_S * (GLO_SUBBLOCKS * k + j);
      const tb = (((epoch - HH_LEAP_SECONDS + 10800) % 86400) + 86400) % 86400 / GLO_STEP_S;
      const records: Uint8Array[] = [];
      for (const id of sats) {
        const source = input.orbits.findIndex((o) => interpolate(o, id, epoch - GLO_STEP_S, s) && interpolate(o, id, epoch + GLO_STEP_S, s) && interpolate(o, id, epoch, s));
        if (source < 0) continue;
        const o = input.orbits[source] as Sp3;
        const datum = datums[source]?.get(id);
        const c0 = clockAt(o, id, epoch);
        const cA = clockAt(o, id, epoch - FIT_STEP_S);
        const cB = clockAt(o, id, epoch + FIT_STEP_S);
        if (datum === undefined || Number.isNaN(c0) || Number.isNaN(cA) || Number.isNaN(cB)) {
          report.dropped += 1;
          continue;
        }
        for (let i = 0; i < 6; i++) s[i] = (s[i] as number) / 1000;
        lunisolarAcceleration(s, epoch, HH_LEAP_SECONDS, acc);
        const slot = Number(id.slice(1));
        let bytes: Uint8Array;
        try {
          bytes = packGlo({ slot, tb, tauN: -(c0 - datum), gammaN: (cB - cA) / (2 * FIT_STEP_S), state: s, acc });
        } catch (error) {
          if (!(error instanceof RangeError)) throw error;
          report.dropped += 1;
          continue;
        }
        if (Math.max(...glonassErrors(bytes, o, id, epoch).near) > GLO_RECORD_MAX_M || records.length >= LAYOUT.R.capacity) {
          report.dropped += 1;
          continue;
        }
        records.push(bytes);
      }
      blocks.push(records);
    }
    slots.push({ time: base + HH_LEAP_SECONDS + 3600 + SLOT_SECONDS * k, blocks });
  }
  return slots;
}

/** Decoded GLONASS record propagated with the ICD algorithm vs the source orbit [m]: at the epoch, ±450 s (`near`), ±900 s (`far`). */
function glonassErrors(rec: Uint8Array, o: Sp3, id: string, epoch: number): { centre: number; near: number[]; far: number[] } {
  const g = decodeGlo(rec);
  const p = new Float64Array(3);
  const truth = new Float64Array(6);
  const at = (dt: number) => {
    glonassPropagate(g.state, g.acc, dt, p);
    if (!interpolate(o, id, epoch + dt, truth)) return Infinity;
    return Math.hypot((p[0] as number) - (truth[0] as number), (p[1] as number) - (truth[1] as number), (p[2] as number) - (truth[2] as number));
  };
  return { centre: at(0), near: [at(-450), at(450)], far: [at(-900), at(900)] };
}

/**
 * The quality gate on the finished files: every record decoded from the bytes, its orbit evaluated with the ICD algorithm and compared with
 * the source product (the first that covers it, the same rule the build uses). Fills the error statistics of `report`; returns why the build
 * must be refused, or null.
 */
export function qualityGate(files: Map<FileKind, Uint8Array>, orbits: Sp3[], report: Record<FileKind, SystemReport>): string | null {
  const tk = Float64Array.from({ length: FIT_POINTS }, (_, j) => (j - (FIT_POINTS - 1) / 2) * FIT_STEP_S);
  const obs = new Float64Array(3 * FIT_POINTS);
  const state = new Float64Array(6);
  const problems: string[] = [];
  for (const c of ['G', 'E', 'C', 'J'] as const) {
    const r = report[c];
    const blocks = readBlocks(c, files.get(c) as Uint8Array);
    r.slots = blocks.filter((b) => b.records.length > 0).length;
    resetTally(r);
    for (const { time, records } of blocks) {
      for (const rec of records) {
        const dec = decodeKepler(c, rec);
        const id = `${c}${String(dec.prn).padStart(2, '0')}`;
        const source = sampleOrbit(orbits, id, time, obs, state);
        if (source < 0) {
          problems.push(`${id} at ${time}: no source orbit`);
          continue;
        }
        const err = keplerErrors(c, dec.el, obs, tk);
        r.records += 1;
        r.bySource[source] = (r.bySource[source] ?? 0) + 1;
        addError(r.centre, err[(FIT_POINTS - 1) / 2] as number);
        addError(r.edge, err[0] as number);
        addError(r.edge, err[FIT_POINTS - 1] as number);
        for (const e of err) addError(r.all, e);
      }
    }
    r.centre = finishStats(r.centre);
    r.edge = finishStats(r.edge);
    r.all = finishStats(r.all);
    if (r.all.rms > GATE.kepler.rmsM || r.all.max > GATE.kepler.maxM) {
      problems.push(`${c}: position error RMS ${r.all.rms.toFixed(2)} m, max ${r.all.max.toFixed(2)} m exceeds the gate`);
    }
  }
  const g = report.R;
  const blocks = readBlocks('R', files.get('R') as Uint8Array);
  resetTally(g);
  g.slots = 0;
  for (let i = 0; i < blocks.length; i += GLO_SUBBLOCKS) if (blocks.slice(i, i + GLO_SUBBLOCKS).some((b) => b.records.length > 0)) g.slots += 1;
  blocks.forEach(({ time, records }, n) => {
    const epoch = time - 3600 + GLO_STEP_S * (n % GLO_SUBBLOCKS);
    for (const rec of records) {
      const id = `R${String(rec[0] as number + 1).padStart(2, '0')}`;
      const s = new Float64Array(6);
      const source = orbits.findIndex((o) => interpolate(o, id, epoch - GLO_STEP_S, s) && interpolate(o, id, epoch + GLO_STEP_S, s));
      if (source < 0) {
        problems.push(`${id} at ${epoch}: no source orbit`);
        continue;
      }
      const e = glonassErrors(rec, orbits[source] as Sp3, id, epoch);
      g.records += 1;
      g.bySource[source] = (g.bySource[source] ?? 0) + 1;
      addError(g.centre, e.centre);
      for (const x of e.near) addError(g.edge, x);
      for (const x of [e.centre, ...e.near, ...e.far]) addError(g.all, x);
    }
  });
  g.centre = finishStats(g.centre);
  g.edge = finishStats(g.edge);
  g.all = finishStats(g.all);
  if (g.edge.rms > GATE.glonass.rmsM || g.edge.max > GATE.glonass.maxM) {
    problems.push(`R: position error at ±450 s RMS ${g.edge.rms.toFixed(2)} m, max ${g.edge.max.toFixed(2)} m exceeds the gate`);
  }
  return problems.length ? problems.join('; ') : null;
}

/**
 * Builds, gates and bundles the six files for `input.nowMs`. Slots no product covers stay empty (count 0, header still filled): Huawei's
 * own files skip a satellite that has no fit and leave no hole, so an empty block means "no ephemeris for this slot" and the receiver falls
 * back to the sky. Returns the build or why there is none.
 */
export function buildPgnss(input: BuildInput): { build: PgnssBuild } | { problem: string } {
  const builtGps = gpsSecondsAt(input.nowMs);
  const base = Math.floor(builtGps / SLOT_SECONDS) * SLOT_SECONDS;
  const nav = new Map(selectCurrent(input.nav, input.nowMs).map((r) => [`${r.sys}${String(r.prn).padStart(2, '0')}`, r]));
  const datums = clockDatums(input.orbits, nav, builtGps);
  const report = Object.fromEntries((['G', 'J', 'E', 'C', 'R'] as const).map((k) => [k, newReport(input.orbits.length)])) as Record<FileKind, SystemReport>;
  const files = new Map<FileKind, Uint8Array>();
  for (const c of ['G', 'J', 'E', 'C'] as const) files.set(c, assembleFile(c, buildKepler(c, input, base, nav, datums, report[c])));
  files.set('R', assembleFile('R', buildGlonass(input, base, nav, datums, report.R)));

  const problem = qualityGate(files, input.orbits, report);
  if (problem) return { problem };
  const gpsBlocks = readBlocks('G', files.get('G') as Uint8Array);
  const firstEmpty = gpsBlocks.findIndex((b) => b.records.length === 0);
  const covered = firstEmpty < 0 ? SLOTS : firstEmpty;
  if (covered < MIN_GPS_SLOTS) return { problem: `GPS covers ${covered} slots, fewer than ${MIN_GPS_SLOTS}` };
  const firstCount = (k: FileKind) => readBlocks(k, files.get(k) as Uint8Array)[0]?.records.length ?? 0;
  for (const k of ['G', 'E', 'R'] as const) {
    if (firstCount(k) < MIN_FIRST_SLOT[k]) return { problem: `${k}: ${firstCount(k)} records in the first slot, fewer than ${MIN_FIRST_SLOT[k]}` };
  }
  const coveredUntil = base + SLOT_SECONDS * covered + SLOT_SECONDS;
  const extra = buildExtra({ utc: input.utc, ion: input.ion, start: base, end: coveredUntil, leap: input.utc?.dtls ?? HH_LEAP_SECONDS });
  const out: PgnssFile[] = PGNSS_FILES.map((f) => ({ name: f.name, bytes: f.kind ? (files.get(f.kind) as Uint8Array) : extra }));
  return { build: { files: out, bundle: encodeBundle(out), builtGps, base, coveredUntil, report } };
}
