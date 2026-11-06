import { describe, expect, it } from 'bun:test';

import { HR_COVERAGE_MIN, keytelKcalPerMin, restKcalPerMin, type EnergyProfile } from '../record/energy';
import { ensureRecordingSchema } from '../record/journal';
import { openDb } from '../record/testDb';
import { bytesToHex } from '../sensors/gatt';
import { estimateKcal } from './calc';
import {
  clearHrJournal,
  coverageOf,
  HR_SAMPLE_SEC,
  HrCollector,
  hrStats,
  loadHrJournal,
  pickStrap,
  saveHrJournal,
  strapResult,
  strengthEnergy,
  type HrSample,
} from './hr';

const T0 = 1_760_000_000_000;
const profile: EnergyProfile = { weightKg: 70, age: 35, sex: 'male' };
const noSets = { exercises: [] };

/** Heart Rate Measurement, uint8 format; `contact` sets the "contact supported" flag and whether it is detected. */
const hrHex = (bpm: number, contact: 'unsupported' | 'detected' | 'lost' = 'unsupported') =>
  bytesToHex(new Uint8Array([contact === 'unsupported' ? 0x00 : contact === 'detected' ? 0x06 : 0x04, bpm]));

const samples = (n: number, hr: number, from = T0 / 1000): HrSample[] => Array.from({ length: n }, (_, i) => ({ ts: from + i * HR_SAMPLE_SEC, hr }));

describe('HrCollector sampling', () => {
  it('takes one reading every 5 seconds from a strap that notifies every second', () => {
    const c = new HrCollector();
    for (let s = 0; s <= 60; s++) {
      c.ingest('2a37', hrHex(100 + s), T0 + s * 1000);
      c.tick(T0 + s * 1000);
    }
    expect(c.samples).toHaveLength(13);
    expect(c.samples.map((p) => p.ts - T0 / 1000)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]);
    expect(c.samples[3]).toEqual({ ts: T0 / 1000 + 15, hr: 115 });
  });

  it('does not sample twice inside the interval, however often it is ticked', () => {
    const c = new HrCollector();
    c.ingest('2a37', hrHex(120), T0);
    expect(c.tick(T0)).toEqual({ ts: T0 / 1000, hr: 120 });
    expect(c.tick(T0 + 1000)).toBeNull();
    expect(c.tick(T0 + 4999)).toBeNull();
    expect(c.samples).toHaveLength(1);
  });

  it('holds a reading for 5 seconds at most, then leaves a gap instead of repeating it', () => {
    const c = new HrCollector();
    c.ingest('2a37', hrHex(130), T0);
    expect(c.tick(T0 + 5000)?.hr).toBe(130);
    // the strap went silent: 6 s after its last value there is nothing to sample
    expect(c.tick(T0 + 10_001)).toBeNull();
    expect(c.live(T0 + 10_001)).toBeNull();
    c.ingest('2a37', hrHex(128), T0 + 12_000);
    expect(c.tick(T0 + 12_000)).toEqual({ ts: T0 / 1000 + 12, hr: 128 });
  });

  it('skips readings while the strap reports no skin contact', () => {
    const c = new HrCollector();
    c.ingest('2a37', hrHex(150, 'detected'), T0);
    c.tick(T0);
    // a fresh value is not trusted either once the strap says it lost contact
    c.ingest('2a37', hrHex(190, 'lost'), T0 + 1000);
    expect(c.live(T0 + 1000)).toBeNull();
    // later: the old value is long stale and the new one is not trusted: nothing, and no live reading
    c.ingest('2a37', hrHex(190, 'lost'), T0 + 6000);
    expect(c.tick(T0 + 6000)).toBeNull();
    expect(c.live(T0 + 6000)).toBeNull();
    c.ingest('2a37', hrHex(120, 'lost'), T0 + 7000);
    expect(c.tick(T0 + 7000)).toBeNull();
    c.ingest('2a37', hrHex(121, 'detected'), T0 + 8000);
    expect(c.tick(T0 + 8000)).toEqual({ ts: T0 / 1000 + 8, hr: 121 });
  });

  it('drops a value of 0 bpm and ignores every characteristic but the heart rate measurement', () => {
    const c = new HrCollector();
    expect(c.ingest('2a37', hrHex(0), T0)).toBe(true);
    expect(c.tick(T0)).toBeNull();
    expect(c.ingest('2a63', bytesToHex(new Uint8Array([0, 0, 200, 0])), T0)).toBe(false);
    expect(c.ingest('2A37', hrHex(99), T0 + 1000)).toBe(true);
    expect(c.tick(T0 + 1000)?.hr).toBe(99);
  });

  it('hands out each sample once for the journal', () => {
    const c = new HrCollector();
    c.ingest('2a37', hrHex(100), T0);
    c.tick(T0);
    expect(c.drainNew()).toHaveLength(1);
    expect(c.drainNew()).toEqual([]);
    c.ingest('2a37', hrHex(101), T0 + 5000);
    c.tick(T0 + 5000);
    expect(c.drainNew()).toEqual([{ ts: T0 / 1000 + 5, hr: 101 }]);
  });

  it('continues after restored samples: the next one waits for the interval and restored ones are not journaled again', () => {
    const c = new HrCollector([{ ts: T0 / 1000, hr: 100 }]);
    expect(c.drainNew()).toEqual([]);
    c.ingest('2a37', hrHex(110), T0 + 2000);
    expect(c.tick(T0 + 2000)).toBeNull();
    expect(c.tick(T0 + 5000)).toEqual({ ts: T0 / 1000 + 5, hr: 110 });
    expect(c.samples).toHaveLength(2);
  });
});

