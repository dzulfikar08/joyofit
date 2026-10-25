import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import type { StrengthExercise, StrengthSet } from '@/features/strength/types';
import { applyLocale } from '@/i18n';

import { TEMPLATES } from '../catalog';
import type { SceneNode } from '../core/scene';
import { offerGroups } from '../offer';
import { FIXTURE_PHOTOS } from '../testing/fixtures';
import { renderTemplate } from '../testing/render';
import { sportWorkout } from '../testing/sportWorkouts';
import type { JsonObject } from '../subject';
import { buildRunSubject } from './run';
import { DEFAULT_GROUP, METRIC_FIELDS, SPORT_METRICS } from './sportMetrics';

beforeAll(() => applyLocale('id'));
afterAll(() => applyLocale('id'));

function subjectOf(key: string, strength?: StrengthExercise[]) {
  const { input } = sportWorkout(key);
  const subject = buildRunSubject({ ...input, strength: strength ? { exercises: strength } : undefined }, 'id');
  return { subject, run: subject.data.run as JsonObject };
}

function texts(nodes: readonly SceneNode[]): string[] {
  return nodes.flatMap((n) => (n.k === 'text' ? [n.text] : n.k === 'group' ? texts(n.children) : []));
}

/** Every text of every template the sheet offers the workout, in both canvases, as the person would see them. */
function everyCardText(key: string): string[] {
  const { subject } = subjectOf(key);
  const out: string[] = [];
  for (const group of offerGroups(subject)) {
    for (const template of Object.values(group.variants)) {
      if (!template) continue;
      const assets = template.meta?.needsPhoto ? { photo: FIXTURE_PHOTOS.dusk } : undefined;
      const { scene, issues } = renderTemplate(template, subject.data, { locale: 'id', mode: 'dark', date: subject.date, assets });
      expect({ id: template.id, issues }).toEqual({ id: template.id, issues: [] });
      out.push(...texts(scene.nodes));
    }
  }
  return out;
}

const set = (i: number, weightKg: number | null, reps: number, type: StrengthSet['type'] = 'normal'): StrengthSet => ({
  id: `s${i}`,
  type,
  weightKg,
  reps,
  seconds: null,
  rpe: null,
  done: true,
  doneAt: null,
});
const exercise = (id: string, sets: StrengthSet[]): StrengthExercise => ({ key: id, exerciseId: id, note: '', restSec: null, supersetGroup: null, sets });

describe('sport families: the numbers each family keeps', () => {
  test('a watch strength session loses the step distance, the speed, the cadence and the steps', () => {
    const { subject, run } = subjectOf('gym.watch');
    expect(run.category).toBe('gym');
    for (const key of ['distanceM', 'speedKmh', 'paceSecKm', 'cadence', 'steps', 'route']) expect(run[key]).toBeUndefined();
    expect(run).toMatchObject({ movingSec: 3120, hrAvg: 118, hrMax: 158, kcal: 318, effortLabel: 'Sedang' });
    expect(run.hrZonePct).toBeArray();
    expect(subject.kinds).toEqual(['gym', 'run']);
    expect(subject.defaultGroup).toBe('gym.bold');
  });

  test('a strength log merged with the watch session brings its working sets, reps and volume', () => {
    const log = [exercise('bench', [set(1, 40, 10, 'warmup'), set(2, 80, 5), set(3, 80, 5)]), exercise('row', [set(4, 60, 8)])];
    const { run } = subjectOf('gym.watch', log);
    expect(run).toMatchObject({ volumeKg: 80 * 5 * 2 + 60 * 8, sets: 3, reps: 18, exercises: 2 });
    // The same log on a run is not a run number.
    const onRun = buildRunSubject({ ...sportWorkout('run.road').input, strength: { exercises: log } }, 'id').data.run as JsonObject;
    expect(onRun.volumeKg).toBeUndefined();
  });

  test('a pool swim carries laps, strokes, SWOLF and pool length, its pace per 100 m, and no steps', () => {
    const { subject, run } = subjectOf('swim.pool');
    expect(run).toMatchObject({ category: 'swim', distanceM: 1500, pace100Sec: 164, laps: 60, strokes: 1020, swolf: 38, strokeRate: 26, poolM: 25 });
    expect(run.paceSecKm).toBeUndefined();
    expect(run.steps).toBeUndefined();
    expect(subject.kinds).toEqual(['swim', 'run']);
  });

  test('a ride keeps speed, climb, cadence and power, never a pace', () => {
    const { run } = subjectOf('ride.outdoor');
    expect(run).toMatchObject({ category: 'ride', speedKmh: 25.8, elevGainM: 412, cadence: 84, power: 168 });
    expect(run.route).toBeArray();
    expect(run.paceSecKm).toBeUndefined();
  });

  test('HIIT and yoga keep time, heart rate and calories only', () => {
    for (const key of ['cardio.hiit', 'flow.yoga']) {
      const { run } = subjectOf(key);
      for (const field of ['distanceM', 'speedKmh', 'paceSecKm', 'cadence', 'steps', 'elevGainM']) expect({ key, field, value: run[field] }).toEqual({ key, field, value: undefined });
      expect(run.movingSec).toBeNumber();
      expect(run.hrAvg).toBeNumber();
      expect(run.kcal).toBeNumber();
    }
  });

  test('a jump rope session counts the watch steps as jumps', () => {
    const { run } = subjectOf('cardio.rope');
    expect(run.jumps).toBe(1420);
    expect(run.steps).toBeUndefined();
  });

  test('a court sport keeps the distance covered and the steps, but no speed', () => {
    const { run } = subjectOf('court.badminton');
    expect(run).toMatchObject({ category: 'court', distanceM: 3120, steps: 5240 });
    expect(run.speedKmh).toBeUndefined();
  });

  test('a hike keeps pace, climb, steps and route; a run keeps everything and opens on the running card', () => {
    expect(subjectOf('walk.hike').run).toMatchObject({ category: 'walk', paceSecKm: 1173, elevGainM: 642, steps: 14_210 });
    const { subject, run } = subjectOf('run.road');
    expect(run).toMatchObject({ category: 'run', distanceM: 5240, paceSecKm: 380, cadence: 172, steps: 5720, elevGainM: 38 });
    expect(subject.kinds).toEqual(['run']);
    expect(subject.defaultGroup).toBe('run.bold');
  });

  test('a sport outside every family keeps distance and steps but drops the speed', () => {
    const { subject, run } = subjectOf('other.golf');
    expect(run).toMatchObject({ category: 'other', distanceM: 6400, steps: 11_200 });
    expect(run.speedKmh).toBeUndefined();
    expect(subject.kinds).toEqual(['run']);
  });

  test('every field the table drops is absent, every field it keeps survives', () => {
    for (const [category, metrics] of Object.entries(SPORT_METRICS)) {
      const dropped = Object.entries(METRIC_FIELDS).filter(([m]) => !(metrics as readonly string[]).includes(m)).flatMap(([, fields]) => fields);
      const key = { run: 'run.road', walk: 'walk.hike', ride: 'ride.outdoor', swim: 'swim.pool', gym: 'gym.watch', cardio: 'cardio.hiit', flow: 'flow.yoga', court: 'court.badminton', other: 'other.golf' }[category]!;
      const { run } = subjectOf(key);
      for (const field of dropped) expect({ category, field, value: run[field] }).toEqual({ category, field, value: undefined });
    }
  });
});

