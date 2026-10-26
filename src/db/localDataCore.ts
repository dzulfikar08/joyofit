import type { SQLiteDatabase } from 'expo-sqlite';

import {
  adoptAccount,
  CLOUD_TABLES,
  DETACHED_AT_KEY,
  getCloudState,
  listWorkoutsForBaseline,
  setCloudState,
  setUploaded,
  upsertCloudWorkout,
  DETACHED_HASH,
} from '@/db/cloud';
import { baselineHealthSync } from '@/cloud/healthRecords';
import { ensureSyncItemSchema } from '@/cloud/syncItems';
import { ANALYSIS_ENGINE_REV } from '@/features/workouts/analysis/engineRev';
import { META } from '@/cloud/strengthSyncCore';

/**
 * The SQL half of "this phone's data": what is deleted, what counts as data, and how existing data is kept out of the next
 * account. No native imports, so it runs under `bun test`; `localData.ts` adds the files and key-value entries.
 *
 * Several of these tables are created from JS (gear, strength, coach, `sync_item`, `strength_kcal_sent`), so a phone that never
 * opened those features does not have them: every statement first asks whether the table exists.
 */

/**
 * Everything the person made or the cloud restored, children first. Deliberately not here: `device` (the paired watches and their
 * keys), `health_metric_status` (what a paired watch supports), `downloaded_faces` (watch faces), `cloud_cursor` (reset, not
 * deleted: its `seq` feeds the row triggers) and the `strava_*` keys of `cloud_state` (the Strava connection lives on the Worker).
 */
export const USER_DATA_TABLES = [
  'workout_points',
  'cloud_workout',
  'workouts',
  'step_samples',
  'sleep_segments',
  'diet_day',
  'body_metrics',
  'cycle_periods',
  'cycle_days',
  'health_metrics',
  'sleep_scores',
  'rri_samples',
  'hrv_readings',
  'strava_upload',
  'strava_manual_upload',
  'strength_record',
  'strength_exercise_use',
  'strength_meta',
  'strength_kcal_sent',
  'gear',
  'gear_default',
  'workout_gear',
  'strava_gear_sent',
  'workout_deleted',
  'coach_doc',
  'sync_item',
  'rogo_import_queue',
] as const;

/** Tables whose rows say the phone holds something worth asking about before another account takes over. */
const DATA_PROBES: readonly { table: string; where?: string }[] = [
  { table: 'workouts' },
  { table: 'step_samples' },
  { table: 'sleep_segments' },
  { table: 'diet_day' },
  { table: 'body_metrics' },
  { table: 'cycle_periods' },
  { table: 'cycle_days' },
  { table: 'health_metrics' },
  { table: 'sleep_scores' },
  { table: 'hrv_readings' },
  { table: 'strength_record', where: 'deleted_at IS NULL' },
  { table: 'gear', where: 'deleted_at IS NULL' },
  { table: 'coach_doc' },
  { table: 'sync_item', where: 'deleted_at IS NULL' },
];

async function tableExists(db: Pick<SQLiteDatabase, 'getFirstAsync'>, table: string): Promise<boolean> {
  return (await db.getFirstAsync('SELECT 1 AS found FROM sqlite_master WHERE type = ? AND name = ?', 'table', table)) != null;
}

/** True when the phone holds data of its own (or restored from an account) in the database. Files and key-value entries are not looked at. */
export async function hasLocalData(db: Pick<SQLiteDatabase, 'getFirstAsync'>): Promise<boolean> {
  for (const { table, where } of DATA_PROBES) {
    if (!(await tableExists(db, table))) continue;
    if ((await db.getFirstAsync(`SELECT 1 AS found FROM ${table}${where ? ` WHERE ${where}` : ''} LIMIT 1`)) != null) return true;
  }
  return false;
}

/**
 * Empties every table of {@link USER_DATA_TABLES}, forgets all sync bookkeeping (`cloud_state` except the Strava keys, the upload
 * cursors) so the next sign-in starts from nothing and restores, and leaves watch pairing alone.
 */
export async function deleteLocalRows(db: SQLiteDatabase): Promise<void> {
  for (const table of USER_DATA_TABLES) {
    if (await tableExists(db, table)) await db.runAsync(`DELETE FROM ${table}`);
  }
  await db.runAsync("DELETE FROM cloud_state WHERE key NOT LIKE 'strava\\_%' ESCAPE '\\'");
  await db.runAsync('UPDATE cloud_cursor SET uploaded = 0');
}

