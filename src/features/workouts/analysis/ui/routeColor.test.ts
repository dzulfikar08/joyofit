import { describe, expect, it } from 'bun:test';

import type { RouteDetail } from '../route';
import type { AnalysisSeries, LatLon } from '../types';
import { rampColor, routeColoring, type RampOptions } from './routeColor';

/** Four stops cut into four steps: each step is exactly one stop, so the tests can name the colours. */
const RAMP: RampOptions = { stops: ['#000000', '#0000ff', '#00ff00', '#ff0000'], steps: 4, gapColor: 'gap' };
const [C0, , , C3] = RAMP.stops;

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

/** The colour of the stretch that starts at `from`. */
const colorAt = (runs: { color: string; segments: LatLon[][] }[], from: LatLon) =>
  runs.find((r) => r.segments.some((seg) => seg.slice(0, -1).some((p) => p[0] === from[0])))?.color;

describe('rampColor', () => {
  it('is each stop at its place and blends in between', () => {
    const stops = ['#000000', '#ff0000', '#ffffff'];
    expect(rampColor(stops, 0)).toBe('#000000');
    expect(rampColor(stops, 0.5)).toBe('#ff0000');
    expect(rampColor(stops, 1)).toBe('#ffffff');
    expect(rampColor(stops, 0.25)).toBe('#800000');
    expect(rampColor(stops, 2)).toBe('#ffffff');
  });
});

describe('routeColoring', () => {
  it('colours low values with the first colour and high values with the last', () => {
    const out = routeColoring(series([100, 100, 100, 160, 160, 160]), null, 'hr', RAMP)!;
    expect(colorAt(out.runs, [0, 0])).toBe(C0);
    expect(colorAt(out.runs, [0.004, 0])).toBe(C3);
    expect(out.low).toBeLessThan(out.high);
  });

  it('joins a run of one colour into one line, and starts the next where it ends', () => {
    const out = routeColoring(series([100, 100, 100, 100, 160, 160, 160]), null, 'hr', RAMP)!;
    expect(out.runs.find((r) => r.color === C0)!.segments).toEqual([[[0, 0], [0.001, 0], [0.002, 0], [0.003, 0]]]);
    // The stretch from 100 to 160 bpm takes the colour of 130, then the high colour starts where it ends.
    expect(out.runs.find((r) => r.color === C3)!.segments[0]![0]).toEqual([0.004, 0]);
  });

  it('blends a rise through the colours in between instead of jumping', () => {
    const out = routeColoring(series([100, 115, 130, 145, 160]), null, 'hr', RAMP)!;
    expect(new Set(out.runs.map((r) => r.color)).size).toBe(4);
  });

  it('puts the fast end of pace on the hot colours', () => {
    // 4:00 /km is faster than 6:00 /km: it gets the last colour, and the legend reads slow to fast.
    const out = routeColoring(series([null, null, null, null, null, null], [360, 360, 360, 240, 240, 240]), null, 'pace', RAMP)!;
    expect(colorAt(out.runs, [0, 0])).toBe(C0);
    expect(colorAt(out.runs, [0.004, 0])).toBe(C3);
    expect(out.low).toBeGreaterThan(out.high);
  });

  it('draws a stretch without a value at either end in the gap colour, listed last', () => {
    const out = routeColoring(series([120, null, null, null, 150, 150]), null, 'hr', RAMP)!;
    expect(colorAt(out.runs, [0.001, 0])).toBe('gap');
    expect(out.runs.at(-1)!.color).toBe('gap');
  });

  it('does not let one spike stretch the scale', () => {
    const hr = [...Array.from({ length: 40 }, (_, i) => 120 + (i % 2) * 20), 230];
    const out = routeColoring(series(hr), null, 'hr', RAMP)!;
    expect(out.high).toBeLessThan(200);
  });

  it('reads the series between its samples at each full-resolution fix', () => {
    // Fixes every 5 s on a 10 s grid: the fix at 5 s reads halfway between 100 and 160 bpm, not either sample.
    const route: RouteDetail = {
      segments: [[[0, 0], [0.0005, 0], [0.001, 0], [0.0015, 0], [0.002, 0], [0.0025, 0], [0.003, 0]]],
      secs: [[0, 5, 10, 15, 20, 25, 30]],
      kms: [],
    };
    const out = routeColoring(series([100, 160, 160, 160]), route, 'hr', RAMP)!;
    const first = colorAt(out.runs, [0, 0]);
    const second = colorAt(out.runs, [0.0005, 0]);
    expect(first).not.toBe(second);
    expect(colorAt(out.runs, [0.002, 0])).toBe(C3);
  });

  it('is null when the metric has no values on the route', () => {
    expect(routeColoring(series([null, null, null]), null, 'hr', RAMP)).toBeNull();
    expect(routeColoring(series([120, 130]), null, 'power', RAMP)).toBeNull();
  });
});
