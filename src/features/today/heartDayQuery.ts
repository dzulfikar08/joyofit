import type { SQLiteDatabase } from 'expo-sqlite';

import { listDayHeartLoad, listRestingHeartRateByDay } from '@/db/queries';

import { addDays } from '@/features/trends/series';

import { buildHeartDay, HEART_BUCKET_SEC, RESTING_LOOKBACK_DAYS, type HeartBucketRow, type HeartDay } from './heartDay';

/**
 * Heart-rate readings of `[dayStart, dayEnd)` folded into `bucketSec` buckets in SQL, so a day of per-minute rows never goes
 * through JS. A reading on a boundary belongs to the later bucket and `dayEnd` itself to the next day. Buckets without a
 * reading are absent. Readings without a positive heart rate are skipped.
 */
export function listHeartBuckets(db: SQLiteDatabase, dayStart: number, dayEnd: number, bucketSec: number = HEART_BUCKET_SEC): Promise<HeartBucketRow[]> {
  return db.getAllAsync<HeartBucketRow>(
    `SELECT CAST((timestamp - ?) / ? AS INTEGER) AS bucket, AVG(heart_rate) AS avg, MIN(heart_rate) AS min, MAX(heart_rate) AS max, COUNT(*) AS count
     FROM step_samples
     WHERE timestamp >= ? AND timestamp < ? AND heart_rate > 0
     GROUP BY bucket ORDER BY bucket`,
    dayStart,
    bucketSec,
    dayStart,
    dayEnd,
  );
}

/** Whether any reading in `[since, until)` carries a resting heart rate. */
export async function hasRestingHeartRate(db: SQLiteDatabase, since: number, until: number): Promise<boolean> {
  const row = await db.getFirstAsync<{ found: number }>(
    'SELECT EXISTS(SELECT 1 FROM step_samples WHERE timestamp >= ? AND timestamp < ? AND resting_heart_rate > 0) AS found',
    since,
    until,
  );
  return (row?.found ?? 0) === 1;
}

export interface HeartDayData {
  day: HeartDay;
  /** The watch's lowest resting heart rate of the day, null when it reported none. */
  resting: number | null;
  /** A resting heart rate was stored in the `RESTING_LOOKBACK_DAYS` up to the day's end. */
  restingRecently: boolean;
  /** Seconds the day's readings cover in Edwards zones 1..5, 1..6 for the reserve method (`listDayHeartLoad`); all zero without readings. */
  zoneSeconds: readonly number[];
}

/** Everything the day chart shows for the local day `[dayStart, dayEnd)`. */
export async function loadHeartDay(db: SQLiteDatabase, dayStart: number, dayEnd: number, thresholds: readonly number[]): Promise<HeartDayData> {
  const [rows, resting, load, restingRecently] = await Promise.all([
    listHeartBuckets(db, dayStart, dayEnd),
    listRestingHeartRateByDay(db, [dayStart, dayEnd]),
    listDayHeartLoad(db, [dayStart, dayEnd], thresholds),
    hasRestingHeartRate(db, addDays(dayEnd, -RESTING_LOOKBACK_DAYS), dayEnd),
  ]);
  return {
    day: buildHeartDay(rows, dayStart, dayEnd),
    resting: resting.get(dayStart) ?? null,
    restingRecently,
    zoneSeconds: load[0]?.zoneSeconds ?? thresholds.map(() => 0),
  };
}
