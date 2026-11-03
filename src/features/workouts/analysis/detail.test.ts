import { describe, expect, it } from 'bun:test';

import { DEFAULT_HR_ZONE_SETTINGS, resolveHrZones } from '@/features/hrzones/zones';
import { LONG_RIDE_POINTS, longRide } from '@/features/map/longRide.fixture';
import { routePath } from '@/features/map/routeOverlay';
import { boundsOf, fitBounds, lonLatToWorld } from '@/features/map/tileMath';

import { analyzeWorkout, analyzeWorkoutWithDetail, type AnalysisHistory, type AnalyzeInput, type AnalyzeOptions } from './analyze';
import { cleanFixes } from './geo';
import { row, T0, workoutRow } from './fixtures';
import { routeDetail } from './route';
import { buildGrid, detailGridStep, type AnalysisPoint } from './series';
import { ANALYSIS_LIMITS, kmMarkers, trackSegments, type LatLon } from './types';
import { chartGeometry } from './ui/chartMath';

const ZONES = resolveHrZones(DEFAULT_HR_ZONE_SETTINGS, 30);
const ALL: AnalyzeOptions = { includeHr: true, includeRoute: true, includeComparison: true };
const NO_HISTORY: AnalysisHistory = { efforts: [], trimps: [], similar: [] };
/** The server's ceiling on a stored analysis (`ANALYSIS_MAX_BYTES` in JoyoRogo's workout-analysis-schema). */
const ANALYSIS_MAX_BYTES = 200_000;
const SPIKE_AT = 20_000;

const ride = longRide();

/** The 157 km ride as the database holds it: one row per second with position, altitude, heart rate, speed, cadence and power; a 10 s burst of 900 W in the middle. */
const points: AnalysisPoint[] = ride.points.map(([lat, lon], i) =>
  row(T0 + i, {
    lat,
    lon,
    alt: 400 + 80 * Math.sin(i / 3000),
    hr: Math.round(135 + 25 * Math.sin(i / 900)),
    speed: 3.6,
    cadence: 85,
    power: i >= SPIKE_AT && i < SPIKE_AT + 10 ? 900 : 200,
  }),
);
const ELAPSED = LONG_RIDE_POINTS;
const DISTANCE = Math.round(ride.km * 1000);

function input(over: Partial<AnalyzeInput> = {}, pts: readonly AnalysisPoint[] = points, elapsed = ELAPSED, distance = DISTANCE): AnalyzeInput {
  return {
    workout: workoutRow({ end: T0 + elapsed, sportName: 'Outdoor Cycling', duration: elapsed, distance }),
    summary: {},
    points: pts,
    zones: ZONES,
    daySamples: [],
    history: NO_HISTORY,
    ...over,
  };
}

const long = analyzeWorkoutWithDetail(input(), ALL);

describe('detailGridStep', () => {
  it('is null while the shared grid is already as fine as one point per 12 s', () => {
    expect(detailGridStep(30)).toBeNull();
    expect(detailGridStep(3600)).toBeNull();
    expect(detailGridStep(7200)).toBeNull();
  });

  it('is 12 s for a long workout and widens only past the 4 000-point cap', () => {
    expect(detailGridStep(7201)).toBe(12);
    expect(detailGridStep(ELAPSED)).toBe(12);
    expect(detailGridStep(48_000)).toBe(12);
    expect(detailGridStep(50_400)).toBe(13);
    expect(detailGridStep(86_400)).toBe(22);
  });
});

