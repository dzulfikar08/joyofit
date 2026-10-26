/**
 * The phone's step counter turned into a workout's steps and cadence: the readings are cumulative counts (`onSteps` of a recorded
 * workout, `onLiveSteps` of a watch-started one, `modules/ble-sensors`), and this keeps the steps counted while the workout clock runs
 * and the steps per minute of the last seconds. The Run recorder (`record/recorder.ts`) and the watch-started live screen
 * (`live/liveExtras.ts`) both count with it. Pure: no React Native, runs under bun test.
 *
 * Phones hand their steps over late and in bursts: Android's step counter may hold its count back for 10 s and more (one event
 * with 20 new steps), a phone whose processor sleeps keeps the events in the sensor hub and delivers a whole batch at once, iOS
 * sends an update every second or two. So the cadence is taken over the sensor's own times of the readings (not their arrival),
 * over the last `PHONE_CADENCE_WINDOW_MS`; it holds while no new step has come for as long as the counter has lately taken to
 * report one (`holdMs`), then fades to 0. A silence is a stop only once it is longer than the counter's usual delay.
 */

/** The cadence covers the steps of this long (sensor time), counted from the reading just before it when the readings are sparser. */
export const PHONE_CADENCE_WINDOW_MS = 20_000;
/** The cadence needs readings at least this far apart. */
export const PHONE_STEPS_MIN_SPAN_MS = 4000;
/** No new step for this long is a stop, unless the counter has lately taken longer than that to report its steps (`holdMs`). */
export const PHONE_STEPS_HOLD_MS = 8000;
/** The longest hold; and two readings further apart than this are a stand: the cadence starts over after it. */
export const PHONE_STEPS_MAX_HOLD_MS = 60_000;
/** After the hold the cadence fades to 0 over this long. */
export const PHONE_CADENCE_FADE_MS = 4000;
/** How long a reporting delay of the counter keeps lengthening the hold. */
const WAIT_MEMORY_MS = 120_000;
/** A reading's delay counts for the hold only when the steps it brings are walking for the whole gap: a stand is not a slow counter. */
const WALKING_SPM = 40;
/** More than this many steps per minute is not a human on foot (counter glitch, phone shaken). */
export const MAX_PHONE_CADENCE_SPM = 260;

interface Reading {
  /** The sensor's time of the reading (Unix ms): when its newest step was taken. */
  ts: number;
  count: number;
  /** The pedometer's own steps per minute at this reading (iOS), null without one. */
  spm: number | null;
}

export class PhoneStepCount {
  /** Steps counted while the clock ran (differences of the cumulative readings), pauses excluded. */
  total = 0;
  /**
   * The readings of the current stretch while the clock ran, oldest first: the window and the one reading before it. Emptied by a
   * pause, a counter that starts over and a stand longer than `PHONE_STEPS_MAX_HOLD_MS`.
   */
  private readings: Reading[] = [];
  /** The newest raw reading seen (also while paused): the baseline of the next difference. */
  private last: { count: number; ts: number } | null = null;
  /** The sensor time of the newest counted reading that moved the count: the newest step. */
  private lastStepTs: number | null = null;
  /** How long after the reading before it each walking reading reached the app (`at`, Unix ms): what the hold waits out. */
  private waits: { at: number; ms: number }[] = [];

