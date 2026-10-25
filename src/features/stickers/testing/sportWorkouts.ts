/**
 * Watch workouts of every sport family, as the workout screen hands them to `buildRunSubject`: the stored row, its summary
 * JSON and a small analysis (heart rate zones and strain). The numbers are what a Huawei watch records for these sessions,
 * including the step-derived distance it reports for indoor and court sports, so the tests see the same noise as the app.
 */
import type { WorkoutRow } from '@/db/queries';
import { WORKOUT_ANALYSIS_VERSION, type SportKind, type WorkoutAnalysis } from '@/features/workouts/analysis/types';
import type { RoutePoint, WorkoutSummary } from '@/features/workouts/summary';

import type { RunSubjectInput } from '../data/run';
import { lineRoute, loopRoute } from './routes';

export interface SportWorkout {
  /** `<family>.<case>`, e.g. `gym.watch`. */
  key: string;
  label: string;
  input: RunSubjectInput;
}

const DAY = Date.UTC(2026, 9, 20, 0, 0) / 1000;

function row(i: number, sportName: string, o: { durationSec: number; distanceM?: number; kcal?: number; avgHr?: number; maxHr?: number; steps?: number }): WorkoutRow {
  const start = DAY + i * 86400 + 6 * 3600;
  return {
    id: i + 1,
    workoutNumber: i + 1,
    start,
    end: start + o.durationSec + 20,
    sportType: 0,
    sportName,
    duration: o.durationSec,
    distance: o.distanceM ?? 0,
    calories: o.kcal ?? 0,
    avgHr: o.avgHr ?? null,
    maxHr: o.maxHr ?? null,
    steps: o.steps ?? 0,
    complete: true,
    imported: false,
  };
}

/** A minimal analysis: the zones and strain a heart rate trace gives, nothing GPS-bound. */
function analysis(kind: SportKind, w: WorkoutRow, zoneSec: number[], strain: number, band: 'light' | 'moderate' | 'hard' | 'max'): WorkoutAnalysis {
  return {
    v: WORKOUT_ANALYSIS_VERSION,
    sport: { name: w.sportName, kind },
    startedAt: w.start * 1000,
    elapsedSec: w.end - w.start,
    movingSec: w.duration,
    distanceM: null,
    elevation: null,
    series: null,
    splits: [],
    laps: [],
    hrZones: { method: 'max', maxHr: 190, source: 'age', bounds: [95, 114, 133, 152, 171, 190], sec: zoneSec, belowSec: 0 },
    paceZones: null,
    bestEfforts: [],
    effort: { strain, trimp: strain * 10, band, addedToDay: null },
    load: null,
    calories: null,
    comparison: null,
    stats: { avgHr: w.avgHr, maxHr: w.maxHr, minHr: null, avgPaceSecKm: null, bestPaceSecKm: null, avgSpeedMs: null, maxSpeedMs: null, avgCad: null, maxCad: null, avgPower: null, maxPower: null, normalizedPower: null, avgStrideM: null },
  };
}

const route = (pairs: [number, number][]): RoutePoint[] => pairs.map(([lat, lon]) => ({ lat, lon }));

function make(key: string, label: string, workout: WorkoutRow, summary: WorkoutSummary, extra: Partial<RunSubjectInput> = {}): SportWorkout {
  return { key, label, input: { workout, summary, analysis: null, route: [], gearLine: null, ...extra } };
}

