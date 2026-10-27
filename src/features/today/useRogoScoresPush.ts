import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';

import { authClient } from '@/cloud/auth';
import { RogoError, rogo, type RogoScoreMetrics } from '@/cloud/rogo';
import { rogoScoreDays } from '@/features/today/rogoScores';
import type { Scores } from '@/features/today/scores';
import { errorMessage } from '@/format';
import { pushLog } from '@/state/logStore';

/** Wait this long after the scores change so a burst of re-reads becomes one request. */
const PUSH_DEBOUNCE_MS = 3_000;
/** After JoyoRogo answered 404 (not deployed with the `fitness` router yet), do not ask again for this long. */
const UNSUPPORTED_BACKOFF_MS = 30 * 60 * 1000;

let unsupportedAt = 0;

const log = (direction: 'info' | 'error', message: string) =>
  pushLog({ ts: Date.now(), direction, serviceId: null, commandId: null, hex: null, message });

/**
 * Sends the last few days' Recovery / Strain / Sleep to JoyoRogo's diary while signed in to JoyoRogo, with today's body
 * metrics (`metrics`: sleep hours, resting HR, HRV, VO2max, training status, recovery time; whichever JoyoFit has computed),
 * the hours slept on each earlier day of the week (`sleepHours`), and the watch's all-day active energy per day (`activeKcal`,
 * which JoyoRogo counts in Sisa). `activeKcal` stays ACTIVE energy only, never the Today tile's total: JoyoRogo adds its own
 * BMR, so sending resting energy too would count it twice. A change of any of them (also only the active energy of a day) changes the serialized days
 * and so is sent again.
 * It runs when the scores change (every stored sync and every time Today regains focus re-reads them) and when the app returns to the
 * foreground, and only sends what differs from the last accepted push. Nothing is shown: a failure is a line in the Log
 * screen, and a JoyoRogo that does not have the procedure yet (404) is skipped quietly for a while.
 */
export function useRogoScoresPush(
  scores: Scores | null,
  dayStart: number | null,
  metrics?: RogoScoreMetrics,
  activeKcal?: ReadonlyMap<string, number>,
  sleepHours?: ReadonlyMap<string, number>,
): void {
  const session = authClient.useSession();
  const signedIn = session.data?.user != null;

  const days = useMemo(
    () => (scores && dayStart !== null ? rogoScoreDays(scores, dayStart, metrics, activeKcal, sleepHours) : []),
    [scores, dayStart, metrics, activeKcal, sleepHours],
  );
  const payload = useMemo(() => JSON.stringify(days), [days]);
  const latest = useRef({ days, payload });
  // Declared before the effects that call `push`, so they see this render's scores.
  useEffect(() => {
    latest.current = { days, payload };
  }, [days, payload]);
  const accepted = useRef<string | null>(null);
  const inFlight = useRef(false);

  const push = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      // Loops while the scores changed during the request, so the last version always goes out.
      for (;;) {
        const { days: toSend, payload: body } = latest.current;
        if (toSend.length === 0 || accepted.current === body) return;
        if (Date.now() - unsupportedAt < UNSUPPORTED_BACKOFF_MS) return;
        try {
          await rogo.pushScores(toSend);
          accepted.current = body;
          log('info', `JoyoRogo scores: sent ${toSend.length} day${toSend.length === 1 ? '' : 's'}`);
        } catch (e) {
          if (e instanceof RogoError && (e.status === 404 || e.status === 405)) {
            unsupportedAt = Date.now();
            log('info', 'JoyoRogo scores: this JoyoRogo has no fitness scores yet, skipped');
          } else {
            log('error', `JoyoRogo scores: ${errorMessage(e)}`);
          }
          return;
        }
      }
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    // Another account must not inherit "already sent".
    if (!signedIn) accepted.current = null;
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    const timer = setTimeout(() => void push(), PUSH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [signedIn, payload, push]);

  useEffect(() => {
    if (!signedIn) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void push();
    });
    return () => sub.remove();
  }, [signedIn, push]);
}
