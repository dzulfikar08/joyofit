import { describe, expect, test } from 'bun:test';

import type { LoopCandidate } from './generate';
import { advance, currentLoop, poolKey, type Pool } from './pool';

const HOME = { lat: -6.2088, lon: 106.8456 };
const candidate = (id: string): LoopCandidate => ({ id, line: [], lengthM: 7000, newShare: 0.9, repeatShare: 0, lengthError: 0 });

describe('poolKey', () => {
  test('same start (to a metre), length (to 50 m) and activity is the same plan', () => {
    const key = poolKey(HOME, 7000, 'walk');
    expect(poolKey({ lat: HOME.lat + 0.000001, lon: HOME.lon }, 7010, 'walk')).toBe(key);
    expect(poolKey({ lat: HOME.lat + 0.001, lon: HOME.lon }, 7000, 'walk')).not.toBe(key);
    expect(poolKey(HOME, 7100, 'walk')).not.toBe(key);
    expect(poolKey(HOME, 7000, 'run')).not.toBe(key);
  });
});

describe('pool', () => {
  const key = poolKey(HOME, 7000, 'walk');
  const pool: Pool = { key, candidates: [candidate('a'), candidate('b')], at: 0 };

  test('the loop on the map is the one at the pool position, and only for the same plan', () => {
    expect(currentLoop(pool, key)?.id).toBe('a');
    expect(currentLoop(pool, poolKey(HOME, 9000, 'walk'))).toBeNull();
    expect(currentLoop(null, key)).toBeNull();
    expect(currentLoop(pool, null)).toBeNull();
  });

  test('another route walks through the batch, then asks for a new one', () => {
    const second = advance(pool, key);
    expect(second && currentLoop(second, key)?.id).toBe('b');
    expect(advance(second as Pool, key)).toBeNull();
  });

  test('a pool of another plan is never advanced', () => {
    expect(advance(pool, poolKey(HOME, 9000, 'walk'))).toBeNull();
  });
});
