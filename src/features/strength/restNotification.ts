/**
 * The local notification that tells the person the rest is over when the app is not in front. One notification at most (a fixed
 * identifier replaces the previous one). The permission is asked once, after a one-button explanation that always goes on to the system
 * prompt, the first time a set is completed with the rest timer on; the system answer is remembered and never asked again.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { t } from '@/i18n';
import type { SQLiteDatabase } from 'expo-sqlite';

import { getStrengthMeta, setStrengthMeta } from './store';

const CHANNEL_ID = 'strength-rest';
const IDENTIFIER = 'strength-rest-timer';
const ASKED_KEY = 'restNotificationAsked';

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: t('strength:notification.channel'),
    importance: Notifications.AndroidImportance.HIGH,
  });
}

export type RestPermission = 'granted' | 'ask' | 'blocked';

/** `ask` = the person was never asked and the system would still show its prompt. */
export async function restPermission(db: SQLiteDatabase): Promise<RestPermission> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return 'granted';
    const asked = (await getStrengthMeta(db, ASKED_KEY)) === '1';
    return !asked && current.canAskAgain ? 'ask' : 'blocked';
  } catch {
    return 'blocked';
  }
}

/** The system prompt, after the explanation dialog. Remembers that the person was asked, whatever the answer. */
export async function requestRestPermission(db: SQLiteDatabase): Promise<boolean> {
  await setStrengthMeta(db, ASKED_KEY, '1');
  try {
    await ensureChannel();
    return (await Notifications.requestPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** Schedules the "rest is over" notification at `endsAt` (epoch ms); does nothing for a time in the past. */
export async function scheduleRestEnd(endsAt: number, exerciseName: string | null): Promise<void> {
  const seconds = Math.ceil((endsAt - Date.now()) / 1000);
  try {
    await Notifications.cancelScheduledNotificationAsync(IDENTIFIER);
    if (seconds < 1) return;
    await ensureChannel();
    await Notifications.scheduleNotificationAsync({
      identifier: IDENTIFIER,
      content: {
        title: t('strength:notification.title'),
        body: exerciseName ? t('strength:notification.bodyNamed', { name: exerciseName }) : t('strength:notification.body'),
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds, channelId: CHANNEL_ID },
    });
  } catch {
    // no notification is not worth interrupting a workout for
  }
}

export async function cancelRestEnd(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(IDENTIFIER);
  } catch {
    // nothing scheduled
  }
}
