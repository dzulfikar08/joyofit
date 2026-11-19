import type { WorkoutPointRow } from '@/db/queries';
import { watchPauses } from '@/features/workouts/pause';
import { movingOf } from '@/features/workouts/times';

import { cleanFixes, haversineM, type CleanFix } from './geo';
import { isFootKind, hasPace } from './sport';
import { minuteCadenceGrid, type MinuteSteps } from './minuteCadence';
import { MAX_STEP_M, MIN_STEP_M } from './stride';
import type { LatLon, SportKind } from './types';

/** `workout_points` row with the per-sample columns of the watch's data frames; missing columns read as absent. */
export type AnalysisPoint = WorkoutPointRow & {
  /** Metres per second. */
  speed?: number | null;
  /** Steps per minute. */
  cadence?: number | null;
  /** Metres per step. */
  stride?: number | null;
  /** Watts. */
  power?: number | null;
};

/** The grid has at most this many steps (plus the one at t = 0), well inside the 720 the contract allows. */
const MAX_STEPS = 600;
/** The phone's finer chart grid: one sample per this many seconds (see `detailGridStep`), at most this many samples. */
const DETAIL_STEP_SEC = 12;
const DETAIL_MAX_STEPS = 4000;
const MIN_BPM = 20;
const MAX_BPM = 250;
/** Pace window: distance over time across this many seconds, centred on the sample. */
const PACE_WINDOW_SEC = 30;
const MAX_PACE_SEC_KM = 1800;
/** A gap between fixes still draws a line when it is short in time or in distance. */
const TRACK_GAP_SEC = 30;
const TRACK_GAP_M = 40;
/** Smallest GPS track (metres) that counts as a recording; a few stray fixes in a room do not. */
const MIN_GPS_DISTANCE_M = 20;
/** Under this ground speed (m/s) a stretch has no pace. */
const MIN_MOVING_SPEED_MS = 0.5;
const ALT_SMOOTH_SEC = 15;
const MIN_ALT_M = -500;
const MAX_ALT_M = 9000;
const MAX_SPEED_SAMPLE_MS = 60;

export type DistanceSource = 'gps' | 'speed' | 'spread';

/** Every series at full precision on the shared grid; `analyze` rounds them for the payload. */
export interface Grid {
  stepSec: number;
  n: number;
  elapsedSec: number;
  dist: number[] | null;
  distSource: DistanceSource | null;
  hr: (number | null)[] | null;
  pace: (number | null)[] | null;
  alt: (number | null)[] | null;
  /** Altitude with the gaps filled and no smoothing: what the elevation gain and loss are computed from. */
  altRaw: (number | null)[] | null;
  cad: (number | null)[] | null;
  /** Metres per step the source measured per sample (gaps filled like cadence); null when it did not, the chart then derives it from pace and cadence. */
  stride: (number | null)[] | null;
  power: (number | null)[] | null;
  track: (LatLon | null)[] | null;
  /** Seconds counted as moving: the watch's active time when a pause explains the difference, else the elapsed time (see `times.ts`). */
  movingSec: number;
  /** Cleaned GPS fixes (empty without a usable track), for best efforts and the full-resolution route. */
  fixes: CleanFix[];
  /** How the fixes' path length maps to the watch's distance; null without GPS or without a watch distance (the path itself is then the distance). */
  watch: WatchDistance | null;
  /** The watch's pauses in seconds from the start (`watchPauses`, the stretches the Strava file stops its timer for), in time order. */
  pauses: { start: number; end: number }[];
}

export interface GridInput {
  /** Unix seconds. */
  start: number;
  end: number;
  /** Active seconds of the watch. */
  duration: number;
  /** Watch distance in metres (0 when none). */
  distance: number;
  kind: SportKind;
  points: readonly AnalysisPoint[];
  /** The watch's per-minute step samples of the workout's day; on foot they give a cadence series when the points carry none. */
  minuteSteps?: readonly MinuteSteps[];
  /** Seconds per sample; the default is the shared grid's (`gridStep`). */
  stepSec?: number;
  /** The cleaned fixes of `points`, when the caller already has them (`cleanFixes`). */
  fixes?: CleanFix[];
}

interface Sample {
  t: number;
  v: number;
}

/** Elapsed seconds of the workout: `end - start`, or what the points and the active time say when `end` is unusable. */
export function elapsedOf(input: Pick<GridInput, 'start' | 'end' | 'duration' | 'points'>): number {
  if (input.end > input.start) return input.end - input.start;
  const lastTs = input.points.reduce((m, p) => Math.max(m, p.ts), input.start);
  return Math.max(input.duration, lastTs - input.start, 0);
}

