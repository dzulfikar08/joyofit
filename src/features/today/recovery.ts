import type { HrvReadingRow } from '@/db/queries';
import type { NightHrvAvailability } from '@/features/today/nightHrv';
import { t } from '@/i18n';

/**
 * Recovery from HRV against your own baseline, after Plews and Buchheit: work on ln(RMSSD), compare today's value with
 * the mean and standard deviation of the previous 30 days, and treat about half a standard deviation as the smallest
 * change worth noticing. Night readings (the watch's own per-minute RMSSD from its stress records, averaged over sleep) and 1-minute spot readings
 * differ in level, so a reading is only compared with earlier readings of the same kind.
 *
 * Recovery % is a logistic curve of z, 99 / (1 + e^(-k (z - z0))), clamped to 1..99, fitted so the familiar green / yellow / red
 * split at 67 and 34 falls on the same half standard deviation: green from z = -0.5 (within the normal day-to-day spread or above),
 * red below z = -1.5. Your usual HRV (z = 0) is about 80 %, one standard deviation above about 93 %, one below about 51 %. With HRV
 * spread normally around the baseline about 69 % of days are green, 24 % yellow and 7 % red (the earlier linear 50 + 25 z put a
 * normal day at 50 %, yellow, and one day in four in red). The mapping is JoyoFit's; it is not WHOOP's model.
 * (Jeremy's review ALGO-01, second iteration: docs/reviews/2026-11-jeremy-algorithm-review.md.)
 */
const BASELINE_DAYS = 30;
/** z where green starts (67 %) and where red starts (34 %). */
const GREEN_FROM_Z = -0.5;
const RED_BELOW_Z = -1.5;
const logit = (p: number) => Math.log(p / (99 - p));
/** Slope and midpoint of the curve through (GREEN_FROM_Z, 67) and (RED_BELOW_Z, 34). */
const CURVE_K = (logit(67) - logit(34)) / (GREEN_FROM_Z - RED_BELOW_Z);
const CURVE_Z0 = GREEN_FROM_Z - logit(67) / CURVE_K;

/** Recovery % at a z-score against the baseline, 1..99 (not rounded). */
export function recoveryPercent(z: number): number {
  return Math.min(99, Math.max(1, 99 / (1 + Math.exp(-CURVE_K * (z - CURVE_Z0)))));
}
/** Earlier readings of the same kind needed before today's is compared. */
export const MIN_BASELINE_READINGS = 4;
/** A spot reading counts for "today" when taken since this many hours before now. */
const SPOT_FRESH_SEC = 18 * 3600;
/** A night counts when it ended this recently. */
const NIGHT_FRESH_SEC = 20 * 3600;

export type RecoveryBand = 'green' | 'yellow' | 'red';

export interface Recovery {
  percent: number;
  band: RecoveryBand;
  rmssd: number;
  source: HrvReadingRow['source'];
  /** ln(RMSSD) baseline mean back in milliseconds, for display. */
  baselineRmssd: number;
  z: number;
  baselineCount: number;
}

/**
 * Why there is no recovery yet, in a form a gauge can word in a few syllables: the baseline is still filling (`have` of `need`
 * earlier readings of this kind), night HRV is switched off, only a 1-minute reading can give one on this watch, or last night
 * simply has no reading yet.
 */
export type RecoveryWait =
  | { kind: 'baseline'; have: number; need: number; unit: 'night' | 'reading' }
  | { kind: 'off' }
  | { kind: 'spot' }
  | { kind: 'none' };

export type RecoveryState = { recovery: Recovery } | { missing: string; wait: RecoveryWait };

export function bandOf(percent: number): RecoveryBand {
  return percent >= 67 ? 'green' : percent >= 34 ? 'yellow' : 'red';
}

/** The short form of `missingText`, for the Today gauge. */
function waitOf(availability: NightHrvAvailability | null | undefined): RecoveryWait {
  if (availability?.state === 'off') return { kind: 'off' };
  if (availability && ['ios', 'unsupported', 'none-recorded'].includes(availability.state)) return { kind: 'spot' };
  return { kind: 'none' };
}

/** Why there is no reading for today, from what is known about night HRV on this watch. */
function missingText(readings: readonly HrvReadingRow[], availability: NightHrvAvailability | null | undefined): string {
  if (availability && availability.state !== 'available') {
    return availability.state === 'off' || availability.state === 'waiting' || availability.state === 'no-watch'
      ? t('today:recovery.offWaiting', { message: availability.message, detail: availability.detail })
      : t('today:recovery.unavailable', { message: availability.message });
  }
  return readings.length === 0 ? t('today:recovery.noReadings') : t('today:recovery.noRecent');
}

/** Mean and sample standard deviation (n - 1) of `values`; the SD is 0 for a single value. The one baseline arithmetic of `recovery` and `hrvStatus`. */
export function meanSd(values: readonly number[]): { mean: number; sd: number } {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = values.length > 1 ? Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1)) : 0;
  return { mean, sd };
}

/** Today's recovery from `readings` (oldest first). Prefers last night over a spot reading. */
export function recovery(
  readings: readonly HrvReadingRow[],
  nowSec: number,
  availability?: NightHrvAvailability | null,
): RecoveryState {
  const latest = (source: HrvReadingRow['source'], freshSec: number) =>
    [...readings].reverse().find((r) => r.source === source && r.end >= nowSec - freshSec) ?? null;
  const today = latest('night', NIGHT_FRESH_SEC) ?? latest('spot', SPOT_FRESH_SEC);
  if (!today) return { missing: missingText(readings, availability), wait: waitOf(availability) };
  const history = readings.filter(
    (r) => r.source === today.source && r.end < today.start && r.end >= today.end - BASELINE_DAYS * 86400 && r.rmssd > 0,
  );
  if (history.length < MIN_BASELINE_READINGS) {
    return {
      missing: t(today.source === 'night' ? 'today:recovery.baselineNights' : 'today:recovery.baselineReadings', {
        have: history.length,
        count: MIN_BASELINE_READINGS,
      }),
      wait: { kind: 'baseline', have: history.length, need: MIN_BASELINE_READINGS, unit: today.source === 'night' ? 'night' : 'reading' },
    };
  }
  const { mean, sd } = meanSd(history.map((r) => Math.log(r.rmssd)));
  // A few near-identical readings give a tiny spread that would make every change look extreme; 0.1 in ln units is
  // about a 10 % change in RMSSD, a typical day-to-day spread.
  const z = (Math.log(today.rmssd) - mean) / Math.max(sd, 0.1);
  const percent = Math.round(recoveryPercent(z));
  return {
    recovery: {
      percent,
      band: bandOf(percent),
      rmssd: today.rmssd,
      source: today.source,
      baselineRmssd: Math.exp(mean),
      z,
      baselineCount: history.length,
    },
  };
}
