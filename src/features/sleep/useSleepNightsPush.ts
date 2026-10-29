import { useSQLiteContext } from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { authClient } from '@/cloud/auth';
import { rogo } from '@/cloud/rogo';
import type { SleepNightPayload } from '@/cloud/sleepInsightsClient';
import { listAllSleep, listHrvReadingsSince, listRestingHeartRateByDay, listSleepScores } from '@/db/queries';
import { buildNights } from '@/features/sleep/nights';
import { buildRogoNights } from '@/features/sleep/rogoNights';
import { publishSleepInsightsStatus, useSleepInsightsStatus } from '@/features/sleep/sleepInsightsStatus';
import {
  pendingSleepBatches,
  serializeNight,
  sleepBackoffActive,
  SLEEP_BACKFILL_NIGHTS,
  type AcceptedNights,
} from '@/features/sleep/sleepPush';
import { roomEnvByWakeDate } from '@/features/thermometer/aggregate';
import { useEnvVersion } from '@/features/thermometer/events';
import { listEnvSamples } from '@/features/thermometer/store';
import { startOfLocalDay } from '@/features/today/stats';
import { addDays, dayBounds, dayStarts } from '@/features/trends/series';
import { errorMessage } from '@/format';
import { pushLog } from '@/state/logStore';

/** Wait this long after the nights change so a burst of re-reads becomes one request. */
const PUSH_DEBOUNCE_MS = 3_000;
/** A reading can end a day after the night it belongs to; read a little further back than the oldest night. */
const READ_MARGIN_DAYS = 2;

let unsupportedAt = 0;

const log = (direction: 'info' | 'error', message: string) =>
  pushLog({ ts: Date.now(), direction, serviceId: null, commandId: null, hex: null, message });

const pushedKey = (userId: string) => `sleepInsights.pushed.${userId}`;

/**
 * The nights JoyoFit holds, as Wawasan tidur takes them (newest 90 wake dates). Each carries the bedroom thermometer's summary of its
 * own sleep window when one covered it (`roomAggregateForNight`); the raw samples stay on the phone, and this runs only while the
 * Wawasan tidur switch is on.
 */
async function readRogoNights(db: ReturnType<typeof useSQLiteContext>): Promise<SleepNightPayload[]> {
  const todayStart = startOfLocalDay(Math.floor(Date.now() / 1000));
  const days = dayStarts(todayStart, SLEEP_BACKFILL_NIGHTS + READ_MARGIN_DAYS);
  const [segments, scores, hrv, resting] = await Promise.all([
    listAllSleep(db),
    listSleepScores(db),
    listHrvReadingsSince(db, addDays(todayStart, -(SLEEP_BACKFILL_NIGHTS + READ_MARGIN_DAYS))),
    listRestingHeartRateByDay(db, dayBounds(days)),
  ]);
  const nights = buildNights(segments, scores);
  const base = buildRogoNights(nights, hrv, resting, SLEEP_BACKFILL_NIGHTS);
  if (base.length === 0) return base;
  try {
    const samples = await listEnvSamples(db, base[0]!.onsetMs, base[base.length - 1]!.wakeMs);
    if (samples.length === 0) return base;
    return buildRogoNights(nights, hrv, resting, SLEEP_BACKFILL_NIGHTS, roomEnvByWakeDate(base, samples));
  } catch (e) {
    // The room summary is a bonus: a failed read sends the nights without it.
    log('error', `JoyoRogo sleep: room readings: ${errorMessage(e)}`);
    return base;
  }
}

/**
 * Sends the nightly sleep summaries to JoyoRogo's Wawasan tidur, only while the server switch (`sleepInsights.status().enabled`)
 * is on. The switch is read from the server at launch and whenever the app returns to the foreground; the Settings switch
 * publishes its answer to `useSleepInsightsStatus` so a toggle there takes effect at once. JoyoRogo computes and shows the
 * findings; this only pushes the rows.
 *
 * The first push after the switch is seen on (nothing accepted here before) sends the last 90 nights in calls of 14; every
 * later push sends the last 14 nights, minus the ones whose payload the server already accepted. A 404/405 (an older JoyoRogo)
 * is skipped for a while; `consent_required` (switched off in JoyoRogo meanwhile) re-reads the switch. Nothing is shown: a
 * failure is a count-only line in the Log screen.
 */
