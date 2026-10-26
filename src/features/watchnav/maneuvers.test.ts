import { describe, expect, test } from 'bun:test';

import { buildRouteIndex } from '@/features/bikecomputer/nav';
import { at, polyline } from '@/features/bikecomputer/nav/testRoutes';
import type { RouteStep } from '@/features/routes/map/routingClient';

import { dirOfChange, dirOfStep, followsRoute, maneuversFromGeometry, navRouteFromSteps, viaPoints } from './maneuvers';

function step(type: string, x: number, y: number, distanceM: number, extra: Partial<RouteStep> = {}): RouteStep {
  const p = at(x, y);
  return { type, modifier: null, exit: null, name: '', distanceM, location: { lat: p.lat, lon: p.lon }, bearingBefore: null, bearingAfter: null, ...extra };
}

describe('geometry-derived turns', () => {
  test('a right then a sharp right, from the shape alone', () => {
    const route = polyline([[0, 0], [400, 0], [400, -400], [100, -100]], 10);
    const list = maneuversFromGeometry(route);
    expect(list.map((m) => m.dir)).toEqual(['depart', 'right', 'sharp_right', 'arrive']);
    expect(list[1]!.atM).toBeCloseTo(400, -1);
    expect(list[2]!.atM).toBeCloseTo(800, -1);
    expect(list.every((m) => m.street === '')).toBe(true);
  });

  test('bends under 30° are not turns', () => {
    const route = polyline([[0, 0], [400, 0], [800, 150]], 10); // about 20°
    expect(maneuversFromGeometry(route).map((m) => m.dir)).toEqual(['depart', 'arrive']);
  });

  test('angle bands', () => {
    expect(dirOfChange(40)).toBe('slight_right');
    expect(dirOfChange(-90)).toBe('left');
    expect(dirOfChange(140)).toBe('sharp_right');
    expect(dirOfChange(-175)).toBe('uturn');
  });
});

describe('OSRM steps', () => {
  test('step types: turns keep their modifier, straight on and name changes are no instruction, roundabouts carry the exit', () => {
    expect(dirOfStep(step('turn', 0, 0, 0, { modifier: 'slight left' }))).toBe('slight_left');
    expect(dirOfStep(step('end of road', 0, 0, 0, { modifier: 'right' }))).toBe('right');
    expect(dirOfStep(step('new name', 0, 0, 0, { modifier: 'straight' }))).toBeNull();
    expect(dirOfStep(step('continue', 0, 0, 0, { modifier: 'left' }))).toBe('left');
    expect(dirOfStep(step('roundabout', 0, 0, 0, { modifier: 'right', exit: 2 }))).toBe('roundabout');
    expect(dirOfStep(step('exit roundabout', 0, 0, 0, { modifier: 'straight' }))).toBeNull();
  });

  test('maneuvers sit on the line where OSRM puts them; a via point becomes a turn from the headings', () => {
    // Line: east 500, south 500 (via point at the corner), east 300 with a roundabout at 650.
    const line = polyline([[0, 0], [500, 0], [500, -500], [800, -500]], 10);
    const route = navRouteFromSteps({
      line,
      steps: [
        step('depart', 0, 0, 500, { name: 'Jl. Ijen', modifier: 'right' }),
        step('arrive', 500, 0, 0, { bearingBefore: 90 }),
        step('depart', 500, 0, 300, { name: 'Jl. Semeru', bearingAfter: 180 }),
        step('new name', 500, -300, 200, { name: 'Jl. Kawi', modifier: 'straight' }),
        step('turn', 500, -500, 150, { name: 'Jl. Bromo', modifier: 'left' }),
        step('roundabout', 650, -500, 150, { name: 'Jl. Tugu', modifier: 'straight', exit: 3 }),
        step('arrive', 800, -500, 0, { name: 'Jl. Tugu' }),
      ],
    });
    expect(route.source).toBe('osrm');
    expect(route.maneuvers.map((m) => [m.dir, m.street, Math.round(m.atM / 10) * 10, m.exit])).toEqual([
      ['depart', 'Jl. Ijen', 0, undefined],
      ['right', 'Jl. Semeru', 500, undefined],
      ['left', 'Jl. Bromo', 1000, undefined],
      ['roundabout', 'Jl. Tugu', 1150, 3],
      ['arrive', 'Jl. Tugu', 1300, undefined],
    ]);
  });

  test('a via point where the road goes straight on is no instruction', () => {
    const line = polyline([[0, 0], [1000, 0]], 10);
    const route = navRouteFromSteps({
      line,
      steps: [
        step('depart', 0, 0, 500),
        step('arrive', 500, 0, 0, { bearingBefore: 90 }),
        step('depart', 500, 0, 500, { bearingAfter: 92 }),
        step('arrive', 1000, 0, 0),
      ],
    });
    expect(route.maneuvers.map((m) => m.dir)).toEqual(['depart', 'arrive']);
  });
});

describe('route matching', () => {
  const route = buildRouteIndex(polyline([[0, 0], [1000, 0], [1000, 1000]], 10));

  test("OSRM's line along the same streets follows the route", () => {
    const osrm = buildRouteIndex(polyline([[0, 8], [992, 8], [992, 1000]], 25));
    expect(followsRoute(route, osrm)).toBe(true);
  });

  test('a line on other streets does not', () => {
    const osrm = buildRouteIndex(polyline([[0, 0], [0, 1000], [1000, 1000]], 25));
    expect(followsRoute(route, osrm)).toBe(false);
  });

  test('a much longer line does not', () => {
    const osrm = buildRouteIndex(polyline([[0, 0], [1000, 0], [1000, 1000], [1000, 2000], [1000, 1000]], 25));
    expect(followsRoute(route, osrm)).toBe(false);
  });

  test('via points: at most 50, ends kept', () => {
    const long = polyline([[0, 0], [5000, 0], [5000, 5000], [0, 5000]], 5);
    const vias = viaPoints(long);
    expect(vias.length).toBeLessThanOrEqual(50);
    expect(vias[0]).toEqual({ lat: long[0]!.lat, lon: long[0]!.lon });
    expect(vias[vias.length - 1]).toEqual({ lat: long[long.length - 1]!.lat, lon: long[long.length - 1]!.lon });
  });
});
