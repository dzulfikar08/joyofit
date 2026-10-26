import { describe, expect, it } from 'bun:test';

import { openMemoryDb } from '@/cloud/syncTestKit';
import { ensureGearSchema } from '@/features/gear/store';
import { applyStravaConnection, getStravaUpload, listAutoUploadCandidates, saveStravaUpload } from '@/db/strava';

import { clearManualUploadMark, ensureStravaManualSchema, getManualUploadMark, markManualUpload } from './manualStore';

const START = 1_792_058_016;

async function open() {
  const { raw, db } = openMemoryDb();
  // Twice: the app runs it on every open.
  await ensureStravaManualSchema(db);
  await ensureStravaManualSchema(db);
  // `strava_gear_sent`, which a disconnect empties with `strava_upload`.
  await ensureGearSchema(db);
  return { raw, db };
}

describe('manual upload mark', () => {
  it('is unmarked, marked, re-marked and cleared per workout', async () => {
    const { db } = await open();
    expect(await getManualUploadMark(db, START)).toBeNull();
    expect(await markManualUpload(db, START, 100)).toBe(100);
    expect(await getManualUploadMark(db, START)).toBe(100);
    expect(await getManualUploadMark(db, START + 1)).toBeNull();
    await markManualUpload(db, START, 200);
    expect(await getManualUploadMark(db, START)).toBe(200);
    await clearManualUploadMark(db, START);
    expect(await getManualUploadMark(db, START)).toBeNull();
  });

  it('leaves the API upload state alone, and the API flow leaves the mark alone', async () => {
    const { raw, db } = await open();
    raw
      .query(
        `INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, steps, summary_json, complete)
         VALUES (1, ?, ?, 5, 'run', 600, 1000, 50, 100, '{}', 1)`,
      )
      .run(START, START + 600);
    await applyStravaConnection(db, { connected: true, athleteId: 7, connectedAt: START - 10 });
    await markManualUpload(db, START, 100);

    expect(await getStravaUpload(db, START)).toBeNull();
    // The automatic upload still sees the workout: Strava answers a duplicate with the existing activity, which then links it.
    expect((await listAutoUploadCandidates(db, START - 10)).map((w) => w.start)).toEqual([START]);

    await saveStravaUpload(db, { workoutStart: START, status: 'done', uploadId: 1, activityId: 2, error: null, attempts: 1 });
    await applyStravaConnection(db, { connected: false });
    expect(await getStravaUpload(db, START)).toBeNull();
    expect(await getManualUploadMark(db, START)).toBe(100);
  });
});
