import { afterAll, describe, expect, test } from 'bun:test';

import { applyLocale } from '@/i18n';

import { bigNumber, formatPace, secondaryLine, targetText } from './display';
import type { LoopBody } from './targets';

const WALKER: LoopBody = { activity: 'walk', strideM: 0.72, paceSecPerKm: 780, weightKg: 70 };

afterAll(() => applyLocale('id'));

describe('display (Indonesian)', () => {
  test('the big number and its unit', () => {
    expect(bigNumber('steps', 10_000)).toEqual({ number: '10.000', unit: 'langkah' });
    expect(bigNumber('distance', 7000)).toEqual({ number: '7', unit: 'km' });
    expect(bigNumber('distance', 7500)).toEqual({ number: '7,5', unit: 'km' });
    expect(bigNumber('distance', 7250)).toEqual({ number: '7,25', unit: 'km' });
    expect(bigNumber('time', 90)).toEqual({ number: '90', unit: 'menit' });
    expect(bigNumber('kcal', 400)).toEqual({ number: '400', unit: 'kcal' });
    expect(targetText('steps', 10_000)).toBe('10.000 langkah');
  });

  test('the line under it lists the other three figures of the same loop', () => {
    // 10 000 steps of 0.72 m: 7.2 km, 93.6 minutes, 3.8 x 70 x 1.56 h = 415 kcal.
    expect(secondaryLine('steps', 7200, WALKER)).toBe('≈ 7,2 km · 1 j 34 mnt · 415 kcal');
    expect(secondaryLine('distance', 7200, WALKER)).toBe('≈ 10.000 langkah · 1 j 34 mnt · 415 kcal');
    expect(secondaryLine('kcal', 7200, WALKER)).toBe('≈ 10.000 langkah · 7,2 km · 1 j 34 mnt');
  });

  test('pace as minutes and seconds', () => {
    expect(formatPace(700)).toBe('11:40');
    expect(formatPace(359.6)).toBe('6:00');
    expect(formatPace(305)).toBe('5:05');
  });
});

describe('display (English)', () => {
  test('uses the other decimal mark and unit words', () => {
    applyLocale('en');
    expect(bigNumber('steps', 10_000)).toEqual({ number: '10,000', unit: 'steps' });
    expect(bigNumber('distance', 7250)).toEqual({ number: '7.25', unit: 'km' });
    expect(bigNumber('time', 90).unit).toBe('min');
    expect(secondaryLine('steps', 7200, WALKER)).toBe('≈ 7.2 km · 1 h 34 min · 415 kcal');
  });
});
