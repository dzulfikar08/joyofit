/** This week's workouts, volume and sets, and how steady the last weeks were. */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Metric } from '@/components/Metric';
import { Card } from '@/components/Screen';
import { consistency, weekStreak, weekTotals } from '@/features/strength/historyModel';
import type { StrengthWorkout } from '@/features/strength/types';
import { fmtInt } from '@/i18n';
import { spacing } from '@/theme';

import { useWeightUnit } from '../useWeightUnit';
import { volumeText } from './liftFormat';

const CONSISTENCY_WEEKS = 8;

export function WeekStrip({ workouts }: { workouts: readonly StrengthWorkout[] }) {
  const { t } = useTranslation('lifts');
  useWeightUnit();
  const stats = useMemo(() => {
    const now = Date.now();
    return {
      week: weekTotals(workouts, now),
      streak: weekStreak(workouts, now),
      steady: consistency(workouts, now, CONSISTENCY_WEEKS),
    };
  }, [workouts]);
  const { week, streak, steady } = stats;
  return (
    <Card>
      <AppText variant="label" muted accessibilityRole="header">
        {t('week.title')}
      </AppText>
      <View style={styles.figures}>
        <Figure label={t('week.workouts')} value={fmtInt(week.workouts)} />
        <Figure label={t('week.volume')} value={volumeText(week.volume)} />
        <Figure label={t('week.sets')} value={fmtInt(week.sets)} />
      </View>
      {steady.activeWeeks > 0 ? (
        <AppText variant="caption" muted>
          {streak >= 2
            ? t('week.streak', { count: streak, active: steady.activeWeeks, weeks: steady.weeks })
            : t('week.steady', { active: steady.activeWeeks, weeks: steady.weeks })}
        </AppText>
      ) : null}
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={styles.figure}>
      <AppText variant="caption" muted numberOfLines={1}>
        {label}
      </AppText>
      <Metric value={value} size="sm" />
    </View>
  );
}

const styles = StyleSheet.create({
  figures: { flexDirection: 'row', gap: spacing.md },
  figure: { flex: 1, gap: 0 },
});
