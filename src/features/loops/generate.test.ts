import { describe, expect, test } from 'bun:test';

import type { LatLon } from '@/features/routes/map/geometry';
import { RequestError, isAborted } from '@/features/routes/map/http';
import type { ViaRoute } from '@/features/routes/map/routingClient';
import { rejectionOf } from '@/features/routes/map/testSupport';
import { haversineM } from '@/features/routes/routeModel';

import {
  candidateScore,
  DEFAULT_COUNT,
  EXTRA_TRIES,
  FALLBACK_TOLERANCE,
  generateLoops,
  LoopError,
  MAX_ATTEMPTS,
  rankCandidates,
  ringWaypoints,
  shapeFor,
  TOLERANCE,
  type LoopCandidate,
  type LoopRouter,
} from './generate';
import { destination, pathLengthM, resampleLine } from './geo';
import { createPaintedIndex } from './painted';

const HOME: LatLon = { lat: -6.2088, lon: 106.8456 };

/**
 * A routing service that follows roads 25% longer than the straight way: each leg bends through a point beside its middle.
 * `snap` is how far it says it had to move every waypoint to reach a road.
 */
function bendyRouter(options: { snap?: number; calls?: LatLon[][] } = {}): LoopRouter {
  return async (waypoints) => {
    options.calls?.push([...waypoints]);
    const line: LatLon[] = [waypoints[0]];
    for (let i = 1; i < waypoints.length; i++) {
      const a = waypoints[i - 1];
      const b = waypoints[i];
      const mid = { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
      const leg = haversineM(a, b);
      const bearing = (Math.atan2(b.lon - a.lon, b.lat - a.lat) * 180) / Math.PI;
      line.push(destination(mid, bearing + 90, leg * 0.35), b);
    }
    return { line, snapM: waypoints.map(() => options.snap ?? 4) } satisfies ViaRoute;
  };
}

const candidate = (id: string, over: Partial<LoopCandidate>): LoopCandidate => ({
  id,
  line: [],
  lengthM: 7000,
  newShare: 0.5,
  repeatShare: 0,
  lengthError: 0,
  ...over,
});

describe('ringWaypoints', () => {
  test('goes from the start through the ring and back to the start', () => {
    const shape = shapeFor(42, 90);
    const points = ringWaypoints(HOME, 5000, shape);
    expect(points).toHaveLength(shape.waypoints + 2);
    expect(points[0]).toEqual(HOME);
    expect(points[points.length - 1]).toEqual(HOME);
    // The ring is 5 km round: its diameter is 1.6 km, so no waypoint is further than that (plus the jitter) from the start.
    for (const p of points.slice(1, -1)) expect(haversineM(HOME, p)).toBeLessThan(2000);
  });

  test('a bigger ring is a bigger loop', () => {
    const shape = shapeFor(42, 200);
    const small = ringWaypoints(HOME, 3000, shape);
    const big = ringWaypoints(HOME, 6000, shape);
    expect(pathLengthM(big)).toBeGreaterThan(pathLengthM(small) * 1.9);
  });

  test('the same seed gives the same shape', () => {
    expect(shapeFor(7, 10)).toEqual(shapeFor(7, 10));
    expect(shapeFor(7, 10)).not.toEqual(shapeFor(8, 10));
  });
});

describe('generateLoops', () => {
  const base = { start: HOME, targetM: 7000, painted: null, seed: 1234 } as const;

  test('rescales the ring until the routed length is within 5% of the target', async () => {
    // A first guess far too small: the batch has to correct it.
    const { candidates } = await generateLoops({ ...base, router: bendyRouter(), ratio: 2 });
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    for (const c of candidates.filter((c) => Math.abs(c.lengthError) <= TOLERANCE)) {
      expect(Math.abs(c.lengthM - 7000) / 7000).toBeLessThanOrEqual(TOLERANCE);
    }
    expect(candidates[0].lengthError).toBeGreaterThan(-TOLERANCE);
    expect(candidates[0].lengthError).toBeLessThan(TOLERANCE);
  });

  test('learns how long a routed loop is compared with its ring and hands that on', async () => {
    const first = await generateLoops({ ...base, router: bendyRouter() });
    const calls: LatLon[][] = [];
    await generateLoops({ ...base, seed: 99, router: bendyRouter({ calls }), ratio: first.ratio });
    expect(first.ratio).toBeGreaterThan(0.9);
    expect(first.ratio).toBeLessThan(1.6);
    // With the learned ratio most loops need one request, not three.
    expect(calls.length).toBeLessThan(DEFAULT_COUNT * MAX_ATTEMPTS);
  });

  test('the loop is closed on the exact start', async () => {
    const { candidates } = await generateLoops({ ...base, router: bendyRouter() });
    for (const c of candidates) {
      expect(c.line[0]).toEqual(HOME);
      expect(c.line[c.line.length - 1]).toEqual(HOME);
    }
  });

  test('different seeds give different loops, the same seed the same loops', async () => {
    const a = await generateLoops({ ...base, router: bendyRouter() });
    const b = await generateLoops({ ...base, router: bendyRouter() });
    const c = await generateLoops({ ...base, seed: 4321, router: bendyRouter() });
    expect(b.candidates.map((x) => x.id)).toEqual(a.candidates.map((x) => x.id));
    expect(b.candidates[0].line).toEqual(a.candidates[0].line);
    expect(c.candidates[0].id).not.toBe(a.candidates[0].id);
    // Within a batch the loops head in different directions.
    const ends = a.candidates.map((x) => x.line[Math.floor(x.line.length / 4)]);
    expect(new Set(ends.map((p) => p.lat.toFixed(3))).size).toBeGreaterThan(1);
  });

  test('the loop that is least on painted streets comes first', async () => {
    const plain = await generateLoops({ ...base, router: bendyRouter() });
    const onTarget = plain.candidates.filter((c) => Math.abs(c.lengthError) <= TOLERANCE);
    expect(onTarget.length).toBeGreaterThanOrEqual(2);
    // The person has walked the first loop of the plain batch many times.
    const painted = createPaintedIndex(HOME.lat);
    painted.addTrack(resampleLine(onTarget[0].line, 8));
    const again = await generateLoops({ ...base, router: bendyRouter(), painted });
    const walked = again.candidates.find((c) => c.id === onTarget[0].id);
    expect(walked?.newShare).toBeLessThan(0.1);
    expect(again.candidates[0].id).not.toBe(onTarget[0].id);
    expect(again.candidates[0].newShare).toBeGreaterThan(0.5);
    expect(again.candidates.indexOf(walked as LoopCandidate)).toBeGreaterThan(0);
  });

  test('without history the novelty is unknown, never made up', async () => {
    const { candidates } = await generateLoops({ ...base, router: bendyRouter() });
    expect(candidates.every((c) => c.newShare === null)).toBe(true);
  });

  test('reports which loop it is on', async () => {
    const seen: [number, number][] = [];
    await generateLoops({ ...base, router: bendyRouter(), onProgress: (i, n) => seen.push([i, n]) });
    expect(seen[0]).toEqual([1, DEFAULT_COUNT]);
    expect(seen.length).toBeGreaterThanOrEqual(DEFAULT_COUNT);
    expect(seen.length).toBeLessThanOrEqual(DEFAULT_COUNT + EXTRA_TRIES);
  });

  test('keeps trying a little longer when too few loops came out', async () => {
    let calls = 0;
    // Only the very first request of the batch fails to route; the rest work.
    const flaky: LoopRouter = async (waypoints, signal) => {
      calls++;
      if (calls <= MAX_ATTEMPTS) throw new RequestError('code', 'NoRoute');
      return bendyRouter()(waypoints, signal);
    };
    const { candidates } = await generateLoops({ ...base, router: flaky });
    expect(candidates.length).toBeGreaterThanOrEqual(2);
  });

  test('a loop that is too far from the target is not offered, one a little off is, after the good ones', async () => {
    // A service whose loops are always 8% long: offered only as a near miss.
    const long: LoopRouter = async (waypoints, signal) => {
      const routed = await bendyRouter()(waypoints, signal);
      const length = pathLengthM(routed.line);
      const stretch = (7000 * 1.08) / length;
      return { ...routed, line: routed.line.map((p) => ({ lat: HOME.lat + (p.lat - HOME.lat) * stretch, lon: HOME.lon + (p.lon - HOME.lon) * stretch })) };
    };
    const { candidates } = await generateLoops({ ...base, router: long, ratio: 1.22 });
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(Math.abs(c.lengthError)).toBeLessThanOrEqual(FALLBACK_TOLERANCE);
      expect(Math.abs(c.lengthError)).toBeGreaterThan(TOLERANCE);
    }
  });

  test('says there is no street when the start is far from every road', async () => {
    const error = await rejectionOf(generateLoops({ ...base, router: bendyRouter({ snap: 800 }) }));
    expect(error).toBeInstanceOf(LoopError);
    expect((error as LoopError).kind).toBe('no_road');
  });

  test('says no loop when every waypoint lands far from a road', async () => {
    const router = bendyRouter();
    const wild: LoopRouter = async (w, s) => {
      const routed = await router(w, s);
      return { ...routed, snapM: [5, ...w.slice(1).map(() => 400)] };
    };
    const error = await rejectionOf(generateLoops({ ...base, router: wild }));
    expect((error as LoopError).kind).toBe('no_loop');
  });

  test('says network when every request fails, and keeps the cause', async () => {
    const down: LoopRouter = async () => {
      throw new RequestError('network', 'offline');
    };
    const error = await rejectionOf(generateLoops({ ...base, router: down }));
    expect((error as LoopError).kind).toBe('network');
    expect((error as LoopError).cause).toBeInstanceOf(RequestError);
  });

  test('an abort ends the batch with the abort, not with a failure', async () => {
    const controller = new AbortController();
    const stopping: LoopRouter = async () => {
      controller.abort();
      throw new RequestError('aborted', 'aborted');
    };
    const error = await rejectionOf(generateLoops({ ...base, router: stopping, signal: controller.signal }));
    expect(isAborted(error)).toBe(true);
  });
});

describe('ranking', () => {
  test('on-target loops go before near misses, whatever their novelty', () => {
    const ranked = rankCandidates([
      candidate('near-miss', { newShare: 1, lengthError: 0.08 }),
      candidate('good', { newShare: 0.4, lengthError: 0.01 }),
    ]);
    expect(ranked.map((c) => c.id)).toEqual(['good', 'near-miss']);
  });

  test('inside a group the newest streets win, repeats cost, and a tie goes to the closer length', () => {
    const ranked = rankCandidates([
      candidate('old', { newShare: 0.3 }),
      candidate('retrace', { newShare: 0.95, repeatShare: 0.3 }),
      candidate('fresh', { newShare: 0.9 }),
      candidate('fresh-off', { newShare: 0.9, lengthError: 0.04 }),
    ]);
    expect(ranked.map((c) => c.id)).toEqual(['fresh', 'fresh-off', 'retrace', 'old']);
    expect(candidateScore(candidate('x', { newShare: null }))).toBe(0.5);
  });
});
