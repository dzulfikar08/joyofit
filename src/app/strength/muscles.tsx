import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { Screen, Section } from '@/components/Screen';
import { Skeleton } from '@/components/States';
import { MUSCLE_GROUPS, weeklyMuscleLoad, type MuscleGroup } from '@/features/strength/calc';
import { HEAT_FROM, WEEKLY_TARGET_SETS, heatFill, heatLevel, readableOn, weekContributors, type HeatLevel } from '@/features/strength/heat';
import { useStrengthHistory } from '@/features/strength/history';
import { BottomSheet } from '@/features/strength/ui/Sheet';
import { fmtDay, fmtInt, fmtNumber, useLocale } from '@/i18n';
import { spacing, useColors, useTheme } from '@/theme';
import { useNow } from '@/hooks/useNow';

const WEEKS = 8;
const LEVELS: readonly HeatLevel[] = [0, 1, 2, 3, 4];

interface Picked {
  group: MuscleGroup;
  week: string;
}

export default function StrengthMusclesScreen() {
  const { t } = useTranslation(['lifts', 'coach']);
  const router = useRouter();
  const colors = useColors();
  const { radius } = useTheme();
  const locale = useLocale();
  const { ready, workouts, catalog } = useStrengthHistory();
  const [picked, setPicked] = useState<Picked | null>(null);
  const now = useNow(60_000);

  const weeks = useMemo(() => weeklyMuscleLoad(workouts, catalog.muscles, now, WEEKS), [workouts, catalog, now]);
  const current = weeks[weeks.length - 1]!;
  const thisWeek = useMemo(
    () => MUSCLE_GROUPS.map((group) => ({ group, sets: current.sets.get(group) ?? 0 })).sort((a, b) => b.sets - a.sets),
    [current],
  );
  const contributors = useMemo(
    () => (picked ? weekContributors(workouts, catalog.muscles, picked.group, picked.week) : []),
    [picked, workouts, catalog],
  );

  const fillOf = (level: HeatLevel) => heatFill(level, colors.muted, colors.primary);
  const inkOn = (fill: string) => readableOn(fill, [colors.foreground, colors.card]);
  const groupName = (group: MuscleGroup) => t(`group.${group}`);
  const weekLabel = (week: string) => fmtDay(week, 'short');
  const setsText = (sets: number) => fmtNumber(sets, 1);

  const legendLabel = (level: HeatLevel): string => {
    if (level === 0) return t('heat.legend.none');
    if (level === 4) return t('heat.legend.from', { from: fmtInt(HEAT_FROM[2]) });
    const from = level === 1 ? 1 : HEAT_FROM[level - 2]!;
    return t('heat.legend.range', { from: fmtInt(from), to: fmtInt(HEAT_FROM[level - 1]! - 1) });
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t('heat.title') }} />
      <AppText variant="caption" muted>
        {t('heat.intro')}
      </AppText>

      {!ready ? (
        <Skeleton width="100%" height={420} radius="card" />
      ) : (
        <>
          <Section title={t('heat.gridTitle', { count: WEEKS })} icon="grid" tint="workouts">
            <View style={styles.row}>
              <View style={styles.label} />
              {weeks.map((w) => (
                <View key={w.week} style={styles.colHead} accessible accessibilityLabel={t('heat.weekA11y', { week: weekLabel(w.week) })}>
                  <AppText variant="caption" muted numberOfLines={1} style={styles.colText}>
                    {fmtInt(Number(w.week.slice(8)))}
                  </AppText>
                </View>
              ))}
            </View>
            {MUSCLE_GROUPS.map((group) => (
              <View key={group} style={styles.row}>
                <AppText variant="caption" numberOfLines={1} style={styles.label}>
                  {groupName(group)}
                </AppText>
                {weeks.map((w) => {
                  const sets = w.sets.get(group) ?? 0;
                  const fill = fillOf(heatLevel(sets));
                  return (
                    <PressableScale
                      key={w.week}
                      accessibilityRole="button"
                      accessibilityLabel={t('heat.cellA11y', { group: groupName(group), week: weekLabel(w.week), count: sets, value: setsText(sets) })}
                      scaleTo={0.9}
                      onPress={() => setPicked({ group, week: w.week })}
                      style={[styles.cell, { backgroundColor: fill, borderRadius: Math.min(radius.input, 8) }]}>
                      {sets > 0 ? (
                        <AppText variant="label" color={inkOn(fill)} style={styles.cellText} numberOfLines={1}>
                          {fmtInt(sets)}
                        </AppText>
                      ) : null}
                    </PressableScale>
                  );
                })}
              </View>
            ))}
            <AppText variant="caption" muted>
              {t('heat.weekNote')}
            </AppText>
            <View style={styles.legend} accessible accessibilityLabel={t('heat.legend.a11y', { list: LEVELS.map(legendLabel).join('; ') })}>
              {LEVELS.map((level) => (
                <View key={level} style={styles.legendItem}>
                  <View style={[styles.swatch, { backgroundColor: fillOf(level) }]} />
                  <AppText variant="caption" muted>
                    {legendLabel(level)}
                  </AppText>
                </View>
              ))}
            </View>
            <AppText variant="caption" muted>
              {t('heat.target')}
            </AppText>
          </Section>

          <Section title={t('heat.thisWeek')} icon="flame" tint="workouts">
            {thisWeek.every((r) => r.sets === 0) ? (
              <AppText variant="caption" muted>
                {t('heat.thisWeekEmpty')}
              </AppText>
            ) : null}
            {thisWeek.map(({ group, sets }) => (
              <PressableScale
                key={group}
                accessibilityRole="button"
                accessibilityLabel={t('heat.rowA11y', { group: groupName(group), count: sets, value: setsText(sets) })}
                scaleTo={0.985}
                onPress={() => setPicked({ group, week: current.week })}
                style={styles.summaryRow}>
                <AppText variant="bodyStrong" numberOfLines={1} style={styles.summaryName} color={sets > 0 ? colors.foreground : colors.mutedForeground}>
                  {groupName(group)}
                </AppText>
                <View style={[styles.track, { backgroundColor: colors.muted }]}>
                  <View style={[styles.fill, { backgroundColor: colors.primary, width: `${Math.min(100, (sets / WEEKLY_TARGET_SETS) * 100)}%` }]} />
                </View>
                <AppText variant="caption" muted style={styles.summarySets}>
                  {t('heat.sets', { count: sets, value: setsText(sets) })}
                </AppText>
              </PressableScale>
            ))}
            <AppText variant="caption" muted>
              {t('heat.secondaryNote')}
            </AppText>
          </Section>
        </>
      )}

      <BottomSheet
        visible={picked !== null}
        onClose={() => setPicked(null)}
        title={picked ? t('heat.sheet.title', { group: groupName(picked.group), week: weekLabel(picked.week) }) : undefined}>
        {contributors.length === 0 ? (
          <AppText variant="caption" muted>
            {t('heat.sheet.empty')}
          </AppText>
        ) : (
          contributors.map((c) => {
            const name = catalog.name(c.exerciseId, locale) ?? t('exercise.removed');
            return (
              <PressableScale
                key={c.exerciseId}
                accessibilityRole="button"
                accessibilityLabel={t('heat.sheet.rowA11y', { name, count: c.sets, value: setsText(c.sets) })}
                scaleTo={0.985}
                onPress={() => {
                  setPicked(null);
                  router.push({ pathname: '/strength/exercise/[id]', params: { id: c.exerciseId } });
                }}
                style={styles.contributor}>
                <View style={styles.contributorName}>
                  <AppText variant="bodyStrong" numberOfLines={2}>
                    {name}
                  </AppText>
                  {c.secondary ? (
                    <AppText variant="caption" muted>
                      {t('heat.sheet.secondary')}
                    </AppText>
                  ) : null}
                </View>
                <AppText variant="bodyStrong" style={styles.num}>
                  {t('heat.sets', { count: c.sets, value: setsText(c.sets) })}
                </AppText>
              </PressableScale>
            );
          })
        )}
        {picked ? (
          <AppText variant="caption" muted>
            {t('heat.secondaryNote')}
          </AppText>
        ) : null}
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  label: { width: 92 },
  colHead: { flex: 1, alignItems: 'center' },
  colText: { fontVariant: ['tabular-nums'] },
  cell: { flex: 1, height: 34, alignItems: 'center', justifyContent: 'center' },
  cellText: { fontVariant: ['tabular-nums'] },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: spacing.xs },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  swatch: { width: 14, height: 14, borderRadius: 4 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 40 },
  summaryName: { width: 96, flexShrink: 1 },
  track: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  summarySets: { width: 64, textAlign: 'right', fontVariant: ['tabular-nums'] },
  contributor: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 48 },
  contributorName: { flex: 1, gap: 2 },
  num: { fontVariant: ['tabular-nums'] },
});
