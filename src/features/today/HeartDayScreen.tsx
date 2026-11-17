import { Ionicons } from '@expo/vector-icons';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { AppText } from '@/components/AppText';
import { Details } from '@/components/Details';
import { HiddenTabHeader } from '@/components/HiddenTabHeader';
import { Metric } from '@/components/Metric';
import { Card, Screen } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { heartDaySeries, bucketStart, restingNotShared, type HeartDay } from '@/features/today/heartDay';
import { loadHeartDay, type HeartDayData } from '@/features/today/heartDayQuery';
import { startOfLocalDay } from '@/features/today/stats';
import { addDays } from '@/features/trends/series';
import { useAnalysisPalette } from '@/features/workouts/analysis/palette';
import { shares } from '@/features/workouts/analysis/ui/chartMath';
import { ChartPanel } from '@/features/workouts/analysis/ui/ChartPanel';
import { CHART_HEIGHT, ClearButton, useScrubGesture } from '@/features/workouts/analysis/ui/ChartsCard';
import { AnalysisContext, useAnalysisContext, type AnalysisContextValue } from '@/features/workouts/analysis/ui/context';
import { Bar, MIN_HIT, Txt } from '@/features/workouts/analysis/ui/primitives';
import { createScrubStore, useScrub } from '@/features/workouts/analysis/ui/scrub';
import { useAnalysisT } from '@/features/workouts/analysis/ui/text';
import { hrZoneColor } from '@/features/workouts/analysis/ui/theme';
import { hrZoneName } from '@/features/hrzones/names';
import { useHrZones } from '@/features/hrzones/settings';
import type { HrZoneMethod } from '@/features/hrzones/zones';
import { errorMessage, formatDuration } from '@/format';
import { useNow } from '@/hooks/useNow';
import { fmtClock, fmtDate, useLocale, useTranslation } from '@/i18n';
import { useWatch } from '@/state/WatchProvider';
import { HIT, spacing, useColors } from '@/theme';

/** Keeps "today" right when the screen stays open past midnight. */
const TODAY_TICK_MS = 60_000;

interface Loaded {
  dayStart: number;
  data: HeartDayData | null;
  error: string | null;
}

/** Time and bpm under the finger: the 5-minute bucket's time span, its average and its highest reading. */
function Readout({ day }: { day: HeartDay }) {
  const { store, t: at } = useAnalysisContext();
  const { t } = useTranslation('today');
  const index = useScrub(store);
  if (index === null || index >= day.buckets) {
    return (
      <View style={styles.readoutIdle}>
        <Txt size={12} muted>
          {t('heartDay.hint')}
        </Txt>
      </View>
    );
  }
  const from = bucketStart(day, index);
  const to = Math.min(from + day.bucketSec, day.dayEnd);
  const span = `${fmtClock(from)}–${fmtClock(to)}`;
  const avg = day.avg[index];
  const max = day.max[index];
  const label = avg === null ? `${span}, ${t('heartDay.readoutNone')}` : `${span}, ${avg} ${at('unit.bpm')} ${t('heartDay.readoutAvg')}, ${max} ${t('heartDay.readoutMax')}`;
  return (
    <View style={styles.readoutRow} accessible accessibilityLiveRegion="polite" accessibilityLabel={label}>
      <View style={styles.readoutCellWide}>
        <Txt size={14} bold numberOfLines={1}>
          {span}
        </Txt>
      </View>
      {avg === null ? (
        <View style={styles.readoutCell}>
          <Txt size={12} muted numberOfLines={1}>
            {t('heartDay.readoutNone')}
          </Txt>
        </View>
      ) : (
        <>
          <View style={styles.readoutCell}>
            <Txt size={14} bold align="center">
              {avg}
            </Txt>
            <Txt size={10} muted numberOfLines={1} align="center">
              {`${at('unit.bpm')} ${t('heartDay.readoutAvg')}`}
            </Txt>
          </View>
          <View style={styles.readoutCell}>
            <Txt size={14} bold align="center">
              {max}
            </Txt>
            <Txt size={10} muted numberOfLines={1} align="center">
              {`${at('unit.bpm')} ${t('heartDay.readoutMax')}`}
            </Txt>
          </View>
        </>
      )}
    </View>
  );
}

