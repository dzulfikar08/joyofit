import type { SQLiteDatabase } from 'expo-sqlite';

import { setCloudState } from '@/db/cloud';
import { duplicateOf, plainStravaError } from '@/features/strava/activityFile';

/**
 * Local Strava bookkeeping. The connection itself (tokens) lives on the Worker; the phone keeps only what it needs to
 * decide and to show: when the account connected (`cloud_state.strava_connected_at`, unix seconds), the athlete it
 * belongs to, the "add link" choice, and one `strava_upload` row per workout it tried to send (migration 11).
 */
export type StravaUploadStatus =
  /** Strava accepted the file and is still processing it (`upload_id` set); polling resumes next time. */
  | 'processing'
  /** The activity exists on Strava (`activity_id` set), uploaded now or found as a duplicate. */
  | 'done'
  /** A transient failure (network, 429, 5xx); automatic uploads retry a few times, the button retries any time. */
  | 'failed'
  /** Strava refused the file. Automatic uploads give up; only the button tries again. */
  | 'rejected';

export interface StravaUploadRow {
  workoutStart: number;
  status: StravaUploadStatus;
  uploadId: number | null;
  activityId: number | null;
  error: string | null;
  attempts: number;
  updatedAt: number;
}

/** Automatic uploads stop retrying a workout after this many failed attempts. */
export const MAX_AUTO_ATTEMPTS = 3;

export interface StravaSettings {
  /** Unix seconds the account connected; null = not connected. */
  connectedAt: number | null;
  athleteId: number | null;
  /** Put `fit.joyorogo.com` in the description of uploaded activities. Off by default. */
  addLink: boolean;
  /** Name the recording watch in the description of uploaded activities, the way Huawei Health does. On by default. */
  addDevice: boolean;
  /** The grant has `profile:read_all` (the athlete agreed to let JoyoFit list their Strava shoes and bikes). */
  gearScope: boolean;
  /**
   * Offer the manual upload on Strava's own page (`features/strava/manualUpload.ts`): the Worker's `manualUpload` switch, on while
   * the shared Strava application is short of athlete capacity. The last value the Worker gave, so signed out and offline keep it;
   * on until the Worker has said otherwise.
   */
  manualUpload: boolean;
}

export async function getStravaSettings(db: SQLiteDatabase): Promise<StravaSettings> {
  const rows = await db.getAllAsync<{ key: string; value: string }>("SELECT key, value FROM cloud_state WHERE key LIKE 'strava_%'");
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const connectedAt = Number(map.get('strava_connected_at'));
  const athleteId = Number(map.get('strava_athlete_id'));
  return {
    connectedAt: Number.isFinite(connectedAt) && connectedAt > 0 ? connectedAt : null,
    athleteId: Number.isFinite(athleteId) && athleteId > 0 ? athleteId : null,
    addLink: map.get('strava_add_link') === '1',
    addDevice: map.get('strava_add_device') !== '0',
    gearScope: map.get('strava_gear_scope') === '1',
    manualUpload: map.get('strava_manual_upload') !== '0',
  };
}

export function setStravaAddLink(db: SQLiteDatabase, on: boolean): Promise<void> {
  return setCloudState(db, { strava_add_link: on ? '1' : '0' });
}

export function setStravaAddDevice(db: SQLiteDatabase, on: boolean): Promise<void> {
  return setCloudState(db, { strava_add_device: on ? '1' : '0' });
}

/** Keeps the Worker's manual upload switch; a Worker that does not send it (`undefined`) leaves the last value. */
export async function applyManualUploadSwitch(db: SQLiteDatabase, manualUpload: boolean | undefined): Promise<void> {
  if (manualUpload !== undefined) await setCloudState(db, { strava_manual_upload: manualUpload ? '1' : '0' });
}

/**
 * Records what the server says about the connection. A different athlete (or a reconnect, which moves
 * `connected_at`) starts over: upload rows of the previous connection say nothing about the new account.
 */
export async function applyStravaConnection(
  db: SQLiteDatabase,
  status: { connected: boolean; athleteId?: number; connectedAt?: number; gearScope?: boolean },
): Promise<void> {
  const before = await getStravaSettings(db);
  if (!status.connected || status.connectedAt === undefined || status.athleteId === undefined) {
    if (before.connectedAt !== null) {
      await setCloudState(db, { strava_connected_at: null, strava_athlete_id: null, strava_gear_scope: null });
      await db.runAsync('DELETE FROM strava_upload');
      await db.runAsync('DELETE FROM strava_gear_sent');
    }
    return;
  }
  if (before.athleteId !== null && before.athleteId !== status.athleteId) {
    await db.runAsync('DELETE FROM strava_upload');
    await db.runAsync('DELETE FROM strava_gear_sent');
  }
  await setCloudState(db, {
    strava_connected_at: String(status.connectedAt),
    strava_athlete_id: String(status.athleteId),
    strava_gear_scope: status.gearScope ? '1' : null,
  });
}

