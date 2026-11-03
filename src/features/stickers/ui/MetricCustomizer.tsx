import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import type { SportCategory } from '@/features/workouts/sportCategory';
import { useTranslation } from '@/i18n';
import { spacing, useTheme } from '@/theme';

import {
  getAvailableHeroMetrics,
  getAvailableSecondaryMetrics,
  getDefaultConfig,
  type CustomMetricsConfig,
} from '../data/customMetrics';
import { METRIC_CATALOG } from '../data/metricCatalog';
import type { JsonObject } from '../subject';
import { HeroMetricPicker } from './HeroMetricPicker';
import { SecondaryMetricSlots } from './SecondaryMetricSlots';

interface Props {
  run: JsonObject;
  category: SportCategory;
  /** `null` until the person changes something: the card then draws its own fixed numbers. */
  config: CustomMetricsConfig | null;
  onChange: (config: CustomMetricsConfig | null) => void;
  /** The secondary numbers the chosen template draws (`customSlotCount`). */
  slots: number;
}

export function MetricCustomizer({ run, category, config, onChange, slots }: Props) {
  const { colors, fonts, radius } = useTheme();
  const { t } = useTranslation('stickers');
  const [expanded, setExpanded] = useState(false);

  // Edits start from the sport's defaults (all four picks, whatever this template shows), so a later, roomier template keeps them.
  const base = useMemo(() => config ?? getDefaultConfig(run, category), [config, run, category]);
  const heroMetrics = useMemo(() => getAvailableHeroMetrics(run), [run]);
  const secondaryAvailable = useMemo(() => getAvailableSecondaryMetrics(run, base.heroId), [run, base.heroId]);
  const metricLabels = useMemo(() => {
    const map: Record<string, string> = Object.create(null);
    for (const m of METRIC_CATALOG) map[m.id] = t(`label.${m.labelKey}` as 'label.time');
    return map;
  }, [t]);

  // The picks past this template's slots are kept for a template with more room.
  const hidden = (except?: string) => base.secondaryIds.slice(slots).filter((id) => id !== except);
  const shown = base.secondaryIds.slice(0, slots);

  const selectHero = (heroId: string) => onChange({ heroId, secondaryIds: [...shown.filter((id) => id !== heroId), ...hidden(heroId)] });
  const addSecondary = (id: string) => {
    if (shown.length >= slots || shown.includes(id)) return;
    onChange({ ...base, secondaryIds: [...shown, id, ...hidden(id)] });
  };
  const reorderSecondary = (ids: string[]) => onChange({ ...base, secondaryIds: [...ids, ...hidden()] });
  const removeSecondary = (id: string) => onChange({ ...base, secondaryIds: [...shown.filter((item) => item !== id), ...hidden()] });

  if (heroMetrics.length <= 1) return null;
  const customized = config !== null;

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
          <AppText variant="caption" muted={!customized} style={{ fontFamily: fonts.medium }}>
            {customized ? t('ui.customMetrics.customBadge') : t('ui.customMetrics.defaultBadge')}
          </AppText>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.mutedForeground} />
      </PressableScale>

      {expanded ? (
        <View style={styles.content}>
          {customized ? (
            <View style={styles.resetRow}>
              <PressableScale accessibilityRole="button" onPress={() => onChange(null)}>
                <AppText variant="caption" style={{ color: colors.primary, fontFamily: fonts.bold }}>
                  {t('ui.customMetrics.reset')}
                </AppText>
              </PressableScale>
            </View>
          ) : null}

          <HeroMetricPicker metrics={heroMetrics} selectedHeroId={base.heroId} onSelectHero={selectHero} />

          <SecondaryMetricSlots
            secondaryIds={shown}
            availableMetrics={secondaryAvailable}
            metricLabels={metricLabels}
            maxSlots={slots}
            onReorder={reorderSecondary}
            onAdd={addSecondary}
            onRemove={removeSecondary}
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
