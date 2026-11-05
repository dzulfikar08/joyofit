import type { WatchAlarm, WatchAlarmsUpdate, WatchSmartAlarm } from '@/wear';

/** Pure parts of the alarm backup (no storage), so they can be tested without React Native. See `alarmBackup.ts`. */
const MAX_SLOTS = 5;

/** What a backup holds: the event alarms and the smart alarm, without the read-time capability flags. */
export interface AlarmBackup {
  event: WatchAlarm[];
  smart: WatchSmartAlarm | null;
}

function isAlarm(value: unknown): value is WatchAlarm {
  if (typeof value !== 'object' || value === null) return false;
  const a = value as Record<string, unknown>;
  return (
    typeof a.slot === 'number' && a.slot >= 1 && a.slot <= MAX_SLOTS &&
    typeof a.enabled === 'boolean' &&
    typeof a.hour === 'number' && a.hour >= 0 && a.hour <= 23 &&
    typeof a.minute === 'number' && a.minute >= 0 && a.minute <= 59 &&
    typeof a.repeat === 'number' &&
    typeof a.name === 'string'
  );
}

/** Only the fields the watch takes, alarms sorted by slot, so the same alarms always make the same document. */
export function normalizeBackup(alarms: Pick<WatchAlarmsUpdate, 'event' | 'smart'>): AlarmBackup {
  const event = alarms.event
    .filter(isAlarm)
    .map(({ slot, enabled, hour, minute, repeat, name }) => ({ slot, enabled, hour, minute, repeat, name }))
    .sort((a, b) => a.slot - b.slot);
  return { event, smart: alarms.smart?.enabled ? alarms.smart : null };
}

/** True when there is something worth keeping: at least one alarm, or a smart alarm that is on. */
export function hasAlarms(alarms: Pick<WatchAlarmsUpdate, 'event' | 'smart'>): boolean {
  return alarms.event.length > 0 || alarms.smart?.enabled === true;
}

/** Offer to put the backup back when the watch holds no alarms and the backup does. */
export function shouldOfferRestore(onWatch: Pick<WatchAlarmsUpdate, 'event' | 'smart'>, backup: AlarmBackup | null): boolean {
  return backup !== null && hasAlarms(backup) && !hasAlarms(onWatch);
}

/** Parses a stored or pulled document; null for anything that is not a usable backup. */
export function parseBackup(value: unknown): AlarmBackup | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.event) || !v.event.every(isAlarm) || v.event.length > MAX_SLOTS) return null;
  const smart = v.smart === null || v.smart === undefined ? null : (v.smart as WatchSmartAlarm);
  return normalizeBackup({ event: v.event as WatchAlarm[], smart });
}
