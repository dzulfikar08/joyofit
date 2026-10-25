import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Card } from '@/components/Screen';
import { searchCatalogue } from '@/features/device/watchCatalogue';
import { WatchGlyph } from '@/features/onboarding/pair/WatchGlyph';
import { spacing, useColors } from '@/theme';

interface AddManuallySheetProps {
  visible: boolean;
  onPick: (model: string) => void;
  onClose: () => void;
}

/**
 * "Add manually", after Huawei Health's list of series: every model JoyoFit knows, grouped by family with how far JoyoFit gets with it,
 * and a search box. Picking one closes the list; the pairing step then explains how that model is put in pairing mode and marks its
 * cards in the scan.
 */
export function AddManuallySheet({ visible, onPick, onClose }: AddManuallySheetProps) {
  const { t } = useTranslation(['onboarding', 'nowatch', 'common']);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const groups = useMemo(() => searchCatalogue(query), [query]);
  const count = groups.reduce((sum, g) => sum + g.models.length, 0);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.modal, { backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <AppText variant="heading" style={styles.title} accessibilityRole="header">
            {t('onboarding:pair.manual.title')}
          </AppText>
          <Button label={t('common:actions.close')} variant="ghost" onPress={onClose} />
        </View>
        <View style={styles.search}>
          <Input
            icon="search"
            value={query}
            onChangeText={setQuery}
            placeholder={t('onboarding:pair.manual.search')}
            accessibilityLabel={t('onboarding:pair.manual.search')}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
          <AppText variant="caption" muted>
            {t('onboarding:pair.manual.count', { count })}
          </AppText>
        </View>
        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {groups.length === 0 ? (
            <AppText variant="body" muted>
              {t('onboarding:pair.manual.none')}
            </AppText>
          ) : null}
          {groups.map((group) => (
            <Card key={group.family.id} style={styles.group}>
              <View style={styles.groupHead}>
                <WatchGlyph size={48} highlighted={group.family.support === 'tested'} />
                <View style={styles.groupText}>
                  <AppText variant="bodyStrong">{group.family.name}</AppText>
                  <AppText variant="caption" muted>
                    {t(`nowatch:supported.status.${group.family.support}`)}
                  </AppText>
                </View>
              </View>
              {group.models.map((model) => (
                <Pressable
                  key={model}
                  accessibilityRole="button"
                  accessibilityLabel={model}
                  onPress={() => {
                    onPick(model);
                    setQuery('');
                  }}
                  style={({ pressed }) => [styles.model, { borderTopColor: colors.hairline }, pressed && { backgroundColor: colors.muted }]}>
                  <AppText variant="body" style={styles.groupText}>
                    {model}
                  </AppText>
                  <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
                </Pressable>
              ))}
            </Card>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  title: { flex: 1 },
  search: { gap: spacing.xs, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  list: { gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  group: { gap: spacing.xs },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingBottom: spacing.sm },
  groupText: { flex: 1 },
  model: { flexDirection: 'row', alignItems: 'center', minHeight: 48, borderTopWidth: StyleSheet.hairlineWidth },
});
