/**
 * The live half of the rest timer: a countdown that keeps running on the lock screen (an Android notification with a chronometer, an iOS
 * Live Activity), through the `rest-timer` native module. The "rest is over" alert stays with `restNotification.ts`; this one is silent.
 *
 * The logger's screen calls `syncRestLive` after every change of the draft and `restNotification.cancelRestEnd` (which ends this too) when
 * a rest is skipped, over, or the workout is finished or discarded. A binary built before the module existed has none: every call is then
 * a no-op and the rest behaves as it always did.
 */
import { Platform } from 'react-native';

import { t } from '@/i18n';

import { isRestTimerSupported, startRestTimer, stopRestTimer } from '../../../modules/rest-timer';
import { liveRestAllowed, restLiveAction, wantedRestLive, type RestLiveInput, type RestLiveWish } from './restLiveLogic';
import type { RestPermission } from './restNotification';

/** What this session put on the lock screen; undefined until the first call, when a countdown of an earlier session may still be up. */
let shown: RestLiveWish | null | undefined;

/** Whether a countdown may show for this notification permission (Android needs it, iOS does not). */
export function restLiveAllowed(permission: RestPermission): boolean {
  return liveRestAllowed(Platform.OS, permission);
}

/** Makes the lock screen match the draft: starts, moves (+15 s, -15 s, a new exercise) or removes the countdown, and does nothing when it already matches. */
export function syncRestLive(input: Omit<RestLiveInput, 'now'>): void {
  const action = restLiveAction(shown, wantedRestLive({ ...input, now: Date.now() }));
  if (!action) return;
  if (action.type === 'stop') {
    shown = null;
    stopRestTimer();
    return;
  }
  if (!isRestTimerSupported()) return;
  shown = action.wish;
  startRestTimer({
    endsAt: action.wish.endsAt,
    title: t('strength:liveRest.title'),
    body: action.wish.exerciseName ? t('strength:liveRest.bodyNamed', { name: action.wish.exerciseName }) : t('strength:liveRest.body'),
    channelName: t('strength:liveRest.channel'),
  });
}

/** Removes the countdown. Safe to call when none is up. */
export function stopRestLive(): void {
  shown = null;
  stopRestTimer();
}
