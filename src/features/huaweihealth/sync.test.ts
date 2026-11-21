import { describe, expect, it } from 'bun:test';

import { openImportDb } from '@/features/huaweiimport/testDb';

import { HealthKitHttpError } from './api';
import { DAILY_STEPS, RUNNING_WITH_ROUTE, STEP_DETAILS } from './fixtures';
import type { HkActivityRecord, HkGroup } from './mapping';
import { dayOf, historyStartMs, OVERLAP_MS, SCOPE, syncHealthKit, timeZoneOf, windows, type SyncState } from './sync';

const ALL_SCOPES = ['openid', SCOPE.activityRecord, SCOPE.activity, SCOPE.location, SCOPE.steps, SCOPE.historyYear];
const DAY = 86_400_000;
/** "Now" a little after the documented examples (2020-08-20), so they fall inside the year of history. */
const NOW = Date.UTC(2020, 7, 20, 12);
const CONNECTED_AT = Math.floor(NOW / 1000) - 3600;

interface Calls {
  activity: [number, number, string[]][];
  details: [number, number][];
  daily: [string, string, string][];
}

/** A Health Kit that answers every window with the documented examples that fall inside it. */
function fakeClient(records: HkActivityRecord[] = [RUNNING_WITH_ROUTE], { refuseBefore = -Infinity } = {}) {
  const calls: Calls = { activity: [], details: [], daily: [] };
  const inside = (ms: number, start: number, end: number) => ms >= start && ms <= end;
  return {
    calls,
    client: {
      activityRecords: async (start: number, end: number, details: readonly string[]) => {
        calls.activity.push([start, end, [...details]]);
        if (start < refuseBefore) throw new HealthKitHttpError(403, null, 'The query time is out of range.');
        return records.filter((r) => inside(r.startTime!, start, end));
      },
      stepDetails: async (start: number, end: number): Promise<HkGroup[]> => {
        calls.details.push([start, end]);
        if (start < refuseBefore) throw new HealthKitHttpError(403, null, 'The query time is out of range.');
        return STEP_DETAILS.map((g) => ({
          ...g,
          sampleSet: g.sampleSet!.map((s) => ({ ...s, samplePoints: s.samplePoints!.filter((p) => inside(p.startTime! / 1e6, start, end)) })),
        }));
      },
      dailySteps: async (startDay: string, endDay: string, tz: string): Promise<HkGroup[]> => {
        calls.daily.push([startDay, endDay, tz]);
        return DAILY_STEPS.filter((g) => {
          const day = dayOf(g.startTime!, 8 * 60);
          return day >= startDay && day <= endDay;
        });
      },
    },
  };
}

function run(f: ReturnType<typeof openImportDb>, client: ReturnType<typeof fakeClient>['client'], state: SyncState, extra: Partial<Parameters<typeof syncHealthKit>[0]> = {}) {
  return syncHealthKit({ db: f.db, client, scope: ALL_SCOPES, connectedAt: CONNECTED_AT, state, now: NOW, utcOffsetMinutes: 8 * 60, ...extra });
}

const FIRST: SyncState = { workoutsUntilMs: null, stepsUntilMs: null };

