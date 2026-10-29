import { memo, useCallback, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import type { AnalysisSeries, LatLon } from '../types';
import { ChartPanel } from './ChartPanel';
import { AnalysisContext, useAnalysisContext, type AnalysisContextValue } from './context';
import { RouteMap } from './MapSection';
import { Card, Txt } from './primitives';
import { createScrubStore } from './scrub';
import type { AnalysisT } from './text';
import type { AnalysisMapTheme, AnalysisPalette } from './theme';

const CHART_HEIGHT = 140;

export interface BasicDetailProps {
  hr: { intervalSec: number; bpm: number[] } | null;
  route: [number, number][] | null;
  palette: AnalysisPalette;
  t: AnalysisT;
  mapTheme: AnalysisMapTheme;
}

function HrChart({ hr }: { hr: { intervalSec: number; bpm: number[] } }) {
  const { t } = useAnalysisContext();
  const [width, setWidth] = useState(0);
  const series = useMemo<AnalysisSeries>(
    () => ({
      stepSec: hr.intervalSec > 0 ? hr.intervalSec : 1,
      n: hr.bpm.length,
      dist: null,
      hr: hr.bpm.map((b) => (b > 0 ? b : null)),
      pace: null,
      alt: null,
      cad: null,
      power: null,
      track: null,
    }),
    [hr],
  );
  const range = useMemo(() => {
    const real = hr.bpm.filter((b) => b > 0);
    return real.length > 0 ? { min: Math.min(...real), max: Math.max(...real) } : null;
  }, [hr]);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    setWidth((prev) => (prev === w ? prev : w));
  }, []);
  if (hr.bpm.length < 2) return null;
  return (
    <Card title={t('section.heartRate')} aside={range ? t('basic.hrRange', range) : undefined}>
      <View onLayout={onLayout} accessible accessibilityRole="image" accessibilityLabel={t('basic.hrChart')} style={{ height: CHART_HEIGHT }}>
        {width > 0 ? <ChartPanel series={series} metric="hr" width={width} height={CHART_HEIGHT} /> : null}
      </View>
    </Card>
  );
}

function BasicDetailImpl({ hr, route, palette, t, mapTheme }: BasicDetailProps) {
  const [store] = useState(createScrubStore);
  const value = useMemo<AnalysisContextValue>(() => ({ palette, t, store, setScrubActive: noop }), [palette, t, store]);
  const segments = useMemo<LatLon[][]>(() => (route && route.length >= 2 ? [route] : []), [route]);
  const hasHr = hr !== null && hr.bpm.length >= 2;
  return (
    <AnalysisContext.Provider value={value}>
      <View style={styles.stack}>
        {hasHr ? <HrChart hr={hr} /> : null}
        {segments.length > 0 ? (
          <Card flush>
            <RouteMap segments={segments} mapTheme={mapTheme} interactive={false} />
          </Card>
        ) : null}
        {!hasHr && segments.length === 0 ? (
          <Card>
            <Txt size={13} muted>
              {t('basic.noData')}
            </Txt>
          </Card>
        ) : null}
      </View>
    </AnalysisContext.Provider>
  );
}

function noop() {}

/** The legacy detail for posts that carry only a heart-rate trace and a route: no scrubbing, no analysis. */
export const BasicDetail = memo(BasicDetailImpl);

const styles = StyleSheet.create({
  stack: { gap: 12 },
});
