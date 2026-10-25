/**
 * Made-up readings for the editor's preview, the picker's examples and the screenshots. Never shown as a rider's data: the editor labels
 * them "Contoh" / "Sample". Pure; the instant is fixed so the same call gives the same text.
 */
import { hrZonesForMax } from '@/features/hrzones/zones';
import type { FieldContext } from '../fields/values';
import { fieldValue } from '../fields/values';
import type { FieldId, FieldValue } from '../types';
import type { ElevationPoint } from './elevationGeometry';
import type { LapRowData } from './LapsPage';

/** 07:42 on a Sunday, local time. */
const SAMPLE_NOW = new Date(2026, 9, 18, 7, 42, 0).getTime();

export function sampleContext(): FieldContext {
  return {
    live: {
      status: 'recording',
      movingSec: 3725,
      elapsedSec: 4010,
      distanceM: 24_350,
      hr: 148,
      speedMps: 28.4 / 3.6,
      cadence: 88,
      watts: 205,
      calories: 640,
      lapNumber: 3,
      lapDistanceM: 3200,
      lapMovingSec: 612,
      fixAgeSec: 1,
      fixAccuracyM: 6,
      elevationGainM: 312,
      altitudeM: 148,
    },
    metrics: {
      avgSpeedMps: 24.6 / 3.6,
      maxSpeedMps: 52.1 / 3.6,
      lapAvgSpeedMps: 26 / 3.6,
      avgCadence: 84,
      avgHr: 141,
      maxHr: 171,
      avgPower: 187,
      power3s: 212,
      power10s: 198,
      normPower: 201,
      altitudeM: 412,
      ascentM: 356,
      descentM: 301,
      gradePct: 4.2,
      estPowerW: 196,
    },
    nav: {
      routeId: 'sample',
      distanceDoneM: 8200,
      distanceToFinishM: 18_400,
      etaSec: 2700,
      offCourse: false,
      offCourseM: null,
      nextCue: { cue: { kind: 'right', atM: 8500, lat: 0, lon: 0 }, distanceM: 300 },
      climb: {
        climb: { startM: 7800, endM: 9300, lengthM: 1500, ascentM: 90, avgGradePct: 6, maxGradePct: 11, category: 4 },
        startsInM: 0,
        remainingAscentM: 86,
        remainingM: 1420,
        inProgress: true,
      },
    },
    zones: hrZonesForMax(190),
    ftp: 220,
    batteryPct: 76,
    nowMs: SAMPLE_NOW,
    lapSpeedMps: 26 / 3.6,
  };
}

export function sampleFieldValue(id: FieldId, ctx: FieldContext = sampleContext()): FieldValue {
  return fieldValue(id, ctx);
}

/** A 27 km route with a 1.5 km climb at 7.8 km, for the climb page. */
export function sampleElevation(): ElevationPoint[] {
  const points: ElevationPoint[] = [];
  for (let d = 0; d <= 27_000; d += 300) {
    let alt = 380;
    if (d > 7800) alt += Math.min(d - 7800, 1500) * 0.06;
    if (d > 9300) alt += Math.min(d - 9300, 3000) * -0.008 + Math.sin(d / 900) * 6;
    if (d > 17_000) alt -= (d - 17_000) * 0.01;
    points.push({ distM: d, altM: alt + Math.sin(d / 400) * 3 });
  }
  return points;
}

export function sampleLaps(): LapRowData[] {
  return [
    { number: 1, distanceM: 5000, movingSec: 842, avgHr: 139 },
    { number: 2, distanceM: 5000, movingSec: 797, avgHr: 146 },
  ];
}
