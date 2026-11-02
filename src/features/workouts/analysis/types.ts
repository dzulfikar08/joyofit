// Workout analysis: the payload JoyoFit computes for a watch workout and JoyoRogo stores and
// shows (feed post detail, Pro viewers). Types and pure helpers only, no I/O and no dependencies,
// so server, web and native all import this one file. JoyoFit keeps a verbatim copy at
// `src/features/workouts/analysis/types.ts`; change both together.
//
// All series live on ONE uniform time grid so a single scrubber index addresses the map, every
// chart and the readout: sample `i` is at `i * stepSec` seconds after the start (elapsed time).

export const WORKOUT_ANALYSIS_VERSION = 1;

/** Upper bounds the server enforces; JoyoFit builds within them. */
export const ANALYSIS_LIMITS = {
  samples: 720,
  splits: 250,
  laps: 300,
  comparison: 6,
} as const;

export type LatLon = [lat: number, lon: number];

/** `run` and `walk` read as pace per km, `ride` as km/h, `swim` and `other` as duration/HR only. */
export type SportKind = "run" | "walk" | "ride" | "swim" | "other";

export interface AnalysisSeries {
  /** Grid spacing in seconds; sample i is at i * stepSec. */
  stepSec: number;
  /** Sample count; every non-null array below has exactly this length. */
  n: number;
  /** Cumulative distance in metres (non-decreasing); null without GPS or distance. */
  dist: number[] | null;
  /** Beats per minute; null entries are gaps. */
  hr: (number | null)[] | null;
  /** Smoothed seconds per km; null entries while stopped. */
  pace: (number | null)[] | null;
  /** Metres above sea level, smoothed. */
  alt: (number | null)[] | null;
  /** Steps (rpm when cycling) per minute. */
  cad: (number | null)[] | null;
  /**
   * Metres per step, only when the source measured it per sample (a FIT file, a foot pod). Absent otherwise: a reader derives
   * the step length from `pace` and `cad` (speed over steps per second).
   */
  stride?: (number | null)[] | null;
  /** Watts. */
  power: (number | null)[] | null;
  /** Whole-day screens only: all-day HRV (RMSSD, ms) and stress level (1 to 100); null entries are gaps. Workouts leave both out. */
  hrv?: (number | null)[] | null;
  stress?: (number | null)[] | null;
  /** Position per sample; null outside the GPS recording. Omitted by the author for a private route. */
  track: (LatLon | null)[] | null;
}

export interface AnalysisSplit {
  /** 1-based; the last split may be shorter than 1000 m (see distM). */
  n: number;
  distM: number;
  /** Elapsed seconds spent on the split. */
  sec: number;
  paceSecKm: number | null;
  hr: number | null;
  gainM: number | null;
  lossM: number | null;
  cad: number | null;
}

export interface AnalysisLap {
  n: number;
  startSec: number;
  sec: number;
  distM: number | null;
  paceSecKm: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgCad: number | null;
  gainM: number | null;
}

/**
 * The person's heart-rate zones for this workout: `bounds` are the limits they had when the analysis was made. By default zones 1 to 5 are
 * 50-60, 60-70, 70-80, 80-90 and 90-100 percent of the maximum heart rate; the person may use the reserve method (six zones: warm-up, then
 * Huawei's five from 59 percent of the reserve) or their own limits.
 */
export interface AnalysisHrZones {
  /** The calculation method, which names the zones. Absent in analyses made before the reserve method had its warm-up zone (read as 'max'). */
  method?: 'max' | 'hrr' | 'lthr';
  maxHr: number;
  /** Where the maximum comes from: the profile's age formula or an explicit setting. */
  source: "age" | "setting";
  /** Lower bound of every zone, then maxHr: six bpm for five zones, seven for the reserve method's six. */
  bounds: number[];
  /** Seconds in every zone, Z1 first. */
  sec: number[];
  /** Seconds under Z1's lower bound. */
  belowSec: number;
}

export type PaceZoneKey = "recovery" | "endurance" | "tempo" | "threshold" | "vo2";

export interface AnalysisPaceZones {
  /** Estimated threshold pace (about a 60-minute effort), seconds per km. */
  thresholdSecKm: number;
  /** Slowest zone first. Bounds are seconds per km; `from` is the slow end, null = unbounded. */
  zones: { key: PaceZoneKey; fromSecKm: number | null; toSecKm: number | null; sec: number }[];
}

export type BestEffortKey = "400m" | "1k" | "1mi" | "5k" | "10k" | "half";

export const BEST_EFFORT_DISTANCES: Record<BestEffortKey, number> = {
  "400m": 400,
  "1k": 1000,
  "1mi": 1609.344,
  "5k": 5000,
  "10k": 10000,
  half: 21097.5,
};

export interface AnalysisBestEffort {
  key: BestEffortKey;
  sec: number;
  /** Distance into the workout where the fastest stretch starts, metres. */
  atM: number;
  /** 1 = best of the last 120 days of similar workouts, 2 = second, ... null without history. */
  rank: number | null;
}

export type EffortBand = "light" | "moderate" | "hard" | "max";

/** Relative effort: JoyoFit's workout strain (0 to 21) from time in heart-rate zones. */
export interface AnalysisEffort {
  strain: number;
  /** Edwards TRIMP behind the strain. */
  trimp: number;
  band: EffortBand;
  /** Strain this workout added to its day, null when unknown. */
  addedToDay: number | null;
}

