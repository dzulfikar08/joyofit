/**
 * The recording state machine of a workout the phone records: idle -> recording <-> paused -> finished, fed by GPS fixes and the raw
 * characteristic values of the sensors, sampled once a second into `RecordedSample`s (the columns of `workout_points`).
 *
 * Time never comes from a clock in here: every method takes the instant in epoch milliseconds, so a test drives it second by second and
 * the app drives it from `Date.now()` and the radio timestamps. `tick(now)` writes one sample for every whole second since the last one
 * (carrying the latest readings forward), so a JS thread that was throttled with the screen off loses no seconds.
 *
 * No React Native imports: runs under bun test.
 */
import { virtualSpeedMs } from '@/features/cycling/series';
import { haversineM } from '../workouts/analysis/geo';
import { SPORT_ROWS, type ManualSport } from '../workouts/manual';
import { SensorTracker, type SensorReadings } from '../sensors/gatt';
import { PhoneStepCount } from '../sensors/phoneSteps';
import { HR_COVERAGE_MIN, type EnergyProfile, keytelKcalPerMin, metKcalPerSec } from './energy';

export type RecorderStatus = 'idle' | 'recording' | 'paused' | 'finished';

export interface GpsFix {
  /** Epoch ms of the fix. */
  ts: number;
  lat: number;
  lon: number;
  alt: number | null;
  /** Horizontal accuracy in metres. */
  accuracy: number | null;
  /** m/s. */
  speed: number | null;
}

/** One row of `workout_points`, minus the workout id. */
export interface RecordedSample {
  /** Unix seconds. */
  ts: number;
  lat: number | null;
  lon: number | null;
  alt: number | null;
  hr: number | null;
  /** m/s */
  speed: number | null;
  /** rpm on a bike, steps per minute on foot. */
  cadence: number | null;
  /** Metres per step. */
  stride: number | null;
  power: number | null;
}

export interface RecordedLap {
  startTs: number;
  endTs: number;
  distanceM: number;
  avgHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;
  /** Seconds the clock ran inside the lap. */
  movingSec: number;
}

export interface RecorderConfig {
  sport: ManualSport;
  /** Use the phone's GPS (outdoor sports). */
  gps: boolean;
  wheelCircumferenceM: number;
  profile: EnergyProfile;
}

export interface RecordedWorkout {
  sport: ManualSport;
  /** Unix seconds of the first sample and of the last active second. */
  start: number;
  end: number;
  /** Seconds the clock ran (pauses excluded). */
  movingSec: number;
  distanceM: number;
  calories: number;
  kcalSource: 'hr' | 'met';
  steps: number;
  avgHr: number | null;
  maxHr: number | null;
  minHr: number | null;
  avgSpeed: number | null;
  maxSpeed: number | null;
  avgCadence: number | null;
  maxCadence: number | null;
  avgPower: number | null;
  maxPower: number | null;
  normalizedPower: number | null;
  /** Mean percent of the left pedal while pedalling, when the power meter reports balance. */
  balanceLeftPct: number | null;
  samples: RecordedSample[];
  laps: RecordedLap[];
}

export interface LiveStats {
  status: RecorderStatus;
  movingSec: number;
  elapsedSec: number;
  distanceM: number;
  hr: number | null;
  /** Average over the last 5 s of samples. */
  speedMps: number | null;
  cadence: number | null;
  watts: number | null;
  calories: number;
  /** Heart rate of the recorded seconds so far (pauses excluded): mean and highest, null before the first reading. */
  avgHr: number | null;
  maxHr: number | null;
  /** Steps so far: a running pod's, else the phone's step counter's (pauses excluded); 0 without either. */
  steps: number;
  lapNumber: number;
  lapDistanceM: number;
  lapMovingSec: number;
  /** Age of the last GPS fix in seconds, null when there has been none. */
  fixAgeSec: number | null;
  fixAccuracyM: number | null;
  /** Climb so far in metres from the GPS altitude (smoothed, 3 m dead band), pauses excluded; 0 without GPS. */
  elevationGainM: number;
  /** Altitude of the latest fresh fix in metres, null without one. */
  altitudeM: number | null;
}

