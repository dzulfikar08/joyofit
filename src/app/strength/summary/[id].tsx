import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { HeroGradient } from '@/components/HeroGradient';
import { IconChip } from '@/components/IconChip';
import { NavRow } from '@/components/NavRow';
import { Card, Screen, Section } from '@/components/Screen';
import { EmptyState, Notice, Skeleton } from '@/components/States';
import { StatTile } from '@/components/StatTile';
import { useToast } from '@/components/Toast';
import { loadStoredWorkout } from '@/cloud/workoutAnalysis';
import type { WorkoutRow } from '@/db/queries';
import { fmtDateTime, fmtDecimal, fmtDuration, fmtInt, useLocale } from '@/i18n';
import { spacing, useColors } from '@/theme';

import { afterStrengthSaved } from '@/features/strength/afterSave';
import {
  bestsByExercise,
  findPersonalRecords,
  workoutTotals,
  type PersonalRecord,
  type PrKind,
} from '@/features/strength/calc';
import { buildCatalog, type Catalog } from '@/features/strength/catalog';
import { resolveTimed, routineExercisesOf } from '@/features/strength/draft';
import { detachWorkoutRow } from '@/features/strength/link';
import { DEFAULT_WEIGHT_KG, hasUserWeight } from '@/features/strength/profile';
import { prValueText, previousLabel, rpeText, SET_BADGE, timerText } from '@/features/strength/logFormat';
import { volumeText } from '@/features/strength/ui/liftFormat';
import { useWeightUnit } from '@/features/strength/useWeightUnit';
import { nextSortOrder } from '@/features/strength/routineEdit';
import { startStrengthWorkout } from '@/features/strength/start';
import {
  customExerciseIndex,
  deleteStrengthWorkout,
  getStrengthWorkout,
  listRoutines,
  listStrengthWorkouts,
  newId,
  saveRoutine,
} from '@/features/strength/store';
import type { StrengthWorkout } from '@/features/strength/types';
import { TextPrompt } from '@/features/strength/ui/Sheet';
import { StrengthActions } from '@/features/strength/ui/StrengthActions';
import { useWorkoutStrain } from '@/features/workouts/useWorkoutStrain';
import { WorkoutAnalysisView, useAnalysisT } from '@/features/workouts/analysis/ui';
import { useAnalysisPalette, useMapTheme } from '@/features/workouts/analysis/palette';
import type { WorkoutAnalysis } from '@/features/workouts/analysis/types';
import { parseSummary } from '@/features/workouts/summary';
import { OPEN_IN_STACK } from '@/components/navigation';

interface Loaded {
  workout: StrengthWorkout;
  records: PersonalRecord[];
  catalog: Catalog;
  /** The watch's `workouts` row when the workout was merged with a watch workout. */
  watch: WorkoutRow | null;
  /** The heart rate a strap recorded in the session, kept in the logger's own `workouts` row. */
  strap: StrapRow | null;
}

const PR_KINDS: readonly PrKind[] = ['weight', 'e1rm', 'volume', 'reps', 'time'];