const gym = row(0, 'Strength Training', { durationSec: 3120, distanceM: 640, kcal: 318, avgHr: 118, maxHr: 158, steps: 910 });
const swim = row(1, 'Pool Swimming', { durationSec: 2460, distanceM: 1500, kcal: 402, avgHr: 134, maxHr: 161 });
const ride = row(2, 'Biking', { durationSec: 5410, distanceM: 38_700, kcal: 960, avgHr: 141, maxHr: 172 });
const hiit = row(3, 'High-intensity Interval Training', { durationSec: 1820, distanceM: 1230, kcal: 312, avgHr: 149, maxHr: 182, steps: 2140 });
const yoga = row(4, 'Yoga', { durationSec: 3600, kcal: 176, avgHr: 92, maxHr: 118 });
const badminton = row(5, 'Badminton', { durationSec: 4260, distanceM: 3120, kcal: 548, avgHr: 141, maxHr: 176, steps: 5240 });
const hike = row(6, 'Hiking', { durationSec: 10_840, distanceM: 9240, kcal: 1010, avgHr: 121, maxHr: 158, steps: 14_210 });
const rope = row(7, 'Jumping Rope', { durationSec: 900, kcal: 168, avgHr: 156, maxHr: 179, steps: 1420 });
const indoorRide = row(8, 'Indoor Cycling', { durationSec: 2700, distanceM: 18_100, kcal: 420, avgHr: 138, maxHr: 166 });
const run = row(9, 'Running', { durationSec: 1992, distanceM: 5240, kcal: 402, avgHr: 154, maxHr: 178, steps: 5720 });
const golf = row(10, 'Golf', { durationSec: 9000, distanceM: 6400, kcal: 830, avgHr: 104, maxHr: 131, steps: 11_200 });

/** One workout per sport family (plus a jump rope, an indoor ride, a run and an unknown sport). */
export const SPORT_WORKOUTS: readonly SportWorkout[] = [
  make('gym.watch', 'Watch strength session with step-derived distance and cadence', gym, { kind: 'STRENGTH_TRAINING', samples: { avgStepRate: 18 } }, {
    analysis: analysis('other', gym, [420, 1260, 980, 380, 80], 9.6, 'moderate'),
  }),
  make('swim.pool', 'Pool swim with laps, strokes and SWOLF', swim, {
    kind: 'SWIMMING',
    avgPaceSecPer100m: 164,
    swim: { style: 'Freestyle', strokes: 1020, avgStrokeRate: 26, poolLengthCm: 2500, laps: 60, avgSwolf: 38 },
  }),
  make('ride.outdoor', 'Outdoor ride with route, climb, cadence and power', ride, { kind: 'CYCLING', elevationGain: 412, avgCadence: 84, avgPower: 168 }, {
    route: route(loopRoute(520, 2600, 3)),
  }),
  make('cardio.hiit', 'HIIT with step-derived distance', hiit, { kind: 'HIIT', samples: { avgStepRate: 71 } }, {
    analysis: analysis('other', hiit, [120, 240, 520, 640, 300], 13.1, 'hard'),
  }),
  make('flow.yoga', 'Yoga', yoga, { kind: 'YOGA' }, { analysis: analysis('other', yoga, [2400, 900, 300, 0, 0], 3.2, 'light') }),
  make('court.badminton', 'Badminton with step-derived distance and steps', badminton, { kind: 'BADMINTON' }, {
    analysis: analysis('other', badminton, [300, 900, 1500, 1260, 300], 12.4, 'hard'),
  }),
  make('walk.hike', 'Hike with route, climb and steps', hike, { kind: 'HIKING', elevationGain: 642 }, { route: route(lineRoute(480, 9240)) }),
  make('cardio.rope', 'Jump rope: the watch counts jumps as steps', rope, { kind: 'JUMP_ROPING', jumps: 1420 }),
  make('ride.indoor', 'Indoor ride, no route', indoorRide, { kind: 'INDOOR_CYCLING', avgCadence: 88, avgPower: 182 }),
  make('run.road', 'Road run', run, { kind: 'RUNNING', elevationGain: 38, avgCadence: 172 }, { route: route(loopRoute(520, 420)) }),
  make('other.golf', 'Golf: a sport outside every family', golf, { kind: 'GOLF' }),
];

export function sportWorkout(key: string): SportWorkout {
  const found = SPORT_WORKOUTS.find((w) => w.key === key);
  if (!found) throw new Error(`no sport workout ${key}`);
  return found;
}
