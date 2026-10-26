import { describe, expect, test } from 'bun:test';

import { DEFAULT_HR_ZONE_SETTINGS, hrZonesForMax, resolveHrZones, type HrZoneSettings } from '@/features/hrzones/zones';

import { heartZone } from './liveWorkout';
import { HR_HOLD_MS, HrStats, LiveExtrasSession } from './liveStats';

const T0 = 1_760_000_000_000;
const s = (seconds: number) => T0 + seconds * 1000;

describe('HrStats: average and maximum over the watch readings', () => {
  test('nothing before the clock runs', () => {
    const hr = new HrStats();
    hr.update(150, false, s(0));
    hr.update(160, false, s(5));
    expect(hr.average()).toBeNull();
    expect(hr.maximum()).toBeNull();
  });

  test('the first running reading is the average until a second payload gives it a duration', () => {
    const hr = new HrStats();
    hr.update(120, true, s(0));
    expect(hr.average()).toBe(120);
    expect(hr.maximum()).toBe(120);
  });

  test('weighted by how long each reading held, not by how many payloads repeated it', () => {
    const hr = new HrStats();
    // 120 bpm for 30 s in 1 s payloads (the phone's GPS ticking), then 150 bpm for 10 s in one.
    for (let i = 0; i < 30; i++) hr.update(120, true, s(i));
    hr.update(150, true, s(30));
    hr.update(150, true, s(40));
    expect(hr.average()).toBe(Math.round((120 * 30 + 150 * 10) / 40));
    expect(hr.maximum()).toBe(150);
  });

  test('a pause counts for neither the average nor the maximum', () => {
    const hr = new HrStats();
    hr.update(130, true, s(0));
    hr.update(130, true, s(10));
    // paused at 10 s: the 190 of the pause (talking, a stair) is not part of the run
    hr.update(190, false, s(10));
    hr.update(185, false, s(40));
    // resumed at 40 s
    hr.update(140, true, s(40));
    hr.update(140, true, s(50));
    expect(hr.average()).toBe(135);
    expect(hr.maximum()).toBe(140);
  });

  test('a gap longer than the hold (app in the background, link lost) is not filled with the last reading', () => {
    const hr = new HrStats();
    hr.update(100, true, s(0));
    hr.update(160, true, s(10));
    hr.update(160, true, s(10 + 600));
    // 100 for 10 s, 160 for at most HR_HOLD_MS
    const hold = HR_HOLD_MS / 1000;
    expect(hr.average()).toBe(Math.round((100 * 10 + 160 * hold) / (10 + hold)));
  });

  test('no reading and 0 are skipped, a payload older than the last is ignored', () => {
    const hr = new HrStats();
    hr.update(null, true, s(0));
    hr.update(0, true, s(5));
    expect(hr.average()).toBeNull();
    hr.update(140, true, s(10));
    hr.update(200, true, s(8));
    hr.update(140, true, s(20));
    expect(hr.average()).toBe(140);
    expect(hr.maximum()).toBe(140);
  });
});

describe('the zone field follows the person\'s zone settings (Settings > HR zones)', () => {
  const settings = (over: Partial<HrZoneSettings>): HrZoneSettings => ({ ...DEFAULT_HR_ZONE_SETTINGS, ...over });

  test('custom limits move the zone of the same heart rate', () => {
    const custom = resolveHrZones(settings({ maxHr: 190, limits: [95, 125, 140, 155, 171] }), 35);
    expect(heartZone(120, hrZonesForMax(190))?.zone).toBe(2);
    expect(heartZone(120, custom)?.zone).toBe(1);
    expect(heartZone(172, custom)?.zone).toBe(5);
    expect(heartZone(90, custom)).toBeNull();
  });

  test('the threshold method names the zones its own way', () => {
    const zones = resolveHrZones(settings({ method: 'lthr', lthr: 168, maxHr: 190 }), 35);
    const zone = heartZone(160, zones);
    expect(zone?.zone).toBe(4);
    expect(zone?.label).toBeTruthy();
  });
});

describe('LiveExtrasSession: the phone\'s figures of a watch-started workout', () => {
  test('steps, cadence and stride from the phone, counted only while the clock runs', () => {
    const session = new LiveExtrasSession(1);
    expect(session.figures(s(0))).toEqual({ avgHr: null, maxHr: null, steps: null, cadence: null, strideM: null });
    // The counter starts on the GO screen (preparing): its first reading is the baseline, nothing counts yet.
    session.payload(110, false, s(0), 0);
    session.stepReading(0, s(0));
    session.stepReading(12, s(3));
    expect(session.figures(s(3)).steps).toBe(0);
    // GO
    session.payload(140, true, s(3), 0);
    for (let i = 1; i <= 60; i++) {
      session.payload(140, true, s(3 + i), i * 1.2);
      session.stepReading(12 + i * 3, s(3 + i));
    }
    const running = session.figures(s(63));
    expect(running.steps).toBe(180);
    expect(running.cadence).toBe(180);
    expect(running.strideM).toBeCloseTo(72 / 180, 5);
    expect(running.avgHr).toBe(140);
    // Paused: no cadence, and the steps of the pause do not count.
    session.payload(150, false, s(64), 72);
    session.stepReading(220, s(70));
    const paused = session.figures(s(70));
    expect(paused.cadence).toBeNull();
    expect(paused.steps).toBe(180);
    expect(paused.maxHr).toBe(140);
  });

  test('a counter that starts mid-run measures the stride over its own stretch', () => {
    const session = new LiveExtrasSession(2);
    session.payload(130, true, s(0), 500);
    session.stepReading(0, s(0));
    session.payload(130, true, s(30), 560);
    session.stepReading(80, s(30));
    expect(session.figures(s(30)).strideM).toBeCloseTo(60 / 80, 5);
  });

  test('an outdoor walk with the phone in a pocket: a counter that reports every 12 s keeps the cadence, it never drops to 0', () => {
    const session = new LiveExtrasSession(3);
    session.payload(100, false, s(0), 0);
    session.stepReading(0, s(0));
    session.payload(100, true, s(1), 0);
    const shown: (number | null)[] = [];
    for (let t = 1; t <= 180; t++) {
      session.payload(110, true, s(t), t * 1.3);
      // 116 spm, handed over 12 s at a time, each batch a second after its newest step
      if (t % 12 === 1 && t > 1) session.stepReading(Math.round(((t - 2) * 116) / 60), s(t - 1), s(t));
      shown.push(session.figures(s(t)).cadence);
    }
    const fromSecondBatch = shown.slice(25);
    expect(fromSecondBatch.every((c) => c !== null && c >= 112 && c <= 120)).toBe(true);
    expect(session.figures(s(180)).steps).toBe(Math.round((167 * 116) / 60));
  });
});
