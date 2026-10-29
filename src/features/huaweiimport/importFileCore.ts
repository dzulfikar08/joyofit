/**
 * Reads a JoyoFit import file (`docs/huawei-web-import.md`: gzip of NDJSON, built in the browser from a Huawei Health export) as a
 * stream and applies it to `joyofit.db` with the SQL of the native importer (`importStoreSql.ts`).
 *
 * Two passes over the compressed bytes, never the whole decompressed text in memory:
 *
 * 1. `checkImportFile`: header format and version, the gzip stream (inflate errors, the size the trailer promises), every line parses,
 *    the last line is `end`. Writes nothing; any failure is an `ImportFileError` with a `code` the screen words.
 * 2. `applyImportSource`: the batches in file order, one transaction per batch (consecutive workouts share one), cancellable between them.
 *
 * No Expo imports here, so the whole thing runs under `bun test`; `importFile.ts` opens the real file and database.
 */
import { DecodeUTF8, Gunzip } from 'fflate';

import type { HuaweiImportSummary } from '@/wear';

import {
  queueForRogo,
  STRESS_METRIC,
  writeDayTotals,
  writeMetrics,
  writeMinutes,
  writeSleep,
  writeSleepScores,
  writeWeighIns,
  writeWorkout,
  type DayTotalRow,
  type ImportTxn,
  type MetricRow,
  type MinuteRow,
  type QueueRow,
  type SleepRow,
  type SleepScoreRow,
  type WeighInRow,
  type WorkoutLine,
} from './importStoreSql';

export const IMPORT_FORMAT = 'joyofit-import';
export const IMPORT_VERSION = 1;

/** Upload `Content-Type` of an import file; the phone recognises its uploads by it. */
export const IMPORT_CONTENT_TYPE = 'application/x-joyofit-import+gzip';

/** Compressed bytes read per step. */
const CHUNK_BYTES = 256 * 1024;
/** Most workouts, and most points, written in one transaction. */
const WORKOUTS_PER_TRANSACTION = 50;
const POINTS_PER_TRANSACTION = 20_000;
/** The event loop gets a turn at least this often, so the progress bar paints and Cancel is heard. */
const YIELD_MS = 50;
const PROGRESS_MS = 250;

export type ImportFileErrorCode =
  /** Not a gzip file, an inflate error, or the size in the gzip trailer does not match. */
  | 'corrupt'
  /** The header is not an import file's. */
  | 'format'
  /** An import file of a version this app does not know. */
  | 'version'
  /** The gzip is complete but the last line is not `end` (a cut-off download), or the file is empty. */
  | 'truncated'
  /** A line that is not valid JSON or not a known batch. */
  | 'line';

export class ImportFileError extends Error {
  constructor(
    readonly code: ImportFileErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ImportFileError';
  }
}

/** A file read from the start: `read` returns up to `length` bytes (none at the end), `close` is called once. */
export interface ImportSource {
  readonly size: number;
  seek(offset: number): void;
  read(length: number): Uint8Array;
  close(): void;
}

export interface ImportHeader {
  format: string;
  version: number;
  source?: string;
  createdAt?: number;
  exportName?: string;
}

export type ImportProfile = NonNullable<HuaweiImportSummary['profile']>;

/** What pass 1 found: the header, the reading's summary and profile from the `end` line, and the size of the text. */
export interface ImportFileInfo {
  header: ImportHeader;
  summary: Record<string, unknown>;
  profile: ImportProfile;
  lines: number;
}

export interface ImportFileProgress {
  phase: 'checking' | 'writing';
  /** 0 to 1 over the compressed bytes read in this phase. */
  fraction: number;
  /** The file's summary with what writing has done so far (the counts of the final result). */
  summary: HuaweiImportSummary;
}

/** The slice of expo-sqlite the applier needs: one exclusive transaction on a connection of its own per call. */
export interface ImportDb {
  withExclusiveTransactionAsync(task: (txn: ImportTxn) => Promise<void>): Promise<void>;
}

export interface ImportRunOptions {
  onProgress?: (progress: ImportFileProgress) => void;
  /** Polled between batches; true stops the run, keeping what was written. */
  isCancelled?: () => boolean;
}

