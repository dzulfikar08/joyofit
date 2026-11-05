import { describe, expect, it } from 'bun:test';

import { DEFAULT_HR_ZONE_SETTINGS, resolveHrZones } from '@/features/hrzones/zones';
import { workoutStrain } from '@/features/today/strain';
import type { WorkoutSummary } from '@/features/workouts/summary';

import { analyzeWorkout, type AnalysisHistory, type AnalyzeInput, type AnalyzeOptions } from './analyze';
import { buildLoad } from './effort';
import { bestEffortsForHistory } from './efforts';
import { cleanFixes, haversineM } from './geo';
import { elevationProfile } from './elevation';
import { row, straightRun, T0, workoutRow, type Leg, type Synth } from './fixtures';
import { buildGrid } from './series';
import { selectSimilar, type SimilarCandidate } from './similar';
import { paceBlockSplits } from './splits';
import { ANALYSIS_LIMITS, kmMarkers, type WorkoutAnalysis } from './types';

const MAX_HR = 190;
/** Age 30: `220 - age` is the 190 the tests use, so the maximum comes from the age. */
const ZONES = resolveHrZones(DEFAULT_HR_ZONE_SETTINGS, 220 - MAX_HR);
const ALL: AnalyzeOptions = { includeHr: true, includeRoute: true, includeComparison: true };
const NO_HISTORY: AnalysisHistory = { efforts: [], trimps: [], similar: [] };

/** 5:00 per km. */
const FIVE_MIN_KM = 1000 / 300;
const hrRamp = (total: number) => (t: number) => 130 + (40 * t) / total;

function analyze(
  synth: Synth,
  over: { sportName?: string; summary?: WorkoutSummary; history?: AnalysisHistory; options?: AnalyzeOptions; distance?: number; calories?: number; duration?: number; steps?: number } = {},
): WorkoutAnalysis {
  const input: AnalyzeInput = {
    workout: workoutRow({
      end: T0 + synth.elapsed,
      sportName: over.sportName ?? 'Outdoor Run',
      duration: over.duration ?? synth.elapsed,
      distance: over.distance ?? Math.round(synth.distance),
      calories: over.calories ?? 0,
      steps: over.steps ?? 0,
    }),
    summary: over.summary ?? {},
    points: synth.points,
    zones: ZONES,
    daySamples: [],
    history: over.history ?? NO_HISTORY,
  };
  return analyzeWorkout(input, over.options ?? ALL);
}

const steady5k = (extra: Partial<Parameters<typeof straightRun>[0]> = {}) =>
  straightRun({ legs: [{ sec: 1510, speed: FIVE_MIN_KM }], hr: hrRamp(1510), alt: () => 20, ...extra });

describe('geo', () => {
  it('measures a degree of latitude as 111.19 km', () => {
    expect(haversineM(0, 0, 1, 0)).toBeCloseTo(111_195, -1);
  });

  it('drops invalid fixes, pause markers, duplicate timestamps, jitter and teleports', () => {
    const fixes = cleanFixes(
      [
        row(0, { lat: -6.2, lon: 106.8 }),
        row(1, { lat: 90, lon: -80 }),
        row(1, { lat: 0, lon: 0 }),
        row(1, { lat: 200, lon: 5 }),
        row(2, { lat: -6.2 + 3 / 111_195, lon: 106.8 }),
        row(2, { lat: -6.2 + 6 / 111_195, lon: 106.8 }),
        row(3, { lat: -6.2 + 3.5 / 111_195, lon: 106.8 }),
        row(4, { lat: -6.2 + 600 / 111_195, lon: 106.8 }),
        row(5, { lat: -6.2 + 9 / 111_195, lon: 106.8 }),
      ],
      'run',
    );
    expect(fixes.map((f) => f.ts)).toEqual([0, 2, 5]);
    expect(fixes[2].dist).toBeCloseTo(9, 1);
  });

  it('allows 30 m/s off foot but not on foot', () => {
    const pts = [row(0, { lat: -6.2, lon: 106.8 }), row(1, { lat: -6.2 + 20 / 111_195, lon: 106.8 })];
    expect(cleanFixes(pts, 'run')).toHaveLength(1);
    expect(cleanFixes(pts, 'ride')).toHaveLength(2);
  });

  it('restarts from the current fix when the first fix was the outlier', () => {
    const pts = [row(0, { lat: 10, lon: 10 })];
    for (let i = 1; i <= 12; i++) pts.push(row(i, { lat: -6.2 + (3 * i) / 111_195, lon: 106.8 }));
    const fixes = cleanFixes(pts, 'run');
    expect(fixes.length).toBeGreaterThan(5);
    expect(fixes[0].dist).toBe(0);
  });
});

