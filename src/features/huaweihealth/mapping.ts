/**
 * Health Kit cloud data (docs/huawei-health-kit.md "Sync from the cloud API") turned into the rows the Huawei import writes
 * (`importStoreSql.ts`): an `ActivityRecord` becomes a `WorkoutLine` with its points, `com.huawei.continuous.steps.delta`
 * sample points become per-minute step rows, and the daily totals of `sampleSet:dailyPolymerize` become `DayTotalRow`s.
 *
 * Field names, units and time units follow Huawei's data model: record times are milliseconds, sample point times are
 * nanoseconds, distance is metres, calories kcal, speed m/s, heart rate bpm. Pure: no Expo imports, tested under bun.
 */
import type { DayTotalRow, MinuteRow, PointRow, WorkoutLine } from '@/features/huaweiimport/importStoreSql';

import { isPaceKind, sportOfActivityType } from './sports';

// ---------------------------------------------------------------------------------------------------------------------
// Huawei's data model (REST "Data Model"), only the fields read here; everything optional because nothing is trusted.
// ---------------------------------------------------------------------------------------------------------------------

export interface HkValue {
  fieldName?: string;
  integerValue?: number;
  floatValue?: number;
  longValue?: number;
  stringValue?: string;
}

export interface HkSamplePoint {
  /** Nanoseconds. */
  startTime?: number;
  /** Nanoseconds. */
  endTime?: number;
  dataTypeName?: string;
  value?: HkValue[];
}

export interface HkSampleSet {
  dataCollectorId?: string;
  samplePoints?: HkSamplePoint[];
}

export interface HkActivityRecord {
  id?: string;
  name?: string;
  /** Milliseconds. */
  startTime?: number;
  /** Milliseconds; absent while the workout is still in progress. */
  endTime?: number;
  modifyTime?: number;
  timeZone?: string;
  /** Milliseconds. */
  activeTime?: number;
  activityType?: number;
  activitySummary?: { dataSummary?: HkSamplePoint[] };
  details?: HkSampleSet[];
  /** 1: Huawei marked one of two records of the same time as the duplicate. */
  duplicate?: number;
  abnormal?: number;
  sourceType?: number;
}

export interface HkGroup {
  /** Milliseconds. */
  startTime?: number;
  /** Milliseconds (inclusive). */
  endTime?: number;
  sampleSet?: HkSampleSet[];
}

/** Data type names (Health Kit "Data Types", cloud side). */
export const HK = {
  stepsDelta: 'com.huawei.continuous.steps.delta',
  stepsTotal: 'com.huawei.continuous.steps.total',
  distanceTotal: 'com.huawei.continuous.distance.total',
  caloriesTotal: 'com.huawei.continuous.calories.burnt.total',
  heartRateStats: 'com.huawei.continuous.exercise_heart_rate.statistics',
  speedStats: 'com.huawei.continuous.speed.statistics',
  heartRate: 'com.huawei.instantaneous.exercise_heart_rate',
  location: 'com.huawei.instantaneous.location.sample',
  speed: 'com.huawei.instantaneous.speed',
  cadence: 'com.huawei.instantaneous.steps.rate',
  altitude: 'com.huawei.instantaneous.altitude',
} as const;

/** The workout details the sync asks for (`detailDataType`); each needs the `activity.read` scope, the route `location.read`. */
export const WORKOUT_DETAIL_TYPES = [HK.heartRate, HK.speed, HK.cadence, HK.altitude, HK.location] as const;

/** `coordinate` of a location sample: 1 is WGS84; 2 (GCJ-02) is mainland China's shifted grid, not drawn on our maps. */
const WGS84 = 1;
/** Huawei's documented range of workout heart rate, (0, 255). */
const HR_MIN = 1;
const HR_MAX = 254;

const ns = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v / 1e9) : null);
const ms = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v / 1000) : null);

