import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { NavRow } from '@/components/NavRow';
import { Card, Divider, Screen } from '@/components/Screen';
import { EmptyState, Notice, Skeleton } from '@/components/States';
import { useToast } from '@/components/Toast';
import { errorMessage } from '@/format';
import { buildCatalog, type Catalog } from '@/features/strength/catalog';
import { workoutTotals } from '@/features/strength/calc';
import {
  copyRoutine,
  moveRoutine,
  nextSortOrder,
  parseCollapsed,
  STARTERS_FOLD,
} from '@/features/strength/routineEdit';
import { pickRoutineFile, planImportFromDb, savePlan, shareRoutineFile, shareRoutineText } from '@/features/strength/routineShareIo';
import { getStarterRoutine, starterRoutines } from '@/features/strength/starterRoutines';
import { startStrengthWorkout } from '@/features/strength/start';
import {
  customExerciseIndex,
  deleteFolder,
  deleteRoutine,
  getStrengthMeta,
  listFolders,
  listRoutines,
  listStrengthWorkouts,
  newId,
  saveFolder,
  saveRoutine,
  setStrengthMeta,
} from '@/features/strength/store';
import type { Routine, RoutineFolder, StrengthWorkout } from '@/features/strength/types';
import { ActiveWorkoutBanner } from '@/features/strength/ui/ActiveWorkoutBanner';
import { FolderHeader } from '@/features/strength/ui/RoutineFolderHeader';
import { RoutineList } from '@/features/strength/ui/RoutineList';
import { RoutineMenu, type MenuItem } from '@/features/strength/ui/RoutineMenu';
import { RoutineNameDialog } from '@/features/strength/ui/RoutineNameDialog';
import { RoutineSheet } from '@/features/strength/ui/RoutineSheet';
import { RoutineImportSheet, type ImportState } from '@/features/strength/ui/RoutineImportSheet';
import { RogoImportCard } from '@/features/strength/ui/RogoImportCard';
import { StrengthCloudLine } from '@/features/strength/ui/StrengthCloudLine';
import { fmtDate, fmtDuration, useLocale } from '@/i18n';
import { spacing } from '@/theme';

/** How many finished workouts the home screen lists; the rest is on the history screen. */
const RECENT = 3;

const COLLAPSED_KEY = 'routinesCollapsed';

interface HomeData {
  routines: Routine[];
  folders: RoutineFolder[];
  recent: StrengthWorkout[];
  catalog: Catalog;
  collapsed: string[];
}

async function loadHome(db: SQLiteDatabase): Promise<HomeData> {
  const [routines, folders, recent, custom, saved] = await Promise.all([
    listRoutines(db),
    listFolders(db),
    listStrengthWorkouts(db, RECENT),
    customExerciseIndex(db),
    getStrengthMeta(db, COLLAPSED_KEY),
  ]);
  return { routines, folders, recent, catalog: buildCatalog([...custom.values()]), collapsed: parseCollapsed(saved, routines.length > 0) };
}

type FolderDialog = { mode: 'new' } | { mode: 'rename'; folder: RoutineFolder };