/** A finished workout: totals, records, the sets, and what to do with it. `fresh=1` right after finishing. */
export default function StrengthSummaryScreen() {
  const { t } = useTranslation(['strength', 'common']);
  const locale = useLocale();
  // The unit is read by the formatters; this makes the screen redraw when it changes in Settings.
  useWeightUnit();
  const db = useSQLiteContext();
  const { id, fresh } = useLocalSearchParams<{ id: string; fresh?: string }>();
  const { toast, show } = useToast();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [routinePrompt, setRoutinePrompt] = useState(false);
  const [savingRoutine, setSavingRoutine] = useState(false);
  /** A chart of the analysis is being dragged: the page stops scrolling. */
  const [scrubbing, setScrubbing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const workout = await getStrengthWorkout(db, id);
        if (cancelled) return;
        if (!workout || workout.deletedAt !== null) {
          setMissing(true);
          return;
        }
        const [all, custom, watch, strapRow] = await Promise.all([
          listStrengthWorkouts(db),
          customExerciseIndex(db),
          workout.workoutStart === null
            ? Promise.resolve(null)
            : db.getFirstAsync<WorkoutRow>(
                `SELECT id, workout_number AS workoutNumber, start, "end" AS "end", sport_type AS sportType, sport_name AS sportName, duration, distance,
                        calories, avg_hr AS avgHr, max_hr AS maxHr, steps, complete, imported FROM workouts WHERE start = ? AND imported = 0`,
                workout.workoutStart,
              ),
          workout.workoutStart === null
            ? Promise.resolve(null)
            : db.getFirstAsync<{ id: number; avgHr: number; maxHr: number | null; summary: string }>(
                'SELECT id, avg_hr AS avgHr, max_hr AS maxHr, summary_json AS summary FROM workouts WHERE start = ? AND imported = 1 AND avg_hr IS NOT NULL',
                workout.workoutStart,
              ),
        ]);
        if (cancelled) return;
        const earlier = all.filter((w) => w.id !== workout.id && w.deletedAt === null && w.startedAt < workout.startedAt);
        const summary = strapRow ? parseSummary(strapRow.summary) : null;
        setLoaded({
          workout,
          records: findPersonalRecords(workout, bestsByExercise(earlier)),
          catalog: buildCatalog([...custom.values()]),
          watch: watch ? { ...watch, complete: !!watch.complete, imported: !!watch.imported } : null,
          strap:
            strapRow && summary
              ? { rowId: strapRow.id, avgHr: strapRow.avgHr, maxHr: strapRow.maxHr, minHr: summary.minHr ?? null, sensors: (summary.sensors ?? []).map((s) => s.name) }
              : null,
        });
      })().catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
      return () => {
        cancelled = true;
      };
    }, [db, id]),
  );

  const totals = useMemo(() => (loaded ? workoutTotals(loaded.workout) : null), [loaded]);

  const remove = async () => {
    if (!loaded) return;
    setConfirmDelete(false);
    await detachWorkoutRow(db, loaded.workout);
    await deleteStrengthWorkout(db, loaded.workout);
    void afterStrengthSaved(db, loaded.workout, 'deleted');
    router.replace('/strength');
  };

  const saveAsRoutine = async (name: string) => {
    if (!loaded) return;
    setSavingRoutine(true);
    try {
      const now = Date.now();
      await saveRoutine(db, {
        id: newId('r', now),
        name,
        folderId: null,
        note: '',
        exercises: routineExercisesOf(loaded.workout),
        sortOrder: nextSortOrder(await listRoutines(db)),
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      show(t('strength:summary.routineSaved'));
    } finally {
      setSavingRoutine(false);
    }
  };

  if (missing) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('strength:summary.title') }} />
        <EmptyState
          icon="barbell"
          title={t('strength:summary.missingTitle')}
          description={t('strength:summary.missingBody')}
          action={{ label: t('strength:summary.toHome'), onPress: () => router.replace('/strength') }}
        />
      </Screen>
    );
  }
  if (!loaded || !totals) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('strength:summary.title') }} />
        {error ? (
          <Notice tone="danger">{error}</Notice>
        ) : (
          <>
            <Skeleton width="60%" height={28} />
            <Skeleton width="100%" height={110} radius="tile" />
            <Skeleton width="100%" height={220} radius="card" />
          </>
        )}
      </Screen>
    );
  }

  const { workout, records, catalog, watch, strap } = loaded;
  const nameOf = (exerciseId: string) => catalog.name(exerciseId, locale) ?? t('strength:removedExercise');
  const recordSets = new Set(records.map((r) => r.setId));

  return (
    <View style={styles.root}>
      <Screen scrollEnabled={!scrubbing}>
        <Stack.Screen options={{ title: t('strength:summary.title') }} />
        {fresh === '1' ? <FreshHeader name={workout.name} records={records.length} /> : (
          <View style={styles.titleBlock}>
            <AppText variant="title" accessibilityRole="header">
              {workout.name}
            </AppText>
            <AppText variant="caption" muted>
              {fmtDateTime(new Date(workout.startedAt))}
            </AppText>
          </View>
        )}

        <View style={styles.tiles}>
          <View style={styles.tileRow}>
            <StatTile icon="time-outline" tint="workouts" label={t('strength:summary.duration')} value={fmtDuration(workout.durationSec)} />
            <StatTile icon="barbell-outline" tint="steps" label={t('strength:summary.volume')} value={volumeText(totals.volume)} />
          </View>
          <View style={styles.tileRow}>
            <StatTile icon="layers-outline" tint="link" label={t('strength:summary.sets')} value={fmtInt(totals.sets)} sub={totals.warmupSets > 0 ? t('strength:summary.warmupSets', { count: totals.warmupSets }) : undefined} />
            {/* A workout of holds only has no reps to show: its time takes the tile; with both, the time goes under the reps. */}
            {totals.reps === 0 && totals.seconds > 0 ? (
              <StatTile icon="timer-outline" tint="sleep" label={t('strength:summary.time')} value={timerText(totals.seconds)} />
            ) : (
              <StatTile icon="repeat" tint="sleep" label={t('strength:summary.reps')} value={fmtInt(totals.reps)} sub={totals.seconds > 0 ? timerText(totals.seconds) : undefined} />
            )}
          </View>
          <View style={styles.tileRow}>
            <StatTile icon="list-outline" tint="workouts" label={t('strength:summary.exercises')} value={fmtInt(totals.exercises)} />
            {workout.kcal !== null ? (
              <StatTile
                icon="flame-outline"
                tint="heart"
                label={t('strength:summary.kcal')}
                value={fmtInt(workout.kcal)}
                sub={t(workout.kcalSource === 'watch' ? 'strength:summary.kcalWatch' : workout.kcalSource === 'hr' ? 'strength:summary.kcalHr' : 'strength:summary.kcalEstimate')}
              />
            ) : (
              <View style={styles.tileRow} />
            )}
          </View>
        </View>

        {workout.kcal !== null && workout.kcalSource !== 'watch' && !hasUserWeight() ? (
          <Notice icon="scale-outline" action={{ label: t('strength:summary.kcalWeightAction'), onPress: () => router.push('/settings/profile', OPEN_IN_STACK) }}>
            {t('strength:summary.kcalWeightHint', { kg: DEFAULT_WEIGHT_KG })}
          </Notice>
        ) : null}

        {watch ? <WatchTiles watch={watch} /> : null}
        {strap ? <StrapTiles strap={strap} /> : null}

        {records.length > 0 ? (
          <Section title={t('strength:summary.records')} icon="trophy-outline" tint="workouts">
            {records
              .slice()
              .sort((a, b) => PR_KINDS.indexOf(a.kind) - PR_KINDS.indexOf(b.kind))
              .map((record) => (
                <View key={`${record.exerciseId}-${record.kind}`} style={styles.recordRow}>
                  <IconChip icon="trophy" tint="workouts" size="sm" />
                  <View style={styles.grow}>
                    <AppText variant="bodyStrong" numberOfLines={1}>
                      {nameOf(record.exerciseId)}
                    </AppText>
                    <AppText variant="caption" muted>
                      {t('strength:summary.recordLine', {
                        kind: t(`strength:pr.${record.kind}`),
                        value: prValueText(record.kind, record.value),
                        previous: prValueText(record.kind, record.previous),
                      })}
                    </AppText>
                  </View>
                </View>
              ))}
          </Section>
        ) : null}

        {workout.exercises.map((exercise) => {
          const info = catalog.get(exercise.exerciseId);
          return (
            <Section key={exercise.key} title={nameOf(exercise.exerciseId)}>
              {exercise.note ? (
                <AppText variant="caption" muted>
                  {exercise.note}
                </AppText>
              ) : null}
              {exercise.sets.map((set, index) => (
                <SetLine
                  key={set.id}
                  position={index + 1}
                  type={set.type}
                  text={previousLabel(set, resolveTimed(exercise, info?.timed ?? null)) ?? t('strength:table.dash')}
                  rpe={set.rpe}
                  record={recordSets.has(set.id)}
                />
              ))}
            </Section>
          );
        })}

        {workout.note ? (
          <Section title={t('strength:active.notes')} icon="document-text-outline">
            <AppText variant="body">{workout.note}</AppText>
          </Section>
        ) : null}

        {strap ? <StrapAnalysis rowId={strap.rowId} onScrubActive={setScrubbing} /> : null}

        <StrengthActions workout={workout} catalog={catalog} records={records} />

        <View style={styles.actions}>
          <ButtonRow>
            <Button label={t('common:actions.edit')} icon="create-outline" onPress={() => router.push({ pathname: '/strength/active', params: { editWorkoutId: workout.id } })} />
            <Button label={t('strength:summary.repeat')} icon="refresh" onPress={() => startStrengthWorkout({ repeatWorkoutId: workout.id })} />
          </ButtonRow>
          <Button label={t('strength:summary.saveRoutine')} icon="bookmark-outline" loading={savingRoutine} onPress={() => setRoutinePrompt(true)} />
          <Button label={t('common:actions.delete')} variant="destructive" icon="trash-outline" onPress={() => setConfirmDelete(true)} />
        </View>
      </Screen>
      {toast}
      <TextPrompt
        visible={routinePrompt}
        title={t('strength:summary.routineTitle')}
        label={t('strength:summary.routineName')}
        initial={workout.name}
        confirmLabel={t('common:actions.save')}
        onClose={() => setRoutinePrompt(false)}
        onConfirm={(name) => void saveAsRoutine(name)}
      />
      <ConfirmDialog
        visible={confirmDelete}
        title={t('strength:summary.deleteTitle')}
        message={t('strength:summary.deleteMessage')}
        confirmLabel={t('common:actions.delete')}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </View>
  );
}

