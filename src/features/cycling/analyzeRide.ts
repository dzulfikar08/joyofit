import { workoutStrain } from '@/features/today/strain';
import { keytelKcalPerMin, restKcalPerMin, type EnergyProfile } from '@/features/record/energy';
import { elevationProfile, elevationSummary, type ElevationProfile } from '@/features/workouts/analysis/elevation';
import type { WorkoutSummary } from '@/features/workouts/summary';

import { detectClimbs, gradeExtremes } from './climbs';
import {
  CURVE_DURATIONS,
  ftpSuggestion,
  intensityFactor,
  normalizedPower,
  powerCurve,
  powerZones,
  trainingStressScore,
  TSS_TO_TRIMP,
  wattsOf,
} from './power';
import { buildRideSeries, type RidePointInput, type RideSeries } from './series';
import type {
  CadenceBand,
  CalorieSource,
  RideAnalysis,
  RideCadence,
  RideCalories,
  RideDecoupling,
  RideElevation,
  RideHr,
  RideLap,
  RideLoad,
  RidePower,
  RideProfile,
  RideSpeed,
  RideSplit,
} from './types';

/**
 * Bump when a figure changes, so cached curves and load numbers are recomputed.
 *
 * 2: the heart-rate load (`trimpHr`) is Edwards' fixed %HRmax zones again; rows saved between the zone settings (95fd4fa) and this fix counted in the person's zones.
 */
export const RIDE_ENGINE_REV = 2;

/**
 * Elevation gain and loss of a ride: a 15 s mean of the altitude and a 2.5 m hysteresis. The running method (60 s and 1 m, fitted to
 * Strava's totals for walks, `workouts/analysis/elevation.ts`) is too slow for a bike: a minute is 400 m of road at 25 km/h and it
 * rounds small climbs away. With no Strava rides to fit, the pair is the one with the smallest mean error against the totals four
 * public bike-computer files carry (Garmin Edge 810 and 500, Wahoo ELEMNT, COROS Pace 2): 12.5 % mean absolute error on gain and loss.
 */
export const RIDE_ELEVATION_SMOOTH_SEC = 15;
export const RIDE_ELEVATION_HYSTERESIS_M = 2.5;

/** Distance per split, metres. */
export const SPLIT_M = 5000;
const MIN_PARTIAL_SPLIT_M = 500;
const MS_TO_KMH = 3.6;
/** Half of the first and second half of a ride are compared for decoupling only when 40 minutes remain after a 10 minute warm-up. */
const DECOUPLING_WARMUP_SEC = 600;
const DECOUPLING_MIN_SEC = 2400;
const DECOUPLING_MIN_HR_SHARE = 0.9;
/** Share of the covered seconds that must have a reading before a channel decides the calories. */
const COVERAGE_MIN = 0.5;
/** Mechanical work to food energy at a gross efficiency of 24 % (Coyle; Garmin and TrainingPeaks use the same rule of thumb): 1 kJ is 0.996 kcal. */
export const KCAL_PER_KJ = 1 / (0.24 * 4.184);

const CADENCE_EDGES: readonly number[] = [0, 1, 60, 70, 80, 90, 100, 110];
const INDOOR_SPORT_TYPES: readonly number[] = [7, 141];

export interface RideInput {
  workout: { start: number; end: number; duration: number; distance: number; calories: number; sportType: number; sportName: string };
  summary: WorkoutSummary;
  points: readonly RidePointInput[];
  profile: RideProfile;
}

/** MET of cycling by speed, Compendium of Physical Activities 2011 (codes 01011 to 01040), speeds in km/h from the mph bands. */
export function cyclingMet(kmh: number): number {
  if (kmh < 16.09) return 4.0;
  if (kmh < 19.31) return 6.8;
  if (kmh < 22.53) return 8.0;
  if (kmh < 25.75) return 10.0;
  if (kmh < 32.19) return 12.0;
  return 15.8;
}

function mean(values: ArrayLike<number>, series: RideSeries, from: number, to: number, skip?: (v: number) => boolean): number | null {
  let sum = 0;
  let count = 0;
  for (let i = from; i <= Math.min(to, series.n - 1); i++) {
    const v = values[i]!;
    if (!series.covered[i] || Number.isNaN(v) || skip?.(v)) continue;
    sum += v;
    count += 1;
  }
  return count > 0 ? sum / count : null;
}

