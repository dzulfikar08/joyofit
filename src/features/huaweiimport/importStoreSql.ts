/**
 * The SQL of `SqliteHuaweiImportStore` (`HuaweiImportStore.kt`), statement for statement, run through expo-sqlite's synchronous API
 * on the connection of an exclusive transaction. The rules are the native ones and must stay in step with it:
 *
 * - **Watch data wins.** Rows are inserted with `imported = 1` and never replace a row that exists. A minute the watch already stored
 *   only gets heart rate, SpO2 and resting heart rate where those are NULL; a sleep segment is skipped when a watch-synced one
 *   overlaps it; a workout is skipped when one starts within `WORKOUT_MATCH_SEC` of it.
 * - **Idempotent.** The second run of the same rows changes nothing.
 * - Minute calories are small calories (cal), like the watch's own.
 *
 * Every function runs inside a transaction the caller owns (one per batch) and returns what the native store returns.
 */
import type { SQLiteBindValue, SQLiteDatabase } from 'expo-sqlite';

/** What the writers need of an exclusive transaction's connection (`SQLiteDatabase` has it). */
export type ImportTxn = Pick<SQLiteDatabase, 'execSync' | 'prepareSync'>;

/** `scale_reading.scale_id` of weigh-ins read from the export; no `scale` row belongs to it. */
export const WEIGH_IN_SCALE_ID = 'huawei-health-export';

/** No stored sleep stage is longer than this (the parser refuses longer ones, the watch never writes them). */
export const MAX_SEGMENT_SEC = 24 * 3600;

/** The same workout seen by the watch and by the export differs by a second or two at most. */
export const WORKOUT_MATCH_SEC = 120;

/** `HuaweiExportSports.name(null)`: what a workout whose Huawei sport id was missing is called. */
export const UNKNOWN_SPORT_NAME = 'Workout (Huawei type unknown)';

/** `HuaweiMetricTypes.STRESS`: stress / emotion readings are counted apart from the other metrics. */
export const STRESS_METRIC = 'emotion';

/** `[ts, steps, calories, distance, heartRate, spo2, restingHeartRate]` */
export type MinuteRow = [number, number, number, number, number | null, number | null, number | null];
/** `[start, end, type, stage]` */
export type SleepRow = [number, number, number, string | null];
/** `[type, ts, value, json]` */
export type MetricRow = [string, number, number, string];
/** `[start, end, score, efficiency]` */
export type SleepScoreRow = [number, number, number, number | null];
/** `[kind, key, payload]` */
export type QueueRow = [string, string, string];
/** `[tsMs, weightKg, impedanceOhm, reportedJson]` */
export type WeighInRow = [number, number, number | null, string | null];
/** `[dayStartSec, dayEndSec, noonSec, steps, distance, calories]` */
export type DayTotalRow = [number, number, number, number, number, number];
/** `[ts, lat, lon, alt, hr, speed, cadence, stride, power]` */
export type PointRow = [number, number | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null];

export interface WorkoutLine {
  start: number;
  end: number;
  sportType: number;
  sportName: string;
  duration: number;
  distance: number;
  calories: number;
  steps: number;
  avgHr: number | null;
  maxHr: number | null;
  summaryJson: string;
  points: PointRow[];
}

export interface WorkoutWrite {
  added: boolean;
  points: number;
  updated: boolean;
}

const nul = (v: SQLiteBindValue | undefined): SQLiteBindValue => (v === undefined ? null : v);

function withStatement<T>(txn: ImportTxn, sql: string, body: (run: (params: SQLiteBindValue[]) => number) => T): T {
  const statement = txn.prepareSync(sql);
  try {
    return body((params) => statement.executeSync(params).changes);
  } finally {
    statement.finalizeSync();
  }
}

function rowsOf<T>(txn: ImportTxn, sql: string, params: SQLiteBindValue[]): T[] {
  const statement = txn.prepareSync(sql);
  try {
    return statement.executeSync<T>(params).getAllSync();
  } finally {
    statement.finalizeSync();
  }
}

