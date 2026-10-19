import type { ScaleUser } from './types';

/** The slice of the saved profile (Settings > Profile) the scale code reads. */
export interface ProfileLike {
  heightCm: number;
  weightKg: number;
  birthYear: number;
  sex: 'male' | 'female' | 'unknown';
}

/** The person for body estimates and for protocols that send user data to the scale. Null when height, birth year or sex is missing or implausible. */
export function scaleUserFrom(profile: ProfileLike | null, year: number): ScaleUser | null {
  if (!profile || (profile.sex !== 'male' && profile.sex !== 'female')) return null;
  const ageYears = year - profile.birthYear;
  if (!(profile.heightCm >= 100 && profile.heightCm <= 230) || !(ageYears >= 10 && ageYears <= 100)) return null;
  return { heightCm: profile.heightCm, ageYears, male: profile.sex === 'male' };
}

/** The weight in the profile, used as the "is this you" yardstick when no weigh-in exists yet. */
export function profileWeightKg(profile: ProfileLike | null): number | null {
  return profile && profile.weightKg >= 20 && profile.weightKg <= 300 ? profile.weightKg : null;
}
