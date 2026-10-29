import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Keyboard, KeyboardAvoidingView, ScrollView, StyleSheet, TextInput, Vibration, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PressableScale } from '@/components/PressableScale';
import { LoadingState } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { useToast } from '@/components/Toast';
import { useLocale } from '@/i18n';
import { fontSize, HIT, spacing, useTheme } from '@/theme';

import { afterStrengthSaved } from '@/features/strength/afterSave';
import { buildCatalog, type Catalog } from '@/features/strength/catalog';
import {
  addExercises,
  addSet,
  adjustRest,
  applyEdit,
  draftFromPlan,
  draftFromRoutine,
  draftFromWorkout,
  draftProgress,
  elapsedMs,
  emptyDraft,
  finishDraft,
  hasMeasureValues,
  leaveSuperset,
  makeSuperset,
  moveExercise,
  pauseDraft,
  removeExercise,
  removeSet,
  replaceExercise,
  resolveTimed,
  restFor,
  resumeDraft,
  setExerciseNote,
  setExerciseTimed,
  skipRest,
  toggleSetDone,
  updateSet,
  type PlannedInput,
  type RestContext,
} from '@/features/strength/draft';
import { strengthHr } from '@/features/strength/hrInstance';
import { holdScreenOn, releaseScreen } from '@/features/strength/keepAwake';
import { attachWorkoutRow, detachWorkoutRow, isImported } from '@/features/strength/link';
import {
  clampRestChoice,
  defaultWorkoutName,
  previousAt,
  previousForMeasure,
  REST_CHOICES,
  restLabel,
  RPE_CHOICES,
  rpeText,
  setExerciseRestOrOff,
  supersetLetters,
  timerText,
  type PreviousSet,
} from '@/features/strength/logFormat';
import { userEnergyProfile, userWeightKg } from '@/features/strength/profile';
import { restLiveAllowed, stopRestLive, syncRestLive } from '@/features/strength/restLive';
import {
  cancelRestEnd,
  declineRestPermission,
  requestRestPermission,
  restPermission,
  scheduleRestEnd,
  type RestPermission,
} from '@/features/strength/restNotification';
import { COUNTDOWN_VIBRATION, startSetTimer, timerFinished, timerResultSec, type SetTimer } from '@/features/strength/setTimer';
import { getStarterRoutine } from '@/features/strength/starterRoutines';
import {
  DEFAULT_SETTINGS,
  deleteStrengthWorkout,
  getRoutine,
  getStrengthWorkout,
  lastPerformance,
  listCustomExercises,
  listRestPrefs,
  listTimedPrefs,
  loadDraft,
  loadSettings,
  saveDraft,
  saveWorkout,
  saveSettings,
  setRestPref,
  setTimedPref,
  type StrengthSettings,
} from '@/features/strength/store';
import { plateLoads } from '@/features/strength/plates';
import { getWeightUnit } from '@/features/strength/units';
import type { StrengthDraft, StrengthExercise, StrengthWorkout } from '@/features/strength/types';
import { ExerciseCard, type ExerciseCardActions } from '@/features/strength/ui/ExerciseCard';
import { ExerciseInfoSheet } from '@/features/strength/ui/ExerciseInfoSheet';
import { ExercisePicker } from '@/features/strength/ui/ExercisePicker';
import { PlateSheet } from '@/features/strength/ui/PlateSheet';
import { RestBar, RestOverBanner } from '@/features/strength/ui/RestBar';
import { BottomSheet, MenuSheet, TextPrompt, type MenuItem } from '@/features/strength/ui/Sheet';
import { StrapCard } from '@/features/strength/ui/StrapCard';
import { StrapChip } from '@/features/strength/ui/StrapChip';
import { useStrengthDraft, useTicker } from '@/features/strength/ui/useStrengthDraft';
import { WatchChip, WatchNotice } from '@/features/strength/ui/WatchSession';
import { endStrengthWatch, strengthWatch } from '@/features/strength/watchWorkoutInstance';

const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);
const REST_OVER_MS = 3000;

type Picker = { mode: 'add' } | { mode: 'replace'; key: string } | null;
type Confirm = 'discard' | 'finish' | 'nothing' | 'noSets' | 'leaveEdit' | 'conflict' | 'notify' | null;
interface Flash {
  exerciseKey: string;
  setId: string;
  n: number;
}

