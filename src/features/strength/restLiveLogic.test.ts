import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { liveRestAllowed, restLiveAction, wantedRestLive, type RestLiveInput, type RestLiveWish } from './restLiveLogic';

const NOW = 1_000_000;
const base: RestLiveInput = { active: true, rest: { endsAt: NOW + 90_000 }, paused: false, allowed: true, exerciseName: 'Bench Press', now: NOW };

describe('liveRestAllowed', () => {
  it('asks Android for the notification permission', () => {
    expect(liveRestAllowed('android', 'granted')).toBe(true);
    expect(liveRestAllowed('android', 'ask')).toBe(false);
    expect(liveRestAllowed('android', 'blocked')).toBe(false);
  });

  it('does not ask iOS: a Live Activity is not a notification', () => {
    expect(liveRestAllowed('ios', 'blocked')).toBe(true);
    expect(liveRestAllowed('ios', 'ask')).toBe(true);
  });
});

describe('wantedRestLive', () => {
  it('wants the running rest, with its end and exercise', () => {
    expect(wantedRestLive(base)).toEqual({ endsAt: NOW + 90_000, exerciseName: 'Bench Press' });
  });

  it('wants nothing without a rest', () => {
    expect(wantedRestLive({ ...base, rest: null })).toBeNull();
  });

  it('wants nothing while the stopwatch is paused', () => {
    expect(wantedRestLive({ ...base, paused: true })).toBeNull();
  });

  it('wants nothing when the platform does not allow it, or the logger is not showing a workout', () => {
    expect(wantedRestLive({ ...base, allowed: false })).toBeNull();
    expect(wantedRestLive({ ...base, active: false })).toBeNull();
  });

  it('wants nothing for a rest that is over', () => {
    expect(wantedRestLive({ ...base, rest: { endsAt: NOW } })).toBeNull();
    expect(wantedRestLive({ ...base, rest: { endsAt: NOW - 1 } })).toBeNull();
  });

  it('keeps an exercise-less rest', () => {
    expect(wantedRestLive({ ...base, exerciseName: null })?.exerciseName).toBeNull();
  });
});

describe('restLiveAction', () => {
  const rest: RestLiveWish = { endsAt: NOW + 90_000, exerciseName: 'Bench Press' };

  it('starts a rest when nothing is up', () => {
    expect(restLiveAction(null, rest)).toEqual({ type: 'start', wish: rest });
  });

  it('starts it when nobody knows what is up (the app just started)', () => {
    expect(restLiveAction(undefined, rest)).toEqual({ type: 'start', wish: rest });
  });

  it('does nothing when the lock screen already matches', () => {
    expect(restLiveAction(rest, { ...rest })).toBeNull();
  });

  it('moves the countdown on +15 s and -15 s', () => {
    const later = { ...rest, endsAt: rest.endsAt + 15_000 };
    expect(restLiveAction(rest, later)).toEqual({ type: 'start', wish: later });
    const sooner = { ...rest, endsAt: rest.endsAt - 15_000 };
    expect(restLiveAction(rest, sooner)).toEqual({ type: 'start', wish: sooner });
  });

  it('follows the exercise of the next rest', () => {
    const next = { ...rest, exerciseName: 'Squat' };
    expect(restLiveAction(rest, next)).toEqual({ type: 'start', wish: next });
  });

  it('stops on skip, end, pause, finish and discard (all of them want nothing)', () => {
    expect(restLiveAction(rest, null)).toEqual({ type: 'stop' });
  });

  it('does not stop what is not up, but stops once when it is unknown', () => {
    expect(restLiveAction(null, null)).toBeNull();
    expect(restLiveAction(undefined, null)).toEqual({ type: 'stop' });
  });

  it('follows a whole rest: start, +15 s, pause, resume, skip', () => {
    let shown: RestLiveWish | null | undefined = null;
    const steps: RestLiveInput[] = [
      base,
      { ...base, rest: { endsAt: NOW + 105_000 } },
      { ...base, rest: { endsAt: NOW + 105_000 }, paused: true },
      { ...base, rest: { endsAt: NOW + 120_000 } },
      { ...base, rest: null },
    ];
    const seen: string[] = [];
    for (const step of steps) {
      const action = restLiveAction(shown, wantedRestLive(step));
      seen.push(action ? action.type : 'none');
      if (action) shown = action.type === 'start' ? action.wish : null;
    }
    expect(seen).toEqual(['start', 'start', 'stop', 'start', 'stop']);
  });
});

describe('the Live Activity attributes', () => {
  const root = join(import.meta.dir, '..', '..', '..');
  const read = (path: string) => readFileSync(join(root, path), 'utf8');

  it('are the same file in the RestTimer pod and in the widget extension', () => {
    expect(read('targets/rest-timer/RestTimerAttributes.swift')).toBe(read('modules/rest-timer/ios/RestTimerAttributes.swift'));
  });
});
