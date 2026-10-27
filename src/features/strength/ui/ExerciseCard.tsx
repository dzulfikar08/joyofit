import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { PressableScale } from '@/components/PressableScale';
import { HIT, spacing, tintColors, useColors, useTheme, type Tint } from '@/theme';

import { setLabels } from '../draft';
import { restLabel, type PreviousSet } from '../logFormat';
import type { SetTimer } from '../setTimer';
import { useWeightUnit } from '../useWeightUnit';
import type { StrengthExercise } from '../types';
import { MeasureToggle } from './MeasureToggle';
import { COLUMN, SetRow, type SetRowActions } from './SetRow';

export interface ExerciseCardActions extends SetRowActions {
  onAddSet: (exerciseKey: string) => void;
  onInfo: (exerciseKey: string) => void;
  onExerciseMenu: (exerciseKey: string) => void;
  onNote: (exerciseKey: string) => void;
  onRest: (exerciseKey: string) => void;
  /** Measures the exercise in seconds (`true`) or repetitions (`false`); the screen confirms first when sets hold values. */
  onMeasure: (exerciseKey: string, timed: boolean) => void;
  /** Opens the plate calculator for the exercise's loads. */
  onPlates: (exerciseKey: string) => void;
}

/** One colour per superset letter; they cycle. */
const RAIL_TINTS: readonly Tint[] = ['link', 'heart', 'workouts', 'sleep'];

interface ExerciseCardProps {
  entry: StrengthExercise;
  name: string;
  /** Primary muscles, already translated. */
  muscles: string;
  timed: boolean;
  /** The stopwatch running on a set of this exercise, else null. */
  timer: SetTimer | null;
  /** `A`, `B`, ... when the exercise is in a superset. */
  superset: string | null;
  previous: readonly PreviousSet[] | null;
  /** Seconds the rest timer of this exercise runs after a set (the effective value). */
  restSec: number;
  showRpe: boolean;
  /** The set whose tick was refused and how often: makes its field shake. */
  flash: { exerciseKey: string; setId: string; n: number } | null;
  actions: ExerciseCardActions;
}

function ExerciseCardView({ entry, name, muscles, timed, timer, superset, previous, restSec, showRpe, flash, actions }: ExerciseCardProps) {
  const { t } = useTranslation('strength');
  // The card is memoised: the column header has to follow a switch of kg and lb on its own.
  const unit = useWeightUnit();
  const { colors, radius } = useTheme();
  const labels = setLabels(entry.sets);
  const rail = superset ? tintColors(colors, RAIL_TINTS[(superset.charCodeAt(0) - 65) % RAIL_TINTS.length]!).base : null;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderRadius: radius.card },
        rail ? { borderLeftWidth: 5, borderLeftColor: rail } : null,
      ]}>
      <View style={styles.head}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('exercise.openInfo', { name })}
          onPress={() => actions.onInfo(entry.key)}
          scaleTo={0.985}
          style={styles.title}>
          <AppText variant="heading" numberOfLines={2} color={colors.primary}>
            {name}
          </AppText>
          {muscles ? (
            <AppText variant="caption" muted numberOfLines={1}>
              {muscles}
            </AppText>
          ) : null}
        </PressableScale>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('exercise.menu', { name })}
          onPress={() => actions.onExerciseMenu(entry.key)}
          style={styles.menu}>
          <Ionicons name="ellipsis-horizontal" size={22} color={colors.foreground} />
        </PressableScale>
      </View>

      <View style={styles.chips}>
        <MeasureToggle timed={timed} name={name} onChange={(next) => actions.onMeasure(entry.key, next)} />
        {superset ? (
          <View style={[styles.pill, { backgroundColor: rail ?? colors.muted }]}>
            <AppText variant="label" color={colors.primaryForeground}>
              {t('exercise.superset', { letter: superset })}
            </AppText>
          </View>
        ) : null}
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('exercise.restChip', { value: restLabel(restSec) })}
          onPress={() => actions.onRest(entry.key)}
          style={[styles.pill, { backgroundColor: colors.muted }]}>
          <Ionicons name="timer-outline" size={14} color={colors.mutedForeground} />
          <AppText variant="label" muted>
            {restLabel(restSec)}
          </AppText>
        </PressableScale>
        {!timed && entry.sets.some((set) => set.weightKg !== null && set.weightKg > 0) ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t('plates.open', { name })}
            onPress={() => actions.onPlates(entry.key)}
            style={[styles.pill, { backgroundColor: colors.muted }]}>
            <Ionicons name="barbell-outline" size={14} color={colors.mutedForeground} />
            <AppText variant="label" muted>
              {t('plates.chip')}
            </AppText>
          </PressableScale>
        ) : null}
      </View>

      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={entry.note ? t('exercise.noteEdit') : t('exercise.noteAdd')}
        onPress={() => actions.onNote(entry.key)}
        scaleTo={0.99}>
        <AppText variant="caption" muted={entry.note.length === 0} numberOfLines={3}>
          {entry.note || t('exercise.noteAdd')}
        </AppText>
      </PressableScale>

      <View style={styles.table}>
        <View style={styles.header}>
          <AppText variant="label" muted style={[styles.hSet, { width: COLUMN.set }]}>
            {t('table.set')}
          </AppText>
          <AppText variant="label" muted style={[styles.hPrevious, timed && styles.hPreviousTimed]}>
            {t('table.previous')}
          </AppText>
          <AppText variant="label" muted style={styles.hField}>
            {t(`table.${unit}`)}
          </AppText>
          <AppText variant="label" muted style={styles.hField}>
            {timed ? t('table.time') : t('table.reps')}
          </AppText>
          {timed ? <View style={{ width: COLUMN.timer }} /> : null}
          {showRpe ? (
            <AppText variant="label" muted style={[styles.hSet, { width: COLUMN.rpe }]}>
              {t('table.rpe')}
            </AppText>
          ) : null}
          <View style={{ width: COLUMN.check }} />
        </View>
        {entry.sets.map((set, index) => (
          <SetRow
            key={set.id}
            exerciseKey={entry.key}
            set={set}
            label={labels[index] ?? String(index + 1)}
            previous={previous?.[index] ?? null}
            timed={timed}
            timer={timer?.setId === set.id ? timer : null}
            showRpe={showRpe}
            flash={flash?.setId === set.id ? flash.n : 0}
            actions={actions}
          />
        ))}
      </View>

      <Button label={t('exercise.addSet')} icon="add" onPress={() => actions.onAddSet(entry.key)} />
    </View>
  );
}

export const ExerciseCard = memo(ExerciseCardView);

const styles = StyleSheet.create({
  card: { padding: spacing.md, gap: spacing.sm, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  title: { flex: 1, gap: 2, minHeight: HIT, justifyContent: 'center' },
  menu: { width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.md, minHeight: 28, borderRadius: 14 },
  table: { gap: 2 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xs },
  hSet: { textAlign: 'center' },
  hPrevious: { flex: 1.3, textAlign: 'center' },
  hPreviousTimed: { flex: 0.9 },
  hField: { flex: 1, textAlign: 'center' },
});
