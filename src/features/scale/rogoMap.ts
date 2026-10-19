import type { ScaleReading } from './types';

/** `weight.checkIn` of JoyoRogo (packages/api/src/routers/weight.ts) accepts 25 to 400 kg. */
export const ROGO_MIN_KG = 25;
export const ROGO_MAX_KG = 400;

const WIB_OFFSET_MS = 7 * 3_600_000;

/** The `YYYY-MM-DD` day JoyoRogo files a weigh-in under: Jakarta (UTC+7, no daylight saving), the way its `jakartaToday()` counts. */
export function jakartaDay(epochMs: number): string {
  return new Date(epochMs + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

export interface RogoCheckIn {
  weightKg: number;
  date: string;
}

/**
 * What `weight.checkIn` gets for a weigh-in: the weight to 0.1 kg (what a person types) and the Jakarta day of the moment it was taken.
 * JoyoRogo keeps one row per day (the last weigh-in of the day wins) and has no field for the source or for body composition, so
 * nothing else is sent. Null when the weight is outside what JoyoRogo accepts.
 */
export function toRogoCheckIn(reading: Pick<ScaleReading, 'weightKg'>, takenAt: number): RogoCheckIn | null {
  const weightKg = Math.round(reading.weightKg * 10) / 10;
  if (!Number.isFinite(weightKg) || weightKg < ROGO_MIN_KG || weightKg > ROGO_MAX_KG) return null;
  return { weightKg, date: jakartaDay(takenAt) };
}
