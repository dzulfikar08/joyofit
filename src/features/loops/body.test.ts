import { describe, expect, test } from 'bun:test';

import { SPORT } from '@/features/fitimport/parseFit';

import { deriveBody, MIN_SAMPLES, RECENT_WORKOUTS, type WorkoutFact } from './body';

const walk = (distance: number, minutes: number, steps: number): WorkoutFact => ({ sportType: SPORT.walking, duration: minutes * 60, distance, steps });
const run = (distance: number, minutes: number, steps: number): WorkoutFact => ({ sportType: SPORT.running, duration: minutes * 60, distance, steps });

const profile = { heightCm: 170, weightKg: 65, hasWeight: true };

describe('deriveBody', () => {
  test('without workouts the stride comes from the height and the pace is the default', () => {
    const walker = deriveBody('walk', { ...profile, workouts: [] });
    expect(walker.body.strideM).toBeCloseTo(1.7 * 0.415, 5);
    expect(walker.body.paceSecPerKm).toBe(720);
    expect(walker.body.weightKg).toBe(65);
    expect(walker.sources).toEqual({ stride: 'height', pace: 'default', weight: 'profile' });
    expect(deriveBody('run', { ...profile, workouts: [] }).body.strideM).toBeCloseTo(1.7 * 0.6, 5);
  });

  test('the weight is flagged as a default when the person never entered one', () => {
    const body = deriveBody('walk', { ...profile, hasWeight: false, workouts: [] });
    expect(body.sources.weight).toBe('default');
  });

  test('the median pace and stride of enough matching workouts win over the estimates', () => {
    const workouts = [walk(5000, 60, 7000), walk(4000, 50, 5600), walk(6000, 70, 8200), run(5000, 28, 5400)];
    const { body, sources } = deriveBody('walk', { ...profile, workouts });
    // Paces 720, 750 and 700 s/km: the median is 720.
    expect(body.paceSecPerKm).toBeCloseTo(720, 5);
    // Strides 0.714, 0.714 and 0.7317 m: the median is 0.714.
    expect(body.strideM).toBeCloseTo(5000 / 7000, 4);
    expect(sources).toEqual({ stride: 'measured', pace: 'history', weight: 'profile' });
  });

  test('fewer than three workouts is not enough to trust', () => {
    const { sources } = deriveBody('walk', { ...profile, workouts: [walk(5000, 60, 7000), walk(4000, 50, 5600)] });
    expect(MIN_SAMPLES).toBe(3);
    expect(sources.pace).toBe('default');
    expect(sources.stride).toBe('height');
  });

  test('short workouts and implausible ones are left out', () => {
    const workouts = [
      walk(500, 8, 700), // too short
      walk(5000, 10, 7000), // 2 min/km: not a walk
      walk(5000, 60, 7000),
      walk(5000, 60, 7000),
    ];
    const { sources } = deriveBody('walk', { ...profile, workouts });
    expect(sources.pace).toBe('default');
  });

  test('a broken step count spoils the stride, not the pace', () => {
    const workouts = [walk(5000, 60, 100), walk(5000, 60, 100), walk(5000, 60, 100)];
    const { sources } = deriveBody('walk', { ...profile, workouts });
    expect(sources.pace).toBe('history');
    expect(sources.stride).toBe('height');
  });

  test('only the newest workouts count', () => {
    const recent = Array.from({ length: RECENT_WORKOUTS }, () => walk(5000, 55, 7000));
    const old = Array.from({ length: 30 }, () => walk(5000, 90, 7000));
    expect(deriveBody('walk', { ...profile, workouts: [...recent, ...old] }).body.paceSecPerKm).toBeCloseTo(660, 5);
  });

  test('a walk and a run are told apart by the sport', () => {
    const workouts = [run(5000, 25, 5000), run(6000, 31, 6100), run(8000, 44, 8000), walk(5000, 60, 7000)];
    const runner = deriveBody('run', { ...profile, workouts });
    expect(runner.sources.pace).toBe('history');
    expect(runner.body.paceSecPerKm).toBeCloseTo(310, 0);
    expect(deriveBody('walk', { ...profile, workouts }).sources.pace).toBe('default');
  });
});
