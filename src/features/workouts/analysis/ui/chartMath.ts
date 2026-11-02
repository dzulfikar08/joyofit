/**
 * Pure maths behind the analysis charts and tables: axis scaling, ticks, percentile clipping, SVG paths, readout
 * values, bar widths. No React, no react-native: unit tested with `bun test`.
 */

import {
  axisValue,
  formatDuration,
  formatPace,
  indexAtAxis,
  type AnalysisComparisonItem,
  type AnalysisSeries,
  type AnalysisSplit,
  type SportKind,
} from '../types';
import { fmtDate, fmtDecimal, fmtNumber, t } from '@/i18n';

import { isFootKind } from '../sport';
import { stepLengthAt, stepLengthSeries } from '../stride';

/** The metrics of a workout chart: the tabs of the workout analysis. */
export type WorkoutMetric = 'pace' | 'speed' | 'hr' | 'alt' | 'cad' | 'stride' | 'power';
/** Sparse day metrics the whole-day screens chart: all-day HRV (ms) and stress level (1 to 100). */
export type DayMetric = 'hrv' | 'stress';
export type ChartMetric = WorkoutMetric | DayMetric;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** `p` in 0..1, linear interpolation between the neighbours of a sorted ascending array. */
export function percentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return NaN;
  const pos = clamp(p, 0, 1) * (sortedAsc.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sortedAsc[lo]!;
  const b = sortedAsc[hi]!;
  return a + (b - a) * (pos - lo);
}

export function finiteSorted(values: readonly (number | null)[]): number[] {
  const out: number[] = [];
  for (const v of values) if (v !== null && Number.isFinite(v)) out.push(v);
  return out.sort((a, b) => a - b);
}

// --- Metrics ---------------------------------------------------------------------------------

/** The per-sample values of a metric; speed is derived from the pace series (km/h). Null when the series lacks it. */
export function metricValues(series: AnalysisSeries, metric: ChartMetric): (number | null)[] | null {
  switch (metric) {
    case 'pace':
      return series.pace;
    case 'speed':
      return series.pace ? series.pace.map((p) => (p !== null && p > 0 ? 3600 / p : null)) : null;
    case 'hr':
      return series.hr;
    case 'alt':
      return series.alt;
    case 'cad':
      return series.cad;
    case 'stride':
      return stepLengthSeries(series, series.n);
    case 'power':
      return series.power;
    case 'hrv':
      return series.hrv ?? null;
    case 'stress':
      return series.stress ?? null;
  }
}

function hasValues(values: readonly (number | null)[] | null, min = 2): boolean {
  if (!values) return false;
  let count = 0;
  for (const v of values) {
    if (v !== null && Number.isFinite(v) && ++count >= min) return true;
  }
  return false;
}

/** The tabs a series can show, in display order. Pace is for runs and walks, speed for rides. */
export function availableMetrics(series: AnalysisSeries, kind: SportKind): WorkoutMetric[] {
  if (series.n < 2) return [];
  const out: WorkoutMetric[] = [];
  if (hasValues(series.pace)) {
    if (kind === 'run' || kind === 'walk') out.push('pace');
    else if (kind === 'ride') out.push('speed');
  }
  if (hasValues(series.hr)) out.push('hr');
  if (hasValues(series.alt)) out.push('alt');
  if (hasValues(series.cad)) out.push('cad');
  if (isFootKind(kind) && hasValues(stepLengthSeries(series, series.n))) out.push('stride');
  if (hasValues(series.power)) out.push('power');
  return out;
}

export interface Domain {
  min: number;
  max: number;
  /** True for pace: the smallest value (fastest) is drawn at the top. */
  invert: boolean;
}

interface DomainRule {
  lo: number;
  hi: number;
  pad: number;
  minSpan: number;
  floorZero: boolean;
}

const DOMAIN_RULES: Record<ChartMetric, DomainRule> = {
  pace: { lo: 0.05, hi: 0.95, pad: 0.1, minSpan: 20, floorZero: true },
  speed: { lo: 0.02, hi: 0.98, pad: 0.1, minSpan: 4, floorZero: true },
  hr: { lo: 0.01, hi: 0.99, pad: 0.08, minSpan: 20, floorZero: true },
  alt: { lo: 0, hi: 1, pad: 0.12, minSpan: 10, floorZero: false },
  cad: { lo: 0.02, hi: 0.98, pad: 0.08, minSpan: 20, floorZero: true },
  stride: { lo: 0.02, hi: 0.98, pad: 0.08, minSpan: 0.2, floorZero: true },
  power: { lo: 0.02, hi: 0.98, pad: 0.08, minSpan: 40, floorZero: true },
  hrv: { lo: 0, hi: 1, pad: 0.12, minSpan: 20, floorZero: true },
  // Whole range of the day (no clipping: a peak is the point), and a span of at least 40 so a calm day stays flat instead of stretched.
  stress: { lo: 0, hi: 1, pad: 0.1, minSpan: 40, floorZero: true },
};

