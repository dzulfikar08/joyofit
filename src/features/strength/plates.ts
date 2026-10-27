import type { WeightUnit } from './units';

/**
 * Plate calculator: which plates go on each side of the bar for a target weight. Pure and in the display unit (kg or lb); the
 * caller converts the stored kg first. Plates are the common gym sets with unlimited pairs, loaded largest first.
 */

/** Plates per unit, heaviest first. */
export const PLATES: Record<WeightUnit, readonly number[]> = {
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
  lb: [45, 35, 25, 10, 5, 2.5],
};

/** The bar the calculator starts with, per unit. */
export const DEFAULT_BAR: Record<WeightUnit, number> = { kg: 20, lb: 45 };

/** Step of the bar stepper, per unit. */
export const BAR_STEP: Record<WeightUnit, number> = { kg: 2.5, lb: 5 };

export const MAX_BAR = 50;

export interface PlateCount {
  /** Weight of one plate in the display unit. */
  weight: number;
  /** How many of it on each side. */
  count: number;
}

export interface PlateLoad {
  /** Plates of one side, heaviest first (the one next to the bar is the first). */
  perSide: PlateCount[];
  /** The weight the bar and plates add up to, in the display unit. */
  reached: number;
  /** Target minus reached (both sides together), 0 when the target is hit. Never negative. */
  remainder: number;
  /** The target is lighter than the empty bar: no plates, `reached` is the bar. */
  belowBar: boolean;
}

/** Hundredths as an integer, so 1.25 plates and a float like 102.05800000000001 add up exactly. */
const hundredths = (n: number): number => Math.round(n * 100);

/** Plates to put on each side of `bar` to reach `target`, all in `unit`. A null, zero or negative target is an empty load. */
export function platesFor(target: number | null, bar: number, unit: WeightUnit): PlateLoad {
  const barH = hundredths(bar);
  const targetH = target !== null && Number.isFinite(target) && target > 0 ? hundredths(target) : 0;
  if (targetH < barH) return { perSide: [], reached: barH / 100, remainder: 0, belowBar: targetH > 0 };

  const sideH = Math.floor((targetH - barH) / 2);
  let left = sideH;
  const perSide: PlateCount[] = [];
  for (const plate of PLATES[unit]) {
    const plateH = hundredths(plate);
    const count = Math.floor(left / plateH);
    if (count > 0) {
      perSide.push({ weight: plate, count });
      left -= count * plateH;
    }
  }
  const reachedH = barH + 2 * (sideH - left);
  return { perSide, reached: reachedH / 100, remainder: (targetH - reachedH) / 100, belowBar: false };
}

/** The distinct loads (kg, above zero) of an exercise's sets in set order, the first one still to do (else the last) in front: what the sheet offers. */
export function plateLoads(sets: readonly { weightKg: number | null; done: boolean }[]): number[] {
  const loads = [...new Set(sets.flatMap((set) => (set.weightKg !== null && set.weightKg > 0 ? [set.weightKg] : [])))];
  const lead = sets.find((set) => !set.done && set.weightKg !== null && set.weightKg > 0) ?? sets.findLast((set) => set.weightKg !== null && set.weightKg > 0);
  if (!lead || lead.weightKg === null) return loads;
  return [lead.weightKg, ...loads.filter((kg) => kg !== lead.weightKg)];
}
