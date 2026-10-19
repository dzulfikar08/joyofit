import type { BodyEstimate } from '../bodyComposition';
import type { ReportedBody } from '../types';

export type BodyKey = 'fat' | 'water' | 'muscle' | 'bone' | 'visceral' | 'bmr' | 'bmi';

export interface BodyValue {
  key: BodyKey;
  /** Already rounded for display (one decimal, whole kcal / rating). */
  value: number;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** The body values of a weigh-in that exist, in display order. Missing values are left out, never zero. */
export function bodyValues(source: Pick<ReportedBody, 'bodyFatPct' | 'waterPct' | 'musclePct' | 'boneKg' | 'visceralFat' | 'bmrKcal' | 'bmi'> | BodyEstimate | null): BodyValue[] {
  if (!source) return [];
  const out: BodyValue[] = [];
  const add = (key: BodyKey, value: number | undefined, round: (n: number) => number = round1) => {
    if (value !== undefined && Number.isFinite(value) && value > 0) out.push({ key, value: round(value) });
  };
  add('fat', source.bodyFatPct);
  add('water', source.waterPct);
  add('muscle', source.musclePct);
  add('bone', source.boneKg);
  add('visceral', source.visceralFat, Math.round);
  add('bmr', source.bmrKcal, Math.round);
  add('bmi', source.bmi);
  return out;
}