/** Value range of a chart: percentile-clipped (pace p5 to p95), padded, never below zero for non-elevation metrics. */
export function metricDomain(metric: ChartMetric, values: readonly (number | null)[]): Domain | null {
  const sorted = finiteSorted(values);
  if (sorted.length === 0) return null;
  const rule = DOMAIN_RULES[metric];
  let lo = percentile(sorted, rule.lo);
  let hi = percentile(sorted, rule.hi);
  if (hi - lo < rule.minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - rule.minSpan / 2;
    hi = mid + rule.minSpan / 2;
  }
  const pad = (hi - lo) * rule.pad;
  lo -= pad;
  hi += pad;
  if (rule.floorZero && lo < 0) {
    hi -= lo;
    lo = 0;
  }
  return { min: lo, max: hi, invert: metric === 'pace' };
}

/** Y pixel of a value; values outside the domain stick to its edge. */
export function yPosition(value: number, domain: Domain, top: number, height: number): number {
  const span = domain.max - domain.min || 1;
  const t = (clamp(value, domain.min, domain.max) - domain.min) / span;
  return top + (domain.invert ? t : 1 - t) * height;
}

// --- Ticks -----------------------------------------------------------------------------------

const PACE_STEPS = [5, 10, 15, 20, 30, 60, 120, 300];

