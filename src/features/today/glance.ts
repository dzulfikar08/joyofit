/**
 * The two Today tiles' numbers. Pure: no React, no storage.
 */
import type { StepSample } from '@/wear';

/** One point of the small heart-rate line: a stored reading, or the mean of a few neighbours when the day has more than the line can show. */
export interface TrailPoint {
  /** Unix seconds. */
  timestamp: number;
  bpm: number;
}

/**
 * Today's heart-rate readings (oldest first, those without a positive reading skipped) reduced to at most `maxPoints` for a tile-sized
 * line: runs of neighbouring readings are averaged. Fewer readings than that are kept as they are. Empty when the day has none.
 */
export function heartTrail(samples: readonly StepSample[], maxPoints: number): TrailPoint[] {
  const beats: TrailPoint[] = [];
  for (const s of samples) {
    if (s.heartRate !== null && s.heartRate > 0) beats.push({ timestamp: s.timestamp, bpm: s.heartRate });
  }
  if (beats.length <= maxPoints) return beats;
  const out: TrailPoint[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const from = Math.floor((i * beats.length) / maxPoints);
    const to = Math.floor(((i + 1) * beats.length) / maxPoints);
    const chunk = beats.slice(from, Math.max(to, from + 1));
    out.push({
      timestamp: Math.round(chunk.reduce((a, p) => a + p.timestamp, 0) / chunk.length),
      bpm: chunk.reduce((a, p) => a + p.bpm, 0) / chunk.length,
    });
  }
  return out;
}
