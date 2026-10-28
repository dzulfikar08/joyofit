import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { spacing, useTheme } from '@/theme';

interface PlanOptionProps {
  title: string;
  /** StoreKit's price line ("Rp29.000 per month"); null while the product is not available. */
  price: string | null;
  /** The text for a product that is not available. */
  missing: string;
  /** "Save 43%", shown beside the title. */
  badge?: string | null;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/** One subscription choice on the paywall: a radio card with the plan name, the storefront price and an optional saving badge. */
export function PlanOption({ title, price, missing, badge, selected, disabled, onSelect }: PlanOptionProps) {
  const { colors, radius } = useTheme();
  const usable = price !== null && !disabled;
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityLabel={price ? `${title}, ${price}` : `${title}, ${missing}`}
      accessibilityState={{ selected, disabled: !usable }}
      disabled={!usable}
      onPress={onSelect}
      style={[
        styles.card,
        { backgroundColor: colors.card, borderRadius: radius.card, borderColor: selected ? colors.primary : colors.hairline, opacity: usable ? 1 : 0.6 },
      ]}>
      <View style={[styles.dot, { borderColor: selected ? colors.primary : colors.hairline }]}>
        {selected ? <View style={[styles.dotFill, { backgroundColor: colors.primary }]} /> : null}
      </View>
      <View style={styles.text}>
        <View style={styles.titleRow}>
          <AppText variant="bodyStrong">{title}</AppText>
          {badge ? (
            <AppText variant="label" color={colors.linkText}>
              {badge}
            </AppText>
          ) : null}
        </View>
        <AppText variant="caption" muted>
          {price ?? missing}
        </AppText>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderWidth: 2 },
  dot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dotFill: { width: 10, height: 10, borderRadius: 5 },
  text: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
