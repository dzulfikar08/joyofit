/**
 * How a logged strength workout lives in the `workouts` table, so the Workouts list, the Strava upload, the JoyoRogo cloud
 * workouts and Gear treat it like any other workout.
 *
 * - **A watch recorded it too.** A complete watch workout (`imported = 0`) of a strength-like sport whose time span overlaps the
 *   logged one by more than half of the shorter span is the same session: the logger links to it (`workoutStart` = its `start`)
 *   and the watch's heart rate, energy and strain stay the workout's. Nothing of the watch row is written.
 * - **Nobody did.** The workout gets a row of its own: sport 140 (Strength Training), `imported = 1`, energy from `estimateKcal`
 *   (MET). `imported = 1` keeps it out of the watch-only exports (Health Connect, Apple Health, automatic Strava, whose cursors read
 *   `imported = 0` and which the native sync owns); its energy reaches JoyoRogo through `cloud/strengthKcal.ts` instead.
 * - **A heart rate strap was worn** (`StrapResult`, see `hr.ts`). The workout's own row also gets that heart rate: `avg_hr`, `max_hr`,
 *   `summary.minHr`, the points in `workout_points`, one sample per minute in `step_samples`, the strap in `workout_sensor` and
 *   `summary.sensors`; the energy is the strap's (`kcalSource` `hr`) when it covered enough of the session, else still the MET estimate.
 *   The Strava file and the workout analysis read those points. A watch workout that merges with the session (now or after the next
 *   sync) keeps winning: its row replaces the logger's own row, and with it the strap's points, minute samples and sensor, so the
 *   watch's heart rate and energy are the only ones the workout has.
 *
 * `reconcileLinks` runs after a watch sync: a workout logged first and recorded by the watch later moves from its own row to the
 * watch's.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { minuteHeartRates } from '../record/save';
import { insertWorkoutSensors } from '../sensors/store';
import { estimateKcal } from './calc';
import { recordedSamplesOf, type StrapResult } from './hr';
import { listRecords, saveWorkout } from './store';
import type { StrengthWorkout } from './types';

/** Huawei sport types that a strength session on the logger can be the same recording as: strength, HIIT, calisthenics, classes, gym machines. */
export const STRENGTH_LIKE_SPORTS: readonly number[] = [134, 135, 136, 139, 140, 142, 143, 145, 146, 147, 157];

/** The sport type of the row a logged workout gets: Strength Training. */
export const STRENGTH_SPORT_TYPE = 140;
export const STRENGTH_SPORT_NAME = 'Strength Training';

/** Over this share of the shorter span, two workouts are the same session. */
export const MERGE_OVERLAP_SHARE = 0.5;

/** A `workouts` row as the link logic reads it. */
interface Row {
  start: number;
  end: number;
  sportType: number;
  calories: number;
  imported: number;
}

const startSec = (workout: Pick<StrengthWorkout, 'startedAt'>): number => Math.floor(workout.startedAt / 1000);
const endSec = (workout: Pick<StrengthWorkout, 'endedAt' | 'startedAt'>): number => Math.max(Math.floor(workout.endedAt / 1000), startSec(workout) + 1);

/**
 * The watch workout that is the same session as `workout`: the strength-like, complete, watch-recorded row with the largest overlap above
 * `MERGE_OVERLAP_SHARE`, not already linked to another strength workout. Null when there is none.
 */
