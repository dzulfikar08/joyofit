import { describe, expect, test } from 'bun:test';

import { buildRouteIndex } from '@/features/bikecomputer/nav/routeIndex';
import { at, polyline } from '@/features/bikecomputer/nav/testRoutes';

import { NavEngine, type NavFix } from './engine';
import { navRouteFromGeometry } from './maneuvers';
import { buildMapFrame, headingDelta, lineHeadingDeg, planarHeading, pointAtM, toPlanar } from './mapview';
import { MessageEncoder, decodeWatchMessage, type PhoneMessage } from './messages';

// East 1000 m, then right (south) 1000 m, then left (east) 500 m.
const ROUTE = polyline([[0, 0], [1000, 0], [1000, -1000], [1500, -1000]], 10);
const index = buildRouteIndex(ROUTE);

const pairs = (p: number[]) => p.reduce<[number, number][]>((out, v, i) => (i % 2 ? out : [...out, [v, p[i + 1]!]]), []);

describe('mapview geometry', () => {
  test('headings: north 0, east 90, south 180; delta wraps', () => {
    expect(planarHeading({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(0);
    expect(planarHeading({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(90);
    expect(planarHeading({ x: 0, y: 0 }, { x: 0, y: -10 })).toBeCloseTo(180);
    expect(planarHeading({ x: 0, y: 0 }, { x: 0.2, y: 0.2 })).toBeNull();
    expect(headingDelta(350, 10)).toBe(20);
    expect(lineHeadingDeg(index, 500)!).toBeCloseTo(90, 0);
    expect(lineHeadingDeg(index, 1500)!).toBeCloseTo(180, 0);
  });

  test('pointAtM interpolates along the line', () => {
    const start = pointAtM(index, 0);
    const p = pointAtM(index, 500);
    expect(p.x - start.x).toBeCloseTo(500, -1);
    expect(p.y - start.y).toBeCloseTo(0, 0);
  });

  test('heading east: the route ahead points up (+y), the right turn bends to the right (+x)', () => {
    const pos = pointAtM(index, 900);
    const frame = buildMapFrame(index, pos, 90, 900, 1000, { r: 200, maxPoints: 45 });
    const pts = pairs(frame.p);
    // Ahead of the wearer up to the corner at 100 m: x ~ 0, y grows.
    expect(pts.some(([x, y]) => Math.abs(x) <= 2 && y >= 95 && y <= 105)).toBe(true);
    // After the corner the line heads south in the world = to the right on screen.
    expect(pts.some(([x, y]) => x >= 150 && Math.abs(y - 100) <= 3)).toBe(true);
    // The maneuver (the corner) sits 100 m ahead.
    expect(frame.tx).toBeCloseTo(0, -1);
    expect(frame.ty).toBeCloseTo(100, -1);
  });

  test('stays within the box and the point budget, and its message fits in 1000 bytes', () => {
    const zigzag = polyline(Array.from({ length: 200 }, (_, i) => [i * 20, i % 2 ? 15 : -15] as [number, number]), 5);
    const z = buildRouteIndex(zigzag);
    const frame = buildMapFrame(z, pointAtM(z, 1000), 85, 1000, null, { r: 450, maxPoints: 45 });
    expect(frame.p.length / 2).toBeLessThanOrEqual(45);
    expect(frame.p.length / 2).toBeGreaterThan(2);
    for (const [x, y] of pairs(frame.p)) expect(Math.max(Math.abs(x), Math.abs(y))).toBeLessThanOrEqual(450 * 1.6 + 450);
    const { bytes } = new MessageEncoder().encode(frame);
    expect(bytes).toBeLessThanOrEqual(1000);
  });

  test('a wearer far from the route gets an empty line', () => {
    const far = toPlanar(index, at(-5000, 5000).lat, at(-5000, 5000).lon);
    const frame = buildMapFrame(index, far, 0, 0, null, { r: 200, maxPoints: 45 });
    expect(frame.p).toEqual([]);
    expect(frame.tx).toBeUndefined();
  });
});

describe('view and map messages', () => {
  test('decode view', () => {
    expect(decodeWatchMessage('{"v":1,"t":"view","n":3,"mode":"map"}')).toEqual({ t: 'view', n: 3, mode: 'map' });
    expect(decodeWatchMessage('{"v":1,"t":"view","n":3,"mode":"globe"}')).toBeNull();
  });

  test('map coordinates are whole and clamped', () => {
    const { json } = new MessageEncoder().encode({ t: 'map', r: 200.4, p: [1.6, -2.4, 1e9, -1e9], tx: 3.5, ty: -0.4 });
    expect(JSON.parse(json)).toEqual({ v: 1, t: 'map', n: 1, r: 200, p: [2, -2, 99999, -99999], tx: 4, ty: 0 });
  });
});

describe('NavEngine map frames', () => {
  const route = navRouteFromGeometry(ROUTE);
  const fix = (ts: number, x: number, y: number, speed = 2): NavFix => {
    const p = at(x, y);
    return { ts, lat: p.lat, lon: p.lon, speedMps: speed, accuracy: 5 };
  };
  const maps = (ms: PhoneMessage[]) => ms.filter((m) => m.t === 'map');

  test('no frames until the watch shows the map; then at once, throttled while walking, off again on `view turn`', () => {
    const e = new NavEngine(route, { dest: 'X', defaultSpeedMps: 1.4 });
    e.begin(0);
    let t = 1000;
    for (let x = 0; x <= 20; x += 2, t += 1000) expect(maps(e.update(fix(t, x, 0), t))).toEqual([]);
    const first = e.watch({ t: 'view', n: 1, mode: 'map' }, t);
    expect(types(first)).toEqual(['map']);
    // 2 m/s walking, radius 200 m: a frame per 16 m moved, never within 3 s.
    const frameTimes: number[] = [];
    for (let x = 22; x <= 200; x += 2, t += 1000) if (maps(e.update(fix(t, x, 0), t)).length > 0) frameTimes.push(t);
    expect(frameTimes.length).toBeGreaterThanOrEqual(8);
    for (let i = 1; i < frameTimes.length; i++) expect(frameTimes[i]! - frameTimes[i - 1]!).toBeGreaterThanOrEqual(3000);
    e.watch({ t: 'view', n: 2, mode: 'turn' }, t);
    for (let x = 202; x <= 300; x += 2, t += 1000) expect(maps(e.update(fix(t, x, 0), t))).toEqual([]);
  });

  test('`hello` (the watch app reopened) switches the map off; paused sends none', () => {
    const e = new NavEngine(route, { dest: 'X', defaultSpeedMps: 1.4 });
    e.begin(0);
    expect(types(e.watch({ t: 'view', n: 1, mode: 'map' }, 0))).toEqual(['map']);
    expect(types(e.watch({ t: 'hello', n: 1, app: '1.1.0' }, 1000))).not.toContain('map');
    e.watch({ t: 'view', n: 2, mode: 'map' }, 2000);
    e.watch({ t: 'pause', n: 3 }, 3000);
    expect(maps(e.tick(60_000))).toEqual([]);
  });

  test('a ride (>= 4 m/s) widens the view to 450 m', () => {
    const e = new NavEngine(route, { dest: 'X', defaultSpeedMps: 5 });
    e.begin(0);
    const frame = e.watch({ t: 'view', n: 1, mode: 'map' }, 0)[0] as Extract<PhoneMessage, { t: 'map' }>;
    expect(frame.r).toBe(450);
  });
});

const types = (ms: PhoneMessage[]) => ms.map((m) => m.t);
