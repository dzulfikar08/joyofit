import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { CommonActions } from 'expo-router/react-navigation';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Screen } from '@/components/Screen';
import { BikeRideView } from '@/features/bikecomputer/ui/BikeRideView';
import { useBikeSettings } from '@/features/bikecomputer/ui/useBikeSettings';
import { holdScreenOn, releaseScreen } from '@/features/strength/keepAwake';
import type { ManualSport } from '@/features/workouts/manual';
import { errorMessage } from '@/format';
import { useRecorder } from '@/state/RecorderProvider';
import { useStrava } from '@/state/StravaProvider';

import { anchorLiveStack, WORKOUTS_ROUTE, WORKOUTS_STACK } from '../liveRoute';
import { FinishDialog } from './FinishDialog';
import { LiveView } from './LiveView';
import { ReadyView } from './ReadyView';
import { SetupView } from './SetupView';

/** The tag this screen holds the screen on under, so the strength logger's hold is not released with it. */
const KEEP_AWAKE_TAG = 'recording';

type Dialog = 'finish' | 'discard' | null;

/**
 * Recording a workout on the phone. The recording itself lives in `RecorderProvider`, so leaving this screen (back button, gesture, the
 * Workouts tab) leaves it running; only "Buang" ends it without saving. The screen follows the recorder's phase: setup, ready (GPS and
 * sensors connecting), live numbers. While a recording is live, back lands on the Workouts list (see `liveRoute.ts`).
 */
export function RecordScreen() {
  const { t } = useTranslation('workouts');
  const router = useRouter();
  const navigation = useNavigation();
  const { snapshot, pause, resume, finish, discard } = useRecorder();
  const { settings } = useStrava();
  const stravaAvailable = settings.connectedAt !== null;

  const { sport: sportParam } = useLocalSearchParams<{ sport?: string }>();
  // The loop planner opens the recorder with the activity of the loop; anything else starts on a run.
  const [sport, setSport] = useState<ManualSport>(sportParam === 'walk' ? 'walk' : 'run');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [strava, setStrava] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const { phase, status } = snapshot;
  const bike = useBikeSettings();
  // Bike computer mode takes the whole screen (no header, no scrolling page) while a ride is recording.
  const bikeLive = bike.enabled && snapshot.sport === 'ride' && (phase === 'active' || phase === 'saving');

  // Opened from another tab, from Manual entry or from the notification, the live screen can sit on its own or on a screen it has nothing
  // to do with. Putting the Workouts list under it makes back (hardware, header, iOS swipe) a plain pop onto the list with the live card.
  useEffect(() => {
    const state = navigation.getState();
    if (!state) return;
    const routes: { name: string; key?: string }[] = state.routes;
    const next = anchorLiveStack(routes, phase, () => ({ name: WORKOUTS_STACK.list }));
    if (next) navigation.dispatch(CommonActions.reset({ index: next.length - 1 - (routes.length - 1 - state.index), routes: next }));
  }, [navigation, phase]);
  const awake = phase === 'ready' || phase === 'active';
  useEffect(() => {
    if (!awake) return;
    void holdScreenOn(KEEP_AWAKE_TAG);
    return () => {
      void releaseScreen(KEEP_AWAKE_TAG);
    };
  }, [awake]);

  /** The clock stops while the person decides, so the minutes in the dialog are not part of the workout. */
  const askFinish = () => {
    if (status === 'recording') pause();
    setDialog('finish');
  };

  const keepGoing = () => {
    setDialog(null);
    if (status === 'paused') resume();
  };

  const save = async () => {
    setSaveError(null);
    setNotice(null);
    try {
      const result = await finish({ strava: stravaAvailable && strava });
      setDialog(null);
      if (result) {
        setLeaving(true);
        router.replace({ pathname: '/workouts/[id]', params: { id: String(result.workoutId) } });
      } else {
        setNotice(t('record.finish.nothing'));
      }
    } catch (e) {
      setDialog(null);
      setSaveError(errorMessage(e));
    }
  };

  const confirmDiscard = async () => {
    setDiscarding(true);
    try {
      await discard();
      setDialog(null);
      setSaveError(null);
      if (router.canGoBack()) router.back();
      else router.replace(WORKOUTS_ROUTE);
    } catch {
      // The recording is still there (the phase did not change): the dialog closes and "Buang" can be tried again.
      setDialog(null);
    } finally {
      setDiscarding(false);
    }
  };

  return (
    <>
      {bikeLive ? <Stack.Screen options={{ headerShown: false }} /> : null}
      {bikeLive && !leaving ? (
        <BikeRideView
          saving={phase === 'saving'}
          saveError={saveError}
          onFinish={askFinish}
          onSaveAgain={() => void save()}
          onDiscard={() => setDialog('discard')}
        />
      ) : (
      <Screen>
        {leaving ? null : phase === 'idle' ? (
          <SetupView sport={sport} onSport={setSport} notice={notice} />
        ) : phase === 'ready' ? (
          <ReadyView />
        ) : (
          <LiveView
            saving={phase === 'saving'}
            saveError={saveError}
            onFinish={askFinish}
            onSaveAgain={() => void save()}
            onDiscard={() => setDialog('discard')}
          />
        )}
      </Screen>
      )}
      <FinishDialog
        visible={dialog === 'finish'}
        live={snapshot.live}
        stravaAvailable={stravaAvailable}
        strava={strava}
        onStrava={setStrava}
        busy={phase === 'saving'}
        onSave={() => void save()}
        onResume={keepGoing}
        onDiscard={() => setDialog('discard')}
      />
      <ConfirmDialog
        visible={dialog === 'discard'}
        title={t('record.finish.discardTitle')}
        message={t('record.finish.discardMessage')}
        confirmLabel={t('record.finish.discardConfirm')}
        destructive
        busy={discarding}
        onConfirm={() => void confirmDiscard()}
        onCancel={() => setDialog(status === 'finished' ? null : 'finish')}
      />
    </>
  );
}