function roundTo(value: number | null, decimals = 0): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function indexAtDistance(dist: Float64Array, d: number): number {
  let lo = 0;
  let hi = dist.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dist[mid]! < d) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

interface Segment {
  from: number;
  to: number;
}

function segmentStats(series: RideSeries, seg: Segment, profile: ElevationProfile | null, watts: Float64Array | null): Omit<RideSplit, 'n'> & { maxPower: number | null } {
  const { from, to } = seg;
  let movingSec = 0;
  for (let i = from; i < to; i++) movingSec += series.moving[i]!;
  const distM = series.dist[to]! - series.dist[from]!;
  const altStart = series.alt[from]!;
  const altEnd = series.alt[to]!;
  let maxPower: number | null = null;
  if (watts) {
    maxPower = 0;
    for (let i = from; i <= to; i++) maxPower = Math.max(maxPower, watts[i]!);
  }
  return {
    distM: Math.round(distM),
    sec: to - from,
    movingSec,
    avgSpeedKmh: movingSec > 0 && distM > 0 ? roundTo((distM / movingSec) * MS_TO_KMH, 1) : null,
    avgHr: roundTo(mean(series.hr, series, from, to)),
    avgCad: roundTo(mean(series.cad, series, from, to, (v) => v === 0)),
    avgPower: watts ? roundTo(mean(watts, series, from, to)) : null,
    gainM: profile ? roundTo(profile.cumGain[to]! - profile.cumGain[from]!, 1) : null,
    lossM: profile ? roundTo(profile.cumLoss[to]! - profile.cumLoss[from]!, 1) : null,
    avgGradePct: profile && distM >= 100 && !Number.isNaN(altStart) && !Number.isNaN(altEnd) ? roundTo(((altEnd - altStart) / distM) * 100, 1) : null,
    maxPower,
  };
}

/** Splits every `SPLIT_M` metres of the ridden distance; the last, partial one is kept from 500 m on. */
function buildSplits(series: RideSeries, profile: ElevationProfile | null, watts: Float64Array | null): RideSplit[] {
  const total = series.dist[series.n - 1]!;
  const whole = Math.floor(total / SPLIT_M);
  const ends: number[] = [];
  for (let k = 1; k <= whole; k++) ends.push(indexAtDistance(series.dist, k * SPLIT_M));
  if (total - whole * SPLIT_M >= MIN_PARTIAL_SPLIT_M) ends.push(series.n - 1);
  const splits: RideSplit[] = [];
  let from = 0;
  for (const to of ends) {
    if (to > from) {
      const { maxPower: _maxPower, ...stats } = segmentStats(series, { from, to }, profile, watts);
      splits.push({ n: splits.length + 1, ...stats });
    }
    from = to;
  }
  return splits;
}

function buildLaps(series: RideSeries, summary: WorkoutSummary, profile: ElevationProfile | null, watts: Float64Array | null): RideLap[] {
  const laps: RideLap[] = [];
  for (const lap of summary.laps ?? []) {
    const from = Math.max(0, Math.round(lap.startTs - series.start));
    const to = Math.min(series.n - 1, Math.round(lap.endTs - series.start));
    if (to <= from) continue;
    const stats = segmentStats(series, { from, to }, profile, watts);
    laps.push({ n: laps.length + 1, startSec: from, ...stats, distM: lap.distanceM !== null && lap.distanceM > 0 ? Math.round(lap.distanceM) : stats.distM });
  }
  return laps;
}

