import type { LiveLocation, LiveWorkout, LiveWorkoutStatus } from '@/wear';

import { averagePace, footKind, type FieldSportKind } from './runFields';

/**
 * What the live screen works with: the native `LiveWorkout` payload turned into the shape the screens read (sport kind, the nine
 * figures with the phone's GPS as the fallback for the ones the band does not send, the phone's position). Pure: the hook
 * (`useLiveSession.ts`) only feeds it.
 */
export type SportKind = FieldSportKind;

/** The sports that record the phone's GPS, as `record/controller.ts` has it. */
export const GPS_KINDS: readonly SportKind[] = ['run', 'walk', 'ride', 'hike'];

/** Every figure is null while unknown. */
export interface LiveSessionMetrics {
  durationS: number | null;
  distanceM: number | null;
  paceSPerKm: number | null;
  avgPaceSPerKm: number | null;
  hr: number | null;
  calories: number | null;
  /** Steps per minute on foot, revolutions per minute on a bike. */
  cadence: number | null;
  elevationGainM: number | null;
  altitudeM: number | null;
}

export interface LiveSession {
  id: number;
  /** The native payload, for what the contract does not carry (source, zones, fuel estimate, `endSuspected` ...). */
  raw: LiveWorkout;
  state: LiveWorkoutStatus;
  /** Null when nothing says what the workout is (no sport tag, no GPS request): the screen may then offer the strength logger. */
  sportKind: SportKind | null;
  /** The kind is a guess (an outdoor workout the band did not name): the screen lets the person pick run, walk, ride or hike. */
  sportKindInferred: boolean;
  /** An outdoor, GPS workout: never a strength session, and the map applies. */
  gpsSport: boolean;
  metrics: LiveSessionMetrics;
  /** The phone's last GPS fix; null before the first one, and on a build without it. */
  location: LiveLocation | null;
  /** The phone's GPS is reaching the screen: a fix less than `GPS_FRESH_MS` old. */
  gpsFix: boolean;
  /**
   * The clock of this session was started by a word from the watch. False: only by the person moving (a watch that gives no sign of its
   * start). Null: this build does not say (it could have started the clock from the first GPS request, which cannot be told afterwards).
   */
  clockConfirmed: boolean | null;
}

/** A fix older than this does not count as "GPS is working" (the phone's GPS ticks about once a second). */
export const GPS_FRESH_MS = 10_000;

/** Huawei sport types (`WorkoutSportTypes.kt`) the live screen knows by kind. `outdoor`: the sport records a GPS track. */
const KIND_BY_TYPE: Record<number, { kind: SportKind; outdoor: boolean }> = {
  1: { kind: 'run', outdoor: true },
  2: { kind: 'walk', outdoor: true },
  3: { kind: 'ride', outdoor: true },
  4: { kind: 'hike', outdoor: true },
  5: { kind: 'run', outdoor: false },
  7: { kind: 'ride', outdoor: false },
  11: { kind: 'run', outdoor: true },
  13: { kind: 'walk', outdoor: false },
  14: { kind: 'hike', outdoor: true },
};

/** The kind of a Huawei sport type; a type the table has a name for but this screen has no kind for is `other`. */
export function sportKindOf(sportType: number): SportKind {
  return KIND_BY_TYPE[sportType]?.kind ?? 'other';
}

/**
 * The sport kind and whether it is a guess. `override`: what the person picked. `lastPick`: what they picked for the last workout the band
 * did not name, the better guess for the next one (a walker walks again).
 */
export function deriveSportKind(
  live: LiveWorkout,
  override: SportKind | null,
  lastPick: SportKind | null = null,
): { kind: SportKind | null; inferred: boolean } {
  if (override !== null) return { kind: override, inferred: false };
  if (live.sportType !== null) return { kind: sportKindOf(live.sportType), inferred: false };
  // The band asks for the phone's GPS (`18/02`) only in an outdoor workout, and neither the Fit 4 Pro nor (as far as known) a Band 11 names
  // the sport on the link, not even after GO (`17/03` `02 01 03 03`, 2026-10-25): the last pick, else running, the usual one.
  if (asksForGps(live)) return { kind: lastPick ?? 'run', inferred: true };
  return { kind: null, inferred: false };
}

/** The watch asked for the phone's GPS: `gpsRequested` on a current build, a session opened by the request (`source` `gps`) before it. */
function asksForGps(live: LiveWorkout): boolean {
  return live.gpsRequested === true || live.source === 'gps';
}

/** An outdoor GPS workout: a sport type that records a track, a GPS request from the band, or a kind the person picked that does. */
export function isGpsSport(live: LiveWorkout, override: SportKind | null): boolean {
  if (live.sportType !== null) {
    const known = KIND_BY_TYPE[live.sportType];
    if (known) return known.outdoor || asksForGps(live);
    return asksForGps(live);
  }
  return asksForGps(live) || (override !== null && GPS_KINDS.includes(override));
}

const firstPositive = (...values: (number | null | undefined)[]): number | null => {
  for (const v of values) if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  return null;
};

const firstNumber = (...values: (number | null | undefined)[]): number | null => {
  for (const v of values) if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
};

/**
 * The figures of a session. The band's number wins when it is above zero (a band without GPS reports a flat 0 for distance and a missing
 * pace, which must not hide the phone's own numbers); otherwise the phone's GPS track fills it; otherwise whatever the band sent (a real 0).
 */
export function deriveMetrics(live: LiveWorkout, kind: SportKind | null): LiveSessionMetrics {
  const distanceM = firstPositive(live.distanceM, live.gpsDistanceM) ?? firstNumber(live.distanceM, live.gpsDistanceM);
  const paceSPerKm = firstPositive(live.paceSecPerKm, live.speedKmh ? 3600 / live.speedKmh : null, live.gpsPaceSecPerKm);
  const gpsRise = live.gpsRiseM == null ? null : Math.round(live.gpsRiseM);
  const elevationGainM = firstPositive(live.riseM, gpsRise) ?? firstNumber(live.riseM, gpsRise);
  const cadence = footKind(kind) || kind === null ? firstPositive(live.stepRate, live.cadence) : firstPositive(live.cadence, live.stepRate);
  return {
    durationS: live.durationSec,
    distanceM,
    paceSPerKm,
    avgPaceSPerKm: averagePace(live.durationSec, distanceM),
    hr: live.heartRate,
    calories: firstNumber(live.calories, live.activeCalories),
    cadence,
    elevationGainM,
    altitudeM: live.altitudeM,
  };
}

/**
 * The session the screens read. `override`: the kind the person picked for this session (`useLiveSession.setSportKind`). `lastPick`:
 * the kind they picked for the last workout the band did not name, the guess for this one (else running).
 */
export function deriveSession(live: LiveWorkout, override: SportKind | null, nowMs: number, lastPick: SportKind | null = null): LiveSession {
  const { kind, inferred } = deriveSportKind(live, override, lastPick);
  const location = live.location ?? null;
  const locatedAt = live.locationAt ?? null;
  return {
    id: live.id,
    raw: live,
    state: live.status,
    sportKind: kind,
    sportKindInferred: inferred,
    gpsSport: isGpsSport(live, override),
    metrics: deriveMetrics(live, kind),
    location,
    gpsFix: location !== null && locatedAt !== null && live.status !== 'ended' && nowMs - locatedAt <= GPS_FRESH_MS,
    clockConfirmed: live.clockConfirmed ?? null,
  };
}
