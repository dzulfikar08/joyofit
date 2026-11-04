import { useEventListener } from 'expo';
import { useRootNavigationState, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { OPEN_IN_STACK } from '@/components/navigation';
import { HuaweiWear, type CameraRemoteEvent } from '@/wear';

import { CAMERA_HREF, cameraRemoteState, clearOpenCameraNotification, notifyOpenCamera } from './cameraRemote';

/**
 * The watch's Remote shutter, while the camera screen is not showing: an open (or a shutter press) from the watch opens the camera
 * screen when JoyoFit is in front; in the background it posts a notification, and the camera opens when the app comes back within a
 * minute. While the screen is mounted it handles the watch's events itself.
 */
export function CameraRemoteRunner() {
  const router = useRouter();
  // Navigating before the tabs are mounted throws; the key appears once they are.
  const navigatorReady = useRootNavigationState()?.key !== undefined;

  useEventListener(HuaweiWear, 'onCameraRemote', (event: CameraRemoteEvent) => {
    if (cameraRemoteState.screenMounted) return;
    if (event.action === 'close') {
      cameraRemoteState.clearPendingOpen();
      cameraRemoteState.takePendingShutter();
      void clearOpenCameraNotification();
      return;
    }
    if (AppState.currentState === 'active' && navigatorReady) {
      // A shutter press before the camera was up is taken once it is ready.
      if (event.action === 'shutter') cameraRemoteState.queueShutter();
      router.navigate(CAMERA_HREF, OPEN_IN_STACK);
    } else {
      cameraRemoteState.markPendingOpen(Date.now());
      if (event.action === 'open') void notifyOpenCamera();
    }
  });

  useEffect(() => {
    if (!navigatorReady) return;
    const open = () => {
      if (cameraRemoteState.takePendingOpen(Date.now()) && !cameraRemoteState.screenMounted) router.navigate(CAMERA_HREF, OPEN_IN_STACK);
    };
    open();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') open();
    });
    return () => subscription.remove();
  }, [navigatorReady, router]);

  return null;
}
