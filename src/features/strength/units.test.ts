import { afterEach, describe, expect, it } from 'bun:test';

import { applyLocale } from '@/i18n';

import { clampWeight, MAX_WEIGHT_KG, parseWeight, previousLabel, weightInputText, weightText } from './logFormat';
import { parseWeightAmount } from './routineEdit';
import { strengthShareStats } from './share/strengthShareStats';
import { buildCatalog } from './catalog';
import type { StrengthWorkout } from './types';
import { volumeText, weightText as liftWeightText } from './ui/liftFormat';
import {
  displayWeight,
  getWeightUnit,
  inputWeight,
  isWeightUnit,
  KG_PER_LB,
  kgToUnit,
  roundWeight,
  setWeightUnit,
  subscribeWeightUnit,
  unitToKg,
} from './units';

afterEach(() => {
  setWeightUnit('kg');
  void applyLocale('id');
});

describe('conversion', () => {
  it('uses the exact pound', () => {
    expect(KG_PER_LB).toBe(0.45359237);
    expect(kgToUnit(100, 'lb')).toBeCloseTo(220.462, 3);
    expect(unitToKg(220.462, 'lb')).toBeCloseTo(100, 3);
    expect(kgToUnit(62.5, 'kg')).toBe(62.5);
    expect(unitToKg(62.5, 'kg')).toBe(62.5);
  });

  it('reads the module unit when none is given and tells listeners', () => {
    const seen: string[] = [];
    const off = subscribeWeightUnit(() => seen.push(getWeightUnit()));
    expect(getWeightUnit()).toBe('kg');
    setWeightUnit('lb');
    setWeightUnit('lb');
    expect(kgToUnit(45.359237)).toBeCloseTo(100, 6);
    expect(unitToKg(100)).toBeCloseTo(45.359237, 6);
    setWeightUnit('kg');
    off();
    setWeightUnit('lb');
    expect(seen).toEqual(['lb', 'kg']);
  });

  it('knows its units', () => {
    expect(isWeightUnit('kg')).toBe(true);
    expect(isWeightUnit('lb')).toBe(true);
    expect(isWeightUnit('stone')).toBe(false);
    expect(isWeightUnit(undefined)).toBe(false);
  });
});

describe('display rounding', () => {
  it('keeps kg as before: whole from 100, one decimal below', () => {
    expect(roundWeight(62.54, 'kg')).toBe(62.5);
    expect(roundWeight(102.5, 'kg')).toBe(103);
    expect(displayWeight(99.96, 'kg')).toBe(100);
  });

  it('keeps one decimal of lb at any size', () => {
    expect(roundWeight(102.5, 'lb')).toBe(102.5);
    expect(roundWeight(225.04, 'lb')).toBe(225);
    expect(displayWeight(100, 'lb')).toBe(220.5);
    expect(displayWeight(61.23, 'lb')).toBe(135);
  });

  it('shows the box value with two decimals of kg and one of lb, never the whole-number display rounding', () => {
    expect(inputWeight(102.5, 'kg')).toBe(102.5);
    expect(inputWeight(22.256, 'kg')).toBe(22.26);
    expect(inputWeight(61.23, 'lb')).toBe(135);
    expect(inputWeight(46.49, 'lb')).toBe(102.5);
  });
});

