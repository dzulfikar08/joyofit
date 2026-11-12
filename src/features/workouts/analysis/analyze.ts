import type { WorkoutRow } from '@/db/queries';
import type { HrZones } from '@/features/hrzones/zones';
import { workoutStrain } from '@/features/today/strain';
import { splitWorkout } from '@/features/workouts/substrate';
import type { WorkoutSummary } from '@/features/workouts/summary';
import { averagePaceSec, averageSpeedMs } from '@/features/workouts/times';
import type { StepSample } from '@/wear';

import { buildEffort, buildLoad, type TrimpEntry } from './effort';
import { bestEfforts, type EffortSeconds } from './efforts';
import { elevationProfile, elevationSummary } from './elevation';
import { buildLaps } from './laps';
import { round, roundOrNull } from './round';
import { routeDetail, type RouteDetail } from './route';
import { buildGrid, detailGridStep, type AnalysisPoint, type Grid, type GridInput } from './series';
import { selectSimilar, type SimilarCandidate } from './similar';
import { hasPace, isFootKind, sportKind } from './sport';
import { kmSplits, paceBlockSplits, type SplitGrid } from './splits';
import { cadenceFigures } from './cadence';
import {
  ANALYSIS_LIMITS,
  WORKOUT_ANALYSIS_VERSION,
  type AnalysisSeries,
  type AnalysisSplit,
  type AnalysisStats,
  type LatLon,
  type SportKind,
  type WorkoutAnalysis,
} from './types';
import { hrZones, paceZones, thresholdPaceFromEfforts } from './zones';

const MIN_BPM = 20;
const MAX_BPM = 250;
const MAX_SPORT_NAME = 60;
const NORMALIZED_POWER_WINDOW_SEC = 30;

export interface AnalysisHistory {
  /** Best-effort seconds of the on-foot workouts of the same kind in the last 90 days (every run, whatever its sport name, for a run; see `loadAnalysisHistory`). The threshold pace comes from these. */
  efforts: readonly EffortSeconds[];
  /** TRIMP of the other workouts of the last 28 days. */
  trimps: readonly TrimpEntry[];
  /** Past workouts of the same sport, summary level. */
  similar: readonly SimilarCandidate[];
}

export interface AnalyzeInput {
  workout: WorkoutRow;
  summary: WorkoutSummary;
  points: readonly AnalysisPoint[];
  /** The person's heart-rate zones (`@/features/hrzones`): what the zone time, the burn split and the coaching read. Strain and load take only `zones.maxHr`. */
  zones: HrZones;
  /** Per-minute samples of the workout's day, oldest first, for `effort.addedToDay`. */
  daySamples: readonly StepSample[];
  history: AnalysisHistory;
}

/** What a shared post may contain. */
export interface AnalyzeOptions {
  includeHr: boolean;
  includeRoute: boolean;
  includeComparison: boolean;
}

function meanOf(values: readonly (number | null)[] | null): number | null {
  if (!values) return null;
  let sum = 0;
  let count = 0;
  for (const v of values) {
    if (v !== null) {
      sum += v;
      count += 1;
    }
  }
  return count > 0 ? sum / count : null;
}

function maxOf(values: readonly (number | null)[] | null): number | null {
  if (!values) return null;
  let max: number | null = null;
  for (const v of values) if (v !== null && (max === null || v > max)) max = v;
  return max;
}

function minOf(values: readonly (number | null)[] | null): number | null {
  if (!values) return null;
  let min: number | null = null;
  for (const v of values) if (v !== null && (min === null || v < min)) min = v;
  return min;
}

