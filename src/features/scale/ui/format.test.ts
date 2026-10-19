import { describe, expect, it } from 'bun:test';

import { bodyValues } from './format';

describe('bodyValues', () => {
  it('orders and rounds the values that exist and leaves out the rest', () => {
    expect(bodyValues({ bmi: 24.46, bodyFatPct: 18.54, bmrKcal: 1612.4, visceralFat: 7.6 })).toEqual([
      { key: 'fat', value: 18.5 },
      { key: 'visceral', value: 8 },
      { key: 'bmr', value: 1612 },
      { key: 'bmi', value: 24.5 },
    ]);
  });
  it('never shows zero or missing values', () => {
    expect(bodyValues({ bodyFatPct: 0, waterPct: Number.NaN })).toEqual([]);
    expect(bodyValues(null)).toEqual([]);
  });
});
