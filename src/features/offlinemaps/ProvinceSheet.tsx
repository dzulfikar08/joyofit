import { useTranslation } from 'react-i18next';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { IconChip } from '@/components/IconChip';
import { PressableScale } from '@/components/PressableScale';
import { IconAction } from '@/features/courses/IconAction';
import { overlay, spacing, useTheme } from '@/theme';

import type { ProvinceTotal } from './listing';

interface ProvinceSheetProps {
  visible: boolean;
  provinces: readonly ProvinceTotal[];
  /** Null = every province. */
  selected: string | null;
  onPick: (province: string | null) => void;
  onClose: () => void;
}

type Choice = { province: string | null; count: number };

/** A bottom sheet of the catalog's provinces with their map counts; "Semua provinsi" clears the choice. */
export function ProvinceSheet({ visible, provinces, selected, onPick, onClose }: ProvinceSheetProps) {
  const { t } = useTranslation(['settings', 'common']);
  const { colors, radius } = useTheme();
  const total = provinces.reduce((sum, p) => sum + p.count, 0);
  // Maps from a server without provinces cannot be picked by province; they stay under "all".
  const choices: Choice[] = [{ province: null, count: total }, ...provinces.filter((p) => p.province !== '')];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={t('common:actions.close')} />
        <View style={[styles.sheet, { backgroundColor: colors.card, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card }]} accessibilityViewIsModal>
          <View style={styles.header}>
            <AppText variant="heading" accessibilityRole="header" style={styles.title}>
              {t('offlineMapLab.pickProvince')}
            </AppText>
            <IconAction icon="close" label={t('common:actions.close')} onPress={onClose} />
          </View>
          <FlatList
            data={choices}
            style={styles.flat}
            keyExtractor={(choice) => choice.province ?? ''}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => {
              const label = item.province ?? t('offlineMapLab.allProvinces');
              const chosen = item.province === selected;
              return (
                <PressableScale
                  accessibilityRole="radio"
                  accessibilityState={{ selected: chosen }}
                  accessibilityLabel={`${label}, ${t('offlineMapLab.regions', { count: item.count })}`}
                  onPress={() => onPick(item.province)}
                  scaleTo={0.985}
                  style={styles.row}>
                  <IconChip icon={chosen ? 'radio-button-on' : 'radio-button-off'} tint={chosen ? 'link' : 'neutral'} size="md" />
                  <AppText variant="bodyStrong" numberOfLines={1} style={styles.rowText}>
                    {label}
                  </AppText>
                  <AppText variant="caption" muted>
                    {t('offlineMapLab.regions', { count: item.count })}
                  </AppText>
                </PressableScale>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: overlay.scrim },
  sheet: { maxHeight: '80%', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1 },
  flat: { flexShrink: 1 },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  rowText: { flex: 1 },
});
