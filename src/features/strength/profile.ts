import type { EnergyProfile, Sex } from '@/features/record/energy';
import { watchVo2 } from '@/features/fitness/watchVo2';
import { DEFAULT_AGE } from '@/features/workouts/substrate';
import { HuaweiWear } from '@/wear';

/** Weight used when the person has not entered one in Settings > Profile (the same default the profile form starts with). */
export const DEFAULT_WEIGHT_KG = 70;

function savedWeightKg(): number | null {
  const weight = HuaweiWear.getUserProfile()?.weightKg;
  return typeof weight === 'number' && weight >= 20 && weight <= 300 ? weight : null;
}

/** The person's weight in kg (Settings > Profile), for the energy estimate. */
export function userWeightKg(): number {
  return savedWeightKg() ?? DEFAULT_WEIGHT_KG;
}

/** Whether the weight above is the person's own; false means the estimate ran on the default and the summary says so. */
export function hasUserWeight(): boolean {
  return savedWeightKg() !== null;
}

/** The profile the heart rate energy (Keytel) runs on: the saved weight (or the default), age from the birth year, sex, the watch's VO2max. */
export function userEnergyProfile(): EnergyProfile {
  const profile = HuaweiWear.getUserProfile();
  const age = profile?.birthYear ? new Date().getFullYear() - profile.birthYear : DEFAULT_AGE;
  const sex: Sex = profile?.sex === 'male' || profile?.sex === 'female' ? profile.sex : 'unknown';
  return { weightKg: userWeightKg(), age: Math.min(100, Math.max(10, age)), sex, vo2max: watchVo2() };
}
