/** Which loops are on offer for one target and start point. Pure. */
import type { LatLon } from '@/features/routes/map/geometry';

import type { LoopCandidate } from './generate';
import type { LoopActivity } from './targets';

export interface Pool {
  /** `poolKey` of the plan the loops were made for. */
  key: string;
  /** Best first. */
  candidates: readonly LoopCandidate[];
  /** The loop on the map. */
  at: number;
}

/** Loops are reused only for the same start (to about a metre), the same length (to 50 m) and the same activity. */
export function poolKey(start: LatLon, targetM: number, activity: LoopActivity): string {
  return `${activity}:${start.lat.toFixed(5)},${start.lon.toFixed(5)}:${Math.round(targetM / 50) * 50}`;
}

/** The loop to show for `key`, or null when the pool belongs to another plan. */
export function currentLoop(pool: Pool | null, key: string | null): LoopCandidate | null {
  return pool !== null && key !== null && pool.key === key ? (pool.candidates[pool.at] ?? null) : null;
}

/** The next loop of the same plan, or null when every loop has been shown and a new batch is needed. */
export function advance(pool: Pool, key: string): Pool | null {
  if (pool.key !== key || pool.at + 1 >= pool.candidates.length) return null;
  return { ...pool, at: pool.at + 1 };
}
