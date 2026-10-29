import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionList, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { useContentPadding } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { EmptyState, Skeleton } from '@/components/States';
import { listWorkouts } from '@/db/queries';
import { localDay } from '@/features/strength/calc';
import { useStrengthHistory } from '@/features/strength/history';
import {
  dayCounts,
  groupByMonth,
  mergeByDay,
  monthOf,
  prCounts,
  sameMonth,
  shiftMonth,
  type DayItem,
  type MonthRef,
  type WatchRow,
} from '@/features/strength/historyModel';
import { startStrengthWorkout } from '@/features/strength/start';
import type { StrengthWorkout } from '@/features/strength/types';
import { Calendar } from '@/features/strength/ui/Calendar';
import { StrengthCard, WatchCard } from '@/features/strength/ui/HistoryCards';
import { WeekStrip } from '@/features/strength/ui/WeekStrip';
import { IconAction } from '@/features/courses/IconAction';
import { fmtDate, fmtDay, fmtInt, useLocale } from '@/i18n';
import { spacing, useColors } from '@/theme';
import { OPEN_IN_STACK } from '@/components/navigation';
import { useNow } from '@/hooks/useNow';

type HistoryView = 'list' | 'calendar';

export default function StrengthHistoryScreen() {
  const { t } = useTranslation('lifts');
  const db = useSQLiteContext();
  const router = useRouter();
  const colors = useColors();
  const locale = useLocale();
  const padding = useContentPadding(false);
  const { ready, workouts } = useStrengthHistory();
  const [view, setView] = useState<HistoryView>('list');
  const [watchRows, setWatchRows] = useState<WatchRow[]>([]);
  const [month, setMonth] = useState<MonthRef>(() => monthOf(Date.now()));
  const [selected, setSelected] = useState<string | null>(() => localDay(Date.now()));

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      listWorkouts(db).then(
        (rows) => {
          if (!cancelled) setWatchRows(rows);
        },
        () => {
          // The calendar then shows the strength workouts only.
        },
      );
      return () => {
        cancelled = true;
      };
    }, [db]),
  );

  const sections = useMemo(
    () => groupByMonth(workouts).map((group) => ({ key: group.key, title: fmtDate(group.at / 1000, 'month'), data: group.workouts })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workouts, locale],
  );
  const prs = useMemo(() => prCounts(workouts), [workouts]);
  const days = useMemo(() => mergeByDay(workouts, watchRows), [workouts, watchRows]);

  const openWorkout = useCallback(
    (workout: StrengthWorkout) => router.push({ pathname: '/strength/summary/[id]', params: { id: workout.id } }),
    [router],
  );
  const openWatch = useCallback((row: WatchRow) => router.push({ pathname: '/workouts/[id]', params: { id: String(row.id) } }, OPEN_IN_STACK), [router]);

  const options = useMemo(
    () => [
      { value: 'list' as const, label: t('history.view.list') },
      { value: 'calendar' as const, label: t('history.view.calendar') },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, locale],
  );

  const header = (
    <View style={styles.header}>
      <Segmented options={options} value={view} onChange={setView} />
      {view === 'list' && workouts.length > 0 ? <WeekStrip workouts={workouts} /> : null}
      {view === 'calendar' ? (
        <CalendarPanel
          month={month}
          days={days}
          selected={selected}
          onMonth={setMonth}
          onSelect={setSelected}
          onOpenStrength={openWorkout}
          onOpenWatch={openWatch}
          prs={prs}
        />
      ) : null}
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: t('history.title') }} />
      <SectionList
        sections={view === 'list' ? sections : []}
        keyExtractor={(w) => w.id}
        contentContainerStyle={padding}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        ItemSeparatorComponent={Gap}
        ListHeaderComponent={header}
        ListEmptyComponent={
          view !== 'list' ? null : ready ? (
            <EmptyState
              icon="barbell"
              title={t('history.empty.title')}
              description={t('history.empty.description')}
              action={{ label: t('history.empty.start'), icon: 'add', onPress: () => startStrengthWorkout() }}
            />
          ) : (
            <View style={styles.skeletons}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} width="100%" height={96} radius="card" />
              ))}
            </View>
          )
        }
        renderSectionHeader={({ section }) => (
          <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
            <AppText variant="label" muted accessibilityRole="header">
              {section.title}
            </AppText>
          </View>
        )}
        renderItem={({ item }) => <StrengthCard workout={item} prs={prs.get(item.id) ?? 0} onPress={openWorkout} />}
      />
    </View>
  );
}

