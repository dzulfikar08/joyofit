import { describe, expect, test } from 'bun:test';

import { at, polyline } from '@/features/bikecomputer/nav/testRoutes';

import { NavEngine, type NavFix } from './engine';
import { navRouteFromGeometry } from './maneuvers';
import type { PhoneMessage } from './messages';

// East 1000 m, right (south) 1000 m, left (east) 500 m: depart, right at 1000, left at 2000, arrive at 2500.
const ROUTE = polyline([[0, 0], [1000, 0], [1000, -1000], [1500, -1000]], 10);

function engine(config = {}) {
  return new NavEngine(navRouteFromGeometry(ROUTE), { dest: 'Alun-alun', defaultSpeedMps: 1.4, config });
}

function fix(ts: number, x: number, y: number, speed: number | null = 2, accuracy: number | null = 5): NavFix {
  const p = at(x, y);
  return { ts, lat: p.lat, lon: p.lon, speedMps: speed, accuracy };
}

const types = (messages: PhoneMessage[]) => messages.map((m) => m.t);
const turnOf = (messages: PhoneMessage[]) => messages.find((m): m is Extract<PhoneMessage, { t: 'turn' }> => m.t === 'turn');
const progOf = (messages: PhoneMessage[]) => messages.find((m): m is Extract<PhoneMessage, { t: 'prog' }> => m.t === 'prog');

/** Walks along x from `fromX` to `toX` (y = 0) at 2 m/s, one fix a second; returns every message with its time. */
function walkEast(e: NavEngine, fromX: number, toX: number, t0: number): { at: number; m: PhoneMessage }[] {
  const out: { at: number; m: PhoneMessage }[] = [];
  let t = t0;
  for (let x = fromX; x <= toX; x += 2, t += 1000) for (const m of e.update(fix(t, x, 0), t)) out.push({ at: t, m });
  return out;
}

