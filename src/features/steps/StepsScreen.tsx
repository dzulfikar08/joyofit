import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { MoreText } from '@/components/MoreText';
import { BarChart, type BarDatum } from '@/components/BarChart';
import { HiddenTabHeader } from '@/components/HiddenTabHeader';
import { InfoPill } from '@/components/InfoPill';
import { Metric } from '@/components/Metric';
import { NavRow } from '@/components/NavRow';
import { Card, Screen } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { BucketList, type BucketRow } from '@/features/metric/BucketList';
import { periodLabel } from '@/features/metric/labels';
import {
  anchorFor,
  canStepForward,
  holdsToday,
  monthStart,
  periodFor,
  shiftAnchor,
  type MetricRange,
} from '@/features/metric/range';
import { RangeHeader } from '@/features/metric/RangeHeader';
import { stepBars, summarizeSteps, type StepBar } from '@/features/steps/series';
import { useStepsPeriod } from '@/features/steps/useStepsData';
import { stepsLeft } from '@/features/steps/weekView';
import { ownTotalsOf } from '@/features/device/watchDayTotals';
import { useStepGoal } from '@/features/today/useStepGoal';
import { startOfLocalDay } from '@/features/today/stats';
import { fmtClock, fmtDate, fmtInt, useLocale } from '@/i18n';
import { useWatch } from '@/state/WatchProvider';
import { spacing, useColors } from '@/theme';
import { OPEN_IN_STACK } from '@/components/navigation';

const BAR_AREA_HEIGHT = 140;
const GAP: Record<MetricRange, number> = { D: 3, W: 6, M: 2, '3M': 4, Y: 5 };

/** The range that shows one slot of `range` in full: a day from a week or month, a week from three months, a month from a year. */
const FINER: Partial<Record<MetricRange, MetricRange>> = { W: 'D', M: 'D', '3M': 'W', Y: 'M' };

/** The tick under bar `i`, or null; sparse where bars are thin. */
function tickOf(range: MetricRange, bar: StepBar, i: number): string | null {
  switch (range) {
    case 'D':
      return i % 6 === 0 || i === 23 ? String(i) : null;
    case 'W':
      return fmtDate(bar.from, 'dayShort');
    case 'M':
      return i % 5 === 0 ? String(new Date((bar.from + 12 * 3600) * 1000).getDate()) : null;
    case '3M':
      return i % 4 === 0 ? fmtDate(bar.from, 'short') : null;
    case 'Y':
      return fmtDate(bar.from, 'monthShort');
  }
}

