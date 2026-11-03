import { memo, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { TileMap, type MapMarker, type RouteRun } from '@/features/map';

import type { RouteDetail } from '../route';
import { kmMarkers, trackSegments, type LatLon, type WorkoutAnalysis } from '../types';
import { availableMetrics, formatYTick, type WorkoutMetric } from './chartMath';
import { useAnalysisContext } from './context';
import { METRIC_LABEL, MetricTabs } from './MetricTabs';
import { Card, Txt } from './primitives';
import { routeColoring } from './routeColor';
import { useScrubFrame } from './scrub';
import type { AnalysisTextKey } from './text';
import { ROUTE_RAMP, type AnalysisMapTheme } from './theme';

const MAP_HEIGHT = 260;

interface RouteMapProps {
  segments: readonly (readonly LatLon[])[];
  routeRuns?: readonly RouteRun[] | null;
  markers?: readonly MapMarker[];
  highlight?: LatLon | null;
  mapTheme: AnalysisMapTheme;
  height?: number;
  interactive?: boolean;
}

/** The map as the analysis views use it. This file is the only one in the folder that imports the map folder. */
export function RouteMap({ segments, routeRuns, markers, highlight, mapTheme, height = MAP_HEIGHT, interactive }: RouteMapProps) {
  const { palette, t, setScrubActive } = useAnalysisContext();
  const colors = useMemo(
    () => ({
      route: palette.mapRoute,
      routeCasing: palette.mapRouteCasing,
      start: palette.positive,
      finish: palette.negative,
      text: palette.text,
      surface: palette.surface,
    }),
    [palette],
  );
  return (
    <TileMap
      segments={segments}
      routeRuns={routeRuns}
      markers={markers}
      highlight={highlight}
      theme={mapTheme}
      colors={colors}
      height={height}
      interactive={interactive}
      onInteract={setScrubActive}
      a11yLabel={t('section.route')}
    />
  );
}

const UNIT: Record<WorkoutMetric, AnalysisTextKey> = {
  pace: 'unit.perKm',
  speed: 'unit.kmh',
  hr: 'unit.bpm',
  alt: 'unit.m',
  cad: 'unit.spm',
  stride: 'unit.m',
  power: 'unit.w',
};

interface Props {
  analysis: WorkoutAnalysis;
  mapTheme: AnalysisMapTheme;
  /** The route at the recording's resolution (phone only); without it the line is the analysis' own track. */
  route?: RouteDetail | null;
}

/**
 * The route card of the full analysis: the line coloured by a metric the person picks (heart rate first), a legend with the
 * values at both ends of the colours, km markers, start and finish, and a ring that follows the shared scrubber.
 */
function MapSectionImpl({ analysis, mapTheme, route = null }: Props) {
  const { store, palette, t } = useAnalysisContext();
  const series = analysis.series;
  const track = series?.track ?? null;
  const kind = analysis.sport.kind;

  const { segments, markers } = useMemo(() => {
    if (!series || !track) return { segments: [], markers: [] as MapMarker[] };
    const segs = route ? route.segments : trackSegments(track);
    const kms = route ? route.kms : kmMarkers(series);
    const out: MapMarker[] = [];
    const first = segs[0]?.[0];
    const lastSeg = segs[segs.length - 1];
    const last = lastSeg?.[lastSeg.length - 1];
    for (const m of kms) out.push({ pos: m.pos, kind: 'km', km: m.km, label: String(m.km) });
    if (first) out.push({ pos: first, kind: 'start' });
    if (last) out.push({ pos: last, kind: 'finish' });
    return { segments: segs, markers: out };
  }, [series, track, route]);

  const metrics = useMemo(() => (series && track ? availableMetrics(series, kind) : []), [series, track, kind]);
  const [chosen, setChosen] = useState<WorkoutMetric | null>(null);
  const metric = chosen && metrics.includes(chosen) ? chosen : metrics.includes('hr') ? 'hr' : (metrics[0] ?? null);
  const coloring = useMemo(
    () => (series && metric ? routeColoring(series, route, metric, ROUTE_RAMP, palette.mapRoute) : null),
    [series, route, metric, palette.mapRoute],
  );

  const index = useScrubFrame(store);
  const highlight = index !== null && track ? (track[index] ?? null) : null;

  if (segments.length === 0) return null;
  const unit = metric ? t(metric === 'cad' && kind === 'ride' ? 'unit.rpm' : UNIT[metric]) : '';
  const low = coloring && metric ? formatYTick(metric, coloring.low) : '';
  const high = coloring && metric ? formatYTick(metric, coloring.high) : '';
  return (
    <Card flush>
      <RouteMap segments={segments} routeRuns={coloring?.runs} markers={markers} highlight={highlight} mapTheme={mapTheme} />
      {coloring && metric ? (
        <View style={styles.below}>
          {metrics.length > 1 ? <MetricTabs metrics={metrics} selected={metric} onSelect={setChosen} /> : null}
          <View
            style={styles.legend}
            accessible
            accessibilityLabel={t('map.legend', { metric: t(METRIC_LABEL[metric]), low, high, unit })}
          >
            <Txt size={12} bold>
              {low}
            </Txt>
            <View style={styles.ramp}>
              {ROUTE_RAMP.map((color) => (
                <View key={color} style={[styles.rampStep, { backgroundColor: color }]} />
              ))}
            </View>
            <Txt size={12} bold>
              {high}
            </Txt>
            <Txt size={12} muted>
              {unit}
            </Txt>
          </View>
        </View>
      ) : null}
    </Card>
  );
}

export const MapSection = memo(MapSectionImpl);

const styles = StyleSheet.create({
  below: { padding: 14, gap: 12 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ramp: { flex: 1, flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden' },
  rampStep: { flex: 1 },
});
