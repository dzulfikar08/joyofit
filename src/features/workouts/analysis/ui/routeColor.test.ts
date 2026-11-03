import { describe, expect, it } from 'bun:test';

import type { RouteDetail } from '../route';
import type { AnalysisSeries, LatLon } from '../types';
import { routeColoring } from './routeColor';

const RAMP = ['c0', 'c1', 'c2', 'c3'];
const GAP = 'gap';

/** A straight line north, one position per sample, with the given heart rate and pace. */
function series(hr: (number | null)[], pace: (number | null)[] | null = null): AnalysisSeries {
  const n = hr.length;
  return {
    stepSec: 10,
    n,
    dist: null,
    hr,
    pace,
    alt: null,
    cad: null,
    power: null,
    track: Array.from({ length: n }, (_, i): LatLon => [i / 1000, 0]),
  };
}

const colorAt = (runs: { color: string; segments: LatLon[][] }[], from: LatLon) =>
  runs.find((r) => r.segments.some((seg) => seg[0]![0] === from[0]))?.color;

describe('routeColoring', () => {
  it('colours low values with the first colours and high values with the last', () => {
    const out = routeColoring(series([100, 100, 130, 160, 160]), null, 'hr', RAMP, GAP)!;
    expect(colorAt(out.runs, [0, 0])).toBe('c0');
    expect(colorAt(out.runs, [0.003, 0])).toBe('c3');
    expect(out.low).toBeLessThan(out.high);
  });

  it('joins a run of one colour into one line, and starts the next where it ends', () => {
    const out = routeColoring(series([100, 100, 100, 160, 160, 160]), null, 'hr', RAMP, GAP)!;
    const low = out.runs.find((r) => r.color === 'c0')!;
    const high = out.runs.find((r) => r.color === 'c3')!;
    expect(low.segments).toEqual([[[0, 0], [0.001, 0], [0.002, 0], [0.003, 0]]]);
    expect(high.segments[0]![0]).toEqual([0.003, 0]);
  });

  it('puts the fast end of pace on the hot colours', () => {
    // 4:00 /km is faster than 6:00 /km: it gets the last colour, and the legend reads slow to fast.
    const out = routeColoring(series([null, null, null, null], [360, 360, 240, 240]), null, 'pace', RAMP, GAP)!;
    expect(colorAt(out.runs, [0, 0])).toBe('c0');
    expect(colorAt(out.runs, [0.002, 0])).toBe('c3');
    expect(out.low).toBeGreaterThan(out.high);
  });

  it('draws a stretch without a value in the gap colour, listed last', () => {
    const out = routeColoring(series([120, null, null, 150, 150]), null, 'hr', RAMP, GAP)!;
    expect(colorAt(out.runs, [0.001, 0])).toBe(GAP);
    expect(out.runs.at(-1)!.color).toBe(GAP);
  });

  it('does not let one spike stretch the scale', () => {
    const hr = [...Array.from({ length: 40 }, (_, i) => 120 + (i % 2) * 20), 230];
    const out = routeColoring(series(hr), null, 'hr', RAMP, GAP)!;
    expect(out.high).toBeLessThan(200);
    expect(colorAt(out.runs, [0.001, 0])).toBe('c3');
  });

  it('finds the sample of each full-resolution fix by its time', () => {
    // Fixes every 5 s on a 10 s grid: each reads its nearest sample, so the fix at 15 s already reads sample 2 (160 bpm).
    const route: RouteDetail = {
      segments: [[[0, 0], [0.0005, 0], [0.001, 0], [0.0015, 0], [0.002, 0], [0.0025, 0]]],
      secs: [[0, 5, 10, 15, 20, 25]],
      kms: [],
    };
    const out = routeColoring(series([100, 100, 160, 160]), route, 'hr', RAMP, GAP)!;
    expect(colorAt(out.runs, [0, 0])).toBe('c0');
    expect(colorAt(out.runs, [0.0015, 0])).toBe('c3');
  });

  it('is null when the metric has no values on the route', () => {
    expect(routeColoring(series([null, null, null]), null, 'hr', RAMP, GAP)).toBeNull();
    expect(routeColoring({ ...series([120, 130]), power: null }, null, 'power', RAMP, GAP)).toBeNull();
  });
});
