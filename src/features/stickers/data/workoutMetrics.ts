import type { WorkoutAnalysis } from '@/features/workouts/analysis/types';
import type { WorkoutSummary } from '@/features/workouts/summary';

import type { JsonObject } from '../subject';

const MAX_PACE_SEC = 3600;

/**
 * Extracts comprehensive secondary performance and load metrics from workout summaries,
 * sensor records, and analysis structures into `out` (`run.*`).
 */
export function extractWorkoutMetrics(
  summary: WorkoutSummary,
  analysis: WorkoutAnalysis | null,
  movingSec: number,
  jumps: number | null,
  out: JsonObject,
): void {
  // Max speed (m/s -> km/h from summary or analysis)
  const analysisSpd =
    typeof analysis?.stats.maxSpeedMs === 'number' && analysis.stats.maxSpeedMs > 0
      ? analysis.stats.maxSpeedMs
      : null;
  const ms = typeof summary.maxSpeed === 'number' && summary.maxSpeed > 0 ? summary.maxSpeed : analysisSpd;
  if (ms !== null) out.maxSpeedKmh = Math.round(ms * 36) / 10;

  // Best / fastest pace (seconds per km)
  const fastPace = summary.paceFastestSecPerKm ?? summary.minPaceSecPerKm;
  if (fastPace !== undefined && fastPace > 0 && fastPace <= MAX_PACE_SEC) {
    out.paceFastestSec = Math.round(fastPace);
  }

  // Elevation descent / loss (m)
  const elevLoss = summary.elevationLoss ?? analysis?.elevation?.lossM;
  if (elevLoss !== undefined && elevLoss >= 1) out.elevLossM = Math.round(elevLoss);

  // Average stride / step length (converted to cm)
  const stepLen = summary.avgStepLengthM ?? (summary.samples?.avgStepLength ? summary.samples.avgStepLength / 100 : null);
  if (stepLen !== null && stepLen !== undefined && stepLen > 0) out.stepLengthCm = Math.round(stepLen * 100);

  // Jump rope specifics
  if (summary.longestStreak !== undefined && summary.longestStreak > 0) {
    out.longestStreak = summary.longestStreak;
  }
  if (summary.interruptions !== undefined && summary.interruptions > 0) {
    out.interruptions = summary.interruptions;
  }
  if (jumps !== null && jumps > 0 && movingSec > 0) {
    out.jumpRate = Math.round((jumps / movingSec) * 60);
  }

  // Physiological heart rate & training load
  if (summary.minHr !== undefined && summary.minHr > 0) out.minHr = Math.round(summary.minHr);
  if (summary.aerobicEffect !== undefined && summary.aerobicEffect > 0) {
    out.aerobicEffect = Math.round(summary.aerobicEffect * 10) / 10;
  }
  if (summary.anaerobicEffect !== undefined && summary.anaerobicEffect > 0) {
    out.anaerobicEffect = Math.round(summary.anaerobicEffect * 10) / 10;
  }
  if (summary.vo2max !== undefined && summary.vo2max > 0) out.vo2max = Math.round(summary.vo2max);
  if (summary.recoveryHours !== undefined && summary.recoveryHours > 0) {
    out.recoveryHours = Math.round(summary.recoveryHours);
  }
  if (summary.workoutLoad !== undefined && summary.workoutLoad > 0) {
    out.workoutLoad = Math.round(summary.workoutLoad);
  }

  // Power maxima
  const maxPwr = summary.maxPower ?? analysis?.stats.maxPower ?? null;
  if (maxPwr !== null && maxPwr > 0) out.maxPower = Math.round(maxPwr);
}
