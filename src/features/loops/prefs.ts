/** What the loop planner remembers on the phone: the saved Home point and the last choices. Pure parsing; `prefsStore.ts` does the storage. */
import type { LatLon } from '@/features/routes/map/geometry';
import { isUsableCoordinate } from '@/features/routes/routeModel';

import { TARGET_MODES, type LoopActivity, type TargetMode } from './targets';

export type StartFrom = 'here' | 'home';

export interface LoopPrefs {
  activity: LoopActivity;
  mode: TargetMode;
  /** The target in the unit of `mode`; null until the person picks one (the planner then starts at a default). */
  value: number | null;
  startFrom: StartFrom;
}

export const DEFAULT_PREFS: LoopPrefs = { activity: 'walk', mode: 'steps', value: null, startFrom: 'here' };

function record(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The saved Home point; null when none is stored or the stored text is damaged. */
export function parseHome(raw: string | null): LatLon | null {
  const value = record(raw);
  const lat = value?.lat;
  const lon = value?.lon;
  return typeof lat === 'number' && typeof lon === 'number' && isUsableCoordinate(lat, lon) ? { lat, lon } : null;
}

export function serializeHome(home: LatLon): string {
  // 5 decimals is about a metre: more would only say that this is exactly where the person lives.
  return JSON.stringify({ lat: Number(home.lat.toFixed(5)), lon: Number(home.lon.toFixed(5)) });
}

/** The stored choices; every field that is missing or not valid falls back to its default. */
export function parsePrefs(raw: string | null): LoopPrefs {
  const value = record(raw);
  if (!value) return DEFAULT_PREFS;
  const { activity, mode, value: target, startFrom } = value;
  return {
    activity: activity === 'run' ? 'run' : 'walk',
    mode: TARGET_MODES.find((m) => m === mode) ?? DEFAULT_PREFS.mode,
    value: typeof target === 'number' && Number.isFinite(target) && target > 0 ? target : null,
    startFrom: startFrom === 'home' ? 'home' : 'here',
  };
}