describe('constant 5:00/km run', () => {
  const a = analyze(steady5k());

  it('builds the grid with at most 600 steps', () => {
    expect(a.series?.stepSec).toBe(3);
    expect(a.series?.n).toBe(505);
    expect(a.elapsedSec).toBe(1510);
  });

  it('has five 300 s splits and drops the 33 m remainder', () => {
    expect(a.splits).toHaveLength(5);
    for (const s of a.splits) {
      expect(s.distM).toBe(1000);
      expect(s.sec).toBe(300);
      expect(s.paceSecKm).toBe(300);
    }
    expect(a.splits[0].hr).toBeGreaterThan(130);
    expect(a.splits[4].hr as number).toBeGreaterThan(a.splits[0].hr as number);
  });

  it('finds the best efforts', () => {
    const by = Object.fromEntries(a.bestEfforts.map((e) => [e.key, e]));
    expect(by['400m'].sec).toBe(120);
    expect(by['1k'].sec).toBe(300);
    expect(by['1mi'].sec).toBe(483);
    expect(by['5k'].sec).toBe(1500);
    expect(by['10k']).toBeUndefined();
    expect(by['1k'].rank).toBeNull();
  });

  it('reads a constant pace and the full distance', () => {
    const pace = a.series?.pace as (number | null)[];
    expect(pace.every((p) => p === 300)).toBe(true);
    expect(a.distanceM).toBeGreaterThan(5030);
    expect(a.movingSec).toBeGreaterThan(1500);
    expect(a.stats.avgPaceSecKm).toBe(300);
  });

  it('puts every non-null series on the grid and kmMarkers works on it', () => {
    const s = a.series!;
    for (const arr of [s.dist, s.hr, s.pace, s.alt, s.cad, s.power, s.track]) if (arr) expect(arr).toHaveLength(s.n);
    const markers = kmMarkers(s);
    expect(markers.map((m) => m.km)).toEqual([1, 2, 3, 4, 5]);
    expect(markers[0].pos[0]).toBeCloseTo(-6.2 + 1000 / 111_195, 3);
  });

  it('zones: seconds in zones plus below add up to the covered time', () => {
    const z = a.hrZones!;
    const strain = workoutStrain(
      steady5k().points.filter((p) => p.hr !== null),
      ZONES.maxHr,
    )!;
    expect(z.sec.reduce((s, v) => s + v, 0) + z.belowSec).toBe(Math.round(strain.coveredMinutes * 60));
    expect(z.bounds).toHaveLength(6);
    expect(z.bounds[5]).toBe(MAX_HR);
    expect(z.bounds[0]).toBe(95);
    expect(z.source).toBe('age');
    expect(a.effort?.strain).toBe(Math.round(strain.strain * 10) / 10);
    expect(a.effort?.band).toBe(a.effort!.strain < 8 ? 'light' : a.effort!.strain < 13 ? 'moderate' : a.effort!.strain < 18 ? 'hard' : 'max');
  });

  it('has no pace zones without an effort of 8 minutes or more, and with one puts everything in vo2', () => {
    expect(a.paceZones).not.toBeNull();
    const threshold = Math.round(300 * (3600 / 1500) ** (0.06 / 1.06));
    expect(a.paceZones?.thresholdSecKm).toBe(threshold);
    const zones = a.paceZones!.zones;
    expect(zones.map((z) => z.key)).toEqual(['recovery', 'endurance', 'tempo', 'threshold', 'vo2']);
    expect(zones[0].fromSecKm).toBeNull();
    expect(zones[4].toSecKm).toBeNull();
    expect(zones[4].sec).toBe(1510);
    const short = analyze(straightRun({ legs: [{ sec: 400, speed: FIVE_MIN_KM }], hr: () => 150 }));
    expect(short.paceZones).toBeNull();
  });
});

describe('best efforts ranking and history', () => {
  it('ranks against past workouts and feeds the threshold from history', () => {
    const a = analyze(steady5k(), { history: { ...NO_HISTORY, efforts: [{ '1k': 290, '5k': 1600 }, { '1k': 310 }, { '1k': 295 }] } });
    const by = Object.fromEntries(a.bestEfforts.map((e) => [e.key, e]));
    expect(by['1k'].rank).toBe(3);
    expect(by['5k'].rank).toBe(1);
    expect(by['400m'].rank).toBeNull();
    const fast = analyze(steady5k(), { history: { ...NO_HISTORY, efforts: [{ '10k': 2700 }] } });
    expect(fast.paceZones?.thresholdSecKm).toBe(Math.round(270 * (3600 / 2700) ** (0.06 / 1.06)));
  });

  it('computes past efforts from points only for runs and walks', () => {
    const synth = steady5k();
    expect(bestEffortsForHistory(synth.points, 'run')['1k']).toBe(300);
    expect(bestEffortsForHistory(synth.points, 'ride')).toEqual({});
    expect(bestEffortsForHistory(synth.points)['5k']).toBe(1500);
  });
});

