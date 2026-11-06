/**
 * The sensors the person paired (chest strap, speed/cadence sensor, power meter, foot pod) and which of them took part in a workout.
 *
 * Like `strength_record`, these tables are created from JS (`ensureSensorSchema`, run with the other schemas when the database opens)
 * instead of a shared migration: no native code reads them, so they need no new entry in `joyofit-db-migrations.json` and no change in
 * the Kotlin and Swift writers. The `id` is what the radio reports (Android: MAC address, iOS: peripheral UUID), the same role as
 * `device.address` for a watch: attribution is per workout and per sensor (`workout_sensor`), not per sample, because one workout has
 * at most one source per channel.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import type { CscMode, SensorKind } from './gatt';

export interface SavedSensor {
  id: string;
  /** The name the sensor advertises ("Polar H10 7A3B1C2D"). */
  name: string;
  /** What the person called it; null = use `name`. */
  alias: string | null;
  kinds: SensorKind[];
  /** Epoch ms. */
  addedAt: number;
  lastSeen: number | null;
  /** 0..100, from the Battery Service; null until it was read. */
  battery: number | null;
  batteryAt: number | null;
  manufacturer: string | null;
  model: string | null;
  /** Connect when a workout starts. */
  autoConnect: boolean;
}

interface Row {
  id: string;
  name: string;
  alias: string | null;
  kinds: string;
  added_at: number;
  last_seen: number | null;
  battery: number | null;
  battery_at: number | null;
  manufacturer: string | null;
  model: string | null;
  auto_connect: number;
}

export async function ensureSensorSchema(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS sensor (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      alias TEXT,
      kinds TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      last_seen INTEGER,
      battery INTEGER,
      battery_at INTEGER,
      manufacturer TEXT,
      model TEXT,
      auto_connect INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS workout_sensor (
      workout_id INTEGER NOT NULL,
      sensor_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kinds TEXT NOT NULL,
      PRIMARY KEY (workout_id, sensor_id)
    );
    -- A chest strap's beat-to-beat intervals of one phone recording (ms, oldest first, JSON array), as the strap sent them within
    -- 250..2000 ms: the raw series the FIT export carries as hrv messages, for comparison with other devices (docs/hr-validation.md).
    CREATE TABLE IF NOT EXISTS workout_rri (
      workout_id INTEGER PRIMARY KEY,
      rri TEXT NOT NULL
    );
  `);
}

const KINDS: readonly SensorKind[] = ['hr', 'power', 'csc', 'rsc', 'thermometer'];

/** A bedroom thermometer: read from its advertisements (`features/thermometer`), never connected, never part of a workout. */
export const isThermometer = (s: Pick<SavedSensor, 'kinds'>): boolean => s.kinds.includes('thermometer');

/** What workouts, the Watch tab's sensor card and the sensor manager deal with: every paired sensor except the thermometers. */
export const isSportSensor = (s: Pick<SavedSensor, 'kinds'>): boolean => !isThermometer(s);

function parseKinds(json: string): SensorKind[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? KINDS.filter((k) => value.includes(k)) : [];
  } catch {
    return [];
  }
}

function fromRow(r: Row): SavedSensor {
  return {
    id: r.id,
    name: r.name,
    alias: r.alias,
    kinds: parseKinds(r.kinds),
    addedAt: r.added_at,
    lastSeen: r.last_seen,
    battery: r.battery,
    batteryAt: r.battery_at,
    manufacturer: r.manufacturer,
    model: r.model,
    autoConnect: r.auto_connect !== 0,
  };
}

/** What a list shows: the person's name for it, else the advertised one. */
export const sensorLabel = (s: Pick<SavedSensor, 'name' | 'alias'>): string => s.alias?.trim() || s.name;

export async function listSensors(db: SQLiteDatabase): Promise<SavedSensor[]> {
  const rows = await db.getAllAsync<Row>('SELECT * FROM sensor ORDER BY added_at, id');
  return rows.map(fromRow);
}

/** Remembers a sensor (pairing). Pairing it again keeps its alias and refreshes its name and kinds. */
export async function saveSensor(
  db: SQLiteDatabase,
  sensor: { id: string; name: string; kinds: readonly SensorKind[] },
  now: number,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO sensor (id, name, kinds, added_at, last_seen) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, kinds = excluded.kinds, last_seen = excluded.last_seen`,
    sensor.id,
    sensor.name,
    JSON.stringify(sensor.kinds),
    now,
    now,
  );
}

export async function renameSensor(db: SQLiteDatabase, id: string, alias: string): Promise<void> {
  const trimmed = alias.trim();
  await db.runAsync('UPDATE sensor SET alias = ? WHERE id = ?', trimmed === '' ? null : trimmed.slice(0, 40), id);
}

export async function setSensorAutoConnect(db: SQLiteDatabase, id: string, on: boolean): Promise<void> {
  await db.runAsync('UPDATE sensor SET auto_connect = ? WHERE id = ?', on ? 1 : 0, id);
}

