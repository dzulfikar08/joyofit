import { Platform } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/Screen';
import { NavRow } from '@/components/NavRow';
import { Notice } from '@/components/States';
import type { MenuItem } from '@/features/strength/ui/Sheet';

import type { WorkoutExport } from './useWorkoutExport';
import { saveFlow } from './workoutExport';

/** The sheet's entries: save, share, save elsewhere. The manual Strava upload has its own menu entry (`StravaWorkoutSection`). */
export function useExportItems(exporter: WorkoutExport): MenuItem[] {
  const { t } = useTranslation('workouts');
  const files = saveFlow(Platform.OS) === 'files';
  const { saved } = exporter;
  const item = (action: 'save' | 'share') =>
    exporter.entries
      .filter((entry) => entry.action === action)
      .map(
        ({ format, label }): MenuItem => ({
          key: `${action}-${format}`,
          label,
          icon: action === 'save' ? (files ? 'folder-outline' : 'download-outline') : 'share-outline',
          onPress: () => exporter.run(format, action),
        }),
      );
  return [
    ...item('save'),
    ...item('share'),
    ...(saved ? [{ key: 'folder', label: t('export.otherFolder'), icon: 'folder-open-outline', onPress: () => exporter.run(saved.format, 'save', true) } satisfies MenuItem] : []),
  ];
}

/** One row: ".fit · GPX" with a chevron, opening the export sheet. Free and offline; nothing shows when no file can be built. */
export function WorkoutExportRow({ exporter, onOpen }: { exporter: WorkoutExport; onOpen: () => void }) {
  const { t } = useTranslation('workouts');
  if (exporter.entries.length === 0) return null;
  return (
    <>
      <Card>
        <NavRow
          icon="download-outline"
          tint="workouts"
          title={t('export.title')}
          subtitle={exporter.available.gpx ? t('export.formats') : '.fit'}
          onPress={onOpen}
        />
      </Card>
      {exporter.error ? <Notice tone="danger">{exporter.error}</Notice> : null}
    </>
  );
}