describe('pause', () => {
  const legs: Leg[] = [
    { sec: 900, speed: FIVE_MIN_KM },
    { sec: 120, speed: 0 },
    { sec: 600, speed: FIVE_MIN_KM },
  ];
  const synth = straightRun({ legs, hr: hrRamp(1620), alt: () => 20 });
  const a = analyze(synth, { duration: 1500 });

  it('moving time is the watch active time when a pause explains the difference', () => {
    expect(a.elapsedSec).toBe(1620);
    expect(a.movingSec).toBe(1500);
  });

  it('moving time is the watch timer, whatever its gap to the elapsed time; the elapsed time only when there is no timer', () => {
    for (const duration of [1617, 1591, 1590]) {
      const b = analyze(synth, { duration });
      expect(b.movingSec).toBe(duration);
      expect(b.elapsedSec).toBe(1620);
    }
    expect(analyze(synth, { duration: 0 }).movingSec).toBe(1620);
  });

  it('splits leave the watch pause out, as Strava does with the file: every kilometre 5:00, summing to the moving time', () => {
    expect(a.splits.map((s) => s.sec)).toEqual([300, 300, 300, 300, 300]);
    expect(a.splits.reduce((s, x) => s + x.sec, 0)).toBe(a.movingSec);
  });

  it('keeps the position through the pause (same place) and the best effort ignores it', () => {
    const track = a.series!.track!;
    expect(track.every((p) => p !== null)).toBe(true);
    const by = Object.fromEntries(a.bestEfforts.map((e) => [e.key, e]));
    expect(by['1k'].sec).toBe(300);
    expect(by['5k'].sec).toBe(1620);
  });

  it('leaves the pace null while stopped', () => {
    const pace = a.series!.pace!;
    const mid = Math.round(960 / a.series!.stepSec);
    expect(pace[mid]).toBeNull();
    expect(pace[Math.round(300 / a.series!.stepSec)]).toBe(300);
  });
});

describe('gaps in the track', () => {
  it('leaves the position null across a long gap with a big jump but spreads the distance', () => {
    const pts = [];
    for (let t = 0; t <= 100; t++) pts.push(row(T0 + t, { lat: -6.2 + (3 * t) / 111_195, lon: 106.8 }));
    for (let t = 160; t <= 300; t++) pts.push(row(T0 + t, { lat: -6.2 + (3 * (t - 60) * 1.0) / 111_195 + 0.001, lon: 106.8 }));
    const g = buildGrid({ start: T0, end: T0 + 300, duration: 300, distance: 0, kind: 'run', points: pts });
    const i = Math.round(130 / g.stepSec);
    expect(g.track![i]).toBeNull();
    expect(g.dist![i]).toBeGreaterThan(g.dist![Math.round(100 / g.stepSec)]);
    expect(g.track![Math.round(50 / g.stepSec)]).not.toBeNull();
  });
});

describe('elevation', () => {
  it('counts stairs in full', () => {
    const steps = (t: number) => (t < 400 ? Math.floor(t / 40) * 3 : t < 800 ? 30 : Math.max(0, 30 - Math.floor((t - 800) / 40) * 3));
    const a = analyze(straightRun({ legs: [{ sec: 1200, speed: 2 }], alt: steps, hr: () => 140 }));
    expect(a.elevation!.gainM).toBeGreaterThan(24);
    expect(a.elevation!.gainM).toBeLessThan(33);
    expect(a.elevation!.lossM).toBeGreaterThanOrEqual(24);
    expect(a.elevation!.lossM).toBeLessThan(33);
    expect(a.elevation!.maxM).toBeGreaterThan(28);
    expect(a.elevation!.minM).toBeLessThan(2);
  });

  it('rejects noise under the 1 m hysteresis and averages out sensor jitter', () => {
    const noisy = (t: number) => 50 + (t % 2 === 0 ? 0.8 : -0.8);
    const a = analyze(straightRun({ legs: [{ sec: 1200, speed: 2 }], alt: noisy, hr: () => 140 }));
    expect(a.elevation!.gainM).toBe(0);
    expect(a.elevation!.lossM).toBe(0);
    // Jitter of 2 m peak to peak on every sample is gone after the 60 s mean.
    const jitter = elevationProfile(Array.from({ length: 600 }, (_, i) => 50 + (i % 2 === 0 ? 1 : -1)));
    expect(jitter.gain).toBe(0);
  });

  it('counts a long slope in full to within the smoothing at its ends', () => {
    const ramp = elevationProfile(Array.from({ length: 601 }, (_, i) => i * 0.1));
    expect(ramp.gain).toBeGreaterThan(53);
    expect(ramp.gain).toBeLessThanOrEqual(60);
    expect(ramp.loss).toBe(0);
  });

  it('takes the gain and loss of the smoothed altitude, not the watch barometer sum, and min and max from the altitude', () => {
    const a = analyze(straightRun({ legs: [{ sec: 600, speed: 2 }], alt: () => 40, hr: () => 140 }), {
      summary: { elevationGain: 12, elevationLoss: 9, minAltitude: 1, maxAltitude: 99 },
    });
    expect(a.elevation).toEqual({ gainM: 0, lossM: 0, minM: 40, maxM: 40 });
  });

  it('keeps the totals of an imported file, which are the other device\'s own', () => {
    const a = analyze(straightRun({ legs: [{ sec: 600, speed: 2 }], alt: () => 40, hr: () => 140 }), {
      summary: { elevationGain: 12, elevationLoss: 9, importedFrom: 'Garmin' },
    });
    expect(a.elevation).toEqual({ gainM: 12, lossM: 9, minM: 40, maxM: 40 });
  });

  it('falls back to the watch figures and altitude range when the points have no altitude', () => {
    const a = analyze(straightRun({ legs: [{ sec: 600, speed: 2 }], hr: () => 140 }), {
      summary: { elevationGain: 12, elevationLoss: 9, minAltitude: 1, maxAltitude: 99 },
    });
    expect(a.elevation).toEqual({ gainM: 12, lossM: 9, minM: 1, maxM: 99 });
  });

  it('is null when nothing reports altitude', () => {
    expect(analyze(straightRun({ legs: [{ sec: 600, speed: 2 }] })).elevation).toBeNull();
  });

  it('gives each split its own climb', () => {
    const slope = (t: number) => 10 + (t / 300) * 6;
    const a = analyze(steady5k({ alt: slope }));
    for (const s of a.splits) expect(s.gainM).toBeGreaterThan(4);
    expect(a.splits.every((s) => s.lossM === 0)).toBe(true);
  });
});

