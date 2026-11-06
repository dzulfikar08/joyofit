import type { SQLiteDatabase } from 'expo-sqlite';

import { minuteHeartRates } from '@/features/record/save';
import { recordedSamplesOf } from '@/features/strength/hr';

/**
 * The SQL half of deleting a workout (the rules in `deleteWorkout.ts`): the tombstone that keeps a deleted workout from coming back,
 * the removal of the row and everything hanging on it, and the retry of what the account still has to be told. No native imports, so it
 * runs under `bun test`.
 *
 * `workout_deleted` is created from JS (like `watch_kcal_sent`): the native watch writers never see it. They re-download the workouts
 * after the newest one the phone has, so a deleted watch workout is written again by the next sync; `purgeDeletedWatchRows` removes it
 * again before anything reads or sends it (after every sync, at start, and ahead of every push).
 */
const SCHEMA = `CREATE TABLE IF NOT EXISTS workout_deleted (
  start INTEGER PRIMARY KEY NOT NULL, deleted_at INTEGER NOT NULL, account_id TEXT,
  cloud INTEGER NOT NULL DEFAULT 0, diary TEXT NOT NULL DEFAULT '[]', posts TEXT NOT NULL DEFAULT '[]')`;

export type DeleteDb = Pick<SQLiteDatabase, 'getAllAsync' | 'getFirstAsync' | 'runAsync' | 'execAsync' | 'withExclusiveTransactionAsync'>;
type Query = Pick<SQLiteDatabase, 'getAllAsync' | 'getFirstAsync' | 'runAsync'>;

const ready = new WeakSet<object>();

export async function ensureDeletedSchema(db: Pick<SQLiteDatabase, 'execAsync'>): Promise<void> {
  if (ready.has(db)) return;
  await db.execAsync(SCHEMA);
  ready.add(db);
}

/** What the account (the one the phone was bound to when the workout was deleted) still has to be told. */
export interface DeleteOps {
  accountId: string | null;
  /** The workout's cloud copy (`watchWorkout/remove`, the tombstone other phones pull). */
  cloud: boolean;
  /** JoyoRogo diary rows (`exercise/removeJoyofit`): `watch:<start>`, `phone:<start>`, `strength:<id>`. */
  diary: readonly string[];
  /** Feed posts of the workout (`social/deletePost`). */
  posts: readonly string[];
}

export const NO_OPS: DeleteOps = { accountId: null, cloud: false, diary: [], posts: [] };

async function tableExists(db: Pick<SQLiteDatabase, 'getFirstAsync'>, table: string): Promise<boolean> {
  return (await db.getFirstAsync('SELECT 1 AS found FROM sqlite_master WHERE type = ? AND name = ?', 'table', table)) != null;
}

/** Starts of the workouts this phone knows were deleted. */
export async function deletedStarts(db: Query): Promise<Set<number>> {
  const rows = await db.getAllAsync<{ start: number }>('SELECT start FROM workout_deleted');
  return new Set(rows.map((row) => row.start));
}

export async function isWorkoutDeleted(db: Query & Pick<SQLiteDatabase, 'execAsync'>, start: number): Promise<boolean> {
  await ensureDeletedSchema(db);
  return (await db.getFirstAsync('SELECT 1 AS found FROM workout_deleted WHERE start = ?', start)) != null;
}

/** The cloud (this phone's other copy, another phone) deleted the workout: remember it so the watch does not bring it back. Nothing to tell anyone. */
export async function recordRemoteDeletion(db: Query & Pick<SQLiteDatabase, 'execAsync'>, start: number, nowMs = Date.now()): Promise<void> {
  await ensureDeletedSchema(db);
  await db.runAsync('INSERT OR IGNORE INTO workout_deleted (start, deleted_at) VALUES (?, ?)', start, nowMs);
}

