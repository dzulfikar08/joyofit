import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { PressableScale } from '@/components/PressableScale';
import { Segmented } from '@/components/Segmented';
import { SwitchRow } from '@/components/SwitchRow';
import { spacing, useTheme } from '@/theme';

import { assignMetric, FIELD_COUNTS, PAGE_SIZE, RUN_METRIC_IDS, withCount, type FieldCount, type RunLayout, type RunMetricId } from '../runFields';

interface MetricPickerProps {
  visible: boolean;
  /** Open on the list of metrics for this slot (a long press on a tile); null opens on the overview of every slot. */
  initialSlot: number | null;
  layout: RunLayout;
  /** Metrics this screen has no reading for at all (the phone recorder has no altitude); they are not offered. */
  exclude?: readonly RunMetricId[];
  onChange: (layout: RunLayout) => void;
  onClose: () => void;
}

/**
 * The editor of a live workout's data fields: four to twelve fields (more than six on further pages), a large first field, and for each
 * slot the metric it shows. Choosing a metric already shown in another slot swaps the two, so no figure appears twice.
 */
export function MetricPicker({ visible, initialSlot, layout, exclude, onChange, onClose }: MetricPickerProps) {
  // The key restarts the sheet's own state (which slot is open) each time it is shown.
  return visible ? <Sheet key={String(initialSlot)} initialSlot={initialSlot} layout={layout} exclude={exclude} onChange={onChange} onClose={onClose} /> : null;
}

type SheetProps = Omit<MetricPickerProps, 'visible'>;

const NONE: readonly RunMetricId[] = [];

function Sheet({ initialSlot, layout, exclude = NONE, onChange, onClose }: SheetProps) {
  const { t } = useTranslation('sharing');
  const { colors, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const [slot, setSlot] = useState<number | null>(initialSlot);
  const choosing = slot !== null;

  const back = () => (initialSlot !== null ? onClose() : setSlot(null));

  return (
    <Modal visible animationType="slide" onRequestClose={choosing ? back : onClose} statusBarTranslucent>
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={styles.header}>
          <AppText variant="heading" accessibilityRole="header" style={styles.title}>
            {choosing ? t('live.fields.slotTitle', { number: slot + 1 }) : t('live.fields.title')}
          </AppText>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={choosing ? t('live.fields.back') : t('live.fields.close')}
            onPress={choosing ? back : onClose}
            style={[styles.close, { backgroundColor: colors.muted, borderRadius: radius.control }]}>
            <Ionicons name={choosing ? 'chevron-back' : 'close'} size={24} color={colors.foreground} />
          </PressableScale>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing.xl, gap: spacing.md }}>
          {choosing ? (
            RUN_METRIC_IDS.filter((id) => !exclude.includes(id) || layout.ids[slot] === id).map((id) => {
              const current = layout.ids[slot] === id;
              return (
                <PressableScale
                  key={id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: current }}
                  scaleTo={0.98}
                  onPress={() => {
                    onChange(assignMetric(layout, slot, id));
                    if (initialSlot !== null) onClose();
                    else setSlot(null);
                  }}
                  style={[styles.row, { backgroundColor: current ? colors.muted : 'transparent', borderRadius: radius.control }]}>
                  <View style={styles.rowText}>
                    <AppText variant="bodyStrong">{t(`live.fields.metric.${id}`)}</AppText>
                    {layout.ids.includes(id) && !current ? (
                      <AppText variant="caption" muted>
                        {t('live.fields.shownIn', { number: layout.ids.indexOf(id) + 1 })}
                      </AppText>
                    ) : null}
                  </View>
                  {current ? <Ionicons name="checkmark" size={22} color={colors.primary} /> : null}
                </PressableScale>
              );
            })
          ) : (
            <>
              <View style={styles.setting}>
                <AppText variant="bodyStrong">{t('live.fields.count')}</AppText>
                <Segmented<FieldCount>
                  options={FIELD_COUNTS.map((count) => ({ value: count, label: String(count) }))}
                  value={FIELD_COUNTS.find((count) => count === layout.ids.length) ?? 4}
                  onChange={(count) => onChange(withCount(layout, count, exclude))}
                />
                <AppText variant="caption" muted>
                  {t('live.fields.pagesHint', { count: PAGE_SIZE })}
                </AppText>
              </View>
              <SwitchRow
                label={t('live.fields.big')}
                hint={t('live.fields.bigHint')}
                value={layout.big}
                onValueChange={(big) => onChange({ ...layout, big })}
              />
              {layout.ids.map((id, index) => (
                <PressableScale
                  key={id}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('live.fields.slotTitle', { number: index + 1 })}: ${t(`live.fields.metric.${id}`)}`}
                  scaleTo={0.98}
                  onPress={() => setSlot(index)}
                  style={[styles.row, { backgroundColor: colors.muted, borderRadius: radius.control }]}>
                  <View style={styles.rowText}>
                    <AppText variant="caption" muted>
                      {t('live.fields.slotTitle', { number: index + 1 })}
                    </AppText>
                    <AppText variant="bodyStrong">{t(`live.fields.metric.${id}`)}</AppText>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.mutedForeground} />
                </PressableScale>
              ))}
              <Button label={t('live.fields.done')} variant="primary" onPress={onClose} />
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  title: { flex: 1 },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  setting: { gap: spacing.sm },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  rowText: { flex: 1, gap: 1 },
});
