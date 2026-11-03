import { describe, expect, it } from 'bun:test';

import { TEMPLATES } from '../catalog';
import type { JsonObject } from '../subject';
import {
  applyCustomMetrics,
  getAvailableHeroMetrics,
  getAvailableSecondaryMetrics,
  getDefaultConfig,
  getDefaultHeroId,
  getDefaultSecondaryMetrics,
  getHeroField,
  getTemplateSecondarySlotCount,
  MAX_CUSTOM_METRICS,
  templateSupportsCustomMetrics,
} from './customMetrics';

describe('customMetrics', () => {
  const sampleRun: JsonObject = {
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

  describe('getDefaultHeroId and getHeroField', () => {
    it('identifies distance as default hero for distance sports', () => {
      expect(getDefaultHeroId(sampleRun, 'run')).toBe('distance');
      expect(getDefaultHeroId(sampleRun, 'ride')).toBe('distance');
      expect(getDefaultHeroId(sampleRun, 'swim')).toBe('distance');
      expect(getHeroField(sampleRun, 'run')).toBe('distanceM');
    });

    it('falls back to steps or time for walk when distance is absent', () => {
      expect(getDefaultHeroId({ steps: 4000, movingSec: 1200 }, 'walk')).toBe('steps');
      expect(getDefaultHeroId({ movingSec: 1200 }, 'walk')).toBe('time');
    });

    it('identifies volume for gym, falling back to time', () => {
      expect(getDefaultHeroId({ volumeKg: 3500, movingSec: 1800 }, 'gym')).toBe('volume');
      expect(getDefaultHeroId({ movingSec: 1800 }, 'gym')).toBe('time');
    });

    it('identifies jumps for cardio, falling back to time', () => {
      expect(getDefaultHeroId({ jumps: 800, movingSec: 900 }, 'cardio')).toBe('jumps');
      expect(getDefaultHeroId({ movingSec: 900 }, 'cardio')).toBe('time');
    });

    it('identifies time for flow and court', () => {
      expect(getDefaultHeroId({ movingSec: 2400 }, 'flow')).toBe('time');
      expect(getDefaultHeroId({ movingSec: 3600 }, 'court')).toBe('time');
    });
  });

  describe('getAvailableHeroMetrics', () => {
    it('allows any recorded metric to be Hero (hero metric liberation)', () => {
      const heroes = getAvailableHeroMetrics(sampleRun, 'run');
      const ids = heroes.map((m) => m.id);

      expect(ids).toContain('distance');
      expect(ids).toContain('pace');
      expect(ids).toContain('hr');
      expect(ids).toContain('power');
      expect(ids).toContain('cadence');
      expect(ids).toContain('elevation');
      expect(ids).toContain('time');

      expect(ids).not.toContain('swolf');
      expect(ids).not.toContain('volume');
      expect(ids).not.toContain('jumps');
    });

    it('handles empty or zero-value run safely', () => {
      expect(getAvailableHeroMetrics({}, 'run')).toEqual([]);
      expect(getAvailableHeroMetrics({ movingSec: 0, distanceM: -5, hrAvg: 0 }, 'run')).toEqual([]);
    });
  });

  describe('getAvailableSecondaryMetrics', () => {
    it('omits the active heroId from candidates', () => {
      const secondaries = getAvailableSecondaryMetrics(sampleRun, 'run', 'distance');
      const ids = secondaries.map((m) => m.id);
      expect(ids).not.toContain('distance');
      expect(ids).toContain('pace');
      expect(ids).toContain('hr');

      const paceAsHeroSecondaries = getAvailableSecondaryMetrics(sampleRun, 'run', 'pace');
      const paceIds = paceAsHeroSecondaries.map((m) => m.id);
      expect(paceIds).not.toContain('pace');
      expect(paceIds).toContain('distance');
    });
  });

  describe('getDefaultConfig & getDefaultSecondaryMetrics', () => {
    it('picks top 4 defaults excluding active heroId', () => {
      const config = getDefaultConfig(sampleRun, 'run');
      expect(config.heroId).toBe('distance');
      expect(config.secondaryIds).toEqual(['time', 'pace', 'hr', 'kcal']);
      expect(config.secondaryIds.length).toBeLessThanOrEqual(MAX_CUSTOM_METRICS);
    });

    it('adapts when high-priority metrics are absent', () => {
      const noHrRun = { ...sampleRun, hrAvg: undefined, hrMax: undefined };
      const config = getDefaultConfig(noHrRun, 'run');
      expect(config.secondaryIds).toEqual(['time', 'pace', 'kcal', 'elevation']);
    });

    it('respects sport category defaults (ride, swim, gym, flow)', () => {
      const rideRun: JsonObject = { distanceM: 25000, movingSec: 3600, speedKmh: 25.4, elevGainM: 150, cadence: 85, hrAvg: 140 };
      expect(getDefaultSecondaryMetrics(rideRun, 'ride', 'distance')).toEqual(['time', 'speed', 'elevation', 'cadence']);

      const swimRun: JsonObject = { distanceM: 1500, movingSec: 2100, pace100Sec: 140, laps: 30, swolf: 38, hrAvg: 135 };
      expect(getDefaultSecondaryMetrics(swimRun, 'swim', 'distance')).toEqual(['time', 'pace', 'laps', 'swolf']);

      const gymRun: JsonObject = { volumeKg: 3500, movingSec: 3000, sets: 18, reps: 150, kcal: 280, hrAvg: 125 };
      expect(getDefaultSecondaryMetrics(gymRun, 'gym', 'volume')).toEqual(['time', 'sets', 'reps', 'kcal']);

      const flowRun: JsonObject = { movingSec: 2400, kcal: 120, hrAvg: 95 };
      expect(getDefaultSecondaryMetrics(flowRun, 'flow', 'time')).toEqual(['kcal', 'hr']);
    });
    it('respects optional maxSlots parameter', () => {
      const top2 = getDefaultSecondaryMetrics(sampleRun, 'run', 'distance', 2);
      expect(top2).toEqual(['time', 'pace']);

      const config2 = getDefaultConfig(sampleRun, 'run', 2);
      expect(config2.secondaryIds).toEqual(['time', 'pace']);

      const config3 = getDefaultConfig(sampleRun, 'run', 3);
      expect(config3.secondaryIds).toEqual(['time', 'pace', 'hr']);
    });
  });

  describe('applyCustomMetrics - Hero metric flexibility', () => {
    it('sets pace as hero correctly', () => {
      const data = { run: sampleRun };
      const customized = applyCustomMetrics(data, {
        heroId: 'pace',
        secondaryIds: ['distance', 'time', 'hr'],
      }, { locale: 'en' });
      const run = customized.run as JsonObject;

      expect(run._custom).toBe(true);
      expect(run.heroVal).toBe('5:43');
      expect(run.heroUnit).toBe('/km');
      expect(run.heroLabel).toBe('Pace');
    });

    it('sets heart rate as hero correctly', () => {
      const data = { run: sampleRun };
      const customized = applyCustomMetrics(data, {
        heroId: 'hr',
        secondaryIds: ['distance', 'time', 'pace'],
      }, { locale: 'en' });
      const run = customized.run as JsonObject;

      expect(run._custom).toBe(true);
      expect(run.heroVal).toBe('155');
      expect(run.heroUnit).toBe('bpm');
      expect(run.heroLabel).toBe('Avg heart rate');
    });

    it('sets power as hero correctly', () => {
      const data = { run: sampleRun };
      const customized = applyCustomMetrics(data, {
        heroId: 'power',
        secondaryIds: ['distance', 'cadence'],
      }, { locale: 'en' });
      const run = customized.run as JsonObject;

      expect(run._custom).toBe(true);
      expect(run.heroVal).toBe('240');
      expect(run.heroUnit).toBe('W');
      expect(run.heroLabel).toBe('Power');
    });
  });

  describe('applyCustomMetrics - Slot ordering & swaps', () => {
    it('maintains explicit order of secondary slots', () => {
      const data = { run: sampleRun };
      const customized = applyCustomMetrics(data, {
        heroId: 'distance',
        secondaryIds: ['hr', 'cadence', 'kcal', 'time'],
      }, { locale: 'en' });
      const run = customized.run as JsonObject;

      expect(run.slot1Val).toBe('155');
      expect(run.slot1Unit).toBe('bpm');
      expect(run.slot1Label).toBe('Avg heart rate');

      expect(run.slot2Val).toBe('174');
      expect(run.slot2Unit).toBe('spm');
      expect(run.slot2Label).toBe('Cadence');

      expect(run.slot3Val).toBe('410');
      expect(run.slot3Unit).toBe('kcal');
      expect(run.slot3Label).toBe('Calories');

      expect(run.slot4Val).toBe('30:00');
      expect(run.slot4Unit).toBeUndefined();
      expect(run.slot4Label).toBe('Time');
    });

    it('reflects slot reordering/swaps immediately', () => {
      const data = { run: sampleRun };
      const swapped = applyCustomMetrics(data, {
        heroId: 'distance',
        secondaryIds: ['cadence', 'hr', 'kcal', 'time'],
      }, { locale: 'en' });
      const run = swapped.run as JsonObject;

      expect(run.slot1Val).toBe('174');
      expect(run.slot1Label).toBe('Cadence');
      expect(run.slot2Val).toBe('155');
      expect(run.slot2Label).toBe('Avg heart rate');
    });
  });

  describe('applyCustomMetrics - Boundary checks (min 1, max 4)', () => {
    it('handles minimum 1 secondary metric', () => {
      const data = { run: sampleRun };
      const customized = applyCustomMetrics(data, {
        heroId: 'distance',
        secondaryIds: ['time'],
      }, { locale: 'en' });
      const run = customized.run as JsonObject;

      expect(run.slot1Val).toBe('30:00');
      expect(run.slot2Val).toBeUndefined();
      expect(run.slot3Val).toBeUndefined();
      expect(run.slot4Val).toBeUndefined();
    });

    it('caps slots at MAX_CUSTOM_METRICS (4)', () => {
      const data = { run: sampleRun };
      const customized = applyCustomMetrics(data, {
        heroId: 'distance',
        secondaryIds: ['time', 'pace', 'hr', 'kcal', 'cadence', 'steps'],
      }, { locale: 'en' });
      const run = customized.run as JsonObject;

      expect(run.slot1Val).toBe('30:00');
      expect(run.slot2Val).toBe('5:43');
      expect(run.slot3Val).toBe('155');
      expect(run.slot4Val).toBe('410');
      expect((run as Record<string, unknown>).slot5Val).toBeUndefined();
    });
  });

  describe('applyCustomMetrics - Invariants & preservation', () => {
    it('preserves non-metric structural and raw data properties', () => {
      const data = { run: sampleRun };
      const customized = applyCustomMetrics(data, {
        heroId: 'distance',
        secondaryIds: ['time', 'hr'],
      });
      const run = customized.run as JsonObject;

      expect(run.sport).toBe('Lari');
      expect(run.category).toBe('run');
      expect(run.startedAt).toBe(1729814400000);
      expect(run.route).toEqual([[-6.2, 106.8]]);
      expect(run.hrSeries).toEqual([140, 150, 160]);
    });

    it('safely handles uncustomized workouts without modifying or injecting _custom', () => {
      expect(sampleRun._custom).toBeUndefined();
      expect(sampleRun.heroVal).toBeUndefined();
    });

    it('returns data safely when data.run is absent', () => {
      const data: JsonObject = { sleep: { score: 85 } };
      expect(applyCustomMetrics(data, { heroId: 'time', secondaryIds: [] })).toEqual(data);
    });

    it('supports backward-compatible array input', () => {
      const data = { run: sampleRun };
      const customized = applyCustomMetrics(data, ['pace', 'hr'], { locale: 'en' });
      const run = customized.run as JsonObject;

      expect(run._custom).toBe(true);
      expect(run.heroVal).toBe('5.24');
      expect(run.slot1Val).toBe('5:43');
      expect(run.slot2Val).toBe('155');
    });
    it('constrains slots when maxSlots or template option is provided', () => {
      const data = { run: sampleRun };
      const customizedWithMax = applyCustomMetrics(
        data,
        { heroId: 'distance', secondaryIds: ['time', 'pace', 'hr', 'kcal'] },
        { maxSlots: 2 },
      );
      const runWithMax = customizedWithMax.run as JsonObject;
      expect(runWithMax.slot1Val).toBe('30:00');
      expect(runWithMax.slot2Val).toBe('5:43');
      expect(runWithMax.slot3Val).toBeUndefined();
      expect(runWithMax.slot4Val).toBeUndefined();

      const tapeStory = TEMPLATES.find((t) => t.id === 'run.tape.story')!;
      const customizedWithTemplate = applyCustomMetrics(
        data,
        { heroId: 'distance', secondaryIds: ['time', 'pace', 'hr', 'kcal'] },
        { template: tapeStory },
      );
      const runWithTemplate = customizedWithTemplate.run as JsonObject;
      expect(runWithTemplate.slot1Val).toBe('30:00');
      expect(runWithTemplate.slot2Val).toBe('5:43');
      expect(runWithTemplate.slot3Val).toBeUndefined();
      expect(runWithTemplate.slot4Val).toBeUndefined();
    });
  });

  describe('templateSupportsCustomMetrics', () => {
    it('returns false for null or undefined template', () => {
      expect(templateSupportsCustomMetrics(null)).toBe(false);
      expect(templateSupportsCustomMetrics(undefined)).toBe(false);
    });

    it('correctly identifies custom-metric supporting templates', () => {
      const runBold = TEMPLATES.find((t) => t.id === 'run.bold.story');
      const walkStats = TEMPLATES.find((t) => t.id === 'walk.stats.sticker');
      const runPhoto = TEMPLATES.find((t) => t.id === 'run.photo.story');
      const runClassicStory = TEMPLATES.find((t) => t.id === 'run.classic.story');
      const runClassicSquare = TEMPLATES.find((t) => t.id === 'run.classic.square');

      expect(templateSupportsCustomMetrics(runBold)).toBe(true);
      expect(templateSupportsCustomMetrics(walkStats)).toBe(true);
      expect(templateSupportsCustomMetrics(runPhoto)).toBe(true);
      expect(templateSupportsCustomMetrics(runClassicStory)).toBe(true);
      expect(templateSupportsCustomMetrics(runClassicSquare)).toBe(true);
      expect(templateSupportsCustomMetrics('run.classic.story')).toBe(true);
      expect(templateSupportsCustomMetrics('run.classic.square')).toBe(true);

      for (const name of ['tape', 'column', 'track', 'lanes', 'swoosh']) {
        const story = TEMPLATES.find((t) => t.id === `run.${name}.story`);
        const square = TEMPLATES.find((t) => t.id === `run.${name}.square`);
        expect(templateSupportsCustomMetrics(story)).toBe(true);
        expect(templateSupportsCustomMetrics(square)).toBe(true);
        expect(templateSupportsCustomMetrics(`run.${name}.story`)).toBe(true);
        expect(templateSupportsCustomMetrics(`run.${name}.square`)).toBe(true);
      }
    });

    it('returns false for unknown string template IDs', () => {
      expect(templateSupportsCustomMetrics('non.existent.template')).toBe(false);
    });
    it('returns false for fixed/static sticker templates like run.stats.sticker', () => {
      const runStats = TEMPLATES.find((t) => t.id === 'run.stats.sticker');
      const runRoute = TEMPLATES.find((t) => t.id === 'run.route.sticker');
      const runReceipt = TEMPLATES.find((t) => t.id === 'run.receipt.sticker');
      const badgePr = TEMPLATES.find((t) => t.id === 'badge.pr.sticker');

      expect(templateSupportsCustomMetrics(runStats)).toBe(false);
      expect(templateSupportsCustomMetrics(runRoute)).toBe(false);
      expect(templateSupportsCustomMetrics(runReceipt)).toBe(false);
      expect(templateSupportsCustomMetrics(badgePr)).toBe(false);
    });
  });

  describe('getTemplateSecondarySlotCount', () => {
    it('returns 0 for null, undefined, or unknown IDs', () => {
      expect(getTemplateSecondarySlotCount(null)).toBe(0);
      expect(getTemplateSecondarySlotCount(undefined)).toBe(0);
      expect(getTemplateSecondarySlotCount('non.existent.template')).toBe(0);
    });

    it('returns 0 for non-custom / static templates', () => {
      expect(getTemplateSecondarySlotCount('run.stats.sticker')).toBe(0);
      expect(getTemplateSecondarySlotCount('run.route.sticker')).toBe(0);
      expect(getTemplateSecondarySlotCount('run.receipt.sticker')).toBe(0);
      expect(getTemplateSecondarySlotCount('badge.pr.sticker')).toBe(0);
    });

    it('returns 2 for overlay sticker templates with exactly 2 secondary slots', () => {
      for (const name of ['tape', 'track', 'lanes', 'swoosh']) {
        const storyId = `run.${name}.story`;
        const squareId = `run.${name}.square`;
        expect(getTemplateSecondarySlotCount(storyId)).toBe(2);
        expect(getTemplateSecondarySlotCount(squareId)).toBe(2);
        const storyTpl = TEMPLATES.find((t) => t.id === storyId);
        const squareTpl = TEMPLATES.find((t) => t.id === squareId);
        expect(getTemplateSecondarySlotCount(storyTpl)).toBe(2);
        expect(getTemplateSecondarySlotCount(squareTpl)).toBe(2);
      }
    });

    it('returns 4 for full card and sport templates with 4 secondary slots', () => {
      for (const id of [
        'run.column.story',
        'run.column.square',
        'run.bold.story',
        'run.bold.square',
        'run.poster.story',
        'run.poster.square',
        'run.minimal.story',
        'run.minimal.square',
        'run.photo.story',
        'run.glass.square',
        'run.classic.story',
        'run.classic.square',
        'walk.stats.sticker',
        'ride.stats.sticker',
      ]) {
        expect(getTemplateSecondarySlotCount(id)).toBe(4);
        const tpl = TEMPLATES.find((t) => t.id === id);
        expect(getTemplateSecondarySlotCount(tpl)).toBe(4);
      }
    });
  });
});
