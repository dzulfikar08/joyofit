import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { marqueePlan, MARQUEE } from './marquee';

interface Props {
  title: string;
  /** Read out by screen readers; the title itself is the visible text. */
  hint?: string;
  onPress?: () => void;
}

/** The longest title the strip can lay out; titles are at most 48 characters. */
const STRIP_PX = 1_600;

/**
 * A chat title in the header. When it fits it is plain text. When it does not, it waits about 2 s, slides once to show its end, rests,
 * slides back, and goes quiet until the next round (about every 8 s): the position is a native-driven animation (no re-render per
 * frame, nothing while the screen is idle). With "remove animations" on it never moves; tapping it opens the full title.
 */
export function MarqueeTitle({ title, hint, onPress }: Props) {
  const reduced = useReducedMotion();
  const [x] = useState(() => new Animated.Value(0));
  const [box, setBox] = useState(0);
  const [full, setFull] = useState(0);
  const overflow = full - box;

  useEffect(() => {
    x.setValue(0);
    const plan = marqueePlan(overflow, reduced);
    if (!plan) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let animation: Animated.CompositeAnimation | undefined;
    let stopped = false;
    const round = (first: boolean) => {
      animation = Animated.sequence([
        Animated.delay(first ? MARQUEE.startMs : MARQUEE.restartDelayMs),
        Animated.timing(x, { toValue: -overflow, duration: plan.travelMs, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.delay(MARQUEE.pauseMs),
        Animated.timing(x, { toValue: 0, duration: MARQUEE.backMs, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]);
      animation.start(({ finished }) => {
        if (finished && !stopped) timer = setTimeout(() => round(false), plan.gapMs);
      });
    };
    round(true);
    return () => {
      stopped = true;
      clearTimeout(timer);
      animation?.stop();
      x.setValue(0);
    };
  }, [overflow, reduced, x, title]);

  const onBox = (e: LayoutChangeEvent) => setBox(Math.round(e.nativeEvent.layout.width));
  const onText = (e: LayoutChangeEvent) => setFull(Math.ceil(e.nativeEvent.layout.width));

  const body = (
    <View style={styles.clip} onLayout={onBox}>
      <Animated.View style={[styles.strip, { transform: [{ translateX: x }] }]}>
        <AppText variant="heading" onLayout={onText} style={styles.text}>
          {title}
        </AppText>
      </Animated.View>
    </View>
  );
  return onPress ? (
    <PressableScale accessibilityRole="button" accessibilityLabel={title} accessibilityHint={hint} onPress={onPress} scaleTo={0.99} style={styles.press}>
      {body}
    </PressableScale>
  ) : (
    body
  );
}

const styles = StyleSheet.create({
  press: { flex: 1, minHeight: 44, justifyContent: 'center' },
  clip: { flex: 1, overflow: 'hidden', justifyContent: 'center' },
  strip: { width: STRIP_PX, flexDirection: 'row' },
  text: { alignSelf: 'flex-start' },
});
