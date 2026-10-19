/** Storage of `prefs.ts` in the phone's key-value store. Local only: neither key is part of the account sync. */
import Storage from 'expo-sqlite/kv-store';

import type { LatLon } from '@/features/routes/map/geometry';

import { parseHome, parsePrefs, serializeHome, type LoopPrefs } from './prefs';

const HOME_KEY = 'joyofit.loops.home';
const PREFS_KEY = 'joyofit.loops.prefs';

export function getHome(): LatLon | null {
  return parseHome(Storage.getItemSync(HOME_KEY));
}

/** Stores the Home point, or forgets it with null. */
export function setHome(home: LatLon | null): void {
  if (home === null) Storage.removeItemSync(HOME_KEY);
  else Storage.setItemSync(HOME_KEY, serializeHome(home));
}

export function getPrefs(): LoopPrefs {
  return parsePrefs(Storage.getItemSync(PREFS_KEY));
}

export function setPrefs(prefs: LoopPrefs): void {
  Storage.setItemSync(PREFS_KEY, JSON.stringify(prefs));
}
