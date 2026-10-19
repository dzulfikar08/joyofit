import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Divider, Section } from '@/components/Screen';
import { fmtDateTime, fmtDecimal } from '@/i18n/format';
import type { WeighIn } from '@/features/scale/store';
import { spacing } from '@/theme';

import { bodyValues, type BodyValue } from './format';

interface HistorySectionProps {
  weighIns: readonly WeighIn[];
  rogoWaiting: number;
  needsProfile: boolean;
  onRetry: () => void;
  onDelete: (id: number) => void;
}

function BodyLine({ values, label }: { values: BodyValue[]; label: string }) {
  const { t } = useTranslation('scale');
  if (values.length === 0) return null;
  return (
    <AppText variant="caption" muted>
      {`${label}: ${values.map((v) => t(`body.${v.key}`, { value: fmtDecimal(v.value, v.key === 'visceral' || v.key === 'bmr' ? 0 : 1) })).join(', ')}`}
    </AppText>
  );
}

/** The local weigh-in history, with what JoyoRogo has of it. Body values from the scale and formula estimates are labelled apart. */
export function HistorySection({ weighIns, rogoWaiting, needsProfile, onRetry, onDelete }: HistorySectionProps) {
  const { t } = useTranslation('scale');
  const anyImpedance = weighIns.some((w) => w.impedanceOhm !== null && w.reported === null);
  return (
    <Section title={t('history.title')} icon="time-outline">
      {rogoWaiting > 0 ? (
        <View style={styles.waiting}>
          <AppText variant="caption" muted style={styles.waitingText}>
            {t('history.waiting', { count: rogoWaiting })}
          </AppText>
          <Button label={t('history.retry')} onPress={onRetry} />
        </View>
      ) : null}
      {weighIns.length === 0 ? (
        <AppText variant="caption" muted>
          {t('history.empty')}
        </AppText>
      ) : (
        weighIns.map((w, index) => (
          <View key={w.id}>
            {index > 0 ? <Divider /> : null}
            <View style={styles.row}>
              <View style={styles.text}>
                <AppText variant="bodyStrong">{t('live.weight', { value: fmtDecimal(w.weightKg, 1) })}</AppText>
                <AppText variant="caption" muted>
                  {`${fmtDateTime(w.takenAt)} · ${t(`history.${w.rogoState}`)}`}
                </AppText>
                <BodyLine values={bodyValues(w.reported)} label={t('body.measured')} />
                <BodyLine values={bodyValues(w.estimate)} label={t('body.estimate')} />
              </View>
              <Button label={t('history.delete')} variant="ghost" onPress={() => onDelete(w.id)} />
            </View>
          </View>
        ))
      )}
      {needsProfile && anyImpedance ? (
        <AppText variant="caption" muted>
          {t('body.needProfile')}
        </AppText>
      ) : null}
      {weighIns.some((w) => w.estimate !== null) ? (
        <AppText variant="caption" muted>
          {t('body.estimateNote')}
        </AppText>
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  text: { flex: 1, gap: 2 },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  waitingText: { flex: 1 },
});
