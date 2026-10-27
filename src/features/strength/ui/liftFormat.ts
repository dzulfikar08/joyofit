/**
 * Text for lift numbers on the history, exercise and heat-map screens: weight, volume, a set as `60 × 8`, seconds. Functions, not
 * constants, so they follow the language and the weight unit (`units.ts`) at the moment they are called. Weights come in as stored kg.
 */
import { getWeightUnit, kgToUnit, roundWeight } from '@/features/strength/units';
import { fmtInt, fmtNumber, t } from '@/i18n';

/** `62,5` / `62.5` of a number already in the chosen unit, no trailing zero (`roundWeight`). Chart axes work in this scale. */
export const unitNumber = (value: number): string => fmtNumber(roundWeight(value), 1);

/** `62,5 kg` / `137.8 lb` of a number already in the chosen unit. */
export const unitText = (value: number): string => t(`lifts:unit.${getWeightUnit()}`, { value: unitNumber(value) });

/** Whole units with separators (`12.450 kg`) of a volume already in the chosen unit. */
export const unitVolumeText = (value: number): string => t(`lifts:unit.${getWeightUnit()}`, { value: fmtInt(value) });

/** `62,5` / `137.8` of stored kg. */
export const weightNumber = (kg: number): string => unitNumber(kgToUnit(kg));

/** `62,5 kg` / `137.8 lb` of stored kg. */
export const weightText = (kg: number): string => unitText(kgToUnit(kg));

/** Volume of stored kg in whole units with separators: `12.450 kg` / `27.447 lb`. */
export const volumeText = (kg: number): string => unitVolumeText(kgToUnit(kg));

/** `45 s` under a minute, `1:05` from a minute up (seconds in). */
export function secondsText(seconds: number): string {
  if (seconds < 60) return t('lifts:unit.sec', { value: fmtInt(seconds) });
  const total = Math.round(seconds);
  return `${fmtInt(Math.floor(total / 60))}:${String(total % 60).padStart(2, '0')}`;
}

/** A set as it is read in a gym: `60 × 8`, `8 reps` (bodyweight), `60 kg`, `45 s`; null for an empty set. Weights in the chosen unit. */
export function setText(set: { weightKg: number | null; reps: number | null; seconds: number | null }): string | null {
  if (set.seconds !== null && set.seconds > 0) {
    return set.weightKg !== null && set.weightKg > 0
      ? t('lifts:set.weightSeconds', { weight: weightNumber(set.weightKg), time: secondsText(set.seconds) })
      : secondsText(set.seconds);
  }
  if (set.reps !== null && set.reps > 0) {
    return set.weightKg !== null && set.weightKg > 0
      ? t('lifts:set.weightReps', { weight: weightNumber(set.weightKg), reps: fmtInt(set.reps) })
      : t('lifts:set.reps', { count: set.reps, value: fmtInt(set.reps) });
  }
  return set.weightKg !== null && set.weightKg > 0 ? weightText(set.weightKg) : null;
}