/** `HR-only` minutes the phone wrote itself for a row it recorded (`imported = 1`): a watch minute (steps, energy) or another source's minute stays. */
const CHUNK = 90;
async function dropOwnMinutes(db: Query, workoutId: number): Promise<void> {
  const points = await db.getAllAsync<{ ts: number; hr: number }>('SELECT ts, hr FROM workout_points WHERE workout_id = ? AND hr IS NOT NULL', workoutId);
  const minutes = minuteHeartRates(recordedSamplesOf(points)).map(([minute]) => minute);
  for (let i = 0; i < minutes.length; i += CHUNK) {
    const chunk = minutes.slice(i, i + CHUNK);
    await db.runAsync(
      `DELETE FROM step_samples WHERE imported = 1 AND steps = 0 AND calories = 0 AND distance = 0 AND timestamp IN (${chunk.map(() => '?').join(', ')})`,
      chunk,
    );
  }
}

/**
 * Tables keyed by a workout's start that are created from JS and hold only bookkeeping of that workout. `strava_upload` is NOT here:
 * it stays, so an automatic Strava upload cannot send the same workout again if the watch brings its row back for a moment.
 */
const START_KEYED: readonly (readonly [table: string, column: string])[] = [
  ['cloud_workout', 'start'],
  ['workout_gear', 'workout_start'],
  ['strava_gear_sent', 'workout_start'],
  ['ride_metrics', 'workout_start'],
  ['watch_kcal_sent', 'workout_start'],
  ['phone_kcal_sent', 'workout_start'],
];

/** Deletes the `workouts` row and everything that hangs on it, inside the caller's transaction. */
async function dropRow(db: Query, row: { id: number; start: number; imported: number }): Promise<void> {
  if (row.imported === 1) await dropOwnMinutes(db, row.id);
  await db.runAsync('DELETE FROM workout_points WHERE workout_id = ?', row.id);
  if (await tableExists(db, 'workout_sensor')) await db.runAsync('DELETE FROM workout_sensor WHERE workout_id = ?', row.id);
  if (await tableExists(db, 'workout_rri')) await db.runAsync('DELETE FROM workout_rri WHERE workout_id = ?', row.id);
  await db.runAsync('DELETE FROM workouts WHERE id = ?', row.id);
  for (const [table, column] of START_KEYED) {
    if (await tableExists(db, table)) await db.runAsync(`DELETE FROM ${table} WHERE ${column} = ?`, row.start);
  }
}

/**
 * Deletes the workout that started at `start` and writes its tombstone, in one transaction. The tombstone carries what the account
 * still has to be told (`flushDeleteTombstones`). False when the phone has no such workout.
 */
export async function removeWorkoutRows(db: DeleteDb, start: number, ops: DeleteOps, nowMs = Date.now()): Promise<boolean> {
  await ensureDeletedSchema(db);
  let removed = false;
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      `INSERT INTO workout_deleted (start, deleted_at, account_id, cloud, diary, posts) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (start) DO UPDATE SET deleted_at = excluded.deleted_at, account_id = excluded.account_id, cloud = excluded.cloud,
         diary = excluded.diary, posts = excluded.posts`,
      start,
      nowMs,
      ops.accountId,
      ops.cloud ? 1 : 0,
      JSON.stringify(ops.diary),
      JSON.stringify(ops.posts),
    );
    const row = await txn.getFirstAsync<{ id: number; start: number; imported: number }>('SELECT id, start, imported FROM workouts WHERE start = ?', start);
    if (!row) return;
    await dropRow(txn, row);
    removed = true;
  });
  return removed;
}

/**
 * Removes the watch's copies of deleted workouts (`imported = 0`: only the native sync writes those). Rows the person made or imported
 * themselves (a FIT file, a manual entry, a recording) are never touched: bringing one of those back is their decision. Returns how many went.
 */
export async function purgeDeletedWatchRows(db: DeleteDb): Promise<number> {
  await ensureDeletedSchema(db);
  const rows = await db.getAllAsync<{ id: number; start: number; imported: number }>(
    'SELECT w.id, w.start, w.imported FROM workouts w JOIN workout_deleted d ON d.start = w.start WHERE w.imported = 0',
  );
  if (rows.length === 0) return 0;
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const row of rows) await dropRow(txn, row);
  });
  return rows.length;
}

