import Storage from 'expo-sqlite/kv-store';

import { notePrefChanged } from '@/cloud/prefsSync';

import { userEnergyProfile } from '@/features/strength/profile';
import { userMaxHr } from '@/features/hrzones/settings';

import { FTP_MAX_W, FTP_MIN_W } from './power';
import type { RideProfile } from './types';

const FTP_KEY = 'joyofit.ftpW';
const EBIKE_PREFIX = 'joyofit.ebike.';

export { FTP_MAX_W, FTP_MIN_W, parseFtp } from './power';

/** Functional threshold power set by the person (Settings > Bersepeda), watts; null when none. */
export function getFtp(): number | null {
  const value = Number(Storage.getItemSync(FTP_KEY));
  return Number.isFinite(value) && value >= FTP_MIN_W && value <= FTP_MAX_W ? Math.round(value) : null;
}

/** Stores the FTP, or clears it with null. A value outside the plausible range is clamped into it. */
export function setFtp(watts: number | null): void {
  if (watts === null) Storage.removeItemSync(FTP_KEY);
  else Storage.setItemSync(FTP_KEY, String(Math.round(Math.min(FTP_MAX_W, Math.max(FTP_MIN_W, watts)))));
  void notePrefChanged('ftp');
}

/**
 * Whether the person marked this ride (by its start, unix seconds) as an e-bike ride. Kept per device in the key-value store, not in
 * `summary_json`: the watch sync rewrites that column, and a mark is the person's, not the recorder's.
 */
export function isEbike(workoutStart: number): boolean {
  return Storage.getItemSync(`${EBIKE_PREFIX}${workoutStart}`) === '1';
}

export function setEbike(workoutStart: number, on: boolean): void {
  if (on) Storage.setItemSync(`${EBIKE_PREFIX}${workoutStart}`, '1');
  else Storage.removeItemSync(`${EBIKE_PREFIX}${workoutStart}`);
}

/** Everything the ride analysis needs to know about the person. */
export function rideProfile(): RideProfile {
  const energy = userEnergyProfile();
  return { weightKg: energy.weightKg, age: energy.age, sex: energy.sex, vo2max: energy.vo2max, maxHr: userMaxHr(), ftp: getFtp() };
}
