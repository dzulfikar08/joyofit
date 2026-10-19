import { describe, expect, it } from 'bun:test';

import { jakartaDay, toRogoCheckIn } from './rogoMap';

describe('jakartaDay', () => {
  it('counts the day in UTC+7', () => {
    expect(jakartaDay(Date.UTC(2026, 9, 19, 16, 59))).toBe('2026-10-19');
    expect(jakartaDay(Date.UTC(2026, 9, 19, 17, 0))).toBe('2026-10-20');
    expect(jakartaDay(Date.UTC(2026, 11, 31, 18, 0))).toBe('2027-01-01');
  });
});

describe('toRogoCheckIn', () => {
  const at = Date.UTC(2026, 9, 19, 1, 0);

  it('sends the weight to 0.1 kg and the Jakarta day', () => {
    expect(toRogoCheckIn({ weightKg: 73.46 }, at)).toEqual({ weightKg: 73.5, date: '2026-10-19' });
    expect(toRogoCheckIn({ weightKg: 73.44 }, at)).toEqual({ weightKg: 73.4, date: '2026-10-19' });
  });

  it('rejects what weight.checkIn would reject (25..400 kg)', () => {
    expect(toRogoCheckIn({ weightKg: 24.9 }, at)).toBeNull();
    expect(toRogoCheckIn({ weightKg: 25 }, at)).not.toBeNull();
    expect(toRogoCheckIn({ weightKg: 400 }, at)).not.toBeNull();
    expect(toRogoCheckIn({ weightKg: 400.1 }, at)).toBeNull();
    expect(toRogoCheckIn({ weightKg: Number.NaN }, at)).toBeNull();
  });

  it('carries nothing but weight and date (JoyoRogo has no source or body fields)', () => {
    expect(Object.keys(toRogoCheckIn({ weightKg: 70 }, at) ?? {}).sort()).toEqual(['date', 'weightKg']);
  });
});
