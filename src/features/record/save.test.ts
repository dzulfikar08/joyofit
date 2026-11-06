import { describe, expect, it } from 'bun:test';

import { ensureSensorSchema, listWorkoutRri, listWorkoutSensors, renameSensor, saveSensor, listSensors, updateSensorInfo, removeSensor, sensorLabel } from '../sensors/store';
import { bytesToHex } from '../sensors/gatt';
import { appendJournal, clearJournal, ensureRecordingSchema, loadJournal, saveJournalState } from './journal';
import { Recorder, type RecorderMeta } from './recorder';
import { saveRecordedWorkout } from './save';
import { openDb } from './testDb';

const T0 = 1_700_000_000_000;
const hr = (bpm: number) => bytesToHex(new Uint8Array([0x00, bpm]));
const profile = { weightKg: 70, age: 35, sex: 'unknown' as const };

function recordTreadmill(seconds: number) {
  const r = new Recorder({ sport: 'treadmill', gps: false, wheelCircumferenceM: 2.105, profile });
  r.start(T0);
  for (let s = 0; s <= seconds; s++) {
    r.sensor('2a37', hr(130 + (s % 10)), T0 + s * 1000);
    r.tick(T0 + s * 1000);
  }
  return r.finish(T0 + seconds * 1000)!;
}

describe('saveRecordedWorkout', () => {
  it('stores the workout like an imported one, with points, minute heart rates and the sensors', async () => {
    const { db, all } = openDb();
    await ensureSensorSchema(db);
    const w = recordTreadmill(150);
    const id = await saveRecordedWorkout(db, w, [{ id: 'AA:BB', name: 'Polar H10', kinds: ['hr'] }]);

    const [row] = all<Record<string, unknown>>('SELECT * FROM workouts WHERE id = ?', id);
    expect(row).toMatchObject({
      workout_number: 0,
      start: T0 / 1000,
      end: T0 / 1000 + 150,
      sport_type: 5,
      sport_name: 'Treadmill run',
      duration: 150,
      complete: 1,
      imported: 1,
      device: null,
    });
    expect(row!.avg_hr).toBeGreaterThan(125);
    expect(row!.calories).toBeGreaterThan(0);
    const summary = JSON.parse(row!.summary_json as string);
    expect(summary).toMatchObject({ source: 'phone', kind: 'INDOOR_RUNNING', gps: 'none', kcalSource: 'hr' });
    expect(summary.sensors).toEqual([{ id: 'AA:BB', name: 'Polar H10', kinds: ['hr'] }]);
    expect(all('SELECT * FROM workout_points WHERE workout_id = ?', id)).toHaveLength(151);
    // the minutes 0, 1, 2 of the session (the start is not minute aligned: up to 4 buckets)
    expect(all('SELECT * FROM step_samples WHERE imported = 1').length).toBeGreaterThanOrEqual(3);
    expect(await listWorkoutSensors(db, id)).toEqual([{ id: 'AA:BB', name: 'Polar H10', kinds: ['hr'] }]);
  });

  it('keeps a chest strap\'s raw R-R intervals for the export and summarises HRV from a filtered copy', async () => {
    const { db, all } = openDb();
    await ensureSensorSchema(db);
    const r = new Recorder({ sport: 'treadmill', gps: false, wheelCircumferenceM: 2.105, profile });
    r.start(T0);
    // One beat per frame, 1/1024 s units: 820 is 800.8 ms; beat 20 is an ectopic 1200 (a 1229-unit interval).
    const units = (s: number) => (s === 20 ? 1229 : 820 + (s % 2) * 10);
    for (let s = 0; s <= 40; s++) {
      const u = units(s);
      r.sensor('2a37', bytesToHex(new Uint8Array([0x10, 75, u & 0xff, u >> 8])), T0 + s * 1000);
      r.tick(T0 + s * 1000);
    }
    const w = r.finish(T0 + 40 * 1000)!;
    const id = await saveRecordedWorkout(db, w, [{ id: 'AA:BB', name: 'Polar H10', kinds: ['hr'] }]);

    const stored = await listWorkoutRri(db, id);
    expect(stored.length).toBeGreaterThanOrEqual(30);
    // Raw: the ectopic beat is still there, in whole milliseconds.
    expect(stored).toContain(1200);
    expect(stored.every((v) => Number.isInteger(v))).toBe(true);
    const [row] = all<{ summary_json: string }>('SELECT summary_json FROM workouts WHERE id = ?', id);
    const { hrv } = JSON.parse(row!.summary_json);
    expect(hrv.beats).toBe(stored.length);
    // Filtered: without the 1200 ms beat successive differences are about 10 ms, so RMSSD stays far below its ~400 ms jump.
    expect(hrv.rmssd).toBeLessThan(30);
  });

  it('a web game ride keeps the game distance, climb, route and laps', async () => {
    const { db, all } = openDb();
    await ensureSensorSchema(db);
    const r = new Recorder({ sport: 'indoorRide', gps: false, wheelCircumferenceM: 2.105, profile });
    r.start(T0);
    for (let s = 1; s <= 60; s++) {
      r.virtualSpeed(7, T0 + s * 1000);
      r.tick(T0 + s * 1000);
    }
    const w = r.finish(T0 + 60_000)!;
    const virtual = { distM: 12345.6, elevM: 210, route: 'Bukit Jam', laps: [{ sec: 30, distM: 6000 }] };
    const id = await saveRecordedWorkout(db, w, [], virtual);
    const [row] = all<Record<string, unknown>>('SELECT * FROM workouts WHERE id = ?', id);
    expect(row).toMatchObject({ sport_name: 'Indoor ride', distance: 12346 });
    const summary = JSON.parse(row!.summary_json as string);
    expect(summary.virtualRide).toEqual(virtual);
    expect(summary).toMatchObject({ elevationGain: 210, ascentSource: 'virtual' });
    expect(summary.avgSpeed).toBeCloseTo(12345.6 / w.movingSec, 3);
  });

  it('moves a workout whose start second is taken later, points included', async () => {
    const { db, all } = openDb();
    await ensureSensorSchema(db);
    const first = await saveRecordedWorkout(db, recordTreadmill(30), []);
    const second = await saveRecordedWorkout(db, recordTreadmill(30), []);
    expect(second).not.toBe(first);
    const [a, b] = all<{ start: number }>('SELECT start FROM workouts ORDER BY id');
    expect(b!.start).toBe(a!.start + 1);
    const [firstPoint] = all<{ ts: number }>('SELECT MIN(ts) AS ts FROM workout_points WHERE workout_id = ?', second);
    expect(firstPoint!.ts).toBe(b!.start);
  });

  it('a GPS run gets its route flags, laps and elevation', async () => {
    const { db, all } = openDb();
    await ensureSensorSchema(db);
    const r = new Recorder({ sport: 'run', gps: true, wheelCircumferenceM: 2.105, profile });
    r.start(T0);
    for (let s = 0; s <= 120; s++) {
      r.fix({ ts: T0 + s * 1000, lat: 10 + (s * 3) / 111_194.93, lon: 20, alt: 100 + (s > 60 ? 8 : 0), accuracy: 5, speed: 3 });
      r.tick(T0 + s * 1000);
      if (s === 60) r.lap(T0 + s * 1000);
    }
    const w = r.finish(T0 + 120_000)!;
    const id = await saveRecordedWorkout(db, w, []);
    const [row] = all<Record<string, unknown>>('SELECT * FROM workouts WHERE id = ?', id);
    const summary = JSON.parse(row!.summary_json as string);
    expect(summary.gps).toBe('ok');
    expect(summary.gpsPoints).toBeGreaterThan(100);
    expect(summary.laps).toHaveLength(2);
    expect(summary.avgPaceSecPerKm).toBeGreaterThan(300);
    expect(summary.avgPaceSecPerKm).toBeLessThan(360);
    expect(row!.distance).toBeGreaterThan(340);
  });
});