/** Steps by day, week, month, 3 months and year: the shared metric-detail layout (range, period steps, scrubbable bars with the goal line, the exact value of every bar in a list). */
export function StepsScreen() {
  const { t } = useTranslation(['today', 'common']);
  useLocale();
  const router = useRouter();
  const colors = useColors();
  const { linkState, device, dataVersion, sync, totals, watches } = useWatch();
  const { goal, isDefault } = useStepGoal();
  const [todayStart] = useState(() => startOfLocalDay(Math.floor(Date.now() / 1000)));
  const [range, setRange] = useState<MetricRange>('W');
  const [anchor, setAnchor] = useState(todayStart);
  const canSync = linkState === 'connected' && device !== null;

  const period = periodFor(range, anchor);
  const { data, error } = useStepsPeriod(period, dataVersion);
  // The previous period stays up, dimmed, until the next one has loaded.
  const stale = data !== null && (data.period.range !== period.range || data.period.from !== period.from);

  const view = useMemo(() => {
    if (!data) return null;
    // Today's bar agrees with the ring on Today: the watch's own counter when it has counted more than the stored minutes.
    const counter = ownTotalsOf(totals, watches, data.todayStart)?.steps ?? 0;
    let daily = data.daily;
    if (data.period.range !== 'D' && counter > (daily.get(data.todayStart) ?? 0) && data.period.to > data.todayStart && data.period.from <= data.todayStart) {
      daily = new Map(daily).set(data.todayStart, counter);
    }
    const bars = stepBars({ period: data.period, daily, hourly: data.hourly, goal, todayStart: data.todayStart, nowSec: data.nowSec });
    return { bars, summary: summarizeSteps(data.period.range, bars, daily, data.period, goal), period: data.period };
  }, [data, goal, totals, watches]);

  const chart = useMemo(() => {
    if (!view) return null;
    const { bars, period: p } = view;
    const r = p.range;
    const items: BarDatum[] = bars.map((b, i) => {
      const value = Math.round(b.value);
      const perDay = r === '3M' || r === 'Y';
      const title =
        r === 'D' ? fmtClock(b.from) : r === 'W' || r === 'M' ? fmtDate(b.from, 'weekday') : r === '3M' ? `${fmtDate(b.from, 'short')} - ${fmtDate(b.to - 86400, 'short')}` : fmtDate(b.from, 'month');
      return {
        key: b.from,
        value: b.future ? 0 : value,
        title,
        text: b.days === 0 && r !== 'D' ? t('common:chart.noValue') : perDay ? t('steps.perDay', { value: fmtInt(value) }) : t('week.bar', { steps: fmtInt(value), count: value }),
        short: fmtInt(value),
        hit: b.hit,
        dim: b.future,
      };
    });
    const today = bars.findIndex((b) => b.from <= todayStart && todayStart < b.to);
    return { items, current: r === 'D' ? null : today >= 0 ? today : null, bars, range: r };
  }, [view, t, todayStart]);

  const rows = useMemo<BucketRow[]>(() => {
    if (!view) return [];
    const r = view.period.range;
    const finer = FINER[r];
    const out: BucketRow[] = [];
    for (const [i, b] of view.bars.entries()) {
      if (b.future) continue;
      if (r === 'D' && b.value <= 0) continue;
      const value = b.days === 0 && r !== 'D' ? null : fmtInt(Math.round(b.value));
      const label =
        r === 'D'
          ? fmtClock(b.from)
          : r === 'W' || r === 'M'
            ? fmtDate(b.from, 'weekday')
            : r === '3M'
              ? `${fmtDate(b.from, 'short')} - ${fmtDate(b.to - 86400, 'short')}`
              : fmtDate(b.from, 'month');
      out.push({
        key: i,
        label,
        value: value === null ? null : r === '3M' || r === 'Y' ? t('steps.perDay', { value }) : t('steps.steps', { value, count: Math.round(b.value) }),
        hit: b.hit,
        onPress:
          finer && b.days > 0
            ? () => {
                setRange(finer);
                setAnchor(finer === 'M' ? monthStart(b.from) : b.from);
              }
            : undefined,
      });
    }
    return out.reverse();
  }, [view, t]);

  const onRange = (next: MetricRange) => {
    setRange(next);
    setAnchor(anchorFor(period, todayStart));
  };

  const current = view?.period ?? period;
  const todayInside = holdsToday(period, todayStart);
  const busiest = view && view.period.range === 'D' ? view.bars.reduce((best, b, i) => (b.value > view.bars[best].value ? i : best), 0) : -1;
  const left = stepsLeft(goal, view?.summary.total ?? 0);

  return (
    <Screen refresh={{ refreshing: linkState === 'syncing', onRefresh: () => void sync(), enabled: canSync }}>
      <HiddenTabHeader title={t('steps.title')} />
      <RangeHeader
        range={range}
        onRange={onRange}
        label={periodLabel(period, todayStart)}
        onPrev={() => setAnchor(shiftAnchor(period, -1))}
        onNext={canStepForward(period, todayStart) ? () => setAnchor(shiftAnchor(period, 1)) : null}
        onToday={todayInside ? null : () => setAnchor(todayStart)}
      />
      {error ? <Notice tone="danger">{t('steps.loadError', { error })}</Notice> : null}
      {!view || !chart ? (
        error ? null : <Skeleton width="100%" height={300} radius="card" />
      ) : (
        <View style={[styles.body, stale ? styles.stale : null]}>
          <Card>
            <View style={styles.headline}>
              <View style={styles.figure}>
                {view.summary.headline !== null ? (
                  <Metric
                    value={fmtInt(Math.round(view.summary.headline))}
                    unit={current.range === 'D' ? t('steps.unit') : t('steps.unitPerDay')}
                    size="lg"
                    color={colors.stepsText}
                    unitColor={colors.mutedForeground}
                  />
                ) : (
                  <Metric value="--" unit={current.range === 'D' ? t('steps.unit') : t('steps.unitPerDay')} size="lg" unitColor={colors.mutedForeground} />
                )}
              </View>
              {current.range === 'D' ? (
                current.from === todayStart && view.summary.headline !== null ? (
                  <InfoPill label={left === 0 ? t('week.reached') : t('week.left', { value: fmtInt(left) })} tint={left === 0 ? 'steps' : undefined} />
                ) : null
              ) : view.summary.days > 0 ? (
                <InfoPill label={t('steps.daysAtGoal', { hit: view.summary.daysAtGoal, days: view.summary.days, count: view.summary.days })} tint={view.summary.daysAtGoal > 0 ? 'steps' : undefined} />
              ) : null}
            </View>
            <AppText variant="caption" muted>
              {view.summary.headline === null
                ? t('steps.empty')
                : current.range === 'D'
                  ? t('hourly.peak', { hour: fmtClock(view.bars[busiest].from), steps: fmtInt(view.bars[busiest].value), count: view.bars[busiest].value })
                  : t('steps.average', { count: view.summary.days })}
            </AppText>
            <BarChart
              data={chart.items}
              color={colors.steps}
              height={BAR_AREA_HEIGHT}
              gap={GAP[chart.range]}
              goal={chart.range === 'D' ? undefined : goal}
              current={chart.current}
              tick={(i) => tickOf(chart.range, chart.bars[i], i)}
              tickWidth={chart.range === '3M' ? 44 : chart.range === 'M' ? 20 : chart.range === 'D' ? 20 : 34}
            />
          </Card>
          {rows.length > 0 ? <BucketList rows={rows} emptyText={t('steps.noData')} /> : null}
        </View>
      )}
      <Card style={styles.goalCard}>
        <NavRow
          icon="flag"
          tint="steps"
          title={t('steps.goalTitle')}
          subtitle={isDefault ? t('steps.goalDefault') : undefined}
          value={t('steps.goalValue', { value: fmtInt(goal) })}
          onPress={() => router.push('/settings/profile', OPEN_IN_STACK)}
        />
      </Card>
      <MoreText muted>{t('steps.about')}</MoreText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.lg },
  stale: { opacity: 0.55 },
  // A five or six digit figure in a dot-matrix face is wide: the pill drops under it instead of squeezing it, and the figure itself shrinks to the card.
  headline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: spacing.md, rowGap: spacing.sm },
  figure: { flexShrink: 1, maxWidth: '100%' },
  goalCard: { padding: 0 },
});
