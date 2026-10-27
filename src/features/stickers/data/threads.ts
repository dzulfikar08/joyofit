/**
 * Workout -> "Threads carousel" subject. One subject carries everything the carousel slides can say about a workout; each
 * slide template (`templates/threads.ts`) lists the paths it needs in `requires`, so a slide with no data is simply not
 * offered. Numbers stay raw (the templates format them), text that comes from i18n or the person (sport, exercise names,
 * status words) is resolved here.
 *
 * Namespaces: `run.*` / `strength.*` are the same ones the single stickers read (`buildRunSubject`, `buildStrengthSubject`);
 * `th.*` is the carousel's own:
 *
 * | path | value |
 * |---|---|
 * | `th.device` | recording device, text |
 * | `th.has.<slide>` | `1` when the slide has data (`charts`, `sensors`, `zones`, `power`, `climbs`, `context`) |
 * | `th.splitMode` | `pace` (run, walk) or `speed` (ride) |
 * | `th.splitStep` | distance one row stands for, km (1 for runs, 5 for rides, more when a long workout is merged) |
 * | `th.splitCols.{hr,cad,pwr,gain}` | `1` when some row has the column |
 * | `th.splitRows`, `th.splitRows2`, `th.splitRows3` | up to 12 rows each: `{ n, tot, main, hr?, cad?, pwr?, gain?, best? }` (`tot` = elapsed seconds at the end of the row) |
 * | `th.charts.*` | series and stats of the pace/speed, heart rate and elevation charts |
 * | `th.sensors.*` | cadence and power series and stats |
 * | `th.load.*` | training effect and load |
 * | `th.power.*` | cycling power metrics, curve, zones |
 * | `th.climbs` | up to 5 climbs |
 * | `th.ctx.*` | the last four weeks |
 * | `th.liftRows`, `th.liftRows2`, `th.liftRows3`, `th.liftMore` | strength exercises (6 per slide) |
 * | `th.n`, `th.total` | slide number and count, written per slide by `slideData` |
 */
import type { WorkoutRow } from '@/db/queries';
import { isCounted, setVolume, type PersonalRecord } from '@/features/strength/calc';
import type { Catalog } from '@/features/strength/catalog';
import type { StrengthSet, StrengthWorkout } from '@/features/strength/types';
import { getWeightUnit, kgToUnit } from '@/features/strength/units';
import { haversineM } from '@/features/workouts/analysis/geo';
import { downsample, kmSplits } from '@/features/workouts/summary';
import { sportKind } from '@/features/workouts/analysis/sport';
import type { AnalysisSplit, SportKind } from '@/features/workouts/analysis/types';
import type { RideAnalysis, RideClimb, RideSplit } from '@/features/cycling/types';
import { fmtDate, fmtNumber, getT, type Locale } from '@/i18n';

import type { JsonObject, JsonValue, StickerSubject } from '../subject';
import { buildRunSubject, filledSeries, speedFromPace, type RunSubjectInput } from './run';
import { buildStrengthSubject, type StrengthSubjectInput } from './strength';

/** Rows of one splits slide, and how many splits slides there can be. Longer workouts merge neighbouring splits. */
export const SPLIT_ROWS_PER_PAGE = 12;
export const SPLIT_PAGES = 3;
export const SPLIT_ROWS_MAX = SPLIT_ROWS_PER_PAGE * SPLIT_PAGES;
/** Exercises of one strength slide, and how many such slides there can be. */
export const LIFT_ROWS_PER_PAGE = 6;
export const LIFT_PAGES = 3;
export const CLIMBS_MAX = 5;
/** Points of a chart series: enough for a 936 px chart, small enough to keep the Scene light. */
export const CHART_POINTS = 96;
const WEEKS = 4;
const WEEK_SEC = 7 * 86_400;
const TEXT_MAX = 60;
/** A route shorter than this is dropped: after the 200 m privacy trim at both ends nothing worth drawing would be left. */
const MIN_ROUTE_M = 450;

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const pos = (v: unknown): v is number => num(v) && v > 0;
const round1 = (n: number) => Math.round(n * 10) / 10;

