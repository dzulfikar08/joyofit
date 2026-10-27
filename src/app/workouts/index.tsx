import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { ChipRow } from '@/components/ChipRow';
import { HeaderIconButton } from '@/components/HeaderIconButton';
import { AskJoyoHeaderButton } from '@/features/ai/ui/AskJoyoButton';
import { IconChip } from '@/components/IconChip';
import { showsWatchUi } from '@/features/device/presence';
import { SyncIconButton } from '@/features/device/SyncIconButton';
import { useWatchPresence } from '@/features/device/useWatchPresence';
import { Metric } from '@/components/Metric';
import { PressableScale } from '@/components/PressableScale';
import { PageHeader, useContentPadding, useRefreshControl } from '@/components/Screen';
import { EmptyState, Notice, Skeleton } from '@/components/States';
import { listWorkouts, type WorkoutRow } from '@/db/queries';
import { LoopShortcut } from '@/features/loops/ui/LoopShortcut';
import { hasLive } from '@/features/record/liveRoute';
import { RecordingBanner } from '@/features/record/ui/RecordingBanner';
import { useStrengthHistory } from '@/features/strength/history';
import { workoutTotals } from '@/features/strength/calc';
import type { StrengthWorkout } from '@/features/strength/types';
import { ActiveWorkoutBanner } from '@/features/strength/ui/ActiveWorkoutBanner';
import { timerText } from '@/features/strength/logFormat';
import { volumeText } from '@/features/strength/ui/liftFormat';
import { useWeightUnit } from '@/features/strength/useWeightUnit';
import { getStrengthMeta, setStrengthMeta } from '@/features/strength/store';
import {
  countGroups,
  DEFAULT_VIEW,
  effectiveFilter,
  parseView,
  VIEW_META_KEY,
  visibleFilters,
  workoutGroup,
  type WorkoutView,
} from '@/features/workouts/filter';
import { PROGRESS_KINDS, progressSinceSec, type ProgressRow } from '@/features/workouts/progress';
import { listProgressRows } from '@/features/workouts/progressQuery';
import { sportIcon } from '@/features/workouts/sportIcon';
import { sportLabel } from '@/features/workouts/sportLabel';
import { formatElapsed, workoutDistanceParts } from '@/features/workouts/summary';
import { workoutTimes } from '@/features/workouts/times';
import { usePendingDelete } from '@/features/workouts/pendingDelete';
import { DeleteWorkoutDialog, type DeleteTarget } from '@/features/workouts/ui/DeleteWorkoutDialog';
import { ProgressCard } from '@/features/workouts/ui/ProgressCard';
import { useWorkoutStrain } from '@/features/workouts/useWorkoutStrain';
import { errorMessage, formatCount, formatDateTime } from '@/format';
import { fmtDate, fmtDecimal, useLocale } from '@/i18n';
import { useRecorder } from '@/state/RecorderProvider';
import { useWatch } from '@/state/WatchProvider';
import { spacing, tintColors, useColors, useTheme } from '@/theme';
import { OPEN_IN_STACK } from '@/components/navigation';

interface MonthGroup {
  title: string;
  data: WorkoutRow[];
}

/** Consecutive workouts of the same month under one heading; relies on the query's newest-first order. */
function groupByMonth(workouts: readonly WorkoutRow[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const workout of workouts) {
    const title = fmtDate(workout.start, 'month');
    const last = groups[groups.length - 1];
    if (last && last.title === title) last.data.push(workout);
    else groups.push({ title, data: [workout] });
  }
  return groups;
}

