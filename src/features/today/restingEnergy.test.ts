import { describe, expect, it } from 'bun:test';

import { bmrPerDay, mifflinStJeor, restingSoFar, type BodyProfile } from './restingEnergy';

const DAY = 86400;
const START = 1_000_000 * DAY;
const man: BodyProfile = { heightCm: 175, weightKg: 70, birthYear: 1996, sex: 'male' };

describe('mifflinStJeor', () => {
  it('male: 10 kg + 6.25 cm - 5 age + 5', () => {
    expect(mifflinStJeor(man, 2026)).toBe(Math.round(10 * 70 + 6.25 * 175 - 5 * 30 + 5));
  });
  it('female is 166 lower, unknown sex sits in the middle', () => {
    const f = mifflinStJeor({ ...man, sex: 'female' }, 2026) as number;
    const m = mifflinStJeor(man, 2026) as number;
    const u = mifflinStJeor({ ...man, sex: 'unknown' }, 2026) as number;
    expect(m - f).toBe(166);
    expect(u).toBe(m - 83);
  });
  it('is null when height, weight or birth year is missing or implausible', () => {
    expect(mifflinStJeor(null, 2026)).toBeNull();
    expect(mifflinStJeor({ ...man, heightCm: 0 }, 2026)).toBeNull();
    expect(mifflinStJeor({ ...man, weightKg: 0 }, 2026)).toBeNull();
    expect(mifflinStJeor({ ...man, weightKg: 400 }, 2026)).toBeNull();
    expect(mifflinStJeor({ ...man, birthYear: 0 }, 2026)).toBeNull();
    expect(mifflinStJeor({ ...man, birthYear: 2030 }, 2026)).toBeNull();
  });
});

describe('bmrPerDay', () => {
  it('prefers the cached JoyoRogo value', () => {
    expect(bmrPerDay({ rogoBmr: 1612.4, profile: man, nowYear: 2026 })).toEqual({ kcal: 1612, source: 'rogo' });
  });
  it('falls back to the profile, then to null', () => {
    expect(bmrPerDay({ rogoBmr: null, profile: man, nowYear: 2026 })?.source).toBe('profile');
    expect(bmrPerDay({ rogoBmr: 0, profile: man, nowYear: 2026 })?.source).toBe('profile');
    expect(bmrPerDay({ rogoBmr: null, profile: { ...man, birthYear: 0 }, nowYear: 2026 })).toBeNull();
    expect(bmrPerDay({ rogoBmr: null, profile: undefined, nowYear: 2026 })).toBeNull();
  });
});

describe('restingSoFar (a 24 h day, no DST)', () => {
  it('is 0 at midnight, half at noon, almost all at 23:59', () => {
    expect(restingSoFar(1800, START, START)).toBe(0);
    expect(restingSoFar(1800, START, START + 12 * 3600)).toBe(900);
    expect(restingSoFar(1800, START, START + 23 * 3600 + 59 * 60)).toBe(Math.round((1800 * (DAY - 60)) / DAY));
  });
  it('counts a past day in full and never goes negative', () => {
    expect(restingSoFar(1800, START, START + DAY + 5)).toBe(1800);
    expect(restingSoFar(1800, START, START + 3 * DAY)).toBe(1800);
    expect(restingSoFar(1800, START, START - 10)).toBe(0);
  });
});
