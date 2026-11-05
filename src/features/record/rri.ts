/**
 * R-R intervals (beat-to-beat, milliseconds) from a chest strap's `0x2A37` characteristic, kept so HRV can be worked out after a
 * session. The recorder captures them; this file holds the pure rules (bounds + artefact filter) so they test without React Native.
 * (JoyoFit, from Jeremy's review: BLE-01.)
 */

/** Physiological bounds: 250 ms is 240 bpm, 2000 ms is 30 bpm. Anything outside is a mis-read, not a heartbeat. */
export const RRI_MIN_MS = 250;
export const RRI_MAX_MS = 2000;

/** Keeps only intervals a human heart can produce. */
export function withinPhysiological(rri: number): boolean {
  return rri >= RRI_MIN_MS && rri <= RRI_MAX_MS;
}

/** Beat-to-beat variability of a session, computed from the filtered intervals once enough beats exist. */
export interface HrvMetrics {
  /** Root mean square of successive differences (ms): the common short-term HRV measure. */
  rmssd: number;
  /** Standard deviation of the intervals (ms). */
  sdnn: number;
  /** Intervals it was computed from. */
  beats: number;
}

/** Fewer than this many clean intervals do not make a trustworthy figure (the watch's own spot HRV needs 40 beats). */
export const MIN_RRI_FOR_HRV = 30;

/** RMSSD and SDNN from already-filtered intervals, or null when there are too few. */
export function hrvMetrics(rri: readonly number[]): HrvMetrics | null {
  if (rri.length < MIN_RRI_FOR_HRV) return null;
  const mean = rri.reduce((a, b) => a + b, 0) / rri.length;
  const sdnn = Math.sqrt(rri.reduce((a, b) => a + (b - mean) ** 2, 0) / rri.length);
  let sumSq = 0;
  for (let i = 1; i < rri.length; i++) sumSq += (rri[i]! - rri[i - 1]!) ** 2;
  const rmssd = Math.sqrt(sumSq / (rri.length - 1));
  return { rmssd: Math.round(rmssd * 10) / 10, sdnn: Math.round(sdnn * 10) / 10, beats: rri.length };
}

function median4(a: number, b: number, c: number, d: number): number {
  const s = [a, b, c, d].sort((x, y) => x - y);
  return (s[1]! + s[2]!) / 2;
}

/**
 * Replaces ectopic beats and dropped/doubled intervals with a local estimate, so a few bad beats do not wreck RMSSD. Each interval is
 * compared with the median of its four neighbours (two each side); one more than 20 % away is replaced by the mean of its immediate
 * neighbours (close to the Task Force 1996 moving-average rule). The first two and last two are left as they are, and a run shorter
 * than five is returned unchanged.
 */
export function filterRriArtefacts(raw: readonly number[]): number[] {
  if (raw.length < 5) return [...raw];
  const out = [...raw];
  for (let i = 2; i < raw.length - 2; i++) {
    const localMedian = median4(raw[i - 2]!, raw[i - 1]!, raw[i + 1]!, raw[i + 2]!);
    if (Math.abs(raw[i]! - localMedian) > 0.2 * localMedian) {
      out[i] = (raw[i - 1]! + raw[i + 1]!) / 2;
    }
  }
  return out;
}
