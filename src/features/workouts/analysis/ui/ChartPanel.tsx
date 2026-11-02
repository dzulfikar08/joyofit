import { memo, useId, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';

import { fmtDecimal } from '@/i18n';

import { isFootKind } from '../sport';
import { formatDuration, formatPace, type AnalysisSeries, type SportKind } from '../types';
import {
  chartGeometry,
  formatAxisTick,
  formatYTick,
  yPosition,
  hrGradientStops,
  readoutAt,
  type ChartGeometry,
  type ChartMetric,
} from './chartMath';
import { useAnalysisContext } from './context';
import { Txt } from './primitives';
import { useScrub } from './scrub';
import { hrZoneColors, type AnalysisPalette } from './theme';

export const PAD_X = 6;

export function metricColor(palette: AnalysisPalette, metric: ChartMetric): string {
  switch (metric) {
    case 'pace':
    case 'speed':
      return palette.pace;
    case 'hr':
      return palette.hr;
    case 'alt':
      return palette.elevation;
    case 'cad':
    case 'stride':
      return palette.cadence;
    case 'power':
      return palette.power;
    case 'hrv':
      return palette.hrv;
    case 'stress':
      return palette.stress;
  }
}

interface PanelProps {
  series: AnalysisSeries;
  metric: ChartMetric;
  width: number;
  height: number;
  /** A thin strip: no ticks or labels. */
  compact?: boolean;
  /** Six bpm bounds; paints the heart-rate line by zone. */
  hrBounds?: readonly number[] | null;
  /** Text of an x tick (axis units); the default is elapsed time or distance. A whole-day chart labels the clock time. */
  xLabel?: (value: number) => string;
  /** Real values (one per sample, null where there is none) drawn as dots over the line: a sparse metric whose line bridges short gaps still shows what was actually read. */
  markers?: readonly (number | null)[] | null;
}

interface CrosshairProps {
  geo: ChartGeometry;
  width: number;
  height: number;
  color: string;
  dot: boolean;
}

/** The only part of a chart that re-renders while scrubbing: a vertical line and a dot. */
const Crosshair = memo(function Crosshair({ geo, width, height, color, dot }: CrosshairProps) {
  const { store, palette } = useAnalysisContext();
  const index = useScrub(store);
  if (index === null || index >= geo.xs.length) return null;
  const x = geo.xs[index]!;
  const y = geo.ys[index];
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Line x1={x} x2={x} y1={geo.plot.top} y2={geo.plot.top + geo.plot.height} stroke={palette.text} strokeOpacity={0.55} strokeWidth={1} />
      {dot && y !== null && y !== undefined ? <Circle cx={x} cy={y} r={4.5} fill={color} stroke={palette.surface} strokeWidth={2} /> : null}
    </Svg>
  );
});

/** One metric over the shared axis. Static between re-layouts; the crosshair is a separate overlay. */
export const ChartPanel = memo(function ChartPanel({ series, metric, width, height, compact = false, hrBounds, xLabel, markers }: PanelProps) {
  const { palette } = useAnalysisContext();
  const gradientId = `hrz${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const geo = useMemo(
    () => chartGeometry(series, metric, { width, height, padX: PAD_X, padTop: compact ? 4 : 12, padBottom: compact ? 4 : 22, compact }),
    [series, metric, width, height, compact],
  );
  const color = metricColor(palette, metric);
  const stops = useMemo(
    () => (metric === 'hr' && hrBounds && geo ? hrGradientStops(hrBounds, hrZoneColors(palette, hrBounds.length - 1), geo.domain) : null),
    [metric, hrBounds, geo, palette],
  );
  if (!geo) return null;
  const { plot } = geo;
  const bottom = plot.top + plot.height;
  const fontFamily = palette.fonts?.regular;
  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        {stops ? (
          <Defs>
            <LinearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={0} y1={plot.top} x2={0} y2={bottom}>
              {stops.map((s, i) => (
                <Stop key={i} offset={s.offset} stopColor={s.color} />
              ))}
            </LinearGradient>
          </Defs>
        ) : null}
        {geo.yTicks.map((tick) => (
          <Line key={`y${tick.value}`} x1={plot.left} x2={plot.left + plot.width} y1={tick.y} y2={tick.y} stroke={palette.grid} strokeWidth={1} />
        ))}
        <Line x1={plot.left} x2={plot.left + plot.width} y1={bottom} y2={bottom} stroke={palette.grid} strokeWidth={1} />
        <Path d={geo.area} fill={color} fillOpacity={metric === 'alt' ? 0.35 : 0.16} />
        <Path d={geo.line} fill="none" stroke={stops ? `url(#${gradientId})` : color} strokeWidth={compact ? 1.5 : 2} strokeLinejoin="round" strokeLinecap="round" />
        {markers
          ? markers.map((v, i) =>
              v === null || geo.xs[i] === undefined ? null : (
                <Circle key={`m${i}`} cx={geo.xs[i]} cy={yPosition(v, geo.domain, plot.top, plot.height)} r={2.5} fill={color} />
              ),
            )
          : null}
        {geo.yTicks.map((tick) => (
          <SvgText key={`yl${tick.value}`} x={plot.left + 2} y={tick.y - 3} fontSize={10} fill={palette.textMuted} fontFamily={fontFamily}>
            {formatYTick(metric, tick.value)}
          </SvgText>
        ))}
        {geo.xTicks.map((tick) => (
          <SvgText
            key={`x${tick.value}`}
            x={Math.min(Math.max(tick.x, 16), width - 16)}
            y={height - 6}
            fontSize={10}
            fill={palette.textMuted}
            fontFamily={fontFamily}
            textAnchor="middle"
          >
            {xLabel ? xLabel(tick.value) : formatAxisTick(tick.value, geo.isDistance)}
          </SvgText>
        ))}
      </Svg>
      <Crosshair geo={geo} width={width} height={height} color={color} dot={!compact} />
    </View>
  );
});

