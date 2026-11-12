import type { PaceBlock } from '@/features/workouts/summary';
import { pausedWithin } from '@/features/workouts/pause';

import { round } from './round';
import type { AnalysisSplit, SportKind } from './types';

/** The last, partial split is kept from this length on. */
const MIN_PARTIAL_SPLIT_M = 100;
const MAX_SPLITS = 250;

export interface SplitGrid {
  stepSec: number;
  n: number;
  /** Unrounded cumulative metres. */
  dist: readonly number[] | null;
  hr: readonly (number | null)[] | null;
  cad: readonly (number | null)[] | null;
  /** Cumulative hysteresis gain/loss per sample (see `elevationProfile`), null without altitude. */
  cumGain: readonly number[] | null;
  cumLoss: readonly number[] | null;
  /** The watch's pauses, seconds from the start (`Grid.pauses`): no split counts them, as Strava leaves out the file's timer stops. */
  pauses: readonly { start: number; end: number }[];
}

function mean(values: readonly (number | null)[] | null, from: number, to: number): number | null {
  if (!values) return null;
  let sum = 0;
  let count = 0;
  for (let i = Math.max(0, from); i <= Math.min(values.length - 1, to); i++) {
    const v = values[i];
    if (v !== null) {
      sum += v;
      count += 1;
    }
  }
  return count > 0 ? sum / count : null;
}

/** Elapsed seconds at which the cumulative distance first reaches `d`, interpolated inside the grid step. */
function timeAt(dist: readonly number[], step: number, d: number): number {
  let lo = 0;
  let hi = dist.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dist[mid] < d) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0) return 0;
  const d0 = dist[lo - 1];
  const d1 = dist[lo];
  return ((lo - 1) + (d1 > d0 ? (d - d0) / (d1 - d0) : 1)) * step;
}

/** `sec` is the split's time; the default is the whole span, a km split passes it without the pause. */
function makeSplit(g: SplitGrid, n: number, distM: number, tStart: number, tEnd: number, foot: boolean, sec = tEnd - tStart): AnalysisSplit {
  const from = Math.ceil(tStart / g.stepSec);
  const to = Math.floor(tEnd / g.stepSec);
  const hr = mean(g.hr, from, to) ?? mean(g.hr, Math.round(tStart / g.stepSec), Math.round(tEnd / g.stepSec));
  const cad = mean(g.cad, from, to) ?? mean(g.cad, Math.round(tStart / g.stepSec), Math.round(tEnd / g.stepSec));
  const iS = Math.min(g.n - 1, Math.round(tStart / g.stepSec));
  const iE = Math.min(g.n - 1, Math.round(tEnd / g.stepSec));
  return {
    n,
    distM: Math.round(distM),
    sec: Math.round(sec),
    paceSecKm: foot && sec > 0 && distM > 0 ? Math.round(sec / (distM / 1000)) : null,
    hr: hr === null ? null : Math.round(hr),
    gainM: g.cumGain ? round(g.cumGain[iE] - g.cumGain[iS], 1) : null,
    lossM: g.cumLoss ? round(g.cumLoss[iE] - g.cumLoss[iS], 1) : null,
    cad: cad === null ? null : Math.round(cad),
  };
}

/**
 * Kilometre splits from the cumulative distance, each crossing time interpolated inside its grid step. The last, partial
 * split is kept from 100 m on. `sec` is moving time: the span between the crossings minus the part of the watch's pause in
 * it, which is how Strava times the kilometres of the file JoyoFit uploads (its timer stops for the same window, see
 * `workouts/pause.ts`), so the splits add up to the moving time; `paceSecKm = sec / distKm` (run, walk and ride only).
 */
export function kmSplits(g: SplitGrid, kind: SportKind): AnalysisSplit[] {
  const dist = g.dist;
  if (!dist || g.n < 2) return [];
  const foot = kind === 'run' || kind === 'walk' || kind === 'ride';
  const total = dist[dist.length - 1];
  const whole = Math.floor(total / 1000);
  const splits: AnalysisSplit[] = [];
  const moving = (t0: number, t1: number) => t1 - t0 - pausedWithin(g.pauses, t0, t1);
  let tStart = 0;
  for (let k = 1; k <= whole && splits.length < MAX_SPLITS; k++) {
    const tEnd = timeAt(dist, g.stepSec, k * 1000);
    splits.push(makeSplit(g, k, 1000, tStart, tEnd, foot, moving(tStart, tEnd)));
    tStart = tEnd;
  }
  const rest = total - whole * 1000;
  if (rest >= MIN_PARTIAL_SPLIT_M && splits.length < MAX_SPLITS) {
    const tEnd = timeAt(dist, g.stepSec, total);
    splits.push(makeSplit(g, whole + 1, rest, tStart, tEnd, foot, moving(tStart, tEnd)));
  }
  return splits;
}

/**
 * Splits from the watch's own per-km pace blocks, for a workout without GPS. A block with a `correction` is the last,
 * partial one and is that fraction of a unit long. Heart rate and cadence come from the grid over the block's time span.
 */
export function paceBlockSplits(blocks: readonly PaceBlock[] | undefined, g: SplitGrid): AnalysisSplit[] {
  const perKm = (blocks ?? []).filter((b) => b.type === 0 && b.pace > 0);
  const splits: AnalysisSplit[] = [];
  let tStart = 0;
  for (const b of perKm) {
    if (splits.length >= MAX_SPLITS) break;
    const fraction = b.correction !== null && b.correction > 0 && b.correction < 10000 ? b.correction / 10000 : 1;
    const sec = b.pace * fraction;
    const split = makeSplit(g, splits.length + 1, fraction * 1000, tStart, tStart + sec, true);
    split.paceSecKm = Math.round(b.pace);
    splits.push(split);
    tStart += sec;
  }
  return splits;
}
