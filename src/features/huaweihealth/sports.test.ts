import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { HEALTH_KIT_SPORTS, OTHER_SPORT, SPORTS, sportOfActivityType } from './sports';

const KOTLIN = join(import.meta.dir, '../../../modules/huawei-wear/android/src/main/java/com/joyodigitama/huaweiwear/WorkoutSportTypes.kt');

describe('Health Kit sports', () => {
  it('uses the kinds and names of WorkoutSportTypes.kt exactly', () => {
    const table = new Map([...readFileSync(KOTLIN, 'utf8').matchAll(/(\d+) to Sport\("([A-Z_]+)", "([^"]+)"\)/g)].map((m) => [Number(m[1]), [m[2], m[3]]]));
    for (const [type, row] of Object.entries(SPORTS)) expect([type, table.get(Number(type))]).toEqual([type, [...row]]);
    for (const type of Object.values(HEALTH_KIT_SPORTS)) expect(SPORTS[type]).toBeDefined();
  });

  it('maps the documented workout types of the main sports', () => {
    expect(sportOfActivityType(56)).toEqual({ type: 1, kind: 'RUNNING', name: 'Running' });
    expect(sportOfActivityType(90).kind).toBe('WALKING');
    expect(sportOfActivityType(13).kind).toBe('CYCLING');
    expect(sportOfActivityType(97).kind).toBe('INDOOR_CYCLING');
    expect(sportOfActivityType(57).kind).toBe('INDOOR_RUNNING');
    expect(sportOfActivityType(130).kind).toBe('TRAIL_RUN');
    expect(sportOfActivityType(83).kind).toBe('POOL_SWIM');
    expect(sportOfActivityType(79).kind).toBe('STRENGTH_TRAINING');
    expect(sportOfActivityType(0).type).toBe(OTHER_SPORT);
    expect(sportOfActivityType(9999).type).toBe(OTHER_SPORT);
    expect(sportOfActivityType(null).type).toBe(OTHER_SPORT);
  });
});
