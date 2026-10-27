/** The "Strength" block of the watch workout screen for a workout that is also a logged strength workout. */
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Metric } from '@/components/Metric';
import { Section } from '@/components/Screen';
import { bestSet, isCounted, workoutTotals } from '@/features/strength/calc';
import type { Catalog } from '@/features/strength/catalog';
import type { StrengthWorkout } from '@/features/strength/types';
import { fmtInt, useLocale } from '@/i18n';
import { spacing } from '@/theme';

import { timerText } from '../logFormat';
import { useWeightUnit } from '../useWeightUnit';
import { setText, volumeText } from './liftFormat';
import { OPEN_IN_STACK } from '@/components/navigation';

interface StrengthDetailSectionProps {
  strength: StrengthWorkout;
  catalog: Catalog;
}

export function StrengthDetailSection({ strength, catalog }: StrengthDetailSectionProps) {
  const { t } = useTranslation('lifts');
  const router = useRouter();
  const locale = useLocale();
  const unit = useWeightUnit();
  const totals = useMemo(() => workoutTotals(strength), [strength]);
  const rows = useMemo(
    () =>
      strength.exercises
        .map((entry) => {
          const sets = entry.sets.filter(isCounted);
          const best = bestSet(sets);
          return {
            key: entry.key,
            name: catalog.name(entry.exerciseId, locale) ?? t('exercise.removed'),
            sets: sets.length,
            best: best ? setText(best) : null,
          };
        })
        .filter((row) => row.sets > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [strength, catalog, locale, t, unit],
  );

  return (
    <Section title={t('detail.title')} icon="barbell" tint="workouts">
      <View style={styles.figures}>
        <Figure label={t('detail.volume')} value={volumeText(totals.volume)} />
        <Figure label={t('detail.sets')} value={fmtInt(totals.sets)} />
        {totals.reps > 0 || totals.seconds === 0 ? <Figure label={t('detail.reps')} value={fmtInt(totals.reps)} /> : null}
        {totals.seconds > 0 ? <Figure label={t('detail.time')} value={timerText(totals.seconds)} /> : null}
      </View>
      {rows.map((row) => (
        <View key={row.key} style={styles.row} accessible accessibilityLabel={row.best ? t('detail.rowA11y', { name: row.name, count: row.sets, best: row.best }) : row.name}>
          <View style={styles.rowText}>
            <AppText variant="bodyStrong" numberOfLines={2}>
              {row.name}
            </AppText>
            <AppText variant="caption" muted>
              {t('detail.setsCount', { count: row.sets })}
            </AppText>
          </View>
          {row.best ? (
            <AppText variant="bodyStrong" style={styles.best}>
              {row.best}
            </AppText>
          ) : null}
        </View>
      ))}
      <Button
        label={t('detail.open')}
        variant="secondary"
        icon="open-outline"
        onPress={() => router.push({ pathname: '/strength/summary/[id]', params: { id: strength.id } }, OPEN_IN_STACK)}
      />
    </Section>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.figure}>
      <AppText variant="label" muted numberOfLines={1}>
        {label}
      </AppText>
      <Metric value={value} size="md" />
    </View>
  );
}

const styles = StyleSheet.create({
  figures: { flexDirection: 'row', gap: spacing.md },
  figure: { flex: 1, gap: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 44 },
  rowText: { flex: 1, gap: 0 },
  best: { fontVariant: ['tabular-nums'] },
});
