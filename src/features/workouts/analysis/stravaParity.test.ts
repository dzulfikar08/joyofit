import { describe, expect, it } from 'bun:test';

import type { WorkoutRow } from '@/db/queries';
import { buildRunSubject } from '@/features/stickers/data/run';
import { buildWatchPost } from '@/features/social/watchPost';
import { buildFit, type StravaPoint } from '@/features/strava/activityFile';
import { decodeFit, estimateMovingTime } from '@/features/strava/testDecode';
import { formatElapsed } from '@/features/workouts/summary';
import { workoutTimes } from '@/features/workouts/times';

import { analyzeWorkout, type AnalysisHistory } from './analyze';
import { elevationProfile, workoutElevation } from './elevation';
import { row, T0, workoutRow } from './fixtures';
import { altitudeGrid, elapsedOf, gridStep, type AnalysisPoint } from './series';
import { FLAT_WALK, GENTLE_WALK, WALK } from './stravaWalks.fixture';
import { hrZonesForMax } from '@/features/hrzones/zones';

/**
 * The owner's walk of 2026-10-18 07:35 against what Strava shows for it (activity 20628405451): 2.01 km, moving 25:26,
 * elapsed 25:26, 24 m, 12:39 per km, 143 kcal, 127 bpm, 2,672 steps. The app showed 25:23 in the header and 1.97 km,
 * 24:18 moving, +59/-59 m and 12:38 per km on the analysis card of the same screen. The altitude and heart rate are the
 * walk's own; the route is a straight line of the walk's GPS length, because the real one is a home address.
 */

/** Metres per degree of latitude on the sphere `haversineM` uses. */
const M_PER_DEG = (6_371_000 * Math.PI) / 180;
/** The GPS path the app measured for the walk: its distance card read 1.97 km. */
const GPS_PATH_M = WALK.before.distanceM;
const NO_HISTORY: AnalysisHistory = { efforts: [], trimps: [], similar: [] };
const ALL = { includeHr: true, includeRoute: true, includeComparison: true };

const workout: WorkoutRow = workoutRow({
  start: T0,
  end: T0 + WALK.elapsedSec,
  sportType: 4,
  sportName: 'Outdoor walk',
  duration: WALK.durationSec,
  distance: WALK.distanceM,
  calories: WALK.calories,
  steps: WALK.steps,
  avgHr: WALK.avgHr,
  maxHr: WALK.maxHr,
});

/** One GPS fix per second from the first to the last fix, rows of altitude and heart rate every 5 s, as in `workout_points`. */
function walkPoints(): AnalysisPoint[] {
  const points: AnalysisPoint[] = [];
  for (let t = WALK.firstFixSec; t <= WALK.lastFixSec; t++) {
    const along = (GPS_PATH_M * (t - WALK.firstFixSec)) / (WALK.lastFixSec - WALK.firstFixSec);
    points.push(row(T0 + t, { lat: -7.9 + along / M_PER_DEG, lon: 112.6 }));
  }
  WALK.alt.forEach((alt, i) => {
    const hr = WALK.hr[i] as number;
    points.push(row(T0 + WALK.firstSampleSec + 5 * i, { alt, hr: hr > 0 ? hr : null }));
  });
  return points.sort((a, b) => a.ts - b.ts);
}

const points = walkPoints();
const summary = {
  avgPaceSecPerKm: WALK.before.paceSecKm,
  avgSpeed: WALK.distanceM / WALK.durationSec,
  elevationGain: WALK.before.gainM,
  elevationLoss: WALK.before.lossM,
};
const analysis = analyzeWorkout({ workout, summary, points, zones: hrZonesForMax(190), daySamples: [], history: NO_HISTORY }, ALL);

/** The `run.*` numbers of the sticker for the walk. */
const sticker = () => buildRunSubject({ workout, summary, analysis, route: [], gearLine: null }, 'id').data.run as Record<string, unknown>;

