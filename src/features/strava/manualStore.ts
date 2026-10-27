import type { SQLiteDatabase } from 'expo-sqlite';

import { setCloudState } from '@/db/cloud';
import { parseManualRoute, type ManualRoute } from '@/features/strava/manualUpload';

/**
 * Workouts the person marked as uploaded to Strava by hand ("Already uploaded" after the manual upload). Local only, keyed by the
 * workout's start like `strava_upload`, and apart from it: that table is the API upload's own state (wiped when the connection
 * goes or changes athlete, and its rows decide what the automatic upload sends), while this mark is only what the person said.
 * Nothing here is read from Strava. Deleting a workout keeps the mark, like `strava_upload`, so a row the watch brings back still
 * says it is on Strava.
 */
const SCHEMA = `CREATE TABLE IF NOT EXISTS strava_manual_upload (
  workout_start INTEGER PRIMARY KEY NOT NULL, marked_at INTEGER NOT NULL)`;

export async function ensureStravaManualSchema(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(SCHEMA);
}

/** Unix seconds the workout was marked as uploaded by hand; null when it was not. */
export async function getManualUploadMark(db: SQLiteDatabase, workoutStart: number): Promise<number | null> {
  const row = await db.getFirstAsync<{ markedAt: number }>(
    'SELECT marked_at AS markedAt FROM strava_manual_upload WHERE workout_start = ?',
    workoutStart,
  );
  return row?.markedAt ?? null;
}

export async function markManualUpload(db: SQLiteDatabase, workoutStart: number, at: number = Math.floor(Date.now() / 1000)): Promise<number> {
  await db.runAsync(
    `INSERT INTO strava_manual_upload (workout_start, marked_at) VALUES (?, ?)
     ON CONFLICT (workout_start) DO UPDATE SET marked_at = excluded.marked_at`,
    workoutStart,
    at,
  );
  return at;
}

export async function clearManualUploadMark(db: SQLiteDatabase, workoutStart: number): Promise<void> {
  await db.runAsync('DELETE FROM strava_manual_upload WHERE workout_start = ?', workoutStart);
}

/**
 * The last way the person chose to upload by hand (`ManualRoute`), offered first next time. In `cloud_state` under a `strava_` key,
 * which deleting local data keeps, like the other Strava choices.
 */
const ROUTE_KEY = 'strava_manual_route';

export async function getManualRoute(db: SQLiteDatabase): Promise<ManualRoute> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM cloud_state WHERE key = ?', ROUTE_KEY);
  return parseManualRoute(row?.value);
}

export async function setManualRoute(db: SQLiteDatabase, route: ManualRoute): Promise<void> {
  await setCloudState(db, { [ROUTE_KEY]: route });
}
