import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Metric } from '@/components/Metric';
import { PressableScale } from '@/components/PressableScale';
import { spacing, useTheme } from '@/theme';

interface MetricTileProps {
  label: string;
  value: string;
  unit?: string;
  size: 'hero' | 'lg' | 'md';
  /** Tints the tile and adds the zone line (when `text` is not null): the heart-rate tile in its training zone. */
  zone?: { color: string; text: string | null } | null;
  /** Long press changes this field (the picker opens on this slot). */
  onLongPress: () => void;
  longPressHint: string;
}

/** One data field: the label, the figure large with its unit, and for the heart rate the zone as a tint and a line of words. */
export function MetricTile({ label, value, unit, size, zone, onLongPress, longPressHint }: MetricTileProps) {
  const { theme, colors, radius } = useTheme();
  const tint = zone ? `${zone.color}33` : colors.card;
  return (
    <PressableScale
      accessible
      accessibilityLabel={`${label}: ${value}${unit ? ` ${unit}` : ''}${zone?.text ? `, ${zone.text}` : ''}`}
      accessibilityHint={longPressHint}
      accessibilityActions={[{ name: 'longpress', label: longPressHint }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'longpress') onLongPress();
      }}
      onLongPress={onLongPress}
      delayLongPress={350}
      scaleTo={0.98}
      style={[
        styles.tile,
        size === 'hero' && styles.hero,
        { backgroundColor: tint, borderRadius: radius.tile },
        theme.outlined ? { borderWidth: StyleSheet.hairlineWidth, borderColor: zone ? zone.color : colors.hairline } : null,
      ]}>
      <AppText variant="label" muted numberOfLines={1}>
        {label}
      </AppText>
      <Metric value={value} unit={unit} size={size} />
      {zone?.text ? (
        <View style={styles.zone}>
          <View style={[styles.zoneDot, { backgroundColor: zone.color }]} />
          <AppText variant="label" numberOfLines={1} style={styles.zoneText}>
            {zone.text}
          </AppText>
        </View>
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, padding: spacing.md, gap: 2, minHeight: 80, justifyContent: 'center' },
  hero: { alignItems: 'center', paddingVertical: spacing.lg },
  zone: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  zoneDot: { width: 10, height: 10, borderRadius: 5 },
  zoneText: { flex: 1 },
});
