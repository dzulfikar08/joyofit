import { describe, expect, it } from 'bun:test';

import { openMemoryDb } from '@/cloud/syncTestKit';

import { buildMetricDay, chooseBucketSec, hrvDaySeries, stressBandOf, stressBandSeconds, stressDaySeries, STRESS_BANDS } from './metricDay';
import { loadHrvDay, loadMetricDay } from './metricDayQuery';

const DAY = 1_760_000_000 - (1_760_000_000 % 86400);
const END = DAY + 86400;

describe('chooseBucketSec', () => {
  it('uses the narrowest width that covers the median spacing', () => {
    expect(chooseBucketSec([0, 300, 600, 900])).toBe(300);
    expect(chooseBucketSec([0, 900, 1800, 2700])).toBe(900);
    expect(chooseBucketSec([0, 1200, 2400])).toBe(1800);
    expect(chooseBucketSec([0, 7200, 14400])).toBe(3600);
  });

  it('ignores a few outliers (median) and falls back for fewer than two points', () => {
    expect(chooseBucketSec([0, 900, 1800, 2700, 3600, 20000])).toBe(900);
    expect(chooseBucketSec([])).toBe(1800);
    expect(chooseBucketSec([5])).toBe(1800);
  });
});

describe('buildMetricDay', () => {
  it('has no stats and an all-gap line for a day without points', () => {
    const day = buildMetricDay([], DAY, END);
    expect(day.stats).toBeNull();
    expect(day.avg.every((v) => v === null)).toBe(true);
    expect(day.line.every((v) => v === null)).toBe(true);
  });

  it('buckets points, puts a boundary point in the later bucket and ignores other days', () => {
    const day = buildMetricDay(
      [
        { ts: DAY - 1, value: 99 },
        { ts: DAY, value: 40 },
        { ts: DAY + 899, value: 50 },
        { ts: DAY + 900, value: 70 },
        { ts: END, value: 99 },
      ],
      DAY,
      END,
      900,
    );
    expect(day.buckets).toBe(96);
    expect(day.avg[0]).toBe(45);
    expect(day.min[0]).toBe(40);
    expect(day.max[0]).toBe(50);
    expect(day.count[0]).toBe(2);
    expect(day.avg[1]).toBe(70);
    expect(day.avg[2]).toBeNull();
  });

  it('takes stats over the raw points and the latest by time', () => {
    const day = buildMetricDay(
      [
        { ts: DAY + 3600, value: 80 },
        { ts: DAY + 100, value: 20 },
        { ts: DAY + 200, value: 40 },
      ],
      DAY,
      END,
      900,
    );
    expect(day.stats).toEqual({ min: 20, max: 80, avg: 47, latest: 80, latestTs: DAY + 3600, readings: 3 });
  });

  it('bridges one missed bucket but breaks the line at a longer gap', () => {
    const at = (b: number, value: number) => ({ ts: DAY + b * 900, value });
    const day = buildMetricDay([at(0, 10), at(2, 30), at(6, 50)], DAY, END, 900);
    expect(day.line.slice(0, 3)).toEqual([10, 20, 30]);
    expect(day.line.slice(3, 6)).toEqual([null, null, null]);
    expect(day.line[6]).toBe(50);
    expect(day.avg[1]).toBeNull();
  });

  it('follows a 23 h and a 25 h day', () => {
    expect(buildMetricDay([], DAY, DAY + 23 * 3600, 3600).buckets).toBe(23);
    expect(buildMetricDay([], DAY, DAY + 25 * 3600, 3600).buckets).toBe(25);
  });

  it('lays the line on the chart grid under the right series key', () => {
    const day = buildMetricDay([{ ts: DAY + 1800, value: 42 }], DAY, END, 1800);
    const hrv = hrvDaySeries(day);
    expect(hrv.n).toBe(48);
    expect(hrv.stepSec).toBe(1800);
    expect(hrv.hrv?.[1]).toBe(42);
    expect(hrv.hr).toBeNull();
    expect(stressDaySeries(day).stress?.[1]).toBe(42);
  });
});

describe('stress bands', () => {
  it('splits at 30, 60 and 80', () => {
    expect(STRESS_BANDS.map((b) => b.band)).toEqual(['relaxed', 'normal', 'medium', 'high']);
    expect([1, 29, 30, 59, 60, 79, 80, 100].map(stressBandOf)).toEqual(['relaxed', 'relaxed', 'normal', 'normal', 'medium', 'medium', 'high', 'high']);
  });

  it('counts each filled bucket for its width in the band of its average, and nothing for empty buckets', () => {
    const day = buildMetricDay(
      [
        { ts: DAY, value: 10 },
        { ts: DAY + 900, value: 50 },
        { ts: DAY + 1800, value: 70 },
        { ts: DAY + 2700, value: 90 },
        { ts: DAY + 3600, value: 20 },
        { ts: DAY + 3700, value: 30 }, // same bucket as above: average 25, relaxed
      ],
      DAY,
      END,
      900,
    );
    expect(stressBandSeconds(day)).toEqual([1800, 900, 900, 900]);
  });

  it('counts the last bucket only up to midnight', () => {
    const end = DAY + 3600 + 600;
    const day = buildMetricDay([{ ts: DAY + 3601, value: 90 }], DAY, end, 3600);
    expect(stressBandSeconds(day)).toEqual([0, 0, 0, 600]);
  });
});

describe('loadMetricDay / loadHrvDay', () => {
  const metric = (raw: ReturnType<typeof openMemoryDb>['raw'], type: string, ts: number, value: number | null) =>
    raw.query("INSERT INTO health_metrics (type, ts, last_ts, value, values_json) VALUES (?, ?, ?, ?, '{}')").run(type, ts, ts, value);

  it('reads one type inside the day and skips empty values', async () => {
    const { raw, db } = openMemoryDb();
    metric(raw, 'emotion', DAY - 1, 90);
    metric(raw, 'emotion', DAY + 60, 35);
    metric(raw, 'emotion', DAY + 120, null);
    metric(raw, 'emotion', DAY + 180, 0);
    metric(raw, 'hrv', DAY + 60, 55);
    metric(raw, 'emotion', END, 90);
    const day = await loadMetricDay(db, 'emotion', DAY, END);
    expect(day.stats).toMatchObject({ min: 35, max: 35, readings: 1, latest: 35 });
  });

  it('splits the hrv readings that ended in the day into night and spot', async () => {
    const { raw, db } = openMemoryDb();
    const reading = (start: number, end: number, source: string, rmssd: number) =>
      raw.query('INSERT INTO hrv_readings (start, end, source, rmssd, beats) VALUES (?, ?, ?, ?, 100)').run(start, end, source, rmssd);
    reading(DAY - 30000, DAY - 29700, 'night', 90); // last night's night: ended yesterday
    reading(DAY + 1000, DAY + 1300, 'night', 40);
    reading(DAY + 2000, DAY + 2300, 'night', 60);
    reading(DAY + 40000, DAY + 40060, 'spot', 52.4);
    const data = await loadHrvDay(db, DAY, END);
    expect(data.night.map((r) => r.rmssd)).toEqual([40, 60]);
    expect(data.nightAvg).toBe(50);
    expect(data.spot.map((r) => r.rmssd)).toEqual([52.4]);
    expect(data.day.stats).toBeNull();
  });
});
