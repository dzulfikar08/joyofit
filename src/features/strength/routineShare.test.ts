import { describe, expect, it } from 'bun:test';

import { buildCatalog } from './catalog';
import {
  buildRoutineExport,
  exportFileName,
  parseRoutineExport,
  planImport,
  routineText,
  serializeRoutineExport,
  type RoutineExportFile,
} from './routineShare';
import type { CustomExercise, Routine } from './types';

const custom: CustomExercise = { id: 'custom_abc', name: 'Sled Push', primary: ['quadriceps'], equipment: 'other', timed: false, updatedAt: 1, deletedAt: null };
const withCustom = buildCatalog([custom]);
const without = buildCatalog([]);

const routine: Routine = {
  id: 'r1',
  name: 'Push Day',
  folderId: null,
  note: 'Easy week',
  exercises: [
    {
      exerciseId: 'push_up',
      restSec: 90,
      note: 'slow down',
      supersetGroup: 1,
      sets: [
        { type: 'warmup', weightKg: null, reps: 10, seconds: null },
        { type: 'normal', weightKg: 60, reps: 8, seconds: null },
        { type: 'normal', weightKg: 60, reps: 8, seconds: null },
      ],
    },
    { exerciseId: 'custom_abc', restSec: null, note: '', supersetGroup: 1, sets: [{ type: 'normal', weightKg: 62.5, reps: 12, seconds: null }] },
    { exerciseId: 'plank', timed: true, restSec: 45, note: '', supersetGroup: null, sets: [{ type: 'failure', weightKg: null, reps: null, seconds: 60 }] },
  ],
  sortOrder: 3,
  createdAt: 5,
  updatedAt: 5,
  deletedAt: null,
};

const ctx = (catalog = without) => ({ catalog, routines: [{ sortOrder: 4 }], folders: [], now: 1_000_000 });

describe('routineText', () => {
  it('lists exercises, superset letters, rest and the footer', () => {
    const text = routineText(routine, withCustom, 'en', 'kg');
    const lines = text.split('\n');
    expect(lines[0]).toBe('Push Day');
    expect(lines[1]).toBe('Easy week');
    expect(text).toContain('A1. ');
    expect(text).toContain('A2. Sled Push');
    expect(text).toContain('2. Plank');
    expect(text).toContain('1 x 10 (warm-up), 2 x 8 @ 60 kg | rest 90 s');
    expect(text).toContain('1 x 12 @ 62.5 kg');
    expect(text).toContain('1 x 60 s (to failure) | rest 45 s');
    expect(text).toContain('slow down');
    expect(lines[lines.length - 1]).toContain('JoyoFit');
  });

  it('converts to pounds and uses the Indonesian words and decimal comma', () => {
    const text = routineText(routine, withCustom, 'id', 'lb');
    expect(text).toContain('istirahat 90 dtk');
    expect(text).toContain('pemanasan');
    expect(text).toContain('137,8 lb');
  });

  it('names a removed exercise', () => {
    const text = routineText(routine, without, 'en', 'kg');
    expect(text).toContain('Removed exercise');
  });
});

describe('export and import', () => {
  const file = buildRoutineExport([routine], withCustom, 'en', null);

  it('round-trips on the same phone with fresh ids and the same content', () => {
    const parsed = parseRoutineExport(serializeRoutineExport(file));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const plan = planImport(parsed.file, ctx(withCustom));
    expect(plan.newExercises).toEqual([]);
    expect(plan.newFolder).toBeNull();
    const [copy] = plan.routines as [Routine];
    expect(copy.id).not.toBe(routine.id);
    expect(copy.sortOrder).toBe(5);
    const strip = (r: Routine) => ({ name: r.name, note: r.note, exercises: r.exercises });
    expect(strip(copy)).toEqual(strip({ ...routine, exercises: routine.exercises.map((e) => (e.exerciseId === 'plank' ? e : { ...e })) }));
  });

  it('creates a custom exercise for an id the phone lacks, once per id', () => {
    const twice: Routine = { ...routine, exercises: [routine.exercises[1]!, routine.exercises[1]!] };
    const parsed = parseRoutineExport(serializeRoutineExport(buildRoutineExport([twice], withCustom, 'en')));
    if (!parsed.ok) throw new Error('parse');
    const plan = planImport(parsed.file, ctx(without));
    expect(plan.newExercises).toHaveLength(1);
    const made = plan.newExercises[0]!;
    expect(made.id.startsWith('custom_')).toBe(true);
    expect(made.id).not.toBe('custom_abc');
    expect(made.name).toBe('Sled Push');
    expect(made.primary).toEqual(['quadriceps']);
    expect(plan.routines[0]!.exercises.map((e) => e.exerciseId)).toEqual([made.id, made.id]);
  });

  it('reuses a custom exercise of the same name', () => {
    const parsed = parseRoutineExport(serializeRoutineExport(buildRoutineExport([routine], withCustom, 'en')));
    if (!parsed.ok) throw new Error('parse');
    const mine = buildCatalog([{ ...custom, id: 'custom_mine' }]);
    const plan = planImport(parsed.file, ctx(mine));
    expect(plan.newExercises).toEqual([]);
    expect(plan.routines[0]!.exercises[1]!.exerciseId).toBe('custom_mine');
  });

  it('turns an unknown library id into a custom exercise', () => {
    const odd: RoutineExportFile = { ...file, routines: [{ ...file.routines[0]!, exercises: [{ ...file.routines[0]!.exercises[0]!, id: 'gone_from_library', name: 'Gone Press' }] }] };
    const plan = planImport(odd, ctx());
    expect(plan.newExercises.map((e) => e.name)).toEqual(['Gone Press']);
  });

  it('a folder export makes a folder, or reuses one of that name', () => {
    const folderFile = buildRoutineExport([routine, { ...routine, name: 'Pull Day' }], withCustom, 'en', 'Gym');
    const made = planImport(folderFile, ctx(withCustom));
    expect(made.newFolder?.name).toBe('Gym');
    expect(made.routines.map((r) => r.folderId)).toEqual([made.newFolder!.id, made.newFolder!.id]);
    expect(new Set(made.routines.map((r) => r.id)).size).toBe(2);
    const existing = { id: 'f1', name: 'gym', sortOrder: 0, updatedAt: 1, deletedAt: null };
    const reused = planImport(folderFile, { ...ctx(withCustom), folders: [existing] });
    expect(reused.newFolder).toBeNull();
    expect(reused.folderId).toBe('f1');
  });
});

