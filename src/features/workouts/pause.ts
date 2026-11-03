/**
 * Where the watch was paused during a workout, worked out once for everything that has to agree on it: the Strava file
 * writes it as a timer stop and start (`strava/activityFile.ts`), and the analysis leaves it out of the split times
 * (`analysis/splits.ts`), so a kilometre takes as long in JoyoFit as Strava says it did.
 */

/** A stretch the watch had paused, in Unix seconds. */
export interface WatchPause {
  start: number;
  end: number;
}

export interface PausePoint {
  /** Unix seconds. */
  ts: number;
  lat: number | null;
  lon: number | null;
}

/** A usable GPS fix: both coordinates, on the globe, and not the 0,0 a receiver reports before it has a position. */
export function validFix(lat: number | null, lon: number | null): lat is number {
  return lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
}

/**
 * The watch's pause. The watch only gives its timer (`duration`), so the pause is `elapsed - timer` seconds long (2 s on a
 * run whose end stamp is 2 s after the timer stopped, minutes for a real pause); Strava reads its moving time from the timer
 * events once a file has a pause (see `times.ts`), so the file always writes it. Where it sat is not stored, but nothing is
 * recorded while the watch is paused, so it lies around the longest stretch the samples leave empty: the longest gap between
 * GPS fixes when the workout has at least two (the watch stops the GPS when it pauses; heart-rate samples may run on or stop
 * a little later), else between any samples, the start and the end included. Samples count per whole second inside
 * `[start, end]`. The window is centred on that gap (a gap shorter than the pause is widened to the pause's length, a longer
 * one is cut to it) and kept inside the workout. Null when the watch reports no timer or the timer is not shorter than the
 * elapsed time.
 */
export function watchPause(workout: { start: number; end: number; duration: number }, points: readonly PausePoint[]): WatchPause | null {
  const end = Math.max(workout.end, workout.start);
  if (!(workout.duration > 0)) return null;
  const length = end - workout.start - Math.round(workout.duration);
  if (length < 1) return null;
  const all = new Set<number>([workout.start, end]);
  const fixes = new Set<number>();
  for (const p of points) {
    if (p.ts < workout.start || p.ts > end) continue;
    const ts = Math.round(p.ts);
    all.add(ts);
    if (validFix(p.lat, p.lon)) fixes.add(ts);
  }
  const candidates = [...(fixes.size >= 2 ? fixes : all)].sort((a, b) => a - b);
  let gapStart = workout.start;
  let gap = 0;
  for (let i = 1; i < candidates.length; i++) {
    const width = candidates[i]! - candidates[i - 1]!;
    if (width > gap) {
      gap = width;
      gapStart = candidates[i - 1]!;
    }
  }
  const start = Math.min(end - length, Math.max(workout.start, Math.round(gapStart + gap / 2 - length / 2)));
  return { start, end: start + length };
}
