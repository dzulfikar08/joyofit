/**
 * Where the watch was paused during a workout, worked out once for everything that has to agree on it: the Strava file
 * writes it as timer stops and starts (`strava/activityFile.ts`), and the analysis leaves it out of the split times
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

/** An empty stretch shorter than this is the watch's normal sampling, not a pause; only the first pause may sit in one. */
export const MIN_PAUSE_GAP_SEC = 10;
/** Pause time the empty stretches cannot hold, up to this much, widens the longest pause (the watch's timer and its stamps differ by seconds). */
export const PAUSE_WIDEN_MAX_SEC = 10;

/**
 * The watch's pauses, in time order. The watch only gives its timer (`duration`), so the paused time is `elapsed - timer`
 * seconds (2 s on a run whose end stamp is 2 s after the timer stopped, hours on a trail run with many stops); Strava reads
 * its moving time from the timer events once a file has a pause (see `times.ts`). Where the pauses sat is not stored, but
 * nothing is recorded while the watch is paused, so they lie in the stretches the samples leave empty: the gaps between GPS
 * fixes when the workout has at least two (the watch stops the GPS when it pauses; heart-rate samples may run on or stop a
 * little later), else between any samples, the start and the end included. Samples count per whole second inside
 * `[start, end]`.
 *
 * The paused time goes into the longest gaps first, each pause as long as its gap (the last one cut to what is left and
 * centred in it). A pause never covers a fix: Strava drops every record while the timer is stopped and draws a straight line
 * over them (a trail run with 1:46 of stops lost kilometres of track when the whole time was one pause around its longest
 * gap). What the gaps cannot hold, up to `PAUSE_WIDEN_MAX_SEC`, widens the longest pause, kept inside the workout; more than
 * that is left out (the file's timer then runs a little longer than the watch's). Empty when the watch reports no timer or
 * the timer is not shorter than the elapsed time.
 */
export function watchPauses(workout: { start: number; end: number; duration: number }, points: readonly PausePoint[]): WatchPause[] {
  const end = Math.max(workout.end, workout.start);
  if (!(workout.duration > 0)) return [];
  const length = end - workout.start - Math.round(workout.duration);
  if (length < 1) return [];
  const all = new Set<number>([workout.start, end]);
  const fixes = new Set<number>();
  for (const p of points) {
    if (p.ts < workout.start || p.ts > end) continue;
    const ts = Math.round(p.ts);
    all.add(ts);
    if (validFix(p.lat, p.lon)) fixes.add(ts);
  }
  const candidates = [...(fixes.size >= 2 ? fixes : all)].sort((a, b) => a - b);
  const gaps: { start: number; width: number }[] = [];
  for (let i = 1; i < candidates.length; i++) gaps.push({ start: candidates[i - 1]!, width: candidates[i]! - candidates[i - 1]! });
  // Longest first; equal gaps keep their time order.
  gaps.sort((a, b) => b.width - a.width);

  const pauses: WatchPause[] = [];
  let remaining = length;
  for (const gap of gaps) {
    if (remaining <= 0) break;
    if (pauses.length > 0 && (remaining <= PAUSE_WIDEN_MAX_SEC || gap.width < MIN_PAUSE_GAP_SEC)) break;
    if (gap.width <= 0) break;
    const take = Math.min(gap.width, remaining);
    const start = Math.round(gap.start + gap.width / 2 - take / 2);
    pauses.push({ start, end: start + take });
    remaining -= take;
  }
  if (remaining > 0 && remaining <= PAUSE_WIDEN_MAX_SEC) {
    const longest = pauses[0];
    const want = (longest ? longest.end - longest.start : 0) + remaining;
    const centre = longest ? (longest.start + longest.end) / 2 : (workout.start + end) / 2;
    const start = Math.min(end - want, Math.max(workout.start, Math.round(centre - want / 2)));
    if (longest) pauses[0] = { start, end: start + want };
    else pauses.push({ start, end: start + want });
  }
  return merged(pauses);
}

/** Sorted, with overlapping or touching pauses joined (a widened pause can reach its neighbour). */
function merged(pauses: WatchPause[]): WatchPause[] {
  const sorted = [...pauses].sort((a, b) => a.start - b.start);
  const out: WatchPause[] = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last && p.start <= last.end) last.end = Math.max(last.end, p.end);
    else out.push({ ...p });
  }
  return out;
}

/** Seconds of `[from, to]` that fall inside the pauses (any unit, as long as both agree). */
export function pausedWithin(pauses: readonly { start: number; end: number }[], from: number, to: number): number {
  let sec = 0;
  for (const p of pauses) sec += Math.max(0, Math.min(to, p.end) - Math.max(from, p.start));
  return sec;
}
