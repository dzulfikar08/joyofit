import { describe, expect, it } from 'bun:test';

import { profileWeightKg, scaleUserFrom } from './profile';

const base = { heightCm: 172, weightKg: 70, birthYear: 1992, sex: 'male' as const };

describe('scaleUserFrom', () => {
  it('derives age from the birth year', () => {
    expect(scaleUserFrom(base, 2026)).toEqual({ heightCm: 172, ageYears: 34, male: true });
    expect(scaleUserFrom({ ...base, sex: 'female' }, 2026)?.male).toBe(false);
  });
  it('is null when something is missing or implausible', () => {
    expect(scaleUserFrom(null, 2026)).toBeNull();
    expect(scaleUserFrom({ ...base, sex: 'unknown' }, 2026)).toBeNull();
    expect(scaleUserFrom({ ...base, heightCm: 0 }, 2026)).toBeNull();
    expect(scaleUserFrom({ ...base, birthYear: 0 }, 2026)).toBeNull();
    expect(scaleUserFrom({ ...base, birthYear: 2024 }, 2026)).toBeNull();
  });
});

describe('profileWeightKg', () => {
  it('accepts a human weight only', () => {
    expect(profileWeightKg(base)).toBe(70);
    expect(profileWeightKg({ ...base, weightKg: 0 })).toBeNull();
    expect(profileWeightKg(null)).toBeNull();
  });
});
