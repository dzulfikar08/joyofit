import type { SQLiteDatabase } from 'expo-sqlite';

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