/** Fixes worse than this (horizontal accuracy, metres) are not used. */
export const MAX_FIX_ACCURACY_M = 35;
/** Altitude counts only from fixes at least this good (horizontal accuracy, metres), as the watch-live GPS track does. */
const MAX_ALT_ACCURACY_M = 30;
/** Weight of a new altitude in the smoothed one (GPS altitude jumps by metres). */
const ALT_ALPHA = 0.25;
/** The smoothed altitude must move this far (metres) from the reference before a rise counts. */
const RISE_HYSTERESIS_M = 3;
/** Under this ground speed (m/s) a fix is the phone standing still, not movement. */
const STILL_SPEED_MPS = 0.4;
/** A step shorter than this (metres) from the anchor is jitter. */
const MIN_STEP_M = 1;
/** Faster than this between two fixes is a GPS jump (m/s): 43 km/h on foot, 100 km/h on wheels. */
const MAX_FOOT_MPS = 12;
const MAX_WHEEL_MPS = 28;
/** After this many jumps in a row the anchor itself is wrong; start again from the newest fix. */
const JUMPS_BEFORE_REANCHOR = 5;
/** A GPS fix older than this is not the current position. */
const FIX_FRESH_MS = 5000;
/** The web game reports its speed about once a second; one older than this is not the current speed. */
const VIRTUAL_FRESH_MS = 5000;

/** Sports where the phone's own step counter gives cadence and steps when no running pod does (the phone is carried on the body). */
export const FOOT_SPORTS: readonly ManualSport[] = ['run', 'walk', 'hike'];

interface Segment {
  start: number;
  end: number | null;
}

/** Everything `Recorder.restore` needs besides the samples; plain JSON. */
export interface RecorderMeta {
  config: RecorderConfig;
  status: RecorderStatus;
  segments: Segment[];
  nextSec: number;
  distanceM: number;
  steps: number;
  kcalHr: number;
  kcalMet: number;
  hrSeconds: number;
  laps: RecordedLap[];
  lapStartIndex: number;
  lapStartDistance: number;
  /** Steps counted by the phone's step counter, pauses excluded. Absent in a journal written before it existed. */
  phoneSteps?: number;
  /** Live climb in metres. Absent in a journal written before it existed. */
  elevationGainM?: number;
}

const isCycling = (sport: ManualSport) => sport === 'ride' || sport === 'indoorRide';

export class Recorder {
  readonly config: RecorderConfig;
  private tracker: SensorTracker;
  status: RecorderStatus = 'idle';
  private segments: Segment[] = [];
  private samples: RecordedSample[] = [];
  private drained = 0;
  private nextSec = 0;
  private distance = 0;
  /** Steps added up from the running pod's cadence. */
  private podSteps = 0;
  /** The phone's step counter: steps counted while recording and the cadence of the last seconds. */
  private phoneSteps = new PhoneStepCount();
  /** Heart rate of the recorded seconds: sum, count and highest, for the live average and maximum. */
  private hrSum = 0;
  private hrCount = 0;
  private hrMax: number | null = null;
  private kcalHr = 0;
  private kcalMet = 0;
  private hrSeconds = 0;
  /** Left pedal share of each second that had one, percent. */
  private balances: number[] = [];
  private laps: RecordedLap[] = [];
  private lapStartIndex = 0;
  private lapStartDistance = 0;

  // GPS
  private latestFix: GpsFix | null = null;
  private anchor: GpsFix | null = null;
  private jumps = 0;
  private gpsDeltaM = 0;
  private lastWheelM = 0;
  private lastFixSpeed: number | null = null;
  /** Live climb: total, smoothed altitude and the reference level of the dead band (both reset at resume). */
  private elevationGain = 0;
  private smoothedAlt: number | null = null;
  private referenceAlt: number | null = null;
  /** The web game's speed for an indoor ride without a wheel sensor ("Main di web"), and when it was last reported. */
  private virtual: { speedMps: number; at: number } | null = null;

