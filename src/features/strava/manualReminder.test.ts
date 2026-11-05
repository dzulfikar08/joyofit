import { describe, expect, it } from 'bun:test';

import { openMemoryDb } from '@/cloud/syncTestKit';
import { saveStravaUpload } from '@/db/strava';

import { getManualReminder, REMIND_WINDOW_S, setManualReminder, takeNewManualWorkouts } from './manualReminder';
import { ensureStravaManualSchema, markManualUpload } from './manualStore';

const NOW = 1_792_100_000;

async function open() {
  const { raw, db } = openMemoryDb();
  await ensureStravaManualSchema(db);
  const add = (start: number, opts: { complete?: number; imported?: number; distance?: number } = {}) =>
    raw
      .query(
        `INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, steps, summary_json, complete, imported)
         VALUES (1, ?, ?, 5, 'Running', 600, ?, 50, 100, '{}', ?, ?)`,
      )
      .run(start, start + 600, opts.distance ?? 5000, opts.complete ?? 1, opts.imported ?? 0);
  return { db, add };
}

describe('manual upload reminder', () => {
  it('is off until the person has uploaded by hand, then follows their choice', async () => {
    const { db } = await open();
    expect(await getManualReminder(db)).toBe(false);
    await markManualUpload(db, 1, 1);
    expect(await getManualReminder(db)).toBe(true);
    await setManualReminder(db, false);
    expect(await getManualReminder(db)).toBe(false);
    await setManualReminder(db, true);
    expect(await getManualReminder(db)).toBe(true);
  });

  it('never announces what was on the phone before the first pass', async () => {
    const { db, add } = await open();
    add(NOW - 3600);
    expect(await takeNewManualWorkouts(db, NOW)).toEqual([]);
    expect(await takeNewManualWorkouts(db, NOW)).toEqual([]);
  });

  it('offers each new workout once, newest first', async () => {
    const { db, add } = await open();
    await takeNewManualWorkouts(db, NOW);
    add(NOW - 7200);
    add(NOW - 3600, { distance: 3000 });
    const fresh = await takeNewManualWorkouts(db, NOW);
    expect(fresh.map((w) => [w.start, w.sportName, w.distance])).toEqual([
      [NOW - 3600, 'Running', 3000],
      [NOW - 7200, 'Running', 5000],
    ]);
    expect(await takeNewManualWorkouts(db, NOW)).toEqual([]);
  });

  it('skips old history, imports, incomplete, sent and hand-marked workouts', async () => {
    const { db, add } = await open();
    await takeNewManualWorkouts(db, NOW);
    add(NOW - REMIND_WINDOW_S - 3600);
    add(NOW - 100_000, { imported: 1 });
    add(NOW - 90_000, { complete: 0 });
    add(NOW - 80_000);
    add(NOW - 70_000);
    add(NOW - 60_000);
    add(NOW - 50_000);
    await saveStravaUpload(db, { workoutStart: NOW - 80_000, status: 'done', uploadId: 1, activityId: 2, error: null, attempts: 1 });
    await saveStravaUpload(db, { workoutStart: NOW - 70_000, status: 'failed', uploadId: null, activityId: null, error: 'x', attempts: 3 });
    await markManualUpload(db, NOW - 60_000, NOW);
    expect((await takeNewManualWorkouts(db, NOW)).map((w) => w.start)).toEqual([NOW - 50_000, NOW - 70_000]);
  });
});
