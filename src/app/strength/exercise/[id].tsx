import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ChipRow } from '@/components/ChipRow';
import { IconChip } from '@/components/IconChip';
import { KeyValue } from '@/components/KeyValue';
import { PressableScale } from '@/components/PressableScale';
import { Card, Screen, Section } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { Skeleton } from '@/components/States';
import { exerciseImageUrl } from '@/features/coach/exercises';
import { CHART_RANGES, inRange, type ChartRange } from '@/features/strength/chartScale';
import {
  availableMetrics,
  exerciseRecords,
  exerciseSeries,
  exerciseSessions,
  repRecords,
  type ExerciseMetric,
  type RecordEntry,
} from '@/features/strength/exerciseStats';
import { useStrengthHistory } from '@/features/strength/history';
import { BarChart, LineChart, type ChartDatum } from '@/features/strength/ui/Chart';
import { kgToUnit } from '@/features/strength/units';
import { useWeightUnit } from '@/features/strength/useWeightUnit';
import { secondsText, setText, unitNumber, unitText, unitVolumeText, volumeText, weightText } from '@/features/strength/ui/liftFormat';
import { fmtDate, fmtInt, useLocale } from '@/i18n';
import { spacing, tintColors, useColors, useTheme } from '@/theme';
import { useNow } from '@/hooks/useNow';

const SESSION_STEP = 8;
const REP_ROWS = 8;

/** Charts drawn as a line; the others are bars per workout. */
const LINE_METRICS: readonly ExerciseMetric[] = ['bestSet', 'e1rm'];

/** Charts whose values are kg (volume is kg x reps); the chart scales them to the chosen unit. */
const WEIGHT_METRICS: readonly ExerciseMetric[] = ['bestSet', 'e1rm', 'volume'];

