import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Field } from '@/components/Input';
import { NavRow } from '@/components/NavRow';
import { Card, Screen } from '@/components/Screen';
import { EmptyState, Notice, Skeleton } from '@/components/States';
import { errorMessage } from '@/format';
import { buildCatalog, type Catalog } from '@/features/strength/catalog';
import { MAX_EXERCISES, resolveTimed, routineExercisesOf, type ExerciseInfo } from '@/features/strength/draft';
import {
  addExercises,
  addSet,
  copyRoutine,
  editFromRoutine,
  editSnapshot,
  emptyEdit,
  linkedWithNext,
  hasCustomAmounts,
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  moveExercise,
  nextSortOrder,
  removeExercise,
  removeSet,
  replaceExercise,
  routineFromEdit,
  setExerciseNote,
  setExerciseRest,
  setExerciseTimed,
  toggleSupersetWithNext,
  updateSet,
  validateEdit,
  type EditProblem,
  type EditRoutine,
  type SetPatch,
} from '@/features/strength/routineEdit';
import { getStarterRoutine, isStarterId } from '@/features/strength/starterRoutines';
import {
  customExerciseIndex,
  DEFAULT_SETTINGS,
  listTimedPrefs,
  deleteRoutine,
  getRoutine,
  getStrengthWorkout,
  listFolders,
  listRoutines,
  loadSettings,
  setTimedPref,
  saveRoutine,
} from '@/features/strength/store';
import { SET_TYPES, type Routine, type RoutineFolder, type SetType } from '@/features/strength/types';
import { ExercisePicker } from '@/features/strength/ui/ExercisePicker';
import { RoutineExerciseCard } from '@/features/strength/ui/RoutineExerciseCard';
import { RoutineMenu, type MenuItem } from '@/features/strength/ui/RoutineMenu';
import { shareRoutineFile, shareRoutineText } from '@/features/strength/routineShareIo';
import { useLocale } from '@/i18n';
import { spacing } from '@/theme';

type Params = { id: string; from?: string; copy?: string; folder?: string };

/** What the exercise picker is for: more exercises at the end, or another exercise in place of one. */
type PickerMode = { kind: 'add' } | { kind: 'replace'; key: string };

