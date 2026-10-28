import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Section } from '@/components/Screen';
import { fmtDecimal } from '@/i18n/format';
import { scaleLabel, type SavedScale } from '@/features/scale/store';
import { shownName } from '@/features/device/shownName';
import type { ScaleLive } from '@/state/ScaleProvider';
import { spacing } from '@/theme';

interface LiveCardProps {
  scale: SavedScale;
  kindLabel: string | null;
  /** The scale sends the weight and nothing else: say so instead of leaving body values to be missed. */
  weightOnly: boolean;
  /** The scale's key is not saved yet, so nothing can be read from it. */
  needsKey: boolean;
  live: ScaleLive;
  testing: boolean;
  onTest: () => void;
  onStopTest: () => void;
  onRename: () => void;
  onForget: () => void;
}

/** The picked scale: what it sends right now, a test weigh-in, rename and forget. */
export function LiveCard({ scale, kindLabel, weightOnly, needsKey, live, testing, onTest, onStopTest, onRename, onForget }: LiveCardProps) {
  const { t } = useTranslation('scale');
  const headline =
    live.reading === null
      ? t('live.stepOn')
      : t('live.weight', { value: fmtDecimal(live.reading.weightKg, 1) });
  const sub =
    live.reading === null
      ? needsKey
        ? t('live.needsKey')
        : t(`live.status.${live.status}`)
      : live.settled
        ? t('live.settled')
        : t('live.unsettled');
  return (
    <Section title={shownName(scaleLabel(scale))} icon="scale-outline">
      {kindLabel ? (
        <AppText variant="caption" muted>
          {weightOnly ? t('card.kindWeightOnly', { label: kindLabel }) : t('card.kind', { label: kindLabel })}
        </AppText>
      ) : null}
      {weightOnly ? (
        <AppText variant="caption" muted>
          {t('card.weightOnlyNote')}
        </AppText>
      ) : null}
      <View style={styles.reading} accessibilityLiveRegion="polite">
        <AppText variant="display">{headline}</AppText>
        <AppText variant="caption" muted>
          {sub}
        </AppText>
      </View>
      <View style={styles.actions}>
        {testing ? (
          <Button label={t('live.stop')} icon="stop-circle-outline" onPress={onStopTest} />
        ) : (
          <Button label={t('live.test')} icon="play-circle-outline" variant="primary" disabled={needsKey} onPress={onTest} />
        )}
        <Button label={t('card.rename')} icon="create-outline" onPress={onRename} />
        <Button label={t('card.forget')} icon="trash-outline" variant="ghost" onPress={onForget} />
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  reading: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.md },
  actions: { gap: spacing.sm },
});
