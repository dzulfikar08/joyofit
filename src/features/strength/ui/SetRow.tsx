import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { fontSize, spacing, tintColors, useColors, useTheme } from '@/theme';

import type { SetPatch } from '../draft';
import { inputText, previousForMeasure, previousLabel, rpeText, SET_BADGE, timerText, weightInputText, type PreviousSet } from '../logFormat';
import { timerShownSec, type SetTimer } from '../setTimer';
import { useWeightUnit } from '../useWeightUnit';
import type { SetType, StrengthSet } from '../types';
import { NumberField } from './NumberField';
import { useTicker } from './useStrengthDraft';

/** Column widths shared by the header and the rows of a set table. */
export const COLUMN = { set: 44, rpe: 56, check: 44, timer: 40 } as const;

export interface SetRowActions {
  onChange: (exerciseKey: string, setId: string, patch: SetPatch) => void;
  onToggle: (exerciseKey: string, setId: string) => void;
  onMenu: (exerciseKey: string, setId: string) => void;
  onFillPrevious: (exerciseKey: string, setId: string) => void;
  onPickRpe: (exerciseKey: string, setId: string) => void;
  /** Starts the stopwatch / countdown of a timed set, or stops it and stores the seconds. */
  onTimer: (exerciseKey: string, setId: string) => void;
}

interface SetRowProps {
  exerciseKey: string;
  set: StrengthSet;
  label: string;
  previous: PreviousSet | null;
  timed: boolean;
  /** The stopwatch running on this set, else null. */
  timer: SetTimer | null;
  showRpe: boolean;
  /** Bumps when this row's tick was refused. */
  flash: number;
  actions: SetRowActions;
}

/** The colour of the badge of a set type. */
export function useTypeColor(type: SetType): string {
  const colors = useColors();
  switch (type) {
    case 'warmup':
      return colors.warning;
    case 'drop':
      return tintColors(colors, 'link').text;
    case 'failure':
      return colors.destructive;
    default:
      return colors.mutedForeground;
  }
}

/** The seconds box of a set while its stopwatch runs: the live clock (counting down from the plan, or up), a tap stops and stores it. Redraws on its own; the list does not. */
function RunningClock({ timer, label, onPress, style }: { timer: SetTimer; label: string; onPress: () => void; style: StyleProp<ViewStyle> }) {
  const { colors, fonts, radius } = useTheme();
  const now = useTicker(true, 250);
  const shown = timerText(timerShownSec(timer, now));
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityValue={{ text: shown }}
      onPress={onPress}
      scaleTo={0.96}
      style={[styles.clock, { backgroundColor: colors.primary, borderRadius: radius.input }, style]}>
      <AppText variant="bodyStrong" color={colors.primaryForeground} style={{ fontFamily: fonts.bold, fontVariant: ['tabular-nums'] }}>
        {shown}
      </AppText>
    </PressableScale>
  );
}