type BatchKind = 'minutes' | 'sleep' | 'metrics' | 'sleepScores' | 'queue' | 'weighIns' | 'dayTotals';
const BATCH_KINDS: readonly string[] = ['minutes', 'sleep', 'metrics', 'sleepScores', 'queue', 'weighIns', 'dayTotals'] satisfies BatchKind[];

type FileLine =
  | { t: BatchKind; rows: unknown[] }
  | { t: 'workout'; w: WorkoutLine }
  | { t: 'end'; summary: Record<string, unknown>; profile: ImportProfile };

const nextTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function parseLine(text: string, n: number): FileLine {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ImportFileError('line', `line ${n} is not JSON`);
  }
  if (typeof value !== 'object' || value === null) throw new ImportFileError('line', `line ${n} is not an object`);
  const line = value as Record<string, unknown>;
  const t = line.t;
  if (typeof t === 'string' && BATCH_KINDS.includes(t) && Array.isArray(line.rows)) return line as unknown as FileLine;
  if (t === 'workout' && typeof line.w === 'object' && line.w !== null && 'points' in line.w && Array.isArray(line.w.points)) return line as unknown as FileLine;
  if (t === 'end' && typeof line.summary === 'object' && line.summary !== null) {
    return { t, summary: line.summary as Record<string, unknown>, profile: (line.profile ?? {}) as ImportProfile };
  }
  throw new ImportFileError('line', `line ${n} is not a known batch`);
}

function parseHeader(text: string): ImportHeader {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ImportFileError('format', 'the first line is not an import file header');
  }
  const header = value as Partial<ImportHeader> | null;
  if (typeof header !== 'object' || header === null || header.format !== IMPORT_FORMAT) {
    throw new ImportFileError('format', 'not a JoyoFit import file');
  }
  if (header.version !== IMPORT_VERSION) throw new ImportFileError('version', `import file version ${String(header.version)} is not supported`);
  return header as ImportHeader;
}

/** The size the gzip trailer promises (ISIZE, the last four bytes, little endian), or null when the file is shorter than a gzip file can be. */
function trailerSize(source: ImportSource): number | null {
  if (source.size < 18) return null;
  source.seek(source.size - 4);
  const b = source.read(4);
  if (b.length < 4) return null;
  return (b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24)) >>> 0;
}

interface ScanControl {
  /** Called after each chunk with the compressed bytes read so far. */
  onBytes(done: number): void;
  isCancelled(): boolean;
}

/**
 * Inflates the source chunk by chunk and hands every line to `onLine` in order. Returns false when cancelled. The memory held is one
 * chunk's output; a gzip stream that ends early, or whose size differs from the trailer's, is `corrupt`.
 */
async function scanLines(source: ImportSource, onLine: (text: string, n: number) => Promise<void> | void, ctl: ScanControl): Promise<boolean> {
  if (source.size === 0) throw new ImportFileError('truncated', 'the file is empty');
  const expected = trailerSize(source);
  source.seek(0);
  let inflated = 0;
  let tail = '';
  let pending: string[] = [];
  let lineNo = 0;
  const utf8 = new DecodeUTF8((text, final) => {
    const joined = tail + text;
    const parts = joined.split('\n');
    tail = parts.pop() ?? '';
    for (const p of parts) pending.push(p);
    if (final && tail !== '') {
      pending.push(tail);
      tail = '';
    }
  });
  const gunzip = new Gunzip((data, final) => {
    inflated += data.length;
    utf8.push(data, final);
  });
  let done = 0;
  let lastYield = Date.now();
  try {
    while (done < source.size) {
      if (ctl.isCancelled()) return false;
      const chunk = source.read(Math.min(CHUNK_BYTES, source.size - done));
      if (chunk.length === 0) throw new ImportFileError('corrupt', 'the file ended early');
      done += chunk.length;
      try {
        gunzip.push(chunk, done >= source.size);
      } catch (e) {
        throw new ImportFileError('corrupt', `not a valid gzip file (${e instanceof Error ? e.message : String(e)})`);
      }
      const lines = pending;
      pending = [];
      for (const text of lines) {
        lineNo++;
        await onLine(text, lineNo);
      }
      ctl.onBytes(done);
      if (Date.now() - lastYield >= YIELD_MS) {
        await nextTurn();
        lastYield = Date.now();
      }
    }
  } finally {
    source.close();
  }
  if (expected === null || (inflated >>> 0) !== expected) throw new ImportFileError('corrupt', 'the file is damaged or cut off (size mismatch)');
  return true;
}

