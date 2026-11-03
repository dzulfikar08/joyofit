import { describe, expect, it } from 'bun:test';

import type { WorkoutSummary } from '@/features/workouts/summary';
import type { JsonObject } from '../subject';
import { extractWorkoutMetrics } from './workoutMetrics';

describe('extractWorkoutMetrics', () => {
  it('extracts speed, fastest pace, climb loss, and step length', () => {
    const summary: WorkoutSummary = {
      maxSpeed: 8.5, // 8.5 m/s = 30.6 km/h
      paceFastestSecPerKm: 275,
      elevationLoss: 120,
      avgStepLengthM: 0.95,
      minHr: 58,
      aerobicEffect: 3.4,
      anaerobicEffect: 1.8,
      vo2max: 52,
      recoveryHours: 24,
      workoutLoad: 180,
      maxPower: 450,
    };
    const out: JsonObject = {};
    extractWorkoutMetrics(summary, null, 1800, null, out);

    expect(out.maxSpeedKmh).toBe(30.6);
    expect(out.paceFastestSec).toBe(275);
    expect(out.elevLossM).toBe(120);
    expect(out.stepLengthCm).toBe(95);
    expect(out.minHr).toBe(58);
    expect(out.aerobicEffect).toBe(3.4);
    expect(out.anaerobicEffect).toBe(1.8);
    expect(out.vo2max).toBe(52);
    expect(out.recoveryHours).toBe(24);
    expect(out.workoutLoad).toBe(180);
    expect(out.maxPower).toBe(450);
  });

  it('calculates jump rope rate and captures streak & interruptions', () => {
    const summary: WorkoutSummary = {
      longestStreak: 250,
      interruptions: 3,
    };
    const out: JsonObject = {};
    extractWorkoutMetrics(summary, null, 600, 1200, out);

    expect(out.longestStreak).toBe(250);
    expect(out.interruptions).toBe(3);
    expect(out.jumpRate).toBe(120); // 1200 jumps in 600 sec = 120 jumps/min
  });
});
