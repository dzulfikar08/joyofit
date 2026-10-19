import { describe, expect, test } from 'bun:test';

import { haversineM } from '@/features/routes/routeModel';

import { boxAround, destination, pathLengthM, resampleLine, seededRandom } from './geo';

const HOME = { lat: -6.2088, lon: 106.8456 };

describe('destination', () => {
  test('lands the asked distance away on the asked bearing', () => {
    for (const bearing of [0, 45, 90, 180, 270, 333]) {
      const there = destination(HOME, bearing, 1500);
      expect(haversineM(HOME, there)).toBeCloseTo(1500, 0);
    }
    const east = destination(HOME, 90, 1000);
    expect(east.lon).toBeGreaterThan(HOME.lon);
    expect(Math.abs(east.lat - HOME.lat)).toBeLessThan(1e-4);
    expect(destination(HOME, 0, 1000).lat).toBeGreaterThan(HOME.lat);
  });

  test('wraps the longitude at the date line', () => {
    const there = destination({ lat: 0, lon: 179.999 }, 90, 5000);
    expect(there.lon).toBeLessThan(-179);
  });
});

describe('pathLengthM and resampleLine', () => {
  const line = [HOME, destination(HOME, 90, 100), destination(destination(HOME, 90, 100), 0, 100)];

  test('length of an L is the sum of its legs', () => {
    expect(pathLengthM(line)).toBeCloseTo(200, 0);
    expect(pathLengthM([])).toBe(0);
    expect(pathLengthM([HOME])).toBe(0);
  });

  test('points come every step along the line, ends included, even across the corner', () => {
    const out = resampleLine(line, 30);
    expect(out[0]).toEqual(line[0]);
    expect(out[out.length - 1]).toEqual(line[2]);
    // 200 m at 30 m: points at 30, 60, 90, 120, 150, 180 plus both ends.
    expect(out.length).toBe(8);
    for (let i = 1; i < out.length - 1; i++) {
      expect(haversineM(out[i - 1], out[i])).toBeLessThanOrEqual(30.5);
    }
  });

  test('a line shorter than the step is its two ends; no points is no points', () => {
    expect(resampleLine([HOME, destination(HOME, 0, 5)], 10)).toHaveLength(2);
    expect(resampleLine([], 10)).toEqual([]);
    expect(resampleLine([HOME], 10)).toEqual([HOME]);
  });
});

describe('boxAround', () => {
  test('is south, west, north, east, wider in degrees of longitude toward the poles', () => {
    const [south, west, north, east] = boxAround(HOME, 1000);
    expect(north - south).toBeCloseTo(2000 / 111_195, 3);
    expect(east).toBeGreaterThan(west);
    const [, w2, , e2] = boxAround({ lat: 60, lon: 18 }, 1000);
    expect(e2 - w2).toBeGreaterThan(east - west);
  });
});

describe('seededRandom', () => {
  test('the same seed gives the same sequence, another seed another one', () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    const c = seededRandom(8);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect([c(), c(), c()]).not.toEqual(first);
    for (const v of first) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