export function useSleepNightsPush(dataVersion: number): void {
  const db = useSQLiteContext();
  const session = authClient.useSession();
  const userId = session.data?.user?.id ?? null;
  const status = useSleepInsightsStatus();
  const envVersion = useEnvVersion();
  const enabled = userId !== null && status?.enabled === true;

  const [nights, setNights] = useState<SleepNightPayload[]>([]);
  const latest = useRef({ nights, userId });
  useEffect(() => {
    latest.current = { nights, userId };
  }, [nights, userId]);
  const accepted = useRef<AcceptedNights>(new Map());
  const inFlight = useRef(false);

  const refreshStatus = useCallback(async () => {
    if (sleepBackoffActive(unsupportedAt, Date.now())) return;
    try {
      const s = await rogo.sleepInsightsStatus();
      if (s === null) {
        unsupportedAt = Date.now();
        log('info', 'JoyoRogo sleep: this JoyoRogo has no sleep insights yet, skipped');
      } else {
        publishSleepInsightsStatus(s);
      }
    } catch (e) {
      log('error', `JoyoRogo sleep: ${errorMessage(e)}`);
    }
  }, []);

  // Read the switch at launch, at sign-in, and when the app returns to the foreground; another account must not inherit state.
  useEffect(() => {
    accepted.current = new Map();
    if (userId === null) {
      publishSleepInsightsStatus(null);
      return;
    }
    void refreshStatus();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshStatus();
    });
    return () => sub.remove();
  }, [userId, refreshStatus]);

  // Switched off: forget what was sent, so switching on again backfills.
  useEffect(() => {
    if (userId !== null && status !== null && !status.enabled) {
      accepted.current = new Map();
      void Storage.removeItem(pushedKey(userId)).catch(() => {});
    }
  }, [userId, status]);

  // Nights are only read while the switch is on.
  if (!enabled && nights.length > 0) setNights([]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    readRogoNights(db).then(
      (rows) => {
        if (!cancelled) setNights(rows);
      },
      (e: unknown) => {
        if (!cancelled) log('error', `JoyoRogo sleep: ${errorMessage(e)}`);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, db, dataVersion, envVersion]);

  const push = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const uid = latest.current.userId;
      if (uid === null) return;
      const key = pushedKey(uid);
      const backfill = (await Storage.getItem(key).catch(() => null)) === null;
      let sent = 0;
      // Loops while the nights changed during a request, so the last version always goes out.
      for (;;) {
        if (sleepBackoffActive(unsupportedAt, Date.now())) return;
        const batches = pendingSleepBatches(latest.current.nights, accepted.current, backfill);
        if (batches.length === 0) break;
        for (const batch of batches) {
          try {
            const outcome = await rogo.pushSleepNights(batch);
            if (outcome.kind === 'unsupported') {
              unsupportedAt = Date.now();
              log('info', 'JoyoRogo sleep: this JoyoRogo has no sleep insights yet, skipped');
              return;
            }
            if (outcome.kind === 'consent_required') {
              log('info', 'JoyoRogo sleep: the switch is off on JoyoRogo, not sent');
              await refreshStatus();
              return;
            }
            for (const n of batch) accepted.current.set(n.wakeDate, serializeNight(n));
            sent += batch.length;
          } catch (e) {
            log('error', `JoyoRogo sleep: ${errorMessage(e)}`);
            return;
          }
        }
      }
      if (backfill) await Storage.setItem(key, '1').catch(() => {});
      if (sent > 0) log('info', `JoyoRogo sleep: sent ${sent} night${sent === 1 ? '' : 's'}`);
    } finally {
      inFlight.current = false;
    }
  }, [refreshStatus]);

  useEffect(() => {
    if (!enabled || nights.length === 0) return;
    const timer = setTimeout(() => void push(), PUSH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [enabled, nights, push]);
}