/** The workout logger: the screen of a workout in progress, of a new one, or of a finished one being edited. */
export default function ActiveWorkoutScreen() {
  const { t } = useTranslation(['strength', 'coach', 'common']);
  const locale = useLocale();
  const db = useSQLiteContext();
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const { toast, show } = useToast();
  const params = useLocalSearchParams<{
    routineId?: string;
    planKey?: string;
    planned?: string;
    name?: string;
    repeatWorkoutId?: string;
    editWorkoutId?: string;
  }>();
  const editWorkoutId = one(params.editWorkoutId);
  const editing = editWorkoutId !== undefined;

  const handle = useStrengthDraft(!editing);
  const { draft, commit, current, update } = handle;
  const [phase, setPhase] = useState<'loading' | 'ready'>('loading');
  const [original, setOriginal] = useState<StrengthWorkout | null>(null);
  const [initialJson, setInitialJson] = useState('');
  const [settings, setSettings] = useState<StrengthSettings>(DEFAULT_SETTINGS);
  const [prefs, setPrefs] = useState<ReadonlyMap<string, number>>(new Map());
  const [timedPrefs, setTimedPrefs] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [measureFor, setMeasureFor] = useState<{ key: string; timed: boolean } | null>(null);
  const [setTimer, setSetTimer] = useState<SetTimer | null>(null);
  const [catalog, setCatalog] = useState<Catalog>(() => buildCatalog([]));
  const [previous, setPrevious] = useState<Record<string, PreviousSet[]>>({});
  const [flash, setFlash] = useState<Flash | null>(null);
  const [permission, setPermission] = useState<RestPermission>('blocked');
  const [restOver, setRestOver] = useState(false);
  const [busy, setBusy] = useState(false);
  /** The workout is being finished or discarded: its heart rate strap is shutting down and must not be started again. */
  const [closing, setClosing] = useState(false);
  const [nameFocused, setNameFocused] = useState(false);

  const [picker, setPicker] = useState<Picker>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [overflow, setOverflow] = useState(false);
  const [exerciseMenu, setExerciseMenu] = useState<string | null>(null);
  const [setMenu, setSetMenu] = useState<{ key: string; setId: string } | null>(null);
  const [rpeFor, setRpeFor] = useState<{ key: string; setId: string } | null>(null);
  const [restTarget, setRestFor] = useState<string | null>(null);
  const [customRestFor, setCustomRestFor] = useState<string | null>(null);
  const [saveRest, setSaveRest] = useState(false);
  const [infoKey, setInfoKey] = useState<string | null>(null);
  const [platesKey, setPlatesKey] = useState<string | null>(null);
  const [supersetFor, setSupersetFor] = useState<string | null>(null);
  const [notePrompt, setNotePrompt] = useState<'workout' | { key: string } | null>(null);
  const [conflictDraft, setConflictDraft] = useState<StrengthDraft | null>(null);
  const [keyboard, setKeyboard] = useState(false);

  // Refs the stable `actions` object reads, so the cards do not redraw for every state change.
  const settingsRef = useRef(settings);
  const prefsRef = useRef(prefs);
  const timedPrefsRef = useRef(timedPrefs);
  const setTimerRef = useRef(setTimer);
  const previousRef = useRef(previous);
  const catalogRef = useRef(catalog);
  const permissionRef = useRef(permission);
  useLayoutEffect(() => {
    settingsRef.current = settings;
    prefsRef.current = prefs;
    timedPrefsRef.current = timedPrefs;
    setTimerRef.current = setTimer;
    previousRef.current = previous;
    catalogRef.current = catalog;
    permissionRef.current = permission;
  }, [settings, prefs, timedPrefs, setTimer, previous, catalog, permission]);
  const flashCount = useRef(0);
  const started = useRef(false);
  const requested = useRef(new Set<string>());

  const nameOf = useCallback((exerciseId: string) => catalog.name(exerciseId, locale) ?? t('strength:removedExercise'), [catalog, locale, t]);

  const reloadCatalog = useCallback(async () => {
    setCatalog(buildCatalog(await listCustomExercises(db)));
  }, [db]);

  async function createDraft(
    input: { routineId?: string; planKey?: string; plannedJson?: string; repeatId?: string; name?: string },
    now: number,
  ): Promise<StrengthDraft> {
    let draftOut: StrengthDraft | null = null;
    if (input.repeatId) {
      const source = await getStrengthWorkout(db, input.repeatId);
      if (source) draftOut = draftFromWorkout(source, now, true);
    } else if (input.routineId) {
      const routine = input.routineId.startsWith('builtin:') ? getStarterRoutine(input.routineId, locale) : await getRoutine(db, input.routineId);
      if (routine) draftOut = draftFromRoutine(routine, now);
    } else if (input.plannedJson) {
      try {
        const planned = JSON.parse(input.plannedJson) as PlannedInput[];
        if (Array.isArray(planned) && planned.length > 0) draftOut = draftFromPlan(input.planKey ?? '', planned, now, input.name ?? '');
      } catch {
        draftOut = null;
      }
    }
    const base = draftOut ?? emptyDraft(now);
    return { ...base, name: input.name ?? base.name, planKey: input.planKey ?? base.planKey };
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Start: load what is needed, then the draft in progress, the one a caller asks for, or the finished workout to edit
  // -------------------------------------------------------------------------------------------------------------------
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let cancelled = false;
    (async () => {
      const [loadedSettings, loadedPrefs, loadedTimed, custom] = await Promise.all([loadSettings(db), listRestPrefs(db), listTimedPrefs(db), listCustomExercises(db)]);
      if (cancelled) return;
      setSettings(loadedSettings);
      setPrefs(loadedPrefs);
      setTimedPrefs(loadedTimed);
      setCatalog(buildCatalog(custom));
      setPermission(await restPermission(db));

      const now = Date.now();
      if (editWorkoutId) {
        const workout = await getStrengthWorkout(db, editWorkoutId);
        if (cancelled) return;
        if (!workout || workout.deletedAt !== null) {
          router.back();
          return;
        }
        const edit = draftFromWorkout(workout, now, false);
        setOriginal(workout);
        setInitialJson(editFingerprint(edit));
        handle.start(edit);
        setPhase('ready');
        return;
      }

      const routineId = one(params.routineId);
      const planKey = one(params.planKey);
      const plannedJson = one(params.planned);
      const repeatId = one(params.repeatWorkoutId);
      const wantsNew = !!(routineId || planKey || plannedJson || repeatId || one(params.name));
      const existing = await loadDraft(db);
      if (cancelled) return;
      if (existing && !wantsNew) {
        handle.start(existing);
        setPhase('ready');
        return;
      }

      const fresh = await createDraft({ routineId, planKey, plannedJson, repeatId, name: one(params.name) }, now);
      if (cancelled) return;
      if (existing) {
        // A workout is in progress and another one was asked for: the person decides.
        handle.start(existing);
        setConflictDraft(fresh);
        setConfirm('conflict');
      } else {
        handle.start(fresh);
        void handle.flush();
      }
      setPhase('ready');
      router.setParams({ routineId: undefined, planKey: undefined, planned: undefined, name: undefined, repeatWorkoutId: undefined });
    })().catch(() => {
      if (!cancelled) {
        handle.start(emptyDraft(Date.now()));
        setPhase('ready');
      }
    });
    return () => {
      cancelled = true;
      started.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per mount
  }, []);

  // Settings and rest preferences may change in the settings screen opened from the menu.
  useFocusEffect(
    useCallback(() => {
      if (phase !== 'ready') return;
      void loadSettings(db).then(setSettings);
      void listRestPrefs(db).then(setPrefs);
      void listTimedPrefs(db).then(setTimedPrefs);
    }, [db, phase]),
  );

  useEffect(() => {
    const show_ = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(false));
    return () => {
      show_.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    if (phase !== 'ready' || !settings.keepAwake) return;
    void holdScreenOn();
    return () => void releaseScreen();
  }, [phase, settings.keepAwake]);

  // "Previous" of every exercise in the workout, read once per exercise.
  const exerciseIds = draft ? draft.exercises.map((e) => e.exerciseId).join('|') : '';
  useEffect(() => {
    const d = current();
    if (!d) return;
    for (const id of new Set(d.exercises.map((e) => e.exerciseId))) {
      if (requested.current.has(id)) continue;
      requested.current.add(id);
      void lastPerformance(db, id, d.startedAt, d.id).then(
        (found) => {
          if (found) setPrevious((prev) => ({ ...prev, [id]: found.sets }));
        },
        () => undefined,
      );
    }
  }, [db, exerciseIds, current]);

  // The notification that says the rest is over while the app is not in front.
  const rest = draft?.rest ?? null;
  const paused = draft?.pausedAt != null;
  useEffect(() => {
    strengthHr.setPaused(paused);
  }, [paused]);
  useEffect(() => {
    void strengthWatch.setPaused(paused);
  }, [paused]);
  /** The workout the heart rate strap records for: only one in progress, never a finished one being edited. */
  const strapWorkoutId = !editing && !closing && phase === 'ready' && draft ? draft.id : null;
  /** The watch starts Strength training with the workout: a workout in progress, with the setting on. */
  const watchWanted = strapWorkoutId !== null && settings.startOnWatch;
  const restExerciseName = rest && draft ? nameOf(draft.exercises.find((e) => e.key === rest.exerciseKey)?.exerciseId ?? '') : null;
  useEffect(() => {
    if (phase !== 'ready' || editing) return;
    // The live countdown follows the rest (start, +/-15 s, pause) on its own terms: on iOS it needs no notification permission.
    syncRestLive({ active: true, rest, paused, allowed: restLiveAllowed(permission), exerciseName: restExerciseName });
    if (!rest || paused || permission !== 'granted') {
      void cancelRestEnd();
      return;
    }
    void scheduleRestEnd(rest.endsAt, restExerciseName);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new end time or exercise is what reschedules
  }, [phase, editing, rest?.endsAt, rest?.exerciseKey, paused, permission]);

  useEffect(() => {
    if (!restOver) return;
    const id = setTimeout(() => setRestOver(false), REST_OVER_MS);
    return () => clearTimeout(id);
  }, [restOver]);

  // -------------------------------------------------------------------------------------------------------------------
  // Measure (Repetisi / Waktu) and the stopwatch of a timed set
  // -------------------------------------------------------------------------------------------------------------------
  /** Whether an entry is measured in seconds now: its own choice, else the library's flag. */
  const timedOf = useCallback((entry: StrengthExercise) => resolveTimed(entry, catalog.get(entry.exerciseId)?.timed ?? null), [catalog]);

  const applyMeasure = useCallback(
    (key: string, timed: boolean) => {
      const entry = current()?.exercises.find((e) => e.key === key);
      if (!entry) return;
      if (setTimerRef.current?.exerciseKey === key) setSetTimer(null);
      update((d) => setExerciseTimed(d, key, timed, catalogRef.current.get(entry.exerciseId)?.timed ?? null));
      // The choice sticks: the next time this exercise is added it starts that way.
      void setTimedPref(db, entry.exerciseId, timed).then(() => listTimedPrefs(db)).then(setTimedPrefs);
    },
    [current, update, db],
  );

  /** Stores what the stopwatch measured in its set and clears it; a countdown that reached zero also buzzes. */
  const stopSetTimer = useCallback(
    (timer: SetTimer, vibrate: boolean) => {
      setSetTimer(null);
      update((d) => updateSet(d, timer.exerciseKey, timer.setId, { seconds: timerResultSec(timer, Date.now()) }));
      if (vibrate) Vibration.vibrate([...COUNTDOWN_VIBRATION]);
    },
    [update],
  );

  // A countdown ends by itself: checked on a short interval and again when the app comes back to the front. One whose set was removed
  // or replaced meanwhile is dropped without a buzz.
  useEffect(() => {
    if (!setTimer || setTimer.targetSec === null) return;
    const check = () => {
      const alive = current()?.exercises.some((e) => e.key === setTimer.exerciseKey && e.sets.some((s) => s.id === setTimer.setId));
      if (!alive) setSetTimer(null);
      else if (timerFinished(setTimer, Date.now())) stopSetTimer(setTimer, true);
    };
    const id = setInterval(check, 250);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [setTimer, stopSetTimer, current]);

  /** The running stopwatch, unless its set is gone (a stopwatch that counts up and lost its set just stays unseen until the next start). */
  const shownTimer = setTimer && draft?.exercises.some((e) => e.key === setTimer.exerciseKey && e.sets.some((s) => s.id === setTimer.setId)) ? setTimer : null;

  // -------------------------------------------------------------------------------------------------------------------
  // Actions on sets and exercises
  // -------------------------------------------------------------------------------------------------------------------
  const actions = useMemo<ExerciseCardActions>(
    () => ({
      onChange: (key, setId, patch) => update((d) => updateSet(d, key, setId, patch)),
      onToggle: (key, setId) => {
        const running = setTimerRef.current;
        if (running && running.exerciseKey === key && running.setId === setId) stopSetTimer(running, false);
        const d = current();
        const entry = d?.exercises.find((e) => e.key === key);
        if (!d || !entry) return;
        const index = entry.sets.findIndex((s) => s.id === setId);
        const timed = timedOf(entry);
        const before = previousAt(previousRef.current[entry.exerciseId], index);
        const context: RestContext = { defaultRestSec: settingsRef.current.defaultRestSec, autoRest: settingsRef.current.autoRest && !editing, prefs: prefsRef.current };
        const result = toggleSetDone(d, key, setId, Date.now(), context, before ? previousForMeasure({ weightKg: before.weightKg, reps: before.reps, seconds: before.seconds }, timed) : null);
        if (result.refused) {
          flashCount.current += 1;
          setFlash({ exerciseKey: key, setId, n: flashCount.current });
          show(t('strength:toast.needValue'));
          return;
        }
        const next = result.draft.rest && result.draft.rest.totalSec <= 0 ? skipRest(result.draft) : result.draft;
        commit(next);
        if (result.restStarted && next.rest && permissionRef.current === 'ask') setConfirm('notify');
      },
      onMenu: (key, setId) => setSetMenu({ key, setId }),
      onFillPrevious: (key, setId) => {
        const d = current();
        const entry = d?.exercises.find((e) => e.key === key);
        if (!entry) return;
        const before = previousAt(previousRef.current[entry.exerciseId], entry.sets.findIndex((s) => s.id === setId));
        if (before) {
          const { weightKg, reps, seconds } = previousForMeasure(before, timedOf(entry));
          update((x) => updateSet(x, key, setId, { weightKg, reps, seconds }));
        }
      },
      onPickRpe: (key, setId) => setRpeFor({ key, setId }),
      onTimer: (key, setId) => {
        const running = setTimerRef.current;
        const same = running?.exerciseKey === key && running.setId === setId;
        if (running) stopSetTimer(running, false);
        if (same) return;
        const set = current()?.exercises.find((e) => e.key === key)?.sets.find((s) => s.id === setId);
        if (!set || set.done) return;
        setSetTimer(startSetTimer(key, setId, set.seconds, settingsRef.current.countdownTimed, Date.now()));
      },
      onMeasure: (key, timed) => {
        const entry = current()?.exercises.find((e) => e.key === key);
        if (!entry || timedOf(entry) === timed) return;
        if (hasMeasureValues(entry)) setMeasureFor({ key, timed });
        else applyMeasure(key, timed);
      },
      onAddSet: (key) => update((d) => addSet(d, key)),
      onInfo: (key) => setInfoKey(key),
      onNote: (key) => setNotePrompt({ key }),
      onRest: (key) => setRestFor(key),
      onPlates: (key) => setPlatesKey(key),
      onExerciseMenu: (key) => setExerciseMenu(key),
    }),
    // `editing` and the callbacks above are all this reads; everything else comes from refs.
    [update, commit, current, editing, show, t, timedOf, applyMeasure, stopSetTimer],
  );

  const onRestEnded = useCallback(() => {
    update((d) => skipRest(d));
    void cancelRestEnd();
    stopRestLive();
    setRestOver(true);
  }, [update]);

  // -------------------------------------------------------------------------------------------------------------------
  // Leaving the screen: minimize, discard, finish, save an edit
  // -------------------------------------------------------------------------------------------------------------------
  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/strength');
  }, []);

  const minimize = useCallback(async () => {
    if (editing) {
      const d = current();
      const changed = d ? editFingerprint(d) !== initialJson : false;
      if (changed) setConfirm('leaveEdit');
      else leave();
      return;
    }
    await handle.flush();
    leave();
  }, [editing, current, initialJson, handle, leave]);

  const discard = useCallback(async () => {
    setConfirm(null);
    handle.close();
    setClosing(true);
    void strengthHr.end();
    void endStrengthWatch(db);
    await saveDraft(db, null);
    await cancelRestEnd();
    stopRestLive();
    leave();
  }, [handle, db, leave]);

  const finish = useCallback(async () => {
    const d = current();
    if (!d || busy) return;
    setConfirm(null);
    setBusy(true);
    try {
      const now = Date.now();
      const weight = userWeightKg();
      if (editing && original) {
        const edited = applyEdit(original, d, now);
        if (!edited) {
          setConfirm('noSets');
          return;
        }
        const linked = isImported(edited) ? edited : await attachWorkoutRow(db, edited, weight);
        await saveWorkout(db, linked);
        void afterStrengthSaved(db, linked, 'saved');
        handle.close();
        leave();
        return;
      }
      const workout = finishDraft(d, now, defaultWorkoutName(d.startedAt));
      if (!workout) {
        setConfirm('nothing');
        return;
      }
      // The strap's heart rate goes into the logger's own row; a watch workout of the same session wins and drops it (see `link.ts`).
      const linked = await attachWorkoutRow(db, workout, weight, strengthHr.result(workout, userEnergyProfile()));
      await saveWorkout(db, linked);
      handle.close();
      await saveDraft(db, null);
      await cancelRestEnd();
      stopRestLive();
      setClosing(true);
      void strengthHr.end();
      void endStrengthWatch(db);
      void afterStrengthSaved(db, linked, 'saved');
      router.replace(`/strength/summary/${linked.id}?fresh=1`);
    } catch {
      show(t('strength:toast.saveFailed'));
    } finally {
      setBusy(false);
    }
  }, [current, busy, editing, original, db, handle, leave, show, t]);

  const requestFinish = useCallback(() => {
    const d = current();
    if (!d) return;
    const { doneSets, totalSets } = draftProgress(d);
    if (editing) {
      void finish();
    } else if (doneSets === 0) setConfirm('nothing');
    else if (doneSets < totalSets) setConfirm('finish');
    else void finish();
  }, [current, editing, finish]);

  const deleteEdited = useCallback(async () => {
    if (!original) return;
    setConfirm(null);
    setBusy(true);
    try {
      await detachWorkoutRow(db, original);
      await deleteStrengthWorkout(db, original);
      void afterStrengthSaved(db, original, 'deleted');
      handle.close();
      router.replace('/strength');
    } finally {
      setBusy(false);
    }
  }, [original, db, handle]);

  const startConflict = useCallback(async (replaceExisting: boolean) => {
    setConfirm(null);
    const fresh = conflictDraft;
    setConflictDraft(null);
    if (replaceExisting && fresh) {
      await cancelRestEnd();
      stopRestLive();
      requested.current.clear();
      setPrevious({});
      handle.start(fresh);
      void handle.flush();
    }
  }, [conflictDraft, handle]);

  // -------------------------------------------------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------------------------------------------------
  if (phase === 'loading' || !draft) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top + spacing.lg, paddingHorizontal: spacing.lg }]}>
        <LoadingState label={t('strength:active.loading')} />
      </View>
    );
  }

  const letters = supersetLetters(draft.exercises);
  const restContext = { defaultRestSec: settings.defaultRestSec, prefs };
  const menuEntry = draft.exercises.find((e) => e.key === exerciseMenu) ?? null;
  const menuIndex = menuEntry ? draft.exercises.indexOf(menuEntry) : -1;
  const restEntry = draft.exercises.find((e) => e.key === restTarget) ?? null;
  const infoEntry = draft.exercises.find((e) => e.key === infoKey) ?? null;
  const platesEntry = draft.exercises.find((e) => e.key === platesKey) ?? null;
  // Distinct loads of the exercise; the first one still to do (else the last) is the one the sheet opens on.
  const plateWeights = platesEntry ? plateLoads(platesEntry.sets) : [];
  const noteEntry = notePrompt && notePrompt !== 'workout' ? (draft.exercises.find((e) => e.key === notePrompt.key) ?? null) : null;
  const progress = draftProgress(draft);

  const exerciseMenuItems: MenuItem[] = menuEntry
    ? [
        { key: 'replace', label: t('strength:menu.replace'), icon: 'swap-horizontal', onPress: () => setPicker({ mode: 'replace', key: menuEntry.key }) },
        { key: 'note', label: t('strength:menu.note'), icon: 'create-outline', onPress: () => setNotePrompt({ key: menuEntry.key }) },
        { key: 'rest', label: t('strength:menu.rest'), icon: 'timer-outline', onPress: () => setRestFor(menuEntry.key) },
        menuEntry.supersetGroup === null
          ? { key: 'superset', label: t('strength:menu.superset'), icon: 'git-merge-outline', disabled: draft.exercises.length < 2, onPress: () => setSupersetFor(menuEntry.key) }
          : { key: 'leave', label: t('strength:menu.leaveSuperset'), icon: 'git-branch-outline', onPress: () => update((d) => leaveSuperset(d, menuEntry.key)) },
        { key: 'up', label: t('strength:menu.moveUp'), icon: 'arrow-up', disabled: menuIndex <= 0, onPress: () => update((d) => moveExercise(d, menuEntry.key, menuIndex - 1)) },
        { key: 'down', label: t('strength:menu.moveDown'), icon: 'arrow-down', disabled: menuIndex >= draft.exercises.length - 1, onPress: () => update((d) => moveExercise(d, menuEntry.key, menuIndex + 1)) },
        { key: 'remove', label: t('strength:menu.remove'), icon: 'trash-outline', danger: true, onPress: () => update((d) => removeExercise(d, menuEntry.key)) },
      ]
    : [];

  const setEntry = setMenu ? draft.exercises.find((e) => e.key === setMenu.key)?.sets.find((s) => s.id === setMenu.setId) : undefined;
  const setMenuItems: MenuItem[] = setMenu
    ? [
        ...(['normal', 'warmup', 'drop', 'failure'] as const).map(
          (type): MenuItem => ({
            key: type,
            label: t(`strength:setType.${type}`),
            icon: type === 'normal' ? 'ellipse-outline' : type === 'warmup' ? 'flame-outline' : type === 'drop' ? 'trending-down' : 'alert-circle-outline',
            selected: setEntry?.type === type,
            onPress: () => update((d) => updateSet(d, setMenu.key, setMenu.setId, { type })),
          }),
        ),
        { key: 'delete', label: t('strength:setMenu.delete'), icon: 'trash-outline', danger: true, onPress: () => update((d) => removeSet(d, setMenu.key, setMenu.setId)) },
      ]
    : [];

  const supersetItems: MenuItem[] = supersetFor
    ? draft.exercises
        .filter((e) => e.key !== supersetFor)
        .map((e) => ({
          key: e.key,
          label: nameOf(e.exerciseId),
          icon: 'barbell-outline' as const,
          onPress: () =>
            update((d) => {
              const group = e.supersetGroup === null ? [e.key] : d.exercises.filter((x) => x.supersetGroup === e.supersetGroup).map((x) => x.key);
              return makeSuperset(d, [...group, supersetFor]);
            }),
        }))
    : [];

  const overflowItems: MenuItem[] = [
    { key: 'notes', label: t('strength:menu.workoutNote'), icon: 'document-text-outline', onPress: () => setNotePrompt('workout') },
    ...(editing
      ? [{ key: 'delete', label: t('strength:menu.deleteWorkout'), icon: 'trash-outline' as const, danger: true, onPress: () => void deleteEdited() }]
      : [
          { key: 'settings', label: t('strength:menu.settings'), icon: 'settings-outline' as const, onPress: () => router.push('/strength/settings') },
          { key: 'discard', label: t('strength:menu.discard'), icon: 'trash-outline' as const, danger: true, onPress: () => setConfirm('discard') },
        ]),
  ];

  const restSecOf = (e: (typeof draft.exercises)[number]) => restFor(e, restContext);
  const restChoices = restEntry ? [...REST_CHOICES] : [];

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={editing ? t('strength:active.closeEdit') : t('strength:active.minimize')}
          onPress={() => void minimize()}
          style={styles.iconButton}>
          <Ionicons name={editing ? 'close' : 'chevron-down'} size={26} color={colors.foreground} />
        </PressableScale>
        <View style={styles.headerText}>
          {editing ? (
            <AppText variant="caption" muted numberOfLines={1}>
              {t('strength:active.editing', { done: progress.doneSets })}
            </AppText>
          ) : (
            <View style={styles.clockRow}>
              <ElapsedLine draft={draft} progress={progress} />
              <StrapChip workoutId={strapWorkoutId} />
              <WatchChip workoutId={strapWorkoutId} />
            </View>
          )}
        </View>
        {!editing ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={paused ? t('strength:active.resume') : t('strength:active.pause')}
            onPress={() => update((d) => (d.pausedAt === null ? pauseDraft(d, Date.now()) : resumeDraft(d, Date.now())))}
            style={styles.iconButton}>
            <Ionicons name={paused ? 'play' : 'pause'} size={22} color={colors.foreground} />
          </PressableScale>
        ) : null}
        <Button
          label={editing ? t('strength:active.save') : t('strength:active.finish')}
          variant="primary"
          loading={busy}
          onPress={requestFinish}
          style={styles.finish}
        />
        <PressableScale accessibilityRole="button" accessibilityLabel={t('strength:active.more')} onPress={() => setOverflow(true)} style={styles.iconButton}>
          <Ionicons name="ellipsis-vertical" size={22} color={colors.foreground} />
        </PressableScale>
      </View>
      {/* The name gets its own full-width row. On the same row as four buttons the field was only a little wider than a short name, and
          Android scrolled the text under the left edge once the cursor sat at its end ("Iome, dumbbells"). */}
      <View style={styles.nameRow}>
        <TextInput
          accessibilityLabel={t('strength:active.nameLabel')}
          value={draft.name}
          onChangeText={(name) => update((d) => ({ ...d, name }))}
          onFocus={() => setNameFocused(true)}
          onBlur={() => setNameFocused(false)}
          // At rest the caret is parked at the start, so a long name shows its beginning instead of staying scrolled to its end.
          selection={nameFocused ? undefined : { start: 0, end: 0 }}
          placeholder={editing ? original?.name : defaultWorkoutName(draft.startedAt)}
          placeholderTextColor={colors.mutedForeground}
          selectTextOnFocus
          maxLength={60}
          returnKeyType="done"
          style={[styles.nameInput, { color: colors.foreground, fontFamily: fonts.bold }]}
        />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}>
        <StrapCard workoutId={strapWorkoutId} />
        <WatchNotice workoutId={strapWorkoutId} wanted={watchWanted} startedAt={draft.startedAt} />
        {draft.exercises.length === 0 ? (
          <View style={styles.empty}>
            <AppText variant="heading" style={styles.centered}>
              {t('strength:active.emptyTitle')}
            </AppText>
            <AppText variant="caption" muted style={styles.centered}>
              {t('strength:active.emptyBody')}
            </AppText>
          </View>
        ) : null}
        {draft.exercises.map((entry) => {
          const info = catalog.get(entry.exerciseId);
          return (
            <ExerciseCard
              key={entry.key}
              entry={entry}
              name={nameOf(entry.exerciseId)}
              muscles={info ? info.primary.map((m) => t(`coach:muscle.${m}`)).join(', ') : ''}
              timed={timedOf(entry)}
              timer={shownTimer?.exerciseKey === entry.key ? shownTimer : null}
              superset={entry.supersetGroup === null ? null : (letters.get(entry.supersetGroup) ?? null)}
              previous={previous[entry.exerciseId] ?? null}
              restSec={restSecOf(entry)}
              showRpe={settings.showRpe}
              flash={flash?.exerciseKey === entry.key ? flash : null}
              actions={actions}
            />
          );
        })}
        <Button label={t('strength:active.addExercise')} variant="primary" icon="add" onPress={() => setPicker({ mode: 'add' })} />
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('strength:menu.workoutNote')}
          onPress={() => setNotePrompt('workout')}
          scaleTo={0.99}
          style={[styles.noteCard, { backgroundColor: colors.card }]}>
          <AppText variant="label" muted>
            {t('strength:active.notes')}
          </AppText>
          <AppText variant="body" muted={draft.note.length === 0}>
            {draft.note || t('strength:active.notesHint')}
          </AppText>
        </PressableScale>
      </ScrollView>

      {!editing && (rest || restOver) ? (
        <View style={[styles.restArea, { paddingBottom: keyboard ? spacing.sm : insets.bottom + spacing.sm }]}>
          {rest ? (
            <RestBar
              rest={rest}
              pausedAt={draft.pausedAt}
              onAdjust={(delta) => update((d) => adjustRest(d, delta, Date.now()))}
              onSkip={() => {
                update((d) => skipRest(d));
                void cancelRestEnd();
                stopRestLive();
              }}
              onEnded={onRestEnded}
            />
          ) : (
            <RestOverBanner />
          )}
        </View>
      ) : (
        <View style={{ height: keyboard ? 0 : insets.bottom }} />
      )}
      {toast}

      <ExercisePicker
        visible={picker !== null}
        onClose={() => setPicker(null)}
        multi={picker?.mode === 'add'}
        selected={draft.exercises.map((e) => e.exerciseId)}
        catalog={catalog}
        onCatalogChange={() => void reloadCatalog()}
        onPick={(ids) => {
          const target = picker;
          if (!target) return;
          const infos = ids.map((id) => ({ exerciseId: id, timed: timedPrefsRef.current.get(id) ?? catalogRef.current.get(id)?.timed ?? false }));
          if (target.mode === 'replace') {
            const first = infos[0];
            if (setTimerRef.current?.exerciseKey === target.key) setSetTimer(null);
            if (first) update((d) => replaceExercise(d, target.key, first));
          } else {
            update((d) => addExercises(d, infos));
          }
        }}
      />

      <ExerciseInfoSheet exercise={infoEntry ? catalog.get(infoEntry.exerciseId) : null} name={infoEntry ? nameOf(infoEntry.exerciseId) : ''} onClose={() => setInfoKey(null)} />
      <PlateSheet
        visible={platesEntry !== null}
        onClose={() => setPlatesKey(null)}
        weightsKg={plateWeights}
        bar={settings.barWeight[getWeightUnit()]}
        onBarChange={(bar) => {
          const unit = getWeightUnit();
          const next = { ...settings, barWeight: { ...settings.barWeight, [unit]: bar } };
          setSettings(next);
          void saveSettings(db, next);
        }}
      />
      <MenuSheet visible={overflow} onClose={() => setOverflow(false)} items={overflowItems} />
      <MenuSheet visible={menuEntry !== null} onClose={() => setExerciseMenu(null)} title={menuEntry ? nameOf(menuEntry.exerciseId) : undefined} items={exerciseMenuItems} />
      <MenuSheet visible={setMenu !== null} onClose={() => setSetMenu(null)} title={t('strength:setMenu.title')} items={setMenuItems} />
      <MenuSheet visible={supersetFor !== null} onClose={() => setSupersetFor(null)} title={t('strength:menu.supersetWith')} items={supersetItems} />

      <BottomSheet visible={rpeFor !== null} onClose={() => setRpeFor(null)} title={t('strength:rpe.title')}>
        <AppText variant="caption" muted>
          {t('strength:rpe.hint')}
        </AppText>
        <View style={styles.wrap}>
          {RPE_CHOICES.map((value) => (
            <Chip
              key={value}
              label={rpeText(value)}
              selected={rpeFor !== null && draft.exercises.find((e) => e.key === rpeFor.key)?.sets.find((s) => s.id === rpeFor.setId)?.rpe === value}
              onPress={() => {
                if (rpeFor) update((d) => updateSet(d, rpeFor.key, rpeFor.setId, { rpe: value }));
                setRpeFor(null);
              }}
            />
          ))}
        </View>
        <Button
          label={t('strength:rpe.clear')}
          onPress={() => {
            if (rpeFor) update((d) => updateSet(d, rpeFor.key, rpeFor.setId, { rpe: null }));
            setRpeFor(null);
          }}
        />
      </BottomSheet>

      <BottomSheet visible={restEntry !== null} onClose={() => setRestFor(null)} title={restEntry ? t('strength:rest.title', { name: nameOf(restEntry.exerciseId) }) : undefined}>
        <View style={styles.wrap}>
          {restChoices.map((sec) => (
            <Chip
              key={sec}
              label={restLabel(sec)}
              selected={restEntry !== null && restSecOf(restEntry) === sec}
              onPress={() => {
                if (!restEntry) return;
                update((d) => setExerciseRestOrOff(d, restEntry.key, sec));
                if (saveRest) void setRestPref(db, restEntry.exerciseId, sec).then(() => listRestPrefs(db)).then(setPrefs);
                setRestFor(null);
              }}
            />
          ))}
          <Chip label={t('strength:rest.custom')} selected={false} onPress={() => restEntry && setCustomRestFor(restEntry.key)} />
        </View>
        <SwitchRow label={t('strength:rest.save')} hint={t('strength:rest.saveHint')} value={saveRest} onValueChange={setSaveRest} />
        <Button
          label={t('strength:rest.useDefault')}
          onPress={() => {
            if (!restEntry) return;
            update((d) => setExerciseRestOrOff(d, restEntry.key, null));
            if (saveRest) void setRestPref(db, restEntry.exerciseId, null).then(() => listRestPrefs(db)).then(setPrefs);
            setRestFor(null);
          }}
        />
      </BottomSheet>

      <TextPrompt
        visible={customRestFor !== null}
        title={t('strength:rest.customTitle')}
        label={t('strength:rest.customLabel')}
        placeholder="90"
        numeric
        confirmLabel={t('common:actions.save')}
        onClose={() => setCustomRestFor(null)}
        onConfirm={(text) => {
          const key = customRestFor;
          const entry = draft.exercises.find((e) => e.key === key);
          const sec = clampRestChoice(Number(text));
          if (!key || !entry || sec === null) return;
          update((d) => setExerciseRestOrOff(d, key, sec));
          if (saveRest) void setRestPref(db, entry.exerciseId, sec).then(() => listRestPrefs(db)).then(setPrefs);
          setRestFor(null);
        }}
      />

      <TextPrompt
        visible={notePrompt !== null}
        title={notePrompt === 'workout' ? t('strength:menu.workoutNote') : t('strength:menu.note')}
        label={t('strength:active.notes')}
        initial={notePrompt === 'workout' ? draft.note : (noteEntry?.note ?? '')}
        confirmLabel={t('common:actions.save')}
        multiline
        allowEmpty
        onClose={() => setNotePrompt(null)}
        onConfirm={(text) => {
          const target = notePrompt;
          if (target === 'workout') update((d) => ({ ...d, note: text }));
          else if (target) update((d) => setExerciseNote(d, target.key, text));
        }}
      />

      <ConfirmDialog
        visible={measureFor !== null}
        title={t('strength:measure.confirmTitle', { measure: measureFor?.timed ? t('strength:table.time') : t('strength:table.reps') })}
        message={t('strength:measure.confirmMessage')}
        confirmLabel={t('strength:measure.confirm')}
        cancelLabel={t('strength:measure.cancel')}
        onConfirm={() => {
          const target = measureFor;
          setMeasureFor(null);
          if (target) applyMeasure(target.key, target.timed);
        }}
        onCancel={() => setMeasureFor(null)}
      />
      <ConfirmDialog
        visible={confirm === 'discard'}
        title={t('strength:discard.title')}
        message={t('strength:discard.message')}
        confirmLabel={t('strength:discard.confirm')}
        cancelLabel={t('strength:discard.cancel')}
        onConfirm={() => void discard()}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        visible={confirm === 'finish'}
        title={t('strength:finish.partialTitle')}
        message={t('strength:finish.partialMessage', { count: progress.totalSets - progress.doneSets })}
        confirmLabel={t('strength:finish.partialConfirm')}
        cancelLabel={t('strength:finish.keepGoing')}
        onConfirm={() => void finish()}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        visible={confirm === 'nothing'}
        title={t('strength:finish.nothingTitle')}
        message={t('strength:finish.nothingMessage')}
        confirmLabel={t('strength:finish.nothingDiscard')}
        cancelLabel={t('strength:finish.keepGoing')}
        onConfirm={() => void discard()}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        visible={confirm === 'noSets'}
        title={t('strength:edit.noSetsTitle')}
        message={t('strength:edit.noSetsMessage')}
        confirmLabel={t('strength:menu.deleteWorkout')}
        cancelLabel={t('strength:finish.keepGoing')}
        onConfirm={() => void deleteEdited()}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        visible={confirm === 'leaveEdit'}
        title={t('strength:edit.leaveTitle')}
        message={t('strength:edit.leaveMessage')}
        confirmLabel={t('strength:edit.leaveConfirm')}
        cancelLabel={t('strength:finish.keepGoing')}
        onConfirm={() => {
          setConfirm(null);
          handle.close();
          leave();
        }}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        visible={confirm === 'conflict'}
        title={t('strength:conflict.title')}
        message={t('strength:conflict.message')}
        confirmLabel={t('strength:conflict.startNew')}
        cancelLabel={t('strength:conflict.continue')}
        onConfirm={() => void startConflict(true)}
        onCancel={() => void startConflict(false)}
      />
      <ConfirmDialog
        visible={confirm === 'notify'}
        title={t('strength:notification.askTitle')}
        message={t('strength:notification.askMessage')}
        confirmLabel={t('strength:notification.askConfirm')}
        cancelLabel={t('strength:notification.askCancel')}
        onConfirm={() => {
          setConfirm(null);
          void requestRestPermission(db).then((granted) => setPermission(granted ? 'granted' : 'blocked'));
        }}
        onCancel={() => {
          setConfirm(null);
          setPermission('blocked');
          void declineRestPermission(db);
        }}
      />
    </KeyboardAvoidingView>
  );
}

