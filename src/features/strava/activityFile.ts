/**
 * The file JoyoFit sends to Strava for one workout: a FIT activity built from the `workouts` row, its `workout_points`
 * and the figures of its `summary_json`.
 *
 * Strava keeps the numbers a file carries, so the file carries the watch's: every sample of the workout from its start
 * to its end (GPS fixes and heart-rate-only samples, so the elapsed time is the whole workout, not just the GPS part),
 * a cumulative distance on every record, scaled so the last one is exactly the watch's distance (raw GPS distance
 * drifts), and the watch's active time, calories, heart rate, elevation gain and step-based cadence on the lap and the
 * session. Nothing is invented: what the watch does not provide is left out of the file. Pure functions, no React Native
 * imports, so they run under `bun test`.
 */

import { type FitFieldDef, type FitFieldType, type FitValue, FitWriter, toFitTime, toSemicircles } from './fitEncoder';
import { plausibleStepLength } from '../workouts/analysis/stride';
import { movingOf } from '../workouts/times';
import { FIT_MANUFACTURER_DEVELOPMENT, type StravaDevice } from './device';

export interface StravaWorkout {
  /** Unix seconds. */
  start: number;
  end: number;
  /** The raw Huawei sport type byte. */
  sportType: number;
  sportName: string;
  /** Active seconds. */
  duration: number;
  /** Metres. */
  distance: number;
  calories: number;
  avgHr: number | null;
  maxHr: number | null;
  /** Steps the watch counted; with the active time they give the average cadence of a foot sport. */
  steps?: number;
  /** Metres, from the watch's summary. */
  elevationGain?: number | null;
  elevationLoss?: number | null;
  /** Metres per second, from the watch's summary. */
  maxSpeed?: number | null;
  /** Watts, from `summary_json` (a power meter's recording or an imported file). */
  avgPower?: number | null;
  maxPower?: number | null;
  normalizedPower?: number | null;
  /**
   * Steps per minute on foot, rpm on a bike. The caller resolves them as the workout screen does (`cadenceFigures`: samples, the
   * summary, the watch's per-km blocks, the step count); a foot sport without them takes its cadence from `steps` and the active time.
   */
  avgCadence?: number | null;
  maxCadence?: number | null;
  /** Metres per step, the session's and the single lap's `avg_step_length`. */
  avgStepLengthM?: number | null;
  /** The person marked this ride as an e-bike ride: Strava's `EBikeRide` instead of `Ride`. */
  ebike?: boolean;
  /** Ride metrics of a bike workout (`cycling/analyzeRide`) that the session carries where FIT has a field for them. */
  ride?: StravaRideMetrics;
}

/** What FIT's session message can hold of a ride's analysis; everything is optional and a missing value is not written. */
export interface StravaRideMetrics {
  /** Training stress score. */
  tss?: number | null;
  /** Intensity factor, 0.00 to about 1.5. */
  intensityFactor?: number | null;
  /** Functional threshold power the TSS and IF were computed with, watts. */
  ftp?: number | null;
  /** Mechanical work, kJ. */
  workKj?: number | null;
  /** Mean percent of the left pedal. */
  balanceLeftPct?: number | null;
  /** Net grade over the ride, and the steepest ascent and descent, percent. */
  avgGradePct?: number | null;
  maxGradePct?: number | null;
  minGradePct?: number | null;
}

export interface StravaPoint {
  ts: number;
  lat: number | null;
  lon: number | null;
  alt: number | null;
  hr: number | null;
  /** Metres per second. */
  speed?: number | null;
  /** Steps per minute on foot, rpm on a bike (as `workout_points.cadence`). */
  cadence?: number | null;
  /** Metres per step (as `workout_points.stride`): written as the record's `step_length` only where the point has one. */
  stride?: number | null;
  power?: number | null;
}

/** One lap of a workout with several (a `summary_json.laps` entry); a workout with fewer than two laps is written as one lap. */
export interface StravaLap {
  startTs: number;
  endTs: number;
  distanceM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;
}

export interface StravaSport {
  /** Strava's `sport_type` upload parameter. */
  sportType: string;
  /** Marks a treadmill or bike-trainer session. */
  trainer: boolean;
  /** FIT `sport` and `sub_sport` enum values of the file's lap and session. */
  fitSport: number;
  fitSubSport: number;
}

/** FIT `sport` enum values used below. */
const FIT_SPORT = {
  generic: 0,
  running: 1,
  cycling: 2,
  fitnessEquipment: 4,
  swimming: 5,
  soccer: 7,
  tennis: 8,
  training: 10,
  walking: 11,
  rowing: 15,
  hiking: 17,
  paddling: 19,
  inlineSkating: 30,
  rockClimbing: 31,
  sailing: 32,
  iceSkating: 33,
  standUpPaddleboarding: 37,
  surfing: 38,
  hiit: 62,
  racket: 64,
} as const;

/** FIT `sub_sport` enum values used below. */
const FIT_SUB_SPORT = {
  generic: 0,
  treadmill: 1,
  trail: 3,
  indoorCycling: 6,
  eBikeFitness: 28,
  indoorRowing: 14,
  elliptical: 15,
  stairClimbing: 16,
  lapSwimming: 17,
  openWater: 18,
  strengthTraining: 20,
  indoorWalking: 27,
  yoga: 43,
  pilates: 44,
  squash: 94,
  badminton: 95,
  tableTennis: 97,
} as const;

const entry = (sportType: string, fitSport: number, fitSubSport: number, trainer = false): StravaSport => ({
  sportType,
  trainer,
  fitSport,
  fitSubSport,
});

