import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Divider } from '@/components/Screen';
import { IconAction } from '@/features/courses/IconAction';
import { fmtInt, fmtNumber, useLocale } from '@/i18n';
import { overlay, spacing, useTheme } from '@/theme';

import type { Catalog } from '../catalog';
import { summarizeSets } from '../routineEdit';
import type { Routine, RoutineExercise } from '../types';
import { inputWeight } from '../units';
import { useWeightUnit } from '../useWeightUnit';

import { MenuRows, type MenuItem } from './RoutineMenu';

interface RoutineSheetProps {
  /** The routine to preview; null keeps the sheet closed. */
  routine: Routine | null;
  /** A built-in starter: it can be started or copied, not changed. */
  starter: boolean;
  catalog: Catalog;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onClose: () => void;
  onStart: (routine: Routine) => void;
  onEdit: (routine: Routine) => void;
  onDuplicate: (routine: Routine) => void;
  onMoveToFolder: (routine: Routine) => void;
  onMoveUp: (routine: Routine) => void;
  onMoveDown: (routine: Routine) => void;
  onDelete: (routine: Routine) => void;
  onCopy: (routine: Routine) => void;
  onShare: (routine: Routine) => void;
  onExportFile: (routine: Routine) => void;
}

const range = (r: { min: number; max: number }): string => (r.min === r.max ? fmtInt(r.min) : `${fmtInt(r.min)}-${fmtInt(r.max)}`);

/** A routine's preview in a bottom sheet: its exercises with sets and reps, then what can be done with it. */
export function RoutineSheet({
  routine,
  starter,
  catalog,
  canMoveUp,
  canMoveDown,
  onClose,
  onStart,
  onEdit,
  onDuplicate,
  onMoveToFolder,
  onMoveUp,
  onMoveDown,
  onDelete,
  onCopy,
  onShare,
  onExportFile,
}: RoutineSheetProps) {
  const { t } = useTranslation('routines');
  const locale = useLocale();
  const unit = useWeightUnit();
  const { colors, radius } = useTheme();
  const accent = colors.primary;

  const summaryOf = (exercise: RoutineExercise): string => {
    const s = summarizeSets(exercise.sets);
    const weight = s.weightKg === null ? null : t(`unit.${unit}`, { value: fmtNumber(inputWeight(s.weightKg, unit), 1) });
    if (s.seconds) return t('sheet.summarySeconds', { sets: fmtInt(s.sets), seconds: range(s.seconds) });
    if (s.reps && weight) return t('sheet.summaryRepsWeight', { sets: fmtInt(s.sets), reps: range(s.reps), weight });
    if (s.reps) return t('sheet.summaryReps', { sets: fmtInt(s.sets), reps: range(s.reps) });
    return t('row.sets', { count: s.sets });
  };

  const shareItems = (r: Routine): MenuItem[] => [
    { key: 'share', label: t('share.text'), icon: 'share-social-outline', onPress: () => onShare(r) },
    { key: 'exportFile', label: t('share.file'), icon: 'document-outline', onPress: () => onExportFile(r) },
  ];

  const actions = (r: Routine): MenuItem[] => [
    { key: 'edit', label: t('sheet.edit'), icon: 'create-outline', onPress: () => onEdit(r) },
    { key: 'duplicate', label: t('sheet.duplicate'), icon: 'copy-outline', onPress: () => onDuplicate(r) },
    ...shareItems(r),
    { key: 'move', label: t('sheet.moveToFolder'), icon: 'folder-open-outline', onPress: () => onMoveToFolder(r) },
    { key: 'up', label: t('sheet.moveUp'), icon: 'arrow-up', disabled: !canMoveUp, onPress: () => onMoveUp(r) },
    { key: 'down', label: t('sheet.moveDown'), icon: 'arrow-down', disabled: !canMoveDown, onPress: () => onMoveDown(r) },
    { key: 'delete', label: t('sheet.delete'), icon: 'trash-outline', destructive: true, onPress: () => onDelete(r) },
  ];

  return (
    <Modal visible={routine !== null} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={t('sheet.close')} />
        {routine ? (
          <View
            accessibilityViewIsModal
            style={[styles.sheet, { backgroundColor: colors.card, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card }]}>
            <View style={styles.header}>
              <View style={styles.headerText}>
                <AppText variant="heading" accessibilityRole="header" numberOfLines={2}>
                  {routine.name}
                </AppText>
                <AppText variant="caption" muted>
                  {t('sheet.exerciseCount', { count: routine.exercises.length })}
                </AppText>
              </View>
              <IconAction icon="close" label={t('sheet.close')} onPress={onClose} />
            </View>
            <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.content}>
              {routine.note.length > 0 ? (
                <AppText variant="caption" muted>
                  {routine.note}
                </AppText>
              ) : null}
              <View>
                {routine.exercises.map((exercise, index) => (
                  <View key={`${exercise.exerciseId}:${index}`} style={styles.exercise}>
                    {exercise.supersetGroup !== null ? <View style={[styles.bar, { backgroundColor: accent }]} /> : null}
                    <View style={styles.exerciseText}>
                      <AppText variant="bodyStrong" numberOfLines={2}>
                        {catalog.name(exercise.exerciseId, locale) ?? t('row.removedExercise')}
                      </AppText>
                      {exercise.supersetGroup !== null ? (
                        <AppText variant="caption" color={accent}>
                          {t('sheet.superset')}
                        </AppText>
                      ) : null}
                    </View>
                    <AppText variant="caption" muted style={styles.exerciseSets}>
                      {summaryOf(exercise)}
                    </AppText>
                  </View>
                ))}
              </View>
              <Button label={t('sheet.start')} variant="primary" icon="play" onPress={() => onStart(routine)} />
              {starter ? (
                <>
                  <Button label={t('sheet.copy')} icon="copy-outline" onPress={() => onCopy(routine)} />
                  <MenuRows items={shareItems(routine)} />
                </>
              ) : (
                <>
                  <Divider />
                  <MenuRows items={actions(routine)} />
                </>
              )}
            </ScrollView>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: overlay.scrim },
  sheet: { maxHeight: '88%', paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerText: { flex: 1, gap: 2 },
  scroll: { flexGrow: 0 },
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  exercise: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 48, paddingVertical: spacing.xs },
  bar: { width: 3, alignSelf: 'stretch', borderRadius: 2 },
  exerciseText: { flex: 1, gap: 0 },
  exerciseSets: { textAlign: 'right', maxWidth: '40%' },
});
