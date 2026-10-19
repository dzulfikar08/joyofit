/**
 * Multi-user guard: a scale in a shared bathroom weighs everyone. A weight that differs a lot from this person's last one is asked about
 * ("Ini kamu?") instead of being saved silently. Day-to-day body weight moves about 1 to 2 percent, so the default threshold sits well
 * above that and well below the gap between two adults in a household.
 */
export const DEFAULT_GUARD_PERCENT = 6;

/** The last weight is only a good yardstick for a while; after this many days of silence nobody is asked (a person can change a lot). */
export const GUARD_REFERENCE_MAX_AGE_DAYS = 45;

export interface Reference {
  weightKg: number;
  /** Epoch ms of that weigh-in; null when unknown (the JoyoRogo profile weight). */
  at: number | null;
}

/** True when the new weight is far enough from the reference that the person must confirm it is theirs. */
export function needsConfirmation(weightKg: number, reference: Reference | null, now: number, percent = DEFAULT_GUARD_PERCENT): boolean {
  if (!reference || !(reference.weightKg > 0) || percent <= 0) return false;
  if (reference.at !== null && now - reference.at > GUARD_REFERENCE_MAX_AGE_DAYS * 86_400_000) return false;
  return Math.abs(weightKg - reference.weightKg) / reference.weightKg > percent / 100;
}