function clip(text: string | null | undefined): string | null {
  const s = (text ?? '').trim();
  if (!s) return null;
  return s.length > TEXT_MAX ? `${s.slice(0, TEXT_MAX - 3).trimEnd()}...` : s;
}

/** Puts `value` under `key` unless it is missing. */
function put(target: JsonObject, key: string, value: JsonValue | null | undefined): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'number' && !Number.isFinite(value)) return;
  target[key] = value;
}

// ------------------------------------------------------------------------------------------------------------- context

export interface ContextWeek {
  /** Epoch ms of the first instant of the 7-day window. */
  startMs: number;
  distanceM: number;
  movingSec: number;
  sessions: number;
  volumeKg: number;
  sets: number;
}

/** The four 7-day windows that end with the workout, oldest first. */
export interface ThreadsContext {
  kind: SportKind | 'strength';
  weeks: ContextWeek[];
}

export interface ContextInput {
  /** Complete watch/phone workout rows (`listWorkouts`). */
  workouts: readonly Pick<WorkoutRow, 'start' | 'end' | 'duration' | 'distance' | 'sportName' | 'complete'>[];
  /** Strength workouts of the last 28 days. */
  strength: readonly StrengthWorkout[];
  /** Unix seconds: the end of the newest window (the workout's own start, plus its length). */
  anchorSec: number;
  kind: SportKind | 'strength';
}

/**
 * The last 28 days up to the workout, as four weekly windows of the same sport (a ride is compared with rides, a lift with
 * lifts). The newest window includes the workout itself. Null when the person has fewer than two sessions in the 28 days:
 * one session says nothing about training.
 */
export function weeklyContext(input: ContextInput): ThreadsContext | null {
  const { anchorSec, kind } = input;
  if (!num(anchorSec)) return null;
  const weeks: ContextWeek[] = Array.from({ length: WEEKS }, (_, i) => ({
    startMs: (anchorSec - (WEEKS - i) * WEEK_SEC) * 1000,
    distanceM: 0,
    movingSec: 0,
    sessions: 0,
    volumeKg: 0,
    sets: 0,
  }));
  const windowOf = (sec: number): number => {
    const back = anchorSec - sec;
    if (back < 0 || back >= WEEKS * WEEK_SEC) return -1;
    return WEEKS - 1 - Math.floor(back / WEEK_SEC);
  };
  if (kind === 'strength') {
    for (const s of input.strength) {
      if (s.deletedAt !== null && s.deletedAt !== undefined) continue;
      const i = windowOf(s.startedAt / 1000);
      if (i < 0) continue;
      const week = weeks[i]!;
      week.sessions += 1;
      week.movingSec += pos(s.durationSec) ? s.durationSec : 0;
      for (const exercise of s.exercises) {
        for (const set of exercise.sets) {
          if (!isCounted(set)) continue;
          week.sets += 1;
          week.volumeKg += setVolume(set);
        }
      }
    }
  } else {
    for (const w of input.workouts) {
      if (!w.complete || sportKind(w.sportName) !== kind) continue;
      const i = windowOf(w.start);
      if (i < 0) continue;
      const week = weeks[i]!;
      week.sessions += 1;
      week.movingSec += pos(w.duration) ? w.duration : Math.max(0, w.end - w.start);
      week.distanceM += pos(w.distance) ? w.distance : 0;
    }
  }
  const sessions = weeks.reduce((a, w) => a + w.sessions, 0);
  return sessions >= 2 ? { kind, weeks } : null;
}

