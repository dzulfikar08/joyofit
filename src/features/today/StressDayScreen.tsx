import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Details } from '@/components/Details';
import { HiddenTabHeader } from '@/components/HiddenTabHeader';
import { Card, Screen } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { DayNav, MetricDayChart, StatsRow } from '@/features/today/MetricDayParts';
import { STRESS_BANDS, stressBandSeconds, stressDaySeries, type MetricDay, type StressBand } from '@/features/today/metricDay';
import { loadMetricDay, STRESS_METRIC_TYPE } from '@/features/today/metricDayQuery';
import { startOfLocalDay } from '@/features/today/stats';
import { addDays } from '@/features/trends/series';
import { useAnalysisPalette } from '@/features/workouts/analysis/palette';
import { shares } from '@/features/workouts/analysis/ui/chartMath';
import { CHART_HEIGHT } from '@/features/workouts/analysis/ui/ChartsCard';
import { AnalysisContext, useAnalysisContext, type AnalysisContextValue } from '@/features/workouts/analysis/ui/context';
import { Bar, Txt } from '@/features/workouts/analysis/ui/primitives';
import { createScrubStore } from '@/features/workouts/analysis/ui/scrub';
import { useAnalysisT } from '@/features/workouts/analysis/ui/text';
import { errorMessage, formatDuration } from '@/format';
import { useNow } from '@/hooks/useNow';
import { fmtDate, useLocale, useTranslation } from '@/i18n';
import { useWatch } from '@/state/WatchProvider';
import { spacing } from '@/theme';

/** Keeps "today" right when the screen stays open past midnight. */
const TODAY_TICK_MS = 60_000;

/** Upper end of each band's range as the watch states it. */
const BAND_TO: Record<StressBand, number> = { relaxed: 29, normal: 59, medium: 79, high: 100 };

interface Loaded {
  dayStart: number;
  day: MetricDay | null;
  error: string | null;
}

/** Time in each band: calm to high, each with its range and a bar of the day's covered time. */
function Bands({ day }: { day: MetricDay }) {
  const { palette } = useAnalysisContext();
  const { t } = useTranslation('today');
  const seconds = useMemo(() => stressBandSeconds(day), [day]);
  const fractions = shares(seconds);
  const colors: Record<StressBand, string> = { relaxed: palette.zones[1], normal: palette.zones[0], medium: palette.zones[3], high: palette.zones[4] };
  return (
    <View style={styles.bands}>
      <AppText variant="heading">{t('stressDay.bandsTitle')}</AppText>
      {STRESS_BANDS.map(({ band, from }, i) => {
        const name = t(`stressDay.band.${band}`);
        const range = t('stressDay.bandRange', { from, to: BAND_TO[band] });
        return (
          <View key={band} style={styles.band} accessible accessibilityLabel={`${name}, ${range}, ${formatDuration(seconds[i] ?? 0)}`}>
            <View style={styles.bandHead}>
              <View style={[styles.swatch, { backgroundColor: colors[band] }]} />
              <Txt size={13} bold style={styles.bandName}>
                {name}
              </Txt>
              <Txt size={12} muted>
                {range}
              </Txt>
              <Txt size={13} bold style={styles.bandTime}>
                {formatDuration(seconds[i] ?? 0)}
              </Txt>
            </View>
            <Bar fraction={fractions[i] ?? 0} color={colors[band]} />
          </View>
        );
      })}
      <Details>{t('stressDay.bandsNote')}</Details>
    </View>
  );
}

/**
 * The whole day's stress level (opened from the Health overview): average, highest and latest level, the 24 h chart with a
 * touch-and-drag readout, time in each band, and a way to step to the previous and next day. Stretches without readings stay
 * gaps in the line and count for no band.
 */
export function StressDayScreen() {
  const { t } = useTranslation('today');
  const at = useAnalysisT();
  const palette = useAnalysisPalette();
  const locale = useLocale();
  const db = useSQLiteContext();
  const { dataVersion } = useWatch();
  const nowSec = Math.floor(useNow(TODAY_TICK_MS) / 1000);
  const todayStart = startOfLocalDay(nowSec);
  const [dayStart, setDayStart] = useState(todayStart);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [store] = useState(createScrubStore);
  const context = useMemo<AnalysisContextValue>(() => ({ palette, t: at, store, setScrubActive: setScrubbing }), [palette, at, store]);

  useEffect(() => {
    let cancelled = false;
    store.set(null);
    loadMetricDay(db, STRESS_METRIC_TYPE, dayStart, addDays(dayStart, 1)).then(
      (day) => {
        if (!cancelled) setLoaded({ dayStart, day, error: null });
      },
      (e: unknown) => {
        if (!cancelled) setLoaded({ dayStart, day: null, error: errorMessage(e) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [db, dayStart, dataVersion, store]);

  const isToday = dayStart >= todayStart;
  const current = loaded?.dayStart === dayStart ? loaded : null;
  const day = current?.day ?? null;
  const series = useMemo(() => (day ? stressDaySeries(day) : null), [day]);
  const stats = day?.stats ?? null;

  return (
    <AnalysisContext.Provider value={context}>
      <Screen scrollEnabled={!scrubbing}>
        <HiddenTabHeader title={t('stressDay.title')} />
        <DayNav dayStart={dayStart} todayStart={todayStart} onStep={(n) => setDayStart((d) => addDays(d, n))} />

        {current?.error ? <Notice tone="danger">{t('stressDay.loadError', { error: current.error })}</Notice> : null}

        {current === null ? (
          <Skeleton width="100%" height={CHART_HEIGHT + 120} radius="card" />
        ) : day && series ? (
          <>
            <Card>
              <StatsRow
                cells={[
                  { key: 'avg', label: t('metricDay.avg'), value: stats ? String(stats.avg) : '--' },
                  { key: 'max', label: t('metricDay.max'), value: stats ? String(stats.max) : '--' },
                  { key: 'latest', label: t('metricDay.latest'), value: stats ? String(stats.latest) : '--' },
                ]}
              />
            </Card>
            {stats ? (
              <>
                <Card>
                  <MetricDayChart
                    key={`${dayStart}:${locale}`}
                    day={day}
                    series={series}
                    metric="stress"
                    unit={t('stressDay.unit')}
                    name={t('stressDay.title')}
                    label={t('stressDay.chartLabel', { day: fmtDate(dayStart, 'long') })}
                  />
                </Card>
                <Card>
                  <Bands day={day} />
                </Card>
              </>
            ) : (
              <Card>
                <AppText variant="caption" muted>
                  {t(isToday ? 'stressDay.emptyToday' : 'stressDay.emptyPast')}
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
  bands: { gap: spacing.sm },
  band: { gap: 6 },
  bandHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  bandName: { flexShrink: 1 },
  bandTime: { marginLeft: 'auto' },
});