function DayChart({ day, dayStart, hrBounds, label }: { day: HeartDay; dayStart: number; hrBounds: readonly number[]; label: string }) {
  const { store, setScrubActive, t: at, palette } = useAnalysisContext();
  const { t } = useTranslation('today');
  const [width, setWidth] = useState(0);
  const series = useMemo(() => heartDaySeries(day), [day]);
  const handlers = useScrubGesture(store, setScrubActive, { series, width });
  const xLabel = useCallback((seconds: number) => fmtClock(dayStart + seconds), [dayStart]);
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
  const peak = day.peak;
  return (
    <>
      <View style={styles.readoutLine}>
        <View style={styles.readoutFlex}>
          <Readout day={day} />
        </View>
        <ClearButton />
      </View>
      <View
        onLayout={onLayout}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityHint={at('chart.a11y', { metric: at('metric.hr') })}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={onAccessibilityAction}
        {...handlers}>
        <View pointerEvents="none" style={{ height: CHART_HEIGHT }}>
          {width > 0 ? (
            <ChartPanel series={series} metric="hr" width={width} height={CHART_HEIGHT} hrBounds={hrBounds} xLabel={xLabel} />
          ) : null}
        </View>
      </View>
      {peak ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('heartDay.peakA11y', { bpm: peak.bpm, time: fmtClock(bucketStart(day, peak.bucket)) })}
          onPress={() => store.set(peak.bucket)}
          hitSlop={{ top: 8, bottom: 8 }}
          style={styles.peak}>
          <Ionicons name="trending-up" size={16} color={palette.hr} />
          <Txt size={13} bold>
            {t('heartDay.peak', { bpm: peak.bpm, time: fmtClock(bucketStart(day, peak.bucket)) })}
          </Txt>
        </Pressable>
      ) : null}
    </>
  );
}

function Zones({ zoneSeconds, bounds, maxHr, method }: { zoneSeconds: readonly number[]; bounds: readonly number[]; maxHr: number; method: HrZoneMethod }) {
  const { palette } = useAnalysisContext();
  const { t } = useTranslation('today');
  const fractions = shares(zoneSeconds);
  return (
    <View style={styles.zones}>
      <AppText variant="heading">{t('heartDay.zonesTitle')}</AppText>
      {zoneSeconds.map((sec, i) => (
        <View key={i} style={styles.zone} accessible accessibilityLabel={`${t('heartDay.zone', { n: i + 1, name: hrZoneName(method, i + 1) })}, ${formatDuration(sec)}`}>
          <View style={styles.zoneHead}>
            <View style={[styles.swatch, { backgroundColor: hrZoneColor(palette, i + 1) }]} />
            <Txt size={13} bold style={styles.zoneName}>
              {t('heartDay.zone', { n: i + 1, name: hrZoneName(method, i + 1) })}
            </Txt>
            <Txt size={12} muted>
              {t('heartDay.zoneRange', { from: bounds[i] })}
            </Txt>
            <Txt size={13} bold style={styles.zoneTime}>
              {formatDuration(sec)}
            </Txt>
          </View>
          <Bar fraction={fractions[i] ?? 0} color={hrZoneColor(palette, i + 1)} />
        </View>
      ))}
      <Details>{t('heartDay.zonesNote', { max: maxHr })}</Details>
    </View>
  );
}

function DayStats({ data }: { data: HeartDayData }) {
  const { t } = useTranslation('today');
  const colors = useColors();
  const stats = data.day.stats;
  const cells: { key: string; label: string; value: string }[] = [
    { key: 'min', label: t('heartDay.min'), value: stats ? String(stats.min) : '--' },
    { key: 'avg', label: t('heartDay.avg'), value: stats ? String(stats.avg) : '--' },
    { key: 'max', label: t('heartDay.max'), value: stats ? String(stats.max) : '--' },
    { key: 'resting', label: t('heartDay.resting'), value: data.resting !== null ? String(data.resting) : '--' },
  ];
  const noResting = restingNotShared(stats !== null, data.resting, data.restingRecently);
  return (
    <>
      <View style={styles.statsRow}>
        {cells.map((c) => (
          <View key={c.key} style={styles.statCell} accessible accessibilityLabel={`${c.label}: ${c.value}${c.value === '--' ? '' : ' bpm'}`}>
            <Metric value={c.value} size="md" color={c.key === 'max' && stats ? colors.heartText : undefined} />
            <AppText variant="caption" muted numberOfLines={1}>
              {c.label}
            </AppText>
          </View>
        ))}
      </View>
      {noResting ? (
        <AppText variant="caption" muted style={styles.restingNote}>
          {t('heartDay.restingNotShared')}
        </AppText>
      ) : null}
    </>
  );
}

/**
 * The whole day's heart rate (opened from the Today heart card): min, average, highest and resting rate, the 24 h line coloured by
 * zone, a touch-and-drag readout of time and bpm, time per zone, and a way to step to the previous and next day. The chart is the
 * workout analysis chart on a 5-minute grid; stretches the watch recorded nothing for stay gaps.
 */