function buildCadence(series: RideSeries, summary: WorkoutSummary): RideCadence | null {
  const bands: CadenceBand[] = CADENCE_EDGES.map((from, i) => ({ fromRpm: from, toRpm: i + 1 < CADENCE_EDGES.length ? CADENCE_EDGES[i + 1]! : null, sec: 0 }));
  let pedalling = 0;
  let coasting = 0;
  let sum = 0;
  let max = 0;
  let any = false;
  for (let i = 0; i < series.n; i++) {
    const c = series.cad[i]!;
    if (!series.covered[i] || Number.isNaN(c)) continue;
    any = true;
    let b = 0;
    while (b + 1 < CADENCE_EDGES.length && c >= CADENCE_EDGES[b + 1]!) b += 1;
    bands[b]!.sec += 1;
    if (c > 0) {
      pedalling += 1;
      sum += c;
      max = Math.max(max, c);
    } else if (series.moving[i]) coasting += 1;
  }
  if (!any) {
    const avg = summary.avgCadence;
    return typeof avg === 'number' && avg > 0 ? { avg: Math.round(avg), max: summary.maxCadence ?? null, pedallingSec: 0, coastingSec: 0, bands: [] } : null;
  }
  return { avg: pedalling > 0 ? Math.round(sum / pedalling) : null, max: pedalling > 0 ? Math.round(max) : null, pedallingSec: pedalling, coastingSec: coasting, bands };
}

function buildPower(series: RideSeries, profile: RideProfile, summary: WorkoutSummary): RidePower | null {
  if (!series.hasPower) return null;
  const watts = wattsOf(series);
  let basisSec = 0;
  let sum = 0;
  let max = 0;
  let zero = 0;
  for (let i = 0; i < series.n; i++) {
    if (!series.covered[i]) continue;
    basisSec += 1;
    sum += watts[i]!;
    max = Math.max(max, watts[i]!);
    if (watts[i] === 0) zero += 1;
  }
  if (basisSec === 0) return null;
  const avg = sum / basisSec;
  const np = normalizedPower(watts, series.covered);
  const ftp = profile.ftp;
  const intensity = intensityFactor(np, ftp);
  const tss = trainingStressScore(basisSec, np, ftp);
  const kg = profile.weightKg > 0 ? profile.weightKg : null;
  return {
    avg: Math.round(avg),
    max: Math.round(max),
    normalized: roundTo(np),
    variabilityIndex: np !== null && avg > 0 ? roundTo(np / avg, 2) : null,
    intensityFactor: roundTo(intensity, 2),
    tss: roundTo(tss, 0),
    workKj: Math.round(sum / 1000),
    avgWkg: kg ? roundTo(avg / kg, 2) : null,
    normalizedWkg: kg && np !== null ? roundTo(np / kg, 2) : null,
    zeroSec: zero,
    balanceLeftPct: typeof summary.balanceLeftPct === 'number' ? roundTo(summary.balanceLeftPct, 1) : null,
    ftp,
    zones: ftp ? powerZones(watts, series.covered, ftp) : null,
    curve: powerCurve(watts, CURVE_DURATIONS).map((e) => ({ ...e, watts: Math.round(e.watts) })),
    basisSec,
  };
}

/** Efficiency factor (output over heart rate) of the first and second half of the steady part: Friel's aerobic decoupling. */
function buildDecoupling(series: RideSeries, hasPower: boolean): RideDecoupling | null {
  const idx: number[] = [];
  for (let i = 0; i < series.n; i++) if (series.covered[i] && series.moving[i]) idx.push(i);
  const steady = idx.slice(DECOUPLING_WARMUP_SEC);
  if (steady.length < DECOUPLING_MIN_SEC) return null;
  const half = steady.length >> 1;
  const watts = hasPower ? wattsOf(series) : null;
  const ef = (part: number[]): number | null => {
    let hrSum = 0;
    let hrCount = 0;
    let speedSum = 0;
    for (const i of part) {
      if (!Number.isNaN(series.hr[i]!)) {
        hrSum += series.hr[i]!;
        hrCount += 1;
      }
      if (!Number.isNaN(series.speed[i]!)) speedSum += series.speed[i]!;
    }
    if (hrCount < DECOUPLING_MIN_HR_SHARE * part.length || hrSum <= 0) return null;
    const hr = hrSum / hrCount;
    if (watts) {
      const np = normalizedPower(
        part.map((i) => watts[i]!),
        part.map(() => 1),
      );
      return np === null ? null : np / hr;
    }
    return ((speedSum / part.length) * 60) / hr;
  };
  const first = ef(steady.slice(0, half));
  const second = ef(steady.slice(half));
  if (first === null || second === null || first <= 0) return null;
  return { basis: watts ? 'power' : 'speed', pct: Math.round(((first - second) / first) * 1000) / 10, firstEf: Math.round(first * 1000) / 1000, secondEf: Math.round(second * 1000) / 1000 };
}