export function gridStep(elapsedSec: number): number {
  return Math.max(1, Math.ceil(elapsedSec / MAX_STEPS));
}

/**
 * Seconds per sample of the phone's own chart grid, or null when the shared grid is already that fine. The shared grid is
 * capped at 600 steps (the cloud document and its schema depend on it), so a long ride gets a point every 72 s at 12 h;
 * the phone does not upload this grid, so it can follow the duration instead: a point per `DETAIL_STEP_SEC` seconds, at
 * most `DETAIL_MAX_STEPS` of them (a 12 h ride is 3 600 points, a 24 h one 4 000 at 22 s).
 */
export function detailGridStep(elapsedSec: number): number | null {
  const step = Math.max(DETAIL_STEP_SEC, Math.ceil(elapsedSec / DETAIL_MAX_STEPS));
  return step < gridStep(elapsedSec) ? step : null;
}

function collect(points: readonly AnalysisPoint[], start: number, pick: (p: AnalysisPoint) => number | null | undefined, ok: (v: number) => boolean): Sample[] {
  const out: Sample[] = [];
  for (const p of points) {
    const v = pick(p);
    if (v !== null && v !== undefined && Number.isFinite(v) && ok(v)) out.push({ t: p.ts - start, v });
  }
  return out;
}

/** Mean of the samples falling in each grid bucket (bucket i is centred on i * step); null for an empty bucket. */
function bucketMean(samples: readonly Sample[], step: number, n: number): (number | null)[] {
  const sums = new Array<number>(n).fill(0);
  const counts = new Array<number>(n).fill(0);
  for (const s of samples) {
    const i = Math.round(s.t / step);
    if (i < 0 || i >= n) continue;
    sums[i] += s.v;
    counts[i] += 1;
  }
  return sums.map((sum, i) => (counts[i] > 0 ? sum / counts[i] : null));
}

/** Linear fill of the empty stretches between two readings that are at most `maxGapSec` apart; longer gaps stay null. */
function fillGaps(values: (number | null)[], step: number, maxGapSec: number): (number | null)[] {
  const out = [...values];
  let prev = -1;
  for (let i = 0; i < out.length; i++) {
    if (values[i] === null) continue;
    if (prev >= 0 && i - prev > 1 && (i - prev) * step <= maxGapSec) {
      const a = values[prev] as number;
      const b = values[i] as number;
      for (let j = prev + 1; j < i; j++) out[j] = a + ((b - a) * (j - prev)) / (i - prev);
    }
    prev = i;
  }
  return out;
}

function hasValue(values: readonly (number | null)[] | null): values is (number | null)[] {
  return values !== null && values.some((v) => v !== null);
}

function windowOf(step: number): number {
  const w = Math.max(3, Math.round(ALT_SMOOTH_SEC / step));
  return w % 2 === 0 ? w + 1 : w;
}

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  const mid = values.length >> 1;
  return values.length % 2 === 1 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

/** Moving median then moving mean over about 15 s; nulls stay null and are skipped inside a window. */
function smooth(values: readonly (number | null)[], step: number): (number | null)[] {
  const h = (windowOf(step) - 1) >> 1;
  const pass = (src: readonly (number | null)[], reduce: (w: number[]) => number) =>
    src.map((v, i) => {
      if (v === null) return null;
      const w: number[] = [];
      for (let j = Math.max(0, i - h); j <= Math.min(src.length - 1, i + h); j++) {
        const x = src[j];
        if (x !== null) w.push(x);
      }
      return reduce(w);
    });
  return pass(pass(values, median), (w) => w.reduce((a, b) => a + b, 0) / w.length);
}

/** Cumulative distance and position on the grid from cleaned fixes. */
function gridFromFixes(fixes: readonly CleanFix[], start: number, step: number, n: number): { dist: number[]; track: (LatLon | null)[] } {
  const dist = new Array<number>(n);
  const track = new Array<LatLon | null>(n).fill(null);
  const first = fixes[0];
  const last = fixes[fixes.length - 1];
  const tol = Math.min(step, 5);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = start + i * step;
    if (t <= first.ts) {
      dist[i] = 0;
      if (first.ts - t <= tol) track[i] = [first.lat, first.lon];
      continue;
    }
    if (t >= last.ts) {
      dist[i] = last.dist;
      if (t - last.ts <= tol) track[i] = [last.lat, last.lon];
      continue;
    }
    while (fixes[k + 1].ts <= t) k++;
    const a = fixes[k];
    const b = fixes[k + 1];
    const f = (t - a.ts) / (b.ts - a.ts);
    dist[i] = a.dist + (b.dist - a.dist) * f;
    if (b.ts - a.ts < TRACK_GAP_SEC || haversineM(a.lat, a.lon, b.lat, b.lon) < TRACK_GAP_M) {
      track[i] = [a.lat + (b.lat - a.lat) * f, a.lon + (b.lon - a.lon) * f];
    }
  }
  return { dist, track };
}