describe('distance: the watch total, everywhere', () => {
  it('is 2.01 km on the card, in the series and in the post, not the 1.97 km of the GPS path', () => {
    expect(analysis.distanceM).toBe(WALK.strava.distanceM);
    const dist = analysis.series!.dist!;
    expect(dist[dist.length - 1]).toBe(WALK.strava.distanceM);
    const post = buildWatchPost(workout, points, { caption: '', visibility: 'grup', includeHr: true, includeRoute: true, includeComparison: true }, analysis);
    expect(post.workout.distanceM).toBe(WALK.strava.distanceM);
    expect(post.detail && 'analysis' in post.detail ? post.detail.analysis.distanceM : null).toBe(WALK.strava.distanceM);
    expect(sticker().distanceM).toBe(WALK.strava.distanceM);
  });

  it('spreads the watch distance as the Strava file does: the unrecorded start and end move at the average speed', () => {
    // 47 s before the first fix at 2010 m / 1526 s, then the GPS path scaled to what is left.
    const speed = WALK.distanceM / WALK.elapsedSec;
    const stepSec = analysis.series!.stepSec;
    const dist = analysis.series!.dist!;
    expect(dist[Math.round(WALK.firstFixSec / stepSec)]).toBeCloseTo(speed * WALK.firstFixSec, -1);
    // Two splits of a kilometre each, as Strava lists them; the 10 m left is under the 100 m a split needs.
    expect(analysis.splits.map((s) => s.distM)).toEqual([1000, 1000]);
    const total = analysis.splits.reduce((sum, s) => sum + s.sec, 0);
    expect(total).toBeGreaterThan(1500);
    expect(total).toBeLessThan(WALK.elapsedSec);
    // Strava: 12:36 and 12:42 for the two kilometres; this straight route walks them at one speed.
    for (const s of analysis.splits) expect(Math.abs(s.paceSecKm! - WALK.strava.paceSecKm)).toBeLessThan(12);
  });

  it('keeps the GPS track for the map', () => {
    expect(analysis.series!.track!.filter((p) => p !== null).length).toBeGreaterThan(400);
  });

  it('is in the Strava file too: session, lap and the last record', () => {
    const stravaPoints: StravaPoint[] = points.map((p) => ({ ts: p.ts, lat: p.lat, lon: p.lon, alt: p.alt ?? null, hr: p.hr }));
    const decoded = decodeFit(buildFit({ ...workout, elevationGain: 24, elevationLoss: 25 }, stravaPoints, { utcOffsetSeconds: 7 * 3600 }).bytes);
    expect(decoded.errors).toEqual([]);
    const session = decoded.messages.sessionMesgs?.[0];
    const records = decoded.messages.recordMesgs ?? [];
    expect(session?.totalDistance).toBe(WALK.strava.distanceM);
    expect(records[records.length - 1]?.distance).toBe(WALK.strava.distanceM);
    // The timer time of the file is the watch timer; the 3 s to the elapsed time are a timer stop and start, no record dropped.
    expect(session?.totalElapsedTime).toBe(WALK.elapsedSec);
    expect(session?.totalTimerTime).toBe(WALK.durationSec);
    // Strava respects the file's pause events (its support page) and takes the timer time as the moving time.
    const strava = estimateMovingTime(records, decoded.messages.eventMesgs ?? []);
    expect(strava).toEqual({ seconds: WALK.durationSec, from: 'timer events' });
    expect(records.length).toBe(new Set([...stravaPoints.map((p) => p.ts), T0, T0 + WALK.elapsedSec]).size);
  });
});

describe('time: the watch timer everywhere, elapsed kept apart', () => {
  it('is 25:23 in the header, the analysis, the share card and the post; 25:26 stays the total', () => {
    const times = workoutTimes(workout);
    expect(times).toEqual({ elapsedSec: WALK.elapsedSec, movingSec: WALK.durationSec });
    expect(formatElapsed(times.movingSec)).toBe('25:23');
    expect(analysis.elapsedSec).toBe(WALK.elapsedSec);
    expect(analysis.movingSec).toBe(WALK.durationSec);
    expect(sticker().movingSec).toBe(WALK.durationSec);
    const post = buildWatchPost(workout, points, { caption: '', visibility: 'grup', includeHr: true, includeRoute: true, includeComparison: true }, analysis);
    expect(post.workout.durationMin).toBe(25);
  });

  it('falls back to the elapsed time only when the watch gave no timer', () => {
    expect(workoutTimes({ ...workout, duration: 0 })).toEqual({ elapsedSec: WALK.elapsedSec, movingSec: WALK.elapsedSec });
    expect(workoutTimes({ ...workout, duration: WALK.elapsedSec - 29 }).movingSec).toBe(WALK.elapsedSec - 29);
  });
});

