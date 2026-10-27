import { afterEach, describe, expect, it } from 'bun:test';

import { applyLocale } from '@/i18n';

import type { PersonalRecord } from '@/features/strength/calc';
import { buildCatalog } from '@/features/strength/catalog';
import { kgToUnit, setWeightUnit } from '@/features/strength/units';
import type { CustomExercise, Muscle, StrengthExercise, StrengthSet, StrengthWorkout } from '@/features/strength/types';
import { buildStrengthSubject } from './strength';

afterEach(() => {
  applyLocale('id');
  setWeightUnit('kg');
});

const custom = (id: string, name: string, primary: Muscle[], timed = false): CustomExercise => ({ id, name, primary, equipment: 'other', timed, updatedAt: 0, deletedAt: null });
const catalog = buildCatalog([]);

const set = (id: string, over: Partial<StrengthSet>): StrengthSet => ({ id, type: 'normal', weightKg: null, reps: null, seconds: null, rpe: null, done: true, doneAt: 1, ...over });
const exercise = (exerciseId: string, sets: StrengthSet[]): StrengthExercise => ({ key: exerciseId, exerciseId, note: '', restSec: null, supersetGroup: null, sets });
const workout = (exercises: StrengthExercise[], over: Partial<StrengthWorkout> = {}): StrengthWorkout => ({
  id: 'w1',
  name: 'Push day',
  startedAt: new Date(2026, 9, 12, 7, 30).getTime(),
  endedAt: new Date(2026, 9, 12, 8, 30).getTime(),
  durationSec: 3600,
  note: '',
  routineId: null,
  planKey: null,
  exercises,
  workoutStart: 1,
  kcal: 250,
  kcalSource: 'estimate',
  updatedAt: 0,
  deletedAt: null,
  ...over,
});

const build = (w: StrengthWorkout, records: PersonalRecord[] = [], cat = catalog, locale: 'id' | 'en' = 'en') =>
  buildStrengthSubject({ workout: w, catalog: cat, records, resolveMuscles: cat.muscles }, locale);
const strengthOf = (s: ReturnType<typeof build>) => s.data.strength as Record<string, any>;

const bench = exercise('barbell_bench_press', [
  set('w', { type: 'warmup', weightKg: 100, reps: 10 }),
  set('a', { weightKg: 60, reps: 8, rpe: 8 }),
  set('b', { weightKg: 70, reps: 5, rpe: 9 }),
]);
const squat = exercise('barbell_back_squat', [set('c', { weightKg: 100, reps: 5 })]);
const pushUps = exercise('push_up', [set('f', { reps: 20 })]);
const plank = exercise('plank', [set('g', { seconds: 45 })]);

