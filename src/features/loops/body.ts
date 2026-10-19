/**
 * Stride and pace of the person, measured from their own walking and running workouts when there are enough, else estimated.
 * Takes plain rows (`bodyStore.ts` reads them from the database), so it runs under `bun test`.
 */
import { SPORT } from '@/features/fitimport/parseFit';

import { DEFAULT_PACE_SEC_PER_KM, STRIDE_PER_HEIGHT, type BodySources, type LoopActivity, type LoopBody } from './targets';

/** The part of a `workouts` row the figures come from. */
export interface WorkoutFact {
  sportType: number;
  /** Active seconds. */
  duration: number;
  /** Metres. */
  distance: number;
  steps: number;
}

/** The height used when the person has not entered one (the same default the profile form starts with). */
export const DEFAULT_HEIGHT_CM = 175;

/** Sport types of each activity: outdoor walking and hiking walk; outdoor running and trail running run. */
export const SPORT_TYPES: Readonly<Record<LoopActivity, readonly number[]>> = {
  walk: [SPORT.walking, SPORT.hiking],
  run: [SPORT.running, SPORT.trailRun],
};

/** Plausible ranges: a workout outside them is a mislabelled one (a ride logged as a walk) and is left out. */
const PACE_RANGE: Readonly<Record<LoopActivity, readonly [number, number]>> = { walk: [480, 1500], run: [150, 540] };
const STRIDE_RANGE: Readonly<Record<LoopActivity, readonly [number, number]>> = { walk: [0.4, 1.1], run: [0.6, 1.8] };

/** A workout shorter than this says little about the pace. */
const MIN_DISTANCE_M = 1000;
const MIN_DURATION_S = 600;
/** The newest workouts of an activity that are looked at, and how many it takes to trust a figure. */
export const RECENT_WORKOUTS = 15;
export const MIN_SAMPLES = 3;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface BodyInput {
  heightCm: number;
  weightKg: number;
  hasWeight: boolean;
  /** Newest first. */
  workouts: readonly WorkoutFact[];
}

/** The body for one activity: the median pace and stride of the newest matching workouts, else the estimates. */
export function deriveBody(activity: LoopActivity, input: BodyInput): { body: LoopBody; sources: BodySources } {
  const types = SPORT_TYPES[activity];
  const [paceLo, paceHi] = PACE_RANGE[activity];
  const [strideLo, strideHi] = STRIDE_RANGE[activity];
  const recent = input.workouts
    .filter((w) => types.includes(w.sportType) && w.distance >= MIN_DISTANCE_M && w.duration >= MIN_DURATION_S)
    .slice(0, RECENT_WORKOUTS);

  const paces = recent.map((w) => (w.duration / w.distance) * 1000).filter((p) => p >= paceLo && p <= paceHi);
  const strides = recent
    .filter((w) => w.steps > 0)
    .map((w) => w.distance / w.steps)
    .filter((s) => s >= strideLo && s <= strideHi);

  const measuredPace = paces.length >= MIN_SAMPLES;
  const measuredStride = strides.length >= MIN_SAMPLES;
  const strideM = measuredStride ? median(strides) : (input.heightCm / 100) * STRIDE_PER_HEIGHT[activity];
  const paceSecPerKm = measuredPace ? median(paces) : DEFAULT_PACE_SEC_PER_KM[activity];

  return {
    body: { activity, strideM, paceSecPerKm, weightKg: input.weightKg },
    sources: {
      stride: measuredStride ? 'measured' : 'height',
      pace: measuredPace ? 'history' : 'default',
      weight: input.hasWeight ? 'profile' : 'default',
    },
  };
}
