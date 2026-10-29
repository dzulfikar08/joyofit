import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { sensorHub } from '@/features/sensors/instance';
import { ensureSensorPermissions } from '@/features/sensors/permissions';
import { sensorLabel } from '@/features/sensors/store';
import { t } from '@/i18n';
import { useRecorder } from '@/state/RecorderProvider';
import { useSensors } from '@/state/SensorsProvider';

import { pickStrap } from './hr';
import { strengthHr } from './hrInstance';

/** What the heart rate strap needs from the person on this screen, if anything. */
export type StrapPrompt = 'explain' | 'denied' | 'blocked';

export interface StrengthStrap {
  /** The strap this workout uses (its name for the card). Null when no strap is paired for workouts: the screen then shows nothing about straps. */
  name: string | null;
  prompt: StrapPrompt | null;
  /** The Bluetooth radio is off or unavailable: the strap cannot connect. */
  bluetoothOff: boolean;
  /** "Lanjut" of the explanation card: asks for the permission, then connects. */
  onContinue: () => void;
  /** Dismisses the card or the notice; the strap is not asked for again in this workout. */
  onDismiss: () => void;
}

/** Workouts whose strap the person turned down: not asked again until the app restarts. */
const dismissed = new Set<string>();

/**
 * The heart rate strap of a strength session. When the logger is ready (`workoutId` set: a workout in progress, never a finished
 * workout being edited), no phone recording runs and a paired heart rate sensor is set to connect with workouts, a small card
 * explains the Bluetooth permission once; "Lanjut" asks for it and starts the strap (`strengthHr`, which outlives the screen).
 * A strap that is already connected needs no permission and starts at once. Without such a sensor nothing is asked or shown.
 * Used by one small component, not by the screen: the sensor state changes every second.
 */
export function useStrengthHr(workoutId: string | null): StrengthStrap {
  const db = useSQLiteContext();
  const { saved, loaded, hub } = useSensors();
  const recorder = useRecorder();
  const session = useSyncExternalStore(strengthHr.subscribe, strengthHr.getSnapshot);
  // null: nothing decided yet (the explanation shows while it is due); 'closed': the person answered, show nothing.
  const [prompt, setPrompt] = useState<StrapPrompt | 'closed' | null>(null);
  const strap = pickStrap(saved);
  const eligible = workoutId !== null && loaded && strap !== null && recorder.snapshot.phase === 'idle';
  const running = workoutId !== null && session.workoutId === workoutId && session.sensorId === strap?.id;
  const linked = strap !== null && hub.links[strap.id]?.state === 'connected';

  const start = useCallback(async () => {
    if (workoutId === null || strap === null) return;
    await strengthHr.begin({
      db,
      workoutId,
      sensor: { id: strap.id, name: sensorLabel(strap), kinds: strap.kinds },
      title: t('strength:hr.session.title'),
      text: t('strength:hr.session.text'),
    });
  }, [db, strap, workoutId]);

  useEffect(() => {
    if (!eligible || running || dismissed.has(workoutId)) return;
    if (linked) void start();
  }, [eligible, running, linked, workoutId, start]);

  // A session that belongs to another workout (the person replaced the one in progress) is over.
  useEffect(() => {
    if (workoutId !== null && session.workoutId !== null && session.workoutId !== workoutId) void strengthHr.end();
  }, [workoutId, session.workoutId]);

  const onContinue = useCallback(() => {
    void ensureSensorPermissions().then((answer) => {
      if (answer === 'granted') {
        setPrompt('closed');
        return start();
      }
      setPrompt(answer);
    });
  }, [start]);

  const onDismiss = useCallback(() => {
    if (workoutId !== null) dismissed.add(workoutId);
    setPrompt('closed');
  }, [workoutId]);

  const explain = eligible && !running && !linked && !dismissed.has(workoutId);
  const shown = prompt === 'closed' ? null : (prompt ?? (explain ? 'explain' : null));

  return {
    name: strap ? sensorLabel(strap) : null,
    prompt: eligible && !running ? shown : null,
    bluetoothOff: running && (session.error === 'ERR_BLUETOOTH_OFF' || session.error === 'ERR_BLUETOOTH_UNAVAILABLE'),
    onContinue,
    onDismiss,
  };
}

/** `searching`: the strap is not connected yet; `waiting`: connected, no reading (not worn, or no contact); `live`: `bpm` is valid. */
export type StrapChipValue = { state: 'live'; bpm: number } | { state: 'searching' | 'waiting' };

/** The chip of the session header: null unless the strap is running for workout `workoutId`. Re-renders on its own, not the screen. */
export function useStrapChip(workoutId: string | null): StrapChipValue | null {
  const session = useSyncExternalStore(strengthHr.subscribe, strengthHr.getSnapshot);
  const sensorId = session.sensorId;
  const connected = useSyncExternalStore(sensorHub.subscribe, () => (sensorId !== null && sensorHub.getSnapshot().links[sensorId]?.state === 'connected'));
  if (workoutId === null || session.workoutId !== workoutId) return null;
  if (session.hr !== null) return { state: 'live', bpm: session.hr };
  return { state: connected ? 'waiting' : 'searching' };
}
