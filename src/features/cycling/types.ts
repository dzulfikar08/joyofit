// Cycling analysis: what JoyoFit computes for a ride on top of the generic workout analysis. Pure types, no I/O.
// The generic `WorkoutAnalysis` (analysis/types.ts) is a contract shared verbatim with JoyoRogo, so nothing cycling-only is added
// to it: everything here is computed on the phone from the stored 1 Hz points and never leaves it.

/** Where the speed (and so the distance shape) of the ride comes from. `power` is a model estimate (indoor, no wheel sensor). */
export type SpeedSource = 'sensor' | 'gps' | 'power' | 'none';

export interface RideProfile {
  /** Body weight, kg (Settings > Profile; the default when the person has none). */
  weightKg: number;
  age: number;
  sex: 'male' | 'female' | 'unknown';
  /** Maximum heart rate, for the heart-rate load of a ride without power (Edwards' fixed %HRmax zones, whatever zones the person set). */
  maxHr: number;
  /** Functional threshold power set by the person, watts; null until set. */
  ftp: number | null;
  /** The watch's VO2max for the heart-rate energy equation, when it has one. */
  vo2max?: number | null;
}

export interface RideSpeed {
  /** Distance over the timer time, m/s (Garmin "Avg Speed"). */
  avgMs: number | null;
  /** Distance over the moving time after auto-pause, m/s (Garmin "Avg Moving Speed"). */
  avgMovingMs: number | null;
  /** Distance over the elapsed time, m/s (Garmin "Overall Avg Speed"). */
  avgOverallMs: number | null;
  /** Fastest 3 s mean, m/s. */
  maxMs: number | null;
  source: SpeedSource;
}

export interface RideTimes {
  elapsedSec: number;
  /** The recorder's timer: the watch's active time when a pause explains it, else the elapsed time (`movingOf`). */
  timerSec: number;
  /** Seconds the bike moved above the cycling auto-pause threshold, never more than the timer. */
  movingSec: number;
  /** Seconds stopped inside the timer (traffic lights, a coffee). */
  stoppedSec: number;
}

export interface RideElevation {
  /** `device`: the head unit's own ascent and descent; `computed`: from the altitude stream (`RIDE_ELEVATION_*`). */
  source: 'device' | 'computed';
  gainM: number;
  lossM: number;
  minM: number;
  maxM: number;
  /** Net altitude change over the distance, percent. */
  avgGradePct: number | null;
  /** Steepest 100 m climb and descent (percent, descent negative). */
  maxGradePct: number | null;
  minGradePct: number | null;
}

export type ClimbCategory = 'hc' | '1' | '2' | '3' | '4' | 'none';

export interface RideClimb {
  n: number;
  startM: number;
  endM: number;
  lengthM: number;
  gainM: number;
  avgGradePct: number;
  maxGradePct: number;
  /** Seconds since the start of the ride. */
  startSec: number;
  endSec: number;
  /** Elapsed seconds the climb took. */
  sec: number;
  avgSpeedKmh: number | null;
  avgPower: number | null;
  avgHr: number | null;
  /** Vertical metres per hour. */
  vam: number | null;
  /** Length in metres times average grade in percent. */
  score: number;
  category: ClimbCategory;
}

export interface RideSplit {
  n: number;
  distM: number;
  /** Elapsed seconds. */
  sec: number;
  movingSec: number;
  /** Km/h over the moving time. */
  avgSpeedKmh: number | null;
  avgHr: number | null;
  avgCad: number | null;
  avgPower: number | null;
  gainM: number | null;
  lossM: number | null;
  avgGradePct: number | null;
}

export interface RideLap extends Omit<RideSplit, 'n'> {
  n: number;
  startSec: number;
  maxPower: number | null;
}

export interface CadenceBand {
  /** Inclusive lower and exclusive upper bound, rpm; `toRpm` null = open ended. */
  fromRpm: number;
  toRpm: number | null;
  sec: number;
}

export interface RideCadence {
  /** Mean over pedalling seconds only: coasting (0 rpm) is left out, as Garmin does. */
  avg: number | null;
  max: number | null;
  /** Seconds with the crank turning and seconds coasting (zero cadence while moving). */
  pedallingSec: number;
  coastingSec: number;
  /** Time in 0 (coasting), 1-59, 60-69, 70-79, 80-89, 90-99, 100-109, 110+ rpm. */
  bands: CadenceBand[];
}

export type PowerZoneKey = 'z1' | 'z2' | 'z3' | 'z4' | 'z5' | 'z6' | 'z7';

export interface PowerZone {
  key: PowerZoneKey;
  /** Watts; `toW` null = open ended. */
  fromW: number;
  toW: number | null;
  sec: number;
}

export interface PowerEffort {
  sec: number;
  watts: number;
  /** Seconds into the ride where the effort starts. */
  atSec: number;
}

export interface RidePower {
  avg: number;
  max: number;
  normalized: number | null;
  /** Normalized power over average power. */
  variabilityIndex: number | null;
  /** Normalized power over FTP; null without FTP. */
  intensityFactor: number | null;
  tss: number | null;
  /** Kilojoules of mechanical work. */
  workKj: number;
  avgWkg: number | null;
  normalizedWkg: number | null;
  /** Seconds of the zero-power (coasting or stopped) kind inside the timer. */
  zeroSec: number;
  /** Mean percent of the left pedal, when a sensor measured balance; the right is 100 minus it. */
  balanceLeftPct: number | null;
  ftp: number | null;
  zones: PowerZone[] | null;
  /** Mean power of the best 5 s, 1 min, 5 min, 20 min, 60 min (present when the ride is long enough) and the other curve points. */
  curve: PowerEffort[];
  /** Seconds the NP and TSS figures are based on. */
  basisSec: number;
}

export interface FtpSuggestion {
  watts: number;
  /** The best 20 minute power it comes from. */
  best20Watts: number;
}

export interface RideDecoupling {
  /** `power` = Pw:Hr (normalized power over heart rate), `speed` = Pa:Hr (speed over heart rate). */
  basis: 'power' | 'speed';
  /** Percent the efficiency factor fell from the first half to the second; positive = heart rate drifted up. */
  pct: number;
  firstEf: number;
  secondEf: number;
}

export interface RideHr {
  avg: number | null;
  max: number | null;
  decoupling: RideDecoupling | null;
}

export type CalorieSource = 'power' | 'hr' | 'met' | 'device';

export interface RideCalories {
  kcal: number;
  source: CalorieSource;
}

export interface RideLoad {
  /** Edwards TRIMP of the heart rate samples, null without heart rate. */
  trimp: number | null;
  /** TSS-based load as TRIMP-equivalent (`TSS_TO_TRIMP` x TSS), null without power or FTP. */
  tssTrimp: number | null;
  /** The figure the training load uses: TSS-based when there is power and FTP, else TRIMP. */
  trimpUsed: number | null;
  basis: 'tss' | 'hr' | null;
}

export interface RideAnalysis {
  /** The analysis engine's revision, stored with cached figures. */
  rev: number;
  indoor: boolean;
  times: RideTimes;
  distanceM: number | null;
  speed: RideSpeed;
  elevation: RideElevation | null;
  splits: RideSplit[];
  laps: RideLap[];
  climbs: RideClimb[];
  cadence: RideCadence | null;
  power: RidePower | null;
  ftpSuggestion: FtpSuggestion | null;
  hr: RideHr;
  calories: RideCalories | null;
  load: RideLoad;
}
