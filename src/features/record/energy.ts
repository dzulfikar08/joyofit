// Energy of a phone-recorded session. With a heart rate strap the figure comes from the heart rate (Keytel et al. 2005); without one it is
// MET x body weight, like a manual workout. The watch link's phone-side estimate (LiveWorkoutCodec, native) still uses the equation
// without VO2max and the flat 1.2 kcal/min floor until the next native build.
// No React Native imports: runs under bun test.

export type Sex = 'male' | 'female' | 'unknown';

export interface EnergyProfile {
  weightKg: number;
  /** Whole years. */
  age: number;
  sex: Sex;
  /**
   * The watch's own VO2max (ml/kg/min) when it has measured one (`watchVo2.ts`); null or absent otherwise. JoyoFit's estimate from
   * resting heart rate is deliberately not used here: it rests on 220 - age itself, so its error would stack on the equation's.
   */
  vo2max?: number | null;
}

/** A body at rest burns about 1 MET, 1 kcal per kg per hour: the floor under the equation, which turns negative for light effort. */
export function restKcalPerMin(weightKg: number): number {
  return weightKg / 60;
}

/** A VO2max the equation may use: a human value (10..90 ml/kg/min, the range `plausibleVo2` accepts), else null. */
function usableVo2(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 10 && v <= 90 ? v : null;
}

/**
 * kcal per minute at a heart rate, Keytel et al. (2005), kJ/min / 4.184. With a measured VO2max the paper's fitness model:
 * male -95.7735 + 0.634 HR + 0.404 VO2max + 0.394 kg + 0.271 age, female -59.3954 + 0.450 HR + 0.380 VO2max + 0.103 kg + 0.274 age.
 * Without it the population model: male -55.0969 + 0.6309 HR + 0.1988 kg + 0.2017 age, female -20.4022 + 0.4472 HR - 0.1263 kg + 0.074 age
 * (the negative weight term is the paper's own). Unknown sex takes the mean of the two. Never below `restKcalPerMin`.
 * (Jeremy's review JURNAL-02, second iteration: docs/reviews/2026-11-jeremy-algorithm-review.md.)
 */
export function keytelKcalPerMin(hr: number, p: EnergyProfile): number {
  const vo2 = usableVo2(p.vo2max);
  const male =
    vo2 !== null
      ? (-95.7735 + 0.634 * hr + 0.404 * vo2 + 0.394 * p.weightKg + 0.271 * p.age) / 4.184
      : (-55.0969 + 0.6309 * hr + 0.1988 * p.weightKg + 0.2017 * p.age) / 4.184;
  const female =
    vo2 !== null
      ? (-59.3954 + 0.45 * hr + 0.38 * vo2 + 0.103 * p.weightKg + 0.274 * p.age) / 4.184
      : (-20.4022 + 0.4472 * hr - 0.1263 * p.weightKg + 0.074 * p.age) / 4.184;
  const value = p.sex === 'male' ? male : p.sex === 'female' ? female : (male + female) / 2;
  return Math.max(restKcalPerMin(p.weightKg), value);
}

/** kcal per second at a MET value (1 MET = 1 kcal per kg per hour). */
export function metKcalPerSec(met: number, weightKg: number): number {
  return (met * weightKg) / 3600;
}

/** Share of a session that has a heart rate from which the heart rate figure is trusted over the MET estimate. */
export const HR_COVERAGE_MIN = 0.5;
