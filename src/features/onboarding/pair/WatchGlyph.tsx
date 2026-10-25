import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { radius, useColors } from '@/theme';

/**
 * The watch's picture on the pairing screens. No product photos ship with the app (the model catalogue is names only), so it is the
 * watch glyph on a soft disc; `badge` sits on its lower right (the tick to tap on the confirm panel).
 */
export function WatchGlyph({ size, highlighted = false, badge }: { size: number; highlighted?: boolean; badge?: ReactNode }) {
  const colors = useColors();
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      style={[styles.disc, { width: size, height: size, backgroundColor: highlighted ? colors.linkSoft : colors.muted }]}>
      <Ionicons name="watch" size={Math.round(size * 0.5)} color={highlighted ? colors.link : colors.foreground} />
      {badge ? <View style={styles.badge}>{badge}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  disc: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', right: 0, bottom: 0 },
});
