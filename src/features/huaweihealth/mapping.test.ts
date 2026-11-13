import { describe, expect, it } from 'bun:test';

import { DAILY_STEPS, INDOOR_CYCLING_RECORD, RUNNING_RECORD, RUNNING_WITH_ROUTE, STEP_DETAILS } from './fixtures';
import { dailyStepTotals, groupPoints, HEALTH_KIT_SOURCE, recordToWorkout, stepsToMinutes } from './mapping';

describe('recordToWorkout', () => {
  it('maps the documented running record: times, sport, totals, heart rate, summary', () => {
    const w = recordToWorkout(RUNNING_RECORD)!;
    expect(w.start).toBe(1592905552);
    expect(w.end).toBe(1592906207);
    expect(w.duration).toBe(655);
    expect(w.sportType).toBe(1);
    expect(w.sportName).toBe('Running');
    expect(w.distance).toBe(610);
    expect(w.calories).toBe(16);
    expect(w.steps).toBe(949);
    expect(w.avgHr).toBe(120);
    expect(w.maxHr).toBe(120);
    expect(w.points).toEqual([[1592905552, null, null, null, 120, null, null, null, null]]);
    const summary = JSON.parse(w.summaryJson) as Record<string, unknown>;
    expect(summary).toMatchObject({
      kind: 'RUNNING',
      source: HEALTH_KIT_SOURCE,
      huaweiActivityType: 56,
      healthKitId: '1592905552721',
      timeZone: '+0800',
      movingTimeSec: 655,
      gps: 'none',
      gpsPoints: 0,
      minHr: 120,
    });
    expect(summary.avgPaceSecPerKm as number).toBeCloseTo(1000 / (610 / 655), 6);
  });

  it('adds the WGS84 route, merges readings of the same second, leaves GCJ-02 fixes out and works out the climb', () => {
    const w = recordToWorkout(RUNNING_WITH_ROUTE)!;
    expect(w.points).toEqual([
      [1592905552, -7.9666, 112.6326, null, 120, null, null, null, null],
      [1592905562, -7.9667, 112.6328, 440, null, 2.5, 160, null, null],
      [1592905582, null, null, 446, null, null, null, null, null],
    ]);
    const summary = JSON.parse(w.summaryJson) as Record<string, unknown>;
    expect(summary).toMatchObject({ gps: 'ok', gpsPoints: 2, minAltitude: 440, maxAltitude: 446, elevationGain: 6, elevationLoss: 0 });
  });

  it('maps the documented indoor cycling record (97) with no calories, steps or heart rate', () => {
    const w = recordToWorkout(INDOOR_CYCLING_RECORD)!;
    expect(w.sportType).toBe(7);
    expect(w.sportName).toBe('Indoor Cycling');
    expect(w.distance).toBe(1786);
    expect(w.calories).toBe(0);
    expect(w.steps).toBe(0);
    expect(w.avgHr).toBeNull();
    expect(w.maxHr).toBeNull();
    expect(w.points).toEqual([]);
    // Speed, not pace, for a ride.
    expect(JSON.parse(w.summaryJson)).not.toHaveProperty('avgPaceSecPerKm');
  });

  it('stores an unknown or missing workout type as Exercise and keeps the Health Kit number', () => {
    const w = recordToWorkout({ ...RUNNING_RECORD, activityType: 158 })!;
    expect([w.sportType, w.sportName]).toEqual([255, 'Exercise']);
    expect(JSON.parse(w.summaryJson)).toMatchObject({ kind: 'EXERCISE', huaweiActivityType: 158 });
    expect(recordToWorkout({ ...RUNNING_RECORD, activityType: undefined })!.sportType).toBe(255);
  });

  it('takes average and maximum heart rate from the detail points when the summary has none', () => {
    const record = {
      ...RUNNING_RECORD,
      activitySummary: { dataSummary: RUNNING_RECORD.activitySummary!.dataSummary!.filter((p) => !p.dataTypeName!.includes('heart_rate')) },
      details: [
        {
          samplePoints: [100, 140, 300].map((bpm, i) => ({
            startTime: (1592905560000 + i * 1000) * 1e6,
            endTime: (1592905560000 + i * 1000) * 1e6,
            dataTypeName: 'com.huawei.instantaneous.exercise_heart_rate',
            value: [{ fieldName: 'bpm', floatValue: bpm }],
          })),
        },
      ],
    };
    const w = recordToWorkout(record)!;
    // 300 is outside Huawei's documented (0, 255) and is dropped.
    expect([w.avgHr, w.maxHr]).toEqual([120, 140]);
    expect(w.points.map((p) => p[4])).toEqual([100, 140]);
  });

  it('skips a record still in progress, a broken time span, and the one Huawei marked as the duplicate', () => {
    expect(recordToWorkout({ ...RUNNING_RECORD, endTime: undefined })).toBeNull();
    expect(recordToWorkout({ ...RUNNING_RECORD, endTime: RUNNING_RECORD.startTime })).toBeNull();
    expect(recordToWorkout({ ...RUNNING_RECORD, duplicate: 1 })).toBeNull();
    expect(recordToWorkout({ ...RUNNING_RECORD, duplicate: 0 })).not.toBeNull();
  });
});

