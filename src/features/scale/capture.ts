import { bodyOf } from './body';
import { needsConfirmation, type Reference } from './guard';
import { ROGO_MAX_KG, ROGO_MIN_KG } from './rogoMap';
import { completeWeighIn, insertWeighIn, type ScaleDb, type WeighIn } from './store';
import type { ScaleReading, ScaleUser } from './types';

export interface CaptureContext {
  db: ScaleDb;
  scaleId: string;
  protocolId: string;
  /** The person's profile for body estimates; null without height, age and sex. */
  user: ScaleUser | null;
  /** Percent from the last weight that makes the person confirm it is theirs; 0 turns the question off. */
  guardPercent: number;
  /** Whether weigh-ins go on to JoyoRogo (otherwise they are stored as `skipped`). */
  pushToRogo: boolean;
  now: number;
  /** The yardstick for the multi-user question: the person's last weight, from wherever it is known. */
  reference: () => Promise<Reference | null>;
}

/** A weigh-in held back until the person says it is theirs. */
export interface PendingWeighIn {
  scaleId: string;
  protocolId: string;
  takenAt: number;
  reading: ScaleReading;
  referenceKg: number;
}

export type CaptureResult =
  | { kind: 'saved'; weighIn: Pick<WeighIn, 'id' | 'weightKg' | 'takenAt'> }
  | { kind: 'completed'; id: number }
  | { kind: 'confirm'; pending: PendingWeighIn };

export interface LastSaved {
  id: number;
  weightKg: number;
}

async function save(ctx: CaptureContext, reading: ScaleReading, takenAt: number): Promise<CaptureResult> {
  const body = bodyOf(reading, ctx.protocolId, ctx.user);
  const inRogoRange = reading.weightKg >= ROGO_MIN_KG && reading.weightKg <= ROGO_MAX_KG;
  const id = await insertWeighIn(ctx.db, {
    scaleId: ctx.scaleId,
    takenAt,
    reading,
    reported: body.reported,
    estimate: body.estimate,
    rogoState: ctx.pushToRogo && inRogoRange ? 'pending' : 'skipped',
  });
  return { kind: 'saved', weighIn: { id, weightKg: reading.weightKg, takenAt } };
}

/**
 * A settled weigh-in from the scale. Same weight again with impedance completes the row saved a moment ago (`upgrade`); a weight far from
 * the person's last one waits for "Ini kamu?"; anything else is saved.
 */
export async function captureFinal(
  ctx: CaptureContext,
  reading: ScaleReading,
  upgrade: boolean,
  last: LastSaved | null,
): Promise<CaptureResult> {
  if (upgrade && last && Math.abs(last.weightKg - reading.weightKg) <= 0.05) {
    const body = bodyOf(reading, ctx.protocolId, ctx.user);
    await completeWeighIn(ctx.db, last.id, { impedanceOhm: reading.impedanceOhm ?? null, reported: body.reported, estimate: body.estimate });
    return { kind: 'completed', id: last.id };
  }
  const reference = await ctx.reference();
  if (reference && needsConfirmation(reading.weightKg, reference, ctx.now, ctx.guardPercent)) {
    return {
      kind: 'confirm',
      pending: { scaleId: ctx.scaleId, protocolId: ctx.protocolId, takenAt: ctx.now, reading, referenceKg: reference.weightKg },
    };
  }
  return save(ctx, reading, ctx.now);
}

/** "Ya, ini aku": saves the held weigh-in with the time it was taken. */
export function confirmPending(ctx: CaptureContext, pending: PendingWeighIn): Promise<CaptureResult> {
  return save({ ...ctx, scaleId: pending.scaleId, protocolId: pending.protocolId }, pending.reading, pending.takenAt);
}
