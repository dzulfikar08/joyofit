import { hrZoneName } from '@/features/hrzones/names';
import { zoneIndex, type HrZones } from '@/features/hrzones/zones';
import { fmtDecimal, fmtInt } from '@/i18n';
import type { LiveWorkout } from '@/wear';

/** Workout time now: the watch's last figure plus the time since it, while running (the watch pushes about every second). */
export function elapsedSec(live: LiveWorkout, nowMs: number): number {
  const base = live.durationSec ?? 0;
  if (live.status !== 'running' || live.durationSec === null) return base;
  // Capped so a stalled stream (link lost) does not keep counting for minutes.
  return base + Math.min(Math.max(0, (nowMs - live.updatedAt) / 1000), MAX_EXTRAPOLATE_SEC);
}

const MAX_EXTRAPOLATE_SEC = 30;

/** Pace suits running and walking (per km), speed suits cycling. Huawei types: 3 cycling, 7 indoor cycling. */
export function prefersSpeed(live: LiveWorkout): boolean {
  return live.sportType === 3 || live.sportType === 7;
}

/** `5.2 g` under 10 g, whole grams above. */
export function formatGrams(grams: number): string {
  return grams < 10 ? fmtDecimal(grams, 1) : fmtInt(grams);
}

/** Distance as a tile shows it: `850` m, then `1.24` km. */
export function distanceParts(meters: number): { value: string; unit: string } {
  return meters >= 1000 ? { value: fmtDecimal(meters / 1000, 2), unit: 'km' } : { value: fmtInt(meters), unit: 'm' };
}

/** `5:32` (minutes per km) */
export function paceValue(secPerKm: number): string {
  const total = Math.round(secPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * What the screen tells the user. `searching`: the watch asked for the phone's GPS but its workout has not started (it is
 * still looking for a fix, or counting down), so JoyoFit's own session does not count time yet. `preparing`: the same on a
 * watch that sends its own numbers.
 */
export type LivePhase = 'searching' | 'preparing' | 'running' | 'paused' | 'ended';

export function livePhase(live: LiveWorkout): LivePhase {
  if (live.status !== 'preparing') return live.status;
  return live.source === 'watch' ? 'preparing' : 'searching';
}

/** The clock shows a time only once the workout runs on the watch; until then it stays blank. */
export function showsClock(live: LiveWorkout): boolean {
  const phase = livePhase(live);
  return live.durationSec !== null && phase !== 'searching' && phase !== 'preparing';
}

/**
 * The watch looks to have stopped without saying so (it still asks for GPS but reports no workout, or went quiet), so the
 * screen asks instead of dropping the session silently. `kept`: the user chose to keep going while this lasts.
 */
export function endPromptVisible(live: LiveWorkout, kept: boolean): boolean {
  return live.status !== 'ended' && live.endSuspected === true && !kept;
}

/** True while the watch is still recording (the live screen and the Today banner show it). */
export function isActive(live: LiveWorkout | null): live is LiveWorkout {
  return live !== null && live.status !== 'ended';
}

/** The person's zone (`@/features/hrzones`) of a reading, named the way Huawei Health names its zones (five for the maximum method, six for the reserve method). Below zone 1 is no zone. */
export function heartZone(heartRate: number, zones: HrZones): { zone: number; label: string } | null {
  const zone = zoneIndex(heartRate, zones);
  if (zone === 0) return null;
  return { zone, label: hrZoneName(zones.method, zone) };
}
