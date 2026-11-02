/**
 * A whole local day of one sparse `health_metrics` type (HRV, stress) for the day chart: the stored points folded into buckets
 * whose width follows how often the watch writes the metric, laid on the grid the workout charts draw (`AnalysisSeries`: sample
 * `i` is `i * stepSec` after midnight). Pure: no React, no storage.
 */
import type { AnalysisSeries } from '@/features/workouts/analysis/types';

import { bridgeShortGaps, bucketCount, bucketOf } from './heartDay';

export { bucketStart } from './heartDay';

/** Bucket widths a day chart may use, narrowest first: a reading nearly always lands in a bucket when one is due. */
export const METRIC_BUCKET_LADDER_SEC = [300, 600, 900, 1800, 3600] as const;

/** The chart joins points across at most this many empty buckets (one missed reading); a longer silence stays a gap. */
export const METRIC_MAX_JOINED_EMPTY_BUCKETS = 1;

export interface MetricPoint {
  /** Unix seconds. */
  ts: number;
  value: number;
}

export interface MetricDay {
  dayStart: number;
  /** Midnight after the day: 23 to 25 hours after `dayStart` across a daylight-saving change. */
  dayEnd: number;
  bucketSec: number;
  /** Bucket count of the day; bucket `i` covers `dayStart + i * bucketSec` up to the next. */
  buckets: number;
  /** Rounded mean per bucket, null where no point fell. These are the real values the readout shows. */
  avg: (number | null)[];
  min: (number | null)[];
  max: (number | null)[];
  /** Points per bucket. */
  count: number[];
  /** `avg` with a single missed bucket bridged, for the line only. */
  line: (number | null)[];
  /** Over every point of the day; null when there is none. `latest` is the last point by time. */
  stats: { min: number; max: number; avg: number; latest: number; latestTs: number; readings: number } | null;
}

/** The narrowest ladder width that is at least the median spacing of the points; 30 min for fewer than two points. */
export function chooseBucketSec(timestamps: readonly number[]): number {
  const ladder = METRIC_BUCKET_LADDER_SEC;
  if (timestamps.length < 2) return 1800;
  const sorted = [...timestamps].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i]! - sorted[i - 1]!;
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return ladder[0];
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)]!;
  return ladder.find((w) => w >= median) ?? ladder[ladder.length - 1]!;
}

/** Folds the points of `[dayStart, dayEnd)` into a day. Points outside it, or not finite, are ignored. */
export function buildMetricDay(points: readonly MetricPoint[], dayStart: number, dayEnd: number, bucketSec?: number): MetricDay {
  const inDay = points.filter((p) => Number.isFinite(p.value) && p.ts >= dayStart && p.ts < dayEnd);
  const width = bucketSec ?? chooseBucketSec(inDay.map((p) => p.ts));
  const buckets = bucketCount(dayStart, dayEnd, width);
  const sum: number[] = new Array(buckets).fill(0);
  const count: number[] = new Array(buckets).fill(0);
  const min: (number | null)[] = new Array(buckets).fill(null);
  const max: (number | null)[] = new Array(buckets).fill(null);
  let lo = Infinity;
  let hi = -Infinity;
  let total = 0;
  let latest: MetricPoint | null = null;
  for (const p of inDay) {
    const b = bucketOf(p.ts, dayStart, width);
    if (b < 0 || b >= buckets) continue;
    sum[b] = sum[b]! + p.value;
    count[b] = count[b]! + 1;
    min[b] = min[b] === null ? p.value : Math.min(min[b]!, p.value);
    max[b] = max[b] === null ? p.value : Math.max(max[b]!, p.value);
    lo = Math.min(lo, p.value);
    hi = Math.max(hi, p.value);
    total += p.value;
    if (latest === null || p.ts >= latest.ts) latest = p;
  }
  const avg = sum.map((s, i) => (count[i]! > 0 ? Math.round(s / count[i]!) : null));
  const readings = count.reduce((a, b) => a + b, 0);
  return {
    dayStart,
    dayEnd,
    bucketSec: width,
    buckets,
    avg,
    min,
    max,
    count,
    line: bridgeShortGaps(avg, METRIC_MAX_JOINED_EMPTY_BUCKETS),
    stats:
      readings > 0 && latest !== null
        ? { min: lo, max: hi, avg: Math.round(total / readings), latest: latest.value, latestTs: latest.ts, readings }
        : null,
  };
}

/** The day as the series the shared chart panel draws: HRV (ms) on the bucket grid. */
export function hrvDaySeries(day: MetricDay): AnalysisSeries {
  return { ...emptySeries(day), hrv: day.line };
}

/** The day as the series the shared chart panel draws: the stress level (1 to 100) on the bucket grid. */
export function stressDaySeries(day: MetricDay): AnalysisSeries {
  return { ...emptySeries(day), stress: day.line };
}

function emptySeries(day: MetricDay): AnalysisSeries {
  return { stepSec: day.bucketSec, n: day.buckets, dist: null, hr: null, pace: null, alt: null, cad: null, power: null, track: null };
}

// --- Stress bands ----------------------------------------------------------------------------

export type StressBand = 'relaxed' | 'normal' | 'medium' | 'high';

/** Bands of the watch's stress level, calmest first: relaxed 1 to 29, normal 30 to 59, medium 60 to 79, high 80 to 100. */
export const STRESS_BANDS: readonly { band: StressBand; from: number }[] = [
  { band: 'relaxed', from: 1 },
  { band: 'normal', from: 30 },
  { band: 'medium', from: 60 },
  { band: 'high', from: 80 },
];

export function stressBandOf(value: number): StressBand {
  if (value >= 80) return 'high';
  if (value >= 60) return 'medium';
  if (value >= 30) return 'normal';
  return 'relaxed';
}

/**
 * Seconds of the day spent in each band, in `STRESS_BANDS` order. A bucket with at least one point counts for its whole width
 * (the last one only up to midnight) in the band of its average; empty buckets count for nothing.
 */
export function stressBandSeconds(day: MetricDay): number[] {
  const out = STRESS_BANDS.map(() => 0);
  for (let i = 0; i < day.buckets; i++) {
    const v = day.avg[i];
    if (v === null || v === undefined) continue;
    const from = day.dayStart + i * day.bucketSec;
    const sec = Math.min(day.bucketSec, day.dayEnd - from);
    const k = STRESS_BANDS.findIndex((b) => b.band === stressBandOf(v));
    out[k] = out[k]! + sec;
  }
  return out;
}
