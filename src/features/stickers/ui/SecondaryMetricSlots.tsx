import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Chip } from '@/components/Chip';
import { useTranslation } from '@/i18n';
import { spacing, useTheme } from '@/theme';

import { MAX_SECONDARY_METRICS, type MetricDefinition } from '../data/customMetrics';
import { SlotItem } from './SlotItem';

interface SecondaryMetricSlotsProps {
  secondaryIds: readonly string[];
  availableMetrics: readonly MetricDefinition[];
  metricLabels: Record<string, string>;
  maxSlots?: number;
  onReorder: (ids: string[]) => void;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}

export function SecondaryMetricSlots({
  secondaryIds,
  availableMetrics,
  metricLabels,
  maxSlots,
  onReorder,
  onAdd,
  onRemove,
}: SecondaryMetricSlotsProps) {
  const { fonts } = useTheme();
  const { t } = useTranslation('stickers');

  const move = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= secondaryIds.length) return;
    const next = [...secondaryIds];
    const [item] = next.splice(fromIndex, 1);
    if (!item) return;
    next.splice(toIndex, 0, item);
    onReorder(next);
  };

  const max = maxSlots ?? MAX_SECONDARY_METRICS;
  const unusedAvailable = availableMetrics.filter((m) => !secondaryIds.includes(m.id));
  const canAdd = secondaryIds.length < max;
  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <AppText variant="caption" muted style={[styles.sectionTitle, { fontFamily: fonts.bold }]}>
          {t('ui.customMetrics.secondaryTitle')}
        </AppText>
        <AppText variant="caption" muted style={{ fontFamily: fonts.medium }}>
          {t('ui.customMetrics.secondarySlots', { count: secondaryIds.length, max })}
        </AppText>
      </View>

      <View style={styles.slotsList}>
        {secondaryIds.map((id, index) => (
          <SlotItem
            key={id}
            index={index}
            label={metricLabels[id] ?? id}
            isFirst={index === 0}
            isLast={index === secondaryIds.length - 1}
            onMoveUp={() => move(index, index - 1)}
            onMoveDown={() => move(index, index + 1)}
            onRemove={() => onRemove(id)}
          />
        ))}
      </View>

      {canAdd && unusedAvailable.length > 0 ? (
        <View style={styles.availableSection}>
          <AppText variant="caption" muted style={styles.subcaption}>
            {t('ui.customMetrics.addMetric')}
          </AppText>
          <View style={styles.chipGrid}>
            {unusedAvailable.map((m) => (
              <Chip
                key={m.id}
                role="button"
                label={`+ ${metricLabels[m.id] ?? m.id}`}
                selected={false}
                onPress={() => onAdd(m.id)}
              />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  slotsList: {
    gap: spacing.xs,
  },
  availableSection: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  subcaption: {
    fontSize: 12,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
});
