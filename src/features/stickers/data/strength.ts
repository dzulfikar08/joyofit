/**
 * Strength workout -> sticker subject (`strength.*` namespace). Numbers stay raw; exercise names, loads and muscle labels
 * are text in the given locale. A value the workout does not have is an absent key.
 */
import { MUSCLE_GROUPS, averageRpe, isCounted, muscleSets, workoutTotals, type MuscleResolver, type PersonalRecord } from '@/features/strength/calc';
import type { Catalog } from '@/features/strength/catalog';
import { heatFill, heatLevel } from '@/features/strength/heat';
import { setLoad, strengthShareStats, topSets } from '@/features/strength/share/strengthShareStats';
import { getWeightUnit, kgToUnit } from '@/features/strength/units';
import type { StrengthWorkout } from '@/features/strength/types';
import { getT } from '@/i18n';

import type { JsonObject, StickerKind, StickerSubject } from '../subject';

type Locale = 'id' | 'en';

export interface StrengthSubjectInput {
  workout: StrengthWorkout;
  catalog: Catalog;
  records: readonly PersonalRecord[];
  resolveMuscles: MuscleResolver;
}

const MAX_TEXT = 60;
const MAX_TOP_SETS = 5;
const MAX_PRS = 3;
const MAX_MUSCLES = 8;
/** Heat colours: an untrained cell to the accent, same ramp as the muscle heat map. */
const HEAT_EMPTY = '#2B3A3F';
const HEAT_ACCENT = '#D4FF3A';

function clip(text: string): string {
  const s = text.trim();
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 3).trimEnd()}...` : s;
}

const positive = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

export function buildStrengthSubject(input: StrengthSubjectInput, locale: Locale): StickerSubject {
  const { workout, catalog, records, resolveMuscles } = input;
  const share = strengthShareStats(workout, catalog, locale, records);
  const totals = workoutTotals(workout);
  const t = getT(locale, 'strengthshare');
  const lifts = getT(locale, 'lifts');

  const strength: JsonObject = { name: clip(share.name) || clip(t('fallbackName')) };
  if (Number.isFinite(workout.startedAt)) strength.startedAt = workout.startedAt;
  if (positive(totals.volume)) {
    strength.volume = Math.round(kgToUnit(totals.volume) * 10) / 10;
    strength.unit = getWeightUnit();
  }
  if (positive(totals.reps)) strength.reps = Math.round(totals.reps);
  if (positive(totals.seconds)) strength.seconds = Math.round(totals.seconds);
  if (positive(totals.sets)) strength.sets = Math.round(totals.sets);
  if (positive(workout.durationSec)) strength.durationSec = Math.round(workout.durationSec);
  if (positive(workout.kcal)) strength.kcal = Math.round(workout.kcal);

  const exercises = new Set<string>();
  for (const exercise of workout.exercises) if (exercise.sets.some(isCounted)) exercises.add(exercise.exerciseId);
  if (exercises.size > 0) strength.exercises = exercises.size;

  const best = topSets(workout, catalog, locale, MAX_TOP_SETS)
    .map((s) => ({ exercise: clip(s.exercise), load: clip(s.load) }))
    .filter((s) => s.load !== '');
  if (best.length > 0) strength.topSets = best;

  const setsById = new Map(workout.exercises.flatMap((e) => e.sets.map((s) => [s.id, s] as const)));
  const prs: { exercise: string; load: string; kind: PersonalRecord['kind'] }[] = [];
  let firstValue: number | null = null;
  for (const record of records) {
    const set = setsById.get(record.setId);
    const load = set ? clip(setLoad(set, locale)) : '';
    if (!load) continue;
    if (prs.length === 0 && Number.isFinite(record.value)) firstValue = record.value;
    prs.push({ exercise: clip(catalog.name(record.exerciseId, locale) ?? t('unknownExercise')), load, kind: record.kind });
  }
  if (records.length > 0) strength.prCount = records.length;
  if (prs.length > 0) strength.prs = prs.slice(0, MAX_PRS);

  const load = muscleSets(workout, resolveMuscles);
  const groups = MUSCLE_GROUPS.map((group, order) => ({ group, order, sets: load.get(group) ?? 0 }))
    .filter((g) => positive(g.sets))
    .sort((a, b) => b.sets - a.sets || a.order - b.order)
    .slice(0, MAX_MUSCLES);
  if (groups.length > 0) {
    strength.muscleLabels = groups.map((g) => lifts(`group.${g.group}`));
    strength.muscleSets = groups.map((g) => g.sets);
    strength.muscleColors = groups.map((g) => heatFill(heatLevel(g.sets), HEAT_EMPTY, HEAT_ACCENT));
  }

  const rpe = averageRpe(workout);
  if (positive(rpe)) strength.avgRpe = Math.round(rpe * 10) / 10;

  const kinds: StickerKind[] = ['strength'];
  const data: JsonObject = { strength };
  const first = prs[0];
  if (records.length > 0 && first) {
    kinds.push('badge');
    data.milestone = {
      kind: 'pr',
      title: first.exercise,
      subtitle: share.prLabel ?? '',
      ...(firstValue !== null ? { value: firstValue } : {}),
      valueText: first.load,
    };
  }

  return {
    id: `strength:${workout.id}`,
    kinds,
    heading: t('share.heading'),
    caption: getT(locale, 'sharing')('share.caption'),
    date: workout.startedAt,
    data,
  };
}
