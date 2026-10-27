/**
 * What can happen to a routine while it is edited, as pure functions (no React, no database): the editor screen holds an
 * `EditRoutine` in state and calls these; the rules live here so they are tested once. `Routine` itself is in `types.ts`.
 *
 * Supersets here mean two or more ADJACENT exercises with the same `supersetGroup`; every function ends with `normalizeSupersets`,
 * so a move or a removal that breaks adjacency leaves no half group behind.
 */
import { clampRest, MAX_EXERCISES, MAX_SETS_PER_EXERCISE, resolveTimed, type ExerciseInfo } from './draft';
import { newId } from './store';
import type { Routine, RoutineExercise, RoutineSet, SetType } from './types';
import { kgToUnit, unitToKg, type WeightUnit } from './units';

/** A routine exercise with an id that survives moves and edits (list keys). */
export interface EditExercise extends RoutineExercise {
  key: string;
}

export interface EditRoutine {
  name: string;
  folderId: string | null;
  note: string;
  exercises: EditExercise[];
}

export const MAX_NAME_LENGTH = 60;
export const MAX_NOTE_LENGTH = 500;
export const MAX_WEIGHT_KG = 999;
export const MAX_REPS = 999;
export const MAX_SECONDS = 3600;

/** Sets a new exercise starts with, and what each holds. */
export const DEFAULT_SETS = 3;
export const DEFAULT_REPS = 10;
export const DEFAULT_SECONDS = 30;

export function editFromRoutine(routine: Pick<Routine, 'name' | 'folderId' | 'note' | 'exercises'>): EditRoutine {
  return {
    name: routine.name,
    folderId: routine.folderId,
    note: routine.note,
    exercises: normalizeSupersets(routine.exercises.map((e) => ({ ...e, key: newId('k'), sets: e.sets.map((s) => ({ ...s })) }))),
  };
}

export const emptyEdit = (folderId: string | null = null): EditRoutine => ({ name: '', folderId, note: '', exercises: [] });

/** The exercises as stored: no keys, groups numbered 1, 2, ... in order. */
export function storedExercises(exercises: readonly (RoutineExercise & { key?: string })[]): RoutineExercise[] {
  return normalizeSupersets(exercises).map(({ key: _key, ...e }) => ({ ...e, sets: e.sets.map((s) => ({ ...s })) }));
}

/** A fixed text of the edit, to tell whether anything changed since it was loaded. */
export const editSnapshot = (edit: EditRoutine): string =>
  JSON.stringify([edit.name.trim(), edit.folderId, edit.note.trim(), storedExercises(edit.exercises)]);

export type EditProblem = 'name' | 'exercises';

/** What stops a routine from being saved: no name, or nothing in it. */
export function validateEdit(edit: EditRoutine): EditProblem | null {
  if (edit.name.trim().length === 0) return 'name';
  if (edit.exercises.length === 0) return 'exercises';
  return null;
}

/** A new routine from an edit (`base` null), or the saved one with the edit applied. */
export function routineFromEdit(base: Routine | null, edit: EditRoutine, sortOrder: number, now: number): Routine {
  const fields = {
    name: edit.name.trim().slice(0, MAX_NAME_LENGTH),
    folderId: edit.folderId,
    note: edit.note.trim().slice(0, MAX_NOTE_LENGTH),
    exercises: storedExercises(edit.exercises),
  };
  if (base) return { ...base, ...fields, updatedAt: Math.max(now, base.updatedAt + 1) };
  return { id: newId('r', now), ...fields, sortOrder, createdAt: now, updatedAt: now, deletedAt: null };
}

