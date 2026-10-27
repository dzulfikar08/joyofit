import { describe, expect, it } from 'bun:test';

import type { HrvReadingRow, WorkoutRow } from '@/db/queries';
import type { SleepSegment } from '@/wear';
import { computeDailyFitness, computeFitnessOverview } from './compute';
import type { FitnessData } from './useFitnessData';

const H = 3600;
const DAY = 86400;
const DAY_START = 1_760_000_000 - (1_760_000_000 % DAY);
const NOW = DAY_START + 10 * H;

const empty: FitnessData = {
  nowSec: NOW,
  dayStart: DAY_START,
  maxHr: 190,
  strain: [],
  resting: new Map(),
  workouts: [],
  hrv: [],
  sleep: [],
  samples: [],
  stress: [],
};
/** A staged night that ends `endBack` days before DAY_START + 7 h, `hours` long. */
const night = (endBack: number, hours: number): SleepSegment[] => {
  const end = DAY_START + 7 * H - endBack * DAY;
  return [{ start: end - hours * H, end, type: 6, stage: 'light' }];
};
const workout = (over: Partial<WorkoutRow>): WorkoutRow => ({
  id: 1,
  workoutNumber: 1,
  start: NOW - 5 * H,
  end: NOW - 4 * H,
  sportType: 1,
  sportName: 'Running',
  duration: 3600,
  distance: 8000,
  calories: 500,
  avgHr: 150,
  maxHr: 175,
  steps: 9000,
  complete: true,
  imported: false,
  ...over,
});

describe('computeDailyFitness', () => {
  it('carries the latest VO2max for the Today card: the watch value, else null without data', () => {
    expect(computeDailyFitness(empty).vo2).toBeNull();
    const r = computeDailyFitness({ ...empty, workouts: [{ workout: workout({}), summary: { vo2max: 44 } }] });
    expect(r.vo2?.value).toBe(44);
    expect(r.vo2?.source).toBe('watch');
  });

  it('has no Energi Tubuh without last night, but still a sleep need', () => {
    const r = computeDailyFitness(empty);
    expect(r.energy).toBeNull();
    expect(r.energyMissing).toContain('data tidur');
    expect(r.recovery).toBeNull();
    expect(r.sleepNeed.needSec).toBe(7.5 * H);
  });

  it('has Energi Tubuh from last night, full sleep and no activity', () => {
    const r = computeDailyFitness({ ...empty, sleep: night(0, 7.5) });
    expect(r.energyMissing).toBeNull();
    // Woke 3 h ago: 90 minus 3 x 0.8.
    expect(r.energy?.level).toBeCloseTo(90 - 2.4);
  });

  it('judges last night against the need after yesterday strain', () => {
    const yesterdayHard = { day: DAY_START - DAY, trimp: 500, strain: 21, zoneMinutes: [0, 0, 0, 0, 0] as [number, number, number, number, number], coveredMinutes: 0 };
    const r = computeDailyFitness({ ...empty, strain: [yesterdayHard], sleep: night(0, 7.5) });
    // 7.5 h of an 8.5 h need.
    expect(r.energy?.wakeLevel).toBeCloseTo(30 + 60 * (7.5 / 8.5));
  });

  it('adds sleep debt to tonight from 3 or more nights', () => {
    const sleep = [...night(3, 6.5), ...night(2, 6.5), ...night(1, 6.5), ...night(0, 6.5)];
    const r = computeDailyFitness({ ...empty, sleep });
    expect(r.sleepNeed.nights).toBe(4);
    expect(r.sleepNeed.debtSec).toBe(4 * H);
    expect(r.sleepNeed.needSec).toBe(8.5 * H);
  });

  it('uses the watch recovery time of the last workout', () => {
    const r = computeDailyFitness({ ...empty, workouts: [{ workout: workout({}), summary: { recoveryHours: 15 } }] });
    expect(r.recovery?.source).toBe('watch');
    expect(r.recovery?.hoursLeft).toBeCloseTo(15 - 4);
  });

  it('uses the HRV recovery z-score for the wake level', () => {
    const night7: HrvReadingRow[] = Array.from({ length: 6 }, (_, i) => ({ start: NOW - (i + 1) * DAY - 8 * H, end: NOW - (i + 1) * DAY, source: 'night', rmssd: i % 2 ? 45 : 55, beats: 1000 }));
    const today: HrvReadingRow = { start: NOW - 9 * H, end: NOW - 3 * H, source: 'night', rmssd: 80, beats: 1000 };
    const r = computeDailyFitness({ ...empty, sleep: night(0, 7.5), hrv: [...night7.reverse(), today] });
    expect(r.energy?.wakeLevel).toBe(100);
  });
});

describe('computeFitnessOverview', () => {
  it('is empty and says so with no data', () => {
    const r = computeFitnessOverview(empty, []);
    expect(r.vo2).toBeNull();
    expect(r.load.kind).toBe('short');
    expect(r.races.kind).toBe('short');
    expect('missing' in r.hrv).toBe(true);
    expect(r.intensity.total).toBe(0);
  });

  it('takes the watch VO2max from the workouts and race predictions from the efforts', () => {
    const r = computeFitnessOverview(
      { ...empty, workouts: [{ workout: workout({}), summary: { vo2max: 48 } }] },
      [{ '5k': 1500 }, { '5k': 1520 }, { '5k': 1540 }],
    );
    expect(r.vo2?.value).toBe(48);
    expect(r.vo2?.source).toBe('watch');
    expect(r.races.kind).toBe('ok');
  });
});