/** Huawei sport type byte (see `WorkoutSportTypes.kt`) -> Strava `sport_type` and FIT sport. Everything not listed is `Workout`. */
const SPORTS: Readonly<Record<number, StravaSport>> = {
  1: entry('Run', FIT_SPORT.running, FIT_SUB_SPORT.generic),
  2: entry('Walk', FIT_SPORT.walking, FIT_SUB_SPORT.generic),
  3: entry('Ride', FIT_SPORT.cycling, FIT_SUB_SPORT.generic),
  4: entry('Hike', FIT_SPORT.hiking, FIT_SUB_SPORT.generic),
  5: entry('Run', FIT_SPORT.running, FIT_SUB_SPORT.treadmill, true),
  6: entry('Swim', FIT_SPORT.swimming, FIT_SUB_SPORT.lapSwimming),
  7: entry('VirtualRide', FIT_SPORT.cycling, FIT_SUB_SPORT.indoorCycling),
  8: entry('Swim', FIT_SPORT.swimming, FIT_SUB_SPORT.openWater),
  11: entry('TrailRun', FIT_SPORT.running, FIT_SUB_SPORT.trail),
  13: entry('Walk', FIT_SPORT.walking, FIT_SUB_SPORT.indoorWalking, true),
  14: entry('Hike', FIT_SPORT.hiking, FIT_SUB_SPORT.generic),
  128: entry('TableTennis', FIT_SPORT.racket, FIT_SUB_SPORT.tableTennis),
  129: entry('Badminton', FIT_SPORT.racket, FIT_SUB_SPORT.badminton),
  130: entry('Tennis', FIT_SPORT.tennis, FIT_SUB_SPORT.generic),
  131: entry('Soccer', FIT_SPORT.soccer, FIT_SUB_SPORT.generic),
  134: entry('Elliptical', FIT_SPORT.fitnessEquipment, FIT_SUB_SPORT.elliptical),
  135: entry('Rowing', FIT_SPORT.rowing, FIT_SUB_SPORT.indoorRowing),
  136: entry('StairStepper', FIT_SPORT.fitnessEquipment, FIT_SUB_SPORT.stairClimbing),
  137: entry('Yoga', FIT_SPORT.training, FIT_SUB_SPORT.yoga),
  138: entry('Pilates', FIT_SPORT.training, FIT_SUB_SPORT.pilates),
  140: entry('WeightTraining', FIT_SPORT.training, FIT_SUB_SPORT.strengthTraining),
  141: entry('VirtualRide', FIT_SPORT.cycling, FIT_SUB_SPORT.indoorCycling),
  143: entry('HighIntensityIntervalTraining', FIT_SPORT.hiit, FIT_SUB_SPORT.generic),
  145: entry('Crossfit', FIT_SPORT.training, FIT_SUB_SPORT.generic),
  163: entry('InlineSkate', FIT_SPORT.inlineSkating, FIT_SUB_SPORT.generic),
  177: entry('StairStepper', FIT_SPORT.fitnessEquipment, FIT_SUB_SPORT.stairClimbing),
  191: entry('Squash', FIT_SPORT.racket, FIT_SUB_SPORT.squash),
  194: entry('Sail', FIT_SPORT.sailing, FIT_SUB_SPORT.generic),
  195: entry('Surfing', FIT_SPORT.surfing, FIT_SUB_SPORT.generic),
  199: entry('Canoeing', FIT_SPORT.paddling, FIT_SUB_SPORT.generic),
  200: entry('Rowing', FIT_SPORT.rowing, FIT_SUB_SPORT.generic),
  202: entry('StandUpPaddling', FIT_SPORT.standUpPaddleboarding, FIT_SUB_SPORT.generic),
  203: entry('IceSkate', FIT_SPORT.iceSkating, FIT_SUB_SPORT.generic),
  209: entry('Skateboard', FIT_SPORT.generic, FIT_SUB_SPORT.generic),
  210: entry('RockClimbing', FIT_SPORT.rockClimbing, FIT_SUB_SPORT.generic),
};

/**
 * Strava activity type and FIT sport of a Huawei sport. A bike ride outdoors is `Ride`, one indoors (trainer, spinning: the
 * Huawei indoor-cycling sports) is `VirtualRide`, and an outdoor ride the person marked as an e-bike ride is `EBikeRide` (FIT sport
 * stays cycling, so gear and the sport kind do not change; the sub sport says e-bike). Strava takes the `sport_type` upload field
 * over the file's sport.
 */
export function stravaSport(huaweiSportType: number, ebike = false): StravaSport {
  const sport = SPORTS[huaweiSportType] ?? entry('Workout', FIT_SPORT.training, FIT_SUB_SPORT.generic);
  return ebike && sport.sportType === 'Ride' ? entry('EBikeRide', FIT_SPORT.cycling, FIT_SUB_SPORT.eBikeFitness) : sport;
}

/** Stable per workout (its start is unique), so Strava refuses a second upload of the same workout as a duplicate. */
export function externalId(start: number): string {
  return `joyofit-${start}`;
}

/** The file name Strava sees, `joyofit-<start>.fit`: the API upload and the manual upload on strava.com both send this name. */
export function fitFileName(start: number): string {
  return `${externalId(start)}.fit`;
}

interface Sample {
  ts: number;
  lat: number | null;
  lon: number | null;
  alt: number | null;
  hr: number | null;
  speed: number | null;
  cadence: number | null;
  /** Metres per step. */
  stride: number | null;
  power: number | null;
  /** Cumulative metres, filled in by `withDistance`. */
  distance: number;
}

const EARTH_RADIUS_M = 6_371_000;

function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function validFix(lat: number | null, lon: number | null): lat is number {
  return lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
}

/**
 * One sample per second at most, in time order, inside `[start, end]`, with a sample exactly at `start` and at `end` so
 * Strava's elapsed time is the watch's. Several points of one second merge: a fix, an altitude or a heart rate
 * from any of them wins over a missing value.
 */
