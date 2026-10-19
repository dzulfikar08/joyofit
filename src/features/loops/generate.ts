/**
 * Round-trip loops from one point. Routing services with a real round-trip call need an API key or are not reliable about the
 * length, so the loop is built here: a few waypoints on a seeded, jittered ring that passes through the start, one foot-routing
 * request through them (`start, w1 .. wn, start`), and the ring is rescaled until the routed length lands within 5% of the
 * target. Several seeds give several different loops; the one on the fewest painted streets wins. Pure: the router is injected.
 */
import type { LatLon } from '@/features/routes/map/geometry';
import { isAborted } from '@/features/routes/map/http';
import type { ViaRoute } from '@/features/routes/map/routingClient';
import { haversineM } from '@/features/routes/routeModel';

import { destination, pathLengthM, seededRandom } from './geo';
import { scoreLoop, type PaintedIndex } from './painted';

/** A loop within this share of the target length is "on target". */
export const TOLERANCE = 0.05;
/** When no loop reaches the tolerance, one within this share is still offered (after those that did). */
export const FALLBACK_TOLERANCE = 0.1;
/** A waypoint that has to move further than this to reach a road makes the loop's shape unreliable. */
export const MAX_SNAP_M = 150;
/** A start that is further than this from any road cannot be routed from. */
export const MAX_START_SNAP_M = 300;
/** Routing requests spent on one loop while rescaling it. */
export const MAX_ATTEMPTS = 3;
/** Loops tried per batch, and how many more are tried when fewer than `MIN_WANTED` came out usable. */
export const DEFAULT_COUNT = 4;
export const EXTRA_TRIES = 2;
export const MIN_WANTED = 2;
/** First guess of routed length over ring circumference, before the first measurement. */
export const INITIAL_RATIO = 1.25;

/** Routes through the waypoints in order. Rejects with a `RequestError`; an abort has kind `aborted`. */
export type LoopRouter = (waypoints: readonly LatLon[], signal?: AbortSignal) => Promise<ViaRoute>;

export interface LoopCandidate {
  /** Unique within a session: the seed that made it. */
  id: string;
  /** The closed line, from the start back to the start. */
  line: readonly LatLon[];
  lengthM: number;
  /** Share of the length, 0 to 1, on streets not painted yet; null without history. */
  newShare: number | null;
  /** Share of the length that retraces the loop's own streets, 0 to 1. */
  repeatShare: number;
  /** Routed length over the target, minus 1. */
  lengthError: number;
}

export type LoopFailure =
  /** The start is not near any street or path the service can route on. */
  | 'no_road'
  /** Every try came back unusable (no route, shapes too far from the target). */
  | 'no_loop'
  /** Every request failed (offline, service down); `cause` has the last error. */
  | 'network';

export class LoopError extends Error {
  readonly kind: LoopFailure;
  readonly cause?: unknown;

  constructor(kind: LoopFailure, cause?: unknown) {
    super(`loop generation failed: ${kind}`);
    this.name = 'LoopError';
    this.kind = kind;
    this.cause = cause;
  }
}

interface Shape {
  /** Compass bearing from the start to the centre of the ring. */
  bearing: number;
  /** Waypoints on the ring besides the start. */
  waypoints: number;
  /** +1 walks the ring clockwise, -1 counter-clockwise. */
  turn: 1 | -1;
  /** Per waypoint: radius factor around 1 and angle offset in degrees. */
  radial: readonly number[];
  angular: readonly number[];
}

/** The shape a seed gives, with the ring's centre `bearing` degrees from the start. Same seed, same shape. */
export function shapeFor(seed: number, bearing: number): Shape {
  const random = seededRandom(seed);
  const waypoints = random() < 0.5 ? 3 : 4;
  const turn = random() < 0.5 ? 1 : -1;
  const radial: number[] = [];
  const angular: number[] = [];
  for (let i = 0; i < waypoints; i++) {
    radial.push(1 + (random() - 0.5) * 0.3);
    angular.push((random() - 0.5) * 20);
  }
  return { bearing, waypoints, turn, radial, angular };
}

/** `[start, w1 .. wn, start]` for a ring of `circumferenceM` that passes through `start`. */
export function ringWaypoints(start: LatLon, circumferenceM: number, shape: Shape): LatLon[] {
  const radius = circumferenceM / (2 * Math.PI);
  const center = destination(start, shape.bearing, radius);
  const startAngle = shape.bearing + 180;
  const between = 360 / (shape.waypoints + 1);
  const points: LatLon[] = [start];
  for (let i = 0; i < shape.waypoints; i++) {
    const angle = startAngle + shape.turn * ((i + 1) * between + shape.angular[i]);
    points.push(destination(center, angle, radius * shape.radial[i]));
  }
  points.push(start);
  return points;
}

/** The routed line with the exact start point at both ends, so the loop is closed on the marker and not on the road beside it. */
function closeLoop(line: readonly LatLon[], start: LatLon): LatLon[] {
  const out = [...line];
  if (haversineM(start, out[0]) > 0.5) out.unshift(start);
  if (haversineM(start, out[out.length - 1]) > 0.5) out.push(start);
  return out;
}

interface Attempt {
  line: LatLon[];
  lengthM: number;
  snapOk: boolean;
}

