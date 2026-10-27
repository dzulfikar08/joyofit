import type { WorkoutRow } from '@/db/queries';
import { workoutTotals } from '@/features/strength/calc';
import { getWeightUnit, kgToUnit } from '@/features/strength/units';
import type { StrengthWorkout } from '@/features/strength/types';
import { getT, type Locale } from '@/i18n';
import { downsample, formatElapsed, kmSplits, type RoutePoint, type WorkoutSummary } from '@/features/workouts/summary';
import { sportLabel } from '@/features/workouts/sportLabel';
import { averagePaceSec, averageSpeedMs, workoutTimes } from '@/features/workouts/times';
import { summaryCadence } from '@/features/workouts/analysis/cadence';
import { sportKind, hasPace } from '@/features/workouts/analysis/sport';
import { isCardioMachine, sportCategory, type SportCategory } from '@/features/workouts/sportCategory';
import {
  BEST_EFFORT_DISTANCES,
  type AnalysisBestEffort,
  type BestEffortKey,
  type SportKind,
  type WorkoutAnalysis,
} from '@/features/workouts/analysis/types';
import type { JsonObject, StickerKind, StickerSubject } from '../subject';
import { CATEGORY_KIND, DEFAULT_GROUP, dropInapplicable, metricApplies } from './sportMetrics';

export interface RunSubjectInput {
  workout: WorkoutRow;
  summary: WorkoutSummary;
  analysis: WorkoutAnalysis | null;
  route: readonly RoutePoint[];
  gearLine: string | null;
  /** The strength log merged with this watch workout, when there is one: its sets, reps and volume go on the gym cards. */
  strength?: Pick<StrengthWorkout, 'exercises'> | null;
}

export const ROUTE_MAX_POINTS = 500;
export const SPLITS_MAX = 60;
export const SERIES_MAX_POINTS = 48;
const MIN_SERIES_REAL = 8;
const MIN_DERIVED_SECONDS = 30;
const MAX_PACE_SEC = 3600;
const STRAIN_MAX = 21;
const TEXT_MAX = 60;
const ZONE_COLORS = ['#5FD3EE', '#6EE7A0', '#F5D547', '#FF9F43', '#FF4D6A'];

const PR_KEYS = {
  '400m': 'run.pr.label.m400',
  '1k': 'run.pr.label.k1',
  '1mi': 'run.pr.label.mile1',
  '5k': 'run.pr.label.k5',
  '10k': 'run.pr.label.k10',
  half: 'run.pr.label.half',
} as const satisfies Record<BestEffortKey, string>;

function num(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function pos(v: unknown): v is number {
  return num(v) && v > 0;
}

function cleanText(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  return s.length > TEXT_MAX ? `${s.slice(0, TEXT_MAX - 3).trimEnd()}...` : s;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Fills gaps by linear interpolation (edges take the nearest value); null unless enough of the array is real. */
export function filledSeries(values: readonly (number | null | undefined)[] | null | undefined): number[] | null {
  if (!values || values.length === 0) return null;
  const real = values.filter(num).length;
  if (real < MIN_SERIES_REAL || real < values.length / 2) return null;
  const out: number[] = new Array(values.length);
  let prev = -1;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!num(v)) continue;
    out[i] = v;
    if (prev === -1) for (let j = 0; j < i; j++) out[j] = v;
    else
      for (let j = prev + 1; j < i; j++) {
        out[j] = out[prev]! + ((v - out[prev]!) * (j - prev)) / (i - prev);
      }
    prev = i;
  }
  for (let j = prev + 1; j < values.length; j++) out[j] = out[prev]!;
  return out;
}

export function speedFromPace(pace: number | null | undefined): number | null {
  return pos(pace) && pace <= MAX_PACE_SEC ? 3600 / pace : null;
}

/** Pace per km on foot (run, walk, orienteering, obstacle race), per 100 m in the pool, speed for the rest. */
function paceFields(
  workout: WorkoutRow,
  summary: WorkoutSummary,
  movingSec: number,
  category: SportCategory,
  out: JsonObject,
): void {
  const kind = category === 'swim' ? 'pace100m' : category === 'run' || category === 'walk' ? 'paceKm' : 'speed';
  const derivable = movingSec >= MIN_DERIVED_SECONDS;
  if (kind === 'speed') {
    const ms = (derivable ? averageSpeedMs(workout.distance, movingSec) : null) ?? summary.avgSpeed;
    if (pos(ms)) out.speedKmh = round1(ms * 3.6);
    return;
  }
  const per100 = kind === 'pace100m';
  const watchPace = per100 ? summary.avgPaceSecPer100m : summary.avgPaceSecPerKm;
  const pace = (derivable ? averagePaceSec(workout.distance, movingSec, per100 ? 100 : 1000) : null) ?? watchPace;
  if (!pos(pace) || pace > MAX_PACE_SEC) return;
  out[per100 ? 'pace100Sec' : 'paceSecKm'] = Math.round(pace);
}

