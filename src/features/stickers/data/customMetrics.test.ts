import { describe, expect, it } from 'bun:test';

import { TEMPLATES } from '../catalog';
import type { JsonObject } from '../subject';
import {
  applyCustomMetrics,
  getAvailableHeroMetrics,
  getAvailableSecondaryMetrics,
  getDefaultConfig,
  getDefaultHeroId,
  customSlotCount,
} from './customMetrics';

const RUN: JsonObject = {
  sport: 'Lari',
  category: 'run',
  startedAt: 1729814400000,
  distanceM: 5240,
  movingSec: 1800,
  paceSecKm: 343,
  hrAvg: 155,
  hrMax: 178,
  kcal: 410,
  elevGainM: 45,
  cadence: 174,
  power: 240,
  steps: 5120,
  route: [[-6.2, 106.8]],
  hrSeries: [140, 150, 160],
};

const custom = (run: JsonObject, heroId: string, secondaryIds: string[]) =>
  applyCustomMetrics({ run }, { heroId, secondaryIds }, { locale: 'en' }).run as JsonObject;

describe('getDefaultHeroId', () => {
  it('uses the distance for distance sports and falls back to the time without one', () => {
    for (const category of ['run', 'ride', 'swim', 'other'] as const) expect(getDefaultHeroId(RUN, category)).toBe('distance');
    expect(getDefaultHeroId({ movingSec: 1200 }, 'run')).toBe('time');
  });

  it('falls back to steps, then time, for a walk without a distance', () => {
    expect(getDefaultHeroId({ steps: 4000, movingSec: 1200 }, 'walk')).toBe('steps');
    expect(getDefaultHeroId({ movingSec: 1200 }, 'walk')).toBe('time');
  });

  it('uses the logged volume for gym and the jumps for cardio, else the time', () => {
    expect(getDefaultHeroId({ volume: 3500, movingSec: 1800 }, 'gym')).toBe('volume');
    expect(getDefaultHeroId({ movingSec: 1800 }, 'gym')).toBe('time');
    expect(getDefaultHeroId({ jumps: 800, movingSec: 900 }, 'cardio')).toBe('jumps');
    expect(getDefaultHeroId({ movingSec: 900 }, 'cardio')).toBe('time');
    expect(getDefaultHeroId(RUN, 'flow')).toBe('time');
    expect(getDefaultHeroId(RUN, 'court')).toBe('time');
  });
});

describe('available metrics', () => {
  it('offers only the numbers the workout recorded', () => {
    const ids = getAvailableHeroMetrics(RUN).map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(['distance', 'pace', 'hr', 'power', 'cadence', 'elevation', 'time']));
    expect(ids).not.toContain('swolf');
    expect(getAvailableHeroMetrics({ movingSec: 0, distanceM: -5, hrAvg: 0 })).toEqual([]);
  });

  it('never offers a word as the hero, but does as a secondary number', () => {
    const swim: JsonObject = { category: 'swim', distanceM: 1500, movingSec: 2100, swimStyle: 'Freestyle' };
    expect(getAvailableHeroMetrics(swim).map((m) => m.id)).not.toContain('swimStyle');
    expect(getAvailableSecondaryMetrics(swim, 'distance').map((m) => m.id)).toContain('swimStyle');
  });

  it('leaves the hero out of the secondary choices', () => {
    expect(getAvailableSecondaryMetrics(RUN, 'pace').map((m) => m.id)).not.toContain('pace');
  });
});

