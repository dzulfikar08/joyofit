/**
 * VO2max, the watch's own value first and JoyoFit's estimate when the watch gave none.
 *
 * Watch: `summary_json.vo2max` of a workout, the watch's `maxMET` times 3.5 ml/kg/min per MET, divided by 65536 (the same
 * conversion as Gadgetbridge's `HuaweiWorkoutGbParser`). The division is in whole numbers on both sides, so the stored
 * value is the watch's figure rounded down to a whole ml/kg/min: up to 1 below the watch's own. A value outside
 * 10..90 cannot be a human VO2max (it would mean the unit is not what we think), so it is not used.
 *
 * Estimate: Uth-Sorensen (2004), VO2max = 15.3 x maximum heart rate / resting heart rate. The maximum is 220 minus the age
 * from the profile, not a measured one, and the resting rate is the median over the last 14 days of the watch's own daily
 * `restingHeartRate` reading (`listRestingHeartRateByDay` selects `MIN(resting_heart_rate)`, the value the watch reports as
 * resting, not the day's lowest instantaneous heart rate), so treat it as a rough figure.
 */
export const VO2_MIN = 10;
export const VO2_MAX = 90;
const UTH_FACTOR = 15.3;
const DAY_SEC = 86400;
const WATCH_WINDOW_DAYS = 90;
const REST_WINDOW_DAYS = 14;
export const MIN_REST_DAYS = 5;
const TREND_WEEKS = 8;
const MIN_REST_DAYS_PER_WEEK = 3;

export interface Vo2Point {
  /** Unix seconds: the workout start, or the start of the week for an estimate. */
  at: number;
  value: number;
}

export interface Vo2Status {
  value: number;
  source: 'watch' | 'estimate';
  /** Unix seconds the value is from (the workout for the watch's value, `dayStart` for the estimate). */
  asOf: number;
  /** Oldest first. */
  trend: Vo2Point[];
  /** Latest minus the first value of the trend; null when the trend spans under a week or has one point. */
  delta: number | null;
}

/** The watch's value when it is a plausible VO2max, else null. */
export function plausibleVo2(value: number | undefined | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= VO2_MIN && value <= VO2_MAX ? value : null;
}

/** Uth-Sorensen from maximum and resting heart rate; null when either is missing or they cannot belong together. */
export function uthSorensen(maxHr: number, restHr: number): number | null {
  if (!(restHr >= 30 && restHr <= 110) || !(maxHr > restHr)) return null;
  const value = (UTH_FACTOR * maxHr) / restHr;
  return plausibleVo2(value);
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function deltaOf(trend: readonly Vo2Point[]): number | null {
  if (trend.length < 2) return null;
  const first = trend[0];
  const last = trend[trend.length - 1];
  return last.at - first.at >= 7 * DAY_SEC ? last.value - first.value : null;
}

export function vo2maxStatus(input: {
  nowSec: number;
  /** Local midnight of today. */
  dayStart: number;
  workouts: readonly { start: number; vo2max?: number }[];
  /** The watch's resting heart rate per local day (`listRestingHeartRateByDay`), keyed by local midnight. */
  resting: ReadonlyMap<number, number>;
  maxHr: number;
}): Vo2Status | null {
  const { nowSec, dayStart, workouts, resting, maxHr } = input;

  const watch: Vo2Point[] = workouts
    .filter((w) => w.start >= nowSec - WATCH_WINDOW_DAYS * DAY_SEC && w.start <= nowSec)
    .flatMap((w) => {
      const value = plausibleVo2(w.vo2max);
      return value === null ? [] : [{ at: w.start, value }];
    })
    .sort((a, b) => a.at - b.at);
  if (watch.length > 0) {
    const last = watch[watch.length - 1];
    return { value: last.value, source: 'watch', asOf: last.at, trend: watch, delta: deltaOf(watch) };
  }

  const restIn = (from: number, to: number) => [...resting.entries()].filter(([day]) => day >= from && day < to).map(([, v]) => v);
  const recent = restIn(dayStart - REST_WINDOW_DAYS * DAY_SEC, dayStart + DAY_SEC);
  if (recent.length < MIN_REST_DAYS) return null;
  const value = uthSorensen(maxHr, median(recent) as number);
  if (value === null) return null;

  const trend: Vo2Point[] = [];
  for (let w = TREND_WEEKS - 1; w >= 0; w--) {
    const to = dayStart + DAY_SEC - w * 7 * DAY_SEC;
    const from = to - 7 * DAY_SEC;
    const week = restIn(from, to);
    if (week.length < MIN_REST_DAYS_PER_WEEK) continue;
    const v = uthSorensen(maxHr, median(week) as number);
    if (v !== null) trend.push({ at: from, value: v });
  }
  return { value, source: 'estimate', asOf: dayStart, trend, delta: deltaOf(trend) };
}
