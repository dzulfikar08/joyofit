import type { SQLiteDatabase } from 'expo-sqlite';

import type { WeightUnit } from './units';

import type {
  CustomExercise,
  ExercisePref,
  KindDoc,
  Routine,
  RoutineFolder,
  StrengthDraft,
  StrengthKind,
  StrengthWorkout,
} from './types';

/**
 * Strength data on the phone. The tables live in `joyofit.db` but are created here, from JS, not through
 * `joyofit-db-migrations.json` (shipped inside the native module, so a new entry needs a new binary; same reason as
 * `features/gear/store.ts`). The native side never reads or writes them.
 *
 * Every record (workout, routine, folder, custom exercise, saved preference) is one JSON document in `strength_record`,
 * keyed by `(kind, id)`, with the columns the screens query by. A write sets `dirty = 1`; `src/cloud/strengthSync.ts` uploads
 * dirty rows, merges what the cloud has per record (newest `updatedAt` wins, a delete is a row with `deletedAt`) and clears the flag.
 * `strength_exercise_use` says which workouts contain which exercise, so "what did I do last time" is one indexed read.
 */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS strength_record (
     kind TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL,
     sort_at INTEGER NOT NULL DEFAULT 0, plan_key TEXT, workout_start INTEGER,
     updated_at INTEGER NOT NULL, deleted_at INTEGER, dirty INTEGER NOT NULL DEFAULT 1,
     PRIMARY KEY (kind, id))`,
  `CREATE INDEX IF NOT EXISTS strength_record_by_sort ON strength_record (kind, deleted_at, sort_at DESC)`,
  `CREATE INDEX IF NOT EXISTS strength_record_by_plan ON strength_record (plan_key) WHERE plan_key IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS strength_record_by_start ON strength_record (workout_start) WHERE workout_start IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS strength_record_dirty ON strength_record (dirty) WHERE dirty = 1`,
  `CREATE TABLE IF NOT EXISTS strength_exercise_use (
     workout_id TEXT NOT NULL, exercise_id TEXT NOT NULL, started_at INTEGER NOT NULL,
     PRIMARY KEY (workout_id, exercise_id))`,
  `CREATE INDEX IF NOT EXISTS strength_exercise_use_by_exercise ON strength_exercise_use (exercise_id, started_at DESC)`,
  `CREATE TABLE IF NOT EXISTS strength_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)`,
];

export async function ensureStrengthSchema(db: SQLiteDatabase): Promise<void> {
  for (const statement of SCHEMA) await db.execAsync(statement);
}

/** A new id: the prefix, the time in base 36 and three random characters (two phones can create in the same millisecond). */
export function newId(prefix: 'w' | 'r' | 'f' | 'custom_' | 's' | 'k', nowMs = Date.now()): string {
  return `${prefix}${nowMs.toString(36)}${Math.floor(Math.random() * 46656).toString(36).padStart(3, '0')}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------------------------------------------------

interface RecordRow {
  json: string;
}

function sortAt(kind: StrengthKind, doc: KindDoc[StrengthKind]): number {
  if (kind === 'workout') return (doc as StrengthWorkout).startedAt;
  if (kind === 'routine') return (doc as Routine).sortOrder;
  if (kind === 'folder') return (doc as RoutineFolder).sortOrder;
  return 0;
}