function contextData(context: ThreadsContext, locale: Locale): JsonObject {
  const ctx: JsonObject = {};
  const total = (pick: (w: ContextWeek) => number) => context.weeks.reduce((a, w) => a + pick(w), 0);
  ctx.weekLabels = context.weeks.map((w) => fmtDate(new Date(w.startMs), 'short', locale));
  ctx.weekSessions = context.weeks.map((w) => w.sessions);
  ctx.weekMin = context.weeks.map((w) => Math.round(w.movingSec / 60));
  ctx.sessions = total((w) => w.sessions);
  ctx.movingSec = total((w) => w.movingSec);
  ctx.avgSessionsWeek = round1(total((w) => w.sessions) / WEEKS);
  if (context.kind === 'strength') {
    const unit = getWeightUnit();
    ctx.weekVolume = context.weeks.map((w) => Math.round(kgToUnit(w.volumeKg, unit)));
    const volume = kgToUnit(total((w) => w.volumeKg), unit);
    ctx.volume = Math.round(volume);
    ctx.unit = unit;
    ctx.sets = total((w) => w.sets);
    ctx.avgVolumeWeek = Math.round(volume / WEEKS);
  } else if (total((w) => w.distanceM) > 0) {
    ctx.weekKm = context.weeks.map((w) => round1(w.distanceM / 1000));
    ctx.distanceM = Math.round(total((w) => w.distanceM));
    ctx.avgDistanceWeekM = Math.round(total((w) => w.distanceM) / WEEKS);
  }
  return ctx;
}

// -------------------------------------------------------------------------------------------------------------- splits

export interface SplitRow {
  /** Label of the row: the kilometre it ends at. */
  n: string;
  /** Metres the row covers; not emitted, used to merge rows. */
  distM: number;
  sec: number;
  /** Seconds per km (pace mode) or km/h (speed mode). */
  main: number;
  hr: number | null;
  cad: number | null;
  pwr: number | null;
  gain: number | null;
}

/** Km label of a split ending `cumM` metres into the workout: whole km as an integer, a partial last split with decimals. */
function kmLabel(cumM: number, locale: Locale): string {
  const km = cumM / 1000;
  return Math.abs(km - Math.round(km)) < 0.005 ? String(Math.round(km)) : fmtNumber(km, 2, locale);
}

function footRows(splits: readonly AnalysisSplit[], locale: Locale): SplitRow[] {
  const rows: SplitRow[] = [];
  let cum = 0;
  for (const s of splits) {
    cum += s.distM;
    if (s.distM < 200 || !pos(s.paceSecKm) || !pos(s.sec)) continue;
    rows.push({
      n: kmLabel(cum, locale),
      distM: s.distM,
      sec: Math.round(s.sec),
      main: Math.round(s.paceSecKm),
      hr: pos(s.hr) ? Math.round(s.hr) : null,
      cad: pos(s.cad) ? Math.round(s.cad) : null,
      pwr: null,
      gain: num(s.gainM) ? Math.round(s.gainM) : null,
    });
  }
  return rows;
}

function summaryRows(paceBlocks: readonly { km: number; pace: number }[], locale: Locale): SplitRow[] {
  const rows: SplitRow[] = [];
  let cum = 0;
  for (const b of paceBlocks) {
    cum += b.km * 1000;
    if (b.km < 0.2 || !pos(b.pace)) continue;
    rows.push({ n: kmLabel(cum, locale), distM: b.km * 1000, sec: Math.round(b.pace * b.km), main: Math.round(b.pace), hr: null, cad: null, pwr: null, gain: null });
  }
  return rows;
}

function rideRows(splits: readonly RideSplit[], locale: Locale): SplitRow[] {
  const rows: SplitRow[] = [];
  let cum = 0;
  for (const s of splits) {
    cum += s.distM;
    if (!pos(s.avgSpeedKmh) || !pos(s.sec)) continue;
    rows.push({
      n: kmLabel(cum, locale),
      distM: s.distM,
      sec: Math.round(s.sec),
      main: s.avgSpeedKmh,
      hr: pos(s.avgHr) ? Math.round(s.avgHr) : null,
      cad: pos(s.avgCad) ? Math.round(s.avgCad) : null,
      pwr: pos(s.avgPower) ? Math.round(s.avgPower) : null,
      gain: num(s.gainM) ? Math.round(s.gainM) : null,
    });
  }
  return rows;
}

