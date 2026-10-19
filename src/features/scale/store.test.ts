import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';

import {
  completeWeighIn, deleteWeighIn, ensureScaleSchema, insertWeighIn, latestWeighIn, listScales, listWeighIns, markRogo,
  pendingWeighIns, removeScale, renameScale, saveScale, scaleLabel, type ScaleDb,
} from './store';
import { pushPendingWeighIns } from './sync';

async function openDb(): Promise<ScaleDb> {
  const raw = new Database(':memory:');
  const flat = (params: unknown[]) => (params.length === 1 && Array.isArray(params[0]) ? params[0] : params) as never[];
  const db = {
    getAllAsync: async (sql: string, ...p: unknown[]) => raw.query(sql).all(...flat(p)),
    getFirstAsync: async (sql: string, ...p: unknown[]) => raw.query(sql).get(...flat(p)),
    runAsync: async (sql: string, ...p: unknown[]) => {
      const r = raw.query(sql).run(...flat(p));
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: r.changes };
    },
    execAsync: async (sql: string) => raw.exec(sql),
  } as unknown as ScaleDb;
  await ensureScaleSchema(db);
  return db;
}

const weigh = (takenAt: number, weightKg: number, rogoState: 'pending' | 'skipped' = 'pending') => ({
  scaleId: 'AA', takenAt, reading: { weightKg }, reported: null, estimate: null, rogoState,
});

describe('scale store', () => {
  it('remembers a scale, keeps the alias when it is picked again, forgets it without touching weigh-ins', async () => {
    const db = await openDb();
    await saveScale(db, { id: 'AA', name: 'ADV', protocolId: 'okok-chipsea-broadcast' }, 10);
    await renameScale(db, 'AA', '  Kamar mandi ');
    await saveScale(db, { id: 'AA', name: 'ADV2', protocolId: 'okok-chipsea-broadcast' }, 20);
    const [scale] = await listScales(db);
    expect(scale).toMatchObject({ id: 'AA', name: 'ADV2', alias: 'Kamar mandi', addedAt: 10, lastSeen: 20 });
    expect(scaleLabel(scale)).toBe('Kamar mandi');
    await insertWeighIn(db, weigh(1, 70));
    await removeScale(db, 'AA');
    expect(await listScales(db)).toEqual([]);
    expect(await listWeighIns(db)).toHaveLength(1);
  });

  it('stores weigh-ins with body values and returns them newest first', async () => {
    const db = await openDb();
    await insertWeighIn(db, weigh(1_000, 70.5));
    const id = await insertWeighIn(db, {
      scaleId: 'AA', takenAt: 2_000, reading: { weightKg: 71, impedanceOhm: 480 },
      reported: { bodyFatPct: 20 }, estimate: { formula: 'standard', source: 'x', bodyFatPct: 22 }, rogoState: 'pending',
    });
    const all = await listWeighIns(db);
    expect(all.map((w) => w.weightKg)).toEqual([71, 70.5]);
    expect(all[0]).toMatchObject({ impedanceOhm: 480, reported: { bodyFatPct: 20 }, estimate: { formula: 'standard', bodyFatPct: 22 } });
    expect((await latestWeighIn(db))?.id).toBe(id);
    await completeWeighIn(db, id, { impedanceOhm: 500, reported: null, estimate: null });
    expect((await latestWeighIn(db))).toMatchObject({ impedanceOhm: 500, reported: null, estimate: null });
    await deleteWeighIn(db, id);
    expect((await latestWeighIn(db))?.weightKg).toBe(70.5);
  });
});

describe('pushPendingWeighIns', () => {
  const notSignedIn = (e: unknown) => (e as Error).message === 'offline';

  it('sends pending rows oldest first, marks them sent, and skips what JoyoRogo would refuse', async () => {
    const db = await openDb();
    const day = Date.UTC(2026, 9, 19, 1);
    await insertWeighIn(db, weigh(day + 2_000, 73.5));
    await insertWeighIn(db, weigh(day, 73.9));
    await insertWeighIn(db, weigh(day + 1_000, 12));
    const sent: unknown[] = [];
    const out = await pushPendingWeighIns(db, async (i) => void sent.push(i), notSignedIn);
    expect(sent).toEqual([{ weightKg: 73.9, date: '2026-10-19' }, { weightKg: 73.5, date: '2026-10-19' }]);
    expect(out).toEqual({ sent: 2, waiting: 0 });
    expect(await pendingWeighIns(db)).toEqual([]);
    expect((await listWeighIns(db)).map((w) => w.rogoState).sort()).toEqual(['sent', 'sent', 'skipped']);
  });

  it('stops quietly when offline or signed out and leaves everything pending', async () => {
    const db = await openDb();
    await insertWeighIn(db, weigh(1, 70));
    await insertWeighIn(db, weigh(2, 71));
    const out = await pushPendingWeighIns(db, async () => { throw new Error('offline'); }, notSignedIn);
    expect(out).toEqual({ sent: 0, waiting: 2 });
    expect((await pendingWeighIns(db)).map((w) => w.rogoError)).toEqual([null, null]);
  });

  it('keeps the answer of a real error on the row and stops', async () => {
    const db = await openDb();
    await insertWeighIn(db, weigh(1, 70));
    await insertWeighIn(db, weigh(2, 71));
    let calls = 0;
    const out = await pushPendingWeighIns(db, async () => { calls++; throw new Error('Sesi ditolak'); }, notSignedIn);
    expect(calls).toBe(1);
    expect(out).toEqual({ sent: 0, waiting: 2 });
    expect((await pendingWeighIns(db))[0].rogoError).toBe('Sesi ditolak');
  });

  it('a row marked skipped is never sent', async () => {
    const db = await openDb();
    const id = await insertWeighIn(db, weigh(1, 70, 'skipped'));
    let calls = 0;
    await pushPendingWeighIns(db, async () => void calls++, notSignedIn);
    expect(calls).toBe(0);
    await markRogo(db, id, 'pending', null);
    await pushPendingWeighIns(db, async () => void calls++, notSignedIn);
    expect(calls).toBe(1);
  });
});
