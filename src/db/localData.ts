import { Directory, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';

import { resetSyncedPrefs } from '@/cloud/prefsSync';
import { baselineRecordSync } from '@/cloud/recordSync';
import { loadCoachDoc } from '@/features/coach/store';

import { deleteLocalRows, detachLocalData as detachRows, keepApart as keepApartRows } from './localDataCore';

export { accountSwitchOf, countDirtyStrength, hasLocalData } from './localDataCore';

/** `detachRows` with the app's record baseline: preferences, templates, routes and health records are never sent to the next account either. */
export const detachLocalData = (db: SQLiteDatabase, now?: number): Promise<void> => detachRows(db, now, baselineRecordSync);

/** "Keep separate": the account that signed in takes over the bookkeeping and this phone's data is baselined, or neither happens. */
export const keepApart = (db: SQLiteDatabase, userId: string, email: string): Promise<void> => keepApartRows(db, userId, email, baselineRecordSync);

/** Folders of `Paths.document` that hold the person's files: saved routes (`routeStore.ts`) and gear photos (`gear-edit.tsx`). */
const DATA_FOLDERS = ['routes', 'gear'] as const;

/** Key-value entries that are the person's data: the Coach chat and "how do you feel" answer, the course draft, the loop planner's Home point and choices. Sticker Studio templates are every key under {@link TEMPLATE_PREFIX}. */
const DATA_KEYS = ['joyofit.coach.chat', 'joyofit.coach.feel', 'joyofit.courseDraft.v1', 'joyofit.loops.home', 'joyofit.loops.prefs'] as const;
const TEMPLATE_PREFIX = 'joyofit.stickers.user.';

/**
 * Deletes everything the person made or the cloud restored on this phone, as if the app were new: the database tables of
 * `USER_DATA_TABLES`, the saved route files and gear photos, Sticker Studio templates, Coach chat, every synced preference back
 * to its default, and all sync bookkeeping (cursors, account id, restore flags). The cloud is not touched.
 *
 * Kept on purpose: the watch pairing (`device` rows and the native BLE keys), what a paired watch supports, watch faces, the
 * Strava connection, and settings that belong to the phone (language, theme, Wi-Fi only, automatic sync, notification and
 * Health Connect / Apple Health state, onboarding).
 */
export async function deleteAllLocalData(db: SQLiteDatabase): Promise<void> {
  // Preferences first: if clearing one leaves a sync record behind, the table delete below removes it.
  await resetSyncedPrefs();
  for (const name of DATA_FOLDERS) {
    const folder = new Directory(Paths.document, name);
    if (folder.exists) folder.delete();
  }
  for (const key of Storage.getAllKeysSync()) {
    if (key.startsWith(TEMPLATE_PREFIX) || (DATA_KEYS as readonly string[]).includes(key)) Storage.removeItemSync(key);
  }
  await deleteLocalRows(db);
  // The Coach screens hold the document in memory; hand them the empty one.
  await loadCoachDoc(db);
}
