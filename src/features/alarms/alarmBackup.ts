import Storage from 'expo-sqlite/kv-store';

import { notePrefChanged } from '@/cloud/prefsSync';
import type { WatchAlarmsUpdate } from '@/wear';

import { hasAlarms, normalizeBackup, parseBackup, type AlarmBackup } from './alarmBackupModel';

export { hasAlarms, normalizeBackup, parseBackup, shouldOfferRestore, type AlarmBackup } from './alarmBackupModel';

/**
 * A copy of the watch's alarms kept on the phone (kv `joyofit.alarmBackup`) and, for Pro, in the account (synced pref
 * `watch.alarms`). Alarms live on the watch: a factory reset, or pairing with a new phone, leaves the watch with none. The
 * copy is only ever taken from a watch that has alarms, so an emptied watch never overwrites it, and it is only put back
 * on a watch when the person taps Restore: a pulled copy from another phone never changes a watch by itself.
 */
export const ALARM_BACKUP_PREF = 'watch.alarms';
const KEY = 'joyofit.alarmBackup';
export function alarmBackup(): AlarmBackup | null {
  const raw = Storage.getItemSync(KEY);
  if (!raw) return null;
  try {
    return parseBackup(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Stores a pulled or read backup as it is (null removes it). */
export function storeAlarmBackup(backup: AlarmBackup | null): void {
  if (!backup || !hasAlarms(backup)) Storage.removeItemSync(KEY);
  else Storage.setItemSync(KEY, JSON.stringify(backup));
}

/** Called with what the watch reported: keeps it when the watch has alarms, ignores an empty (reset) watch. */
export function rememberAlarms(onWatch: Pick<WatchAlarmsUpdate, 'event' | 'smart'>): void {
  if (!hasAlarms(onWatch)) return;
  const next = normalizeBackup(onWatch);
  const current = alarmBackup();
  if (current && JSON.stringify(current) === JSON.stringify(next)) return;
  storeAlarmBackup(next);
  void notePrefChanged(ALARM_BACKUP_PREF);
}