describe('sport families: what the share sheet offers', () => {
  test('the sheet opens on a card of the family, offered first, and the running cards stay selectable', () => {
    for (const key of ['gym.watch', 'swim.pool', 'ride.outdoor', 'cardio.hiit', 'flow.yoga', 'court.badminton', 'walk.hike']) {
      const { subject } = subjectOf(key);
      const groups = offerGroups(subject);
      const family = subject.kinds[0];
      expect({ key, first: groups[0]?.key }).toEqual({ key, first: subject.defaultGroup });
      expect(subject.defaultGroup).toBe(DEFAULT_GROUP[(subject.data.run as JsonObject).category as keyof typeof DEFAULT_GROUP]);
      expect(groups.some((g) => g.kind === family)).toBe(true);
      expect(groups.some((g) => g.key === 'run.bold')).toBe(true);
    }
  });

  test('every family has a story, a square and a transparent sticker', () => {
    for (const family of ['walk', 'ride', 'swim', 'gym', 'cardio', 'flow', 'court']) {
      const aspects = new Set(TEMPLATES.filter((t) => t.kind === family).map((t) => t.canvas.aspect));
      expect({ family, aspects: [...aspects].sort() }).toEqual({ family, aspects: ['free', 'square', 'story'] });
    }
  });

  test('no card, the running ones included, shows a pace, a speed or a distance on a gym, HIIT or yoga session', () => {
    for (const key of ['gym.watch', 'cardio.hiit', 'cardio.rope', 'flow.yoga']) {
      const shown = everyCardText(key);
      for (const unit of ['km', '/km', 'km/j', '/100 m', 'spm', 'rpm']) expect({ key, unit, shown: shown.includes(unit) }).toEqual({ key, unit, shown: false });
    }
  });

  test('no card shows a pace or a speed on a court sport or golf; a ride reads its cadence in rpm', () => {
    for (const key of ['court.badminton', 'other.golf']) {
      const shown = everyCardText(key);
      for (const unit of ['/km', 'km/j', '/100 m']) expect({ key, unit, shown: shown.includes(unit) }).toEqual({ key, unit, shown: false });
    }
    const ride = everyCardText('ride.outdoor');
    expect(ride).toContain('rpm');
    expect(ride).not.toContain('spm');
    expect(ride).not.toContain('/km');
  });

  test('the swim cards read laps and SWOLF, the receipt thanks the swimmer', () => {
    const shown = everyCardText('swim.pool');
    expect(shown).toContain('SWOLF');
    expect(shown).toContain('60');
    expect(shown).not.toContain('MAKASIH SUDAH LARI');
    expect(shown).toContain('MAKASIH SUDAH BERENANG');
  });
});
