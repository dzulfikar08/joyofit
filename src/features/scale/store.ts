/**
 * The scale the person picked and the weigh-ins it delivered. Like the sensor tables these are created from JS (`ensureScaleSchema`, run
 * with the other schemas when the database opens): no native code reads them, so no shared migration. A weigh-in is kept locally first;
 * `rogo_state` says whether JoyoRogo has it yet (`pending` is retried, `sent` is done, `skipped` is a weight JoyoRogo does not accept or a
 * push the person switched off).
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import type { BodyEstimate } from './bodyComposition';
import type { ReportedBody, ScaleReading } from './types';

export type ScaleDb = Pick<SQLiteDatabase, 'getAllAsync' | 'getFirstAsync' | 'runAsync' | 'execAsync'>;

export interface SavedScale {
  /** Android: MAC address. iOS: peripheral identifier. */
  id: string;
  name: string;
  alias: string | null;
  protocolId: string;
  addedAt: number;
  lastSeen: number | null;
}

export type RogoState = 'pending' | 'sent' | 'skipped';

export interface WeighIn {
  id: number;
  scaleId: string;
  takenAt: number;
  weightKg: number;
  impedanceOhm: number | null;
  reported: ReportedBody | null;
  /** A formula estimate from the impedance; shown labelled as an estimate, never as a measurement. */
  estimate: BodyEstimate | null;
  rogoState: RogoState;
  rogoError: string | null;
}

interface ScaleRow {
  id: string;
  name: string;
  alias: string | null;
  protocol_id: string;
  added_at: number;
  last_seen: number | null;
}

interface WeighInRow {
  id: number;
  scale_id: string;
  taken_at: number;
  weight_kg: number;
  impedance_ohm: number | null;
  reported: string | null;
  estimate: string | null;
  rogo_state: RogoState;
  rogo_error: string | null;
}

export async function ensureScaleSchema(db: Pick<SQLiteDatabase, 'execAsync'>): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS scale (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      alias TEXT,
      protocol_id TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      last_seen INTEGER
    );
    CREATE TABLE IF NOT EXISTS scale_reading (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scale_id TEXT NOT NULL,
      taken_at INTEGER NOT NULL,
      weight_kg REAL NOT NULL,
      impedance_ohm REAL,
      reported TEXT,
      estimate TEXT,
      rogo_state TEXT NOT NULL DEFAULT 'pending',
      rogo_error TEXT
    );
    CREATE INDEX IF NOT EXISTS scale_reading_taken_at ON scale_reading (taken_at);
  `);
}

const scaleOf = (r: ScaleRow): SavedScale => ({
  id: r.id,
  name: r.name,
  alias: r.alias,
  protocolId: r.protocol_id,
  addedAt: r.added_at,
  lastSeen: r.last_seen,
});

function parseJson<T>(text: string | null): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

const weighInOf = (r: WeighInRow): WeighIn => ({
  id: r.id,
  scaleId: r.scale_id,
  takenAt: r.taken_at,
  weightKg: r.weight_kg,
  impedanceOhm: r.impedance_ohm,
  reported: parseJson<ReportedBody>(r.reported),
  estimate: parseJson<BodyEstimate>(r.estimate),
  rogoState: r.rogo_state,
  rogoError: r.rogo_error,
});

/** What a list shows: the person's name for it, else the advertised one. */
export const scaleLabel = (s: Pick<SavedScale, 'name' | 'alias'>): string => s.alias?.trim() || s.name;

export async function listScales(db: ScaleDb): Promise<SavedScale[]> {
  return (await db.getAllAsync<ScaleRow>('SELECT * FROM scale ORDER BY added_at, id')).map(scaleOf);
}

/** Remembers a scale. Picking it again keeps its alias and refreshes its name and protocol. */
export async function saveScale(db: ScaleDb, scale: { id: string; name: string; protocolId: string }, now: number): Promise<void> {
  await db.runAsync(
    `INSERT INTO scale (id, name, protocol_id, added_at, last_seen) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, protocol_id = excluded.protocol_id, last_seen = excluded.last_seen`,
    scale.id,
    scale.name,
    scale.protocolId,
    now,
    now,
  );
}

export async function renameScale(db: ScaleDb, id: string, alias: string): Promise<void> {
  const trimmed = alias.trim();
  await db.runAsync('UPDATE scale SET alias = ? WHERE id = ?', trimmed === '' ? null : trimmed.slice(0, 40), id);
}

/** Forgets a scale; its weigh-ins stay (they are the person's history). */
export async function removeScale(db: ScaleDb, id: string): Promise<void> {
  await db.runAsync('DELETE FROM scale WHERE id = ?', id);
}

export async function touchScale(db: ScaleDb, id: string, now: number): Promise<void> {
  await db.runAsync('UPDATE scale SET last_seen = ? WHERE id = ?', now, id);
}

export interface NewWeighIn {
  scaleId: string;
  takenAt: number;
  reading: Pick<ScaleReading, 'weightKg' | 'impedanceOhm'>;
  reported: ReportedBody | null;
  estimate: BodyEstimate | null;
  /** `skipped` for a weight JoyoRogo does not take or when pushing is off; `pending` otherwise. */
  rogoState: RogoState;
}

export async function insertWeighIn(db: ScaleDb, w: NewWeighIn): Promise<number> {
  const result = await db.runAsync(
    `INSERT INTO scale_reading (scale_id, taken_at, weight_kg, impedance_ohm, reported, estimate, rogo_state)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    w.scaleId,
    w.takenAt,
    w.reading.weightKg,
    w.reading.impedanceOhm ?? null,
    w.reported ? JSON.stringify(w.reported) : null,
    w.estimate ? JSON.stringify(w.estimate) : null,
    w.rogoState,
  );
  return result.lastInsertRowId;
}

