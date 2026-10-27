/**
 * What the strength share card and the Strava description say about a workout: the headline numbers, the best sets and
 * the record count. Pure: text comes from the `strengthshare` namespace in the given locale, numbers from `@/i18n/format`.
 */
import { epley1rm, isCounted, workoutTotals, type PersonalRecord } from '../calc';
import type { Catalog } from '../catalog';
import { timerText } from '../logFormat';
import type { StrengthSet, StrengthWorkout } from '../types';
import { displayWeight, getWeightUnit, kgToUnit } from '../units';
import { fmtClock, fmtDate, fmtDuration, fmtInt, fmtNumber, getT } from '@/i18n';

type Locale = 'id' | 'en';

export interface StrengthShareStat {
  key: 'volume' | 'reps' | 'hold' | 'time' | 'sets' | 'kcal';
  label: string;
  value: string;
  unit?: string;
}

export interface StrengthShareSet {
  exercise: string;
  /** "60 kg x 8", "12 reps", "45 s". */
  load: string;
}

export interface StrengthShareStats {
  name: string;
  /** "12 Okt 2026 · 07.30". */
  subtitle: string;
  /** The first is the headline: volume, or total reps for a bodyweight-only workout, or the time held (plank), or the workout's duration. */
  stats: StrengthShareStat[];
  topSets: StrengthShareSet[];
  /** Records the workout set; 0 = no badge. */
  prCount: number;
  /** "2 new PRs"; null when there are none. */
  prLabel: string | null;
}

/** How many sets the card lists. */
export const TOP_SET_COUNT = 3;

interface Ranked {
  exerciseId: string;
  set: StrengthSet;
  /** Higher is better; weighted sets always outrank bodyweight rep sets, which outrank timed sets. */
  rank: number;
}

/** A set's score: estimated 1RM (the plain load past what the formula describes) when it has a load, else reps, else seconds. */
function rankOf(set: StrengthSet): number | null {
  const weight = set.weightKg ?? 0;
  const reps = set.reps ?? 0;
  const seconds = set.seconds ?? 0;
  if (weight > 0 && (reps > 0 || seconds > 0)) return 1e9 + (epley1rm(weight, reps) ?? weight);
  if (reps > 0) return 1e6 + reps;
  if (seconds > 0) return seconds;
  return null;
}

/** The best counted set of each exercise, best first, at most `limit`. Warm-ups never count. */
export function topSets(workout: Pick<StrengthWorkout, 'exercises'>, catalog: Pick<Catalog, 'name'>, locale: Locale, limit = TOP_SET_COUNT): StrengthShareSet[] {
  const bestOfExercise = new Map<string, Ranked>();
  for (const exercise of workout.exercises) {
    for (const set of exercise.sets) {
      if (!isCounted(set)) continue;
      const rank = rankOf(set);
      if (rank === null) continue;
      const known = bestOfExercise.get(exercise.exerciseId);
      if (!known || rank > known.rank) bestOfExercise.set(exercise.exerciseId, { exerciseId: exercise.exerciseId, set, rank });
    }
  }
  const t = getT(locale, 'strengthshare');
  return [...bestOfExercise.values()]
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
    .map(({ exerciseId, set }) => ({ exercise: catalog.name(exerciseId, locale) ?? t('unknownExercise'), load: setLoad(set, locale) }));
}

/** "60 kg x 8", "60 kg x 45 s", "12 reps" or "45 s"; the weight in the chosen unit (`units.ts`). */
export function setLoad(set: Pick<StrengthSet, 'weightKg' | 'reps' | 'seconds'>, locale: Locale): string {
  const t = getT(locale, 'strengthshare');
  const weight = set.weightKg !== null && set.weightKg > 0 ? fmtNumber(displayWeight(set.weightKg), 1, locale) : null;
  const unit = getWeightUnit();
  const reps = set.reps !== null && set.reps > 0 ? set.reps : null;
  const seconds = set.seconds !== null && set.seconds > 0 ? fmtInt(set.seconds, locale) : null;
  if (weight && reps) return t('setWeightReps', { weight, unit, reps: fmtInt(reps, locale) });
  if (weight && seconds) return t('setWeightSeconds', { weight, unit, seconds });
  if (reps) return t('setReps', { count: reps, reps: fmtInt(reps, locale) });
  if (seconds) return t('setSeconds', { seconds });
  return weight ? t('setWeight', { weight, unit }) : '';
}

