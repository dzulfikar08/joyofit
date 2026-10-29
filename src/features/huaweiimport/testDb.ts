// Test-only (bun): the real schema in memory behind the slice of expo-sqlite the applier uses, and import-file sources read from a path or bytes.
// To apply a real file to a fresh database from a test or a script:
//   const f = openImportDb();
//   const summary = await applyImportFileAtPath(f.db, '/tmp/joyofit-import-sample.ndjson.gz');
//   f.all('SELECT COUNT(*) AS n FROM step_samples');   // read the rows back
import { Database, type Statement } from 'bun:sqlite';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

import type { HuaweiImportSummary } from '@/wear';

import migrations from '../../../modules/huawei-wear/schema/joyofit-db-migrations.json';
import { applyImportFile, type ImportDb, type ImportRunOptions, type ImportSource } from './importFileCore';
import type { ImportTxn } from './importStoreSql';

/** `prepareSync` on bun:sqlite with the result shape the applier reads (`changes`, `lastInsertRowId`, `getAllSync`). */
function txnOf(raw: Database): ImportTxn {
  return {
    execSync: (sql: string) => raw.exec(sql),
    prepareSync: (sql: string) => {
      const statement: Statement = raw.prepare(sql);
      return {
        executeSync: (params: unknown[] = []) => {
          if (statement.columnNames.length > 0) {
            const rows = statement.all(...(params as never[]));
            return { changes: 0, lastInsertRowId: 0, getAllSync: () => rows };
          }
          const r = statement.run(...(params as never[]));
          return { changes: r.changes, lastInsertRowId: Number(r.lastInsertRowid), getAllSync: () => [] };
        },
        finalizeSync: () => statement.finalize(),
      };
    },
  } as unknown as ImportTxn;
}

/** A fresh database with the shipped schema (every migration the app and the native side share). */
export function openImportDb() {
  const raw = new Database(':memory:');
  for (const statements of migrations) raw.exec(statements.join(';\n'));
  const txn = txnOf(raw);
  const db: ImportDb = {
    withExclusiveTransactionAsync: async (task) => {
      raw.exec('BEGIN');
      try {
        await task(txn);
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
  const all = <T>(sql: string, ...params: unknown[]) => raw.query(sql).all(...(params as never[])) as T[];
  const one = <T>(sql: string, ...params: unknown[]) => raw.query(sql).get(...(params as never[])) as T;
  /** `SELECT COUNT(*)` of one statement. */
  const count = (sql: string, ...params: unknown[]) => Object.values(one<Record<string, number>>(sql, ...params))[0] ?? 0;
  return { raw, db, all, one, count };
}

/** A source over bytes already in memory. `chunk` caps what one `read` returns, so a test can force many steps. */
export function bytesSource(bytes: Uint8Array, chunk = Infinity): ImportSource {
  let at = 0;
  return {
    size: bytes.length,
    seek: (offset) => {
      at = offset;
    },
    read: (length) => {
      const out = bytes.subarray(at, Math.min(at + Math.min(length, chunk), bytes.length));
      at += out.length;
      return out;
    },
    close: () => undefined,
  };
}

/** A source over a file on disk, read in chunks like the phone's. */
export function pathSource(path: string): ImportSource {
  const fd = openSync(path, 'r');
  let at = 0;
  return {
    size: fstatSync(fd).size,
    seek: (offset) => {
      at = offset;
    },
    read: (length) => {
      const buffer = new Uint8Array(length);
      const n = readSync(fd, buffer, 0, length, at);
      at += n;
      return buffer.subarray(0, n);
    },
    close: () => closeSync(fd),
  };
}

/** Checks and applies the import file at `path` to `db` (see `openImportDb`); throws `ImportFileError` for a refused file. */
export function applyImportFileAtPath(db: ImportDb, path: string, options?: ImportRunOptions): Promise<HuaweiImportSummary> {
  return applyImportFile(db, () => pathSource(path), options);
}