  constructor(config: RecorderConfig, tracker?: SensorTracker) {
    this.config = config;
    this.tracker = tracker ?? new SensorTracker(config.wheelCircumferenceM);
  }

  // -------------------------------------------------------------------------------------------------------------------
  // transitions

  start(nowMs: number): void {
    if (this.status !== 'idle') return;
    this.status = 'recording';
    this.segments = [{ start: nowMs, end: null }];
    this.nextSec = Math.floor(nowMs / 1000);
    this.lastWheelM = this.tracker.wheelDistanceM;
    this.tick(nowMs);
  }

  pause(nowMs: number): void {
    if (this.status !== 'recording') return;
    this.tick(nowMs);
    this.closeSegment(nowMs);
    this.status = 'paused';
    // Readings of the pause must not enter the cadence of the first seconds after it.
    this.phoneSteps.pause();
  }

  resume(nowMs: number): void {
    if (this.status !== 'paused') return;
    this.status = 'recording';
    this.segments.push({ start: nowMs, end: null });
    this.nextSec = Math.max(this.nextSec, Math.floor(nowMs / 1000));
    // Nothing moved while paused: restart the GPS path and the wheel baseline so the pause adds no distance.
    this.anchor = null;
    this.gpsDeltaM = 0;
    this.smoothedAlt = null;
    this.referenceAlt = null;
    this.lastWheelM = this.tracker.wheelDistanceM;
    this.tick(nowMs);
  }

  /** Closes the current lap and opens the next. Returns the closed lap, or null outside a recording. */
  lap(nowMs: number): RecordedLap | null {
    if (this.status !== 'recording') return null;
    this.tick(nowMs);
    return this.closeLap(Math.floor(nowMs / 1000));
  }

  /** Ends the recording. Returns null when there is nothing to save (no sample was taken). */
  finish(nowMs: number): RecordedWorkout | null {
    if (this.status === 'idle' || this.status === 'finished') return null;
    if (this.status === 'recording') {
      this.tick(nowMs);
      this.closeSegment(nowMs);
    }
    this.status = 'finished';
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (!first || !last) return null;
    this.closeLap(last.ts);
    return this.summarise(first.ts, last.ts);
  }

  // -------------------------------------------------------------------------------------------------------------------
  // input

  /** A GPS fix (any time; fixes before `start` only feed the "signal" readout). */
  fix(fix: GpsFix): void {
    this.latestFix = fix;
    this.lastFixSpeed = fix.speed;
    if (this.status !== 'recording' || !this.config.gps) return;
    if (fix.accuracy !== null && fix.accuracy > MAX_FIX_ACCURACY_M) return;
    this.climb(fix);
    const prev = this.anchor;
    if (!prev) {
      this.anchor = fix;
      return;
    }
    const dt = (fix.ts - prev.ts) / 1000;
    if (dt <= 0) return;
    const d = haversineM(prev.lat, prev.lon, fix.lat, fix.lon);
    const limit = isCycling(this.config.sport) ? MAX_WHEEL_MPS : MAX_FOOT_MPS;
    if (d / dt > limit) {
      this.jumps += 1;
      if (this.jumps >= JUMPS_BEFORE_REANCHOR) {
        this.anchor = fix;
        this.jumps = 0;
      }
      return;
    }
    this.jumps = 0;
    if (fix.speed !== null && fix.speed < STILL_SPEED_MPS) {
      this.anchor = fix;
      return;
    }
    if (d < MIN_STEP_M) return;
    this.gpsDeltaM += d;
    this.anchor = fix;
  }