export function strengthShareStats(workout: StrengthWorkout, catalog: Catalog, locale: Locale, records: readonly PersonalRecord[]): StrengthShareStats {
  const t = getT(locale, 'strengthshare');
  const totals = workoutTotals(workout);
  const stat = (key: StrengthShareStat['key'], value: string, unit?: string): StrengthShareStat => ({
    key,
    label: t(`stats.${key}`),
    value,
    ...(unit ? { unit } : {}),
  });
  const time = workout.durationSec > 0 ? stat('time', fmtDuration(workout.durationSec, locale)) : null;

  const stats: StrengthShareStat[] = [];
  if (totals.volume > 0) stats.push(stat('volume', fmtInt(kgToUnit(totals.volume), locale), getWeightUnit()));
  else if (totals.reps > 0) stats.push(stat('reps', fmtInt(totals.reps, locale)));
  else if (totals.seconds > 0) stats.push(stat('hold', timerText(totals.seconds)));
  else if (time) stats.push(time);
  if (time && stats[0] !== time) stats.push(time);
  if (totals.sets > 0) stats.push(stat('sets', fmtInt(totals.sets, locale)));
  if (totals.volume > 0 && totals.reps > 0) stats.push(stat('reps', fmtInt(totals.reps, locale)));
  if (totals.seconds > 0 && stats[0]?.key !== 'hold') stats.push(stat('hold', timerText(totals.seconds)));
  if (workout.kcal !== null && workout.kcal > 0) stats.push(stat('kcal', fmtInt(workout.kcal, locale), 'kcal'));

  const at = new Date(workout.startedAt);
  return {
    name: workout.name.trim() || t('fallbackName'),
    subtitle: `${fmtDate(at, 'medium', locale)} · ${fmtClock(at, locale)}`,
    stats,
    topSets: topSets(workout, catalog, locale),
    prCount: records.length,
    prLabel: records.length > 0 ? t('prBadge', { count: records.length }) : null,
  };
}

/**
 * The Strava activity description: totals, the best sets and the records, one line each. The JoyoFit link is added by
 * `buildUploadForm` when the person allows it.
 */
export function strengthDescription(workout: StrengthWorkout, catalog: Catalog, locale: Locale, records: readonly PersonalRecord[] = []): string {
  const t = getT(locale, 'strengthshare');
  const totals = workoutTotals(workout);
  const lines: string[] = [];
  if (totals.sets > 0) {
    lines.push(
      totals.volume > 0
        ? t('description.totalsVolume', { volume: fmtInt(kgToUnit(totals.volume), locale), unit: getWeightUnit(), count: totals.sets, reps: fmtInt(totals.reps, locale) })
        : totals.reps === 0 && totals.seconds > 0
          ? t('description.totalsTime', { count: totals.sets, time: timerText(totals.seconds) })
          : t('description.totalsReps', { count: totals.sets, reps: fmtInt(totals.reps, locale) }),
    );
    if (totals.reps > 0 && totals.seconds > 0) lines.push(t('description.hold', { time: timerText(totals.seconds) }));
  }
  const best = topSets(workout, catalog, locale);
  if (best.length > 0) lines.push(t('description.topSets', { sets: best.map((s) => `${s.exercise} ${s.load}`).join(', ') }));
  if (records.length > 0) lines.push(t('prBadge', { count: records.length }));
  return lines.join('\n');
}
