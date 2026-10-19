import { describe, expect, test } from 'bun:test';

import {
  activityMet,
  convertTarget,
  distanceFor,
  figuresFor,
  loopLengthM,
  MAX_LOOP_M,
  MIN_LOOP_M,
  rulerLabel,
  scaleFor,
  snapToScale,
  targetForLength,
  TARGET_MODES,
  valueFor,
  type LoopBody,
} from './targets';

/** 70 kg walker: 0.72 m stride, 13 minutes per km (4.6 km/h). */
const WALKER: LoopBody = { activity: 'walk', strideM: 0.72, paceSecPerKm: 780, weightKg: 70 };
const RUNNER: LoopBody = { activity: 'run', strideM: 1.0, paceSecPerKm: 330, weightKg: 62 };

describe('conversions', () => {
  test('steps are distance over stride; distance is itself; time is distance over pace', () => {
    expect(distanceFor('steps', 10_000, WALKER)).toBeCloseTo(7200, 5);
    expect(distanceFor('distance', 7000, WALKER)).toBe(7000);
    // 7 km at 13 min/km is 91 minutes.
    expect(valueFor('time', 7000, WALKER)).toBeCloseTo(91, 5);
    expect(distanceFor('time', 91, WALKER)).toBeCloseTo(7000, 5);
  });

  test('kcal is MET x kg x hours with the MET of manual walking and running workouts', () => {
    expect(activityMet('walk')).toBe(3.8);
    expect(activityMet('run')).toBe(9.8);
    // 7 km walked in 1 h 31 min: 3.8 x 70 x 1.5167 = 403.5 kcal.
    expect(valueFor('kcal', 7000, WALKER)).toBeCloseTo(403.5, 0);
    // 10 km run in 55 min at 62 kg.
    expect(valueFor('kcal', 10_000, RUNNER)).toBeCloseTo((9.8 * 62 * 55) / 60, 0);
  });

  test('every mode converts to a distance and back to the same value', () => {
    for (const body of [WALKER, RUNNER]) {
      for (const mode of TARGET_MODES) {
        for (const meters of [1500, 5000, 12_345, 21_000]) {
          expect(distanceFor(mode, valueFor(mode, meters, body), body)).toBeCloseTo(meters, 6);
        }
      }
    }
  });

  test('figuresFor has the four figures of one loop', () => {
    const f = figuresFor(7200, WALKER);
    expect(f.steps).toBeCloseTo(10_000, 5);
    expect(f.distance).toBe(7200);
    expect(f.time).toBeCloseTo(93.6, 5);
    expect(f.kcal).toBeGreaterThan(400);
  });

  test('the loop length is kept to what the planner offers', () => {
    expect(loopLengthM('distance', 200, WALKER)).toBe(MIN_LOOP_M);
    expect(loopLengthM('steps', 100_000, WALKER)).toBe(MAX_LOOP_M);
    expect(loopLengthM('distance', 8000, WALKER)).toBe(8000);
  });
});

describe('rulers', () => {
  test('a ruler never offers a loop shorter or longer than the planner makes', () => {
    for (const body of [WALKER, RUNNER]) {
      for (const mode of TARGET_MODES) {
        const scale = scaleFor(mode, body);
        expect(scale.max).toBeGreaterThan(scale.min);
        expect(distanceFor(mode, scale.min, body)).toBeGreaterThanOrEqual(MIN_LOOP_M - 1e-6);
        expect(distanceFor(mode, scale.max, body)).toBeLessThanOrEqual(MAX_LOOP_M + 1e-6);
        expect((scale.max - scale.min) % scale.step).toBe(0);
      }
    }
  });

  test('the step ruler of a walker spans the 5k to 14k of the design', () => {
    const scale = scaleFor('steps', WALKER);
    expect(scale.min).toBeLessThanOrEqual(5000);
    expect(scale.max).toBeGreaterThanOrEqual(14_000);
    expect(scale.step).toBe(250);
  });

  test('snapping goes to the nearest tick and stays inside', () => {
    const scale = { min: 2000, max: 30_000, step: 250, majorEvery: 4 };
    expect(snapToScale(5120, scale)).toBe(5000);
    expect(snapToScale(5130, scale)).toBe(5250);
    expect(snapToScale(10, scale)).toBe(2000);
    expect(snapToScale(1e9, scale)).toBe(30_000);
  });

  test('labels: k for steps, km for distance, plain numbers for minutes and kcal', () => {
    expect(rulerLabel('steps', 5000)).toBe('5k');
    expect(rulerLabel('distance', 7000)).toBe('7');
    expect(rulerLabel('time', 60)).toBe('60');
    expect(rulerLabel('kcal', 400)).toBe('400');
  });
});

describe('switching mode', () => {
  test('keeps the same loop, snapped to the ruler of the new mode', () => {
    // 10 000 steps = 7.2 km: on the distance ruler that is 7.25 km (250 m ticks).
    expect(convertTarget('steps', 10_000, 'distance', WALKER)).toBe(7250);
    // 7.25 km at 13 min/km is 94 minutes: the nearest 5 is 95.
    expect(convertTarget('distance', 7250, 'time', WALKER)).toBe(95);
  });

  test('a target of a given length starts every mode at the same loop', () => {
    expect(targetForLength('distance', 5000, WALKER)).toBe(5000);
    expect(targetForLength('steps', 5000, WALKER)).toBe(7000);
    expect(targetForLength('time', 5000, RUNNER)).toBe(30);
  });
});
