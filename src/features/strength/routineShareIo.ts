/**
 * The device side of sharing routines: the system share sheet, the export file in the cache, the file picker and saving an import.
 * What goes into the text, the file and the plan is the pure `routineShare.ts`.
 */
import * as DocumentPicker from 'expo-document-picker';
import { getDocumentAsync } from '@/documentPicker';
import { File, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Share } from 'react-native';
import ShareFile from 'react-native-share';

import { isShareCancel } from '@/features/stickers/share/shareImage';

import type { Catalog } from './catalog';
import {
  buildRoutineExport,
  exportFileName,
  EXPORT_MIME,
  MAX_EXPORT_CHARS,
  parseRoutineExport,
  planImport,
  routineText,
  serializeRoutineExport,
  type ImportPlan,
  type ParseResult,
} from './routineShare';
import { listFolders, listRoutines, saveCustomExercise, saveFolder, saveRoutine, customExerciseIndex } from './store';
import { buildCatalog } from './catalog';
import type { Routine } from './types';

/** Shares the routine as text through the system sheet. Closing the sheet is not an error. */
export async function shareRoutineText(routine: Routine, catalog: Catalog, locale: 'id' | 'en'): Promise<void> {
  await Share.share({ message: routineText(routine, catalog, locale) });
}

/** Writes `<name>.joyofit-routine.json` to the cache and hands it to the share sheet. `title` names the file (a routine or folder name). */
export async function shareRoutineFile(routines: readonly Routine[], title: string, catalog: Catalog, locale: 'id' | 'en', folder: string | null): Promise<void> {
  const name = exportFileName(title);
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  file.write(serializeRoutineExport(buildRoutineExport(routines, catalog, locale, folder)));
  try {
    await ShareFile.open({ url: file.uri, type: EXPORT_MIME, filename: name, title: name, failOnCancel: false });
  } catch (error) {
    if (!isShareCancel(error)) throw error;
  }
}

export type PickedRoutines = { ok: true; name: string; result: ParseResult } | { ok: false; reason: 'cancelled' | 'unreadable' };

/** The system file picker (any type: other apps often report a `.json` as octet-stream), read and parsed. Nothing is saved. */
export async function pickRoutineFile(): Promise<PickedRoutines> {
  const picked = await getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
  if (picked.canceled || picked.assets.length === 0) return { ok: false, reason: 'cancelled' };
  const asset = picked.assets[0] as DocumentPicker.DocumentPickerAsset;
  try {
    const file = new File(asset.uri);
    if (file.size > MAX_EXPORT_CHARS * 4) return { ok: true, name: asset.name, result: { ok: false, error: { code: 'too-large' } } };
    return { ok: true, name: asset.name, result: parseRoutineExport(await file.text()) };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

/** The plan for a parsed file against what the phone has now. */
export async function planImportFromDb(db: SQLiteDatabase, file: Parameters<typeof planImport>[0]): Promise<ImportPlan> {
  const [routines, folders, custom] = await Promise.all([listRoutines(db), listFolders(db), customExerciseIndex(db)]);
  return planImport(file, { catalog: buildCatalog([...custom.values()]), routines, folders, now: Date.now() });
}

/** Saves a plan: the folder and custom exercises first, then the routines. Only new records are written; none is overwritten. */
export async function savePlan(db: SQLiteDatabase, plan: ImportPlan): Promise<void> {
  if (plan.newFolder) await saveFolder(db, plan.newFolder);
  for (const exercise of plan.newExercises) await saveCustomExercise(db, exercise);
  for (const routine of plan.routines) await saveRoutine(db, routine);
}