describe('the 157 km ride', () => {
  it('is the ride of the screenshot: 44 100 s, about 157 km', () => {
    expect(ride.points.length).toBe(44_100);
    expect(ride.km).toBeGreaterThan(150);
    expect(ride.km).toBeLessThan(175);
  });

  it('keeps the analysis the cloud and the posts carry exactly what analyzeWorkout returns, inside the server limits', () => {
    const plain = analyzeWorkout(input(), ALL);
    expect(long.analysis).toEqual(plain);
    const series = plain.series!;
    expect(series.stepSec).toBe(74);
    expect(series.n).toBeLessThanOrEqual(ANALYSIS_LIMITS.samples);
    expect(JSON.stringify(plain).length).toBeLessThan(ANALYSIS_MAX_BYTES);
  });

  it('draws the map from every fix, not from the 600-sample grid', () => {
    const coarse = long.analysis.series!.track!.filter((p) => p !== null).length;
    const route = long.detail.route!;
    const drawn = route.segments.reduce((sum, seg) => sum + seg.length, 0);
    expect(coarse).toBeLessThanOrEqual(601);
    expect(drawn).toBeGreaterThan(40_000);
    expect(route.segments.length).toBe(1);
    expect(route.segments[0]![0]).toEqual(ride.points[0]!);
    expect(route.segments[0]!.at(-1)).toEqual(ride.points.at(-1)!);
  });

  it('follows the road where the grid cuts its corners', () => {
    const route = long.detail.route!;
    const coarseSegs = trackSegments(long.analysis.series!.track!);
    const fit = fitBounds(boundsOf(route.segments)!, 330, 260, 48);
    // Zoomed in to about 5 m per pixel the bends are visible: the full route keeps them, the 74 s grid has straightened them.
    const zoom = fit.zoom + 6;
    const mid = ride.points[Math.floor(ride.points.length / 4)]!;
    const c = lonLatToWorld(mid[0], mid[1], zoom);
    const vertices = (segs: readonly (readonly LatLon[])[]) => segs.reduce((n, seg) => n + ((routePath(seg, zoom, c.x - 165, c.y - 130) ?? '').split(/[ML]/).length - 1), 0);
    expect(vertices(route.segments)).toBeGreaterThan(vertices(coarseSegs) * 2);
  });

  it('puts a km pill on the line at every kilometre of the watch distance', () => {
    const { kms, segments } = long.detail.route!;
    expect(kms.length).toBeGreaterThanOrEqual(Math.floor(DISTANCE / 1000) - 1);
    expect(kms.length).toBeLessThanOrEqual(Math.floor(DISTANCE / 1000));
    expect(kms.map((k) => k.km)).toEqual(kms.map((_, i) => i + 1));
    const line = segments[0]!;
    // Planar distance in metres around the route's latitude; the fixes are about 3.6 m apart, so a pill on the line is within a few metres of a fix.
    const mPerDegLon = 111_195 * Math.cos((-7.2 * Math.PI) / 180);
    for (const k of [kms[0]!, kms[37]!, kms[100]!, kms.at(-1)!]) {
      let best = Infinity;
      for (const p of line) best = Math.min(best, Math.hypot((p[0] - k.pos[0]) * 111_195, (p[1] - k.pos[1]) * mPerDegLon));
      expect(best).toBeLessThan(4);
    }
  });

  it('places the pills where the grid places them, to within a grid step of the line', () => {
    const grid = kmMarkers(long.analysis.series!);
    const detail = long.detail.route!.kms;
    expect(Math.abs(grid.length - detail.length)).toBeLessThanOrEqual(1);
    for (const g of grid.slice(0, 20)) {
      const d = detail.find((k) => k.km === g.km)!;
      // 74 s at 3.6 m/s is 266 m of line per grid step.
      expect(Math.hypot((g.pos[0] - d.pos[0]) * 111_195, (g.pos[1] - d.pos[1]) * 111_195)).toBeLessThan(300);
    }
  });

  it('charts on a point every 12 s with the same distance, so a burst is not averaged away', () => {
    const fine = long.detail.series!;
    const coarse = long.analysis.series!;
    expect(fine.stepSec).toBe(12);
    expect(fine.n).toBe(Math.ceil(ELAPSED / 12) + 1);
    expect(fine.n).toBeLessThanOrEqual(4001);
    expect(fine.dist!.at(-1)).toBe(coarse.dist!.at(-1));
    for (let i = 1; i < fine.n; i++) expect(fine.dist![i]!).toBeGreaterThanOrEqual(fine.dist![i - 1]!);
    const peak = (values: readonly (number | null)[]) => Math.max(...values.map((v) => v ?? 0));
    // 10 s at 900 W among 200 W: a 74 s mean cannot rise above about 295 W, a 12 s one reaches 700+.
    expect(peak(coarse.power!)).toBeLessThan(310);
    expect(peak(fine.power!)).toBeGreaterThan(700);
  });

  it('has no more than one chart sample per 12 s and a pixel-sized path', () => {
    const fine = long.detail.series!;
    const geo = chartGeometry(fine, 'hr', { width: 340, height: 176, padX: 6, padTop: 8, padBottom: 20 })!;
    const vertices = geo.line.split(/[ML]/).length - 1;
    expect(fine.n).toBeGreaterThan(3000);
    // At most four samples per pixel column are drawn, whatever the grid.
    expect(vertices).toBeLessThan(4 * 340);
  });

  it('costs one extra grid, not a second analysis', () => {
    const t0 = performance.now();
    analyzeWorkoutWithDetail(input(), ALL);
    const withDetail = performance.now() - t0;
    expect(withDetail).toBeLessThan(5000);
  });
});

