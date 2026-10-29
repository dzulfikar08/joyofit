/**
 * Small charts for the lift pages, drawn with react-native-svg: a line over time and bars per workout. Touch (or drag) a point to read
 * it above the chart; screen readers get an adjustable control that steps through the points. Handles 0, 1 and many points.
 * Geometry is `chartScale.ts`.
 */
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View, type AccessibilityActionEvent, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { layoutBars, layoutLine, labelIndices, nearestIndex, type Plot } from '@/features/strength/chartScale';
import { fontSize, spacing, useTheme } from '@/theme';

export interface ChartDatum {
  /** Epoch ms of the workout. */
  at: number;
  value: number;
  /** A second line in the readout, e.g. the best set. */
  detail?: string;
}

interface ChartProps {
  data: readonly ChartDatum[];
  color: string;
  /** The value in the readout and the screen reader label, with its unit. */
  formatValue: (value: number) => string;
  /** The y-axis labels, without a unit; defaults to `formatValue`. */
  formatTick?: (value: number) => string;
  /** The x-axis dates, short. */
  formatDate: (at: number) => string;
  /** The date in the readout; defaults to `formatDate`. */
  formatDateFull?: (at: number) => string;
  /** What the chart shows, for screen readers ("Estimated 1RM"). */
  label: string;
  /** Shown instead of the chart when there is no data. */
  empty: string;
  /** Instruction read after the label for screen readers. */
  hint: string;
  height?: number;
}

const TOP = 10;
const BOTTOM = 24;
const RIGHT = 12;
const CHAR_WIDTH = 6.2;

type Kind = 'line' | 'bars';