export function writeMinutes(txn: ImportTxn, rows: readonly MinuteRow[]): number {
  if (rows.length === 0) return 0;
  return withStatement(
    txn,
    `INSERT INTO step_samples (timestamp, steps, calories, distance, heart_rate, spo2, resting_heart_rate, imported)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(timestamp) DO UPDATE SET
       heart_rate = COALESCE(heart_rate, excluded.heart_rate),
       spo2 = COALESCE(spo2, excluded.spo2),
       resting_heart_rate = COALESCE(resting_heart_rate, excluded.resting_heart_rate),
       steps = CASE WHEN imported = 1 AND steps = 0 THEN excluded.steps ELSE steps END,
       distance = CASE WHEN imported = 1 AND distance = 0 THEN excluded.distance ELSE distance END,
       calories = CASE WHEN imported = 1 AND calories = 0 THEN excluded.calories ELSE calories END
     WHERE (heart_rate IS NULL AND excluded.heart_rate IS NOT NULL)
        OR (spo2 IS NULL AND excluded.spo2 IS NOT NULL)
        OR (resting_heart_rate IS NULL AND excluded.resting_heart_rate IS NOT NULL)
        OR (imported = 1 AND steps = 0 AND excluded.steps > 0)
        OR (imported = 1 AND distance = 0 AND excluded.distance > 0)
        OR (imported = 1 AND calories = 0 AND excluded.calories > 0)`,
    (run) => {
      let changed = 0;
      for (const m of rows) changed += run([m[0], m[1], m[2], m[3], nul(m[4]), nul(m[5]), nul(m[6])]);
      return changed;
    },
  );
}

export function writeSleep(txn: ImportTxn, segments: readonly SleepRow[]): number {
  if (segments.length === 0) return 0;
  return withStatement(
    txn,
    `INSERT OR IGNORE INTO sleep_segments (start, end, type, stage, imported)
     SELECT ?, ?, ?, ?, 1
     WHERE NOT EXISTS (SELECT 1 FROM sleep_segments WHERE start > ? AND start < ? AND end > ? AND imported = 0)`,
    (run) => {
      let added = 0;
      for (const s of segments) {
        // The primary key leads with `start`, so a window of the longest stage keeps this lookup off a scan of the table.
        added += run([s[0], s[1], s[2], nul(s[3]), s[0] - MAX_SEGMENT_SEC, s[1], s[0]]);
      }
      return added;
    },
  );
}

/** Metrics go where the watch's own go (`health_metrics`); a row the watch already stored for the same type and second stays. Rows added per type. */
export function writeMetrics(txn: ImportTxn, points: readonly MetricRow[]): Map<string, number> {
  const added = new Map<string, number>();
  if (points.length === 0) return added;
  withStatement(txn, 'INSERT OR IGNORE INTO health_metrics (type, ts, last_ts, value, values_json) VALUES (?, ?, ?, ?, ?)', (run) => {
    for (const p of points) {
      const n = run([p[0], p[1], p[1], p[2], p[3]]);
      if (n > 0) added.set(p[0], (added.get(p[0]) ?? 0) + n);
    }
  });
  return added;
}

/** A night's score where the watch has none starting at the same second; the watch's own row is never replaced. */
export function writeSleepScores(txn: ImportTxn, scores: readonly SleepScoreRow[]): number {
  if (scores.length === 0) return 0;
  return withStatement(txn, 'INSERT OR IGNORE INTO sleep_scores (start, end, score, efficiency) VALUES (?, ?, ?, ?)', (run) => {
    let added = 0;
    for (const s of scores) added += run([s[0], s[1], s[2], nul(s[3])]);
    return added;
  });
}

/**
 * The day's totals are authoritative where the per-minute rows fall short of them. The shortfall (steps / distance / calories the minutes
 * of that day do not account for) goes into one row at the first free minute from noon, marked `imported = 1`. A day whose rows already
 * add up to its total is left alone, which also makes a second run add nothing.
 */