function buildCalories(series: RideSeries, workout: RideInput['workout'], power: RidePower | null, profile: RideProfile, avgMovingMs: number | null): RideCalories | null {
  let coveredCount = 0;
  let hrCount = 0;
  for (let i = 0; i < series.n; i++) {
    if (!series.covered[i]) continue;
    coveredCount += 1;
    if (!Number.isNaN(series.hr[i]!)) hrCount += 1;
  }
  if (coveredCount === 0) return workout.calories > 0 ? { kcal: Math.round(workout.calories), source: 'device' } : null;
  const energy: EnergyProfile = { weightKg: profile.weightKg, age: profile.age, sex: profile.sex, vo2max: profile.vo2max };
  let source: CalorieSource;
  let kcal: number;
  if (power && power.basisSec >= COVERAGE_MIN * coveredCount) {
    source = 'power';
    kcal = power.workKj * KCAL_PER_KJ;
  } else if (workout.calories > 0) {
    source = 'device';
    kcal = workout.calories;
  } else if (hrCount >= COVERAGE_MIN * coveredCount) {
    source = 'hr';
    kcal = 0;
    let last = 0;
    for (let i = 0; i < series.n; i++) {
      if (!series.covered[i]) continue;
      const hr = series.hr[i]!;
      if (!Number.isNaN(hr)) last = hr;
      if (last > 0) kcal += keytelKcalPerMin(last, energy) / 60;
    }
  } else {
    source = 'met';
    const met = cyclingMet(avgMovingMs === null ? 0 : avgMovingMs * MS_TO_KMH);
    let moving = 0;
    for (let i = 0; i < series.n; i++) moving += series.moving[i]!;
    const stopped = Math.max(0, coveredCount - moving);
    kcal = (met * profile.weightKg * moving) / 3600 + (restKcalPerMin(profile.weightKg) * stopped) / 60;
  }
  return kcal > 0 ? { kcal: Math.round(kcal), source } : null;
}

/**
 * The cycling analysis of one ride: times with a cycling auto-pause, km/h speeds, elevation, 5 km splits and the device's laps,
 * climbs, cadence, power (NP, IF, TSS, VI, zones, curve), heart rate with decoupling, energy and training load. Pure.
 */
