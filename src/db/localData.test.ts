import type { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import { openMemoryDb } from '@/cloud/syncTestKit';
import { ensureSyncItemSchema, putLocalItem } from '@/cloud/syncItems';
import { META } from '@/cloud/strengthSyncCore';
import {
  adoptAccount,
  countPendingRows,
  getCloudState,
  getCloudValue,
  getDetachedAt,
  getUploaded,
  getUploadedStats,
  listPendingWorkouts,
  setCloudState,
} from '@/db/cloud';
import { ensureCoachSchema } from '@/features/coach/store';
import { ensureGearSchema, saveGear } from '@/features/gear/store';
import { ensureStravaManualSchema } from '@/features/strava/manualStore';
import { ensureRogoImportQueueSchema } from '@/features/huaweiimport/rogoQueue';
import { ensureDeletedSchema } from '@/features/workouts/deleteCore';
import { ensureStrengthSchema, putRecord, setStrengthMeta, listDirty } from '@/features/strength/store';
import { ANALYSIS_ENGINE_REV } from '@/features/workouts/analysis/engineRev';

import { accountSwitchOf, countDirtyStrength, deleteLocalRows, detachLocalData, hasLocalData, keepApart, USER_DATA_TABLES } from './localDataCore';

interface Phone {
  raw: Database;
  db: SQLiteDatabase;
}

async function phone(): Promise<Phone> {
  const { raw, db } = openMemoryDb();
  await ensureGearSchema(db);
  await ensureStravaManualSchema(db);
  await ensureStrengthSchema(db);
  await ensureCoachSchema(db);
  await ensureSyncItemSchema(db);
  await ensureDeletedSchema(db);
  await ensureRogoImportQueueSchema(db);
  raw.exec('CREATE TABLE IF NOT EXISTS strength_kcal_sent (workout_id TEXT PRIMARY KEY NOT NULL, external_id TEXT NOT NULL, date TEXT NOT NULL, kcal INTEGER NOT NULL, sent_at INTEGER NOT NULL)');
  return { raw, db };
}

const count = (p: Phone, table: string) => p.raw.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n ?? 0;

function addWorkout(p: Phone, start: number) {
  p.raw
    .query(
      `INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, steps, summary_json)
       VALUES (1, ?, ?, 1, 'run', 600, 1000, 50, 100, '{}')`,
    )
    .run(start, start + 600);
}

const addSteps = (p: Phone, timestamp: number) =>
  p.raw.query('INSERT INTO step_samples (timestamp, steps, calories, distance) VALUES (?, 10, 1, 5)').run(timestamp);
const addSleep = (p: Phone, start: number) =>
  p.raw.query('INSERT INTO sleep_segments (start, end, type) VALUES (?, ?, 1)').run(start, start + 3600);

const strengthWorkout = (id: string, updatedAt: number) =>
  ({
    id,
    name: 'Push',
    startedAt: updatedAt,
    updatedAt,
    deletedAt: null,
    workoutStart: null,
    exercises: [],
  }) as never;

async function fill(p: Phone) {
  addWorkout(p, 1_000_000);
  addWorkout(p, 2_000_000);
  addSteps(p, 1_000);
  addSteps(p, 2_000);
  addSleep(p, 5_000);
  await putRecord(p.db, 'workout', strengthWorkout('w1', 10));
  await saveGear(p.db, { kind: 'shoes', name: 'Pegasus', brand: null, model: null, startDistanceM: 0, retireAtM: null }, 50);
  await putLocalItem(p.db, 'pref', 'theme', '{"value":"dark"}', 100);
  await setCloudState(p.db, { user_id: 'user-a', email: 'a@x.id', strava_connected_at: '1700000000', workout_pull_cursor: '{"updatedAt":1,"start":1}' });
  p.raw.query("INSERT INTO strava_upload (workout_start, status, updated_at) VALUES (1000000, 'done', 1)").run();
}

describe('hasLocalData', () => {
  it('is false for an empty phone and for a phone that only has bookkeeping', async () => {
    const p = await phone();
    expect(await hasLocalData(p.db)).toBe(false);
    await setCloudState(p.db, { user_id: 'user-a', email: 'a@x.id' });
    expect(await hasLocalData(p.db)).toBe(false);
  });

  it('sees workouts, step rows, strength records and live gear, not deleted gear', async () => {
    const p = await phone();
    addSteps(p, 1);
    expect(await hasLocalData(p.db)).toBe(true);
    const q = await phone();
    await putRecord(q.db, 'workout', strengthWorkout('w1', 10));
    expect(await hasLocalData(q.db)).toBe(true);
    const r = await phone();
    r.raw.exec("INSERT INTO gear (id, kind, name, start_distance_m, created_at, updated_at, deleted_at, notified) VALUES ('g', 'shoes', 'x', 0, 1, 2, 3, 0)");
    expect(await hasLocalData(r.db)).toBe(false);
  });

  it('works on a database that never created the JS tables', async () => {
    const { db, raw } = openMemoryDb();
    expect(await hasLocalData(db)).toBe(false);
    raw.query('INSERT INTO sleep_segments (start, end, type) VALUES (1, 2, 1)').run();
    expect(await hasLocalData(db)).toBe(true);
  });
});

describe('accountSwitchOf', () => {
  it('asks only for a different account on a phone that has data', async () => {
    const p = await phone();
    expect(await accountSwitchOf(p.db, 'user-b')).toBeNull(); // anonymous phone: adopted as today
    await fill(p);
    expect(await accountSwitchOf(p.db, 'user-a')).toBeNull(); // same account
    expect(await accountSwitchOf(p.db, 'user-b')).toEqual({ previousUserId: 'user-a', previousEmail: 'a@x.id' });
  });

  it('does not ask on an empty phone, and not before anyone was bound', async () => {
    const empty = await phone();
    await setCloudState(empty.db, { user_id: 'user-a', email: 'a@x.id' });
    expect(await accountSwitchOf(empty.db, 'user-b')).toBeNull();
    const anonymous = await phone();
    addSteps(anonymous, 1);
    expect(await accountSwitchOf(anonymous.db, 'user-b')).toBeNull();
  });
});

describe('deleteLocalRows', () => {
  it('empties every user data table, resets the upload cursors and the sync bookkeeping, and keeps the watch pairing and Strava connection', async () => {
    const p = await phone();
    await fill(p);
    p.raw.query("INSERT INTO device (address, name) VALUES ('AA:BB', 'Watch')").run();
    p.raw.query("INSERT INTO health_metric_status (type, dict_class, title, supported, gate, checked_at) VALUES ('hrv', 1, 'HRV', 1, 'ok', 1)").run();
    p.raw.query("INSERT INTO strength_kcal_sent VALUES ('w1', 'strength:w1', '2026-01-01', 100, 1)").run();
    p.raw.query("INSERT INTO cloud_workout VALUES (1000000, 1, 2, 1, 'h', 10, 1)").run();
    p.raw.query('INSERT INTO workout_points (workout_id, ts) VALUES (1, 1)').run();
    p.raw.query("INSERT INTO diet_day (date, meals_json, updated_at) VALUES ('2026-01-01', '[]', 1)").run();
    p.raw.query("INSERT INTO cycle_days (day, modified) VALUES ('2026-01-01', 1)").run();
    p.raw.query('INSERT INTO workout_deleted (start, deleted_at) VALUES (1000000, 1)').run();
    await setStrengthMeta(p.db, META.user, 'user-a');
    await p.db.runAsync("UPDATE cloud_cursor SET uploaded = 99");

    await deleteLocalRows(p.db);

    for (const table of USER_DATA_TABLES) {
      expect([table, count(p, table)]).toEqual([table, 0]);
    }
    expect(await hasLocalData(p.db)).toBe(false);
    const state = await getCloudState(p.db);
    expect(state.userId).toBeNull();
    expect(await getCloudValue(p.db, 'workout_pull_cursor')).toBeNull();
    expect(await getCloudValue(p.db, 'strava_connected_at')).toBe('1700000000');
    expect(await getUploaded(p.db, 'step_samples')).toBe(0);
    expect(count(p, 'device')).toBe(1);
    expect(count(p, 'health_metric_status')).toBe(1);
  });

  it('works when the JS tables were never created', async () => {
    const { db, raw } = openMemoryDb();
    raw.query('INSERT INTO sleep_segments (start, end, type) VALUES (1, 2, 1)').run();
    await deleteLocalRows(db);
    expect(await hasLocalData(db)).toBe(false);
  });

  it('lets the next sign-in start as a first one: nothing pending, nothing uploaded', async () => {
    const p = await phone();
    await fill(p);
    await deleteLocalRows(p.db);
    addSteps(p, 3_000);
    expect(await countPendingRows(p.db)).toBe(1);
    expect(await adoptAccount(p.db, 'user-b', 'b@x.id')).toBe(false);
  });
});

describe('detachLocalData', () => {
  it('moves the step and sleep upload cursors to the newest rev, so nothing existing is pending', async () => {
    const p = await phone();
    await fill(p);
    expect(await countPendingRows(p.db)).toBe(3);
    await adoptAccount(p.db, 'user-b', 'b@x.id'); // resets the cursors, as the real sign-in does
    expect(await countPendingRows(p.db)).toBe(3);
    await detachLocalData(p.db);
    expect(await countPendingRows(p.db)).toBe(0);
    expect(await getUploaded(p.db, 'step_samples')).toBe(2);
    expect(await getUploaded(p.db, 'sleep_segments')).toBe(1);
  });

  it('uploads rows written after the detach, and only those', async () => {
    const p = await phone();
    await fill(p);
    await adoptAccount(p.db, 'user-b', 'b@x.id');
    await detachLocalData(p.db);
    addSteps(p, 3_000);
    addSleep(p, 9_000);
    expect(await countPendingRows(p.db)).toBe(2);
    // an existing row rewritten by the native sync gets a new rev, like a new row
    p.raw.query('UPDATE step_samples SET steps = 99 WHERE timestamp = 1000').run();
    expect(await countPendingRows(p.db)).toBe(3);
  });

  it('records every workout as uploaded at its current rev and engine revision, so none is pending, and a later edit is', async () => {
    const p = await phone();
    await fill(p);
    await adoptAccount(p.db, 'user-b', 'b@x.id');
    expect(await listPendingWorkouts(p.db, ANALYSIS_ENGINE_REV)).toHaveLength(2);
    await detachLocalData(p.db);
    expect(await listPendingWorkouts(p.db, ANALYSIS_ENGINE_REV)).toHaveLength(0);
    const rows = p.raw.query<{ hash: string; engine_rev: number }, []>('SELECT hash, engine_rev FROM cloud_workout').all();
    expect(rows).toEqual([
      { hash: 'detached', engine_rev: ANALYSIS_ENGINE_REV },
      { hash: 'detached', engine_rev: ANALYSIS_ENGINE_REV },
    ]);
    addWorkout(p, 3_000_000);
    p.raw.query('UPDATE workouts SET calories = 77 WHERE start = 1000000').run();
    expect((await listPendingWorkouts(p.db, ANALYSIS_ENGINE_REV)).map((w) => w.start).sort()).toEqual([1_000_000, 3_000_000]);
  });

  it('does not count detached workouts in the upload size estimate', async () => {
    const p = await phone();
    await fill(p);
    await detachLocalData(p.db);
    expect(await getUploadedStats(p.db)).toEqual({ workouts: 0, bytes: 0, points: 0 });
  });

  it('marks strength records clean and forgets the account and cursor of the strength sync', async () => {
    const p = await phone();
    await fill(p);
    await setStrengthMeta(p.db, META.user, 'user-a');
    await setStrengthMeta(p.db, META.cursor, '123');
    await setStrengthMeta(p.db, META.locked, '1');
    await setStrengthMeta(p.db, 'settings', '{"autoRest":false}');
    expect(await countDirtyStrength(p.db)).toBe(1);
    await detachLocalData(p.db);
    expect(await countDirtyStrength(p.db)).toBe(0);
    expect(await listDirty(p.db, 10)).toEqual([]);
    const meta = p.raw.query<{ key: string }, []>('SELECT key FROM strength_meta ORDER BY key').all();
    expect(meta.map((m) => m.key)).toEqual(['settings']);
    await putRecord(p.db, 'workout', strengthWorkout('w2', 99));
    expect((await listDirty(p.db, 10)).map((r) => r.id)).toEqual(['w2']);
  });

  it('keeps sync_item rows and their times but marks them clean; a later local edit is dirty', async () => {
    const p = await phone();
    await fill(p);
    await putLocalItem(p.db, 'sticker', 'u-abc123', '{"x":1}', 200);
    await detachLocalData(p.db);
    const rows = p.raw.query(`SELECT kind, id, updated_at, dirty FROM sync_item WHERE kind != 'scanmark' ORDER BY kind`).all();
    expect(rows).toEqual([
      { kind: 'pref', id: 'theme', updated_at: 100, dirty: 0 },
      { kind: 'sticker', id: 'u-abc123', updated_at: 200, dirty: 0 },
    ]);
    await putLocalItem(p.db, 'pref', 'theme', '{"value":"light"}', 300);
    expect(p.raw.query<{ dirty: number }, [string]>('SELECT dirty FROM sync_item WHERE id = ?').get('theme')?.dirty).toBe(1);
  });

  it('sets detached_at, leaves Strava bookkeeping alone and keeps all the data', async () => {
    const p = await phone();
    await fill(p);
    expect(await getDetachedAt(p.db)).toBeNull();
    await detachLocalData(p.db, 4_242);
    expect(await getDetachedAt(p.db)).toBe(4_242);
    expect(count(p, 'strava_upload')).toBe(1);
    expect(await getCloudValue(p.db, 'strava_connected_at')).toBe('1700000000');
    expect(count(p, 'workouts')).toBe(2);
    expect(count(p, 'gear')).toBe(1);
  });

  it('works on a database without the JS tables', async () => {
    const { db, raw } = openMemoryDb();
    raw.query('INSERT INTO sleep_segments (start, end, type) VALUES (1, 2, 1)').run();
    await detachLocalData(db);
    expect(await countPendingRows(db)).toBe(0);
  });
});

describe('keepApart', () => {
  it('binds the new account and leaves nothing of the old data pending', async () => {
    const p = await phone();
    await fill(p);
    await keepApart(p.db, 'user-b', 'b@x.id');
    expect((await getCloudState(p.db)).userId).toBe('user-b');
    expect(await countPendingRows(p.db)).toBe(0);
    expect(await listPendingWorkouts(p.db, ANALYSIS_ENGINE_REV)).toHaveLength(0);
    expect(await countDirtyStrength(p.db)).toBe(0);
    expect(await accountSwitchOf(p.db, 'user-b')).toBeNull();
  });

  it('records the health rows the phone holds as known, so they are never sent to the new account', async () => {
    const p = await phone();
    await fill(p);
    p.raw.query("INSERT INTO cycle_days (day, flow, modified) VALUES ('2026-01-01', 2, 5)").run();
    await keepApart(p.db, 'user-b', 'b@x.id');
    const dirty = p.raw.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM sync_item WHERE dirty = 1').get()?.n;
    expect(dirty).toBe(0);
    const cycle = p.raw.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM sync_item WHERE kind = 'cycleday'").get()?.n;
    expect(cycle).toBe(1);
  });

  it('puts the previous account back when the baseline fails, so the next sync asks again', async () => {
    const p = await phone();
    await fill(p);
    p.raw.exec('DROP TABLE workouts');
    await expect(keepApart(p.db, 'user-b', 'b@x.id')).rejects.toThrow();
    const state = await getCloudState(p.db);
    expect(state.userId).toBe('user-a');
    expect(state.email).toBe('a@x.id');
    expect(await accountSwitchOf(p.db, 'user-b')).not.toBeNull();
  });

  it('runs the app record baseline instead of the health one, and rolls back when it fails', async () => {
    const p = await phone();
    await fill(p);
    let calls = 0;
    await keepApart(p.db, 'user-b', 'b@x.id', async () => {
      calls += 1;
    });
    expect(calls).toBe(1);
    const q = await phone();
    await fill(q);
    await expect(
      keepApart(q.db, 'user-b', 'b@x.id', async () => {
        throw new Error('baseline failed');
      }),
    ).rejects.toThrow('baseline failed');
    expect((await getCloudState(q.db)).userId).toBe('user-a');
  });
});
