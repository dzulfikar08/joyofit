/**
 * The figures of a workout started on the watch that JoyoFit adds on the phone (`liveStats.ts`): average and highest heart rate over
 * the watch's readings, and steps, cadence and stride from the phone's own step counter (`BleSensors.startLiveSteps`, the counter of
 * the Run recorder's module, `modules/ble-sensors`). One session at a time, kept for as long as the app runs: a figure covers what this
 * app heard, so after a restart of the app mid-workout the averages and the steps start over.
 *
 * `LiveExtrasFeed` (mounted once, inside `LiveWorkoutProvider`) feeds every payload and runs the step counter while a watch-started
 * session on foot is open; the screen reads `useLiveExtras`.
 */
import { useEffect, useSyncExternalStore } from 'react';

import { BleSensors, type StepsEvent } from '@/ble';
import { ensureStepCounter, stepCounterState } from '@/features/sensors/permissions';

import { LiveExtrasSession, type LiveExtraFigures } from './liveStats';
import type { LiveSession } from './liveSession';
import { footKind } from './runFields';
import { useLiveSession } from './useLiveSession';

/**
 * The phone's step counter for this session. `on`: counting. `ask`: not allowed yet (Android cannot tell "never asked" from "refused";
 * the screen offers to ask). `unavailable`: no step counter in this phone, or a binary without `startLiveSteps`. `off`: not a session on
 * foot, or none.
 */
export type LiveStepsState = 'off' | 'on' | 'ask' | 'unavailable';

let current: LiveExtrasSession | null = null;
let stepsState: LiveStepsState = 'off';
let subscription: { remove(): void } | null = null;
/** Bumped by every start and stop: a start that finishes after a later stop undoes itself. */
let generation = 0;
const listeners = new Set<() => void>();

function setStepsState(next: LiveStepsState): void {
  if (next === stepsState) return;
  stepsState = next;
  for (const l of listeners) l();
}

const nativeSteps = (): boolean => typeof BleSensors.startLiveSteps === 'function' && typeof BleSensors.stopLiveSteps === 'function';

function onReading(e: StepsEvent): void {
  current?.stepReading(e.steps, e.ts);
}

/** Starts the phone's step counter when it is allowed; `ask` when it is not (nothing is asked here: the screen does, on a tap). */
async function startSteps(): Promise<void> {
  const mine = ++generation;
  if (!nativeSteps()) return setStepsState('unavailable');
  const permission = await stepCounterState().catch(() => 'unavailable' as const);
  if (mine !== generation) return;
  if (permission === 'unavailable') return setStepsState('unavailable');
  if (permission !== 'granted') return setStepsState('ask');
  subscription ??= BleSensors.addListener('onLiveSteps', onReading);
  const running = await BleSensors.startLiveSteps().catch(() => false);
  if (mine !== generation) {
    // Stopped while starting: the stop found the counter not yet running.
    if (running) void BleSensors.stopLiveSteps().catch(() => undefined);
    return;
  }
  setStepsState(running ? 'on' : 'unavailable');
}

function stopSteps(): void {
  generation += 1;
  subscription?.remove();
  subscription = null;
  if (nativeSteps() && stepsState === 'on') void BleSensors.stopLiveSteps().catch(() => undefined);
  setStepsState('off');
}

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
    void startSteps();
    return stopSteps;
  }, [counting, id]);

  return null;
}

/** Asks for the step counter permission (the screen's button) and starts counting when it was given. */
export async function allowLiveSteps(): Promise<void> {
  if ((await ensureStepCounter()) === 'granted' && stepsState === 'ask') await startSteps();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => stepsState;

const NONE: LiveExtraFigures = { avgHr: null, maxHr: null, steps: null, cadence: null, strideM: null };

/** This session's added figures at `nowMs` (the screen re-renders every second) and the state of the phone's step counter. */
export function useLiveExtras(session: LiveSession, nowMs: number): { figures: LiveExtraFigures; steps: LiveStepsState } {
  const steps = useSyncExternalStore(subscribe, snapshot);
  const figures = current?.id === session.id ? current.figures(nowMs) : NONE;
  return { figures, steps };
}
