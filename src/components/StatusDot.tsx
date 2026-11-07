import { useEffect, useState } from 'react';
import { Animated, Easing, View } from 'react-native';

import { useReducedMotion } from '@/hooks/useReducedMotion';

interface StatusDotProps {
  color: string;
  /** Pulses a soft halo while true: the link is up or being set up. Static when false or under reduced motion. */
  live: boolean;
  /**
   * Whether the halo pulses (default: while [live]). Screens that stay open for hours pass false once the link is settled: the
   * loop redraws the screen at the display's full refresh rate (~120 fps on the Today hero), which made taps lag on slower phones.
   */
  pulse?: boolean;
  size?: number;
}

/** Small link-state dot. The halo is the only thing that moves, 1.8 s per beat, and only while the link is live. */
export function StatusDot({ color, live, pulse = live, size = 10 }: StatusDotProps) {
  const reduced = useReducedMotion();
  const [beat] = useState(() => new Animated.Value(0));
  const pulsing = live && pulse && !reduced;

  useEffect(() => {
    if (!pulsing) {
      beat.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(beat, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [beat, pulsing]);

  const box = size * 2.6;
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      style={{ width: box, height: box, alignItems: 'center', justifyContent: 'center' }}>
      {pulsing ? (
        <Animated.View
          style={{
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color,
            opacity: beat.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0] }),
            transform: [{ scale: beat.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }],
          }}
        />
      ) : null}
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: live ? color : 'transparent',
          borderWidth: live ? 0 : 2,
          borderColor: color,
        }}
      />
    </View>
  );
}
