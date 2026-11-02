import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { AppText } from '@/components/AppText';
import { Metric } from '@/components/Metric';
import { bucketStart, type MetricDay } from '@/features/today/metricDay';
import type { AnalysisSeries } from '@/features/workouts/analysis/types';
import type { DayMetric } from '@/features/workouts/analysis/ui/chartMath';
import { ChartPanel } from '@/features/workouts/analysis/ui/ChartPanel';
import { CHART_HEIGHT, ClearButton, useScrubGesture } from '@/features/workouts/analysis/ui/ChartsCard';
import { useAnalysisContext } from '@/features/workouts/analysis/ui/context';
import { Txt } from '@/features/workouts/analysis/ui/primitives';
import { useScrub } from '@/features/workouts/analysis/ui/scrub';
import { fmtClock, fmtDate, useTranslation } from '@/i18n';
import { addDays } from '@/features/trends/series';
import { HIT, spacing, useColors } from '@/theme';

/** Previous / next day arrows around the day's name and date; the next arrow stops at today. */
export function DayNav({ dayStart, todayStart, onStep }: { dayStart: number; todayStart: number; onStep: (days: number) => void }) {
  const { t } = useTranslation('today');
  const colors = useColors();
  const isToday = dayStart >= todayStart;
  const dayTitle = isToday ? t('metricDay.today') : dayStart === addDays(todayStart, -1) ? t('metricDay.yesterday') : fmtDate(dayStart, 'weekday');
  const dayDate = fmtDate(dayStart, 'long');
  return (
    <View style={styles.dayNav}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('metricDay.prevDay')} onPress={() => onStep(-1)} style={styles.navButton}>
        <Ionicons name="chevron-back" size={22} color={colors.foreground} />
      </Pressable>
      <View style={styles.dayLabel} accessible accessibilityRole="header" accessibilityLabel={`${dayTitle}, ${dayDate}`}>
        <AppText variant="heading">{dayTitle}</AppText>
        <AppText variant="caption" muted>
          {dayDate}
        </AppText>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('metricDay.nextDay')}
        accessibilityState={{ disabled: isToday }}
        disabled={isToday}
        onPress={() => onStep(1)}
        style={[styles.navButton, isToday && styles.navDisabled]}>
        <Ionicons name="chevron-forward" size={22} color={colors.foreground} />
      </Pressable>
    </View>
  );
}

export interface StatCell {
  key: string;
  label: string;
  /** `--` when there is no value. */
  value: string;
  unit?: string;
  color?: string;
}

/** A row of big numbers with captions, like the heart-rate day's min / average / highest. */
export function StatsRow({ cells }: { cells: readonly StatCell[] }) {
  return (
    <View style={styles.statsRow}>
      {cells.map((c) => (
        <View key={c.key} style={styles.statCell} accessible accessibilityLabel={`${c.label}: ${c.value}${c.value === '--' || !c.unit ? '' : ` ${c.unit}`}`}>
          <Metric value={c.value} unit={c.value === '--' ? undefined : c.unit} size="md" color={c.color} />
          <AppText variant="caption" muted numberOfLines={1}>
            {c.label}
          </AppText>
        </View>
      ))}
    </View>
  );
}