function ChartBase({ kind, data, color, formatValue, formatTick, formatDate, formatDateFull, label, empty, hint, height = 190 }: ChartProps & { kind: Kind }) {
  const { colors, fonts } = useTheme();
  const [width, setWidth] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const tick = formatTick ?? formatValue;

  // A new series clears the picked point.
  const [seenData, setSeenData] = useState(data);
  if (seenData !== data) {
    setSeenData(data);
    setPicked(null);
  }

  const geometry = useMemo(() => {
    const points = data.map((d) => ({ at: d.at, value: d.value }));
    const provisional: Plot = { width: Math.max(width, 120), height, left: 0, right: RIGHT, top: TOP, bottom: BOTTOM };
    const domain = (kind === 'line' ? layoutLine(points, provisional, false) : layoutBars(points, provisional)).domain;
    const labels = domain.ticks.map(tick);
    const left = Math.max(...labels.map((l) => l.length)) * CHAR_WIDTH + 10;
    const plot: Plot = { ...provisional, width, left, right: RIGHT };
    if (kind === 'line') {
      const l = layoutLine(points, plot, false);
      return { plot, domain: l.domain, labels, centers: l.x, line: l, bars: null };
    }
    const b = layoutBars(points, plot);
    return { plot, domain: b.domain, labels, centers: b.x.map((x) => x + b.barWidth / 2), line: null, bars: b };
  }, [data, width, height, kind, tick]);

  const count = data.length;
  const index = count === 0 ? -1 : Math.min(picked ?? count - 1, count - 1);
  const current = index >= 0 ? data[index]! : null;
  const readout = current ? `${(formatDateFull ?? formatDate)(current.at)}: ${formatValue(current.value)}${current.detail ? `, ${current.detail}` : ''}` : empty;

  const touch = useCallback(
    (event: GestureResponderEvent) => {
      const i = nearestIndex(geometry.centers, event.nativeEvent.locationX);
      if (i >= 0) setPicked(i);
    },
    [geometry.centers],
  );

  const onAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (count === 0) return;
      const step = event.nativeEvent.actionName === 'increment' ? 1 : -1;
      setPicked(Math.max(0, Math.min(count - 1, index + step)));
    },
    [count, index],
  );

  if (count === 0) {
    return (
      <View style={[styles.empty, { height: height / 2 }]}>
        <AppText variant="caption" muted style={styles.emptyText}>
          {empty}
        </AppText>
      </View>
    );
  }

  const { plot, domain, labels } = geometry;
  const innerH = plot.height - plot.top - plot.bottom;
  const yOf = (v: number) => plot.top + (1 - (v - domain.min) / (domain.max - domain.min)) * innerH;
  const lastX = plot.width - plot.right;
  const labelAt = labelIndices(count, plot.width > 260);

  return (
    <View style={styles.wrap}>
      <View style={styles.readout} accessible={false} importantForAccessibility="no-hide-descendants">
        <View style={styles.readoutText}>
          <AppText variant="caption" muted numberOfLines={1}>
            {(formatDateFull ?? formatDate)(current!.at)}
          </AppText>
          {current!.detail ? (
            <AppText variant="caption" muted numberOfLines={1}>
              {current!.detail}
            </AppText>
          ) : null}
        </View>
        <AppText variant="heading" color={color} style={styles.readoutValue}>
          {formatValue(current!.value)}
        </AppText>
      </View>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: readout }}
        accessibilityHint={hint}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={onAction}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onTouchStart={touch}
        onTouchMove={touch}
        style={{ height }}>
        {width > 0 ? (
          <View pointerEvents="none">
            <Svg width={width} height={height}>
              {domain.ticks.map((value) => (
                <Line key={`g${value}`} x1={plot.left} x2={lastX} y1={yOf(value)} y2={yOf(value)} stroke={colors.hairline} strokeWidth={1} />
              ))}
              {domain.ticks.map((value, i) => (
                <SvgText key={`y${value}`} x={plot.left - 6} y={yOf(value) + 3.5} fontSize={fontSize.xs} fontFamily={fonts.regular} fill={colors.mutedForeground} textAnchor="end">
                  {labels[i]}
                </SvgText>
              ))}
              {labelAt.map((i) => {
                const x = geometry.centers[i]!;
                const anchor = count === 1 ? 'middle' : i === 0 ? 'start' : i === count - 1 ? 'end' : 'middle';
                const lx = anchor === 'start' ? plot.left : anchor === 'end' ? lastX : x;
                return (
                  <SvgText key={`x${i}`} x={lx} y={plot.height - 6} fontSize={fontSize.xs} fontFamily={fonts.regular} fill={colors.mutedForeground} textAnchor={anchor}>
                    {formatDate(data[i]!.at)}
                  </SvgText>
                );
              })}
              {kind === 'line' && geometry.line ? (
                <>
                  {count > 1 ? (
                    <Polyline
                      points={geometry.line.x.map((x, i) => `${x},${geometry.line!.y[i]}`).join(' ')}
                      fill="none"
                      stroke={color}
                      strokeWidth={2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  ) : null}
                  {count <= 40
                    ? geometry.line.x.map((x, i) => <Circle key={`p${i}`} cx={x} cy={geometry.line!.y[i]} r={i === index ? 0 : 3} fill={color} />)
                    : null}
                  <Line x1={geometry.line.x[index]} x2={geometry.line.x[index]} y1={plot.top} y2={plot.top + innerH} stroke={color} strokeOpacity={0.35} strokeWidth={1} />
                  <Circle cx={geometry.line.x[index]} cy={geometry.line.y[index]} r={5.5} fill={color} stroke={colors.card} strokeWidth={2} />
                </>
              ) : null}
              {kind === 'bars' && geometry.bars
                ? geometry.bars.x.map((x, i) => (
                    <Rect
                      key={`b${i}`}
                      x={x}
                      y={geometry.bars!.y[i]}
                      width={geometry.bars!.barWidth}
                      height={Math.max(1, geometry.bars!.base - geometry.bars!.y[i]!)}
                      rx={Math.min(3, geometry.bars!.barWidth / 2)}
                      fill={color}
                      fillOpacity={i === index ? 1 : 0.45}
                    />
                  ))
                : null}
            </Svg>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** A line over time (x by date), for values that change slowly: the best weight, the estimated 1RM. */
export function LineChart(props: ChartProps) {
  return <ChartBase kind="line" {...props} />;
}

/** One bar per workout, from zero: volume, reps, time. */
export function BarChart(props: ChartProps) {
  return <ChartBase kind="bars" {...props} />;
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  readout: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 40 },
  readoutText: { flex: 1, gap: 0 },
  readoutValue: { fontVariant: ['tabular-nums'] },
  empty: { alignItems: 'center', justifyContent: 'center' },
  emptyText: { textAlign: 'center' },
});
