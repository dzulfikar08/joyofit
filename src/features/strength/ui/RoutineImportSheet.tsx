import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Notice } from '@/components/States';
import { IconAction } from '@/features/courses/IconAction';
import { overlay, spacing, useTheme } from '@/theme';

import type { ImportPlan, ParseError } from '../routineShare';

/** What the picked file turned out to be: a plan to confirm, or a reason it cannot be imported. */
export type ImportState = { fileName: string; plan: ImportPlan } | { fileName: string; error: ParseError | 'unreadable' };

interface RoutineImportSheetProps {
  /** Null keeps the sheet closed. */
  state: ImportState | null;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** The preview of an import (routines, exercise counts, exercises that will be created) with a confirm button, or the error of a bad file. Nothing is saved before the confirm. */
export function RoutineImportSheet({ state, busy, onConfirm, onClose }: RoutineImportSheetProps) {
  const { t } = useTranslation('routines');
  const { colors, radius } = useTheme();
  const plan = state && 'plan' in state ? state.plan : null;
  const error = state && 'error' in state ? state.error : null;
  const code = error === null ? null : error === 'unreadable' ? 'unreadable' : error.code;

  return (
    <Modal visible={state !== null} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={t('share.import.close')} />
        {state ? (
          <View
            accessibilityViewIsModal
            style={[styles.sheet, { backgroundColor: colors.card, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card }]}>
            <View style={styles.header}>
              <View style={styles.headerText}>
                <AppText variant="heading" accessibilityRole="header" numberOfLines={2}>
                  {t(plan ? 'share.import.title' : 'share.import.errorTitle')}
                </AppText>
                <AppText variant="caption" muted numberOfLines={1}>
                  {state.fileName}
                </AppText>
              </View>
              <IconAction icon="close" label={t('share.import.close')} onPress={onClose} />
            </View>
            <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.content}>
              {code !== null ? (
                <Notice tone="danger">
                  {t(`share.import.error.${code}`)}
                  {error !== null && error !== 'unreadable' && error.at ? ` (${error.at})` : ''}
                </Notice>
              ) : null}
              {plan ? (
                <>
                  {plan.newFolder ? (
                    <AppText variant="caption" muted>
                      {t('share.import.newFolder', { name: plan.newFolder.name })}
                    </AppText>
                  ) : null}
                  <View>
                    {plan.routines.map((routine) => (
                      <View key={routine.id} style={styles.routine}>
                        <AppText variant="bodyStrong" numberOfLines={2} style={styles.routineName}>
                          {routine.name}
                        </AppText>
                        <AppText variant="caption" muted>
                          {t('sheet.exerciseCount', { count: routine.exercises.length })}
                        </AppText>
                      </View>
                    ))}
                  </View>
                  {plan.newExercises.length > 0 ? (
                    <View style={styles.custom}>
                      <AppText variant="label" muted>
                        {t('share.import.customTitle', { count: plan.newExercises.length })}
                      </AppText>
                      <AppText variant="caption" muted>
                        {plan.newExercises.map((e) => e.name).join(', ')}
                      </AppText>
                    </View>
                  ) : null}
                  <AppText variant="caption" muted>
                    {t('share.import.keepNote')}
                  </AppText>
                  <Button label={t('share.import.confirm', { count: plan.routines.length })} variant="primary" icon="download-outline" loading={busy} onPress={onConfirm} />
                </>
              ) : null}
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
  routine: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 44, paddingVertical: spacing.xs },
  routineName: { flex: 1 },
  custom: { gap: 2 },
});
