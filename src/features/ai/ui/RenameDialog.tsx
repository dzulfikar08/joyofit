import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { overlay, spacing, useTheme } from '@/theme';
import { CHAT_LIMITS } from '../conversations';

interface Props {
  visible: boolean;
  /** The whole current title: shown in full, so a title that is cut in the header can be read here. */
  title: string;
  onSave: (title: string) => void;
  onClose: () => void;
}

/** The full title of a chat, editable. An empty name goes back to the first question. */
export function RenameDialog({ visible, title, onSave, onClose }: Props) {
  const { t } = useTranslation('ai');
  const { colors, radius } = useTheme();
  const [value, setValue] = useState(title);
  // Reset the draft each time the dialog opens or the title changes while open.
  const [seen, setSeen] = useState({ visible, title });
  if (seen.visible !== visible || seen.title !== title) {
    setSeen({ visible, title });
    if (visible) setValue(title);
  }
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={t('chat.renameCancel')}>
          <Pressable
            accessibilityViewIsModal
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.hairline, borderRadius: radius.card }]}
            onPress={() => {}}>
            <AppText variant="heading" accessibilityRole="header">
              {t('chat.renameTitle')}
            </AppText>
            <Input value={value} onChangeText={setValue} multiline maxLength={CHAT_LIMITS.titleChars} autoFocus accessibilityLabel={t('chat.renameTitle')} />
            <AppText variant="caption" muted>
              {t('chat.renameBody')}
            </AppText>
            <View style={styles.actions}>
              <Button label={t('chat.renameSave')} variant="primary" onPress={() => onSave(value)} />
              <Button label={t('chat.renameCancel')} onPress={onClose} />
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrim: { flex: 1, backgroundColor: overlay.scrim, justifyContent: 'center', padding: spacing.lg },
  card: { borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, gap: spacing.md },
  actions: { gap: spacing.sm, paddingTop: spacing.sm },
});