describe('no GPS', () => {
  const gym = straightRun({ legs: [{ sec: 1800, speed: 0 }], noGps: true, hr: hrRamp(1800) });
  const a = analyze(gym, { sportName: 'Strength training', calories: 220, distance: 0 });

  it('keeps heart rate only and counts the whole time as moving', () => {
    expect(a.series?.dist).toBeNull();
    expect(a.series?.pace).toBeNull();
    expect(a.series?.track).toBeNull();
    expect(a.series?.hr).not.toBeNull();
    expect(a.series?.stepSec).toBe(3);
    expect(a.movingSec).toBe(a.elapsedSec);
    expect(a.distanceM).toBeNull();
    expect(a.splits).toEqual([]);
    expect(a.bestEfforts).toEqual([]);
    expect(a.paceZones).toBeNull();
    expect(a.sport.kind).toBe('other');
  });

  it('still has zones, effort, load and calories split', () => {
    const z = a.hrZones!;
    expect(z.sec.reduce((s, v) => s + v, 0) + z.belowSec).toBeGreaterThan(1790);
    expect(a.effort).not.toBeNull();
    expect(a.load?.trimp).toBe(a.effort?.trimp);
    expect(a.calories?.kcal).toBe(220);
    expect(a.calories?.fatG).not.toBeNull();
  });

  it('spreads a watch distance over time when there is none from GPS or speed', () => {
    const treadmill = straightRun({ legs: [{ sec: 1800, speed: 0 }], noGps: true, hr: () => 150 });
    const t = analyze(treadmill, { distance: 5000 });
    expect(t.series?.dist?.[t.series.n - 1]).toBe(5000);
    expect(t.series?.pace).toBeNull();
    expect(t.distanceM).toBe(5000);
    expect(t.splits).toEqual([]);
    expect(t.movingSec).toBe(1800);
  });

  it('uses per-sample speed for the distance and pace when GPS is missing', () => {
    const pts = [];
    for (let t = 0; t <= 1200; t++) pts.push(row(T0 + t, { hr: 150, speed: t < 600 ? 3 : 4 }));
    const a2 = analyze({ points: pts, elapsed: 1200, distance: 0 }, { distance: 3600 });
    const s = a2.series!;
    expect(s.dist![s.n - 1]).toBe(3600);
    const pace = s.pace!;
    expect(pace[Math.round(300 / s.stepSec)]).toBeGreaterThan(pace[Math.round(900 / s.stepSec)] as number);
    expect(a2.splits.length).toBe(4);
  });

  it('builds splits from the watch pace blocks when there is no GPS', () => {
    const treadmill = straightRun({ legs: [{ sec: 1500, speed: 0 }], noGps: true, hr: () => 150 });
    const a3 = analyze(treadmill, {
      distance: 5300,
      summary: {
        paceBlocks: [
          { type: 0, distance: 1, correction: null, pace: 300 },
          { type: 0, distance: 2, correction: null, pace: 290 },
          { type: 0, distance: 3, correction: null, pace: 310 },
          { type: 0, distance: 4, correction: null, pace: 300 },
          { type: 0, distance: 5, correction: null, pace: 300 },
          { type: 0, distance: 6, correction: 3000, pace: 300 },
          { type: 1, distance: 3, correction: null, pace: 480 },
        ],
      },
    });
    expect(a3.splits.map((s) => s.paceSecKm)).toEqual([300, 290, 310, 300, 300, 300]);
    expect(a3.splits[5].distM).toBe(300);
    expect(a3.splits[5].sec).toBe(90);
    expect(a3.splits[0].hr).toBe(150);
    expect(paceBlockSplits(undefined, { stepSec: 1, n: 2, dist: null, hr: null, cad: null, cumGain: null, cumLoss: null, pause: null })).toEqual([]);
  });
});

describe('a 1 km workout', () => {
  const a = analyze(straightRun({ legs: [{ sec: 302, speed: FIVE_MIN_KM }], hr: () => 150 }));
  it('has one split and the short efforts only', () => {
    expect(a.splits).toHaveLength(1);
    expect(a.splits[0].distM).toBe(1000);
    expect(a.bestEfforts.map((e) => e.key)).toEqual(['400m', '1k']);
    expect(a.paceZones).toBeNull();
  });
  it('keeps a 140 m remainder as a short last split', () => {
    const b = analyze(straightRun({ legs: [{ sec: 340, speed: FIVE_MIN_KM }], hr: () => 150 }));
    expect(b.splits).toHaveLength(2);
    expect(b.splits[1].distM).toBeGreaterThanOrEqual(130);
    expect(b.splits[1].distM).toBeLessThan(150);
    expect(b.splits[1].paceSecKm).toBe(300);
  });
});

