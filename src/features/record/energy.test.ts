import { describe, expect, it } from 'bun:test';

import { keytelKcalPerMin, restKcalPerMin } from './energy';

describe('keytelKcalPerMin', () => {
  it('without VO2max is the population model (the negative female weight term is the paper\'s)', () => {
    expect(keytelKcalPerMin(150, { weightKg: 70, age: 30, sex: 'male' })).toBeCloseTo((-55.0969 + 0.6309 * 150 + 0.1988 * 70 + 0.2017 * 30) / 4.184, 9);
    expect(keytelKcalPerMin(150, { weightKg: 60, age: 30, sex: 'female' })).toBeCloseTo((-20.4022 + 0.4472 * 150 - 0.1263 * 60 + 0.074 * 30) / 4.184, 9);
  });

  it('with the watch\'s VO2max is the fitness model: 30 y, 70 kg, 150 bpm, VO2max 45 is about 12.72 kcal/min', () => {
    expect(keytelKcalPerMin(150, { weightKg: 70, age: 30, sex: 'male', vo2max: 45 })).toBeCloseTo(53.2165 / 4.184, 3);
    expect(keytelKcalPerMin(150, { weightKg: 60, age: 30, sex: 'female', vo2max: 40 })).toBeCloseTo(
      (-59.3954 + 0.45 * 150 + 0.38 * 40 + 0.103 * 60 + 0.274 * 30) / 4.184,
      9,
    );
  });

  it('a fitter person of the same build burns more at the same heart rate, and a heavier woman more, not less', () => {
    const base = { weightKg: 60, age: 30, sex: 'female' as const };
    expect(keytelKcalPerMin(140, { ...base, vo2max: 50 })).toBeGreaterThan(keytelKcalPerMin(140, { ...base, vo2max: 35 }));
    expect(keytelKcalPerMin(140, { ...base, weightKg: 80, vo2max: 40 })).toBeGreaterThan(keytelKcalPerMin(140, { ...base, vo2max: 40 }));
  });

  it('ignores an implausible VO2max and falls back to the population model', () => {
    const p = { weightKg: 70, age: 30, sex: 'male' as const };
    expect(keytelKcalPerMin(150, { ...p, vo2max: 300 })).toBe(keytelKcalPerMin(150, p));
    expect(keytelKcalPerMin(150, { ...p, vo2max: null })).toBe(keytelKcalPerMin(150, p));
  });

  it('never drops below resting energy, 1 MET for the person\'s weight', () => {
    expect(restKcalPerMin(60)).toBe(1);
    expect(restKcalPerMin(120)).toBe(2);
    expect(keytelKcalPerMin(50, { weightKg: 120, age: 30, sex: 'female' })).toBe(2);
  });
});
