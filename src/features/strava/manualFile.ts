import { Directory, File, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';

import { getWorkout } from '@/db/queries';
import { t } from '@/i18n';
import { manualUploadFile } from '@/features/strava/manualUpload';
import { buildWorkoutFit } from '@/features/strava/workoutFit';

/** The workout's FIT file written for the manual upload: what the page gets, and what "Open in browser" saves or shares. */
export interface WrittenManualFile {
  uri: string;
  name: string;
  bytes: Uint8Array;
  /** The workout's start, the key of its manual upload mark. */
  workoutStart: number;
}

/**
 * Builds the file the API upload sends (`buildWorkoutFit`) and writes it to the cache as `joyofit-<start>.fit`, in a folder of its
 * own so the web view is never handed anything else. The OS may clear the cache; the screen writes it again on every visit.
 */
export async function writeManualUploadFile(db: SQLiteDatabase, workoutId: number): Promise<WrittenManualFile> {
  const found = await getWorkout(db, workoutId);
  if (!found) throw new Error(t('common:errors.workoutGone'));
  // One still downloading from the watch has no final numbers yet (`canExportFit`).
  if (!found.workout.complete) throw new Error(t('sharing:strava.downloading'));
  const { fit } = await buildWorkoutFit(db, found.workout, found.summaryJson);
  const { name, bytes } = manualUploadFile(found.workout.start, fit.bytes);
  const folder = new Directory(Paths.cache, 'strava-upload');
  folder.create({ idempotent: true, intermediates: true });
  const file = new File(folder, name);
  file.create({ overwrite: true });
  file.write(bytes);
  return { uri: file.uri, name, bytes, workoutStart: found.workout.start };
}