/** Forgets a sensor. Workouts it recorded keep their `workout_sensor` row (the name stays readable in the history). */
export async function removeSensor(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM sensor WHERE id = ?', id);
}

export interface SensorInfoUpdate {
  battery?: number;
  manufacturer?: string;
  model?: string;
  /** Services the connection found: replaces `kinds` when not empty. */
  kinds?: readonly SensorKind[];
  seenAt?: number;
}

/** Fields only change when given, so a battery reading never clears the model. */
export async function updateSensorInfo(db: SQLiteDatabase, id: string, info: SensorInfoUpdate): Promise<void> {
  const sets: string[] = [];
  const args: (string | number)[] = [];
  if (info.battery !== undefined) {
    sets.push('battery = ?', 'battery_at = ?');
    args.push(info.battery, info.seenAt ?? Date.now());
  }
  if (info.manufacturer !== undefined) {
    sets.push('manufacturer = ?');
    args.push(info.manufacturer);
  }
  if (info.model !== undefined) {
    sets.push('model = ?');
    args.push(info.model);
  }
  if (info.kinds && info.kinds.length > 0) {
    sets.push('kinds = ?');
    args.push(JSON.stringify(info.kinds));
  }
  if (info.seenAt !== undefined) {
    sets.push('last_seen = ?');
    args.push(info.seenAt);
  }
  if (sets.length === 0) return;
  await db.runAsync(`UPDATE sensor SET ${sets.join(', ')} WHERE id = ?`, ...args, id);
}

export interface WorkoutSensor {
  id: string;
  name: string;
  kinds: SensorKind[];
  /**
   * Values of this sensor the recording took. 0 is a sensor the recording asked for that never sent one (its row says so on the workout);
   * absent on a recording made before this was kept. Kept in the workout's summary, not in `workout_sensor`.
   */
  frames?: number;
  /** What its CSC frames carried (wheel only, crank only or both), absent when it sent none or is not a CSC sensor. */
  mode?: CscMode;
}

/** The sensors a workout used, as they were called when it was recorded. */
export async function listWorkoutSensors(db: SQLiteDatabase, workoutId: number): Promise<WorkoutSensor[]> {
  const rows = await db.getAllAsync<{ sensor_id: string; name: string; kinds: string }>(
    'SELECT sensor_id, name, kinds FROM workout_sensor WHERE workout_id = ? ORDER BY name',
    workoutId,
  );
  return rows.map((r) => ({ id: r.sensor_id, name: r.name, kinds: parseKinds(r.kinds) }));
}

/** Inside the save transaction: which sensors took part in workout `workoutId`. */
export async function insertWorkoutSensors(
  txn: Pick<SQLiteDatabase, 'runAsync'>,
  workoutId: number,
  sensors: readonly WorkoutSensor[],
): Promise<void> {
  for (const s of sensors) {
    await txn.runAsync(
      'INSERT OR REPLACE INTO workout_sensor (workout_id, sensor_id, name, kinds) VALUES (?, ?, ?, ?)',
      workoutId,
      s.id,
      s.name,
      JSON.stringify(s.kinds),
    );
  }
}

/** Inside the save transaction: the R-R intervals of workout `workoutId`, whole milliseconds. Nothing is stored for an empty list. */
export async function insertWorkoutRri(txn: Pick<SQLiteDatabase, 'runAsync'>, workoutId: number, rri: readonly number[]): Promise<void> {
  if (rri.length === 0) return;
  await txn.runAsync('INSERT OR REPLACE INTO workout_rri (workout_id, rri) VALUES (?, ?)', workoutId, JSON.stringify(rri.map((v) => Math.round(v))));
}

/** The stored R-R intervals of a workout (ms, oldest first); empty when it has none or the table does not exist yet. */
export async function listWorkoutRri(db: Pick<SQLiteDatabase, 'getFirstAsync'>, workoutId: number): Promise<number[]> {
  try {
    const row = await db.getFirstAsync<{ rri: string }>('SELECT rri FROM workout_rri WHERE workout_id = ?', workoutId);
    const parsed: unknown = row ? JSON.parse(row.rri) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is number => typeof v === 'number' && v > 0) : [];
  } catch {
    return [];
  }
}

/** Display text of a sensor kind list's role ("heart rate, cadence"): the labels live in i18n, this is the channel id list. */
export function kindChannels(kinds: readonly SensorKind[]): ('hr' | 'speed' | 'cadence' | 'power' | 'pod')[] {
  const out: ('hr' | 'speed' | 'cadence' | 'power' | 'pod')[] = [];
  if (kinds.includes('hr')) out.push('hr');
  if (kinds.includes('csc')) out.push('speed', 'cadence');
  if (kinds.includes('power')) out.push('power');
  if (kinds.includes('rsc')) out.push('pod');
  return out;
}