export function writeDayTotals(txn: ImportTxn, totals: readonly DayTotalRow[]): number {
  if (totals.length === 0) return 0;
  let added = 0;
  withStatement(txn, 'INSERT OR IGNORE INTO step_samples (timestamp, steps, calories, distance, imported) VALUES (?, ?, ?, ?, 1)', (insert) => {
    for (const [dayStartSec, dayEndSec, noonSec, dayTotalSteps, dayTotalDistance, dayTotalCalories] of totals) {
      const [have] = rowsOf<{ s: number; c: number; d: number }>(
        txn,
        'SELECT COALESCE(SUM(steps), 0) AS s, COALESCE(SUM(calories), 0) AS c, COALESCE(SUM(distance), 0) AS d FROM step_samples WHERE timestamp >= ? AND timestamp < ?',
        [dayStartSec, dayEndSec],
      );
      const steps = Math.max(0, dayTotalSteps - (have?.s ?? 0));
      const calories = Math.max(0, dayTotalCalories - (have?.c ?? 0));
      const distance = Math.max(0, dayTotalDistance - (have?.d ?? 0));
      if (steps === 0 && calories === 0 && distance === 0) continue;
      const taken = new Set(
        rowsOf<{ timestamp: number }>(txn, 'SELECT timestamp FROM step_samples WHERE timestamp >= ? AND timestamp < ?', [noonSec, dayEndSec]).map((r) => r.timestamp),
      );
      let at = Math.floor(noonSec / 60) * 60;
      while (taken.has(at) && at < dayEndSec) at += 60;
      if (at >= dayEndSec) continue;
      added += insert([at, steps, calories, distance]);
    }
  });
  return added;
}

/**
 * The queue of what JoyoRogo should get from an import (`rogo_import_queue`, created here and by JS, `rogoQueue.ts`): one row per meal or
 * water day, `state` `pending` until JS has sent it. A row that is there already (pending, sent or failed) stays as it is. Returns the rows
 * added per kind.
 */
export function queueForRogo(txn: ImportTxn, items: readonly QueueRow[]): { meals: number; water: number } {
  const added = { meals: 0, water: 0 };
  if (items.length === 0) return added;
  txn.execSync(
    `CREATE TABLE IF NOT EXISTS rogo_import_queue (
       kind TEXT NOT NULL, key TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', error TEXT,
       PRIMARY KEY (kind, key))`,
  );
  withStatement(txn, 'INSERT OR IGNORE INTO rogo_import_queue (kind, key, payload) VALUES (?, ?, ?)', (run) => {
    for (const item of items) {
      const n = run([item[0], item[1], item[2]]);
      if (item[0] === 'water') added.water += n;
      else added.meals += n;
    }
  });
  return added;
}

/**
 * Weigh-ins go where the Bluetooth scale's go (`scale_reading`, created by JS when the database opens; the same statement runs here so an
 * import before the first JS start still works), under the scale id `WEIGH_IN_SCALE_ID` and with `rogo_state = 'pending'`. Skipped when a
 * weigh-in already sits within a minute at about the same weight.
 */
export function writeWeighIns(txn: ImportTxn, weighIns: readonly WeighInRow[]): number {
  if (weighIns.length === 0) return 0;
  txn.execSync(
    `CREATE TABLE IF NOT EXISTS scale_reading (
       id INTEGER PRIMARY KEY AUTOINCREMENT, scale_id TEXT NOT NULL, taken_at INTEGER NOT NULL, weight_kg REAL NOT NULL,
       impedance_ohm REAL, reported TEXT, estimate TEXT, rogo_state TEXT NOT NULL DEFAULT 'pending', rogo_error TEXT)`,
  );
  txn.execSync('CREATE INDEX IF NOT EXISTS scale_reading_taken_at ON scale_reading (taken_at)');
  return withStatement(
    txn,
    `INSERT INTO scale_reading (scale_id, taken_at, weight_kg, impedance_ohm, reported, rogo_state)
     SELECT ?, ?, ?, ?, ?, 'pending'
     WHERE NOT EXISTS (SELECT 1 FROM scale_reading WHERE taken_at BETWEEN ? AND ? AND ABS(weight_kg - ?) < 0.3)`,
    (run) => {
      let added = 0;
      for (const w of weighIns) added += run([WEIGH_IN_SCALE_ID, w[0], w[1], nul(w[2]), nul(w[3]), w[0] - 60_000, w[0] + 60_000, w[1]]);
      return added;
    },
  );
}