const mean = (xs: number[]): number | null => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Merges `step` neighbouring rows into one (time and distance add, pace/speed from the totals, the rest averaged). */
export function mergeRows(rows: readonly SplitRow[], step: number, mode: 'pace' | 'speed', locale: Locale, cumEnds: readonly number[]): SplitRow[] {
  if (step <= 1) return [...rows];
  const out: SplitRow[] = [];
  for (let i = 0; i < rows.length; i += step) {
    const chunk = rows.slice(i, i + step);
    const distM = chunk.reduce((a, r) => a + r.distM, 0);
    const sec = chunk.reduce((a, r) => a + r.sec, 0);
    const avg = (pick: (r: SplitRow) => number | null): number | null => {
      const m = mean(chunk.map(pick).filter(pos));
      return m === null ? null : Math.round(m);
    };
    const gains = chunk.map((r) => r.gain).filter(num);
    out.push({
      n: kmLabel(cumEnds[Math.min(i + step, rows.length) - 1]!, locale),
      distM,
      sec,
      main: mode === 'pace' ? Math.round((sec / distM) * 1000) : round1((distM / sec) * 3.6),
      hr: avg((r) => r.hr),
      cad: avg((r) => r.cad),
      pwr: avg((r) => r.pwr),
      gain: gains.length > 0 ? gains.reduce((a, b) => a + b, 0) : null,
    });
  }
  return out;
}

function splitData(rows: SplitRow[], mode: 'pace' | 'speed', baseKm: number, locale: Locale): JsonObject | null {
  if (rows.length < 2) return null;
  let cum = 0;
  const cumEnds = rows.map((r) => (cum += r.distM));
  const step = Math.max(1, Math.ceil(rows.length / SPLIT_ROWS_MAX));
  const merged = mergeRows(rows, step, mode, locale, cumEnds);

  let best = 0;
  merged.forEach((r, i) => {
    const better = mode === 'pace' ? r.main < merged[best]!.main : r.main > merged[best]!.main;
    if (better) best = i;
  });

  const cols: JsonObject = {};
  if (merged.some((r) => r.hr !== null)) cols.hr = 1;
  if (merged.some((r) => r.cad !== null)) cols.cad = 1;
  if (merged.some((r) => r.pwr !== null)) cols.pwr = 1;
  if (merged.some((r) => r.gain !== null)) cols.gain = 1;

  let elapsed = 0;
  const totals = merged.map((r) => (elapsed += r.sec));
  const asJson = (r: SplitRow, index: number): JsonObject => {
    const row: JsonObject = { n: r.n, tot: totals[index]!, main: r.main };
    put(row, 'hr', r.hr);
    put(row, 'cad', r.cad);
    put(row, 'pwr', r.pwr);
    put(row, 'gain', r.gain);
    if (index === best) row.best = 1;
    return row;
  };
  const out: JsonObject = { splitMode: mode, splitStep: baseKm * step, splitCols: cols };
  const keys = ['splitRows', 'splitRows2', 'splitRows3'] as const;
  keys.forEach((key, page) => {
    const slice = merged.slice(page * SPLIT_ROWS_PER_PAGE, (page + 1) * SPLIT_ROWS_PER_PAGE);
    if (slice.length === 0) return;
    out[key] = slice.map((r, i) => asJson(r, page * SPLIT_ROWS_PER_PAGE + i));
  });
  return out;
}

// -------------------------------------------------------------------------------------------------------------- run

export interface ThreadsRunInput extends RunSubjectInput {
  /** The cycling metrics when the workout is a ride (`useRideData`); null for everything else. */
  ride: RideAnalysis | null;
  /** The watch or phone that recorded it, as the person knows it ("HUAWEI WATCH FIT 4 Pro"); null when unknown. */
  deviceName: string | null;
  /** The last four weeks (`weeklyContext`); null to leave the context slide out. */
  context: ThreadsContext | null;
}

