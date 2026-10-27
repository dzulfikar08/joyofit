/**
 * Sharing routines, as pure functions (no React, no database, no files): a readable text for chat apps, a versioned JSON file that
 * another JoyoFit can import, and the plan of what an import would create. Saving the plan and handing text or files to the system is
 * `routineShareIo.ts` and the screens.
 *
 * The file carries weights in kg (the storage unit, whatever unit the sender reads) and, next to each exercise id, the exercise's name,
 * muscles, equipment and measure. That is what lets a phone that does not know the id (a custom exercise made on the sender's phone,
 * or a library entry this build lacks) create a custom exercise of the same name instead of a broken row.
 */
import { isRecord } from '@/features/ai/json';

import type { Catalog } from './catalog';
import { normalize } from './catalog';
import { MAX_EXERCISES, MAX_REST_SEC, MAX_SETS_PER_EXERCISE } from './draft';
import { MAX_NAME_LENGTH, MAX_NOTE_LENGTH, MAX_REPS, MAX_SECONDS, MAX_WEIGHT_KG } from './routineEdit';
import { newId } from './store';
import { SET_TYPES, type CustomExercise, type Equipment, type Muscle, type Routine, type RoutineExercise, type RoutineFolder, type RoutineSet, type SetType } from './types';
import { getWeightUnit, kgToUnit, type WeightUnit } from './units';

// ---------------------------------------------------------------------------------------------------------------------
// The file format
// ---------------------------------------------------------------------------------------------------------------------

export const EXPORT_APP = 'joyofit';
export const EXPORT_KIND = 'routine';
export const EXPORT_VERSION = 1;
/** Ends the file name of an export, so the share sheet and the file picker recognise it. */
export const EXPORT_SUFFIX = '.joyofit-routine.json';
export const EXPORT_MIME = 'application/json';

/** A folder export of a person with a lot of routines stays well below this; anything bigger is not one of our files. */
export const MAX_ROUTINES = 100;
export const MAX_EXPORT_CHARS = 2_000_000;
const MAX_EXERCISE_NAME = 100;
const MAX_ID = 80;

export interface SharedSet {
  type: SetType;
  weightKg: number | null;
  reps: number | null;
  seconds: number | null;
}

export interface SharedExercise {
  /** The id on the sender's phone: a library slug or `custom_...`. */
  id: string;
  /** Its name there, one text for both languages. */
  name: string;
  primary: Muscle[];
  equipment: Equipment;
  /** The measure of this entry (seconds when true); absent = the exercise's own. */
  timed?: boolean;
  restSec: number | null;
  note: string;
  supersetGroup: number | null;
  sets: SharedSet[];
}

export interface SharedRoutine {
  name: string;
  note: string;
  exercises: SharedExercise[];
}

export interface RoutineExportFile {
  app: typeof EXPORT_APP;
  kind: typeof EXPORT_KIND;
  v: typeof EXPORT_VERSION;
  /** The folder the routines came from (a folder export); null for routines picked one by one. */
  folder: string | null;
  routines: SharedRoutine[];
}

const MUSCLES: readonly Muscle[] = [
  'abs', 'abductors', 'adductors', 'biceps', 'calves', 'chest', 'forearms', 'glutes', 'hamstrings', 'lats', 'lower_back', 'middle_back', 'neck',
  'quadriceps', 'shoulders', 'traps', 'triceps',
];
const EQUIPMENT: readonly Equipment[] = ['bodyweight', 'band', 'dumbbell', 'kettlebell', 'barbell', 'machine', 'cable', 'bench', 'bar', 'other'];

/** An exercise's name when nothing knows it any more: its id read as words. */
const wordsOf = (id: string): string => id.replace(/^custom_/, '').replace(/[_-]+/g, ' ').trim() || id;

/** The routines as a file. `locale` picks the language of library names; a custom exercise has one name. */
export function buildRoutineExport(routines: readonly Routine[], catalog: Catalog, locale: 'id' | 'en', folder: string | null = null): RoutineExportFile {
  return {
    app: EXPORT_APP,
    kind: EXPORT_KIND,
    v: EXPORT_VERSION,
    folder,
    routines: routines.map((r) => ({
      name: r.name,
      note: r.note,
      exercises: r.exercises.map((e): SharedExercise => {
        const known = catalog.get(e.exerciseId);
        const shared: SharedExercise = {
          id: e.exerciseId,
          name: known?.name[locale] ?? wordsOf(e.exerciseId),
          primary: known ? [...known.primary] : [],
          equipment: known?.equipment ?? 'other',
          restSec: e.restSec,
          note: e.note,
          supersetGroup: e.supersetGroup,
          sets: e.sets.map((s) => ({ type: s.type, weightKg: s.weightKg, reps: s.reps, seconds: s.seconds })),
        };
        if (e.timed !== undefined) shared.timed = e.timed;
        else if (known?.timed) shared.timed = true;
        return shared;
      }),
    })),
  };
}