function WorkoutCard({ workout, strength, onDelete }: { workout: WorkoutRow; strength?: StrengthWorkout; onDelete: (target: DeleteTarget) => void }) {
  const router = useRouter();
  const { colors, radius } = useTheme();
  const heart = tintColors(colors, 'heart');
  const { t } = useTranslation('workouts');
  const { t: lifts } = useTranslation('lifts');
  useWeightUnit();
  const sport = strength?.name.trim() || sportLabel(workout.sportName);
  const { value: distance, unit: distanceUnit } = workoutDistanceParts(workout.distance);
  const strain = useWorkoutStrain(workout);
  const totals = useMemo(() => (strength ? workoutTotals(strength) : null), [strength]);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t('list.cardA11y', { sport, date: formatDateTime(workout.start) })}
      accessibilityActions={[{ name: 'delete', label: t('delete.action') }]}
      onAccessibilityAction={() => onDelete({ start: workout.start, sportName: workout.sportName, name: strength?.name })}
      onLongPress={() => onDelete({ start: workout.start, sportName: workout.sportName, name: strength?.name })}
      onPress={() =>
        strength
          ? router.push({ pathname: '/strength/summary/[id]', params: { id: strength.id } }, OPEN_IN_STACK)
          : router.push({ pathname: '/workouts/[id]', params: { id: String(workout.id) } })
      }
      style={[styles.card, { backgroundColor: colors.card, borderRadius: radius.card }]}>
      <View style={styles.cardHead}>
        <IconChip sport={sportIcon(workout.sportName)} tint="workouts" />
        <View style={styles.cardTitle}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {sport}
          </AppText>
          <AppText variant="caption" muted numberOfLines={1}>
            {formatDateTime(workout.start)}
          </AppText>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
      </View>
      <View style={styles.metrics}>
        <Metric value={formatElapsed(workoutTimes(workout).movingSec)} size="sm" />
        {workout.distance > 0 ? <Metric value={distance} unit={distanceUnit} size="sm" /> : null}
        {workout.calories > 0 ? <Metric value={formatCount(workout.calories)} unit={t('list.unit.kcal')} size="sm" /> : null}
        {workout.avgHr !== null ? (
          <Metric value={String(workout.avgHr)} unit={t('list.unit.bpmAvg')} size="sm" color={heart.text} unitColor={heart.text} />
        ) : null}
        {strain !== null && strain !== undefined ? (
          <Metric value={fmtDecimal(strain, 1)} unit={t('list.unit.strain')} size="sm" color={colors.workoutsText} unitColor={colors.workoutsText} />
        ) : null}
      </View>
      {totals ? (
        <View style={styles.strengthLine}>
          <Ionicons name="barbell-outline" size={16} color={colors.mutedForeground} />
          <AppText variant="caption" muted style={styles.partialText}>
            {totals.volume > 0
              ? lifts('list.strengthLine', { count: totals.sets, volume: volumeText(totals.volume) })
              : totals.seconds > 0
                ? lifts('list.strengthLineTime', { count: totals.sets, time: timerText(totals.seconds) })
                : lifts('list.strengthLineSets', { count: totals.sets })}
          </AppText>
        </View>
      ) : null}
      {!workout.complete ? (
        <View style={styles.partial}>
          <Ionicons name="cloud-download-outline" size={16} color={colors.mutedForeground} />
          <AppText variant="caption" muted style={styles.partialText}>
            {t('list.partial')}
          </AppText>
        </View>
      ) : null}
    </PressableScale>
  );
}

function WorkoutSkeletons() {
  return (
    <View style={styles.skeletons}>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} width="100%" height={96} radius="card" />
      ))}
    </View>
  );
}

