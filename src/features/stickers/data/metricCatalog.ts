import type { SportCategory } from '@/features/workouts/sportCategory';
import type { JsonObject } from '../subject';

export interface MetricDef {
  id: string;
  labelKey: string;
  fields: readonly string[];
  isAvailable: (run: JsonObject) => boolean;
}

export type MetricDefinition = MetricDef;

const pos = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const METRIC_CATALOG: readonly MetricDef[] = [
  { id: 'time', labelKey: 'time', fields: ['movingSec', 'elapsedSec'], isAvailable: (r) => pos(r.movingSec) || pos(r.elapsedSec) },
  { id: 'distance', labelKey: 'distance', fields: ['distanceM'], isAvailable: (r) => pos(r.distanceM) },
  { id: 'pace', labelKey: 'pace', fields: ['paceSecKm', 'pace100Sec'], isAvailable: (r) => pos(r.paceSecKm) || pos(r.pace100Sec) },
  { id: 'speed', labelKey: 'speed', fields: ['speedKmh'], isAvailable: (r) => pos(r.speedKmh) },
  { id: 'hr', labelKey: 'avgHr', fields: ['hrAvg'], isAvailable: (r) => pos(r.hrAvg) },
  { id: 'hrMax', labelKey: 'maxHr', fields: ['hrMax'], isAvailable: (r) => pos(r.hrMax) },
  { id: 'kcal', labelKey: 'kcal', fields: ['kcal'], isAvailable: (r) => pos(r.kcal) },
  { id: 'elevation', labelKey: 'elevation', fields: ['elevGainM'], isAvailable: (r) => num(r.elevGainM) },
  { id: 'cadence', labelKey: 'cadence', fields: ['cadence'], isAvailable: (r) => pos(r.cadence) },
  { id: 'power', labelKey: 'power', fields: ['power'], isAvailable: (r) => pos(r.power) },
  { id: 'steps', labelKey: 'steps', fields: ['steps'], isAvailable: (r) => pos(r.steps) },
  { id: 'jumps', labelKey: 'jumps', fields: ['jumps'], isAvailable: (r) => pos(r.jumps) },
  { id: 'laps', labelKey: 'laps', fields: ['laps'], isAvailable: (r) => pos(r.laps) },
  { id: 'swolf', labelKey: 'swolf', fields: ['swolf'], isAvailable: (r) => pos(r.swolf) },
  { id: 'strokes', labelKey: 'strokes', fields: ['strokes'], isAvailable: (r) => pos(r.strokes) },
  { id: 'swimStyle', labelKey: 'swimStyle', fields: ['swimStyle'], isAvailable: (r) => typeof r.swimStyle === 'string' && r.swimStyle.length > 0 },
  { id: 'strokeRate', labelKey: 'strokeRate', fields: ['strokeRate'], isAvailable: (r) => pos(r.strokeRate) },
  { id: 'pool', labelKey: 'pool', fields: ['poolM'], isAvailable: (r) => pos(r.poolM) },
  { id: 'volume', labelKey: 'volume', fields: ['volumeKg', 'volume'], isAvailable: (r) => pos(r.volumeKg) || pos(r.volume) },
  { id: 'sets', labelKey: 'sets', fields: ['sets'], isAvailable: (r) => pos(r.sets) },
  { id: 'reps', labelKey: 'reps', fields: ['reps'], isAvailable: (r) => pos(r.reps) },
  { id: 'exercises', labelKey: 'exercises', fields: ['exercises'], isAvailable: (r) => pos(r.exercises) },
  { id: 'fastPace', labelKey: 'bestPace', fields: ['paceFastestSec'], isAvailable: (r) => pos(r.paceFastestSec) },
  { id: 'maxSpeed', labelKey: 'maxSpeed', fields: ['maxSpeedKmh'], isAvailable: (r) => pos(r.maxSpeedKmh) },
  { id: 'elevLoss', labelKey: 'elevLoss', fields: ['elevLossM'], isAvailable: (r) => num(r.elevLossM) },
  { id: 'stepLength', labelKey: 'stepLength', fields: ['stepLengthCm'], isAvailable: (r) => pos(r.stepLengthCm) },
  { id: 'jumpRate', labelKey: 'jumpRate', fields: ['jumpRate'], isAvailable: (r) => pos(r.jumpRate) },
  { id: 'longestStreak', labelKey: 'longestStreak', fields: ['longestStreak'], isAvailable: (r) => pos(r.longestStreak) },
  { id: 'interruptions', labelKey: 'interruptions', fields: ['interruptions'], isAvailable: (r) => pos(r.interruptions) },
  { id: 'minHr', labelKey: 'minHr', fields: ['minHr'], isAvailable: (r) => pos(r.minHr) },
  { id: 'maxPower', labelKey: 'maxPower', fields: ['maxPower'], isAvailable: (r) => pos(r.maxPower) },
  { id: 'aerobic', labelKey: 'aerobicEffect', fields: ['aerobicEffect'], isAvailable: (r) => pos(r.aerobicEffect) },
  { id: 'anaerobic', labelKey: 'anaerobicEffect', fields: ['anaerobicEffect'], isAvailable: (r) => pos(r.anaerobicEffect) },
  { id: 'vo2max', labelKey: 'vo2max', fields: ['vo2max'], isAvailable: (r) => pos(r.vo2max) },
  { id: 'recovery', labelKey: 'recoveryHours', fields: ['recoveryHours'], isAvailable: (r) => pos(r.recoveryHours) },
  { id: 'workoutLoad', labelKey: 'trainingLoad', fields: ['workoutLoad'], isAvailable: (r) => pos(r.workoutLoad) },
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
