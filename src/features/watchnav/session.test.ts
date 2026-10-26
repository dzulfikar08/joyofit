import { describe, expect, test } from 'bun:test';

import { at, polyline } from '@/features/bikecomputer/nav/testRoutes';
import type { StepsRoute } from '@/features/routes/map/routingClient';
import type { WatchNavEvent, WatchNavStatus } from '@/wear';

import type { NavFix } from './engine';
import { WatchNavSession, type SessionDeps } from './session';

const ROUTE = polyline([[0, 0], [1000, 0], [1000, -1000]], 10);
const CONFIG = { phoneFingerprint: 'PLACEHOLDER-P', watchFingerprint: 'PLACEHOLDER-W' };

function status(patch: Partial<WatchNavStatus> = {}): WatchNavStatus {
  return {
    enabled: true,
    active: true,
    p2p: true,
    registered: true,
    phonePackage: 'com.joyodigitama.joyofit',
    watchBundle: 'com.joyodigitama.navi',
    placeholderFingerprints: true,
    watchApp: 'unknown',
    lastCode: null,
    lastHeardAt: null,
    sent: 0,
    acked: 0,
    received: 0,
    ...patch,
  };
}

function harness(routing: SessionDeps['routing'] = null) {
  let time = 0;
  const sent: string[] = [];
  const logs: string[] = [];
  const calls: string[] = [];
  let nativeListener: ((e: WatchNavEvent) => void) | null = null;
  let fixListener: ((f: NavFix) => void) | null = null;
  let tick: (() => void) | null = null;
  const deps: SessionDeps = {
    native: {
      start: async (config) => {
        calls.push(`start ${config.watchFingerprint}`);
        return status();
      },
      send: async (json) => {
        sent.push(json);
        return true;
      },
      stop: async () => {
        calls.push('stop');
      },
      status: () => status(),
      onEvent: (l) => {
        nativeListener = l;
        return () => (nativeListener = null);
      },
    },
    location: {
      start: async () => void calls.push('gps on'),
      stop: async () => void calls.push('gps off'),
      onFix: (l) => {
        fixListener = l;
        return () => (fixListener = null);
      },
    },
    routing,
    config: CONFIG,
    now: () => time,
    every: (fn) => {
      tick = fn;
      return () => (tick = null);
    },
    log: (m) => logs.push(m),
  };
  const session = new WatchNavSession(deps);
  const types = () => sent.map((j) => JSON.parse(j).t as string);
  const fix = (x: number, y: number) => {
    time += 1000;
    const p = at(x, y);
    fixListener?.({ ts: time, lat: p.lat, lon: p.lon, speedMps: 2, accuracy: 5 });
  };
  const watch = (json: string) => nativeListener?.({ kind: 'message', json, ts: time });
  // Lets the queued sends and native calls (resolved promises) run: microtasks only, no clock.
  const settle = async () => {
    for (let i = 0; i < 50; i++) await Promise.resolve();
  };
  return { session, sent, logs, calls, types, fix, watch, settle, tick: () => tick?.(), advance: (ms: number) => (time += ms) };
}