describe('statistics and coverage', () => {
  it('has average, highest and lowest of the samples', () => {
    const c = new HrCollector([
      { ts: 1, hr: 100 },
      { ts: 6, hr: 140 },
      { ts: 11, hr: 121 },
    ]);
    expect([c.avg(), c.max(), c.min()]).toEqual([120, 140, 100]);
    expect(hrStats([])).toBeNull();
    expect([new HrCollector().avg(), new HrCollector().max(), new HrCollector().min()]).toEqual([null, null, null]);
  });

  it('is the share of the session the samples stand for, at most 1', () => {
    expect(coverageOf(samples(6, 100), 60)).toBe(0.5);
    expect(coverageOf(samples(12, 100), 60)).toBe(1);
    expect(coverageOf(samples(30, 100), 60)).toBe(1);
    expect(coverageOf(samples(3, 100), 0)).toBe(0);
    expect(new HrCollector(samples(6, 100)).coverage(120)).toBe(0.25);
  });
});

describe('energy', () => {
  const session = (durationSec: number) => ({ ...noSets, durationSec });

  it('is the MET estimate alone below the coverage threshold', () => {
    // 5 samples = 25 s of 600 s
    const e = strengthEnergy(samples(5, 160), session(600), profile);
    expect(e.source).toBe('estimate');
    expect(e.kcal).toBe(estimateKcal(session(600), 70));
    expect(e.coverage).toBeCloseTo(25 / 600, 6);
    expect(strengthEnergy([], session(600), profile)).toEqual({ kcal: estimateKcal(session(600), 70), source: 'estimate', coverage: 0 });
  });

  it('uses the heart rate from the threshold up (inclusive), Keytel over the covered seconds and the MET rate for the rest', () => {
    // exactly half of 600 s: 60 samples x 5 s
    const half = strengthEnergy(samples(60, 150), session(600), profile);
    expect(HR_COVERAGE_MIN).toBe(0.5);
    expect(half.source).toBe('hr');
    const met = estimateKcal(session(600), 70);
    const expectedHalf = (keytelKcalPerMin(150, profile) / 60) * 300 + (met * 300) / 600;
    expect(half.kcal).toBe(Math.round(expectedHalf));

    // just under: 59 samples
    expect(strengthEnergy(samples(59, 150), session(600), profile).source).toBe('estimate');

    // the whole session covered: no MET share at all
    const full = strengthEnergy(samples(120, 150), session(600), profile);
    expect(full).toMatchObject({ source: 'hr', coverage: 1 });
    expect(full.kcal).toBe(Math.round((keytelKcalPerMin(150, profile) / 60) * 600));
  });

  it('rises with the heart rate and never drops below the resting rate', () => {
    const easy = strengthEnergy(samples(120, 100), session(600), profile).kcal;
    const hard = strengthEnergy(samples(120, 160), session(600), profile).kcal;
    expect(hard).toBeGreaterThan(easy);
    // Keytel is negative for a very low reading: the floor is the resting rate (1.2 kcal/min)
    expect(strengthEnergy(samples(120, 20), session(600), profile).kcal).toBe(Math.round(restKcalPerMin(profile.weightKg) * 10));
  });

  it('is more than the MET estimate for a hard session and less for a very easy one', () => {
    const met = estimateKcal(session(3600), 70);
    expect(strengthEnergy(samples(720, 165), session(3600), profile).kcal).toBeGreaterThan(met);
    expect(strengthEnergy(samples(720, 70), session(3600), profile).kcal).toBeLessThan(met);
  });

  it('is available from the collector with its own samples', () => {
    const c = new HrCollector(samples(120, 150));
    expect(c.kcal(session(600), profile)).toEqual(strengthEnergy(samples(120, 150), session(600), profile));
  });
});

