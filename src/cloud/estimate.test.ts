import { afterEach, describe, expect, it } from 'bun:test';

import { applyLocale } from '@/i18n';
import { ANALYSIS_BYTES, bytesPerPoint, cloudLineText, DEFAULT_BYTES_PER_POINT, estimateBytes, formatSize } from './estimate';

const NOTHING = { workouts: 0, bytes: 0, points: 0 };

describe('estimateBytes', () => {
  it('uses 9 bytes per point and about 8 KB of analysis per workout until something is uploaded', () => {
    expect(bytesPerPoint(NOTHING)).toBe(DEFAULT_BYTES_PER_POINT);
    expect(estimateBytes(1, 3600, NOTHING)).toBe(3600 * 9 + ANALYSIS_BYTES);
    expect(estimateBytes(3, 0, NOTHING)).toBe(3 * ANALYSIS_BYTES);
    expect(estimateBytes(0, 0, NOTHING)).toBe(0);
  });

  it('learns the bytes per point from what is already in the cloud, without the analyses', () => {
    // Two workouts of 5000 points at 12 bytes per point, plus their analyses.
    const uploaded = { workouts: 2, bytes: 2 * ANALYSIS_BYTES + 10_000 * 12, points: 10_000 };
    expect(bytesPerPoint(uploaded)).toBeCloseTo(12, 6);
    expect(estimateBytes(1, 1000, uploaded)).toBe(1000 * 12 + ANALYSIS_BYTES);
  });

  it('keeps the default when too few points were uploaded to learn from, or the figures make no sense', () => {
    expect(bytesPerPoint({ workouts: 1, bytes: 9_000, points: 100 })).toBe(DEFAULT_BYTES_PER_POINT);
    expect(bytesPerPoint({ workouts: 5, bytes: 100, points: 50_000 })).toBe(DEFAULT_BYTES_PER_POINT);
  });
});

describe('formatSize', () => {
  afterEach(() => applyLocale('id'));

  it('is KB below a megabyte and MB above', async () => {
    await applyLocale('en');
    expect(formatSize(0)).toBe('1 KB');
    expect(formatSize(38_400)).toBe('38 KB');
    expect(formatSize(999_400)).toBe('999 KB');
    expect(formatSize(1_250_000)).toBe('1.3 MB');
    expect(formatSize(400_000_000)).toBe('400 MB');
  });

  it('uses the decimal comma in Indonesian', () => {
    expect(formatSize(1_250_000)).toBe('1,3 MB');
  });
});

describe('cloudLineText', () => {
  afterEach(() => applyLocale('id'));

  it('says in the cloud with its size, or not uploaded yet with the estimate', async () => {
    await applyLocale('en');
    expect(cloudLineText({ cloudBytes: 38_000, stale: false, estimateBytes: 41_000, locked: false })).toBe('Cloud: in cloud (38 KB)');
    expect(cloudLineText({ cloudBytes: null, stale: false, estimateBytes: 41_000, locked: false })).toBe('Cloud: not uploaded yet (about 41 KB)');
  });

  it('mentions a waiting update, and for a free account only that the workout stays on the phone', async () => {
    await applyLocale('en');
    expect(cloudLineText({ cloudBytes: 38_000, stale: true, estimateBytes: 41_000, locked: false })).toBe(
      'Cloud: in cloud (38 KB), update waiting (about 41 KB)',
    );
    expect(cloudLineText({ cloudBytes: 38_000, stale: true, estimateBytes: 41_000, locked: true })).toBe('Cloud: in cloud (38 KB)');
    expect(cloudLineText({ cloudBytes: null, stale: false, estimateBytes: 41_000, locked: true })).toBe(
      'Cloud: stays on this phone (Joyo Pro syncs it)',
    );
  });

  it('speaks Indonesian by default', () => {
    expect(cloudLineText({ cloudBytes: 38_000, stale: true, estimateBytes: 41_000, locked: false })).toBe(
      'Cloud: sudah di cloud (38 KB), pembaruan menunggu (sekitar 41 KB)',
    );
  });
});
