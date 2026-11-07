import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Animated, Easing, StyleSheet, View, type DimensionValue } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { IconChip, type IconName } from '@/components/IconChip';
import { MoreText } from '@/components/MoreText';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { spacing, useColors, useTheme, type Theme } from '@/theme';

interface NoticeProps {
  tone?: 'info' | 'danger';
  /** Defaults to an info or alert glyph from the tone. */
  icon?: IconName;
  children: ReactNode;
  /** One clear next step. */
  action?: { label: string; onPress: () => void };
  /** Always show the whole text. By default long plain text shows its first sentence and a "More" link (`MoreText`). */
  full?: boolean;
}

/** Inline message that names what happened and, when there is one, the next step. */
export function Notice({ tone = 'info', icon, children, action, full }: NoticeProps) {
  const { colors, radius } = useTheme();
  const danger = tone === 'danger';
  const fg = danger ? colors.destructive : colors.mutedForeground;
  return (
    <View
      accessibilityRole={danger ? 'alert' : undefined}
      style={[styles.notice, { backgroundColor: danger ? colors.destructiveSoft : colors.muted, borderRadius: radius.input }]}>
      <View style={styles.noticeRow}>
        <Ionicons
          name={icon ?? (danger ? 'alert-circle' : 'information-circle')}
          size={18}
          color={fg}
          style={styles.noticeIcon}
        />
        {typeof children === 'string' && !full ? (
          <MoreText color={danger ? colors.destructive : colors.foreground} selectable style={styles.noticeText}>
            {children}
          </MoreText>
        ) : (
          <AppText variant="caption" color={danger ? colors.destructive : colors.foreground} selectable style={styles.noticeText}>
            {children}
          </AppText>
        )}
      </View>
      {action ? <Button label={action.label} variant={danger ? 'destructive' : 'ghost'} onPress={action.onPress} /> : null}
    </View>
  );
}

interface EmptyStateProps {
  icon: IconName;
  title: string;
  description: string;
  action?: { label: string; onPress: () => void; icon?: IconName };
}

/** Why the list is empty and the one action that fills it. */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <View style={styles.empty}>
      <IconChip icon={icon} size="lg" />
      <AppText variant="heading" style={styles.centered}>
        {title}
      </AppText>
      <AppText variant="caption" muted style={styles.centered}>
        {description}
      </AppText>
      {action ? <Button label={action.label} icon={action.icon} variant="primary" onPress={action.onPress} /> : null}
    </View>
  );
}

/** Spinner plus what is loading. */
export function LoadingState({ label }: { label: string }) {
  const colors = useColors();
  return (
    <View style={styles.loading} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator color={colors.primary} />
      <AppText variant="caption" muted>
        {label}
      </AppText>
    </View>
  );
}

interface SkeletonProps {
  width: DimensionValue;
  height: number;
  /** A corner size in dp, or one of the theme's radii. */
  radius?: number | keyof Theme['radius'];
}

/** Placeholder block shaped like the content it stands in for; fades slowly, still under reduced motion. */
export function Skeleton({ width, height, radius: corner = 8 }: SkeletonProps) {
  const { colors, radius } = useTheme();
  const reduced = useReducedMotion();
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduced) {
      opacity.setValue(0.6);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.5, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reduced]);
  return (
    <Animated.View
      importantForAccessibility="no-hide-descendants"
      style={{ width, height, borderRadius: typeof corner === 'number' ? corner : radius[corner], backgroundColor: colors.muted, opacity }}
    />
  );
}

const styles = StyleSheet.create({
  notice: { padding: spacing.md, gap: spacing.sm },
  noticeRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  noticeIcon: { marginTop: 1 },
  noticeText: { flex: 1 },
  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl, paddingHorizontal: spacing.md },
  centered: { textAlign: 'center' },
  loading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
});