/** Pass 1. Throws `ImportFileError`; returns null when cancelled. Reads the source from its start and closes it. */
export async function checkImportFile(
  source: ImportSource,
  { onProgress, isCancelled = () => false }: ImportRunOptions = {},
): Promise<ImportFileInfo | null> {
  const seen: { header?: ImportHeader; end?: Extract<FileLine, { t: 'end' }> } = {};
  let lines = 0;
  let lastReport = 0;
  const finished = await scanLines(
    source,
    (text, n) => {
      lines = n;
      if (n === 1) {
        seen.header = parseHeader(text);
        return;
      }
      if (seen.end) throw new ImportFileError('line', `line ${n} follows the end line`);
      const line = parseLine(text, n);
      if (line.t === 'end') seen.end = line;
    },
    {
      isCancelled,
      onBytes: (done) => {
        const now = Date.now();
        if (!onProgress || now - lastReport < PROGRESS_MS) return;
        lastReport = now;
        onProgress({ phase: 'checking', fraction: done / source.size, summary: buildSummary({}) });
      },
    },
  );
  if (!finished) return null;
  if (!seen.header || !seen.end) throw new ImportFileError('truncated', 'the file has no end line: the download was cut off');
  return { header: seen.header, summary: seen.end.summary, profile: seen.end.profile, lines };
}

const NUMBER_KEYS = [
  'filesRead',
  'filesFailed',
  'filesIgnored',
  'badRecords',
  'rejectedSamples',
  'unmappedSamples',
  'heartRateReadings',
  'restingHeartRateReadings',
  'spo2Readings',
  'stressReadings',
  'sleepSegmentsFound',
  'metricsFound',
  'sleepScoresFound',
  'dayTotalsFound',
  'mealsFound',
  'waterDaysFound',
  'weighInsFound',
  'workoutsFound',
] as const;

/** The file's `end.summary` as a `HuaweiImportSummary`, with the counts of writing at zero. */
export function buildSummary(found: Record<string, unknown>, profile: ImportProfile = {}): HuaweiImportSummary {
  const num = (key: string) => (typeof found[key] === 'number' ? (found[key] as number) : 0);
  const orNull = (key: string) => (typeof found[key] === 'number' ? (found[key] as number) : null);
  const list = <T>(key: string): T[] => (Array.isArray(found[key]) ? (found[key] as T[]) : []);
  const counts = Object.fromEntries(NUMBER_KEYS.map((k) => [k, num(k)])) as Record<(typeof NUMBER_KEYS)[number], number>;
  return {
    ...counts,
    minutesWritten: 0,
    sleepSegmentsAdded: 0,
    stressAdded: 0,
    metricsAdded: 0,
    sleepScoresAdded: 0,
    dayTotalsAdded: 0,
    mealsQueued: 0,
    waterDaysQueued: 0,
    weighInsAdded: 0,
    workoutsAdded: 0,
    workoutsUpdated: 0,
    workoutPointsAdded: 0,
    profile,
    rejectedReasons: list('rejectedReasons'),
    badRecordReasons: list('badRecordReasons'),
    unmappedKeys: list('unmappedKeys'),
    oldestSec: orNull('oldestSec'),
    newestSec: orNull('newestSec'),
    cancelled: false,
  };
}

/** What one transaction does with its lines, then adds to the summary once it has committed. */
type Unit = { kind: BatchKind; rows: unknown[] } | { kind: 'workouts'; workouts: WorkoutLine[] };