interface SplitRow {
  label: string;
  kmh: number;
}

function splitRows(summary: WorkoutSummary, analysis: WorkoutAnalysis | null): SplitRow[] {
  const rows: SplitRow[] = [];
  if (analysis && analysis.splits.length > 0) {
    for (const s of analysis.splits) {
      if (s.distM < 999) continue;
      const kmh = speedFromPace(s.paceSecKm);
      if (kmh !== null) rows.push({ label: String(s.n), kmh });
    }
    return rows;
  }
  kmSplits(summary).forEach((s, i) => {
    if (Math.abs(s.km - Math.round(s.km)) > 1e-9) return;
    const kmh = speedFromPace(s.pace);
    if (kmh !== null) rows.push({ label: String(i + 1), kmh });
  });
  return rows;
}

function rankOne(analysis: WorkoutAnalysis | null): AnalysisBestEffort[] {
  if (!analysis) return [];
  return analysis.bestEfforts
    .filter((b) => b.rank === 1 && pos(b.sec) && b.key in PR_KEYS)
    .sort((a, b) => BEST_EFFORT_DISTANCES[b.key] - BEST_EFFORT_DISTANCES[a.key]);
}

/** Laps, strokes, SWOLF and pool length of a swim, as the watch summed them up. */
function swimFields(summary: WorkoutSummary, out: JsonObject): void {
  const swim = summary.swim;
  if (!swim) return;
  if (pos(swim.laps)) out.laps = Math.round(swim.laps);
  if (pos(swim.strokes)) out.strokes = Math.round(swim.strokes);
  if (pos(swim.avgSwolf)) out.swolf = Math.round(swim.avgSwolf);
  if (pos(swim.avgStrokeRate)) out.strokeRate = Math.round(swim.avgStrokeRate);
  if (pos(swim.poolLengthCm)) out.poolM = Math.round(swim.poolLengthCm / 100);
}

/** Working sets, reps and volume of the strength log merged with the workout (warm-up sets do not count). */
function liftFields(strength: Pick<StrengthWorkout, 'exercises'>, out: JsonObject): void {
  const totals = workoutTotals(strength);
  if (pos(totals.volume)) {
    out.volume = round1(kgToUnit(totals.volume));
    out.unit = getWeightUnit();
  }
  if (pos(totals.sets)) out.sets = totals.sets;
  if (pos(totals.reps)) out.reps = totals.reps;
  if (pos(totals.exercises)) out.exercises = totals.exercises;
}

