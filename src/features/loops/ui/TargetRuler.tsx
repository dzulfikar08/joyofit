import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Vibration,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

import { rulerLabel, type RulerScale } from '../targets';

/** Distance between two ticks, in dp: wide enough to read the labels, narrow enough that a flick covers the range. */
export const TICK_WIDTH = 14;
const HEIGHT = 64;
const MAJOR_TICK = 30;
const MINOR_TICK = 16;
/** One tick of haptic per snap; Android only (the vibration API of iOS has no short tick), and never faster than this. */
const HAPTIC_MS = 6;
const HAPTIC_GAP_MS = 35;

interface TargetRulerProps {
  scale: RulerScale;
  mode: string;
  value: number;
  onChange: (value: number) => void;
  /** What a screen reader says for the current value, e.g. "10.000 langkah". */
  valueText: string;
}

/**
 * A horizontal ruler: ticks scroll under a fixed marker in the middle and the value under the marker is the target. The scroll
 * view snaps to every tick (`snapToInterval`), the value follows the scroll live, and each snap gives a short vibration on
 * Android. A screen reader gets an adjustable slider (swipe up and down) that moves one tick at a time.
 */
export function TargetRuler({ scale, mode, value, onChange, valueText }: TargetRulerProps) {
  const { t } = useTranslation('loops');
  const { colors } = useTheme();
  const scroll = useRef<ScrollView>(null);
  const [width, setWidth] = useState(0);
  const count = Math.round((scale.max - scale.min) / scale.step) + 1;
  const indexOf = (v: number) => Math.min(count - 1, Math.max(0, Math.round((v - scale.min) / scale.step)));
  const lastIndex = useRef(indexOf(value));
  const lastHaptic = useRef(0);

  // The value changed from outside (another mode, another activity, a screen reader): move the ruler to it.
  useEffect(() => {
    const next = indexOf(value);
    if (width > 0 && next !== lastIndex.current) {
      lastIndex.current = next;
      scroll.current?.scrollTo({ x: next * TICK_WIDTH, animated: false });
    }
    // `indexOf` is rebuilt from scale and count every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, width, scale.min, scale.max, scale.step]);

  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.min(count - 1, Math.max(0, Math.round(event.nativeEvent.contentOffset.x / TICK_WIDTH)));
    if (index === lastIndex.current) return;
    lastIndex.current = index;
    const now = Date.now();
    if (Platform.OS === 'android' && now - lastHaptic.current >= HAPTIC_GAP_MS) {
      lastHaptic.current = now;
      try {
        Vibration.vibrate(HAPTIC_MS);
      } catch {
        // no vibrator
      }
    }
    onChange(scale.min + index * scale.step);
  };

  const side = Math.max(0, (width - TICK_WIDTH) / 2);
  const majors: { index: number; label: string }[] = [];
  const ticks: { index: number; major: boolean }[] = [];
  for (let i = 0; i < count; i++) {
    const major = i % scale.majorEvery === 0;
    ticks.push({ index: i, major });
    if (major) majors.push({ index: i, label: rulerLabel(mode, scale.min + i * scale.step) });
  }

  const step = (delta: number) => {
    const next = Math.min(count - 1, Math.max(0, lastIndex.current + delta));
    if (next === lastIndex.current) return;
    onChange(scale.min + next * scale.step);
  };

  return (
    <View
      onLayout={onLayout}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={t('ruler.label')}
      accessibilityHint={t('ruler.hint')}
      accessibilityValue={{ text: valueText }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => step(event.nativeEvent.actionName === 'increment' ? 1 : -1)}
      style={styles.frame}>
      {width > 0 ? (
        <ScrollView
          // A new scale is a new ruler: it opens at the value, not at the old offset.
          key={`${mode}:${scale.min}:${scale.max}`}
          ref={scroll}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={TICK_WIDTH}
          snapToAlignment="start"
          decelerationRate="fast"
          scrollEventThrottle={16}
          overScrollMode="never"
          bounces={false}
          contentOffset={{ x: indexOf(value) * TICK_WIDTH, y: 0 }}
          onScroll={onScroll}
          onContentSizeChange={() => scroll.current?.scrollTo({ x: indexOf(value) * TICK_WIDTH, animated: false })}
          contentContainerStyle={{ paddingHorizontal: side, height: HEIGHT }}>
          <View style={styles.ticks}>
            {ticks.map(({ index, major }) => (
              <View key={index} style={styles.cell}>
                <View
                  style={[
                    styles.tick,
                    { height: major ? MAJOR_TICK : MINOR_TICK, backgroundColor: major ? colors.foreground : colors.mutedForeground },
                  ]}
                />
              </View>
            ))}
            {majors.map(({ index, label }) => (
              <View key={index} pointerEvents="none" style={[styles.label, { left: index * TICK_WIDTH + TICK_WIDTH / 2 - LABEL_WIDTH / 2 }]}>
                <AppText variant="caption" muted style={styles.labelText} numberOfLines={1}>
                  {label}
                </AppText>
              </View>
            ))}
          </View>
        </ScrollView>
      ) : null}
      <View pointerEvents="none" style={[styles.marker, { backgroundColor: colors.primary, left: side + TICK_WIDTH / 2 - 1.5 }]} />
    </View>
  );
}

const LABEL_WIDTH = 44;

const styles = StyleSheet.create({
  frame: { height: HEIGHT },
  ticks: { flexDirection: 'row', height: HEIGHT },
  cell: { width: TICK_WIDTH, height: MAJOR_TICK, alignItems: 'center', justifyContent: 'flex-start' },
  tick: { width: 2, borderRadius: 1 },
  label: { position: 'absolute', top: MAJOR_TICK + 4, width: LABEL_WIDTH, alignItems: 'center' },
  labelText: { textAlign: 'center' },
  marker: { position: 'absolute', top: 0, width: 3, height: MAJOR_TICK + 6, borderRadius: 2 },
});