export default function WorkoutsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation('workouts');
  const { t: lifts } = useTranslation('lifts');
  const locale = useLocale();
  // The status-bar inset is applied outside the list so sticky month headers stop below it.
  const padding = useContentPadding(false);
  const { linkState, device, dataVersion, sync } = useWatch();
  const { snapshot } = useRecorder();
  const presence = useWatchPresence();
  // A phone that never had a watch gets no Sync button and no "connect your watch" nagging; the strength logger is the point of this tab.
  const watchUi = presence !== null && showsWatchUi(presence);
  const [workouts, setWorkouts] = useState<WorkoutRow[] | null>(null);
  // `at` is when the rows were read: the week and month the card sums are the ones that were running then.
  const [progressData, setProgressData] = useState<{ rows: ProgressRow[]; at: number }>({ rows: [], at: 0 });
  const [view, setView] = useState<WorkoutView>(DEFAULT_VIEW);
  const [error, setError] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
  // A deleted workout leaves the list at once; it is really deleted when the 5 seconds of "Urungkan" are up.
  const pendingDelete = usePendingDelete();
  // Strength workouts by the `workouts.start` they are stored as (their own row, or the watch row they merged with).
  const { workouts: strengthWorkouts } = useStrengthHistory();
  const strengthByStart = useMemo(() => {
    const map = new Map<number, StrengthWorkout>();
    for (const w of strengthWorkouts) if (w.workoutStart !== null) map.set(w.workoutStart, w);
    return map;
  }, [strengthWorkouts]);

  // The last chosen sport and chart range come back on the next visit.
  useEffect(() => {
    let cancelled = false;
    getStrengthMeta(db, VIEW_META_KEY).then(
      (json) => {
        if (!cancelled) setView(parseView(json));
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [db]);
  const changeView = (patch: Partial<WorkoutView>) => {
    const next = { ...view, ...patch };
    setView(next);
    void setStrengthMeta(db, VIEW_META_KEY, JSON.stringify(next));
  };

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      listWorkouts(db).then(
        (rows) => {
          if (!cancelled) {
            setWorkouts(rows);
            setError(null);
          }
        },
        (e: unknown) => {
          if (!cancelled) setError(errorMessage(e));
        },
      );
      const readAt = Math.floor(Date.now() / 1000);
      listProgressRows(db, progressSinceSec(readAt)).then(
        (rows) => {
          if (!cancelled) setProgressData({ rows, at: readAt });
        },
        () => {
          if (!cancelled) setProgressData({ rows: [], at: readAt });
        },
      );
      return () => {
        cancelled = true;
      };
      // dataVersion re-runs the query after each stored sync.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [db, dataVersion]),
  );

  const canSync = linkState === 'connected' && device !== null;
  const syncing = linkState === 'syncing';
  const shown = useMemo(() => (workouts ?? []).filter((w) => w.start !== pendingDelete?.start), [workouts, pendingDelete?.start]);
  const groupOf = useCallback((w: WorkoutRow) => workoutGroup(w.sportName, strengthByStart.has(w.start)), [strengthByStart]);
  const counts = useMemo(() => countGroups(shown, groupOf), [shown, groupOf]);
  const filter = effectiveFilter(view.filter, counts);
  const chips = useMemo(() => visibleFilters(counts), [counts]);
  const sections = useMemo(
    () => groupByMonth(filter === 'all' ? shown : shown.filter((w) => groupOf(w) === filter)),
    [shown, filter, groupOf, locale],
  );
  const progressKind = PROGRESS_KINDS.find((k) => k === filter);
  const visibleProgressRows = useMemo(() => progressData.rows.filter((r) => r.start !== pendingDelete?.start), [progressData.rows, pendingDelete?.start]);
  const refreshControl = useRefreshControl({
    refreshing: pulling,
    enabled: canSync,
    onRefresh: () => {
      setPulling(true);
      void sync().finally(() => setPulling(false));
    },
  });

  const connectAction = { label: t('list.connectWatch'), onPress: () => router.push('/watch') };
  // Strength workouts that have no row in this list (imported from JoyoRogo): they live in the strength history.
  const strengthOnlyCount = useMemo(() => strengthWorkouts.filter((w) => w.workoutStart === null).length, [strengthWorkouts]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* Outside the list so it stays in view while the workouts scroll; the same page padding as the list. */}
      {hasLive(snapshot.phase, snapshot.sport) ? (
        <View style={[styles.pinned, { paddingHorizontal: padding.paddingHorizontal, paddingTop: padding.paddingTop }]}>
          <RecordingBanner />
        </View>
      ) : null}
      <SectionList
        sections={sections}
        keyExtractor={(w) => String(w.id)}
        contentContainerStyle={padding}
        refreshControl={refreshControl}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        ItemSeparatorComponent={ItemGap}
        ListHeaderComponent={
          <View style={styles.header}>
            <PageHeader
              title={t('list.title')}
              right={
                <View style={styles.headerActions}>
                  <AskJoyoHeaderButton />
                  <HeaderIconButton icon="calendar-outline" label={lifts('list.history')} onPress={() => router.push('/strength/history', OPEN_IN_STACK)} />
                  {watchUi ? <SyncIconButton /> : null}
                </View>
              }
            />
            <ActiveWorkoutBanner />
            <LoopShortcut dismissible />
            {error ? <Notice tone="danger">{t('list.readError', { error })}</Notice> : null}
            {strengthOnlyCount > 0 ? (
              <Notice icon="barbell-outline" action={{ label: lifts('list.history'), onPress: () => router.push('/strength/history', OPEN_IN_STACK) }}>
                {t('list.strengthElsewhere', { count: strengthOnlyCount })}
              </Notice>
            ) : null}
            {watchUi && !canSync && !syncing && workouts && (workouts.length === 0 || workouts.some((w) => !w.imported)) ? (
              <Notice icon="watch-outline" action={connectAction}>
                {t('list.connectToSync')}
              </Notice>
            ) : null}
            {chips.length > 1 ? (
              <ChipRow
                items={chips.map((f) => ({
                  key: f,
                  label: t(`list.filter.${f}`),
                  selected: f === filter,
                  onPress: () => changeView({ filter: f }),
                }))}
              />
            ) : null}
            {progressKind && progressData.at > 0 ? (
              <ProgressCard
                kind={progressKind}
                rows={visibleProgressRows}
                nowSec={progressData.at}
                period={view.period}
                onPeriodChange={(period) => changeView({ period })}
              />
            ) : null}
          </View>
        }
        ListEmptyComponent={
          workouts ? (
            <EmptyState
              icon="fitness"
              title={t('list.empty.title')}
              description={watchUi ? t('list.empty.description') : t('list.empty.descriptionNoWatch')}
            />
          ) : error ? null : (
            <WorkoutSkeletons />
          )
        }
        renderSectionHeader={({ section }) => (
          <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
            <AppText variant="label" muted accessibilityRole="header">
              {section.title}
            </AppText>
          </View>
        )}
        renderItem={({ item }) => <WorkoutCard workout={item} strength={strengthByStart.get(item.start)} onDelete={setDeleting} />}
      />
      <DeleteWorkoutDialog target={deleting} onClose={() => setDeleting(null)} />
    </View>
  );
}

function ItemGap() {
  return <View style={styles.gap} />;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  pinned: { paddingBottom: spacing.xs },
  header: { gap: spacing.sm, marginBottom: spacing.xs },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionHeader: { paddingTop: spacing.sm, paddingBottom: spacing.xs },
  gap: { height: spacing.sm },
  card: { padding: spacing.md + 4, gap: spacing.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardTitle: { flex: 1, gap: 2 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: 0 },
  partial: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  strengthLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  partialText: { flex: 1 },
  skeletons: { gap: spacing.md },
});
