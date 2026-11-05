import { zoneIndex, type HrZones } from '@/features/hrzones/zones';
import { heartStretches } from '@/features/today/strain';

import type { EffortSeconds } from './efforts';
import { BEST_EFFORT_DISTANCES, type AnalysisBestEffort, type AnalysisHrZones, type AnalysisPaceZones, type BestEffortKey, type PaceZoneKey } from './types';

/** Efforts shorter than this say little about a one-hour pace. */
const MIN_THRESHOLD_EFFORT_SEC = 480;
/**
 * Riegel's time-to-pace scaling exponent. Riegel's law is T2 = T1 * (D2/D1)^1.06; rescaling a pace by the ratio of the efforts'
 * durations needs the exponent (b-1)/b = 0.06/1.06 ≈ 0.0566, not the distance exponent b-1 = 0.06 itself. (JoyoFit fix 2026-11, from
 * Jeremy's review: the two differ by ~0.4% of threshold pace.)
 */
const RIEGEL_PACE_EXPONENT = 0.06 / 1.06;
const THRESHOLD_EFFORT_SEC = 3600;
const THRESHOLD_KEYS: readonly BestEffortKey[] = ['1mi', '5k', '10k', 'half'];

/**
 * Time in the person's heart-rate zones, from the same stretches of heart rate strain reads (`heartStretches`: every reading counts
 * until the next one, a gap over two minutes is a pause), so the covered time of the two always agrees. Display only: strain and the
 * load do not use these zones. The limits are the zones in force when the analysis is made (past workouts are not snapshotted);
 * `source` is 'age' while the maximum comes from the profile's birth year (or the default age), 'setting' when the user entered it.
 */
export function hrZones(points: readonly { ts: number; hr: number | null }[], zones: HrZones): AnalysisHrZones {
  const minutes = zones.bounds.map(() => 0);
  let coveredMinutes = 0;
  for (const stretch of heartStretches(points)) {
    coveredMinutes += stretch.minutes;
    const zone = zoneIndex(stretch.hr, zones);
    if (zone > 0) minutes[zone - 1] += stretch.minutes;
  }
  const sec = minutes.map((m) => Math.round(m * 60));
  const covered = Math.round(coveredMinutes * 60);
  return {
    method: zones.method,
    maxHr: zones.maxHr,
    source: zones.maxHrSource,
    bounds: [...zones.bounds, zones.maxHr],
    sec,
    belowSec: Math.max(0, covered - sec.reduce((a, b) => a + b, 0)),
  };
}

export interface EffortCandidate {
  sec: number;
  distM: number;
}

/**
 * Threshold pace (about a 60-minute effort, seconds per km): for each effort of at least 8 minutes, its pace slowed to a
 * one-hour effort with Riegel's exponent, `pace * (3600 / sec) ^ 0.06`; the fastest of them. Null without such an effort.
 */
export function thresholdPace(candidates: readonly EffortCandidate[]): number | null {
  let best: number | null = null;
  for (const c of candidates) {
    if (c.sec < MIN_THRESHOLD_EFFORT_SEC || c.distM <= 0) continue;
    const pace = (c.sec / c.distM) * 1000 * (THRESHOLD_EFFORT_SEC / c.sec) ** RIEGEL_PACE_EXPONENT;
    if (best === null || pace < best) best = pace;
  }
  return best;
}

/** The 1 mile, 5 km, 10 km and half-marathon efforts of this workout and of the history, as threshold candidates. */
function thresholdCandidates(efforts: readonly AnalysisBestEffort[], history: readonly EffortSeconds[]): EffortCandidate[] {
  const out: EffortCandidate[] = [];
  for (const key of THRESHOLD_KEYS) {
    const distM = BEST_EFFORT_DISTANCES[key];
    const own = efforts.find((e) => e.key === key);
    if (own) out.push({ sec: own.sec, distM });
    for (const h of history) {
      const sec = h[key];
      if (sec) out.push({ sec, distM });
    }
  }
  return out;
}

/**
 * The one threshold pace (seconds per km) of the app: from this workout's own best efforts (none for the coach) and the best
 * efforts of the runs of the last `THRESHOLD_WINDOW_DAYS` days (`inEffortWindow`). Both the workout analysis and the coach
 * call it, so they never disagree. Null until some effort of 8 minutes or more exists.
 */
export function thresholdPaceFromEfforts(own: readonly AnalysisBestEffort[], history: readonly EffortSeconds[]): number | null {
  return thresholdPace(thresholdCandidates(own, history));
}

/** Zone edges as a share of threshold pace, slow to fast; `from` is the slow edge. */
const PACE_ZONES: readonly { key: PaceZoneKey; from: number | null; to: number | null }[] = [
  { key: 'recovery', from: null, to: 1.29 },
  { key: 'endurance', from: 1.29, to: 1.14 },
  { key: 'tempo', from: 1.14, to: 1.06 },
  { key: 'threshold', from: 1.06, to: 0.99 },
  { key: 'vo2', from: 0.99, to: null },
];

/**
 * Time per pace zone from the grid's pace series: every sample with a pace counts the `stepSec` it covers (the last one
 * only up to `elapsedSec`). Zones are fractions of the threshold: recovery slower than 129 %, endurance 114-129,
 * tempo 106-114, threshold 99-106, VO2 faster than 99 %.
 */
export function paceZones(pace: readonly (number | null)[], stepSec: number, elapsedSec: number, thresholdSecKm: number): AnalysisPaceZones {
  const sec = PACE_ZONES.map(() => 0);
  for (let i = 0; i < pace.length; i++) {
    const p = pace[i];
    if (p === null) continue;
    const share = p / thresholdSecKm;
    const index = PACE_ZONES.findIndex((z) => z.to === null || share > z.to);
    sec[index === -1 ? PACE_ZONES.length - 1 : index] += Math.min(stepSec, Math.max(0, elapsedSec - i * stepSec));
  }
  return {
    thresholdSecKm: Math.round(thresholdSecKm),
    zones: PACE_ZONES.map((z, i) => ({
      key: z.key,
      fromSecKm: z.from === null ? null : Math.round(z.from * thresholdSecKm),
      toSecKm: z.to === null ? null : Math.round(z.to * thresholdSecKm),
      sec: sec[i],
    })),
  };
}
