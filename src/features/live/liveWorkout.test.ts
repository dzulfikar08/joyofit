import { describe, expect, test } from 'bun:test';

import { elapsedSec, endPromptVisible, isActive, livePhase, showsClock } from '@/features/live/liveWorkout';
import { t } from '@/i18n';
import type { LiveWorkout } from '@/wear';

function live(patch: Partial<LiveWorkout> = {}): LiveWorkout {
  return {
    id: 1,
    status: 'running',
    source: 'gps',
    sportType: 1,
    sportName: 'running',
    updatedAt: 1_000_000,
    endedAt: null,
    durationSec: null,
    heartRate: null,
    heartRateZone: null,
    maxHeartRate: 185,
    distanceM: null,
    calories: null,
    activeCalories: null,
    speedKmh: null,
    paceSecPerKm: null,
    stepRate: null,
    steps: null,
    cadence: null,
    altitudeM: null,
    riseM: null,
    descentM: null,
    aerobicTe: null,
    anaerobicTe: null,
    fatGrams: 0,
    carbGrams: 0,
    fatShare: null,
    ...patch,
  };
}

describe('livePhase', () => {
  test('a phone-side session that has not seen the workout run is searching for GPS', () => {
    expect(livePhase(live({ status: 'preparing', source: 'gps' }))).toBe('searching');
    expect(livePhase(live({ status: 'preparing', source: 'status' }))).toBe('searching');
  });

  test('a watch-fed session counting down is preparing, not searching', () => {
    expect(livePhase(live({ status: 'preparing', source: 'watch' }))).toBe('preparing');
  });

  test('the other statuses pass through', () => {
    expect(livePhase(live({ status: 'running' }))).toBe('running');
    expect(livePhase(live({ status: 'paused' }))).toBe('paused');
    expect(livePhase(live({ status: 'ended' }))).toBe('ended');
  });

  test('the waiting labels are Indonesian and say the start is on the watch', () => {
    expect(t('sharing:live.status.searching')).toBe('Menunggu mulai di jam…');
    expect(t('sharing:live.status.preparing')).toBe('Menunggu mulai di jam');
  });
});

describe('the clock', () => {
  test('stays blank and does not count while searching, whatever the heart rate does', () => {
    const searching = live({ status: 'preparing', source: 'gps', heartRate: 90 });
    expect(showsClock(searching)).toBe(false);
    expect(elapsedSec(searching, searching.updatedAt + 600_000)).toBe(0);
  });

  test('stays blank on a stale figure while the watch only prepares', () => {
    expect(showsClock(live({ status: 'preparing', source: 'watch', durationSec: 12 }))).toBe(false);
  });

  test('shows once the workout runs and counts on from the last figure', () => {
    const running = live({ status: 'running', durationSec: 0, updatedAt: 1_000_000 });
    expect(showsClock(running)).toBe(true);
    expect(elapsedSec(running, 1_000_000)).toBe(0);
    expect(elapsedSec(running, 1_007_000)).toBe(7);
  });

  test('does not count while paused', () => {
    const paused = live({ status: 'paused', durationSec: 95, updatedAt: 1_000_000 });
    expect(showsClock(paused)).toBe(true);
    expect(elapsedSec(paused, 1_500_000)).toBe(95);
  });

  test('a stalled stream is not extrapolated for more than 30 s', () => {
    expect(elapsedSec(live({ durationSec: 100, updatedAt: 0 }), 600_000)).toBe(130);
  });

  test('keeps the final figure once ended', () => {
    const ended = live({ status: 'ended', durationSec: 1_800 });
    expect(showsClock(ended)).toBe(true);
    expect(elapsedSec(ended, ended.updatedAt + 60_000)).toBe(1_800);
  });
});

describe('endPromptVisible', () => {
  test('asks when a phone-side session looks stopped', () => {
    expect(endPromptVisible(live({ endSuspected: true }), false)).toBe(true);
  });

  test('does not ask until the build reports a suspicion', () => {
    expect(endPromptVisible(live(), false)).toBe(false);
    expect(endPromptVisible(live({ endSuspected: false }), false)).toBe(false);
  });

  test('stays quiet after "keep going" or for a finished workout', () => {
    expect(endPromptVisible(live({ endSuspected: true }), true)).toBe(false);
    expect(endPromptVisible(live({ endSuspected: true, status: 'ended' }), false)).toBe(false);
  });

  test('asks for a watch-fed session when end is suspected', () => {
    expect(endPromptVisible(live({ endSuspected: true, source: 'watch' }), false)).toBe(true);
  });
});

describe('isActive', () => {
  test('a searching session is active: the live screen and the Today banner show it', () => {
    expect(isActive(live({ status: 'preparing' }))).toBe(true);
    expect(isActive(live({ status: 'ended' }))).toBe(false);
    expect(isActive(null)).toBe(false);
  });
});
