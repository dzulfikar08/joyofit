/**
 * The instructions of a navigation route, each at its distance along the line the wearer follows. Two sources:
 * - OSRM steps (`routingClient.navigate`, `steps=true`): street names, roundabout exits; the line is OSRM's.
 * - the saved route's own shape when routing is unavailable or OSRM's line does not follow the route: turns where the heading changes
 *   (`generateCues`, the bike computer's cue finder), no street names.
 * Pure.
 */
import { buildRouteIndex, generateCues, project, type RouteIndex } from '@/features/bikecomputer/nav';
import type { TurnKind } from '@/features/bikecomputer/types';
import type { LatLon } from '@/features/routes/map/geometry';
import type { RouteStep, StepsRoute } from '@/features/routes/map/routingClient';
import { simplifyRoute, type RoutePoint } from '@/features/routes/routeModel';

import type { Dir } from './messages';

export interface NavManeuver {
  /** Metres along the route line. */
  atM: number;
  dir: Dir;
  /** The way the maneuver leads onto; empty when unknown. */
  street: string;
  exit?: number;
}

export interface NavRoute {
  line: readonly RoutePoint[];
  index: RouteIndex;
  /** Sorted by `atM`; the first is `depart` at 0, the last `arrive` at the end of the line. */
  maneuvers: readonly NavManeuver[];
  source: 'osrm' | 'geometry';
}

/** Most waypoints sent to OSRM for one navigation request (the URL stays near 1.3 kB). */
export const MAX_VIA_POINTS = 50;
/** Smallest heading change that is a turn when the shape is all there is, degrees (the bike computer uses 25 for its cues). */
export const GEOMETRY_MIN_TURN_DEG = 30;
/** OSRM's line follows the saved route when this share of the route's samples lies within `MATCH_OFF_M` of it. */
export const MATCH_SHARE = 0.9;
export const MATCH_OFF_M = 50;
const MATCH_SAMPLE_M = 50;
/** And its length is within this ratio of the route's. */
const MATCH_LENGTH_RATIO = 1.25;
/** Maneuvers this close along the line are one (an OSRM "turn" right after a via point). */
const SAME_PLACE_M = 5;
/** How far from OSRM's own running distance a maneuver is looked for on the line. */
const STEP_WINDOW_M = 500;

const MODIFIERS: Record<string, Dir> = {
  uturn: 'uturn',
  'sharp right': 'sharp_right',
  right: 'right',
  'slight right': 'slight_right',
  straight: 'straight',
  'slight left': 'slight_left',
  left: 'left',
  'sharp left': 'sharp_left',
};

/** Steps that keep going the same way: an instruction only when they bend. */
const PASS_THROUGH: Record<string, true> = {
  'new name': true,
  continue: true,
  notification: true,
  'use lane': true,
  'exit roundabout': true,
  'exit rotary': true,
};
const ROUNDABOUT: Record<string, true> = { roundabout: true, rotary: true, 'roundabout turn': true };

/** The direction of a signed heading change (positive = right), with the bike computer's angle bands. */
export function dirOfChange(deg: number): Dir {
  const a = Math.abs(deg);
  const right = deg > 0;
  if (a > 160) return 'uturn';
  if (a > 120) return right ? 'sharp_right' : 'sharp_left';
  if (a > 60) return right ? 'right' : 'left';
  return right ? 'slight_right' : 'slight_left';
}

const KIND_DIRS: Record<TurnKind, Dir> = {
  start: 'depart',
  finish: 'arrive',
  slightLeft: 'slight_left',
  left: 'left',
  sharpLeft: 'sharp_left',
  slightRight: 'slight_right',
  right: 'right',
  sharpRight: 'sharp_right',
  uTurn: 'uturn',
};

/** The instruction of one OSRM step in the middle of a leg; null when the step needs none (straight on, a name change, leaving a roundabout). */
export function dirOfStep(step: RouteStep): Dir | null {
  if (ROUNDABOUT[step.type]) return 'roundabout';
  const dir = step.modifier === null ? null : (MODIFIERS[step.modifier] ?? null);
  if (PASS_THROUGH[step.type]) return dir === null || dir === 'straight' ? null : dir;
  if (step.type === 'depart' || step.type === 'arrive') return null;
  return dir;
}

function signedChange(before: number, after: number): number {
  let d = after - before;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
}

function asPoints(line: readonly LatLon[]): RoutePoint[] {
  return line.map((p) => ({ lat: p.lat, lon: p.lon, alt: null }));
}

