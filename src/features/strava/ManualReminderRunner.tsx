import * as Notifications from 'expo-notifications';
import { useRootNavigationState, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { OPEN_IN_STACK } from '@/components/navigation';
import { fmtDistance } from '@/i18n/format';
import { t } from '@/i18n';
import { sportLabel } from '@/features/workouts/sportLabel';
import { useStrava } from '@/state/StravaProvider';
import { useWatch } from '@/state/WatchProvider';

import { getManualReminder, takeNewManualWorkouts, type ReminderWorkout } from './manualReminder';

const CHANNEL_ID = 'strava-manual';
const NOTIFICATION_ID = 'strava-manual-ready';
const TYPE = 'strava_manual';
/** A burst of sync events becomes one pass, like the automatic upload. */
const DEBOUNCE_MS = 3_000;

/** The workout id a "Ready for Strava" notification carries; null for any other notification. */
export function manualReminderWorkoutId(data: unknown): number | null {
  if (typeof data !== 'object' || data === null) return null;
  const { type, workoutId } = data as { type?: unknown; workoutId?: unknown };
  return type === TYPE && typeof workoutId === 'number' && Number.isInteger(workoutId) && workoutId > 0 ? workoutId : null;
}

async function notify(workouts: ReminderWorkout[]): Promise<void> {
  const [newest] = workouts;
  if (!newest) return;
  // Never asks for permission from here: a person who did not allow notifications keeps the button on the workout page.
  if (!(await Notifications.getPermissionsAsync()).granted) return;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: t('sharing:strava.manual.remind.channel'),
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const workout = newest.distance > 0 ? `${sportLabel(newest.sportName)} ${fmtDistance(newest.distance)}` : sportLabel(newest.sportName);
  const body =
    workouts.length > 1
      ? t('sharing:strava.manual.remind.bodyMore', { workout, more: workouts.length - 1 })
      : t('sharing:strava.manual.remind.body', { workout });
  await Notifications.scheduleNotificationAsync({
    identifier: NOTIFICATION_ID,
    content: { title: t('sharing:strava.manual.remind.title'), body, data: { type: TYPE, workoutId: newest.id } },
    trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null,
  });
}

/**
 * "Ready for Strava" (`manualReminder.ts`): after each sync, while Strava is not connected and the manual upload is offered, tells
 * the person a new watch workout can go to Strava by hand; tapping it opens that workout's manual upload.
 */
export function ManualReminderRunner() {
  const db = useSQLiteContext();
  const router = useRouter();
  const navigationReady = useRootNavigationState()?.key != null;
  const { dataVersion } = useWatch();
  const strava = useStrava();
  const active = strava.configured && strava.settings.connectedAt === null && strava.settings.manualUpload;

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => {
      void (async () => {
        // The watermark moves on every pass, so a workout that came while the reminder was off is never announced later.
        const fresh = await takeNewManualWorkouts(db);
        if (fresh.length > 0 && (await getManualReminder(db))) await notify(fresh);
      })().catch(() => {});
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [db, active, dataVersion]);

  const lastResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!navigationReady || !lastResponse || lastResponse.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const workoutId = manualReminderWorkoutId(lastResponse.notification.request.content.data);
    if (workoutId !== null) router.push({ pathname: '/workouts/strava-upload', params: { id: String(workoutId) } }, OPEN_IN_STACK);
  }, [lastResponse, navigationReady, router]);

  return null;
}
