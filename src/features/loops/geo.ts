/** Map-independent geometry for the loop planner. Pure: no React, no native modules, so it runs under `bun test`. */
import type { LatLon } from '@/features/routes/map/geometry';
import { haversineM } from '@/features/routes/routeModel';

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Metres per degree of latitude (and of longitude at the equator) on the sphere haversine uses. */
export const M_PER_DEG = (EARTH_RADIUS_M * Math.PI) / 180;

/** The point `distanceM` away from `from` on a great circle that leaves at `bearingDeg` (0 north, 90 east). */
export function destination(from: LatLon, bearingDeg: number, distanceM: number): LatLon {
  const angular = distanceM / EARTH_RADIUS_M;
  const bearing = toRad(bearingDeg);
  const lat1 = toRad(from.lat);
  const lon1 = toRad(from.lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
  const lon2 =
    lon1 + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: toDeg(lat2), lon: ((toDeg(lon2) + 540) % 360) - 180 };
}

/** Length of the line in metres. */
export function pathLengthM(line: readonly LatLon[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += haversineM(line[i - 1], line[i]);
  return total;
}

/**
 * Points along the line every `stepM` metres, the first and the last point always included. A line shorter than the step is
 * its two ends. Each segment is cut where it crosses a multiple of the step, so the spacing is even across the corners.
 */
export function resampleLine(line: readonly LatLon[], stepM: number): LatLon[] {
  if (line.length === 0) return [];
  const out: LatLon[] = [line[0]];
  let carried = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const segment = haversineM(a, b);
    if (segment === 0) continue;
    let at = stepM - carried;
    while (at < segment) {
      const f = at / segment;
      out.push({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f });
      at += stepM;
    }
    carried = segment - (at - stepM);
  }
  const last = line[line.length - 1];
  const end = out[out.length - 1];
  if (end.lat !== last.lat || end.lon !== last.lon) out.push(last);
  return out;
}

/** The box around `center`, `radiusM` metres to every side, as `[south, west, north, east]`. */
export function boxAround(center: LatLon, radiusM: number): [number, number, number, number] {
  const dLat = radiusM / M_PER_DEG;
  const dLon = radiusM / (M_PER_DEG * Math.max(0.05, Math.cos(toRad(center.lat))));
  return [center.lat - dLat, center.lon - dLon, center.lat + dLat, center.lon + dLon];
}

/** A small deterministic generator (mulberry32): the same seed gives the same sequence, in `[0, 1)`. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