describe('syncHealthKit', () => {
  it('writes the workout with its points, the step minutes and the day total, as imported rows', async () => {
    const f = openImportDb();
    const saved: SyncState[] = [];
    const result = await run(f, fakeClient().client, FIRST, { saveState: (s) => void saved.push(s) });

    expect(result).toMatchObject({ workoutsFound: 1, workoutsAdded: 1, workoutsUpdated: 0, workoutPointsAdded: 3, dayTotalsAdded: 1, cancelled: false });
    const workout = f.one<{ start: number; sport_type: number; imported: number; complete: number }>('SELECT start, sport_type, imported, complete FROM workouts');
    expect(workout).toEqual({ start: 1592905552, sport_type: 1, imported: 1, complete: 1 });
    expect(f.count('SELECT COUNT(*) FROM workout_points WHERE lat IS NOT NULL')).toBe(2);
    expect(f.count('SELECT COUNT(*) FROM step_samples WHERE imported = 0')).toBe(0);
    // The documented step details (260 steps on 2020-05-29/30) and the documented day total (9000 on 2020-08-11).
    expect(f.count('SELECT SUM(steps) FROM step_samples WHERE timestamp < 1597000000')).toBe(260);
    expect(f.count('SELECT SUM(steps) FROM step_samples WHERE timestamp >= 1597075200 AND timestamp < 1597161600')).toBe(9000);
    expect(saved.at(-1)).toEqual({ workoutsUntilMs: NOW, stepsUntilMs: NOW });
  });

  it('is idempotent: the same span synced again adds and changes nothing', async () => {
    const f = openImportDb();
    const fake = fakeClient();
    await run(f, fake.client, FIRST);
    const snapshot = () => ({
      workouts: f.all('SELECT * FROM workouts'),
      points: f.all('SELECT * FROM workout_points ORDER BY ts'),
      steps: f.all('SELECT * FROM step_samples ORDER BY timestamp'),
    });
    const before = snapshot();
    const again = await run(f, fake.client, FIRST);
    expect(again).toMatchObject({ workoutsAdded: 0, workoutsUpdated: 0, workoutPointsAdded: 0, minutesWritten: 0, dayTotalsAdded: 0 });
    expect(snapshot()).toEqual(before);
  });

  it('never replaces watch data: a watch workout at the same start and a watch-synced minute stay as they were', async () => {
    const f = openImportDb();
    f.raw.exec(
      `INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, steps, summary_json, complete, imported)
       VALUES (7, 1592905560, 1592906200, 1, 'Running', 640, 700, 30, 1000, '{}', 1, 0)`,
    );
    f.raw.exec('INSERT INTO step_samples (timestamp, steps, calories, distance, imported) VALUES (1590760320, 3, 0, 0, 0)');
    const result = await run(f, fakeClient().client, FIRST);
    expect(result.workoutsAdded).toBe(0);
    expect(f.all('SELECT workout_number, distance, imported FROM workouts')).toEqual([{ workout_number: 7, distance: 700, imported: 0 }]);
    expect(f.count('SELECT COUNT(*) FROM workout_points')).toBe(0);
    expect(f.one('SELECT steps, imported FROM step_samples WHERE timestamp = 1590760320')).toEqual({ steps: 3, imported: 0 });
  });

  it('fills in a workout an earlier ZIP import stored without its track', async () => {
    const f = openImportDb();
    f.raw.exec(
      `INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, steps, summary_json, complete, imported)
       VALUES (0, 1592905552, 1592906207, 1, 'Running', 655, 0, 0, 0, '{}', 1, 1)`,
    );
    const result = await run(f, fakeClient().client, FIRST);
    expect(result).toMatchObject({ workoutsAdded: 0, workoutsUpdated: 1, workoutPointsAdded: 3 });
    expect(f.one('SELECT distance, calories FROM workouts')).toEqual({ distance: 610, calories: 16 });
  });

  it('starts a later sync a few days before the last one ended, and reads a year back the first time', async () => {
    const f = openImportDb();
    const first = fakeClient();
    await run(f, first.client, FIRST);
    expect(first.calls.activity[0]![0]).toBe(CONNECTED_AT * 1000 - 365 * DAY);
    expect(first.calls.activity.at(-1)![1]).toBe(NOW);
    expect(first.calls.activity.every(([s, e]) => e - s <= 31 * DAY)).toBe(true);
    expect(first.calls.details.every(([s, e]) => e - s <= 30 * DAY)).toBe(true);
    expect(first.calls.daily.every(([, , tz]) => tz === '+0800')).toBe(true);

    const later = fakeClient();
    await run(f, later.client, { workoutsUntilMs: NOW - DAY, stepsUntilMs: NOW - 2 * DAY });
    expect(later.calls.activity).toEqual([[NOW - DAY - OVERLAP_MS, NOW, expect.any(Array) as unknown as string[]]]);
    expect(later.calls.details).toEqual([[NOW - 2 * DAY - OVERLAP_MS, NOW]]);
  });

  it('asks only for the detail types whose scope was granted, and skips what has no scope', async () => {
    const f = openImportDb();
    const fake = fakeClient();
    const result = await run(f, fake.client, FIRST, { scope: ['openid', SCOPE.activityRecord, SCOPE.activity] });
    expect(fake.calls.activity[0]![2]).not.toContain('com.huawei.instantaneous.location.sample');
    expect(fake.calls.activity[0]![2]).toContain('com.huawei.instantaneous.exercise_heart_rate');
    expect(fake.calls.details).toEqual([]);
    expect(result.missingScopes).toEqual([SCOPE.steps, SCOPE.location]);
    // Without the history scope, reading starts at the authorization.
    expect(fake.calls.activity[0]![0]).toBe(CONNECTED_AT * 1000);
  });

  it('goes on past windows before the authorization that Huawei refuses as out of range', async () => {
    const f = openImportDb();
    const fake = fakeClient([RUNNING_WITH_ROUTE], { refuseBefore: Date.UTC(2020, 4, 1) });
    const result = await run(f, fake.client, FIRST);
    expect(result.windowsRefused).toBeGreaterThan(0);
    expect(result.workoutsAdded).toBe(1);
  });

  it('stops on a 403 after the authorization (a scope taken back) without moving the saved state', async () => {
    const f = openImportDb();
    const saved: SyncState[] = [];
    const client = {
      ...fakeClient().client,
      activityRecords: async () => {
        throw new HealthKitHttpError(403, null, 'Insufficient Permission');
      },
    };
    // Connected a month ago: the window re-read now starts after the authorization, so a 403 there is a real refusal.
    const connectedAt = Math.floor((NOW - 30 * DAY) / 1000);
    await expect(
      run(f, client, { workoutsUntilMs: NOW - DAY, stepsUntilMs: NOW - DAY }, { connectedAt, saveState: (s) => void saved.push(s) }),
    ).rejects.toThrow('Insufficient Permission');
    expect(saved).toEqual([]);
  });

  it('stops between windows when cancelled, keeping what was written', async () => {
    const f = openImportDb();
    let calls = 0;
    const result = await run(f, fakeClient().client, FIRST, { isCancelled: () => ++calls > 3 });
    expect(result.cancelled).toBe(true);
  });
});

describe('helpers', () => {
  it('windows cover the span without gaps', () => {
    expect(windows(0, 25, 10)).toEqual([
      [0, 10],
      [10, 20],
      [20, 25],
    ]);
    expect(windows(5, 5, 10)).toEqual([]);
  });

  it('formats time zones and calendar days like Health Kit', () => {
    expect(timeZoneOf(420)).toBe('+0700');
    expect(timeZoneOf(-150)).toBe('-0230');
    expect(dayOf(Date.UTC(2020, 7, 10, 17), 7 * 60)).toBe('20200811');
  });

  it('history goes back as far as the granted history scope', () => {
    expect(historyStartMs([SCOPE.historyYear], 1000)).toBe(1_000_000 - 365 * DAY);
    expect(historyStartMs([SCOPE.historyMonth], 1000)).toBe(1_000_000 - 30 * DAY);
    expect(historyStartMs([SCOPE.historyWeek], 1000)).toBe(1_000_000 - 7 * DAY);
    expect(historyStartMs([], 1000)).toBe(1_000_000);
  });
});