describe('strapResult', () => {
  const sensors = [{ id: 'AA:BB', name: 'Polar H10', kinds: ['hr' as const] }];

  it('gives the points, their statistics, the strap energy and the sensor', () => {
    const list = [...samples(60, 120), ...samples(60, 140, T0 / 1000 + 300)];
    const result = strapResult(list, { ...noSets, durationSec: 600 }, profile, sensors);
    expect(result).toMatchObject({ avgHr: 130, maxHr: 140, minHr: 120, sensors });
    expect(result?.samples).toEqual(list);
    expect(result?.kcal).toBe(strengthEnergy(list, { ...noSets, durationSec: 600 }, profile).kcal);
  });

  it('keeps the points but no energy when the strap covered too little, and is null without a heart rate', () => {
    const result = strapResult(samples(3, 150), { ...noSets, durationSec: 3600 }, profile, sensors);
    expect(result).toMatchObject({ avgHr: 150, kcal: null });
    expect(strapResult([], { ...noSets, durationSec: 3600 }, profile, sensors)).toBeNull();
  });
});

describe('pickStrap', () => {
  const sensor = (id: string, kinds: ('hr' | 'power' | 'csc' | 'rsc')[], autoConnect: boolean) => ({ id, kinds, autoConnect });

  it('is the first paired heart rate sensor that connects with workouts', () => {
    const saved = [sensor('cadence', ['csc'], true), sensor('off', ['hr'], false), sensor('h10', ['hr'], true), sensor('other', ['hr', 'power'], true)];
    expect(pickStrap(saved)?.id).toBe('h10');
  });

  it('is null without one', () => {
    expect(pickStrap([])).toBeNull();
    expect(pickStrap([sensor('power', ['power'], true), sensor('off', ['hr'], false)])).toBeNull();
  });
});

describe('journal', () => {
  it('saves samples as they come and restores them with the draft, then clears', async () => {
    const { db } = openDb();
    await ensureRecordingSchema(db as never);
    const first = samples(3, 120);
    const second = samples(2, 130, T0 / 1000 + 15);
    await saveHrJournal(db, first, { workoutId: 'wabc', sensorId: 'AA:BB' }, T0 + 15_000);
    await saveHrJournal(db, second, { workoutId: 'wabc', sensorId: 'AA:BB' }, T0 + 30_000);

    const restored = await loadHrJournal(db, 'wabc');
    expect(restored).toEqual([...first, ...second]);
    const c = new HrCollector(restored ?? []);
    expect(c.samples).toHaveLength(5);
    expect(c.drainNew()).toEqual([]);

    await clearHrJournal(db);
    expect(await loadHrJournal(db, 'wabc')).toBeNull();
  });

  it('drops the journal of another workout instead of mixing it in', async () => {
    const { db, all } = openDb();
    await ensureRecordingSchema(db as never);
    await saveHrJournal(db, samples(2, 120), { workoutId: 'wold', sensorId: 'AA:BB' }, T0);
    expect(await loadHrJournal(db, 'wnew')).toBeNull();
    expect(all('SELECT * FROM recording_journal')).toEqual([]);
    expect(all('SELECT * FROM recording_state')).toEqual([]);
  });

  it('is not touched by a phone recording journal', async () => {
    const { db, all } = openDb();
    await ensureRecordingSchema(db as never);
    await saveHrJournal(db, samples(1, 120), { workoutId: 'wabc', sensorId: 'AA:BB' }, T0);
    await db.runAsync(`INSERT INTO recording_state (session, meta, updated_at) VALUES ('phone', '{}', 1)`);
    await clearHrJournal(db);
    expect(all<{ session: string }>('SELECT session FROM recording_state')).toEqual([{ session: 'phone' }]);
  });
});
