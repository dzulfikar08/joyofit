import { describe, expect, test } from 'bun:test';

import { plateLoads, platesFor } from './plates';

describe('platesFor', () => {
  test('exact: 100 kg on a 20 kg bar is 25 + 15 per side', () => {
    expect(platesFor(100, 20, 'kg')).toEqual({
      perSide: [
        { weight: 25, count: 1 },
        { weight: 15, count: 1 },
      ],
      reached: 100,
      remainder: 0,
      belowBar: false,
    });
  });

  test('inexact: 101 kg reaches 100 with 1 kg left', () => {
    const load = platesFor(101, 20, 'kg');
    expect(load.reached).toBe(100);
    expect(load.remainder).toBe(1);
    expect(load.perSide.map((p) => p.weight)).toEqual([25, 15]);
  });

  test('stacks the same plate', () => {
    expect(platesFor(140, 20, 'kg').perSide).toEqual([{ weight: 25, count: 2 }, { weight: 10, count: 1 }]);
  });

  test('below the bar: no plates, the bar is what is lifted', () => {
    expect(platesFor(15, 20, 'kg')).toEqual({ perSide: [], reached: 20, remainder: 0, belowBar: true });
  });

  test('the bar alone is exact', () => {
    expect(platesFor(20, 20, 'kg')).toEqual({ perSide: [], reached: 20, remainder: 0, belowBar: false });
  });

  test('zero, negative and null are an empty load, not "below the bar"', () => {
    for (const target of [0, -5, null, Number.NaN]) {
      expect(platesFor(target, 20, 'kg')).toEqual({ perSide: [], reached: 20, remainder: 0, belowBar: false });
    }
  });

  test('lb: 225 on a 45 bar is two 45s per side', () => {
    expect(platesFor(225, 45, 'lb')).toEqual({ perSide: [{ weight: 45, count: 2 }], reached: 225, remainder: 0, belowBar: false });
  });

  test('lb uses 35s and has no 15', () => {
    expect(platesFor(135 + 70, 45, 'lb').perSide).toEqual([{ weight: 45, count: 1 }, { weight: 35, count: 1 }]);
  });

  test('smallest kg plate: 1.25 per side', () => {
    expect(platesFor(22.5, 20, 'kg')).toEqual({ perSide: [{ weight: 1.25, count: 1 }], reached: 22.5, remainder: 0, belowBar: false });
  });

  test('float noise from a unit conversion does not cost a plate', () => {
    // 225 lb stored as kg and read back is 225.00000000000003
    expect(platesFor(102.05828325 / 0.45359237, 45, 'lb').remainder).toBe(0);
    expect(platesFor(0.1 + 0.2 + 99.7, 20, 'kg').remainder).toBe(0);
  });

  test('an odd leftover is reported, not rounded away', () => {
    const load = platesFor(20.5, 20, 'kg');
    expect(load.perSide).toEqual([]);
    expect(load.remainder).toBe(0.5);
  });
});

describe('plateLoads', () => {
  const set = (weightKg: number | null, done: boolean) => ({ weightKg, done });

  test('distinct loads, the first set still to do in front', () => {
    expect(plateLoads([set(60, true), set(80, true), set(80, false), set(100, false)])).toEqual([80, 60, 100]);
  });

  test('all done: the last load leads', () => {
    expect(plateLoads([set(60, true), set(100, true)])).toEqual([100, 60]);
  });

  test('no load: nothing to offer', () => {
    expect(plateLoads([set(null, false), set(0, false)])).toEqual([]);
  });
});
