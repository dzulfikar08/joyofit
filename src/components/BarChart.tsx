import { Ionicons } from '@expo/vector-icons';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GestureResponderEvent, LayoutChangeEvent } from 'react-native';
import { StyleSheet, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { bucketAt, labelLeft, barHeight as heightOf, chartPeak, labelledBars, labelWidth, nextSelection, pointAt, slotCenter } from '@/components/barScrub';
import { spacing, useColors } from '@/theme';

const LABEL_HEIGHT = 16;
/** Space between a bar and the value printed over it. */
const LABEL_LIFT = 2;
const MIN_BAR = 3;

interface Scrub {
  selected: number | null;
  /** Spread onto the touchable chart area. */
  touch: {
    ref: React.RefObject<View | null>;
    onLayout: (e: LayoutChangeEvent) => void;
    onTouchStart: (e: GestureResponderEvent) => void;
    onTouchMove: (e: GestureResponderEvent) => void;
    onTouchEnd: () => void;
    onTouchCancel: () => void;
  };
  /** Width of the touch area in px; 0 until laid out. */
  width: number;
  clear: () => void;
}

/**
 * Tap or drag across `count` equal slots (or, in `point` mode, evenly spaced points) to select one; a tap on the selected slot, or outside the slots, clears it.
 * Selection resets when `resetKey` changes (new data).
 */
export function useBarScrub(count: number, resetKey: unknown, left = 0, right = 0, mode: 'slot' | 'point' = 'slot'): Scrub {
  const [selected, setSelected] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const ref = useRef<View>(null);
  const box = useRef({ x: 0, w: 0 });
  const gesture = useRef({ start: null as number | null, last: -1, moved: false });

  // Reset the selection during render when the data changes (no extra effect pass).
  const [seenKey, setSeenKey] = useState(resetKey);
  if (!Object.is(seenKey, resetKey)) {
    setSeenKey(resetKey);
    setSelected(null);
  }

  const measure = useCallback(() => {
    ref.current?.measureInWindow((x, _y, w) => {
      box.current = { x, w };
    });
  }, []);

  const hit = (pageX: number): number => {
    const { x, w } = box.current;
    return (mode === 'slot' ? bucketAt : pointAt)(pageX - x, left, w - left - right, count);
  };

  const onTouchStart = (e: GestureResponderEvent) => {
    gesture.current = { start: selected, last: -1, moved: false };
    const pageX = e.nativeEvent.pageX;
    const i = hit(pageX);
    gesture.current.last = i;
    if (i >= 0) setSelected(i);
    measure();
  };
  const onTouchMove = (e: GestureResponderEvent) => {
    gesture.current.moved = true;
    const i = hit(e.nativeEvent.pageX);
    if (i < 0 || i === gesture.current.last) return;
    gesture.current.last = i;
    setSelected(i);
  };
  const onTouchEnd = () => {
    const { start, last, moved } = gesture.current;
    setSelected(nextSelection(start, last, moved));
  };

  return {
    selected: selected !== null && selected < count ? selected : null,
    width,
    clear: () => setSelected(null),
    touch: {
      ref,
      onLayout: (e) => {
        setWidth(e.nativeEvent.layout.width);
        measure();
      },
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel: onTouchEnd,
    },
  };
}

interface ReadoutProps {
  /** The date or hour of the bar. */
  title: string | null;
  /** Its value with the unit. */
  text: string | null;
  color: string;
}

/** One line above a chart: the selected bar's date on the left and its value on the right, or a hint to tap. */
export function BarReadout({ title, text, color }: ReadoutProps) {
  const { t } = useTranslation('common');
  const selected = title !== null && text !== null;
  return (
    <View style={styles.readout} accessibilityLiveRegion="polite" importantForAccessibility="no-hide-descendants">
      {selected ? (
        <>
          <AppText variant="caption" muted numberOfLines={1} style={styles.readoutTitle}>
            {title}
          </AppText>
          <AppText variant="bodyStrong" color={color} numberOfLines={1} style={styles.readoutValue}>
            {text}
          </AppText>
        </>
      ) : (
        <AppText variant="caption" muted numberOfLines={1}>
          {t('chart.hint')}
        </AppText>
      )}
    </View>
  );
}

export interface BarDatum {
  key: string | number;
  value: number;
  /** Date or hour, for the readout and the accessibility label. */
  title: string;
  /** Value with its unit, for the readout and the accessibility label. */
  text: string;
  /** Short value for the label above the bar (no unit). Printed in full, never cut. */
  short: string;
  /** Draws the bar dimmed, like a past period. */
  dim?: boolean;
  /** The bar reached the chart's `goal`: a check is drawn at its top when the bars are wide enough to hold one. */
  hit?: boolean;
}

interface BarValueProps {
  text: string;
  /** Centre x of the bar in the chart. */
  center: number;
  chartWidth: number;
  /** Distance from the chart's bottom edge to the label. */
  bottom: number;
}

/**
 * A bar's value over it at its natural width, centred on the bar and slid inward at the chart's edges so it is never cut.
 * Its width is measured after the first frame; until then the estimate places it.
 */
function BarValue({ text, center, chartWidth, bottom }: BarValueProps) {
  const [measured, setMeasured] = useState<number | null>(null);
  const width = measured ?? labelWidth(text);
  return (
    <View pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.valueRow, { bottom }]}>
      <AppText
        variant="caption"
        muted
        numberOfLines={1}
        onLayout={(e) => setMeasured(e.nativeEvent.layout.width)}
        style={[styles.value, { marginLeft: labelLeft(center, width, chartWidth) }]}>
        {text}
      </AppText>
    </View>
  );
}