/** Writes a record and marks it for upload. `workout` also refreshes `strength_exercise_use`. */
export async function putRecord<K extends StrengthKind>(db: SQLiteDatabase, kind: K, doc: KindDoc[K], dirty = true): Promise<void> {
  const workout = kind === 'workout' ? (doc as StrengthWorkout) : null;
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO strength_record (kind, id, json, sort_at, plan_key, workout_start, updated_at, deleted_at, dirty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (kind, id) DO UPDATE SET json = excluded.json, sort_at = excluded.sort_at, plan_key = excluded.plan_key,
         workout_start = excluded.workout_start, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, dirty = excluded.dirty`,
      kind,
      doc.id,
      JSON.stringify(doc),
      sortAt(kind, doc),
      workout?.planKey ?? null,
      workout?.workoutStart ?? null,
      doc.updatedAt,
      doc.deletedAt,
      dirty ? 1 : 0,
    );
    if (workout) {
      await db.runAsync('DELETE FROM strength_exercise_use WHERE workout_id = ?', workout.id);
      if (workout.deletedAt === null) {
        for (const exerciseId of new Set(workout.exercises.map((e) => e.exerciseId))) {
          await db.runAsync(
            'INSERT INTO strength_exercise_use (workout_id, exercise_id, started_at) VALUES (?, ?, ?)',
            workout.id,
            exerciseId,
            workout.startedAt,
          );
        }
      }
    }
  });
}

export async function getRecord<K extends StrengthKind>(db: SQLiteDatabase, kind: K, id: string): Promise<KindDoc[K] | null> {
  const row = await db.getFirstAsync<RecordRow>('SELECT json FROM strength_record WHERE kind = ? AND id = ?', kind, id);
  return row ? (JSON.parse(row.json) as KindDoc[K]) : null;
}

/** Records of a kind that are not deleted, newest `sort_at` first (workouts: newest first; routines and folders: highest `sortOrder` first, so callers reverse). */
export async function listRecords<K extends StrengthKind>(db: SQLiteDatabase, kind: K, limit = -1): Promise<KindDoc[K][]> {
  const rows = await db.getAllAsync<RecordRow>(
    'SELECT json FROM strength_record WHERE kind = ? AND deleted_at IS NULL ORDER BY sort_at DESC, updated_at DESC LIMIT ?',
    kind,
    limit,
  );
  return rows.map((r) => JSON.parse(r.json) as KindDoc[K]);
}

// ---------------------------------------------------------------------------------------------------------------------
// Workouts
// ---------------------------------------------------------------------------------------------------------------------

export const saveWorkout = (db: SQLiteDatabase, workout: StrengthWorkout): Promise<void> => putRecord(db, 'workout', workout);

export const getStrengthWorkout = (db: SQLiteDatabase, id: string): Promise<StrengthWorkout | null> => getRecord(db, 'workout', id);

/** Workouts not deleted, newest first. */
export const listStrengthWorkouts = (db: SQLiteDatabase, limit = -1): Promise<StrengthWorkout[]> => listRecords(db, 'workout', limit);

/** Workouts started for the coach plan session `planKey` (`<planId>:<week>:<slot>`), newest first. The coach marks the session done from this. */
export async function listStrengthWorkoutsByPlanKey(db: SQLiteDatabase, planKey: string): Promise<StrengthWorkout[]> {
  const rows = await db.getAllAsync<RecordRow>(
    `SELECT json FROM strength_record WHERE kind = 'workout' AND plan_key = ? AND deleted_at IS NULL ORDER BY sort_at DESC`,
    planKey,
  );
  return rows.map((r) => JSON.parse(r.json) as StrengthWorkout);
}

/** The strength workout stored as the `workouts` row that started at `workoutStart` (own or merged watch row), or null. */
export async function getStrengthWorkoutByStart(db: SQLiteDatabase, workoutStart: number): Promise<StrengthWorkout | null> {
  const row = await db.getFirstAsync<RecordRow>(
    `SELECT json FROM strength_record WHERE kind = 'workout' AND workout_start = ? AND deleted_at IS NULL ORDER BY sort_at DESC`,
    workoutStart,
  );
  return row ? (JSON.parse(row.json) as StrengthWorkout) : null;
}

/** Workouts of the half-open day range `[fromMs, toMs)`, oldest first. */
export async function listStrengthWorkoutsBetween(db: SQLiteDatabase, fromMs: number, toMs: number): Promise<StrengthWorkout[]> {
  const rows = await db.getAllAsync<RecordRow>(
    `SELECT json FROM strength_record WHERE kind = 'workout' AND deleted_at IS NULL AND sort_at >= ? AND sort_at < ? ORDER BY sort_at`,
    fromMs,
    toMs,
  );
  return rows.map((r) => JSON.parse(r.json) as StrengthWorkout);
}

/** Tombstones a workout (the cloud hears about the delete). The caller removes its `workouts` row (`link.ts`). */
export async function deleteStrengthWorkout(db: SQLiteDatabase, workout: StrengthWorkout, nowMs = Date.now()): Promise<void> {
  await saveWorkout(db, { ...workout, deletedAt: nowMs, updatedAt: nowMs });
}

/**
 * What an exercise was the last time (the newest workout before `beforeMs` with a done set of it): its done sets in order, or an
 * empty list. The inline "previous" of the logger.
 */
export async function lastPerformance(
  db: SQLiteDatabase,
  exerciseId: string,
  beforeMs: number = Number.MAX_SAFE_INTEGER,
  excludeWorkoutId: string | null = null,
): Promise<{ workoutId: string; at: number; sets: { type: string; weightKg: number | null; reps: number | null; seconds: number | null }[] } | null> {
  const use = await db.getFirstAsync<{ workoutId: string }>(
    `SELECT u.workout_id AS workoutId FROM strength_exercise_use u
     JOIN strength_record r ON r.kind = 'workout' AND r.id = u.workout_id AND r.deleted_at IS NULL
     WHERE u.exercise_id = ? AND u.started_at < ? AND u.workout_id != ? ORDER BY u.started_at DESC LIMIT 1`,
    exerciseId,
    beforeMs,
    excludeWorkoutId ?? '',
  );
  if (!use) return null;
  const workout = await getStrengthWorkout(db, use.workoutId);
  if (!workout) return null;
  const sets = workout.exercises
    .filter((e) => e.exerciseId === exerciseId)
    .flatMap((e) => e.sets.filter((s) => s.done))
    .map((s) => ({ type: s.type, weightKg: s.weightKg, reps: s.reps, seconds: s.seconds }));
  return sets.length === 0 ? null : { workoutId: workout.id, at: workout.startedAt, sets };
}

// ---------------------------------------------------------------------------------------------------------------------
// Routines, folders, custom exercises, preferences
// ---------------------------------------------------------------------------------------------------------------------

export const saveRoutine = (db: SQLiteDatabase, routine: Routine): Promise<void> => putRecord(db, 'routine', routine);
export const getRoutine = (db: SQLiteDatabase, id: string): Promise<Routine | null> => getRecord(db, 'routine', id);

/** Routines in the person's order (`sortOrder` ascending, then newest). */
export async function listRoutines(db: SQLiteDatabase): Promise<Routine[]> {
  const all = await listRecords(db, 'routine');
  return all.sort((a, b) => a.sortOrder - b.sortOrder || b.createdAt - a.createdAt);
}

export async function deleteRoutine(db: SQLiteDatabase, routine: Routine, nowMs = Date.now()): Promise<void> {
  await saveRoutine(db, { ...routine, deletedAt: nowMs, updatedAt: nowMs });
}

export const saveFolder = (db: SQLiteDatabase, folder: RoutineFolder): Promise<void> => putRecord(db, 'folder', folder);

export async function listFolders(db: SQLiteDatabase): Promise<RoutineFolder[]> {
  const all = await listRecords(db, 'folder');
  return all.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/** Deletes a folder; its routines move out of it (to "no folder"). */
export async function deleteFolder(db: SQLiteDatabase, folder: RoutineFolder, nowMs = Date.now()): Promise<void> {
  const routines = (await listRoutines(db)).filter((r) => r.folderId === folder.id);
  for (const routine of routines) await saveRoutine(db, { ...routine, folderId: null, updatedAt: nowMs });
  await saveFolder(db, { ...folder, deletedAt: nowMs, updatedAt: nowMs });
}

export const saveCustomExercise = (db: SQLiteDatabase, exercise: CustomExercise): Promise<void> => putRecord(db, 'exercise', exercise);
export const listCustomExercises = (db: SQLiteDatabase): Promise<CustomExercise[]> => listRecords(db, 'exercise');

/** Deletes a custom exercise. Workouts that used it keep the id and show it as a removed exercise. */
export async function deleteCustomExercise(db: SQLiteDatabase, exercise: CustomExercise, nowMs = Date.now()): Promise<void> {
  await saveCustomExercise(db, { ...exercise, deletedAt: nowMs, updatedAt: nowMs });
}

/** Custom exercises including deleted ones, by id: workout history still names an exercise that was deleted. */
export async function customExerciseIndex(db: SQLiteDatabase): Promise<Map<string, CustomExercise>> {
  const rows = await db.getAllAsync<RecordRow>(`SELECT json FROM strength_record WHERE kind = 'exercise'`);
  return new Map(rows.map((r) => JSON.parse(r.json) as CustomExercise).map((e) => [e.id, e]));
}

export const getExercisePref = (db: SQLiteDatabase, exerciseId: string): Promise<ExercisePref | null> => getRecord(db, 'pref', exerciseId);

/** Saved rest timers by exercise id (not deleted, with a value). */
export async function listRestPrefs(db: SQLiteDatabase): Promise<Map<string, number>> {
  const prefs = await listRecords(db, 'pref');
  return new Map(prefs.filter((p) => p.restSec !== null).map((p) => [p.id, p.restSec as number]));
}

/** Writes the pref of an exercise with `patch` applied; a pref left with neither a rest nor a measure becomes a tombstone. `updatedAt` always moves on so the cloud takes it. */
async function patchPref(db: SQLiteDatabase, exerciseId: string, patch: Partial<Pick<ExercisePref, 'restSec' | 'timed'>>, nowMs: number): Promise<void> {
  const before = await getRecord(db, 'pref', exerciseId);
  const restSec = patch.restSec !== undefined ? patch.restSec : (before?.deletedAt === null ? before.restSec : null);
  const timed = patch.timed !== undefined ? patch.timed : (before?.deletedAt === null ? (before.timed ?? null) : null);
  const empty = restSec === null && timed === null;
  await putRecord(db, 'pref', {
    id: exerciseId,
    restSec,
    timed,
    updatedAt: Math.max(nowMs, (before?.updatedAt ?? 0) + 1),
    deletedAt: empty ? nowMs : null,
  });
}

/** Remembers the rest timer of an exercise (null forgets it, so the default applies again). The saved measure stays. */
export const setRestPref = (db: SQLiteDatabase, exerciseId: string, restSec: number | null, nowMs = Date.now()): Promise<void> =>
  patchPref(db, exerciseId, { restSec }, nowMs);

/** Saved measure by exercise id (`true` = seconds, `false` = repetitions), only for exercises the person switched. */
export async function listTimedPrefs(db: SQLiteDatabase): Promise<Map<string, boolean>> {
  const prefs = await listRecords(db, 'pref');
  return new Map(prefs.filter((p) => typeof p.timed === 'boolean').map((p) => [p.id, p.timed as boolean]));
}

/** Remembers how the person measures an exercise (the last Repetisi / Waktu choice); null forgets it, so the exercise's default applies again. */
export const setTimedPref = (db: SQLiteDatabase, exerciseId: string, timed: boolean | null, nowMs = Date.now()): Promise<void> =>
  patchPref(db, exerciseId, { timed }, nowMs);

// ---------------------------------------------------------------------------------------------------------------------
// The active workout (draft) and small settings
// ---------------------------------------------------------------------------------------------------------------------

async function getMeta(db: SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM strength_meta WHERE key = ?', key);
  return row?.value ?? null;
}

async function setMeta(db: SQLiteDatabase, key: string, value: string | null): Promise<void> {
  if (value === null) await db.runAsync('DELETE FROM strength_meta WHERE key = ?', key);
  else await db.runAsync('INSERT INTO strength_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, value);
}

/** The workout in progress, or null. Local only: it is not synced until it is finished. */
export async function loadDraft(db: SQLiteDatabase): Promise<StrengthDraft | null> {
  const json = await getMeta(db, 'draft');
  if (!json) return null;
  try {
    return JSON.parse(json) as StrengthDraft;
  } catch {
    return null;
  }
}

export const saveDraft = (db: SQLiteDatabase, draft: StrengthDraft | null): Promise<void> =>
  setMeta(db, 'draft', draft === null ? null : JSON.stringify(draft));

/** Settings of the logger, stored on the phone. */
export interface StrengthSettings {
  /** Rest after a completed set when the exercise has none of its own, seconds. */
  defaultRestSec: number;
  /** The rest timer starts by itself when a set is completed. */
  autoRest: boolean;
  /** Keep the screen on during a workout. */
  keepAwake: boolean;
  /** Show the RPE column. */
  showRpe: boolean;
  /** Upload finished workouts to Strava as Weight Training once Strava is linked (a per-workout button always works). */
  autoStrava: boolean;
  /** The stopwatch of a timed set counts down from the planned seconds when the set has some (it counts up otherwise, and always when off). */
  countdownTimed: boolean;
  /** A connected watch that can be started from the phone starts Strength training with the logger, and is paused and stopped with it (`watchWorkout.ts`). */
  startOnWatch: boolean;
  /** The unit weights are shown and typed in (`units.ts`); storage is always kg. */
  weightUnit: WeightUnit;
  /** The bar of the plate calculator, per unit, in that unit (20 kg and 45 lb are different bars, so each unit keeps its own). */
  barWeight: Record<WeightUnit, number>;
}

export const DEFAULT_SETTINGS: StrengthSettings = {
  defaultRestSec: 90,
  autoRest: true,
  keepAwake: true,
  showRpe: false,
  autoStrava: false,
  countdownTimed: true,
  startOnWatch: true,
  weightUnit: 'kg',
  barWeight: { kg: 20, lb: 45 },
};

export async function loadSettings(db: SQLiteDatabase): Promise<StrengthSettings> {
  const json = await getMeta(db, 'settings');
  if (!json) return DEFAULT_SETTINGS;
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(json) as Partial<StrengthSettings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export const saveSettings = (db: SQLiteDatabase, settings: StrengthSettings): Promise<void> => setMeta(db, 'settings', JSON.stringify(settings));

export { getMeta as getStrengthMeta, setMeta as setStrengthMeta };

// ---------------------------------------------------------------------------------------------------------------------
// Sync support
// ---------------------------------------------------------------------------------------------------------------------

export interface DirtyRecord {
  kind: StrengthKind;
  id: string;
  json: string;
  updatedAt: number;
  deletedAt: number | null;
}

export function listDirty(db: SQLiteDatabase, limit: number): Promise<DirtyRecord[]> {
  return db.getAllAsync<DirtyRecord>(
    `SELECT kind, id, json, updated_at AS updatedAt, deleted_at AS deletedAt FROM strength_record WHERE dirty = 1 ORDER BY updated_at LIMIT ?`,
    limit,
  );
}

/** Clears the upload flag of what was uploaded, unless the record changed again since (its `updatedAt` moved). */
export async function markUploaded(db: SQLiteDatabase, records: readonly Pick<DirtyRecord, 'kind' | 'id' | 'updatedAt'>[]): Promise<void> {
  for (const r of records) {
    await db.runAsync('UPDATE strength_record SET dirty = 0 WHERE kind = ? AND id = ? AND updated_at = ?', r.kind, r.id, r.updatedAt);
  }
}

/** Everything is uploaded again at the next sync (a new account, or a restore). */
export async function markAllDirty(db: SQLiteDatabase): Promise<void> {
  await db.runAsync('UPDATE strength_record SET dirty = 1');
}

/**
 * Applies records from the cloud: a record newer than the local copy replaces it (`dirty = 0`), an older one is ignored (the
 * next upload sends the local one), an equal one only clears the flag. Returns how many replaced a local record or were new.
 */
export async function applyRemote(
  db: SQLiteDatabase,
  records: readonly { kind: StrengthKind; id: string; json: string; updatedAt: number; deletedAt: number | null }[],
): Promise<{ applied: number; workouts: StrengthWorkout[] }> {
  let applied = 0;
  const workouts: StrengthWorkout[] = [];
  for (const record of records) {
    const local = await db.getFirstAsync<{ updatedAt: number }>(
      'SELECT updated_at AS updatedAt FROM strength_record WHERE kind = ? AND id = ?',
      record.kind,
      record.id,
    );
    if (local && local.updatedAt > record.updatedAt) continue;
    if (local && local.updatedAt === record.updatedAt) {
      await db.runAsync('UPDATE strength_record SET dirty = 0 WHERE kind = ? AND id = ?', record.kind, record.id);
      continue;
    }
    const doc = JSON.parse(record.json) as KindDoc[StrengthKind];
    await putRecord(db, record.kind, doc as never, false);
    applied += 1;
    if (record.kind === 'workout') workouts.push(doc as StrengthWorkout);
  }
  return { applied, workouts };
}
