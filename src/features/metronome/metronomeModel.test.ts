import { describe, expect, test } from 'bun:test';

import {
  beatIntervalMs,
  BPM_KEY,
  clampBpm,
  clicks,
  DEFAULT_BPM,
  DEFAULT_MODE,
  MAX_BPM,
  MIN_BPM,
  MODE_KEY,
  nextBeatAt,
  parseMode,
  readSettings,
  saveSetting,
  type SettingsStore,
  stepBpm,
  vibrates,
  wantsClickSound,
} from './metronomeModel';

function memoryStore(initial: Record<string, string> = {}): SettingsStore & { kv: Map<string, string> } {
  const kv = new Map(Object.entries(initial));
  return {
    kv,
    getItemSync: (key) => kv.get(key) ?? null,
    setItemSync: (key, value) => void kv.set(key, value),
  };
}

const brokenStore: SettingsStore = {
  getItemSync: () => {
    throw new Error('database closed');
  },
  setItemSync: () => {
    throw new Error('database closed');
  },
};

describe('clampBpm', () => {
  test('keeps the range and rounds', () => {
    expect(clampBpm(100)).toBe(MIN_BPM);
    expect(clampBpm(260)).toBe(MAX_BPM);
    expect(clampBpm(171.6)).toBe(172);
  });
  test('anything else is the default', () => {
    expect(clampBpm(Number.NaN)).toBe(DEFAULT_BPM);
    expect(clampBpm('180')).toBe(DEFAULT_BPM);
  });
});

describe('stepBpm', () => {
  test('moves by 5 and stops at the ends', () => {
    expect(stepBpm(170, 1)).toBe(175);
    expect(stepBpm(170, -1)).toBe(165);
    expect(stepBpm(MAX_BPM, 1)).toBe(MAX_BPM);
    expect(stepBpm(MIN_BPM, -1)).toBe(MIN_BPM);
  });
});

describe('beat timing', () => {
  test('interval of 180 bpm is a third of a second', () => {
    expect(beatIntervalMs(180)).toBeCloseTo(333.33, 1);
  });
  test('stays on the grid when a timer fires late', () => {
    expect(nextBeatAt(1000, 1040, 333)).toBe(1333);
  });
  test('restarts from now after a long suspension', () => {
    expect(nextBeatAt(1000, 9000, 333)).toBe(9333);
  });
});

describe('mode', () => {
  test('vibration stays the default, so nothing changes for anyone who never picks a mode', () => {
    expect(DEFAULT_MODE).toBe('vibration');
    expect(parseMode(null)).toBe('vibration');
    expect(parseMode('beep')).toBe('vibration');
    expect(parseMode('sound')).toBe('sound');
    expect(parseMode('both')).toBe('both');
  });
  test('what each mode does on a beat', () => {
    expect([vibrates('vibration'), clicks('vibration')]).toEqual([true, false]);
    expect([vibrates('sound'), clicks('sound')]).toEqual([false, true]);
    expect([vibrates('both'), clicks('both')]).toEqual([true, true]);
  });
  test('the click sound is loaded only while the metronome runs in a mode with a click', () => {
    expect(wantsClickSound({ enabled: true, mode: 'sound' })).toBe(true);
    expect(wantsClickSound({ enabled: true, mode: 'both' })).toBe(true);
    expect(wantsClickSound({ enabled: true, mode: 'vibration' })).toBe(false);
    expect(wantsClickSound({ enabled: false, mode: 'sound' })).toBe(false);
  });
});

describe('kept settings', () => {
  test('an empty store gives the defaults', () => {
    expect(readSettings(memoryStore())).toEqual({ bpm: DEFAULT_BPM, mode: DEFAULT_MODE });
  });
  test('a saved tempo and mode come back', () => {
    const store = memoryStore();
    saveSetting(store, BPM_KEY, '180');
    saveSetting(store, MODE_KEY, 'both');
    expect(store.kv.get(MODE_KEY)).toBe('both');
    expect(readSettings(store)).toEqual({ bpm: 180, mode: 'both' });
  });
  test('the tempo stored before the mode existed still reads, with the default mode', () => {
    expect(readSettings(memoryStore({ [BPM_KEY]: '165' }))).toEqual({ bpm: 165, mode: 'vibration' });
  });
  test('damaged values fall back one by one', () => {
    expect(readSettings(memoryStore({ [BPM_KEY]: 'fast', [MODE_KEY]: 'sound' }))).toEqual({ bpm: DEFAULT_BPM, mode: 'sound' });
    expect(readSettings(memoryStore({ [BPM_KEY]: '400', [MODE_KEY]: 'loud' }))).toEqual({ bpm: MAX_BPM, mode: 'vibration' });
  });
  test('a failing store reads as the defaults and a failed save does not throw', () => {
    expect(readSettings(brokenStore)).toEqual({ bpm: DEFAULT_BPM, mode: DEFAULT_MODE });
    expect(() => saveSetting(brokenStore, MODE_KEY, 'sound')).not.toThrow();
  });
});