interface BarChartProps {
  data: readonly BarDatum[];
  color: string;
  /** Height of the bars area, without the label row. */
  height: number;
  gap: number;
  /** The tick under bar `i`, or null for none. */
  tick: (index: number) => string | null;
  tickWidth: number;
  /** The bar that gets a value label when labels do not fit for all; the newest by default. null for none: use it when the screen already states that bar's value next to the chart. */
  current?: number | null;
  /** A target value drawn as a dashed line across the chart; the bars are scaled so the line is always inside it. */
  goal?: number;
}

/** Narrowest slot that still holds a goal check. */
const MIN_HIT_SLOT = 22;

/**
 * Bars made of plain Views, scaled to the tallest. Touch highlights a bar and reads its date and value out above the
 * chart. Value labels over the bars: the current bar (every bar when they fit) while nothing is selected, none for the
 * selected bar, since the readout already shows it. Labels are printed in full, centred on the bar and kept inside the chart.
 */
export function BarChart({ data, color, height, gap, tick, tickWidth, current, goal }: BarChartProps) {
  const colors = useColors();
  const scrub = useBarScrub(data.length, data);
  const peak = chartPeak(data.map((d) => d.value), goal);
  const slotWidth = data.length > 0 && scrub.width > 0 ? (scrub.width - gap * (data.length - 1)) / data.length : 0;
  const highlighted = scrub.selected === null ? (current === undefined ? data.length - 1 : current) : null;
  const labelled = labelledBars(data.length, scrub.width, data.map((d) => d.short), highlighted, scrub.selected);
  const picked = scrub.selected !== null ? data[scrub.selected]! : null;
  const barHeight = (d: BarDatum) => heightOf(d.value, peak, height, MIN_BAR);

  return (
    <View style={styles.wrap}>
      <BarReadout title={picked?.title ?? null} text={picked?.text ?? null} color={color} />
      <View {...scrub.touch} style={[styles.bars, { height: height + LABEL_HEIGHT, gap }]}>
        {data.map((d, i) => {
          const dimmed = scrub.selected !== null ? i !== scrub.selected : d.dim === true;
          return (
            <View key={d.key} accessible accessibilityLabel={`${d.title}: ${d.text}`} style={styles.slot}>
              <View
                style={[
                  styles.bar,
                  d.value > 0
                    ? { height: barHeight(d), backgroundColor: color, opacity: dimmed ? 0.5 : 1 }
                    : { height: MIN_BAR, backgroundColor: colors.muted },
                ]}>
                {d.hit && d.value > 0 && slotWidth >= MIN_HIT_SLOT ? (
                  <View style={styles.hit} pointerEvents="none">
                    <Ionicons name="checkmark" size={13} color={colors.card} />
                  </View>
                ) : null}
              </View>
            </View>
          );
        })}
        {goal !== undefined && Number.isFinite(goal) && goal > 0 && scrub.width > 0 ? (
          <Svg pointerEvents="none" width={scrub.width} height={3} style={[styles.goal, { bottom: (goal / peak) * height - 1.5 }]}>
            <Line x1={0} x2={scrub.width} y1={1.5} y2={1.5} stroke={colors.foreground} strokeWidth={1.5} strokeDasharray="4 3" opacity={0.7} />
          </Svg>
        ) : null}
        {scrub.width > 0
          ? data.map((d, i) =>
              labelled.has(i) && d.value > 0 ? (
                <BarValue
                  key={d.key}
                  text={d.short}
                  center={slotCenter(i, data.length, scrub.width, gap)}
                  chartWidth={scrub.width}
                  bottom={barHeight(d) + LABEL_LIFT}
                />
              ) : null,
            )
          : null}
      </View>
      <View style={[styles.axis, { gap }]} pointerEvents="none">
        {data.map((d, i) => {
          const label = tick(i);
          return (
            <View key={d.key} style={styles.slot}>
              {label !== null ? (
                <AppText
                  variant="caption"
                  muted
                  numberOfLines={1}
                  style={[styles.tick, { width: tickWidth }]}>
                  {label}
                </AppText>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  readout: { minHeight: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  readoutTitle: { flexShrink: 1 },
  readoutValue: { fontVariant: ['tabular-nums'] },
  bars: { flexDirection: 'row', alignItems: 'flex-end' },
  slot: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  valueRow: { position: 'absolute', left: 0, right: 0, flexDirection: 'row' },
  value: { flexShrink: 0, fontSize: 11, lineHeight: 14, fontVariant: ['tabular-nums'] },
  goal: { position: 'absolute', left: 0 },
  hit: { alignItems: 'center', paddingTop: 2 },
  bar: { alignSelf: 'stretch', borderTopLeftRadius: 3, borderTopRightRadius: 3, borderBottomLeftRadius: 1, borderBottomRightRadius: 1 },
  axis: { flexDirection: 'row' },
  tick: { textAlign: 'center', fontSize: 11, lineHeight: 15 },
});
