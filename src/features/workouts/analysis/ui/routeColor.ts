/**
 * The route coloured by a metric (heart rate, pace, elevation...): each stretch of the line takes the colour of the value
 * the series has where the stretch starts. Pure, so `bun test` covers it; the map only draws the runs.
 */
import type { RouteDetail } from '../route';
import type { AnalysisSeries, LatLon } from '../types';
import { clamp, finiteSorted, metricValues, percentile, type WorkoutMetric } from './chartMath';

/** The ramp spans the route's 5th to 95th percentile: a sprint or a GPS glitch does not wash the rest out to one colour. */
const LOW_P = 0.05;
const HIGH_P = 0.95;

export interface ColorRun {
  color: string;
  segments: LatLon[][];
}

export interface RouteColoring {
  /** One entry per colour used, low to high, then the stretches without a value (`gapColor`). */
  runs: ColorRun[];
  /** The values at the two ends of the ramp, in the metric's units. For pace `low` is the slow end: the ramp runs slow to fast. */
  low: number;
  high: number;
}

interface Stop {
  pos: LatLon;
  /** Series sample index. */
  i: number;
}

/** The route's positions with their series sample: the full-resolution route when there is one, else the series' own track. */
function stops(series: AnalysisSeries, route: RouteDetail | null): Stop[][] {
  const last = series.n - 1;
  if (route) {
    return route.segments.map((seg, s) => seg.map((pos, j) => ({ pos, i: clamp(Math.round((route.secs[s]?.[j] ?? 0) / series.stepSec), 0, last) })));
  }
  const out: Stop[][] = [];
  let current: Stop[] = [];
  series.track?.forEach((pos, i) => {
    if (pos) current.push({ pos, i });
    else if (current.length > 0) {
      out.push(current);
      current = [];
    }
  });
  if (current.length > 0) out.push(current);
  return out;
}

/**
 * Splits the route into runs of one colour of `ramp` by `metric`. Higher values take the later colours; pace is turned
 * around so the fast end is the hot one, as with speed. A stretch whose start has no value (a gap in the heart rate, a
 * stop for pace) is drawn in `gapColor`. Null when the metric has fewer than two values on the route.
 */
export function routeColoring(
  series: AnalysisSeries,
  route: RouteDetail | null,
  metric: WorkoutMetric,
  ramp: readonly string[],
  gapColor: string,
): RouteColoring | null {
  const values = metricValues(series, metric);
  if (!values || ramp.length === 0) return null;
  const line = stops(series, route);
  const onRoute = finiteSorted(line.flatMap((seg) => seg.map((s) => values[s.i] ?? null)));
  if (onRoute.length < 2) return null;
  const lo = percentile(onRoute, LOW_P);
  const hi = percentile(onRoute, HIGH_P);
  const invert = metric === 'pace';
  const binOf = (v: number | null | undefined): number => {
    if (v === null || v === undefined || !Number.isFinite(v)) return -1;
    const f = hi > lo ? clamp((v - lo) / (hi - lo), 0, 1) : 0.5;
    return Math.min(ramp.length - 1, Math.floor((invert ? 1 - f : f) * ramp.length));
  };

  const byBin = new Map<number, LatLon[][]>();
  for (const seg of line) {
    let run: LatLon[] | null = null;
    let runBin = Number.NaN;
    for (let j = 1; j < seg.length; j++) {
      const bin = binOf(values[seg[j - 1].i]);
      if (run && bin === runBin) {
        run.push(seg[j].pos);
        continue;
      }
      // A new run starts on the last point of the previous one, so the line has no hole where the colour changes.
      run = [seg[j - 1].pos, seg[j].pos];
      runBin = bin;
      const list = byBin.get(bin);
      if (list) list.push(run);
      else byBin.set(bin, [run]);
    }
  }

  const runs = [...byBin.keys()]
    .sort((a, b) => (a < 0 ? 1 : b < 0 ? -1 : a - b))
    .map((bin) => ({ color: bin < 0 ? gapColor : ramp[bin]!, segments: byBin.get(bin)! }));
  return { runs, low: invert ? hi : lo, high: invert ? lo : hi };
}