describe('cadence, power and stride', () => {
  it('averages cadence and power, and takes 0 cadence as a gap', () => {
    const synth = steady5k({ cadence: (t) => (t < 100 ? 0 : 170), power: () => 250 });
    const a = analyze(synth);
    expect(a.series!.cad![0]).toBeNull();
    expect(a.series!.cad![a.series!.n - 5]).toBe(170);
    expect(a.stats.avgCad).toBe(170);
    expect(a.stats.maxCad).toBe(170);
    expect(a.stats.avgPower).toBe(250);
    expect(a.stats.normalizedPower).toBe(250);
    expect(a.series!.power!.every((p) => p === null || p === 250)).toBe(true);
  });

  it('reads stride length from points', () => {
    const synth = steady5k();
    const withStride = synth.points.map((p, i) => (i % 3 === 0 ? { ...p, stride: 1.1 } : p));
    expect(analyze({ ...synth, points: withStride }).stats.avgStrideM).toBe(1.1);
  });

  it('derives the step length of a run from its speed and cadence when no source gives one', () => {
    // 5:00 per km is 3.33 m/s; at 170 steps per minute (2.83 steps a second) a step is 1.18 m.
    const a = analyze(steady5k({ cadence: () => 170 }));
    expect(a.stats.avgCad).toBe(170);
    expect(a.stats.avgStrideM).toBeCloseTo(1.18, 1);
  });

  it('prefers a measured step length to the derived one, and drops an impossible one', () => {
    const synth = steady5k({ cadence: () => 170 });
    const measured = synth.points.map((p) => (p.ts % 2 === 0 ? { ...p, stride: 0.9 } : p));
    expect(analyze({ ...synth, points: measured }).stats.avgStrideM).toBe(0.9);
    const absurd = synth.points.map((p) => ({ ...p, stride: 3.5 }));
    expect(analyze({ ...synth, points: absurd }).stats.avgStrideM).toBeCloseTo(1.18, 1);
  });

  it('doubles the per-leg cadence a FIT file keeps in its summary and reads its avg_step_length', () => {
    const synth = steady5k();
    const summary: WorkoutSummary = { avgCadence: 85, maxCadence: 112, avgStepLengthM: 1.05, importedFrom: 'Garmin' };
    const a = analyze(synth, { summary });
    expect(a.stats).toMatchObject({ avgCad: 170, maxCad: 224, avgStrideM: 1.05 });
    // A bike's cadence is revolutions per minute: never doubled.
    const ride = analyze(synth, { summary: { avgCadence: 85, maxCadence: 112, importedFrom: 'Garmin' }, sportName: 'Biking' });
    expect(ride.stats).toMatchObject({ avgCad: 85, maxCad: 112, avgStrideM: null });
  });

  it('does not double a FIT summary that already counts steps (flagged by the import) or that is above any per-leg value', () => {
    const synth = steady5k();
    expect(analyze(synth, { summary: { avgCadence: 158, maxCadence: 175, importedFrom: 'Huawei', cadencePerLeg: false } }).stats).toMatchObject({ avgCad: 158, maxCad: 175 });
    // 150 per leg would be 300 steps per minute.
    expect(analyze(synth, { summary: { avgCadence: 150, importedFrom: 'Huawei' } }).stats.avgCad).toBe(150);
    // The boundary: 130 per leg is 260 steps per minute, still a stride count.
    expect(analyze(synth, { summary: { avgCadence: 130, importedFrom: 'Garmin' } }).stats.avgCad).toBe(260);
  });

  it('reads the watch\'s own sample averages (cadence or step rate in steps per minute, step length in centimetres)', () => {
    const a = analyze(steady5k(), { summary: { samples: { avgCadence: 158, avgStepLength: 78 } } });
    expect(a.stats).toMatchObject({ avgCad: 158, avgStrideM: 0.78 });
    const walk = analyze(steady5k(), { summary: { samples: { avgStepRate: 112.4 } }, sportName: 'Outdoor Walk' });
    expect(walk.stats.avgCad).toBe(112);
  });

  it('reads the watch\'s per-km blocks, weighted by length, and skips blocks with no reading', () => {
    const sections = [
      { distance: 1000, cadence: 160, stepLength: 70 },
      { distance: 1000, cadence: 170, stepLength: 80 },
      { distance: 500, cadence: -1, stepLength: 0 },
    ];
    expect(analyze(steady5k(), { summary: { sections } }).stats).toMatchObject({ avgCad: 165, avgStrideM: 0.75 });
  });

  it('falls back to the step count over the moving time, and ignores a count that is not a gait', () => {
    const synth = steady5k();
    // 1510 s is 25.17 minutes: 4000 steps are 159 per minute.
    const a = analyze(synth, { steps: 4000 });
    expect(a.stats.avgCad).toBe(159);
    expect(a.stats.avgStrideM).toBeCloseTo(1.26, 1);
    expect(analyze(synth, { steps: 20_000 }).stats).toMatchObject({ avgCad: null, avgStrideM: null });
    expect(analyze(synth, { steps: 0 }).stats).toMatchObject({ avgCad: null, avgStrideM: null });
  });
});

