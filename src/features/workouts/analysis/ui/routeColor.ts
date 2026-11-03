/**
 * The route coloured by a metric (heart rate, pace, elevation...). Each fix reads the series at its own time (interpolated
 * between the two samples around it, so a 12 s grid does not step), each stretch between two fixes takes the colour of the
 * mean of its ends, and the colour comes from a smooth ramp cut into many fine steps, so the line fades from one colour into
 * the next instead of jumping between a few bands. Pure, so `bun test` covers it; the map only draws the runs.
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

export interface RampOptions {
  /** `#rrggbb` colours, low to high, evenly spaced along the ramp. */
  stops: readonly string[];
  /** How many colours the ramp is cut into: the first is `stops[0]`, the last the last stop, the rest blend in between. */
  steps: number;
  /** The colour of a stretch without a value. */
  gapColor: string;
}

const hex2 = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');

/** The colour at `f` (0..1) along evenly spaced `#rrggbb` stops, blended in RGB. */
export function rampColor(stops: readonly string[], f: number): string {
  if (stops.length === 0) return '#000000';
  const pos = clamp(f, 0, 1) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(pos));
  if (i < 0) return stops[0]!;
  const t = pos - i;
  const a = stops[i]!;
  const b = stops[i + 1]!;
  const channel = (k: number) => {
    const x = parseInt(a.slice(1 + 2 * k, 3 + 2 * k), 16);
    const y = parseInt(b.slice(1 + 2 * k, 3 + 2 * k), 16);
    return hex2(x + (y - x) * t);
  };
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

interface Stop {
  pos: LatLon;
  /** Position on the series axis, in samples (fractional between two samples). */
  at: number;
}

/** The route's positions with their place on the series: the full-resolution route when there is one, else the series' own track. */
function stopsOf(series: AnalysisSeries, route: RouteDetail | null): Stop[][] {
  const last = series.n - 1;
  if (route) {
    return route.segments.map((seg, s) => seg.map((pos, j) => ({ pos, at: clamp((route.secs[s]?.[j] ?? 0) / series.stepSec, 0, last) })));
  }
  const out: Stop[][] = [];
  let current: Stop[] = [];
  series.track?.forEach((pos, i) => {
    if (pos) current.push({ pos, at: i });
    else if (current.length > 0) {
      out.push(current);
      current = [];
    }
  });
  if (current.length > 0) out.push(current);
  return out;
}

/** The value at a fractional sample: linear between the two samples around it, the one that exists when the other is a gap. */
function valueAt(values: readonly (number | null)[], at: number): number | null {
  const i = Math.floor(at);
  const a = values[i] ?? null;
  const b = values[Math.min(values.length - 1, i + 1)] ?? null;
  if (a === null || !Number.isFinite(a)) return b !== null && Number.isFinite(b) && at - i >= 0.5 ? b : null;
  if (b === null || !Number.isFinite(b)) return at - i < 0.5 ? a : null;
  return a + (b - a) * (at - i);
}

/**
 * Splits the route into runs of one colour by `metric`. Higher values take the later colours; pace is turned around so the
 * fast end is the hot one, as with speed. A stretch with no value at either end (a gap in the heart rate, a stop for pace)
 * is drawn in `gapColor`. Null when the metric has fewer than two values on the route.
 */
export function routeColoring(series: AnalysisSeries, route: RouteDetail | null, metric: WorkoutMetric, ramp: RampOptions): RouteColoring | null {
  const values = metricValues(series, metric);
  const steps = Math.max(1, Math.round(ramp.steps));
  if (!values || ramp.stops.length === 0) return null;
  const line = stopsOf(series, route).map((seg) => seg.map((s) => ({ pos: s.pos, v: valueAt(values, s.at) })));
  const onRoute = finiteSorted(line.flatMap((seg) => seg.map((s) => s.v)));
  if (onRoute.length < 2) return null;
  const lo = percentile(onRoute, LOW_P);
  const hi = percentile(onRoute, HIGH_P);
  const invert = metric === 'pace';
  const binOf = (a: number | null, b: number | null): number => {
    const v = a !== null && b !== null ? (a + b) / 2 : (a ?? b);
    if (v === null) return -1;
    const f = hi > lo ? clamp((v - lo) / (hi - lo), 0, 1) : 0.5;
    return Math.min(steps - 1, Math.floor((invert ? 1 - f : f) * steps));
  };

  const byBin = new Map<number, LatLon[][]>();
  for (const seg of line) {
    let run: LatLon[] | null = null;
    let runBin = Number.NaN;
    for (let j = 1; j < seg.length; j++) {
      const bin = binOf(seg[j - 1].v, seg[j].v);
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

  const colorOf = (bin: number) => (bin < 0 ? ramp.gapColor : rampColor(ramp.stops, steps > 1 ? bin / (steps - 1) : 0.5));
  const runs = [...byBin.keys()]
    .sort((a, b) => (a < 0 ? 1 : b < 0 ? -1 : a - b))
    .map((bin) => ({ color: colorOf(bin), segments: byBin.get(bin)! }));
  return { runs, low: invert ? hi : lo, high: invert ? lo : hi };
}
