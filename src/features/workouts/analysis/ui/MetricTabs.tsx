import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import type { WorkoutMetric } from './chartMath';
import { metricColor } from './ChartPanel';
import { useAnalysisContext } from './context';
import { MIN_HIT, Txt } from './primitives';
import type { AnalysisTextKey } from './text';

export const METRIC_LABEL: Record<WorkoutMetric, AnalysisTextKey> = {
  pace: 'metric.pace',
  speed: 'metric.speed',
  hr: 'metric.hr',
  alt: 'metric.elevation',
  cad: 'metric.cadence',
  stride: 'metric.stride',
  power: 'metric.power',
};

const METRIC_ICON: Record<WorkoutMetric, keyof typeof Ionicons.glyphMap> = {
  pace: 'speedometer',
  speed: 'speedometer',
  hr: 'heart',
  alt: 'trending-up',
  cad: 'footsteps',
  stride: 'swap-horizontal',
  power: 'flash',
};

interface Props {
  metrics: readonly WorkoutMetric[];
  selected: WorkoutMetric;
  onSelect: (metric: WorkoutMetric) => void;
}

/** A row of metric pills, the selected one filled in the metric's colour: the chart's tabs, and what the route is coloured by. */
export function MetricTabs({ metrics, selected, onSelect }: Props) {
  const { palette, t } = useAnalysisContext();
  return (
    <View style={styles.tabs} accessibilityRole="tablist">
      {metrics.map((m) => {
        const on = m === selected;
        const color = metricColor(palette, m);
        return (
          <Pressable
            key={m}
            onPress={() => onSelect(m)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            hitSlop={{ top: 5, bottom: 5, left: 2, right: 2 }}
            style={[styles.tab, { backgroundColor: on ? color : palette.surfaceAlt }]}
          >
            <Ionicons name={METRIC_ICON[m]} size={14} color={on ? palette.surface : color} />
            <Txt size={13} bold color={on ? palette.surface : palette.text}>
              {t(METRIC_LABEL[m])}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: MIN_HIT - 10, borderRadius: 999 },
});