export interface GenerateOptions {
  start: LatLon;
  targetM: number;
  router: LoopRouter;
  /** The person's painted streets near the start; null when they have no tracks here. */
  painted: PaintedIndex | null;
  /** Makes the batch reproducible; every batch of a session uses a new one. */
  seed: number;
  count?: number;
  /** Routed length over ring circumference seen so far (the previous batch's answer); `INITIAL_RATIO` when unknown. */
  ratio?: number;
  signal?: AbortSignal;
  /** Called before each loop is tried, `index` counting from 1. */
  onProgress?: (index: number, count: number) => void;
}

export interface GenerateResult {
  /** Best first: on-target loops by novelty, then the near misses. */
  candidates: LoopCandidate[];
  /** Pass to the next batch: how long a routed loop is compared with its ring. */
  ratio: number;
}

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

/** Higher is better. Novelty leads, the loop's own repeats cost double, and a loop nearer the target length wins a tie. */
export function candidateScore(c: Pick<LoopCandidate, 'newShare' | 'repeatShare' | 'lengthError'>): number {
  return (c.newShare ?? 0.5) - 2 * c.repeatShare - 0.5 * Math.abs(c.lengthError);
}

/** On-target loops first, each group best score first. */
export function rankCandidates(candidates: readonly LoopCandidate[]): LoopCandidate[] {
  const onTarget = (c: LoopCandidate) => Math.abs(c.lengthError) <= TOLERANCE;
  return [...candidates].sort((a, b) => {
    const group = Number(onTarget(b)) - Number(onTarget(a));
    return group !== 0 ? group : candidateScore(b) - candidateScore(a);
  });
}

/** One loop: route the ring, rescale it by the length it came out at, route again, up to `MAX_ATTEMPTS` times. */
async function tryOne(
  options: GenerateOptions,
  shape: Shape,
  ratio: { value: number },
  report: { startSnap: number | null },
): Promise<Attempt | null> {
  const { start, targetM, router, signal } = options;
  let circumference = targetM / ratio.value;
  let best: Attempt | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const waypoints = ringWaypoints(start, circumference, shape);
    const routed = await router(waypoints, signal);
    const lengthM = pathLengthM(routed.line);
    if (report.startSnap === null && routed.snapM.length > 0) report.startSnap = routed.snapM[0];
    // The start routed to itself: the ring could not be walked at all.
    if (lengthM < 1) return best;
    ratio.value = lengthM / circumference;
    const snapOk = routed.snapM.length === 0 || routed.snapM.every((d) => d <= MAX_SNAP_M);
    const current: Attempt = { line: closeLoop(routed.line, start), lengthM, snapOk };
    if (snapOk && (best === null || Math.abs(lengthM - targetM) < Math.abs(best.lengthM - targetM))) best = current;
    if (!snapOk) return best;
    if (Math.abs(lengthM - targetM) / targetM <= TOLERANCE) return best;
    circumference = clamp(circumference * (targetM / lengthM), circumference * 0.5, circumference * 2);
  }
  return best;
}

/**
 * A batch of different loops of about `targetM`, ranked. Loops that cannot be routed are skipped; it throws a `LoopError` when none
 * is left (`network` when every request failed, `no_road` when the start has no street, `no_loop` otherwise) and rethrows an abort.
 */
export async function generateLoops(options: GenerateOptions): Promise<GenerateResult> {
  const { targetM, painted, seed, signal, onProgress } = options;
  const count = options.count ?? DEFAULT_COUNT;
  const random = seededRandom(seed);
  const baseBearing = random() * 360;
  const ratio = { value: options.ratio ?? INITIAL_RATIO };
  const report: { startSnap: number | null } = { startSnap: null };

  const found: LoopCandidate[] = [];
  let tries = 0;
  let failures = 0;
  let lastError: unknown;
  for (let i = 0; i < count + EXTRA_TRIES && (i < count || found.length < MIN_WANTED); i++) {
    onProgress?.(Math.min(i + 1, count), count);
    // Spread the ring centres around the compass so the loops differ in direction, not just in detail.
    const bearing = (baseBearing + (i * 360) / count + (random() - 0.5) * 40 + 360) % 360;
    const candidateSeed = (seed + i * 7919) >>> 0;
    tries++;
    let attempt: Attempt | null;
    try {
      attempt = await tryOne(options, shapeFor(candidateSeed, bearing), ratio, report);
    } catch (error) {
      if (isAborted(error) || signal?.aborted) throw error;
      failures++;
      lastError = error;
      if (report.startSnap !== null && report.startSnap > MAX_START_SNAP_M) break;
      continue;
    }
    if (report.startSnap !== null && report.startSnap > MAX_START_SNAP_M) break;
    if (attempt === null) continue;
    const lengthError = attempt.lengthM / targetM - 1;
    if (Math.abs(lengthError) > FALLBACK_TOLERANCE) continue;
    const score = scoreLoop(attempt.line, painted);
    found.push({
      id: String(candidateSeed),
      line: attempt.line,
      lengthM: attempt.lengthM,
      newShare: score.newShare,
      repeatShare: score.repeatShare,
      lengthError,
    });
  }

  if (found.length === 0) {
    if (report.startSnap !== null && report.startSnap > MAX_START_SNAP_M) throw new LoopError('no_road');
    throw new LoopError(failures >= tries ? 'network' : 'no_loop', lastError);
  }
  return { candidates: rankCandidates(found), ratio: ratio.value };
}