describe('buildStrengthSubject', () => {
  it('builds a full workout with PRs', () => {
    const records: PersonalRecord[] = [
      { exerciseId: 'barbell_bench_press', kind: 'weight', setId: 'b', value: 70, previous: 65 },
      { exerciseId: 'barbell_back_squat', kind: 'e1rm', setId: 'c', value: 116, previous: 110 },
    ];
    const s = build(workout([bench, squat]), records);
    const d = strengthOf(s);
    expect(s.id).toBe('strength:w1');
    expect(s.kinds).toEqual(['strength', 'badge']);
    expect(s.date).toBe(workout([]).startedAt);
    expect(s.heading).toBe('Share workout');
    expect(s.caption).toContain('JoyoFit');
    expect(d.name).toBe('Push day');
    expect(d.startedAt).toBe(s.date);
    expect(d.volume).toBe(60 * 8 + 70 * 5 + 500);
    expect(d.unit).toBe('kg');
    expect(d.reps).toBe(18);
    expect(d.sets).toBe(3);
    expect(d.exercises).toBe(2);
    expect(d.durationSec).toBe(3600);
    expect(d.kcal).toBe(250);
    expect(d.avgRpe).toBe(8.5);
    expect(d.topSets).toEqual([
      { exercise: 'Barbell back squat', load: '100 kg x 5' },
      { exercise: 'Barbell bench press', load: '70 kg x 5' },
    ]);
    expect(d.prCount).toBe(2);
    expect(d.prs).toEqual([
      { exercise: 'Barbell bench press', load: '70 kg x 5', kind: 'weight' },
      { exercise: 'Barbell back squat', load: '100 kg x 5', kind: 'e1rm' },
    ]);
    expect(s.data.milestone).toEqual({ kind: 'pr', title: 'Barbell bench press', subtitle: '2 new PRs', value: 70, valueText: '70 kg x 5' });
    expect(d.muscleLabels.length).toBe(d.muscleSets.length);
    expect(d.muscleColors.length).toBe(d.muscleSets.length);
    expect(d.muscleSets).toEqual([...d.muscleSets].sort((a, b) => b - a));
    expect(d.muscleColors.every((c: string) => /^#[0-9a-f]{6}$/.test(c))).toBe(true);
    expect(d.muscleLabels).toContain('Chest');
  });

  it('carries the volume and its unit in lb when the logger is set to lb', () => {
    setWeightUnit('lb');
    const d = strengthOf(build(workout([bench, squat])));
    const kg = 60 * 8 + 70 * 5 + 500;
    expect(d.unit).toBe('lb');
    expect(d.volume).toBeCloseTo(kgToUnit(kg, 'lb'), 1);
    expect(d.topSets[0].load).toContain('lb');
  });

  it('has no prs and only the strength kind without records', () => {
    const s = build(workout([bench]));
    expect(s.kinds).toEqual(['strength']);
    expect(strengthOf(s).prs).toBeUndefined();
    expect(strengthOf(s).prCount).toBeUndefined();
    expect(s.data.milestone).toBeUndefined();
  });

  it('keeps reps as the headline for a bodyweight-only workout', () => {
    const d = strengthOf(build(workout([pushUps], { kcal: null })));
    expect(d.volume).toBeUndefined();
    expect(d.unit).toBeUndefined();
    expect(d.kcal).toBeUndefined();
    expect(d.reps).toBe(20);
    expect(d.sets).toBe(1);
    expect(d.topSets).toEqual([{ exercise: 'Push-up', load: '20 reps' }]);
  });

  it('handles a timed-set-only workout', () => {
    const d = strengthOf(build(workout([plank])));
    expect(d.volume).toBeUndefined();
    expect(d.reps).toBeUndefined();
    expect(d.seconds).toBe(45);
    expect(d.sets).toBe(1);
    expect(d.exercises).toBe(1);
    expect(d.topSets[0].load).toBe('45 s');
  });

  it('still builds a subject when no set was completed', () => {
    const s = build(workout([exercise('barbell_curl', [set('x', { weightKg: 20, reps: 10, done: false })])], { durationSec: 0, kcal: null }));
    const d = strengthOf(s);
    expect(s.kinds).toEqual(['strength']);
    expect(d.name).toBe('Push day');
    for (const key of ['volume', 'unit', 'reps', 'seconds', 'sets', 'exercises', 'durationSec', 'kcal', 'topSets', 'prs', 'muscleLabels', 'muscleSets', 'muscleColors', 'avgRpe']) {
      expect(d[key]).toBeUndefined();
    }
    const empty = strengthOf(build(workout([])));
    expect(empty.topSets).toBeUndefined();
  });

  it('falls back to a name when the workout has none', () => {
    expect(strengthOf(build(workout([bench], { name: '   ' }))).name).toBe('Strength workout');
  });

  it('ignores warm-up sets everywhere', () => {
    const warm = exercise('barbell_bench_press', [set('w', { type: 'warmup', weightKg: 100, reps: 10, rpe: 3 })]);
    const d = strengthOf(build(workout([warm])));
    expect(d.sets).toBeUndefined();
    expect(d.exercises).toBeUndefined();
    expect(d.topSets).toBeUndefined();
    expect(d.muscleLabels).toBeUndefined();
    expect(d.avgRpe).toBeUndefined();
  });

  it('caps muscle groups at 8, most sets first', () => {
    const muscles: Muscle[] = ['chest', 'lats', 'shoulders', 'biceps', 'triceps', 'forearms', 'abs', 'glutes', 'quadriceps', 'hamstrings'];
    const cat = buildCatalog(muscles.map((m, i) => custom(`custom_${i}`, `Move ${i}`, [m])));
    const exercises = muscles.map((_, i) => exercise(`custom_${i}`, Array.from({ length: 10 - i }, (_, k) => set(`s${i}-${k}`, { reps: 5 }))));
    const d = strengthOf(build(workout(exercises), [], cat));
    expect(d.muscleLabels).toHaveLength(8);
    expect(d.muscleSets).toEqual([10, 9, 8, 7, 6, 5, 4, 3]);
    expect(d.muscleLabels[0]).toBe('Chest');
    expect(d.topSets).toHaveLength(5);
  });

  it('passes emoji in custom exercise names through and cuts long names', () => {
    const long = 'A'.repeat(80);
    const cat = buildCatalog([custom('custom_a', 'Leg day 🔥💪', ['quadriceps']), custom('custom_b', long, ['chest'])]);
    const w = workout([exercise('custom_a', [set('a', { weightKg: 50, reps: 5 })]), exercise('custom_b', [set('b', { weightKg: 20, reps: 5 })])], { name: `${long} 🔥` });
    const d = strengthOf(build(w, [], cat));
    expect(d.topSets[0].exercise).toBe('Leg day 🔥💪');
    expect(d.topSets[1].exercise).toBe(`${'A'.repeat(57)}...`);
    expect(d.name.length).toBeLessThanOrEqual(60);
    expect(d.name.endsWith('...')).toBe(true);
  });

  it('survives NaN and Infinity inputs and stays JSON-serializable', () => {
    const w = workout([exercise('barbell_bench_press', [set('a', { weightKg: 60, reps: 8 })])], { durationSec: Infinity, kcal: NaN });
    const s = build(w, [{ exerciseId: 'barbell_bench_press', kind: 'weight', setId: 'a', value: NaN, previous: 1 }]);
    const d = strengthOf(s);
    expect(d.durationSec).toBeUndefined();
    expect(d.kcal).toBeUndefined();
    expect((s.data.milestone as any).value).toBeUndefined();
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    const full = build(workout([bench, squat, pushUps, plank]), [{ exerciseId: 'barbell_bench_press', kind: 'weight', setId: 'b', value: 70, previous: 65 }]);
    expect(JSON.parse(JSON.stringify(full))).toEqual(full);
  });

  it('ignores records whose set is missing', () => {
    const s = build(workout([bench]), [{ exerciseId: 'barbell_bench_press', kind: 'weight', setId: 'nope', value: 70, previous: 65 }]);
    expect(strengthOf(s).prs).toBeUndefined();
    expect(s.kinds).toEqual(['strength']);
  });

  it('speaks Indonesian and English', async () => {
    const records: PersonalRecord[] = [{ exerciseId: 'barbell_bench_press', kind: 'weight', setId: 'b', value: 70, previous: 65 }];
    const id = build(workout([bench]), records, catalog, 'id');
    await applyLocale('en');
    const en = build(workout([bench]), records, catalog, 'en');
    await applyLocale('id');
    expect(strengthOf(id).muscleLabels).toContain('Dada');
    expect(strengthOf(en).muscleLabels).toContain('Chest');
    expect(id.caption).not.toBe(en.caption);
    expect(id.heading).not.toBe(en.heading);
    expect(strengthOf(id).topSets[0].exercise).not.toBe(strengthOf(en).topSets[0].exercise);
  });
});
