import { describe, expect, it } from 'bun:test';

import { filterRriArtefacts, hrvMetrics, MIN_RRI_FOR_HRV, withinPhysiological } from './rri';

describe('R-R intervals', () => {
  it('keeps only physiological intervals (30-240 bpm)', () => {
    expect([200, 250, 800, 2000, 2001].filter(withinPhysiological)).toEqual([250, 800, 2000]);
  });

  it('returns a short run unchanged', () => {
    expect(filterRriArtefacts([800, 810, 790, 805])).toEqual([800, 810, 790, 805]);
  });

  it('replaces a single artefact with the mean of its neighbours, leaving clean beats', () => {
    const clean = [800, 810, 805, 795, 800, 808, 802];
    expect(filterRriArtefacts(clean)).toEqual(clean);
    // A dropped beat in the middle (≈double interval) is pulled back to its neighbours' mean.
    const out = filterRriArtefacts([800, 810, 1600, 795, 800]);
    expect(out[2]).toBeCloseTo((810 + 795) / 2, 6);
    expect(out[0]).toBe(800);
    expect(out[4]).toBe(800);
  });

  it('does not touch the two beats at each end', () => {
    const raw = [1600, 800, 805, 800, 1600];
    const out = filterRriArtefacts(raw);
    expect(out[0]).toBe(1600);
    expect(out[4]).toBe(1600);
  });
});

describe('HRV metrics', () => {
  it('returns null below the beat floor', () => {
    expect(hrvMetrics(Array(MIN_RRI_FOR_HRV - 1).fill(800))).toBeNull();
  });

  it('is zero variability for identical intervals', () => {
    const r = hrvMetrics(Array(60).fill(800));
    expect(r).not.toBeNull();
    expect(r!.rmssd).toBe(0);
    expect(r!.sdnn).toBe(0);
    expect(r!.beats).toBe(60);
  });

  it('computes RMSSD from successive differences', () => {
    // Alternating 800/840: each successive diff is 40, so RMSSD = 40.
    const alt = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? 800 : 840));
    const r = hrvMetrics(alt)!;
    expect(r.rmssd).toBeCloseTo(40, 6);
    expect(r.sdnn).toBeCloseTo(20, 6);
  });
});
