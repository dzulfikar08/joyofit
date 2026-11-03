import type { SportCategory } from '@/features/workouts/sportCategory';
import type { JsonObject } from '../subject';

export interface MetricDef {
  id: string;
  labelKey: string;
  isAvailable: (run: JsonObject) => boolean;
  /** A word, not a number (the swim style): it fits a slot but not the hero's poster-size numerals. */
  text?: true;
}

const pos = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const METRIC_CATALOG: readonly MetricDef[] = [
  { id: 'time', labelKey: 'time', isAvailable: (r) => pos(r.movingSec) || pos(r.elapsedSec) },
  { id: 'distance', labelKey: 'distance', isAvailable: (r) => pos(r.distanceM) },
  { id: 'pace', labelKey: 'pace', isAvailable: (r) => pos(r.paceSecKm) || pos(r.pace100Sec) },
  { id: 'speed', labelKey: 'speed', isAvailable: (r) => pos(r.speedKmh) },
  { id: 'hr', labelKey: 'avgHr', isAvailable: (r) => pos(r.hrAvg) },
  { id: 'hrMax', labelKey: 'maxHr', isAvailable: (r) => pos(r.hrMax) },
  { id: 'kcal', labelKey: 'kcal', isAvailable: (r) => pos(r.kcal) },
  { id: 'elevation', labelKey: 'elevation', isAvailable: (r) => num(r.elevGainM) },
  { id: 'cadence', labelKey: 'cadence', isAvailable: (r) => pos(r.cadence) },
  { id: 'power', labelKey: 'power', isAvailable: (r) => pos(r.power) },
  { id: 'steps', labelKey: 'steps', isAvailable: (r) => pos(r.steps) },
  { id: 'jumps', labelKey: 'jumps', isAvailable: (r) => pos(r.jumps) },
  { id: 'laps', labelKey: 'laps', isAvailable: (r) => pos(r.laps) },
  { id: 'swolf', labelKey: 'swolf', isAvailable: (r) => pos(r.swolf) },
  { id: 'strokes', labelKey: 'strokes', isAvailable: (r) => pos(r.strokes) },
  { id: 'swimStyle', labelKey: 'swimStyle', isAvailable: (r) => typeof r.swimStyle === 'string' && r.swimStyle.length > 0, text: true },
  { id: 'strokeRate', labelKey: 'strokeRate', isAvailable: (r) => pos(r.strokeRate) },
  { id: 'pool', labelKey: 'pool', isAvailable: (r) => pos(r.poolM) },
  { id: 'volume', labelKey: 'volume', isAvailable: (r) => pos(r.volume) },
  { id: 'sets', labelKey: 'sets', isAvailable: (r) => pos(r.sets) },
  { id: 'reps', labelKey: 'reps', isAvailable: (r) => pos(r.reps) },
  { id: 'exercises', labelKey: 'exercises', isAvailable: (r) => pos(r.exercises) },
  { id: 'fastPace', labelKey: 'bestPace', isAvailable: (r) => pos(r.paceFastestSec) },
  { id: 'maxSpeed', labelKey: 'maxSpeed', isAvailable: (r) => pos(r.maxSpeedKmh) },
  { id: 'elevLoss', labelKey: 'elevLoss', isAvailable: (r) => num(r.elevLossM) },
  { id: 'stepLength', labelKey: 'stepLength', isAvailable: (r) => pos(r.stepLengthCm) },
  { id: 'jumpRate', labelKey: 'jumpRate', isAvailable: (r) => pos(r.jumpRate) },
  { id: 'longestStreak', labelKey: 'longestStreak', isAvailable: (r) => pos(r.longestStreak) },
  { id: 'interruptions', labelKey: 'interruptions', isAvailable: (r) => pos(r.interruptions) },
  { id: 'minHr', labelKey: 'minHr', isAvailable: (r) => pos(r.minHr) },
  { id: 'maxPower', labelKey: 'maxPower', isAvailable: (r) => pos(r.maxPower) },
  { id: 'aerobic', labelKey: 'aerobicEffect', isAvailable: (r) => pos(r.aerobicEffect) },
  { id: 'anaerobic', labelKey: 'anaerobicEffect', isAvailable: (r) => pos(r.anaerobicEffect) },
  { id: 'vo2max', labelKey: 'vo2max', isAvailable: (r) => pos(r.vo2max) },
  { id: 'recovery', labelKey: 'recoveryHours', isAvailable: (r) => pos(r.recoveryHours) },
  { id: 'workoutLoad', labelKey: 'trainingLoad', isAvailable: (r) => pos(r.workoutLoad) },
];

export const PRIORITY_BY_CATEGORY: Readonly<Record<SportCategory, readonly string[]>> = {
  run: ['time', 'pace', 'hr', 'kcal', 'elevation', 'cadence', 'steps', 'fastPace', 'stepLength', 'vo2max'],
  walk: ['time', 'pace', 'elevation', 'steps', 'hr', 'kcal', 'stepLength'],
  ride: ['time', 'speed', 'elevation', 'cadence', 'power', 'hr', 'kcal', 'maxSpeed', 'maxPower'],
  swim: ['time', 'pace', 'swimStyle', 'laps', 'swolf', 'strokes', 'strokeRate', 'pool', 'hr', 'kcal'],
  gym: ['time', 'sets', 'reps', 'volume', 'exercises', 'kcal', 'hr'],
  cardio: ['time', 'jumps', 'jumpRate', 'longestStreak', 'kcal', 'hr', 'hrMax', 'interruptions', 'cadence'],
  flow: ['time', 'kcal', 'hr', 'minHr', 'hrMax'],
  court: ['time', 'kcal', 'hr', 'hrMax', 'steps', 'distance'],
  other: ['time', 'pace', 'speed', 'hr', 'kcal', 'elevation', 'steps'],
};