function FreshHeader({ name, records }: { name: string; records: number }) {
  const { t } = useTranslation('strength');
  const colors = useColors();
  return (
    <Card style={[styles.fresh, { backgroundColor: colors.hero }]}>
      <HeroGradient />
      <Ionicons name="checkmark-circle" size={44} color={colors.heroAccent} />
      <AppText variant="title" color={colors.heroForeground} style={styles.centered} accessibilityRole="header">
        {t('summary.freshTitle')}
      </AppText>
      <AppText variant="body" color={colors.heroMuted} style={styles.centered}>
        {records > 0 ? t('summary.freshRecords', { count: records, name }) : t('summary.freshBody', { name })}
      </AppText>
    </Card>
  );
}

function WatchTiles({ watch }: { watch: WorkoutRow }) {
  const { t } = useTranslation('strength');
  const strain = useWorkoutStrain(watch);
  return (
    <Section
      title={t('summary.watch')}
      icon="watch-outline"
      tint="heart"
      onPress={() => router.push({ pathname: '/workouts/[id]', params: { id: String(watch.id) } }, OPEN_IN_STACK)}>
      <View style={styles.tileRow}>
        <StatTile icon="heart-outline" tint="heart" label={t('summary.avgHr')} value={watch.avgHr ? fmtInt(watch.avgHr) : t('table.dash')} unit={t('summary.bpm')} />
        <StatTile icon="pulse-outline" tint="heart" label={t('summary.maxHr')} value={watch.maxHr ? fmtInt(watch.maxHr) : t('table.dash')} unit={t('summary.bpm')} />
      </View>
      {strain !== undefined && strain !== null ? (
        <View style={styles.tileRow}>
          <StatTile icon="speedometer-outline" tint="workouts" label={t('summary.strain')} value={fmtDecimal(strain, 1)} />
          <View style={styles.tileRow} />
        </View>
      ) : null}
    </Section>
  );
}

