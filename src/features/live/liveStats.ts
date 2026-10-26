/**
 * Figures of a workout started on the watch that the watch does not send and the native payload does not carry: the average and the
 * highest heart rate over the `19/03` readings, and the phone's steps, cadence and stride. Fed with every `LiveWorkout` payload and
 * every reading of the phone's step counter (`liveExtras.ts`). Pure: no React Native, runs under bun test.
 */
import { PhoneStepCount } from '@/features/sensors/phoneSteps';

import { strideLength } from './runFields';

/**
 * A reading counts for at most this long before the next payload (milliseconds). The payload changes about every second while the phone's
 * GPS runs and with every heart-rate report (about every 6 s); a longer gap is the app not hearing the watch (background, link lost), and
 * filling it with the last reading would make it up.
 */
export const HR_HOLD_MS = 20_000;

/**
 * The heart rate of the running stretches of a workout: the average weighted by time (each reading holds until the next payload, at
 * most `HR_HOLD_MS`) and the highest. Readings of a pause, before the start and after the end count for neither.
 */
export class HrStats {
  private sum = 0;
  private weightMs = 0;
  private max: number | null = null;
  private last: { hr: number | null; running: boolean; at: number } | null = null;

  /** A payload: the heart rate it carries (null or 0: none), whether the workout clock runs, and its time (Unix ms). */
  update(hr: number | null, running: boolean, atMs: number): void {
    const prev = this.last;
    if (prev !== null && atMs < prev.at) return;
    if (prev !== null && prev.running && prev.hr !== null) {
      const dt = Math.min(atMs - prev.at, HR_HOLD_MS);
      this.sum += prev.hr * dt;
      this.weightMs += dt;
    }
    const reading = hr !== null && Number.isFinite(hr) && hr > 0 ? hr : null;
    if (running && reading !== null) this.max = this.max === null ? reading : Math.max(this.max, reading);
    this.last = { hr: reading, running, at: atMs };
  }

  /** Whole bpm; the first reading itself until a second payload gives it a duration; null before any running reading. */
  average(): number | null {
    if (this.weightMs > 0) return Math.round(this.sum / this.weightMs);
    return this.last?.running && this.last.hr !== null ? this.last.hr : null;
  }

  maximum(): number | null {
    return this.max;
  }
}

/** What the live screen shows besides the payload's own figures; every one null while unknown. */
export interface LiveExtraFigures {
  avgHr: number | null;
  maxHr: number | null;
  /** The phone's steps while the clock ran, null before its counter's first reading. */
  steps: number | null;
  /** The phone's steps per minute of the last seconds. */
  cadence: number | null;
  /** Metres per step: the distance since the phone's counter started over its steps. */
  strideM: number | null;
}

/** One watch-started session's heart-rate figures and phone step count. */
export class LiveExtrasSession {
  readonly hr = new HrStats();
  readonly steps = new PhoneStepCount();
  private running = false;
  private distanceM: number | null = null;
  /** The session's distance when the phone's counter gave its first reading: the stride covers the same stretch as the steps. */
  private distanceAtFirstStep: number | null = null;

  constructor(readonly id: number) {}

  /** A payload of this session: its heart rate, whether the clock runs, its time, and the distance the screen shows. */
  payload(hr: number | null, running: boolean, atMs: number, distanceM: number | null): void {
    this.hr.update(hr, running, atMs);
    if (this.running && !running) this.steps.pause();
    this.running = running;
    this.distanceM = distanceM;
  }

  /** A reading of the phone's step counter (cumulative since it started). */
  stepReading(count: number, tsMs: number): void {
    if (!this.steps.started) this.distanceAtFirstStep = this.distanceM ?? 0;
    this.steps.reading(count, tsMs, this.running);
  }

  figures(nowMs: number): LiveExtraFigures {
    const started = this.steps.started;
    const stretch = started && this.distanceM !== null && this.distanceAtFirstStep !== null ? this.distanceM - this.distanceAtFirstStep : null;
    return {
      avgHr: this.hr.average(),
      maxHr: this.hr.maximum(),
      steps: started ? this.steps.total : null,
      cadence: started ? this.steps.cadence(nowMs) : null,
      strideM: started ? strideLength(stretch, this.steps.total) : null,
    };
  }
}
