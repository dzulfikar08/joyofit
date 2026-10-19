import { estimateBody, type BodyEstimate } from './bodyComposition';
import { bodyFormulaOf } from './registry';
import type { ReportedBody, ScaleReading, ScaleUser } from './types';

export interface BodyResult {
  /** Values the scale itself sent (shown as measured). */
  reported: ReportedBody | null;
  /** A formula estimate from the impedance (shown with an "estimate" label), only when the scale reported no body fat itself. */
  estimate: BodyEstimate | null;
}

/**
 * What body composition a weigh-in can honestly show. The scale's own values win; otherwise, with an impedance and a profile (height, age,
 * sex), the published openScale formula of that scale family gives an estimate. Nothing is invented: no impedance, no profile, no known
 * formula or an out-of-range input means no values.
 */
export function bodyOf(reading: ScaleReading, protocolId: string, user: ScaleUser | null): BodyResult {
  const reported = reading.reported && Object.keys(reading.reported).length > 0 ? reading.reported : null;
  if (reported?.bodyFatPct !== undefined) return { reported, estimate: null };
  const formula = bodyFormulaOf(protocolId);
  const impedance = reading.impedanceOhm ?? 0;
  if (!formula || !user || impedance <= 0) return { reported, estimate: null };
  const estimate = estimateBody(formula, {
    weightKg: reading.weightKg,
    impedanceOhm: impedance,
    user: { heightCm: user.heightCm, ageYears: user.ageYears, male: user.male },
  });
  return { reported, estimate };
}