describe('sensor store', () => {
  it('pairs, renames, updates and removes; pairing again keeps the alias', async () => {
    const { db } = openDb();
    await ensureSensorSchema(db);
    await saveSensor(db, { id: 'X', name: 'TICKR 1234', kinds: ['hr'] }, 1000);
    await renameSensor(db, 'X', '  My strap ');
    await updateSensorInfo(db, 'X', { battery: 87, manufacturer: 'Wahoo', seenAt: 2000 });
    let [s] = await listSensors(db);
    expect(s).toMatchObject({ id: 'X', alias: 'My strap', battery: 87, batteryAt: 2000, manufacturer: 'Wahoo', autoConnect: true, kinds: ['hr'] });
    expect(sensorLabel(s!)).toBe('My strap');

    await saveSensor(db, { id: 'X', name: 'TICKR 1234', kinds: ['hr', 'csc'] }, 3000);
    [s] = await listSensors(db);
    expect(s!.alias).toBe('My strap');
    expect(s!.kinds).toEqual(['hr', 'csc']);
    expect(s!.addedAt).toBe(1000);

    await renameSensor(db, 'X', '  ');
    [s] = await listSensors(db);
    expect(sensorLabel(s!)).toBe('TICKR 1234');
    await removeSensor(db, 'X');
    expect(await listSensors(db)).toEqual([]);
  });
});

describe('journal', () => {
  it('round-trips samples and state and clears them', async () => {
    const { db } = openDb();
    await ensureRecordingSchema(db);
    const r = new Recorder({ sport: 'other', gps: false, wheelCircumferenceM: 2.105, profile });
    r.start(T0);
    r.sensor('2a37', hr(120), T0);
    for (let s = 0; s <= 5; s++) r.tick(T0 + s * 1000);
    await appendJournal(db, 'phone', r.drainNew());
    await saveJournalState(db, 'phone', r.meta(), T0);
    const loaded = (await loadJournal<RecorderMeta>(db, 'phone'))!;
    expect(loaded.samples).toHaveLength(6);
    const back = Recorder.restore(loaded.meta, loaded.samples);
    expect(back.status).toBe('paused');
    expect(back.sampleCount).toBe(6);
    await clearJournal(db, 'phone');
    expect(await loadJournal(db, 'phone')).toBeNull();
  });
});