/** What decides "was something changed" when a finished workout is edited: sets and texts, not ids. */
function editFingerprint(d: StrengthDraft): string {
  return JSON.stringify([d.name, d.note, d.exercises.map((e) => [e.exerciseId, e.timed ?? null, e.note, e.sets.map((s) => [s.weightKg, s.reps, s.seconds, s.type, s.rpe, s.done])])]);
}

/** The stopwatch and the sets done, redrawn every second without redrawing the exercises. */
function ElapsedLine({ draft, progress }: { draft: StrengthDraft; progress: { doneSets: number; totalSets: number } }) {
  const { t } = useTranslation('strength');
  const { colors } = useTheme();
  const now = useTicker(draft.pausedAt === null);
  const clock = timerText(elapsedMs(draft, now) / 1000);
  return (
    <AppText variant="caption" muted={draft.pausedAt === null} color={draft.pausedAt === null ? undefined : colors.warning} style={styles.tabular}>
      {draft.pausedAt === null ? clock : t('active.pausedClock', { time: clock })}
      {' - '}
      {t('active.progress', { done: progress.doneSets, total: progress.totalSets })}
    </AppText>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, minHeight: 60 },
  iconButton: { width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, minWidth: 0, paddingLeft: spacing.xs },
  clockRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.sm, rowGap: 2 },
  nameRow: { paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
  nameInput: { fontSize: fontSize.lg, paddingVertical: 0, paddingHorizontal: 0, minHeight: 32 },
  finish: { minHeight: 40, paddingHorizontal: spacing.md },
  scroll: { flex: 1 },
  content: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xxl, gap: spacing.md },
  empty: { paddingVertical: spacing.xl, gap: spacing.xs },
  centered: { textAlign: 'center' },
  noteCard: { borderRadius: 16, padding: spacing.md, gap: 2 },
  restArea: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tabular: { fontVariant: ['tabular-nums'] },
});
