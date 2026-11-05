import type { SQLiteDatabase } from 'expo-sqlite';

import { setCloudState } from '@/db/cloud';

/**
 * "Ready for Strava": after a sync brings a new watch workout, a person who is not connected to Strava (no slot, or released) and
 * uploads by hand gets a notification that opens the workout's manual upload (docs/strava.md section 7). It only says a workout
 * is waiting; nothing is sent anywhere. State lives in `cloud_state` under `strava_` keys, kept when local data is deleted.
 */

/** '1' on, '0' off; unset means on once the person has uploaded by hand at least once (they use the manual upload). */
const SETTING_KEY = 'strava_manual_remind';
/** Highest `workouts.id` already considered: rows above it are workouts that arrived since. */
const SEEN_KEY = 'strava_manual_remind_seen';
/** A workout the watch hands over later than this after it ended (a first sync of old history) is not announced. */
export const REMIND_WINDOW_S = 2 * 24 * 3600;

export interface ReminderWorkout {
  id: number;
  start: number;
  sportName: string;
  distance: number;
}

async function cloudValue(db: SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM cloud_state WHERE key = ?', key);
  return row?.value ?? null;
}

/** Whether the reminder is on: the person's own choice, or, before they chose, whether they have uploaded by hand before. */
export async function getManualReminder(db: SQLiteDatabase): Promise<boolean> {
  const value = await cloudValue(db, SETTING_KEY);
  if (value === '1') return true;
  if (value === '0') return false;
  return (await db.getFirstAsync('SELECT 1 FROM strava_manual_upload LIMIT 1')) !== null;
}

export async function setManualReminder(db: SQLiteDatabase, on: boolean): Promise<void> {
  await setCloudState(db, { [SETTING_KEY]: on ? '1' : '0' });
}

/**
 * The workouts that arrived since the last call and still wait for Strava, newest first: complete watch workouts (not from the
 * Huawei export), ended within `REMIND_WINDOW_S` of `now`, not sent by the API and not marked as uploaded by hand. Every call
 * moves the watermark past all current rows, so a workout is offered at most once. The first call only sets the watermark:
 * turning the reminder on never announces the history already on the phone.
 */
export async function takeNewManualWorkouts(db: SQLiteDatabase, now: number = Math.floor(Date.now() / 1000)): Promise<ReminderWorkout[]> {
  const top = (await db.getFirstAsync<{ id: number | null }>('SELECT MAX(id) AS id FROM workouts'))?.id ?? 0;
  const seen = await cloudValue(db, SEEN_KEY);
  if (seen === null || Number(seen) >= top) {
    if (seen === null || Number(seen) > top) await setCloudState(db, { [SEEN_KEY]: String(top) });
    return [];
  }
  const rows = await db.getAllAsync<ReminderWorkout>(
    `SELECT w.id AS id, w.start AS start, w.sport_name AS sportName, w.distance AS distance
     FROM workouts w
       LEFT JOIN strava_upload u ON u.workout_start = w.start
       LEFT JOIN strava_manual_upload m ON m.workout_start = w.start
     WHERE w.id > ? AND w.id <= ? AND w.complete != 0 AND w.imported = 0 AND w."end" > ?
       AND m.workout_start IS NULL AND (u.workout_start IS NULL OR u.status NOT IN ('done', 'processing'))
     ORDER BY w.start DESC`,
    Number(seen),
    top,
    now - REMIND_WINDOW_S,
  );
  await setCloudState(db, { [SEEN_KEY]: String(top) });
  return rows;
}