  /** Adds the rise of a recorded fix's altitude to the live climb: the same rule as the watch-live GPS track (LiveGpsTrack). */
  private climb(fix: GpsFix): void {
    const alt = fix.alt;
    if (alt === null || !Number.isFinite(alt)) return;
    if (fix.accuracy !== null && fix.accuracy > MAX_ALT_ACCURACY_M) return;
    const smooth = this.smoothedAlt === null ? alt : this.smoothedAlt + ALT_ALPHA * (alt - this.smoothedAlt);
    this.smoothedAlt = smooth;
    const ref = this.referenceAlt;
    if (ref === null || ref - smooth >= RISE_HYSTERESIS_M) {
      this.referenceAlt = smooth;
    } else if (smooth - ref >= RISE_HYSTERESIS_M) {
      this.elevationGain += smooth - ref;
      this.referenceAlt = smooth;
    }
  }

  /** The speed (m/s) the web game says the rider makes; used for an indoor ride while it is fresh and no wheel sensor reports a speed. */
  virtualSpeed(speedMps: number, nowMs: number): void {
    this.virtual = { speedMps: Math.max(0, speedMps), at: nowMs };
  }

  /**
   * A reading of the phone's step counter: `count` steps counted since the workout session started (cumulative), `tsMs` the instant of
   * the reading. Only foot sports use it. The steps counted between two readings are added to the workout's total while it records;
   * the ones of a pause are skipped (`PhoneStepCount`). Readings before `start` and after `finish` are ignored.
   */
  steps(count: number, tsMs: number): void {
    if (!FOOT_SPORTS.includes(this.config.sport)) return;
    if (this.status !== 'recording' && this.status !== 'paused') return;
    this.phoneSteps.reading(count, tsMs, this.status === 'recording');
  }

  /** A raw characteristic value from a connected sensor; true when the tracker used it. `ts` is the radio timestamp in ms. */
  sensor(characteristic: string, hex: string, ts: number): boolean {
    return this.tracker.ingest(characteristic, hex, ts);
  }

  /**
   * Writes the samples of every second up to `nowMs`. Outside `recording` it does nothing (the clock is stopped).
   * Heart rate, power, cadence and speed come from the sensors; position and altitude from the latest fix not older than 5 s.
   */
  tick(nowMs: number): void {
    if (this.status !== 'recording') return;
    const until = Math.floor(nowMs / 1000);
    for (; this.nextSec <= until; this.nextSec++) this.takeSample(this.nextSec, nowMs);
  }

  private takeSample(sec: number, nowMs: number): void {
    const { sport, gps, profile } = this.config;
    const row = SPORT_ROWS[sport];
    const cycling = isCycling(sport);
    // The sensors are read at the real instant, not at the (earlier) second being filled in after a stall.
    const r: SensorReadings = this.tracker.read(nowMs);
    const fix = this.latestFix && nowMs - this.latestFix.ts <= FIX_FRESH_MS && gps ? this.latestFix : null;

    // Distance of this second and the speed that goes with the same source.
    const wheelNow = this.tracker.wheelDistanceM;
    const wheelDelta = Math.max(0, wheelNow - this.lastWheelM);
    this.lastWheelM = wheelNow;
    const gpsDelta = this.gpsDeltaM;
    this.gpsDeltaM = 0;
    let delta = 0;
    let speed: number | null = null;
    if (cycling && r.speedMps !== undefined) {
      delta = wheelDelta;
      speed = r.speedMps;
    } else if (cycling && !gps && this.virtual !== null && nowMs - this.virtual.at <= VIRTUAL_FRESH_MS) {
      speed = this.virtual.speedMps;
      delta = speed;
    } else if (cycling && !gps && r.watts !== undefined) {
      // An indoor ride with a power meter but no wheel sensor: the speed a rider makes with those watts on the flat (`virtualSpeedMs`).
      const recent = [...this.samples.slice(-4).map((p) => p.power ?? 0), r.watts];
      speed = virtualSpeedMs(recent.reduce((a, b) => a + b, 0) / recent.length, profile.weightKg);
      delta = speed;
    } else if (gps) {
      delta = gpsDelta;
      speed = fix ? (this.lastFixSpeed !== null && this.lastFixSpeed >= 0 ? this.lastFixSpeed : delta) : null;
    } else if (!cycling && r.podSpeedMps !== undefined) {
      delta = r.podSpeedMps;
      speed = r.podSpeedMps;
    }
    this.distance += delta;

    const podCadence = cycling ? null : r.podCadenceSpm ?? null;
    if (podCadence !== null) this.podSteps += podCadence / 60;
    const cadence = cycling
      ? r.cadenceRpm !== undefined
        ? Math.round(r.cadenceRpm)
        : null
      : podCadence ?? (FOOT_SPORTS.includes(sport) ? this.phoneSteps.cadence(nowMs) : null);
    const hr = r.hr ?? null;
    if (cycling && r.balanceLeftPct !== undefined && r.watts !== undefined && r.watts > 0) this.balances.push(r.balanceLeftPct);

    this.kcalMet += metKcalPerSec(row.met, profile.weightKg);
    if (hr !== null) {
      this.hrSeconds += 1;
      this.kcalHr += keytelKcalPerMin(hr, profile) / 60;
      this.hrSum += hr;
      this.hrCount += 1;
      this.hrMax = this.hrMax === null ? hr : Math.max(this.hrMax, hr);
    } else {
      this.kcalHr += metKcalPerSec(row.met, profile.weightKg);
    }

    this.samples.push({
      ts: sec,
      lat: fix ? fix.lat : null,
      lon: fix ? fix.lon : null,
      alt: fix && fix.alt !== null ? Math.round(fix.alt * 10) / 10 : null,
      hr,
      speed: speed === null ? null : Math.round(speed * 100) / 100,
      cadence,
      stride: !cycling && r.podStrideM !== undefined ? r.podStrideM : null,
      power: r.watts ?? null,
    });
  }