/** The same weigh-in arrived again with impedance (and what follows from it): completes the row instead of adding one. */
export async function completeWeighIn(
  db: ScaleDb,
  id: number,
  update: { impedanceOhm: number | null; reported: ReportedBody | null; estimate: BodyEstimate | null },
): Promise<void> {
  await db.runAsync(
    'UPDATE scale_reading SET impedance_ohm = ?, reported = ?, estimate = ? WHERE id = ?',
    update.impedanceOhm,
    update.reported ? JSON.stringify(update.reported) : null,
    update.estimate ? JSON.stringify(update.estimate) : null,
    id,
  );
}

export async function listWeighIns(db: ScaleDb, limit = 60): Promise<WeighIn[]> {
  return (await db.getAllAsync<WeighInRow>('SELECT * FROM scale_reading ORDER BY taken_at DESC, id DESC LIMIT ?', limit)).map(weighInOf);
}

export async function latestWeighIn(db: ScaleDb): Promise<WeighIn | null> {
  const row = await db.getFirstAsync<WeighInRow>('SELECT * FROM scale_reading ORDER BY taken_at DESC, id DESC LIMIT 1');
  return row ? weighInOf(row) : null;
}

export async function deleteWeighIn(db: ScaleDb, id: number): Promise<void> {
  await db.runAsync('DELETE FROM scale_reading WHERE id = ?', id);
}

/** Weigh-ins JoyoRogo does not have yet, oldest first. */
export async function pendingWeighIns(db: ScaleDb): Promise<WeighIn[]> {
  return (await db.getAllAsync<WeighInRow>("SELECT * FROM scale_reading WHERE rogo_state = 'pending' ORDER BY taken_at, id")).map(weighInOf);
}

export async function markRogo(db: ScaleDb, id: number, state: RogoState, error: string | null): Promise<void> {
  await db.runAsync('UPDATE scale_reading SET rogo_state = ?, rogo_error = ? WHERE id = ?', state, error, id);
}
