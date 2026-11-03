import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { family } from '@/cloud/family';
import { familyDeviceId, pushPlatform } from '@/features/family/device';
import { t } from '@/i18n';

/** Foreground notifications show like any other: a banner, in the list, with sound. Set once, at import. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

const CHANNEL_ID = 'family';

/** Android 8+ needs a channel before any notification, and Android 13+ before the permission prompt. */
async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: t('family:push.channel'),
    importance: Notifications.AndroidImportance.HIGH,
  });
}

/** The EAS project the Expo push token is minted for; null in a build that has none (the token cannot be made). */
function easProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
}

export type PushOutcome =
  /** The system allows notifications and this phone's push token is with the Worker. */
  | 'enabled'
  /** The person refused the system prompt (or turned notifications off in system settings). */
  | 'denied'
  /** The phone cannot get a push token: no EAS project in this build, or no Google services (some Huawei phones). */
  | 'unavailable';

/** Gets this phone's Expo push token and hands it to the Worker. Throws when the token cannot be made or sent. */
async function registerToken(): Promise<void> {
  const projectId = easProjectId();
  if (projectId === null) throw new Error('This build has no EAS project id.'); // i18n-ok: caught, never shown
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  await family.pushToken.put(token.data, pushPlatform, await familyDeviceId());
}

/**
 * The system prompt and the push token. Call it only after the screen that says why ("Lanjut"): the first call is what
 * shows the system dialog.
 */
export async function enablePush(): Promise<PushOutcome> {
  await ensureChannel();
  const current = await Notifications.getPermissionsAsync();
  const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
  if (!permission.granted) return 'denied';
  try {
    await registerToken();
    return 'enabled';
  } catch {
    return 'unavailable';
  }
}

/** Whether notifications are already allowed, so a screen can skip the explanation. */
export async function pushAllowed(): Promise<boolean> {
  return (await Notifications.getPermissionsAsync()).granted;
}

/**
 * Where the notification permission stands, without asking: `enabled`, `denied` (refused for good: the system shows no prompt any more, only
 * the settings change it) or `idle` (the system prompt is still due). A screen shows the way to the settings for `denied`, not an explanation.
 */
export async function pushStatus(): Promise<'enabled' | 'denied' | 'idle'> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return 'enabled';
  return current.canAskAgain ? 'idle' : 'denied';
}

/**
 * Registers the token again for a person who already allowed notifications: Expo push tokens can change, and the Worker
 * only sends to the one it has. Quiet when it cannot (offline, no project id).
 */
export async function refreshPushToken(): Promise<void> {
  try {
    if (await pushAllowed()) {
      await ensureChannel();
      await registerToken();
    }
  } catch {
    // retried on the next start; nothing to tell the person
  }
}
