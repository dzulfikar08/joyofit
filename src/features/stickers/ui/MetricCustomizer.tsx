import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import type { SportCategory } from '@/features/workouts/sportCategory';
import { useTranslation } from '@/i18n';
import { spacing, useTheme } from '@/theme';

import type { Template } from '../core/schema';
import {
  getAvailableHeroMetrics,
  getAvailableSecondaryMetrics,
  getDefaultConfig,
  getTemplateSecondarySlotCount,
  MAX_SECONDARY_METRICS,
  type CustomMetricsConfig,
} from '../data/customMetrics';
import type { JsonObject } from '../subject';
import { HeroMetricPicker } from './HeroMetricPicker';
import { SecondaryMetricSlots } from './SecondaryMetricSlots';

interface Props {
  run: JsonObject;
  category: SportCategory;
  config: CustomMetricsConfig;
  onChange: (config: CustomMetricsConfig) => void;
  template?: Template | string | null;
  maxSecondarySlots?: number;
}

export function MetricCustomizer({
  run,
  category,
  config,
  onChange,
  template,
  maxSecondarySlots: propMaxSlots,
}: Props) {
  const { colors, fonts, radius } = useTheme();
  const { t } = useTranslation('stickers');
  const [expanded, setExpanded] = useState(false);

  const maxSecondarySlots = propMaxSlots ?? (template ? getTemplateSecondarySlotCount(template) : MAX_SECONDARY_METRICS);

  const heroMetrics = useMemo(() => getAvailableHeroMetrics(run, category), [run, category]);
  const secondaryAvailable = useMemo(
    () => getAvailableSecondaryMetrics(run, category, config.heroId),
    [run, category, config.heroId],
  );
  const defaults = useMemo(
    () => getDefaultConfig(run, category, maxSecondarySlots),
    [run, category, maxSecondarySlots],
  );

  const activeSecondaryIds = useMemo(
    () => config.secondaryIds.slice(0, maxSecondarySlots),
    [config.secondaryIds, maxSecondarySlots],
  );

  const isCustomized = useMemo(() => {
    if (config.heroId !== defaults.heroId) return true;
    if (activeSecondaryIds.length !== defaults.secondaryIds.length) return true;
    return activeSecondaryIds.some((id, i) => id !== defaults.secondaryIds[i]);
  }, [config.heroId, defaults, activeSecondaryIds]);

  const metricLabels = useMemo(() => {
    const map: Record<string, string> = Object.create(null);
    for (const m of heroMetrics) {
      map[m.id] = t(`label.${m.labelKey}` as 'label.time');
    }
    return map;
  }, [heroMetrics, t]);

  const handleHeroSelect = (heroId: string) => {
    const nextSecondary = activeSecondaryIds.filter((id) => id !== heroId);
    const rest = config.secondaryIds.slice(maxSecondarySlots).filter((id) => id !== heroId);
    onChange({ heroId, secondaryIds: [...nextSecondary, ...rest] });
  };

  const handleAddSecondary = (id: string) => {
    if (activeSecondaryIds.length >= maxSecondarySlots) return;
    if (activeSecondaryIds.includes(id)) return;
    const nextSecondary = [...activeSecondaryIds, id];
    const rest = config.secondaryIds.slice(maxSecondarySlots).filter((item) => item !== id);
    onChange({ ...config, secondaryIds: [...nextSecondary, ...rest] });
  };

  const handleRemoveSecondary = (id: string) => {
    const nextSecondary = activeSecondaryIds.filter((item) => item !== id);
    const rest = config.secondaryIds.slice(maxSecondarySlots);
    onChange({ ...config, secondaryIds: [...nextSecondary, ...rest] });
  };

  const handleReorderSecondary = (reordered: string[]) => {
    const rest = config.secondaryIds.slice(maxSecondarySlots);
    onChange({ ...config, secondaryIds: [...reordered, ...rest] });
  };
  if (heroMetrics.length <= 1) return null;

  return (
    <View style={[styles.root, { backgroundColor: colors.muted, borderRadius: radius.card }]}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t('ui.customMetrics.title')}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((prev) => !prev)}
        style={styles.header}>
        <Ionicons name="stats-chart-outline" size={18} color={colors.foreground} />
        <AppText variant="label" style={[styles.title, { fontFamily: fonts.bold }]}>
          {t('ui.customMetrics.title')}
        </AppText>
        <View style={[styles.badge, { backgroundColor: colors.card, borderRadius: radius.control }]}>
          <AppText variant="caption" muted={!isCustomized} style={{ fontFamily: fonts.medium }}>
            {isCustomized ? t('ui.customMetrics.customBadge') : t('ui.customMetrics.defaultBadge')}
          </AppText>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.mutedForeground} />
      </PressableScale>

      {expanded ? (
        <View style={styles.content}>
          {isCustomized ? (
            <View style={styles.resetRow}>
              <PressableScale accessibilityRole="button" onPress={() => onChange(defaults)}>
                <AppText variant="caption" style={{ color: colors.primary, fontFamily: fonts.bold }}>
                  {t('ui.customMetrics.reset')}
                </AppText>
              </PressableScale>
            </View>
          ) : null}

          <HeroMetricPicker
            metrics={heroMetrics}
            selectedHeroId={config.heroId}
            onSelectHero={handleHeroSelect}
          />

          <SecondaryMetricSlots
            secondaryIds={activeSecondaryIds}
            availableMetrics={secondaryAvailable}
            metricLabels={metricLabels}
            maxSlots={maxSecondarySlots}
            onReorder={handleReorderSecondary}
            onAdd={handleAddSecondary}
            onRemove={handleRemoveSecondary}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.sm,
  },
  title: { flex: 1 },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  resetRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
});