export function analyzeRide(input: RideInput): RideAnalysis {
  const { workout, summary, profile } = input;
  const series = buildRideSeries({
    start: workout.start,
    end: workout.end,
    duration: workout.duration,
    distance: workout.distance,
    points: input.points,
    weightKg: profile.weightKg,
  });
  const indoor = !series.hasGps || INDOOR_SPORT_TYPES.includes(workout.sportType);

  let counted = 0;
  for (let i = 0; i < series.n; i++) counted += series.moving[i]!;
  const movingSec = Math.min(counted, series.timerSec);
  const times = { elapsedSec: series.elapsedSec, timerSec: series.timerSec, movingSec, stoppedSec: Math.max(0, series.timerSec - movingSec) };

  const total = series.dist[series.n - 1]!;
  const distanceM = workout.distance > 0 ? Math.round(workout.distance) : total > 0 ? Math.round(total) : null;
  const distance = distanceM ?? 0;
  let max = 0;
  for (let i = 0; i < series.n; i++) if (!Number.isNaN(series.speed[i]!)) max = Math.max(max, series.speed[i]!);
  const speed: RideSpeed = {
    avgMs: distance >= 100 && times.timerSec > 0 ? roundTo(distance / times.timerSec, 3) : null,
    avgMovingMs: distance >= 100 && movingSec > 0 ? roundTo(distance / movingSec, 3) : null,
    avgOverallMs: distance >= 100 && times.elapsedSec > 0 ? roundTo(distance / times.elapsedSec, 3) : null,
    maxMs: max > 0 ? roundTo(max, 2) : typeof summary.maxSpeed === 'number' ? summary.maxSpeed : null,
    source: series.speedSource,
  };

  const hasAlt = !indoor && series.alt.some((a) => !Number.isNaN(a));
  const altValues = hasAlt ? Array.from(series.alt, (a) => (Number.isNaN(a) ? null : a)) : null;
  const profileOfAlt = altValues ? elevationProfile(altValues, 1, RIDE_ELEVATION_SMOOTH_SEC, RIDE_ELEVATION_HYSTERESIS_M) : null;
  // A bike computer's own ascent and descent (a FIT file's session) are what Garmin and Strava show for a barometric device: used as
  // they are. Without them (phone GPS recording, a watch without totals) the profile of the altitude stream is computed.
  const deviceTotals =
    summary.ascentSource === 'device' ||
    (summary.ascentSource === undefined && summary.importedFrom !== undefined && typeof summary.elevationGain === 'number' && typeof summary.elevationLoss === 'number');
  const ascentSource: RideElevation['source'] = deviceTotals ? 'device' : 'computed';
  const summaryElevation = elevationSummary(altValues, profileOfAlt, deviceTotals ? { ...summary, importedFrom: summary.importedFrom ?? 'FIT file' } : { ...summary, importedFrom: undefined });
  let elevation: RideElevation | null = null;
  if (summaryElevation && !indoor) {
    const grade = hasAlt ? gradeExtremes(series) : null;
    const firstAt = series.alt.findIndex((a, i) => !Number.isNaN(a) && series.covered[i] === 1);
    const lastAt = series.alt.findLastIndex((a, i) => !Number.isNaN(a) && series.covered[i] === 1);
    const first = firstAt >= 0 ? mean(series.alt, series, firstAt, firstAt + 30) : null;
    const last = lastAt >= 0 ? mean(series.alt, series, Math.max(0, lastAt - 30), lastAt) : null;
    elevation = {
      source: ascentSource,
      gainM: Math.round(summaryElevation.gainM * 10) / 10,
      lossM: Math.round(summaryElevation.lossM * 10) / 10,
      minM: Math.round(summaryElevation.minM * 10) / 10,
      maxM: Math.round(summaryElevation.maxM * 10) / 10,
      avgGradePct: first !== null && last !== null && distance >= 500 ? roundTo(((last - first) / distance) * 100, 1) : null,
      maxGradePct: grade ? roundTo(grade.max, 1) : null,
      minGradePct: grade ? roundTo(grade.min, 1) : null,
    };
  }

  const power = buildPower(series, profile, summary);
  const watts = series.hasPower ? wattsOf(series) : null;
  const curveBest20 = power?.curve.find((e) => e.sec === 1200)?.watts ?? null;

  let hrCount = 0;
  let hrSum = 0;
  let hrMax = 0;
  for (let i = 0; i < series.n; i++) {
    const v = series.hr[i]!;
    if (!series.covered[i] || Number.isNaN(v)) continue;
    hrCount += 1;
    hrSum += v;
    hrMax = Math.max(hrMax, v);
  }
  const hr: RideHr = {
    avg: hrCount > 0 ? Math.round(hrSum / hrCount) : null,
    max: hrCount > 0 ? Math.round(hrMax) : null,
    decoupling: buildDecoupling(series, power !== null),
  };

  const trimp = workoutStrain(
    input.points.map((p) => ({ ts: p.ts, hr: p.hr ?? null })),
    profile.maxHr,
  )?.trimp ?? null;
  const tssTrimp = power?.tss != null ? power.tss * TSS_TO_TRIMP : null;
  const load: RideLoad = {
    trimp: roundTo(trimp, 1),
    tssTrimp: roundTo(tssTrimp, 1),
    trimpUsed: roundTo(tssTrimp ?? trimp, 1),
    basis: tssTrimp !== null ? 'tss' : trimp !== null ? 'hr' : null,
  };

  return {
    rev: RIDE_ENGINE_REV,
    indoor,
    times,
    distanceM,
    speed,
    elevation,
    splits: buildSplits(series, profileOfAlt, watts),
    laps: buildLaps(series, summary, profileOfAlt, watts),
    climbs: indoor ? [] : detectClimbs(series),
    cadence: buildCadence(series, summary),
    power,
    ftpSuggestion: ftpSuggestion(curveBest20),
    hr,
    calories: buildCalories(series, workout, power, profile, speed.avgMovingMs),
    load,
  };
}