function SetLine({ position, type, text, rpe, record }: { position: number; type: 'normal' | 'warmup' | 'drop' | 'failure'; text: string; rpe: number | null; record: boolean }) {
  const { t } = useTranslation('strength');
  const colors = useColors();
  const badge = SET_BADGE[type];
  return (
    <View style={styles.setLine}>
      <AppText variant="bodyStrong" muted style={styles.setNo}>
        {fmtInt(position)}
      </AppText>
      <AppText variant="body" style={styles.grow}>
        {text}
      </AppText>
      {badge ? (
        <AppText variant="label" color={type === 'warmup' ? colors.warning : type === 'failure' ? colors.destructive : colors.mutedForeground}>
          {t(`setType.${type}`)}
        </AppText>
      ) : null}
      {rpe !== null ? (
        <AppText variant="caption" muted>
          {t('summary.rpe', { value: rpeText(rpe) })}
        </AppText>
      ) : null}
      {record ? <Ionicons name="trophy" size={16} color={colors.warning} accessibilityLabel={t('summary.records')} /> : null}
    </View>
  );
}

/** The row of the logger's own `workouts` entry that carries the strap's heart rate. */
interface StrapRow {
  rowId: number;
  avgHr: number;
  maxHr: number | null;
  minHr: number | null;
  /** The names of the sensors that recorded it. */
  sensors: string[];
}