describe('WatchNavSession', () => {
  test('start without routing: the route shape, native start, GPS, then start/turn/prog with n 1, 2, 3', async () => {
    const h = harness();
    await h.session.start({ routeId: 'r1', name: 'Ijen', points: ROUTE, activity: 'walk', reroute: true });
    await h.settle();
    expect(h.calls).toEqual(['start PLACEHOLDER-W', 'gps on']);
    expect(h.session.getSnapshot().phase).toBe('running');
    expect(h.session.getSnapshot().view?.source).toBe('geometry');
    expect(h.types()).toEqual(['start', 'turn', 'prog']);
    expect(h.sent.map((j) => JSON.parse(j).n)).toEqual([1, 2, 3]);
  });

  test('the watch app: hello resends the state, a repeated n is ignored, stop ends and unregisters', async () => {
    const h = harness();
    await h.session.start({ routeId: 'r1', name: 'Ijen', points: ROUTE, activity: 'walk', reroute: false });
    h.fix(100, 0);
    await h.settle();
    h.sent.length = 0;
    h.watch('{"v":1,"t":"hello","n":1,"app":"1.0.0"}');
    await h.settle();
    expect(h.types()).toEqual(['start', 'turn', 'prog']);
    expect(h.session.getSnapshot().watchAppVersion).toBe('1.0.0');
    h.sent.length = 0;
    h.watch('{"v":1,"t":"pause","n":2}');
    h.watch('{"v":1,"t":"pause","n":2}');
    h.watch('{"v":1,"t":"resume","n":2}');
    await h.settle();
    expect(h.types()).toEqual([]);
    h.watch('{"v":1,"t":"stop","n":3}');
    await h.settle();
    await h.settle();
    expect(h.types()).toEqual(['end']);
    expect(JSON.parse(h.sent[0]!).why).toBe('stopped');
    expect(h.calls.slice(-2).sort()).toEqual(['gps off', 'stop']);
    expect(h.session.getSnapshot().phase).toBe('ended');
  });

  test('stop from the phone sends end once', async () => {
    const h = harness();
    await h.session.start({ routeId: 'r1', name: 'Ijen', points: ROUTE, activity: 'ride', reroute: false });
    await h.settle();
    h.sent.length = 0;
    await h.session.stop();
    await h.session.stop();
    expect(h.types()).toEqual(['end']);
    expect(h.calls.filter((c) => c === 'stop')).toHaveLength(1);
  });

  test('OSRM steps are used when their line follows the route; otherwise the shape', async () => {
    const line = polyline([[0, 0], [1000, 0], [1000, -1000]], 50);
    const p = (x: number, y: number) => ({ lat: at(x, y).lat, lon: at(x, y).lon });
    const answer: StepsRoute = {
      line,
      steps: [
        { type: 'depart', modifier: null, exit: null, name: 'Jl. Ijen', distanceM: 1000, location: p(0, 0), bearingBefore: null, bearingAfter: 90 },
        { type: 'turn', modifier: 'right', exit: null, name: 'Jl. Semeru', distanceM: 1000, location: p(1000, 0), bearingBefore: 90, bearingAfter: 180 },
        { type: 'arrive', modifier: null, exit: null, name: 'Jl. Semeru', distanceM: 0, location: p(1000, -1000), bearingBefore: 180, bearingAfter: null },
      ],
    };
    const good = harness({ navigate: async () => answer });
    await good.session.start({ routeId: 'r1', name: 'Ijen', points: ROUTE, activity: 'walk', reroute: false });
    expect(good.session.getSnapshot().view?.source).toBe('osrm');
    good.fix(200, 0);
    await good.settle();
    const turn = good.sent.map((j) => JSON.parse(j)).find((m) => m.t === 'turn' && m.dir === 'right');
    expect(turn.street).toBe('Jl. Semeru');

    const elsewhere = harness({ navigate: async () => ({ ...answer, line: polyline([[0, 0], [0, -1000], [1000, -1000]], 50) }) });
    await elsewhere.session.start({ routeId: 'r1', name: 'Ijen', points: ROUTE, activity: 'walk', reroute: false });
    expect(elsewhere.session.getSnapshot().view?.source).toBe('geometry');

    const offline = harness({
      navigate: async () => {
        throw new Error('network');
      },
    });
    await offline.session.start({ routeId: 'r1', name: 'Ijen', points: ROUTE, activity: 'walk', reroute: false });
    expect(offline.session.getSnapshot().view?.source).toBe('geometry');
    expect(offline.logs.some((l) => l.includes('routing unavailable'))).toBe(true);
  });

  test('off route with reroute on: off, reroute, then a fresh turn on the new line', async () => {
    let asked = 0;
    const h = harness({
      navigate: async () => {
        asked++;
        if (asked === 1) throw new Error('offline at start');
        const line = polyline([[300, 100], [1000, 100], [1000, -1000]], 20);
        const p = (x: number, y: number) => ({ lat: at(x, y).lat, lon: at(x, y).lon });
        return {
          line,
          steps: [
            { type: 'depart', modifier: null, exit: null, name: 'Gang Mawar', distanceM: 700, location: p(300, 100), bearingBefore: null, bearingAfter: 90 },
            { type: 'turn', modifier: 'right', exit: null, name: 'Jl. Semeru', distanceM: 1100, location: p(1000, 100), bearingBefore: 90, bearingAfter: 180 },
            { type: 'arrive', modifier: null, exit: null, name: '', distanceM: 0, location: p(1000, -1000), bearingBefore: 180, bearingAfter: null },
          ],
        };
      },
    });
    await h.session.start({ routeId: 'r1', name: 'Ijen', points: ROUTE, activity: 'walk', reroute: true });
    h.fix(200, 0);
    h.fix(250, 0);
    h.sent.length = 0;
    for (let i = 0; i < 12; i++) h.fix(300, 100);
    await h.settle();
    await h.settle();
    const types = h.types();
    expect(types.slice(types.indexOf('off'))).toEqual(['off', 'reroute', 'turn', 'prog']);
    expect(asked).toBe(2);
    expect(h.session.getSnapshot().view?.phase).toBe('navigating');
  });

  test('a failing native start is a failed session, with GPS never started', async () => {
    const h = harness();
    const s = new WatchNavSession({
      ...Reflect.get(h.session, 'deps'),
      native: {
        ...Reflect.get(h.session, 'deps').native,
        start: async () => {
          throw new Error('Watch navigation is a lab feature');
        },
      },
    });
    await s.start({ routeId: 'r1', name: 'Ijen', points: ROUTE, activity: 'walk', reroute: false });
    expect(s.getSnapshot().phase).toBe('failed');
    expect(s.getSnapshot().error).toContain('lab feature');
    expect(h.calls).not.toContain('gps on');
  });

  test('the heartbeat goes out from the tick after 30 s of silence', async () => {
    const h = harness();
    await h.session.start({ routeId: 'r1', name: 'Ijen', points: ROUTE, activity: 'walk', reroute: false });
    await h.settle();
    h.sent.length = 0;
    h.advance(31_000);
    h.tick();
    await h.settle();
    expect(h.types()).toEqual(['hb']);
  });
});