  // -------------------------------------------------------------------------------------------------------------------
  // queries

  /** Seconds the clock has run at `nowMs`. */
  movingSec(nowMs: number): number {
    let ms = 0;
    for (const s of this.segments) ms += (s.end ?? Math.max(nowMs, s.start)) - s.start;
    return Math.floor(ms / 1000);
  }

  live(nowMs: number): LiveStats {
    const last = this.samples[this.samples.length - 1];
    const recent = this.samples.slice(-5);
    const speeds = recent.map((s) => s.speed).filter((v): v is number => v !== null);
    const moving = this.movingSec(nowMs);
    const calories = this.calories();
    return {
      status: this.status,
      movingSec: moving,
      elapsedSec: this.segments.length > 0 ? Math.floor((nowMs - (this.segments[0] as Segment).start) / 1000) : 0,
      distanceM: this.distance,
      hr: last?.hr ?? null,
      speedMps: speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : null,
      cadence: last?.cadence ?? null,
      watts: last?.power ?? null,
      calories: calories.kcal,
      avgHr: this.hrCount > 0 ? Math.round(this.hrSum / this.hrCount) : null,
      maxHr: this.hrMax,
      steps: Math.round(this.stepsSoFar()),
      lapNumber: this.laps.length + 1,
      lapDistanceM: this.distance - this.lapStartDistance,
      lapMovingSec: this.samples.length - this.lapStartIndex,
      fixAgeSec: this.latestFix ? Math.max(0, Math.floor((nowMs - this.latestFix.ts) / 1000)) : null,
      fixAccuracyM: this.latestFix?.accuracy ?? null,
      elevationGainM: this.elevationGain,
      altitudeM: this.latestFix && this.latestFix.alt !== null && nowMs - this.latestFix.ts <= FIX_FRESH_MS ? this.latestFix.alt : null,
    };
  }

  /** Samples not handed out yet (for the crash journal); each sample is returned once. */
  drainNew(): RecordedSample[] {
    const out = this.samples.slice(this.drained);
    this.drained = this.samples.length;
    return out;
  }

  get sampleCount(): number {
    return this.samples.length;
  }

  /** Samples from index `from` on, read-only (bike mode feeds its metrics from them; the journal uses `drainNew`). */
  samplesSince(from: number): readonly RecordedSample[] {
    return from <= 0 ? this.samples : this.samples.slice(from);
  }