async function applyUnit(db: ImportDb, unit: Unit, summary: HuaweiImportSummary): Promise<void> {
  // Counted only when the transaction commits: a failed batch is rolled back and counts nothing.
  const done: (() => void)[] = [];
  await db.withExclusiveTransactionAsync(async (txn) => {
    // The same counting as the native `flush()` / `writeWorkout` / `queueWater` of `HuaweiExportImporter`.
    done.length = 0;
    switch (unit.kind) {
      case 'minutes': {
        const n = writeMinutes(txn, unit.rows as MinuteRow[]);
        done.push(() => (summary.minutesWritten += n));
        break;
      }
      case 'sleep': {
        const n = writeSleep(txn, unit.rows as SleepRow[]);
        done.push(() => (summary.sleepSegmentsAdded += n));
        break;
      }
      case 'metrics': {
        for (const [type, n] of writeMetrics(txn, unit.rows as MetricRow[])) {
          done.push(() => {
            if (type === STRESS_METRIC) summary.stressAdded += n;
            else summary.metricsAdded = (summary.metricsAdded ?? 0) + n;
          });
        }
        break;
      }
      case 'sleepScores': {
        const n = writeSleepScores(txn, unit.rows as SleepScoreRow[]);
        done.push(() => (summary.sleepScoresAdded = (summary.sleepScoresAdded ?? 0) + n));
        break;
      }
      case 'queue': {
        const n = queueForRogo(txn, unit.rows as QueueRow[]);
        done.push(() => {
          summary.mealsQueued = (summary.mealsQueued ?? 0) + n.meals;
          summary.waterDaysQueued = (summary.waterDaysQueued ?? 0) + n.water;
        });
        break;
      }
      case 'weighIns': {
        const n = writeWeighIns(txn, unit.rows as WeighInRow[]);
        done.push(() => (summary.weighInsAdded = (summary.weighInsAdded ?? 0) + n));
        break;
      }
      case 'dayTotals': {
        const n = writeDayTotals(txn, unit.rows as DayTotalRow[]);
        done.push(() => (summary.dayTotalsAdded = (summary.dayTotalsAdded ?? 0) + n));
        break;
      }
      case 'workouts': {
        for (const workout of unit.workouts) {
          const r = writeWorkout(txn, workout);
          done.push(() => {
            if (r.added) summary.workoutsAdded++;
            if (r.updated) summary.workoutsUpdated = (summary.workoutsUpdated ?? 0) + 1;
            if (r.added || r.updated) summary.workoutPointsAdded += r.points;
          });
        }
        break;
      }
    }
  });
  for (const apply of done) apply();
}

/**
 * Pass 2: applies the batches of a file that passed `checkImportFile` (`info`). The source is read again from the start and closed.
 * Returns the file's summary plus what writing did; a cancel keeps what was written and says so (`cancelled`).
 */
export async function applyImportSource(
  db: ImportDb,
  source: ImportSource,
  info: ImportFileInfo,
  { onProgress, isCancelled = () => false }: ImportRunOptions = {},
): Promise<HuaweiImportSummary> {
  const summary = buildSummary(info.summary, info.profile);
  let workouts: WorkoutLine[] = [];
  let workoutPoints = 0;
  let lastReport = 0;
  let bytes = 0;
  const report = (force: boolean) => {
    const now = Date.now();
    if (!onProgress || (!force && now - lastReport < PROGRESS_MS)) return;
    lastReport = now;
    onProgress({ phase: 'writing', fraction: bytes / source.size, summary });
  };
  const flushWorkouts = async () => {
    if (workouts.length === 0) return;
    const unit: Unit = { kind: 'workouts', workouts };
    workouts = [];
    workoutPoints = 0;
    await applyUnit(db, unit, summary);
  };
  const finished = await scanLines(
    source,
    async (text, n) => {
      if (n === 1) return;
      const line = parseLine(text, n);
      if (line.t === 'end') return;
      if (line.t === 'workout') {
        workouts.push(line.w);
        workoutPoints += line.w.points.length;
        if (workouts.length >= WORKOUTS_PER_TRANSACTION || workoutPoints >= POINTS_PER_TRANSACTION) await flushWorkouts();
        return;
      }
      await flushWorkouts();
      await applyUnit(db, { kind: line.t, rows: line.rows }, summary);
    },
    {
      isCancelled,
      onBytes: (done) => {
        bytes = done;
        report(false);
      },
    },
  );
  if (finished) await flushWorkouts();
  else summary.cancelled = true;
  bytes = source.size;
  report(true);
  return summary;
}

/**
 * Both passes: `open` is called once per pass (each closes its source). A file that fails the check writes nothing and throws
 * `ImportFileError`. This is what the screen runs and what a test calls with a source of its own.
 */
export async function applyImportFile(db: ImportDb, open: () => ImportSource, options: ImportRunOptions = {}): Promise<HuaweiImportSummary> {
  const info = await checkImportFile(open(), options);
  if (!info) return { ...buildSummary({}), cancelled: true };
  return applyImportSource(db, open(), info, options);
}
