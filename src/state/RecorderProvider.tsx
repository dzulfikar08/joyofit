import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { BleSensors, type WorkoutControls } from '@/ble';
import { cloudLog as log } from '@/cloud/log';
import { getLocale, t } from '@/i18n';
import { afterRecordingSaved } from '@/features/record/afterSave';
import { bandLink } from '@/features/record/bandLink';
import { RecordingController, type ControllerTick, type FinishResult, type RecordingSnapshot } from '@/features/record/controller';
import type { EnergyProfile, Sex } from '@/features/record/energy';
import { LIVE_URL } from '@/features/record/liveRoute';
import { sensorHub } from '@/features/sensors/instance';
import { getWheelMm } from '@/features/sensors/settings';
import { userWeightKg } from '@/features/strength/profile';
import { DEFAULT_AGE } from '@/features/workouts/substrate';
import type { VirtualRide } from '@/features/workouts/summary';
import type { ManualSport } from '@/features/workouts/manual';
import { useSensors } from '@/state/SensorsProvider';
import { useWatch } from '@/state/WatchProvider';
import { HuaweiWear } from '@/wear';

export interface RecorderContextValue {
  snapshot: RecordingSnapshot;
  /** The controller itself, for features that run beside the recording (the ride bridge, `state/RideProvider.tsx`). Screens use the functions below. */
  controller: RecordingController;
  /** Gets ready to record `sport` (native session, GPS, sensors). `title` is the Android notification title. Rejects with ERR_LOCATION_PERMISSION for an outdoor sport without precise location; ask first (`ensureLocation`). */
  prepare: (sport: ManualSport, title: string) => Promise<void>;
  /**
   * Starts the GPS while the picker is open (an outdoor sport with precise location already granted; never asks), so a fix is waiting at
   * `prepare`. `stopWarmUp` ends it when the picker closes, the sport has no GPS or the app leaves the foreground. Neither rejects.
   */
  warmUp: (sport: ManualSport, title: string) => Promise<void>;
  stopWarmUp: () => Promise<void>;
  cancel: () => Promise<void>;
  start: () => void;
  pause: () => void;
  resume: () => void;
  lap: () => void;
  /**
   * Ends and saves the workout, then reports the data change (cloud sync, lists) and runs the follow-ups (JoyoRogo energy, Strava when
   * `strava` is true). Resolves with the new workout's id, or null when nothing was recorded. Rejects when saving fails; the
   * recording is kept (`snapshot.status` is `finished`) and `finish` can be called again. `virtual` is the web game's summary of an
   * indoor ride ("Main di web"): its distance and climb are saved with the workout.
   */
  finish: (options: { strava: boolean; virtual?: VirtualRide }) => Promise<FinishResult | null>;
  discard: () => Promise<void>;
  /** Calls `listener` every second while a recording is active (also paused); returns the unsubscribe. Bike mode runs its engines from it. */
  observe: (listener: (tick: ControllerTick) => void) => () => void;
}

const RecorderContext = createContext<RecorderContextValue | null>(null);

export function useRecorder(): RecorderContextValue {
  const value = useContext(RecorderContext);
  if (!value) throw new Error('useRecorder must be used inside <RecorderProvider>');
  return value;
}

/** The profile the energy estimate runs on: the saved weight (or the default), age from the birth year, sex. */
function energyProfile(): EnergyProfile {
  const profile = HuaweiWear.getUserProfile();
  const age = profile?.birthYear ? new Date().getFullYear() - profile.birthYear : DEFAULT_AGE;
  const sex: Sex = profile?.sex === 'male' || profile?.sex === 'female' ? profile.sex : 'unknown';
  return { weightKg: userWeightKg(), age: Math.min(100, Math.max(10, age)), sex };
}

/** The notification's buttons and the language it formats the distance in (the notification itself counts the time). */
function notificationControls(): WorkoutControls {
  return {
    locale: getLocale(),
    paused: t('workouts:liveEntry.paused'),
    pause: t('workouts:record.live.pause'),
    resume: t('workouts:record.live.resume'),
    lap: t('workouts:record.live.lap'),
  };
}

/**
 * The phone-recorded workout (see `features/record/controller.ts`) for the whole app: the recording survives leaving the screen, and a
 * recording the app lost (killed, crashed) is brought back, paused, when the app opens. Must sit inside `SensorsProvider`.
 */
export function RecorderProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const { saved } = useSensors();
  const { dataChanged } = useWatch();
  const savedRef = useRef(saved);
  // Read lazily by the controller, never during render.
  useLayoutEffect(() => {
    savedRef.current = saved;
  }, [saved]);

  const controller = useMemo(
    () =>
      new RecordingController({
        hub: sensorHub,
        session: {
          // The notification opens the live screen, the same place back leads to (see `liveRoute.ts`).
          start: (options) => BleSensors.startWorkoutSession({ ...options, openUrl: LIVE_URL, controls: notificationControls() }),
          update: (state) => BleSensors.updateWorkoutSession(state),
          end: () => BleSensors.endWorkoutSession(),
          onAction: (listener) => {
            const sub = BleSensors.addListener('onWorkoutAction', (event) => listener(event.action));
            return () => sub.remove();
          },
        },
        stepCounter: () => BleSensors.stepCounterPermission(),
        db,
        now: Date.now,
        profile: energyProfile,
        wheelCircumferenceM: () => getWheelMm() / 1000,
        sensors: () => savedRef.current,
        band: bandLink,
        log: (message) => log(`recording: ${message}`),
      }),
    [db],
  );

  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);

  useEffect(() => {
    void sensorHub.start().then(() => controller.restore()).catch((error) => log(`recording restore failed: ${String(error)}`, 'error'));
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') controller.tick();
    });
    return () => sub.remove();
  }, [controller]);

  const warmUp = useCallback((sport: ManualSport, title: string) => controller.warmUp(sport, title), [controller]);
  const stopWarmUp = useCallback(() => controller.stopWarmUp(), [controller]);

  const finish = useCallback(
    async (options: { strava: boolean; virtual?: VirtualRide }) => {
      const result = await controller.finish(options.virtual);
      if (result) {
        dataChanged();
        void afterRecordingSaved(db, result.workoutId, options);
      }
      return result;
    },
    [controller, dataChanged, db],
  );

  const value = useMemo<RecorderContextValue>(
    () => ({
      snapshot,
      controller,
      prepare: (sport, title) => controller.prepare(sport, title),
      warmUp,
      stopWarmUp,
      cancel: () => controller.cancel(),
      start: () => controller.start(),
      pause: () => controller.pause(),
      resume: () => controller.resume(),
      lap: () => controller.lap(),
      finish,
      discard: () => controller.discard(),
      observe: controller.observe,
    }),
    [controller, finish, snapshot, stopWarmUp, warmUp],
  );

  return <RecorderContext.Provider value={value}>{children}</RecorderContext.Provider>;
}