/** Round tick values inside [min, max], roughly `target` of them. `steps` overrides the 1-2-5 ladder (pace uses seconds). */
export function niceTicks(min: number, max: number, target: number, steps?: readonly number[]): number[] {
  if (!(max > min) || target < 1) return [];
  // A step up to a quarter smaller than the even split is fine: charts read better with a tick more than a tick less.
  const rough = ((max - min) / target) * 0.75;
  let step: number;
  if (steps) {
    step = steps.find((s) => s >= rough) ?? steps[steps.length - 1]!;
  } else {
    const mag = 10 ** Math.floor(Math.log10(rough));
    step = ([1, 2, 5, 10].map((m) => m * mag).find((s) => s >= rough) ?? 10 * mag) as number;
  }
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

export function yTicks(metric: ChartMetric, domain: Domain, target: number): number[] {
  return niceTicks(domain.min, domain.max, target, metric === 'pace' ? PACE_STEPS : undefined);
}

const DISTANCE_STEPS_M = [100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000];
const TIME_STEPS_SEC = [30, 60, 120, 300, 600, 900, 1200, 1800, 3600, 7200, 10800, 21600];

/** X axis ticks (in axis units, metres or seconds), at most `maxTicks`, never at 0. */
export function axisTicks(axisMax: number, isDistance: boolean, maxTicks: number): number[] {
  if (!(axisMax > 0) || maxTicks < 1) return [];
  const steps = isDistance ? DISTANCE_STEPS_M : TIME_STEPS_SEC;
  const step = steps.find((s) => Math.floor(axisMax / s) <= maxTicks) ?? steps[steps.length - 1]!;
  const out: number[] = [];
  for (let v = step; v <= axisMax + 1e-9; v += step) out.push(v);
  return out;
}

export function formatAxisTick(value: number, isDistance: boolean): string {
  return isDistance ? t('common:units.km', { value: fmtNumber(value / 1000, 2) }) : formatDuration(value);
}

// --- Axis and scrub index --------------------------------------------------------------------

/** The last x value of a series; at least 1 so a degenerate series never divides by zero. */
export function axisMaxOf(series: AnalysisSeries): number {
  return Math.max(1, axisValue(series, series.n - 1));
}

export function xFromIndex(series: AnalysisSeries, index: number, left: number, width: number): number {
  return left + (axisValue(series, clamp(index, 0, series.n - 1)) / axisMaxOf(series)) * width;
}

/** The sample under a touch at pixel `x` of a plot that starts at `left` and is `width` wide. */
export function indexFromX(series: AnalysisSeries, x: number, left: number, width: number): number {
  if (series.n <= 1 || width <= 0) return 0;
  const f = clamp((x - left) / width, 0, 1);
  return indexAtAxis(series, f * axisMaxOf(series));
}

// --- Chart geometry --------------------------------------------------------------------------

export interface PlotRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ChartGeometry {
  plot: PlotRect;
  domain: Domain;
  /** Pixel x per sample. */
  xs: number[];
  /** Pixel y per sample; null for gaps. */
  ys: (number | null)[];
  line: string;
  area: string;
  yTicks: { value: number; y: number }[];
  xTicks: { value: number; x: number }[];
  isDistance: boolean;
}

const r1 = (v: number): string => (Math.round(v * 10) / 10).toString();

/**
 * The samples of one run worth drawing: where several share a pixel column (a long ride on a fine grid has ten or more per
 * pixel) only the first, the lowest, the highest and the last are kept, so peaks stay and the path stays short. A column with
 * at most three samples is kept whole.
 */
function thinRun(run: readonly number[], xs: readonly number[], ys: readonly (number | null)[]): number[] {
  const out: number[] = [];
  let k = 0;
  while (k < run.length) {
    const col = Math.floor(xs[run[k]!]!);
    let end = k + 1;
    while (end < run.length && Math.floor(xs[run[end]!]!) === col) end++;
    if (end - k <= 3) {
      for (let j = k; j < end; j++) out.push(run[j]!);
    } else {
      let lo = k;
      let hi = k;
      for (let j = k + 1; j < end; j++) {
        if ((ys[run[j]!] as number) < (ys[run[lo]!] as number)) lo = j;
        if ((ys[run[j]!] as number) > (ys[run[hi]!] as number)) hi = j;
      }
      const picks = [k, lo, hi, end - 1].sort((a, b) => a - b);
      for (let j = 0; j < picks.length; j++) if (j === 0 || picks[j] !== picks[j - 1]) out.push(run[picks[j]!]!);
    }
    k = end;
  }
  return out;
}

/** `M x y L x y ...` per uninterrupted run (single points are dropped) plus the closed area down to `baseY`. */
export function buildPaths(xs: readonly number[], ys: readonly (number | null)[], baseY: number): { line: string; area: string } {
  let line = '';
  let area = '';
  let run: number[] = [];
  const flush = () => {
    if (run.length >= 2) {
      const kept = thinRun(run, xs, ys);
      let l = '';
      for (let k = 0; k < kept.length; k++) l += `${k === 0 ? 'M' : 'L'}${r1(xs[kept[k]!]!)} ${r1(ys[kept[k]!]!)}`;
      const first = kept[0]!;
      const last = kept[kept.length - 1]!;
      line += l;
      area += `${l}L${r1(xs[last]!)} ${r1(baseY)}L${r1(xs[first]!)} ${r1(baseY)}Z`;
    }
    run = [];
  };
  for (let i = 0; i < ys.length; i++) {
    if (ys[i] === null) flush();
    else run.push(i);
  }
  flush();
  return { line, area };
}

export interface GeometryOptions {
  width: number;
  height: number;
  padX: number;
  padTop: number;
  padBottom: number;
  /** Skip tick generation (the thin elevation strip). */
  compact?: boolean;
}

/** Everything the SVG needs to draw one metric over the shared axis; null when the metric has no data. */
export function chartGeometry(series: AnalysisSeries, metric: ChartMetric, opts: GeometryOptions): ChartGeometry | null {
  const values = metricValues(series, metric);
  if (!values || series.n < 2) return null;
  const domain = metricDomain(metric, values);
  if (!domain) return null;
  const plot: PlotRect = {
    left: opts.padX,
    top: opts.padTop,
    width: Math.max(1, opts.width - opts.padX * 2),
    height: Math.max(1, opts.height - opts.padTop - opts.padBottom),
  };
  const isDistance = series.dist !== null;
  const xs: number[] = new Array(series.n);
  const ys: (number | null)[] = new Array(series.n);
  for (let i = 0; i < series.n; i++) {
    xs[i] = xFromIndex(series, i, plot.left, plot.width);
    const v = values[i];
    ys[i] = v === null || v === undefined || !Number.isFinite(v) ? null : yPosition(v, domain, plot.top, plot.height);
  }
  const { line, area } = buildPaths(xs, ys, plot.top + plot.height);
  const axisMax = axisMaxOf(series);
  return {
    plot,
    domain,
    xs,
    ys,
    line,
    area,
    yTicks: opts.compact ? [] : yTicks(metric, domain, 3).map((value) => ({ value, y: yPosition(value, domain, plot.top, plot.height) })),
    xTicks: opts.compact
      ? []
      : axisTicks(axisMax, isDistance, Math.max(2, Math.floor(plot.width / 64))).map((value) => ({
          value,
          x: plot.left + (value / axisMax) * plot.width,
        })),
    isDistance,
  };
}

/** Hard-edged vertical gradient stops painting a heart-rate line by zone: `bounds` are the six bpm bounds of Z1..Z5 and max. */
export function hrGradientStops(bounds: readonly number[], colors: readonly string[], domain: Domain): { offset: number; color: string }[] {
  const span = domain.max - domain.min || 1;
  const offset = (v: number) => clamp((domain.max - v) / span, 0, 1);
  const stops: { offset: number; color: string }[] = [];
  const last = bounds.length - 2;
  for (let zone = last; zone >= 0; zone--) {
    const start = zone === last ? 0 : offset(bounds[zone + 1]!);
    const end = zone === 0 ? 1 : offset(bounds[zone]!);
    const color = colors[zone]!;
    stops.push({ offset: start, color }, { offset: end, color });
  }
  return stops;
}

// --- Readout ---------------------------------------------------------------------------------

export interface Readout {
  index: number;
  /** Axis position: metres into the workout, null without distance. */
  distM: number | null;
  sec: number;
  pace: number | null;
  speedKmh: number | null;
  hr: number | null;
  alt: number | null;
  cad: number | null;
  /** Metres per step: measured, else derived from pace and cadence. */
  stride: number | null;
  power: number | null;
}

const at = (values: readonly (number | null)[] | null, i: number): number | null => {
  const v = values?.[i];
  return v === undefined || v === null || !Number.isFinite(v) ? null : v;
};

export function readoutAt(series: AnalysisSeries, index: number): Readout {
  const i = clamp(Math.round(index), 0, Math.max(0, series.n - 1));
  const pace = at(series.pace, i);
  return {
    index: i,
    distM: series.dist ? (series.dist[i] ?? null) : null,
    sec: i * series.stepSec,
    pace,
    speedKmh: pace !== null && pace > 0 ? 3600 / pace : null,
    hr: at(series.hr, i),
    alt: at(series.alt, i),
    cad: at(series.cad, i),
    stride: stepLengthAt(series, i),
    power: at(series.power, i),
  };
}

// --- Bars ------------------------------------------------------------------------------------

/** Share of the total per entry, 0..1; all zeros when the total is zero. */
export function shares(values: readonly number[]): number[] {
  const total = values.reduce((a, b) => a + Math.max(0, b), 0);
  return values.map((v) => (total > 0 ? Math.max(0, v) / total : 0));
}

const MIN_BAR = 0.3;

/** Bar length 0..1 per split: the fastest fills the bar, the slowest keeps 30 percent; null paces get 0. */
export function paceBarFractions(paces: readonly (number | null)[]): number[] {
  const real = paces.filter((p): p is number => p !== null && p > 0);
  if (real.length === 0) return paces.map(() => 0);
  const fast = Math.min(...real);
  const slow = Math.max(...real);
  return paces.map((p) => {
    if (p === null || p <= 0) return 0;
    if (slow === fast) return 1;
    return MIN_BAR + (1 - MIN_BAR) * ((slow - p) / (slow - fast));
  });
}

/** Index of the smallest positive pace, or -1. */
export function fastestIndex(paces: readonly (number | null)[]): number {
  let best = -1;
  for (let i = 0; i < paces.length; i++) {
    const p = paces[i];
    if (p !== null && p !== undefined && p > 0 && (best === -1 || p < paces[best]!)) best = i;
  }
  return best;
}

export type LoadVerdict = 'under' | 'steady' | 'high' | 'spike';

/** Acute-to-chronic ratio: under 0.8 Under, up to 1.3 Steady, up to 1.5 High, above Spike. */
export function loadVerdict(ratio: number): LoadVerdict {
  if (ratio < 0.8) return 'under';
  if (ratio <= 1.3) return 'steady';
  if (ratio <= 1.5) return 'high';
  return 'spike';
}

/** Two bar lengths 0..1 relative to the larger of the two. */
export function loadBarFractions(acute: number, chronic: number): { acute: number; chronic: number } {
  const top = Math.max(acute, chronic, 0);
  if (top <= 0) return { acute: 0, chronic: 0 };
  return { acute: Math.max(0, acute) / top, chronic: Math.max(0, chronic) / top };
}

export type RankBadge = 'pr' | '2nd' | '3rd';

export function rankBadge(rank: number | null): RankBadge | null {
  if (rank === 1) return 'pr';
  if (rank === 2) return '2nd';
  if (rank === 3) return '3rd';
  return null;
}

export const STRAIN_MAX = 21;

/** Ring fill 0..1 for a strain value. */
export function strainFraction(strain: number): number {
  return clamp(strain / STRAIN_MAX, 0, 1);
}

// --- Splits ----------------------------------------------------------------------------------

/** `3` for a full kilometre, `0.42 km` for a partial split. */
export function splitLabel(split: Pick<AnalysisSplit, 'n' | 'distM'>): string {
  return split.distM >= 999.5 ? String(split.n) : t('common:units.km', { value: fmtDecimal(split.distM / 1000, 2) });
}

/** Sample index where each split ends (nearest sample to the cumulative distance; the last split ends at the last sample). */
export function splitEndIndices(series: AnalysisSeries, splits: readonly AnalysisSplit[]): number[] {
  if (!series.dist) return [];
  let cumulative = 0;
  return splits.map((s, k) => {
    cumulative += s.distM;
    return k === splits.length - 1 ? series.n - 1 : indexAtAxis(series, cumulative);
  });
}

/** The split a sample falls into (the first whose end index is at or after it); -1 for no scrub. */
export function splitAtIndex(ends: readonly number[], index: number | null): number {
  if (index === null || ends.length === 0) return -1;
  const k = ends.findIndex((e) => e >= index);
  return k === -1 ? ends.length - 1 : k;
}

export function speedKmhFromPace(paceSecKm: number | null): number | null {
  return paceSecKm !== null && paceSecKm > 0 ? 3600 / paceSecKm : null;
}

// --- Misc formatting -------------------------------------------------------------------------

/** `8.35` + `km`, or `640` + `m` below a kilometre. */
export function distanceParts(meters: number): { value: string; unit: 'km' | 'm' } {
  return meters >= 1000 ? { value: fmtDecimal(meters / 1000, 2), unit: 'km' } : { value: fmtNumber(Math.round(meters)), unit: 'm' };
}

export function kcalPerHour(kcal: number, elapsedSec: number): number | null {
  return elapsedSec > 0 ? Math.round(kcal / (elapsedSec / 3600)) : null;
}

/** `18 Okt` / `Oct 18`, in the device's local time. */
export function formatShortDate(epochMs: number): string {
  return fmtDate(new Date(epochMs), 'short');
}

/** `+0:17` / `-1:05` for a difference in seconds; `0:00` when equal. */
export function signedDuration(sec: number): string {
  const r = Math.round(sec);
  if (r === 0) return '0:00';
  return `${r > 0 ? '+' : '-'}${formatDuration(Math.abs(r))}`;
}

export function signedNumber(value: number, decimals: number): string {
  const text = fmtDecimal(Math.abs(value), decimals);
  if (Number(Math.abs(value).toFixed(decimals)) === 0) return fmtDecimal(0, decimals);
  return `${value > 0 ? '+' : '-'}${text}`;
}

export function mean(values: readonly (number | null)[]): number | null {
  let sum = 0;
  let count = 0;
  for (const v of values) {
    if (v !== null && Number.isFinite(v)) {
      sum += v;
      count += 1;
    }
  }
  return count > 0 ? sum / count : null;
}

export interface ComparisonAverage {
  distM: number | null;
  sec: number;
  paceSecKm: number | null;
  avgHr: number | null;
}

export function comparisonAverage(items: readonly AnalysisComparisonItem[]): ComparisonAverage | null {
  if (items.length === 0) return null;
  return {
    distM: mean(items.map((i) => i.distM)),
    sec: mean(items.map((i) => i.sec)) ?? 0,
    paceSecKm: mean(items.map((i) => i.paceSecKm)),
    avgHr: mean(items.map((i) => i.avgHr)),
  };
}

/** `current - reference`, null when either is missing. */
export function difference(current: number | null | undefined, reference: number | null | undefined): number | null {
  if (current === null || current === undefined || reference === null || reference === undefined) return null;
  return current - reference;
}

/** Axis label of a y tick: `5:30` for pace, whole numbers otherwise. */
export function formatYTick(metric: ChartMetric, value: number): string {
  if (metric === 'stride') return fmtDecimal(value, 1);
  return metric === 'pace' ? formatPace(value) : String(Math.round(value));
}
