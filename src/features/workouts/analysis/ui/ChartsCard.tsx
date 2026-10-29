import { Ionicons } from '@expo/vector-icons';
import { memo, useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import type { AnalysisSeries, WorkoutAnalysis } from '../types';
import { availableMetrics, indexFromX, type ChartMetric } from './chartMath';
import { ChartPanel, PAD_X, Readout, metricColor } from './ChartPanel';
import { useAnalysisContext } from './context';
import { Card, MIN_HIT, Txt } from './primitives';
import { useScrubSelector, type ScrubStore } from './scrub';
import type { AnalysisTextKey } from './text';

export const CHART_HEIGHT = 176;
const STRIP_HEIGHT = 52;
/** Horizontal travel before a touch counts as a scrub that owns the gesture. */
const ENGAGE_DX = 6;

const TAB_LABEL: Record<ChartMetric, AnalysisTextKey> = {
  pace: 'metric.pace',
  speed: 'metric.speed',
  hr: 'metric.hr',
  alt: 'metric.elevation',
  cad: 'metric.cadence',
  stride: 'metric.stride',
  power: 'metric.power',
};

const TAB_ICON: Record<ChartMetric, keyof typeof Ionicons.glyphMap> = {
  pace: 'speedometer',
  speed: 'speedometer',
  hr: 'heart',
  alt: 'trending-up',
  cad: 'footsteps',
  stride: 'swap-horizontal',
  power: 'flash',
};

interface GestureTarget {
  series: AnalysisSeries;
  /** Width of the touchable area, px. */
  width: number;
}

/** The latest gesture target, kept outside of render so handlers can read it. */
function createLive(initial: GestureTarget) {
  let current = initial;
  return {
    get: () => current,
    set: (next: GestureTarget) => {
      current = next;
    },
  };
}

/** The gesture handlers; they read the latest target through `getTarget`, so a re-render never rebuilds them mid-touch. */
function createScrubHandlers(store: ScrubStore, setActive: (active: boolean) => void, getTarget: () => GestureTarget) {
  let startX = 0;
  let previous: number | null = null;
  let engaged = false;
  const apply = (x: number) => {
    const { series, width } = getTarget();
    if (width <= 0) return;
    store.set(indexFromX(series, x, PAD_X, width - PAD_X * 2));
  };
  const finish = () => {
    if (engaged) setActive(false);
    engaged = false;
  };
  return PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => !engaged,
    onShouldBlockNativeResponder: () => engaged,
    onPanResponderGrant: (evt) => {
      previous = store.get();
      engaged = false;
      startX = evt.nativeEvent.locationX;
      apply(startX);
    },
    onPanResponderMove: (_evt, g) => {
      if (!engaged && Math.abs(g.dx) > ENGAGE_DX && Math.abs(g.dx) > Math.abs(g.dy)) {
        engaged = true;
        setActive(true);
      }
      apply(startX + g.dx);
    },
    onPanResponderRelease: finish,
    onPanResponderTerminate: () => {
      if (!engaged) store.set(previous);
      finish();
    },
  }).panHandlers;
}

/**
 * Touch or drag sets the shared scrub index. The finger only owns the gesture (and the host locks its scroll view) once it
 * has moved sideways; a vertical swipe is released to the surrounding scroll view and restores the previous marker.
 */
export function useScrubGesture(store: ScrubStore, setActive: (active: boolean) => void, target: GestureTarget) {
  const [live] = useState(() => createLive(target));
  useLayoutEffect(() => {
    live.set(target);
  });
  return useMemo(() => createScrubHandlers(store, setActive, live.get), [store, setActive, live]);
}

export function ClearButton() {
  const { store, t, palette } = useAnalysisContext();
  const active = useScrubSelector(store, useCallback((i: number | null) => i !== null, []));
  if (!active) return null;
  return (
    <Pressable
      onPress={() => store.set(null)}
      accessibilityRole="button"
      accessibilityLabel={t('chart.clear')}
      hitSlop={4}
      style={styles.clear}
    >
      <Ionicons name="close-circle" size={22} color={palette.textMuted} />
    </Pressable>
  );
}