function StrapTiles({ strap }: { strap: StrapRow }) {
  const { t } = useTranslation('strength');
  return (
    <Section
      title={t('summary.strap')}
      icon="heart-outline"
      tint="heart"
      onPress={() => router.push({ pathname: '/workouts/[id]', params: { id: String(strap.rowId) } }, OPEN_IN_STACK)}>
      {strap.sensors.length > 0 ? (
        <AppText variant="caption" muted>
          {t('summary.strapFrom', { name: strap.sensors.join(', ') })}
        </AppText>
      ) : null}
      <View style={styles.tileRow}>
        <StatTile icon="heart-outline" tint="heart" label={t('summary.avgHr')} value={fmtInt(strap.avgHr)} unit={t('summary.bpm')} />
        <StatTile icon="pulse-outline" tint="heart" label={t('summary.maxHr')} value={strap.maxHr ? fmtInt(strap.maxHr) : t('table.dash')} unit={t('summary.bpm')} />
      </View>
      <View style={styles.tileRow}>
        <StatTile icon="trending-down-outline" tint="heart" label={t('summary.minHr')} value={strap.minHr ? fmtInt(strap.minHr) : t('table.dash')} unit={t('summary.bpm')} />
        <View style={styles.tileRow} />
      </View>
    </Section>
  );
}

/** The workout analysis of the strap's heart rate (curve, zones, strain), the same one the Workouts tab shows for the row. */
function StrapAnalysis({ rowId, onScrubActive }: { rowId: number; onScrubActive: (active: boolean) => void }) {
  const { t } = useTranslation('workouts');
  const db = useSQLiteContext();
  const palette = useAnalysisPalette();
  const mapTheme = useMapTheme();
  const analysisT = useAnalysisT();
  const [state, setState] = useState<{ analysis: WorkoutAnalysis } | { error: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadStoredWorkout(db, rowId).then(
      (stored) => {
        if (!cancelled && stored) setState({ analysis: stored.analysis });
      },
      (e: unknown) => {
        if (!cancelled) setState({ error: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [db, rowId]);
  if (state === null) return <Skeleton width="100%" height={320} radius="card" />;
  if ('error' in state) return <Notice tone="danger">{t('detail.errors.analysis', { message: state.error })}</Notice>;
  return <WorkoutAnalysisView analysis={state.analysis} palette={palette} t={analysisT} mapTheme={mapTheme} onScrubActive={onScrubActive} />;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  titleBlock: { gap: 2 },
  tiles: { gap: spacing.sm },
  tileRow: { flexDirection: 'row', gap: spacing.sm, flex: 1 },
  fresh: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg, overflow: 'hidden' },
  centered: { textAlign: 'center' },
  recordRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  grow: { flex: 1 },
  setLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 32 },
  setNo: { width: 24 },
  actions: { gap: spacing.sm },
});