describe('cadence and step length series from the watch minutes', () => {
  const minutes = (steps: number, from: number, count: number) =>
    Array.from({ length: count }, (_, i) => ({ timestamp: T0 + from + i * 60, steps, calories: 0, distance: 0, heartRate: null, spo2: null, restingHeartRate: null }));

  function withMinutes(synth: Synth, daySamples: ReturnType<typeof minutes>, summary: WorkoutSummary = {}): WorkoutAnalysis {
    return analyzeWorkout(
      {
        workout: workoutRow({ end: T0 + synth.elapsed, duration: synth.elapsed, distance: Math.round(synth.distance), steps: 4000 }),
        summary,
        points: synth.points,
        zones: ZONES,
        daySamples,
        history: NO_HISTORY,
      },
      ALL,
    );
  }

  it('builds a real per-minute cadence for a run whose points carry none, gaps staying gaps', () => {
    const synth = steady5k();
    // 25 minutes; minutes 0-9 and 12-24 have steps, 10 and 11 are missing.
    const day = [...minutes(160, 0, 10), ...minutes(172, 720, 13)];
    const a = withMinutes(synth, day);
    const s = a.series!;
    expect(s.cad![0]).toBe(160);
    expect(s.cad![Math.floor(1490 / s.stepSec)]).toBe(172);
    const gap = Math.round(630 / s.stepSec);
    expect(s.cad![gap]).toBeNull();
    // Not a flat line: two distinct values.
    expect(new Set(s.cad!.filter((v) => v !== null)).size).toBe(2);
    expect(a.stats.avgCad).toBeGreaterThan(160);
    expect(a.stats.maxCad).toBe(172);
    // The step length is derived by the chart from this pace and cadence; the payload carries no stride series of its own.
    expect(s.stride).toBeUndefined();
  });

  it('prefers stored per-sample cadence to the minute data', () => {
    const synth = steady5k({ cadence: () => 150 });
    const a = withMinutes(synth, minutes(170, 0, 25));
    expect(a.series!.cad!.filter((v) => v !== null).every((v) => v === 150)).toBe(true);
  });

  it('does not use minute steps for a ride (its cadence is rpm)', () => {
    const synth = steady5k();
    const a = analyzeWorkout(
      {
        workout: workoutRow({ end: T0 + synth.elapsed, duration: synth.elapsed, sportName: 'Biking', distance: Math.round(synth.distance) }),
        summary: {},
        points: synth.points,
        zones: ZONES,
        daySamples: minutes(170, 0, 25),
        history: NO_HISTORY,
      },
      ALL,
    );
    expect(a.series!.cad).toBeNull();
  });

  it('carries a measured per-sample step length in series.stride', () => {
    const synth = steady5k({ cadence: () => 170 });
    const measured = synth.points.map((p) => (p.ts % 2 === 0 ? { ...p, stride: 0.9 } : p));
    const a = analyze({ ...synth, points: measured });
    expect(a.series!.stride!.some((v) => v === 0.9)).toBe(true);
    expect(a.series!.stride!.every((v) => v === null || v === 0.9)).toBe(true);
  });
});

describe('heart-rate gaps', () => {
  it('leaves a long dropout null and fills short ones', () => {
    const synth = steady5k({ hr: (t) => (t >= 300 && t < 400 ? null : t % 5 === 0 ? 150 : null) });
    const g = analyze(synth).series!;
    expect(g.hr![Math.round(350 / g.stepSec)]).toBeNull();
    expect(g.hr![Math.round(200 / g.stepSec)]).toBe(150);
  });

  it('ignores out-of-range bpm', () => {
    const synth = steady5k({ hr: (t) => (t % 2 === 0 ? 300 : 10) });
    expect(analyze(synth).series!.hr).toBeNull();
    expect(analyze(synth).hrZones).toBeNull();
  });
});

describe('limits and rounding', () => {
  it('keeps the sample count within the contract for any length', () => {
    for (const hours of [0.25, 1, 3, 10]) {
      const sec = Math.round(hours * 3600);
      const a = analyze(straightRun({ legs: [{ sec, speed: 2.5 }], hr: () => 140 }));
      expect(a.series!.n).toBeLessThanOrEqual(ANALYSIS_LIMITS.samples);
      expect(a.series!.stepSec).toBe(Math.max(1, Math.ceil(sec / 600)));
      expect(a.splits.length).toBeLessThanOrEqual(ANALYSIS_LIMITS.splits);
    }
    expect(analyze(straightRun({ legs: [{ sec: 3600, speed: 2.5 }], hr: () => 140 })).series!.stepSec).toBe(6);
  });

  it('rounds to the documented precision', () => {
    const a = analyze(
      straightRun({ legs: [{ sec: 1500, speed: 3.3217 }], hr: (t) => 140.37 + (t % 7) / 3, alt: (t) => 20.0371 + t * 0.013, cadence: () => 171.4 }),
    );
    const s = a.series!;
    expect(s.dist!.every(Number.isInteger)).toBe(true);
    expect(s.hr!.every((v) => v === null || Number.isInteger(v))).toBe(true);
    expect(s.pace!.every((v) => v === null || Number.isInteger(v))).toBe(true);
    expect(s.cad!.every((v) => v === null || Number.isInteger(v))).toBe(true);
    expect(s.alt!.every((v) => v === null || Math.abs(v * 10 - Math.round(v * 10)) < 1e-9)).toBe(true);
    expect(s.track!.every((p) => p === null || (Math.abs(p[0] * 1e5 - Math.round(p[0] * 1e5)) < 1e-6 && Math.abs(p[1] * 1e5 - Math.round(p[1] * 1e5)) < 1e-6))).toBe(true);
    for (let i = 1; i < s.n; i++) expect(s.dist![i]).toBeGreaterThanOrEqual(s.dist![i - 1]);
    expect(Number.isInteger(a.elapsedSec) && Number.isInteger(a.movingSec) && Number.isInteger(a.distanceM!)).toBe(true);
  });

  it('is a small payload for a one-hour run', () => {
    const a = analyze(straightRun({ legs: [{ sec: 3600, speed: 3 }], hr: hrRamp(3600), alt: (t) => 20 + 5 * Math.sin(t / 200), cadence: () => 170 }));
    const bytes = JSON.stringify(a).length;
    expect(bytes).toBeLessThan(40_000);
  });
});

