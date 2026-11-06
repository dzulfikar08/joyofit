import { describe, expect, test } from 'bun:test';

import { at, polyline } from '@/features/bikecomputer/nav/testRoutes';

import { TurnAlerts, type AlertStrings } from './alerts';
import { NavEngine } from './engine';
import { navRouteFromGeometry } from './maneuvers';
import type { PhoneMessage } from './messages';

const S: AlertStrings = {
  action: (dir, exit) => (exit ? `${dir} ${exit}` : dir),
  distance: (m) => `${Math.round(m)} m`,
  offRoute: 'Off route',
  offRouteBody: 'Head back to the route',
  arrived: 'Arrived',
};

describe('TurnAlerts', () => {
  test('first turn once even when far, later turns only at 200 m and 50 m, each once', () => {
    const a = new TurnAlerts(S);
    expect(a.take({ t: 'start', dest: 'Alun-alun', totalM: 2500, etaS: 900 })).toBeNull();
    expect(a.take({ t: 'turn', dir: 'depart', distM: 0, street: '' })).toBeNull();
    expect(a.take({ t: 'turn', dir: 'right', distM: 1000, street: 'Jl. Ijen' })).toEqual({ title: '1000 m · right', body: 'Jl. Ijen' });
    expect(a.take({ t: 'prog', distM: 900, remM: 2400, etaS: 800 })).toBeNull();
    expect(a.take({ t: 'turn', dir: 'right', distM: 200, street: 'Jl. Ijen' })).toEqual({ title: '200 m · right', body: 'Jl. Ijen' });
    expect(a.take({ t: 'turn', dir: 'right', distM: 199, street: 'Jl. Ijen' })).toBeNull(); // repeat of the same band
    expect(a.take({ t: 'turn', dir: 'right', distM: 50, street: 'Jl. Ijen' })).toEqual({ title: '50 m · right', body: 'Jl. Ijen' });
    expect(a.take({ t: 'turn', dir: 'left', distM: 1000, street: 'Jl. Semeru' })).toBeNull(); // far, not the first
    expect(a.take({ t: 'turn', dir: 'roundabout', distM: 180, street: 'Jl. Tugu', exit: 2 })).toEqual({ title: '180 m · roundabout 2', body: 'Jl. Tugu' });
  });

  test('off route once until back on a turn; arrival names the destination', () => {
    const a = new TurnAlerts(S);
    a.take({ t: 'start', dest: 'Alun-alun', totalM: 100, etaS: 60 });
    expect(a.take({ t: 'off' })).toEqual({ title: 'Off route', body: 'Head back to the route' });
    expect(a.take({ t: 'off' })).toBeNull();
    a.take({ t: 'turn', dir: 'left', distM: 400, street: '' });
    expect(a.take({ t: 'off' })).not.toBeNull();
    expect(a.take({ t: 'arrive' })).toEqual({ title: 'Arrived', body: 'Alun-alun' });
  });

  test('a whole walk through the engine: few alerts, in order', () => {
    // East 1000 m, right (south) 1000 m, left (east) 500 m.
    const route = navRouteFromGeometry(polyline([[0, 0], [1000, 0], [1000, -1000], [1500, -1000]], 10));
    const e = new NavEngine(route, { dest: 'Alun-alun', defaultSpeedMps: 1.4 });
    const a = new TurnAlerts(S);
    const titles: string[] = [];
    const feed = (ms: PhoneMessage[]) => {
      for (const m of ms) {
        const alert = a.take(m);
        if (alert) titles.push(alert.title);
      }
    };
    const fix = (ts: number, x: number, y: number) => ({ ts, lat: at(x, y).lat, lon: at(x, y).lon, speedMps: 2, accuracy: 5 });
    feed(e.begin(0));
    let t = 1000;
    for (let x = 0; x <= 1000; x += 5, t += 1000) feed(e.update(fix(t, x, 0), t));
    for (let y = 0; y >= -1000; y -= 5, t += 1000) feed(e.update(fix(t, 1000, y), t));
    for (let x = 1000; x <= 1500; x += 5, t += 1000) feed(e.update(fix(t, x, -1000), t));
    expect(titles[0]).toMatch(/· right$/); // the first turn, announced from the start
    expect(titles.filter((x) => x.endsWith('· right'))).toHaveLength(3); // first, 200 m, 50 m
    expect(titles.filter((x) => x.endsWith('· left'))).toHaveLength(2); // 200 m, 50 m
    expect(titles[titles.length - 1]).toBe('Arrived');
    expect(titles.length).toBeLessThanOrEqual(9);
  });
});
