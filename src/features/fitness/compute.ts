import { t } from '@/i18n';
import { buildNights } from '@/features/sleep/nights';
import type { EffortSeconds } from '@/features/workouts/analysis/efforts';
import type { NightHrvAvailability } from '@/features/today/nightHrv';
import { sleepNeedSec } from '@/features/today/readiness';
import { recovery } from '@/features/today/recovery';
import { energyNow, type Energy } from '@/features/fitness/energy';
import { hrvStatus, type HrvStatusState } from '@/features/fitness/hrvStatus';
import { intensityMinutes, mondayOf, type IntensityWeek } from '@/features/fitness/intensityMinutes';
import { predictRaces, type RacePredictions } from '@/features/fitness/racePredictor';
import { recoveryLeft, type RecoveryLeft } from '@/features/fitness/recoveryTime';
import { recentNightsAsleep, sleepNeedTonight, type SleepNeedTonight } from '@/features/fitness/sleepNeed';
import { loadBalance, type LoadBalance } from '@/features/fitness/trainingLoad';
import type { FitnessData } from '@/features/fitness/useFitnessData';
import { vo2maxStatus, type Vo2Status } from '@/features/fitness/vo2max';

const DAY_SEC = 86400;
/** Last night's sleep is the latest night that ended within this long ago. */
const LAST_NIGHT_SEC = 36 * 3600;

export interface DailyFitness {
  energy: Energy | null;
  /** Why there is no Energi Tubuh yet; null when there is one. */
  energyMissing: string | null;
  recovery: RecoveryLeft | null;
  sleepNeed: SleepNeedTonight;
  /** Latest VO2max (the watch's, else the estimate); needs the `full` fitness scope for the 90 days of workouts it looks at. */
  vo2: Vo2Status | null;
}

/** The Today cards: Energi Tubuh, recovery time, the sleep tonight needs and VO2max. */
export function computeDailyFitness(d: FitnessData, availability?: NightHrvAvailability | null): DailyFitness {
  const { nowSec, dayStart } = d;
  const nights = buildNights(d.sleep, []);
  const last = nights.find((n) => !n.nap && n.end <= nowSec && n.end >= nowSec - LAST_NIGHT_SEC) ?? null;
  const yesterday = d.strain.find((s) => s.day === dayStart - DAY_SEC)?.strain ?? null;
  const rec = recovery(d.hrv, nowSec, availability);

  let energy: Energy | null = null;
  const noSleep = t('health:fitness.noSleep');
  let energyMissing: string | null = noSleep;
  if (last) {
    energy = energyNow({
      nowSec,
      wakeSec: last.end,
      asleepSec: last.asleepSeconds,
      needSec: sleepNeedSec(yesterday),
      recoveryZ: 'recovery' in rec ? rec.recovery.z : null,
      maxHr: d.maxHr,
      samples: d.samples,
      stress: d.stress,
      naps: nights.filter((n) => n.nap && n.start >= last.end).map((n) => ({ start: n.start, end: n.end })),
      restingHr: d.resting.get(dayStart) ?? null,
    });
    energyMissing = energy ? null : noSleep;
  }

  return {
    energy,
    energyMissing,
    recovery: recoveryLeft({
      nowSec,
      dayStart,
      workouts: d.workouts.map(({ workout, summary }) => ({ end: workout.end, recoveryHours: summary.recoveryHours })),
      strain: d.strain,
    }),
    sleepNeed: sleepNeedTonight({
      todayStrain: d.strain.find((s) => s.day === dayStart)?.strain ?? null,
      nightsAsleepSec: recentNightsAsleep(d.sleep, nowSec),
    }),
    vo2: vo2Of(d),
  };
}

function vo2Of(d: FitnessData): Vo2Status | null {
  return vo2maxStatus({
    nowSec: d.nowSec,
    dayStart: d.dayStart,
    workouts: d.workouts.map(({ workout, summary }) => ({ start: workout.start, vo2max: summary.vo2max })),
    resting: d.resting,
    maxHr: d.maxHr,
  });
}

export interface FitnessOverview {
  vo2: Vo2Status | null;
  load: LoadBalance;
  races: RacePredictions;
  hrv: HrvStatusState;
  intensity: IntensityWeek;
}

/** The Kebugaran screen. `efforts` are the best efforts of the recent runs (`loadRunEfforts`). */
export function computeFitnessOverview(d: FitnessData, efforts: readonly EffortSeconds[]): FitnessOverview {
  return {
    vo2: vo2Of(d),
    load: loadBalance(d.strain, d.dayStart),
    races: predictRaces(efforts),
    hrv: hrvStatus(d.hrv, d.nowSec),
    intensity: intensityMinutes(d.strain, mondayOf(d.dayStart)),
  };
}
