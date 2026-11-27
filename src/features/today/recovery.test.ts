import { describe, expect, it } from 'bun:test';

import type { HrvReadingRow } from '@/db/queries';
import { applyLocale } from '@/i18n';

import { nightHrvAvailability, type NightHrvInput } from './nightHrv';
import { bandOf, recovery, recoveryPercent } from './recovery';

const NOW = 1_760_655_600;
const OLD = 'HRV: belum ada pengukuran. Ukur HRV selama semenit, atau sinkron setelah semalam memakai jam.';

const input: NightHrvInput = {
  platform: 'android',
  knownSupported: true,
  enabled: true,
  calibratedAt: NOW - 10 * 86400,
  nightsSinceSetup: 0,
  nightRowsSinceSetup: 0,
  anyNightRowInHistory: false,
};
const missing = (r: ReturnType<typeof recovery>) => ('missing' in r ? r.missing : '');
const waitOf = (r: ReturnType<typeof recovery>) => ('wait' in r ? r.wait : null);

describe('recovery without a reading', () => {
  it('keeps the old text when nothing is known', () => {
    expect(missing(recovery([], NOW))).toBe(OLD);
    expect(missing(recovery([], NOW, null))).toBe(OLD);
    expect(missing(recovery([], NOW, { state: 'available' }))).toBe(OLD);
  });

  it('keeps the stale-readings text when nothing is known', () => {
    const stale: HrvReadingRow = { start: NOW - 5 * 86400, end: NOW - 5 * 86400 + 60, source: 'spot', rmssd: 40, beats: 60 };
    expect(missing(recovery([stale], NOW))).toBe('HRV: belum ada pengukuran dari semalam atau hari ini.');
  });

  it('says night HRV is unavailable and offers a 1-minute reading for an unsupported watch', () => {
    const text = missing(recovery([], NOW, nightHrvAvailability({ ...input, knownSupported: false })));
    expect(text).toBe('HRV malam tidak tersedia di jam ini. Ukur HRV selama semenit untuk mendapat skor pemulihan.');
  });

  it('does the same when the watch recorded none', () => {
    const text = missing(recovery([], NOW, nightHrvAvailability({ ...input, nightsSinceSetup: 3 })));
    expect(text).toBe('HRV malam tidak tersedia di jam ini. Ukur HRV selama semenit untuk mendapat skor pemulihan.');
  });

  it('does the same on iPhone', () => {
    const text = missing(recovery([], NOW, nightHrvAvailability({ ...input, platform: 'ios' })));
    expect(text).toBe('HRV malam belum dibaca di iPhone. Ukur HRV selama semenit untuk mendapat skor pemulihan.');
  });

  it('shows the off and waiting texts', () => {
    expect(missing(recovery([], NOW, nightHrvAvailability({ ...input, enabled: false })))).toStartWith('HRV malam mati. Nyalakan Stres otomatis');
    expect(missing(recovery([], NOW, nightHrvAvailability({ ...input, nightsSinceSetup: 2 })))).toBe(
      'HRV malam: menunggu beberapa malam pertama. Pakai jam saat tidur lalu sinkron. 2 dari 3 malam sudah dicek.',
    );
  });

  it('gives the gauge a short wait to match: switched off, 1-minute readings only, nothing yet', () => {
    expect(waitOf(recovery([], NOW, nightHrvAvailability({ ...input, enabled: false })))).toEqual({ kind: 'off' });
    expect(waitOf(recovery([], NOW, nightHrvAvailability({ ...input, knownSupported: false })))).toEqual({ kind: 'spot' });
    expect(waitOf(recovery([], NOW))).toEqual({ kind: 'none' });
  });

  it('counts the baseline the gauge is waiting for', () => {
    const night: HrvReadingRow = { start: NOW - 8 * 3600, end: NOW - 3600, source: 'night', rmssd: 50, beats: 100 };
    expect(waitOf(recovery([night], NOW, { state: 'available' }))).toEqual({ kind: 'baseline', have: 0, need: 4, unit: 'night' });
  });

  it('keeps the baseline message when a reading exists', () => {
    const night: HrvReadingRow = { start: NOW - 8 * 3600, end: NOW - 3600, source: 'night', rmssd: 50, beats: 100 };
    expect(missing(recovery([night], NOW, { state: 'available' }))).toBe('HRV: 0 dari 4 malam sebelumnya yang dibutuhkan untuk baselinemu.');
  });

  it('is worded in English, with plurals, when the app is', async () => {
    await applyLocale('en');
    try {
      expect(missing(recovery([], NOW))).toBe('HRV: no readings yet. Measure HRV for a minute, or sync after a night with the watch on.');
      const night: HrvReadingRow = { start: NOW - 8 * 3600, end: NOW - 3600, source: 'night', rmssd: 50, beats: 100 };
      expect(missing(recovery([night], NOW, { state: 'available' }))).toBe('HRV: 0 of 4 earlier nights needed for your baseline.');
    } finally {
      await applyLocale('id');
    }
  });
});

describe('recoveryPercent (ALGO-01, second iteration)', () => {
  it('puts the band edges on half a standard deviation: green from z = -0.5, red below z = -1.5', () => {
    expect(recoveryPercent(-0.5)).toBeCloseTo(67, 9);
    expect(recoveryPercent(-1.5)).toBeCloseTo(34, 9);
    expect(bandOf(Math.round(recoveryPercent(-0.49)))).toBe('green');
    expect(bandOf(Math.round(recoveryPercent(-0.6)))).toBe('yellow');
    expect(bandOf(Math.round(recoveryPercent(-1.6)))).toBe('red');
  });

  it('reads a usual day (z = 0) as about 80 %, green', () => {
    expect(Math.round(recoveryPercent(0))).toBe(80);
    expect(Math.round(recoveryPercent(1))).toBe(93);
    expect(Math.round(recoveryPercent(-1))).toBe(51);
  });

  it('rises with z and stays within 1..99', () => {
    const zs = [-6, -3, -2, -1, 0, 1, 2, 3, 6];
    const ps = zs.map(recoveryPercent);
    for (let i = 1; i < ps.length; i++) expect(ps[i]!).toBeGreaterThan(ps[i - 1]!);
    expect(Math.min(...ps)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...ps)).toBeLessThanOrEqual(99);
  });
});