describe('parseRoutineExport', () => {
  const good = () => JSON.parse(serializeRoutineExport(buildRoutineExport([routine], withCustom, 'en'))) as Record<string, any>;
  const code = (doc: unknown) => {
    const result = parseRoutineExport(typeof doc === 'string' ? doc : JSON.stringify(doc));
    return result.ok ? 'ok' : result.error.code;
  };

  it('accepts a good file', () => expect(code(good())).toBe('ok'));

  it('refuses what is not ours', () => {
    expect(code('not json {')).toBe('not-json');
    expect(code('[]')).toBe('not-joyofit');
    expect(code({ ...good(), app: 'other' })).toBe('not-joyofit');
    expect(code({ ...good(), kind: 'workout' })).toBe('wrong-kind');
    expect(code({ ...good(), v: 2 })).toBe('version');
    expect(code({ ...good(), v: '1' })).toBe('version');
  });

  it('refuses bad numbers and says where', () => {
    const doc = good();
    doc.routines[0].exercises[0].sets[1].reps = -3;
    const result = parseRoutineExport(JSON.stringify(doc));
    expect(result).toEqual({ ok: false, error: { code: 'number', at: 'routines[0].exercises[0].sets[1].reps' } });
    const heavy = good();
    heavy.routines[0].exercises[0].sets[0].weightKg = 5000;
    expect(code(heavy)).toBe('number');
    const frac = good();
    frac.routines[0].exercises[0].sets[0].reps = 2.5;
    expect(code(frac)).toBe('number');
    const text = good();
    text.routines[0].exercises[0].restSec = '90';
    expect(code(text)).toBe('number');
  });

  it('refuses a bad shape and too many items', () => {
    const noName = good();
    noName.routines[0].name = '  ';
    expect(code(noName)).toBe('shape');
    const noSets = good();
    noSets.routines[0].exercises[0].sets = [];
    expect(code(noSets)).toBe('shape');
    const type = good();
    type.routines[0].exercises[0].sets[0].type = 'giant';
    expect(code(type)).toBe('shape');
    const none = good();
    none.routines = [];
    expect(code(none)).toBe('shape');
    const many = good();
    many.routines = Array.from({ length: 101 }, () => many.routines[0]);
    expect(code(many)).toBe('too-many');
    const sets = good();
    sets.routines[0].exercises[0].sets = Array.from({ length: 31 }, () => ({ type: 'normal', weightKg: null, reps: 5, seconds: null }));
    expect(code(sets)).toBe('too-many');
    expect(code(' '.repeat(2_000_001))).toBe('too-large');
  });

  it('never throws on odd input', () => {
    for (const input of ['', 'null', '1', '"x"', '{}', '{"app":"joyofit","kind":"routine","v":1}', '{"app":"joyofit","kind":"routine","v":1,"routines":[null]}']) {
      expect(() => parseRoutineExport(input)).not.toThrow();
      expect(parseRoutineExport(input).ok).toBe(false);
    }
    expect(parseRoutineExport(undefined as unknown as string).ok).toBe(false);
  });

  it('ignores unknown muscles and equipment instead of refusing', () => {
    const doc = good();
    doc.routines[0].exercises[1].primary = ['quadriceps', 'tail'];
    doc.routines[0].exercises[1].equipment = 'spaceship';
    const result = parseRoutineExport(JSON.stringify(doc));
    expect(result.ok && result.file.routines[0]!.exercises[1]!.primary).toEqual(['quadriceps']);
    expect(result.ok && result.file.routines[0]!.exercises[1]!.equipment).toBe('other');
  });
});

describe('exportFileName', () => {
  it('keeps the name and strips what file systems refuse', () => {
    expect(exportFileName('Push Day')).toBe('Push Day.joyofit-routine.json');
    expect(exportFileName('a/b:c*?')).toBe('a b c.joyofit-routine.json');
    expect(exportFileName('  ')).toBe('routines.joyofit-routine.json');
    expect(exportFileName('...')).toBe('routines.joyofit-routine.json');
  });
});