describe('typing in lb', () => {
  it('stores kg that reads back as the typed lb after clampWeight rounds to 0.01 kg', () => {
    for (const lb of [0.1, 2.5, 45, 95.5, 135, 185, 225, 315, 405, 495.5, 1000, 2204.6]) {
      const kg = clampWeight(unitToKg(lb, 'lb')) as number;
      expect(inputWeight(kg, 'lb')).toBe(lb);
      expect(displayWeight(kg, 'lb')).toBe(lb);
      // The same number typed as text goes through the box path.
      expect(weightInputText(kg, '.', 'lb')).toBe(String(lb));
    }
    expect(clampWeight(unitToKg(135, 'lb'))).toBe(61.23);
  });

  it('parses text in the unit and keeps nothing for nothing', () => {
    expect(parseWeight('135', 'lb')).toBe(61.23);
    expect(parseWeight('135,5', 'lb')).toBe(61.46);
    expect(parseWeight('60', 'kg')).toBe(60);
    expect(parseWeight('', 'lb')).toBeNull();
    expect(parseWeight('abc', 'lb')).toBeNull();
    expect(parseWeight('0', 'lb')).toBe(0);
    expect(weightInputText(null, '.', 'lb')).toBe('');
  });

  it('caps at the kg limit, however it was typed', () => {
    expect(parseWeight('5000', 'lb')).toBe(MAX_WEIGHT_KG);
    expect(parseWeight('5000', 'kg')).toBe(MAX_WEIGHT_KG);
    expect(inputWeight(MAX_WEIGHT_KG, 'lb')).toBe(2204.6);
    expect(clampWeight(unitToKg(2204.62, 'lb'))).toBe(MAX_WEIGHT_KG);
  });

  it('follows the module unit when none is passed', () => {
    setWeightUnit('lb');
    expect(parseWeight('135')).toBe(61.23);
    expect(weightInputText(61.23, '.')).toBe('135');
    setWeightUnit('kg');
    expect(weightInputText(61.23, '.')).toBe('61.23');
  });

  it('the routine editor box parses lb to kg with a cap and no extra places', () => {
    expect(parseWeightAmount('135', 'lb')).toBe(61.23);
    expect(parseWeightAmount('135,5', 'lb')).toBe(61.46);
    expect(parseWeightAmount('60', 'kg')).toBe(60);
    expect(parseWeightAmount('', 'lb')).toBeNull();
    expect(parseWeightAmount('1,', 'lb')).toBe(0.45);
    expect(parseWeightAmount('9999', 'lb')).toBe(999);
    expect(parseWeightAmount('9999', 'kg')).toBe(999);
    expect(parseWeightAmount('12kg', 'lb')).toBeNull();
  });
});

describe('switching back', () => {
  it('shows the original kg after a round of lb', () => {
    const stored = 62.5;
    setWeightUnit('lb');
    expect(liftWeightText(stored)).toBe('137,8 lb');
    setWeightUnit('kg');
    expect(liftWeightText(stored)).toBe('62,5 kg');
    expect(stored).toBe(62.5);
  });
});

describe('text in the chosen unit', () => {
  it('weights, previous column and volume', () => {
    expect(weightText(61.23)).toBe('61,2 kg');
    expect(volumeText(1000)).toBe('1.000 kg');
    setWeightUnit('lb');
    expect(weightText(61.23)).toBe('135 lb');
    expect(previousLabel({ weightKg: 61.23, reps: 5, seconds: null }, false)).toBe('135 lb x 5');
    expect(previousLabel({ weightKg: 0, reps: 5, seconds: null }, false)).toBe('5');
    expect(volumeText(1000)).toBe('2.205 lb');
    void applyLocale('en');
    expect(liftWeightText(100)).toBe('220.5 lb');
  });
});

describe('share card', () => {
  const set = { id: 's', type: 'normal' as const, weightKg: 100, reps: 5, seconds: null, rpe: null, done: true, doneAt: 1 };
  const workout: StrengthWorkout = {
    id: 'w',
    name: 'Legs',
    startedAt: 1,
    endedAt: 2,
    durationSec: 600,
    note: '',
    routineId: null,
    planKey: null,
    exercises: [{ key: 'k', exerciseId: 'barbell_back_squat', note: '', restSec: null, supersetGroup: null, sets: [set] }],
    workoutStart: null,
    kcal: null,
    kcalSource: null,
    updatedAt: 0,
    deletedAt: null,
  };

  it('writes the volume and the top set in lb', () => {
    setWeightUnit('lb');
    const s = strengthShareStats(workout, buildCatalog([]), 'en', []);
    expect(s.stats[0]).toMatchObject({ key: 'volume', value: '1,102', unit: 'lb' });
    expect(s.topSets[0]!.load).toBe('220.5 lb x 5');
    setWeightUnit('kg');
    const kg = strengthShareStats(workout, buildCatalog([]), 'en', []);
    expect(kg.stats[0]).toMatchObject({ key: 'volume', value: '500', unit: 'kg' });
    expect(kg.topSets[0]!.load).toBe('100 kg x 5');
  });
});
