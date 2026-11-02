import { fmtDecimal, fmtInt, fmtNumber, t } from '@/i18n';
import type { IconName } from '@/components/IconChip';
import type { Tint } from '@/theme';

/** How one `health_metrics.type` is named, shown and coloured. Types not listed here use a generic card. */
export interface MetricMeta {
  label: string;
  icon: IconName;
  tint: Tint;
  /** Unit written after the number; empty when `format` already says it. */
  unit: string;
  /** Short line under the value: what the number is. */
  hint?: string;
  format: (value: number) => string;
  /** Screen with the whole day of this metric; the card opens it. */
  dayRoute?: '/hrv-day' | '/stress';
}

const oneDecimal = (v: number) => fmtDecimal(v, 1);
const whole = (v: number) => fmtInt(v);

/** Known metrics, built on demand so the text follows the language; key order is the display order. The raw ones (value = null) only need a title. */
const META: Record<string, (() => MetricMeta) | undefined> = {
  skin_temperature: () => ({ label: t('health:metrics.skin_temperature.label'), icon: 'thermometer', tint: 'workouts', unit: '\u00B0C', format: oneDecimal }), // i18n-ok: unit symbol
  hrv: () => ({ label: t('health:metrics.hrv.label'), icon: 'pulse', tint: 'heart', unit: 'ms', hint: t('health:metrics.hrv.hint'), format: whole, dayRoute: '/hrv-day' }), // i18n-ok: unit symbol
  emotion: () => ({ label: t('health:metrics.emotion.label'), icon: 'happy', tint: 'sleep', unit: '', hint: t('health:metrics.emotion.hint'), format: whole, dayRoute: '/stress' }),
  sleep_apnea: () => ({
    label: t('health:metrics.sleep_apnea.label'),
    icon: 'moon',
    tint: 'sleep',
    unit: '',
    hint: t('health:metrics.sleep_apnea.hint'),
    format: (v) => t('health:metrics.level', { value: fmtInt(v) }),
  }),
  arterial_stiffness: () => ({ label: t('health:metrics.arterial_stiffness.label'), icon: 'fitness', tint: 'heart', unit: '', format: whole }),
  blood_pressure: () => ({ label: t('health:metrics.blood_pressure.label'), icon: 'water', tint: 'heart', unit: '', format: whole }),
  altitude: () => ({ label: t('health:metrics.altitude.label'), icon: 'trending-up', tint: 'steps', unit: '', format: whole }),
  ams: () => ({ label: t('health:metrics.ams.label'), icon: 'warning', tint: 'workouts', unit: '', format: whole }),
  arrhythmia: () => ({ label: t('health:metrics.arrhythmia.label'), icon: 'heart-half', tint: 'heart', unit: '', format: whole }),
};

/** Known types in display order; unknown types sort after them. */
export const METRIC_ORDER = Object.keys(META);

/** A type nobody knows gets this generic look and is titled by the caller. */
const FALLBACK: MetricMeta = {
  label: '',
  icon: 'analytics',
  tint: 'steps',
  unit: '',
  format: (v) => fmtNumber(v, 2),
};

export function metaOrFallback(type: string): MetricMeta {
  return META[type]?.() ?? FALLBACK;
}

export const WEEK_DAYS = 7;

/** Local midnights (unix seconds) of the last `WEEK_DAYS` days, oldest first; the last one is today. */
export function weekDayStarts(nowSec: number): number[] {
  const today = new Date(nowSec * 1000);
  const starts: number[] = [];
  for (let back = WEEK_DAYS - 1; back >= 0; back--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
    starts.push(Math.floor(d.getTime() / 1000));
  }
  return starts;
}

export interface WeekPoint {
  /** Unix seconds of local midnight of that day. */
  dayStart: number;
  /** Mean of that day's values, or null when the day has none. */
  mean: number | null;
}

/** Daily means over the last seven local days from rows with a value. */
export function dailyMeans(rows: readonly { ts: number; value: number }[], nowSec: number): WeekPoint[] {
  const starts = weekDayStarts(nowSec);
  const sums = new Array<number>(starts.length).fill(0);
  const counts = new Array<number>(starts.length).fill(0);
  for (const row of rows) {
    for (let i = starts.length - 1; i >= 0; i--) {
      if (row.ts >= starts[i]) {
        sums[i] += row.value;
        counts[i] += 1;
        break;
      }
    }
  }
  return starts.map((dayStart, i) => ({ dayStart, mean: counts[i] > 0 ? sums[i] / counts[i] : null }));
}

/** Parsed `values_json` as label/value pairs; anything that is not a JSON object comes back as one raw line. */
export function rawPairs(valuesJson: string): [string, string][] {
  try {
    const parsed: unknown = JSON.parse(valuesJson);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [
        key,
        typeof value === 'string' ? value : JSON.stringify(value),
      ]);
    }
  } catch {
    // Not JSON: show the text as it is below.
  }
  return [['raw', valuesJson]];
}