  /**
   * A reading: `count` steps since the counter started (cumulative), `tsMs` the sensor's time of it, `counting` whether the workout
   * clock runs, `atMs` when it reached the app (later than `tsMs` when the phone held it back), `spm` the pedometer's own cadence
   * when it gives one (iOS). The steps between two readings are added while the clock runs; those of a pause are skipped. A count
   * lower than the one before (the counter restarted, the phone rebooted) starts the baseline over without subtracting anything.
   */
  reading(count: number, tsMs: number, counting: boolean, atMs: number = tsMs, spm: number | null = null): void {
    if (!Number.isFinite(count) || !Number.isFinite(tsMs)) return;
    const before = this.last;
    // The sensor's clock does not go back; a wall-clock jump must not make a negative span.
    const ts = before !== null ? Math.max(tsMs, before.ts) : tsMs;
    this.last = { count, ts };
    if (before !== null && count < before.count) {
      this.readings = [];
      this.lastStepTs = null;
    } else if (before !== null && counting) {
      this.total += count - before.count;
    }
    if (!counting) return;

    const prev = this.readings[this.readings.length - 1];
    // A new baseline (the first reading, a counter that started over) is the newest step too.
    const moved = before === null || count !== before.count;
    if (prev !== undefined && ts - prev.ts > PHONE_STEPS_MAX_HOLD_MS) {
      this.readings = [];
    } else if (prev !== undefined && moved && Number.isFinite(atMs)) {
      const gapMs = ts - prev.ts;
      const walking = gapMs <= 0 || ((count - prev.count) / gapMs) * 60_000 >= WALKING_SPM;
      if (walking) this.waits.push({ at: atMs, ms: Math.max(0, atMs - prev.ts) });
      while (this.waits.length > 0 && (this.waits[0]?.at ?? atMs) < atMs - WAIT_MEMORY_MS) this.waits.shift();
    }
    if (moved) this.lastStepTs = ts;
    this.readings.push({ ts, count, spm: spm !== null && Number.isFinite(spm) && spm > 0 ? spm : null });
    const start = ts - PHONE_CADENCE_WINDOW_MS;
    while (this.readings.length > 2 && (this.readings[1]?.ts ?? start) <= start) this.readings.shift();
  }

  /** The clock stopped: readings of the pause must not enter the cadence of the first seconds after it. */
  pause(): void {
    this.readings = [];
    this.lastStepTs = null;
  }

  /** Whether any reading arrived yet (the counter runs). */
  get started(): boolean {
    return this.last !== null;
  }

  /**
   * How long a silence still holds the cadence at `nowMs`: half again the longest delay of the last two minutes between a reading
   * and the next walking one reaching the app, at least `PHONE_STEPS_HOLD_MS`, at most `PHONE_STEPS_MAX_HOLD_MS`.
   */
  holdMs(nowMs: number): number {
    let longest = 0;
    for (const w of this.waits) if (w.at >= nowMs - WAIT_MEMORY_MS && w.ms > longest) longest = w.ms;
    return Math.min(PHONE_STEPS_MAX_HOLD_MS, Math.max(PHONE_STEPS_HOLD_MS, Math.round(longest * 1.5)));
  }

  /**
   * Steps per minute at `nowMs`: the pedometer's own when the newest reading has one, else the newest reading minus the one at the
   * start of the last `PHONE_CADENCE_WINDOW_MS` (or the oldest of the stretch), over the sensor time between them (at least 4 s). It
   * holds while the newest step is no older than `holdMs`, then fades to 0 over `PHONE_CADENCE_FADE_MS` and stays 0 while the counter
   * runs. Null while the clock is paused, above `MAX_PHONE_CADENCE_SPM`, and before two readings far enough apart (0 once even
   * `PHONE_STEPS_MAX_HOLD_MS` has passed without another).
   */
  cadence(nowMs: number): number | null {
    const newest = this.readings[this.readings.length - 1];
    if (newest === undefined) return null;
    const silence = this.lastStepTs === null ? Infinity : Math.max(0, nowMs - this.lastStepTs);
    const spm = newest.spm ?? this.windowRate(newest);
    // One reading tells nothing of the counter's delay: unknown until even the longest hold is over.
    if (spm === null) return silence >= PHONE_STEPS_MAX_HOLD_MS + PHONE_CADENCE_FADE_MS ? 0 : null;
    const hold = this.holdMs(nowMs);
    if (silence >= hold + PHONE_CADENCE_FADE_MS) return 0;
    if (spm > MAX_PHONE_CADENCE_SPM) return null;
    if (silence <= hold) return Math.round(spm);
    return Math.round(spm * (1 - (silence - hold) / PHONE_CADENCE_FADE_MS));
  }

  private windowRate(newest: Reading): number | null {
    const oldest = this.readings[0];
    if (oldest === undefined) return null;
    const spanMs = newest.ts - oldest.ts;
    if (spanMs < PHONE_STEPS_MIN_SPAN_MS) return null;
    return ((newest.count - oldest.count) / spanMs) * 60_000;
  }
}
