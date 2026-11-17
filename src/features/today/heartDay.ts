/**
 * A whole local day of heart rate for the day chart: stored readings folded into 5-minute buckets (the SQL does the folding, see
 * `heartDayQuery.ts`), laid on the grid the workout charts draw (`AnalysisSeries`: sample `i` is `i * stepSec` after midnight).
 * Pure: no React, no storage.
 */
import type { AnalysisSeries } from '@/features/workouts/analysis/types';

/** Bucket width. A watch reads every minute or so while worn actively and every few minutes at rest, so a bucket nearly always holds a reading when one exists. */
export const HEART_BUCKET_SEC = 300;

/** The chart joins readings across at most this many empty buckets (15 min, longer than the watch's resting interval); a longer silence stays a gap. */
export const MAX_JOINED_EMPTY_BUCKETS = 2;

/** One bucket as the query returns it; `bucket` counts from the start of the day. */
export interface HeartBucketRow {
  bucket: number;
  avg: number;
  min: number;
  max: number;
  count: number;
}

export interface HeartDay {
  dayStart: number;
  /** Midnight after the day: 23 to 25 hours after `dayStart` across a daylight-saving change. */
  dayEnd: number;
  bucketSec: number;
  /** Bucket count of the day; bucket `i` covers `dayStart + i * bucketSec` up to the next. */
  buckets: number;
  /** Average bpm per bucket, null where no reading fell. These are the real values the readout shows. */
  avg: (number | null)[];
  min: (number | null)[];
  max: (number | null)[];
  /** `avg` with short silences bridged for the line only (see `MAX_JOINED_EMPTY_BUCKETS`). */
  line: (number | null)[];
  /** Over every reading of the day; null when there is none. */
  stats: { min: number; max: number; avg: number; readings: number } | null;
  /** The bucket holding the day's highest reading. */
  peak: { bpm: number; bucket: number } | null;
}

export function bucketCount(dayStart: number, dayEnd: number, bucketSec: number = HEART_BUCKET_SEC): number {
  return Math.max(0, Math.ceil((dayEnd - dayStart) / bucketSec));
}

/** The bucket a reading at `timestamp` falls in: a reading exactly on a boundary starts the later bucket. */
export function bucketOf(timestamp: number, dayStart: number, bucketSec: number = HEART_BUCKET_SEC): number {
  return Math.floor((timestamp - dayStart) / bucketSec);
}

/** Fills empty runs of at most `maxEmpty` between two present values with a straight line; leading, trailing and longer runs stay null. */
export function bridgeShortGaps(values: readonly (number | null)[], maxEmpty: number): (number | null)[] {
  const out = [...values];
  let last = -1;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || v === undefined) continue;
    const empty = i - last - 1;
    if (last !== -1 && empty > 0 && empty <= maxEmpty) {
      const from = values[last] as number;
      for (let k = 1; k <= empty; k++) out[last + k] = from + ((v - from) * k) / (empty + 1);
    }
    last = i;
  }
  return out;
}

/** Folds query rows into a day. Rows outside `[0, buckets)` are ignored (the query bounds the day, so none are expected). */
export function buildHeartDay(rows: readonly HeartBucketRow[], dayStart: number, dayEnd: number, bucketSec: number = HEART_BUCKET_SEC): HeartDay {
  const buckets = bucketCount(dayStart, dayEnd, bucketSec);
  const avg: (number | null)[] = new Array(buckets).fill(null);
  const min: (number | null)[] = new Array(buckets).fill(null);
  const max: (number | null)[] = new Array(buckets).fill(null);
  let lo = Infinity;
  let hi = -Infinity;
  let sum = 0;
  let readings = 0;
  let peak: HeartDay['peak'] = null;
  for (const row of rows) {
    if (row.bucket < 0 || row.bucket >= buckets || row.count <= 0) continue;
    avg[row.bucket] = Math.round(row.avg);
    min[row.bucket] = row.min;
    max[row.bucket] = row.max;
    lo = Math.min(lo, row.min);
    sum += row.avg * row.count;
    readings += row.count;
    if (row.max > hi) {
      hi = row.max;
      peak = { bpm: row.max, bucket: row.bucket };
    }
  }
  return {
    dayStart,
    dayEnd,
    bucketSec,
    buckets,
    avg,
    min,
    max,
    line: bridgeShortGaps(avg, MAX_JOINED_EMPTY_BUCKETS),
    stats: readings > 0 ? { min: lo, max: hi, avg: Math.round(sum / readings), readings } : null,
    peak,
  };
}

/** The day as the series the shared chart panel draws: heart rate only, on the bucket grid. */
export function heartDaySeries(day: HeartDay): AnalysisSeries {
  return {
    stepSec: day.bucketSec,
    n: day.buckets,
    dist: null,
    hr: day.line,
    pace: null,
    alt: null,
    cad: null,
    power: null,
    track: null,
  };
}

/** Unix seconds a bucket starts at. */
export function bucketStart(day: Pick<HeartDay, 'dayStart' | 'bucketSec'>, bucket: number): number {
  return day.dayStart + bucket * day.bucketSec;
}

/** How far back a resting heart rate counts as "the watch sends one" (a day without one is then just a day it has none yet). */
export const RESTING_LOOKBACK_DAYS = 14;

/**
 * Whether to explain an empty resting rate: the day has readings, no resting rate, and the watch sent none in the last
 * `RESTING_LOOKBACK_DAYS` either, so it most likely keeps it to itself (HONOR Watch ES, JRG-487/488).
 */
export function restingNotShared(hasReadings: boolean, resting: number | null, restingRecently: boolean): boolean {
  return hasReadings && resting === null && !restingRecently;
}
