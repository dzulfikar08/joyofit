import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Chip } from '@/components/Chip';
import { useTranslation } from '@/i18n';
import { spacing, useTheme } from '@/theme';

import type { MetricDefinition } from '../data/customMetrics';

interface HeroMetricPickerProps {
  metrics: readonly MetricDefinition[];
  selectedHeroId: string;
  onSelectHero: (id: string) => void;
}

export function HeroMetricPicker({ metrics, selectedHeroId, onSelectHero }: HeroMetricPickerProps) {
  const { fonts } = useTheme();
  const { t } = useTranslation('stickers');

  return (
    <View style={styles.container}>
      <AppText variant="caption" muted style={[styles.sectionTitle, { fontFamily: fonts.bold }]}>
        {t('ui.customMetrics.heroTitle')}
      </AppText>
      <View style={styles.chipGrid}>
        {metrics.map((m) => (
          <Chip
            key={m.id}
            role="radio"
            label={t(`label.${m.labelKey}` as 'label.time')}
            selected={m.id === selectedHeroId}
            onPress={() => onSelectHero(m.id)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  sectionTitle: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
});