export const serializeRoutineExport = (file: RoutineExportFile): string => JSON.stringify(file, null, 2);

/** `<name>.joyofit-routine.json` with what file systems refuse taken out. */
export function exportFileName(name: string): string {
  const safe = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 60)
    .trim();
  return `${safe.length > 0 ? safe : 'routines'}${EXPORT_SUFFIX}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading a file
// ---------------------------------------------------------------------------------------------------------------------

/** Why a file was refused. `at` says where (`routines[1].exercises[0].sets[2].reps`) for the problems inside the data. */
export type ParseErrorCode = 'too-large' | 'not-json' | 'not-joyofit' | 'wrong-kind' | 'version' | 'shape' | 'number' | 'too-many';

export interface ParseError {
  code: ParseErrorCode;
  at?: string;
}

export type ParseResult = { ok: true; file: RoutineExportFile } | { ok: false; error: ParseError };

class Refused extends Error {
  constructor(readonly refusal: ParseError) {
    super(refusal.code);
  }
}

const refuse = (code: ParseErrorCode, at?: string): never => {
  throw new Refused(at === undefined ? { code } : { code, at });
};

function text(value: unknown, at: string, max: number, required: boolean): string {
  if (value === undefined || value === null) return required ? refuse('shape', at) : '';
  if (typeof value !== 'string') return refuse('shape', at);
  const trimmed = value.trim();
  if (required && trimmed.length === 0) return refuse('shape', at);
  return trimmed.length > max ? refuse('too-many', at) : trimmed;
}

/** `null`/absent = none; otherwise a finite number in range (and a whole one when `whole`). */
function amount(value: unknown, at: string, max: number, whole: boolean): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max || (whole && !Number.isInteger(value))) return refuse('number', at);
  return value;
}

function array(value: unknown, at: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value)) return refuse('shape', at);
  if (value.length > max) return refuse('too-many', at);
  if (value.length < min) return refuse('shape', at);
  return value;
}

function parseSet(raw: unknown, at: string): SharedSet {
  if (!isRecord(raw)) return refuse('shape', at);
  const type = raw.type ?? 'normal';
  if (typeof type !== 'string' || !SET_TYPES.includes(type as SetType)) return refuse('shape', `${at}.type`);
  return {
    type: type as SetType,
    weightKg: amount(raw.weightKg, `${at}.weightKg`, MAX_WEIGHT_KG, false),
    reps: amount(raw.reps, `${at}.reps`, MAX_REPS, true),
    seconds: amount(raw.seconds, `${at}.seconds`, MAX_SECONDS, true),
  };
}

function parseExercise(raw: unknown, at: string): SharedExercise {
  if (!isRecord(raw)) return refuse('shape', at);
  const id = text(raw.id, `${at}.id`, MAX_ID, true);
  const equipment = typeof raw.equipment === 'string' && EQUIPMENT.includes(raw.equipment as Equipment) ? (raw.equipment as Equipment) : 'other';
  // Muscles and equipment only describe a custom exercise the receiver has to create; an unknown value is dropped, not a reason to refuse.
  const primary = Array.isArray(raw.primary) ? (raw.primary.filter((m): m is Muscle => typeof m === 'string' && MUSCLES.includes(m as Muscle)).slice(0, 4) as Muscle[]) : [];
  if (raw.timed !== undefined && raw.timed !== null && typeof raw.timed !== 'boolean') return refuse('shape', `${at}.timed`);
  const restSec = amount(raw.restSec, `${at}.restSec`, MAX_REST_SEC, true);
  const group = amount(raw.supersetGroup, `${at}.supersetGroup`, MAX_EXERCISES, true);
  const exercise: SharedExercise = {
    id,
    name: text(raw.name, `${at}.name`, MAX_EXERCISE_NAME, true),
    primary,
    equipment,
    restSec,
    note: text(raw.note, `${at}.note`, MAX_NOTE_LENGTH, false),
    supersetGroup: group === 0 ? null : group,
    sets: array(raw.sets, `${at}.sets`, 1, MAX_SETS_PER_EXERCISE).map((s, i) => parseSet(s, `${at}.sets[${i}]`)),
  };
  if (typeof raw.timed === 'boolean') exercise.timed = raw.timed;
  return exercise;
}

function parseRoutine(raw: unknown, at: string): SharedRoutine {
  if (!isRecord(raw)) return refuse('shape', at);
  return {
    name: text(raw.name, `${at}.name`, MAX_NAME_LENGTH, true),
    note: text(raw.note, `${at}.note`, MAX_NOTE_LENGTH, false),
    exercises: array(raw.exercises, `${at}.exercises`, 1, MAX_EXERCISES).map((e, i) => parseExercise(e, `${at}.exercises[${i}]`)),
  };
}

/**
 * Reads the text of an export file. Strict: a wrong app, kind or version, a number that is not a number or out of range, or a list
 * that is too long refuses the whole file, so a half-read file never lands in the person's routines. Never throws.
 */
export function parseRoutineExport(source: string): ParseResult {
  try {
    if (typeof source !== 'string') return refuse('not-json');
    if (source.length > MAX_EXPORT_CHARS) return refuse('too-large');
    let doc: unknown;
    try {
      doc = JSON.parse(source.replace(/^\uFEFF/, ''));
    } catch {
      return refuse('not-json');
    }
    if (!isRecord(doc) || doc.app !== EXPORT_APP) return refuse('not-joyofit');
    if (doc.kind !== EXPORT_KIND) return refuse('wrong-kind');
    if (doc.v !== EXPORT_VERSION) return refuse('version');
    const folder = doc.folder === undefined || doc.folder === null ? null : text(doc.folder, 'folder', MAX_NAME_LENGTH, false) || null;
    const routines = array(doc.routines, 'routines', 1, MAX_ROUTINES).map((r, i) => parseRoutine(r, `routines[${i}]`));
    return { ok: true, file: { app: EXPORT_APP, kind: EXPORT_KIND, v: EXPORT_VERSION, folder, routines } };
  } catch (e) {
    if (e instanceof Refused) return { ok: false, error: e.refusal };
    return { ok: false, error: { code: 'shape' } };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Importing
// ---------------------------------------------------------------------------------------------------------------------

export interface ImportContext {
  catalog: Catalog;
  /** Routines and folders the phone has now (not deleted): the new routines go after them; a folder of the same name is reused. */
  routines: readonly Pick<Routine, 'sortOrder'>[];
  folders: readonly RoutineFolder[];
  now: number;
}

export interface ImportPlan {
  routines: Routine[];
  /** Custom exercises to create first (an id this phone does not know). Names only, for the preview: see `createdNames`. */
  newExercises: CustomExercise[];
  /** A folder to create for the routines, or null (none in the file, or one of that name exists: `folderId` then points at it). */
  newFolder: RoutineFolder | null;
  folderId: string | null;
}

/**
 * What importing the file would save. Nothing here touches the phone: routines get fresh ids and are appended, so an import never
 * overwrites or changes an existing routine. An exercise id the phone knows is kept; one it does not (a custom exercise of the
 * sender's, or a library entry this build lacks) becomes a custom exercise with a new id, reusing a custom exercise of the same name
 * when there is one, so importing twice does not pile up copies.
 */
export function planImport(file: RoutineExportFile, ctx: ImportContext): ImportPlan {
  const { catalog, now } = ctx;
  const offered = catalog.all();
  const known = new Set(offered.map((e) => e.id));
  const customByName = new Map(offered.filter((e) => e.custom).map((e) => [normalize(e.name.id), e.id]));

  const resolved = new Map<string, string>();
  const newExercises: CustomExercise[] = [];
  const resolve = (shared: SharedExercise): string => {
    if (known.has(shared.id)) return shared.id;
    const done = resolved.get(shared.id);
    if (done) return done;
    const byName = customByName.get(normalize(shared.name));
    const id = byName ?? newId('custom_', now + newExercises.length);
    if (!byName) {
      newExercises.push({
        id,
        name: shared.name.slice(0, MAX_EXERCISE_NAME),
        primary: shared.primary,
        equipment: shared.equipment,
        timed: shared.timed ?? false,
        updatedAt: now,
        deletedAt: null,
      });
      customByName.set(normalize(shared.name), id);
    }
    resolved.set(shared.id, id);
    return id;
  };

  let folderId: string | null = null;
  let newFolder: RoutineFolder | null = null;
  if (file.folder !== null) {
    const same = ctx.folders.find((f) => f.deletedAt === null && normalize(f.name) === normalize(file.folder as string));
    if (same) folderId = same.id;
    else {
      const order = ctx.folders.reduce((max, f) => Math.max(max, f.sortOrder + 1), 0);
      newFolder = { id: newId('f', now), name: file.folder, sortOrder: order, updatedAt: now, deletedAt: null };
      folderId = newFolder.id;
    }
  }

  const firstOrder = ctx.routines.reduce((max, r) => Math.max(max, r.sortOrder + 1), 0);
  const routines = file.routines.map((shared, i): Routine => ({
    id: newId('r', now + i),
    name: shared.name,
    folderId,
    note: shared.note,
    exercises: shared.exercises.map((e): RoutineExercise => {
      const exercise: RoutineExercise = {
        exerciseId: resolve(e),
        restSec: e.restSec,
        note: e.note,
        supersetGroup: e.supersetGroup,
        sets: e.sets.map((s): RoutineSet => ({ ...s })),
      };
      if (e.timed !== undefined) exercise.timed = e.timed;
      return exercise;
    }),
    sortOrder: firstOrder + i,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }));
  return { routines, newExercises, newFolder, folderId };
}

// ---------------------------------------------------------------------------------------------------------------------
// The text for chat apps
// ---------------------------------------------------------------------------------------------------------------------

const WORDS = {
  id: { rest: 'istirahat', warmup: 'pemanasan', drop: 'drop set', failure: 'sampai gagal', secondsUnit: 'dtk', superset: 'Superset', footer: 'Dari JoyoFit', removed: 'Latihan dihapus' },
  en: { rest: 'rest', warmup: 'warm-up', drop: 'drop set', failure: 'to failure', secondsUnit: 's', superset: 'Superset', footer: 'From JoyoFit', removed: 'Removed exercise' },
} as const;

/** A number with at most one decimal, in the language's separator ("62,5" / "62.5"). */
function number1(value: number, locale: 'id' | 'en'): string {
  const text = (Math.round(value * 10) / 10).toString();
  return locale === 'id' ? text.replace('.', ',') : text;
}

const setAmount = (s: RoutineSet, locale: 'id' | 'en'): string => {
  const w = WORDS[locale];
  if (s.seconds !== null && s.seconds > 0) return `${s.seconds} ${w.secondsUnit}`;
  return s.reps !== null && s.reps > 0 ? `${s.reps}` : '-';
};

/** "3 x 10 @ 60 kg": runs of identical sets are counted; a warm-up, drop or failure set says so. */
function setsText(sets: readonly RoutineSet[], unit: WeightUnit, locale: 'id' | 'en'): string {
  const w = WORDS[locale];
  const parts: string[] = [];
  let i = 0;
  while (i < sets.length) {
    const s = sets[i] as RoutineSet;
    let end = i + 1;
    while (end < sets.length) {
      const n = sets[end] as RoutineSet;
      if (n.type !== s.type || n.reps !== s.reps || n.seconds !== s.seconds || n.weightKg !== s.weightKg) break;
      end += 1;
    }
    const weight = s.weightKg !== null && s.weightKg > 0 ? ` @ ${number1(kgToUnit(s.weightKg, unit), locale)} ${unit}` : '';
    const tag = s.type === 'normal' ? '' : ` (${w[s.type]})`;
    parts.push(`${end - i} x ${setAmount(s, locale)}${weight}${tag}`);
    i = end;
  }
  return parts.join(', ');
}

/** The routine as plain text for a chat app: name, note, each exercise with its sets, rest and note; supersets are A1, A2, B1 ... */
export function routineText(routine: Routine, catalog: Catalog, locale: 'id' | 'en', unit: WeightUnit = getWeightUnit()): string {
  const w = WORDS[locale];
  const lines: string[] = [routine.name];
  if (routine.note.length > 0) lines.push(routine.note);
  lines.push('');
  let number = 0;
  const seen = new Map<number, number>();
  for (const e of routine.exercises) {
    const group = e.supersetGroup;
    let label: string;
    if (group === null) {
      number += 1;
      label = `${number}.`;
    } else {
      const inGroup = (seen.get(group) ?? 0) + 1;
      seen.set(group, inGroup);
      if (inGroup === 1) number += 1;
      label = `${String.fromCharCode(64 + number)}${inGroup}.`;
    }
    lines.push(`${label} ${catalog.name(e.exerciseId, locale) ?? w.removed}`);
    const detail = [setsText(e.sets, unit, locale)];
    if (e.restSec !== null) detail.push(`${w.rest} ${e.restSec} ${w.secondsUnit}`);
    lines.push(`   ${detail.join(' | ')}`);
    if (e.note.length > 0) lines.push(`   ${e.note}`);
  }
  lines.push('', `${w.footer} - fit.joyorogo.com`);
  return lines.join('\n');
}
