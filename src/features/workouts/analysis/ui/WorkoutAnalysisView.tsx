import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { RouteDetail } from '../route';
import type { WorkoutAnalysis } from '../types';
import { BestEffortsCard } from './BestEffortsCard';
import { ChartsCard } from './ChartsCard';
import { ComparisonCard } from './ComparisonCard';
import { AnalysisContext, type AnalysisContextValue } from './context';
import { EffortCard, LoadCard } from './EffortLoadCards';
import { LapsCard } from './LapsCard';
import { MapSection } from './MapSection';
import { Card, Txt } from './primitives';
import { createScrubStore } from './scrub';
import { SplitsCard } from './SplitsCard';
import { SummaryStrip, type ExtraStat } from './SummaryStrip';
import type { AnalysisT } from './text';
import type { AnalysisMapTheme, AnalysisPalette } from './theme';
import { HrZonesCard, PaceZonesCard } from './ZonesCards';

export interface WorkoutAnalysisViewProps {
  analysis: WorkoutAnalysis;
  /** Memoize `palette` and `t`: a new identity re-renders every card. */
  palette: AnalysisPalette;
  t: AnalysisT;
  mapTheme: AnalysisMapTheme;
  /** True while a chart or map gesture owns the touch; lock the parent ScrollView's scrolling. */
  onScrubActive?: (active: boolean) => void;
  /** Cells for the summary grid that the analysis does not carry (the step count). */
  extraStats?: readonly ExtraStat[];
  /** The host shows the fat and carbohydrate burn itself: leave the fuel line out of the summary. */
  omitFuel?: boolean;
  /** The host shows the watch's training effect, recovery time and load itself: leave them out of the load card. */
  omitLoadExtras?: boolean;
  /** The route at the recording's resolution, for the map (phone only, `analyzeWorkoutWithDetail`); without it the map draws the analysis' own track. */
  route?: RouteDetail | null;
}

/**
 * The full workout analysis as a stack of cards (12 px apart). The parent screen provides the scroll view. One shared
 * scrub index, kept in a small store, ties the charts, the map marker and the splits together without re-rendering the cards.
 */
function WorkoutAnalysisViewImpl({ analysis, palette, t, mapTheme, onScrubActive, extraStats, omitFuel = false, omitLoadExtras = false, route }: WorkoutAnalysisViewProps) {
  const [store] = useState(createScrubStore);
  const onActiveRef = useRef(onScrubActive);
  useLayoutEffect(() => {
    onActiveRef.current = onScrubActive;
  });
  const setScrubActive = useCallback((active: boolean) => onActiveRef.current?.(active), []);
  const value = useMemo<AnalysisContextValue>(() => ({ palette, t, store, setScrubActive }), [palette, t, store, setScrubActive]);

  const series = analysis.series;
  const hasSeries = series !== null && series.n >= 2;
  const hasTrack = hasSeries && series.track !== null && series.track.some((p) => p !== null);

  return (
    <AnalysisContext.Provider value={value}>
      <View style={styles.stack}>
        <SummaryStrip analysis={analysis} extra={extraStats} showFuel={!omitFuel} />
        {hasTrack ? <MapSection analysis={analysis} mapTheme={mapTheme} route={route} /> : null}
        {hasSeries ? <ChartsCard analysis={analysis} /> : null}
        {!hasSeries ? (
          <Card>
            <Txt size={13} muted>
              {t('empty.noSeries')}
            </Txt>
          </Card>
        ) : null}
        <SplitsCard analysis={analysis} />
        <HrZonesCard analysis={analysis} />
        <PaceZonesCard analysis={analysis} />
        <BestEffortsCard analysis={analysis} />
        <EffortCard analysis={analysis} />
        <LoadCard analysis={analysis} showExtras={!omitLoadExtras} />
        <LapsCard analysis={analysis} />
        <ComparisonCard analysis={analysis} />
      </View>
    </AnalysisContext.Provider>
  );
}

export const WorkoutAnalysisView = memo(WorkoutAnalysisViewImpl);

const styles = StyleSheet.create({
  stack: { gap: 12 },
});
