import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { radius, spacing, useColors } from '@/theme';

const SIZE = 168;
const RINGS = 3;
const PERIOD_MS = 2400;

/**
 * The scan's picture, after Huawei Health's radar: rings that keep spreading from a Bluetooth glyph while the scan runs, still when it
 * stops (and under reduced motion). Transform and opacity only, on the native thread. The caption says what is going on in words.
 */
export function ScanRadar({ scanning, title, caption }: { scanning: boolean; title: string; caption: string }) {
  const colors = useColors();
  const reduced = useReducedMotion();
  const [phase] = useState(() => new Animated.Value(0));
  const moving = scanning && !reduced;

  useEffect(() => {
    if (!moving) {
      phase.stopAnimation();
      phase.setValue(0);
      return;
    }
    const loop = Animated.loop(Animated.timing(phase, { toValue: 1, duration: PERIOD_MS, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [moving, phase]);

  return (
    <View style={styles.wrap} accessible accessibilityRole={scanning ? 'progressbar' : undefined} accessibilityLabel={`${title}. ${caption}`}>
      <View style={styles.radar} importantForAccessibility="no-hide-descendants">
        {Array.from({ length: RINGS }, (_, i) => {
          // Each ring runs the same 0..1 cycle, a third of a period behind the one before, so one is always leaving the centre.
          const offset = i / RINGS;
          const t = Animated.modulo(Animated.add(phase, offset), 1);
          const still = (i + 1) / RINGS;
          return (
            <Animated.View
              key={i}
              style={[
                styles.ring,
                { borderColor: colors.link, backgroundColor: colors.linkSoft },
                moving
                  ? {
                      opacity: t.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.55, 0] }),
                      transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }],
                    }
                  : { opacity: 0.35 - i * 0.08, transform: [{ scale: still }] },
              ]}
            />
          );
        })}
        <View style={[styles.core, { backgroundColor: colors.link }]}>
          <Ionicons name="bluetooth" size={28} color={colors.primaryForeground} />
        </View>
      </View>
      <AppText variant="heading" style={styles.centered}>
        {title}
      </AppText>
      <AppText variant="caption" muted style={styles.centered}>
        {caption}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm },
  radar: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  ring: { position: 'absolute', width: SIZE, height: SIZE, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth * 2 },
  core: { width: 56, height: 56, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  centered: { textAlign: 'center' },
});
