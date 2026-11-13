/**
 * One sync from Health Kit into `joyofit.db` (docs/huawei-health-kit.md "Sync from the cloud API"): exercise records with
 * their heart rate and route, step details per minute, and step totals per finished day. Rows go through the SQL of the
 * Huawei import (`importStoreSql.ts`), so the same rules hold: rows are `imported = 1`, watch data wins, and a second sync
 * of the same span adds nothing. Every sync re-reads a few days before where the last one ended, which those rules make safe.
 *
 * No Expo imports: the database, the Health Kit client and the clock are passed in (`sync.test.ts` runs it on bun:sqlite).
 */
import type { ImportDb } from '@/features/huaweiimport/importFileCore';
import { writeDayTotals, writeMinutes, writeWorkout, type WorkoutLine } from '@/features/huaweiimport/importStoreSql';

import { HealthKitHttpError, type HealthKitClient } from './api';
import { dailyStepTotals, groupPoints, HK, recordToWorkout, stepsToMinutes, WORKOUT_DETAIL_TYPES } from './mapping';

const DAY_MS = 86_400_000;
/** Exercise records: Huawei allows 31 days per call. */
const WORKOUT_WINDOW_MS = 30 * DAY_MS;
/** Step details: Huawei allows 30 days per call; one day less keeps clear of the edge. */
const STEPS_WINDOW_MS = 29 * DAY_MS;
/** Daily totals: Huawei allows 31 days between startDay and endDay. */
const DAILY_WINDOW_DAYS = 28;
/** Each sync starts this far before where the previous one ended (Huawei's data arrives minutes to hours late). */
export const OVERLAP_MS = 3 * DAY_MS;
/** A day total is written only for days that ended at least this long ago (see `dailyStepTotals`). */
export const DAY_TOTAL_SETTLE_MS = 2 * DAY_MS;
const WORKOUTS_PER_TRANSACTION = 50;
const MINUTES_PER_TRANSACTION = 20_000;

export const SCOPE = {
  activityRecord: 'https://www.huawei.com/healthkit/activityrecord.read',
  activity: 'https://www.huawei.com/healthkit/activity.read',
  location: 'https://www.huawei.com/healthkit/location.read',
  steps: 'https://www.huawei.com/healthkit/step.read',
  historyYear: 'https://www.huawei.com/healthkit/historydata.open.year',
  historyMonth: 'https://www.huawei.com/healthkit/historydata.open.month',
  historyWeek: 'https://www.huawei.com/healthkit/historydata.open.week',
} as const;

/** Where the last successful sync of each kind ended (unix ms); null before the first. */
export interface SyncState {
  workoutsUntilMs: number | null;
  stepsUntilMs: number | null;
}

export interface SyncOptions {
  db: ImportDb;
  client: Pick<HealthKitClient, 'activityRecords' | 'stepDetails' | 'dailySteps'>;
  /** The scopes the user granted (the Worker's token answer). */
  scope: readonly string[];
  /** When the user authorized JoyoFit, unix seconds: Huawei serves history from there back as far as the history scope allows. */
  connectedAt: number;
  state: SyncState;
  /** Called after each part that finished, so an interrupted sync resumes from there. */
  saveState?: (state: SyncState) => void | Promise<void>;
  now?: number;
  /** Minutes east of UTC of the phone's time zone (`-new Date().getTimezoneOffset()`); calendar days for the daily totals. */
  utcOffsetMinutes: number;
  isCancelled?: () => boolean;
  onProgress?: (fraction: number) => void;
}

export interface SyncResult {
  workoutsFound: number;
  workoutsAdded: number;
  workoutsUpdated: number;
  workoutPointsAdded: number;
  minutesWritten: number;
  dayTotalsAdded: number;
  /** Parts not read because the user did not grant their scope. */
  missingScopes: string[];
  /** Windows Huawei refused as outside the readable history (403); the sync went on with the next. */
  windowsRefused: number;
  cancelled: boolean;
  state: SyncState;
}

/** How far back Huawei lets the app read: the history scope counts from the authorization. */
export function historyStartMs(scope: readonly string[], connectedAt: number): number {
  const at = connectedAt * 1000;
  if (scope.includes(SCOPE.historyYear)) return at - 365 * DAY_MS;
  if (scope.includes(SCOPE.historyMonth)) return at - 30 * DAY_MS;
  if (scope.includes(SCOPE.historyWeek)) return at - 7 * DAY_MS;
  return at;
}

/** [start, end] pairs covering [from, to], each at most `size` long. */
export function windows(from: number, to: number, size: number): [number, number][] {
  const out: [number, number][] = [];
  for (let start = from; start < to; start += size) out.push([start, Math.min(start + size, to)]);
  return out;
}

