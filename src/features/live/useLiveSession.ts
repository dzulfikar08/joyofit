import Storage from 'expo-sqlite/kv-store';
import { useMemo, useSyncExternalStore } from 'react';

import { useLiveWorkout } from '@/state/LiveWorkoutProvider';
import type { LiveWorkout } from '@/wear';

import { deriveSession, type LiveSession, type SportKind } from './liveSession';

/** The kind picked for the last workout the band did not name: the guess for the next one (`deriveSportKind`). */
const LAST_PICK_KEY = 'joyofit.live.lastSportKind';
const PICKABLE: readonly SportKind[] = ['run', 'walk', 'ride', 'hike'];

function readLastPick(): SportKind | null {
  try {
    const value = Storage.getItemSync(LAST_PICK_KEY);
    return PICKABLE.find((kind) => kind === value) ?? null;
  } catch {
    return null;
  }
}

/** The kind the person picked for a workout the band did not name, by session id (`setSportKind`). Lives as long as the app does. */
let picked: ReadonlyMap<number, SportKind> = new Map();
let lastPick: SportKind | null = readLastPick();
const listeners = new Set<() => void>();

/**
 * Lets the person say what an outdoor workout the band did not name is (run, walk, ride, hike). It is no longer a guess then, and it is the
 * guess for the next such workout.
 */
export function setSportKind(id: number, kind: SportKind): void {
  picked = new Map(picked).set(id, kind);
  lastPick = kind;
  try {
    Storage.setItemSync(LAST_PICK_KEY, kind);
  } catch {
    // Only the next guess is lost.
  }
  for (const l of listeners) l();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => picked;

/** Read the clock outside render: the session is derived when the inputs change, not on every render. */
function deriveNow(live: LiveWorkout, choice: SportKind | null): LiveSession {
  return deriveSession(live, choice, Date.now(), lastPick);
}

/** The workout followed on the watch, in the shape the live screens read (`liveSession.ts`); null when none. */
export function useLiveSession(): LiveSession | null {
  const live = useLiveWorkout();
  const choices = useSyncExternalStore(subscribe, snapshot);
  return useMemo(() => (live ? deriveNow(live, choices.get(live.id) ?? null) : null), [live, choices]);
}