export interface AnalysisLoad {
  trimp: number;
  /** TRIMP of the last 7 days up to this workout, this workout included. */
  acute: number;
  /** Average weekly TRIMP over the 28 days up to this workout. */
  chronicWeekly: number;
  /** acute / chronicWeekly; null when there is no chronic load. */
  ratio: number | null;
  /** Watch-reported values, when it reported them. */
  watchLoad: number | null;
  aerobicEffect: number | null;
  anaerobicEffect: number | null;
  recoveryHours: number | null;
}

export interface AnalysisComparisonItem {
  startedAt: number;
  distM: number | null;
  sec: number;
  paceSecKm: number | null;
  avgHr: number | null;
  gainM: number | null;
}

export interface AnalysisComparison {
  /** What "similar" meant: distance within 20 percent, else duration within 25 percent, same sport. */
  basis: "distance" | "duration";
  /** Newest first. */
  items: AnalysisComparisonItem[];
}

export interface AnalysisStats {
  avgHr: number | null;
  maxHr: number | null;
  minHr: number | null;
  avgPaceSecKm: number | null;
  bestPaceSecKm: number | null;
  avgSpeedMs: number | null;
  maxSpeedMs: number | null;
  avgCad: number | null;
  maxCad: number | null;
  avgPower: number | null;
  maxPower: number | null;
  normalizedPower: number | null;
  /** Average metres per step, when the watch reports stride length. */
  avgStrideM: number | null;
}

export interface WorkoutAnalysis {
  v: typeof WORKOUT_ANALYSIS_VERSION;
  sport: { name: string; kind: SportKind };
  /** Epoch ms. */
  startedAt: number;
  elapsedSec: number;
  /** Time spent actually moving (speed above a walking floor); equals elapsedSec without GPS. */
  movingSec: number;
  distanceM: number | null;
  elevation: { gainM: number; lossM: number; minM: number; maxM: number } | null;
  series: AnalysisSeries | null;
  splits: AnalysisSplit[];
  laps: AnalysisLap[];
  hrZones: AnalysisHrZones | null;
  paceZones: AnalysisPaceZones | null;
  bestEfforts: AnalysisBestEffort[];
  effort: AnalysisEffort | null;
  load: AnalysisLoad | null;
  calories: { kcal: number; fatG: number | null; carbG: number | null } | null;
  comparison: AnalysisComparison | null;
  stats: AnalysisStats;
}

// --- Pure helpers shared by every renderer ---------------------------------------------------

/** `5:32` for a pace in seconds per km (no unit); `--` for null or unusable. */
export function formatPace(secPerKm: number | null | undefined): string {
  if (secPerKm === null || secPerKm === undefined || !Number.isFinite(secPerKm) || secPerKm <= 0) return "--";
  const total = Math.round(secPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** `1:05:09` or `42:10`. */
export function formatDuration(totalSec: number): string {
  const total = Math.max(0, Math.round(totalSec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** `5.02` km, or metres below 1 km (`640 m`). */
export function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

/** Seconds per km from metres per second; null when not moving. */
export function paceFromSpeed(metersPerSecond: number): number | null {
  return metersPerSecond > 0.1 ? 1000 / metersPerSecond : null;
}

export function effortBand(strain: number): EffortBand {
  if (strain < 8) return "light";
  if (strain < 13) return "moderate";
  if (strain < 18) return "hard";
  return "max";
}

/** The x value of sample `i` on the shared axis: metres when the series has distance, else seconds. */
export function axisValue(series: AnalysisSeries, i: number): number {
  return series.dist ? (series.dist[i] ?? 0) : i * series.stepSec;
}

/** Nearest sample index for an axis value (binary search on the monotonic axis). */
export function indexAtAxis(series: AnalysisSeries, x: number): number {
  let lo = 0;
  let hi = series.n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (axisValue(series, mid) < x) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(axisValue(series, lo - 1) - x) <= Math.abs(axisValue(series, lo) - x)) return lo - 1;
  return lo;
}

export interface KmMarker {
  /** Whole kilometre, 1-based. */
  km: number;
  /** Interpolated position on the track. */
  pos: LatLon;
  /** Nearest grid sample, for scrubbing to it. */
  index: number;
}

/** One marker where the track crosses each full kilometre; empty without distance and track. */
export function kmMarkers(series: AnalysisSeries): KmMarker[] {
  const { dist, track } = series;
  if (!dist || !track) return [];
  const markers: KmMarker[] = [];
  let next = 1;
  for (let i = 1; i < series.n; i++) {
    const d0 = dist[i - 1]!;
    const d1 = dist[i]!;
    while (d1 >= next * 1000 && d0 < next * 1000) {
      const a = track[i - 1];
      const b = track[i];
      const f = d1 > d0 ? (next * 1000 - d0) / (d1 - d0) : 0;
      const pos: LatLon | null = a && b ? [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f] : (b ?? a ?? null);
      if (pos) markers.push({ km: next, pos, index: f < 0.5 ? i - 1 : i });
      next += 1;
    }
  }
  return markers;
}

/** The track's non-null positions, in order, as one polyline per uninterrupted stretch. */
export function trackSegments(track: (LatLon | null)[]): LatLon[][] {
  const out: LatLon[][] = [];
  let current: LatLon[] = [];
  for (const p of track) {
    if (p) current.push(p);
    else if (current.length > 0) {
      out.push(current);
      current = [];
    }
  }
  if (current.length > 0) out.push(current);
  return out;
}