/** Normalized power: the fourth-power mean of 30 s rolling averages, back to the fourth root. Null under 30 s of data. */
function normalizedPowerOf(power: readonly (number | null)[] | null, stepSec: number): number | null {
  if (!power) return null;
  const w = Math.max(1, Math.round(NORMALIZED_POWER_WINDOW_SEC / stepSec));
  if (power.length < w) return null;
  let sum4 = 0;
  let count = 0;
  for (let i = 0; i + w <= power.length; i++) {
    let sum = 0;
    let ok = 0;
    for (let j = i; j < i + w; j++) {
      const v = power[j];
      if (v !== null) {
        sum += v;
        ok += 1;
      }
    }
    if (ok === 0) continue;
    sum4 += (sum / ok) ** 4;
    count += 1;
  }
  return count > 0 ? (sum4 / count) ** 0.25 : null;
}

function finitePositive(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** The distance the analysis shows: the watch's total, else where the grid's track ends; null when neither is above zero. */
export function analysisDistanceM(workout: Pick<WorkoutRow, 'distance'>, grid: Pick<Grid, 'dist' | 'n'>): number | null {
  if (workout.distance > 0) return Math.round(workout.distance);
  const last = grid.dist?.[grid.n - 1];
  return last !== undefined && last > 0 ? Math.round(last) : null;
}

/** Average speed in m/s: the distance over the moving time, as Strava computes it; the summary's own figure (distance over the watch's active time) only stands in without a distance. */
export function analysisAvgSpeedMs(distanceM: number | null, movingSec: number, summary: Pick<WorkoutSummary, 'avgSpeed'>): number | null {
  return (distanceM === null ? null : averageSpeedMs(distanceM, movingSec)) ?? finitePositive(summary.avgSpeed);
}

function buildStats(
  input: AnalyzeInput,
  grid: Grid,
  kind: SportKind,
  options: AnalyzeOptions,
  distanceM: number | null,
  hrValues: readonly number[],
): AnalysisStats {
  const { workout, summary, points } = input;
  const hrOk = options.includeHr;
  const hrMean = hrValues.length > 0 ? hrValues.reduce((a, b) => a + b, 0) / hrValues.length : null;
  const validBpm = (v: number | null) => (v !== null && v >= MIN_BPM && v <= MAX_BPM ? v : null);

  const bestPace = minOf(grid.pace) ?? finitePositive(summary.paceFastestSecPerKm) ?? finitePositive(summary.minPaceSecPerKm);
  // Average pace and speed are the watch's distance over the moving time, as Strava computes them; the summary's own
  // figures (distance over the watch's active time) only stand in when there is no distance.
  const avgSpeed = analysisAvgSpeedMs(distanceM, grid.movingSec, summary);
  const avgPace = hasPace(kind) ? (distanceM === null ? null : averagePaceSec(distanceM, grid.movingSec)) ?? finitePositive(summary.avgPaceSecPerKm) : null;
  const maxSpeed = finitePositive(summary.maxSpeed) ?? (bestPace !== null ? 1000 / bestPace : null);

  const { avgCad, maxCad, avgStrideM } = cadenceFigures({ kind, summary, steps: workout.steps, grid, points, avgSpeedMs: avgSpeed });

  const avgPower = meanOf(grid.power) ?? finitePositive(summary.avgPower);
  return {
    avgHr: hrOk ? roundOrNull(validBpm(workout.avgHr) ?? hrMean, 0) : null,
    maxHr: hrOk ? roundOrNull(validBpm(workout.maxHr) ?? maxOf(hrValues), 0) : null,
    minHr: hrOk ? roundOrNull(validBpm(summary.minHr ?? null) ?? (hrValues.length > 0 ? Math.min(...hrValues) : null), 0) : null,
    avgPaceSecKm: roundOrNull(avgPace, 0),
    bestPaceSecKm: roundOrNull(bestPace, 0),
    avgSpeedMs: roundOrNull(avgSpeed, 2),
    maxSpeedMs: roundOrNull(maxSpeed, 2),
    avgCad: roundOrNull(avgCad, 0),
    maxCad: roundOrNull(maxCad, 0),
    avgPower: roundOrNull(avgPower, 0),
    maxPower: roundOrNull(maxOf(grid.power) ?? finitePositive(summary.maxPower), 0),
    normalizedPower: roundOrNull(finitePositive(summary.normalizedPower) ?? normalizedPowerOf(grid.power, grid.stepSec), 0),
    avgStrideM: roundOrNull(avgStrideM, 2),
  };
}

function buildSeries(grid: Grid, options: AnalyzeOptions): AnalysisSeries | null {
  if (grid.n < 2) return null;
  const rounded = (values: readonly (number | null)[] | null, decimals: number) => (values ? values.map((v) => roundOrNull(v, decimals)) : null);
  const series: AnalysisSeries = {
    stepSec: grid.stepSec,
    n: grid.n,
    dist: grid.dist ? grid.dist.map((d) => Math.round(d)) : null,
    hr: options.includeHr ? rounded(grid.hr, 0) : null,
    pace: rounded(grid.pace, 0),
    alt: rounded(grid.alt, 1),
    cad: rounded(grid.cad, 0),
    power: rounded(grid.power, 0),
    // Only a measured step length travels: the chart derives the rest from pace and cadence, so the payload stays as before.
    ...(grid.stride ? { stride: rounded(grid.stride, 2) } : {}),
    track:
      options.includeRoute && grid.track
        ? grid.track.map((p): LatLon | null => (p ? [round(p[0], 5), round(p[1], 5)] : null))
        : null,
  };
  const carries = [series.dist, series.hr, series.pace, series.alt, series.cad, series.stride ?? null, series.power, series.track].some((a) => a !== null);
  return carries ? series : null;
}

/**
 * The full analysis of one workout, ready to store or post: the shared time grid with every series, splits, laps, zones,
 * best efforts, relative effort, training load, comparison with similar past workouts and summary stats. Pure: everything it
 * needs is passed in (history from `loadAnalysisHistory`). `options` says what a shared post may reveal: without
 * `includeRoute` there is no track, without `includeHr` no heart-rate series, zones, effort or load, without
 * `includeComparison` no comparison.
 */
export function analyzeWorkout(input: AnalyzeInput, options: AnalyzeOptions): WorkoutAnalysis {
  return run(input, options).analysis;
}

/** What only the phone draws, on top of the analysis: never uploaded or posted. */
export interface WorkoutDetail {
  /** The charts' series on a finer grid (`detailGridStep`) than the analysis', so a long ride keeps its peaks; null when the analysis' grid is already as fine. Same distance, same units. */
  series: AnalysisSeries | null;
  /** The route with every GPS fix instead of the grid's 600 positions; null without a track or when the options leave the route out. */
  route: RouteDetail | null;
}

/**
 * `analyzeWorkout` plus the phone-only detail. The analysis is identical to `analyzeWorkout`'s (the cloud copy and the posts
 * keep using that one, within the server's size limits); `detail` only replaces what the screen charts and maps.
 */
export function analyzeWorkoutWithDetail(input: AnalyzeInput, options: AnalyzeOptions): { analysis: WorkoutAnalysis; detail: WorkoutDetail } {
  const { analysis, grid, kind } = run(input, options);
  const step = detailGridStep(grid.elapsedSec);
  const fine =
    step === null
      ? null
      : buildSeries(buildGrid({ ...gridInputOf(input, kind), stepSec: step, fixes: grid.fixes }), options);
  return { analysis, detail: { series: fine, route: options.includeRoute ? routeDetail(grid.fixes, grid.watch, input.workout.start) : null } };
}

function gridInputOf(input: AnalyzeInput, kind: SportKind): GridInput {
  const { workout } = input;
  return {
    start: workout.start,
    end: workout.end,
    duration: workout.duration,
    distance: workout.distance,
    kind,
    points: input.points,
    minuteSteps: input.daySamples,
  };
}

function run(input: AnalyzeInput, options: AnalyzeOptions): { analysis: WorkoutAnalysis; grid: Grid; kind: SportKind } {
  const { workout, summary, points, history } = input;
  const kind = sportKind(workout.sportName, summary.kind);
  const foot = isFootKind(kind);
  const grid = buildGrid(gridInputOf(input, kind));

  const hrPoints = points.filter((p) => p.hr !== null && p.hr >= MIN_BPM && p.hr <= MAX_BPM);
  const strain = workoutStrain(hrPoints, input.zones.maxHr);

  const profile = grid.altRaw ? elevationProfile(grid.altRaw, grid.stepSec) : null;
  const splitGrid: SplitGrid = {
    stepSec: grid.stepSec,
    n: grid.n,
    dist: grid.dist,
    hr: options.includeHr ? grid.hr : null,
    cad: grid.cad,
    cumGain: profile?.cumGain ?? null,
    cumLoss: profile?.cumLoss ?? null,
    pauses: grid.pauses,
  };
  const hasBlocks = (summary.paceBlocks ?? []).some((b) => b.type === 0);
  let splits: AnalysisSplit[];
  if (grid.distSource === 'gps') splits = kmSplits(splitGrid, kind);
  else if (hasBlocks) splits = paceBlockSplits(summary.paceBlocks, splitGrid);
  else if (grid.distSource === 'speed') splits = kmSplits(splitGrid, kind);
  else splits = [];
  splits = splits.slice(0, ANALYSIS_LIMITS.splits);

  const efforts = foot ? bestEfforts(grid.fixes, history.efforts) : [];
  const threshold = foot && grid.pace ? thresholdPaceFromEfforts(efforts, history.efforts) : null;

  const distanceM = analysisDistanceM(workout, grid);
  const split = options.includeHr && workout.calories > 0 ? splitWorkout(workout.calories, hrPoints, input.zones) : null;
  const e = elevationSummary(grid.alt, profile, summary);
  const similar = options.includeComparison
    ? selectSimilar(
        { start: workout.start, duration: workout.duration, distance: workout.distance, sportName: workout.sportName },
        history.similar,
      )
    : null;
  const comparison =
    similar && !options.includeHr ? { ...similar, items: similar.items.map((item) => ({ ...item, avgHr: null })) } : similar;

  const analysis: WorkoutAnalysis = {
    v: WORKOUT_ANALYSIS_VERSION,
    sport: { name: workout.sportName.slice(0, MAX_SPORT_NAME), kind },
    startedAt: workout.start * 1000,
    elapsedSec: Math.round(grid.elapsedSec),
    movingSec: Math.round(grid.movingSec),
    distanceM,
    elevation: e ? { gainM: round(e.gainM, 1), lossM: round(e.lossM, 1), minM: round(e.minM, 1), maxM: round(e.maxM, 1) } : null,
    series: buildSeries(grid, options),
    splits,
    laps: buildLaps(summary.laps, workout.start, splitGrid, hasPace(kind), options.includeHr),
    hrZones: options.includeHr && strain ? hrZones(hrPoints, input.zones) : null,
    paceZones: threshold !== null && grid.pace ? paceZones(grid.pace, grid.stepSec, grid.elapsedSec, threshold) : null,
    bestEfforts: efforts,
    effort: options.includeHr && strain ? buildEffort(strain, workout, input.daySamples, input.zones.maxHr) : null,
    load: options.includeHr && strain ? buildLoad(strain.trimp, workout.start, history.trimps, summary) : null,
    calories:
      workout.calories > 0
        ? { kcal: Math.round(workout.calories), fatG: split ? round(split.fatGrams, 1) : null, carbG: split ? round(split.carbGrams, 1) : null }
        : null,
    comparison,
    stats: buildStats(input, grid, kind, options, distanceM, hrPoints.map((p) => p.hr as number)),
  };
  return { analysis, grid, kind };
}
