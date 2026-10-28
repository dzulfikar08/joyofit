import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet } from 'react-native';

import { Button } from '@/components/Button';
import { UpgradeCard } from '@/features/pro/UpgradeCard';
import { overlay, spacing } from '@/theme';

/** The Pro offer over the current screen, for a free account that reached a Pro-only row or limit. Back or a tap outside closes it. */
export function ProUpsellDialog({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation('common');
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={t('actions.close')}>
        {/* A press on the card itself must not reach the scrim. */}
        <Pressable accessibilityViewIsModal style={styles.card} onPress={() => {}}>
          <UpgradeCard moment="family" onOpened={onClose} />
          <Button label={t('actions.close')} onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: overlay.scrim, justifyContent: 'center', padding: spacing.lg },
  card: { gap: spacing.sm },
});
