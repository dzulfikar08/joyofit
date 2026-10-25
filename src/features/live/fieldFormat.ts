import { fmtDecimal, fmtInt } from '@/i18n';
import { formatElapsed } from '@/features/workouts/summary';

import { distanceParts, paceValue } from './liveWorkout';
import type { RunMetricId } from './runFields';

export const FIELD_DASH = '--';

export interface FieldText {
  value: string;
  unit?: string;
}

/** The unit printed after a metric. `foot`: cadence counts steps per minute, else revolutions. */
function unitOf(id: RunMetricId, foot: boolean): string | undefined {
  switch (id) {
    case 'duration':
    case 'hrZone':
    case 'steps':
      return undefined;
    case 'distance':
      return 'km';
    case 'pace':
    case 'avgPace':
      return '/km';
    case 'speed':
      return 'km/h';
    case 'cadence':
      return foot ? 'spm' : 'rpm';
    case 'hr':
    case 'avgHr':
    case 'maxHr':
      return 'bpm';
    case 'calories':
      return 'kcal';
    case 'stride':
    case 'elevationGain':
    case 'altitude':
      return 'm';
  }
}

/** A metric reading as a tile prints it: the number and its unit; `--` for no reading. */
export function formatMetric(id: RunMetricId, value: number | null | undefined, foot: boolean): FieldText {
  const unit = unitOf(id, foot);
  if (value === null || value === undefined || !Number.isFinite(value)) return { value: FIELD_DASH, unit };
  switch (id) {
    case 'duration':
      return { value: formatElapsed(value) };
    case 'distance':
      return distanceParts(value);
    case 'pace':
    case 'avgPace':
      return { value: paceValue(value), unit };
    case 'speed':
      return { value: fmtDecimal(value, 1), unit };
    case 'stride':
      return { value: fmtDecimal(value, 2), unit };
    default:
      return { value: fmtInt(value), unit };
  }
}
