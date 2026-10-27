/**
 * The weight unit of the logger. Everything is stored in kg (records, cloud, calc, Strava); only what the person reads and types is
 * in the chosen unit. The unit is module state (like the i18n locale) so the pure formatters read it without a parameter; the root
 * layout sets it from `StrengthSettings.weightUnit` on load (`useWeightUnit.ts`) and the settings screen whenever the setting changes.
 * Screens that draw weights read it through `useWeightUnit()` so they redraw on a change.
 */
export type WeightUnit = 'kg' | 'lb';

/** Exact by definition (international avoirdupois pound). */
export const KG_PER_LB = 0.45359237;

export const WEIGHT_UNITS: readonly WeightUnit[] = ['kg', 'lb'];

export const isWeightUnit = (value: unknown): value is WeightUnit => value === 'kg' || value === 'lb';

let current: WeightUnit = 'kg';
const listeners = new Set<() => void>();

export const getWeightUnit = (): WeightUnit => current;

export function setWeightUnit(unit: WeightUnit): void {
  if (unit === current) return;
  current = unit;
  for (const listener of listeners) listener();
}

/** For `useSyncExternalStore`: called after the unit changed. Returns the unsubscribe. */
export function subscribeWeightUnit(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** kg as the person reads it in `unit`. */
export const kgToUnit = (kg: number, unit: WeightUnit = current): number => (unit === 'kg' ? kg : kg / KG_PER_LB);

/** A number typed or read in `unit`, back to kg for storage. */
export const unitToKg = (value: number, unit: WeightUnit = current): number => (unit === 'kg' ? value : value * KG_PER_LB);

/**
 * A weight in `unit` rounded for reading. kg: whole from 100 up, one decimal below (a 102,5 kg bar is "103", noise past a point). lb:
 * one decimal everywhere, no trailing zero once formatted: 2.5 lb is the smallest jump of a pair of plates, and it must stay readable
 * at 102.5 and 225.5 lb, where whole pounds would hide it. Round-trip safe: a weight typed in lb with at most one decimal reads back the
 * same after the 0.01 kg rounding of `clampWeight` (that rounding is 0.011 lb at most, the display step is 0.1 lb).
 */
export function roundWeight(value: number, unit: WeightUnit = current): number {
  if (unit === 'lb') return Math.round(value * 10) / 10;
  return value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
}

/** Stored kg as a number to read in `unit` (see `roundWeight`). */
export const displayWeight = (kg: number, unit: WeightUnit = current): number => roundWeight(kgToUnit(kg, unit), unit);

/**
 * Stored kg as the number a weight box shows for editing, in `unit`: up to two decimals of kg (as before), one decimal of lb. Never the
 * whole-number display rounding: a box must not turn 102,5 into 103 under the person's thumb.
 */
export function inputWeight(kg: number, unit: WeightUnit = current): number {
  return unit === 'lb' ? Math.round(kgToUnit(kg, 'lb') * 10) / 10 : Math.round(kg * 100) / 100;
}