/** Seconds of the rolling mean that smooths the cadence and power charts (the pace series is smoothed by the analysis). */
export const SENSOR_SMOOTH_SEC = 30;

/** Centered moving mean over `window` samples; the ends average what is there. A window of 1 or less returns the values. */
export function smoothSeries(values: readonly number[], window: number): number[] {
  if (window <= 1) return [...values];
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const from = Math.max(0, i - half);
    const to = Math.min(values.length - 1, i + half);
    let sum = 0;
    for (let j = from; j <= to; j++) sum += values[j]!;
    return sum / (to - from + 1);
  });
}

/** A chart series: gaps filled, optionally smoothed over `smoothSec` seconds of a grid with `stepSec` spacing, downsampled. */
function series(values: readonly (number | null | undefined)[] | null | undefined, smooth?: { smoothSec: number; stepSec: number }): number[] | null {
  const filled = filledSeries(values);
  if (!filled) return null;
  const smoothed = smooth ? smoothSeries(filled, Math.round(smooth.smoothSec / smooth.stepSec)) : filled;
  return downsample(smoothed, CHART_POINTS).map(round1);
}

function stats(values: readonly number[]): { min: number; max: number; avg: number } {
  return { min: Math.min(...values), max: Math.max(...values), avg: values.reduce((a, b) => a + b, 0) / values.length };
}

/** Length of a `[lat, lng][]` polyline, metres. */
function routeLengthM(route: readonly JsonValue[]): number {
  let total = 0;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1] as number[];
    const b = route[i] as number[];
    total += haversineM(a[0]!, a[1]!, b[0]!, b[1]!);
  }
  return total;
}

function climbRow(c: RideClimb): JsonObject {
  const row: JsonObject = { n: c.n, lengthM: Math.round(c.lengthM), gainM: Math.round(c.gainM), avgGrade: round1(c.avgGradePct), maxGrade: round1(c.maxGradePct), sec: Math.round(c.sec), category: c.category };
  put(row, 'vam', pos(c.vam) ? Math.round(c.vam) : null);
  put(row, 'power', pos(c.avgPower) ? Math.round(c.avgPower) : null);
  put(row, 'hr', pos(c.avgHr) ? Math.round(c.avgHr) : null);
  return row;
}

const CURVE_KEYS: readonly number[] = [5, 60, 300, 1200, 3600];
const CURVE_LABEL_KEY = { 5: 'threads.curve.5', 60: 'threads.curve.60', 300: 'threads.curve.300', 1200: 'threads.curve.1200', 3600: 'threads.curve.3600' } as const;

function powerData(ride: RideAnalysis, locale: Locale): JsonObject | null {
  const p = ride.power;
  if (!p || !pos(p.avg)) return null;
  const t = getT(locale, 'stickers');
  const out: JsonObject = { avg: Math.round(p.avg), max: Math.round(p.max), workKj: Math.round(p.workKj) };
  put(out, 'np', pos(p.normalized) ? Math.round(p.normalized) : null);
  put(out, 'vi', pos(p.variabilityIndex) ? Math.round(p.variabilityIndex * 100) / 100 : null);
  put(out, 'if', pos(p.intensityFactor) ? Math.round(p.intensityFactor * 100) / 100 : null);
  put(out, 'tss', pos(p.tss) ? Math.round(p.tss) : null);
  put(out, 'wkg', pos(p.avgWkg) ? Math.round(p.avgWkg * 100) / 100 : null);
  put(out, 'nwkg', pos(p.normalizedWkg) ? Math.round(p.normalizedWkg * 100) / 100 : null);
  put(out, 'ftp', pos(p.ftp) ? Math.round(p.ftp) : null);
  put(out, 'balanceLeft', pos(p.balanceLeftPct) ? Math.round(p.balanceLeftPct) : null);

  const curve = CURVE_KEYS.map((sec) => p.curve.find((c) => c.sec === sec)).filter((c): c is NonNullable<typeof c> => c !== undefined && pos(c.watts));
  if (curve.length >= 2) {
    out.curveW = curve.map((c) => Math.round(c.watts));
    out.curveLabels = curve.map((c) => `${t(CURVE_LABEL_KEY[c.sec as keyof typeof CURVE_LABEL_KEY])} \u00b7 ${Math.round(c.watts)} W`);
  }
  if (p.zones && p.zones.length === 7) {
    const total = p.zones.reduce((a, z) => a + z.sec, 0);
    if (total > 0) {
      out.zonePct = p.zones.map((z) => z.sec / total);
      out.zoneSec = p.zones.map((z) => Math.round(z.sec));
      out.zoneLabels = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Z6', 'Z7'];
      out.zoneColors = ['#9AA7AD', '#5FD3EE', '#6EE7A0', '#F5D547', '#FF9F43', '#FF4D6A', '#C98BFF'];
    }
  }
  return out;
}

