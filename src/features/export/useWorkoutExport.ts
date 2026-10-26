import type { SQLiteDatabase } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';

import { errorMessage } from '@/format';

import { exportWorkoutFile } from './exportWorkoutFile';
import {
  canExportFit,
  canExportGpx,
  exportEntries,
  exportLabelKey,
  type ExportAction,
  type ExportEntry,
  type ExportFormat,
  type ExportPoint,
  type ExportWorkout,
} from './workoutExport';

/** A file the last Save wrote to a folder. */
export interface SavedExport {
  format: ExportFormat;
  name: string;
  folder: string;
}

export interface WorkoutExport {
  /** Which files this workout can be exported as. */
  available: Record<ExportFormat, boolean>;
  /** What to offer on this platform, Save first, with the translated label. */
  entries: (ExportEntry & { label: string })[];
  /** The export being built, if any. */
  busy: { format: ExportFormat; action: ExportAction } | null;
  error: string | null;
  /** Where the last Save went (Android); cleared by the next export. */
  saved: SavedExport | null;
  /** Saves the file to a folder (Android) or opens the share sheet with "Save to Files" (iOS), or shares it. `pickFolder` asks for the folder again. */
  run: (format: ExportFormat, action: ExportAction, pickFolder?: boolean) => void;
}

/** One export state for the screen, shared by the menu entries and the export section. */
export function useWorkoutExport(db: SQLiteDatabase, workout: (ExportWorkout & { id: number }) | null, points: readonly ExportPoint[]): WorkoutExport {
  const [busy, setBusy] = useState<WorkoutExport['busy']>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedExport | null>(null);
  const { t } = useTranslation('workouts');
  const id = workout?.id;

  const run = useCallback(
    (format: ExportFormat, action: ExportAction, pickFolder = false) => {
      if (id === undefined || busy !== null) return;
      setError(null);
      setSaved(null);
      setBusy({ format, action });
      exportWorkoutFile(db, id, format, action, pickFolder)
        .then((outcome) => {
          if (outcome.kind === 'saved') setSaved({ format, name: outcome.name, folder: outcome.folder });
        })
        .catch((e) => setError(errorMessage(e)))
        .finally(() => setBusy(null));
    },
    [db, id, busy],
  );

  const available = { fit: workout !== null && canExportFit(workout), gpx: workout !== null && canExportGpx(workout, points) };
  const entries = useMemo(
    () => exportEntries(Platform.OS, { fit: available.fit, gpx: available.gpx }).map((entry) => ({ ...entry, label: t(exportLabelKey(Platform.OS, entry)) })),
    [available.fit, available.gpx, t],
  );

  return {
    available,
    entries,
    busy,
    error,
    saved,
    run,
  };
}
