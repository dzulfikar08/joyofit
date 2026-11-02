import { useEventListener } from 'expo';
import { useRootNavigationState, useRouter } from 'expo-router';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import Storage from 'expo-sqlite/kv-store';
import { useSQLiteContext } from 'expo-sqlite';
import { AppState, PermissionsAndroid, Platform } from 'react-native';

import { t } from '@/i18n';
import { rememberedWatch } from '@/features/device/rememberedWatch';
import { isActive } from '@/features/live/liveWorkout';
import { isStrengthSport } from '@/features/strength/watchLive';
import { useWatch } from '@/state/WatchProvider';
import { HuaweiWear, type LiveWorkout } from '@/wear';
import { OPEN_IN_STACK } from '@/components/navigation';
import { appAlert } from '@/components/AppAlert';

/** Set once the location explanation was shown, so the dialog does not come back on every launch. */
const GPS_EXPLAINED_KEY = 'joyofit.gpsExplained';

const LiveWorkoutContext = createContext<LiveWorkout | null | undefined>(undefined);

/** The workout started on the watch, or the last one until dismissed; null when none. */
export function useLiveWorkout(): LiveWorkout | null {
  const value = useContext(LiveWorkoutContext);
  if (value === undefined) throw new Error('useLiveWorkout must be used inside <LiveWorkoutProvider>');
  return value;
}

/**
 * Follows a workout started on the watch (native `LiveWorkout.kt`). When one starts while the app is open, or the app
 * opens during one, the live screen opens by itself, once per workout. With the app closed the native notification
 * links to the same screen.
 */
export function LiveWorkoutProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  // Navigating before the tabs are mounted throws; the key appears once they are.
  const navigatorReady = useRootNavigationState()?.key !== undefined;
  const [live, setLive] = useState<LiveWorkout | null>(() => HuaweiWear.getLiveWorkout());
  const [foreground, setForeground] = useState(() => AppState.currentState === 'active');
  const opened = useRef<number | null>(null);

  useEventListener(HuaweiWear, 'onLiveWorkout', setLive);

  // A JS reload or a return from the background may have missed events.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active');
      if (state === 'active') setLive(HuaweiWear.getLiveWorkout());
    });
    return () => subscription.remove();
  }, []);

  // The watch asks for the phone's GPS during outdoor workouts; that needs precise location. Explain it once before
  // Android's dialog; Settings > Phone and calls can ask again. Only with a watch in the picture: a phone that never had one
  // (a strength-only install) is not asked about a watch's GPS, and the question comes with the first pairing instead.
  const db = useSQLiteContext();
  const linked = useWatch().device !== null;
  useEffect(() => {
    // Android only: iOS asks for location itself (the system prompt, when-in-use) the first time the watch wants the phone's GPS.
    if (Platform.OS !== 'android') return;
    const fine = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
    void (async () => {
      if (!(await rememberedWatch(db))) return;
      if (await PermissionsAndroid.check(fine)) return;
      if ((await Storage.getItem(GPS_EXPLAINED_KEY)) === '1') return;
      await Storage.setItem(GPS_EXPLAINED_KEY, '1');
      appAlert(t('common:gps.title'), t('common:gps.body'), [
        { text: t('common:gps.notNow'), style: 'cancel' },
        { text: t('common:gps.continue'), onPress: () => void PermissionsAndroid.request(fine) },
      ]);
    })();
  }, [db, linked]);

  const activeId = isActive(live) ? live.id : null;
  // A strength workout on the watch opens the strength logger (the routine picker first when none is in progress), not the generic screen.
  const strength = isActive(live) && isStrengthSport(live.sportType);
  useEffect(() => {
    if (activeId === null || opened.current === activeId || !foreground || !navigatorReady) return;
    opened.current = activeId;
    router.navigate(strength ? '/strength/watch-pick' : '/workout-live', OPEN_IN_STACK);
    // `strength` is read once per workout: the type may arrive a poll later and must not open a second screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, foreground, navigatorReady, router]);

  return <LiveWorkoutContext.Provider value={live}>{children}</LiveWorkoutContext.Provider>;
}
