/**
 * Which one-line insights the Today card at the top can say, and in which order. Pure: it only decides from numbers JoyoFit already
 * has (today's steps against the goal, the readiness headline and its sleep signal, whether a Coach suggestion exists). The words are
 * written by `InsightCard`; nothing here is a statistic about other people and nothing is guessed when a number is missing.
 */
import type { ReadinessHeadline, SignalTone } from '@/features/today/readiness';

/** From this share of the goal (and under it) the card says how many steps are left. */
export const STEPS_CLOSE_SHARE = 0.5;

export type Insight =
  | { kind: 'stepsReached'; steps: number }
  | { kind: 'stepsClose'; left: number }
  | { kind: 'readiness'; headline: ReadinessHeadline; recoveryPercent: number | null }
  | { kind: 'sleep'; tone: SignalTone }
  | { kind: 'coach' };

export interface InsightInput {
  /** Today's steps as the hero ring shows them, null while they are unknown. */
  steps: number | null;
  goal: number;
  /** Today's readiness word; null until there are signals. */
  headline: ReadinessHeadline | null;
  /** Recovery percent (0..100) when HRV has a baseline. */
  recoveryPercent: number | null;
  /** Tone of the readiness sleep signal; null without a recorded night. */
  sleepTone: SignalTone | null;
  /** A Coach suggestion for today exists (Pro account with the data read). */
  coach: boolean;
}

/**
 * The insights to page through, most worth reading first: the step goal (reached, or half way and more), readiness, last night's
 * sleep, then Coach. A kind whose data is missing is left out, so an empty list means the card has nothing honest to say yet.
 */
export function pickInsights(input: InsightInput): Insight[] {
  const { steps, goal, headline, recoveryPercent, sleepTone, coach } = input;
  const out: Insight[] = [];
  if (steps !== null && goal > 0 && steps > 0) {
    if (steps >= goal) out.push({ kind: 'stepsReached', steps });
    else if (steps >= goal * STEPS_CLOSE_SHARE) out.push({ kind: 'stepsClose', left: goal - steps });
  }
  if (headline !== null) out.push({ kind: 'readiness', headline, recoveryPercent });
  if (sleepTone !== null) out.push({ kind: 'sleep', tone: sleepTone });
  if (coach) out.push({ kind: 'coach' });
  return out;
}