interface ReadoutProps {
  series: AnalysisSeries;
  metric: ChartMetric;
  kind: SportKind;
}

interface ReadoutCell {
  key: ChartMetric | 'dist' | 'time';
  value: string;
  unit: string;
}

/** Values at the scrub index. Renders a hint while nothing is scrubbed. */
export const Readout = memo(function Readout({ series, metric, kind }: ReadoutProps) {
  const { store, palette, t } = useAnalysisContext();
  const index = useScrub(store);
  if (index === null) {
    return (
      <View style={styles.readoutIdle}>
        <Txt size={12} muted>
          {t('chart.hint')}
        </Txt>
      </View>
    );
  }
  const r = readoutAt(series, index);
  const cells: ReadoutCell[] = [];
  if (r.distM !== null) cells.push({ key: 'dist', value: fmtDecimal(r.distM / 1000, 2), unit: t('unit.km') });
  cells.push({ key: 'time', value: formatDuration(r.sec), unit: t('unit.time') });
  if (series.pace) {
    const speed = kind === 'ride';
    cells.push(
      speed
        ? { key: 'speed', value: r.speedKmh !== null ? fmtDecimal(r.speedKmh, 1) : '--', unit: t('unit.kmh') }
        : { key: 'pace', value: formatPace(r.pace), unit: t('unit.perKm') },
    );
  }
  if (series.hr) cells.push({ key: 'hr', value: r.hr !== null ? String(Math.round(r.hr)) : '--', unit: t('unit.bpm') });
  if (series.alt) cells.push({ key: 'alt', value: r.alt !== null ? String(Math.round(r.alt)) : '--', unit: t('unit.m') });
  if (series.cad) cells.push({ key: 'cad', value: r.cad !== null ? String(Math.round(r.cad)) : '--', unit: t(kind === 'ride' ? 'unit.rpm' : 'unit.spm') });
  if (isFootKind(kind) && (series.stride || (series.pace && series.cad))) {
    cells.push({ key: 'stride', value: r.stride !== null ? fmtDecimal(r.stride, 2) : '--', unit: t('unit.m') });
  }
  if (series.power) cells.push({ key: 'power', value: r.power !== null ? String(Math.round(r.power)) : '--', unit: t('unit.w') });
  return (
    <View
      style={styles.readoutRow}
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={cells.map((c) => `${c.value} ${c.unit}`).join(', ')}
    >
      {cells.map((cell) => (
        <View key={cell.key} style={styles.readoutCell}>
          <Txt size={14} bold fit numberOfLines={1} align="center" color={cell.key === metric ? metricColor(palette, metric) : undefined}>
            {cell.value}
          </Txt>
          <Txt size={10} muted numberOfLines={1} align="center">
            {cell.unit}
          </Txt>
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  readoutRow: { flexDirection: 'row', alignItems: 'center', height: 46, gap: 2 },
  readoutCell: { flex: 1, minWidth: 0, alignItems: 'center' },
  readoutIdle: { height: 46, justifyContent: 'center' },
});
