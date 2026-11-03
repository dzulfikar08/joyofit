import { haversineM, type CleanFix } from './geo';
import type { WatchDistance } from './series';
import type { LatLon } from './types';

/** A gap between fixes still joins them when it is short in time or in distance (the same rule as the shared grid's track). */
const GAP_SEC = 30;
const GAP_M = 40;

export interface RouteKm {
  /** Whole kilometre, 1-based, of the watch's distance. */
  km: number;
  pos: LatLon;
}

/**
 * The route at the recording's own resolution: every cleaned GPS fix, one polyline per uninterrupted stretch, and where each
 * whole kilometre falls on it. Phone only (the shared grid's 600-sample track is what the cloud copy and the posts carry);
 * the map simplifies it per zoom, so the point count here does not cost drawing time.
 */
export interface RouteDetail {
  segments: LatLon[][];
  /** Seconds since the workout start of every position in `segments` (same shape): the series' time axis, so a fix finds its sample. */
  secs: number[][];
  kms: RouteKm[];
}

function joined(a: CleanFix, b: CleanFix): boolean {
  return b.ts - a.ts < GAP_SEC || haversineM(a.lat, a.lon, b.lat, b.lon) < GAP_M;
}

/**
 * Builds the route from the grid's cleaned fixes. `watch` maps the fixes' path length to the watch's distance (without it
 * the path itself is the distance), so a km pill sits where the splits and the charts say the kilometre ends. Kilometres
 * the watch covered before the first fix or after the last one have no position and get no pill. `start` is the workout's
 * start (unix seconds), the origin of the series grid. Null without a track.
 */
export function routeDetail(fixes: readonly CleanFix[], watch: WatchDistance | null, start: number): RouteDetail | null {
  if (fixes.length < 2) return null;
  const segments: LatLon[][] = [];
  const secs: number[][] = [];
  const kms: RouteKm[] = [];
  const lead = watch?.lead ?? 0;
  const scale = watch?.scale ?? 1;
  let current: LatLon[] = [[fixes[0].lat, fixes[0].lon]];
  let currentSecs: number[] = [fixes[0].ts - start];
  // The first kilometre mark past the first fix: those before it were covered without a position.
  let next = Math.floor(lead / 1000) + 1;
  for (let i = 1; i < fixes.length; i++) {
    const a = fixes[i - 1];
    const b = fixes[i];
    const link = joined(a, b);
    if (!link) {
      segments.push(current);
      secs.push(currentSecs);
      current = [];
      currentSecs = [];
    }
    current.push([b.lat, b.lon]);
    currentSecs.push(b.ts - start);
    const d0 = lead + scale * a.dist;
    const d1 = lead + scale * b.dist;
    while (d1 >= next * 1000 && d0 < next * 1000) {
      const f = d1 > d0 ? (next * 1000 - d0) / (d1 - d0) : 0;
      kms.push({ km: next, pos: link ? [a.lat + (b.lat - a.lat) * f, a.lon + (b.lon - a.lon) * f] : [b.lat, b.lon] });
      next += 1;
    }
  }
  segments.push(current);
  secs.push(currentSecs);
  return { segments, secs, kms };
}
