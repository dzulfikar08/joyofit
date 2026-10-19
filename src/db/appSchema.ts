import type { SQLiteDatabase } from 'expo-sqlite';

import { migrate } from '@/db/migrations';
import { ensureCoachSchema } from '@/features/coach/store';
import { ensureCyclingSchema } from '@/features/cycling/store';
import { ensureGearSchema } from '@/features/gear/store';
import { ensureRecordingSchema } from '@/features/record/journal';
import { ensureScaleSchema } from '@/features/scale/store';
import { ensureSensorSchema } from '@/features/sensors/store';
import { ensureStrengthSchema } from '@/features/strength/store';

/** The database file in expo-sqlite's folder. The native writer (`SyncStore.kt`, `SyncStore.swift`) opens the same name. */
export const DATABASE_NAME = 'joyofit.db';

/**
 * Every table the app uses: the shared migrations, then the tables JS creates itself. Opening the database runs it, and the
 * repair (`recovery/env.ts`) runs it on the new file it salvages into, so the two can never differ.
 */
export async function buildAppSchema(db: SQLiteDatabase): Promise<void> {
  await migrate(db);
  await ensureGearSchema(db);
  await ensureStrengthSchema(db);
  await ensureCoachSchema(db);
  await ensureSensorSchema(db);
  await ensureScaleSchema(db);
  await ensureCyclingSchema(db);
  await ensureRecordingSchema(db);
}