/** `+0700` for 420 minutes east of UTC (Health Kit's `timeZone` format). */
export function timeZoneOf(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}${String(abs % 60).padStart(2, '0')}`;
}

/** `yyyyMMdd` of the calendar day `ms` falls on at `offsetMinutes` east of UTC. */
export function dayOf(ms: number, offsetMinutes: number): string {
  const d = new Date(ms + offsetMinutes * 60_000);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Huawei refuses a span before the readable history with 403 (FAQ "The query time is out of range"). Only a window that starts
 * before the authorization can be that; a 403 for a later window is a real refusal (a scope taken back) and stops the sync, so
 * the saved state never moves past data that was not read.
 */
const isOutOfRange = (e: unknown, windowStartMs: number, connectedAt: number) =>
  e instanceof HealthKitHttpError && e.status === 403 && e.code !== 121001 && windowStartMs < connectedAt * 1000;

async function writeWorkouts(db: ImportDb, workouts: readonly WorkoutLine[], result: SyncResult): Promise<void> {
  for (let i = 0; i < workouts.length; i += WORKOUTS_PER_TRANSACTION) {
    const batch = workouts.slice(i, i + WORKOUTS_PER_TRANSACTION);
    let added = 0;
    let updated = 0;
    let points = 0;
    await db.withExclusiveTransactionAsync(async (txn) => {
      for (const workout of batch) {
        const write = writeWorkout(txn, workout);
        if (write.added) added += 1;
        if (write.updated) updated += 1;
        points += write.points;
      }
    });
    // Counted only after the transaction committed.
    result.workoutsAdded += added;
    result.workoutsUpdated += updated;
    result.workoutPointsAdded += points;
    await yieldToUi();
  }
}

export async function syncHealthKit(options: SyncOptions): Promise<SyncResult> {
  const { db, client, scope } = options;
  const now = options.now ?? Date.now();
  const state: SyncState = { ...options.state };
  const result: SyncResult = {
    workoutsFound: 0,
    workoutsAdded: 0,
    workoutsUpdated: 0,
    workoutPointsAdded: 0,
    minutesWritten: 0,
    dayTotalsAdded: 0,
    missingScopes: [],
    windowsRefused: 0,
    cancelled: false,
    state,
  };
  const earliest = historyStartMs(scope, options.connectedAt);
  const fromOf = (until: number | null) => Math.max(earliest, until === null ? earliest : until - OVERLAP_MS);

  const readWorkouts = scope.includes(SCOPE.activityRecord);
  const readSteps = scope.includes(SCOPE.steps);
  if (!readWorkouts) result.missingScopes.push(SCOPE.activityRecord);
  if (!readSteps) result.missingScopes.push(SCOPE.steps);
  // Detail types without their scope would make Huawei refuse the whole call, so only the granted ones are asked for.
  const detailTypes = WORKOUT_DETAIL_TYPES.filter((t) => (t === HK.location ? scope.includes(SCOPE.location) : scope.includes(SCOPE.activity)));
  if (readWorkouts && !scope.includes(SCOPE.activity)) result.missingScopes.push(SCOPE.activity);
  if (readWorkouts && !scope.includes(SCOPE.location)) result.missingScopes.push(SCOPE.location);

  const workoutWindows = readWorkouts ? windows(fromOf(state.workoutsUntilMs), now, WORKOUT_WINDOW_MS) : [];
  const stepsFrom = fromOf(state.stepsUntilMs);
  const stepWindows = readSteps ? windows(stepsFrom, now, STEPS_WINDOW_MS) : [];
  const dayWindows: [string, string, number][] = [];
  if (readSteps) {
    for (let day = stepsFrom; day < now; day += DAILY_WINDOW_DAYS * DAY_MS) {
      dayWindows.push([dayOf(day, options.utcOffsetMinutes), dayOf(Math.min(day + (DAILY_WINDOW_DAYS - 1) * DAY_MS, now), options.utcOffsetMinutes), day]);
    }
  }
  const total = Math.max(1, workoutWindows.length + stepWindows.length + dayWindows.length);
  let done = 0;
  const step = () => options.onProgress?.(Math.min(1, ++done / total));
  const stopped = () => {
    if (options.isCancelled?.()) result.cancelled = true;
    return result.cancelled;
  };

  for (const [start, end] of workoutWindows) {
    if (stopped()) return result;
    try {
      const records = await client.activityRecords(start, end, detailTypes);
      const workouts = records.map(recordToWorkout).filter((w): w is WorkoutLine => w !== null);
      result.workoutsFound += workouts.length;
      await writeWorkouts(db, workouts, result);
    } catch (e) {
      if (!isOutOfRange(e, start, options.connectedAt)) throw e;
      result.windowsRefused += 1;
    }
    step();
  }
  if (readWorkouts) {
    state.workoutsUntilMs = now;
    await options.saveState?.({ ...state });
  }

  for (const [start, end] of stepWindows) {
    if (stopped()) return result;
    try {
      const minutes = stepsToMinutes(groupPoints(await client.stepDetails(start, end)));
      for (let i = 0; i < minutes.length; i += MINUTES_PER_TRANSACTION) {
        const batch = minutes.slice(i, i + MINUTES_PER_TRANSACTION);
        let written = 0;
        await db.withExclusiveTransactionAsync(async (txn) => {
          written = writeMinutes(txn, batch);
        });
        result.minutesWritten += written;
        await yieldToUi();
      }
    } catch (e) {
      if (!isOutOfRange(e, start, options.connectedAt)) throw e;
      result.windowsRefused += 1;
    }
    step();
  }

  // After the minutes: a day total only fills what that day's minutes leave (`writeDayTotals`).
  const settledBefore = Math.floor((now - DAY_TOTAL_SETTLE_MS) / 1000);
  for (const [startDay, endDay, startMs] of dayWindows) {
    if (stopped()) return result;
    try {
      const totals = dailyStepTotals(await client.dailySteps(startDay, endDay, timeZoneOf(options.utcOffsetMinutes)), settledBefore);
      let added = 0;
      await db.withExclusiveTransactionAsync(async (txn) => {
        added = writeDayTotals(txn, totals);
      });
      result.dayTotalsAdded += added;
    } catch (e) {
      if (!isOutOfRange(e, startMs, options.connectedAt)) throw e;
      result.windowsRefused += 1;
    }
    step();
  }
  if (readSteps) {
    state.stepsUntilMs = now;
    await options.saveState?.({ ...state });
  }
  return result;
}
