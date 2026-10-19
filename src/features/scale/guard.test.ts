import { describe, expect, it } from 'bun:test';

import { DEFAULT_GUARD_PERCENT, GUARD_REFERENCE_MAX_AGE_DAYS, needsConfirmation } from './guard';

const DAY = 86_400_000;

describe('needsConfirmation', () => {
  const now = 1_000 * DAY;
  const last = { weightKg: 73.5, at: now - 2 * DAY };

  it('lets ordinary day-to-day changes through', () => {
    expect(needsConfirmation(74.9, last, now)).toBe(false);
    expect(needsConfirmation(72.0, last, now)).toBe(false);
  });

  it('asks when the weight is far from the last one (another person on the scale)', () => {
    expect(needsConfirmation(58.0, last, now)).toBe(true);
    expect(needsConfirmation(91.0, last, now)).toBe(true);
  });

  it('uses the percent threshold exactly', () => {
    const limit = 73.5 * (1 + DEFAULT_GUARD_PERCENT / 100);
    expect(needsConfirmation(limit - 0.01, last, now)).toBe(false);
    expect(needsConfirmation(limit + 0.01, last, now)).toBe(true);
    expect(needsConfirmation(80, last, now, 20)).toBe(false);
  });

  it('never asks without a reference, with a stale one, or when switched off', () => {
    expect(needsConfirmation(40, null, now)).toBe(false);
    expect(needsConfirmation(40, { weightKg: 73.5, at: now - (GUARD_REFERENCE_MAX_AGE_DAYS + 1) * DAY }, now)).toBe(false);
    expect(needsConfirmation(40, last, now, 0)).toBe(false);
  });

  it('a reference without a date (profile weight) always counts', () => {
    expect(needsConfirmation(40, { weightKg: 73.5, at: null }, now)).toBe(true);
  });
});