  /**
   * Ground speed right now in m/s whatever the status (a paused recorder takes no samples, auto-pause still needs to see the bike move):
   * the wheel sensor when it reports, else a fresh GPS fix; null when neither is current.
   */
  instantSpeedMps(nowMs: number): number | null {
    const wheel = this.tracker.read(nowMs).speedMps;
    if (wheel !== undefined) return wheel;
    const fix = this.latestFix;
    if (this.config.gps && fix && nowMs - fix.ts <= FIX_FRESH_MS && fix.speed !== null && fix.speed >= 0) return fix.speed;
    return null;
  }

  /** The newest GPS fix with its age, null before the first one. */
  latestPosition(nowMs: number): { lat: number; lon: number; accuracy: number | null; ts: number; ageMs: number } | null {
    const fix = this.latestFix;
    return fix ? { lat: fix.lat, lon: fix.lon, accuracy: fix.accuracy, ts: fix.ts, ageMs: Math.max(0, nowMs - fix.ts) } : null;
  }

  /** Plain-JSON state besides the samples; `Recorder.restore(meta, samples)` rebuilds the recorder from it. */
  meta(): RecorderMeta {
    return {
      config: this.config,
      status: this.status,
      segments: this.segments.map((s) => ({ ...s })),
      nextSec: this.nextSec,
      distanceM: this.distance,
      steps: this.podSteps,
      phoneSteps: this.phoneSteps.total,
      elevationGainM: this.elevationGain,
      kcalHr: this.kcalHr,
      kcalMet: this.kcalMet,
      hrSeconds: this.hrSeconds,
      laps: this.laps,
      lapStartIndex: this.lapStartIndex,
      lapStartDistance: this.lapStartDistance,
    };
  }

  /**
   * Rebuilds a recorder after the app was killed. A recording that was running comes back paused from its last sample (the time the app
   * was dead is not workout time); the person resumes it, which re-anchors GPS and wheel counters.
   */
  static restore(meta: RecorderMeta, samples: RecordedSample[], tracker?: SensorTracker): Recorder {
    const r = new Recorder(meta.config, tracker);
    r.samples = samples;
    r.drained = samples.length;
    r.segments = meta.segments.map((s) => ({ ...s }));
    const last = samples[samples.length - 1];
    if (meta.status === 'recording') {
      const open = r.segments[r.segments.length - 1];
      if (open && open.end === null) open.end = last ? Math.max(open.start, (last.ts + 1) * 1000) : open.start;
      r.status = 'paused';
    } else {
      r.status = meta.status;
    }
    r.nextSec = last ? Math.max(meta.nextSec, last.ts + 1) : meta.nextSec;
    r.distance = meta.distanceM;
    r.podSteps = meta.steps;
    r.phoneSteps.total = meta.phoneSteps ?? 0;
    for (const s of samples) {
      if (s.hr === null) continue;
      r.hrSum += s.hr;
      r.hrCount += 1;
      r.hrMax = r.hrMax === null ? s.hr : Math.max(r.hrMax, s.hr);
    }
    r.elevationGain = meta.elevationGainM ?? 0;
    r.kcalHr = meta.kcalHr;
    r.kcalMet = meta.kcalMet;
    r.hrSeconds = meta.hrSeconds;
    r.laps = meta.laps.map((l) => ({ ...l }));
    r.lapStartIndex = meta.lapStartIndex;
    r.lapStartDistance = meta.lapStartDistance;
    return r;
  }

  // -------------------------------------------------------------------------------------------------------------------
  // internals

  private closeSegment(nowMs: number): void {
    const open = this.segments[this.segments.length - 1];
    if (open && open.end === null) open.end = Math.max(nowMs, open.start);
  }

  /** A running pod's steps win; without one the phone's step counter has the count. */
  private stepsSoFar(): number {
    return this.podSteps > 0 ? this.podSteps : this.phoneSteps.total;
  }