export async function findWatchWorkout(db: SQLiteDatabase, workout: StrengthWorkout): Promise<Row | null> {
  const from = startSec(workout);
  const to = endSec(workout);
  const placeholders = STRENGTH_LIKE_SPORTS.map(() => '?').join(', ');
  const rows = await db.getAllAsync<Row>(
    `SELECT start, "end" AS "end", sport_type AS sportType, calories, imported FROM workouts
     WHERE imported = 0 AND complete != 0 AND sport_type IN (${placeholders}) AND start < ? AND "end" > ?
       AND start NOT IN (SELECT workout_start FROM strength_record WHERE kind = 'workout' AND deleted_at IS NULL AND workout_start IS NOT NULL AND id != ?)`,
    ...STRENGTH_LIKE_SPORTS,
    to,
    from,
    workout.id,
  );
  let best: Row | null = null;
  let bestOverlap = 0;
  for (const row of rows) {
    const overlap = Math.min(row.end, to) - Math.max(row.start, from);
    const shorter = Math.max(1, Math.min(row.end - row.start, to - from));
    if (overlap > shorter * MERGE_OVERLAP_SHARE && overlap > bestOverlap) {
      best = row;
      bestOverlap = overlap;
    }
  }
  return best;
}

/** A session imported from JoyoRogo (`rogo:<session id>`): history only, no `workouts` row and no energy pushed back to JoyoRogo. */
export const isImported = (workout: Pick<StrengthWorkout, 'id'>): boolean => workout.id.startsWith('rogo:');

/**
 * `{"kind":"strength"}` plus what the list and the detail show; the watch's `summary_json` shape for a strength row. An own row that
 * already exists keeps what it has (the strap's `minHr`, `sensors` and `kcalSource`), so editing the sets of a workout never drops it.
 */
function summaryOf(workout: StrengthWorkout, previous: string | null, strap: StrapResult | null): string {
  let kept: Record<string, unknown> = {};
  try {
    const parsed: unknown = previous === null ? null : JSON.parse(previous);
    if (typeof parsed === 'object' && parsed !== null) kept = parsed as Record<string, unknown>;
  } catch {
    kept = {};
  }
  return JSON.stringify({
    ...kept,
    kind: 'strength',
    gps: 'none',
    importedFrom: 'JoyoFit strength',
    strengthWorkoutId: workout.id,
    ...(strap
      ? { minHr: strap.minHr, sensors: strap.sensors.map((s) => ({ id: s.id, name: s.name, kinds: [...s.kinds] })), kcalSource: strap.kcal === null ? 'met' : 'hr' }
      : {}),
  });
}

/**
 * The first free `start` at or after `want` (the column is unique and a watch row may have the same second). The row this same workout
 * wrote before (finishing again after a failed save, which has not recorded `workoutStart` yet) is free too: it is updated, not duplicated.
 */
async function freeStart(db: SQLiteDatabase, want: number, own: number | null, workoutId: string): Promise<number> {
  let start = want;
  for (;;) {
    const taken = await db.getFirstAsync<{ summary: string; imported: number }>('SELECT summary_json AS summary, imported FROM workouts WHERE start = ?', start);
    if (!taken || start === own || (taken.imported === 1 && taken.summary.includes(`"strengthWorkoutId":${JSON.stringify(workoutId)}`))) return start;
    start += 1;
  }
}

/**
 * Makes the `workouts` row of a finished or edited workout and returns the workout with `workoutStart`, `kcal` and `kcalSource` set
 * (not saved; callers save it). `weightKg` is the person's weight for the estimate. `strap` is the heart rate of the session (only a
 * session that has just finished has one): it goes into the logger's own row, unless a watch workout is the same session, which then
 * keeps its own heart rate and energy and the strap's data is dropped. Without `strap` an existing own row keeps the strap data it has,
 * and a workout whose energy came from a strap (`kcalSource` `hr`, e.g. pulled from the cloud) keeps that figure instead of the estimate.
 */
