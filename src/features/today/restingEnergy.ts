import { ageFromBirthYear } from '@/features/ai/person';

/**
 * Resting energy (BMR) for the Today calories tile, which shows active + resting so far. Everything else in JoyoFit
 * (JoyoRogo's `activeKcal`, the AI digest, Health Connect, workouts) stays active-only.
 *
 * Source order, first that works:
 *  1. JoyoRogo's `targets.bmr`, as last cached on this phone (`readCachedBmr`); no network call is made for it.
 *  2. Mifflin-St Jeor (1990) from Settings > Body profile: 10 x kg + 6.25 x cm - 5 x age + s, s = +5 male, -161 female.
 *     Sex "unknown" uses the midpoint -78 (the mean of the two): the tile already says it is an estimate and the error is at
 *     most 83 kcal/day either way, which beats hiding the total from people who never set a sex.
 *  3. null: a missing or implausible height, weight or birth year gives no number. There is no invented default body.
 */
export interface BodyProfile {
  heightCm: number;
  weightKg: number;
  birthYear: number;
  sex: 'male' | 'female' | 'unknown';
}

export type RestingSource = 'rogo' | 'profile';

export interface Bmr {
  /** kcal per day. */
  kcal: number;
  source: RestingSource;
}

const MIN_BMR = 500;
const MAX_BMR = 5000;
const SEX_TERM = { male: 5, female: -161, unknown: -78 } as const;
const DAY_SEC = 86400;

const inRange = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** Mifflin-St Jeor in kcal/day; null when height, weight or birth year is missing or implausible. */
export function mifflinStJeor(profile: BodyProfile | null | undefined, nowYear: number): number | null {
  if (!profile || !inRange(profile.heightCm, 100, 250) || !inRange(profile.weightKg, 20, 300)) return null;
  const age = ageFromBirthYear(profile.birthYear, nowYear);
  if (age === null || age < 10 || age > 110) return null;
  const sex = profile.sex === 'male' || profile.sex === 'female' ? profile.sex : 'unknown';
  const kcal = 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * age + SEX_TERM[sex];
  return inRange(kcal, MIN_BMR, MAX_BMR) ? Math.round(kcal) : null;
}

/** The BMR per day: JoyoRogo's when cached, else Mifflin-St Jeor from the profile, else null. */
export function bmrPerDay(input: { rogoBmr: number | null; profile: BodyProfile | null | undefined; nowYear: number }): Bmr | null {
  if (inRange(input.rogoBmr, MIN_BMR, MAX_BMR)) return { kcal: Math.round(input.rogoBmr), source: 'rogo' };
  const kcal = mifflinStJeor(input.profile, input.nowYear);
  return kcal === null ? null : { kcal, source: 'profile' };
}

/**
 * Resting energy burned by `nowSec` in the local day that starts at `dayStart` (unix seconds): the BMR times the elapsed
 * fraction of the day. A day that has ended counts in full. The day is taken as 24 h; a DST change would make it 23 or 25 h,
 * an error under 5%, and the app's target zones (Asia/Jakarta and the like) have no DST.
 */
export function restingSoFar(bmr: number, dayStart: number, nowSec: number): number {
  const elapsed = Math.min(Math.max(nowSec - dayStart, 0), DAY_SEC);
  return Math.round((bmr * elapsed) / DAY_SEC);
}