/** A routine as a new one (the duplicate action and "copy to my routines" of a starter): new id, same content, last in the list. */
export function copyRoutine(source: Routine, name: string, folderId: string | null, sortOrder: number, now: number): Routine {
  return {
    id: newId('r', now),
    name: name.trim().slice(0, MAX_NAME_LENGTH),
    folderId,
    note: source.note,
    exercises: storedExercises(source.exercises),
    sortOrder,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Exercises
// ---------------------------------------------------------------------------------------------------------------------

const defaultSets = (timed: boolean): RoutineSet[] =>
  Array.from({ length: DEFAULT_SETS }, () => ({
    type: 'normal',
    weightKg: null,
    reps: timed ? null : DEFAULT_REPS,
    seconds: timed ? DEFAULT_SECONDS : null,
  }));

/** Appends exercises, each with three empty-weight sets (repetitions, or seconds for a timed exercise). `restOf` gives a saved rest. */
export function addExercises(edit: EditRoutine, infos: readonly ExerciseInfo[], restOf: (exerciseId: string) => number | null = () => null): EditRoutine {
  const room = MAX_EXERCISES - edit.exercises.length;
  if (room <= 0) return edit;
  const added = infos.slice(0, room).map(
    (info): EditExercise => ({ key: newId('k'), exerciseId: info.exerciseId, timed: info.timed, restSec: restOf(info.exerciseId), note: '', supersetGroup: null, sets: defaultSets(info.timed) }),
  );
  return { ...edit, exercises: [...edit.exercises, ...added] };
}

const mapExercise = (edit: EditRoutine, key: string, change: (e: EditExercise) => EditExercise): EditRoutine => ({
  ...edit,
  exercises: edit.exercises.map((e) => (e.key === key ? change(e) : e)),
});

export const removeExercise = (edit: EditRoutine, key: string): EditRoutine => ({
  ...edit,
  exercises: normalizeSupersets(edit.exercises.filter((e) => e.key !== key)),
});

/**
 * Moves an exercise one place up (`-1`) or down (`1`). Inside a superset it swaps with its partner; at the edge of a superset it leaves
 * the group; an exercise that is alone jumps over a whole neighbouring superset instead of splitting it.
 */
export function moveExercise(edit: EditRoutine, key: string, direction: -1 | 1): EditRoutine {
  const from = edit.exercises.findIndex((e) => e.key === key);
  const neighbour = from + direction;
  if (from < 0 || neighbour < 0 || neighbour >= edit.exercises.length) return edit;
  const exercises = [...edit.exercises];
  const moved = exercises[from] as EditExercise;
  const group = moved.supersetGroup;
  if (group !== null && exercises[neighbour]!.supersetGroup === group) {
    exercises[from] = exercises[neighbour] as EditExercise;
    exercises[neighbour] = moved;
    return { ...edit, exercises: normalizeSupersets(exercises) };
  }
  const other = exercises[neighbour]!.supersetGroup;
  let span = 1;
  while (other !== null) {
    const next = neighbour + direction * span;
    if (next < 0 || next >= exercises.length || exercises[next]!.supersetGroup !== other) break;
    span += 1;
  }
  exercises.splice(from, 1);
  exercises.splice(from + direction * span, 0, { ...moved, supersetGroup: null });
  return { ...edit, exercises: normalizeSupersets(exercises) };
}

export const setExerciseNote = (edit: EditRoutine, key: string, note: string): EditRoutine => mapExercise(edit, key, (e) => ({ ...e, note }));

export const setExerciseRest = (edit: EditRoutine, key: string, restSec: number | null): EditRoutine =>
  mapExercise(edit, key, (e) => ({ ...e, restSec: restSec === null ? null : clampRest(restSec) }));

/** Swaps the exercise of an entry for another one. Sets keep their type and weight; reps and seconds follow whether the new one is timed. */
export function replaceExercise(edit: EditRoutine, key: string, info: ExerciseInfo): EditRoutine {
  return mapExercise(edit, key, (e) => ({
    ...e,
    exerciseId: info.exerciseId,
    timed: info.timed,
    sets: e.sets.map((s) => ({
      ...s,
      reps: info.timed ? null : (s.reps ?? DEFAULT_REPS),
      seconds: info.timed ? (s.seconds ?? DEFAULT_SECONDS) : null,
    })),
  }));
}

/** Whether any set holds a repetition or seconds value the person typed (not just the default of a new exercise): switching the measure would replace it. */
export const hasCustomAmounts = (exercise: Pick<RoutineExercise, 'sets'>): boolean =>
  exercise.sets.some((s) => (s.reps !== null && s.reps !== DEFAULT_REPS) || (s.seconds !== null && s.seconds !== DEFAULT_SECONDS));

/**
 * Measures a routine exercise in seconds (`true`) or repetitions (`false`). Sets keep their type and weight; the amount of the measure
 * left is dropped and the new one starts at the default of a new exercise (10 repetitions, 30 seconds), like `replaceExercise` here.
 * Nothing changes when it is measured that way already.
 */
export function setExerciseTimed(edit: EditRoutine, key: string, timed: boolean, catalogTimed: boolean | null = null): EditRoutine {
  const target = edit.exercises.find((e) => e.key === key);
  if (!target || resolveTimed(target, catalogTimed) === timed) return edit;
  return mapExercise(edit, key, (e) => ({
    ...e,
    timed,
    sets: e.sets.map((s) => ({ ...s, reps: timed ? null : DEFAULT_REPS, seconds: timed ? DEFAULT_SECONDS : null })),
  }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Supersets
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Groups are runs of adjacent exercises with the same number: a run of one is no superset, and two separate runs with the same number
 * are two groups. The result numbers the groups 1, 2, ... from the top.
 */
export function normalizeSupersets<T extends RoutineExercise>(exercises: readonly T[]): T[] {
  const groups: (number | null)[] = exercises.map(() => null);
  let next = 1;
  let i = 0;
  while (i < exercises.length) {
    const group = exercises[i]!.supersetGroup;
    let end = i + 1;
    while (group !== null && end < exercises.length && exercises[end]!.supersetGroup === group) end += 1;
    if (group !== null && end - i >= 2) {
      for (let j = i; j < end; j += 1) groups[j] = next;
      next += 1;
    }
    i = end;
  }
  return exercises.map((e, at) => ({ ...e, supersetGroup: groups[at] ?? null }));
}

/** Whether the exercise and the one after it are in the same superset. */
export function linkedWithNext(exercises: readonly RoutineExercise[], index: number): boolean {
  const a = exercises[index];
  const b = exercises[index + 1];
  return !!a && !!b && a.supersetGroup !== null && a.supersetGroup === b.supersetGroup;
}

/** Joins the exercise with the one after it into a superset, or splits them when they already are one. */
export function toggleSupersetWithNext(edit: EditRoutine, key: string): EditRoutine {
  const index = edit.exercises.findIndex((e) => e.key === key);
  const a = edit.exercises[index];
  const b = edit.exercises[index + 1];
  if (!a || !b) return edit;
  const exercises = edit.exercises.map((e) => ({ ...e }));
  if (linkedWithNext(exercises, index)) {
    // The part after the split gets a group number nobody uses.
    const group = a.supersetGroup as number;
    const fresh = Math.max(0, ...exercises.map((e) => e.supersetGroup ?? 0)) + 1;
    for (let j = index + 1; j < exercises.length && exercises[j]!.supersetGroup === group; j += 1) exercises[j]!.supersetGroup = fresh;
  } else {
    const group = a.supersetGroup ?? b.supersetGroup ?? Math.max(0, ...exercises.map((e) => e.supersetGroup ?? 0)) + 1;
    const runOf = (at: number): number[] => {
      const g = exercises[at]!.supersetGroup;
      if (g === null) return [at];
      let lo = at;
      let hi = at;
      while (lo > 0 && exercises[lo - 1]!.supersetGroup === g) lo -= 1;
      while (hi < exercises.length - 1 && exercises[hi + 1]!.supersetGroup === g) hi += 1;
      return Array.from({ length: hi - lo + 1 }, (_, n) => lo + n);
    };
    for (const at of [...runOf(index), ...runOf(index + 1)]) exercises[at]!.supersetGroup = group;
  }
  return { ...edit, exercises: normalizeSupersets(exercises) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Sets
// ---------------------------------------------------------------------------------------------------------------------

/** Appends a set that starts with the values of the last working set; a warm-up copies nothing but the repetitions. */
export function addSet(edit: EditRoutine, key: string, type: SetType = 'normal'): EditRoutine {
  return mapExercise(edit, key, (e) => {
    if (e.sets.length >= MAX_SETS_PER_EXERCISE) return e;
    const last = [...e.sets].reverse().find((s) => s.type !== 'warmup') ?? e.sets[e.sets.length - 1];
    const set: RoutineSet = { type, weightKg: type === 'warmup' ? null : (last?.weightKg ?? null), reps: last?.reps ?? null, seconds: last?.seconds ?? null };
    return { ...e, sets: [...e.sets, set] };
  });
}

export const removeSet = (edit: EditRoutine, key: string, index: number): EditRoutine =>
  mapExercise(edit, key, (e) => ({ ...e, sets: e.sets.filter((_, i) => i !== index) }));

export type SetPatch = Partial<Pick<RoutineSet, 'type' | 'weightKg' | 'reps' | 'seconds'>>;

export const updateSet = (edit: EditRoutine, key: string, index: number, patch: SetPatch): EditRoutine =>
  mapExercise(edit, key, (e) => ({ ...e, sets: e.sets.map((s, i) => (i === index ? { ...s, ...patch } : s)) }));

/** Sets of a routine exercise a person does for real (warm-ups left out). */
export const workingSets = (sets: readonly Pick<RoutineSet, 'type'>[]): number => sets.filter((s) => s.type !== 'warmup').length;

/** Working sets over all exercises. */
export const routineSetCount = (routine: Pick<Routine, 'exercises'>): number => routine.exercises.reduce((sum, e) => sum + workingSets(e.sets), 0);

// ---------------------------------------------------------------------------------------------------------------------
// Number fields
// ---------------------------------------------------------------------------------------------------------------------

/**
 * What a person typed into a kg, repetitions or seconds box: "12", "12,5" and "12.5" are read, anything else is nothing (null).
 * Negative and above `max` values are not accepted; `decimals` caps the places kept.
 */
export function parseAmount(text: string, max: number, decimals: number): number | null {
  const clean = text.trim().replace(',', '.');
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(clean)) return null;
  const value = Number(clean);
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** decimals;
  return Math.min(max, Math.round(value * scale) / scale);
}

/**
 * A weight box of the routine editor: `text` is in `unit`, the result is the kg to store (two decimals, at most `MAX_WEIGHT_KG`), null
 * for nothing. One decimal of the unit is kept while typing, as `parseAmount` does for kg.
 */
export function parseWeightAmount(text: string, unit: WeightUnit): number | null {
  const typed = parseAmount(text, kgToUnit(MAX_WEIGHT_KG, unit), 1);
  return typed === null ? null : Math.min(MAX_WEIGHT_KG, Math.round(unitToKg(typed, unit) * 100) / 100);
}

// ---------------------------------------------------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------------------------------------------------

/** `sortOrder` of a routine added at the end of the list. */
export const nextSortOrder = (routines: readonly Pick<Routine, 'sortOrder'>[]): number => routines.reduce((max, r) => Math.max(max, r.sortOrder + 1), 0);

/**
 * Moves a routine one place up (`-1`) or down (`1`) among the routines of its folder (or of "no folder"). Returns the routines whose
 * `sortOrder` changed, each with its new value (the scope is numbered 0, 1, 2, ... in its current order first, so ties and gaps
 * never block a move); an empty list when it cannot move.
 */
export function moveRoutine(routines: readonly Routine[], id: string, direction: -1 | 1, now: number): Routine[] {
  const subject = routines.find((r) => r.id === id);
  if (!subject) return [];
  const scope = routines
    .filter((r) => r.folderId === subject.folderId)
    .sort((a, b) => a.sortOrder - b.sortOrder || b.createdAt - a.createdAt);
  const from = scope.findIndex((r) => r.id === id);
  const to = from + direction;
  if (to < 0 || to >= scope.length) return [];
  const [moved] = scope.splice(from, 1);
  scope.splice(to, 0, moved as Routine);
  const changed: Routine[] = [];
  scope.forEach((r, i) => {
    const original = routines.find((o) => o.id === r.id) as Routine;
    if (original.sortOrder !== i) changed.push({ ...original, sortOrder: i, updatedAt: Math.max(now, original.updatedAt + 1) });
  });
  return changed;
}

export interface SetsSummary {
  /** Working sets. */
  sets: number;
  /** Lowest and highest repetitions of the working sets; null when none has any. */
  reps: { min: number; max: number } | null;
  seconds: { min: number; max: number } | null;
  /** The heaviest working set, kg; null when none has a weight. */
  weightKg: number | null;
}

/** What the preview shows for an exercise: "3 x 8-12, 60 kg" is `{ sets: 3, reps: { min: 8, max: 12 }, weightKg: 60 }`. */
export function summarizeSets(sets: readonly RoutineSet[]): SetsSummary {
  const working = sets.filter((s) => s.type !== 'warmup');
  const range = (values: (number | null)[]): { min: number; max: number } | null => {
    const present = values.filter((v): v is number => v !== null && v > 0);
    return present.length > 0 ? { min: Math.min(...present), max: Math.max(...present) } : null;
  };
  return {
    sets: working.length,
    reps: range(working.map((s) => s.reps)),
    seconds: range(working.map((s) => s.seconds)),
    weightKg: range(working.map((s) => s.weightKg))?.max ?? null,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Folded lists on the home screen
// ---------------------------------------------------------------------------------------------------------------------

/** The id the starter routines' header folds under (folders use their own ids). */
export const STARTERS_FOLD = 'starters';

/**
 * The lists the person folded, from what was saved (a JSON array of folder ids and `STARTERS_FOLD`). Nothing saved yet: the starters
 * start folded once the person has routines of their own, and open while the list of their own is empty.
 */
export function parseCollapsed(saved: string | null, hasRoutines: boolean): string[] {
  if (saved === null) return hasRoutines ? [STARTERS_FOLD] : [];
  try {
    const parsed: unknown = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