function SetRowView({ exerciseKey, set, label, previous, timed, timer, showRpe, flash, actions }: SetRowProps) {
  const { t } = useTranslation('strength');
  // The row is memoised: a switch of kg and lb has to reach the "previous" label and the weight hint from here.
  const unit = useWeightUnit();
  const colors = useColors();
  const typeColor = useTypeColor(set.type);
  const badge = SET_BADGE[set.type];
  const prev = previous ? previousLabel(previousForMeasure(previous, timed), timed) : null;
  const hintOf = (n: number | null): string | undefined => (set.done || n === null ? undefined : inputText(n));
  const hintWeight = (n: number | null): string | undefined => (set.done || n === null ? undefined : weightInputText(n));
  const hintTime = (n: number | null): string | undefined => (set.done || n === null ? undefined : timerText(n));

  const typeName = t(`setType.${set.type}`);
  return (
    <View style={[styles.row, set.done && { backgroundColor: colors.workoutsSoft }]}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t('table.setLabel', { label, type: typeName })}
        onPress={() => actions.onMenu(exerciseKey, set.id)}
        scaleTo={0.92}
        style={[styles.setCell, { width: COLUMN.set }]}>
        <AppText variant="bodyStrong" color={set.type === 'normal' ? colors.foreground : typeColor}>
          {label}
        </AppText>
        {badge && (set.type === 'drop' || set.type === 'failure') ? (
          <AppText variant="label" color={typeColor} style={styles.badge}>
            {t(`setTypeShort.${set.type}`)}
          </AppText>
        ) : null}
      </PressableScale>

      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={prev ? t('table.usePrevious', { value: prev }) : t('table.noPrevious')}
        disabled={!prev}
        onPress={() => actions.onFillPrevious(exerciseKey, set.id)}
        scaleTo={0.96}
        style={[styles.previous, timed && styles.previousTimed]}>
        <AppText variant="caption" muted numberOfLines={1}>
          {prev ?? t('table.dash')}
        </AppText>
      </PressableScale>

      <NumberField
        kind="weight"
        value={set.weightKg}
        hint={hintWeight(previous?.weightKg ?? null)}
        label={t('table.weightField', { label, unit })}
        done={set.done}
        flash={0}
        onChange={(weightKg) => actions.onChange(exerciseKey, set.id, { weightKg })}
        style={styles.field}
      />
      {timed && timer ? (
        <RunningClock timer={timer} label={t('table.timerStop', { label })} onPress={() => actions.onTimer(exerciseKey, set.id)} style={styles.field} />
      ) : timed ? (
        <NumberField
          kind="seconds"
          value={set.seconds}
          hint={hintTime(previous?.seconds ?? null)}
          label={t('table.secondsField', { label })}
          done={set.done}
          flash={flash}
          onChange={(seconds) => actions.onChange(exerciseKey, set.id, { seconds })}
          style={styles.field}
        />
      ) : (
        <NumberField
          kind="reps"
          value={set.reps}
          hint={hintOf(previous?.reps ?? null)}
          label={t('table.repsField', { label })}
          done={set.done}
          flash={flash}
          onChange={(reps) => actions.onChange(exerciseKey, set.id, { reps })}
          style={styles.field}
        />
      )}
      {timed ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={timer ? t('table.timerStop', { label }) : t('table.timerStart', { label })}
          accessibilityState={{ disabled: set.done }}
          disabled={set.done}
          onPress={() => actions.onTimer(exerciseKey, set.id)}
          scaleTo={0.9}
          style={[styles.timer, { width: COLUMN.timer, backgroundColor: timer ? colors.destructive : colors.muted }]}>
          <Ionicons name={timer ? 'stop' : 'stopwatch-outline'} size={20} color={timer ? colors.primaryForeground : colors.mutedForeground} />
        </PressableScale>
      ) : null}

      {showRpe ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('table.rpeField', { label })}
          onPress={() => actions.onPickRpe(exerciseKey, set.id)}
          scaleTo={0.94}
          style={[styles.rpe, { width: COLUMN.rpe, backgroundColor: colors.muted }]}>
          <AppText variant="bodyStrong" muted={set.rpe === null}>
            {set.rpe === null ? t('table.dash') : rpeText(set.rpe)}
          </AppText>
        </PressableScale>
      ) : null}

      <PressableScale
        accessibilityRole="checkbox"
        accessibilityLabel={t('table.doneField', { label })}
        accessibilityState={{ checked: set.done }}
        onPress={() => actions.onToggle(exerciseKey, set.id)}
        scaleTo={0.9}
        style={[styles.check, { width: COLUMN.check, backgroundColor: set.done ? colors.primary : colors.muted }]}>
        <Ionicons name="checkmark" size={22} color={set.done ? colors.primaryForeground : colors.mutedForeground} />
      </PressableScale>
    </View>
  );
}

export const SetRow = memo(SetRowView);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 4, paddingHorizontal: spacing.xs, borderRadius: 12 },
  setCell: { height: 44, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 1 },
  badge: { fontSize: fontSize.xs, lineHeight: 14 },
  previous: { flex: 1.3, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  previousTimed: { flex: 0.9 },
  field: { flex: 1, minWidth: 0 },
  clock: { height: 40, alignItems: 'center', justifyContent: 'center' },
  timer: { height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rpe: { height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  check: { height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
