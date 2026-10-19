import { describe, expect, test } from 'bun:test';

import { DEFAULT_PREFS, parseHome, parsePrefs, serializeHome } from './prefs';

describe('home point', () => {
  test('is stored to about a metre and read back', () => {
    const raw = serializeHome({ lat: -6.208812345, lon: 106.845612345 });
    expect(raw).toBe('{"lat":-6.20881,"lon":106.84561}');
    expect(parseHome(raw)).toEqual({ lat: -6.20881, lon: 106.84561 });
  });

  test('damaged, missing and impossible values are no home', () => {
    for (const raw of [null, '', 'nope', '[]', '{}', '{"lat":"1","lon":2}', '{"lat":0,"lon":0}', '{"lat":95,"lon":10}', '{"lat":1,"lon":181}']) {
      expect(parseHome(raw)).toBeNull();
    }
  });
});

describe('choices', () => {
  test('are read back', () => {
    const raw = JSON.stringify({ activity: 'run', mode: 'kcal', value: 400, startFrom: 'home' });
    expect(parsePrefs(raw)).toEqual({ activity: 'run', mode: 'kcal', value: 400, startFrom: 'home' });
  });

  test('every field that is not valid falls back by itself', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('{{')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs(JSON.stringify({ activity: 'swim', mode: 'furlongs', value: -3, startFrom: 'moon' }))).toEqual(DEFAULT_PREFS);
    expect(parsePrefs(JSON.stringify({ mode: 'time', value: 45 }))).toEqual({ ...DEFAULT_PREFS, mode: 'time', value: 45 });
  });
});