export async function attachWorkoutRow(
  db: SQLiteDatabase,
  workout: StrengthWorkout,
  weightKg: number,
  strap: StrapResult | null = null,
): Promise<StrengthWorkout> {
  const watch = await findWatchWorkout(db, workout);
  const estimate = estimateKcal(workout, weightKg);
  if (watch) {
    // The watch row is the workout: the logger's own row (if it had one before the watch synced) goes away.
    if (workout.workoutStart !== null && workout.workoutStart !== watch.start) await removeOwnRow(db, workout.workoutStart);
    return {
      ...workout,
      workoutStart: watch.start,
      kcal: watch.calories > 0 ? watch.calories : estimate,
      kcalSource: watch.calories > 0 ? 'watch' : 'estimate',
    };
  }

  const start = await freeStart(db, startSec(workout), workout.workoutStart, workout.id);
  const end = Math.max(endSec(workout), start + 1);
  const measured = strap?.kcal ?? (strap === null && workout.kcalSource === 'hr' ? workout.kcal : null);
  const kcal = measured ?? estimate;
  const previous = await db.getFirstAsync<{ summary: string; imported: number }>('SELECT summary_json AS summary, imported FROM workouts WHERE start = ?', start);
  await db.runAsync(
    `INSERT INTO workouts (workout_number, start, "end", sport_type, sport_name, duration, distance, calories, avg_hr, max_hr, steps, summary_json, complete, imported)
     VALUES (0, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, ?, 1, 1)
     ON CONFLICT (start) DO UPDATE SET "end" = excluded."end", duration = excluded.duration, calories = excluded.calories, summary_json = excluded.summary_json,
       avg_hr = COALESCE(excluded.avg_hr, workouts.avg_hr), max_hr = COALESCE(excluded.max_hr, workouts.max_hr)
     WHERE workouts.imported = 1`,
    start,
    end,
    STRENGTH_SPORT_TYPE,
    STRENGTH_SPORT_NAME,
    Math.max(0, Math.round(workout.durationSec)),
    kcal,
    strap?.avgHr ?? null,
    strap?.maxHr ?? null,
    summaryOf(workout, previous?.imported === 1 ? previous.summary : null, strap),
  );
  if (strap) await writeStrap(db, start, strap);
  // A changed start moves the row: the old one goes.
  if (workout.workoutStart !== null && workout.workoutStart !== start) await removeOwnRow(db, workout.workoutStart);
  return { ...workout, workoutStart: start, kcal, kcalSource: measured === null ? 'estimate' : 'hr' };
}

const CHUNK = 90;

/** The strap's points, one heart rate per minute in `step_samples` (what Strain and Trends read) and the sensor, replacing an earlier write. */
async function writeStrap(db: SQLiteDatabase, start: number, strap: StrapResult): Promise<void> {
  const row = await db.getFirstAsync<{ id: number }>('SELECT id FROM workouts WHERE start = ?', start);
  if (!row) return;
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM workout_points WHERE workout_id = ?', row.id);
    for (let i = 0; i < strap.samples.length; i += CHUNK) {
      const chunk = strap.samples.slice(i, i + CHUNK);
      await db.runAsync(
        `INSERT INTO workout_points (workout_id, ts, hr) VALUES ${chunk.map(() => '(?, ?, ?)').join(', ')}`,
        ...chunk.flatMap((p) => [row.id, p.ts, p.hr]),
      );
    }
    const minutes = minuteHeartRates(recordedSamplesOf(strap.samples));
    for (let i = 0; i < minutes.length; i += CHUNK) {
      const chunk = minutes.slice(i, i + CHUNK);
      await db.runAsync(
        `INSERT OR IGNORE INTO step_samples (timestamp, steps, calories, distance, heart_rate, imported) VALUES ${chunk.map(() => '(?, 0, 0, 0, ?, 1)').join(', ')}`,
        ...chunk.flatMap(([minute, bpm]) => [minute, bpm]),
      );
    }
    await insertWorkoutSensors(db, row.id, strap.sensors);
  });
}

/**
 * Deletes a row the logger made (`imported = 1`, summary kind strength) with its points, the minute heart rates and the sensors it wrote
 * and its cloud bookkeeping; a watch row is never touched.
 */