describe('shorter workouts and privacy', () => {
  const hour = points.slice(0, 3600);
  const short = analyzeWorkoutWithDetail(input({}, hour, 3599, 12_000), ALL);

  it('keep the shared grid for the charts (6 s is finer than 12 s) and still draw every fix', () => {
    expect(short.detail.series).toBeNull();
    expect(short.analysis.series!.stepSec).toBe(6);
    expect(short.detail.route!.segments[0]!.length).toBeGreaterThan(3000);
  });

  it('leave the route out when the post may not show one', () => {
    const noRoute = analyzeWorkoutWithDetail(input({}, hour, 3599, 12_000), { ...ALL, includeRoute: false });
    expect(noRoute.detail.route).toBeNull();
    expect(noRoute.analysis.series!.track).toBeNull();
    expect(analyzeWorkoutWithDetail(input(), { ...ALL, includeRoute: false }).detail.series!.track).toBeNull();
  });

  it('give no route for a workout without GPS', () => {
    const indoor = hour.map((p) => ({ ...p, lat: null, lon: null }));
    const out = analyzeWorkoutWithDetail(input({}, indoor, 3599, 12_000), ALL);
    expect(out.detail.route).toBeNull();
  });
});

describe('routeDetail', () => {
  const M_PER_DEG = (6_371_000 * Math.PI) / 180;
  const north = (metres: number) => -6.2 + metres / M_PER_DEG;

  it('puts a pill where the path crosses each kilometre and none past the end', () => {
    const fixes = cleanFixes(
      Array.from({ length: 601 }, (_, i) => row(T0 + i, { lat: north(i * 5), lon: 106.8 })),
      'ride',
    );
    const out = routeDetail(fixes, null, T0)!;
    expect(out.kms.map((k) => k.km)).toEqual([1, 2, 3]);
    expect(out.kms[1]!.pos[0]).toBeCloseTo(north(2000), 6);
  });

  it('scales the kilometres to the watch distance, with metres before the first fix', () => {
    const fixes = cleanFixes(
      Array.from({ length: 601 }, (_, i) => row(T0 + 100 + i, { lat: north(i * 5), lon: 106.8 })),
      'ride',
    );
    // 700 s elapsed, the first fix at 100 s, 3 000 m of fixes; the watch says 3 500 m, so the 100 s before the first fix were 500 m.
    const grid = buildGrid({ start: T0, end: T0 + 700, duration: 700, distance: 3500, kind: 'ride', points: fixes.map((f) => row(f.ts, { lat: f.lat, lon: f.lon })) });
    const out = routeDetail(grid.fixes, grid.watch, T0)!;
    expect(out.kms.map((k) => k.km)).toEqual([1, 2, 3]);
    // The watch counted 500 m before the first fix, so km 1 is 500 m into the fixes.
    expect(out.kms[0]!.pos[0]).toBeCloseTo(north(500), 5);
  });

  it('splits the line where the recording jumped and puts no interpolated pill across the gap', () => {
    const fixes = cleanFixes(
      [
        row(T0, { lat: north(0), lon: 106.8 }),
        row(T0 + 10, { lat: north(50), lon: 106.8 }),
        // 120 s later and 2 km on: reachable at 30 m/s, but too far apart in both time and distance to join.
        row(T0 + 130, { lat: north(2050), lon: 106.8 }),
        row(T0 + 140, { lat: north(2100), lon: 106.8 }),
      ],
      'ride',
    );
    const out = routeDetail(fixes, null, T0)!;
    expect(out.segments.map((s) => s.length)).toEqual([2, 2]);
    // Each position keeps its time on the series axis, split the same way as the line.
    expect(out.secs).toEqual([[0, 10], [130, 140]]);
    expect(out.kms.map((k) => k.km)).toEqual([1, 2]);
    // Both kilometres are crossed inside the gap: they are shown at the fix that ended it, not on the empty ground in between.
    for (const k of out.kms) expect(k.pos[0]).toBeCloseTo(north(2050), 6);
  });

  it('is null with fewer than two fixes', () => {
    expect(routeDetail([], null, T0)).toBeNull();
    expect(routeDetail([{ ts: T0, lat: -6.2, lon: 106.8, dist: 0 }], null, T0)).toBeNull();
  });
});
