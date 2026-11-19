import { useState } from 'react';

import { haversineM } from '@/features/routes/routeModel';

export interface TrailPoint {
  lat: number;
  lon: number;
}

/** A fix closer than this (metres) to the last trail point is jitter, not movement. */
export const TRAIL_MIN_STEP_M = 6;
/** The trail never holds more points than this: past it every second point goes (the line keeps its shape, the GeoJSON stays small). */
export const TRAIL_MAX_POINTS = 1500;

/** `trail` with `point` added when it is a real step from the last point; the same array when it is not. */
export function appendTrail(trail: readonly TrailPoint[], point: TrailPoint): readonly TrailPoint[] {
  if (
    !Number.isFinite(point.lat) ||
    !Number.isFinite(point.lon) ||
    point.lat < -90 ||
    point.lat > 90 ||
    point.lon < -180 ||
    point.lon > 180
  ) {
    return trail;
  }
  const last = trail[trail.length - 1];
  if (last && haversineM(last, point) < TRAIL_MIN_STEP_M) return trail;
  const next = [...trail, { lat: point.lat, lon: point.lon }];
  if (next.length <= TRAIL_MAX_POINTS) return next;
  return next.filter((_, index) => index % 2 === 0 || index === next.length - 1);
}

/** Converts GeoJSON `[lon, lat]` pairs from native `LiveWorkout.trail` into validated `TrailPoint`s. */
export function fromNativeTrail(nativeTrail?: readonly (readonly [number, number])[] | null): readonly TrailPoint[] {
  if (!nativeTrail || nativeTrail.length === 0) return [];
  const out: TrailPoint[] = [];
  for (const pair of nativeTrail) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const lon = Number(pair[0]);
    const lat = Number(pair[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    out.push({ lat, lon });
  }
  return out;
}

interface TrailState {
  trail: readonly TrailPoint[];
  nativeCount: number;
  lastLat?: number;
  lastLon?: number;
}

/** The path a recording's position has taken since the workout started, for the line on the map. */
export function useTrail(
  position: TrailPoint | null,
  nativeTrail?: readonly (readonly [number, number])[] | null,
): readonly TrailPoint[] {
  const [state, setState] = useState<TrailState>(() => ({
    trail: fromNativeTrail(nativeTrail),
    nativeCount: nativeTrail?.length ?? 0,
    lastLat: position?.lat,
    lastLon: position?.lon,
  }));

  // Native sends the trail every few seconds, not on every push: a push without one leaves the trail as it is.
  const nativeCount = nativeTrail == null ? state.nativeCount : nativeTrail.length;
  const lat = position?.lat;
  const lon = position?.lon;

  const nativeChanged = nativeTrail != null && nativeCount !== state.nativeCount;
  const posChanged = lat !== state.lastLat || lon !== state.lastLon;

  if (nativeChanged || posChanged) {
    let nextTrail = state.trail;
    if (nativeChanged) {
      const recovered = fromNativeTrail(nativeTrail);
      if (recovered.length > 0 || nativeCount < state.nativeCount) {
        nextTrail = recovered;
      }
    }
    if (
      posChanged &&
      lat !== undefined &&
      lon !== undefined &&
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      lat >= -90 &&
      lat <= 90 &&
      lon >= -180 &&
      lon <= 180
    ) {
      nextTrail = appendTrail(nextTrail, { lat, lon });
    }
    setState({
      trail: nextTrail,
      nativeCount,
      lastLat: lat,
      lastLon: lon,
    });
  }

  return state.trail;
}