function ChartsCardImpl({ analysis }: { analysis: WorkoutAnalysis }) {
  const { palette, t, store, setScrubActive } = useAnalysisContext();
  const series = analysis.series;
  const kind = analysis.sport.kind;
  const metrics = useMemo(() => (series ? availableMetrics(series, kind) : []), [series, kind]);
  const [chosen, setChosen] = useState<ChartMetric | null>(null);
  const [width, setWidth] = useState(0);
  const metric = chosen && metrics.includes(chosen) ? chosen : (metrics[0] ?? null);

  const handlers = useScrubGesture(store, setScrubActive, { series: series ?? EMPTY_SERIES, width });

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    setWidth((prev) => (prev === w ? prev : w));
  }, []);

  const onAccessibilityAction = useCallback(
    (e: { nativeEvent: { actionName: string } }) => {
      if (!series) return;
      const step = Math.max(1, Math.round(series.n / 40));
      const current = store.get() ?? 0;
      if (e.nativeEvent.actionName === 'increment') store.set(Math.min(series.n - 1, current + step));
      else if (e.nativeEvent.actionName === 'decrement') store.set(Math.max(0, current - step));
    },
    [series, store],
  );

  if (!series || !metric) return null;
  const showStrip = metric !== 'alt' && series.alt !== null && metrics.includes('alt');
  const hrBounds = analysis.hrZones?.bounds ?? null;

  return (
    <Card title={t('section.charts')}>
      <View style={styles.tabs} accessibilityRole="tablist">
        {metrics.map((m) => {
          const selected = m === metric;
          const color = metricColor(palette, m);
          return (
            <Pressable
              key={m}
              onPress={() => setChosen(m)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              hitSlop={{ top: 5, bottom: 5, left: 2, right: 2 }}
              style={[styles.tab, { backgroundColor: selected ? color : palette.surfaceAlt }]}
            >
              <Ionicons name={TAB_ICON[m]} size={14} color={selected ? palette.surface : color} />
              <Txt size={13} bold color={selected ? palette.surface : palette.text}>
                {t(TAB_LABEL[m])}
              </Txt>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.readoutLine}>
        <View style={styles.readoutFlex}>
          <Readout series={series} metric={metric} kind={kind} />
        </View>
        <ClearButton />
      </View>
      <View
        onLayout={onLayout}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={t('chart.a11y', { metric: t(TAB_LABEL[metric]) })}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={onAccessibilityAction}
        {...handlers}
      >
        {width > 0 ? (
          <>
            <View pointerEvents="none" style={{ height: CHART_HEIGHT }}>
              <ChartPanel series={series} metric={metric} width={width} height={CHART_HEIGHT} hrBounds={hrBounds} />
            </View>
            {showStrip ? (
              <View pointerEvents="none" style={styles.strip}>
                <ChartPanel series={series} metric="alt" width={width} height={STRIP_HEIGHT} compact />
              </View>
            ) : null}
          </>
        ) : (
          <View style={{ height: CHART_HEIGHT }} />
        )}
      </View>
    </Card>
  );
}

const EMPTY_SERIES: AnalysisSeries = { stepSec: 1, n: 0, dist: null, hr: null, pace: null, alt: null, cad: null, power: null, track: null };

export const ChartsCard = memo(ChartsCardImpl);

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: MIN_HIT - 10, borderRadius: 999 },
  readoutLine: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  readoutFlex: { flex: 1, minWidth: 0 },
  clear: { width: MIN_HIT, height: MIN_HIT, alignItems: 'center', justifyContent: 'center' },
  strip: { height: STRIP_HEIGHT, marginTop: 4 },
});
