/**
 * Fixture data for the golden renders and the edge-case tests: the same shapes the builders in `../data` emit (numbers raw,
 * a missing value is an absent key). Deterministic: no clock, no randomness beyond the seeded noise below.
 */
import { slideData } from '../data/threads';
import type { JsonObject, StickerKind } from '../subject';
import { lineRoute, loopRoute, seeded } from './routes';
import { THREADS_FIXTURES } from './threadsFixtures';

export { lineRoute, loopRoute } from './routes';

export interface Fixture {
  /** Stable key used in golden file names: `<kind>.<variant>`. */
  key: string;
  kind: StickerKind;
  /** What the case exercises. */
  label: string;
  /** The binding root, one object per namespace. */
  data: JsonObject;
}

const HR_ZONE_COLORS = ['#5FD3EE', '#6EE7A0', '#F5D547', '#FF9F43', '#FF4D6A'];

function wave(n: number, base: number, amp: number, seed: number): number[] {
  const rand = seeded(seed);
  return Array.from({ length: n }, (_, i) => Math.round((base + Math.sin(i / 5) * amp + (rand() - 0.5) * amp * 0.5) * 10) / 10);
}

const RUN_FULL: JsonObject = {
  sport: 'Lari',
  kind: 'run',
  startedAt: Date.UTC(2026, 9, 12, 0, 30),
  movingSec: 1992,
  distanceM: 5240,
  paceSecKm: 380,
  hrAvg: 154,
  hrMax: 178,
  kcal: 402,
  elevGainM: 38,
  cadence: 172,
  route: loopRoute(520, 420),
  splitKmh: [10.1, 9.8, 9.4, 9.9, 10.4, 11.2],
  splitLabels: ['1', '2', '3', '4', '5', '6'],
  splitFastest: 5,
  hrZoneSec: [120, 380, 900, 520, 72],
  hrZonePct: [0.06, 0.19, 0.45, 0.26, 0.04],
  hrZoneLabels: ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'],
  hrZoneColors: HR_ZONE_COLORS,
  hrZoneTop: 3,
  hrSeries: wave(48, 150, 18, 3),
  paceSeries: wave(48, 9.9, 1.2, 4),
  altSeries: wave(48, 32, 7, 5),
  strain: 11.4,
  strainPct: 11.4 / 21,
  effortLabel: 'Sedang',
  prLabel: '5K tercepat',
  prTime: 1892,
  prCount: 1,
  gear: 'Sepatu: Nike Pegasus 41 · 312 km',
};

const MILESTONE_PR: JsonObject = {
  kind: 'pr',
  title: '5K tercepat',
  subtitle: 'Terbaik dalam 120 hari terakhir',
  value: 1892,
  valueText: '31:32',
};

const STRENGTH_FULL: JsonObject = {
  name: 'Push day',
  startedAt: Date.UTC(2026, 9, 14, 11, 5),
  volumeKg: 8420,
  reps: 142,
  sets: 19,
  durationSec: 3720,
  kcal: 310,
  exercises: 6,
  topSets: [
    { exercise: 'Bench press', load: '82,5 kg x 5' },
    { exercise: 'Overhead press', load: '52,5 kg x 6' },
    { exercise: 'Incline dumbbell press', load: '30 kg x 10' },
    { exercise: 'Cable fly', load: '20 kg x 12' },
    { exercise: 'Triceps pushdown', load: '35 kg x 12' },
  ],
  prCount: 2,
  prs: [
    { exercise: 'Bench press', load: '82,5 kg x 5', kind: 'e1rm' },
    { exercise: 'Overhead press', load: '52,5 kg x 6', kind: 'weight' },
  ],
  muscleLabels: ['Dada', 'Bahu', 'Trisep', 'Core'],
  muscleSets: [11, 6, 5.5, 2],
  muscleColors: ['#D4FF3A', '#9DBF2B', '#7E9A2A', '#4D5A2A'],
  avgRpe: 8,
};

