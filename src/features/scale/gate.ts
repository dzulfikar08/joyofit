import type { ScaleReading } from './types';

/** A weight a person can plausibly be (JoyoRogo accepts 25..400 kg; anything below 10 kg is a scale idling or a pet on it). */
export const MIN_WEIGHT_KG = 10;
export const MAX_WEIGHT_KG = 400;

/** Identical readings closer than this are one weigh-in (a scale repeating its final frame, or the person stepping on twice). */
export const DEDUPE_MS = 2 * 60 * 1000;

/** Two weights this close count as "the same" (scales resolve 0.05 to 0.1 kg). */
export const SAME_WEIGHT_KG = 0.05;

export interface GateOptions {
  /**
   * Consecutive equal stable frames needed before a reading is final. 1 for connected scales (their stable flag is explicit).
   * Broadcast scales repeat their final frame many times a second and a few formats (OKOK V11 / VF0) have no stable flag, so 2.
   */
  repeats: number;
  dedupeMs?: number;
}

export interface GateOutput {
  /** A reading that is still settling (shown live, never saved). */
  live?: ScaleReading;
  /** A settled weigh-in to save. */
  final?: ScaleReading;
  /**
   * The settled weight of the previous `final` arrived again with impedance it did not have: the saved row should be completed, not
   * duplicated.
   */
  upgrade?: boolean;
}

/**
 * Turns the frames of one scale into weigh-ins: a frame that is not stable is live, `repeats` equal stable frames in a row make a final,
 * and the same weight again within `dedupeMs` is not a new weigh-in (except to add impedance the first final lacked).
 */
export class ReadingGate {
  private readonly repeats: number;
  private readonly dedupeMs: number;
  private run = 0;
  private runWeight = Number.NaN;
  private last: { weightKg: number; at: number; hadImpedance: boolean } | null = null;

  constructor(options: GateOptions) {
    this.repeats = Math.max(1, options.repeats);
    this.dedupeMs = options.dedupeMs ?? DEDUPE_MS;
  }

  push(reading: ScaleReading, now: number): GateOutput {
    const w = reading.weightKg;
    if (!Number.isFinite(w) || w < MIN_WEIGHT_KG || w > MAX_WEIGHT_KG) {
      this.run = 0;
      return {};
    }
    if (!reading.stable) {
      this.run = 0;
      return { live: reading };
    }
    this.run = Math.abs(w - this.runWeight) <= SAME_WEIGHT_KG ? this.run + 1 : 1;
    this.runWeight = w;
    if (this.run < this.repeats) return { live: { ...reading, stable: false } };

    const hasImpedance = (reading.impedanceOhm ?? 0) > 0;
    const last = this.last;
    if (last && now - last.at < this.dedupeMs && Math.abs(w - last.weightKg) <= SAME_WEIGHT_KG) {
      if (hasImpedance && !last.hadImpedance) {
        this.last = { weightKg: last.weightKg, at: last.at, hadImpedance: true };
        return { final: reading, upgrade: true };
      }
      return {};
    }
    this.last = { weightKg: w, at: now, hadImpedance: hasImpedance };
    return { final: reading };
  }

  /** The person left the scale (link dropped, scan restarted): the next stable frame starts a new run. */
  reset(): void {
    this.run = 0;
    this.runWeight = Number.NaN;
  }
}