/** The highest `rev` of a cloud table, 0 when it is empty. */
async function maxRev(db: Pick<SQLiteDatabase, 'getFirstAsync'>, table: string): Promise<number> {
  const row = await db.getFirstAsync<{ rev: number | null }>(`SELECT MAX(rev) AS rev FROM ${table}`);
  return row?.rev ?? 0;
}

/** Records the preferences, templates, routes and health rows this phone holds as already synced (`baselineRecordSync` in the app). */
export type RecordBaseline = (db: SQLiteDatabase) => Promise<void>;

/**
 * Marks everything this phone holds as "already uploaded" without uploading it, so the account that signs in next never
 * receives it. Call it after the new account has been adopted (`adoptAccount` resets the cursors this raises again):
 * - step samples and sleep segments: the upload cursor moves to the current newest `rev`;
 * - workouts: each gets a `cloud_workout` row at its current `rev` and the current engine revision (hash `detached`), which is
 *   what `listPendingWorkouts` looks for;
 * - strength: records are marked clean, and the account the strength sync believes it is bound to is forgotten (with its
 *   cursor), so the next account is "the first one" and does not mark everything dirty again;
 * - `sync_item` rows (preferences, templates, routes, health kinds) are marked clean, their times untouched;
 * - `cloud_state.detached_at` is set to `now`: gear and the coach plan are whole documents the cloud overwrites, so they hold
 *   back what is not newer than it (see `syncGearDoc`, `syncCoachDoc`).
 * Anything edited or written after this call goes up normally. Strava bookkeeping is untouched.
 */
export async function detachLocalData(
  db: SQLiteDatabase,
  now = Date.now(),
  baselineRecords: RecordBaseline = (target) => baselineHealthSync(target, now),
): Promise<void> {
  for (const table of CLOUD_TABLES) await setUploaded(db, table, await maxRev(db, table));

  const uploadedAt = Math.floor(now / 1000);
  for (const { start, rev } of await listWorkoutsForBaseline(db)) {
    await upsertCloudWorkout(db, { start, rev, engineRev: ANALYSIS_ENGINE_REV, version: 0, hash: DETACHED_HASH, bytes: 0, uploadedAt });
  }

  if (await tableExists(db, 'strength_record')) await db.runAsync('UPDATE strength_record SET dirty = 0');
  if (await tableExists(db, 'strength_meta')) {
    for (const key of [META.user, META.cursor, META.locked, META.full, META.rejected]) {
      await db.runAsync('DELETE FROM strength_meta WHERE key = ?', key);
    }
  }
  // Health rows are tracked in `sync_item` too (the native writers have no `imported` column), and preferences, templates and
  // routes that were never synced have no row at all: `baselineRecords` records what is there as known, then dirty rows are cleaned.
  await ensureSyncItemSchema(db);
  await baselineRecords(db);
  await db.runAsync('UPDATE sync_item SET dirty = 0');

  await setCloudState(db, { [DETACHED_AT_KEY]: String(now) });
}

/**
 * "Keep separate": the account that signed in takes over the bookkeeping (`adoptAccount`) and this phone's data is baselined
 * (`detachLocalData`). Either both happen or neither: when the baseline fails the previous account is bound again, so the next
 * sync asks again instead of uploading everything.
 */
export async function keepApart(db: SQLiteDatabase, userId: string, email: string, baselineRecords?: RecordBaseline): Promise<void> {
  const before = await getCloudState(db);
  try {
    await adoptAccount(db, userId, email);
    await detachLocalData(db, Date.now(), baselineRecords);
  } catch (error) {
    await setCloudState(db, { user_id: before.userId, email: before.email }).catch(() => {});
    throw error;
  }
}

/**
 * What a sign-in needs to ask about: the phone still holds the data of an earlier account (`cloud_state.user_id` is another id)
 * and has data. Null for a first sign-in (nobody was ever bound), the same account again, and an empty phone.
 */
export async function accountSwitchOf(
  db: SQLiteDatabase,
  userId: string,
): Promise<{ previousUserId: string; previousEmail: string | null } | null> {
  const state = await getCloudState(db);
  if (state.userId === null || state.userId === userId) return null;
  return (await hasLocalData(db)) ? { previousUserId: state.userId, previousEmail: state.email } : null;
}

/** Strength records changed on this phone that the cloud does not have; 0 when the strength tables were never created. */
export async function countDirtyStrength(db: Pick<SQLiteDatabase, 'getFirstAsync'>): Promise<number> {
  if (!(await tableExists(db, 'strength_record'))) return 0;
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM strength_record WHERE dirty = 1');
  return row?.n ?? 0;
}