describe('NavEngine', () => {
  test('begin sends start, the depart turn and a prog with the default-speed ETA', () => {
    const msgs = engine().begin(0);
    expect(types(msgs)).toEqual(['start', 'turn', 'prog']);
    const start = msgs[0] as Extract<PhoneMessage, { t: 'start' }>;
    expect(start.dest).toBe('Alun-alun');
    expect(start.totalM).toBeCloseTo(2500, -1);
    expect(start.etaS).toBe(Math.round(start.totalM / 1.4));
    expect(turnOf(msgs)?.dir).toBe('depart');
  });

  test('turn sequencing: depart, right, left, then arrive and end', () => {
    const e = engine();
    e.begin(0);
    const dirs: string[] = [];
    let t = 1000;
    const collect = (ms: PhoneMessage[]) => {
      for (const m of ms) if (m.t === 'turn' && dirs[dirs.length - 1] !== m.dir) dirs.push(m.dir);
    };
    for (let x = 0; x <= 1000; x += 5, t += 1000) collect(e.update(fix(t, x, 0, 5), t));
    for (let y = 0; y >= -1000; y -= 5, t += 1000) collect(e.update(fix(t, 1000, y, 5), t));
    const tail: PhoneMessage[] = [];
    for (let x = 1000; x <= 1500; x += 5, t += 1000) tail.push(...e.update(fix(t, x, -1000, 5), t));
    collect(tail);
    expect(dirs).toEqual(['right', 'left', 'arrive']);
    expect(types(tail).slice(-2)).toEqual(['arrive', 'end']);
    expect(tail[tail.length - 1]).toEqual({ t: 'end', why: 'arrived' });
    expect(e.isEnded).toBe(true);
    expect(e.update(fix(t, 1500, -1000), t)).toEqual([]);
  });

  test('distance to the turn and remaining distance follow the matched position', () => {
    const e = engine();
    e.begin(0);
    const msgs = e.update(fix(1000, 300, 6), 1000);
    const turn = turnOf(msgs)!;
    expect(turn.dir).toBe('right');
    expect(turn.distM).toBeGreaterThan(680);
    expect(turn.distM).toBeLessThan(720);
    const view = e.view();
    expect(view.remainingM).toBeCloseTo(2200, -1);
    expect(view.offM).toBeCloseTo(6, 0);
  });

  test('turn goes out again when the distance first drops to 200 m and to 50 m', () => {
    const e = engine();
    e.begin(0);
    const turns = walkEast(e, 0, 1000, 1000)
      .map((x) => x.m)
      .filter((m): m is Extract<PhoneMessage, { t: 'turn' }> => m.t === 'turn' && m.dir === 'right');
    expect(turns.map((m) => m.distM <= 50 ? 50 : m.distM <= 200 ? 200 : 'far')).toEqual(['far', 200, 50]);
  });

  test('prog: at most every 5 s while the numbers change, sooner on a 10% jump', () => {
    const e = engine();
    e.begin(0);
    const progs = walkEast(e, 0, 400, 1000).filter((x) => x.m.t === 'prog');
    for (let i = 1; i < progs.length; i++) expect(progs[i]!.at - progs[i - 1]!.at).toBeGreaterThanOrEqual(1000);
    // 2 m/s for 200 s: about one prog every 5 s (the 10% rule fires only near the turn, never here at 600+ m).
    expect(progs.length).toBeGreaterThan(30);
    expect(progs.length).toBeLessThan(45);
    // Standing still: no prog, only the heartbeat after 30 s.
    const still = e.update(fix(400_000, 400, 0, 0), 400_000);
    expect(still.filter((m) => m.t === 'prog').length).toBeLessThanOrEqual(1);
    const quiet: PhoneMessage[] = [];
    for (let t = 401_000; t <= 431_000; t += 1000) quiet.push(...e.update(fix(t, 400, 0, 0), t), ...e.tick(t));
    expect(types(quiet)).toEqual(['hb']);
  });

  test('a 10% change of the distance to the turn sends prog before 5 s', () => {
    const e = engine();
    e.begin(0);
    walkEast(e, 0, 880, 1000);
    // ~120 m before the turn, then 20 m further 1.5 s later: more than 10%.
    const a = e.update(fix(1_000_000, 880, 0), 1_000_000);
    const b = e.update(fix(1_001_500, 900, 0), 1_001_500);
    expect(progOf([...a, ...b])).toBeDefined();
  });

  test('ETA comes from the recent speed, and keeps the moving speed while standing', () => {
    const e = engine();
    e.begin(0);
    for (let i = 0; i < 20; i++) e.update(fix(1000 + i * 1000, 100 + i * 4, 0, 4), 1000 + i * 1000);
    const moving = e.view();
    expect(moving.etaS).toBeCloseTo(moving.remainingM / 4, -1);
    for (let i = 0; i < 40; i++) e.update(fix(30_000 + i * 1000, 176, 0, 0), 30_000 + i * 1000);
    expect(e.view().etaS).toBeCloseTo(moving.etaS, -1);
  });

  test('off route after > 40 m for 10 s: one off, silence, then a fresh turn when back', () => {
    const e = engine();
    e.begin(0);
    walkEast(e, 0, 200, 1000);
    const away: PhoneMessage[] = [];
    for (let t = 200_000; t <= 211_000; t += 1000) away.push(...e.update(fix(t, 210, 60), t), ...e.tick(t));
    // A prog may still go out during the first 10 s; from `off` on, nothing.
    expect(types(away.slice(types(away).indexOf('off')))).toEqual(['off']);
    expect(e.view().phase).toBe('offRoute');
    expect(e.wantsReroute(211_000)).toBe(true);
    // 30 m away is still off (clears at 25 m).
    expect(e.update(fix(212_000, 215, 30), 212_000)).toEqual([]);
    const back = e.update(fix(213_000, 220, 5), 213_000);
    expect(turnOf(back)?.dir).toBe('right');
    expect(e.view().phase).toBe('navigating');
  });

  test('a short excursion (under 10 s) is not off route', () => {
    const e = engine();
    e.begin(0);
    walkEast(e, 0, 100, 1000);
    const out: PhoneMessage[] = [];
    for (let t = 100_000; t < 108_000; t += 1000) out.push(...e.update(fix(t, 100, 80), t));
    out.push(...e.update(fix(108_000, 104, 2), 108_000));
    expect(types(out)).not.toContain('off');
  });

  test('inaccurate fixes are not matched', () => {
    const e = engine();
    e.begin(0);
    e.update(fix(1000, 500, 0, 2, 80), 1000);
    expect(e.view().matched).toBe(false);
  });

  test('a loop does not arrive at its start', () => {
    const loop = polyline([[0, 0], [500, 0], [500, 500], [0, 500], [0, 0]], 10);
    const e = new NavEngine(navRouteFromGeometry(loop), { dest: 'Loop', defaultSpeedMps: 1.4 });
    e.begin(0);
    const msgs = e.update(fix(1000, 2, 0), 1000);
    expect(types(msgs)).not.toContain('arrive');
    expect(e.view().remainingM).toBeGreaterThan(1900);
  });

  test('hello and resume answer start, turn, prog (and off when off route); pause silences; stop ends', () => {
    const e = engine();
    e.begin(0);
    walkEast(e, 0, 100, 1000);
    expect(types(e.watch({ t: 'hello', n: 1, app: '1.0.0' }, 60_000))).toEqual(['start', 'turn', 'prog']);
    expect(e.watch({ t: 'pause', n: 2 }, 61_000)).toEqual([]);
    expect(e.view().phase).toBe('paused');
    expect(e.update(fix(62_000, 150, 0), 62_000)).toEqual([]);
    const hb = e.tick(95_000);
    expect(types(hb)).toEqual(['hb']);
    expect(types(e.watch({ t: 'resume', n: 3 }, 96_000))).toEqual(['start', 'turn', 'prog']);
    for (let t = 100_000; t <= 111_000; t += 1000) e.update(fix(t, 160, 80), t);
    expect(types(e.watch({ t: 'hello', n: 1, app: '1.0.0' }, 112_000))).toEqual(['start', 'turn', 'prog', 'off']);
    expect(e.watch({ t: 'stop', n: 4 }, 113_000)).toEqual([{ t: 'end', why: 'stopped' }]);
    expect(e.watch({ t: 'hello', n: 5, app: '1.0.0' }, 114_000)).toEqual([]);
  });

  test('reroute: reroute message, then a fresh turn on the new line', () => {
    const e = engine();
    e.begin(0);
    walkEast(e, 0, 100, 1000);
    for (let t = 100_000; t <= 111_000; t += 1000) e.update(fix(t, 100, 100), t);
    expect(e.beginReroute(111_000)).toEqual([{ t: 'reroute' }]);
    expect(e.wantsReroute(112_000)).toBe(false);
    // New line from where the wearer stands: north 0 -> back down to the original corner.
    const fresh = navRouteFromGeometry(polyline([[100, 100], [600, 100], [600, 0], [1000, 0]], 10));
    const msgs = e.replaceRoute(fresh, 112_000);
    expect(turnOf(msgs)).toBeDefined();
    expect(progOf(msgs)).toBeDefined();
    expect(e.view().phase).toBe('navigating');
    expect(e.view().remainingM).toBeCloseTo(1000, -1);
  });

  test('a failed reroute is retried after 30 s, not before', () => {
    const e = engine();
    e.begin(0);
    for (let t = 1000; t <= 12_000; t += 1000) e.update(fix(t, 50, 100), t);
    e.beginReroute(12_000);
    e.rerouteFailed();
    expect(e.wantsReroute(20_000)).toBe(false);
    expect(e.wantsReroute(42_000)).toBe(true);
  });

  test('location lost for 5 min ends with error', () => {
    const e = engine();
    e.begin(0);
    e.update(fix(1000, 10, 0), 1000);
    expect(e.tick(200_000).some((m) => m.t === 'end')).toBe(false);
    expect(e.tick(301_000)).toEqual([{ t: 'end', why: 'error' }]);
  });

  test('next is sent when the following maneuver is within 150 m', () => {
    const zigzag = polyline([[0, 0], [500, 0], [500, -100], [1000, -100]], 10);
    const e = new NavEngine(navRouteFromGeometry(zigzag), { dest: 'Z', defaultSpeedMps: 1.4 });
    e.begin(0);
    const turn = turnOf(e.update(fix(1000, 200, 0), 1000))!;
    expect(turn.dir).toBe('right');
    expect(turn.next).toEqual({ dir: 'left', street: '' });
  });
});
