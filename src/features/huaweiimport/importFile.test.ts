import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, strToU8 } from 'fflate';

import { applyImportFile, ImportFileError, type ImportFileErrorCode } from './importFileCore';
import { applyImportFileAtPath, bytesSource, openImportDb } from './testDb';

const HEADER = { format: 'joyofit-import', version: 1, source: 'huawei-export', createdAt: 1_792_800_000_000, exportName: 'HUAWEI_HEALTH_20261022112019.zip' };
const T0 = 1_750_000_020_000;
const START = 1_750_000_020;

type Line = Record<string, unknown>;

const minutes = (...rows: unknown[][]): Line => ({ t: 'minutes', rows });
const workout = (w: Partial<Record<string, unknown>> & { start: number }): Line => ({
  t: 'workout',
  w: { end: w.start + 600, sportType: 3, sportName: 'Biking', duration: 600, distance: 2500, calories: 285, steps: 3243, avgHr: 100, maxHr: 120, summaryJson: '{}', points: [], ...w },
});

/** An import file: header, the batches, the `end` line (unless `end: false`), gzipped. */
function build(lines: Line[], { header = HEADER, end = true, summary = {} as Line, profile = {} as Line } = {}): Uint8Array {
  const all: unknown[] = [header, ...lines];
  if (end) all.push({ t: 'end', summary, profile });
  return gzipSync(strToU8(all.map((l) => JSON.stringify(l)).join('\n') + '\n'));
}

function setup() {
  const f = openImportDb();
  const apply = (bytes: Uint8Array, options?: Parameters<typeof applyImportFile>[2]) => applyImportFile(f.db, () => bytesSource(bytes, 64 * 1024), options);
  return { ...f, apply };
}

/** The table as JS creates it (`ensureScaleSchema`): the applier's own `IF NOT EXISTS` must agree with it. */
const createScaleTableLikeJs = (raw: ReturnType<typeof openImportDb>['raw']) =>
  raw.exec(`CREATE TABLE IF NOT EXISTS scale_reading (
    id INTEGER PRIMARY KEY AUTOINCREMENT, scale_id TEXT NOT NULL, taken_at INTEGER NOT NULL, weight_kg REAL NOT NULL,
    impedance_ohm REAL, reported TEXT, estimate TEXT, rogo_state TEXT NOT NULL DEFAULT 'pending', rogo_error TEXT)`);

async function refusal(bytes: Uint8Array): Promise<ImportFileErrorCode> {
  const f = setup();
  try {
    await f.apply(bytes);
  } catch (e) {
    expect(e).toBeInstanceOf(ImportFileError);
    // Nothing is written when a file is refused.
    expect(f.count('SELECT COUNT(*) FROM step_samples')).toBe(0);
    expect(f.count('SELECT COUNT(*) FROM workouts')).toBe(0);
    return (e as ImportFileError).code;
  }
  throw new Error('the file was accepted');
}

describe('the checks before anything is written', () => {
  it('refuses another format, an unknown version and a file that is not gzip', async () => {
    expect(await refusal(build([], { header: { ...HEADER, format: 'something-else' } }))).toBe('format');
    expect(await refusal(build([], { header: { ...HEADER, version: 2 } }))).toBe('version');
    expect(await refusal(strToU8('{"format":"joyofit-import","version":1}\n'))).toBe('corrupt');
    expect(await refusal(new Uint8Array(0))).toBe('truncated');
  });

  it('refuses a file without its end line, and writes none of its batches', async () => {
    const code = await refusal(build([minutes([START, 10, 0, 0, 80, null, null])], { end: false }));
    expect(code).toBe('truncated');
  });

  it('refuses a download that was cut off, in the middle of the stream and at its trailer', async () => {
    const rows = Array.from({ length: 4000 }, (_, i) => [START + i * 60, 10, 0, 0, 70 + (i % 30), null, null]);
    const whole = build([minutes(...rows)]);
    expect(await refusal(whole.subarray(0, Math.floor(whole.length / 2)))).toBe('corrupt');
    expect(await refusal(whole.subarray(0, whole.length - 5))).toBe('corrupt');
  });

  it('refuses a line that is not a batch, and anything after the end line', async () => {
    expect(await refusal(build([{ t: 'bogus', rows: [] }]))).toBe('line');
    expect(await refusal(build([minutes([START, 1, 0, 0, null, null, null])].concat([{ t: 'end', summary: {}, profile: {} }])))).toBe('line');
    const text = `${JSON.stringify(HEADER)}\nnot json\n${JSON.stringify({ t: 'end', summary: {}, profile: {} })}\n`;
    expect(await refusal(gzipSync(strToU8(text)))).toBe('line');
  });
});

