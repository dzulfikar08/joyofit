import { describe, expect, test } from 'bun:test';

import { deriveMetrics, deriveSession, deriveSportKind, GPS_FRESH_MS, isGpsSport, sportKindOf } from '@/features/live/liveSession';
import type { LiveWorkout } from '@/wear';

function live(patch: Partial<LiveWorkout> = {}): LiveWorkout {
  return {
    id: 1,
    status: 'running',
    source: 'status',
    sportType: null,
    sportName: null,
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

describe('sportKindOf', () => {
  test('maps the Huawei sport types the live screen knows', () => {
    expect(sportKindOf(1)).toBe('run');
    expect(sportKindOf(11)).toBe('run');
    expect(sportKindOf(5)).toBe('run');
    expect(sportKindOf(2)).toBe('walk');
    expect(sportKindOf(13)).toBe('walk');
    expect(sportKindOf(3)).toBe('ride');
    expect(sportKindOf(7)).toBe('ride');
    expect(sportKindOf(14)).toBe('hike');
    expect(sportKindOf(4)).toBe('hike');
  });

  test('everything else is other', () => {
    expect(sportKindOf(140)).toBe('other');
    expect(sportKindOf(137)).toBe('other');
    expect(sportKindOf(9999)).toBe('other');
  });
});

describe('deriveSportKind', () => {
  test('a sport tag is used as it is and is not a guess', () => {
    expect(deriveSportKind(live({ sportType: 2 }), null)).toEqual({ kind: 'walk', inferred: false });
  });

  test('no tag but a session opened by the GPS request is an inferred run', () => {
    expect(deriveSportKind(live({ source: 'gps' }), null)).toEqual({ kind: 'run', inferred: true });
  });

  test('no tag but the band asked for the phone GPS during a status session is an inferred run too', () => {
    expect(deriveSportKind(live({ source: 'status', gpsRequested: true }), null)).toEqual({ kind: 'run', inferred: true });
  });

  test('no tag and no GPS request says nothing', () => {
    expect(deriveSportKind(live({ source: 'status', gpsRequested: false }), null)).toEqual({ kind: null, inferred: false });
    expect(deriveSportKind(live({ source: 'manual' }), null)).toEqual({ kind: null, inferred: false });
  });

  test('the person picking a kind ends the guess, even over a tag', () => {
    expect(deriveSportKind(live({ source: 'gps' }), 'ride')).toEqual({ kind: 'ride', inferred: false });
    expect(deriveSportKind(live({ sportType: 1 }), 'hike')).toEqual({ kind: 'hike', inferred: false });
  });

  test('an unnamed outdoor workout guesses the last pick, still as a guess; a tag or a pick wins over it', () => {
    // The Fit 4 Pro opened on Outdoor walk sends no sport tag (2026-10-25): the person who picked walk last time sees walk.
    expect(deriveSportKind(live({ source: 'gps' }), null, 'walk')).toEqual({ kind: 'walk', inferred: true });
    expect(deriveSportKind(live({ sportType: 1 }), null, 'walk')).toEqual({ kind: 'run', inferred: false });
    expect(deriveSportKind(live({ source: 'gps' }), 'ride', 'walk')).toEqual({ kind: 'ride', inferred: false });
    expect(deriveSportKind(live({ source: 'manual' }), null, 'walk')).toEqual({ kind: null, inferred: false });
  });
});

describe('isGpsSport (never offer strength for these)', () => {
  test('a GPS-requesting session is one, tagged or not', () => {
    expect(isGpsSport(live({ source: 'gps' }), null)).toBe(true);
    expect(isGpsSport(live({ source: 'status', gpsRequested: true }), null)).toBe(true);
    expect(isGpsSport(live({ sportType: 1 }), null)).toBe(true);
  });

  test('an indoor type without a GPS request is not', () => {
    expect(isGpsSport(live({ sportType: 5 }), null)).toBe(false);
    expect(isGpsSport(live({ sportType: 7 }), null)).toBe(false);
  });

  test('strength and an untagged indoor session are not', () => {
    expect(isGpsSport(live({ sportType: 140 }), null)).toBe(false);
    expect(isGpsSport(live({ source: 'manual' }), null)).toBe(false);
  });

  test('a picked outdoor kind counts, a picked other does not', () => {
    expect(isGpsSport(live({ source: 'status' }), 'walk')).toBe(true);
    expect(isGpsSport(live({ source: 'status' }), 'other')).toBe(false);
  });
});

describe('deriveMetrics fallbacks', () => {
  test('the band figures are used as they come', () => {
    const m = deriveMetrics(
      live({ durationSec: 600, distanceM: 2000, paceSecPerKm: 300, riseM: 12, heartRate: 150, calories: 120, stepRate: 168, altitudeM: 40 }),
      'run',
    );
    expect(m).toEqual({
      durationS: 600,
      distanceM: 2000,
      paceSPerKm: 300,
      avgPaceSPerKm: 300,
      hr: 150,
      calories: 120,
      cadence: 168,
      elevationGainM: 12,
      altitudeM: 40,
    });
  });

  test('a band that reports 0 m (no GPS reached it) does not hide the phone track', () => {
    const m = deriveMetrics(live({ durationSec: 600, distanceM: 0, gpsDistanceM: 1850 }), 'run');
    expect(m.distanceM).toBe(1850);
    expect(m.avgPaceSPerKm).toBeCloseTo(600 / 1.85, 5);
  });

  test('a real band distance wins over the phone track', () => {
    expect(deriveMetrics(live({ distanceM: 3000, gpsDistanceM: 2900 }), 'run').distanceM).toBe(3000);
  });

  test('0 m stays 0 when nothing else knows better, null stays null', () => {
    expect(deriveMetrics(live({ distanceM: 0 }), 'run').distanceM).toBe(0);
    expect(deriveMetrics(live(), 'run').distanceM).toBeNull();
    expect(deriveMetrics(live({ gpsDistanceM: 0 }), 'run').distanceM).toBe(0);
  });

  test('pace: the band pace, else the band speed, else the phone pace', () => {
    expect(deriveMetrics(live({ paceSecPerKm: 330, speedKmh: 20, gpsPaceSecPerKm: 400 }), 'run').paceSPerKm).toBe(330);
    expect(deriveMetrics(live({ speedKmh: 12, gpsPaceSecPerKm: 400 }), 'run').paceSPerKm).toBe(300);
    expect(deriveMetrics(live({ gpsPaceSecPerKm: 400 }), 'run').paceSPerKm).toBe(400);
    expect(deriveMetrics(live(), 'run').paceSPerKm).toBeNull();
  });

  test('a band pace of 0 (standing) falls through to the phone pace instead of showing 0', () => {
    expect(deriveMetrics(live({ paceSecPerKm: 0, gpsPaceSecPerKm: 410 }), 'run').paceSPerKm).toBe(410);
  });

  test('average pace waits for 10 m and a clock', () => {
    expect(deriveMetrics(live({ durationSec: 30, gpsDistanceM: 5 }), 'run').avgPaceSPerKm).toBeNull();
    expect(deriveMetrics(live({ durationSec: null, gpsDistanceM: 500 }), 'run').avgPaceSPerKm).toBeNull();
  });

  test('climb: the band rise, else the phone climb rounded', () => {
    expect(deriveMetrics(live({ riseM: 8, gpsRiseM: 20 }), 'run').elevationGainM).toBe(8);
    expect(deriveMetrics(live({ riseM: 0, gpsRiseM: 17.6 }), 'run').elevationGainM).toBe(18);
    expect(deriveMetrics(live({ gpsRiseM: 0 }), 'run').elevationGainM).toBe(0);
    expect(deriveMetrics(live(), 'run').elevationGainM).toBeNull();
  });

  test('cadence is steps per minute on foot and rpm on a bike', () => {
    expect(deriveMetrics(live({ stepRate: 170, cadence: 85 }), 'run').cadence).toBe(170);
    expect(deriveMetrics(live({ stepRate: 170, cadence: 85 }), 'ride').cadence).toBe(85);
    expect(deriveMetrics(live({ stepRate: 170 }), 'ride').cadence).toBe(170);
  });

  test('calories fall back to the active figure', () => {
    expect(deriveMetrics(live({ activeCalories: 80 }), 'run').calories).toBe(80);
  });
});

describe('deriveSession', () => {
  const now = 5_000_000;

  test('the state is the native status: preparing stays preparing, a GPS request never turns it into running', () => {
    const s = deriveSession(live({ status: 'preparing', source: 'gps' }), null, now);
    expect(s.state).toBe('preparing');
    expect(s.sportKind).toBe('run');
    expect(s.sportKindInferred).toBe(true);
    expect(s.gpsSport).toBe(true);
  });

  test('the location is fresh for ten seconds', () => {
    const base = { location: { lat: 1, lon: 2, accuracy: 5, bearing: null } };
    expect(deriveSession(live({ ...base, locationAt: now - 1000 }), null, now).gpsFix).toBe(true);
    expect(deriveSession(live({ ...base, locationAt: now - GPS_FRESH_MS - 1 }), null, now).gpsFix).toBe(false);
    expect(deriveSession(live({ ...base, locationAt: now - 1000, status: 'ended' }), null, now).gpsFix).toBe(false);
  });

  test('a build without the new fields gives no location and an unknown clock confirmation', () => {
    const s = deriveSession(live(), null, now);
    expect(s.location).toBeNull();
    expect(s.gpsFix).toBe(false);
    expect(s.clockConfirmed).toBeNull();
  });

  test('clockConfirmed passes through', () => {
    expect(deriveSession(live({ clockConfirmed: false }), null, now).clockConfirmed).toBe(false);
    expect(deriveSession(live({ clockConfirmed: true }), null, now).clockConfirmed).toBe(true);
  });
});