export default function RoutineEditor() {
  const { id, from, copy, folder } = useLocalSearchParams<Params>();
  const db = useSQLiteContext();
  const router = useRouter();
  const navigation = useNavigation();
  const { t } = useTranslation(['routines', 'strength', 'common']);
  const locale = useLocale();
  const isNew = id === 'new';

  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [base, setBase] = useState<Routine | null>(null);
  const [edit, setEdit] = useState<EditRoutine>(emptyEdit());
  const [initial, setInitial] = useState(() => editSnapshot(emptyEdit()));
  const [folders, setFolders] = useState<RoutineFolder[]>([]);
  const [catalog, setCatalog] = useState<Catalog>(() => buildCatalog([]));
  const [defaultRestSec, setDefaultRestSec] = useState(DEFAULT_SETTINGS.defaultRestSec);
  const [timedPrefs, setTimedPrefs] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [measureAsk, setMeasureAsk] = useState<{ key: string; timed: boolean } | null>(null);
  const [problem, setProblem] = useState<EditProblem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  /** Shares the routine as it is in the editor, saved or not (the edit is what the person sees). */
  const shareCurrent = async (how: 'text' | 'file') => {
    const found = validateEdit(edit);
    if (found) {
      setProblem(found);
      return;
    }
    setShareError(null);
    try {
      const routine = routineFromEdit(base, edit, base?.sortOrder ?? 0, Date.now());
      if (how === 'text') await shareRoutineText(routine, catalog, locale);
      else await shareRoutineFile([routine], routine.name, catalog, locale, null);
    } catch (e) {
      setShareError(errorMessage(e));
    }
  };

  const [picker, setPicker] = useState<PickerMode | null>(null);
  const [exerciseMenu, setExerciseMenu] = useState<string | null>(null);
  const [setTypeMenu, setSetTypeMenu] = useState<{ key: string; index: number } | null>(null);
  const [folderMenu, setFolderMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  // Leaving with unsaved changes asks first: the navigation action is held until the person decides.
  const dirty = status === 'ready' && editSnapshot(edit) !== initial;
  const dirtyRef = useRef(false);
  useLayoutEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  const skipGuard = useRef(false);
  const heldLeave = useRef<(() => void) | null>(null);
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (event) => {
        if (!dirtyRef.current || skipGuard.current) return;
        event.preventDefault();
        heldLeave.current = () => navigation.dispatch(event.data.action);
        setConfirmLeave(true);
      }),
    [navigation],
  );

  const leave = useCallback(() => {
    skipGuard.current = true;
    if (router.canGoBack()) router.back();
    else router.replace('/strength');
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [custom, allFolders, settings, timedSaved] = await Promise.all([customExerciseIndex(db), listFolders(db), loadSettings(db), listTimedPrefs(db)]);
        if (cancelled) return;
        setCatalog(buildCatalog([...custom.values()]));
        setFolders(allFolders);
        setDefaultRestSec(settings.defaultRestSec);
        setTimedPrefs(timedSaved);
        const folderOk = (folderId: string | null | undefined): string | null => (folderId && allFolders.some((f) => f.id === folderId) ? folderId : null);

        if (!isNew) {
          const routine = await getRoutine(db, id);
          if (cancelled) return;
          if (!routine) {
            setStatus('missing');
            return;
          }
          const loaded = editFromRoutine({ ...routine, folderId: folderOk(routine.folderId) });
          setBase(routine);
          setEdit(loaded);
          setInitial(editSnapshot(loaded));
          setStatus('ready');
          return;
        }

        let start = emptyEdit(folderOk(folder));
        if (from) {
          const workout = await getStrengthWorkout(db, from);
          if (workout) start = editFromRoutine({ name: workout.name, folderId: start.folderId, note: '', exercises: routineExercisesOf(workout) });
        } else if (copy) {
          const source = isStarterId(copy) ? getStarterRoutine(copy, locale) : await getRoutine(db, copy);
          if (source) {
            const name = isStarterId(copy) ? source.name : t('routines:duplicateName', { name: source.name });
            start = editFromRoutine({ ...source, name, folderId: folderOk(source.folderId) });
          }
        }
        if (cancelled) return;
        setEdit(start);
        setInitial(editSnapshot(emptyEdit(start.folderId)));
        setStatus('ready');
      } catch (e) {
        if (!cancelled) {
          setError(errorMessage(e));
          setStatus('ready');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // The language only names a starter copied into a new routine, once, when the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, id, from, copy, folder]);

  const reloadCatalog = useCallback(async () => {
    setCatalog(buildCatalog([...(await customExerciseIndex(db)).values()]));
  }, [db]);

  // A new exercise starts the way the person measured it last time (saved by the switch of the logger or this editor), else the library's way.
  const infoOf = (exerciseId: string): ExerciseInfo => ({ exerciseId, timed: timedPrefs.get(exerciseId) ?? catalog.get(exerciseId)?.timed ?? false });
  const nameOf = (exerciseId: string): string => catalog.name(exerciseId, locale) ?? t('routines:row.removedExercise');
  const catalogTimedOf = (exerciseId: string): boolean | null => catalog.get(exerciseId)?.timed ?? null;

  const applyMeasure = (key: string, timed: boolean) => {
    const target = edit.exercises.find((e) => e.key === key);
    if (!target) return;
    change(setExerciseTimed(edit, key, timed, catalogTimedOf(target.exerciseId)));
    void setTimedPref(db, target.exerciseId, timed).then(() => listTimedPrefs(db)).then(setTimedPrefs);
  };
  const askMeasure = (key: string, timed: boolean) => {
    const target = edit.exercises.find((e) => e.key === key);
    if (!target || resolveTimed(target, catalogTimedOf(target.exerciseId)) === timed) return;
    if (hasCustomAmounts(target)) setMeasureAsk({ key, timed });
    else applyMeasure(key, timed);
  };

  const change = (next: EditRoutine) => {
    setEdit(next);
    setProblem(null);
  };

  const pick = (ids: string[]) => {
    const mode = picker;
    setPicker(null);
    if (!mode || ids.length === 0) return;
    if (mode.kind === 'add') change(addExercises(edit, ids.map(infoOf)));
    else change(replaceExercise(edit, mode.key, infoOf(ids[0] as string)));
  };

  const save = async () => {
    const found = validateEdit(edit);
    if (found) {
      setProblem(found);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const order = nextSortOrder(await listRoutines(db));
      const now = Date.now();
      // A routine moved to another folder goes to the end of that folder's list.
      const kept = base && base.folderId === edit.folderId ? base : base ? { ...base, sortOrder: order } : null;
      await saveRoutine(db, routineFromEdit(kept, edit, order, now));
      leave();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const duplicate = async () => {
    const found = validateEdit(edit);
    if (found) {
      setProblem(found);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const order = nextSortOrder(await listRoutines(db));
      const now = Date.now();
      const draft = routineFromEdit(null, edit, order, now);
      const copyOfEdit = copyRoutine(draft, t('routines:duplicateName', { name: draft.name }), draft.folderId, order, now);
      await saveRoutine(db, copyOfEdit);
      skipGuard.current = true;
      router.replace({ pathname: '/strength/routine/[id]', params: { id: copyOfEdit.id } });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!base) return;
    setConfirmDelete(false);
    setBusy(true);
    try {
      await deleteRoutine(db, base);
      leave();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const exerciseItems = (key: string): MenuItem[] => {
    const index = edit.exercises.findIndex((e) => e.key === key);
    const target = edit.exercises[index];
    if (!target) return [];
    const linked = linkedWithNext(edit.exercises, index);
    return [
      { key: 'replace', label: t('routines:editor.menu.replace'), icon: 'swap-horizontal-outline', onPress: () => setPicker({ kind: 'replace', key }) },
      {
        key: 'superset',
        label: linked ? t('routines:editor.menu.splitSuperset') : t('routines:editor.menu.superset'),
        icon: linked ? 'unlink-outline' : 'link-outline',
        disabled: index === edit.exercises.length - 1,
        onPress: () => change(toggleSupersetWithNext(edit, key)),
      },
      { key: 'up', label: t('routines:editor.menu.moveUp'), icon: 'arrow-up', disabled: index === 0, onPress: () => change(moveExercise(edit, key, -1)) },
      { key: 'down', label: t('routines:editor.menu.moveDown'), icon: 'arrow-down', disabled: index === edit.exercises.length - 1, onPress: () => change(moveExercise(edit, key, 1)) },
      ...(target.restSec !== null
        ? [{ key: 'rest', label: t('routines:editor.menu.defaultRest'), icon: 'timer-outline', onPress: () => change(setExerciseRest(edit, key, null)) } satisfies MenuItem]
        : []),
      { key: 'remove', label: t('routines:editor.menu.remove'), icon: 'trash-outline', destructive: true, onPress: () => change(removeExercise(edit, key)) },
    ];
  };

  const setTypeItems = (key: string, index: number): MenuItem[] => {
    const current = edit.exercises.find((e) => e.key === key)?.sets[index]?.type;
    return SET_TYPES.map(
      (type: SetType): MenuItem => ({
        key: type,
        label: t(`strength:setType.${type}`),
        selected: type === current,
        onPress: () => change(updateSet(edit, key, index, { type })),
      }),
    );
  };

  const folderName = folders.find((f) => f.id === edit.folderId)?.name ?? t('routines:move.noFolder');
  const folderItems: MenuItem[] = [
    { key: 'none', label: t('routines:move.noFolder'), icon: 'albums-outline', selected: edit.folderId === null, onPress: () => change({ ...edit, folderId: null }) },
    ...folders.map((f): MenuItem => ({ key: f.id, label: f.name, icon: 'folder-outline', selected: edit.folderId === f.id, onPress: () => change({ ...edit, folderId: f.id }) })),
  ];

  const title = isNew ? t('routines:editor.titleNew') : t('routines:editor.titleEdit');

  if (status !== 'ready') {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        {status === 'missing' ? (
          <EmptyState
            icon="albums-outline"
            title={t('routines:editor.missing.title')}
            description={t('routines:editor.missing.body')}
            action={{ label: t('common:actions.back'), onPress: leave }}
          />
        ) : (
          <Skeleton width="100%" height={160} radius="card" />
        )}
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title }} />

      <Card>
        <Field
          label={t('routines:editor.name')}
          value={edit.name}
          onChangeText={(name) => change({ ...edit, name })}
          placeholder={t('routines:editor.namePlaceholder')}
          maxLength={MAX_NAME_LENGTH}
          returnKeyType="done"
        />
        <NavRow icon="folder-outline" title={t('routines:editor.folder')} value={folderName} onPress={() => setFolderMenu(true)} style={styles.flushRow} />
        <Field
          label={t('routines:editor.note')}
          value={edit.note}
          onChangeText={(note) => change({ ...edit, note })}
          placeholder={t('routines:editor.notePlaceholder')}
          maxLength={MAX_NOTE_LENGTH}
          multiline
          style={styles.noteInput}
        />
      </Card>

      <View style={styles.block}>
        <AppText variant="heading" accessibilityRole="header">
          {t('routines:editor.exercises')}
        </AppText>
        {edit.exercises.length === 0 ? (
          <Card>
            <AppText variant="caption" muted>
              {t('routines:editor.exercisesEmpty')}
            </AppText>
          </Card>
        ) : null}
        {edit.exercises.map((exercise) => (
          <RoutineExerciseCard
            key={exercise.key}
            exercise={exercise}
            name={nameOf(exercise.exerciseId)}
            timed={resolveTimed(exercise, catalogTimedOf(exercise.exerciseId))}
            onMeasure={(timed) => askMeasure(exercise.key, timed)}
            defaultRestSec={defaultRestSec}
            onMenu={() => setExerciseMenu(exercise.key)}
            onNote={(note) => change(setExerciseNote(edit, exercise.key, note))}
            onRest={(restSec) => change(setExerciseRest(edit, exercise.key, restSec))}
            onSetPatch={(index: number, patch: SetPatch) => change(updateSet(edit, exercise.key, index, patch))}
            onSetType={(index) => setSetTypeMenu({ key: exercise.key, index })}
            onAddSet={() => change(addSet(edit, exercise.key))}
            onRemoveSet={(index) => change(removeSet(edit, exercise.key, index))}
          />
        ))}
        <Button
          label={t('routines:editor.addExercise')}
          icon="add"
          disabled={edit.exercises.length >= MAX_EXERCISES}
          onPress={() => setPicker({ kind: 'add' })}
        />
      </View>

      {problem !== null ? <Notice tone="danger">{t(`routines:editor.problem.${problem}`)}</Notice> : null}
      {error !== null ? <Notice tone="danger">{t('routines:editor.saveError', { error })}</Notice> : null}
      {shareError !== null ? <Notice tone="danger">{t('routines:share.error', { error: shareError })}</Notice> : null}

      <Button label={t('routines:editor.save')} variant="primary" icon="checkmark" loading={busy} onPress={() => void save()} />
      {base ? (
        <>
          <ButtonRow>
            <Button label={t('routines:share.text')} icon="share-social-outline" disabled={busy} onPress={() => void shareCurrent('text')} />
            <Button label={t('routines:share.file')} icon="document-outline" disabled={busy} onPress={() => void shareCurrent('file')} />
          </ButtonRow>
          <ButtonRow>
            <Button label={t('routines:editor.duplicate')} icon="copy-outline" disabled={busy} onPress={() => void duplicate()} />
            <Button label={t('routines:editor.delete')} variant="destructive" icon="trash-outline" disabled={busy} onPress={() => setConfirmDelete(true)} />
          </ButtonRow>
        </>
      ) : null}

      <ExercisePicker
        visible={picker !== null}
        onClose={() => setPicker(null)}
        onPick={pick}
        selected={edit.exercises.map((e) => e.exerciseId)}
        multi={picker?.kind !== 'replace'}
        catalog={catalog}
        onCatalogChange={() => void reloadCatalog()}
      />

      <RoutineMenu
        visible={exerciseMenu !== null}
        title={exerciseMenu ? nameOf(edit.exercises.find((e) => e.key === exerciseMenu)?.exerciseId ?? '') : undefined}
        items={exerciseMenu ? exerciseItems(exerciseMenu) : []}
        onClose={() => setExerciseMenu(null)}
      />
      <RoutineMenu
        visible={setTypeMenu !== null}
        title={t('routines:editor.setType')}
        items={setTypeMenu ? setTypeItems(setTypeMenu.key, setTypeMenu.index) : []}
        onClose={() => setSetTypeMenu(null)}
      />
      <RoutineMenu visible={folderMenu} title={t('routines:move.title')} items={folderItems} onClose={() => setFolderMenu(false)} />

      <ConfirmDialog
        visible={confirmDelete}
        title={t('routines:confirmDelete.title', { name: base?.name ?? '' })}
        message={t('routines:confirmDelete.message')}
        confirmLabel={t('routines:confirmDelete.confirm')}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void remove()}
      />
      <ConfirmDialog
        visible={measureAsk !== null}
        title={t('strength:measure.confirmTitle', { measure: measureAsk?.timed ? t('strength:table.time') : t('strength:table.reps') })}
        message={t('strength:measure.confirmMessageRoutine')}
        confirmLabel={t('strength:measure.confirm')}
        cancelLabel={t('strength:measure.cancel')}
        onCancel={() => setMeasureAsk(null)}
        onConfirm={() => {
          const ask = measureAsk;
          setMeasureAsk(null);
          if (ask) applyMeasure(ask.key, ask.timed);
        }}
      />
      <ConfirmDialog
        visible={confirmLeave}
        title={t('routines:editor.discard.title')}
        message={t('routines:editor.discard.message')}
        confirmLabel={t('routines:editor.discard.confirm')}
        cancelLabel={t('routines:editor.discard.keep')}
        onCancel={() => {
          heldLeave.current = null;
          setConfirmLeave(false);
        }}
        onConfirm={() => {
          setConfirmLeave(false);
          skipGuard.current = true;
          heldLeave.current?.();
          heldLeave.current = null;
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.md },
  flushRow: { paddingHorizontal: 0 },
  noteInput: { minHeight: 80, textAlignVertical: 'top', paddingVertical: spacing.sm },
});