export async function removeOwnRow(db: SQLiteDatabase, start: number): Promise<void> {
  const row = await db.getFirstAsync<{ id: number; summary: string; imported: number }>(
    'SELECT id, summary_json AS summary, imported FROM workouts WHERE start = ?',
    start,
  );
  if (!row || row.imported !== 1 || !row.summary.includes('"strengthWorkoutId"')) return;
  const points = await db.getAllAsync<{ ts: number; hr: number }>('SELECT ts, hr FROM workout_points WHERE workout_id = ? AND hr IS NOT NULL', row.id);
  // Only the minutes this logger wrote (heart rate alone): a watch minute with steps, or a minute of another source, stays.
  const minutes = minuteHeartRates(recordedSamplesOf(points)).map(([minute]) => minute);
  for (let i = 0; i < minutes.length; i += CHUNK) {
    const chunk = minutes.slice(i, i + CHUNK);
    await db.runAsync(
      `DELETE FROM step_samples WHERE imported = 1 AND steps = 0 AND calories = 0 AND distance = 0 AND timestamp IN (${chunk.map(() => '?').join(', ')})`,
      ...chunk,
    );
  }
  await db.runAsync('DELETE FROM workout_points WHERE workout_id = ?', row.id);
  await db.runAsync('DELETE FROM workout_sensor WHERE workout_id = ?', row.id);
  await db.runAsync('DELETE FROM workout_rri WHERE workout_id = ?', row.id);
  await db.runAsync('DELETE FROM workouts WHERE id = ?', row.id);
  await db.runAsync('DELETE FROM cloud_workout WHERE start = ?', start);
}

/** A finished workout leaves: its tombstone is saved by the caller; its own `workouts` row is removed here. */
export async function detachWorkoutRow(db: SQLiteDatabase, workout: StrengthWorkout): Promise<void> {
  if (workout.workoutStart !== null) await removeOwnRow(db, workout.workoutStart);
}

/**
 * Links workouts the logger recorded on its own to the watch workout that has appeared since (the watch syncs after the
 * session). Returns the workouts that changed (already saved). Cheap enough to run after every sync: it only looks at workouts whose
 * row is the logger's own.
 */
export async function reconcileLinks(db: SQLiteDatabase, weightKg: number): Promise<StrengthWorkout[]> {
  const own = await db.getAllAsync<{ start: number }>(
    `SELECT start FROM workouts WHERE imported = 1 AND summary_json LIKE '%"strengthWorkoutId"%'`,
  );
  if (own.length === 0) return [];
  const mine = new Set(own.map((r) => r.start));
  const changed: StrengthWorkout[] = [];
  for (const workout of await listRecords(db, 'workout')) {
    if (workout.workoutStart === null || !mine.has(workout.workoutStart)) continue;
    const watch = await findWatchWorkout(db, workout);
    if (!watch) continue;
    const next = await attachWorkoutRow(db, workout, weightKg);
    if (next.workoutStart === workout.workoutStart) continue;
    const saved = { ...next, updatedAt: Math.max(Date.now(), workout.updatedAt + 1) };
    await saveWorkout(db, saved);
    changed.push(saved);
  }
  return changed;
}

/**
 * After a pull from the cloud: a workout whose `workouts` row this phone does not have (the cloud's workout document has not arrived,
 * or the account is not Pro) gets one, so every strength workout shows in the Workouts list. Returns the workouts whose link changed (saved).
 */
export async function ensureRows(db: SQLiteDatabase, workouts: readonly StrengthWorkout[], weightKg: number): Promise<StrengthWorkout[]> {
  const changed: StrengthWorkout[] = [];
  for (const workout of workouts) {
    // History imported from JoyoRogo has no `workouts` row: it never reaches the watch cloud, plan matching or Strava.
    if (workout.deletedAt !== null || isImported(workout)) continue;
    if (workout.workoutStart !== null) {
      const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM workouts WHERE start = ?', workout.workoutStart);
      if (row && row.n > 0) continue;
    }
    const next = await attachWorkoutRow(db, workout, weightKg);
    if (next.workoutStart === workout.workoutStart && next.kcal === workout.kcal) continue;
    // Same `updatedAt`: both phones derive the same row, so this is not an edit the other one has to take.
    await saveWorkout(db, { ...next, updatedAt: workout.updatedAt });
    changed.push(next);
  }
  return changed;
}