/** The run of 2026-10-19 (workout 14, Fit 4 Pro): the watch showed 1.01 km, 00:10:53, 10'47"/km; log `dur=653s dist=1010m`. */
describe('the run of 19 Oct: 655 s elapsed, 653 s on the watch', () => {
  const run: WorkoutRow = workoutRow({
    start: 1_792_414_805,
    end: 1_792_415_460,
    sportType: 1,
    sportName: 'Outdoor run',
    duration: 653,
    distance: 1010,
  });
  const runAnalysis = analyzeWorkout({ workout: run, summary: {}, points: [], zones: hrZonesForMax(190), daySamples: [], history: NO_HISTORY }, ALL);

  it('shows 10:53 and 10\'47"/km on the header, the analysis and the sticker, with 10:55 as the total', () => {
    expect(workoutTimes(run)).toEqual({ elapsedSec: 655, movingSec: 653 });
    expect(formatElapsed(653)).toBe('10:53');
    expect(runAnalysis.movingSec).toBe(653);
    expect(runAnalysis.elapsedSec).toBe(655);
    expect(formatElapsed(runAnalysis.stats.avgPaceSecKm!)).toBe('10:47');
    const card = buildRunSubject({ workout: run, summary: {}, analysis: runAnalysis, route: [], gearLine: null }, 'id').data.run as Record<string, unknown>;
    expect(card.movingSec).toBe(653);
    expect(formatElapsed(card.paceSecKm as number)).toBe('10:47');
  });

  it('writes the 2 s as a timer stop and start so Strava counts 10:53, with every sample kept', () => {
    const fixes: StravaPoint[] = Array.from({ length: 100 }, (_, i) => ({ ts: 1_792_414_810 + i * 6, lat: -7.9 + i * 0.0001, lon: 112.6, alt: null, hr: null }));
    const decoded = decodeFit(buildFit(run, fixes, { utcOffsetSeconds: 0 }).bytes);
    const session = decoded.messages.sessionMesgs?.[0];
    expect(session?.totalElapsedTime).toBe(655);
    expect(session?.totalTimerTime).toBe(653);
    const records = decoded.messages.recordMesgs ?? [];
    expect(estimateMovingTime(records, decoded.messages.eventMesgs ?? [])).toEqual({ seconds: 653, from: 'timer events' });
    expect(records.length).toBe(102);
  });
});

describe('pace, calories, heart rate', () => {
  it('pace is the watch distance over the watch timer: 12:38 per km, as the watch, not the 12:39 of Strava over elapsed time', () => {
    expect(analysis.stats.avgPaceSecKm).toBe(WALK.watch.paceSecKm);
    expect(formatElapsed(analysis.stats.avgPaceSecKm!)).toBe('12:38');
    expect(formatElapsed(sticker().paceSecKm as number)).toBe('12:38');
  });

  it('calories, heart rate and steps are the watch totals Strava shows', () => {
    expect(analysis.calories?.kcal).toBe(WALK.strava.kcal);
    expect(analysis.stats.avgHr).toBe(WALK.strava.avgHr);
    expect(analysis.stats.maxHr).toBe(WALK.strava.maxHr);
    expect(workout.steps).toBe(WALK.strava.steps);
  });
});

describe('elevation gain: smoothed, near Strava, not the barometer sum', () => {
  it('is 24 m on the card, the header and the share card, not 59 m', () => {
    const e = analysis.elevation!;
    expect(Math.round(e.gainM)).toBe(24);
    expect(Math.abs(e.gainM - WALK.strava.gainM)).toBeLessThan(1.5);
    const header = workoutElevation(workout, summary, points)!;
    expect(Math.round(header.gainM * 10) / 10).toBe(e.gainM);
    expect(Math.round(header.lossM * 10) / 10).toBe(e.lossM);
    // The same walk is down by about as much as it climbed (net -4.6 m over the 5 s samples).
    expect(Math.abs(e.lossM - e.gainM)).toBeLessThan(8);
  });

  it('the raw barometer reading really climbs 53 m (59 m by the watch) on a 29 m span, which is what was wrong', () => {
    let rises = 0;
    for (let i = 1; i < WALK.alt.length; i++) rises += Math.max(0, (WALK.alt[i] as number) - (WALK.alt[i - 1] as number));
    expect(rises).toBeGreaterThan(50);
    expect(Math.max(...WALK.alt) - Math.min(...WALK.alt)).toBeLessThan(30);
  });

  /** The gain the method gives a series of `[seconds, altitude]` readings of a workout `elapsed` seconds long. */
  const gainOf = (alt: readonly [number, number][], elapsed: number) => {
    const rows = alt.map(([t, a]) => row(T0 + t, { alt: a }));
    const stepSec = gridStep(elapsedOf({ start: T0, end: T0 + elapsed, duration: elapsed, points: rows }));
    return elevationProfile(altitudeGrid(rows, T0, stepSec, Math.ceil(elapsed / stepSec) + 1), stepSec).gain;
  };

  it('is within a few metres of Strava on the other two JoyoFit walks it was fitted on', () => {
    // Strava's own figure is its terrain model's, so these differ in places: the gentle walk it counts 18.2 m, the flat one 2.1 m.
    const gentle = gainOf(GENTLE_WALK.alt, GENTLE_WALK.elapsedSec);
    expect(gentle).toBeGreaterThan(8);
    expect(gentle).toBeLessThan(11);
    const flat = gainOf(FLAT_WALK.alt, FLAT_WALK.elapsedSec);
    expect(flat).toBeGreaterThan(0);
    expect(flat).toBeLessThan(FLAT_WALK.stravaGainM + 3);
  });
});

