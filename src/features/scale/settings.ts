import Storage from 'expo-sqlite/kv-store';

import { DEFAULT_GUARD_PERCENT } from './guard';

const AUTO_KEY = 'joyofit.scale.auto';
const GUARD_KEY = 'joyofit.scale.guardPercent';
const ROGO_KEY = 'joyofit.scale.rogo';

/** Catch a weigh-in whenever the app is open and the scale speaks (default on once a scale is picked). */
export function getAutoCapture(): boolean {
  return Storage.getItemSync(AUTO_KEY) !== '0';
}

export function setAutoCapture(on: boolean): void {
  Storage.setItemSync(AUTO_KEY, on ? '1' : '0');
}

/** Percent away from the last weight that makes the app ask "Ini kamu?"; 0 = never ask. */
export function getGuardPercent(): number {
  const raw = Storage.getItemSync(GUARD_KEY);
  if (raw === null) return DEFAULT_GUARD_PERCENT;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 50 ? value : DEFAULT_GUARD_PERCENT;
}

export function setGuardPercent(percent: number): void {
  Storage.setItemSync(GUARD_KEY, String(Math.min(50, Math.max(0, Math.round(percent)))));
}

/** Send weigh-ins to JoyoRogo's weight log (default on; it only happens while signed in). */
export function getPushToRogo(): boolean {
  return Storage.getItemSync(ROGO_KEY) !== '0';
}

export function setPushToRogo(on: boolean): void {
  Storage.setItemSync(ROGO_KEY, on ? '1' : '0');
}
