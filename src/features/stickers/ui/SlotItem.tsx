import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { useTranslation } from '@/i18n';
import { spacing, useTheme } from '@/theme';

interface SlotItemProps {
  index: number;
  label: string;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}

export function SlotItem({ index, label, isFirst, isLast, onMoveUp, onMoveDown, onRemove }: SlotItemProps) {
  const { colors, fonts, radius } = useTheme();
  const { t } = useTranslation('stickers');

  return (
    <View style={[styles.row, { backgroundColor: colors.card, borderRadius: radius.control }]}>
      <View style={[styles.badge, { backgroundColor: colors.muted, borderRadius: radius.control }]}>
        <AppText variant="caption" style={{ fontFamily: fonts.bold, color: colors.foreground }}>
          {index + 1}
        </AppText>
      </View>
      <AppText variant="body" style={[styles.label, { fontFamily: fonts.medium, color: colors.foreground }]}>
        {label}
      </AppText>
      <View style={styles.actions}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('ui.customMetrics.moveUp')}
          disabled={isFirst}
          hitSlop={8}
          onPress={onMoveUp}
          style={[styles.actionBtn, isFirst && styles.disabled]}>
          <Ionicons name="chevron-up" size={18} color={isFirst ? colors.mutedForeground : colors.foreground} />
        </PressableScale>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('ui.customMetrics.moveDown')}
          disabled={isLast}
          hitSlop={8}
          onPress={onMoveDown}
          style={[styles.actionBtn, isLast && styles.disabled]}>
          <Ionicons name="chevron-down" size={18} color={isLast ? colors.mutedForeground : colors.foreground} />
        </PressableScale>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('ui.customMetrics.remove')}
          hitSlop={8}
          onPress={onRemove}
          style={styles.actionBtn}>
          <Ionicons name="close-circle-outline" size={18} color={colors.mutedForeground} />
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    gap: spacing.sm,
  },
  badge: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  actionBtn: {
    padding: spacing.xs,
  },
  disabled: {
    opacity: 0.3,
  },
});
