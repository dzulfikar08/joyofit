/** Reads the newest walking and running workouts and the profile for `deriveBody`. */
import type { SQLiteDatabase } from 'expo-sqlite';

import { hasUserWeight, userWeightKg } from '@/features/strength/profile';
import { HuaweiWear } from '@/wear';

import { DEFAULT_HEIGHT_CM, deriveBody, SPORT_TYPES, type WorkoutFact } from './body';
import type { BodySources, LoopActivity, LoopBody } from './targets';

const WORKOUT_LIMIT = 80;

/** The body of `activity` from the stored workouts and the profile (Settings > Profile). */
export async function loadBody(db: SQLiteDatabase, activity: LoopActivity): Promise<{ body: LoopBody; sources: BodySources }> {
  const types = SPORT_TYPES[activity];
  const rows = await db.getAllAsync<WorkoutFact>(
    `SELECT sport_type AS sportType, duration, distance, steps FROM workouts
     WHERE complete != 0 AND distance > 0 AND sport_type IN (${types.map(() => '?').join(',')})
     ORDER BY start DESC LIMIT ?`,
    ...types,
    WORKOUT_LIMIT,
  );
  const profile = HuaweiWear.getUserProfile();
  const height = profile?.heightCm;
  return deriveBody(activity, {
    heightCm: typeof height === 'number' && height >= 100 && height <= 230 ? height : DEFAULT_HEIGHT_CM,
    weightKg: userWeightKg(),
    hasWeight: hasUserWeight(),
    workouts: rows,
  });
}
