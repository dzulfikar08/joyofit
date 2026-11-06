/**
 * The map view of the watch app (`map` message, `protocol/watch-nav.schema.json`): the stretch of the route around the wearer, in whole
 * metres, already turned so that straight ahead is up. The watch only scales and draws it (lite JS has no map engine, and every message
 * must stay under 1000 bytes), so all the geometry is here. Pure.
 *
 * Frame: origin = the wearer, x = metres to the right, y = metres ahead. The route is taken from `behindM` back to `aheadM` forward along
 * the line, cut where it leaves a box of `clipFactor * r` around the wearer, then thinned (Douglas-Peucker) to at most `maxPoints`.
 */
import type { RouteIndex } from '@/features/bikecomputer/nav/routeIndex';

const M_PER_DEG = 111_194.93;

export interface MapFrameOptions {
  /** View radius the watch scales to, metres: about the distance from the wearer to the top edge. */
  r: number;
  maxPoints: number;
}

/** Without the envelope; `tx`/`ty` = the current maneuver, when it is within the frame. */
export interface MapFrame {
  t: 'map';
  r: number;
  p: number[];
  tx?: number;
  ty?: number;
}

export interface Planar {
  x: number;
  y: number;
}

/** A lat/lon in the route index's planar metres. */
export function toPlanar(index: RouteIndex, lat: number, lon: number): Planar {
  return { x: (lon - index.lon0) * index.cosLat0 * M_PER_DEG, y: (lat - index.lat0) * M_PER_DEG };
}

/** The point `atM` metres along the line, planar. */
export function pointAtM(index: RouteIndex, atM: number): Planar {
  const { cumM, xs, ys } = index;
  const n = cumM.length;
  if (n === 1 || atM <= 0) return { x: xs[0]!, y: ys[0]! };
  if (atM >= cumM[n - 1]!) return { x: xs[n - 1]!, y: ys[n - 1]! };
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumM[mid]! <= atM) lo = mid;
    else hi = mid;
  }
  const span = cumM[hi]! - cumM[lo]!;
  const f = span > 0 ? (atM - cumM[lo]!) / span : 0;
  return { x: xs[lo]! + (xs[hi]! - xs[lo]!) * f, y: ys[lo]! + (ys[hi]! - ys[lo]!) * f };
}

/** Heading of the line at `atM` (0 = north, clockwise, degrees), from the stretch `lookM` ahead; null on a line with no length there. */
export function lineHeadingDeg(index: RouteIndex, atM: number, lookM = 25): number | null {
  const a = pointAtM(index, Math.min(atM, index.totalM - 1));
  const b = pointAtM(index, Math.min(atM + lookM, index.totalM));
  return planarHeading(a, b);
}

/** Heading from a to b in degrees (0 = north = +y, clockwise), or null when they are under 1 m apart. */
export function planarHeading(a: Planar, b: Planar): number | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.hypot(dx, dy) < 1) return null;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

/** Smallest difference between two headings, 0..180. */
export function headingDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Douglas-Peucker; keeps the first and last point. */
function simplify(pts: Planar[], tolerance: number): Planar[] {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    const a = pts[first]!;
    const b = pts[last]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    let worst = -1;
    let worstD = tolerance;
    for (let i = first + 1; i < last; i++) {
      const p = pts[i]!;
      const d = len === 0 ? Math.hypot(p.x - a.x, p.y - a.y) : Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len;
      if (d > worstD) {
        worst = i;
        worstD = d;
      }
    }
    if (worst > 0) {
      keep[worst] = 1;
      stack.push([first, worst], [worst, last]);
    }
  }
  return pts.filter((_, i) => keep[i] === 1);
}

/**
 * The frame for a wearer at `pos` (planar) heading `headingDeg`, matched `atM` along the line; `turnAtM` = the current maneuver.
 * Returns a frame with an empty `p` when no part of the route is near.
 */
export function buildMapFrame(
  index: RouteIndex,
  pos: Planar,
  headingDeg: number,
  atM: number,
  turnAtM: number | null,
  options: MapFrameOptions,
): MapFrame {
  const { r, maxPoints } = options;
  const behindM = r * 0.6;
  const aheadM = r * 3;
  const box = r * 1.6;
  const rad = (headingDeg * Math.PI) / 180;
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);
  // Rotate the world by -heading: the heading direction (sin, cos) becomes +y.
  const local = (p: Planar): Planar => {
    const dx = p.x - pos.x;
    const dy = p.y - pos.y;
    return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
  };
  const inBox = (p: Planar) => Math.abs(p.x) <= box && Math.abs(p.y) <= box;

  const { cumM } = index;
  const from = Math.max(0, atM - behindM);
  const to = Math.min(index.totalM, atM + aheadM);
  const pts: Planar[] = [local(pointAtM(index, from))];
  for (let i = 0; i < cumM.length; i++) {
    const m = cumM[i]!;
    if (m <= from) continue;
    if (m >= to) break;
    pts.push(local({ x: index.xs[i]!, y: index.ys[i]! }));
  }
  pts.push(local(pointAtM(index, to)));

  // Keep the run around the wearer: cut the line where it leaves the box, keeping one point outside so the line reaches the edge.
  const nearest = pts.reduce((best, p, i) => (Math.hypot(p.x, p.y) < Math.hypot(pts[best]!.x, pts[best]!.y) ? i : best), 0);
  let start = nearest;
  while (start > 0 && inBox(pts[start - 1]!)) start--;
  if (start > 0) start--;
  let end = nearest;
  while (end < pts.length - 1 && inBox(pts[end + 1]!)) end++;
  if (end < pts.length - 1) end++;
  let run = pts.slice(start, end + 1);
  if (!run.some(inBox)) run = [];

  let tolerance = r / 80;
  let thin = simplify(run, tolerance);
  while (thin.length > maxPoints) {
    tolerance *= 1.5;
    thin = simplify(run, tolerance);
  }

  const frame: MapFrame = { t: 'map', r: Math.round(r), p: [] };
  for (const p of thin) frame.p.push(Math.round(p.x), Math.round(p.y));
  if (turnAtM !== null) {
    const turn = local(pointAtM(index, turnAtM));
    if (inBox(turn)) {
      frame.tx = Math.round(turn.x);
      frame.ty = Math.round(turn.y);
    }
  }
  return frame;
}