export function HeartDayScreen() {
  const { t } = useTranslation('today');
  const at = useAnalysisT();
  const palette = useAnalysisPalette();
  const colors = useColors();
  const locale = useLocale();
  const db = useSQLiteContext();
  const { dataVersion } = useWatch();
  const nowSec = Math.floor(useNow(TODAY_TICK_MS) / 1000);
  const todayStart = startOfLocalDay(nowSec);
  const [dayStart, setDayStart] = useState(todayStart);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [store] = useState(createScrubStore);
  const zones = useHrZones();
  const bounds = useMemo(() => [...zones.bounds, zones.maxHr], [zones]);
  const context = useMemo<AnalysisContextValue>(() => ({ palette, t: at, store, setScrubActive: setScrubbing }), [palette, at, store]);

  useEffect(() => {
    let cancelled = false;
    store.set(null);
    loadHeartDay(db, dayStart, addDays(dayStart, 1), zones.bounds).then(
      (data) => {
        if (!cancelled) setLoaded({ dayStart, data, error: null });
      },
      (e: unknown) => {
        if (!cancelled) setLoaded({ dayStart, data: null, error: errorMessage(e) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [db, dayStart, dataVersion, zones, store]);

  const isToday = dayStart >= todayStart;
  const current = loaded?.dayStart === dayStart ? loaded : null;
  const dayTitle = isToday
    ? t('heartDay.today')
    : dayStart === addDays(todayStart, -1)
      ? t('heartDay.yesterday')
      : fmtDate(dayStart, 'weekday');
  const dayDate = fmtDate(dayStart, 'long');
  const step = (n: number) => setDayStart((d) => addDays(d, n));

  return (
    <AnalysisContext.Provider value={context}>
      <Screen scrollEnabled={!scrubbing}>
        <HiddenTabHeader title={t('heartDay.title')} />
        <View style={styles.dayNav}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('heartDay.prevDay')}
            onPress={() => step(-1)}
            style={styles.navButton}>
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
            accessibilityLabel={t('heartDay.nextDay')}
            accessibilityState={{ disabled: isToday }}
            disabled={isToday}
            onPress={() => step(1)}
            style={[styles.navButton, isToday && styles.navDisabled]}>
            <Ionicons name="chevron-forward" size={22} color={colors.foreground} />
          </Pressable>
        </View>

        {current?.error ? <Notice tone="danger">{t('heartDay.loadError', { error: current.error })}</Notice> : null}

        {current === null ? (
          <Skeleton width="100%" height={CHART_HEIGHT + 120} radius="card" />
        ) : current.data ? (
          <>
            <Card>
              <DayStats data={current.data} />
            </Card>
            {current.data.day.stats ? (
              <>
                <Card>
                  <DayChart
                    key={`${dayStart}:${locale}`}
                    day={current.data.day}
                    dayStart={dayStart}
                    hrBounds={bounds}
                    label={t('heartDay.chartLabel', { day: dayDate })}
                  />
                </Card>
                <Card>
                  <Zones zoneSeconds={current.data.zoneSeconds} bounds={bounds} maxHr={zones.maxHr} method={zones.method} />
                </Card>
              </>
            ) : (
              <Card>
                <AppText variant="caption" muted>
                  {t(isToday ? 'heartDay.emptyToday' : 'heartDay.emptyPast')}
                </AppText>
              </Card>
            )}
          </>
        ) : null}
      </Screen>
    </AnalysisContext.Provider>
  );
}

const styles = StyleSheet.create({
  dayNav: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  navButton: { width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' },
  navDisabled: { opacity: 0.3 },
  dayLabel: { flex: 1, alignItems: 'center' },
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  restingNote: { marginTop: spacing.sm },
  statCell: { flex: 1, minWidth: 0 },
  readoutLine: { flexDirection: 'row', alignItems: 'center' },
  readoutFlex: { flex: 1, minWidth: 0 },
  readoutRow: { flexDirection: 'row', alignItems: 'center', height: 46, gap: 4 },
  readoutIdle: { height: 46, justifyContent: 'center' },
  readoutCellWide: { flex: 1.6, minWidth: 0 },
  readoutCell: { flex: 1, minWidth: 0, alignItems: 'center' },
  peak: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: MIN_HIT - 8 },
  zones: { gap: spacing.sm },
  zone: { gap: 6 },
  zoneHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  zoneName: { flexShrink: 1 },
  zoneTime: { marginLeft: 'auto' },
});