/** The number in one field of a sample point (whichever of integerValue / floatValue / longValue Huawei filled). */
export function fieldValue(point: HkSamplePoint | undefined, fieldName: string): number | null {
  const value = point?.value?.find((v) => v.fieldName === fieldName);
  const n = value?.integerValue ?? value?.floatValue ?? value?.longValue;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function summaryPoint(record: HkActivityRecord, dataTypeName: string): HkSamplePoint | undefined {
  return record.activitySummary?.dataSummary?.find((p) => p.dataTypeName === dataTypeName);
}

function* detailPoints(record: HkActivityRecord): Generator<HkSamplePoint> {
  for (const set of record.details ?? []) for (const point of set.samplePoints ?? []) yield point;
}

/** Climb and descent of an altitude series, ignoring swings under 3 m (`HuaweiMotionPathParser.elevationChange`). */
function elevationChange(altitudes: number[]): [number, number] {
  if (altitudes.length === 0) return [0, 0];
  let reference = altitudes[0]!;
  let gain = 0;
  let loss = 0;
  for (const a of altitudes) {
    if (a - reference >= 3) {
      gain += a - reference;
      reference = a;
    } else if (reference - a >= 3) {
      loss += reference - a;
      reference = a;
    }
  }
  return [gain, loss];
}

/** `summary_json.source` of a workout read from Health Kit; the export import writes `huawei-export`. */
export const HEALTH_KIT_SOURCE = 'huawei-health-kit';

/**
 * The workout one exercise record describes, or null when it has no usable time span or Huawei marked it the duplicate of
 * another record of the same time. Detail points of the same second are merged into one point; GPS fixes outside WGS84
 * are left out (the heart rate and the rest of the workout stay).
 */
export function recordToWorkout(record: HkActivityRecord): WorkoutLine | null {
  if (record.duplicate === 1) return null;
  const start = ms(record.startTime);
  const end = ms(record.endTime);
  if (start === null || end === null || end <= start) return null;
  const sport = sportOfActivityType(record.activityType);

  const byTs = new Map<number, PointRow>();
  const at = (ts: number): PointRow => {
    let p = byTs.get(ts);
    if (!p) {
      p = [ts, null, null, null, null, null, null, null, null];
      byTs.set(ts, p);
    }
    return p;
  };
  const heartRates: number[] = [];
  const altitudes: number[] = [];
  let gpsPoints = 0;
  for (const point of detailPoints(record)) {
    const ts = ns(point.startTime);
    if (ts === null) continue;
    switch (point.dataTypeName) {
      case HK.heartRate: {
        const bpm = fieldValue(point, 'bpm');
        if (bpm === null) break;
        const rounded = Math.round(bpm);
        if (rounded < HR_MIN || rounded > HR_MAX) break;
        at(ts)[4] = rounded;
        heartRates.push(rounded);
        break;
      }
      case HK.location: {
        const lat = fieldValue(point, 'latitude');
        const lon = fieldValue(point, 'longitude');
        if (lat === null || lon === null || fieldValue(point, 'coordinate') !== WGS84) break;
        if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) break;
        const p = at(ts);
        p[1] = lat;
        p[2] = lon;
        gpsPoints += 1;
        break;
      }
      case HK.speed: {
        const speed = fieldValue(point, 'speed');
        if (speed !== null && speed >= 0) at(ts)[5] = speed;
        break;
      }
      case HK.cadence: {
        const spm = fieldValue(point, 'step_rate');
        if (spm !== null && spm > 0) at(ts)[6] = Math.round(spm);
        break;
      }
      case HK.altitude: {
        const altitude = fieldValue(point, 'altitude');
        if (altitude !== null) {
          at(ts)[3] = altitude;
          altitudes.push(altitude);
        }
        break;
      }
    }
  }
  const points = [...byTs.values()].sort((a, b) => a[0] - b[0]);

  const duration = end - start;
  const distance = Math.max(0, Math.round(fieldValue(summaryPoint(record, HK.distanceTotal), 'distance') ?? 0));
  const calories = Math.max(0, Math.round(fieldValue(summaryPoint(record, HK.caloriesTotal), 'calories_total') ?? 0));
  const steps = Math.max(0, Math.round(fieldValue(summaryPoint(record, HK.stepsTotal), 'steps') ?? 0));
  const hrStats = summaryPoint(record, HK.heartRateStats);
  const statHr = (field: string) => {
    const v = fieldValue(hrStats, field);
    return v !== null && v >= HR_MIN && v <= HR_MAX ? Math.round(v) : null;
  };
  // The summary's own statistics first (Huawei computes them over the full series); the detail points when it has none.
  const avgHr = statHr('avg') ?? (heartRates.length ? Math.round(heartRates.reduce((a, b) => a + b, 0) / heartRates.length) : null);
  const maxHr = statHr('max') ?? (heartRates.length ? Math.max(...heartRates) : null);
  const minHr = statHr('min') ?? (heartRates.length ? Math.min(...heartRates) : null);

  const summary: Record<string, unknown> = {
    kind: sport.kind,
    source: HEALTH_KIT_SOURCE,
    huaweiActivityType: record.activityType ?? null,
    healthKitId: record.id ?? null,
  };
  if (record.timeZone) summary.timeZone = record.timeZone;
  if (typeof record.activeTime === 'number' && record.activeTime > 0) summary.movingTimeSec = Math.round(record.activeTime / 1000);
  summary.gps = gpsPoints > 0 ? 'ok' : 'none';
  summary.gpsPoints = gpsPoints;
  if (duration > 0 && distance > 0) {
    const avgSpeed = distance / duration;
    summary.avgSpeed = avgSpeed;
    if (isPaceKind(sport.kind)) summary.avgPaceSecPerKm = 1000 / avgSpeed;
  }
  if (minHr !== null) summary.minHr = minHr;
  if (altitudes.length > 0) {
    const [gain, loss] = elevationChange(altitudes);
    summary.minAltitude = Math.min(...altitudes);
    summary.maxAltitude = Math.max(...altitudes);
    summary.avgAltitude = altitudes.reduce((a, b) => a + b, 0) / altitudes.length;
    summary.elevationGain = gain;
    summary.elevationLoss = loss;
  }

  return {
    start,
    end,
    sportType: sport.type,
    sportName: sport.name,
    duration,
    distance,
    calories,
    steps,
    avgHr,
    maxHr,
    summaryJson: JSON.stringify(summary),
    points,
  };
}