interface ExistingWorkout {
  id: number;
  imported: number;
  points: number;
  calories: number;
  distance: number;
  sport_name: string | null;
}

function insertPoints(txn: ImportTxn, workoutId: number, points: readonly PointRow[]): void {
  withStatement(
    txn,
    'INSERT INTO workout_points (workout_id, ts, lat, lon, alt, hr, speed, cadence, stride, power) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    (run) => {
      for (const p of points) run([workoutId, p[0], nul(p[1]), nul(p[2]), nul(p[3]), nul(p[4]), nul(p[5]), nul(p[6]), nul(p[7]), nul(p[8])]);
    },
  );
}

/**
 * Adds the workout unless the database already has one starting within two minutes of it. A workout an earlier import stored without its
 * track and totals is filled in, and so is one named "Workout (Huawei type unknown)" by a read off a broken record (its track is kept);
 * a watch-synced workout is never touched.
 */
export function writeWorkout(txn: ImportTxn, workout: WorkoutLine): WorkoutWrite {
  const [existing] = rowsOf<ExistingWorkout>(
    txn,
    `SELECT id, imported, (SELECT COUNT(*) FROM workout_points WHERE workout_id = workouts.id) AS points, calories, distance, sport_name
     FROM workouts WHERE start BETWEEN ? AND ? LIMIT 1`,
    [workout.start - WORKOUT_MATCH_SEC, workout.start + WORKOUT_MATCH_SEC],
  );
  if (existing) {
    const fillTrack =
      existing.points === 0 && (workout.points.length > 0 || existing.calories !== workout.calories || existing.distance !== workout.distance);
    const fillSport = existing.sport_name === UNKNOWN_SPORT_NAME && workout.sportName !== existing.sport_name;
    if (existing.imported !== 1 || !(fillTrack || fillSport)) return { added: false, points: 0, updated: false };
    withStatement(
      txn,
      `UPDATE workouts SET end = ?, sport_type = ?, sport_name = ?, duration = ?, distance = ?, calories = ?, avg_hr = ?,
         max_hr = ?, steps = ?, summary_json = ? WHERE id = ?`,
      (run) =>
        run([
          workout.end,
          workout.sportType,
          workout.sportName,
          workout.duration,
          workout.distance,
          workout.calories,
          nul(workout.avgHr),
          nul(workout.maxHr),
          workout.steps,
          workout.summaryJson,
          existing.id,
        ]),
    );
    const pointsAdded = existing.points === 0 ? workout.points.length : 0;
    if (pointsAdded > 0) insertPoints(txn, existing.id, workout.points);
    return { added: false, points: pointsAdded, updated: true };
  }
  const statement = txn.prepareSync(
    `INSERT OR IGNORE INTO workouts
       (workout_number, start, end, sport_type, sport_name, duration, distance, calories, avg_hr, max_hr, steps, summary_json, complete, imported)
     VALUES (0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
  );
  let id = 0;
  try {
    const result = statement.executeSync([
      workout.start,
      workout.end,
      workout.sportType,
      workout.sportName,
      workout.duration,
      workout.distance,
      workout.calories,
      nul(workout.avgHr),
      nul(workout.maxHr),
      workout.steps,
      workout.summaryJson,
    ]);
    // An ignored insert (the unique start is taken) changes nothing and has no row id of its own.
    id = result.changes > 0 ? result.lastInsertRowId : 0;
  } finally {
    statement.finalizeSync();
  }
  if (id <= 0) return { added: false, points: 0, updated: false };
  insertPoints(txn, id, workout.points);
  return { added: true, points: workout.points.length, updated: false };
}