/** Time and value under the finger: the bucket's time span, its average and its highest reading. */
function Readout({ day, unit }: { day: MetricDay; unit: string }) {
  const { t } = useTranslation('today');
  const { store } = useAnalysisContext();
  const index = useScrub(store);
  if (index === null || index >= day.buckets) {
    return (
      <View style={styles.readoutIdle}>
        <Txt size={12} muted>
          {t('metricDay.hint')}
        </Txt>
      </View>
    );
  }
  const from = bucketStart(day, index);
  const to = Math.min(from + day.bucketSec, day.dayEnd);
  const span = `${fmtClock(from)}–${fmtClock(to)}`;
  const avg = day.avg[index];
  const max = day.max[index];
  const label =
    avg === null || avg === undefined
      ? `${span}, ${t('metricDay.readoutNone')}`
      : `${span}, ${avg} ${unit} ${t('metricDay.readoutAvg')}, ${max} ${t('metricDay.readoutMax')}`;
  return (
    <View style={styles.readoutRow} accessible accessibilityLiveRegion="polite" accessibilityLabel={label}>
      <View style={styles.readoutCellWide}>
        <Txt size={14} bold numberOfLines={1}>
          {span}
        </Txt>
      </View>
      {avg === null || avg === undefined ? (
        <View style={styles.readoutCell}>
          <Txt size={12} muted numberOfLines={1}>
            {t('metricDay.readoutNone')}
          </Txt>
        </View>
      ) : (
        <>
          <View style={styles.readoutCell}>
            <Txt size={14} bold align="center">
              {avg}
            </Txt>
            <Txt size={10} muted numberOfLines={1} align="center">
              {`${unit} ${t('metricDay.readoutAvg')}`}
            </Txt>
          </View>
          <View style={styles.readoutCell}>
            <Txt size={14} bold align="center">
              {max}
            </Txt>
            <Txt size={10} muted numberOfLines={1} align="center">
              {`${unit} ${t('metricDay.readoutMax')}`}
            </Txt>
          </View>
        </>
      )}
    </View>
  );
}

interface MetricDayChartProps {
  day: MetricDay;
  series: AnalysisSeries;
  metric: DayMetric;
  /** Unit written in the readout. */
  unit: string;
  /** Name of the metric for the chart's accessibility hint. */
  name: string;
  label: string;
}

/** The whole-day chart of a sparse metric with the touch-and-drag readout above it. */
export function MetricDayChart({ day, series, metric, unit, name, label }: MetricDayChartProps) {
  const { store, setScrubActive, t: at } = useAnalysisContext();
  const [width, setWidth] = useState(0);
  const handlers = useScrubGesture(store, setScrubActive, { series, width });
  const dayStart = day.dayStart;
  const xLabel = useCallback((seconds: number) => fmtClock(dayStart + seconds), [dayStart]);
  const markers = useMemo(() => day.avg, [day]);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    setWidth((prev) => (prev === w ? prev : w));
  }, []);
  const onAccessibilityAction = useCallback(
    (e: { nativeEvent: { actionName: string } }) => {
      const step = Math.max(1, Math.round(series.n / 48));
      const current = store.get() ?? 0;
      if (e.nativeEvent.actionName === 'increment') store.set(Math.min(series.n - 1, current + step));
      else if (e.nativeEvent.actionName === 'decrement') store.set(Math.max(0, current - step));
    },
    [series.n, store],
  );
  return (
    <>
      <View style={styles.readoutLine}>
        <View style={styles.readoutFlex}>
          <Readout day={day} unit={unit} />
        </View>
        <ClearButton />
      </View>
      <View
        onLayout={onLayout}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityHint={at('chart.a11y', { metric: name })}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={onAccessibilityAction}
        {...handlers}>
        <View pointerEvents="none" style={{ height: CHART_HEIGHT }}>
          {width > 0 ? <ChartPanel series={series} metric={metric} width={width} height={CHART_HEIGHT} xLabel={xLabel} markers={markers} /> : null}
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  dayNav: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  navButton: { width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' },
  navDisabled: { opacity: 0.3 },
  dayLabel: { flex: 1, alignItems: 'center' },
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  statCell: { flex: 1, minWidth: 0 },
  readoutLine: { flexDirection: 'row', alignItems: 'center' },
  readoutFlex: { flex: 1, minWidth: 0 },
  readoutRow: { flexDirection: 'row', alignItems: 'center', height: 46, gap: 4 },
  readoutIdle: { height: 46, justifyContent: 'center' },
  readoutCellWide: { flex: 1.6, minWidth: 0 },
  readoutCell: { flex: 1, minWidth: 0, alignItems: 'center' },
});
