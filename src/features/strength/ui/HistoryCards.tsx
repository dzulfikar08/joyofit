/**
 * The rows of the history list and of the calendar's day list: a strength workout (name, date, duration, volume, sets, records,
 * energy) and a watch workout of another sport.
 */
import { Ionicons } from '@expo/vector-icons';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { IconChip } from '@/components/IconChip';
import { Metric } from '@/components/Metric';
import { PressableScale } from '@/components/PressableScale';
import { workoutTotals } from '@/features/strength/calc';
import type { WatchRow } from '@/features/strength/historyModel';
import type { StrengthWorkout } from '@/features/strength/types';
import { sportIcon } from '@/features/workouts/sportIcon';
import { sportLabel } from '@/features/workouts/sportLabel';
import { fmtClock, fmtDate, fmtDuration, fmtInt, useLocale } from '@/i18n';
import { spacing, tintColors, useTheme } from '@/theme';

import { useWeightUnit } from '../useWeightUnit';
import { volumeText } from './liftFormat';

interface StrengthCardProps {
  workout: StrengthWorkout;
  /** Records the workout set. */
  prs: number;
  /** `weekday` date and clock, or just the clock when the card sits under a day heading. */
  showDate?: boolean;
  onPress: (workout: StrengthWorkout) => void;
}

function StrengthCardView({ workout, prs, showDate = true, onPress }: StrengthCardProps) {
  const { t } = useTranslation('lifts');
  const { colors, radius } = useTheme();
  const locale = useLocale();
  useWeightUnit();
  const totals = useMemo(() => workoutTotals(workout), [workout]);
  const when = useMemo(() => {
    const clock = fmtClock(new Date(workout.startedAt));
    return showDate ? t('row.dateTime', { date: fmtDate(workout.startedAt / 1000, 'weekday'), time: clock }) : clock;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workout.startedAt, showDate, locale, t]);
  const name = workout.name.trim() || t('row.untitled');
  const tint = tintColors(colors, 'workouts');
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t('row.a11y', { name, date: when })}
      onPress={() => onPress(workout)}
      style={[styles.card, { backgroundColor: colors.card, borderRadius: radius.card }]}>
      <View style={styles.head}>
        <View style={styles.title}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {name}
          </AppText>
          <AppText variant="caption" muted numberOfLines={1}>
            {when}
          </AppText>
        </View>
        {prs > 0 ? (
          <View accessible accessibilityLabel={t('row.prs', { count: prs })} style={[styles.badge, { backgroundColor: tint.soft }]}>
            <Ionicons name="trophy" size={14} color={tint.text} />
            <AppText variant="label" color={tint.text}>
              {fmtInt(prs)}
            </AppText>
          </View>
        ) : null}
        <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
      </View>
      <View style={styles.metrics}>
        <Metric value={fmtDuration(workout.durationSec)} size="sm" />
        {totals.volume > 0 ? <Metric value={volumeText(totals.volume)} size="sm" /> : null}
        <Metric value={fmtInt(totals.sets)} unit={t('unit.sets', { count: totals.sets })} size="sm" />
        {workout.kcal !== null && workout.kcal > 0 ? <Metric value={fmtInt(workout.kcal)} unit={t('unit.kcal')} size="sm" /> : null}
      </View>
    </PressableScale>
  );
}

export const StrengthCard = memo(StrengthCardView);

interface WatchCardProps {
  row: WatchRow;
  onPress: (row: WatchRow) => void;
}

/** A workout from the watch that is not a strength workout, in the calendar's day list. */
export function WatchCard({ row, onPress }: WatchCardProps) {
  const { t } = useTranslation('lifts');
  const { colors, radius } = useTheme();
  const sport = sportLabel(row.sportName);
  const clock = fmtClock(row.start);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t('row.a11y', { name: sport, date: clock })}
      onPress={() => onPress(row)}
      style={[styles.card, { backgroundColor: colors.card, borderRadius: radius.card }]}>
      <View style={styles.head}>
        <IconChip sport={sportIcon(row.sportName)} tint="workouts" />
        <View style={styles.title}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {sport}
          </AppText>
          <AppText variant="caption" muted numberOfLines={1}>
            {clock}
          </AppText>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
      </View>
      <View style={styles.metrics}>
        <Metric value={fmtDuration(row.duration)} size="sm" />
        {row.calories > 0 ? <Metric value={fmtInt(row.calories)} unit={t('unit.kcal')} size="sm" /> : null}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md + 4, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { flex: 1, gap: 2 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: 999 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md },
});