export function buildThreadsRun(input: ThreadsRunInput, locale: Locale): StickerSubject {
  const base = buildRunSubject(input, locale);
  const run = base.data.run as JsonObject;
  const { analysis, ride, summary } = input;
  const kind = run.kind as SportKind;
  const t = getT(locale, 'stickerdata');
  const th: JsonObject = {};
  const has: JsonObject = {};
  if (Array.isArray(run.route) && routeLengthM(run.route) < MIN_ROUTE_M) delete run.route;

  const device = clip(input.deviceName);
  if (device) th.device = device;

  // Elevation: the ride's own computation when there is one, else the generic analysis.
  const elevation = ride?.elevation ?? analysis?.elevation ?? null;
  if (elevation) {
    th.elev = { gainM: Math.round(elevation.gainM), lossM: Math.round(elevation.lossM), minM: Math.round(elevation.minM), maxM: Math.round(elevation.maxM) };
  }

  // Splits: a ride is cut every 5 km, a run or walk every km.
  let rows: SplitRow[] = [];
  let mode: 'pace' | 'speed' = 'pace';
  let baseKm = 1;
  if (kind === 'ride' && ride && ride.splits.length > 0) {
    rows = rideRows(ride.splits, locale);
    mode = 'speed';
    baseKm = 5;
  } else if (analysis && analysis.splits.length > 0) {
    rows = footRows(analysis.splits, locale);
  } else {
    rows = summaryRows(kmSplits(summary), locale);
  }
  Object.assign(th, splitData(rows, mode, baseKm, locale));

  // Charts: pace or speed, heart rate, elevation.
  const grid = analysis?.series ?? null;
  const charts: JsonObject = {};
  if (grid) {
    const speed = kind === 'ride' || kind === 'run' || kind === 'walk' ? series(grid.pace?.map(speedFromPace)) : null;
    if (speed) {
      charts.speed = speed;
      const s = stats(speed);
      charts.speedMin = round1(s.min);
      charts.speedMax = round1(s.max);
      charts.speedAvg = round1(s.avg);
      if (kind !== 'ride') charts.paceBest = Math.round(3600 / s.max);
    }
    const hr = pos(run.hrAvg) || pos(run.hrMax) ? series(grid.hr?.map((v) => (pos(v) ? v : null))) : null;
    if (hr) {
      charts.hr = hr.map(Math.round);
      const s = stats(hr);
      charts.hrMin = Math.round(s.min);
      charts.hrMax = Math.round(s.max);
      charts.hrAvg = Math.round(s.avg);
    }
    const alt = series(grid.alt);
    if (alt && Math.max(...alt) - Math.min(...alt) >= 3) {
      charts.alt = alt;
      charts.altMin = Math.round(Math.min(...alt));
      charts.altMax = Math.round(Math.max(...alt));
    }
    // Cadence and power go to their own slide.
    // Smoothed for the chart; the average and the maximum below come from the raw data.
    const smooth = { smoothSec: SENSOR_SMOOTH_SEC, stepSec: grid.stepSec };
    const cad = series(grid.cad?.map((v) => (pos(v) ? v : null)), smooth);
    const power = series(grid.power?.map((v) => (num(v) && v >= 0 ? v : null)), smooth);
    const sensors: JsonObject = {};
    if (cad && pos(run.cadence)) {
      sensors.cad = cad.map(Math.round);
      sensors.cadAvg = run.cadence;
      sensors.cadMax = Math.round(analysis?.stats.maxCad ?? Math.max(...cad));
    }
    if (power && pos(run.power)) {
      sensors.power = power.map(Math.round);
      sensors.powerAvg = run.power;
      sensors.powerMax = Math.round(analysis?.stats.maxPower ?? Math.max(...power));
      put(sensors, 'powerNp', pos(analysis?.stats.normalizedPower) ? Math.round(analysis!.stats.normalizedPower!) : null);
    }
    if (sensors.cad || sensors.power) {
      th.sensors = sensors;
      has.sensors = 1;
    }
  }
  const speedTop = pos(ride?.speed.maxMs) ? ride.speed.maxMs * 3.6 : pos(analysis?.stats.maxSpeedMs) ? analysis.stats.maxSpeedMs * 3.6 : null;
  if (charts.speed) put(charts, 'speedTop', speedTop === null ? null : round1(speedTop));
  if (charts.speed || charts.hr || charts.alt) {
    th.charts = charts;
    has.charts = 1;
  }

  // Zones and load.
  if (run.hrZonePct) has.zones = 1;
  const load = analysis?.load ?? null;
  const loadData: JsonObject = {};
  if (load) {
    put(loadData, 'aerobic', pos(load.aerobicEffect) ? round1(load.aerobicEffect) : null);
    put(loadData, 'anaerobic', pos(load.anaerobicEffect) ? round1(load.anaerobicEffect) : null);
    put(loadData, 'recoveryH', pos(load.recoveryHours) ? Math.round(load.recoveryHours) : null);
    put(loadData, 'watchLoad', pos(load.watchLoad) ? Math.round(load.watchLoad) : null);
    put(loadData, 'trimp', pos(load.trimp) ? Math.round(load.trimp) : null);
    if (load.ratio !== null && pos(load.ratio) && pos(load.chronicWeekly)) {
      loadData.ratio = Math.round(load.ratio * 100) / 100;
      loadData.acute = Math.round(load.acute);
      loadData.chronic = Math.round(load.chronicWeekly);
      loadData.status = t(load.ratio < 0.8 ? 'load.status.down' : load.ratio > 1.3 ? 'load.status.up' : 'load.status.balanced');
    }
  }
  put(loadData, 'vo2max', pos(summary.vo2max) ? Math.round(summary.vo2max) : null);
  if (pos(run.strain)) loadData.strain = run.strain;
  if (Object.keys(loadData).length > 0) {
    th.load = loadData;
    has.zones = 1;
  }

  // Cycling power, climbs.
  if (ride) {
    const power = powerData(ride, locale);
    if (power) {
      th.power = power;
      has.power = 1;
    }
    const climbs = [...ride.climbs].sort((a, b) => b.score - a.score).slice(0, CLIMBS_MAX).sort((a, b) => a.startM - b.startM);
    if (climbs.length > 0) {
      th.climbs = climbs.map(climbRow);
      has.climbs = 1;
    }
  }

  if (input.context) {
    th.ctx = contextData(input.context, locale);
    has.context = 1;
  }

  th.has = has;
  const sharing = getT(locale, 'stickers');
  return {
    id: `threads:run:${input.workout.start}`,
    kinds: ['threads'],
    heading: sharing('threads.heading'),
    caption: '',
    date: base.date,
    data: { run, th },
  };
}

