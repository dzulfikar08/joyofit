import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { t } from '@/i18n';
import { HuaweiWear, type CameraRemoteStatus } from '@/wear';

export { cameraRemoteState, PENDING_OPEN_MS } from './state';

/** The camera screen's route. */
export const CAMERA_HREF = '/camera' as const;

const CHANNEL_ID = 'watch-camera';
const NOTIFICATION_ID = 'watch-camera-open';

/** The watch's Remote shutter, or "not connected" on a binary without it (web, tests). */
export function cameraRemoteStatus(): CameraRemoteStatus {
  try {
    return HuaweiWear.getCameraRemote();
  } catch {
    return { connected: false, supported: false };
  }
}

/** Tells the watch the phone's viewfinder is on screen (its shutter then works) or has closed. Never throws. */
export async function reportPhoneCamera(open: boolean): Promise<void> {
  try {
    await HuaweiWear.setPhoneCameraOpen(open);
  } catch {
    // no watch module or no link: nothing to tell
  }
}

/**
 * JoyoFit is in the background and the watch opened its shutter: a notification that brings the app (and the camera) forward. Only
 * when notifications are already allowed; it never asks from the background.
 */
export async function notifyOpenCamera(): Promise<void> {
  try {
    if (!(await Notifications.getPermissionsAsync()).granted) return;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: t('watch:camera.channel'),
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIFICATION_ID,
      content: { title: t('watch:camera.notifyTitle'), body: t('watch:camera.notifyBody'), data: { url: CAMERA_HREF } },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null,
    });
  } catch {
    // a missed notification only means opening JoyoFit by hand
  }
}

/** Takes the notification down (the camera opened, or the watch closed its shutter). */
export async function clearOpenCameraNotification(): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(NOTIFICATION_ID);
  } catch {
    // nothing shown
  }
}