describe('privacy options', () => {
  const synth = steady5k({ cadence: () => 170 });
  const history: AnalysisHistory = {
    efforts: [],
    trimps: [{ start: T0 - 86400, trimp: 100 }],
    similar: [{ id: 2, start: T0 - 86400 * 3, duration: 1500, distance: 5000, sportName: 'Outdoor Run', kind: 'run', avgHr: 150, gain: 10 }],
  };

  it('drops the route', () => {
    const a = analyze(synth, { history, options: { ...ALL, includeRoute: false } });
    expect(a.series!.track).toBeNull();
    expect(kmMarkers(a.series!)).toEqual([]);
    expect(a.series!.dist).not.toBeNull();
    expect(JSON.stringify(a)).not.toContain('-6.2');
  });

  it('drops everything derived from heart rate', () => {
    const a = analyze(synth, { history, calories: 400, options: { ...ALL, includeHr: false } });
    expect(a.series!.hr).toBeNull();
    expect(a.hrZones).toBeNull();
    expect(a.effort).toBeNull();
    expect(a.load).toBeNull();
    expect(a.calories).toEqual({ kcal: 400, fatG: null, carbG: null });
    expect(a.stats.avgHr).toBeNull();
    expect(a.stats.maxHr).toBeNull();
    expect(a.stats.minHr).toBeNull();
    expect(a.splits.every((s) => s.hr === null)).toBe(true);
    expect(a.comparison!.items.every((i) => i.avgHr === null)).toBe(true);
    expect(a.series!.pace).not.toBeNull();
  });

  it('drops the comparison', () => {
    expect(analyze(synth, { history, options: { ...ALL, includeComparison: false } }).comparison).toBeNull();
    expect(analyze(synth, { history }).comparison?.items).toHaveLength(1);
  });

  it('has no series at all when only heart rate existed and it is hidden', () => {
    const gym = straightRun({ legs: [{ sec: 600, speed: 0 }], noGps: true, hr: () => 140 });
    expect(analyze(gym, { options: { ...ALL, includeHr: false } }).series).toBeNull();
  });
});

describe('load', () => {
  it('sums 7 and 28 days up to the workout and divides the chronic load by 4 weeks', () => {
    const day = 86400;
    const load = buildLoad(
      50,
      T0,
      [
        { start: T0 - 2 * day, trimp: 100 },
        { start: T0 - 6 * day, trimp: 40 },
        { start: T0 - 10 * day, trimp: 200 },
        { start: T0 - 27 * day, trimp: 60 },
        { start: T0 - 29 * day, trimp: 999 },
        { start: T0 + 1, trimp: 999 },
      ],
      { workoutLoad: 123.46, aerobicEffect: 3.24, anaerobicEffect: 1, recoveryHours: 36 },
    );
    expect(load.acute).toBe(190);
    expect(load.chronicWeekly).toBe(112.5);
    expect(load.ratio).toBe(1.69);
    expect(load.watchLoad).toBe(123.5);
    expect(load.aerobicEffect).toBe(3.2);
    expect(load.anaerobicEffect).toBe(1);
    expect(load.recoveryHours).toBe(36);
  });

  it('has no ratio and null watch values for a first workout', () => {
    const load = buildLoad(0, T0, [], {});
    expect(load.ratio).toBeNull();
    expect(load.watchLoad).toBeNull();
  });
});

