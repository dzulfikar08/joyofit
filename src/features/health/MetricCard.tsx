import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { KeyValue } from '@/components/KeyValue';
import { Metric } from '@/components/Metric';
import { Section } from '@/components/Screen';
import { metaOrFallback, rawPairs } from '@/features/health/metrics';
import { Sparkline } from '@/features/health/Sparkline';
import type { HealthMetricData } from '@/features/health/useHealthMetrics';
import { formatAgo } from '@/format';
import { useTranslation } from '@/i18n';
import { spacing, tintColors, useColors } from '@/theme';

/** One metric: latest value with its age, the 7-day line, or the raw key/value pairs when the layout is unknown. */
export function MetricCard({ metric, nowSec }: { metric: HealthMetricData; nowSec: number }) {
  const { t } = useTranslation('health');
  const router = useRouter();
  const colors = useColors();
  const { type, status, latest, week } = metric;
  const meta = metaOrFallback(type);
  const title = meta.label || status?.title || type;
  const tint = tintColors(colors, meta.tint);
  const measuredAt = latest ? Math.max(latest.ts, latest.last_ts) : null;
  const value = latest?.value ?? null;
  const dayRoute = latest !== null ? meta.dayRoute : undefined;

  return (
    <Section
      title={title}
      icon={meta.icon}
      tint={meta.tint}
      onPress={dayRoute ? () => router.push(dayRoute) : undefined}
      trailing={
        measuredAt !== null ? (
          <AppText variant="caption" muted>
            {formatAgo(measuredAt, nowSec)}
          </AppText>
        ) : null
      }>
      {latest === null ? (
        <View style={styles.stack}>
          <AppText variant="caption" muted>
            {status?.note ?? t('card.nothingStored')}
          </AppText>
        </View>
      ) : value !== null ? (
        <View style={styles.stack}>
          <View style={styles.value}>
            <Metric value={meta.format(value)} unit={meta.unit || undefined} size="lg" color={tint.text} />
            {meta.hint ? (
              <AppText variant="caption" muted>
                {meta.hint}
              </AppText>
            ) : null}
          </View>
          <Sparkline
            points={week}
            color={tint.base}
            label={t('card.weekLabel', { title })}
          />
        </View>
      ) : (
        <View style={styles.stack}>
          <AppText variant="caption" muted>
            {t('card.rawValues')}
          </AppText>
          {rawPairs(latest.values_json).map(([key, text]) => (
            <KeyValue key={key} label={key} value={text} />
          ))}
        </View>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  value: { gap: 2 },
});