function collectSamples(workout: StravaWorkout, points: readonly StravaPoint[]): Sample[] {
  const end = Math.max(workout.end, workout.start);
  const bySecond = new Map<number, Sample>();
  const at = (ts: number): Sample => {
    let sample = bySecond.get(ts);
    if (!sample) {
      sample = { ts, lat: null, lon: null, alt: null, hr: null, speed: null, cadence: null, stride: null, power: null, distance: 0 };
      bySecond.set(ts, sample);
    }
    return sample;
  };
  for (const p of points) {
    if (p.ts < workout.start || p.ts > end) continue;
    const sample = at(Math.round(p.ts));
    if (validFix(p.lat, p.lon) && p.lon !== null) {
      sample.lat = p.lat;
      sample.lon = p.lon;
    }
    if (p.alt !== null && Number.isFinite(p.alt)) sample.alt = p.alt;
    if (p.hr !== null && p.hr > 0 && p.hr < 255) sample.hr = Math.round(p.hr);
    if (p.speed !== null && p.speed !== undefined && Number.isFinite(p.speed) && p.speed >= 0 && p.speed < 100) sample.speed = p.speed;
    if (p.cadence !== null && p.cadence !== undefined && Number.isFinite(p.cadence) && p.cadence >= 0 && p.cadence < 500) sample.cadence = Math.round(p.cadence);
    const stride = plausibleStepLength(p.stride);
    if (stride !== null) sample.stride = stride;
    if (p.power !== null && p.power !== undefined && Number.isFinite(p.power) && p.power >= 0 && p.power < 4000) sample.power = Math.round(p.power);
  }
  at(workout.start);
  at(end);
  return [...bySecond.values()].sort((a, b) => a.ts - b.ts);
}

/** A stretch of the workout the watch had paused, in Unix seconds. */
interface Pause {
  start: number;
  end: number;
}

/**
 * Where the watch's pause was. The watch only gives its timer (`duration`), so the pause is `elapsed - timer` seconds long
 * (2 s on a run whose end stamp is 2 s after the timer stopped, minutes for a real pause); Strava reads its moving time from
 * the timer events once a file has a pause (see `activityFile` docs in `times.ts`), so the file always writes it. Where it sat is
 * not stored, but nothing is recorded while the watch is paused, so it lies around the longest stretch the samples leave
 * empty: the longest gap between GPS fixes when the workout has at least two (the watch stops the GPS when it pauses;
 * heart-rate samples may run on or stop a little later), else between any samples. The window is centred on that gap (a gap
 * shorter than the pause is widened to the pause's length, a longer one is cut to it) and kept inside the workout; no
 * sample is dropped. Null only when the watch reports no timer or the timer is not shorter than the elapsed time.
 */
function findPause(workout: StravaWorkout, samples: readonly Sample[]): Pause | null {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last || !(workout.duration > 0)) return null;
  const length = last.ts - first.ts - Math.round(workout.duration);
  if (length < 1) return null;
  const fixes = samples.filter((s) => s.lat !== null);
  const candidates = fixes.length >= 2 ? fixes : samples;
  let gapStart = first.ts;
  let gap = 0;
  for (let i = 1; i < candidates.length; i++) {
    const width = (candidates[i] as Sample).ts - (candidates[i - 1] as Sample).ts;
    if (width > gap) {
      gap = width;
      gapStart = (candidates[i - 1] as Sample).ts;
    }
  }
  const start = Math.min(last.ts - length, Math.max(first.ts, Math.round(gapStart + gap / 2 - length / 2)));
  return { start, end: start + length };
}

/**
 * Cumulative distance from the per-sample speed (m/s), scaled so the last sample is `total`. False (nothing written) when fewer than
 * half of the samples carry a speed or they are all zero. A gap of more than 5 s between samples (a pause) adds nothing.
 */
function speedDistance(samples: Sample[], total: number): boolean {
  const withSpeed = samples.filter((s) => s.speed !== null).length;
  if (withSpeed * 2 < samples.length) return false;
  const cumulative: number[] = [0];
  for (let i = 1; i < samples.length; i++) {
    const s = samples[i] as Sample;
    const dt = s.ts - (samples[i - 1] as Sample).ts;
    cumulative.push((cumulative[i - 1] as number) + (dt <= 5 ? (s.speed ?? 0) * dt : 0));
  }
  const sum = cumulative[cumulative.length - 1] as number;
  if (!(sum > 0)) return false;
  samples.forEach((s, i) => {
    s.distance = ((cumulative[i] as number) * total) / sum;
  });
  return true;
}

/**
 * Fills `distance` on every sample. Distance is spread over the *active* time (the workout without its pause), so the
 * stream reads as moving the whole time the watch was running and as stopped exactly while it was paused:
 * - GPS fixes get the haversine path length scaled so the last fix is at the watch's total; the stretch before the first
 *   fix and the one after the last move at the workout's average speed (the watch has no fix there, not no movement),
 *   and the fixes' path takes the rest;
 * - samples between two fixes, and before and after them, interpolate in active time, so a pause is flat;
 * - without two fixes (treadmill, pool) the distance grows linearly in active time over the whole workout.
 * The first sample is 0 and the last is the total.
 */
