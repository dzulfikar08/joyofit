import { describe, expect, it } from 'bun:test';

import { openMemoryDb } from '@/cloud/syncTestKit';

import { bridgeShortGaps, bucketCount, bucketOf, buildHeartDay, heartDaySeries, HEART_BUCKET_SEC, restingNotShared } from './heartDay';
import { listHeartBuckets, loadHeartDay } from './heartDayQuery';
import { hrZonesForMax } from '@/features/hrzones/zones';

const DAY = 1_760_000_000 - (1_760_000_000 % 86400); // any midnight-like anchor: only differences matter
const END = DAY + 86400;

describe('bucket boundaries', () => {
  it('counts 288 five-minute buckets in a 24 h day and follows 23 h and 25 h days', () => {
    expect(bucketCount(DAY, END)).toBe(288);
    expect(bucketCount(DAY, DAY + 23 * 3600)).toBe(276);
    expect(bucketCount(DAY, DAY + 25 * 3600)).toBe(300);
  });

  it('puts the first second in bucket 0, the second before a boundary in the same bucket, the boundary in the next', () => {
    expect(bucketOf(DAY, DAY)).toBe(0);
    expect(bucketOf(DAY + HEART_BUCKET_SEC - 1, DAY)).toBe(0);
    expect(bucketOf(DAY + HEART_BUCKET_SEC, DAY)).toBe(1);
    expect(bucketOf(END - 1, DAY)).toBe(287);
  });
});

describe('buildHeartDay', () => {
  it('has no stats and an all-gap line for a day without readings', () => {
    const day = buildHeartDay([], DAY, END);
    expect(day.stats).toBeNull();
    expect(day.peak).toBeNull();
    expect(day.avg.every((v) => v === null)).toBe(true);
    expect(day.line.every((v) => v === null)).toBe(true);
  });

  it('takes min and max over the readings and the average weighted by reading count', () => {
    const day = buildHeartDay(
      [
        { bucket: 0, avg: 60, min: 58, max: 62, count: 1 },
        { bucket: 1, avg: 100, min: 80, max: 150, count: 3 },
      ],
      DAY,
      END,
    );
    expect(day.stats).toEqual({ min: 58, max: 150, avg: 90, readings: 4 });
    expect(day.peak).toEqual({ bpm: 150, bucket: 1 });
  });

  it('ignores rows outside the day', () => {
    const day = buildHeartDay(
      [
        { bucket: -1, avg: 200, min: 200, max: 200, count: 1 },
        { bucket: 288, avg: 200, min: 200, max: 200, count: 1 },
        { bucket: 287, avg: 70, min: 70, max: 70, count: 1 },
      ],
      DAY,
      END,
    );
    expect(day.stats?.max).toBe(70);
    expect(day.avg[287]).toBe(70);
  });

  it('feeds the shared chart a series on the bucket grid', () => {
    const day = buildHeartDay([{ bucket: 2, avg: 71.4, min: 70, max: 73, count: 2 }], DAY, END);
    const series = heartDaySeries(day);
    expect(series.n).toBe(288);
    expect(series.stepSec).toBe(300);
    expect(series.hr?.[2]).toBe(71);
    expect(series.hr?.[1]).toBeNull();
  });
});

describe('gaps', () => {
  it('bridges up to two empty buckets between readings and no more', () => {
    expect(bridgeShortGaps([60, null, 70], 2)).toEqual([60, 65, 70]);
    expect(bridgeShortGaps([60, null, null, 90], 2)).toEqual([60, 70, 80, 90]);
    expect(bridgeShortGaps([60, null, null, null, 90], 2)).toEqual([60, null, null, null, 90]);
  });

  it('never fills before the first or after the last reading', () => {
    expect(bridgeShortGaps([null, null, 60, null], 2)).toEqual([null, null, 60, null]);
  });

  it('keeps the readout values untouched where the line bridges', () => {
    const day = buildHeartDay(
      [
        { bucket: 0, avg: 60, min: 60, max: 60, count: 1 },
        { bucket: 2, avg: 70, min: 70, max: 70, count: 1 },
      ],
      DAY,
      END,
    );
    expect(day.line[1]).toBe(65);
    expect(day.avg[1]).toBeNull();
  });
});

describe('listHeartBuckets', () => {
  const insert = (raw: ReturnType<typeof openMemoryDb>['raw'], ts: number, hr: number | null) =>
    raw.query('INSERT INTO step_samples (timestamp, steps, calories, distance, heart_rate) VALUES (?, 0, 0, 0, ?)').run(ts, hr);

  it('keeps boundary readings in the right bucket and leaves out the neighbouring days and non-readings', async () => {
    const { raw, db } = openMemoryDb();
    insert(raw, DAY - 1, 90); // yesterday
    insert(raw, DAY, 60); // bucket 0
    insert(raw, DAY + 299, 64); // bucket 0
    insert(raw, DAY + 300, 80); // bucket 1
    insert(raw, DAY + 360, 100); // bucket 1
    insert(raw, DAY + 600, 0); // no reading
    insert(raw, DAY + 660, null); // no reading
    insert(raw, END - 1, 72); // last bucket
    insert(raw, END, 95); // tomorrow
    const rows = await listHeartBuckets(db, DAY, END);
    expect(rows).toEqual([
      { bucket: 0, avg: 62, min: 60, max: 64, count: 2 },
      { bucket: 1, avg: 90, min: 80, max: 100, count: 2 },
      { bucket: 287, avg: 72, min: 72, max: 72, count: 1 },
    ]);
  });

  it('loads resting rate and zone time with the buckets', async () => {
    const { raw, db } = openMemoryDb();
    for (let i = 0; i < 10; i++) insert(raw, DAY + i * 60, 130);
    raw.query('UPDATE step_samples SET resting_heart_rate = 52 WHERE timestamp = ?').run(DAY + 60);
    const data = await loadHeartDay(db, DAY, END, hrZonesForMax(190).bounds);
    expect(data.resting).toBe(52);
    expect(data.day.stats).toEqual({ min: 130, max: 130, avg: 130, readings: 10 });
    expect(data.zoneSeconds.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(data.restingRecently).toBe(true);
  });

  it('looks back two weeks for a resting rate, not further', async () => {
    const { raw, db } = openMemoryDb();
    insert(raw, DAY + 60, 70);
    expect((await loadHeartDay(db, DAY, END, hrZonesForMax(190).bounds)).restingRecently).toBe(false);
    insert(raw, DAY - 13 * 86400, 60);
    raw.query('UPDATE step_samples SET resting_heart_rate = 55 WHERE timestamp = ?').run(DAY - 13 * 86400);
    expect((await loadHeartDay(db, DAY, END, hrZonesForMax(190).bounds)).restingRecently).toBe(true);
    // 15 days before the day's end is outside the window.
    raw.query('UPDATE step_samples SET timestamp = ? WHERE timestamp = ?').run(END - 15 * 86400, DAY - 13 * 86400);
    expect((await loadHeartDay(db, DAY, END, hrZonesForMax(190).bounds)).restingRecently).toBe(false);
  });
});

describe('restingNotShared', () => {
  it('explains a missing resting rate only for a watch that has not sent one lately (HONOR Watch ES, JRG-487)', () => {
    expect(restingNotShared(true, null, false)).toBe(true);
    // A watch that sent one in the last two weeks just has none yet today.
    expect(restingNotShared(true, null, true)).toBe(false);
    expect(restingNotShared(true, 61, false)).toBe(false);
    // No readings at all: the empty-day notice says enough.
    expect(restingNotShared(false, null, false)).toBe(false);
  });
});