describe('splits: the kilometre times Strava takes from the uploaded file', () => {
  /** A run of 5.3 km over `elapsed` s, pace wandering between 5:00 and 6:20, the watch paused (no samples) for `pause`. */
  function pausedRun(elapsed: number, pause: { at: number; sec: number } | null) {
    const points: AnalysisPoint[] = [];
    let along = 0;
    for (let t = 20; t <= elapsed - 15; t++) {
      if (pause && t >= pause.at && t < pause.at + pause.sec) continue;
      along += 1000 / (340 + 40 * Math.sin(t / 200));
      points.push(row(T0 + t, { lat: -6.2 + along / M_PER_DEG, lon: 106.8, hr: 150 }));
    }
    const run = workoutRow({ start: T0, end: T0 + elapsed, duration: elapsed - (pause?.sec ?? 0), distance: 5300, sportName: 'Outdoor Run' });
    return { run, points, analysis: analyzeWorkout({ workout: run, summary: {}, points, zones: hrZonesForMax(190), daySamples: [], history: NO_HISTORY }, ALL) };
  }

  /** What Strava does with the file: each kilometre from where the record distance crosses it, without the time the timer was stopped. */
  function stravaSplits(run: WorkoutRow, points: readonly AnalysisPoint[]): number[] {
    const decoded = decodeFit(buildFit(run, points.map((p) => ({ ts: p.ts, lat: p.lat, lon: p.lon, alt: null, hr: p.hr })), { utcOffsetSeconds: 0 }).bytes);
    const records = decoded.messages.recordMesgs ?? [];
    const at = (m: { timestamp?: unknown }) => Number(m.timestamp ?? 0);
    const stops: [number, number][] = [];
    let stoppedAt: number | null = null;
    for (const e of decoded.messages.eventMesgs ?? []) {
      const start = e.eventType === 0 || String(e.eventType) === 'start';
      if (!start) stoppedAt = at(e);
      else if (stoppedAt !== null) {
        stops.push([stoppedAt, at(e)]);
        stoppedAt = null;
      }
    }
    const crossing = (d: number) => {
      const i = records.findIndex((r) => (r.distance ?? 0) >= d);
      const a = records[i - 1]!;
      const b = records[i]!;
      return at(a) + ((d - (a.distance ?? 0)) / ((b.distance ?? 0) - (a.distance ?? 0))) * (at(b) - at(a));
    };
    const out: number[] = [];
    let from = at(records[0]!);
    for (let km = 1; km * 1000 <= (records.at(-1)?.distance ?? 0); km++) {
      const to = crossing(km * 1000);
      const stopped = stops.reduce((s, [a, b]) => s + Math.max(0, Math.min(to, b) - Math.max(from, a)), 0);
      out.push(Math.round(to - from - stopped));
      from = to;
    }
    return out;
  }

  it('match to the second without a pause', () => {
    const { run, points, analysis } = pausedRun(1800, null);
    expect(analysis.splits.slice(0, 5).map((s) => s.sec)).toEqual(stravaSplits(run, points));
  });

  it('leave the watch pause out of the kilometre it fell in, as Strava does', () => {
    const { run, points, analysis } = pausedRun(1890, { at: 700, sec: 90 });
    const strava = stravaSplits(run, points);
    expect(analysis.splits.slice(0, 5).map((s) => s.sec)).toEqual(strava);
    // The paused kilometre is about 6 minutes, not 7:30; the splits add up to the moving time.
    expect(analysis.splits[1]!.sec).toBeLessThan(400);
    expect(Math.abs(analysis.splits.reduce((sum, s) => sum + s.sec, 0) - analysis.movingSec)).toBeLessThanOrEqual(analysis.splits.length);
  });
});