describe('getDefaultConfig', () => {
  it("takes the sport's first four recorded numbers, skipping the hero and what is missing", () => {
    expect(getDefaultConfig(RUN, 'run')).toEqual({ heroId: 'distance', secondaryIds: ['time', 'pace', 'hr', 'kcal'] });
    expect(getDefaultConfig({ ...RUN, hrAvg: undefined }, 'run').secondaryIds).toEqual(['time', 'pace', 'kcal', 'elevation']);
    const ride: JsonObject = { distanceM: 25000, movingSec: 3600, speedKmh: 25.4, elevGainM: 150, cadence: 85, hrAvg: 140 };
    expect(getDefaultConfig(ride, 'ride').secondaryIds).toEqual(['time', 'speed', 'elevation', 'cadence']);
    const gym: JsonObject = { volume: 3500, unit: 'kg', movingSec: 3000, sets: 18, reps: 150, kcal: 280 };
    expect(getDefaultConfig(gym, 'gym')).toEqual({ heroId: 'volume', secondaryIds: ['time', 'sets', 'reps', 'kcal'] });
    expect(getDefaultConfig({ movingSec: 2400, kcal: 120, hrAvg: 95 }, 'flow').secondaryIds).toEqual(['kcal', 'hr']);
  });
});

describe('applyCustomMetrics', () => {
  it('writes the hero with its unit and label', () => {
    expect(custom(RUN, 'pace', [])).toMatchObject({ _custom: true, heroVal: '5:43', heroUnit: '/km', heroLabel: 'Pace' });
    expect(custom(RUN, 'hr', [])).toMatchObject({ heroVal: '155', heroUnit: 'bpm' });
  });

  it('fills the slots in the picked order', () => {
    const run = custom(RUN, 'distance', ['hr', 'cadence', 'kcal', 'time']);
    expect([run.slot1Val, run.slot2Val, run.slot3Val, run.slot4Val]).toEqual(['155', '174', '410', '30:00']);
    expect(run.slot4Unit).toBeUndefined();
  });

  it('closes up the slots over a number the workout lacks, and over the hero', () => {
    const run = custom(RUN, 'distance', ['swolf', 'distance', 'hr']);
    expect(run.slot1Val).toBe('155');
    expect(run.slot2Val).toBeUndefined();
  });

  it('draws at most four slots', () => {
    const run = custom(RUN, 'distance', ['time', 'pace', 'hr', 'kcal', 'cadence']);
    expect(run.slot4Val).toBe('410');
    expect(run.slot5Val).toBeUndefined();
  });

  it("drops the previous pick's slots when applied again", () => {
    const once = applyCustomMetrics({ run: RUN }, { heroId: 'distance', secondaryIds: ['time', 'pace', 'hr'] });
    const twice = applyCustomMetrics(once, { heroId: 'distance', secondaryIds: ['time'] }).run as JsonObject;
    expect(twice.slot2Val).toBeUndefined();
    expect(twice.slot3Val).toBeUndefined();
  });

  it("labels the volume in the person's weight unit", () => {
    expect(custom({ category: 'gym', volume: 7716, unit: 'lb', movingSec: 3000 }, 'volume', []).heroUnit).toBe('lb');
  });

  it('keeps the rest of the run data, and leaves data without a run alone', () => {
    expect(custom(RUN, 'distance', ['time'])).toMatchObject({ sport: 'Lari', route: [[-6.2, 106.8]], hrSeries: [140, 150, 160] });
    const sleep: JsonObject = { sleep: { score: 85 } };
    expect(applyCustomMetrics(sleep, { heroId: 'time', secondaryIds: [] })).toBe(sleep);
  });
});

describe('customSlotCount', () => {
  const count = (id: string) => customSlotCount(TEMPLATES.find((t) => t.id === id)!);

  it('gives each layout as many picks as it has room for', () => {
    expect(count('run.poster.story')).toBe(4);
    expect(count('run.poster.square')).toBe(3);
    expect(count('run.bold.square')).toBe(3);
    expect(count('run.classic.square')).toBe(4);
    expect(count('run.column.story')).toBe(4);
    expect(count('run.tape.story')).toBe(2);
    expect(count('walk.stats.sticker')).toBe(4);
  });

  it('is 0 for a fixed template, which gets no customizer', () => {
    for (const template of TEMPLATES) {
      const branches = JSON.stringify(template.layers).includes('run._custom');
      expect({ id: template.id, customizable: customSlotCount(template) > 0 }).toEqual({ id: template.id, customizable: branches });
    }
    expect(count('run.stats.sticker')).toBe(0);
  });
});
