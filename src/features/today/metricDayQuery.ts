import type { SQLiteDatabase } from 'expo-sqlite';

import type { HrvReadingRow } from '@/db/queries';

import { buildMetricDay, type MetricDay, type MetricPoint } from './metricDay';

/** `health_metrics` type of the watch's all-day HRV (RMSSD, ms). */
export const HRV_METRIC_TYPE = 'hrv';
/** `health_metrics` type of the watch's stress level (1 to 100). */
export const STRESS_METRIC_TYPE = 'emotion';

/** Points of one `health_metrics` type in `[dayStart, dayEnd)`, oldest first; rows without a positive number are left out. */
export function listMetricPoints(db: SQLiteDatabase, type: string, dayStart: number, dayEnd: number): Promise<MetricPoint[]> {
  return db.getAllAsync<MetricPoint>(
    'SELECT ts, value FROM health_metrics WHERE type = ? AND ts >= ? AND ts < ? AND value > 0 ORDER BY ts',
    type,
    dayStart,
    dayEnd,
  );
}

/** The whole local day `[dayStart, dayEnd)` of one `health_metrics` type. */
export async function loadMetricDay(db: SQLiteDatabase, type: string, dayStart: number, dayEnd: number): Promise<MetricDay> {
  return buildMetricDay(await listMetricPoints(db, type, dayStart, dayEnd), dayStart, dayEnd);
}

/** Night and spot HRV values that ended in `[dayStart, dayEnd)` (the night that ended that morning, the day's one-minute measurements), oldest first. */
export function listHrvReadingsOfDay(db: SQLiteDatabase, dayStart: number, dayEnd: number): Promise<HrvReadingRow[]> {
  return db.getAllAsync<HrvReadingRow>(
    'SELECT start, end, source, rmssd, beats FROM hrv_readings WHERE end >= ? AND end < ? AND rmssd > 0 ORDER BY start',
    dayStart,
    dayEnd,
  );
}

export interface HrvDayData {
  day: MetricDay;
  /** Night values, oldest first, and their mean (rounded); null without any. */
  night: HrvReadingRow[];
  nightAvg: number | null;
  /** One-minute measurements, oldest first. */
  spot: HrvReadingRow[];
}

export async function loadHrvDay(db: SQLiteDatabase, dayStart: number, dayEnd: number): Promise<HrvDayData> {
  const [day, readings] = await Promise.all([loadMetricDay(db, HRV_METRIC_TYPE, dayStart, dayEnd), listHrvReadingsOfDay(db, dayStart, dayEnd)]);
  const night = readings.filter((r) => r.source === 'night');
  return {
    day,
    night,
    nightAvg: night.length > 0 ? Math.round(night.reduce((sum, r) => sum + r.rmssd, 0) / night.length) : null,
    spot: readings.filter((r) => r.source === 'spot'),
  };
}
