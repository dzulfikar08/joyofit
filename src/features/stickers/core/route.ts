/** GPS routes: decode, privacy trim, projection and simplification. Pure math. */

export type LatLng = [lat: number, lng: number];
export type XY = [x: number, y: number];

const EARTH_R = 6371008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Google encoded polyline (precision 5), tolerant of truncated input. */
export function decodePolyline(encoded: string): LatLng[] {
  const out: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const readValue = (): number | null => {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (index >= encoded.length) return null;
      const b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
      if (b < 0x20) break;
      if (shift > 30) return null;
    }
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    const dLat = readValue();
    const dLng = readValue();
    if (dLat === null || dLng === null) break;
    lat += dLat;
    lng += dLng;
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}

/** Accepts `[lat,lng][]` (numbers or numeric strings) or an encoded polyline; drops invalid points. */
export function readRoute(raw: unknown): LatLng[] {
  if (typeof raw === "string") return decodePolyline(raw).filter(validPoint);
  if (!Array.isArray(raw)) return [];
  const out: LatLng[] = [];
  for (const p of raw) {
    if (Array.isArray(p) && p.length >= 2) {
      const lat = Number(p[0]);
      const lng = Number(p[1]);
      if (validPoint([lat, lng])) out.push([lat, lng]);
    }
  }
  return out;
}

function validPoint(p: LatLng): boolean {
  return Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;
}

export function haversine(a: LatLng, b: LatLng): number {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function routeLength(points: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversine(points[i - 1]!, points[i]!);
  return total;
}

function lerp(a: LatLng, b: LatLng, t: number): LatLng {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * Removes `startM` from the beginning and `endM` from the end (privacy around home).
 * Returns null when what is left is shorter than `minLeftM` or has fewer than 2 points.
 */
export function trimRoute(points: LatLng[], startM: number, endM: number, minLeftM = 50): LatLng[] | null {
  if (points.length < 2) return null;
  if (startM <= 0 && endM <= 0) return points.length >= 2 && routeLength(points) >= minLeftM ? points : null;
  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1]! + haversine(points[i - 1]!, points[i]!));
  const total = cum[cum.length - 1]!;
  const from = Math.max(0, startM);
  const to = total - Math.max(0, endM);
  if (to - from < minLeftM) return null;
  const at = (dist: number): { point: LatLng; index: number } => {
    for (let i = 1; i < cum.length; i++) {
      if (cum[i]! >= dist) {
        const span = cum[i]! - cum[i - 1]!;
        const t = span === 0 ? 0 : (dist - cum[i - 1]!) / span;
        return { point: lerp(points[i - 1]!, points[i]!, t), index: i };
      }
    }
    return { point: points[points.length - 1]!, index: points.length };
  };
  const first = at(from);
  const last = at(to);
  const middle = points.slice(first.index, last.index);
  const out = [first.point, ...middle, last.point];
  return out.length >= 2 ? out : null;
}

/** Equirectangular projection fitted into `w x h` with `padding`, aspect preserved, centered. */
export function projectRoute(
  points: LatLng[],
  w: number,
  h: number,
  padding: number,
): { points: XY[]; scale: number } | null {
  if (points.length < 2) return null;
  const meanLat = points.reduce((s, p) => s + p[0], 0) / points.length;
  const kx = Math.cos(rad(meanLat));
  const raw: XY[] = points.map((p) => [p[1] * kx, -p[0]]);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of raw) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const innerW = Math.max(1, w - padding * 2);
  const innerH = Math.max(1, h - padding * 2);
  if (spanX === 0 && spanY === 0) return null;
  const scale = Math.min(spanX === 0 ? Infinity : innerW / spanX, spanY === 0 ? Infinity : innerH / spanY);
  const offX = (w - spanX * scale) / 2;
  const offY = (h - spanY * scale) / 2;
  return {
    points: raw.map(([x, y]): XY => [offX + (x - minX) * scale, offY + (y - minY) * scale]),
    scale,
  };
}

/** Douglas-Peucker; keeps endpoints. */
export function simplify(points: XY[], epsilon: number): XY[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    let worst = 0;
    let index = -1;
    const [ax, ay] = points[lo]!;
    const [bx, by] = points[hi]!;
    const len = Math.hypot(bx - ax, by - ay);
    for (let i = lo + 1; i < hi; i++) {
      const [px, py] = points[i]!;
      const dist =
        len === 0
          ? Math.hypot(px - ax, py - ay)
          : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
      if (dist > worst) {
        worst = dist;
        index = i;
      }
    }
    if (index !== -1 && worst > epsilon) {
      keep[index] = 1;
      stack.push([lo, index], [index, hi]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}
