import type { SQLiteDatabase } from 'expo-sqlite';

import { listDevices } from '@/db/cloud';
import { listWorkoutPoints, type WorkoutPointRow, type WorkoutRow } from '@/db/queries';
import { rideUploadFields } from '@/features/cycling/forStrava';
import { isEbike, rideProfile } from '@/features/cycling/settings';
import { buildFit, type BuiltFit } from '@/features/strava/activityFile';
import { stravaCadenceFields } from '@/features/strava/cadenceFields';
import { listWorkoutRri } from '@/features/sensors/store';
import { stravaDevice, type StravaDevice } from '@/features/strava/device';
import { strengthUploadExtras, type StrengthUploadExtras } from '@/features/strength/share/uploadExtras';
import { workoutElevation } from '@/features/workouts/analysis/elevation';
import { parseSummary, type WorkoutSummary } from '@/features/workouts/summary';

export interface WorkoutFit {
  fit: BuiltFit;
  points: WorkoutPointRow[];
  summary: WorkoutSummary;
  strength: StrengthUploadExtras | null;
  /** The watch that recorded the workout; null for an imported one or a phone recording without a paired watch. */
  device: StravaDevice | null;
}

/**
 * The FIT activity of one stored workout, exactly as the Strava upload sends it: the Strava upload and the "share .fit file"
 * export both build it here, so the file a person shares is the file Strava gets.
 */
export async function buildWorkoutFit(db: SQLiteDatabase, workout: WorkoutRow, summaryJson: string): Promise<WorkoutFit> {
  const points = await listWorkoutPoints(db, workout.id);
  const summary = parseSummary(summaryJson);
  // The ascent and descent the app shows (smoothed, see `elevation.ts`), not the barometer's raw sum.
  const elevation = workoutElevation(workout, summary, points);
  // The watch that recorded it: the one that synced last. A workout imported from a file or an export says nothing about it.
  const watches = workout.imported ? [] : await listDevices(db);
  const watch = watches.sort((a, b) => (b.lastSync ?? 0) - (a.lastSync ?? 0))[0];
  // A strength workout from the logger sends its sets, its own name and a summary of the lifts.
  const strength = await strengthUploadExtras(db, workout.start);
  const ride = rideUploadFields(workout, summary, points, rideProfile());
  const device = stravaDevice(watch);
  // A chest strap's beat-to-beat intervals (phone recordings only), carried as hrv messages for HRV tools.
  const rri = await listWorkoutRri(db, workout.id);
  const fit = buildFit(
    {
      ...workout,
      elevationGain: elevation?.gainM,
      elevationLoss: elevation?.lossM,
      maxSpeed: summary.maxSpeed,
      avgPower: summary.avgPower,
      maxPower: summary.maxPower,
      normalizedPower: summary.normalizedPower,
      ...stravaCadenceFields(workout, summary, points),
      ...ride,
      ebike: isEbike(workout.start),
    },
    points,
    {
      device,
      ...(strength ? { sets: strength.sets } : {}),
      // The laps the person pressed on the phone; a watch's own laps keep going out as one lap, as before.
      ...(summary.source === 'phone' && summary.laps ? { laps: summary.laps } : {}),
      ...(rri.length > 0 ? { rri } : {}),
    },
  );
  return { fit, points, summary, strength, device };
}