describe('similar workouts', () => {
  const target = { start: T0, duration: 1500, distance: 5000, sportName: 'Outdoor Run' };
  const cand = (id: number, over: Partial<SimilarCandidate> = {}): SimilarCandidate => ({
    id,
    start: T0 - id * 86400,
    duration: 1500,
    distance: 5000,
    sportName: 'Outdoor Run',
    kind: 'run',
    avgHr: 150,
    gain: 12,
    ...over,
  });

  it('keeps same sport, earlier, within 20 percent of the distance; newest first, at most 5', () => {
    const list = [
      cand(1),
      cand(2, { distance: 4100 }),
      cand(3, { distance: 6100 }),
      cand(4, { sportName: 'Indoor Run' }),
      cand(5, { start: T0 + 10 }),
      cand(6, { distance: 5900 }),
      cand(7),
      cand(8),
      cand(9),
      cand(10),
      cand(11),
    ];
    const r = selectSimilar(target, list)!;
    expect(r.basis).toBe('distance');
    expect(r.items).toHaveLength(5);
    expect(r.items.map((i) => i.startedAt)).toEqual([1, 2, 6, 7, 8].map((id) => (T0 - id * 86400) * 1000));
    expect(r.items[0].paceSecKm).toBe(300);
  });

  it('falls back to the duration when this workout has no distance', () => {
    const r = selectSimilar({ ...target, distance: 0, sportName: 'Strength' }, [
      cand(1, { sportName: 'Strength', distance: 0, duration: 1800 }),
      cand(2, { sportName: 'Strength', distance: 0, duration: 1000 }),
      cand(3, { sportName: 'Strength', distance: 0, duration: 1400, kind: 'other' }),
    ])!;
    expect(r.basis).toBe('duration');
    expect(r.items).toHaveLength(2);
    expect(r.items[0].distM).toBeNull();
    expect(r.items[0].paceSecKm).toBeNull();
  });

  it('uses moving time when known and is null when nothing matches', () => {
    const r = selectSimilar(target, [cand(1, { movingSec: 1450 })])!;
    expect(r.items[0].sec).toBe(1450);
    expect(selectSimilar(target, [cand(1, { distance: 100 })])).toBeNull();
  });
});

describe('laps', () => {
  it('puts the watch laps on the workout clock and fills what they lack from the grid', () => {
    const summary: WorkoutSummary = {
      laps: [
        { startTs: T0, endTs: T0 + 600, distanceM: null, avgHr: null, maxHr: 160, avgCadence: null },
        { startTs: T0 + 600, endTs: T0 + 1000, distanceM: 1300, avgHr: 155, maxHr: 170, avgCadence: 172 },
        { startTs: T0 + 1000, endTs: T0 + 1000, distanceM: 0, avgHr: null, maxHr: null, avgCadence: null },
      ],
    };
    const a = analyze(steady5k({ cadence: () => 168 }), { summary });
    expect(a.laps).toHaveLength(2);
    expect(a.laps[0]).toMatchObject({ n: 1, startSec: 0, sec: 600, distM: 2000, paceSecKm: 300, maxHr: 160, avgCad: 168 });
    expect(a.laps[0].avgHr).toBeGreaterThan(130);
    expect(a.laps[1]).toMatchObject({ n: 2, startSec: 600, sec: 400, distM: 1300, avgHr: 155, avgCad: 172 });
    expect(a.laps[0].gainM).toBe(0);
  });
});

describe('stats', () => {
  it('takes cadence and top speed from the watch and doubles FIT strides on foot', () => {
    const a = analyze(steady5k(), {
      summary: { avgCadence: 85, maxCadence: 92, importedFrom: 'Garmin', avgSpeed: 3.3, maxSpeed: 5.1, avgPaceSecPerKm: 303 },
    });
    expect(a.stats.avgCad).toBe(170);
    expect(a.stats.maxCad).toBe(184);
    expect(a.stats.maxSpeedMs).toBe(5.1);
    expect(a.stats.bestPaceSecKm).toBe(300);
  });

  it('averages pace and speed as distance over the moving time, not the watch figures', () => {
    const a = analyze(steady5k(), { summary: { avgSpeed: 3.3, avgPaceSecPerKm: 303 } });
    expect(a.stats.avgSpeedMs).toBe(Math.round((a.distanceM! / a.movingSec) * 100) / 100);
    expect(a.stats.avgPaceSecKm).toBe(Math.round(a.movingSec / (a.distanceM! / 1000)));
  });

  it('falls back to the watch pace and speed when there is no distance', () => {
    const a = analyze(straightRun({ legs: [{ sec: 600, speed: 2 }], noGps: true, hr: () => 140 }), {
      distance: 0,
      summary: { avgSpeed: 3.3, avgPaceSecPerKm: 303 },
    });
    expect(a.distanceM).toBeNull();
    expect(a.stats.avgSpeedMs).toBe(3.3);
    expect(a.stats.avgPaceSecKm).toBe(303);
  });

  it('reads avg, max and min heart rate from the points', () => {
    const a = analyze(steady5k());
    expect(a.stats.minHr).toBe(130);
    expect(a.stats.maxHr).toBe(170);
    expect(a.stats.avgHr).toBeGreaterThan(145);
    expect(a.stats.avgHr).toBeLessThan(155);
  });
});

describe('effort', () => {
  it('reports what the workout added to its day when day samples exist', () => {
    const synth = steady5k();
    const input: AnalyzeInput = {
      workout: workoutRow({ end: T0 + synth.elapsed, duration: synth.elapsed, distance: Math.round(synth.distance) }),
      summary: {},
      points: synth.points,
      zones: ZONES,
      daySamples: [{ timestamp: T0 - 3600, steps: 0, calories: 0, distance: 0, heartRate: 120, spo2: null, restingHeartRate: null }],
      history: NO_HISTORY,
    };
    const a = analyzeWorkout(input, ALL);
    expect(a.effort!.addedToDay).not.toBeNull();
    expect(a.effort!.addedToDay as number).toBeGreaterThan(0);
    expect(a.effort!.addedToDay as number).toBeLessThanOrEqual(a.effort!.strain);
    expect(analyze(synth).effort!.addedToDay).toBeNull();
  });
});