/**
 * The maneuvers of OSRM steps on OSRM's line. A request through several waypoints answers one leg per pair, each ending in `arrive` and the
 * next starting in `depart`: those two become one turn from the heading in to the heading out (or nothing when it goes straight on).
 */
export function maneuversFromSteps(steps: readonly RouteStep[], index: RouteIndex): NavManeuver[] {
  const total = index.totalM;
  const out: NavManeuver[] = [{ atM: 0, dir: 'depart', street: steps[0]?.name ?? '' }];
  let runningM = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const startM = runningM;
    runningM += step.distanceM;
    if (i === 0) continue;
    let dir: Dir | null;
    let street = step.name;
    let exit: number | undefined;
    if (step.type === 'arrive') {
      const next = steps[i + 1];
      if (next === undefined) break;
      // A via point: the turn there is the change from the heading arriving to the heading leaving.
      if (step.bearingBefore === null || next.bearingAfter === null) continue;
      const deg = signedChange(step.bearingBefore, next.bearingAfter);
      dir = Math.abs(deg) < GEOMETRY_MIN_TURN_DEG ? null : dirOfChange(deg);
      street = next.name;
    } else if (step.type === 'depart') {
      continue;
    } else {
      dir = dirOfStep(step);
      if (dir === 'roundabout' && step.exit !== null) exit = step.exit;
    }
    if (dir === null) continue;
    const at = project(index, step.location.lat, step.location.lon, { atM: startM, windowM: STEP_WINDOW_M }).atM;
    if (at <= SAME_PLACE_M || at >= total - SAME_PLACE_M) continue;
    const maneuver: NavManeuver = { atM: at, dir, street };
    if (exit !== undefined) maneuver.exit = exit;
    const last = out[out.length - 1]!;
    if (at - last.atM < SAME_PLACE_M && last.dir !== 'depart') out[out.length - 1] = maneuver;
    else if (at > last.atM) out.push(maneuver);
  }
  out.push({ atM: total, dir: 'arrive', street: steps[steps.length - 1]?.name ?? '' });
  return out;
}

/** The maneuvers of a route from its shape alone: `generateCues` with a 30° threshold, no street names. */
export function maneuversFromGeometry(points: readonly RoutePoint[]): NavManeuver[] {
  return generateCues(points, { minAngleDeg: GEOMETRY_MIN_TURN_DEG }).map((cue) => ({ atM: cue.atM, dir: KIND_DIRS[cue.kind], street: '' }));
}

export function navRouteFromGeometry(points: readonly RoutePoint[]): NavRoute {
  return { line: points, index: buildRouteIndex(points), maneuvers: maneuversFromGeometry(points), source: 'geometry' };
}

export function navRouteFromSteps(answer: StepsRoute): NavRoute {
  const line = asPoints(answer.line);
  const index = buildRouteIndex(line);
  return { line, index, maneuvers: maneuversFromSteps(answer.steps, index), source: 'osrm' };
}

/** Waypoints for the navigation request: the route simplified to at most `MAX_VIA_POINTS` (first and last kept). */
export function viaPoints(points: readonly RoutePoint[], max = MAX_VIA_POINTS): LatLon[] {
  return simplifyRoute(points, max).map((p) => ({ lat: p.lat, lon: p.lon }));
}

/**
 * Whether OSRM's line follows the saved route: similar length, and at least 90% of the route (sampled every 50 m) within 50 m of it. A GPX
 * track over paths OSM does not have fails this, and the route's own shape is used instead.
 */
export function followsRoute(route: RouteIndex, osrm: RouteIndex): boolean {
  if (route.totalM <= 0 || osrm.totalM <= 0) return false;
  const ratio = osrm.totalM / route.totalM;
  if (ratio > MATCH_LENGTH_RATIO || ratio < 1 / MATCH_LENGTH_RATIO) return false;
  let samples = 0;
  let near = 0;
  let hint = 0;
  let next = 0;
  for (let i = 0; i < route.points.length; i++) {
    if (route.cumM[i]! < next && i !== route.points.length - 1) continue;
    next = route.cumM[i]! + MATCH_SAMPLE_M;
    const p = route.points[i]!;
    const proj = project(osrm, p.lat, p.lon, { atM: hint, windowM: 2 * MATCH_SAMPLE_M + MATCH_OFF_M });
    samples++;
    if (proj.offM <= MATCH_OFF_M) {
      near++;
      hint = proj.atM;
    }
  }
  return samples > 0 && near / samples >= MATCH_SHARE;
}
