import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { modelOfBluetoothName, watchDisplayName, watchListName, withoutBrand, WATCH_MODEL_PREFIXES } from './watchName';

const KOTLIN = readFileSync(
  new URL('../../../modules/huawei-wear/android/src/main/java/com/joyodigitama/huaweiwear/WatchModels.kt', import.meta.url),
  'utf8',
);

describe('modelOfBluetoothName', () => {
  test('codename Seiya is the Huawei Watch Fit 4 Pro', () => {
    expect(modelOfBluetoothName('Seiya-B29F')).toBe('Huawei Watch Fit 4 Pro');
    expect(modelOfBluetoothName('SEIYA-0001')).toBe('Huawei Watch Fit 4 Pro');
  });

  test('every model in the list is found by its prefix', () => {
    for (const [model, prefix] of WATCH_MODEL_PREFIXES) {
      expect(modelOfBluetoothName(`${prefix.toUpperCase()}ABC`)).toBe(model);
    }
  });

  test('the longest prefix wins', () => {
    expect(modelOfBluetoothName('HUAWEI WATCH FIT 4 Pro-40A')).toBe('Huawei Watch Fit 4 Pro');
    expect(modelOfBluetoothName('HUAWEI WATCH FIT 4-40A')).toBe('Huawei Watch Fit 4');
    expect(modelOfBluetoothName('Huawei Band 11-123')).toBe('Huawei Band 11');
  });

  test('unknown names and empty values give null', () => {
    expect(modelOfBluetoothName('Mystery-1234')).toBeNull();
    expect(modelOfBluetoothName('')).toBeNull();
    expect(modelOfBluetoothName(null)).toBeNull();
  });

  test('the list holds every model name in WatchModels.kt', () => {
    const names = [...KOTLIN.matchAll(/^\s*(?:br|le)\("([^"]+)",/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(60);
    const known = new Set(WATCH_MODEL_PREFIXES.map(([m]) => m));
    expect(names.filter((n) => !known.has(n!))).toEqual([]);
    expect(WATCH_MODEL_PREFIXES.length).toBe(names.length);
  });
});

describe('watchDisplayName', () => {
  test('codename shows the model', () => {
    expect(watchDisplayName({ name: 'Seiya-B29F' })).toBe('Huawei Watch Fit 4 Pro');
  });
  test('unknown falls back to the Bluetooth name', () => {
    expect(watchDisplayName({ name: ' Mystery-1234 ' })).toBe('Mystery-1234');
  });
  test('the native model is used, an alias wins', () => {
    expect(watchDisplayName({ name: 'x', model: 'Honor Band 9' })).toBe('Honor Band 9');
    expect(watchDisplayName({ name: 'Seiya-B29F', alias: ' Lari ' })).toBe('Lari');
  });
});

describe('watchListName', () => {
  test('adds the unit suffix to a model name', () => {
    expect(watchListName({ name: 'Seiya-B29F' })).toBe('Huawei Watch Fit 4 Pro · B29F');
  });
  test('leaves aliases and unknown names alone', () => {
    expect(watchListName({ name: 'Seiya-B29F', alias: 'Lari' })).toBe('Lari');
    expect(watchListName({ name: 'Mystery-1234' })).toBe('Mystery-1234');
  });
});

describe('withoutBrand', () => {
  test('drops a leading Huawei or Honor in any case', () => {
    expect(withoutBrand('Huawei Watch Fit 4 Pro')).toBe('Watch Fit 4 Pro');
    expect(withoutBrand('HUAWEI WATCH FIT 4 Pro-B29F')).toBe('WATCH FIT 4 Pro-B29F');
    expect(withoutBrand('Honor Band 9')).toBe('Band 9');
    expect(withoutBrand('HONOR Scale 2')).toBe('Scale 2');
    expect(withoutBrand('Honor MagicWatch 2')).toBe('MagicWatch 2');
  });

  test('drops the combined Huawei/Honor prefix', () => {
    expect(withoutBrand('Huawei/Honor WSP Scale')).toBe('WSP Scale');
  });

  test('leaves names without a brand, longer words and brand-only names alone', () => {
    expect(withoutBrand('Band 9-1A2B')).toBe('Band 9-1A2B');
    expect(withoutBrand('Honorable Watch')).toBe('Honorable Watch');
    expect(withoutBrand('Huaweii Watch')).toBe('Huaweii Watch');
    expect(withoutBrand('Huawei')).toBe('Huawei');
    expect(withoutBrand('')).toBe('');
  });

  test('only the leading word goes', () => {
    expect(withoutBrand('My Huawei Watch')).toBe('My Huawei Watch');
  });
});