// --------------------------------------------------------------------------------------------------------- strength

export interface ThreadsStrengthInput extends StrengthSubjectInput {
  context: ThreadsContext | null;
  deviceName: string | null;
}

/** "3 x 8 x 60 kg" runs of equal sets, joined by a middle dot. */
function setsText(sets: readonly StrengthSet[], locale: Locale): string {
  const groups: { text: string; count: number }[] = [];
  for (const set of sets) {
    const unit = getWeightUnit();
    const weight = pos(set.weightKg) ? `${fmtNumber(Math.round(kgToUnit(set.weightKg, unit) * 10) / 10, 1, locale)} ${unit}` : null;
    const amount = pos(set.reps) ? String(set.reps) : pos(set.seconds) ? `${set.seconds} s` : null;
    const text = [amount, weight].filter((x): x is string => x !== null).join(' \u00d7 ');
    if (!text) continue;
    const last = groups[groups.length - 1];
    if (last && last.text === text) last.count += 1;
    else groups.push({ text, count: 1 });
  }
  return groups.map((g) => (g.count > 1 ? `${g.count} \u00d7 ${g.text}` : `1 \u00d7 ${g.text}`)).join('  \u00b7  ');
}

export function buildThreadsStrength(input: ThreadsStrengthInput, locale: Locale): StickerSubject {
  const base = buildStrengthSubject(input, locale);
  const strength = base.data.strength as JsonObject;
  const { workout, catalog, records } = input;
  const th: JsonObject = {};
  const has: JsonObject = {};
  const device = clip(input.deviceName);
  if (device) th.device = device;
  const t = getT(locale, 'strengthshare');

  const prExercises = new Set(records.map((r: PersonalRecord) => r.exerciseId));
  const rows: JsonObject[] = [];
  for (const exercise of workout.exercises) {
    const counted = exercise.sets.filter(isCounted);
    if (counted.length === 0) continue;
    const text = setsText(counted, locale);
    if (!text) continue;
    const volume = counted.reduce((a, s) => a + setVolume(s), 0);
    const row: JsonObject = { name: clip(catalog.name(exercise.exerciseId, locale) ?? t('unknownExercise')) ?? '', sets: text, setCount: counted.length };
    if (volume > 0) {
      row.volume = Math.round(kgToUnit(volume));
      row.unit = getWeightUnit();
    }
    if (prExercises.has(exercise.exerciseId)) row.pr = 1;
    rows.push(row);
  }
  const keys = ['liftRows', 'liftRows2', 'liftRows3'] as const;
  keys.forEach((key, page) => {
    const slice = rows.slice(page * LIFT_ROWS_PER_PAGE, (page + 1) * LIFT_ROWS_PER_PAGE);
    if (slice.length > 0) th[key] = slice;
  });
  const shown = LIFT_ROWS_PER_PAGE * LIFT_PAGES;
  if (rows.length > shown) th.liftMore = rows.length - shown;

  const prList = (strength.prs as JsonObject[] | undefined) ?? [];
  if (prList.length > 0 || Array.isArray(strength.muscleSets)) has.muscle = 1;

  if (input.context) {
    th.ctx = contextData(input.context, locale);
    has.context = 1;
  }
  th.has = has;

  return {
    id: `threads:strength:${workout.id}`,
    kinds: ['threads'],
    heading: getT(locale, 'stickers')('threads.heading'),
    caption: '',
    date: base.date,
    data: { strength, th },
  };
}

// ------------------------------------------------------------------------------------------------------ per-slide data

/**
 * The data a slide is drawn with: the subject's data plus its position in the carousel (`th.n` of `th.total`) and the
 * person's choices. `showRoute` false drops the route (the summary slide then shows the numbers alone).
 */
export function slideData(subject: Pick<StickerSubject, 'data'>, position: { n: number; total: number }, choices: { showRoute?: boolean; name?: string | null } = {}): JsonObject {
  const data: JsonObject = { ...subject.data };
  data.th = { ...(subject.data.th as JsonObject), n: position.n, total: position.total };
  if (choices.showRoute === false && data.run) {
    const { route: _route, ...rest } = data.run as JsonObject;
    void _route;
    data.run = rest;
  }
  if (choices.name) data.user = { name: choices.name };
  return data;
}