function withDistance(samples: Sample[], total: number, pause: Pause | null): void {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!(total > 0) || !first || !last) return;
  const activeAt = (ts: number) => ts - first.ts - (pause ? Math.max(0, Math.min(ts, pause.end) - pause.start) : 0);
  const activeTotal = activeAt(last.ts);
  const linear = (s: Sample) => (activeTotal > 0 ? (total * activeAt(s.ts)) / activeTotal : 0);
  const fixes: number[] = [];
  samples.forEach((s, i) => {
    if (s.lat !== null) fixes.push(i);
  });
  const cumulative: number[] = [0];
  for (let k = 1; k < fixes.length; k++) {
    const a = samples[fixes[k - 1] as number] as Sample;
    const b = samples[fixes[k] as number] as Sample;
    cumulative.push((cumulative[k - 1] as number) + haversine(a.lat as number, a.lon as number, b.lat as number, b.lon as number));
  }
  const gpsTotal = cumulative[cumulative.length - 1] as number;
  if (fixes.length < 2 || !(gpsTotal > 0) || !(activeTotal > 0)) {
    // No path to scale (no fixes, one fix, or all fixes on one spot): the samples' own speed if most have one (a bike trainer or
    // a treadmill pod), else time.
    if (!speedDistance(samples, total)) for (const s of samples) s.distance = linear(s);
    last.distance = total;
    return;
  }
  const firstFix = samples[fixes[0] as number] as Sample;
  const lastFix = samples[fixes[fixes.length - 1] as number] as Sample;
  const before = (total * activeAt(firstFix.ts)) / activeTotal;
  const after = (total * (activeTotal - activeAt(lastFix.ts))) / activeTotal;
  const scale = (total - before - after) / gpsTotal;
  fixes.forEach((index, k) => {
    (samples[index] as Sample).distance = before + (cumulative[k] as number) * scale;
  });
  const lastFixIndex = fixes[fixes.length - 1] as number;
  for (let i = 0; i < (fixes[0] as number); i++) {
    const s = samples[i] as Sample;
    s.distance = (before * activeAt(s.ts)) / Math.max(1, activeAt(firstFix.ts));
  }
  for (let i = lastFixIndex + 1; i < samples.length; i++) {
    const s = samples[i] as Sample;
    s.distance = lastFix.distance + (after * (activeAt(s.ts) - activeAt(lastFix.ts))) / Math.max(1, activeTotal - activeAt(lastFix.ts));
  }
  for (let k = 1; k < fixes.length; k++) {
    const a = samples[fixes[k - 1] as number] as Sample;
    const b = samples[fixes[k] as number] as Sample;
    const span = activeAt(b.ts) - activeAt(a.ts);
    for (let i = (fixes[k - 1] as number) + 1; i < (fixes[k] as number); i++) {
      const s = samples[i] as Sample;
      s.distance = span > 0 ? a.distance + ((b.distance - a.distance) * (activeAt(s.ts) - activeAt(a.ts))) / span : a.distance;
    }
  }
  last.distance = total;
}

/** FIT message numbers of the global profile. */
const MESG = { fileId: 0, session: 18, lap: 19, record: 20, event: 21, deviceInfo: 23, activity: 34, set: 225 } as const;

/** FIT enum values used below. */
const FIT = {
  fileActivity: 4,
  eventTimer: 0,
  eventSession: 8,
  eventLap: 9,
  eventActivity: 26,
  eventTypeStart: 0,
  eventTypeStop: 1,
  eventTypeStopAll: 4,
  lapTriggerManual: 0,
  lapTriggerSessionEnd: 7,
  sessionTriggerActivityEnd: 0,
  intensityActive: 0,
  activityManual: 0,
  /** `device_index` of the device that made the file: the watch (creator), then the software that wrote the file. */
  deviceCreator: 0,
  deviceSoftware: 1,
  /** `source_type` `local`: the device is the recorder itself, not a paired sensor. */
  sourceLocal: 6,
  /** `set_type` of a set message: 0 rest, 1 active. */
  setActive: 1,
} as const;

/** The software that writes the file; the recording device is the watch when it is known (`options.device`). */
const APP_PRODUCT_ID = 1;
const APP_PRODUCT_NAME = 'JoyoFit';

type Entry = readonly [num: number, type: FitFieldType, value: FitValue];

/** A whole number above zero, or null: what the watch did not measure is not written. */
const positive = (value: number | null | undefined): number | null => (value !== null && value !== undefined && value > 0 ? Math.round(value) : null);

/** FIT's `step_length` and `avg_step_length` are a uint16 of millimetres x 10; a value that is not a human step length is not written. */
const stepLengthRaw = (metres: number | null | undefined): number | null => {
  const length = plausibleStepLength(metres);
  return length === null ? null : Math.round(length * 10_000);
};

/** Mean of `pick` over the samples that have it, null when none does. */
function meanOf(samples: readonly Sample[], pick: (s: Sample) => number | null): { avg: number | null } {
  let sum = 0;
  let count = 0;
  for (const s of samples) {
    const v = pick(s);
    if (v !== null) {
      sum += v;
      count += 1;
    }
  }
  return { avg: count > 0 ? sum / count : null };
}

/**
 * One set of a strength workout as a FIT `set` message (global message 225). Times are epoch milliseconds; `buildFit` rounds them
 * to seconds and keeps them inside the workout. `category` is a FIT `exercise_category` (see `exerciseCategory`).
 */
export interface FitSet {
  startMs: number;
  endMs: number;
  /** Repetitions; null for a timed set. */
  reps: number | null;
  /** Load in kg; null or 0 = bodyweight (no weight field is written). */
  weightKg: number | null;
  /** Active time in ms: the set's `duration` field. */
  durationMs: number;
  category: number;
}

export interface BuiltFit {
  bytes: Uint8Array;
  /** Record messages written. */
  samples: number;
}

/**
 * The FIT activity of one workout: file_id, device_info, a timer start event, one record per sample, a timer stop event
 * (and, when the watch was paused, a stop and start around the pause, see `findPause`), one lap, one session and the
 * activity. The record timestamps run from the workout's start to its end, the session's
 * `total_elapsed_time` is that span, `total_timer_time` the watch's timer (`movingOf`, the time the app shows; the gap to the
 * elapsed time is a timer stop and start, see `findPause`, so the file agrees with itself and with the app) and `total_distance` the watch's
 * distance. Foot sports get the watch's step count as strides (a stride is two steps) and an average cadence of strides
 * per minute over the active time, as Garmin devices write it. `utcOffsetSeconds` is the wearer's offset from UTC at the
 * workout; it defaults to this device's. `device` is the watch that recorded the workout (`stravaDevice`): it becomes
 * the file's manufacturer, product and product name and the creator `device_info`, with JoyoFit as a second device
 * (the software that wrote the file). Without it the file is JoyoFit's own, manufacturer 255.
 * `sets` (a strength workout) are written as `set` messages in time order between the last record and the timer stop: the
 * timestamp is the end of the set, `start_time` its start, both clamped to the file's span, `duration` its active time in ms,
 * `weight` kg x 16, `category` one `exercise_category` (a one element uint16 array) and `message_index` the position.
 */
