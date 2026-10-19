import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';

import { createTransactionLane } from './transactionLane';

/** expo-sqlite's SQLiteDatabase for what the lane touches, over one real bun:sqlite handle: `withTransactionAsync` is copied from expo. */
class SharedHandle {
  readonly raw = new Database(':memory:');
  readonly log: string[] = [];
  private lane: ReturnType<typeof createTransactionLane> | null = null;

  constructor(useLane: boolean) {
    this.raw.exec('CREATE TABLE t (n INTEGER)');
    if (useLane) {
      const lane = createTransactionLane();
      const original = this.withTransactionAsync.bind(this);
      this.withTransactionAsync = (task) => lane(() => original(task));
      this.lane = lane;
    }
  }

  // Each statement is its own async hop, as with the native module.
  async execAsync(sql: string): Promise<void> {
    await Promise.resolve();
    this.log.push(sql);
    this.raw.exec(sql);
  }

  async runAsync(sql: string): Promise<void> {
    await this.execAsync(sql);
  }

  // From expo-sqlite: SQLiteDatabase.withTransactionAsync.
  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    try {
      await this.execAsync('BEGIN');
      await task();
      await this.execAsync('COMMIT');
    } catch (e) {
      await this.execAsync('ROLLBACK');
      throw e;
    }
  }

  get laned(): boolean {
    return this.lane !== null;
  }
}

const insertTwice = (db: SharedHandle, base: number) => async () => {
  await db.runAsync(`INSERT INTO t VALUES (${base})`);
  await db.runAsync(`INSERT INTO t VALUES (${base + 1})`);
};

describe('withTransactionAsync on the shared handle', () => {
  it('without the lane two transactions started together fail with a nested BEGIN (what the owner saw)', async () => {
    const db = new SharedHandle(false);
    const results = await Promise.allSettled([db.withTransactionAsync(insertTwice(db, 1)), db.withTransactionAsync(insertTwice(db, 10))]);
    expect(results.some((r) => r.status === 'rejected' && /within a transaction/.test(String(r.reason)))).toBe(true);
  });

  it('with the lane every transaction runs whole, one after the other', async () => {
    const db = new SharedHandle(true);
    const results = await Promise.allSettled([
      db.withTransactionAsync(insertTwice(db, 1)),
      db.withTransactionAsync(insertTwice(db, 10)),
      db.withTransactionAsync(insertTwice(db, 20)),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
    expect(db.raw.query('SELECT COUNT(*) AS n FROM t').get()).toEqual({ n: 6 });
    // BEGIN never starts while another transaction is open: BEGIN/COMMIT strictly alternate.
    const frame = db.log.filter((sql) => sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK');
    expect(frame).toEqual(['BEGIN', 'COMMIT', 'BEGIN', 'COMMIT', 'BEGIN', 'COMMIT']);
  });

  it('a failing transaction rolls back and the next one still runs', async () => {
    const db = new SharedHandle(true);
    const failing = db.withTransactionAsync(async () => {
      await db.runAsync('INSERT INTO t VALUES (1)');
      throw new Error('boom');
    });
    const after = db.withTransactionAsync(insertTwice(db, 5));
    await expect(failing).rejects.toThrow('boom');
    await after;
    expect(db.raw.query('SELECT n FROM t ORDER BY n').all()).toEqual([{ n: 5 }, { n: 6 }]);
  });

  it('lets a transaction go ahead after maxWaitMs when the one before it never finishes (a task that waits for its own nested transaction)', async () => {
    const lane = createTransactionLane(50);
    void lane(() => new Promise<void>(() => undefined));
    const second = lane(async () => 'ran');
    // Still waiting after 10 ms (the clock is not read: other test files may have frozen Date.now), then going ahead once the wait limit passed.
    const early = await Promise.race([second, new Promise<string>((resolve) => setTimeout(() => resolve('waiting'), 10))]);
    expect(early).toBe('waiting');
    expect(await second).toBe('ran');
  });
});