/**
 * Per-minute step rows from `com.huawei.continuous.steps.delta` sample points. A point covering several minutes (Huawei
 * allows up to an hour per record) is spread evenly over the minutes it covers, the remainder going to the first ones, so
 * the day's sum stays exact. Calories, distance and heart rate stay 0 / NULL: only steps are read.
 */
export function stepsToMinutes(points: readonly HkSamplePoint[]): MinuteRow[] {
  const minutes = new Map<number, number>();
  for (const point of points) {
    if (point.dataTypeName !== undefined && point.dataTypeName !== HK.stepsDelta) continue;
    const steps = fieldValue(point, 'steps_delta');
    const start = ns(point.startTime);
    if (steps === null || start === null || steps <= 0) continue;
    const end = Math.max(ns(point.endTime) ?? start, start);
    const first = Math.floor(start / 60) * 60;
    // A point ending exactly on a minute boundary does not reach into that minute.
    const count = Math.max(1, Math.ceil((end - first) / 60));
    const total = Math.round(steps);
    const base = Math.floor(total / count);
    let remainder = total - base * count;
    for (let i = 0; i < count; i += 1) {
      const n = base + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
      if (n > 0) minutes.set(first + i * 60, (minutes.get(first + i * 60) ?? 0) + n);
    }
  }
  return [...minutes.entries()].sort((a, b) => a[0] - b[0]).map(([ts, steps]) => [ts, steps, 0, 0, null, null, null]);
}

/** Every sample point of a `sampleSet:polymerize` answer's groups. */
export function groupPoints(groups: readonly HkGroup[] | undefined): HkSamplePoint[] {
  const out: HkSamplePoint[] = [];
  for (const group of groups ?? []) for (const set of group.sampleSet ?? []) out.push(...(set.samplePoints ?? []));
  return out;
}

/**
 * Day totals from a `sampleSet:dailyPolymerize` answer (one group per calendar day in the requested time zone, the
 * `com.huawei.continuous.steps.total` point holding `steps`). Only days that ended before `completeBefore` (unix seconds)
 * are returned: a total written for a day still filling up would later count twice next to the minutes that arrive.
 */
export function dailyStepTotals(groups: readonly HkGroup[] | undefined, completeBefore: number): DayTotalRow[] {
  const out: DayTotalRow[] = [];
  for (const group of groups ?? []) {
    const dayStart = ms(group.startTime);
    const lastMs = group.endTime;
    if (dayStart === null || typeof lastMs !== 'number') continue;
    // `endTime` is the day's last millisecond (…999) or the next midnight; either way the day ends at the next whole second.
    const dayEnd = Math.ceil((lastMs + (lastMs % 1000 === 999 ? 1 : 0)) / 1000);
    if (dayEnd <= dayStart || dayEnd > completeBefore) continue;
    let steps = 0;
    for (const set of group.sampleSet ?? []) {
      for (const point of set.samplePoints ?? []) {
        if (point.dataTypeName !== undefined && point.dataTypeName !== HK.stepsTotal) continue;
        steps += Math.max(0, Math.round(fieldValue(point, 'steps') ?? 0));
      }
    }
    if (steps > 0) out.push([dayStart, dayEnd, dayStart + 12 * 3600, steps, 0, 0]);
  }
  return out;
}