export function buildFit(
  workout: StravaWorkout,
  points: readonly StravaPoint[],
  options: { utcOffsetSeconds?: number; device?: StravaDevice | null; sets?: readonly FitSet[]; laps?: readonly StravaLap[] } = {},
): BuiltFit {
  const samples = collectSamples(workout, points);
  const total = workout.distance > 0 ? workout.distance : 0;
  const pause = findPause(workout, samples);
  withDistance(samples, total, pause);
  const sport = stravaSport(workout.sportType, workout.ebike);
  // `collectSamples` always has a sample at the start and at the end.
  const start = (samples[0] as Sample).ts;
  const end = (samples[samples.length - 1] as Sample).ts;
  const elapsed = end - start;
  // A FIT timer is never longer than the elapsed time.
  const timer = Math.min(elapsed, movingOf(elapsed, Math.round(workout.duration)));
  const fixes = samples.filter((s) => s.lat !== null && s.lon !== null);
  const firstFix = fixes[0];
  const lastFix = fixes[fixes.length - 1];
  const utcOffset = options.utcOffsetSeconds ?? -new Date(start * 1000).getTimezoneOffset() * 60;

  const avgSpeed = total > 0 && timer > 0 ? total / timer : null;
  const maxSpeed = workout.maxSpeed && workout.maxSpeed > 0 ? Math.max(workout.maxSpeed, avgSpeed ?? 0) : null;
  const foot = sport.fitSport === FIT_SPORT.running || sport.fitSport === FIT_SPORT.walking || sport.fitSport === FIT_SPORT.hiking;
  const strides = foot && workout.steps && workout.steps > 0 ? Math.round(workout.steps / 2) : null;
  /**
   * FIT counts running and walking cadence per leg (strides per minute) in `cadence` plus `fractional_cadence` (1/128 of a stride), so
   * 171 steps per minute is 85 and 64/128; the app keeps steps per minute on foot, rpm on a bike (a bike has no fractional field).
   */
  const fitCadence = (c: number | null | undefined): { whole: number | null; fraction: number | null } => {
    if (c === null || c === undefined || !(c >= 0)) return { whole: null, fraction: null };
    if (!foot) return { whole: Math.min(254, Math.round(c)), fraction: null };
    const legs = Math.round((c / 2) * 128) / 128;
    const whole = Math.min(254, Math.floor(legs));
    return { whole, fraction: Math.round((legs - whole) * 128) };
  };
  const fitCadenceFields = (c: number | null): [number | null, ...(number | null)[]] => {
    const { whole, fraction } = fitCadence(c);
    return foot ? [whole, fraction] : [whole];
  };
  const positiveCadence = (c: number | null | undefined) => fitCadence(c !== null && c !== undefined && c > 0 ? c : null);
  // The caller resolves the figures like the app's analysis does (`cadenceFigures`); a workout without them falls back to the step count over the active time.
  const avgCadence = workout.avgCadence != null && workout.avgCadence > 0
    ? fitCadence(workout.avgCadence)
    : strides !== null && timer > 0
      ? { whole: Math.round(strides / (timer / 60)), fraction: null }
      : { whole: null, fraction: null };
  const maxCadence = positiveCadence(workout.maxCadence);
  const ascent = workout.elevationGain !== null && workout.elevationGain !== undefined && workout.elevationGain >= 0 ? Math.round(workout.elevationGain) : null;
  const descent = workout.elevationLoss !== null && workout.elevationLoss !== undefined && workout.elevationLoss >= 0 ? Math.round(workout.elevationLoss) : null;

  const fit = new FitWriter();
  /** Defines and writes a message used once; fields without a value are left out of its definition. */
  const message = (local: number, global: number, entries: readonly Entry[]) => {
    const present = entries.filter(([, , value]) => value !== null && value !== undefined && !(typeof value === 'number' && Number.isNaN(value)));
    const definition = fit.define(
      local,
      global,
      present.map(([num, type, value]): FitFieldDef => (type === 'string' ? { num, type, size: String(value).length + 1 } : { num, type })),
    );
    fit.write(
      definition,
      present.map(([, , value]) => value),
    );
  };
  const event = (timestamp: number, eventType: number) =>
    message(2, MESG.event, [
      [253, 'uint32', toFitTime(timestamp)],
      [0, 'enum', FIT.eventTimer],
      [1, 'enum', eventType],
      [4, 'uint8', 0],
    ]);

  const recorder = {
    manufacturer: options.device?.manufacturer ?? FIT_MANUFACTURER_DEVELOPMENT,
    product: options.device?.product ?? APP_PRODUCT_ID,
    name: options.device?.name ?? APP_PRODUCT_NAME,
  };
  message(0, MESG.fileId, [
    [0, 'enum', FIT.fileActivity],
    [1, 'uint16', recorder.manufacturer],
    [2, 'uint16', recorder.product],
    // JoyoFit has no device serial; the workout's start is unique per file.
    [3, 'uint32z', start],
    [4, 'uint32', toFitTime(start)],
    [8, 'string', recorder.name],
  ]);
  message(1, MESG.deviceInfo, [
    [253, 'uint32', toFitTime(start)],
    [0, 'uint8', FIT.deviceCreator],
    [2, 'uint16', recorder.manufacturer],
    [4, 'uint16', recorder.product],
    // Hundredths of the firmware's major.minor (the field is a uint16 scaled by 100).
    [5, 'uint16', options.device?.softwareVersion ?? null],
    [25, 'enum', FIT.sourceLocal],
    [27, 'string', recorder.name],
  ]);
  if (options.device) {
    message(7, MESG.deviceInfo, [
      [253, 'uint32', toFitTime(start)],
      [0, 'uint8', FIT.deviceSoftware],
      [2, 'uint16', FIT_MANUFACTURER_DEVELOPMENT],
      [4, 'uint16', APP_PRODUCT_ID],
      [27, 'string', APP_PRODUCT_NAME],
    ]);
  }
  event(start, FIT.eventTypeStart);

  const hasAlt = samples.some((s) => s.alt !== null);
  const hasHr = samples.some((s) => s.hr !== null);
  const recordFields: FitFieldDef[] = [{ num: 253, type: 'uint32' }];
  if (fixes.length > 0) recordFields.push({ num: 0, type: 'sint32' }, { num: 1, type: 'sint32' });
  if (total > 0) recordFields.push({ num: 5, type: 'uint32' });
  if (hasAlt) recordFields.push({ num: 2, type: 'uint16' }, { num: 78, type: 'uint32' });
  if (hasHr) recordFields.push({ num: 3, type: 'uint8' });
  const hasCadence = samples.some((s) => s.cadence !== null);
  const hasStride = samples.some((s) => s.stride !== null);
  const hasSpeed = samples.some((s) => s.speed !== null);
  const hasPower = samples.some((s) => s.power !== null);
  if (hasCadence) recordFields.push({ num: 4, type: 'uint8' });
  if (hasCadence && foot) recordFields.push({ num: 53, type: 'uint8' });
  if (hasStride) recordFields.push({ num: 85, type: 'uint16' });
  // Speed is metres per second x 1000 in both the 16-bit and the enhanced 32-bit field.
  if (hasSpeed) recordFields.push({ num: 6, type: 'uint16' }, { num: 73, type: 'uint32' });
  if (hasPower) recordFields.push({ num: 7, type: 'uint16' });
  const record = fit.define(3, MESG.record, recordFields);
  // The watch's pause, if any, as a timer stop after the last record at or before its start and a timer start before the
  // first record at or after its end; Strava takes the moving time of a run from these events when a file has any.
  let pauseStopped = pause === null;
  let pauseResumed = pause === null;
  for (const s of samples) {
    if (pause && !pauseStopped && s.ts > pause.start) {
      event(pause.start, FIT.eventTypeStopAll);
      pauseStopped = true;
    }
    if (pause && !pauseResumed && s.ts >= pause.end) {
      event(pause.end, FIT.eventTypeStart);
      pauseResumed = true;
    }
    const values: FitValue[] = [toFitTime(s.ts)];
    if (fixes.length > 0) values.push(s.lat === null ? null : toSemicircles(s.lat), s.lon === null ? null : toSemicircles(s.lon));
    // Centimetres.
    if (total > 0) values.push(s.distance * 100);
    // Altitude is `(metres + 500) * 5` in both the 16-bit and the enhanced 32-bit field.
    if (hasAlt) values.push(s.alt === null ? null : (s.alt + 500) * 5, s.alt === null ? null : (s.alt + 500) * 5);
    if (hasHr) values.push(s.hr);
    if (hasCadence) values.push(...fitCadenceFields(s.cadence));
    if (hasStride) values.push(s.stride === null ? null : Math.round(s.stride * 10_000));
    if (hasSpeed) values.push(s.speed === null ? null : s.speed * 1000, s.speed === null ? null : s.speed * 1000);
    if (hasPower) values.push(s.power);
    fit.write(record, values);
  }

  if (options.sets && options.sets.length > 0) {
    const definition = fit.define(8, MESG.set, [
      { num: 254, type: 'uint32' },
      { num: 0, type: 'uint32' },
      { num: 3, type: 'uint16' },
      { num: 4, type: 'uint16' },
      { num: 5, type: 'uint8' },
      { num: 6, type: 'uint32' },
      // `category` is an array field: its size is two bytes per element, so one uint16 is an array of one.
      { num: 7, type: 'uint16' },
      { num: 10, type: 'uint16' },
    ]);
    const within = (seconds: number) => Math.min(end, Math.max(start, Math.round(seconds)));
    [...options.sets]
      .sort((a, b) => a.endMs - b.endMs)
      .forEach((set, index) => {
        const stop = within(set.endMs / 1000);
        const begin = Math.min(stop, within(set.startMs / 1000));
        fit.write(definition, [
          toFitTime(stop),
          Math.min(set.durationMs, (stop - start) * 1000),
          set.reps,
          set.weightKg !== null && set.weightKg > 0 ? set.weightKg * 16 : null,
          FIT.setActive,
          toFitTime(begin),
          set.category,
          index,
        ]);
      });
  }

  event(end, FIT.eventTypeStopAll);

  const position = (fix: Sample | undefined, lat: number, long: number): Entry[] => [
    [lat, 'sint32', fix && fix.lat !== null ? toSemicircles(fix.lat) : null],
    [long, 'sint32', fix && fix.lon !== null ? toSemicircles(fix.lon) : null],
  ];
  const calories = positive(workout.calories);
  const laps = options.laps && options.laps.length >= 2 ? options.laps : null;
  /** Average and peak of a channel over some samples; whole numbers, null when the stretch has no reading. */
  const stats = (inLap: readonly Sample[], pick: (s: Sample) => number | null): { avg: number | null; max: number | null } => {
    const values = inLap.map(pick).filter((v): v is number => v !== null);
    return values.length === 0 ? { avg: null, max: null } : { avg: Math.round(values.reduce((a, b) => a + b, 0) / values.length), max: Math.max(...values) };
  };
  const power = stats(samples, (s) => s.power);
  const sessionPower = {
    avg: positive(workout.avgPower) ?? positive(power.avg),
    max: positive(workout.maxPower) ?? positive(power.max),
    normalized: positive(workout.normalizedPower),
  };

  const ride = workout.ride;
  /** FIT `left_right_balance_100`: the percent x 100 in the low 14 bits and 0x8000 when the share is the right pedal's; ours is the left's. */
  const balance = ride?.balanceLeftPct != null && ride.balanceLeftPct > 0 && ride.balanceLeftPct < 100 ? Math.round(ride.balanceLeftPct * 100) : null;

  if (laps) {
    laps.forEach((lap, index) => {
      const last = index === laps.length - 1;
      const lapStart = index === 0 ? start : Math.min(Math.max(lap.startTs, start), end);
      const lapEnd = last ? end : Math.min(Math.max(lap.endTs, lapStart), end);
      const inLap = samples.filter((s) => s.ts >= lapStart && s.ts <= lapEnd);
      const lapFixes = inLap.filter((s) => s.lat !== null && s.lon !== null);
      const lapElapsed = lapEnd - lapStart;
      const lapPause = pause ? Math.max(0, Math.min(lapEnd, pause.end) - Math.max(lapStart, pause.start)) : 0;
      const lapTimer = Math.max(0, lapElapsed - lapPause);
      const firstSample = inLap[0];
      const lastSample = inLap[inLap.length - 1];
      const lapDistance =
        lap.distanceM !== null && lap.distanceM > 0
          ? lap.distanceM
          : firstSample && lastSample && total > 0
            ? lastSample.distance - firstSample.distance
            : 0;
      const lapSpeed = lapDistance > 0 && lapTimer > 0 ? lapDistance / lapTimer : null;
      const lapSpeedMax = stats(inLap, (s) => s.speed).max;
      const lapPower = stats(inLap, (s) => s.power);
      // The lap's own cadence when the recorder kept one (a phone recording's laps), else the mean and peak of the samples inside it.
      const lapSamples = stats(inLap, (s) => (s.cadence !== null && s.cadence > 0 ? s.cadence : null));
      const lapCadence = {
        avg: fitCadence(lap.avgCadence !== null && lap.avgCadence > 0 ? lap.avgCadence : lapSamples.avg),
        max: fitCadence(lapSamples.max),
      };
      const lapStride = meanOf(inLap, (s) => s.stride);
      message(4, MESG.lap, [
        [253, 'uint32', toFitTime(lapEnd)],
        [2, 'uint32', toFitTime(lapStart)],
        ...position(lapFixes[0], 3, 4),
        ...position(lapFixes[lapFixes.length - 1], 5, 6),
        [7, 'uint32', lapElapsed * 1000],
        [8, 'uint32', lapTimer * 1000],
        [9, 'uint32', lapDistance > 0 ? lapDistance * 100 : null],
        [13, 'uint16', lapSpeed === null ? null : lapSpeed * 1000],
        [14, 'uint16', lapSpeedMax === null ? null : Math.max(lapSpeedMax, lapSpeed ?? 0) * 1000],
        [15, 'uint8', positive(lap.avgHr)],
        [16, 'uint8', positive(lap.maxHr)],
        [17, 'uint8', lapCadence.avg.whole],
        [18, 'uint8', lapCadence.max.whole],
        [19, 'uint16', positive(lapPower.avg)],
        [20, 'uint16', positive(lapPower.max)],
        [0, 'enum', FIT.eventLap],
        [1, 'enum', FIT.eventTypeStop],
        [23, 'enum', FIT.intensityActive],
        [24, 'enum', last ? FIT.lapTriggerSessionEnd : FIT.lapTriggerManual],
        [25, 'enum', sport.fitSport],
        [39, 'enum', sport.fitSubSport],
        [110, 'uint32', lapSpeed === null ? null : lapSpeed * 1000],
        [80, 'uint8', lapCadence.avg.fraction],
        [81, 'uint8', lapCadence.max.fraction],
        [120, 'uint16', stepLengthRaw(lapStride.avg)],
        [254, 'uint16', index],
      ]);
    });
  } else {
    message(4, MESG.lap, [
      [253, 'uint32', toFitTime(end)],
      [2, 'uint32', toFitTime(start)],
      ...position(firstFix, 3, 4),
      ...position(lastFix, 5, 6),
      [7, 'uint32', elapsed * 1000],
      [8, 'uint32', timer * 1000],
      [9, 'uint32', total > 0 ? total * 100 : null],
      [10, 'uint32', strides],
      [11, 'uint16', calories],
      [13, 'uint16', avgSpeed === null ? null : avgSpeed * 1000],
      [14, 'uint16', maxSpeed === null ? null : maxSpeed * 1000],
      [15, 'uint8', positive(workout.avgHr)],
      [16, 'uint8', positive(workout.maxHr)],
      [17, 'uint8', avgCadence.whole],
      [18, 'uint8', maxCadence.whole],
      [19, 'uint16', sessionPower.avg],
      [20, 'uint16', sessionPower.max],
      [21, 'uint16', ascent],
      [22, 'uint16', descent],
      [33, 'uint16', sessionPower.normalized],
      [0, 'enum', FIT.eventLap],
      [1, 'enum', FIT.eventTypeStop],
      [23, 'enum', FIT.intensityActive],
      [24, 'enum', FIT.lapTriggerSessionEnd],
      [25, 'enum', sport.fitSport],
      [39, 'enum', sport.fitSubSport],
      [110, 'uint32', avgSpeed === null ? null : avgSpeed * 1000],
      [111, 'uint32', maxSpeed === null ? null : maxSpeed * 1000],
      [254, 'uint16', 0],
      [80, 'uint8', avgCadence.fraction],
      [81, 'uint8', maxCadence.fraction],
      [120, 'uint16', stepLengthRaw(workout.avgStepLengthM)],
    ]);
  }

  message(5, MESG.session, [
    [253, 'uint32', toFitTime(end)],
    [2, 'uint32', toFitTime(start)],
    ...position(firstFix, 3, 4),
    [5, 'enum', sport.fitSport],
    [6, 'enum', sport.fitSubSport],
    [7, 'uint32', elapsed * 1000],
    [8, 'uint32', timer * 1000],
    [9, 'uint32', total > 0 ? total * 100 : null],
    [10, 'uint32', strides],
    [11, 'uint16', calories],
    [14, 'uint16', avgSpeed === null ? null : avgSpeed * 1000],
    [15, 'uint16', maxSpeed === null ? null : maxSpeed * 1000],
    [16, 'uint8', positive(workout.avgHr)],
    [17, 'uint8', positive(workout.maxHr)],
    [18, 'uint8', avgCadence.whole],
    [19, 'uint8', maxCadence.whole],
    [20, 'uint16', sessionPower.avg],
    [21, 'uint16', sessionPower.max],
    [22, 'uint16', ascent],
    [23, 'uint16', descent],
    [25, 'uint16', 0],
    [26, 'uint16', laps ? laps.length : 1],
    [28, 'enum', FIT.sessionTriggerActivityEnd],
    [34, 'uint16', sessionPower.normalized],
    [35, 'uint16', ride?.tss != null && ride.tss > 0 ? ride.tss * 10 : null],
    [36, 'uint16', ride?.intensityFactor != null && ride.intensityFactor > 0 ? ride.intensityFactor * 1000 : null],
    [37, 'uint16', balance],
    [45, 'uint16', positive(ride?.ftp)],
    [48, 'uint32', ride?.workKj != null && ride.workKj > 0 ? ride.workKj * 1000 : null],
    [52, 'sint16', ride?.avgGradePct != null ? ride.avgGradePct * 100 : null],
    [55, 'sint16', ride?.maxGradePct != null ? ride.maxGradePct * 100 : null],
    [56, 'sint16', ride?.minGradePct != null ? ride.minGradePct * 100 : null],
    [0, 'enum', FIT.eventSession],
    [1, 'enum', FIT.eventTypeStop],
    [92, 'uint8', avgCadence.fraction],
    [93, 'uint8', maxCadence.fraction],
    [134, 'uint16', stepLengthRaw(workout.avgStepLengthM)],
    [124, 'uint32', avgSpeed === null ? null : avgSpeed * 1000],
    [125, 'uint32', maxSpeed === null ? null : maxSpeed * 1000],
    [254, 'uint16', 0],
  ]);

  message(6, MESG.activity, [
    [253, 'uint32', toFitTime(end)],
    [0, 'uint32', timer * 1000],
    [1, 'uint16', 1],
    [2, 'enum', FIT.activityManual],
    [3, 'enum', FIT.eventActivity],
    [4, 'enum', FIT.eventTypeStop],
    [5, 'uint32', toFitTime(end) + utcOffset],
  ]);

  return { bytes: fit.finish(), samples: samples.length };
}