export default function StrengthHome() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation('routines');
  const locale = useLocale();
  const { toast, show } = useToast();

  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ id: string } | null>(null);
  const [moving, setMoving] = useState<Routine | null>(null);
  const [deleting, setDeleting] = useState<Routine | null>(null);
  const [folderMenu, setFolderMenu] = useState<RoutineFolder | null>(null);
  const [folderDialog, setFolderDialog] = useState<FolderDialog | null>(null);
  const [folderDeleting, setFolderDeleting] = useState<RoutineFolder | null>(null);
  const [importing, setImporting] = useState<ImportState | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setData(await loadHome(db));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const starters = useMemo(() => starterRoutines(locale), [locale]);

  const sheetRoutine = useMemo<Routine | null>(() => {
    if (!sheet) return null;
    return getStarterRoutine(sheet.id, locale) ?? data?.routines.find((r) => r.id === sheet.id) ?? null;
  }, [sheet, data, locale]);
  const sheetIsStarter = sheet !== null && sheet.id.startsWith('builtin:');

  /** Share and import problems show in the same notice as a read error; closing the share sheet is not one. */
  const shareSafely = async (work: () => Promise<void>) => {
    try {
      await work();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const pickImport = async () => {
    try {
      const picked = await pickRoutineFile();
      if (!picked.ok) {
        if (picked.reason === 'unreadable') setImporting({ fileName: '', error: 'unreadable' });
        return;
      }
      if (!picked.result.ok) {
        setImporting({ fileName: picked.name, error: picked.result.error });
        return;
      }
      setImporting({ fileName: picked.name, plan: await planImportFromDb(db, picked.result.file) });
    } catch {
      setImporting({ fileName: '', error: 'unreadable' });
    }
  };

  const confirmImport = async () => {
    if (!importing || !('plan' in importing)) return;
    setImportBusy(true);
    try {
      await savePlan(db, importing.plan);
      setImporting(null);
      show(t('share.import.done', { count: importing.plan.routines.length }));
      await refresh();
    } catch (e) {
      setImporting({ fileName: importing.fileName, error: 'unreadable' });
      setError(errorMessage(e));
    } finally {
      setImportBusy(false);
    }
  };

  const run = useCallback(
    async (work: () => Promise<void>) => {
      try {
        await work();
        await refresh();
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [refresh],
  );

  const openRoutine = useCallback((routine: Routine) => setSheet({ id: routine.id }), []);
  const startRoutine = useCallback((routine: Routine) => {
    setSheet(null);
    startStrengthWorkout({ routineId: routine.id });
  }, []);

  const isCollapsed = (key: string) => data?.collapsed.includes(key) ?? false;
  const toggle = (key: string) => {
    if (!data) return;
    const next = data.collapsed.includes(key) ? data.collapsed.filter((k) => k !== key) : [...data.collapsed, key];
    setData({ ...data, collapsed: next });
    void setStrengthMeta(db, COLLAPSED_KEY, JSON.stringify(next));
  };

  const copyTo = (source: Routine, name: string, folderId: string | null, message: string) =>
    run(async () => {
      const all = await listRoutines(db);
      await saveRoutine(db, copyRoutine(source, name, folderId, nextSortOrder(all), Date.now()));
      show(message);
    });

  const saveFolderName = (dialog: FolderDialog, name: string) =>
    run(async () => {
      const now = Date.now();
      if (dialog.mode === 'new') {
        const order = (data?.folders ?? []).reduce((max, f) => Math.max(max, f.sortOrder + 1), 0);
        await saveFolder(db, { id: newId('f', now), name, sortOrder: order, updatedAt: now, deletedAt: null });
      } else {
        await saveFolder(db, { ...dialog.folder, name, updatedAt: Math.max(now, dialog.folder.updatedAt + 1) });
      }
    });

  const moveTo = (routine: Routine, folderId: string | null) =>
    run(async () => {
      if (routine.folderId === folderId) return;
      const now = Date.now();
      const all = await listRoutines(db);
      await saveRoutine(db, { ...routine, folderId, sortOrder: nextSortOrder(all), updatedAt: Math.max(now, routine.updatedAt + 1) });
    });

  const moveItems = (routine: Routine): MenuItem[] => [
    {
      key: 'none',
      label: t('move.noFolder'),
      icon: 'albums-outline',
      selected: routine.folderId === null,
      onPress: () => void moveTo(routine, null),
    },
    ...(data?.folders ?? []).map(
      (folder): MenuItem => ({
        key: folder.id,
        label: folder.name,
        icon: 'folder-outline',
        selected: routine.folderId === folder.id,
        onPress: () => void moveTo(routine, folder.id),
      }),
    ),
  ];

  const shift = (routine: Routine, direction: -1 | 1) =>
    run(async () => {
      const changed = moveRoutine(data?.routines ?? [], routine.id, direction, Date.now());
      for (const r of changed) await saveRoutine(db, r);
    });

  const folderMenuItems = (folder: RoutineFolder): MenuItem[] => [
    {
      key: 'new',
      label: t('folder.newRoutineHere'),
      icon: 'add-circle-outline',
      onPress: () => router.push({ pathname: '/strength/routine/[id]', params: { id: 'new', folder: folder.id } }),
    },
    { key: 'rename', label: t('folder.rename'), icon: 'create-outline', onPress: () => setFolderDialog({ mode: 'rename', folder }) },
    {
      key: 'export',
      label: t('share.folder'),
      icon: 'share-social-outline',
      disabled: inFolder(folder).length === 0,
      onPress: () => void shareSafely(() => shareRoutineFile(inFolder(folder), folder.name, data?.catalog ?? buildCatalog([]), locale, folder.name)),
    },
    { key: 'delete', label: t('folder.delete'), icon: 'trash-outline', destructive: true, onPress: () => setFolderDeleting(folder) },
  ];

  const loose = data?.routines.filter((r) => r.folderId === null) ?? [];
  const inFolder = (folder: RoutineFolder) => data?.routines.filter((r) => r.folderId === folder.id) ?? [];
  const empty = data !== null && data.routines.length === 0 && data.folders.length === 0;

  const sheetScope = sheetRoutine && !sheetIsStarter ? (data?.routines ?? []) : [];
  const canMove = (direction: -1 | 1) => sheetRoutine !== null && moveRoutine(sheetScope, sheetRoutine.id, direction, 0).length > 0;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('title') }} />
      <ActiveWorkoutBanner />
      <Button label={t('home.startEmpty')} variant="primary" icon="add" onPress={() => startStrengthWorkout()} />
      <RogoImportCard />
      <StrengthCloudLine />

      {error !== null ? (
        <Notice tone="danger" action={{ label: t('home.retry'), onPress: () => void refresh() }}>
          {t('home.error', { error })}
        </Notice>
      ) : null}

      <View style={styles.block}>
        <AppText variant="heading" accessibilityRole="header">
          {t('home.myRoutines')}
        </AppText>
        <ButtonRow>
          <Button label={t('home.newRoutine')} icon="add" onPress={() => router.push({ pathname: '/strength/routine/[id]', params: { id: 'new' } })} />
          <Button label={t('home.newFolder')} icon="folder-outline" onPress={() => setFolderDialog({ mode: 'new' })} />
        </ButtonRow>
        <Button label={t('share.import.button')} icon="download-outline" onPress={() => void pickImport()} />

        {data === null && error === null ? <RoutineSkeletons /> : null}

        {empty ? (
          <Card>
            <EmptyState
              icon="albums-outline"
              title={t('home.empty.title')}
              description={t('home.empty.body')}
              action={{ label: t('home.newRoutine'), icon: 'add', onPress: () => router.push({ pathname: '/strength/routine/[id]', params: { id: 'new' } }) }}
            />
          </Card>
        ) : null}

        {data
          ? data.folders.map((folder) => {
              const routines = inFolder(folder);
              const folded = isCollapsed(folder.id);
              return (
                <View key={folder.id} style={styles.group}>
                  <FolderHeader title={folder.name} count={routines.length} collapsed={folded} onToggle={() => toggle(folder.id)} onMenu={() => setFolderMenu(folder)} />
                  {folded ? null : routines.length > 0 ? (
                    <RoutineList routines={routines} catalog={data.catalog} onOpen={openRoutine} onStart={startRoutine} />
                  ) : (
                    <Card>
                      <AppText variant="caption" muted>
                        {t('folder.empty')}
                      </AppText>
                    </Card>
                  )}
                </View>
              );
            })
          : null}

        {data && loose.length > 0 ? (
          <View style={styles.group}>
            {data.folders.length > 0 ? (
              <AppText variant="label" muted>
                {t('home.noFolder')}
              </AppText>
            ) : null}
            <RoutineList routines={loose} catalog={data.catalog} onOpen={openRoutine} onStart={startRoutine} />
          </View>
        ) : null}
      </View>

      {data ? (
        <View style={styles.block}>
          <FolderHeader
            title={t('home.starters')}
            count={starters.length}
            icon="sparkles-outline"
            collapsed={isCollapsed(STARTERS_FOLD)}
            onToggle={() => toggle(STARTERS_FOLD)}
          />
          {isCollapsed(STARTERS_FOLD) ? null : (
            <>
              <AppText variant="caption" muted>
                {t('home.startersHint')}
              </AppText>
              <RoutineList routines={starters} catalog={data.catalog} onOpen={openRoutine} onStart={startRoutine} />
            </>
          )}
        </View>
      ) : null}

      <View style={styles.block}>
        <AppText variant="heading" accessibilityRole="header">
          {t('home.recent')}
        </AppText>
        <Card style={styles.flush}>
          {data === null ? (
            <View style={styles.pad}>
              <Skeleton width="100%" height={48} radius="card" />
            </View>
          ) : data.recent.length === 0 ? (
            <View style={styles.pad}>
              <AppText variant="caption" muted>
                {t('home.recentEmpty')}
              </AppText>
            </View>
          ) : (
            data.recent.map((workout, index) => (
              <View key={workout.id}>
                {index > 0 ? <Divider /> : null}
                <NavRow
                  icon="barbell-outline"
                  tint="workouts"
                  title={workout.name.length > 0 ? workout.name : t('home.untitled')}
                  subtitle={t('home.recentMeta', {
                    date: fmtDate(new Date(workout.startedAt), 'weekday', locale),
                    count: workoutTotals(workout).sets,
                    duration: fmtDuration(workout.durationSec, locale),
                  })}
                  onPress={() => router.push({ pathname: '/strength/summary/[id]', params: { id: workout.id } })}
                />
              </View>
            ))
          )}
        </Card>
      </View>

      <Card style={styles.flush}>
        <NavRow icon="calendar-outline" title={t('home.links.history')} onPress={() => router.push('/strength/history')} />
        <Divider />
        <NavRow icon="list-outline" title={t('home.links.exercises')} onPress={() => router.push('/strength/exercises')} />
        <Divider />
        <NavRow icon="body-outline" title={t('home.links.muscles')} onPress={() => router.push('/strength/muscles')} />
        <Divider />
        <NavRow icon="settings-outline" title={t('home.links.settings')} onPress={() => router.push('/strength/settings')} />
      </Card>

      <RoutineSheet
        routine={sheetRoutine}
        starter={sheetIsStarter}
        catalog={data?.catalog ?? buildCatalog([])}
        canMoveUp={canMove(-1)}
        canMoveDown={canMove(1)}
        onClose={() => setSheet(null)}
        onStart={startRoutine}
        onEdit={(r) => {
          setSheet(null);
          router.push({ pathname: '/strength/routine/[id]', params: { id: r.id } });
        }}
        onDuplicate={(r) => {
          setSheet(null);
          void copyTo(r, t('duplicateName', { name: r.name }), r.folderId, t('toast.duplicated'));
        }}
        onMoveToFolder={(r) => {
          setSheet(null);
          setMoving(r);
        }}
        onMoveUp={(r) => void shift(r, -1)}
        onMoveDown={(r) => void shift(r, 1)}
        onDelete={(r) => {
          setSheet(null);
          setDeleting(r);
        }}
        onShare={(r) => {
          setSheet(null);
          void shareSafely(() => shareRoutineText(r, data?.catalog ?? buildCatalog([]), locale));
        }}
        onExportFile={(r) => {
          setSheet(null);
          void shareSafely(() => shareRoutineFile([r], r.name, data?.catalog ?? buildCatalog([]), locale, null));
        }}
        onCopy={(r) => {
          setSheet(null);
          void copyTo(r, r.name, null, t('toast.copied'));
        }}
      />

      <RoutineMenu visible={moving !== null} title={t('move.title')} items={moving ? moveItems(moving) : []} onClose={() => setMoving(null)} />
      <RoutineMenu visible={folderMenu !== null} title={folderMenu?.name} items={folderMenu ? folderMenuItems(folderMenu) : []} onClose={() => setFolderMenu(null)} />

      <RoutineNameDialog
        visible={folderDialog !== null}
        title={folderDialog?.mode === 'rename' ? t('folder.renameTitle') : t('folder.newTitle')}
        placeholder={t('folder.namePlaceholder')}
        confirmLabel={folderDialog?.mode === 'rename' ? t('folder.renameConfirm') : t('folder.newConfirm')}
        initial={folderDialog?.mode === 'rename' ? folderDialog.folder.name : ''}
        onCancel={() => setFolderDialog(null)}
        onConfirm={(name) => {
          const dialog = folderDialog;
          setFolderDialog(null);
          if (dialog) void saveFolderName(dialog, name);
        }}
      />

      <ConfirmDialog
        visible={deleting !== null}
        title={t('confirmDelete.title', { name: deleting?.name ?? '' })}
        message={t('confirmDelete.message')}
        confirmLabel={t('confirmDelete.confirm')}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const routine = deleting;
          setDeleting(null);
          if (routine) void run(() => deleteRoutine(db, routine));
        }}
      />

      <ConfirmDialog
        visible={folderDeleting !== null}
        title={t('folder.confirmDelete.title', { name: folderDeleting?.name ?? '' })}
        message={t('folder.confirmDelete.message')}
        confirmLabel={t('folder.confirmDelete.confirm')}
        onCancel={() => setFolderDeleting(null)}
        onConfirm={() => {
          const folder = folderDeleting;
          setFolderDeleting(null);
          if (folder) void run(() => deleteFolder(db, folder));
        }}
      />
      {toast}
      <RoutineImportSheet state={importing} busy={importBusy} onConfirm={() => void confirmImport()} onClose={() => setImporting(null)} />
    </Screen>
  );
}

function RoutineSkeletons() {
  return (
    <View style={styles.group}>
      <Skeleton width="100%" height={72} radius="card" />
      <Skeleton width="100%" height={72} radius="card" />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.sm },
  group: { gap: spacing.sm },
  flush: { padding: 0, gap: 0, overflow: 'hidden' },
  pad: { padding: spacing.lg },
});