describe('applying an import file', () => {
  it('writes a handcrafted file and gives the file summary plus what writing did', async () => {
    const f = setup();
    const day = Math.floor(1_750_000_000 / 86_400) * 86_400;
    const bytes = build(
      [
        minutes([START, 10, 5000, 7, 80, 97, 55], [START + 60, 0, 0, 0, 82, null, null]),
        { t: 'sleep', rows: [[1_750_100_000, 1_750_101_000, 6, 'light']] },
        { t: 'metrics', rows: [['emotion', START, 30, '{}'], ['hrv', START, 55, '{}']] },
        { t: 'sleepScores', rows: [[1_750_000_000, 1_750_030_000, 85, 97]] },
        { t: 'queue', rows: [['meal', 'r:0', '{"kcal":1}']] },
        { t: 'weighIns', rows: [[T0, 71.5, 500, '{"bodyFatPct":21.3}']] },
        { t: 'dayTotals', rows: [[day, day + 86_400, day + 43_200, 5000, 3000, 100_000]] },
        workout({ start: START + 500_000, points: [[START + 500_000, -6.2, 106.8, null, null, null, null, null, null], [START + 500_005, null, null, null, 88, 2.5, 60, 1.1, 150]] }),
        { t: 'queue', rows: [['water', '2026-08-02', '{"date":"2026-08-02","glasses":3}']] },
      ],
      { summary: { filesRead: 4, heartRateReadings: 2, workoutsFound: 1, weighInsFound: 1, oldestSec: START, newestSec: START + 500_005, unmappedKeys: [{ key: 'x', count: 2 }] }, profile: { heightCm: 170, sex: 'male' } },
    );
    const progress: string[] = [];
    const summary = await f.apply(bytes, { onProgress: (p) => progress.push(p.phase) });
    expect(summary).toMatchObject({
      filesRead: 4,
      heartRateReadings: 2,
      workoutsFound: 1,
      oldestSec: START,
      unmappedKeys: [{ key: 'x', count: 2 }],
      profile: { heightCm: 170, sex: 'male' },
      minutesWritten: 2,
      sleepSegmentsAdded: 1,
      stressAdded: 1,
      metricsAdded: 1,
      sleepScoresAdded: 1,
      mealsQueued: 1,
      waterDaysQueued: 1,
      weighInsAdded: 1,
      dayTotalsAdded: 1,
      workoutsAdded: 1,
      workoutsUpdated: 0,
      workoutPointsAdded: 2,
      cancelled: false,
    });
    expect(progress.at(-1)).toBe('writing');
    expect(f.one<{ heart_rate: number; spo2: number; resting_heart_rate: number; calories: number; imported: number }>('SELECT * FROM step_samples WHERE timestamp = ?', START)).toMatchObject({
      heart_rate: 80,
      spo2: 97,
      resting_heart_rate: 55,
      calories: 5000,
      imported: 1,
    });
    expect(f.one<{ hr: number; speed: number; cadence: number; stride: number; power: number }>('SELECT * FROM workout_points WHERE hr = 88')).toMatchObject({ speed: 2.5, cadence: 60, stride: 1.1, power: 150 });
    expect(f.count("SELECT COUNT(*) FROM rogo_import_queue WHERE state = 'pending'")).toBe(2);
    expect(f.count("SELECT COUNT(*) FROM scale_reading WHERE scale_id = 'huawei-health-export' AND rogo_state = 'pending'")).toBe(1);
    // The same file again adds nothing.
    const again = await f.apply(bytes);
    expect(again).toMatchObject({ minutesWritten: 0, sleepSegmentsAdded: 0, stressAdded: 0, metricsAdded: 0, sleepScoresAdded: 0, mealsQueued: 0, waterDaysQueued: 0, weighInsAdded: 0, dayTotalsAdded: 0, workoutsAdded: 0, workoutsUpdated: 0 });
  });

  it('stops between batches when cancelled and keeps what was written', async () => {
    const f = setup();
    const rows = (from: number) => Array.from({ length: 3000 }, (_, i) => [from + i * 60, 5, 0, 0, null, null, null]);
    const bytes = build([minutes(...rows(START)), minutes(...rows(START + 10_000_000)), minutes(...rows(START + 20_000_000))]);
    let batches = 0;
    const summary = await applyImportFile(f.db, () => bytesSource(bytes, 1024), {
      isCancelled: () => f.count('SELECT COUNT(*) FROM step_samples') >= 3000 || batches++ > 1_000_000,
    });
    expect(summary.cancelled).toBe(true);
    expect(f.count('SELECT COUNT(*) FROM step_samples')).toBe(3000);
    expect(summary.minutesWritten).toBe(3000);
  });

  it('applies a file from a path (the way the parent runs a sample)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'joyofit-import-'));
    try {
      const path = join(dir, 'joyofit-import-20261022-1120.ndjson.gz');
      writeFileSync(path, build([minutes([START, 10, 0, 0, 80, null, null])]));
      const f = openImportDb();
      const summary = await applyImportFileAtPath(f.db, path);
      expect(summary.minutesWritten).toBe(1);
      expect(f.count('SELECT COUNT(*) FROM step_samples WHERE heart_rate = 80')).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes a few hundred thousand minutes in transactions of one batch each', async () => {
    const f = setup();
    const batch = (from: number) => minutes(...Array.from({ length: 20_000 }, (_, i) => [from + i * 60, 3, 0, 0, 60 + (i % 90), null, null]));
    const bytes = build(Array.from({ length: 10 }, (_, i) => batch(START + i * 20_000 * 60)));
    const summary = await f.apply(bytes);
    expect(summary.minutesWritten).toBe(200_000);
    expect(f.count('SELECT COUNT(*) FROM step_samples')).toBe(200_000);
  });
});