/**
 * The activity a Strava duplicate message points at (a repeated `external_id`), or null. Strava words it two ways:
 * "duplicate of activity N" and, in the upload status the app polls, "duplicate of <a href='/activities/N' target='_blank'>Name</a>".
 */
export function duplicateOf(message: string | null): number | null {
  const match = message ? /duplicate of (?:activity (\d+)|<a\s[^>]*href=['"]\/activities\/(\d+))/i.exec(message) : null;
  const id = match?.[1] ?? match?.[2];
  return id ? Number(id) : null;
}

/** Strava's error text without the HTML it embeds (links in "duplicate of ..."), for showing to a person. */
export function plainStravaError(message: string): string {
  return message.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/** The activity description when the user opted in; plain text, never part of the title. */
export const DESCRIPTION_LINK = 'fit.joyorogo.com/?utm_source=strava&utm_medium=referral&utm_campaign=evergreen-description';

export interface UploadForm {
  /** Value of the `Content-Type` header, boundary included. */
  contentType: string;
  body: Uint8Array<ArrayBuffer>;
}

/**
 * The multipart body of `POST /api/v3/uploads` as bytes. React Native's FormData can only send files from disk
 * (`{ uri }`), and the file here exists only in memory, so the body is assembled by hand and sent with fetch (a
 * `Uint8Array` body goes out as binary).
 */
export function buildUploadForm(
  workout: StravaWorkout,
  file: Uint8Array,
  options: {
    addLink: boolean;
    /** Replaces the sport name as the activity title. */
    name?: string;
    /** Text above the device line and the optional link. */
    description?: string;
    /** The line naming the recording watch, e.g. `Recorded with HUAWEI WATCH FIT 4 Pro`; appended below the description. */
    deviceLine?: string;
  },
): UploadForm {
  const sport = stravaSport(workout.sportType, workout.ebike);
  const description = [options.description, options.deviceLine, options.addLink ? DESCRIPTION_LINK : undefined].filter((part) => part).join('\n\n');
  const boundary = `----joyofit${workout.start.toString(36)}${file.length.toString(36)}`;
  const fields: Record<string, string> = {
    data_type: 'fit',
    name: options.name ?? workout.sportName,
    external_id: externalId(workout.start),
    sport_type: sport.sportType,
    ...(sport.trainer ? { trainer: '1' } : {}),
    ...(description ? { description } : {}),
  };
  let head = '';
  for (const [name, value] of Object.entries(fields)) {
    head += `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  }
  head +=
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fitFileName(workout.start)}"\r\n` +
    'Content-Type: application/octet-stream\r\n\r\n';
  const encoder = new TextEncoder();
  const headBytes = encoder.encode(head);
  const tailBytes = encoder.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(headBytes.length + file.length + tailBytes.length);
  body.set(headBytes, 0);
  body.set(file, headBytes.length);
  body.set(tailBytes, headBytes.length + file.length);
  return { contentType: `multipart/form-data; boundary=${boundary}`, body };
}
