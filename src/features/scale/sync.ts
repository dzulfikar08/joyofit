import { toRogoCheckIn, type RogoCheckIn } from './rogoMap';
import { markRogo, pendingWeighIns, type ScaleDb } from './store';

export interface PushOutcome {
  sent: number;
  /** Still pending: JoyoRogo was unreachable or the person is not signed in. */
  waiting: number;
}

/**
 * Sends the weigh-ins JoyoRogo does not have yet through `checkIn` (`weight.checkIn`). JoyoRogo keeps one weight per day (the last one
 * of the day wins), so pending rows go oldest first and the newest of a day ends up as the day's weight. A weight JoyoRogo does not accept
 * is marked `skipped`; a failure leaves the row `pending` for the next try and stops the run (the next rows would fail the same way).
 * `isUnavailable` tells "not signed in / offline" (quiet, retry later) from a real answer (kept as the row's error).
 */
export async function pushPendingWeighIns(
  db: ScaleDb,
  checkIn: (input: RogoCheckIn) => Promise<unknown>,
  isUnavailable: (error: unknown) => boolean,
): Promise<PushOutcome> {
  const pending = await pendingWeighIns(db);
  let sent = 0;
  for (let i = 0; i < pending.length; i++) {
    const row = pending[i];
    const input = toRogoCheckIn({ weightKg: row.weightKg }, row.takenAt);
    if (!input) {
      await markRogo(db, row.id, 'skipped', null);
      continue;
    }
    try {
      await checkIn(input);
    } catch (e) {
      if (!isUnavailable(e)) await markRogo(db, row.id, 'pending', e instanceof Error ? e.message : String(e));
      return { sent, waiting: pending.length - i };
    }
    await markRogo(db, row.id, 'sent', null);
    sent++;
  }
  return { sent, waiting: 0 };
}