/**
 * How the GPS path length becomes the watch's distance, the way the Strava file spreads it (`withDistance` in
 * `strava/activityFile.ts`): the stretch before the first fix and the one after the last move at the workout's average
 * speed (`total` over the moving time; the watch has no fix there, not no movement) and the fixes' path, scaled, takes the
 * rest, so the last sample is exactly `total` and the splits are Strava's. A path that would be left with nothing is only
 * scaled (`lead` and `tail` are then 0).
 */
export interface WatchDistance {
  /** Metres before the first fix. */
  lead: number;
  /** Metres after the last fix. */
  tail: number;
  /** Watch metres per metre of GPS path between the first and last fix. */
  scale: number;
  /** The GPS path length (metres) between the first and last fix. */
  length: number;
  /** Seconds from the start to the first and last fix. */
  firstSec: number;
  lastSec: number;
  elapsedSec: number;
  scaledOnly: boolean;
}

function watchDistance(fixes: readonly CleanFix[], start: number, elapsedSec: number, movingSec: number, total: number): WatchDistance {
  const first = fixes[0];
  const last = fixes[fixes.length - 1];
  const length = last.dist;
  const speed = movingSec > 0 ? total / movingSec : 0;
  const lead = speed * Math.min(Math.max(0, first.ts - start), elapsedSec);
  const tail = speed * Math.max(0, elapsedSec - Math.max(0, last.ts - start));
  const firstSec = first.ts - start;
  const lastSec = last.ts - start;
  if (!(total - lead - tail > 0)) return { lead: 0, tail: 0, scale: total / length, length, firstSec, lastSec, elapsedSec, scaledOnly: true };
  return { lead, tail, scale: (total - lead - tail) / length, length, firstSec, lastSec, elapsedSec, scaledOnly: false };
}

/** `path` is the grid's cumulative GPS distance (0 before the first fix, the full length after the last). */
function toWatchDistance(path: readonly number[], w: WatchDistance, step: number): number[] {
  if (w.scaledOnly) return path.map((d) => d * w.scale);
  return path.map((d, i) => {
    const t = Math.min(i * step, w.elapsedSec);
    if (t <= w.firstSec) return w.firstSec > 0 ? (w.lead * t) / w.firstSec : 0;
    if (t >= w.lastSec) return w.lead + w.scale * w.length + (w.elapsedSec > w.lastSec ? (w.tail * (t - w.lastSec)) / (w.elapsedSec - w.lastSec) : 0);
    return w.lead + w.scale * d;
  });
}

/**
 * Cumulative distance without GPS: `total` metres spread over the grid in proportion to `weights` (trapezoid), i.e. the
 * per-sample speed; uniformly when there are none. With no total, the integrated speed itself is the distance.
 */
function spreadDistance(weights: readonly number[] | null, total: number, step: number, n: number): number[] {
  const w = weights ?? new Array<number>(n).fill(1);
  const cum = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + ((w[i - 1] + w[i]) / 2) * step;
  const sum = cum[n - 1];
  if (total > 0 && sum > 0) return cum.map((c) => (c * total) / sum);
  return weights ? cum : cum.map(() => 0);
}

/** Seconds per km over a window of about 30 s centred on each sample; the last sample may lie past the end, so times are clamped to it. */
function paceSeries(dist: readonly number[], step: number, elapsedSec: number): (number | null)[] {
  const n = dist.length;
  const h = Math.max(1, Math.round(PACE_WINDOW_SEC / 2 / step));
  return dist.map((_, i) => {
    const lo = Math.max(0, i - h);
    const hi = Math.min(n - 1, i + h);
    const seconds = Math.min(hi * step, elapsedSec) - lo * step;
    if (hi <= lo || seconds <= 0) return null;
    const speed = (dist[hi] - dist[lo]) / seconds;
    if (speed < MIN_MOVING_SPEED_MS) return null;
    const pace = 1000 / speed;
    return pace > MAX_PACE_SEC_KM ? null : pace;
  });
}

/** Altitude of the points on the grid, empty buckets filled by interpolation, not smoothed. */
export function altitudeGrid(points: readonly AnalysisPoint[], start: number, stepSec: number, n: number): (number | null)[] {
  return fillGaps(bucketMean(collect(points, start, (p) => p.alt, (v) => v > MIN_ALT_M && v < MAX_ALT_M), stepSec, n), stepSec, Infinity);
}

