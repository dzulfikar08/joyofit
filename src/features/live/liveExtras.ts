/**
 * The figures of a workout started on the watch that JoyoFit adds on the phone (`liveStats.ts`): average and highest heart rate over
 * the watch's readings, and steps, cadence and stride from the phone's own step counter (`BleSensors.startLiveSteps`, the counter of
 * the Run recorder's module, `modules/ble-sensors`; when it runs: `liveSteps.ts`). One session at a time, kept for as long as the app
 * runs: a figure covers what this app heard, so after a restart of the app mid-workout the averages and the steps start over.
 *
 * `LiveExtrasFeed` (mounted once, inside `LiveWorkoutProvider`) feeds every payload and runs the step counter while a watch-started
 * session on foot is open; the screen reads `useLiveExtras`.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { BleSensors } from '@/ble';
import { ensureStepCounter, stepCounterState, type Granted } from '@/features/sensors/permissions';

import { LiveExtrasSession, type LiveExtraFigures } from './liveStats';
import { createLiveSteps, type LiveStepsState } from './liveSteps';
import type { LiveSession } from './liveSession';
import { footKind } from './runFields';
import { useLiveSession } from './useLiveSession';

let current: LiveExtrasSession | null = null;

const steps = createLiveSteps({
  native:
    typeof BleSensors.startLiveSteps === 'function' && typeof BleSensors.stopLiveSteps === 'function'
      ? {
          start: () => BleSensors.startLiveSteps(),
          stop: () => BleSensors.stopLiveSteps(),
          listen: (listener) => BleSensors.addListener('onLiveSteps', listener),
        }
      : null,
  permission: stepCounterState,
  ask: ensureStepCounter,
  onForeground: (listener) =>
    AppState.addEventListener('change', (state) => {
      if (state === 'active') listener();
    }),
  onReading: (e) => current?.stepReading(e.steps, e.ts, Date.now(), e.cadence ?? null),
});

/** Feeds the session's payloads and runs the step counter while a session on foot is open. Render once, inside `LiveWorkoutProvider`. */
export function LiveExtrasFeed(): null {
  const session = useLiveSession();

  useEffect(() => {
    if (session === null) return;
    if (current?.id !== session.id) current = new LiveExtrasSession(session.id);
    current.payload(session.metrics.hr, session.state === 'running', session.raw.updatedAt, session.metrics.distanceM);
  }, [session]);

  const counting = session !== null && session.state !== 'ended' && footKind(session.sportKind);
  const id = session?.id ?? null;
  useEffect(() => {
    if (!counting) return;
    return steps.run();
  }, [counting, id]);

  return null;
}

/** The screen's "Allow step counter": the answer, so a refusal can lead to the phone's settings (`LiveSteps.allow`). */
export function allowLiveSteps(): Promise<Granted> {
  return steps.allow();
}

const NONE: LiveExtraFigures = { avgHr: null, maxHr: null, steps: null, cadence: null, strideM: null };

/** This session's added figures at `nowMs` (the screen re-renders every second) and the state of the phone's step counter. */
export function useLiveExtras(session: LiveSession, nowMs: number): { figures: LiveExtraFigures; steps: LiveStepsState } {
  const state = useSyncExternalStore(steps.subscribe, steps.state);
  const figures = current?.id === session.id ? current.figures(nowMs) : NONE;
  return { figures, steps: state };
}