/** What the retry needs from the outside world; `deleteWorkout.ts` wires the real calls. */
export interface DeleteIo {
  /** The account the phone is bound to; null when none. */
  boundAccount: () => Promise<string | null>;
  paused: () => boolean;
  removeCloudWorkout: (start: number) => Promise<void>;
  removeDiaryRow: (externalId: string) => Promise<void>;
  deletePost: (id: string) => Promise<void>;
  /** `quiet`/`stop`: ask again at the next sync (nobody signed in, no network, the server is down). `refused`: the server answered no; asking again would not help. */
  classify: (error: unknown) => 'quiet' | 'refused' | 'stop';
  onError?: (what: string, error: unknown) => void;
}

interface TombstoneRow {
  start: number;
  account_id: string | null;
  cloud: number;
  diary: string;
  posts: string;
}

const strings = (json: string): string[] => {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
};

/** Tombstones with something still to tell the account. */
export async function countPendingDeletes(db: Query & Pick<SQLiteDatabase, 'execAsync'>): Promise<number> {
  await ensureDeletedSchema(db);
  const row = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM workout_deleted WHERE cloud = 1 OR diary <> '[]' OR posts <> '[]'");
  return row?.n ?? 0;
}

/**
 * Tells the account about deleted workouts: the cloud tombstone, the diary rows, the feed posts. Each step that succeeds (or that the
 * server refuses for good) is crossed off; a connection problem ends the pass and the next sync continues. Tombstones of another account
 * than the one bound now wait for that account. Never throws.
 */
export async function flushDeleteTombstones(db: Query & Pick<SQLiteDatabase, 'execAsync'>, io: DeleteIo): Promise<{ sent: number; pending: number }> {
  let sent = 0;
  try {
    await ensureDeletedSchema(db);
    if (io.paused()) return { sent, pending: await countPendingDeletes(db) };
    const account = await io.boundAccount();
    if (account === null) return { sent, pending: await countPendingDeletes(db) };
    const rows = await db.getAllAsync<TombstoneRow>(
      "SELECT start, account_id, cloud, diary, posts FROM workout_deleted WHERE (cloud = 1 OR diary <> '[]' OR posts <> '[]') ORDER BY deleted_at",
    );
    for (const row of rows) {
      if (row.account_id !== null && row.account_id !== account) continue;
      let cloud = row.cloud === 1;
      let diary = strings(row.diary);
      let posts = strings(row.posts);
      let stop = false;
      const attempt = async (what: string, call: () => Promise<void>): Promise<boolean> => {
        try {
          await call();
          sent += 1;
          return true;
        } catch (error) {
          const kind = io.classify(error);
          if (kind === 'refused') {
            io.onError?.(what, error);
            return true;
          }
          if (kind === 'stop') io.onError?.(what, error);
          stop = true;
          return false;
        }
      };
      if (cloud && (await attempt(`cloud tombstone of workout ${row.start}`, () => io.removeCloudWorkout(row.start)))) cloud = false;
      for (const id of [...diary]) {
        if (stop) break;
        if (await attempt(`diary row ${id}`, () => io.removeDiaryRow(id))) diary = diary.filter((x) => x !== id);
      }
      for (const id of [...posts]) {
        if (stop) break;
        if (await attempt(`feed post ${id}`, () => io.deletePost(id))) posts = posts.filter((x) => x !== id);
      }
      await db.runAsync('UPDATE workout_deleted SET cloud = ?, diary = ?, posts = ? WHERE start = ?', cloud ? 1 : 0, JSON.stringify(diary), JSON.stringify(posts), row.start);
      if (stop) break;
    }
    return { sent, pending: await countPendingDeletes(db) };
  } catch (error) {
    io.onError?.('workout delete retry', error);
    return { sent, pending: -1 };
  }
}