  private calories(): { kcal: number; source: 'hr' | 'met' } {
    const hrShare = this.samples.length > 0 ? this.hrSeconds / this.samples.length : 0;
    return hrShare >= HR_COVERAGE_MIN
      ? { kcal: Math.round(this.kcalHr), source: 'hr' }
      : { kcal: Math.round(this.kcalMet), source: 'met' };
  }

  private closeLap(endTs: number): RecordedLap | null {
    const from = this.lapStartIndex;
    const slice = this.samples.slice(from);
    if (slice.length === 0) return null;
    const hrs = slice.map((s) => s.hr).filter((v): v is number => v !== null);
    const cads = slice.map((s) => s.cadence).filter((v): v is number => v !== null && v > 0);
    const lap: RecordedLap = {
      startTs: (slice[0] as RecordedSample).ts,
      endTs,
      distanceM: this.distance - this.lapStartDistance,
      avgHr: hrs.length > 0 ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
      maxHr: hrs.length > 0 ? Math.max(...hrs) : null,
      avgCadence: cads.length > 0 ? Math.round(cads.reduce((a, b) => a + b, 0) / cads.length) : null,
      movingSec: slice.length,
    };
    this.laps.push(lap);
    this.lapStartIndex = this.samples.length;
    this.lapStartDistance = this.distance;
    return lap;
  }

  private summarise(start: number, end: number): RecordedWorkout {
    const s = this.samples;
    // Intervals between consecutive seconds: the gap that crosses a pause is not moving time.
    let movingSec = 0;
    for (let i = 1; i < s.length; i++) if ((s[i] as RecordedSample).ts - (s[i - 1] as RecordedSample).ts === 1) movingSec += 1;
    const hrs = s.map((p) => p.hr).filter((v): v is number => v !== null);
    const speeds = s.map((p) => p.speed).filter((v): v is number => v !== null);
    const cads = s.map((p) => p.cadence).filter((v): v is number => v !== null && v > 0);
    const watts = s.map((p) => p.power).filter((v): v is number => v !== null);
    const { kcal, source } = this.calories();
    const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    return {
      sport: this.config.sport,
      start,
      end,
      movingSec,
      distanceM: Math.round(this.distance),
      calories: kcal,
      kcalSource: source,
      steps: Math.round(this.stepsSoFar()),
      avgHr: hrs.length > 0 ? Math.round(mean(hrs)) : null,
      maxHr: hrs.length > 0 ? Math.max(...hrs) : null,
      minHr: hrs.length > 0 ? Math.min(...hrs) : null,
      avgSpeed: this.distance >= 100 && movingSec > 0 ? this.distance / movingSec : null,
      maxSpeed: speeds.length > 0 ? Math.max(...smoothed(speeds, 3)) : null,
      avgCadence: cads.length > 0 ? Math.round(mean(cads)) : null,
      maxCadence: cads.length > 0 ? Math.max(...cads) : null,
      avgPower: watts.length > 0 ? Math.round(mean(watts)) : null,
      maxPower: watts.length > 0 ? Math.max(...watts) : null,
      normalizedPower: watts.length > 0 ? normalizedPower(watts) : null,
      balanceLeftPct: this.balances.length > 0 ? Math.round((mean(this.balances) * 10)) / 10 : null,
      samples: s,
      laps: this.laps,
    };
  }
}

/** Centred moving mean with an odd window; the ends use what is there. */
function smoothed(values: readonly number[], window: number): number[] {
  const h = Math.floor(window / 2);
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - h), i + h + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

/** Normalized power: the 4th-power mean of the 30 s rolling average, rooted again (Coggan). Shorter than 30 s it is the plain mean. */
export function normalizedPower(watts: readonly number[]): number {
  if (watts.length < 30) return Math.round(watts.reduce((a, b) => a + b, 0) / watts.length);
  let window = 0;
  let total = 0;
  let n = 0;
  for (let i = 0; i < watts.length; i++) {
    window += watts[i] as number;
    if (i >= 30) window -= watts[i - 30] as number;
    if (i >= 29) {
      const avg = window / 30;
      total += avg ** 4;
      n += 1;
    }
  }
  return Math.round((total / n) ** 0.25);
}