/**
 * Builds a time grid: sample `i` is `i * stepSec` seconds after the start. The shared grid (the one the analysis, the cloud
 * copy and the posts carry) has `stepSec = max(1, ceil(elapsed / 600))`; `input.stepSec` asks for another one (the phone's
 * finer chart grid, see `detailGridStep`).
 * Heart rate is the mean per bucket with short gaps (up to 3 steps, at least 15 s) interpolated and longer ones left null;
 * altitude is interpolated and smoothed; the position follows the cleaned GPS track and the distance is that track's
 * path length scaled so the last sample is exactly the watch's total (GPS distance drifts; the watch's is what Strava
 * shows), so the track gives the map and the shape of the splits and the watch the total; with no GPS the distance is
 * the watch total spread over the speed samples (or uniformly), and the track is absent.
 */
export function buildGrid(input: GridInput): Grid {
  const { start, kind, points } = input;
  const elapsedSec = elapsedOf(input);
  const stepSec = input.stepSec ?? gridStep(elapsedSec);
  const n = Math.ceil(elapsedSec / stepSec) + 1;
  const fillSec = Math.max(3 * stepSec, 15);

  const hrRaw = bucketMean(collect(points, start, (p) => p.hr, (v) => v >= MIN_BPM && v <= MAX_BPM), stepSec, n);
  const hr = fillGaps(hrRaw, stepSec, fillSec);
  const storedCad = fillGaps(bucketMean(collect(points, start, (p) => p.cadence, (v) => v > 0), stepSec, n), stepSec, fillSec);
  const cad = hasValue(storedCad) || !isFootKind(kind) || !input.minuteSteps ? storedCad : (minuteCadenceGrid(input.minuteSteps, start, start + elapsedSec, stepSec, n) ?? storedCad);
  const stride = fillGaps(bucketMean(collect(points, start, (p) => p.stride, (v) => v >= MIN_STEP_M && v <= MAX_STEP_M), stepSec, n), stepSec, fillSec);
  const power = fillGaps(bucketMean(collect(points, start, (p) => p.power, (v) => v >= 0), stepSec, n), stepSec, fillSec);
  const altRaw = altitudeGrid(points, start, stepSec, n);
  const alt = smooth(altRaw, stepSec);

  const fixes = input.fixes ?? cleanFixes(points, kind);
  const hasGps = fixes.length >= 2 && fixes[fixes.length - 1].dist >= MIN_GPS_DISTANCE_M;
  let dist: number[] | null = null;
  let distSource: DistanceSource | null = null;
  let track: (LatLon | null)[] | null = null;
  let watch: WatchDistance | null = null;
  if (hasGps) {
    const g = gridFromFixes(fixes, start, stepSec, n);
    if (input.distance > 0) {
      watch = watchDistance(fixes, start, elapsedSec, movingOf(elapsedSec, input.duration), input.distance);
      dist = toWatchDistance(g.dist, watch, stepSec);
    } else {
      dist = g.dist;
    }
    track = g.track;
    distSource = 'gps';
  } else {
    const speed = fillGaps(bucketMean(collect(points, start, (p) => p.speed, (v) => v >= 0 && v <= MAX_SPEED_SAMPLE_MS), stepSec, n), stepSec, 30);
    if (hasValue(speed)) {
      dist = spreadDistance(speed.map((v) => v ?? 0), input.distance, stepSec, n);
      distSource = 'speed';
    } else if (input.distance > 0) {
      dist = spreadDistance(null, input.distance, stepSec, n);
      distSource = 'spread';
    }
    if (dist && dist[n - 1] <= 0) {
      dist = null;
      distSource = null;
    }
  }

  const pace = dist && distSource !== 'spread' && hasPace(kind) ? paceSeries(dist, stepSec, elapsedSec) : null;
  return {
    stepSec,
    n,
    elapsedSec,
    dist,
    distSource,
    hr: hasValue(hr) ? hr : null,
    altRaw: hasValue(altRaw) ? altRaw : null,
    pace: hasValue(pace) ? pace : null,
    alt: hasValue(alt) ? alt : null,
    cad: hasValue(cad) ? cad : null,
    stride: hasValue(stride) ? stride : null,
    power: hasValue(power) ? power : null,
    track: hasGps && track && track.some((p) => p !== null) ? track : null,
    movingSec: movingOf(elapsedSec, input.duration),
    fixes: hasGps ? fixes : [],
    watch,
    pauses: pausesOf(input),
  };
}

function pausesOf(input: GridInput): Grid['pauses'] {
  return watchPauses(input, input.points).map((p) => ({ start: p.start - input.start, end: p.end - input.start }));
}