const SLEEP_FULL: JsonObject = {
  score: 84,
  asleepSec: 27_300,
  deepSec: 5100,
  remSec: 6300,
  lightSec: 15_900,
  awakeSec: 1500,
  deepPct: 0.18,
  remPct: 0.22,
  lightPct: 0.55,
  awakePct: 0.05,
  bedtime: Date.UTC(2026, 9, 13, 16, 20),
  wakeTime: Date.UTC(2026, 9, 13, 23, 55),
  inBedSec: 28_800,
  awakenings: 2,
  vsAvgSec: 1500,
  hypno: Array.from({ length: 48 }, (_, i) => [1, 2, 3, 3, 4, 4, 3, 2, 3, 4, 4, 3, 2, 3, 3, 2, 2, 3, 2, 3, 2, 2, 2, 1, 2, 3, 2, 2, 1, 2, 2, 2, 3, 2, 2, 2, 2, 3, 2, 2, 2, 2, 1, 2, 2, 2, 1, 1][i]!),
  hypnoColors: Array.from({ length: 48 }, (_, i) => ['#F0A23C', '#C09CF5', '#8F9BE3', '#4B57B5'][[1, 2, 3, 3, 4, 4, 3, 2, 3, 4, 4, 3, 2, 3, 3, 2, 2, 3, 2, 3, 2, 2, 2, 1, 2, 3, 2, 2, 1, 2, 2, 2, 3, 2, 2, 2, 2, 3, 2, 2, 2, 2, 1, 2, 2, 2, 1, 1][i]! - 1]!),
  verdict: 'Cukup',
};

const READY_FULL: JsonObject = {
  recovery: 78,
  headline: 'Siap',
  headlineKey: 'Primed',
  strain: 12.6,
  strainPct: 12.6 / 21,
  sleepSec: 26_400,
  sleepPct: 0.92,
  steps: 9420,
  stepGoal: 8000,
  stepPct: 9420 / 8000,
  rhr: 54,
  hrvMs: 62,
  signals: [
    { title: 'HRV', value: '+0,6', tone: 'good' },
    { title: 'Detak istirahat', value: '-2 bpm', tone: 'good' },
    { title: 'Tidur', value: '92%', tone: 'neutral' },
  ],
};

const WEEK_FULL: JsonObject = {
  rangeStart: Date.UTC(2026, 9, 11, 17),
  rangeEnd: Date.UTC(2026, 9, 18, 16, 59),
  workouts: 5,
  activeDays: 5,
  dayLabels: ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'],
  distanceM: 21_300,
  movingSec: 12_600,
  kcal: 1640,
  dayMin: [34, 0, 52, 0, 41, 78, 25],
  dayStrain: [9.2, 0, 11.4, 0, 8.7, 14.1, 6.3],
  longestM: 9800,
  bestLabel: 'Terpanjang: 9,8 km',
  strengthSessions: 2,
  volumeKg: 14_600,
  steps: 61_200,
  todayIndex: 6,
};

const LOAD_FULL: JsonObject = {
  dayStrain: [9.2, 0, 11.4, 0, 8.7, 14.1, 6.3],
  dayLabels: ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'],
  sessions: 5,
  totalStrain: 49.7,
  acute: 412,
  chronicWeekly: 355,
  ratio: 1.16,
  status: 'Seimbang',
};

const PLAN_FULL: JsonObject = {
  name: 'Lari 5K',
  goal: 'Menuju 5K',
  week: 3,
  weeks: 8,
  progress: 0.38,
  done: 9,
  total: 24,
  phase: 'Membangun',
  nextLabel: 'Lari santai 4 km',
};

const WATCH_FULL: JsonObject = {
  steps: 9420,
  stepGoal: 8000,
  stepPct: 9420 / 8000,
  strain: 12.6,
  strainPct: 12.6 / 21,
  recovery: 78,
  sleepSec: 26_400,
  sleepPct: 0.92,
  rhr: 54,
};

