import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { PressableScale } from '@/components/PressableScale';
import { heartZone } from '@/features/live/liveWorkout';
import { useHrZones } from '@/features/hrzones/settings';
import { useAnalysisPalette } from '@/features/workouts/analysis/palette';
import { hrZoneColor } from '@/features/workouts/analysis/ui';
import { fmtInt } from '@/i18n';
import { spacing, useColors } from '@/theme';

import { FIELD_DASH, formatMetric } from '../fieldFormat';
import { FOOT_ONLY_METRICS, footKind, gridPages, type FieldSportKind, type GridPage, type RunMetricId, type RunMetricValues } from '../runFields';
import { useRunLayout } from '../runLayoutStore';
import { MetricPicker } from './MetricPicker';
import { MetricTile } from './MetricTile';

/** What opens the field editor: from the screen's edit button (no slot) or from a long press on a tile (that slot). */
export interface FieldEditor {
  /** Whether the editor is open, and on which slot (null: the overview). */
  state: { open: boolean; slot: number | null };
  open: (slot?: number) => void;
  close: () => void;
}

export function useFieldEditor(): FieldEditor {
  const [state, setState] = useState<{ open: boolean; slot: number | null }>({ open: false, slot: null });
  return {
    state,
    open: (slot) => setState({ open: true, slot: slot ?? null }),
    close: () => setState({ open: false, slot: null }),
  };
}

interface MetricGridProps {
  kind: FieldSportKind;
  values: RunMetricValues;
  editor: FieldEditor;
  /** Metrics this screen can never read; the editor does not offer them. */
  exclude?: readonly RunMetricId[];
  /** Metrics whose reading comes from the phone's own step counter: their label says so. */
  phoneMeasured?: readonly RunMetricId[];
}

const NONE: readonly RunMetricId[] = [];

/**
 * The data fields of a live workout in the layout saved for the sport kind, the first optionally large. Up to six fields are one page;
 * more go to further pages, swiped sideways (dots below say which). The heart rate tile takes the colour and name of its training zone
 * (the person's zone settings), as does the zone field. A long press on a tile, or the screen's edit button, opens the editor.
 */
export function MetricGrid({ kind, values, editor, exclude = NONE, phoneMeasured = NONE }: MetricGridProps) {
  const { t } = useTranslation('sharing');
  const colors = useColors();
  const zones = useHrZones();
  const palette = useAnalysisPalette();
  const [layout, setLayout] = useRunLayout(kind);
  const foot = footKind(kind);
  const pickerExclude = foot ? exclude : [...exclude, ...FOOT_ONLY_METRICS];
  const pages = gridPages(layout);
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const scroller = useRef<ScrollView>(null);
  const current = Math.min(page, pages.length - 1);
  const hr = values.hr ?? null;
  const zone = hr !== null ? heartZone(hr, zones) : null;
  const zoneColor = zone ? hrZoneColor(palette, zone.zone) : null;
  const zoneShown = layout.ids.includes('hrZone');

  // Fewer pages after an edit: the pager stays on the last one there is.
  useEffect(() => {
    if (width > 0) scroller.current?.scrollTo({ x: width * current, animated: false });
  }, [width, current]);

  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setWidth((old) => (old === next ? old : next));
  };
  const onEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width > 0) setPage(Math.round(event.nativeEvent.contentOffset.x / width));
  };

  const tile = (id: RunMetricId, slot: number, size: number) => {
    const label = t(`live.fields.metric.${id}`);
    const common = {
      label: phoneMeasured.includes(id) ? t('live.fields.phoneLabel', { label }) : label,
      size: size === 1 ? ('hero' as const) : size === 2 ? ('lg' as const) : ('md' as const),
      longPressHint: t('live.fields.longPress'),
      onLongPress: () => editor.open(slot),
    };
    if (id === 'hrZone') {
      return (
        <MetricTile
          key={id}
          {...common}
          value={zone ? fmtInt(zone.zone) : FIELD_DASH}
          zone={zone && zoneColor ? { color: zoneColor, text: zone.label } : null}
        />
      );
    }
    const text = formatMetric(id, values[id], foot);
    // The zone's name is on the heart-rate tile unless the zone has a field of its own; the tint stays.
    const hrZone = id === 'hr' && zone && zoneColor ? { color: zoneColor, text: zoneShown ? null : t('live.zone', { zone: zone.zone, label: zone.label }) } : null;
    return <MetricTile key={id} {...common} value={text.value} unit={text.unit} zone={hrZone} />;
  };

  const renderPage = (p: GridPage) => {
    let index = p.start;
    return (
      <View key={p.start} style={[styles.grid, pages.length > 1 ? { width } : null]}>
        {p.rows.map((size, rowIndex) => {
          const start = index;
          index += size;
          return (
            <View key={rowIndex} style={styles.row}>
              {layout.ids.slice(start, start + size).map((id, offset) => tile(id, start + offset, size))}
            </View>
          );
        })}
      </View>
    );
  };

  return (
    <>
      {pages.length === 1 ? (
        pages.map(renderPage)
      ) : (
        <View style={styles.pager}>
          <View onLayout={onLayout}>
            {width > 0 ? (
              <ScrollView
                ref={scroller}
                horizontal
                pagingEnabled
                bounces={false}
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={onEnd}
                contentContainerStyle={styles.pages}>
                {pages.map(renderPage)}
              </ScrollView>
            ) : null}
          </View>
          <View style={styles.dots}>
            {pages.map((p, index) => (
              <PressableScale
                key={p.start}
                accessibilityRole="button"
                accessibilityState={{ selected: index === current }}
                accessibilityLabel={t('live.fields.page', { current: index + 1, total: pages.length })}
                hitSlop={12}
                onPress={() => {
                  setPage(index);
                  scroller.current?.scrollTo({ x: width * index, animated: true });
                }}>
                <View style={[styles.dot, index === current ? [styles.dotOn, { backgroundColor: colors.foreground }] : { backgroundColor: colors.hairline }]} />
              </PressableScale>
            ))}
          </View>
        </View>
      )}
      <MetricPicker
        visible={editor.state.open}
        initialSlot={editor.state.slot}
        layout={layout}
        exclude={pickerExclude}
        onChange={(next) => setLayout(next, pickerExclude)}
        onClose={editor.close}
      />
    </>
  );
}

const styles = StyleSheet.create({
  grid: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  pager: { gap: spacing.sm },
  pages: { alignItems: 'flex-start' },
  dots: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotOn: { width: 22 },
});