const UPLOAD_COLUMNS = `workout_start AS workoutStart, status, upload_id AS uploadId, activity_id AS activityId, error,
  attempts, updated_at AS updatedAt`;

/**
 * The stored row, as the screens should show it. Builds before 2026-10-21 saved Strava's "duplicate of <a href=...>"
 * answer as a refusal (the link form was not recognised): that row is the activity Strava already has, so it reads as
 * `done`, and any other stored refusal is shown without the HTML Strava embeds.
 */
export async function getStravaUpload(db: SQLiteDatabase, workoutStart: number): Promise<StravaUploadRow | null> {
  const row = await db.getFirstAsync<StravaUploadRow>(`SELECT ${UPLOAD_COLUMNS} FROM strava_upload WHERE workout_start = ?`, workoutStart);
  if (!row || row.status === 'done' || row.error === null) return row;
  const existing = duplicateOf(row.error);
  if (existing !== null) return { ...row, status: 'done', activityId: existing, error: null };
  return { ...row, error: plainStravaError(row.error) };
}

export interface StravaUploadSummary {
  /** Unix seconds the newest upload reached Strava; null when none ever did from this phone. */
  lastDoneAt: number | null;
  /** Uploads that reached Strava since `sinceSec`. */
  done: number;
  /** Uploads Strava refused or that failed since `sinceSec` (a retry that later succeeded counts as done, not failed). */
  failed: number;
}

/** What the Sources screen says about Strava: the last upload and how the recent ones went. */
export async function stravaUploadSummary(db: SQLiteDatabase, sinceSec: number): Promise<StravaUploadSummary> {
  const row = await db.getFirstAsync<{ lastDoneAt: number | null; done: number | null; failed: number | null }>(
    `SELECT MAX(CASE WHEN status = 'done' THEN updated_at END) AS lastDoneAt,
            SUM(CASE WHEN status = 'done' AND updated_at >= ? THEN 1 ELSE 0 END) AS done,
            SUM(CASE WHEN status IN ('failed', 'rejected') AND updated_at >= ? THEN 1 ELSE 0 END) AS failed
     FROM strava_upload`,
    sinceSec,
    sinceSec,
  );
  return { lastDoneAt: row?.lastDoneAt ?? null, done: row?.done ?? 0, failed: row?.failed ?? 0 };
}

export async function saveStravaUpload(
  db: SQLiteDatabase,
  row: Omit<StravaUploadRow, 'updatedAt'>,
): Promise<StravaUploadRow> {
  const updatedAt = Math.floor(Date.now() / 1000);
  await db.runAsync(
    `INSERT INTO strava_upload (workout_start, status, upload_id, activity_id, error, attempts, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workout_start) DO UPDATE SET status = excluded.status, upload_id = excluded.upload_id,
       activity_id = excluded.activity_id, error = excluded.error, attempts = excluded.attempts,
       updated_at = excluded.updated_at`,
    row.workoutStart,
    row.status,
    row.uploadId,
    row.activityId,
    row.error,
    row.attempts,
    updatedAt,
  );
  return { ...row, updatedAt };
}

/**
 * Workouts the app sends on its own: complete ones that ended after the account connected, were recorded by the watch
 * (never imported from the Huawei export) and are not settled yet. Oldest first. Historical workouts are never in this
 * list, only the button sends those.
 */
export function listAutoUploadCandidates(db: SQLiteDatabase, connectedAt: number): Promise<{ id: number; start: number }[]> {
  return db.getAllAsync<{ id: number; start: number }>(
    `SELECT w.id AS id, w.start AS start
     FROM workouts w LEFT JOIN strava_upload u ON u.workout_start = w.start
     WHERE w.complete != 0 AND w.imported = 0 AND w."end" > ?
       AND (u.workout_start IS NULL OR u.status = 'processing' OR (u.status = 'failed' AND u.attempts < ?))
     ORDER BY w.start`,
    connectedAt,
    MAX_AUTO_ATTEMPTS,
  );
}