describe('stepsToMinutes', () => {
  it('spreads each documented step record over the minutes it covers, keeping every step', () => {
    const minutes = stepsToMinutes(groupPoints(STEP_DETAILS));
    expect(minutes.reduce((sum, m) => sum + m[1], 0)).toBe(50 + 60 + 70 + 80);
    // 50 steps over 1590760340..1590760460 s: minutes starting 1590760320, 1590760380, 1590760440.
    expect(minutes.slice(0, 3)).toEqual([
      [1590760320, 17, 0, 0, null, null, null],
      [1590760380, 17, 0, 0, null, null, null],
      // The next record (60 steps over 10 minutes from 1590760460) starts in this minute too: 16 + 6.
      [1590760440, 16 + 6, 0, 0, null, null, null],
    ]);
    expect(minutes.every((m) => m[0] % 60 === 0)).toBe(true);
    expect(new Set(minutes.map((m) => m[0])).size).toBe(minutes.length);
  });

  it('puts an instant or one-minute record in its own minute and ignores empty or other points', () => {
    expect(
      stepsToMinutes([
        { startTime: 120e9, endTime: 120e9, dataTypeName: 'com.huawei.continuous.steps.delta', value: [{ fieldName: 'steps_delta', integerValue: 7 }] },
        { startTime: 180e9, endTime: 240e9, value: [{ fieldName: 'steps_delta', integerValue: 9 }] },
        { startTime: 300e9, endTime: 360e9, value: [{ fieldName: 'steps_delta', integerValue: 0 }] },
        { startTime: 300e9, endTime: 360e9, dataTypeName: 'com.huawei.continuous.distance.delta', value: [{ fieldName: 'distance_delta', floatValue: 5 }] },
      ]),
    ).toEqual([
      [120, 7, 0, 0, null, null, null],
      [180, 9, 0, 0, null, null, null],
    ]);
  });
});

describe('dailyStepTotals', () => {
  it('turns the documented daily answer into a day total for each finished day with steps', () => {
    // Both documented days are long over; the second has no steps and gives no row.
    expect(dailyStepTotals(DAILY_STEPS, 1_800_000_000)).toEqual([[1597075200, 1597161600, 1597075200 + 43200, 9000, 0, 0]]);
  });

  it('leaves out a day that has not ended before the settle time', () => {
    expect(dailyStepTotals(DAILY_STEPS, 1597161600 - 1)).toEqual([]);
    expect(dailyStepTotals(DAILY_STEPS, 1597161600)).toHaveLength(1);
  });
});
