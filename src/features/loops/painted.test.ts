import { describe, expect, test } from 'bun:test';

import { destination, resampleLine } from './geo';
import { CELL_M, createPaintedIndex, displayLines, scoreLoop } from './painted';

const HOME = { lat: -6.2088, lon: 106.8456 };

/** A straight street of `lengthM` going `bearing` from `from`, one fix every `stepM`. */
function street(from: { lat: number; lon: number }, bearing: number, lengthM: number, stepM = 5) {
  const out = [];
  for (let d = 0; d <= lengthM; d += stepM) out.push(destination(from, bearing, d));
  return out;
}

/** A square block loop of `side` metres, as one closed line. */
function square(from: { lat: number; lon: number }, side: number) {
  const a = from;
  const b = destination(a, 90, side);
  const c = destination(b, 0, side);
  const d = destination(c, 270, side);
  return [a, b, c, d, a];
}

describe('createPaintedIndex', () => {
  test('a point on a walked street is painted, one on a street 100 m away is not', () => {
    const index = createPaintedIndex(HOME.lat);
    index.addTrack(street(HOME, 90, 500));
    expect(index.isPainted(destination(HOME, 90, 250))).toBe(true);
    // A few metres off the street still counts: GPS wanders and a street has two sides.
    expect(index.isPainted(destination(destination(HOME, 90, 250), 0, 12))).toBe(true);
    expect(index.isPainted(destination(destination(HOME, 90, 250), 0, 100))).toBe(false);
    expect(index.isPainted(destination(HOME, 90, 800))).toBe(false);
  });

  test('sparse fixes still paint the street between them', () => {
    const index = createPaintedIndex(HOME.lat);
    index.addTrack([HOME, destination(HOME, 90, 120)]);
    expect(index.isPainted(destination(HOME, 90, 60))).toBe(true);
  });

  test('a gap in the signal is not painted as a straight line', () => {
    const index = createPaintedIndex(HOME.lat);
    index.addTrack([HOME, destination(HOME, 90, 1000)]);
    expect(index.isPainted(destination(HOME, 90, 500))).toBe(false);
    expect(index.isPainted(HOME)).toBe(true);
    expect(index.isPainted(destination(HOME, 90, 1000))).toBe(true);
    expect(index.size).toBe(2);
  });

  test('the cell is as small as promised', () => {
    expect(CELL_M).toBeLessThanOrEqual(20);
  });
});

describe('scoreLoop', () => {
  const loop = square(HOME, 400);

  test('without history there is no novelty figure, only the length', () => {
    const score = scoreLoop(loop, null);
    expect(score.newShare).toBeNull();
    expect(score.lengthM).toBeCloseTo(1600, -1);
  });

  test('a loop on streets never walked is entirely new', () => {
    const index = createPaintedIndex(HOME.lat);
    index.addTrack(street(destination(HOME, 180, 2000), 90, 800));
    expect(scoreLoop(loop, index).newShare).toBe(1);
  });

  test('a loop whose street is walked is not new, and half of it walked is about half new', () => {
    const all = createPaintedIndex(HOME.lat);
    all.addTrack(resampleLine(loop, 8));
    expect(scoreLoop(loop, all).newShare).toBeLessThan(0.02);

    const half = createPaintedIndex(HOME.lat);
    half.addTrack(resampleLine([loop[0], loop[1], loop[2]], 8));
    const share = scoreLoop(loop, half).newShare ?? 0;
    expect(share).toBeGreaterThan(0.4);
    expect(share).toBeLessThan(0.6);
  });

  test('an out-and-back retraces itself, a block loop does not', () => {
    const out = street(HOME, 90, 800, 20);
    const outAndBack = [...out, ...[...out].reverse()];
    expect(scoreLoop(outAndBack, null).repeatShare).toBeGreaterThan(0.4);
    expect(scoreLoop(square(HOME, 600), null).repeatShare).toBeLessThan(0.05);
  });
});

describe('displayLines', () => {
  const box: [number, number, number, number] = [HOME.lat - 0.01, HOME.lon - 0.01, HOME.lat + 0.01, HOME.lon + 0.01];

  test('thins a track to one point per 12 m and keeps both ends of a long street', () => {
    const [line] = displayLines([street(HOME, 90, 300, 2)], box);
    expect(line.length).toBeGreaterThan(15);
    expect(line.length).toBeLessThan(40);
  });

  test('cuts a track where it leaves the box and where the signal dropped', () => {
    const leaves = street(HOME, 90, 3000, 10);
    const lines = displayLines([leaves], box);
    expect(lines).toHaveLength(1);
    expect(lines[0][lines[0].length - 1].lon).toBeLessThanOrEqual(box[3]);

    const gap = [...street(HOME, 90, 100), ...street(destination(HOME, 90, 1000), 90, 100)];
    expect(displayLines([gap], box)).toHaveLength(2);
  });

  test('stops at the point budget, newest tracks first', () => {
    const newest = street(HOME, 90, 200, 12);
    const oldest = street(destination(HOME, 0, 300), 90, 200, 12);
    const lines = displayLines([newest, oldest], box, 5, newest.length);
    expect(lines).toHaveLength(1);
    expect(lines[0][0].lat).toBeCloseTo(HOME.lat, 4);
  });
});
