import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';

import { CLOUD_CONFIGURED } from '@/cloud/config';
import { useDiaryStatus } from '@/cloud/useDiaryStatus';
import { isIos } from '@/components/IosUnavailable';
import { countWatchWorkoutsSince, listDailySteps, listSleepSince } from '@/db/queries';
import { stravaUploadSummary, type StravaUploadSummary } from '@/db/strava';
import { activeWatchName, watchDisplayName } from '@/features/device/watchName';
import { shownName } from '@/features/device/shownName';
import { useWatchPresence } from '@/features/device/useWatchPresence';
import { countNightsSince } from '@/features/today/nightHrv';
import { startOfLocalDay } from '@/features/today/stats';
import { dayBounds, dayStarts } from '@/features/trends/series';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { useCloud } from '@/state/CloudProvider';
import { useScale } from '@/state/ScaleProvider';
import { useStrava } from '@/state/StravaProvider';
import { useWatch } from '@/state/WatchProvider';
import { HuaweiWear, type HealthConnectStatus } from '@/wear';

import { parseExportCounts, type SourceFacts } from './model';
import { HEALTH_STORE } from './store';

/** The window of "what it carried". */
const WEEK_DAYS = 7;
/** Write permission types of the platform store (Android adds the workout route). */
const HEALTH_TYPE_COUNT = isIos ? 8 : 9;

interface Week {
  stepDays: number;
  sleepNights: number;
  workouts: number;
  strava: StravaUploadSummary;
}

export interface SourceFactsState {
  facts: SourceFacts | null;
  health: HealthConnectStatus | null;
}

/** Everything the Sources screen shows, read from the app's own state: stored rows for the last week, the providers, and the native Health Connect / Apple Health status. Null until the first read has finished. */
export function useSourceFacts(): SourceFactsState {
  const db = useSQLiteContext();
  const { dataVersion, lastSync, watches, device } = useWatch();
  const presence = useWatchPresence();
  const cloud = useCloud();
  const strava = useStrava();
  const diary = useDiaryStatus();
  const scale = useScale();
  const [week, setWeek] = useState<Week | null>(null);
  const [health, setHealth] = useState<HealthConnectStatus | null>(null);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const now = Math.floor(Date.now() / 1000);
      const days = dayStarts(startOfLocalDay(now), WEEK_DAYS);
      const since = now - WEEK_DAYS * 86_400;
      Promise.all([listDailySteps(db, dayBounds(days)), listSleepSince(db, since), countWatchWorkoutsSince(db, since), stravaUploadSummary(db, since)]).then(
        ([steps, sleep, workouts, summary]) => {
          if (cancelled) return;
          setNowSec(now);
          setWeek({ stepDays: [...steps.values()].filter((v) => v > 0).length, sleepNights: countNightsSince(sleep, [], since), workouts, strava: summary });
        },
        () => undefined,
      );
      return () => {
        cancelled = true;
      };
      // dataVersion re-runs the read after each stored sync or import.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [db, dataVersion]),
  );

  const refreshHealth = useCallback(() => {
    HuaweiWear.getHealthConnectStatus().then(setHealth, () => undefined);
  }, []);
  useNativeRefresh(refreshHealth);

  const facts = useMemo<SourceFacts | null>(() => {
    if (!week || presence === null) return null;
    const primary = watches.find((w) => w.isPrimary) ?? watches[0];
    const weekAgoMs = (nowSec - WEEK_DAYS * 86_400) * 1000;
    return {
      nowSec,
      watch: {
        // The name Today's card shows: the person's rename, else the model, never the Bluetooth codename.
        name: shownName(device ? activeWatchName(device, watches) : primary ? watchDisplayName({ name: primary.name, alias: primary.alias, model: primary.productModel }) : null),
        paired: presence === 'watch',
        lastSyncSec: lastSync,
        stepDays: week.stepDays,
        sleepNights: week.sleepNights,
        workouts: week.workouts,
      },
      health: {
        store: HEALTH_STORE,
        availability: health?.availability ?? null,
        enabled: health?.enabled ?? false,
        granted: health?.granted.length ?? 0,
        total: HEALTH_TYPE_COUNT,
        lastExportSec: health?.lastExportSec ?? null,
        lastError: health?.lastError ?? null,
        counts: parseExportCounts(health?.lastCounts ?? null),
      },
      strava: { connected: strava.settings.connectedAt !== null, lastUploadSec: week.strava.lastDoneAt, uploaded: week.strava.done, failed: week.strava.failed },
      joyorogo: {
        configured: CLOUD_CONFIGURED,
        signedIn: cloud.signedIn,
        email: cloud.email,
        lastSentMs: diary?.lastSentAt ?? null,
        sent: diary?.sentCount ?? 0,
        waiting: diary?.pending ?? 0,
        lastError: diary?.lastError ?? null,
      },
      scale: {
        name: shownName(scale.scale ? (scale.scale.alias ?? scale.scale.name) : null),
        lastWeighMs: scale.weighIns[0]?.takenAt ?? null,
        weighIns: scale.weighIns.filter((w) => w.takenAt >= weekAgoMs).length,
        waiting: scale.rogoWaiting,
      },
    };
  }, [week, presence, watches, device, lastSync, health, strava.settings.connectedAt, cloud.signedIn, cloud.email, diary, scale.scale, scale.weighIns, scale.rogoWaiting, nowSec]);

  return { facts, health };
}
