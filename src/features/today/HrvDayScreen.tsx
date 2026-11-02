import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { HiddenTabHeader } from '@/components/HiddenTabHeader';
import { KeyValue } from '@/components/KeyValue';
import { Metric } from '@/components/Metric';
import { Card, Divider, Screen } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { DayNav, MetricDayChart, StatsRow } from '@/features/today/MetricDayParts';
import { hrvDaySeries } from '@/features/today/metricDay';
import { loadHrvDay, type HrvDayData } from '@/features/today/metricDayQuery';
import { startOfLocalDay } from '@/features/today/stats';
import { addDays } from '@/features/trends/series';
import { useAnalysisPalette } from '@/features/workouts/analysis/palette';
import { CHART_HEIGHT } from '@/features/workouts/analysis/ui/ChartsCard';
import { AnalysisContext, type AnalysisContextValue } from '@/features/workouts/analysis/ui/context';
import { createScrubStore } from '@/features/workouts/analysis/ui/scrub';
import { useAnalysisT } from '@/features/workouts/analysis/ui/text';
import { errorMessage } from '@/format';
import { useNow } from '@/hooks/useNow';
import { fmtClock, fmtDate, fmtInt, useLocale, useTranslation } from '@/i18n';
import { useWatch } from '@/state/WatchProvider';
import { spacing, useColors } from '@/theme';

/** Keeps "today" right when the screen stays open past midnight. */
const TODAY_TICK_MS = 60_000;

interface Loaded {
  dayStart: number;
  data: HrvDayData | null;
  error: string | null;
}

function Stats({ data }: { data: HrvDayData }) {
  const { t } = useTranslation('today');
  const colors = useColors();
  const stats = data.day.stats;
  const unit = t('hrvDay.unit');
  return (
    <StatsRow
      cells={[
        { key: 'min', label: t('metricDay.min'), value: stats ? fmtInt(stats.min) : '--', unit },
        { key: 'avg', label: t('metricDay.avg'), value: stats ? fmtInt(stats.avg) : '--', unit },
        { key: 'max', label: t('metricDay.max'), value: stats ? fmtInt(stats.max) : '--', unit },
        { key: 'latest', label: t('metricDay.latest'), value: stats ? fmtInt(stats.latest) : '--', unit, color: stats ? colors.heartText : undefined },
      ]}
    />
  );
}

/** The night's values (their average and span) and the day's one-minute measurements with their time. */
function Readings({ data }: { data: HrvDayData }) {
  const { t } = useTranslation('today');
  const unit = t('hrvDay.unit');
  const colors = useColors();
  const { night, spot, nightAvg } = data;
  const nightFrom = night[0]?.start;
  const nightTo = night.length > 0 ? Math.max(...night.map((r) => r.end)) : undefined;
  return (
    <View style={styles.readings}>
      {nightAvg !== null && nightFrom !== undefined && nightTo !== undefined ? (
        <View style={styles.block} accessible accessibilityLabel={`${t('hrvDay.nightTitle')}: ${nightAvg} ${unit}`}>
          <AppText variant="heading">{t('hrvDay.nightTitle')}</AppText>
          <Metric value={fmtInt(nightAvg)} unit={unit} size="lg" color={colors.heartText} />
          <AppText variant="caption" muted>
            {t('hrvDay.nightDetail', { count: night.length, from: fmtClock(nightFrom), to: fmtClock(nightTo) })}
          </AppText>
        </View>
      ) : null}
      {nightAvg !== null && spot.length > 0 ? <Divider /> : null}
      {spot.length > 0 ? (
        <View style={styles.block}>
          <AppText variant="heading">{t('hrvDay.spotTitle')}</AppText>
          {spot.map((r) => (
            <KeyValue key={r.start} icon="pulse" label={fmtClock(r.end)} value={`${fmtInt(r.rmssd)} ${unit}`} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The whole day's HRV (opened from the Health overview and the Readiness screen): lowest, average, highest and latest value of
 * the watch's all-day readings, the 24 h chart with a touch-and-drag readout, the night's RMSSD and the one-minute measurements
 * of the day, and a way to step to the previous and next day. Stretches without readings stay gaps in the line.
 */
export function HrvDayScreen() {
  const { t } = useTranslation('today');
  const router = useRouter();
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
    loadHrvDay(db, dayStart, addDays(dayStart, 1)).then(
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
  }, [db, dayStart, dataVersion, store]);

  const isToday = dayStart >= todayStart;
  const current = loaded?.dayStart === dayStart ? loaded : null;
  const data = current?.data ?? null;
  const series = useMemo(() => (data ? hrvDaySeries(data.day) : null), [data]);
  const hasReadings = data !== null && (data.night.length > 0 || data.spot.length > 0);
  const hasData = data !== null && (data.day.stats !== null || hasReadings);

  return (
    <AnalysisContext.Provider value={context}>
      <Screen scrollEnabled={!scrubbing}>
        <HiddenTabHeader title={t('hrvDay.title')} />
        <DayNav dayStart={dayStart} todayStart={todayStart} onStep={(n) => setDayStart((d) => addDays(d, n))} />

        {current?.error ? <Notice tone="danger">{t('hrvDay.loadError', { error: current.error })}</Notice> : null}

        {current === null ? (
          <Skeleton width="100%" height={CHART_HEIGHT + 120} radius="card" />
        ) : data ? (
          <>
            {data.day.stats && series ? (
              <>
                <Card>
                  <Stats data={data} />
                </Card>
                <Card>
                  <MetricDayChart
                    key={`${dayStart}:${locale}`}
                    day={data.day}
                    series={series}
                    metric="hrv"
                    unit={t('hrvDay.unit')}
                    name={t('hrvDay.title')}
                    label={t('hrvDay.chartLabel', { day: fmtDate(dayStart, 'long') })}
                  />
                </Card>
              </>
            ) : null}
            {hasReadings ? (
              <Card>
                <Readings data={data} />
              </Card>
            ) : null}
            {hasData ? (
              <Card>
                <AppText variant="caption" muted>
                  {t('hrvDay.note')}
                </AppText>
              </Card>
            ) : (
              <Card>
                <AppText variant="caption" muted>
                  {t(isToday ? 'hrvDay.emptyToday' : 'hrvDay.emptyPast')}
                </AppText>
              </Card>
            )}
            <Button label={t('hrvDay.measure')} icon="pulse" variant="secondary" onPress={() => router.push('/hrv')} />
          </>
        ) : null}
      </Screen>
    </AnalysisContext.Provider>
  );
}

const styles = StyleSheet.create({
  readings: { gap: spacing.md },
  block: { gap: spacing.xs },
});
