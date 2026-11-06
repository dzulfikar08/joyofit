/**
 * Stores a finished phone recording as a normal workout, the way a FIT import does (`imported = 1`, `device` NULL: the native watch
 * writers, Health Connect export and automatic Strava upload only look at watch rows), with its samples in `workout_points`, one HR
 * sample per minute in `step_samples` (what Strain and Trends read), the sensors that took part in `workout_sensor` and a chest
 * strap's R-R intervals in `workout_rri`.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { workoutElevation } from '../workouts/analysis/elevation';
import { SPORT_ROWS } from '../workouts/manual';
import type { VirtualRide, WorkoutSummary } from '../workouts/summary';
import { insertWorkoutRri, insertWorkoutSensors, type WorkoutSensor } from '../sensors/store';
import type { RecordedSample, RecordedWorkout } from './recorder';
import { filterRriArtefacts, hrvMetrics } from './rri';

export type SaveDb = Pick<SQLiteDatabase, 'getAllAsync' | 'withExclusiveTransactionAsync'>;

const CHUNK = 90;

/** Mean heart rate per whole minute: what the watch stores in `step_samples`. */
export function minuteHeartRates(samples: readonly RecordedSample[]): [minute: number, bpm: number][] {
  const sums = new Map<number, { total: number; n: number }>();
  for (const p of samples) {
    if (p.hr === null) continue;
    const minute = p.ts - (p.ts % 60);
    const slot = sums.get(minute);
    if (slot) {
      slot.total += p.hr;
      slot.n += 1;
    } else sums.set(minute, { total: p.hr, n: 1 });
  }
  return [...sums].map(([m, { total, n }]) => [m, Math.round(total / n)] as [number, number]).sort((a, b) => a[0] - b[0]);
}

/** The `summary_json` of a recording (also what `workoutElevation` reads its fallbacks from). */
export function summaryOf(w: RecordedWorkout, sensors: readonly WorkoutSensor[], samples: readonly RecordedSample[], start: number, end: number, virtual?: VirtualRide): WorkoutSummary {
  const row = SPORT_ROWS[w.sport];
  const fixes = samples.filter((p) => p.lat !== null);
  const alts = samples.map((p) => p.alt).filter((a): a is number => a !== null);
  const summary: WorkoutSummary = {
    kind: row.kind,
    gps: fixes.length > 0 ? 'ok' : 'none',
    gpsPoints: fixes.length,
    avgSpeed: w.avgSpeed ?? undefined,
    maxSpeed: w.maxSpeed ?? undefined,
    avgPaceSecPerKm: row.foot && w.avgSpeed ? 1000 / w.avgSpeed : undefined,
    minPaceSecPerKm: row.foot && w.maxSpeed ? 1000 / w.maxSpeed : undefined,
    minHr: w.minHr ?? undefined,
    minAltitude: alts.length > 0 ? Math.min(...alts) : undefined,
    maxAltitude: alts.length > 0 ? Math.max(...alts) : undefined,
    avgCadence: w.avgCadence ?? undefined,
    maxCadence: w.maxCadence ?? undefined,
    avgPower: w.avgPower ?? undefined,
    maxPower: w.maxPower ?? undefined,
    normalizedPower: w.normalizedPower ?? undefined,
    balanceLeftPct: w.balanceLeftPct ?? undefined,
    laps:
      w.laps.length >= 2
        ? w.laps.map((l) => ({ startTs: l.startTs, endTs: l.endTs, distanceM: Math.round(l.distanceM), avgHr: l.avgHr, maxHr: l.maxHr, avgCadence: l.avgCadence }))
        : undefined,
    source: 'phone',
    sensors: sensors.map((s) => ({
      id: s.id,
      name: s.name,
      kinds: [...s.kinds],
      ...(s.frames !== undefined ? { frames: s.frames } : {}),
      ...(s.mode !== undefined ? { mode: s.mode } : {}),
    })),
    kcalSource: w.kcalSource,
  };
  const elevation = workoutElevation({ start, end, duration: w.movingSec }, summary, samples);
  if (elevation) {
    summary.elevationGain = elevation.gainM;
    summary.elevationLoss = elevation.lossM;
    summary.ascentSource = 'computed';
  }
  if (virtual) {
    // The web game's route is the ride: its climb replaces the (absent) altitude, and the average speed follows its distance.
    summary.virtualRide = virtual;
    summary.elevationGain = virtual.elevM;
    summary.ascentSource = 'virtual';
    if (w.movingSec > 0) summary.avgSpeed = virtual.distM / w.movingSec;
  }
  if (w.rri && w.rri.length > 0) {
    const hrv = hrvMetrics(filterRriArtefacts(w.rri));
    if (hrv) summary.hrv = hrv;
  }
  return summary;
}

/**
 * Inserts the workout and returns its row id. A start second that is taken (it is unique) moves the whole workout later by whole
 * seconds, as a manual workout does.
 */
export async function saveRecordedWorkout(db: SaveDb, w: RecordedWorkout, sensors: readonly WorkoutSensor[], virtual?: VirtualRide): Promise<number> {
  let id = 0;
  await db.withExclusiveTransactionAsync(async (txn) => {
    let shift = 0;
    for (; shift < 60; shift += 1) {
      const taken = await txn.getAllAsync<{ n: number }>('SELECT COUNT(*) AS n FROM workouts WHERE start = ?', [w.start + shift]);
      if (!taken[0] || taken[0].n === 0) break;
    }
    const start = w.start + shift;
    const end = w.end + shift;
    const samples = shift === 0 ? w.samples : w.samples.map((p) => ({ ...p, ts: p.ts + shift }));
    const summary = summaryOf(w, sensors, samples, start, end, virtual);
    const row = SPORT_ROWS[w.sport];
    const inserted = await txn.runAsync(
      `INSERT INTO workouts
         (workout_number, start, end, sport_type, sport_name, duration, distance, calories, avg_hr, max_hr, steps, summary_json, complete, imported)
       VALUES (0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
      [start, end, row.type, row.name, w.movingSec, Math.round(virtual ? virtual.distM : w.distanceM), w.calories, w.avgHr, w.maxHr, w.steps, JSON.stringify(summary)],
    );
    id = inserted.lastInsertRowId;
    for (let i = 0; i < samples.length; i += CHUNK) {
      const chunk = samples.slice(i, i + CHUNK);
      await txn.runAsync(
        `INSERT INTO workout_points (workout_id, ts, lat, lon, alt, hr, speed, cadence, stride, power)
         VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
        chunk.flatMap((p) => [id, p.ts, p.lat, p.lon, p.alt, p.hr, p.speed, p.cadence, p.stride, p.power]),
      );
    }
    const minutes = minuteHeartRates(samples);
    for (let i = 0; i < minutes.length; i += CHUNK) {
      const chunk = minutes.slice(i, i + CHUNK);
      await txn.runAsync(
        `INSERT OR IGNORE INTO step_samples (timestamp, steps, calories, distance, heart_rate, imported) VALUES ${chunk.map(() => '(?, 0, 0, 0, ?, 1)').join(', ')}`,
        chunk.flatMap(([minute, bpm]) => [minute, bpm]),
      );
    }
    await insertWorkoutSensors(txn, id, sensors);
    await insertWorkoutRri(txn, id, w.rri ?? []);
  });
  return id;
}