interface CalendarPanelProps {
  month: MonthRef;
  days: ReadonlyMap<string, readonly DayItem[]>;
  selected: string | null;
  prs: ReadonlyMap<string, number>;
  onMonth: (month: MonthRef) => void;
  onSelect: (day: string) => void;
  onOpenStrength: (workout: StrengthWorkout) => void;
  onOpenWatch: (row: WatchRow) => void;
}

/** Month navigation, the grid with its legend, the month's count and the items of the selected day. */
function CalendarPanel({ month, days, selected, prs, onMonth, onSelect, onOpenStrength, onOpenWatch }: CalendarPanelProps) {
  const { t } = useTranslation('lifts');
  const colors = useColors();
  const locale = useLocale();
  const current = monthOf(useNow(60_000));
  const monthStart = new Date(month.year, month.month, 1);
  const title = useMemo(
    () => fmtDate(monthStart, 'month'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [month.year, month.month, locale],
  );
  const counts = useMemo(() => {
    const prefix = `${month.year}-${String(month.month + 1).padStart(2, '0')}-`;
    let strength = 0;
    let other = 0;
    for (const [day, items] of days) {
      if (!day.startsWith(prefix)) continue;
      const c = dayCounts(items);
      strength += c.strength;
      other += c.other;
    }
    return { strength, other };
  }, [days, month.year, month.month]);
  const items = selected ? (days.get(selected) ?? []) : [];

  return (
    <View style={styles.panel}>
      <View style={styles.monthBar}>
        <IconAction icon="chevron-back" label={t('calendar.previous')} onPress={() => onMonth(shiftMonth(month, -1))} />
        <View style={styles.monthTitle}>
          <AppText variant="heading" accessibilityRole="header" numberOfLines={1}>
            {title}
          </AppText>
          <AppText variant="caption" muted numberOfLines={1}>
            {t('calendar.monthCount', { strength: fmtInt(counts.strength), other: fmtInt(counts.other) })}
          </AppText>
        </View>
        {!sameMonth(month, current) ? (
          <Button
            label={t('calendar.today')}
            variant="ghost"
            onPress={() => {
              onMonth(current);
              onSelect(localDay(Date.now()));
            }}
          />
        ) : null}
        <IconAction icon="chevron-forward" label={t('calendar.next')} onPress={() => onMonth(shiftMonth(month, 1))} />
      </View>
      <Calendar month={month} days={days} selected={selected} onSelect={onSelect} />
      <View style={styles.legend}>
        <LegendDot color={colors.primary} label={t('calendar.legend.strength')} />
        <LegendDot color={colors.workouts} label={t('calendar.legend.other')} />
      </View>
      {selected ? (
        <View style={styles.dayList}>
          <AppText variant="heading" accessibilityRole="header">
            {fmtDay(selected, 'long')}
          </AppText>
          {items.length === 0 ? (
            <AppText variant="caption" muted>
              {t('calendar.dayEmpty')}
            </AppText>
          ) : (
            items.map((item) =>
              item.kind === 'strength' ? (
                <StrengthCard key={item.workout.id} workout={item.workout} prs={prs.get(item.workout.id) ?? 0} showDate={false} onPress={onOpenStrength} />
              ) : (
                <WatchCard key={`watch-${item.row.id}`} row={item.row} onPress={onOpenWatch} />
              ),
            )
          )}
        </View>
      ) : (
        <AppText variant="caption" muted>
          {t('calendar.pickDay')}
        </AppText>
      )}
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <AppText variant="caption" muted>
        {label}
      </AppText>
    </View>
  );
}

function Gap() {
  return <View style={styles.gap} />;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { gap: spacing.md, marginBottom: spacing.sm },
  sectionHeader: { paddingTop: spacing.sm, paddingBottom: spacing.xs },
  gap: { height: spacing.sm },
  skeletons: { gap: spacing.md },
  panel: { gap: spacing.md },
  monthBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  monthTitle: { flex: 1, gap: 0 },
  legend: { flexDirection: 'row', gap: spacing.lg, justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  dayList: { gap: spacing.sm },
});