const ZONES = (sec: number[]): JsonObject => {
  const total = sec.reduce((a, b) => a + b, 0);
  return { hrZoneSec: sec, hrZonePct: sec.map((s) => s / total), hrZoneLabels: ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'], hrZoneColors: HR_ZONE_COLORS, hrZoneTop: sec.indexOf(Math.max(...sec)) + 1 };
};

/**
 * The sport families (`walk` ... `court` kinds): the `run.*` data `buildRunSubject` leaves for each family once the numbers
 * that sport does not have are dropped (see `testing/sportWorkouts.ts` for the watch workouts they come from).
 */
const FAMILY_FIXTURES: readonly Fixture[] = [
  {
    key: 'walk.hike',
    kind: 'walk',
    label: 'Hike with route, climb and steps',
    data: {
      run: { sport: 'Hiking', kind: 'walk', category: 'walk', startedAt: Date.UTC(2026, 9, 25, 23, 0), movingSec: 10_840, distanceM: 9240, paceSecKm: 1173, hrAvg: 121, hrMax: 158, kcal: 1010, elevGainM: 642, steps: 14_210, route: lineRoute(480, 9240), altSeries: wave(48, 900, 180, 21) },
    },
  },
  {
    key: 'walk.indoor',
    kind: 'walk',
    label: 'Indoor walk: steps, no route, no HR',
    data: { run: { sport: 'Jalan dalam ruangan', kind: 'walk', category: 'walk', startedAt: Date.UTC(2026, 9, 24, 11, 0), movingSec: 1500, distanceM: 1820, paceSecKm: 824, kcal: 88, steps: 2460 } },
  },
  {
    key: 'ride.outdoor',
    kind: 'ride',
    label: 'Outdoor ride with route, climb, cadence and power',
    data: {
      run: { sport: 'Bersepeda', kind: 'ride', category: 'ride', startedAt: Date.UTC(2026, 9, 21, 22, 0), movingSec: 5410, distanceM: 38_700, speedKmh: 25.8, hrAvg: 141, hrMax: 172, kcal: 960, elevGainM: 412, cadence: 84, power: 168, route: loopRoute(520, 2600, 3), altSeries: wave(48, 60, 28, 8) },
    },
  },
  {
    key: 'ride.indoor',
    kind: 'ride',
    label: 'Indoor ride: no route, heart rate trace',
    data: { run: { sport: 'Bersepeda dalam ruangan', kind: 'ride', category: 'ride', startedAt: Date.UTC(2026, 9, 27, 23, 0), movingSec: 2700, distanceM: 18_100, speedKmh: 24.1, hrAvg: 138, hrMax: 166, kcal: 420, cadence: 88, power: 182, hrSeries: wave(48, 138, 14, 22) } },
  },
  {
    key: 'swim.pool',
    kind: 'swim',
    label: 'Pool swim with laps, strokes and SWOLF',
    data: { run: { sport: 'Berenang di kolam', kind: 'swim', category: 'swim', startedAt: Date.UTC(2026, 9, 20, 23, 0), movingSec: 2460, distanceM: 1500, pace100Sec: 164, hrAvg: 134, hrMax: 161, kcal: 402, laps: 60, strokes: 1020, swolf: 38, strokeRate: 26, poolM: 25 } },
  },
  {
    key: 'swim.open',
    kind: 'swim',
    label: 'Open water swim with a route, no pool numbers',
    data: { run: { sport: 'Berenang (perairan terbuka)', kind: 'swim', category: 'swim', startedAt: Date.UTC(2026, 9, 19, 22, 30), movingSec: 3120, distanceM: 2050, pace100Sec: 152, kcal: 520, route: loopRoute(300, 380, 17) } },
  },
  {
    key: 'gym.watch',
    kind: 'gym',
    label: 'Watch strength session: duration, heart rate, zones, effort',
    data: { run: { sport: 'Latihan kekuatan', kind: 'other', category: 'gym', startedAt: Date.UTC(2026, 9, 19, 23, 0), movingSec: 3120, hrAvg: 118, hrMax: 158, kcal: 318, ...ZONES([420, 1260, 980, 380, 80]), strain: 9.6, strainPct: 9.6 / 21, effortLabel: 'Sedang' } },
  },
  {
    key: 'gym.logged',
    kind: 'gym',
    label: 'Watch session merged with a strength log: volume, sets, reps',
    data: {
      run: { sport: 'Latihan kekuatan', kind: 'other', category: 'gym', startedAt: Date.UTC(2026, 9, 17, 23, 0), movingSec: 3480, hrAvg: 112, hrMax: 151, kcal: 344, volumeKg: 8420, sets: 18, reps: 142, exercises: 6, hrSeries: wave(48, 112, 20, 23) },
    },
  },
  {
    key: 'cardio.hiit',
    kind: 'cardio',
    label: 'HIIT: duration, heart rate, zones, hard effort',
    data: { run: { sport: 'Latihan interval intensitas tinggi', kind: 'other', category: 'cardio', startedAt: Date.UTC(2026, 9, 22, 23, 0), movingSec: 1820, hrAvg: 149, hrMax: 182, kcal: 312, ...ZONES([120, 240, 520, 640, 300]), strain: 13.1, strainPct: 13.1 / 21, effortLabel: 'Berat' } },
  },
  {
    key: 'cardio.rope',
    kind: 'cardio',
    label: 'Jump rope: jumps as the hero, no zones',
    data: { run: { sport: 'Lompat tali', kind: 'other', category: 'cardio', startedAt: Date.UTC(2026, 9, 26, 23, 0), movingSec: 900, hrAvg: 156, hrMax: 179, kcal: 168, jumps: 1420 } },
  },
  {
    key: 'flow.yoga',
    kind: 'flow',
    label: 'Yoga with a heart rate trace',
    data: { run: { sport: 'Yoga', kind: 'other', category: 'flow', startedAt: Date.UTC(2026, 9, 23, 23, 0), movingSec: 3600, hrAvg: 92, hrMax: 118, kcal: 176, hrSeries: wave(48, 92, 8, 24), ...ZONES([2400, 900, 300, 0, 0]), strain: 3.2, strainPct: 3.2 / 21, effortLabel: 'Ringan' } },
  },
  {
    key: 'flow.sparse',
    kind: 'flow',
    label: 'Stretching: only a duration',
    data: { run: { sport: 'Peregangan', kind: 'other', category: 'flow', startedAt: Date.UTC(2026, 9, 18, 13, 0), movingSec: 900 } },
  },
  {
    key: 'court.badminton',
    kind: 'court',
    label: 'Badminton: duration, heart rate, zones, steps and distance covered',
    data: {
      run: { sport: 'Bulu tangkis', kind: 'other', category: 'court', startedAt: Date.UTC(2026, 9, 24, 12, 0), movingSec: 4260, distanceM: 3120, hrAvg: 141, hrMax: 176, kcal: 548, steps: 5240, ...ZONES([300, 900, 1500, 1260, 300]), strain: 12.4, strainPct: 12.4 / 21, effortLabel: 'Berat' },
    },
  },
  {
    key: 'court.nohr',
    kind: 'court',
    label: 'Futsal without heart rate',
    data: { run: { sport: 'Sepak bola', kind: 'other', category: 'court', startedAt: Date.UTC(2026, 9, 16, 12, 0), movingSec: 3600, kcal: 610, steps: 7400 } },
  },
];

export const FIXTURES: readonly Fixture[] = [
  { key: 'run.full', kind: 'run', label: 'GPS run with analysis', data: { run: RUN_FULL, milestone: MILESTONE_PR } },
  {
    key: 'run.ride',
    kind: 'run',
    label: 'Ride, speed not pace, no PR',
    data: {
      run: {
        sport: 'Bersepeda',
        kind: 'ride',
        startedAt: Date.UTC(2026, 9, 10, 22, 10),
        movingSec: 5410,
        distanceM: 38_700,
        speedKmh: 25.7,
        hrAvg: 141,
        hrMax: 171,
        kcal: 790,
        elevGainM: 264,
        route: loopRoute(600, 2600, 11),
        altSeries: wave(48, 60, 28, 8),
        paceSeries: wave(48, 25, 5, 9),
        hrSeries: wave(48, 140, 15, 10),
      },
    },
  },
  {
    key: 'run.walk',
    kind: 'run',
    label: 'Out-and-back walk, no HR',
    data: {
      run: {
        sport: 'Jalan',
        kind: 'walk',
        startedAt: Date.UTC(2026, 9, 9, 10, 0),
        movingSec: 2710,
        distanceM: 3180,
        paceSecKm: 852,
        kcal: 160,
        route: lineRoute(260, 3180),
      },
    },
  },
  {
    key: 'run.indoor',
    kind: 'run',
    label: 'Treadmill: no route, no GPS fields',
    data: {
      run: {
        sport: 'Lari treadmill',
        kind: 'run',
        startedAt: Date.UTC(2026, 9, 8, 11, 40),
        movingSec: 1800,
        distanceM: 4500,
        paceSecKm: 400,
        hrAvg: 148,
        hrMax: 166,
        kcal: 340,
        hrZoneSec: [60, 400, 1000, 300, 40],
        hrZonePct: [0.03, 0.22, 0.56, 0.17, 0.02],
        hrZoneLabels: ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'],
        hrZoneColors: HR_ZONE_COLORS,
        hrZoneTop: 3,
      },
    },
  },
  {
    key: 'run.sparse',
    kind: 'run',
    label: 'Only a name and a duration',
    data: { run: { sport: 'Latihan', kind: 'other', startedAt: Date.UTC(2026, 9, 7, 6, 0), movingSec: 1260 } },
  },
  {
    key: 'run.long',
    kind: 'run',
    label: 'Marathon distance, very long gear and sport names',
    data: {
      run: {
        ...RUN_FULL,
        sport: 'Lari trail ultra gunung bromo tengger semeru edisi pagi',
        distanceM: 42_195,
        movingSec: 14_850,
        paceSecKm: 352,
        gear: 'Sepatu: Hoka Speedgoat 6 edisi khusus warna oranye · 1.312 km',
        splitKmh: Array.from({ length: 42 }, (_, i) => 10 + Math.sin(i / 4) * 1.2),
        splitLabels: Array.from({ length: 42 }, (_, i) => String(i + 1)),
        splitFastest: 12,
        route: loopRoute(800, 6400, 5),
      },
      milestone: MILESTONE_PR,
    },
  },
  {
    key: 'run.twosplit',
    kind: 'run',
    label: 'Short run: two splits, speed only, no HR, no route',
    data: {
      run: {
        sport: 'Lari',
        kind: 'run',
        startedAt: Date.UTC(2026, 9, 6, 23, 15),
        movingSec: 740,
        distanceM: 2210,
        paceSecKm: 335,
        splitKmh: [10.4, 11.3],
        splitLabels: ['1', '2'],
        splitFastest: 1,
      },
    },
  },
  {
    key: 'run.midsplit',
    kind: 'run',
    label: '10 K with ten splits',
    data: {
      run: {
        ...RUN_FULL,
        distanceM: 10_050,
        movingSec: 3_480,
        paceSecKm: 346,
        splitKmh: [10.2, 10.6, 10.8, 10.5, 10.4, 10.9, 11.1, 10.7, 10.3, 11.6],
        splitLabels: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
        splitFastest: 9,
        route: loopRoute(700, 900, 21),
      },
    },
  },
  { key: 'strength.full', kind: 'strength', label: 'Push day with two PRs', data: { strength: STRENGTH_FULL, milestone: { kind: 'pr', title: 'Bench press', subtitle: '2 rekor baru', value: 82.5, valueText: '82,5 kg x 5' } } },
  {
    key: 'strength.bodyweight',
    kind: 'strength',
    label: 'Bodyweight only, no PR',
    data: {
      strength: {
        name: 'Calisthenics',
        startedAt: Date.UTC(2026, 9, 6, 9, 0),
        reps: 160,
        sets: 14,
        durationSec: 2400,
        exercises: 4,
        topSets: [
          { exercise: 'Pull-up', load: '12 repetisi' },
          { exercise: 'Push-up', load: '30 repetisi' },
          { exercise: 'Plank', load: '90 dtk' },
        ],
        muscleLabels: ['Punggung', 'Dada', 'Core'],
        muscleSets: [6, 5, 3],
        muscleColors: ['#D4FF3A', '#9DBF2B', '#4D5A2A'],
      },
    },
  },
  {
    key: 'strength.sparse',
    kind: 'strength',
    label: 'A name and a duration only',
    data: { strength: { name: 'Latihan beban', startedAt: Date.UTC(2026, 9, 5, 9, 0), durationSec: 1500 } },
  },
  {
    key: 'strength.long',
    kind: 'strength',
    label: 'Long names',
    data: {
      strength: {
        ...STRENGTH_FULL,
        name: 'Hari dada bahu trisep super panjang bersama teman-teman gym',
        topSets: [
          { exercise: 'Barbell incline bench press with pause at the bottom and a slow tempo', load: '102,5 kg x 5' },
          { exercise: 'Seated dumbbell lateral raise to front raise superset', load: '12,5 kg x 15' },
          { exercise: 'Rope triceps pushdown', load: '35 kg x 12' },
        ],
      },
    },
  },
  {
    key: 'strength.muscles8',
    kind: 'strength',
    label: 'Five-digit volume, 8 muscle groups, 5 top sets, no PR',
    data: {
      strength: {
        name: 'Full body',
        startedAt: Date.UTC(2026, 9, 12, 18, 30),
        volumeKg: 12_450,
        reps: 231,
        sets: 28,
        durationSec: 5400,
        exercises: 9,
        topSets: [
          { exercise: 'Back squat', load: '110 kg x 5' },
          { exercise: 'Romanian deadlift', load: '100 kg x 8' },
          { exercise: 'Bench press', load: '80 kg x 6' },
          { exercise: 'Barbell row', load: '70 kg x 8' },
          { exercise: 'Overhead press', load: '47,5 kg x 6' },
        ],
        muscleLabels: ['Paha depan', 'Paha belakang', 'Dada', 'Punggung', 'Bahu', 'Bisep', 'Trisep', 'Core'],
        muscleSets: [9, 7, 5.5, 5, 4, 2, 1.5, 1],
        muscleColors: ['#D4FF3A', '#C2EA36', '#A9CB30', '#8FAD2D', '#738B2A', '#5B6F29', '#4A5A29', '#3C4A29'],
        avgRpe: 7.5,
      },
    },
  },
  {
    key: 'strength.notops',
    kind: 'strength',
    label: 'Volume and one PR, no top sets, no muscle data',
    data: {
      strength: {
        name: 'Leg day',
        startedAt: Date.UTC(2026, 9, 9, 7, 15),
        volumeKg: 6_180,
        reps: 96,
        sets: 15,
        durationSec: 2820,
        prCount: 1,
      },
      milestone: { kind: 'pr', title: 'Leg day', subtitle: '1 rekor baru', value: 6180, valueText: '6.180 kg' },
    },
  },
  { key: 'sleep.full', kind: 'sleep', label: 'Staged night with watch score', data: { sleep: SLEEP_FULL } },
  {
    key: 'sleep.unstaged',
    kind: 'sleep',
    label: 'No stages, no score',
    data: { sleep: { asleepSec: 23_400, bedtime: Date.UTC(2026, 9, 12, 16, 40), wakeTime: Date.UTC(2026, 9, 12, 23, 40), inBedSec: 25_200, verdict: 'Lumayan' } },
  },
  {
    key: 'sleep.noscore',
    kind: 'sleep',
    label: 'Staged night, the watch gave no score',
    data: { sleep: Object.fromEntries(Object.entries(SLEEP_FULL).filter(([key]) => key !== 'score')) },
  },
  {
    key: 'sleep.short',
    kind: 'sleep',
    label: 'Short staged night, below average, long verdict',
    data: {
      sleep: {
        ...SLEEP_FULL,
        score: 52,
        asleepSec: 17_700,
        deepSec: 2100,
        remSec: 2700,
        lightSec: 12_900,
        awakeSec: 3600,
        deepPct: 0.09,
        remPct: 0.12,
        lightPct: 0.59,
        awakePct: 0.2,
        awakenings: 7,
        vsAvgSec: -5400,
        verdict: 'Kurang tidur sama sekali, ayo tidur lebih awal',
      },
    },
  },
  { key: 'ready.full', kind: 'ready', label: 'Recovery, strain, steps, sleep', data: { ready: READY_FULL, watch: WATCH_FULL } },
  {
    key: 'ready.sparse',
    kind: 'ready',
    label: 'Steps only',
    data: { ready: { steps: 4310 }, watch: { steps: 4310 } },
  },
  {
    key: 'ready.partial',
    kind: 'ready',
    label: 'No recovery or strain: steps with goal, sleep',
    data: {
      ready: { steps: 6200, stepGoal: 8000, stepPct: 0.775, sleepSec: 23_400, sleepPct: 0.81, rhr: 57 },
      watch: { steps: 6200, stepGoal: 8000, stepPct: 0.775, sleepSec: 23_400, sleepPct: 0.81, rhr: 57 },
    },
  },
  {
    key: 'ready.recoveryonly',
    kind: 'ready',
    label: 'Only the recovery percent and a long headline',
    data: { ready: { recovery: 41, headline: 'Terbebani sekali hari ini', headlineKey: 'Strained' }, watch: { recovery: 41 } },
  },
  { key: 'load.full', kind: 'load', label: 'Weekly load', data: { load: LOAD_FULL, week: WEEK_FULL } },
  { key: 'week.full', kind: 'week', label: 'Weekly recap', data: { week: WEEK_FULL, load: LOAD_FULL } },
  {
    key: 'week.sparse',
    kind: 'week',
    label: 'One session this week',
    data: {
      week: {
        rangeStart: Date.UTC(2026, 9, 11, 17),
        rangeEnd: Date.UTC(2026, 9, 18, 16, 59),
        workouts: 1,
        activeDays: 1,
        dayLabels: ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'],
        dayMin: [0, 0, 28, 0, 0, 0, 0],
        movingSec: 1680,
        todayIndex: 2,
      },
    },
  },
  { key: 'plan.full', kind: 'plan', label: 'Coach plan, week 3 of 8', data: { plan: PLAN_FULL, milestone: { kind: 'plan', title: 'Minggu 3 selesai', subtitle: 'Lari 5K', value: 38, unit: '%' } } },
  {
    key: 'plan.sparse',
    kind: 'plan',
    label: 'Fresh plan: no length, no next session',
    data: { plan: { name: 'Rencana lari sepuluh kilometer untuk pemula yang sangat panjang', week: 1, progress: 0, done: 0, total: 12, phase: 'Membangun' } },
  },
  {
    key: 'load.sparse',
    kind: 'load',
    label: 'Strain only, no ratio (no chronic load yet)',
    data: { load: { dayStrain: [0, 6.5, 0, 10.2, 0, 0, 0], dayLabels: ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'], sessions: 2, totalStrain: 16.7 } },
  },
  { key: 'watch.full', kind: 'watch', label: 'Watch-face stats', data: { watch: WATCH_FULL, ready: READY_FULL } },
  {
    key: 'watch.sparse',
    kind: 'watch',
    label: 'Steps only, no goal',
    data: { watch: { steps: 4310 } },
  },
  {
    key: 'watch.partial',
    kind: 'watch',
    label: 'Steps with goal, resting HR and sleep: no strain, no recovery',
    data: { watch: { steps: 6200, stepGoal: 8000, stepPct: 0.775, sleepSec: 23_400, sleepPct: 0.81, rhr: 57 } },
  },
  {
    key: 'badge.distance',
    kind: 'badge',
    label: '100 km total',
    data: { milestone: { kind: 'distance', title: '100 km total', subtitle: 'Jarak yang sudah kamu tempuh', value: 100_000, valueText: '100 km', unit: 'km' }, streak: { days: 12, unit: 'hari berturut-turut', best: 21 } },
  },
  {
    key: 'badge.workouts',
    kind: 'badge',
    label: '50 workouts',
    data: { milestone: { kind: 'workouts', title: '50 latihan', subtitle: 'Sudah kamu catat di JoyoFit', value: 50, valueText: '50 latihan', unit: 'latihan' }, streak: { days: 4, unit: 'hari berturut-turut' } },
  },
  {
    key: 'badge.time',
    kind: 'badge',
    label: '100 hours moving',
    data: { milestone: { kind: 'time', title: '100 jam bergerak', subtitle: 'Waktu aktif kamu sejauh ini', value: 360_000, valueText: '100 jam', unit: 'jam' } },
  },
  {
    key: 'badge.streak',
    kind: 'badge',
    label: '30-day streak',
    data: { milestone: { kind: 'streak', title: '30 hari berturut-turut', subtitle: 'Kamu konsisten, terus jalan', value: 30, valueText: '30 hari', unit: 'hari' }, streak: { days: 30, unit: 'hari berturut-turut', best: 30 } },
  },
  {
    key: 'badge.pr',
    kind: 'badge',
    label: 'Personal record',
    data: { milestone: MILESTONE_PR },
  },
  {
    key: 'badge.plan',
    kind: 'badge',
    label: 'Plan week done (no valueText)',
    data: { milestone: { kind: 'plan', title: 'Minggu 3 selesai', subtitle: 'Lari 5K', value: 38, unit: '%' } },
  },
  {
    key: 'badge.long',
    kind: 'badge',
    label: 'Long lift PR title',
    data: {
      milestone: { kind: 'pr', title: 'Barbell incline bench press with pause', subtitle: 'Rekor pribadi baru yang sangat panjang untuk diuji', value: 102.5, valueText: '102,5 kg x 5' },
      streak: { days: 123, unit: 'hari berturut-turut', best: 150 },
    },
  },
  {
    key: 'badge.first',
    kind: 'badge',
    label: 'First workout',
    data: { milestone: { kind: 'workouts', title: 'Latihan pertama', subtitle: 'Awal yang bagus', value: 1, valueText: '1 latihan', unit: 'latihan' } },
  },
  ...FAMILY_FIXTURES,
  // The Threads carousel: each fixture is a whole subject; the slides are drawn from it as the sheet would (slide 2 of 6).
  ...THREADS_FIXTURES.map((f): Fixture => ({ key: f.key, kind: 'threads', label: f.label, data: slideData(f.subject(), { n: 2, total: 6 }) })),
];

/** Synthetic photos (generated gradients, 1200 x 1800): a dusk sky and a bright daytime sky, the two hard cases for overlay text. */
export const FIXTURE_PHOTOS = {
  dusk: { uri: 'fixture:photo-dusk', width: 1200, height: 1800 },
  day: { uri: 'fixture:photo-day', width: 1200, height: 1800 },
} as const;

export function fixturesOfKind(kind: StickerKind): readonly Fixture[] {
  return FIXTURES.filter((fixture) => fixture.kind === kind);
}