export default function StrengthExerciseScreen() {
  const { id: raw } = useLocalSearchParams<{ id: string }>();
  const id = String(raw ?? '');
  const { t } = useTranslation(['lifts', 'coach']);
  const router = useRouter();
  const colors = useColors();
  const locale = useLocale();
  const unit = useWeightUnit();
  const { ready, workouts, catalog } = useStrengthHistory();
  const [metricPick, setMetricPick] = useState<ExerciseMetric | null>(null);
  const [rangePick, setRangePick] = useState<ChartRange | null>(null);
  const [showAllReps, setShowAllReps] = useState(false);
  const [sessionLimit, setSessionLimit] = useState(SESSION_STEP);
  const now = useNow(60_000);

  const exercise = catalog.get(id);
  const name = catalog.name(id, locale) ?? t('exercise.removed');

  const metrics = useMemo(() => availableMetrics(workouts, id), [workouts, id]);
  const metric = metricPick && metrics.includes(metricPick) ? metricPick : (metrics[0] ?? null);
  const series = useMemo(() => (metric ? exerciseSeries(workouts, id, metric) : []), [workouts, id, metric]);
  // Opens on the shortest range with a line to look at; the person's own choice wins once made.
  const range = useMemo<ChartRange>(() => {
    if (rangePick) return rangePick;
    return CHART_RANGES.find((r) => inRange(series, r, now).length >= 2) ?? 'all';
  }, [rangePick, series, now]);

  const records = useMemo(() => exerciseRecords(workouts, id), [workouts, id]);
  const reps = useMemo(() => repRecords(workouts, id), [workouts, id]);
  const sessions = useMemo(() => exerciseSessions(workouts, id), [workouts, id]);

  // The series are kg (volume: kg x reps). The chart takes them in the chosen unit so its axis ticks land on round pounds too.
  const data = useMemo<ChartDatum[]>(
    () =>
      inRange(series, range, now).map((p) => ({
        at: p.at,
        value: metric !== null && WEIGHT_METRICS.includes(metric) ? kgToUnit(p.value, unit) : p.value,
        detail: metric === 'bestSet' && p.best ? (setText(p.best) ?? undefined) : undefined,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, range, metric, locale, unit, now],
  );

  const openWorkout = (workoutId: string) => router.push({ pathname: '/strength/summary/[id]', params: { id: workoutId } });
  const dateOf = (ms: number) => fmtDate(ms / 1000, 'medium');

  const metricLabel = (m: ExerciseMetric) => t(`metric.${m}`);
  const formatters = chartFormatters(metric, (v) => t('unit.reps', { count: Math.round(v), value: fmtInt(v) }));
  const muscles = exercise ? exercise.primary.map((m) => t(`coach:muscle.${m}`)).join(', ') : '';
  const equipment = exercise ? t(`coach:equipment.${exercise.equipment}`) : '';
  const imageCount = exercise?.def?.images ?? 0;

  const rangeOptions = CHART_RANGES.map((r) => ({ value: r, label: t(`range.${r}`) }));

  const recordRows: { key: string; label: string; entry: RecordEntry; value: string }[] = [];
  if (records.weight) {
    recordRows.push({
      key: 'weight',
      label: t('records.weight'),
      entry: records.weight,
      value: setText({ weightKg: records.weight.value, reps: records.weight.reps, seconds: null }) ?? weightText(records.weight.value),
    });
  }
  if (records.e1rm) recordRows.push({ key: 'e1rm', label: t('records.e1rm'), entry: records.e1rm, value: weightText(records.e1rm.value) });
  if (records.volume) recordRows.push({ key: 'volume', label: t('records.volume'), entry: records.volume, value: volumeText(records.volume.value) });
  if (records.time) recordRows.push({ key: 'time', label: t('records.time'), entry: records.time, value: secondsText(records.time.value) });

  return (
    <Screen>
      <Stack.Screen options={{ title: name }} />
      <Card>
        <View style={styles.head}>
          <Thumbnail id={id} images={imageCount} />
          <View style={styles.headText}>
            <AppText variant="heading" numberOfLines={3}>
              {name}
            </AppText>
            {exercise ? (
              <AppText variant="caption" muted>
                {t('exercise.musclesLine', { muscles, equipment })}
              </AppText>
            ) : (
              <AppText variant="caption" muted>
                {t('exercise.removedHint')}
              </AppText>
            )}
          </View>
        </View>
        {sessions.length > 0 ? (
          <AppText variant="caption" muted>
            {t('exercise.summary', { count: sessions.length, last: dateOf(sessions[0]!.at) })}
          </AppText>
        ) : null}
      </Card>

      {!ready ? (
        <>
          <Skeleton width="100%" height={300} radius="card" />
          <Skeleton width="100%" height={160} radius="card" />
        </>
      ) : sessions.length === 0 ? (
        <Card>
          <View style={styles.none}>
            <IconChip icon="stats-chart" size="lg" />
            <AppText variant="heading" style={styles.centered}>
              {t('exercise.noSessions.title')}
            </AppText>
            <AppText variant="caption" muted style={styles.centered}>
              {t('exercise.noSessions.description')}
            </AppText>
          </View>
        </Card>
      ) : (
        <>
          <Section title={t('exercise.progress')} icon="trending-up" tint="workouts">
            <ChipRow
              bleed={false}
              inset={0}
              fadeColor={colors.card}
              items={metrics.map((m) => ({ key: m, label: metricLabel(m), selected: m === metric, role: 'radio' as const, onPress: () => setMetricPick(m) }))}
            />
            <Segmented options={rangeOptions} value={range} onChange={setRangePick} />
            {metric ? (
              LINE_METRICS.includes(metric) ? (
                <LineChart
                  data={data}
                  color={colors.primary}
                  label={t('chart.label', { metric: metricLabel(metric), exercise: name })}
                  empty={t('chart.emptyRange')}
                  hint={t('chart.hint')}
                  formatDate={(at) => fmtDate(at / 1000, 'short')}
                  formatDateFull={(at) => fmtDate(at / 1000, 'medium')}
                  {...formatters}
                />
              ) : (
                <BarChart
                  data={data}
                  color={colors.primary}
                  label={t('chart.label', { metric: metricLabel(metric), exercise: name })}
                  empty={t('chart.emptyRange')}
                  hint={t('chart.hint')}
                  formatDate={(at) => fmtDate(at / 1000, 'short')}
                  formatDateFull={(at) => fmtDate(at / 1000, 'medium')}
                  {...formatters}
                />
              )
            ) : null}
          </Section>

          {recordRows.length > 0 ? (
            <Section title={t('records.title')} icon="trophy" tint="workouts">
              {recordRows.map((row) => (
                <PressableScale
                  key={row.key}
                  accessibilityRole="button"
                  accessibilityLabel={t('records.rowA11y', { label: row.label, value: row.value, date: dateOf(row.entry.at) })}
                  scaleTo={0.985}
                  onPress={() => openWorkout(row.entry.workoutId)}
                  style={styles.record}>
                  <KeyValue label={row.label} value={t('records.valueOn', { value: row.value, date: dateOf(row.entry.at) })} />
                </PressableScale>
              ))}
            </Section>
          ) : null}

          {reps.length > 0 ? (
            <Section title={t('repRecords.title')} icon="list" tint="workouts">
              <AppText variant="caption" muted>
                {t('repRecords.caption')}
              </AppText>
              <View style={styles.tableHead}>
                <AppText variant="label" muted style={styles.colWeight}>
                  {t('repRecords.weight')}
                </AppText>
                <AppText variant="label" muted style={styles.colReps}>
                  {t('repRecords.reps')}
                </AppText>
                <AppText variant="label" muted style={styles.colDate}>
                  {t('repRecords.date')}
                </AppText>
              </View>
              {(showAllReps ? reps : reps.slice(0, REP_ROWS)).map((r) => (
                <PressableScale
                  key={r.weightKg}
                  accessibilityRole="button"
                  accessibilityLabel={t('repRecords.rowA11y', {
                    weight: r.weightKg > 0 ? weightText(r.weightKg) : t('repRecords.bodyweight'),
                    reps: fmtInt(r.reps),
                    date: dateOf(r.at),
                  })}
                  scaleTo={0.985}
                  onPress={() => openWorkout(r.workoutId)}
                  style={styles.tableRow}>
                  <AppText variant="bodyStrong" style={styles.colWeight}>
                    {r.weightKg > 0 ? weightText(r.weightKg) : t('repRecords.bodyweight')}
                  </AppText>
                  <AppText variant="bodyStrong" style={[styles.colReps, styles.num]}>
                    {fmtInt(r.reps)}
                  </AppText>
                  <AppText variant="caption" muted style={styles.colDate}>
                    {fmtDate(r.at / 1000, 'short')}
                  </AppText>
                </PressableScale>
              ))}
              {reps.length > REP_ROWS ? (
                <Button
                  label={showAllReps ? t('repRecords.showLess') : t('repRecords.showAll', { n: reps.length })}
                  variant="ghost"
                  onPress={() => setShowAllReps((v) => !v)}
                />
              ) : null}
            </Section>
          ) : null}

          <Section title={t('sessions.title')} icon="calendar" tint="workouts">
            {sessions.slice(0, sessionLimit).map((s) => {
              const sets = s.sets.map((set) => setText(set)).filter((x): x is string => x !== null);
              const best = s.best ? setText(s.best) : null;
              return (
                <PressableScale
                  key={s.workoutId}
                  accessibilityRole="button"
                  accessibilityLabel={t('sessions.rowA11y', { date: dateOf(s.at), sets: sets.length })}
                  scaleTo={0.985}
                  onPress={() => openWorkout(s.workoutId)}
                  style={styles.session}>
                  <View style={styles.sessionHead}>
                    <View style={styles.headText}>
                      <AppText variant="bodyStrong">{dateOf(s.at)}</AppText>
                      <AppText variant="caption" muted numberOfLines={1}>
                        {s.name.trim() || t('row.untitled')}
                      </AppText>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
                  </View>
                  <View style={styles.setWrap}>
                    {sets.map((text, i) => (
                      <SetPill key={i} text={text} highlight={text === best && i === sets.indexOf(best)} />
                    ))}
                  </View>
                  {best ? (
                    <AppText variant="caption" muted>
                      {t('sessions.best', { set: best })}
                    </AppText>
                  ) : null}
                </PressableScale>
              );
            })}
            {sessions.length > sessionLimit ? (
              <Button
                label={t('sessions.more', { n: Math.min(SESSION_STEP, sessions.length - sessionLimit) })}
                variant="ghost"
                onPress={() => setSessionLimit((n) => n + SESSION_STEP)}
              />
            ) : null}
          </Section>
        </>
      )}
    </Screen>
  );
}

function chartFormatters(metric: ExerciseMetric | null, repsText: (value: number) => string) {
  switch (metric) {
    case 'volume':
      return { formatValue: unitVolumeText, formatTick: (v: number) => fmtInt(v) };
    case 'reps':
      return { formatValue: repsText, formatTick: (v: number) => fmtInt(v) };
    case 'time':
    case 'totalTime':
      return { formatValue: secondsText, formatTick: (v: number) => fmtInt(v) };
    default:
      return { formatValue: unitText, formatTick: unitNumber };
  }
}

function Thumbnail({ id, images }: { id: string; images: number }) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  if (images === 0 || failed) return <IconChip icon="barbell" tint="workouts" size="lg" />;
  return (
    <Image
      source={{ uri: exerciseImageUrl(id, 0) }}
      accessible={false}
      importantForAccessibility="no"
      resizeMode="cover"
      onError={() => setFailed(true)}
      style={[styles.thumb, { backgroundColor: colors.muted }]}
    />
  );
}

function SetPill({ text, highlight }: { text: string; highlight: boolean }) {
  const { colors } = useTheme();
  const tint = tintColors(colors, 'workouts');
  return (
    <View style={[styles.pill, { backgroundColor: highlight ? tint.soft : colors.muted }]}>
      <AppText variant="caption" color={highlight ? tint.text : colors.foreground} style={styles.num}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headText: { flex: 1, gap: 2 },
  thumb: { width: 72, height: 72, borderRadius: 12 },
  none: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  centered: { textAlign: 'center' },
  record: { minHeight: 40, justifyContent: 'center' },
  tableHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tableRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 40 },
  colWeight: { flex: 2 },
  colReps: { flex: 1, textAlign: 'right' },
  colDate: { flex: 2, textAlign: 'right' },
  num: { fontVariant: ['tabular-nums'] },
  session: { gap: spacing.sm, paddingVertical: spacing.sm },
  sessionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  setWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pill: { paddingHorizontal: spacing.sm + 2, paddingVertical: 4, borderRadius: 999 },
});