/** The cases of `HuaweiImportStoreSqlTest`, through the file. */
describe('the rules of the native store', () => {
  it('weigh-ins land in scale_reading and a second run adds nothing', async () => {
    const f = setup();
    const bytes = build([{ t: 'weighIns', rows: [[T0, 71.5, 500, '{"bodyFatPct":21.3,"bmi":22.4}'], [T0 + 86_400_000, 71.2, null, null]] }]);
    expect((await f.apply(bytes)).weighInsAdded).toBe(2);
    expect((await f.apply(bytes)).weighInsAdded).toBe(0);
    expect(f.count("SELECT COUNT(*) FROM scale_reading WHERE scale_id = 'huawei-health-export' AND rogo_state = 'pending'")).toBe(2);
    expect(f.count("SELECT COUNT(*) FROM scale_reading WHERE reported LIKE '%bodyFatPct%' AND impedance_ohm = 500")).toBe(1);
  });

  it('a weigh-in the scale already delivered is not duplicated, another weight at that moment is', async () => {
    const f = setup();
    createScaleTableLikeJs(f.raw);
    f.raw.run("INSERT INTO scale_reading (scale_id, taken_at, weight_kg, rogo_state) VALUES ('AA:BB', ?, 71.4, 'sent')", [T0 + 20_000]);
    expect((await f.apply(build([{ t: 'weighIns', rows: [[T0, 71.5, null, null]] }]))).weighInsAdded).toBe(0);
    expect((await f.apply(build([{ t: 'weighIns', rows: [[T0, 90, null, null]] }]))).weighInsAdded).toBe(1);
  });

  it('minutes are merged and a second run changes nothing', async () => {
    const f = setup();
    const bytes = build([minutes([START, 10, 0, 0, 80, null, null])]);
    expect((await f.apply(bytes)).minutesWritten).toBe(1);
    expect((await f.apply(bytes)).minutesWritten).toBe(0);
    expect(f.count('SELECT COUNT(*) FROM step_samples WHERE heart_rate = 80 AND steps = 10 AND imported = 1')).toBe(1);
  });

  it('a watch minute only gets the heart rate it lacked; an earlier import gets its calories', async () => {
    const f = setup();
    f.raw.run('INSERT INTO step_samples (timestamp, steps, calories, distance, imported) VALUES (1750000020, 10, 0, 7, 1)');
    f.raw.run('INSERT INTO step_samples (timestamp, steps, calories, distance, imported) VALUES (1750000080, 10, 0, 7, 0)');
    const bytes = build([minutes([1_750_000_020, 10, 5000, 7, null, null, null], [1_750_000_080, 99, 5000, 99, 91, null, null])]);
    expect((await f.apply(bytes)).minutesWritten).toBe(2);
    expect((await f.apply(bytes)).minutesWritten).toBe(0);
    expect(f.count('SELECT calories FROM step_samples WHERE timestamp = 1750000020')).toBe(5000);
    // The watch's minute keeps its calories, steps and distance; only its missing heart rate was filled.
    expect(f.one('SELECT calories, steps, distance, heart_rate FROM step_samples WHERE timestamp = 1750000080')).toMatchObject({ calories: 0, steps: 10, distance: 7, heart_rate: 91 });
  });

  it('metrics and sleep scores are added once and the watch rows stay', async () => {
    const f = setup();
    f.raw.run("INSERT INTO health_metrics (type, ts, last_ts, value, values_json) VALUES ('hrv', 1750000000, 1750000000, 70, '{}')");
    f.raw.run('INSERT INTO sleep_scores (start, end, score, efficiency) VALUES (1750100000, 1750130000, 60, 50)');
    const bytes = build([
      { t: 'metrics', rows: [['hrv', 1_750_000_000, 55, '{}'], ['hrv', 1_750_000_300, 56, '{}'], ['emotion', 1_750_000_300, 30, '{}']] },
      { t: 'sleepScores', rows: [[1_750_000_000, 1_750_030_000, 85, 97], [1_750_100_000, 1_750_130_000, 70, null]] },
    ]);
    const first = await f.apply(bytes);
    expect(first).toMatchObject({ metricsAdded: 1, stressAdded: 1, sleepScoresAdded: 1 });
    expect(await f.apply(bytes)).toMatchObject({ metricsAdded: 0, stressAdded: 0, sleepScoresAdded: 0 });
    expect(f.count("SELECT value FROM health_metrics WHERE type = 'hrv' AND ts = 1750000000")).toBe(70);
    expect(f.count('SELECT score FROM sleep_scores WHERE start = 1750100000')).toBe(60);
  });

  it('a day total adds only what the days rows fall short of', async () => {
    const f = setup();
    const day = Math.floor(1_750_000_000 / 86_400) * 86_400;
    const insert = (ts: number, steps: number, calories: number, distance: number, imported: number) =>
      f.raw.run('INSERT INTO step_samples (timestamp, steps, calories, distance, imported) VALUES (?, ?, ?, ?, ?)', [ts, steps, calories, distance, imported]);
    insert(day + 3_600 * 8, 5, 100, 3, 0);
    // A row sits at noon already: the shortfall goes to the next free minute.
    insert(day + 43_200, 7, 0, 4, 1);
    insert(day + 2 * 86_400 + 60, 20, 0, 0, 0);
    const partial = [day, day + 86_400, day + 43_200, 5000, 3000, 100_000];
    const empty = [day + 86_400, day + 2 * 86_400, day + 86_400 + 43_200, 6000, 4000, 200_000];
    const covered = [day + 2 * 86_400, day + 3 * 86_400, day + 2 * 86_400 + 43_200, 10, 0, 0];
    const bytes = build([{ t: 'dayTotals', rows: [partial, empty, covered] }]);
    expect((await f.apply(bytes)).dayTotalsAdded).toBe(2);
    expect((await f.apply(bytes)).dayTotalsAdded).toBe(0);
    // 5000 - (5 + 7) steps, 3000 - (3 + 4) m, 100 000 - 100 cal, at 12:01.
    expect(f.count(`SELECT COUNT(*) FROM step_samples WHERE timestamp = ${day + 43_260} AND steps = 4988 AND distance = 2993 AND calories = 99900 AND imported = 1`)).toBe(1);
    expect(f.count(`SELECT COUNT(*) FROM step_samples WHERE timestamp = ${day + 86_400 + 43_200} AND steps = 6000 AND calories = 200000 AND distance = 4000`)).toBe(1);
    expect(f.count('SELECT COUNT(*) FROM step_samples')).toBe(5);
  });

  const workoutRow = `INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, steps, summary_json, complete, imported)
    VALUES (?, ?, ?, ?, ?, 600, ?, ?, 0, '{}', 1, ?)`;
  const track = (at: number) => [[at, -6.2, 106.8, null, null, null, null, null, null], [at + 5, null, null, null, 88, null, null, null, null]];

  it('a workout imported without its track is filled in once; watch workouts are never touched', async () => {
    const f = setup();
    f.raw.run(workoutRow, [0, START, START + 600, 255, 'Workout (Huawei type 3)', 0, 0, 1]);
    f.raw.run(workoutRow, [1, START + 100_000, START + 100_600, 1, 'Running', 100, 10, 0]);
    const bytes = build([workout({ start: START + 1, points: track(START + 1) }), workout({ start: START + 100_001, points: track(START + 100_001) })]);
    const first = await f.apply(bytes);
    expect(first).toMatchObject({ workoutsAdded: 0, workoutsUpdated: 1, workoutPointsAdded: 2 });
    expect(await f.apply(bytes)).toMatchObject({ workoutsAdded: 0, workoutsUpdated: 0, workoutPointsAdded: 0 });
    expect(f.count(`SELECT COUNT(*) FROM workouts WHERE start = ${START} AND sport_type = 3 AND distance = 2500 AND calories = 285`)).toBe(1);
    expect(f.count('SELECT COUNT(*) FROM workout_points')).toBe(2);
    expect(f.count('SELECT COUNT(*) FROM workouts WHERE sport_type = 1 AND distance = 100')).toBe(1);
  });

  it('a workout imported without its sport is named once and keeps its track', async () => {
    const f = setup();
    for (const [i, name] of ['Workout (Huawei type unknown)', 'Workout (Huawei type 283)'].entries()) {
      const at = START + i * 100_000;
      f.raw.run(workoutRow, [0, at, at + 600, 255, name, 0, 0, 1]);
      f.raw.run('INSERT INTO workout_points (workout_id, ts, lat, lon) SELECT id, ?, -6.2, 106.8 FROM workouts WHERE start = ?', [at, at]);
    }
    const named = build([workout({ start: START, sportType: 1, sportName: 'Running', points: track(START) })]);
    expect(await f.apply(named)).toMatchObject({ workoutsUpdated: 1, workoutPointsAdded: 0 });
    expect(await f.apply(named)).toMatchObject({ workoutsUpdated: 0 });
    expect(f.count(`SELECT COUNT(*) FROM workouts WHERE start = ${START} AND sport_type = 1 AND sport_name = 'Running' AND distance = 2500 AND calories = 285`)).toBe(1);
    // A workout whose sport id was read but is not one JoyoFit names stays as it is.
    const other = build([workout({ start: START + 100_000, sportType: 255, sportName: 'Workout (Huawei type 283)', points: track(START + 100_000) })]);
    expect((await f.apply(other)).workoutsUpdated).toBe(0);
    expect(f.count('SELECT COUNT(*) FROM workout_points')).toBe(2);
  });

  it('a new workout is added with all its point columns', async () => {
    const f = setup();
    const pts = [[START, -6.2, 106.8, 12.5, 90, 3.1, 80, 1.05, 200]];
    expect((await f.apply(build([workout({ start: START, points: pts })])))).toMatchObject({ workoutsAdded: 1, workoutPointsAdded: 1 });
    expect(f.one('SELECT * FROM workout_points')).toMatchObject({ ts: START, lat: -6.2, lon: 106.8, alt: 12.5, hr: 90, speed: 3.1, cadence: 80, stride: 1.05, power: 200 });
    expect(f.one('SELECT * FROM workouts')).toMatchObject({ imported: 1, complete: 1, workout_number: 0, sport_name: 'Biking', avg_hr: 100, max_hr: 120, steps: 3243 });
  });

  it('sleep stages overlapping watch sleep are skipped and a second run adds nothing', async () => {
    const f = setup();
    f.raw.run("INSERT INTO sleep_segments (start, end, type, stage, imported) VALUES (1750000000, 1750003600, 7, 'deep', 0)");
    const bytes = build([
      {
        t: 'sleep',
        rows: [
          [1_750_001_000, 1_750_002_000, 6, 'light'], // inside the watch's stage
          [1_749_990_000, 1_750_000_100, 6, 'light'], // overlaps its start
          [1_750_100_000, 1_750_101_000, 6, 'light'], // a night the watch did not have
          [1_750_100_000, 1_750_102_000, 6, 'light'], // the same stage twice in the export
        ],
      },
    ]);
    expect((await f.apply(bytes)).sleepSegmentsAdded).toBe(1);
    expect((await f.apply(bytes)).sleepSegmentsAdded).toBe(0);
    expect(f.count('SELECT COUNT(*) FROM sleep_segments')).toBe(2);
  });

  it('the queue keeps what is there, and imported weigh-ins wait for JoyoRogo', async () => {
    const f = setup();
    const bytes = build([{ t: 'queue', rows: [['meal', 'r:0', '{"kcal":1}'], ['water', '2026-08-02', '{"glasses":3}']] }]);
    expect(await f.apply(bytes)).toMatchObject({ mealsQueued: 1, waterDaysQueued: 1 });
    expect(await f.apply(bytes)).toMatchObject({ mealsQueued: 0, waterDaysQueued: 0 });
    f.raw.run("UPDATE rogo_import_queue SET state = 'sent' WHERE kind = 'meal'");
    expect((await f.apply(build([{ t: 'queue', rows: [['meal', 'r:0', '{"kcal":2}']] }]))).mealsQueued).toBe(0);
    expect(f.count(`SELECT COUNT(*) FROM rogo_import_queue WHERE kind = 'meal' AND state = 'sent' AND payload = '{"kcal":1}'`)).toBe(1);
    expect(f.count("SELECT COUNT(*) FROM rogo_import_queue WHERE kind = 'water' AND state = 'pending'")).toBe(1);
    createScaleTableLikeJs(f.raw);
    await f.apply(build([{ t: 'weighIns', rows: [[T0, 80, null, null]] }]));
    expect(f.count("SELECT COUNT(*) FROM scale_reading WHERE scale_id = 'huawei-health-export' AND rogo_state = 'pending'")).toBe(1);
  });
});