export function buildRunSubject(input: RunSubjectInput, locale: 'id' | 'en' | Locale): StickerSubject {
  const { workout, summary, analysis, route, gearLine, strength } = input;
  const t = getT(locale as Locale, 'stickerdata');
  const run: JsonObject = {};

  const kind: SportKind = analysis?.sport.kind ?? sportKind(workout.sportName, summary.kind);
  const category = sportCategory(workout.sportName, summary.kind, kind);
  const sport = cleanText(sportLabel(workout.sportName));
  if (sport) run.sport = sport;
  run.kind = kind;
  run.category = category;
  run.startedAt = workout.start * 1000;

  const { elapsedSec, movingSec } = workoutTimes(workout);
  if (movingSec > 0 && Number.isFinite(movingSec)) run.movingSec = movingSec;
  if (Number.isFinite(elapsedSec) && elapsedSec - movingSec >= 60) run.elapsedSec = elapsedSec;
  const distance = pos(workout.distance) ? workout.distance : (analysis?.distanceM ?? null);
  if (pos(distance)) run.distanceM = distance;
  paceFields(workout, summary, movingSec, category, run);

  const hrAvg = pos(workout.avgHr) ? workout.avgHr : analysis?.stats.avgHr;
  const hrMax = pos(workout.maxHr) ? workout.maxHr : analysis?.stats.maxHr;
  if (pos(hrAvg)) run.hrAvg = Math.round(hrAvg);
  if (pos(hrMax)) run.hrMax = Math.round(hrMax);
  const hasHr = pos(hrAvg) || pos(hrMax);
  const kcal = pos(workout.calories) ? workout.calories : analysis?.calories?.kcal;
  if (pos(kcal)) run.kcal = Math.round(kcal);
  const elev = summary.elevationGain ?? analysis?.elevation?.gainM;
  if (num(elev) && elev >= 1) run.elevGainM = Math.round(elev);
  const cadence = analysis?.stats.avgCad ?? summaryCadence(kind, summary, 'avg');
  if (pos(cadence)) run.cadence = Math.round(cadence);
  const power = analysis?.stats.avgPower ?? summary.avgPower;
  if (pos(power)) run.power = Math.round(power);
  // A jump rope session counts jumps; the watch stores them as its steps when the summary has no jump count of its own.
  const jumpRope = summary.kind === 'JUMP_ROPING' || /jump(?:ing)? rop|skipping/i.test(workout.sportName);
  const jumps = pos(summary.jumps) ? summary.jumps : jumpRope ? workout.steps : null;
  if (pos(jumps)) run.jumps = Math.round(jumps);
  if (pos(workout.steps) && !jumpRope) run.steps = Math.round(workout.steps);
  swimFields(summary, run);
  if (strength) liftFields(strength, run);

  const points = route.filter((p) => num(p.lat) && num(p.lon));
  if (points.length >= 2) run.route = downsample(points, ROUTE_MAX_POINTS).map((p) => [p.lat, p.lon]);

  const rows = splitRows(summary, analysis);
  if (rows.length >= 2) {
    const kept = downsample(Array.from({ length: rows.length }, (_, i) => i), SPLITS_MAX).map((i) => rows[i]!);
    run.splitKmh = kept.map((r) => round1(r.kmh));
    run.splitLabels = kept.map((r) => r.label);
    let fastest = 0;
    kept.forEach((r, i) => {
      if (r.kmh > kept[fastest]!.kmh) fastest = i;
    });
    run.splitFastest = fastest;
  }

  const zones = analysis?.hrZones;
  if (hasHr && zones && zones.sec.length >= 5) {
    // The templates draw five zones: the reserve method's sixth (anaerobic advance) joins the fifth.
    const sec = zones.sec.slice(0, 5).map((s) => (pos(s) ? s : 0));
    if (pos(zones.sec[5])) sec[4] += zones.sec[5] as number;
    const total = sec.reduce((a, b) => a + b, 0);
    if (total > 0) {
      run.hrZoneSec = sec;
      run.hrZonePct = sec.map((s) => s / total);
      run.hrZoneLabels = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'];
      run.hrZoneColors = [...ZONE_COLORS];
      run.hrZoneTop = sec.indexOf(Math.max(...sec)) + 1;
    }
  }

  const series = analysis?.series;
  if (series) {
    if (hasHr) {
      const hr = filledSeries(series.hr?.map((v) => (pos(v) ? v : null)));
      if (hr) run.hrSeries = downsample(hr, SERIES_MAX_POINTS).map(Math.round);
    }
    if (hasPace(kind)) {
      const pace = filledSeries(series.pace?.map(speedFromPace));
      if (pace) run.paceSeries = downsample(pace, SERIES_MAX_POINTS).map(round1);
    }
    const alt = filledSeries(series.alt);
    if (alt && Math.max(...alt) - Math.min(...alt) >= 3) {
      run.altSeries = downsample(alt, SERIES_MAX_POINTS).map(round1);
    }
  }

  const effort = analysis?.effort;
  if (effort && num(effort.strain) && effort.strain >= 0) {
    const strain = round1(Math.min(effort.strain, STRAIN_MAX));
    run.strain = strain;
    run.strainPct = strain / STRAIN_MAX;
    run.effortLabel = t(`run.effort.${effort.band}`);
  }

  // What the sport family has no use for goes before any template sees it, so the running cards hide it too.
  const machine = isCardioMachine(workout.sportName);
  dropInapplicable(run, category, machine);
  const prs = metricApplies(category, 'records', machine) ? rankOne(analysis) : [];
  const gear = cleanText(gearLine);
  if (gear) run.gear = gear;

  const data: JsonObject = { run };
  const family = CATEGORY_KIND[category];
  const kinds: StickerKind[] = family ? [family, 'run'] : ['run'];
  if (prs.length > 0) kinds.push('badge');
  if (prs.length > 0) {
    const top = prs[0]!;
    const label = t(PR_KEYS[top.key]);
    run.prLabel = label;
    run.prTime = top.sec;
    run.prCount = prs.length;
    data.milestone = {
      kind: 'pr',
      title: label,
      subtitle: t('run.pr.subtitle'),
      value: top.sec,
      valueText: formatElapsed(top.sec),
    };
  }

  const sharing = getT(locale as Locale, 'sharing');
  return {
    id: `run:${workout.start}`,
    kinds,
    defaultGroup: DEFAULT_GROUP[category],
    heading: sharing('share.workout.heading'),
    caption: sharing('share.caption'),
    date: workout.start * 1000,
    data,
  };
}
