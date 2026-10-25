/**
 * The phone's step counter turned into a workout's steps and cadence: the readings are cumulative counts (`onSteps` of a recorded
 * workout, `onLiveSteps` of a watch-started one, `modules/ble-sensors`), and this keeps the steps counted while the workout clock runs
 * and the steps per minute of the last seconds. The Run recorder (`record/recorder.ts`) and the watch-started live screen
 * (`live/liveExtras.ts`) both count with it. Pure: no React Native, runs under bun test.
 */

/** A reading counts for the cadence this long. */
export const PHONE_STEPS_FRESH_MS = 10_000;
/** The cadence needs readings at least this far apart; a counter silent this long means the person stopped. */
export const PHONE_STEPS_MIN_SPAN_MS = 4000;
/** More than this many steps per minute is not a human on foot (counter glitch, phone shaken). */
export const MAX_PHONE_CADENCE_SPM = 260;

export class PhoneStepCount {
  /** Steps counted while the clock ran (differences of the cumulative readings), pauses excluded. */
  total = 0;
  /** The readings of the last seconds while the clock ran, oldest first. */
  private readings: { ts: number; count: number }[] = [];
  /** The newest raw count seen (also while paused): the baseline of the next difference. */
  private last: number | null = null;

  /**
   * A reading: `count` steps since the counter started (cumulative), `tsMs` its instant, `counting` whether the workout clock runs. The
   * steps between two readings are added while it runs; those of a pause are skipped. A count lower than the one before (the counter
   * restarted, the phone rebooted) starts the baseline over without subtracting anything.
   */
  reading(count: number, tsMs: number, counting: boolean): void {
    if (!Number.isFinite(count) || !Number.isFinite(tsMs)) return;
    const before = this.last;
    this.last = count;
    if (before !== null && count < before) {
      this.readings = [];
    } else if (before !== null && counting) {
      this.total += count - before;
    }
    if (counting) {
      this.readings.push({ ts: tsMs, count });
      const cutoff = tsMs - 2 * PHONE_STEPS_FRESH_MS;
      while (this.readings.length > 2 && (this.readings[0]?.ts ?? cutoff) < cutoff) this.readings.shift();
    }
  }

  /** The clock stopped: readings of the pause must not enter the cadence of the first seconds after it. */
  pause(): void {
    this.readings = [];
  }

  /** Whether any reading arrived yet (the counter runs). */
  get started(): boolean {
    return this.last !== null;
  }

  /**
   * Steps per minute: the newest reading of the last 10 s minus the oldest of them, over the time between them (at least 4 s apart).
   * 0 when the counter did not move over that span, or has said nothing for 4 s (it reports changes only, so silence is a stop); null
   * without a fresh reading, with a single one, or above `MAX_PHONE_CADENCE_SPM`.
   */
  cadence(nowMs: number): number | null {
    const fresh = this.readings.filter((p) => nowMs - p.ts <= PHONE_STEPS_FRESH_MS);
    const newest = fresh[fresh.length - 1];
    const oldest = fresh[0];
    if (!newest || !oldest) return null;
    if (nowMs - newest.ts >= PHONE_STEPS_MIN_SPAN_MS) return 0;
    const spanMs = newest.ts - oldest.ts;
    if (spanMs < PHONE_STEPS_MIN_SPAN_MS) return null;
    const spm = Math.round(((newest.count - oldest.count) / spanMs) * 60_000);
    return spm > MAX_PHONE_CADENCE_SPM ? null : spm;
  }
}
