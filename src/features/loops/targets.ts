/**
 * What the person aims for (steps, distance, time or kcal) and what loop length that means for their body. Pure: no React,
 * no native modules, so everything here runs under `bun test`.
 *
 *   distance = steps x stride
 *   distance = minutes x 60 / pace x 1000                    (pace in seconds per km)
 *   kcal     = MET x weight x hours                          (the same MET table manual workouts use)
 */
import { SPORT_ROWS } from '@/features/workouts/manual';

export type LoopActivity = 'walk' | 'run';
export type TargetMode = 'steps' | 'distance' | 'time' | 'kcal';

export const TARGET_MODES: readonly TargetMode[] = ['steps', 'distance', 'time', 'kcal'];

/** The shortest and longest loop offered, in metres. */
export const MIN_LOOP_M = 1000;
export const MAX_LOOP_M = 25_000;

/** Everything the conversions need about the person and the activity. */
export interface LoopBody {
  activity: LoopActivity;
  /** Metres per step. */
  strideM: number;
  /** Seconds per kilometre. */
  paceSecPerKm: number;
  weightKg: number;
}

/** Where each figure of the body came from, so the screen can say "from your workouts" or "an estimate". */
export interface BodySources {
  stride: 'measured' | 'height';
  pace: 'history' | 'default';
  weight: 'profile' | 'default';
}

/** Walking step length is about 0.415 of the height; running strides are longer, about 0.6 of it at an easy pace. */
export const STRIDE_PER_HEIGHT: Readonly<Record<LoopActivity, number>> = { walk: 0.415, run: 0.6 };
/** 5 km/h and 10 km/h. */
export const DEFAULT_PACE_SEC_PER_KM: Readonly<Record<LoopActivity, number>> = { walk: 720, run: 360 };

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

/** The MET of the activity: the figure a manual workout of that sport uses. */
export function activityMet(activity: LoopActivity): number {
  return SPORT_ROWS[activity].met;
}

/** The loop length, in metres, for a target in the unit of `mode` (steps, metres, minutes, kcal). Not clamped. */
export function distanceFor(mode: TargetMode, value: number, body: LoopBody): number {
  switch (mode) {
    case 'steps':
      return value * body.strideM;
    case 'distance':
      return value;
    case 'time':
      return ((value * 60) / body.paceSecPerKm) * 1000;
    case 'kcal':
      return (value * 3600 * 1000) / (activityMet(body.activity) * body.weightKg * body.paceSecPerKm);
  }
}

/** The target, in the unit of `mode`, that a loop of `meters` stands for. Not rounded. */
export function valueFor(mode: TargetMode, meters: number, body: LoopBody): number {
  switch (mode) {
    case 'steps':
      return meters / body.strideM;
    case 'distance':
      return meters;
    case 'time':
      return ((meters / 1000) * body.paceSecPerKm) / 60;
    case 'kcal':
      return (activityMet(body.activity) * body.weightKg * (meters / 1000) * body.paceSecPerKm) / 3600;
  }
}

/** All four figures for one loop length. `time` is minutes, `distance` metres. */
export interface TargetFigures {
  steps: number;
  distance: number;
  time: number;
  kcal: number;
}

export function figuresFor(meters: number, body: LoopBody): TargetFigures {
  return {
    steps: valueFor('steps', meters, body),
    distance: meters,
    time: valueFor('time', meters, body),
    kcal: valueFor('kcal', meters, body),
  };
}

/** How the ruler of one mode is drawn: its range, the step the slider snaps to, and which ticks are tall and labelled. */
export interface RulerScale {
  min: number;
  max: number;
  step: number;
  /** Every this many steps there is a tall tick with a label. */
  majorEvery: number;
}

const STATIC_SCALES: Readonly<Record<TargetMode, RulerScale>> = {
  // 250 steps a tick, a label every 1 000.
  steps: { min: 2000, max: 30_000, step: 250, majorEvery: 4 },
  // 250 m a tick, a label every km.
  distance: { min: 1000, max: 25_000, step: 250, majorEvery: 4 },
  // 5 minutes a tick, a label every 30.
  time: { min: 10, max: 240, step: 5, majorEvery: 6 },
  // 25 kcal a tick, a label every 100.
  kcal: { min: 50, max: 2000, step: 25, majorEvery: 4 },
};

/**
 * The ruler of `mode` for this body: the mode's own range cut to the loop lengths that are offered (`MIN_LOOP_M` to
 * `MAX_LOOP_M`), so no tick means a loop that is too short to route or too long for the routing service.
 */
export function scaleFor(mode: TargetMode, body: LoopBody): RulerScale {
  const base = STATIC_SCALES[mode];
  const lo = valueFor(mode, MIN_LOOP_M, body);
  const hi = valueFor(mode, MAX_LOOP_M, body);
  const min = Math.max(base.min, Math.ceil(lo / base.step) * base.step);
  const max = Math.min(base.max, Math.floor(hi / base.step) * base.step);
  return { ...base, min, max: Math.max(max, min + base.step) };
}

/** The value snapped to the nearest tick of the scale and kept inside it. */
export function snapToScale(value: number, scale: RulerScale): number {
  const ticks = Math.round((value - scale.min) / scale.step);
  return clamp(scale.min + ticks * scale.step, scale.min, scale.max);
}

/** The loop length of a target, kept to the lengths the planner offers. */
export function loopLengthM(mode: TargetMode, value: number, body: LoopBody): number {
  return clamp(distanceFor(mode, value, body), MIN_LOOP_M, MAX_LOOP_M);
}

/** The target to show in `mode` after the person switches from another mode: the same loop, snapped to the new ruler. */
export function convertTarget(fromMode: TargetMode, fromValue: number, toMode: TargetMode, body: LoopBody): number {
  const meters = loopLengthM(fromMode, fromValue, body);
  return snapToScale(valueFor(toMode, meters, body), scaleFor(toMode, body));
}

/** A target in `mode` that stands for `meters`, snapped to the ruler (the start value of a new session). */
export function targetForLength(mode: TargetMode, meters: number, body: LoopBody): number {
  return snapToScale(valueFor(mode, meters, body), scaleFor(mode, body));
}

/** The label under a tall tick: `5k` steps, `7` km, `60` minutes, `400` kcal. */
export function rulerLabel(mode: string, value: number): string {
  if (mode === 'steps') return `${value / 1000}k`;
  if (mode === 'distance') return String(value / 1000);
  return String(value);
}
